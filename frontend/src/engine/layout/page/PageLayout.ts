// ================================================================
// PageLayout — 页级排版数据类型 (v21.0 抽取)
//
// 职责: 收纳 PageBreaker 算法所依赖的页面/行类型定义。
//       与算法本身解耦 — 其他模块 (incremental, viewport) 可单独引用。
//
// 包含类型:
//   - ILine  分页器视角的一行 (与 LineBreaker 的 ILine 结构兼容, 但元素类型是内联的)
//   - IPage  分页器视角的一页 — 含 lines + headerLines + footerLines + totalHeight
//
// 注意:
//   此处 ILine 是 PageBreaker 独立定义的, 与 line/LineLayout.ILine 结构相同
//   但元素类型是内联形状。保持独立避免类型耦合, 行为完全一致。
// ================================================================

/** 布局内部类型 — 换行后的单行 (PageBreaker 视角) */
export interface ILine {
  elements: { id: string; type: string; value?: string; size?: number; font?: string; bold?: boolean; italic?: boolean; color?: string; underline?: boolean; strikeout?: boolean; superscript?: boolean; subscript?: boolean }[]
  width: number
  height: number
  maxAscent: number
  maxDescent: number
  alignment?: string
  indent?: number
  /** 首行缩进 (仅首行) */
  firstLineIndent?: number
  /** 列表标记文本 (首行), 由 Draw.ts 通过 ListParticle 渲染 */
  listMarker?: string
  /** 可分页行 hook — 表格行由 LayoutEngine 注入 createTablePaginator 实例 (自持分页游标) */
  pageable?: { paginate(availableHeight: number): import('../table/TablePaginator').PaginateResult }
  /** PageBreaker 为表格行产出的一片 (本页渲染行子集) */
  tableFragment?: import('../table/TablePaginator').TableFragment
  /** 表格列宽数组 (由 LayoutEngine 注入, SLIF 映射时消费) */
  columnWidths?: number[]
}

/** 布局内部类型 — 分页后的页面 */
export interface IPage {
  pageIndex: number
  lines: ILine[]
  headerLines: ILine[]
  footerLines: ILine[]
  totalHeight: number
}
