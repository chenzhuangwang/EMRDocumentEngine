// ================================================================
// SelectionCollector — 选区投影纯函数 (契约 §11.2, Drift 3 反转)
//
// 验证 document/selection/SelectionCollector 的纯函数行为:
//   A. paragraphTextLength — 文本节点计 text.length, 非文本计 1。
//   B. collectTextNodeIds — [start,end) 重叠收集, 跳过非文本节点,
//      end=INF 到末尾。
//   C. findFirstTextNodeInRange — 首个重叠文本节点, 无则 null。
//   D. collectSelectionSegments — 同段/跨段/反向归一化/空选区/中间段。
// ================================================================

import { describe, it, expect } from 'vitest'
import {
  paragraphTextLength, collectTextNodeIds, findFirstTextNodeInRange,
  collectSelectionSegments,
} from '../document/selection/SelectionCollector'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, ElementMeta } from '../document/core/DocumentModel'
import type { FormatRange } from '../document/selection/SelectionCollector'

const ELEMENT: ElementMeta = {
  code: { internal: 'CTL_X', dataElement: 'DE00.00.000.00' },
  name: 'X',
}

/**
 * 构造一个文档:
 *   body = [para1, para2, para3]
 *   para1.children = [text "ab", smarttext, text "cd"]  (文本总长 2+1+2=5)
 *   para2.children = [text "ef"]                        (文本总长 2)
 *   para3.children = [text "ghi"]                       (文本总长 3)
 */
function makeHarness() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const mkPara = (texts: string[], withSmart = false): string => {
    const kids: string[] = []
    for (const t of texts) {
      const n = createTextNode(t)
      kids.push(n.id)
      allNodes.set(n.id, n as unknown as BaseNode)
    }
    if (withSmart) {
      const st = createSmartTextNode('[X]', ELEMENT)
      kids.splice(1, 0, st.id) // 插到第二个位置, 制造非文本节点
      allNodes.set(st.id, st as unknown as BaseNode)
    }
    const para = createParagraph(kids)
    allNodes.set(para.id, para as unknown as BaseNode)
    return para.id
  }

  const para1 = mkPara(['ab', 'cd'], true) // text(2) + smarttext(1) + text(2) = 5
  const para2 = mkPara(['ef'])             // 2
  const para3 = mkPara(['ghi'])            // 3
  doc.body.children = [para1, para2, para3]
  const pool = buildNodePool(allNodes, { body: doc.id })

  return { doc, pool, para1, para2, para3 }
}

describe('SelectionCollector — 选区投影 (契约 §11.2)', () => {
  it('paragraphTextLength: 文本节点计长度, 非文本计 1', () => {
    const { pool, para1, para2, para3 } = makeHarness()
    expect(paragraphTextLength(pool, para1)).toBe(5) // "ab" + smarttext(1) + "cd"
    expect(paragraphTextLength(pool, para2)).toBe(2)
    expect(paragraphTextLength(pool, para3)).toBe(3)
  })

  it('collectTextNodeIds: [start,end) 重叠收集, 跳过非文本', () => {
    const { pool, para1 } = makeHarness()
    // 全区间 → 两个 text node (smarttext 非 text 被跳过)
    expect(collectTextNodeIds(pool, para1, 0, 5).length).toBe(2)
    // 落在 smarttext 上 (offset 2..3) → 无 text node
    expect(collectTextNodeIds(pool, para1, 2, 3)).toEqual([])
    // 跨越 smarttext 的区间 → 两侧 text node 都命中
    expect(collectTextNodeIds(pool, para1, 1, 4).length).toBe(2)
  })

  it('collectTextNodeIds: end=INF 表示到段落末尾', () => {
    const { pool, para1 } = makeHarness()
    const ids = collectTextNodeIds(pool, para1, 3, Number.MAX_SAFE_INTEGER)
    expect(ids.length).toBe(1) // 仅末尾 "cd"
  })

  it('findFirstTextNodeInRange: 首个重叠文本节点, 无则 null', () => {
    const { pool, para1 } = makeHarness()
    const r: FormatRange = { path: ['doc', para1], start: 0, end: 5 }
    const node = findFirstTextNodeInRange(pool, r)
    expect(node?.text).toBe('ab')

    const onSmart: FormatRange = { path: ['doc', para1], start: 2, end: 3 }
    expect(findFirstTextNodeInRange(pool, onSmart)).toBeNull()
  })

  it('collectSelectionSegments: 同段选区 (正向/反向归一化)', () => {
    const { doc, para1 } = makeHarness()
    const seg1 = collectSelectionSegments(doc.body.children, para1, 1, para1, 3)
    expect(seg1).toEqual([{ paraId: para1, start: 1, end: 3 }])

    const seg2 = collectSelectionSegments(doc.body.children, para1, 3, para1, 1)
    expect(seg2).toEqual([{ paraId: para1, start: 1, end: 3 }])
  })

  it('collectSelectionSegments: 空选区 (起止重合) 返回空', () => {
    const { doc, para1 } = makeHarness()
    expect(collectSelectionSegments(doc.body.children, para1, 2, para1, 2)).toEqual([])
  })

  it('collectSelectionSegments: 跨段选区 (首段 INF + 中间段 INF + 末段截止)', () => {
    const { doc, para1, para2, para3 } = makeHarness()
    const segs = collectSelectionSegments(doc.body.children, para1, 1, para3, 2)
    expect(segs).toEqual([
      { paraId: para1, start: 1, end: Number.MAX_SAFE_INTEGER },
      { paraId: para2, start: 0, end: Number.MAX_SAFE_INTEGER },
      { paraId: para3, start: 0, end: 2 },
    ])
  })

  it('collectSelectionSegments: 反向跨段也归一化为首段→末段', () => {
    const { doc, para1, para2, para3 } = makeHarness()
    const segs = collectSelectionSegments(doc.body.children, para3, 2, para1, 1)
    expect(segs.map((s) => s.paraId)).toEqual([para1, para2, para3])
    expect(segs[0].start).toBe(1)
    expect(segs[2].end).toBe(2)
  })
})
