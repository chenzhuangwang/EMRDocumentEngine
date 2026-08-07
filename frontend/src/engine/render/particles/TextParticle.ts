// ============================================================
// TextParticle — 文本粒子渲染器 (v5.0 / TASK-475)
//
// 新增: showInvisible 模式 — 空格→中点 / 换行→↵ / 制表符→→
// ============================================================

const REVISION_COLORS: Record<string, string> = {
  insert: '#16A34A', delete: '#DC2626', modify: '#2563EB',
}

/** 不可见字符映射 */
const INVISIBLE_MAP: Record<string, string> = {
  ' ':  '·',   // · (middle dot)
  '\n': '↵',   // ↵ (carriage return arrow)
  '\t': '→',   // → (right arrow)
}

/** 不可见字符的颜色 (淡蓝灰) */
const INVISIBLE_COLOR = '#93C5FD'

export class TextParticle {
  static render(
    ctx: CanvasRenderingContext2D,
    el: { id: string; type: string; value: string; font?: string; size?: number; bold?: boolean; italic?: boolean; color?: string; underline?: boolean; underlineStyle?: string; strikeout?: boolean; superscript?: boolean; subscript?: boolean; highlight?: string; revision?: { type: string } },
    x: number,
    y: number,
    options: { defaultColor?: string; defaultFont?: string; defaultSize?: number; showInvisible?: boolean } = {},
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
      // 不可见字符模式: 空格/制表符绘制为特殊符号
      if (options.showInvisible) {
        this.renderInvisible(ctx, el.value, x, textY, baseColor, fontSize)
      } else {
        ctx.fillText(el.value, x, textY)
      }
    } else if (el.value === '\n' && options.showInvisible) {
      // 换行符可视化
      ctx.save()
      ctx.fillStyle = INVISIBLE_COLOR
      ctx.font = `${fontSize * 0.7}px "${fontFamily}"`
      ctx.fillText(INVISIBLE_MAP['\n'], x, textY)
      ctx.restore()
    }

    // ---- 6. 下划线 ----
    if (el.underline) {
      ctx.strokeStyle = baseColor
      ctx.lineWidth = 1
      const uy = y + fontSize * 0.9
      const tw = ctx.measureText(el.value).width
      const style = el.underlineStyle || 'single'

      if (style === 'wave') {
        // 波浪下划线 — 正弦曲线路径
        ctx.beginPath()
        const amplitude = 2
        const period = 6
        for (let wx = x; wx <= x + tw; wx += 1) {
          const wy = uy + Math.sin((wx - x) / period * Math.PI * 2) * amplitude
          if (wx === x) ctx.moveTo(wx, wy)
          else ctx.lineTo(wx, wy)
        }
        ctx.stroke()
      } else if (style === 'double') {
        // 双下划线 — 两条平行线
        ctx.beginPath()
        ctx.moveTo(x, uy - 2)
        ctx.lineTo(x + tw, uy - 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x, uy + 2)
        ctx.lineTo(x + tw, uy + 2)
        ctx.stroke()
      } else {
        // single — 默认单线
        ctx.beginPath()
        ctx.moveTo(x, uy)
        ctx.lineTo(x + tw, uy)
        ctx.stroke()
      }
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

  /** 不可见字符模式: 逐字符绘制, 空格/制表符用特殊符号代替 */
  private static renderInvisible(
    ctx: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    normalColor: string,
    _fontSize: number,
  ): void {
    const spaceWidth = ctx.measureText(' ').width

    let cx = x
    for (const ch of [...value]) {
      const invisible = INVISIBLE_MAP[ch]
      if (invisible) {
        ctx.save()
        ctx.fillStyle = INVISIBLE_COLOR
        ctx.fillText(invisible, cx, y)
        ctx.restore()
        cx += ch === ' ' ? spaceWidth : ch === '\t' ? spaceWidth * 4 : ctx.measureText(invisible).width
      } else {
        ctx.fillStyle = normalColor
        ctx.fillText(ch, cx, y)
        cx += ctx.measureText(ch).width
      }
    }
  }
}
