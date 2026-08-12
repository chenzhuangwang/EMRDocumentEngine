// ================================================================
// SLIF — 标准布局中间格式 (架构 §7.7, v20.34)
//
// LayoutEngine 产出 → Draw/LayeredRenderer 消费 → 导出链路消费
//
// 版本: SLIF_VERSION = '4.0' — 与 DocumentTree modelVersion 对齐
// ================================================================

/** SLIF 格式版本 (与 DocumentTree modelVersion 对齐) */
export const SLIF_VERSION = '4.0'

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
  /** 域类型 (FieldNode.fieldType), 渲染时动态计算值 */
  fieldType?: string
}

export interface SLIFRow {
  height: number
  cells: SLIFCell[]
}

export interface SLIFCell {
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

export interface SLIF {
  version: string
  documentId: string
  pages: SLIFPage[]
}

/** 将 SLIF 页面的所有 item 展平为绝对坐标列表 (含表格 cell 内嵌项) */
export function getFlatPageItems(page: SLIFPage): SLIFItem[] {
  const result: SLIFItem[] = []
  for (const item of page.items) {
    if (item.type === 'table' && item.rows && item.rows.length > 0) {
      const maxCols = Math.max(...item.rows.map(r => r.cells.length))
      const colWidths = item.columnWidths && item.columnWidths.length === maxCols
        ? item.columnWidths
        : calcUniformColWidths(item.width, maxCols)
      let rowY = item.y
      for (const row of item.rows) {
        const rowHeight = Math.max(row.height || 24, 24)
        let cellX = item.x
        for (let ci = 0; ci < row.cells.length; ci++) {
          const cell = row.cells[ci]
          const cw = colWidths[ci] || 40
          const CELL_PAD = 6
          for (const cellItem of cell.items) {
            result.push({
              ...cellItem,
              x: cellX + CELL_PAD + (cellItem.x || 0),
              y: rowY + (cellItem.y || 0),
              width: cellItem.width || (cw - CELL_PAD * 2),
              height: cellItem.height || 20,
            })
          }
          cellX += cw
        }
        rowY += rowHeight + 1
      }
    }
    result.push(item)
  }
  return result
}

function calcUniformColWidths(totalWidth: number, numCols: number): number[] {
  if (numCols === 0) return []
  const w = Math.max(Math.floor(totalWidth / numCols), 40)
  return Array.from({ length: numCols }, () => w)
}
