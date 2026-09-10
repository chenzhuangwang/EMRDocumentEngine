// ================================================================
// FirstLineIndent — 段落首行缩进布局
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode, Paragraph } from '../document/core/DocumentModel'

function makeDoc(firstLineIndent?: number) {
  const doc = createDocument('fli')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const tn = createTextNode('你好')
  const para = createParagraph([tn.id]) as Paragraph
  if (firstLineIndent) para.firstLineIndent = firstLineIndent
  all.set(tn.id, tn as unknown as BaseNode)
  all.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  return { doc, pool: buildNodePool(all, { body: doc.id }) }
}

describe('首行缩进布局', () => {
  it('firstLineIndent=32 → 首行文本 x = marginLeft + 32', () => {
    const { doc, pool } = makeDoc(32)
    const pages = new LayoutEngine(new EventBus(), testMeasurer).fullLayout(doc, pool)
    const first = pages[0].items.find(it => it.type === 'text')!
    expect(first.x).toBeCloseTo(90 + 32)
  })
  it('无 firstLineIndent → 首行文本 x = marginLeft', () => {
    const { doc, pool } = makeDoc()
    const pages = new LayoutEngine(new EventBus(), testMeasurer).fullLayout(doc, pool)
    const first = pages[0].items.find(it => it.type === 'text')!
    expect(first.x).toBeCloseTo(90)
  })
})
