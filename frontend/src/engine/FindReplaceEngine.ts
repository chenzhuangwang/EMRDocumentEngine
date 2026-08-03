// ================================================================
// FindReplaceEngine — 查找替换引擎 (TASK-451, v5.0)
//
// 职责:
//   - findAll: 查找所有匹配项, 返回 MatchResult[]
//   - findNext/findPrevious: 从当前位置向前/向后查找
//   - replace/replaceAll: 替换匹配项
//   - 支持: 正则/大小写/全词匹配
//
// MatchResult 包含段落路径 + 偏移, 可直接用于光标定位和选区高亮
// ================================================================

import type { DocumentTree } from './document/DocumentModel'

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
   * 替换当前匹配项, 返回替换后的新文本
   */
  replace(
    query: string,
    replacement: string,
    result: MatchResult,
    _doc: DocumentTree,
    pool: { nodes: Map<string, { type: string; text?: string; children?: string[] }> },
    options: FindOptions = {},
  ): { paragraphPath: string[]; offset: number } | null {
    const paraId = result.paragraphPath[result.paragraphPath.length - 1]
    const para = pool.nodes.get(paraId)
    if (!para?.children) return null

    // 在段落文本中执行替换
    const paraText = this.getParagraphText(paraId, pool)
    if (!paraText) return null

    const caseSensitive = options.caseSensitive ?? true
    const useRegex = options.useRegex ?? false

    // 在文本节点中定位到 startOffset, 执行替换
    let offset = 0
    for (const childId of para.children) {
      const child = pool.nodes.get(childId)
      if (!child || (child.type !== 'text' && child.type !== 'smarttext')) {
        offset += 1
        continue
      }
      const text = child.text || ''
      const len = text.length

      if (offset + len > result.startOffset) {
        const localStart = result.startOffset - offset
        const localEnd = result.endOffset - offset

        if (useRegex) {
          const re = new RegExp(query, caseSensitive ? 'g' : 'gi')
          child.text = text.slice(0, localStart) +
            text.slice(localStart, localEnd).replace(re, replacement) +
            text.slice(localEnd)
        } else {
          child.text = text.slice(0, localStart) + replacement + text.slice(localEnd)
        }

        return {
          paragraphPath: result.paragraphPath,
          offset: result.startOffset + replacement.length,
        }
      }

      offset += len
    }

    return null
  }

  /**
   * 替换所有匹配项, 返回替换次数
   */
  replaceAll(
    query: string,
    replacement: string,
    doc: DocumentTree,
    pool: { nodes: Map<string, { type: string; text?: string; children?: string[] }> },
    options: FindOptions = {},
  ): number {
    const results = this.findAll(query, doc, pool, options)
    if (results.length === 0) return 0

    // 从后往前替换 (避免偏移失效)
    let count = 0
    for (let i = results.length - 1; i >= 0; i--) {
      const r = results[i]
      // 更新 startOffset 以匹配已有替换后的文本
      const adjustedResult = count > 0
        ? { ...r, startOffset: r.startOffset, endOffset: r.endOffset }
        : r

      const replaced = this.replace(query, replacement, adjustedResult, doc, pool, options)
      if (replaced) count++
    }

    return count
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
