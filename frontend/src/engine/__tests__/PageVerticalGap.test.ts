// ============================================================
// PageVerticalGap 测试 — 分页渲染间隙坐标计算 (R-new)
//
// 覆盖:
//   - findPageByDocY 间隙区域 localY 钳制
//   - accumulatedHeightTo 间隙累加
//   - getTotalDocHeight 末页后不再追加间隙
//   - 屏幕/逻辑坐标转换 + 分页间隙的 round-trip
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  findPageByDocY,
  accumulatedHeightTo,
  getTotalDocHeight,
  screenToPage,
} from '../layout/table/TableCoordUtil'

describe('findPageByDocY — gap handling', () => {
  // 3 个等高页面 (1123px) + 20px 间隙
  const pages = [{ height: 1123 }, { height: 1123 }, { height: 1123 }]
  const gap = 20

  it('应正确返回页面内坐标 (无间隙)', () => {
    expect(findPageByDocY(0, pages)).toEqual({ pageIndex: 0, localY: 0 })
    expect(findPageByDocY(500, pages)).toEqual({ pageIndex: 0, localY: 500 })
    expect(findPageByDocY(1122, pages)).toEqual({ pageIndex: 0, localY: 1122 })
  })

  it('应正确翻页 (无间隙)', () => {
    expect(findPageByDocY(1123, pages)).toEqual({ pageIndex: 1, localY: 0 })
    expect(findPageByDocY(1124, pages)).toEqual({ pageIndex: 1, localY: 1 })
    expect(findPageByDocY(2246, pages)).toEqual({ pageIndex: 2, localY: 0 })
  })

  it('应支持含间隙的 docY 翻页', () => {
    // 文档布局: page0 [0,1123] | gap [1123,1143] | page1 [1143,2266] | gap [2266,2286] | page2 [2286,3409]
    // 注: docY==pageHeight 时 (== gap 起点) 沿袭旧版 "翻到下一页" 行为 — 与 gap=0 时 docY=pageHeight 行为一致
    expect(findPageByDocY(1123, pages, gap)).toEqual({ pageIndex: 1, localY: 0 })
    // docY=1140 落在 gap 内 — 之前返回负 localY, 现在应钳制到 page1 localY=0
    expect(findPageByDocY(1140, pages, gap)).toEqual({ pageIndex: 1, localY: 0 })
    expect(findPageByDocY(1143, pages, gap)).toEqual({ pageIndex: 1, localY: 0 })
    expect(findPageByDocY(1144, pages, gap)).toEqual({ pageIndex: 1, localY: 1 })
  })

  it('应在 gap 区域钳制 localY 到下一页顶部 0 (避免负值命中错页)', () => {
    // 文档布局: page0 [0,1123] | gap [1123,1143] | page1 [1143,2266]
    // 取 gap 中间 docY=1133 — 之前返回 {pageIndex:1, localY:-10}, 命中错页
    const result = findPageByDocY(1133, pages, gap)
    expect(result.pageIndex).toBe(1)
    expect(result.localY).toBe(0) // 钳制到 0
    expect(result.localY).toBeGreaterThanOrEqual(0)
  })

  it('应在文档尾部 docY 钳制到最后一页 + localY <= pageHeight', () => {
    // 3 页总高 = 1123*3 + 20*2 = 3409
    // docY=5000 远超总高 — 应返回最后一页 + 钳制 localY
    const result = findPageByDocY(5000, pages, gap)
    expect(result.pageIndex).toBe(2)
    expect(result.localY).toBeLessThanOrEqual(pages[2].height)
    expect(result.localY).toBeGreaterThanOrEqual(0)
  })

  it('应处理负 docY — 钳制到第 0 页 localY=0', () => {
    expect(findPageByDocY(-100, pages, gap)).toEqual({ pageIndex: 0, localY: 0 })
    expect(findPageByDocY(-100, pages, 0)).toEqual({ pageIndex: 0, localY: 0 })
  })

  it('空 pages 数组应安全返回 pageIndex=0 + localY=0', () => {
    expect(findPageByDocY(100, [], gap)).toEqual({ pageIndex: 0, localY: 0 })
    expect(findPageByDocY(100, [], 0)).toEqual({ pageIndex: 0, localY: 0 })
  })

  it('应支持变高页面 + 间隙', () => {
    const variedPages = [{ height: 800 }, { height: 1123 }, { height: 600 }]
    // 文档布局: page0 [0,800] | gap [800,820] | page1 [820,1943] | gap [1943,1963] | page2 [1963,2563]
    expect(findPageByDocY(500, variedPages, gap)).toEqual({ pageIndex: 0, localY: 500 })
    // 沿袭旧版边界行为: docY==pageHeight → 下一页
    expect(findPageByDocY(800, variedPages, gap)).toEqual({ pageIndex: 1, localY: 0 })
    expect(findPageByDocY(810, variedPages, gap)).toEqual({ pageIndex: 1, localY: 0 })
    expect(findPageByDocY(820, variedPages, gap)).toEqual({ pageIndex: 1, localY: 0 })
    expect(findPageByDocY(900, variedPages, gap)).toEqual({ pageIndex: 1, localY: 80 })
  })
})

describe('accumulatedHeightTo — gap accumulation', () => {
  const pages = [{ height: 1123 }, { height: 1123 }, { height: 1123 }]
  const gap = 20

  it('应返回 0 for pageIndex=0', () => {
    expect(accumulatedHeightTo(0, pages, gap)).toBe(0)
    expect(accumulatedHeightTo(0, pages, 0)).toBe(0)
  })

  it('无间隙 — 退化为 sum(prev pageHeight)', () => {
    expect(accumulatedHeightTo(1, pages, 0)).toBe(1123)
    expect(accumulatedHeightTo(2, pages, 0)).toBe(2246)
    expect(accumulatedHeightTo(3, pages, 0)).toBe(3369)
  })

  it('含间隙 — 累加 pageHeight + gap', () => {
    expect(accumulatedHeightTo(1, pages, gap)).toBe(1143) // 1123 + 20
    expect(accumulatedHeightTo(2, pages, gap)).toBe(2286) // 1123 + 20 + 1123 + 20
    expect(accumulatedHeightTo(3, pages, gap)).toBe(3429) // 2*pageHeight + 3*gap (含末页前间隙)
  })

  it('应忽略超出 pages.length 的 pageIndex', () => {
    expect(accumulatedHeightTo(10, pages, gap)).toBe(3429) // = 3 pageHeight + 3 gap (上限为 pages.length)
  })

  it('应支持变高页面', () => {
    const varied = [{ height: 800 }, { height: 1123 }]
    expect(accumulatedHeightTo(1, varied, gap)).toBe(820) // 800 + 20
    expect(accumulatedHeightTo(2, varied, gap)).toBe(1963) // 800 + 20 + 1123 + 20
  })

  it('应正确处理负 pageIndex — 返回 0', () => {
    expect(accumulatedHeightTo(-1, pages, gap)).toBe(0)
    expect(accumulatedHeightTo(-10, pages, gap)).toBe(0)
  })
})

describe('getTotalDocHeight — gap totals', () => {
  const pages = [{ height: 1123 }, { height: 1123 }, { height: 1123 }]
  const gap = 20

  it('空数组应返回 0', () => {
    expect(getTotalDocHeight([], gap)).toBe(0)
    expect(getTotalDocHeight([], 0)).toBe(0)
  })

  it('gap=0 — 退化为 sum(pageHeight)', () => {
    expect(getTotalDocHeight(pages, 0)).toBe(3369)
  })

  it('含间隙 — sum + (N-1) * gap (末页后不再追加)', () => {
    expect(getTotalDocHeight(pages, gap)).toBe(3409) // 3369 + 2*20
    expect(getTotalDocHeight([{ height: 1000 }], gap)).toBe(1000) // 单页无间隙
    expect(getTotalDocHeight([{ height: 1000 }, { height: 1000 }], gap)).toBe(2020) // 2000 + 1*20
  })
})

describe('screenToPage — gap-aware', () => {
  // 2 个等高页面 + 30px 间隙
  const pages = [{ width: 794, height: 1123 }, { width: 794, height: 1123 }]
  const gap = 30
  const containerRect = { left: 0, top: 0 }
  const viewportW = 800

  it('scrollY=0 时, page 0 顶部映射正确', () => {
    const result = screenToPage(400, 0, 1, 0, containerRect, pages, viewportW, gap)
    expect(result).not.toBeNull()
    expect(result!.pageIndex).toBe(0)
    expect(result!.y).toBe(0) // PageDocCoords 用 y 表示页面内 y
  })

  it('scrollY=0 时, gap 区域映射到下一页 localY=0', () => {
    // 文档布局: page0 [0,1123] | gap [1123,1153] | page1 [1153,2276]
    // 鼠标点击屏幕 y=1130 → 文档逻辑 y = 1130 + 0 = 1130 (在 gap 内)
    const result = screenToPage(400, 1130, 1, 0, containerRect, pages, viewportW, gap)
    expect(result).not.toBeNull()
    expect(result!.pageIndex).toBe(1)
    expect(result!.y).toBe(0) // 钳制到 page1 顶部
  })

  it('含 scrollY 时, gap 钳制仍正确', () => {
    // 滚动到 1200 后, 用户点击屏幕 y=0
    // 文档逻辑 y = 0 + 1200 = 1200 (在 page1 区域)
    const result = screenToPage(400, 0, 1, 1200, containerRect, pages, viewportW, gap)
    expect(result).not.toBeNull()
    expect(result!.pageIndex).toBe(1)
    expect(result!.y).toBe(1200 - 1153) // 47
  })

  it('向后兼容 — gap 参数缺省时按 gap=0 处理', () => {
    // 不传 gap → 旧版行为
    const result = screenToPage(400, 1124, 1, 0, containerRect, pages, viewportW)
    expect(result).not.toBeNull()
    expect(result!.pageIndex).toBe(1)
    expect(result!.y).toBe(1)
  })
})

describe('hitTest 边界保护 (gap region)', () => {
  // 这是模拟 MouseHandler 调用: docY 落在 gap 时,
  // 旧版返回负 localY 导致命中错页 / 越界
  const pages = [{ height: 1123, width: 794 }, { height: 1123, width: 794 }]
  const gap = 30

  it('docY 落在间隙中部 — 不应返回负 localY', () => {
    // docY=1140: 介于 page0 [0,1123] 末尾和 page1 [1153, 2276] 起点之间 (gap [1123, 1153])
    const { pageIndex, localY } = findPageByDocY(1140, pages, gap)
    expect(pageIndex).toBe(1)
    expect(localY).toBeGreaterThanOrEqual(0) // 关键: 不应为负
  })

  it('docY 恰好等于 gap 起点 — 应映射到下一页顶部 (与旧版 pageHeight 边界行为一致)', () => {
    // 文档布局: page0 [0,1123] | gap [1123,1153] | page1 [1153,2276]
    // 旧版 `findPageByDocY` 在 `localY < pageHeight` 边界 (== 时) 翻到下一页 — 保持向后兼容
    // docY=1123 = page0.height, 与原 gap=0 时 `docY=pageHeight → next page` 行为对齐
    const r = findPageByDocY(1123, pages, gap)
    expect(r.pageIndex).toBe(1)
    expect(r.localY).toBe(0) // 钳制: 负值 → 0
  })

  it('docY 恰好等于 page1 起点 — 应映射到 page1 顶部', () => {
    // docY=1153 = page0.height + gap = page1 起点
    const r = findPageByDocY(1153, pages, gap)
    expect(r.pageIndex).toBe(1)
    expect(r.localY).toBe(0)
  })
})
