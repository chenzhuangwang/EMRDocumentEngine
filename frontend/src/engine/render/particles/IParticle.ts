// ============================================================
// IParticle — 粒子渲染器接口 (R30, v6.0)
//
// 所有粒子渲染器 (Text/Separator/Image/Table/Footnote/Comment)
// 实现此接口, 通过 ParticleRegistry 注册后由 Draw.ts 统一调度
// ============================================================

import type { SLIFItem } from '../../layout/core/SLIF'
import type { PresentationStyle } from '../presentation/PresentationStyle'

/** 渲染上下文选项 */
export interface RenderOptions {
  /** 默认文字颜色 */
  defaultColor?: string
  /** 默认字体 */
  defaultFont?: string
  /** 默认字号 */
  defaultSize?: number
  /** 不可见字符显示模式 */
  showInvisible?: boolean
  /** 内容区域宽度 (用于分隔线等全宽元素) */
  contentWidth?: number
  /** 当前页面索引 (用于域代码动态计算) */
  pageIndex?: number
  /** 总页数 (用于 NUMPAGES 域) */
  totalPages?: number
  /** 表现层样式查询 (按 nodeId), draw time 读取 — 契约 §2.2 */
  presentationStyleOf?: (nodeId: string) => PresentationStyle | undefined
}

/** 粒子渲染器接口 */
export interface IParticle {
  /** 对应 SLIFItem.type 或 nodeType, 用于注册表查找 */
  readonly type: string

  /**
   * 将 SLIF 项渲染到 Canvas 上下文
   *
   * @param ctx     Canvas 2D 渲染上下文
   * @param item    SLIF 布局项 (包含坐标/文本/样式等全部信息)
   * @param x       渲染 X 坐标 (已应用页面偏移)
   * @param y       渲染 Y 坐标 (已应用页面偏移)
   * @param options 全局渲染选项
   */
  render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, options?: RenderOptions): void
}
