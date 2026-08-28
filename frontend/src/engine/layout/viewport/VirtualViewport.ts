// ============================================================
// VirtualViewport — 视口虚拟化 (R55, v6.0)
//
// 仅渲染可视区域 + 前后 overscan 页
// 配合 LayeredRenderer 减少 off-screen 绘制
// ============================================================

export interface ViewportState {
  /** 视口顶部 (scrollTop, CSS px) */
  scrollTop: number
  /** 视口高度 (CSS px) */
  viewportHeight: number
  /** 缩放到文档坐标的变换系数 */
  scale: number
}

export interface VisibleRange {
  /** 第一个可见页索引 */
  start: number
  /** 最后一个可见页索引 */
  end: number
}

export class VirtualViewport {
  private overscanPages = 1
  private pageHeight = 1123 // A4 default
  private currentRange: VisibleRange = { start: 0, end: 0 }

  /**
   * 根据滚动位置计算可见页面范围
   *
   * @param viewport 视口状态
   * @param totalPages 总页数
   * @returns 可见页索引范围
   */
  computeVisible(viewport: ViewportState, totalPages: number): VisibleRange {
    const docScrollTop = viewport.scrollTop / viewport.scale
    const docViewportH = viewport.viewportHeight / viewport.scale

    const start = Math.max(0, Math.floor(docScrollTop / this.pageHeight) - this.overscanPages)
    const end = Math.min(
      totalPages - 1,
      Math.ceil((docScrollTop + docViewportH) / this.pageHeight) + this.overscanPages,
    )

    const range = { start, end }
    this.currentRange = range
    return range
  }

  /** 判断页面是否在当前视口内 */
  isVisible(pageIndex: number): boolean {
    return pageIndex >= this.currentRange.start && pageIndex <= this.currentRange.end
  }

  /** 获取当前可见范围 */
  get visible(): VisibleRange { return { ...this.currentRange } }

  /** 设置页面高度 (影响可见范围计算) */
  setPageHeight(height: number): void { this.pageHeight = height }

  /** 设置 overscan 页数 (前后各多渲染几页, 减少滚动白屏) */
  setOverscan(pages: number): void { this.overscanPages = Math.max(0, pages) }

  /**
   * 计算视口内页面在画布上的 Y 偏移
   * 只生成可见页的 Canvas 绘制指令
   *
   * @param viewportHeight 视口高度 (CSS px) — 由调用方注入 (滚动容器高度),
   *   不读取 window.innerHeight (契约 §28)
   */
  getVisiblePageOffsets(totalPages: number, scrollTop: number, scale: number, viewportHeight: number): { pageIndex: number; canvasY: number }[] {
    const range = this.computeVisible(
      { scrollTop, viewportHeight, scale },
      totalPages,
    )

    const offsets: { pageIndex: number; canvasY: number }[] = []
    for (let i = range.start; i <= range.end; i++) {
      offsets.push({
        pageIndex: i,
        canvasY: i * this.pageHeight * scale - scrollTop,
      })
    }

    return offsets
  }
}
