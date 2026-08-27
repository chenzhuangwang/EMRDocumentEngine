// ================================================================
// FontManager — 字体管理器单例 (架构 §3.1, v5.0 / TASK-401)
//
// 职责:
//   - 嵌入式字体注册 (FontFace API)
//   - 系统字体查询 (queryLocalFonts)
//   - 字体变体索引 (family+weight+style → FontVariant)
//   - 字体度量提取 (Canvas 启发式 + 预留 opentype.js 精确解析)
//   - ensureReady: 等待字体就绪 (防止布局抖动)
//
// 依赖: FontMetrics 接口定义在 ./FontMetrics.ts
// ================================================================

import type { FontMetrics } from './FontMetrics'
import { scriptResolver } from './ScriptResolver'

// ---- FontDescriptor ----

export interface FontDescriptor {
  /** 字体家族名 (如 'SimSun', 'Arial') */
  family: string
  /** 字重 (400=normal, 700=bold) */
  weight: number
  /** 样式 */
  style: 'normal' | 'italic'
  /** 字体来源 */
  source: 'system' | 'embedded' | 'url'
  /** 嵌入式字体的 URL (source='url' 时) */
  url?: string
}

// ---- FontVariant ----

export interface FontVariant {
  descriptor: FontDescriptor
  /** 是否已加载完成 (FontFace.loaded) */
  loaded: boolean
  /** 字体度量数据 (加载后填充, upem=1000) */
  metrics: FontMetrics | null
}

// ---- 工具函数 ----

/** 生成字体变体索引键 */
export function fontKey(d: Pick<FontDescriptor, 'family' | 'weight' | 'style'>): string {
  return `${d.family}|${d.weight}|${d.style}`
}

/** 候选 weight 列表: 精确 → 相近 → 最远, 用于系统字体查找 */
function candidateWeights(target: number): number[] {
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900]
  const sorted = [...weights].sort((a, b) => Math.abs(a - target) - Math.abs(b - target))
  return sorted
}

// ---- FontManager ----

export class FontManager {
  private variants = new Map<string, FontVariant>()
  private loadingPromises = new Map<string, Promise<FontFace[]>>()
  private systemFonts: string[] | null = null

  /** 度量提取用的离屏 Canvas (复用) */
  private measureCanvas: HTMLCanvasElement | null = null
  private measureCtx: CanvasRenderingContext2D | null = null

  private getMeasureContext(): CanvasRenderingContext2D {
    if (!this.measureCanvas) {
      this.measureCanvas = document.createElement('canvas')
      this.measureCtx = this.measureCanvas.getContext('2d')!
    }
    return this.measureCtx!
  }

  // ================================================================
  // 字体注册
  // ================================================================

  /**
   * 注册嵌入式字体 (CSS @font-face 等价)
   * 使用 FontFace API 加载字体文件 → 添加到 document.fonts
   */
  async registerFont(descriptor: FontDescriptor): Promise<void> {
    const key = fontKey(descriptor)
    if (this.variants.has(key)) return

    try {
      if (descriptor.source === 'url' && descriptor.url) {
        // 嵌入式字体: FontFace API 加载
        const fontFace = new FontFace(descriptor.family, `url(${descriptor.url})`, {
          weight: String(descriptor.weight),
          style: descriptor.style,
        })
        await fontFace.load()
        document.fonts.add(fontFace)
      }
      // system 字体: 无需加载, 直接从 document.fonts.check 验证

      const loaded = descriptor.source === 'system'
        ? document.fonts.check(`${descriptor.style} ${descriptor.weight} 16px "${descriptor.family}"`)
        : true

      const metrics = this.extractMetricsCanvas(descriptor.family, descriptor.weight, descriptor.style)

      this.variants.set(key, {
        descriptor,
        loaded,
        metrics,
      })
    } catch (err) {
      console.warn(`[FontManager] Failed to register font: ${fontKey(descriptor)}`, err)
      // 注册失败标记为未加载, 允许后续重试
      this.variants.set(key, {
        descriptor,
        loaded: false,
        metrics: null,
      })
    }
  }

  /**
   * 批量注册 (页面初始化时调用)
   * 并行加载, 单字体失败不阻塞其他字体
   */
  async registerAll(fonts: FontDescriptor[]): Promise<void> {
    const results = await Promise.allSettled(fonts.map(f => this.registerFont(f)))
    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length > 0) {
      console.warn(`[FontManager] ${failed.length}/${fonts.length} fonts failed to load`)
    }
  }

  // ================================================================
  // 字体查询
  // ================================================================

  /**
   * 获取字体变体
   * 查找优先级: 已注册变体 → candidateWeights 近似匹配
   */
  getVariant(family: string, weight = 400, style: 'normal' | 'italic' = 'normal'): FontVariant | null {
    // 1. 精确匹配
    const exactKey = fontKey({ family, weight, style })
    if (this.variants.has(exactKey)) return this.variants.get(exactKey)!

    // 2. 近似 weight 匹配
    for (const w of candidateWeights(weight)) {
      const k = fontKey({ family, weight: w, style })
      if (this.variants.has(k)) return this.variants.get(k)!
    }

    return null
  }

  /** 检查指定字体是否已注册 */
  hasFont(family: string): boolean {
    for (const [key] of this.variants) {
      if (key.startsWith(`${family}|`)) return true
    }
    return false
  }

  /** 获取已注册字体的度量数据 */
  getMetrics(family: string, weight = 400, style: 'normal' | 'italic' = 'normal'): FontMetrics | null {
    const variant = this.getVariant(family, weight, style)
    return variant?.metrics ?? null
  }

  // ================================================================
  // 系统字体
  // ================================================================

  /** 查询系统可用字体列表 */
  async querySystemFonts(): Promise<string[]> {
    if (this.systemFonts) return this.systemFonts

    // Chrome 103+ 支持 queryLocalFonts API
    if ('queryLocalFonts' in window) {
      try {
        const fonts = await (window as unknown as Record<string, unknown>).queryLocalFonts as
          (() => Promise<Array<{ family: string }>>) | undefined
        if (fonts) {
          const result = await fonts()
          this.systemFonts = [...new Set(result.map(f => f.family))]
          return this.systemFonts
        }
      } catch {
        // 权限拒绝, 使用降级列表
      }
    }

    // 降级: 常见中文字体列表
    this.systemFonts = [
      'SimSun', 'SimHei', 'Microsoft YaHei', 'FangSong', 'KaiTi',
      'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC',
      'Arial', 'Times New Roman', 'Courier New',
    ]
    return this.systemFonts
  }

  /**
   * 根据文本内容解析脚本 → 选择最佳匹配字体
   * 利用 ScriptResolver 检测 Unicode 脚本, 映射到已注册字体
   */
  resolveFontForText(text: string, defaultFont: string = 'SimSun'): string {
    const runs = scriptResolver.resolveScriptRuns(text)
    if (runs.length === 0) return defaultFont

    // 查询脚本对应的首选字体, 优先使用已注册字体
    for (const run of runs) {
      const fontFamily = run.font
      if (fontFamily && this.isRegistered(fontFamily)) return fontFamily
    }

    return defaultFont
  }

  /**
   * 检查字体是否已注册
   */
  isRegistered(family: string): boolean {
    return this.variants.has(`${family}|400|normal`)
  }

  // ================================================================
  // 字体就绪
  // ================================================================

  /**
   * 确保指定字体已加载并可用
   * 未加载时等待 document.fonts.ready
   */
  async ensureReady(families: string[]): Promise<FontVariant[]> {
    // 等待所有 document.fonts 就绪
    await document.fonts.ready

    const results: FontVariant[] = []
    for (const family of families) {
      const variant = this.getVariant(family)
      if (variant) {
        // 更新 loaded 状态
        if (!variant.loaded) {
          variant.loaded = document.fonts.check(`normal 400 16px "${family}"`)
        }
        results.push(variant)
      }
    }
    return results
  }

  /**
   * 等待所有已注册字体就绪
   * 用于: Editor 构造完成后 → 确保核心字体可用 → 开始首帧渲染
   */
  async waitForAllReady(): Promise<void> {
    await document.fonts.ready
    for (const [, variant] of this.variants) {
      if (!variant.loaded) {
        const d = variant.descriptor
        variant.loaded = document.fonts.check(`${d.style} ${d.weight} 16px "${d.family}"`)
      }
    }
  }

  // ================================================================
  // 度量提取 (Canvas 启发式 — MVP; 预留 opentype.js 精确解析)
  // ================================================================

  /**
   * 从 Canvas 提取字体度量 (启发式, upem=1000 归一化)
   *
   * TODO (TASK-403 L2): 集成 opentype.js 解析 hhea/OS2 表,
   *   替换 Canvas 启发式, 实现跨平台一致度量
   */
  private extractMetricsCanvas(family: string, weight: number, style: string): FontMetrics {
    const ctx = this.getMeasureContext()
    const fontSize = 100 // 使用 100px 减少浮点误差
    const fontStr = `${style} ${weight} ${fontSize}px "${family}", serif`

    ctx.font = fontStr

    // 测量全角/半角字符宽度
    const fullWidth = ctx.measureText('中').width / fontSize * 1000
    const halfWidth = ctx.measureText('a').width / fontSize * 1000

    // ascent/descent 通过 textBaseline 推算
    // TextMetrics 不直接暴露 ascent/descent (仅 Chrome 有实验性属性)
    const tm = ctx.measureText('M')
    const extended = tm as TextMetrics & {
      fontBoundingBoxAscent?: number
      fontBoundingBoxDescent?: number
      actualBoundingBoxAscent?: number
      actualBoundingBoxDescent?: number
    }

    // 优先使用 fontBoundingBox (Chrome 99+), 降级使用 actualBoundingBox
    let ascent = extended.fontBoundingBoxAscent ?? extended.actualBoundingBoxAscent ?? fontSize * 0.8
    let descent = extended.fontBoundingBoxDescent ?? extended.actualBoundingBoxDescent ?? fontSize * 0.2

    // 归一化到 upem=1000
    ascent = (ascent / fontSize) * 1000
    descent = (descent / fontSize) * 1000

    // lineGap: 通过行高反推
    // 在不支持 fontBoundingBox 的浏览器, 使用启发式估算
    const lineGap = extended.fontBoundingBoxAscent !== undefined
      ? 0 // fontBoundingBox 已经包含 line gap
      : 200 // 默认启发式

    return {
      ascent: Math.round(ascent),
      descent: Math.round(-descent), // 存储为负值, 与 CSS 约定一致
      lineGap,
      capHeight: Math.round(fullWidth * 0.662), // 大写字母约 66.2% 全角
      xHeight: Math.round(fullWidth * 0.458),   // x 高度约 45.8% 全角
      fullWidthAdvance: Math.round(fullWidth),
      halfWidthAdvance: Math.round(halfWidth),
    }
  }

  // ================================================================
  // 生命周期
  // ================================================================

  /** 获取所有已注册字体族名 */
  getRegisteredFamilies(): string[] {
    const families = new Set<string>()
    for (const [, v] of this.variants) {
      families.add(v.descriptor.family)
    }
    return [...families]
  }

  dispose(): void {
    this.variants.clear()
    this.loadingPromises.clear()
    this.systemFonts = null
    this.measureCanvas = null
    this.measureCtx = null
  }
}

// ---- 全局单例 ----

export const fontManager = new FontManager()
