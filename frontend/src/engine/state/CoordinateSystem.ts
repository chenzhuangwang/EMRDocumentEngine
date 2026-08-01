// ================================================================
// CoordinateSystem — 三层坐标转换 (架构 §7.2, v20.34)
//
// Layer 1 — 文档坐标 (逻辑像素, 1px = 1/96 inch)
// Layer 2 — 画布坐标 (物理像素 × DPR)
// Layer 3 — 屏幕坐标 (CSS 像素)
// ================================================================

export interface CoordinateTransform {
  scale: number
  dpr: number
  scrollX: number
  scrollY: number
  canvasOffsetX: number
  canvasOffsetY: number
}

export class CoordinateSystem {
  transform: CoordinateTransform

  constructor(dpr: number) {
    this.transform = { scale: 1, dpr, scrollX: 0, scrollY: 0, canvasOffsetX: 0, canvasOffsetY: 0 }
  }

  update(partial: Partial<CoordinateTransform>): void {
    Object.assign(this.transform, partial)
  }

  /** 文档坐标 → 画布坐标 (物理像素) */
  docToCanvas(docX: number, docY: number): { x: number; y: number } {
    const { scale, dpr, scrollX, scrollY } = this.transform
    return {
      x: (docX - scrollX) * scale * dpr,
      y: (docY - scrollY) * scale * dpr,
    }
  }

  /** 屏幕坐标 → 文档坐标 */
  screenToDoc(screenX: number, screenY: number): { x: number; y: number } {
    const { scale, scrollX, scrollY, canvasOffsetX, canvasOffsetY } = this.transform
    return {
      x: (screenX - canvasOffsetX) / scale + scrollX,
      y: (screenY - canvasOffsetY) / scale + scrollY,
    }
  }

  /** 文档坐标 → 屏幕坐标 */
  docToScreen(docX: number, docY: number): { x: number; y: number } {
    const { scale, scrollX, scrollY, canvasOffsetX, canvasOffsetY } = this.transform
    return {
      x: (docX - scrollX) * scale + canvasOffsetX,
      y: (docY - scrollY) * scale + canvasOffsetY,
    }
  }

  /** ctx.setTransform() 所需的变换矩阵参数 */
  getCanvasTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const { scale, dpr, scrollX, scrollY } = this.transform
    return {
      a: scale * dpr, b: 0, c: 0, d: scale * dpr,
      e: -scrollX * scale * dpr,
      f: -scrollY * scale * dpr,
    }
  }
}
