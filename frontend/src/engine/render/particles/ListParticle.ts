// ============================================================
// ListParticle — 列表标记渲染器 (TASK-454, v5.0)
//
// 独立渲染项目符号(•/◦/▪)和编号(1./a./i.等)
// 由 Draw.ts 在内容层渲染时调用, 在 TextParticle 之前绘制标记
// ============================================================

export class ListParticle {
  /**
   * 渲染列表标记到 Canvas
   *
   * @param ctx   Canvas 2D 上下文
   * @param marker 标记文本 (如 "  1. " 或 "  • ")
   * @param x      标记左上角 X 坐标 (文档坐标)
   * @param y      标记基线 Y 坐标 (文档坐标)
   * @param ascent 行上升高度
   * @param options 渲染选项
   */
  static render(
    ctx: CanvasRenderingContext2D,
    marker: string,
    x: number,
    y: number,
    ascent: number,
    options: {
      font?: string
      size?: number
      bold?: boolean
      color?: string
    } = {},
  ): number {
    const font = options.font || 'SimSun'
    const size = options.size || 16
    const bold = options.bold ?? false
    const color = options.color || '#374151' // gray-700, 比正文略深

    ctx.save()

    // 字体: 标记使用粗体或常规, 字号与正文相同
    const fontWeight = bold ? 'bold' : 'normal'
    ctx.font = `${fontWeight} ${size}px "${font}", sans-serif`
    ctx.fillStyle = color
    ctx.textBaseline = 'alphabetic'

    // 绘制标记文本
    ctx.fillText(marker, x, y + ascent)

    ctx.restore()

    // 返回标记宽度 (供外部计算正文偏移)
    const metrics = ctx.measureText(marker)
    return metrics.width
  }

  /**
   * 生成项目符号字符
   * level 1→•, 2→◦, 3→▪, 4+→◦ (循环)
   */
  static resolveBulletChar(level: number): string {
    const bullets = ['•', '◦', '▪']
    return bullets[(level - 1) % bullets.length]
  }

  /**
   * 生成有序列表编号 (带后缀)
   *
   * @param orderNum     序号 (从 1 开始)
   * @param numberStyle  编号样式
   * @returns 格式化后的编号字符串, 如 "1.", "a.", "i.", "一、"
   */
  static formatOrderedNumber(orderNum: number, numberStyle?: string): string {
    const raw = ListParticle.formatOrderedNumberRaw(orderNum, numberStyle)
    switch (numberStyle) {
      case 'cjk_ideographic':
        return `${raw}、`
      default:
        return `${raw}.`
    }
  }

  /**
   * 生成有序列表编号 (无后缀, 供 LayoutEngine 调用)
   *
   * @param orderNum     序号 (从 1 开始)
   * @param numberStyle  编号样式
   * @returns 格式化后的裸编号, 如 "1", "aa", "i", "一"
   */
  static formatOrderedNumberRaw(orderNum: number, numberStyle?: string): string {
    switch (numberStyle) {
      case 'lower_alpha':
        return ListParticle.toAlphaBijective(orderNum).toLowerCase()
      case 'upper_alpha':
        return ListParticle.toAlphaBijective(orderNum)
      case 'lower_roman':
        return ListParticle.toRoman(orderNum).toLowerCase()
      case 'upper_roman':
        return ListParticle.toRoman(orderNum)
      case 'cjk_ideographic':
        return ListParticle.toCjkIdeographic(orderNum)
      default:
        return String(orderNum)
    }
  }

  /**
   * 双射 base-26 编号 (Excel 列风格)
   * 1→A, 26→Z, 27→AA, 52→AZ, 702→ZZ, 703→AAA
   */
  static toAlphaBijective(n: number): string {
    let result = ''
    let num = n
    while (num > 0) {
      num-- // 调整为 0-based
      result = String.fromCharCode(65 + (num % 26)) + result
      num = Math.floor(num / 26)
    }
    return result
  }

  /** 阿拉伯数字 → 罗马数字 (大写) */
  static toRoman(n: number): string {
    const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
    const symbols = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
    let result = ''
    for (let i = 0; i < values.length; i++) {
      while (n >= values[i]) {
        result += symbols[i]
        n -= values[i]
      }
    }
    return result
  }

  /** 阿拉伯数字 → 中文数字 (支持 0-999, >=1000 回退为数字) */
  static toCjkIdeographic(n: number): string {
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
    if (n < 0) return String(n)
    if (n === 0) return '零'
    if (n <= 9) return digits[n]

    // >= 1000 回退为数字
    if (n >= 1000) return String(n)

    let result = ''
    const hundreds = Math.floor(n / 100)
    const remainder = n % 100

    if (hundreds > 0) {
      result += digits[hundreds] + '百'
      if (remainder === 0) return result // e.g., 200 → 二百
    }

    if (remainder > 0) {
      if (remainder <= 9) {
        // e.g., 201 → 二百零一, 101 → 一百零一
        if (hundreds > 0) result += '零'
        result += digits[remainder]
      } else {
        const tens = Math.floor(remainder / 10)
        const ones = remainder % 10
        // "十" only for standalone 10-19 (无百位); with hundreds it's "一十"
        if (tens === 1 && hundreds === 0) {
          result += '十'
        } else {
          result += digits[tens] + '十'
        }
        if (ones > 0) result += digits[ones]
      }
    }

    return result
  }

  /**
   * 生成编号的保守宽度字符串 (用于光标偏移估算)
   * 例如 "88. " 用于估算两个数字的编号宽度
   */
  static estimateMarkerWidth(level: number, type: 'bullet' | 'ordered'): string {
    const indent = '  '.repeat(level - 1)
    if (type === 'bullet') {
      return indent + '• '
    }
    return indent + '88. '
  }
}
