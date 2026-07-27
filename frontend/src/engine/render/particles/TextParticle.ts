// ============================================================
// TextParticle — 文本粒子渲染器 (Spec TASK-107)
//
// 将文本元素的字体构建、颜色计算、高亮背景、上下标偏移、
// 下划线、删除线等绘制逻辑封装为独立可复用的渲染类。
// ============================================================

import type { IElement, IEditorOption } from '../../document/DocumentModel'

/** 修订状态 → 文字颜色映射 */
const REVISION_COLORS: Record<string, string> = {
  insert: '#16A34A',
  delete: '#DC2626',
  modify: '#2563EB',
}

export class TextParticle {
  /**
   * 将单个文本/超链接/LaTeX 粒子渲染到 Canvas 上下文。
   *
   * 注意：此方法直接修改 ctx.font、ctx.fillStyle、ctx.strokeStyle 等
   * 全局状态，调用方应在需要时自行 save/restore。
   *
   * @param ctx        Canvas 2D 上下文
   * @param el         待渲染的文本元素
   * @param x          文档坐标 X（元素左上角）
   * @param y          文档坐标 Y（元素基线参考点）
   * @param options    编辑器配置（提供默认字体/字号/颜色）
   */
  static render(
    ctx: CanvasRenderingContext2D,
    el: IElement,
    x: number,
    y: number,
    options: Partial<IEditorOption> = {},
  ): void {
    const fontSize = el.size || options.defaultSize || 16
    const fontFamily = el.font || options.defaultFont || 'SimSun'

    // ---- 1. 字体构建 ----
    const fontParts: string[] = []
    if (el.bold) fontParts.push('bold')
    if (el.italic) fontParts.push('italic')
    fontParts.push(`${fontSize}px`)
    fontParts.push(`"${fontFamily}"`)
    ctx.font = fontParts.join(' ')

    // ---- 2. 颜色（修订色优先） ----
    let baseColor = options.defaultColor || '#000000'
    if (el.revision) {
      baseColor = REVISION_COLORS[el.revision.type] || baseColor
    } else if (el.color) {
      baseColor = el.color
    }
    ctx.fillStyle = baseColor

    // ---- 3. 高亮背景（在文字之前绘制，使其位于文字下方） ----
    if (el.highlight) {
      const tw = ctx.measureText(el.value).width
      ctx.fillStyle = el.highlight
      ctx.fillRect(x, y - fontSize * 0.8, tw, fontSize * 1.2)
      ctx.fillStyle = baseColor // 恢复文字颜色
    }

    // ---- 4. 上下标垂直偏移 ----
    let textY = y + fontSize * 0.8
    if (el.superscript) textY = y + fontSize * 0.3
    else if (el.subscript) textY = y + fontSize * 1.2

    // ---- 5. 文字绘制 ----
    if (el.value && el.value !== '​' && el.value !== '\n') {
      ctx.fillText(el.value, x, textY)
    }

    // ---- 6. 下划线 ----
    if (el.underline) {
      ctx.strokeStyle = baseColor
      ctx.lineWidth = 1
      const uy = y + fontSize * 0.9
      const tw = ctx.measureText(el.value).width
      ctx.beginPath()
      ctx.moveTo(x, uy)
      ctx.lineTo(x + tw, uy)
      if (el.underlineStyle === 'wave') ctx.setLineDash([2, 2])
      ctx.stroke()
      ctx.setLineDash([])
    }

    // ---- 7. 删除线 ----
    if (el.strikeout) {
      ctx.strokeStyle = baseColor
      ctx.lineWidth = 1
      const sy = y + fontSize * 0.4
      const tw = ctx.measureText(el.value).width
      ctx.beginPath()
      ctx.moveTo(x, sy)
      ctx.lineTo(x + tw, sy)
      ctx.stroke()
    }
  }
}
