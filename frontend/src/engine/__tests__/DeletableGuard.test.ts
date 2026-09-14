// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// DeletableGuard — 删除控件的 deletable 守卫 (契约 §12.1)
//
// 验证 RemoveControlCommand 删除 smarttext 控件节点时:
//   - deletable:false → 拒绝删除 (forward 返回 null, 节点不动)
//   - deletable:true  → 正常删除
//   - 无 store 条目  → 正常删除 (默认可删)
//   - 未注入 store   → 正常删除
//   - 删除后可撤销 (invert 还原节点)
// ================================================================

import { describe, it, expect } from 'vitest'
import { RemoveControlCommand } from '../command/commands/RemoveControlCommand'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { BaseNode, ElementMeta, Paragraph } from '../document/core/DocumentModel'
import type { CommandContext, StatePatch } from '../command/ICommand'

const ELEMENT: ElementMeta = {
  code: { internal: 'CTL_PATIENT_NAME', dataElement: 'DE02.01.039.00' },
  name: '患者姓名',
}

function makeDoc(deletable: boolean | undefined) {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const st = createSmartTextNode('[姓名]', ELEMENT)
  const para = createParagraph([st.id])
  allNodes.set(st.id, st as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })

  const defs = new TemplateDefinitionStore()
  if (deletable !== undefined) defs.set(st.id, { deletable })

  return { doc, pool, paraId: para.id, stId: st.id, defs }
}

function remove(
  doc: ReturnType<typeof createDocument>,
  pool: ReturnType<typeof buildNodePool>,
  paraId: string,
  nodeId: string,
  defs: TemplateDefinitionStore | undefined,
): { patch: StatePatch | null; cmd: RemoveControlCommand } {
  const ctx: CommandContext = { mode: 'local', doc, pool, templateDefinitions: defs }
  const cmd = new RemoveControlCommand('c1', Date.now(), 'u', [doc.id, paraId], nodeId)
  const patch = cmd.forward(ctx)
  return { patch, cmd }
}

function inPara(pool: ReturnType<typeof buildNodePool>, paraId: string, nodeId: string): boolean {
  return (pool.nodes.get(paraId) as Paragraph | undefined)?.children.includes(nodeId) ?? false
}

describe('删除控件的 deletable 守卫 (契约 §12.1)', () => {
  it('deletable:false → 拒绝删除 (forward 返回 null, 节点不动)', () => {
    const { doc, pool, paraId, stId, defs } = makeDoc(false)
    const { patch } = remove(doc, pool, paraId, stId, defs)
    expect(patch).toBeNull()
    expect(pool.nodes.has(stId)).toBe(true)
    expect(inPara(pool, paraId, stId)).toBe(true)
  })

  it('deletable:true → 正常删除', () => {
    const { doc, pool, paraId, stId, defs } = makeDoc(true)
    const { patch } = remove(doc, pool, paraId, stId, defs)
    expect(patch).not.toBeNull()
    expect(pool.nodes.has(stId)).toBe(false)
    expect(inPara(pool, paraId, stId)).toBe(false)
  })

  it('无 store 条目 → 正常删除 (默认可删)', () => {
    const { doc, pool, paraId, stId, defs } = makeDoc(undefined)
    const { patch } = remove(doc, pool, paraId, stId, defs)
    expect(patch).not.toBeNull()
    expect(pool.nodes.has(stId)).toBe(false)
  })

  it('未注入 store → 正常删除', () => {
    const { doc, pool, paraId, stId } = makeDoc(true)
    const { patch } = remove(doc, pool, paraId, stId, undefined)
    expect(patch).not.toBeNull()
    expect(pool.nodes.has(stId)).toBe(false)
  })

  it('删除后可撤销: invert 还原节点到原位置', () => {
    const { doc, pool, paraId, stId, defs } = makeDoc(true)
    const { cmd } = remove(doc, pool, paraId, stId, defs)
    expect(pool.nodes.has(stId)).toBe(false)

    const ctx: CommandContext = { mode: 'local', doc, pool, templateDefinitions: defs }
    const inverse = cmd.invert(ctx)
    expect(inverse).not.toBeNull()
    inverse!.forward(ctx)

    expect(pool.nodes.has(stId)).toBe(true)
    expect(inPara(pool, paraId, stId)).toBe(true)
    // 还原到原位置 (children 首元素)
    expect((pool.nodes.get(paraId) as Paragraph).children[0]).toBe(stId)
  })
})
