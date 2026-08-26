// ============================================================
// CursorScrollStability — 光标 / 选区滚动稳定性测试 (R-new)
//
// 修复方案 (cheerful-snacking-hamming):
//   1. computeCaretPos 遍历所有页面 (而非仅 visible.start..visible.end),
//      消除与 LayeredRenderer 画布 OVERSCAN_PAGES=1 的不一致。
//   2. 直接使用 coordSystem.transform.scrollY 计算 canvas-Y,
//      不再使用陈旧的 lastCaretPos 缓存。
//   3. 找不到时返回 null, 由调用方决定是否绘制。
//
// 本测试覆盖:
//   - 公式正确性: canvas-Y = accumulatedHeightTo(i) - scrollY
//   - 跨页/跨滚动位置一致性
//   - 实际 Draw.getCaretClientRect 行为: scrollY 变化时 top 严格反向变化
//   - 反向兼容: 单页/无 scrollY 时行为不变
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { accumulatedHeightTo, getTotalDocHeight } from '../layout/TableCoordUtil'
import { createDocument, createParagraph, createTextNode } from '../document/ElementFormatter'
import { buildNodePool } from '../document/NodePool'
import { EventBus } from '../interaction/EventBus'
import { Draw } from '../render/Draw'
import type { BaseNode, DocumentTree } from '../document/DocumentModel'
import type { NodePool } from '../document/NodePool'
import type { SLIFPage, SLIFItem } from '../layout/SLIF'
import type { EditorRuntimeState } from '../state/EditorRuntimeState'

// ============================================================
// 公式层测试 — 验证 canvas-Y = accumulatedHeightTo(i) - scrollY
// 这是 computeCaretPos / renderSelectionUnified / renderCellSelection
// 共同依赖的核心公式。修复前, 该公式只在 visible 范围被应用,
// 范围外回退到陈旧的 lastCaretPos.y, 引发偏移与跳位。
// ============================================================

describe('canvas-Y 公式 — 跨页 / 跨滚动位置一致性', () => {
  // 5 页等高文档 + 20px 间隙, 模拟典型多页病历
  const pages: { height: number }[] = Array.from({ length: 5 }, () => ({ height: 1123 }))
  const gap = 20
  const itemY = 100 // 假设某段落在页面内的 y=100 (item 起始坐标)

  /** 计算某页面某 item 的 canvas-Y (供所有测试统一调用) */
  function canvasY(pageIndex: number, scrollY: number): number {
    return accumulatedHeightTo(pageIndex, pages, gap) + itemY - scrollY
  }

  it('page 0, scrollY=0 → caretY = itemY', () => {
    expect(canvasY(0, 0)).toBe(100)
  })

  it('page 0, scrollY=500 → caretY = itemY - 500 (向上滚动后部分露出屏外)', () => {
    expect(canvasY(0, 500)).toBe(-400)
  })

  it('page 4 (out of visible), scrollY=1000 → caretY = (page4 docY) - 1000', () => {
    // 第 5 页 docY = 4 * (1123 + 20) = 4572
    // caretY = 4572 + 100 - 1000 = 3672
    expect(canvasY(4, 1000)).toBe(3672)
  })

  it('同一段落, scrollY 单调变化时 caretY 严格反向变化', () => {
    // 关键性质: 这是修复 lastCaretPos 缓存 bug 的核心证据。
    // 旧版本下, 当光标所在页超出 visible 范围, caretY 不会跟随 scrollY 变化 (被缓存)。
    // 新版本: caretY 严格 = docY - scrollY, 与 scrollY 1:1 反向。
    const pageIdx = 2
    const docY = accumulatedHeightTo(pageIdx, pages, gap) + itemY

    const y0 = canvasY(pageIdx, 0)
    const y300 = canvasY(pageIdx, 300)
    const y600 = canvasY(pageIdx, 600)

    expect(y0 - y300).toBe(300) // 滚动 300 → caretY 减 300
    expect(y300 - y600).toBe(300)
    expect(y0 - y600).toBe(600)
    // 反向性质: scrollY 翻倍时 caretY 减少值也翻倍
    expect(docY - y0).toBe(0)
    expect(docY - y600).toBe(600)
  })

  it('不同页面, scrollY=0 时 caretY 与页面 docY 严格一致', () => {
    // 验证: 修复前 lastCaretPos 在跨页时会保留旧值, 跨页时不会重置
    expect(canvasY(0, 0)).toBe(100)          // 0
    expect(canvasY(1, 0)).toBe(1243)         // 1143 + 100
    expect(canvasY(2, 0)).toBe(2386)         // 2286 + 100
    expect(canvasY(3, 0)).toBe(3529)         // 3429 + 100
    expect(canvasY(4, 0)).toBe(4672)         // 4572 + 100
  })

  it('gap=0 时退化为旧版等高页面公式', () => {
    // 兼容性测试: 旧版本 gap=0 场景下的 canvas-Y 公式
    const gap0 = 0
    const p0 = Array.from({ length: 3 }, () => ({ height: 1123 }))
    expect(accumulatedHeightTo(1, p0, gap0) + itemY).toBe(1223) // 1123 + 100
    expect(accumulatedHeightTo(2, p0, gap0) + itemY).toBe(2346) // 2246 + 100
  })
})

describe('选区跨页 — 公式逐页独立成立', () => {
  const pages: { height: number }[] = Array.from({ length: 4 }, () => ({ height: 1123 }))
  const gap = 20

  it('选区起点在 page 1, 终点在 page 3 — 两页的 spY 各自正确', () => {
    const scrollY = 500
    const spY1 = accumulatedHeightTo(1, pages, gap) - scrollY
    const spY3 = accumulatedHeightTo(3, pages, gap) - scrollY

    expect(spY1).toBe(643) // (1123 + 20) - 500 = 643
    expect(spY3).toBe(2929) // (1123*3 + 20*3) - 500 = 2929
    // 关键: 旧版本下, 当 page 3 不在 visible.start..visible.end 时,
    // 根本不会进入循环, 选区末段被静默丢弃。新版本始终遍历所有页面。
    expect(spY3 - spY1).toBe(2286) // 跨页 spY 差等于页间累加 (含间隙)
  })

  it('选区在 page 0, scrollY=0 → spY = 0 (页面顶部对齐画布顶部)', () => {
    const scrollY = 0
    const spY = accumulatedHeightTo(0, pages, gap) - scrollY
    expect(spY).toBe(0)
  })
})

describe('getTotalDocHeight — 与 canvas-Y 计算保持一致', () => {
  // 验证: 文档总高度含间隙, 与各页 docY 计算使用同一套累加规则
  it('5 页 + gap=20 → 文档总高 5695 = 5*1123 + 4*20 (末页后不再追加 gap)', () => {
    const pages = Array.from({ length: 5 }, () => ({ height: 1123 }))
    expect(getTotalDocHeight(pages, 20)).toBe(5695)
    // accumulatedHeightTo(N) 含末页前 N 个 gap, 用于计算"末页底部 docY"
    expect(accumulatedHeightTo(5, pages, 20)).toBe(5715) // 5*1123 + 5*20
    // 而 getTotalDocHeight = 末页底部 docY - gap (去掉末页后的间隙)
    expect(getTotalDocHeight(pages, 20)).toBe(accumulatedHeightTo(5, pages, 20) - 20)
  })
})

// ============================================================
// 集成层测试 — Draw.getCaretClientRect
//
// 验证实际 Draw 行为: 改变 scrollY 后, getCaretClientRect 返回的 top
// 严格反向变化 (|Δtop| = |ΔscrollY| × scale)。这是 lastCaretPos 缓存
// bug 不可能满足的不变式。
// ============================================================

describe('Draw.getCaretClientRect — scrollY 变化时位置严格跟随', () => {
  let container: HTMLElement
  let draw: Draw
  let doc: DocumentTree
  let pool: NodePool
  let p1: ReturnType<typeof createParagraph>
  let t1: ReturnType<typeof createTextNode>
  let p2: ReturnType<typeof createParagraph>
  let t2: ReturnType<typeof createTextNode>

  beforeEach(() => {
    // 构造容器 — jsdom 下 container.clientWidth/Height 默认为 0,
    // 设置 style.width 让 offsetX 计算得到非零结果
    container = document.createElement('div')
    container.style.width = '800px'
    container.style.height = '600px'
    document.body.appendChild(container)

    // 构造文档 + 节点池 — p1 在 page 0, p2 在 page 1
    doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)

    t1 = createTextNode('AAAAA')
    p1 = createParagraph([t1.id])
    t2 = createTextNode('BBBBB')
    p2 = createParagraph([t2.id])
    allNodes.set(t1.id, t1 as unknown as BaseNode)
    allNodes.set(p1.id, p1 as unknown as BaseNode)
    allNodes.set(t2.id, t2 as unknown as BaseNode)
    allNodes.set(p2.id, p2 as unknown as BaseNode)

    doc.body.children = [p1.id, p2.id]
    pool = buildNodePool(allNodes, { body: doc.id })

    // 构造 Draw 实例
    const eventBus = new EventBus()
    draw = new Draw(container, eventBus, doc)
    draw.setDocument(doc, pool)

    // 手动注入 2 页 SLIF (避免触发 LayoutEngine 全量布局)
    const pages: SLIFPage[] = [
      {
        pageIndex: 0,
        width: 794, height: 1123,
        items: [makeTextItem(t1.id, p1.id, 100, 100)],
        headerItems: [], footerItems: [],
      },
      {
        pageIndex: 1,
        width: 794, height: 1123,
        items: [makeTextItem(t2.id, p2.id, 100, 100)],
        headerItems: [], footerItems: [],
      },
    ]
    ;(draw as unknown as { pages: SLIFPage[] }).pages = pages
  })

  /** 构造 SLIF text item (行测试足够) */
  function makeTextItem(nodeId: string, _paraId: string, x: number, y: number): SLIFItem {
    return {
      nodeId,
      nodeType: 'text',
      type: 'text',
      text: 'AAAAA',
      x, y,
      width: 50, height: 20,
      ascent: 16, descent: 4,
      font: 'SimSun', size: 16,
    }
  }

  function makeState(paraId: string, offset: number): EditorRuntimeState {
    return {
      cursor: {
        paragraphPath: [doc.id, paraId],
        offset,
        visible: true,
      },
      selection: {
        anchor: { paragraphPath: [doc.id, paraId], offset: 0, visible: true },
        focus: { paragraphPath: [doc.id, paraId], offset: 0, visible: true },
        active: false,
        granularity: 'character',
      },
    } as unknown as EditorRuntimeState
  }

  it('scrollY=0 时, page 0 光标 top 与 item.y 一致', () => {
    draw.getCoordinateSystem().update({ scrollY: 0 })
    const rect = draw.getCaretClientRect(pool, makeState(p1.id, 3))
    expect(rect).not.toBeNull()
    // top = canvasRect.top + caret.y * scale, scale=1 默认
    // caret.y = pageY + yOffset + item.y = (0 - 0) + 0 + 100 = 100
    expect(rect!.top).toBe(100)
  })

  it('scrollY=200 时, 同一光标 top 减少 200 (scale=1)', () => {
    draw.getCoordinateSystem().update({ scrollY: 0 })
    const baseline = draw.getCaretClientRect(pool, makeState(p1.id, 3))!

    draw.getCoordinateSystem().update({ scrollY: 200 })
    const scrolled = draw.getCaretClientRect(pool, makeState(p1.id, 3))!

    // 关键不变式: |Δtop| = |ΔscrollY| × scale
    // 修复前: lastCaretPos 缓存 canvas-Y, 不会随 scrollY 变化, 此断言会失败
    expect(baseline.top - scrolled.top).toBe(200)
  })

  it('scrollY=300, cursor 移到 page 1 → top = page1.docY + itemY - 300', () => {
    // page 1 在文档中的 docY = (1123 + 20) = 1143 (默认 pageVerticalGap=20)
    // caret.y = 1143 + 0 + 100 - 300 = 943
    draw.getCoordinateSystem().update({ scrollY: 300 })
    const rect = draw.getCaretClientRect(pool, makeState(p2.id, 3))
    expect(rect).not.toBeNull()
    expect(rect!.top).toBe(943)
  })

  it('scrollY 从 0 → 400 → 800 时, 同一光标 top 单调递减 400 / 400', () => {
    draw.getCoordinateSystem().update({ scrollY: 0 })
    const r0 = draw.getCaretClientRect(pool, makeState(p1.id, 3))!

    draw.getCoordinateSystem().update({ scrollY: 400 })
    const r400 = draw.getCaretClientRect(pool, makeState(p1.id, 3))!

    draw.getCoordinateSystem().update({ scrollY: 800 })
    const r800 = draw.getCaretClientRect(pool, makeState(p1.id, 3))!

    expect(r0.top - r400.top).toBe(400)
    expect(r400.top - r800.top).toBe(400)
    expect(r0.top).toBeGreaterThan(r400.top)
    expect(r400.top).toBeGreaterThan(r800.top)
  })

  it('cursor 指向不存在的段落 → 返回 null (不绘制陈旧位置)', () => {
    // 修复前: lastCaretPos 会保留上次成功的位置, 此处会返回错误坐标
    // 修复后: 找不到时返回 null, 调用方跳过绘制
    draw.getCoordinateSystem().update({ scrollY: 0 })
    const fakeId = 'non-existent-para-id'
    const rect = draw.getCaretClientRect(pool, makeState(fakeId, 0))
    expect(rect).toBeNull()
  })

  it('pageVerticalGap=0 (旧版行为) — canvas-Y 公式仍正确', () => {
    // 向后兼容: 当 gap=0 时, 公式退化为 pageIndex * pageHeight
    draw.setPageVerticalGap(0)
    draw.getCoordinateSystem().update({ scrollY: 100 })
    // page 1 docY = 1123, caret.y = 1123 + 100 - 100 = 1123
    const rect = draw.getCaretClientRect(pool, makeState(p2.id, 3))
    expect(rect).not.toBeNull()
    expect(rect!.top).toBe(1123)
  })
})