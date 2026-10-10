// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// UpdateControlDefinitionCommand — 设计态控件属性就地编辑 (契约 §12.5)
//
// 验证:
//   A. set — forward(next 有字段) → store.set + 返回非空 patch。
//   B. delete — forward(undefined / 空对象) → store.delete。
//   C. undo — invert 复用自身, forward 后精确还原 old (快照语义)。
//   D. 守卫 — nodeId 不存在 → null; 非 smarttext 节点 → null。
//   E. 守卫 — 未注入 store → null (no-op)。
//   F. single 字段往返 — 布尔字段 (single) 正确写回 / 读回。
// ================================================================

import { describe, it, expect } from 'vitest'
import { UpdateControlDefinitionCommand } from '../command/commands/UpdateControlDefinitionCommand'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import type { BaseNode, ElementMeta } from '../document/core/DocumentModel'
import type { CommandContext, StatePatch } from '../command/ICommand'

const ELEMENT: ElementMeta = {
  code: { internal: 'CTL_PATIENT_NAME', dataElement: 'DE02.01.039.00' },
  name: '患者姓名',
}

const DEFINITION: TemplateDefinition = {
  label: '姓名：', tips: '患者姓名', prefix: '【', suffix: '】',
  deletable: true, editable: true, single: true,
}

interface Harness {
  doc: ReturnType<typeof createDocument>
  pool: ReturnType<typeof buildNodePool>
  smartId: string
  textId: string
  defs: TemplateDefinitionStore
}

/** 段落 = 文本节点 "abc" + 一个 smarttext 控件 (供 nodeId 引用) */
function makeDoc(): Harness {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const text = createTextNode('abc')
  const st = createSmartTextNode('[患者姓名]', ELEMENT)
  const para = createParagraph([text.id, st.id])
  allNodes.set(text.id, text as unknown as BaseNode)
  allNodes.set(st.id, st as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, smartId: st.id, textId: text.id, defs: new TemplateDefinitionStore() }
}

function run(
  h: Harness,
  nodeId: string,
  next?: TemplateDefinition,
  store?: TemplateDefinitionStore,
): { patch: StatePatch | null; cmd: UpdateControlDefinitionCommand } {
  const ctx: CommandContext = {
    mode: 'local', doc: h.doc, pool: h.pool,
    ...(store ? { templateDefinitions: store } : {}),
  }
  const cmd = new UpdateControlDefinitionCommand('c1', Date.now(), 'u', nodeId, next)
  const patch = cmd.forward(ctx)
  return { patch, cmd }
}

function ctxOf(h: Harness, store?: TemplateDefinitionStore): CommandContext {
  return {
    mode: 'local', doc: h.doc, pool: h.pool,
    ...(store ? { templateDefinitions: store } : {}),
  }
}

describe('UpdateControlDefinitionCommand — 控件属性就地编辑 (契约 §12.5)', () => {
  it('set: forward(next 有字段) → store.set + 返回非空 patch', () => {
    const h = makeDoc()
    const { patch } = run(h, h.smartId, DEFINITION, h.defs)
    expect(patch).not.toBeNull()
    expect(patch!.invalidation).toBe('none')
    expect(h.defs.get(h.smartId)).toEqual(DEFINITION)
  })

  it('delete: forward(undefined) → store.delete', () => {
    const h = makeDoc()
    h.defs.set(h.smartId, DEFINITION)
    const { patch } = run(h, h.smartId, undefined, h.defs)
    expect(patch).not.toBeNull()
    expect(h.defs.has(h.smartId)).toBe(false)
  })

  it('delete: forward(空对象) → store.delete (无字段即清除)', () => {
    const h = makeDoc()
    h.defs.set(h.smartId, DEFINITION)
    const { patch } = run(h, h.smartId, {}, h.defs)
    expect(patch).not.toBeNull()
    expect(h.defs.has(h.smartId)).toBe(false)
  })

  it('undo: 整体替换的逆操作精确还原 old (快照语义)', () => {
    const h = makeDoc()
    h.defs.set(h.smartId, { label: '旧标签', deletable: false })

    const { cmd } = run(h, h.smartId, DEFINITION, h.defs)
    expect(h.defs.get(h.smartId)).toEqual(DEFINITION)

    const ctx = ctxOf(h, h.defs)
    const inverse = cmd.invert(ctx)
    expect(inverse).not.toBeNull()
    inverse!.forward(ctx)

    // 精确还原为 old (不是字段级合并)
    expect(h.defs.get(h.smartId)).toEqual({ label: '旧标签', deletable: false })
  })

  it('undo: old 为 undefined 时逆操作删除条目', () => {
    const h = makeDoc()
    const { cmd } = run(h, h.smartId, DEFINITION, h.defs)
    expect(h.defs.has(h.smartId)).toBe(true)

    const ctx = ctxOf(h, h.defs)
    const inverse = cmd.invert(ctx)
    inverse!.forward(ctx)
    expect(h.defs.has(h.smartId)).toBe(false)
  })

  it('守卫: nodeId 不存在 → forward 返回 null (不入 undo 栈)', () => {
    const h = makeDoc()
    const { patch } = run(h, 'no-such-node', DEFINITION, h.defs)
    expect(patch).toBeNull()
    expect(h.defs.size).toBe(0)
  })

  it('守卫: nodeId 非 smarttext (文本节点) → forward 返回 null', () => {
    const h = makeDoc()
    const { patch } = run(h, h.textId, DEFINITION, h.defs)
    expect(patch).toBeNull()
    expect(h.defs.size).toBe(0)
  })

  it('守卫: 未注入 store → forward 返回 null (no-op)', () => {
    const h = makeDoc()
    const { patch } = run(h, h.smartId, DEFINITION, undefined)
    expect(patch).toBeNull()
  })

  it('single 字段往返: 布尔字段正确写回 / 读回', () => {
    const h = makeDoc()
    run(h, h.smartId, { single: true }, h.defs)
    expect(h.defs.get(h.smartId)).toEqual({ single: true })

    // 覆盖为 false (布尔字段可显式置 false, 非「清除」)
    run(h, h.smartId, { single: false }, h.defs)
    expect(h.defs.get(h.smartId)).toEqual({ single: false })
  })
})
