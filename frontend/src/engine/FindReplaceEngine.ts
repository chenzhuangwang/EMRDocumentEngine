// ================================================================
// FindReplaceEngine — 查找替换引擎 (TASK-451, v5.0)
//
// 职责:
//   - findAll: 查找所有匹配项, 返回 MatchResult[]
//   - findNext/findPrevious: 从当前位置向前/向后查找
//   - computeReplacement: 计算单个匹配项的实际替换文本 (纯函数, 不修改文档)
//   - 支持: 正则/大小写/全词匹配
//
// 替换的文档变更改由 ReplaceTextCommand 经 CommandManager 执行 (契约 §5)。
//
// MatchResult 包含段落路径 + 偏移, 可直接用于光标定位和选区高亮
// ================================================================

import type { DocumentTree } from './document/core/DocumentModel'

// ---- 类型 ----

export interface FindOptions {
  /** 是否区分大小写 (默认 true) */
  caseSensitive?: boolean
  /** 是否全词匹配 (仅对英文有效) */
  wholeWord?: boolean
  /** 是否使用正则表达式 */
  useRegex?: boolean
  /** 搜索范围段落 ID 列表 (默认全文档) */
  paragraphIds?: string[]
}

export interface MatchResult {
  /** 段落路径 (ID 链路) */
  paragraphPath: string[]
  /** 在段落内的起始字符偏移 */
  startOffset: number
  /** 在段落内的结束字符偏移 (exclusive) */
  endOffset: number
  /** 匹配的文本 (可能不同于搜索词, 如大小写不敏感时) */
  matchedText: string
  /** 上下文: 匹配项前后各 20 字符 */
  context: string
}

// ---- FindReplaceEngine ----

export class FindReplaceEngine {
  /**
   * 在文档中查找所有匹配项
   */
  findAll(
    query: string,
    doc: DocumentTree,
    pool: { nodes: Map<string, { type: string; text?: string; children?: string[] }> },
    options: FindOptions = {},
  ): MatchResult[] {
    if (!query) return []

    const results: MatchResult[] = []
    const caseSensitive = options.caseSensitive ?? true
    const wholeWord = options.wholeWord ?? false
    const useRegex = options.useRegex ?? false

    const targetIds = options.paragraphIds ?? doc.body.children

    for (const paraId of targetIds) {
      const paraText = this.getParagraphText(paraId, pool)
      if (!paraText) continue

      const matches = this.findInText(query, paraText, { caseSensitive, wholeWord, useRegex })

      for (const m of matches) {
        // 将段落级偏移转换为字符偏移 (考虑列表标记)
        const contextBefore = paraText.slice(Math.max(0, m.start - 20), m.start)
        const contextAfter = paraText.slice(m.end, Math.min(paraText.length, m.end + 20))

        results.push({
          paragraphPath: [doc.id, paraId],
          startOffset: m.start,
          endOffset: m.end,
          matchedText: paraText.slice(m.start, m.end),
          context: `${contextBefore}**${paraText.slice(m.start, m.end)}**${contextAfter}`,
        })
      }
    }

    return results
  }

  /**
   * 从指定位置查找下一个匹配项
   * @returns 第一个匹配项 (在当前光标之后), 无匹配返回 null
   */
  findNext(
    query: string,
    currentPath: string[],
    currentOffset: number,
    doc: DocumentTree,
    pool: { nodes: Map<string, { type: string; text?: string; children?: string[] }> },
    options: FindOptions = {},
  ): MatchResult | null {
    const all = this.findAll(query, doc, pool, options)
    if (all.length === 0) return null

    const currentParaId = currentPath[currentPath.length - 1]

    // 先在同段落后半部分找
    for (const r of all) {
      const rParaId = r.paragraphPath[r.paragraphPath.length - 1]
      if (rParaId === currentParaId && r.startOffset > currentOffset) {
        return r
      }
    }

    // 在后面段落找
    for (const r of all) {
      const rParaId = r.paragraphPath[r.paragraphPath.length - 1]
      if (rParaId !== currentParaId) {
        const bodyIdx = doc.body.children.indexOf(rParaId)
        const curIdx = doc.body.children.indexOf(currentParaId)
        if (bodyIdx > curIdx || (bodyIdx === curIdx && r.startOffset > currentOffset)) {
          return r
        }
      }
    }

    // 回绕到第一个
    return all[0]
  }

  /**
   * 从指定位置查找上一个匹配项
   */
  findPrevious(
    query: string,
    currentPath: string[],
    currentOffset: number,
    doc: DocumentTree,
    pool: { nodes: Map<string, { type: string; text?: string; children?: string[] }> },
    options: FindOptions = {},
  ): MatchResult | null {
    const all = this.findAll(query, doc, pool, options)
    if (all.length === 0) return null

    const currentParaId = currentPath[currentPath.length - 1]

    // 从后往前找
    for (let i = all.length - 1; i >= 0; i--) {
      const r = all[i]
      const rParaId = r.paragraphPath[r.paragraphPath.length - 1]
      if (rParaId === currentParaId && r.endOffset < currentOffset) {
        return r
      }
      const bodyIdx = doc.body.children.indexOf(rParaId)
      const curIdx = doc.body.children.indexOf(currentParaId)
      if (bodyIdx < curIdx) {
        return r
      }
    }

    // 回绕到最后一个
    return all[all.length - 1]
  }

  /**
   * 计算单个匹配项的实际替换文本 (供 ReplaceTextCommand 使用)。
   * 纯函数, 不修改文档:
   *   - 字面替换: 直接返回 replacement
   *   - 正则替换: 对 matchedText 执行 replacement (展开 $n 分组引用)
   */
  computeReplacement(
    query: string,
    matchedText: string,
    replacement: string,
    options: FindOptions = {},
  ): string {
    if (options.useRegex) {
      const caseSensitive = options.caseSensitive ?? true
      const flags = caseSensitive ? 'g' : 'gi'
      const re = new RegExp(query, flags)
      return matchedText.replace(re, replacement)
    }
    return replacement
  }

  /**
   * 高亮所有匹配项 (返回 MatchResult[] 供渲染层绘制)
   */
  highlightAll(
    query: string,
    doc: DocumentTree,
    pool: { nodes: Map<string, { type: string; text?: string; children?: string[] }> },
    options: FindOptions = {},
  ): MatchResult[] {
    return this.findAll(query, doc, pool, options)
  }

  // ---- 内部方法 ----

  /** 获取段落的完整纯文本 */
  private getParagraphText(
    paraId: string,
    pool: { nodes: Map<string, { type: string; text?: string; children?: string[] }> },
  ): string | null {
    const para = pool.nodes.get(paraId)
    if (!para?.children) return null

    const parts: string[] = []
    for (const childId of para.children) {
      const child = pool.nodes.get(childId)
      if (!child) continue
      if (child.type === 'text' || child.type === 'smarttext') {
        parts.push(child.text || '')
      } else {
        parts.push('') // 非文本节点占位
      }
    }

    return parts.join('')
  }

  /** 在纯文本中查找所有匹配 */
  private findInText(
    query: string,
    text: string,
    options: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean },
  ): Array<{ start: number; end: number }> {
    const results: Array<{ start: number; end: number }> = []

    if (options.useRegex) {
      try {
        const flags = options.caseSensitive ? 'g' : 'gi'
        const re = new RegExp(query, flags)
        let match: RegExpExecArray | null
        while ((match = re.exec(text)) !== null) {
          if (this.passesWholeWord(match[0], match.index, text, options.wholeWord)) {
            results.push({ start: match.index, end: match.index + match[0].length })
          }
        }
      } catch {
        // 无效正则 → 当作普通文本搜索
        return this.findInText(escapeRegex(query), text, { ...options, useRegex: false })
      }
    } else {
      const searchText = options.caseSensitive ? text : text.toLowerCase()
      const searchQuery = options.caseSensitive ? query : query.toLowerCase()
      let idx = 0
      while ((idx = searchText.indexOf(searchQuery, idx)) !== -1) {
        if (this.passesWholeWord(text.slice(idx, idx + query.length), idx, text, options.wholeWord)) {
          results.push({ start: idx, end: idx + query.length })
        }
        idx += query.length || 1
      }
    }

    return results
  }

  /** 全词匹配检查 */
  private passesWholeWord(matched: string, start: number, text: string, wholeWord: boolean): boolean {
    if (!wholeWord) return true

    // 仅对包含字母数字的匹配项执行全词检查
    if (!/\w/.test(matched)) return true

    const charBefore = start > 0 ? text[start - 1] : ' '
    const charAfter = start + matched.length < text.length ? text[start + matched.length] : ' '

    const isWordBoundaryBefore = !/\w/.test(charBefore)
    const isWordBoundaryAfter = !/\w/.test(charAfter)

    return isWordBoundaryBefore && isWordBoundaryAfter
  }
}

/** 转义正则特殊字符 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
