// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlScorer — 控件量表评分 (契约 §12.6.2 layer E)
//
// 只读派生语义。覆盖: 空态不计分 / 单选与多选累加 / 无 numericValue 的
// 选项 / 自由文本值 / 无候选源 / Editor.computeControlScore 端到端
// (inline enums 与码表两条候选来源)。
//
// 边界断言: 评分**不产生命令** (无 undo 影响), 且与 QCResult.score 无关。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { scoreControls } from '../evaluation/ControlScorer'
import type { ScorableControl } from '../evaluation/ControlScorer'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createSmartTextNode } from '../document/factory/ElementFormatter'
import { DictionaryStore } from '../document/control/Dictionary'
import type {
  BaseNode, DocumentTree, ElementMeta, ElementEnumOption,
} from '../document/core/DocumentModel'

const PAIN: ElementEnumOption[] = [
  { name: '无痛', value: '0', numericValue: 0 },
  { name: '轻度', value: '1', numericValue: 2 },
  { name: '中度', value: '2', numericValue: 5 },
  { name: '重度', value: '3', numericValue: 8 },
]

function ctl(p: Partial<ScorableControl>): ScorableControl {
  return { nodeId: 'n', name: '控件', value: undefined, candidates: PAIN, ...p }
}

describe('scoreControls — 纯函数', () => {
  it('空态 (undefined) 不计分, 也不报错', () => {
    const r = scoreControls([ctl({ value: undefined })])
    expect(r.total).toBe(0)
    expect(r.items).toEqual([])
    expect(r.uncounted).toBe(0)
    expect(r.counted).toBe(0)
  })

  it('空串 / 空数组同样视为空态', () => {
    expect(scoreControls([ctl({ value: '' })]).counted).toBe(0)
    expect(scoreControls([ctl({ value: [] })]).counted).toBe(0)
  })

  it('单选命中 numericValue → 计入并产出明细', () => {
    const r = scoreControls([ctl({ nodeId: 'a', name: '疼痛', value: '2' })])
    expect(r.total).toBe(5)
    expect(r.counted).toBe(1)
    expect(r.items[0]).toMatchObject({ nodeId: 'a', name: '疼痛', selected: ['中度'], score: 5 })
  })

  it('多选按选中项累加', () => {
    const r = scoreControls([ctl({ value: ['1', '3'] })])
    expect(r.total).toBe(10)
    expect(r.items[0].selected).toEqual(['轻度', '重度'])
  })

  it('数值 0 的选项正常计分 (0 不等于"无分值")', () => {
    const r = scoreControls([ctl({ value: '0' })])
    expect(r.total).toBe(0)
    expect(r.counted).toBe(1)          // 计分了, 只是分值为 0
    expect(r.uncounted).toBe(0)
  })

  it('候选项没配 numericValue → 该控件计入 uncounted 而非静默算 0', () => {
    const noNum: ElementEnumOption[] = [{ name: '甲', value: 'a' }, { name: '乙', value: 'b' }]
    const r = scoreControls([ctl({ value: 'a', candidates: noNum })])
    expect(r.total).toBe(0)
    expect(r.counted).toBe(0)
    expect(r.uncounted).toBe(1)
  })

  it('自由文本值 (不在候选集) 不参与计分', () => {
    const r = scoreControls([ctl({ value: '随便写的' })])
    expect(r.total).toBe(0)
    expect(r.uncounted).toBe(1)
  })

  it('无候选源 (码表未加载 / 无 enums) → 跳过, 不计入 uncounted', () => {
    const r = scoreControls([ctl({ value: '1', candidates: undefined })])
    expect(r.total).toBe(0)
    expect(r.counted).toBe(0)
    expect(r.uncounted).toBe(0)
  })

  it('多个控件累加, 明细按传入顺序', () => {
    const r = scoreControls([
      ctl({ nodeId: 'a', name: 'A', value: '1' }),
      ctl({ nodeId: 'b', name: 'B', value: '3' }),
      ctl({ nodeId: 'c', name: 'C', value: undefined }),
    ])
    expect(r.total).toBe(10)
    expect(r.items.map(i => i.nodeId)).toEqual(['a', 'b'])
  })

  it('数字型运行时值 (N 控件) 按字符串匹配候选', () => {
    const r = scoreControls([ctl({ value: 2 })])
    expect(r.total).toBe(5)
  })
})

// ---- Editor 集成 ----

function makeControlEditor(
  element: ElementMeta,
  value?: string,
): { editor: Editor; nodeId: string } {
  const doc = createDocument('score')
  const st = createSmartTextNode('[控]', element)
  if (value !== undefined) st.value = value
  const para = createParagraph([st.id])
  doc.body.children = [para.id]

  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode
  nodes[st.id] = st as unknown as BaseNode
  nodes[para.id] = para as unknown as BaseNode
  ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)
  return { editor, nodeId: st.id }
}

function painElement(extra?: Partial<ElementMeta['format']>): ElementMeta {
  return {
    code: { internal: 'CTL_PAIN', dataElement: 'DE04.01.132.00' },
    name: '疼痛程度',
    format: { dataType: 'S1', enums: { data: PAIN }, ...extra },
  }
}

describe('Editor.computeControlScore (契约 §12.6.2 layer E)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('inline enums 带 numericValue → 汇总', () => {
    const { editor } = makeControlEditor(painElement(), '2')
    const r = editor.computeControlScore()
    expect(r.total).toBe(5)
    expect(r.items[0].name).toBe('疼痛程度')
  })

  it('只读派生: 不产生命令, 不影响 undo 栈', () => {
    const { editor } = makeControlEditor(painElement(), '2')
    expect(editor.canUndo()).toBe(false)
    editor.computeControlScore()
    expect(editor.canUndo()).toBe(false)
  })

  it('码表驱动的候选同样计分 (注入 provider 后候选可解析)', () => {
    const el: ElementMeta = {
      code: { internal: 'CTL_PAIN', dataElement: 'DE04.01.132.00' },
      name: '疼痛程度',
      format: { dataType: 'S1', dictionary: '9a000000a1b2c3d4e5f60718293a4b5c' },
    }
    const { editor } = makeControlEditor(el, '3')

    // 未注入 → 候选解析不出 → 不参与计分
    expect(editor.computeControlScore().total).toBe(0)

    const store = new DictionaryStore()
    store.set('9a000000a1b2c3d4e5f60718293a4b5c', PAIN)
    editor.setDictionaries(store)
    expect(editor.computeControlScore().total).toBe(8)
  })

  it('inline enums 恒优先于码表 (两者并存时按 enums 计分)', () => {
    const store = new DictionaryStore()
    // 码表里给同一个 value 一个不同分值 → 若被误用, total 会是 99
    store.set('9a000000a1b2c3d4e5f60718293a4b5c', [{ name: '中度', value: '2', numericValue: 99 }])
    const el = painElement({ dictionary: '9a000000a1b2c3d4e5f60718293a4b5c' })
    const { editor } = makeControlEditor(el, '2')
    editor.setDictionaries(store)

    expect(editor.computeControlScore().total).toBe(5)
  })
})
