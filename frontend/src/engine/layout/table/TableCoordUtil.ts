// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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

import type { SLIFItem } from '../core/SLIF'

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
 * 间隙说明 (pageVerticalGap):
 *   文档逻辑 Y 坐标 = 累加 (pageHeight[i] + pageVerticalGap) 形成的虚拟 Y。
 *   返回的 localY 仍是页面内局部坐标 (0 ~ pageHeight[i])，不含间隙。
 *   因此 hitTest / 命中检测无需改动 — 只需把 docY 正确反查到 pageIndex + localY。
 *
 * 边界处理:
 *   - docY 恰好落在间隙区域 → localY 钳制到下一页的 0 (避免负值)
 *   - docY >= 最后页的累计底部 → 返回最后一页 + localY 钳制到 [0, pageHeight)
 *
 * @param docY            文档绝对 y 坐标 (含 scrollY + 间隙)
 * @param pages           SLIF 页面数组 (每页需有 height 属性)
 * @param pageVerticalGap 相邻页面之间的渲染间隙 (文档逻辑 px)，默认 0
 * @returns 页面索引 (0-based) 和页面内局部 Y 坐标 (钳制到 [0, pageHeight))
 */
export function findPageByDocY(
  docY: number,
  pages: { height: number }[],
  pageVerticalGap: number = 0,
): { pageIndex: number; localY: number } {
  if (pages.length === 0) return { pageIndex: 0, localY: 0 }
  let localY = docY
  let pageIndex = 0
  for (let i = 0; i < pages.length; i++) {
    if (localY < pages[i].height) {
      // 落在页面内 (或前 i 页累计的间隙区域 → 钳制到本页顶部 0)
      pageIndex = i
      if (localY < 0) localY = 0
      break
    }
    // localY 落在第 i 页的间隙之后, 跳到下一页
    localY -= pages[i].height + pageVerticalGap
    pageIndex = i
  }
  // 超出最后页 → 钳制到最后一页 + localY 钳制到 [0, pageHeight)
  const clampedIndex = Math.min(pageIndex, pages.length - 1)
  const clampedLocalY = Math.max(0, Math.min(localY, pages[clampedIndex].height))
  return { pageIndex: clampedIndex, localY: clampedLocalY }
}

/**
 * 计算页面在文档逻辑坐标中的累加 Y 偏移 (pageIndex 处页面的顶部 Y)。
 *
 * 用于渲染阶段计算每页在视口 (canvas) 中的 Y 坐标:
 *   canvasPageY(i) = accumulatedHeightTo(i) - scrollY
 *
 * 这是 pageVerticalGap 间隙的唯一作用点 — 仅渲染视口计算，存储的
 * SLIF item.y / page.height / 文档数据模型完全不变。
 *
 * @param pageIndex       目标页索引 (0-based)
 * @param pages           SLIF 页面数组
 * @param pageVerticalGap 相邻页面之间的渲染间隙 (文档逻辑 px)
 */
export function accumulatedHeightTo(
  pageIndex: number,
  pages: { height: number }[],
  pageVerticalGap: number = 0,
): number {
  if (pageIndex <= 0) return 0
  let total = 0
  const upper = Math.min(pageIndex, pages.length)
  for (let i = 0; i < upper; i++) {
    total += pages[i].height + pageVerticalGap
  }
  return total
}

/**
 * 计算含间隙的整篇文档总高度 (CSS 逻辑 px)。
 *
 * 用于 LayeredRenderer spacer 高度与 Editor.getTotalDocHeight()。
 * 当 pageVerticalGap=0 时退化为 sum(pageHeight)，与历史行为一致。
 *
 * @param pages           SLIF 页面数组
 * @param pageVerticalGap 相邻页面之间的渲染间隙
 */
export function getTotalDocHeight(
  pages: { height: number }[],
  pageVerticalGap: number = 0,
): number {
  if (pages.length === 0) return 0
  if (pageVerticalGap === 0) {
    let h = 0
    for (const p of pages) h += p.height
    return h
  }
  // 末页之后不再追加间隙
  return accumulatedHeightTo(pages.length, pages, pageVerticalGap) - pageVerticalGap
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
 * @param screenX         鼠标事件的 clientX
 * @param screenY         鼠标事件的 clientY
 * @param scale           当前缩放比例
 * @param scrollY         当前垂直滚动偏移
 * @param containerRect   容器元素矩形
 * @param pages           SLIF 页面数组 (含 width/height)
 * @param viewportW       视口宽度 (container.clientWidth)
 * @param pageVerticalGap 相邻页面渲染间隙 (CSS px, 默认 0)
 */
export function screenToPage(
  screenX: number,
  screenY: number,
  scale: number,
  scrollY: number,
  containerRect: ScreenRect,
  pages: { width: number; height: number }[],
  viewportW: number,
  pageVerticalGap: number = 0,
): PageDocCoords | null {
  if (pages.length === 0) return null

  const { x: rawX, y: rawY } = screenToLogical(screenX, screenY, scale, scrollY, containerRect)
  const { pageIndex, localY } = findPageByDocY(rawY, pages, pageVerticalGap)
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
