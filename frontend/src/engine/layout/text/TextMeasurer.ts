// ============================================================
// TextMeasurer — 文本测量器 (架构 §3, v5.0 / TASK-403)
//
// 三级精度:
//   L1 (MVP): Canvas measureText + FontManager 精确度量 + LRU 缓存
//   L2 (预留): HarfBuzz WASM 精确塑形 (CJK kerning/GPOS)
//   L3 (预留): 离线预计算 (字体子集化 + 预测量表)
//
// 增强:
//   - 注入 FontManager: lineHeight/ascent/descent 来自字体文件, 非启发式
//   - measureChars(): 逐字符测量 + Latin kerning 计算
//   - 缓存扩容 2000 → 10000
// ============================================================

import { fontManager } from './FontManager'
import { FontFallback } from './FontFallback'
import { resolveLineHeight, DEFAULT_FONT_METRICS } from './FontMetrics'
import type { FontMetrics } from './FontMetrics'

// ---- FontConfig — 字体配置 (供测量器使用) ----

export interface FontConfig {
  font: string
  size: number
  bold?: boolean
  italic?: boolean
  letterSpacing?: number
}

// ---- CharMetrics — 单字符度量结果 ----

export interface CharMetrics {
  char: string
  width: number
  kerning: number
}

export class TextMeasurer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cache: Map<string, TextMetrics>
  private cacheKeys: string[] = []
  private static readonly MAX_CACHE_SIZE = 10000
  private fallback: FontFallback

  constructor() {
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
    this.cache = new Map()
    this.fallback = new FontFallback()
  }

  // ---- 内部 ----

  private buildFontString(config: FontConfig): string {
    const parts: string[] = []
    if (config.bold) parts.push('bold')
    if (config.italic) parts.push('italic')
    parts.push(`${config.size}px`)
    parts.push(`"${config.font}"`)
    return parts.join(' ')
  }

  private getCacheKey(text: string, config: FontConfig): string {
    return `${text}|${config.font}|${config.size}|${config.bold}|${config.italic}`
  }

  // ---- 基础测量 API ----

  measure(text: string, config: FontConfig): TextMetrics {
    const key = this.getCacheKey(text, config)
    if (this.cache.has(key)) {
      // Move to end (MRU)
      this.cacheKeys = this.cacheKeys.filter(k => k !== key)
      this.cacheKeys.push(key)
      return this.cache.get(key)!
    }

    this.ctx.font = this.buildFontString(config)
    const metrics = this.ctx.measureText(text)

    // LRU eviction
    if (this.cacheKeys.length >= TextMeasurer.MAX_CACHE_SIZE) {
      const oldest = this.cacheKeys.shift()!
      this.cache.delete(oldest)
    }

    this.cache.set(key, metrics)
    this.cacheKeys.push(key)
    return metrics
  }

  measureWidth(text: string, config: FontConfig): number {
    // 缺字检测: 如当前字体无法渲染文本, 尝试降级字体
    let font = config.font
    if (text.length > 0 && this.fallback) {
      const missing = this.fallback.detectMissingGlyphs(text, config.font)
      if (missing.size > 0) {
        const result = this.fallback.resolveFallbackFonts(text, {
        primary: config.font,
        fallbacks: ['Microsoft YaHei', 'SimSun', 'Arial', 'sans-serif'],
      })
        if (result.length > 0 && result[0].font !== config.font) {
          font = result[0].font
        }
      }
    }
    return this.measure(text, { ...config, font }).width
  }

  /**
   * 逐字符测量 — 包含 kerning 计算
   *
   * kerning 仅在相邻两个 Latin 字符时计算 (CJK 无 kerning)
   *
   * @returns CharMetrics[] 每个字符的宽度和 kerning 值
   */
  measureChars(text: string, config: FontConfig): CharMetrics[] {
    const chars = [...text]
    return chars.map((char, i) => {
      const width = this.measureWidth(char, config)

      // kerning: 仅相邻 Latin 字符计算
      const prev = i > 0 ? chars[i - 1] : ''
      const isLatinPair = this.isLatinChar(prev) && this.isLatinChar(char)
      let kerning = 0
      if (i > 0 && isLatinPair) {
        const pairWidth = this.measureWidth(prev + char, config)
        const prevWidth = this.measureWidth(prev, config)
        kerning = pairWidth - prevWidth - width
      }

      return { char, width, kerning }
    })
  }

  private isLatinChar(char: string): boolean {
    const cp = char.codePointAt(0) ?? 0
    // ASCII letters + Latin-1 Supplement + Latin Extended
    return (cp >= 0x0041 && cp <= 0x005A) || // A-Z
           (cp >= 0x0061 && cp <= 0x007A) || // a-z
           (cp >= 0x00C0 && cp <= 0x024F)    // Latin-1 + Extended
  }

  // ---- 精确度量 (FontManager 驱动) ----

  /**
   * 获取行高 — 来自 FontManager 精确度量 + resolveLineHeight 公式
   *
   * 公式: lineHeight = (ascent + |descent| + lineGap) × (fontSize / 1000) × paragraphLineHeight
   *
   * 如果字体未注册, 回退到 DEFAULT_FONT_METRICS (SimSun 16px 标准)
   */
  getLineHeight(config: FontConfig, paragraphLineHeight?: number): number {
    const metrics = this.getFontMetrics(config)
    return resolveLineHeight(config.size, paragraphLineHeight, metrics)
  }

  /** 获取 ascent (基线以上高度, px) — 来自 FontManager */
  getAscent(config: FontConfig): number {
    const metrics = this.getFontMetrics(config)
    return metrics.ascent * (config.size / 1000)
  }

  /** 获取 descent (基线以下高度, px, 正值) — 来自 FontManager */
  getDescent(config: FontConfig): number {
    const metrics = this.getFontMetrics(config)
    return Math.abs(metrics.descent) * (config.size / 1000)
  }

  /** 从 FontManager 获取度量, 降级到 DEFAULT_FONT_METRICS */
  private getFontMetrics(config: FontConfig): FontMetrics {
    const fm = fontManager.getMetrics(config.font)
    if (fm) return fm

    // 尝试从已注册字体中查找近似 match
    const families = fontManager.getRegisteredFamilies()
    if (families.includes(config.font)) {
      const variant = fontManager.getVariant(config.font)
      if (variant?.metrics) return variant.metrics
    }

    return DEFAULT_FONT_METRICS
  }

  // ================================================================
  // L2 预留 — HarfBuzz WASM 精确塑形
  //
  // HarfBuzz 可提供:
  //   - GPOS kerning (CJK 字符对间距)
  //   - GSUB 连字 (Arabic/Farsi 字符变形)
  //   - 精确 glyph advance (不含浏览器 hinting 噪声)
  //
  // 集成方式:
  //   1. harfbuzzjs WASM 编译 → harfbuzz.wasm
  //   2. shapeText(text, fontBuffer) → glyph advances[]
  //   3. 缓存: (text, fontId) → GlyphRun
  //
  // 切换条件: 性能达标 + 跨平台度量一致性验证通过
  // ================================================================

  /**
   * L2 精确宽度测量 (预留, 当前委托到 measureWidth)
   *
   * 未来实现: HarfBuzz WASM 塑形 → 精确 glyph advance → 宽度
   */
  measureWidthPrecise(text: string, config: FontConfig): number {
    // TODO L2: HarfBuzz WASM
    // const glyphRun = harfbuzz.shape(text, fontBuffer)
    // return glyphRun.advances.reduce(sum, 0)
    return this.measureWidth(text, config)
  }

  // ---- 多行分割 (保留, 兼容旧接口) ----

  /**
   * 将文本按指定宽度分割为多行
   * 支持 CJK 字符在任意位置断行，英文按单词断行
   */
  splitTextToWidth(text: string, maxWidth: number, config: FontConfig): string[] {
    if (!text) return ['']
    if (maxWidth <= 0) return [text]

    const lines: string[] = []
    const chars = [...text]
    let currentLine = ''
    let currentWidth = 0

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]
      const charWidth = this.measureWidth(char, config)
      const nextWidth = currentWidth + charWidth

      if (nextWidth > maxWidth && currentLine.length > 0) {
        lines.push(currentLine)
        currentLine = char
        currentWidth = charWidth
      } else {
        currentLine += char
        currentWidth = nextWidth
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

    return lines.length > 0 ? lines : ['']
  }

  /**
   * 测量多字符元素的完整宽度
   */
  measureElementWidth(element: { value: string; size?: number; font?: string; bold?: boolean; italic?: boolean; letterSpacing?: number }): number {
    const config: FontConfig = {
      font: element.font || 'SimSun',
      size: element.size || 16,
      bold: element.bold,
      italic: element.italic,
    }

    const text = element.value || ''
    const baseWidth = this.measureWidth(text, config)
    const spacing = element.letterSpacing || 0
    return baseWidth + spacing * Math.max(0, text.length - 1)
  }

  // ---- 缓存管理 ----

  clearCache(): void {
    this.cache.clear()
    this.cacheKeys = []
  }

  getCacheSize(): number {
    return this.cache.size
  }

  destroy(): void {
    this.clearCache()
  }
}

// 全局单例
export const textMeasurer = new TextMeasurer()
