// ================================================================
// FontFallback — 字体降级引擎 (架构 §3, v5.0 / TASK-402)
//
// 职责:
//   - detectMissingGlyphs: 检测文本中在指定字体下缺少的字形
//   - resolveFallbackFonts: 分配字体降级链 → FontRun[]
//   - 降级链: 主字体 → CJK 降级 → Latin 降级 → 通用 fallback
//
// 使用 document.fonts.check() (FontFaceSet API) 做缺字检测
// ================================================================

// ---- FontRun — 使用同一字体的连续文本段 ----

export interface FontRun {
  /** 字体族名 */
  font: string
  /** 该段的文本 */
  text: string
  /** 在原文本中的起始偏移 (字符索引) */
  startIndex: number
  /** 在原文本中的结束偏移 (字符索引, exclusive) */
  endIndex: number
}

// ---- FallbackChain — 降级链配置 ----

export interface FallbackChainConfig {
  /** 主字体 */
  primary: string
  /** 降级字体列表 (按优先级从高到低) */
  fallbacks: string[]
}

// ---- 预定义降级链 ----

/** CJK 简体中文降级链 */
export const CJK_FALLBACK_CHAIN: FallbackChainConfig = {
  primary: 'SimSun',
  fallbacks: [
    'Microsoft YaHei',
    'PingFang SC',
    'Noto Sans CJK SC',
    'SimHei',
    'KaiTi',
    'FangSong',
    'Arial',
    'sans-serif',
  ],
}

/** CJK 日文降级链 */
export const JAPANESE_FALLBACK_CHAIN: FallbackChainConfig = {
  primary: 'MS Mincho',
  fallbacks: [
    'Hiragino Mincho ProN',
    'Yu Mincho',
    'Noto Serif CJK JP',
    'SimSun',
    'Arial',
    'sans-serif',
  ],
}

/** CJK 韩文降级链 */
export const KOREAN_FALLBACK_CHAIN: FallbackChainConfig = {
  primary: 'Batang',
  fallbacks: [
    'Malgun Gothic',
    'Noto Sans CJK KR',
    'Gulim',
    'Arial',
    'sans-serif',
  ],
}

/** Latin 降级链 */
export const LATIN_FALLBACK_CHAIN: FallbackChainConfig = {
  primary: 'Times New Roman',
  fallbacks: [
    'Georgia',
    'Arial',
    'sans-serif',
  ],
}

// ---- FontFallback 引擎 ----

export class FontFallback {
  /**
   * 检测文本中在指定字体下缺少字形的字符
   *
   * 使用 document.fonts.check(font, char) API:
   *   - 浏览器原生 FontFaceSet 检查
   *   - 逐个字符检查 (去重后)
   */
  detectMissingGlyphs(text: string, family: string): Set<string> {
    const missing = new Set<string>()

    // jsdom / 无 FontFaceSet 环境: 无法检测, 视为全部存在 (降级为默认字体渲染)
    if (!document.fonts || typeof document.fonts.check !== 'function') {
      return missing
    }

    const uniqueChars = new Set([...text])

    // 构建字体描述字符串
    const fontSpec = `12px "${family}"`

    for (const char of uniqueChars) {
      // 空格/换行/制表符等空白字符总是"存在"
      if (char.trim() === '' || char === '​') continue

      if (!document.fonts.check(fontSpec, char)) {
        missing.add(char)
      }
    }

    return missing
  }

  /**
   * 解析降级字体分配 — 将文本拆分为 FontRun[]
   *
   * 算法:
   *   1. 检测主字体下缺失的字符
   *   2. 为缺失字符按降级链逐级尝试
   *   3. 将使用相同字体的连续字符合并为一个 FontRun
   *
   * @param text 原始文本
   * @param chain 降级链配置
   * @returns FontRun[] 按文本顺序排列
   */
  resolveFallbackFonts(text: string, chain: FallbackChainConfig): FontRun[] {
    if (!text) return []

    const chars = [...text]
    if (chars.length === 0) return []

    // Step 1: 确定每个字符应使用的最佳字体
    const charFontMap = new Map<number, string>() // index → font

    // 先检查主字体缺失哪些字符
    const missingInPrimary = this.detectMissingGlyphs(text, chain.primary)

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]

      // 空白字符直接用主字体
      if (char.trim() === '' || char === '​') {
        charFontMap.set(i, chain.primary)
        continue
      }

      if (missingInPrimary.has(char)) {
        // 按降级链逐级尝试
        let resolved = false
        for (const fallbackFont of chain.fallbacks) {
          if (!this.detectMissingGlyphs(char, fallbackFont).has(char)) {
            charFontMap.set(i, fallbackFont)
            resolved = true
            break
          }
        }
        // 所有降级字体都不支持 → 使用主字体 (显示方框比显示空白好)
        if (!resolved) {
          charFontMap.set(i, chain.primary)
        }
      } else {
        charFontMap.set(i, chain.primary)
      }
    }

    // Step 2: 合并使用相同字体的连续字符为 FontRun
    const runs: FontRun[] = []
    let runStart = 0
    let currentFont = charFontMap.get(0)!

    for (let i = 1; i < chars.length; i++) {
      const font = charFontMap.get(i)!
      if (font !== currentFont) {
        runs.push({
          font: currentFont,
          text: chars.slice(runStart, i).join(''),
          startIndex: runStart,
          endIndex: i,
        })
        runStart = i
        currentFont = font
      }
    }

    // 最后一段
    runs.push({
      font: currentFont,
      text: chars.slice(runStart).join(''),
      startIndex: runStart,
      endIndex: chars.length,
    })

    return runs
  }

  /**
   * 简单检测: 单个字符在指定字体下是否可用
   */
  isCharAvailable(char: string, family: string): boolean {
    if (char.trim() === '') return true
    return document.fonts.check(`12px "${family}"`, char)
  }

  /**
   * 获取文本中缺失字符的降级字体映射
   * @returns Map<char, fallbackFont> 仅包含缺失字符
   */
  getFallbackMap(text: string, primary: string, fallbacks: string[]): Map<string, string> {
    const missing = this.detectMissingGlyphs(text, primary)
    const map = new Map<string, string>()

    for (const char of missing) {
      for (const fallback of fallbacks) {
        if (!this.detectMissingGlyphs(char, fallback).has(char)) {
          map.set(char, fallback)
          break
        }
      }
      // 所有 fallback 都不支持 → 不添加映射 (让渲染层决定)
    }

    return map
  }
}
