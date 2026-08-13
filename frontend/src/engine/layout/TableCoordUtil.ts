// ================================================================
// TableCoordUtil — 统一坐标转换工具 (架构 §7.8, v21.0)
//
// 四层坐标系统:
//   1. 屏幕坐标 (CSS px, 相对浏览器视口)
//   2. 逻辑文档坐标 (逻辑 px, 绝对位置含 scrollY)
//   3. 页面内坐标 (逻辑 px, 已扣除 scrollY + 居中偏移)
//   4. 单元格局部坐标 (cell 内 item 的 x/y 从 0 开始)
//
// Phase 0 (v21.0): 统一命名
//   screenToLogical   — 屏幕 → 逻辑文档 (原 screenToDoc)
//   logicalToScreen   — 逻辑文档 → 屏幕 (原 docToScreen)
//   cellLocalToGlobal — cell 局部 → 文档全局 (原 cellToDoc)
//   globalToCellLocal — 文档全局 → cell 局部 (NEW)
//   screenToPage      — 屏幕 → 页面内坐标 (NEW, 合并三步转换)
//
// 所有坐标转换统一通过此模块, 禁止调用方手动内联计算。
// ================================================================

import type { SLIFItem } from './SLIF'

/** 屏幕坐标矩形 (CSS 像素, 相对于浏览器视口) */
export interface ScreenRect {
  left: number
  top: number
}

/** 单元格下标 */
export interface CellIndex {
  row: number
  col: number
}

/** 单元格边界矩形 (文档绝对坐标) */
export interface CellRect {
  x: number
  y: number
  width: number
  height: number
}

/** hitTestCell 返回的单元格命中信息 */
export interface CellHitInfo {
  ownerTableId: string
  cellIndex: CellIndex
  cellRect: CellRect
}

/** screenToPage 综合转换的返回类型 */
export interface PageDocCoords {
  /** 页面内 x (已扣除居中偏移) */
  x: number
  /** 页面内 y (已扣除页面顶部偏移) */
  y: number
  /** 页面索引 */
  pageIndex: number
  /** 原始逻辑 x (含居中偏移, 未扣除) */
  rawX: number
  /** 原始逻辑 y (含 scrollY, 未扣除) */
  rawY: number
}

// ================================================================
// 核心坐标转换 (v21.0 正式命名)
// ================================================================

/**
 * 屏幕坐标 (CSS px) → 逻辑文档坐标 (逻辑 px)
 *
 * 替代各调用方内联的 `(clientX - rect.left) / scale` 和
 * `(clientY - rect.top) / scale + scrollY` 算术。
 *
 * @param screenX   鼠标事件的 clientX
 * @param screenY   鼠标事件的 clientY
 * @param scale     当前缩放比例
 * @param scrollY   当前垂直滚动偏移
 * @param containerRect 容器元素的 getBoundingClientRect()
 * @returns 逻辑文档坐标 (含 scrollY, 未扣除页面偏移和居中偏移)
 */
export function screenToLogical(
  screenX: number,
  screenY: number,
  scale: number,
  scrollY: number,
  containerRect: ScreenRect,
): { x: number; y: number } {
  return {
    x: (screenX - containerRect.left) / scale,
    y: (screenY - containerRect.top) / scale + scrollY,
  }
}

/**
 * 逻辑文档坐标 (逻辑 px) → 屏幕坐标 (CSS px)
 *
 * @param docX   文档绝对 x (已扣除居中偏移)
 * @param docY   文档绝对 y (含 scrollY)
 * @param scale  当前缩放比例
 * @param scrollY 当前垂直滚动偏移
 * @param containerRect 容器元素的 getBoundingClientRect()
 */
export function logicalToScreen(
  docX: number,
  docY: number,
  scale: number,
  scrollY: number,
  containerRect: ScreenRect,
): { x: number; y: number } {
  return {
    x: docX * scale + containerRect.left,
    y: (docY - scrollY) * scale + containerRect.top,
  }
}

/**
 * 单元格局部坐标 → 文档全局坐标
 *
 * cell 内部 item 的 x/y 从 0 开始 (LayoutEngine 设置),
 * 转换成文档绝对坐标需要加上 cell 原点和内边距。
 *
 * @param localX  cell item 的相对 x (通常为 0)
 * @param localY  cell item 的相对 y (通常为 0)
 * @param cellX   单元格原点在文档中的绝对 x
 * @param cellY   单元格原点在文档中的绝对 y
 * @param padding 单元格内边距 (默认 6px = CELL_PADDING)
 */
export function cellLocalToGlobal(
  localX: number,
  localY: number,
  cellX: number,
  cellY: number,
  padding: number = 6,
): { x: number; y: number } {
  return {
    x: cellX + padding + localX,
    y: cellY + localY,
  }
}

/**
 * 文档全局坐标 → 单元格局部坐标
 *
 * cell 内点击命中后, 需要将文档绝对坐标转回 cell 局部坐标,
 * 用于在 SLIFCell.innerItems 上做二级二分查找。
 *
 * @param docX    文档绝对 x
 * @param docY    文档绝对 y
 * @param cellX   单元格原点在文档中的绝对 x
 * @param cellY   单元格原点在文档中的绝对 y
 * @param padding 单元格内边距 (默认 6px = CELL_PADDING)
 */
export function globalToCellLocal(
  docX: number,
  docY: number,
  cellX: number,
  cellY: number,
  padding: number = 6,
): { x: number; y: number } {
  return {
    x: docX - cellX - padding,
    y: docY - cellY,
  }
}

// ================================================================
// 向后兼容别名 (Phase 0-4 过渡期保留, Phase 5 移除)
// 标注 @deprecated, 引导新代码使用新名称
// ================================================================

/**
 * @deprecated 使用 screenToLogical 替代 (v21.0 重命名)
 */
export const screenToDoc = screenToLogical

/**
 * @deprecated 使用 logicalToScreen 替代 (v21.0 重命名)
 */
export const docToScreen = logicalToScreen

/**
 * @deprecated 使用 cellLocalToGlobal 替代 (v21.0 重命名)
 */
export const cellToDoc = cellLocalToGlobal

// ================================================================
// 页面定位
// ================================================================

/**
 * 根据文档 Y 坐标在页面数组中查找所在页面。
 *
 * 支持变高页面 (如跨页表格拆分可能产生不同高度的页面)。
 * 替代各调用方中重复的 page-finding loop。
 *
 * @param docY  文档绝对 y 坐标 (含 scrollY)
 * @param pages SLIF 页面数组 (每页需有 height 属性)
 * @returns 页面索引 (0-based) 和页面内局部 Y 坐标
 */
export function findPageByDocY(
  docY: number,
  pages: { height: number }[],
): { pageIndex: number; localY: number } {
  let localY = docY
  let pageIndex = 0
  for (let i = 0; i < pages.length; i++) {
    if (localY < pages[i].height) {
      pageIndex = i
      break
    }
    localY -= pages[i].height
    pageIndex = i
  }
  return { pageIndex: Math.min(pageIndex, pages.length - 1), localY }
}

/**
 * 计算页面居中偏移 (CSS px)。
 *
 * 替代各调用方中的 `Math.max(0, (viewportW - page.width * scale) / 2)`。
 */
export function pageCenteringOffset(
  pageWidth: number,
  viewportW: number,
  scale: number,
): number {
  return Math.max(0, (viewportW - pageWidth * scale) / 2)
}

/**
 * 根据文档 Y 坐标计算在页面内的局部 Y (扣除页面顶部偏移)。
 * 适用于等高页面场景; 变高页面请用 findPageByDocY。
 *
 * @param docY       文档绝对 y 坐标
 * @param pageHeight 单页高度
 */
export function pageLocalY(docY: number, pageHeight: number): number {
  return docY % pageHeight
}

// ================================================================
// 综合坐标转换: screen → 页面内逻辑坐标 (一键完成)
// 合并 screenToLogical + findPageByDocY + pageCenteringOffset
// 是点击命中检测的统一前置步骤
// ================================================================

/**
 * 屏幕坐标 → 页面内逻辑坐标 (一步完成三步转换)
 *
 * 替代各调用方中手动串联的:
 *   screenToDoc → findPageByDocY → pageCenteringOffset → docX 扣除
 *
 * @param screenX    鼠标事件的 clientX
 * @param screenY    鼠标事件的 clientY
 * @param scale      当前缩放比例
 * @param scrollY    当前垂直滚动偏移
 * @param containerRect 容器元素矩形
 * @param pages      SLIF 页面数组 (含 width/height)
 * @param viewportW  视口宽度 (container.clientWidth)
 */
export function screenToPage(
  screenX: number,
  screenY: number,
  scale: number,
  scrollY: number,
  containerRect: ScreenRect,
  pages: { width: number; height: number }[],
  viewportW: number,
): PageDocCoords | null {
  if (pages.length === 0) return null

  const { x: rawX, y: rawY } = screenToLogical(screenX, screenY, scale, scrollY, containerRect)
  const { pageIndex, localY } = findPageByDocY(rawY, pages)
  const page = pages[pageIndex]
  if (!page) return null

  const offsetX = pageCenteringOffset(page.width, viewportW, scale)
  const x = rawX - offsetX / scale

  return { x, y: localY, pageIndex, rawX, rawY }
}

// ================================================================
// 单元格命中检测
// ================================================================

/**
 * 在扁平化 item 列表中命中单元格。
 *
 * 遍历 getFlatPageItems() 输出, 检查每个 item 的 cellRect 元数据,
 * 若 docX/docY 落在某个单元格的边界矩形内, 返回该单元格信息。
 *
 * 用于: 点击单元格空白区域时的回退处理。
 * 注意: 这是过渡期方案。Phase 2 将改用 MergeMatrix.findCellAt() 做二级命中。
 *
 * @param docX      文档绝对 x
 * @param docY      文档绝对 y
 * @param flatItems getFlatPageItems() 的输出 (含 cellRect 元数据)
 * @returns 命中的单元格信息, 或 null
 */
export function hitTestCell(
  docX: number,
  docY: number,
  flatItems: SLIFItem[],
): CellHitInfo | null {
  // 收集已检查过的 cellRect (去重 — 同一 cell 的多个 item 共享同一个 cellRect)
  const seen = new Set<string>()

  for (const item of flatItems) {
    if (!item.cellRect || !item.ownerTableId || !item.cellIndex) continue

    // 去重: 同一 (tableId + row + col) 只检查一次
    const key = `${item.ownerTableId}:${item.cellIndex.row}:${item.cellIndex.col}`
    if (seen.has(key)) continue
    seen.add(key)

    const r = item.cellRect
    if (docX >= r.x && docX <= r.x + r.width && docY >= r.y && docY <= r.y + r.height) {
      return {
        ownerTableId: item.ownerTableId,
        cellIndex: item.cellIndex,
        cellRect: r,
      }
    }
  }

  return null
}

// ================================================================
// 列宽计算 (统一入口)
// ================================================================

/**
 * 计算表格均匀列宽。
 *
 * 替换 HitTestIndex / TableParticle 中重复的列宽计算。
 *
 * @param totalWidth 表格总宽度
 * @param numCols    列数
 * @returns 每列宽度数组 (最小 40px)
 */
export function calcUniformColWidths(totalWidth: number, numCols: number): number[] {
  if (numCols === 0) return []
  const w = Math.max(Math.floor(totalWidth / numCols), 40)
  return Array.from({ length: numCols }, () => w)
}
