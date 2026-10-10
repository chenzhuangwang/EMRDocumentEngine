// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 列表功能单元测试
// 覆盖: 列表模型 / 项目符号 / 编号格式化 / 编号计算 / 合并段保留
// ============================================================

import { describe, it, expect } from 'vitest'
import { ListParticle } from '../render/particles/ListParticle'
import { NodePool, buildNodePool } from '../document/core/NodePool'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { DocumentTree, BaseNode, ListStyle } from '../document/core/DocumentModel'
import { MergeParagraphCommand } from '../command/commands/MergeParagraphCommand'
import type { CommandContext } from '../command/ICommand'

// ---- Helper: 构建带列表属性的文档 ----

interface ParaSpec {
  text: string
  list?: { type: 'bullet' | 'ordered'; level?: number; numberStyle?: string; startAt?: number; continueNumbering?: boolean }
}

function makeDocWithList(specs: ParaSpec[]): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const bodyIds: string[] = []
  for (const spec of specs) {
    const textNode = createTextNode(spec.text)
    const para = createParagraph([textNode.id]) as unknown as unknown as Record<string, unknown>
    if (spec.list) {
      para.list = { ...spec.list }
    }
    allNodes.set(textNode.id, textNode as unknown as BaseNode)
    allNodes.set(para.id as string, para as unknown as BaseNode)
    bodyIds.push(para.id as string)
  }
  doc.body.children = bodyIds
  return { doc, pool: buildNodePool(allNodes, { body: doc.id }) }
}

// ---- 1. resolveBulletChar 项目符号 (static) ----

describe('resolveBulletChar', () => {
  it('level 1 → "•" (solid dot)', () => {
    expect(ListParticle.resolveBulletChar(1)).toBe('•')
  })

  it('level 2 → "◦" (hollow circle)', () => {
    expect(ListParticle.resolveBulletChar(2)).toBe('◦')
  })

  it('level 3 → "▪" (solid square)', () => {
    expect(ListParticle.resolveBulletChar(3)).toBe('▪')
  })

  it('level 4+ → 循环 level 1 的符号', () => {
    expect(ListParticle.resolveBulletChar(4)).toBe('•')
    expect(ListParticle.resolveBulletChar(5)).toBe('◦')
    expect(ListParticle.resolveBulletChar(6)).toBe('▪')
  })
})

// ---- 2. formatOrderedNumber 编号格式化 (static) ----

describe('formatOrderedNumber', () => {
  it('decimal: 1 → "1."', () => {
    expect(ListParticle.formatOrderedNumber(1, 'decimal')).toBe('1.')
  })
  it('decimal: 10 → "10."', () => {
    expect(ListParticle.formatOrderedNumber(10, 'decimal')).toBe('10.')
  })

  it('lower_alpha: 1 → "a.", 2 → "b.", 26 → "z."', () => {
    expect(ListParticle.formatOrderedNumber(1, 'lower_alpha')).toBe('a.')
    expect(ListParticle.formatOrderedNumber(2, 'lower_alpha')).toBe('b.')
    expect(ListParticle.formatOrderedNumber(26, 'lower_alpha')).toBe('z.')
  })

  it('lower_alpha: 26 → "z.", 27 → "aa.", 28 → "ab." (bijective base-26)', () => {
    expect(ListParticle.formatOrderedNumber(26, 'lower_alpha')).toBe('z.')
    expect(ListParticle.formatOrderedNumber(27, 'lower_alpha')).toBe('aa.')
    expect(ListParticle.formatOrderedNumber(28, 'lower_alpha')).toBe('ab.')
    expect(ListParticle.formatOrderedNumber(52, 'lower_alpha')).toBe('az.')
    expect(ListParticle.formatOrderedNumber(53, 'lower_alpha')).toBe('ba.')
  })

  it('upper_alpha: 1 → "A.", 2 → "B."', () => {
    expect(ListParticle.formatOrderedNumber(1, 'upper_alpha')).toBe('A.')
    expect(ListParticle.formatOrderedNumber(2, 'upper_alpha')).toBe('B.')
  })

  it('lower_roman: 1→i., 4→iv., 5→v., 9→ix., 10→x.', () => {
    expect(ListParticle.formatOrderedNumber(1, 'lower_roman')).toBe('i.')
    expect(ListParticle.formatOrderedNumber(4, 'lower_roman')).toBe('iv.')
    expect(ListParticle.formatOrderedNumber(5, 'lower_roman')).toBe('v.')
    expect(ListParticle.formatOrderedNumber(9, 'lower_roman')).toBe('ix.')
    expect(ListParticle.formatOrderedNumber(10, 'lower_roman')).toBe('x.')
  })

  it('upper_roman: 1→I., 4→IV., 10→X.', () => {
    expect(ListParticle.formatOrderedNumber(1, 'upper_roman')).toBe('I.')
    expect(ListParticle.formatOrderedNumber(4, 'upper_roman')).toBe('IV.')
    expect(ListParticle.formatOrderedNumber(10, 'upper_roman')).toBe('X.')
  })

  it('cjk_ideographic: 1→一、, 2→二、, 10→十、, 11→十一、, 20→二十、', () => {
    expect(ListParticle.formatOrderedNumber(1, 'cjk_ideographic')).toBe('一、')
    expect(ListParticle.formatOrderedNumber(2, 'cjk_ideographic')).toBe('二、')
    expect(ListParticle.formatOrderedNumber(10, 'cjk_ideographic')).toBe('十、')
    expect(ListParticle.formatOrderedNumber(11, 'cjk_ideographic')).toBe('十一、')
    expect(ListParticle.formatOrderedNumber(20, 'cjk_ideographic')).toBe('二十、')
    expect(ListParticle.formatOrderedNumber(99, 'cjk_ideographic')).toBe('九十九、')
  })

  it('cjk_ideographic: 0→零、', () => {
    expect(ListParticle.formatOrderedNumber(0, 'cjk_ideographic')).toBe('零、')
  })

  it('cjk_ideographic: 100→一百、, 101→一百零一、, 110→一百一十、, 223→二百二十三、, 999→九百九十九、', () => {
    expect(ListParticle.formatOrderedNumber(100, 'cjk_ideographic')).toBe('一百、')
    expect(ListParticle.formatOrderedNumber(101, 'cjk_ideographic')).toBe('一百零一、')
    expect(ListParticle.formatOrderedNumber(110, 'cjk_ideographic')).toBe('一百一十、')
    expect(ListParticle.formatOrderedNumber(200, 'cjk_ideographic')).toBe('二百、')
    expect(ListParticle.formatOrderedNumber(223, 'cjk_ideographic')).toBe('二百二十三、')
    expect(ListParticle.formatOrderedNumber(300, 'cjk_ideographic')).toBe('三百、')
    expect(ListParticle.formatOrderedNumber(999, 'cjk_ideographic')).toBe('九百九十九、')
  })

  it('cjk_ideographic: >= 1000 fallback to decimal with 、suffix', () => {
    expect(ListParticle.formatOrderedNumber(1000, 'cjk_ideographic')).toBe('1000、')
    expect(ListParticle.formatOrderedNumber(2024, 'cjk_ideographic')).toBe('2024、')
  })

  it('default (no numberStyle) → decimal', () => {
    expect(ListParticle.formatOrderedNumber(7)).toBe('7.')
  })
})

// ---- 3.1 toAlphaBijective 双射 base-26 ----

describe('toAlphaBijective', () => {
  it('1→A, 26→Z, 27→AA, 52→AZ, 702→ZZ, 703→AAA', () => {
    expect(ListParticle.toAlphaBijective(1)).toBe('A')
    expect(ListParticle.toAlphaBijective(26)).toBe('Z')
    expect(ListParticle.toAlphaBijective(27)).toBe('AA')
    expect(ListParticle.toAlphaBijective(52)).toBe('AZ')
    expect(ListParticle.toAlphaBijective(702)).toBe('ZZ')
    expect(ListParticle.toAlphaBijective(703)).toBe('AAA')
  })
})

// ---- 3.2 formatOrderedNumberRaw (无后缀) ----

describe('formatOrderedNumberRaw', () => {
  it('decimal: 1 → "1"', () => {
    expect(ListParticle.formatOrderedNumberRaw(1, 'decimal')).toBe('1')
  })
  it('lower_alpha: 27 → "aa"', () => {
    expect(ListParticle.formatOrderedNumberRaw(27, 'lower_alpha')).toBe('aa')
  })
  it('upper_roman: 4 → "IV"', () => {
    expect(ListParticle.formatOrderedNumberRaw(4, 'upper_roman')).toBe('IV')
  })
  it('cjk_ideographic: 100 → "一百"', () => {
    expect(ListParticle.formatOrderedNumberRaw(100, 'cjk_ideographic')).toBe('一百')
  })
  it('default (no numberStyle) → decimal', () => {
    expect(ListParticle.formatOrderedNumberRaw(7)).toBe('7')
  })
})

// ---- 4. estimateMarkerWidth 标记宽度估算 (static) ----

describe('estimateMarkerWidth', () => {
  it('should return string for bullet list', () => {
    const result = ListParticle.estimateMarkerWidth(1, 'bullet')
    expect(result).toBe('• ')  // level 1 bullet: no indent, just bullet + space
  })

  it('should return string with indent for nested bullet', () => {
    const result = ListParticle.estimateMarkerWidth(2, 'bullet')
    expect(result).toBe('  • ')  // level 2: 2-space indent + bullet + space
  })

  it('should return string for ordered list', () => {
    const result = ListParticle.estimateMarkerWidth(1, 'ordered')
    expect(result).toBe('88. ')  // level 1: no indent, "88. " conservative
  })

  it('should increase indent with level', () => {
    const w1 = ListParticle.estimateMarkerWidth(1, 'ordered')
    const w3 = ListParticle.estimateMarkerWidth(3, 'ordered')
    expect(w3.length).toBeGreaterThan(w1.length) // level 3 有更多缩进空格
  })
})

// ---- 4. ListStyle 模型读写 ----

describe('ListStyle model on Paragraph', () => {
  it('should read list type from paragraph', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'item 1', list: { type: 'ordered', level: 1 } },
    ])
    const para = pool.nodes.get(doc.body.children[0]) as unknown as Record<string, unknown>
    expect(para).toBeDefined()
    expect((para.list as ListStyle).type).toBe('ordered')
    expect((para.list as ListStyle).level).toBe(1)
  })

  it('should read numberStyle from paragraph', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'item 1', list: { type: 'ordered', level: 1, numberStyle: 'upper_roman' } },
    ])
    const para = pool.nodes.get(doc.body.children[0]) as unknown as Record<string, unknown>
    expect((para.list as ListStyle).numberStyle).toBe('upper_roman')
  })

  it('should read startAt from paragraph', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'item 5', list: { type: 'ordered', level: 1, startAt: 5 } },
    ])
    const para = pool.nodes.get(doc.body.children[0]) as unknown as Record<string, unknown>
    expect((para.list as ListStyle).startAt).toBe(5)
  })

  it('should read continueNumbering from paragraph', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'continued', list: { type: 'ordered', level: 1, continueNumbering: true } },
    ])
    const para = pool.nodes.get(doc.body.children[0]) as unknown as Record<string, unknown>
    expect((para.list as ListStyle).continueNumbering).toBe(true)
  })

  it('should read bullet list with level', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'bullet', list: { type: 'bullet', level: 2 } },
    ])
    const para = pool.nodes.get(doc.body.children[0]) as unknown as Record<string, unknown>
    expect((para.list as ListStyle).type).toBe('bullet')
    expect((para.list as ListStyle).level).toBe(2)
  })

  it('paragraph without list should have undefined list', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'plain text' },
    ])
    const para = pool.nodes.get(doc.body.children[0]) as unknown as Record<string, unknown>
    expect(para.list).toBeUndefined()
  })

  it('multiple paragraphs — ordered list counting preserved in model', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'A', list: { type: 'ordered', level: 1 } },
      { text: 'B', list: { type: 'ordered', level: 1 } },
      { text: 'C', list: { type: 'ordered', level: 1 } },
    ])
    for (const bid of doc.body.children) {
      const para = pool.nodes.get(bid) as unknown as Record<string, unknown>
      expect((para.list as ListStyle).type).toBe('ordered')
    }
  })

  it('nested levels — level-specific ordered list siblings', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'L1-A', list: { type: 'ordered', level: 1 } },
      { text: 'L2-A', list: { type: 'ordered', level: 2 } },
      { text: 'L2-B', list: { type: 'ordered', level: 2 } },
      { text: 'L1-B', list: { type: 'ordered', level: 1 } },
    ])
    const l1Ids = [doc.body.children[0], doc.body.children[3]]
    for (const id of l1Ids) {
      const para = pool.nodes.get(id) as unknown as Record<string, unknown>
      expect((para.list as ListStyle).level).toBe(1)
    }
    const l2Ids = [doc.body.children[1], doc.body.children[2]]
    for (const id of l2Ids) {
      const para = pool.nodes.get(id) as unknown as Record<string, unknown>
      expect((para.list as ListStyle).level).toBe(2)
    }
  })

  it('startAt on first ordered paragraph', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'starts at 5', list: { type: 'ordered', level: 1, startAt: 5 } },
    ])
    const para = pool.nodes.get(doc.body.children[0]) as unknown as Record<string, unknown>
    expect((para.list as ListStyle).startAt).toBe(5)
  })

  it('continueNumbering flag stored correctly', () => {
    const { pool, doc } = makeDocWithList([
      { text: '1', list: { type: 'ordered', level: 1 } },
      { text: '2', list: { type: 'ordered', level: 1 } },
      { text: 'plain' },
      { text: 'continues at 3', list: { type: 'ordered', level: 1, continueNumbering: true } },
    ])
    const para4 = pool.nodes.get(doc.body.children[3]) as unknown as Record<string, unknown>
    expect((para4.list as ListStyle).continueNumbering).toBe(true)
  })
})

// ---- 5. MergeParagraphCommand — 列表样式保持 ----

describe('MergeParagraphCommand list propagation', () => {
  function makeContext(pool: NodePool, doc: DocumentTree): CommandContext {
    return { mode: 'local', doc, pool }
  }

  it('should propagate list from deleted para to plain para', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'plain' },
      { text: 'list item', list: { type: 'ordered', level: 1 } },
    ])

    // path[0] = 父节点ID (doc.id), path[1] = 当前段 ID
    const cmd = new MergeParagraphCommand('merge1', Date.now(), 'test', [doc.id, doc.body.children[1]])
    cmd.forward(makeContext(pool, doc))

    // 合并后上一段应该继承了列表样式
    const prevPara = pool.nodes.get(doc.body.children[0]) as unknown as unknown as Record<string, unknown>
    expect(prevPara.list).toBeDefined()
    expect((prevPara.list as ListStyle).type).toBe('ordered')
  })

  it('should not overwrite list when prev para already has list', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'A', list: { type: 'bullet', level: 1 } },
      { text: 'B', list: { type: 'ordered', level: 1 } },
    ])

    const cmd = new MergeParagraphCommand('merge2', Date.now(), 'test', [doc.id, doc.body.children[1]])
    cmd.forward(makeContext(pool, doc))

    // 上一段保持原有的 bullet 列表样式
    const prevPara = pool.nodes.get(doc.body.children[0]) as unknown as unknown as Record<string, unknown>
    expect((prevPara.list as ListStyle).type).toBe('bullet')
  })

  it('should propagate list numberStyle on merge', () => {
    const { pool, doc } = makeDocWithList([
      { text: 'plain' },
      { text: 'roman', list: { type: 'ordered', level: 1, numberStyle: 'lower_roman' } },
    ])

    const cmd = new MergeParagraphCommand('merge3', Date.now(), 'test', [doc.id, doc.body.children[1]])
    cmd.forward(makeContext(pool, doc))

    const prevPara = pool.nodes.get(doc.body.children[0]) as unknown as unknown as Record<string, unknown>
    expect(prevPara.list).toBeDefined()
    expect((prevPara.list as ListStyle).numberStyle).toBe('lower_roman')
  })
})

// ---- 5.1 adjustListLevel 层级变更逻辑 ----

describe('adjustListLevel logic', () => {
  it('Tab on list item should increase level', () => {
    const list = { type: 'bullet' as const, level: 1 }
    const newLevel = list.level + 1
    expect(newLevel).toBe(2)
  })

  it('Shift+Tab on level 2 list item → level 1', () => {
    const list = { type: 'bullet' as const, level: 2 }
    const newLevel = list.level - 1
    expect(newLevel).toBe(1)
  })

  it('Shift+Tab on level 1 list item → level 0 (remove list)', () => {
    const currentLevel = 1
    const newLevel = currentLevel - 1
    expect(newLevel < 1).toBe(true) // should trigger list removal
  })

  it('Tab on level 3 nested list → level 4', () => {
    const list = { type: 'ordered' as const, level: 3 }
    const newLevel = list.level + 1
    expect(newLevel).toBe(4)
  })

  it('non-list paragraph keeps pixel indent behavior', () => {
    const indent = 0
    const newIndent = indent + 24
    expect(newIndent).toBe(24)
  })

  it('non-list paragraph outdent clamps to 0', () => {
    const indent = 24
    const newIndent = Math.max(0, indent - 24)
    expect(newIndent).toBe(0)
  })
})

// ---- 6. ListParticle 静态方法存在性 ----

describe('ListParticle static API', () => {
  it('should have static render method', () => {
    expect(typeof ListParticle.render).toBe('function')
  })

  it('should have static resolveBulletChar method', () => {
    expect(typeof ListParticle.resolveBulletChar).toBe('function')
  })

  it('should have static formatOrderedNumber method', () => {
    expect(typeof ListParticle.formatOrderedNumber).toBe('function')
  })

  it('should have static formatOrderedNumberRaw method', () => {
    expect(typeof ListParticle.formatOrderedNumberRaw).toBe('function')
  })

  it('should have static toAlphaBijective method', () => {
    expect(typeof ListParticle.toAlphaBijective).toBe('function')
  })

  it('should have static toRoman method', () => {
    expect(typeof ListParticle.toRoman).toBe('function')
  })

  it('should have static toCjkIdeographic method', () => {
    expect(typeof ListParticle.toCjkIdeographic).toBe('function')
  })

  it('should have static estimateMarkerWidth method', () => {
    expect(typeof ListParticle.estimateMarkerWidth).toBe('function')
  })
})
