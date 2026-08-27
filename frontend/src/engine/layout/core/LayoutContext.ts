// ================================================================
// LayoutContext — 布局上下文 (v21.0 抽取)
//
// 职责: 收纳 LayoutEngine 的输入配置 (页边距/页眉页脚高/页面尺寸等)。
//       与核心编排器解耦 — LayoutEngine 只负责算法, 上下文由调用方持有。
//
// 与 LayoutConfig 的关系:
//   - 历史上 LayoutConfig 接口内联在 LayoutEngine.ts。
//   - 此文件把它独立出来, 路径清晰表示"这是上下文数据, 不是引擎本身"。
// ================================================================

/** 布局配置 — LayoutEngine 的输入上下文 */
export interface LayoutConfig {
  pageWidth: number
  pageHeight: number
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  /** 页眉区域高度 (px), 默认 42 (约 3 行 14px) */
  headerHeight?: number
  /** 页脚区域高度 (px), 默认 42 */
  footerHeight?: number
}
