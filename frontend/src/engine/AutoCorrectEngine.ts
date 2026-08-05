// ============================================================
// AutoCorrectEngine — 自动更正引擎 (R43, v6.0)
//
// 可配置词库 + 输入后触发匹配 → 自动替换
// 例如: "i.v.g.t.t." → "静脉滴注"
// ============================================================

export interface AutoCorrectRule {
  /** 触发模式 (支持正则字符串或简单文本) */
  pattern: string
  /** 替换文本 */
  replacement: string
  /** 是否区分大小写 */
  caseSensitive?: boolean
  /** 是否全词匹配 (前后须有空白/标点/行边界) */
  wholeWord?: boolean
}

// ---- 默认医学词库 ----

const DEFAULT_RULES: AutoCorrectRule[] = [
  // 静脉给药
  { pattern: 'i\\.v\\.g\\.t\\.t\\.', replacement: '静脉滴注', wholeWord: true },
  { pattern: 'i\\.v\\.', replacement: '静脉注射', wholeWord: true },
  { pattern: 'i\\.m\\.', replacement: '肌肉注射', wholeWord: true },
  { pattern: 'i\\.h\\.', replacement: '皮下注射', wholeWord: true },
  { pattern: 'p\\.o\\.', replacement: '口服', wholeWord: true },
  // 频率
  { pattern: 'q\\.d\\.', replacement: '每日1次', wholeWord: true },
  { pattern: 'b\\.i\\.d\\.', replacement: '每日2次', wholeWord: true },
  { pattern: 't\\.i\\.d\\.', replacement: '每日3次', wholeWord: true },
  { pattern: 'q\\.i\\.d\\.', replacement: '每日4次', wholeWord: true },
  { pattern: 'q\\.o\\.d\\.', replacement: '隔日1次', wholeWord: true },
  { pattern: 'q\\.w\\.', replacement: '每周1次', wholeWord: true },
  // 单位
  { pattern: 'q\\.n\\.', replacement: '每晚', wholeWord: true },
  { pattern: 'q\\.m\\.', replacement: '每晨', wholeWord: true },
  { pattern: 'p\\.r\\.n\\.', replacement: '必要时', wholeWord: true },
  { pattern: 's\\.o\\.s\\.', replacement: '需要时(限用1次)', wholeWord: true },
  { pattern: 's\\.t\\.', replacement: '立即', wholeWord: true },
  // 常见缩写
  { pattern: 'Bp', replacement: '血压', wholeWord: true, caseSensitive: true },
  { pattern: 'HR', replacement: '心率', wholeWord: true, caseSensitive: true },
  { pattern: 'RR', replacement: '呼吸频率', wholeWord: true, caseSensitive: true },
  { pattern: 'T', replacement: '体温', wholeWord: true, caseSensitive: true },
  { pattern: 'SpO2', replacement: '血氧饱和度', wholeWord: true, caseSensitive: true },
  { pattern: 'WBC', replacement: '白细胞计数', wholeWord: true, caseSensitive: true },
  { pattern: 'RBC', replacement: '红细胞计数', wholeWord: true, caseSensitive: true },
  { pattern: 'Hb', replacement: '血红蛋白', wholeWord: true, caseSensitive: true },
  { pattern: 'PLT', replacement: '血小板计数', wholeWord: true, caseSensitive: true },
]

// ---- 引擎 ----

export class AutoCorrectEngine {
  private rules: AutoCorrectRule[] = []
  private compiled: { regex: RegExp; replacement: string }[] = []

  constructor(rules?: AutoCorrectRule[]) {
    this.setRules(rules || DEFAULT_RULES)
  }

  /** 设置规则 (替换全部) */
  setRules(rules: AutoCorrectRule[]): void {
    this.rules = rules
    this.compile()
  }

  /** 追加规则 */
  addRule(rule: AutoCorrectRule): void {
    this.rules.push(rule)
    this.compile()
  }

  /** 获取当前规则 */
  getRules(): AutoCorrectRule[] { return [...this.rules] }

  /**
   * 检查文本中是否包含可自动更正的匹配项
   * 返回替换结果: { corrected, changed }
   */
  check(text: string): { corrected: string; changed: boolean } {
    let result = text
    let changed = false

    for (const { regex, replacement } of this.compiled) {
      const prev = result
      result = result.replace(regex, (_match, ..._groups) => {
        changed = true
        return replacement
      })
      if (result !== prev && changed) break  // 一次只替换一处
    }

    return { corrected: result, changed }
  }

  /**
   * 检查光标前最近输入的词是否需要自动更正
   * 在 IME compositionend / 空格 / 标点后调用
   *
   * @param fullText 段落完整文本
   * @param cursorOffset 光标偏移
   * @returns 替换信息: { replacement, start, end } 或 null
   */
  checkAtCursor(
    fullText: string,
    cursorOffset: number,
  ): { replacement: string; start: number; end: number } | null {
    // 光标前最近一个"词" (空白/标点分隔)
    const before = fullText.slice(0, cursorOffset)
    const wordMatch = before.match(/(\S+)$/)
    if (!wordMatch || !wordMatch[1]) return null

    const word = wordMatch[1]
    const wordStart = cursorOffset - word.length

    for (const { regex, replacement } of this.compiled) {
      // 锚定到词尾
      const anchored = new RegExp(regex.source + '$', regex.flags)
      const m = word.match(anchored)
      if (m) {
        return { replacement, start: wordStart + (m.index || 0), end: cursorOffset }
      }
    }

    return null
  }

  // ---- 内部 ----

  private compile(): void {
    this.compiled = this.rules.map(r => {
      let pattern = r.pattern
      if (r.wholeWord) {
        // 全词匹配: 前边界(空白/标点/行首), 后边界(空白/标点/行尾)
        pattern = `(?<=^|[\\s.,;:!?()\\[\\]{}])${pattern}(?=[\\s.,;:!?()\\[\\]{}]|$)`
      }
      let flags = 'g'
      if (!r.caseSensitive) flags += 'i'
      return { regex: new RegExp(pattern, flags), replacement: r.replacement }
    })
  }
}
