// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ScriptResolver — Unicode 脚本检测与字体分配 (架构 §3, v5.0 / TASK-404)
//
// 职责:
//   - detectScript: 使用 Unicode Property Escapes 识别字符所属脚本
//   - resolveScriptRuns: 将文本按脚本拆分为 ScriptRun[]
//   - MultiLangFontConfig: 多语言字体配置
//
// 支持的脚本: Hans(CJK) / Latin / Kana / Hangul / Arabic / Thai / Devanagari
// ================================================================

// ---- Unicode 脚本 ----

export type UnicodeScript = 'Hans' | 'Latin' | 'Kana' | 'Hangul' | 'Arabic' | 'Thai' | 'Devanagari'

// ---- ScriptRun — 使用同一脚本的连续文本段 ----

export interface ScriptRun {
  /** 段落文本 */
  text: string
  /** 识别的脚本 */
  script: UnicodeScript
  /** 推荐字体 */
  font: string
  /** 在原文本中的起始偏移 (字符索引) */
  startIndex: number
  /** 在原文本中的结束偏移 (字符索引, exclusive) */
  endIndex: number
}

// ---- MultiLangFontConfig — 多语言字体配置 ----

export interface MultiLangFontConfig {
  Hans: string
  Latin: string
  Kana: string
  Hangul: string
  Arabic?: string
  Thai?: string
  Devanagari?: string
}

/** 默认多语言字体配置 */
export const DEFAULT_MULTILANG_CONFIG: MultiLangFontConfig = {
  Hans: 'SimSun',
  Latin: 'Times New Roman',
  Kana: 'MS Mincho',
  Hangul: 'Batang',
  Arabic: 'Arial',
  Thai: 'Leelawadee UI',
  Devanagari: 'Mangal',
}

// ---- ScriptResolver ----

export class ScriptResolver {
  private config: MultiLangFontConfig

  constructor(config: MultiLangFontConfig = DEFAULT_MULTILANG_CONFIG) {
    this.config = config
  }

  /**
   * 使用 Unicode Property Escapes (ES2018+) 检测字符所属脚本
   *
   * 规则:
   *   Script=Han → Hans (CJK 统一汉字)
   *   Script=Latin → Latin
   *   Script=Hiragana / Katakana → Kana
   *   Script=Hangul → Hangul
   *   Script=Arabic → Arabic
   *   Script=Thai → Thai
   *   Script=Devanagari → Devanagari
   *   数字/标点/符号 → Latin (作为通用回退, 不是 Hans)
   */
  detectScript(char: string): UnicodeScript {
    // 空白字符归 Latin (中性, 与周围文字合并)
    if (char.trim() === '') return 'Latin'

    try {
      if (/\p{Script=Han}/u.test(char)) return 'Hans'
      if (/\p{Script=Latin}/u.test(char)) return 'Latin'
      if (/\p{Script=Hiragana}/u.test(char) || /\p{Script=Katakana}/u.test(char)) return 'Kana'
      if (/\p{Script=Hangul}/u.test(char)) return 'Hangul'
      if (/\p{Script=Arabic}/u.test(char)) return 'Arabic'
      if (/\p{Script=Thai}/u.test(char)) return 'Thai'
      if (/\p{Script=Devanagari}/u.test(char)) return 'Devanagari'
    } catch {
      // Unicode Property Escapes 不可用时的降级方案
      return this.fallbackDetectScript(char)
    }

    // 数字、标点、符号等 → Latin (与架构一致)
    return 'Latin'
  }

  /**
   * 降级脚本检测 — 手写码点范围 (当 Unicode Property Escapes 不可用时)
   */
  private fallbackDetectScript(char: string): UnicodeScript {
    const cp = char.codePointAt(0) ?? 0

    // CJK 统一汉字基本块 + 扩展
    if ((cp >= 0x4E00 && cp <= 0x9FFF) ||
        (cp >= 0x3400 && cp <= 0x4DBF) ||
        (cp >= 0x20000 && cp <= 0x2A6DF) ||
        (cp >= 0xF900 && cp <= 0xFAFF)) return 'Hans'

    // 平假名 + 片假名
    if ((cp >= 0x3040 && cp <= 0x309F) ||
        (cp >= 0x30A0 && cp <= 0x30FF)) return 'Kana'

    // 韩文
    if ((cp >= 0xAC00 && cp <= 0xD7AF) ||
        (cp >= 0x1100 && cp <= 0x11FF)) return 'Hangul'

    // 阿拉伯文
    if ((cp >= 0x0600 && cp <= 0x06FF) ||
        (cp >= 0x0750 && cp <= 0x077F) ||
        (cp >= 0xFB50 && cp <= 0xFDFF) ||
        (cp >= 0xFE70 && cp <= 0xFEFF)) return 'Arabic'

    // 泰文
    if (cp >= 0x0E00 && cp <= 0x0E7F) return 'Thai'

    // 天城文
    if (cp >= 0x0900 && cp <= 0x097F) return 'Devanagari'

    return 'Latin'
  }

  /**
   * 将文本按脚本拆分为 ScriptRun[]
   *
   * 算法:
   *   1. 逐字符检测脚本
   *   2. 相同脚本 + 相同字体的连续字符合并
   *   3. 空格/标点与相邻脚本合并 (不单独成段)
   *
   * @param text 输入文本
   * @returns ScriptRun[] 按文本顺序排列
   */
  resolveScriptRuns(text: string): ScriptRun[] {
    if (!text) return []

    const chars = [...text]
    if (chars.length === 0) return []

    // 第一步: 逐字符检测脚本
    const charScripts: UnicodeScript[] = chars.map(c => this.detectScript(c))

    // 第二步: 将空格/标点与相邻非 Latin 脚本合并
    // 规则: 如果前后都是同一非 Latin 脚本, 空格/标点归入该脚本
    for (let i = 0; i < chars.length; i++) {
      if (chars[i].trim() === '' || this.isPunctuation(chars[i])) {
        const prevScript = i > 0 ? charScripts[i - 1] : null
        const nextScript = i < chars.length - 1 ? charScripts[i + 1] : null
        if (prevScript && prevScript !== 'Latin' && prevScript === nextScript) {
          charScripts[i] = prevScript
        }
      }
    }

    // 第三步: 合并相同脚本的连续字符
    const runs: ScriptRun[] = []
    let runStart = 0
    let currentScript = charScripts[0]

    for (let i = 1; i < chars.length; i++) {
      if (charScripts[i] !== currentScript) {
        const scriptText = chars.slice(runStart, i).join('')
        const font = this.getScriptFont(currentScript)
        runs.push({
          text: scriptText,
          script: currentScript,
          font,
          startIndex: runStart,
          endIndex: i,
        })
        runStart = i
        currentScript = charScripts[i]
      }
    }

    // 最后一段
    const lastText = chars.slice(runStart).join('')
    const lastFont = this.getScriptFont(currentScript)
    runs.push({
      text: lastText,
      script: currentScript,
      font: lastFont,
      startIndex: runStart,
      endIndex: chars.length,
    })

    return runs
  }

  /** 获取脚本对应的字体, 未配置则返回 Latin 字体 */
  private getScriptFont(script: UnicodeScript): string {
    switch (script) {
      case 'Hans': return this.config.Hans
      case 'Latin': return this.config.Latin
      case 'Kana': return this.config.Kana
      case 'Hangul': return this.config.Hangul
      case 'Arabic': return this.config.Arabic ?? this.config.Latin
      case 'Thai': return this.config.Thai ?? this.config.Latin
      case 'Devanagari': return this.config.Devanagari ?? this.config.Latin
    }
  }
  private isPunctuation(char: string): boolean {
    const cp = char.codePointAt(0) ?? 0
    // CJK 标点
    if (cp >= 0x3000 && cp <= 0x303F) return true  // CJK 符号与标点
    if (cp >= 0xFF00 && cp <= 0xFFEF) return true  // 全角形式
    // ASCII 标点
    if (cp >= 0x2000 && cp <= 0x206F) return true  // 通用标点
    return false
  }

  /** 获取文本的主要脚本 (按字符数最多) */
  getDominantScript(text: string): UnicodeScript {
    const counts = new Map<UnicodeScript, number>()
    for (const char of [...text]) {
      const script = this.detectScript(char)
      counts.set(script, (counts.get(script) ?? 0) + 1)
    }
    let maxScript: UnicodeScript = 'Latin'
    let maxCount = 0
    for (const [script, count] of counts) {
      if (count > maxCount) { maxCount = count; maxScript = script }
    }
    return maxScript
  }

  /** 更新多语言字体配置 */
  updateConfig(config: Partial<MultiLangFontConfig>): void {
    Object.assign(this.config, config)
  }
}

// ---- 全局单例 ----

export const scriptResolver = new ScriptResolver()
