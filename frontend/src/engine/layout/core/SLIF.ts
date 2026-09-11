// ================================================================
// SLIF — 标准布局中间格式 (架构 §7.7, v20.34)
//
// LayoutEngine 产出 → Draw/LayeredRenderer 消费 → 导出链路消费
//
// 版本: SLIFVersion 为名义独立版本域 (契约 §26.14), 不与 modelVersion 混淆。
// 详见 knowledge/document-version-system-design.md §1.3 (决策 #1 已废止)。
// ================================================================

import { CURRENT_SLIF_VERSION, type SLIFVersion } from '../../document/version/DocumentFormatVersion'

/** SLIF 格式版本 (名义独立版本域, 契约 §26.14) */
export const SLIF_VERSION: SLIFVersion = CURRENT_SLIF_VERSION

export interface SLIFItem {
  nodeId: string
  nodeType: string
  lineOffset?: number
  type: string
  text?: string
  x: number; y: number
  width: number; height: number
  ascent: number; descent: number
  font: string; size: number
  bold?: boolean; italic?: boolean
  underline?: boolean; underlineStyle?: string; strikeout?: boolean
  color?: string; highlight?: string
  superscript?: boolean; subscript?: boolean
  // table extension
  rows?: SLIFRow[]
  /** 跨页重复的表头行 (仅视觉渲染, 不参与逻辑行号/命中) */
  headerRows?: SLIFRow[]
  /** 表头行数 (跨页重复, R65) */
  headerRowCount?: number
  /** 续表标记文本 (R65) */
  continuationLabel?: string
  /** 表格列宽数组 (TASK-701, px) */
  columnWidths?: number[]
  // image extension
  imageUrl?: string
  /** 列表标记文本 (项目符号或编号), 由 Draw.ts 通过 ListParticle 独立渲染 */
  listMarker?: string
  /** 列表标记 X 坐标 (shift 前原始位置) */
  listMarkerX?: number
  /** 列表标记像素宽度 (用于光标 charW 计算扣减) */
  markerWidth?: number
  /** 多行文本域折行后的物理行 (textarea, 契约 §12.6 多行), 供 ControlParticle 逐行绘制 */
  controlLines?: string[]
  /** 域类型 (FieldNode.fieldType), 渲染时动态计算值 */
  fieldType?: string
  /** 所属表格 ID (由 getFlatPageItems 自动填充, 非表格项为 undefined) */
  ownerTableId?: string
  /** 单元格下标 (由 getFlatPageItems 自动填充) */
  cellIndex?: { row: number; col: number }
  /** 单元格边界矩形 — 文档绝对坐标 (由 getFlatPageItems 自动填充) */
  cellRect?: { x: number; y: number; width: number; height: number }
}

export interface SLIFRow {
  height: number
  cells: SLIFCell[]
}

export interface SLIFCell {
  /** 单元格节点 ID (cell nodeId), 供 MergeMatrix 命中反查 (v21.0 Phase 1) */
  id?: string
  x: number; y: number; width: number; height: number
  colspan?: number; rowspan?: number
  isHeader?: boolean
  backgroundColor?: string
  items: SLIFItem[]
}

export interface SLIFPage {
  pageIndex: number
  width: number; height: number
  items: SLIFItem[]
  /** 页眉渲染项 (y 坐标相对于页眉区顶部) */
  headerItems?: SLIFItem[]
  /** 页脚渲染项 (y 坐标相对于页脚区顶部) */
  footerItems?: SLIFItem[]
  /** 页眉区域高度 (px) */
  headerHeight?: number
  /** 页脚区域高度 (px) */
  footerHeight?: number
}

/** 表格相邻行之间的 1px 行隙 (与 TableParticle / getFlatPageItems / hitTestTable 一致) */
export const TABLE_ROW_GAP = 1

/** 单行的布局占高 (行高 + 行隙) — 表格分页/命中/渲染三方共用, 避免漂移 */
export function tableRowUnitHeight(row: { height: number }): number {
  return Math.max(row.height || 24, 24) + TABLE_ROW_GAP
}

/** 重复表头占高 (视觉行, 不计入逻辑行号, 但计入 fragment/item 高度) */
export function tableHeaderRowsHeight(item: { headerRows?: SLIFRow[] }): number {
  return (item.headerRows ?? []).reduce((s, r) => s + tableRowUnitHeight(r), 0)
}

export interface SLIF {
  version: string
  documentId: string
  pages: SLIFPage[]
}

/** 将 SLIF 页面的所有 item 展平为绝对坐标列表 (含表格 cell 内嵌项 + 嵌套元数据)

  每个展平项挂载:
  - ownerTableId: 所属表格 ID (非表格项为 undefined)
  - cellIndex: 单元格下标 {row, col} (非表格项为 undefined)
  - cellRect: 单元格边界矩形 — 文档绝对坐标 (非表格项为 undefined)

  表格容器 item 本身不进入展平列表, 只包含 cell 内嵌项。 */
export function getFlatPageItems(page: SLIFPage): SLIFItem[] {
  const result: SLIFItem[] = []
  for (const item of page.items) {
    if (item.type === 'table' && item.rows && item.rows.length > 0) {
      let rowY = item.y + tableHeaderRowsHeight(item)
      for (let ri = 0; ri < item.rows.length; ri++) {
        const row = item.rows[ri]
        const rowHeight = Math.max(row.height || 24, 24)
        for (let ci = 0; ci < row.cells.length; ci++) {
          const cell = row.cells[ci]
          // 使用 SLIFCell 已算好的合并宽度/起始 x (含 colspan, v21.0 Phase 1)
          const cw = cell.width || 40
          const ch = cell.height || rowHeight
          const cellX = item.x + (cell.x || 0)
          const CELL_PAD = 6
          // 单元格绝对边界矩形 (文档坐标, 高度含 rowspan 合并)
          const cellRect = { x: cellX, y: rowY, width: cw, height: ch }
          for (const cellItem of cell.items) {
            result.push({
              ...cellItem,
              x: cellX + CELL_PAD + (cellItem.x || 0),
              y: rowY + (cellItem.y || 0),
              width: cellItem.width || (cw - CELL_PAD * 2),
              height: cellItem.height || 20,
              // 嵌套元数据挂载
              ownerTableId: item.nodeId,
              cellIndex: { row: ri, col: ci },
              cellRect,
            })
          }
        }
        rowY += rowHeight + 1
      }
      // 表格容器 item 不进入展平列表 — 展平后只需单元格内容
    } else {
      result.push(item)
    }
  }
  return result
}
