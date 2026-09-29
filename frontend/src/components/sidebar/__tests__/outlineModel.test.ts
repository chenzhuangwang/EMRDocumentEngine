// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// outlineModel — 大纲投影 (纯函数, 契约 §31.14)
//
// 锁住两个**真实踩过的缺陷**:
//   1. 空节把 Section id 写进段落槽 → 光标解析不出来的非法路径
//   2. 节内首段不是标题时, 节行被 push 到列表末尾 (顺序错)
// 以及 P4 新增的嵌套缩进 (depth → level)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildOutlineItems } from '../outlineModel'
import { buildNodePool } from '@/engine/document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSection,
} from '@/engine/document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '@/engine/document/core/DocumentModel'

interface Built {
  doc: DocumentTree
  pool: ReturnType<typeof buildNodePool>
  ids: Record<string, string>
}

/** 每个段落可选带 outlineLevel (标题) */
function build(spec: Array<{ id: string; text: string; level?: number }>, sections: Array<{ id: string; children: string[]; code?: string }>, body: string[]): Built {
  const doc = createDocument('outline')
  const nodes = new Map<string, BaseNode>([[doc.id, doc as unknown as BaseNode]])
  const ids: Record<string, string> = {}
  for (const p of spec) {
    const tn = createTextNode(p.text)
    const para = createParagraph([tn.id], p.level ? { outlineLevel: p.level } : undefined)
    nodes.set(tn.id, tn as unknown as BaseNode)
    nodes.set(para.id, para as unknown as BaseNode)
    ids[p.id] = para.id
  }
  for (const s of sections) {
    const sec = createSection(s.children.map((c) => ids[c]), s.code)
    nodes.set(sec.id, sec as unknown as BaseNode)
    ids[s.id] = sec.id
  }
  doc.body.children = body.map((b) => ids[b])
  return { doc, pool: buildNodePool(nodes, { body: doc.id }), ids }
}

const OPTS = { anonymousSectionLabel: 'ANON' }

describe('buildOutlineItems — 空节不再造非法光标路径 (回归)', () => {
  it('空节的 paragraphPath 是**空数组**, 不是 [docId, sectionId]', () => {
    const b = build(
      [{ id: 'p1', text: 'head' }],
      [{ id: 'sec', children: [], code: 'chapter-001' }],
      ['p1', 'sec'],
    )
    const items = buildOutlineItems(b.doc, b.pool, undefined, OPTS)
    const secRow = items.find((i) => i.kind === 'section')!
    expect(secRow).toBeTruthy()
    expect(secRow.paragraphPath).toEqual([])
    // 关键: 节 id 绝不出现在 paragraphPath 里 (那是 CursorState 的段落槽)
    expect(secRow.paragraphPath).not.toContain(b.ids.sec)
    expect(secRow.sectionId).toBe(b.ids.sec)
    expect(secRow.pageIndex).toBe(-1) // 无内容 → 无页
  })

  it('有内容的节: paragraphPath 指向节内首个段落', () => {
    const b = build(
      [{ id: 'p1', text: 'head' }, { id: 'p2', text: 'inner' }],
      [{ id: 'sec', children: ['p2'], code: 'chapter-001' }],
      ['p1', 'sec'],
    )
    const secRow = buildOutlineItems(b.doc, b.pool, undefined, OPTS).find((i) => i.kind === 'section')!
    expect(secRow.paragraphPath).toEqual([b.doc.id, b.ids.p2])
  })
})

describe('buildOutlineItems — 顺序 = 真结构树前序 (回归)', () => {
  it('节内首段不是标题时, 节行仍在**文档位置**, 不在末尾', () => {
    const b = build(
      [
        { id: 'h1', text: 'H1', level: 1 },
        { id: 'plain', text: 'plain-in-section' },
        { id: 'tail', text: 'tail' },
      ],
      [{ id: 'sec', children: ['plain'], code: 'chapter-001' }],
      ['h1', 'sec', 'tail'],
    )
    const items = buildOutlineItems(b.doc, b.pool, undefined, OPTS)
    // 节行必须紧跟 h1 (它的文档位置), 而不是被扔到最后
    expect(items.map((i) => i.text)).toEqual(['H1', 'chapter-001'])
    expect(items[1].kind).toBe('section')
  })

  it('节行永远在它的内容之前', () => {
    const b = build(
      [{ id: 'inner', text: 'inner-heading', level: 1 }],
      [{ id: 'sec', children: ['inner'], code: 'chapter-001' }],
      ['sec'],
    )
    const items = buildOutlineItems(b.doc, b.pool, undefined, OPTS)
    expect(items[0].kind).toBe('section')
    expect(items[1].kind).toBeUndefined() // 标题行
  })

  it('无标题无节的文档 → 空大纲 (不崩)', () => {
    const b = build([{ id: 'p', text: 'body text' }], [], ['p'])
    expect(buildOutlineItems(b.doc, b.pool, undefined, OPTS)).toEqual([])
  })
})

describe('buildOutlineItems — 嵌套缩进 (depth → level)', () => {
  it('顶层节 level=1, 子节 level=2 (共用同一套缩进刻度)', () => {
    const b = build(
      [{ id: 'pi', text: 'deep' }],
      [
        { id: 'inner', children: ['pi'], code: 'chapter-002' },
        { id: 'outer', children: ['inner'], code: 'chapter-001' },
      ],
      ['outer'],
    )
    const items = buildOutlineItems(b.doc, b.pool, undefined, OPTS)
    expect(items.map((i) => [i.text, i.level])).toEqual([
      ['chapter-001', 1],
      ['chapter-002', 2],
    ])
  })

  it('匿名节用注入的兜底文案 (纯函数不挂 hook)', () => {
    const b = build([], [{ id: 'sec', children: [] }], ['sec'])
    const items = buildOutlineItems(b.doc, b.pool, undefined, OPTS)
    expect(items[0].text).toBe('ANON')
    expect(items[0].sectionCode).toBeUndefined()
  })

  it('页码来自注入的 pageMap (节行取其首段所在页)', () => {
    const b = build(
      [{ id: 'p', text: 'x' }],
      [{ id: 'sec', children: ['p'], code: 'c' }],
      ['sec'],
    )
    const pageMap = new Map([[b.ids.p, 3]])
    const items = buildOutlineItems(b.doc, b.pool, pageMap, OPTS)
    expect(items[0].pageIndex).toBe(3)
  })
})
