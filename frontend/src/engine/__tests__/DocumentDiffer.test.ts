// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DocumentDiffer 单元测试 (R66, v6.0)
// ============================================================

import { describe, it, expect } from 'vitest'
import { DocumentDiffer } from '../DocumentDiffer'
import { NodePool, buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
} from '../document/factory/ElementFormatter'
import type { DocumentTree, BaseNode } from '../document/core/DocumentModel'

function makeDoc(title: string, paragraphTexts: string[]): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument(title)
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const paraIds: string[] = []
  for (const text of paragraphTexts) {
    const para = createParagraph()
    const tn = createTextNode(text)
    para.children = [tn.id]
    paraIds.push(para.id)
    allNodes.set(para.id, para as unknown as BaseNode)
    allNodes.set(tn.id, tn as unknown as BaseNode)
  }

  doc.body.children = paraIds
  return { doc, pool: buildNodePool(allNodes, { body: doc.id }) }
}

describe('DocumentDiffer', () => {
  const differ = new DocumentDiffer()

  it('should detect equal documents', () => {
    const a = makeDoc('A', ['段落1', '段落2'])
    const b = makeDoc('A', ['段落1', '段落2'])
    const diffs = differ.compare(a.doc, a.pool, b.doc, b.pool)
    expect(diffs.every(d => d.op === 'equal')).toBe(true)
  })

  it('should detect inserted paragraph', () => {
    const a = makeDoc('A', ['段落1'])
    const b = makeDoc('B', ['段落1', '新段落'])
    const diffs = differ.compare(a.doc, a.pool, b.doc, b.pool)
    expect(diffs.some(d => d.op === 'insert')).toBe(true)
    expect(diffs.some(d => d.op === 'equal')).toBe(true)
  })

  it('should detect deleted paragraph', () => {
    const a = makeDoc('A', ['段落1', '将被删除'])
    const b = makeDoc('B', ['段落1'])
    const diffs = differ.compare(a.doc, a.pool, b.doc, b.pool)
    expect(diffs.some(d => d.op === 'delete')).toBe(true)
  })

  it('should detect modified paragraph (text change)', () => {
    const a = makeDoc('A', ['原始文本'])
    const b = makeDoc('B', ['修改文本'])
    const diffs = differ.compare(a.doc, a.pool, b.doc, b.pool)

    const mod = diffs.find(d => d.op === 'modify')
    expect(mod).toBeDefined()
    expect(mod!.textChanges).toBeDefined()
    expect(mod!.textChanges!.some(c => c.op === 'delete')).toBe(true)
    expect(mod!.textChanges!.some(c => c.op === 'insert')).toBe(true)
  })

  it('should handle LCS correctly with reordered paragraphs', () => {
    const a = makeDoc('A', ['一', '二', '三'])
    const b = makeDoc('B', ['一', '三', '二'])
    const diffs = differ.compare(a.doc, a.pool, b.doc, b.pool)
    // 至少有一个 equal (一)
    expect(diffs.filter(d => d.op === 'equal').length).toBeGreaterThanOrEqual(1)
  })
})
