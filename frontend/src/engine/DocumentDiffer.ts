// ============================================================
// DocumentDiffer — 文档比较引擎 (R46, v6.0)
//
// 树形 LCS diff: 段落级 + 文本节点级
// 返回 DiffResult[] 供 DocumentCompareView 消费
// ============================================================

import type { DocumentTree, Paragraph } from './document/core/DocumentModel'
import { NodePool } from './document/core/NodePool'

// ---- 类型 ----

export type DiffOperation = 'insert' | 'delete' | 'modify' | 'equal'

export interface TextChange {
  /** 文本节点 ID */
  nodeId: string
  /** 操作类型 */
  op: 'insert' | 'delete' | 'equal'
  /** 变更文本 */
  text: string
  /** 原文本 (modify 时有值) */
  oldText?: string
}

export interface DiffResult {
  /** 段落 ID (insert 时为 newParaId, delete 时为 oldParaId) */
  paraId: string
  /** 操作类型 */
  op: DiffOperation
  /** 旧文档段落 ID (delete/modify 时存在) */
  oldParaId?: string
  /** 新文档段落 ID (insert/modify 时存在) */
  newParaId?: string
  /** 段落内文本变更列表 (modify 时) */
  textChanges?: TextChange[]
}

// ---- LCS 算法 ----

/** 计算两个序列的最长公共子序列长度矩阵 */
function lcsMatrix<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (eq(a[i - 1], b[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  return dp
}

/** 回溯 LCS 矩阵生成 diff 操作 */
function backtrack<T>(
  dp: number[][], a: T[], b: T[], eq: (x: T, y: T) => boolean,
): { op: 'equal' | 'insert' | 'delete'; aIdx?: number; bIdx?: number }[] {
  const result: { op: 'equal' | 'insert' | 'delete'; aIdx?: number; bIdx?: number }[] = []
  let i = a.length
  let j = b.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && eq(a[i - 1], b[j - 1])) {
      result.unshift({ op: 'equal', aIdx: i - 1, bIdx: j - 1 })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ op: 'insert', bIdx: j - 1 })
      j--
    } else {
      result.unshift({ op: 'delete', aIdx: i - 1 })
      i--
    }
  }

  return result
}

// ---- 段落哈希 (用于快速判断相等) ----

function paraFingerprint(para: Paragraph, pool: NodePool): string {
  const parts: string[] = []
  for (const childId of para.children) {
    const n = pool.nodes.get(childId) as { type?: string; text?: string } | undefined
    if (n?.type === 'text') parts.push(n.text || '')
    else parts.push(`[${childId}]`)
  }
  return parts.join('')
}

function paraEqual(a: Paragraph, poolA: NodePool, b: Paragraph, poolB: NodePool): boolean {
  return paraFingerprint(a, poolA) === paraFingerprint(b, poolB)
}

// ---- 引擎 ----

export class DocumentDiffer {
  /**
   * 比较两份文档
   * @returns DiffResult[] 差异列表
   */
  compare(oldDoc: DocumentTree, oldPool: NodePool, newDoc: DocumentTree, newPool: NodePool): DiffResult[] {
    const oldParas = this.getParagraphs(oldDoc, oldPool)
    const newParas = this.getParagraphs(newDoc, newPool)

    const dp = lcsMatrix(oldParas, newParas, (a, b) => paraEqual(a, oldPool, b, newPool))
    const ops = backtrack(dp, oldParas, newParas, (a, b) => paraEqual(a, oldPool, b, newPool))

    const results: DiffResult[] = []

    for (const o of ops) {
      if (o.op === 'equal') {
        const op = oldParas[o.aIdx!]
        results.push({ paraId: op.id, op: 'equal', oldParaId: op.id, newParaId: op.id })
      } else if (o.op === 'delete') {
        const op = oldParas[o.aIdx!]
        results.push({ paraId: op.id, op: 'delete', oldParaId: op.id })
      } else if (o.op === 'insert') {
        const np = newParas[o.bIdx!]
        results.push({ paraId: np.id, op: 'insert', newParaId: np.id })
      }
    }

    // 对相邻的 delete+insert 检测是否为 modify (内容相近的段落)
    return this.detectModifications(results, oldParas, oldPool, newParas, newPool)
  }

  // ---- 内部 ----

  private getParagraphs(doc: DocumentTree, pool: NodePool): Paragraph[] {
    const paras: Paragraph[] = []
    for (const childId of doc.body.children) {
      const node = pool.nodes.get(childId)
      if (node && (node as { type?: string }).type === 'paragraph') {
        paras.push(node as unknown as Paragraph)
      }
    }
    return paras
  }

  /** 检测 delete+insert 对是否为 modify (内容相似度 > 阈值) */
  private detectModifications(
    results: DiffResult[],
    oldParas: Paragraph[], oldPool: NodePool,
    newParas: Paragraph[], newPool: NodePool,
  ): DiffResult[] {
    const merged: DiffResult[] = []
    let i = 0

    while (i < results.length) {
      const cur = results[i]
      const next = results[i + 1]

      if (cur.op === 'delete' && next?.op === 'insert') {
        const op = oldParas.find(p => p.id === cur.oldParaId)
        const np = newParas.find(p => p.id === next.newParaId)
        if (op && np) {
          const textChanges = this.compareParagraphText(op, oldPool, np, newPool)
          merged.push({
            paraId: np.id,
            op: 'modify',
            oldParaId: op.id,
            newParaId: np.id,
            textChanges,
          })
          i += 2
          continue
        }
      }

      merged.push(cur)
      i++
    }

    return merged
  }

  /** 比较两个段落的文本节点差异 */
  private compareParagraphText(
    oldPara: Paragraph, oldPool: NodePool,
    newPara: Paragraph, newPool: NodePool,
  ): TextChange[] {
    const oldTexts = this.getTextNodes(oldPara, oldPool)
    const newTexts = this.getTextNodes(newPara, newPool)

    const dp = lcsMatrix(oldTexts, newTexts, (a, b) => a.text === b.text)
    const ops = backtrack(dp, oldTexts, newTexts, (a, b) => a.text === b.text)

    const changes: TextChange[] = []
    for (const o of ops) {
      if (o.op === 'equal') {
        changes.push({ nodeId: newTexts[o.bIdx!].id, op: 'equal', text: newTexts[o.bIdx!].text })
      } else if (o.op === 'delete') {
        changes.push({ nodeId: oldTexts[o.aIdx!].id, op: 'delete', text: oldTexts[o.aIdx!].text })
      } else if (o.op === 'insert') {
        changes.push({ nodeId: newTexts[o.bIdx!].id, op: 'insert', text: newTexts[o.bIdx!].text })
      }
    }

    return changes
  }

  private getTextNodes(para: Paragraph, pool: NodePool): { id: string; text: string }[] {
    const nodes: { id: string; text: string }[] = []
    for (const childId of para.children) {
      const n = pool.nodes.get(childId) as { type?: string; text?: string } | undefined
      if (n?.type === 'text') nodes.push({ id: childId, text: n.text || '' })
    }
    return nodes
  }
}
