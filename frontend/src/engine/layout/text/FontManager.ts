// ================================================================
// FontManager — 字体管理器单例 (架构 §3.1, v5.0 / TASK-401)
//
// 职责:
//   - 嵌入式字体注册 / 系统字体查询 / 字体就绪 (经 FontHost 委托, 契约 §27)
//   - 字体变体索引 (family+weight+style → FontVariant)
//   - 字体度量提取 (经 TextHost.getFontMetrics 委托)
//   - ensureReady: 等待字体就绪 (防止布局抖动)
//
// 依赖: FontMetrics 接口定义在 ./FontMetrics.ts; DOM 经 Host 注入
// ================================================================

import type { FontMetrics } from './FontMetrics'
import { scriptResolver } from './ScriptResolver'
import type { EditorHost } from '../../host/EditorHost'

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
  /** 是否已加载完成 */
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
  private host: EditorHost
  private variants = new Map<string, FontVariant>()
  private systemFonts: string[] | null = null

  constructor(host: EditorHost) {
    this.host = host
  }

  // ================================================================
  // 字体注册
  // ================================================================

  /**
   * 注册字体 (经 FontHost.loadFont / TextHost.getFontMetrics 委托, 契约 §27)
   */
  async registerFont(descriptor: FontDescriptor): Promise<void> {
    const key = fontKey(descriptor)
    if (this.variants.has(key)) return

    try {
      const host = this.host
      // 嵌入式字体通过 FontHost 加载; system 字体无需处理
      await host.font.loadFont(descriptor)

      const loaded = descriptor.source === 'system'
        ? host.font.isFontAvailable(descriptor.family, descriptor.weight, descriptor.style)
        : true

      const metrics = host.text.getFontMetrics(descriptor.family, descriptor.weight, descriptor.style)

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
    this.systemFonts = await this.host.font.querySystemFonts()
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
   * 未加载时等待字体就绪 (经 FontHost.onReady 委托)
   */
  async ensureReady(families: string[]): Promise<FontVariant[]> {
    // 等待所有字体就绪
    await this.host.font.onReady()

    const results: FontVariant[] = []
    for (const family of families) {
      const variant = this.getVariant(family)
      if (variant) {
        // 更新 loaded 状态
        if (!variant.loaded) {
          variant.loaded = this.host.font.isFontAvailable(family, 400, 'normal')
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
    await this.host.font.onReady()
    for (const [, variant] of this.variants) {
      if (!variant.loaded) {
        const d = variant.descriptor
        variant.loaded = this.host.font.isFontAvailable(d.family, d.weight, d.style)
      }
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
    this.systemFonts = null
  }
}
