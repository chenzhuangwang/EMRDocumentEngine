// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SetControlValueCommand — 运行时控件值写入命令单测 (契约 §12.6, VR-3)
//
// 覆盖: 合法写入 (string/number/string[]) / 清空 / 写锁拒绝 /
//       readonly 拒绝 / 类型不符拒绝 / 枚举越界拒绝 / invert 恢复 /
//       非 smarttext 节点拒绝。
// ============================================================

import { describe, it, expect } from 'vitest'
import { SetControlValueCommand } from '../command/commands/SetControlValueCommand'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import { DictionaryStore } from '../document/control/Dictionary'
import type { DictionaryProvider } from '../document/control/Dictionary'
import type {
  BaseNode, ElementMeta, ElementFormat, SmartTextNode, ControlValue,
} from '../document/core/DocumentModel'
import type { CommandContext } from '../command/ICommand'

function element(format?: ElementFormat, extra?: Partial<ElementMeta>): ElementMeta {
  return { code: { internal: 'CTL_X', dataElement: 'DE00.00.000.00' }, name: 'x', format, ...extra }
}

function makeDoc(
  el: ElementMeta,
  editable: boolean | undefined,
  initialValue?: ControlValue,
) {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const st = createSmartTextNode('[字段]', el, undefined, initialValue)
  const para = createParagraph([st.id])
  allNodes.set(st.id, st as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  const defs = new TemplateDefinitionStore()
  if (editable !== undefined) defs.set(st.id, { editable })
  return { doc, pool, defs, stId: st.id }
}

function valueOf(pool: ReturnType<typeof buildNodePool>, id: string): ControlValue | undefined {
  return (pool.nodes.get(id) as SmartTextNode | undefined)?.value
}

function run(
  doc: ReturnType<typeof createDocument>,
  pool: ReturnType<typeof buildNodePool>,
  defs: TemplateDefinitionStore | undefined,
  nodeId: string,
  next: ControlValue | undefined,
  dictionaries?: DictionaryProvider,
) {
  const ctx: CommandContext = { mode: 'local', doc, pool, templateDefinitions: defs, dictionaries }
  const cmd = new SetControlValueCommand('c1', Date.now(), 'u', nodeId, next)
  const patch = cmd.forward(ctx)
  return { cmd, ctx, patch }
}

describe('SetControlValueCommand — 合法写入', () => {
  it('string 值写入 (S1)', () => {
    const { doc, pool, defs, stId } = makeDoc(element({ dataType: 'S1' }), undefined)
    expect(run(doc, pool, defs, stId, '张三').patch).not.toBeNull()
    expect(valueOf(pool, stId)).toBe('张三')
  })

  it('number 值写入 (N)', () => {
    const { doc, pool, defs, stId } = makeDoc(element({ dataType: 'N' }), undefined)
    run(doc, pool, defs, stId, 42)
    expect(valueOf(pool, stId)).toBe(42)
  })

  it('string[] 值写入 (多选枚举, 按声明顺序归一)', () => {
    const el = element({ dataType: 'S3', enums: { multiple: true, data: [
      { name: 'b', value: 'b' }, { name: 'a', value: 'a' }, { name: 'c', value: 'c' },
    ] } })
    const { doc, pool, defs, stId } = makeDoc(el, undefined)
    run(doc, pool, defs, stId, ['a', 'c', 'b'])
    expect(valueOf(pool, stId)).toEqual(['b', 'a', 'c'])
  })

  it('清空 (undefined) → value 归空', () => {
    const { doc, pool, defs, stId } = makeDoc(element({ dataType: 'S1' }), undefined, '张三')
    run(doc, pool, defs, stId, undefined)
    expect(valueOf(pool, stId)).toBeUndefined()
  })
})

describe('SetControlValueCommand — 写锁 / 拒绝 (VR-8)', () => {
  it('editable:false → 拒绝, 值不变', () => {
    const { doc, pool, defs, stId } = makeDoc(element({ dataType: 'S1' }), false, '张三')
    const { patch } = run(doc, pool, defs, stId, '李四')
    expect(patch).toBeNull()
    expect(valueOf(pool, stId)).toBe('张三')
  })

  it('ElementMeta.readonly → 拒绝 (含清空)', () => {
    const el = element({ dataType: 'S1' }, { readonly: true })
    const { doc, pool, defs, stId } = makeDoc(el, undefined, '张三')
    expect(run(doc, pool, defs, stId, '李四').patch).toBeNull()
    expect(run(doc, pool, defs, stId, undefined).patch).toBeNull()
    expect(valueOf(pool, stId)).toBe('张三')
  })

  it('类型不符 (N 传 string) → 拒绝, 值不变', () => {
    const { doc, pool, defs, stId } = makeDoc(element({ dataType: 'N' }), undefined)
    expect(run(doc, pool, defs, stId, '42' as unknown as ControlValue).patch).toBeNull()
    expect(valueOf(pool, stId)).toBeUndefined()
  })

  it('枚举越界 → 拒绝, 值不变', () => {
    const el = element({ dataType: 'S3', enums: { data: [{ name: 'a', value: 'a' }] } })
    const { doc, pool, defs, stId } = makeDoc(el, undefined)
    expect(run(doc, pool, defs, stId, 'z').patch).toBeNull()
    expect(valueOf(pool, stId)).toBeUndefined()
  })

  it('非 smarttext 节点 → 拒绝', () => {
    const { doc, pool, defs } = makeDoc(element({ dataType: 'S1' }), undefined)
    expect(run(doc, pool, defs, 'nonexistent', 'x').patch).toBeNull()
  })
})

describe('SetControlValueCommand — 外部字典 (VR-7)', () => {
  it('解析出候选 → 单选 string, 候选内接受', () => {
    const el = element({ dataType: 'S1', dictionary: 'dict-1' })
    const { doc, pool, defs, stId } = makeDoc(el, undefined)
    const dicts = new DictionaryStore()
    dicts.set('dict-1', [{ name: 'a', value: 'a' }, { name: 'b', value: 'b' }])
    const { patch } = run(doc, pool, defs, stId, 'a', dicts)
    expect(patch).not.toBeNull()
    expect(valueOf(pool, stId)).toBe('a')
  })

  it('解析出候选 → 越界拒绝 (VR-9)', () => {
    const el = element({ dataType: 'S1', dictionary: 'dict-1' })
    const { doc, pool, defs, stId } = makeDoc(el, undefined)
    const dicts = new DictionaryStore()
    dicts.set('dict-1', [{ name: 'a', value: 'a' }])
    const { patch } = run(doc, pool, defs, stId, 'z', dicts)
    expect(patch).toBeNull()
    expect(valueOf(pool, stId)).toBeUndefined()
  })

  it('provider 缺失 → 自由文本接受任意 string', () => {
    const el = element({ dataType: 'S1', dictionary: 'dict-1' })
    const { doc, pool, defs, stId } = makeDoc(el, undefined)
    expect(run(doc, pool, defs, stId, '任意自由文本').patch).not.toBeNull()
    expect(valueOf(pool, stId)).toBe('任意自由文本')
  })

  it('resolve 返回 undefined → 自由文本接受任意 string', () => {
    const el = element({ dataType: 'S1', dictionary: 'dict-1' })
    const { doc, pool, defs, stId } = makeDoc(el, undefined)
    const dicts = new DictionaryStore() // 空 store: resolve('dict-1') === undefined
    expect(run(doc, pool, defs, stId, '任意自由文本', dicts).patch).not.toBeNull()
    expect(valueOf(pool, stId)).toBe('任意自由文本')
  })

  it('inline enums 优先于 dictionary', () => {
    const el = element({ dataType: 'S1', dictionary: 'dict-1', enums: { data: [{ name: 'x', value: 'x' }] } })
    const { doc, pool, defs, stId } = makeDoc(el, undefined)
    const dicts = new DictionaryStore()
    dicts.set('dict-1', [{ name: 'a', value: 'a' }])
    // inline enums 只有 'x'; 候选内接受
    expect(run(doc, pool, defs, stId, 'x', dicts).patch).not.toBeNull()
    expect(valueOf(pool, stId)).toBe('x')
    // 字典候选 'a' 不在 inline enums → 拒绝
    expect(run(doc, pool, defs, stId, 'a', dicts).patch).toBeNull()
  })
})

describe('SetControlValueCommand — invert', () => {
  it('invert 恢复旧值', () => {
    const { doc, pool, defs, stId } = makeDoc(element({ dataType: 'S1' }), undefined, '张三')
    const { cmd, ctx } = run(doc, pool, defs, stId, '李四')
    expect(valueOf(pool, stId)).toBe('李四')

    const inv = cmd.invert(ctx)
    expect(inv).not.toBeNull()
    inv!.forward(ctx)
    expect(valueOf(pool, stId)).toBe('张三')
  })

  it('从空写入后 invert 恢复为空', () => {
    const { doc, pool, defs, stId } = makeDoc(element({ dataType: 'S1' }), undefined)
    const { cmd, ctx } = run(doc, pool, defs, stId, '张三')
    expect(valueOf(pool, stId)).toBe('张三')

    cmd.invert(ctx)!.forward(ctx)
    expect(valueOf(pool, stId)).toBeUndefined()
  })
})
