// ================================================================
// LineLayout — 行级排版数据类型 (v21.0 抽取)
//
// 职责: 收纳 LineBreaker 算法所依赖的所有类型定义 (输入元素/行/配置)。
//       与算法本身解耦 — 其他模块可单独引用这些类型而不必 import LineBreaker。
//
// 包含类型:
//   - LineElement    单个可折行元素 (文本/超链接/图片/控制/表格占位/LaTeX/域)
//   - FontConfig     行内文本元素的字体配置
//   - LineBreakOptions 折行选项 (maxWidth + wordBreak + 默认字体)
//   - ILine          折行结果 — 一行内的所有元素 + 度量 (宽/高/ascent/descent + 对齐/缩进/列表标记)
// ================================================================

/** 单个可折行元素 — 输入 LineBreaker 的最小单元 */
export interface LineElement {
  id: string
  type: string
  value: string
  font?: string
  size?: number
  bold?: boolean
  italic?: boolean
  color?: string
  underline?: boolean; underlineStyle?: string; strikeout?: boolean
  highlight?: string
  superscript?: boolean
  subscript?: boolean
  imageData?: { width?: number; height?: number; wrapType?: string }
  /** 控件布局提示: width 固定宽 / minRows 多行文本域最小行数 /
   *  lines·rows 文本域折行后的物理行 (供 SLIFItem.controlLines 与粒子绘制) /
   *  ownLine 内容超宽被锁宽折行 → 必须独占起行 /
   *  wrapWidth 框内文本可用宽 (折行口径 + overlay 编辑面宽度上限, 契约 §12.8) */
  control?: {
    width?: number; minRows?: number; lines?: string[]; rows?: number
    ownLine?: boolean; wrapWidth?: number
  }
  tableBlock?: unknown
  fieldType?: string
  /**
   * 域代码**量宽用**的代表性显示值 (契约 §12)。
   * `value` 是模型里的占位符 ('[总页数]'), 渲染期才逐页解析出真实值 ('3');
   * 若按占位符量宽, 域后会拖出大片空白。布局/折行一律用本字段量宽,
   * `value` 仍作为未知域类型的显示回退。
   */
  fieldReserveText?: string
}

/** 行内文本元素的字体配置 */
export interface FontConfig {
  font: string
  size: number
  bold?: boolean
  italic?: boolean
  letterSpacing?: number
}

/** 折行选项 */
export interface LineBreakOptions {
  maxWidth: number
  wordBreak: 'break-all' | 'break-word' | 'keep-all'
  defaultFont: string
  defaultSize: number
  /** 段落行距倍率 (ParagraphStyle.lineHeight, 1.0=单倍) */
  lineHeight?: number
}

/** 折行结果 — 一行内的所有元素 + 度量 */
export interface ILine {
  elements: LineElement[]
  width: number
  height: number
  maxAscent: number
  maxDescent: number
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indent?: number
  /** 首行缩进 (仅首行) */
  firstLineIndent?: number
  /** 列表标记文本 (首行), 由 Draw.ts 通过 ListParticle 渲染 */
  listMarker?: string
}
