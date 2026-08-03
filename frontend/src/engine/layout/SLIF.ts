// ================================================================
// SLIF — 标准布局中间格式 (架构 §7.7, v20.34)
//
// LayoutEngine 产出 → Draw/LayeredRenderer 消费 → 导出链路消费
// ================================================================

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
  underline?: boolean; strikeout?: boolean
  color?: string; highlight?: string
  superscript?: boolean; subscript?: boolean
  // table extension
  rows?: SLIFRow[]
  // image extension
  imageUrl?: string
  /** 列表标记文本 (项目符号或编号), 由 Draw.ts 通过 ListParticle 独立渲染 */
  listMarker?: string
}

export interface SLIFRow {
  height: number
  cells: SLIFCell[]
}

export interface SLIFCell {
  x: number; y: number; width: number; height: number
  colspan?: number; rowspan?: number
  isHeader?: boolean
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
