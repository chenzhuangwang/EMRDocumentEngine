// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// QCEngine — 医学文书质控引擎 (R52, v6.0)
//
// 检查: 必填字段 / 值域校验 / 逻辑一致性 / 完整性
// 返回 QCResult[] 供 QCResultPanel 消费
// ============================================================

import type { DocumentTree, SmartTextNode } from '../document/core/DocumentModel'
import { NodeType } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import { isControlValueComplete } from '../document/control/ControlValue'
import { hfContainers } from '../document/core/HeaderFooterRegions'

// ---- 类型 ----

export type QCSeverity = 'error' | 'warning' | 'info'

export interface QCRule {
  id: string
  name: string
  description: string
  severity: QCSeverity
  /** JSONLogic 表达式 (简化版: 仅支持 field_exists/value_in_range/required_not_empty) */
  check: string
}

export interface QCIssue {
  ruleId: string
  ruleName: string
  severity: QCSeverity
  /** 问题描述 */
  message: string
  /** 定位信息: nodeId */
  nodeId?: string
  /** 定位信息: 段落路径 */
  paragraphPath?: string[]
}

/**
 * 规则求值的不通过结果 (契约 §12.2)。能定位的规则必须填 nodeId/paragraphPath
 * —— 面板的「点击问题 → 跳转」依赖它; 文档级规则 (标题/字数/段落数) 无具体
 * 位置, 返回空对象是有意的, 不是漏填。
 */
export interface QCIssueLocation {
  nodeId?: string
  paragraphPath?: string[]
}

export interface QCResult {
  documentId: string
  /** 总评分 (0-100) */
  score: number
  /** 等级 A/B/C/D */
  grade: QCGrade
  /** 问题列表 */
  issues: QCIssue[]
  /** 统计 */
  stats: { errors: number; warnings: number; infos: number }
  /** 检查时间 */
  checkedAt: number
}

export type QCGrade = 'A' | 'B' | 'C' | 'D'

// ---- 内置规则 ----

const BUILTIN_RULES: QCRule[] = [
  {
    id: 'qc_001', name: '文档标题不为空', severity: 'error',
    description: '文档必须包含标题',
    check: 'required_not_empty:title',
  },
  {
    id: 'qc_002', name: '文档包含正文内容', severity: 'error',
    description: '文档 body 至少包含一个段落',
    check: 'field_exists:body.children',
  },
  {
    id: 'qc_003', name: '段落不包含连续空白段', severity: 'warning',
    description: '不应有连续两个空段落 (范围: 正文 + 页眉/页脚各变体, 逐容器独立判定)',
    check: 'no_consecutive_empty_paragraphs',
  },
  {
    id: 'qc_004', name: 'SmartText 必填字段校验', severity: 'warning',
    description: '标记为 required 的 SmartTextNode 不能为空',
    check: 'smarttext_required_not_empty',
  },
  {
    id: 'qc_005', name: '文档字数不低于最低阈值', severity: 'info',
    description: '文档正文至少包含 10 个字符',
    check: 'min_chars:10',
  },
  {
    id: 'qc_006', name: '段落数量合理', severity: 'info',
    description: '段落数应在 1-500 之间',
    check: 'paragraph_count:1:500',
  },
]

// ---- 评分器 ----

function computeGrade(score: number): QCGrade {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  return 'D'
}

// ---- 引擎 ----

export class QCEngine {
  private rules: QCRule[] = []

  constructor(customRules?: QCRule[]) {
    this.rules = [...BUILTIN_RULES, ...(customRules || [])]
  }

  /**
   * 执行质控检查
   * @param doc 文档树
   * @param pool 节点池
   * @param options 选项 (防抖时间等)
   */
  check(doc: DocumentTree, pool: NodePool, _options?: { timeout?: number }): QCResult {
    const issues: QCIssue[] = []
    // 定位索引一次构建, 供各规则共用 (避免逐规则全池扫描)
    const paraOf = this.buildParagraphIndex(doc, pool)

    for (const rule of this.rules) {
      const result = this.evaluateRule(rule, doc, pool, paraOf)
      if (result) issues.push(result)
    }

    // 计分
    const errors = issues.filter(i => i.severity === 'error').length
    const warnings = issues.filter(i => i.severity === 'warning').length
    const infos = issues.filter(i => i.severity === 'info').length

    // 简单扣分: error -15, warning -5, info -2
    let score = 100
    score -= errors * 15
    score -= warnings * 5
    score -= infos * 2
    score = Math.max(0, Math.min(100, score))

    return {
      documentId: doc.id,
      score,
      grade: computeGrade(score),
      issues,
      stats: { errors, warnings, infos },
      checkedAt: Date.now(),
    }
  }

  /** 获取规则列表 */
  getRules(): QCRule[] { return [...this.rules] }

  // ---- 内部 ----

  private evaluateRule(
    rule: QCRule, doc: DocumentTree, pool: NodePool, paraOf: ReadonlyMap<string, string>,
  ): QCIssue | null {
    const fail = this.execCheck(rule.check, doc, pool, paraOf)
    if (!fail) return null

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      message: rule.description,
      ...fail,
    }
  }

  /**
   * 子节点 id → 所属段落 id —— 供问题定位 (契约 §12.2: 问题条目必须能跳转)。
   * 一次构建供各规则共用; 下钻块级容器 (table → row → cell → paragraph) 与
   * 页眉/页脚各变体 (§7.9)。
   */
  private buildParagraphIndex(doc: DocumentTree, pool: NodePool): Map<string, string> {
    const map = new Map<string, string>()
    const visit = (ids: readonly string[]): void => {
      for (const id of ids) {
        const node = pool.nodes.get(id) as { type?: string; children?: readonly string[] } | undefined
        if (!node?.children) continue
        if (node.type === NodeType.PARAGRAPH) {
          map.set(id, id)
          for (const cid of node.children) map.set(cid, id)
        } else {
          visit(node.children)
        }
      }
    }
    visit(doc.body.children)
    for (const band of hfContainers(doc)) visit(band)
    return map
  }

  /**
   * 求值一条规则。**null = 通过**, 返回对象 = 不通过 (并尽量带定位)。
   *
   * 定位不是装饰: 面板的「点击问题 → 跳到位置」全靠它。文档级规则
   * (标题/正文存在/字数/段落数) 无具体位置, 返回空对象 —— 这是有意的,
   * 不是忘了填。
   */
  private execCheck(
    expr: string, doc: DocumentTree, pool: NodePool, paraOf: ReadonlyMap<string, string>,
  ): QCIssueLocation | null {
    const [func, ...args] = expr.split(':')

    switch (func) {
      case 'required_not_empty': {
        const field = args[0]
        if (field === 'title') {
          return (doc as unknown as Record<string, unknown>)[field] ? null : {}
        }
        return null
      }
      case 'field_exists': {
        const path = args[0]?.split('.') || []
        let val: unknown = doc
        for (const key of path) {
          if (val && typeof val === 'object') val = (val as Record<string, unknown>)[key]
          else return {}
        }
        return (Array.isArray(val) ? val.length > 0 : !!val) ? null : {}
      }
      case 'no_consecutive_empty_paragraphs': {
        // 覆盖正文 + 页眉/页脚全部变体 (契约 §7.9); lastEmpty 按容器重置
        // (尾部空页眉段不得与正文首个空段配对)。
        for (const container of [doc.body.children, ...hfContainers(doc)]) {
          let lastEmpty = false
          for (const childId of container) {
            const node = pool.nodes.get(childId) as { type?: string; children?: readonly string[] } | undefined
            // 非段落块 (表格/图片/分隔线…) 不算空段落, 也不与空段落构成"连续空段"
            if (node?.type !== NodeType.PARAGRAPH) { lastEmpty = false; continue }
            const para = node as unknown as { children?: readonly string[] }
            const isEmpty = !para.children || para.children.length === 0 ||
              para.children.every(cid => {
                const n = pool.nodes.get(cid) as { text?: string } | undefined
                return !n?.text
              })
            // 报后一个空段 (用户看到"多余的那一个")
            if (isEmpty && lastEmpty) return { paragraphPath: [doc.id, childId] }
            lastEmpty = isEmpty
          }
        }
        return null
      }
      case 'smarttext_required_not_empty': {
        for (const [, node] of pool.nodes) {
          if (node.type !== NodeType.SMART_TEXT) continue
          const st = node as SmartTextNode
          if (isControlValueComplete(st.value, st.element)) continue
          const paraId = paraOf.get(st.id)
          return paraId
            ? { nodeId: st.id, paragraphPath: [doc.id, paraId] }
            : { nodeId: st.id }
        }
        return null
      }
      case 'min_chars': {
        const min = parseInt(args[0], 10) || 0
        let count = 0
        for (const childId of doc.body.children) {
          const para = pool.nodes.get(childId) as { children?: readonly string[] } | undefined
          if (para?.children) {
            for (const cid of para.children) {
              const n = pool.nodes.get(cid) as { text?: string } | undefined
              if (n?.text) count += [...n.text].length
            }
          }
        }
        return count >= min ? null : {}
      }
      case 'paragraph_count': {
        const min = parseInt(args[0], 10) || 1
        const max = parseInt(args[1], 10) || 500
        const count = doc.body.children.length
        return count >= min && count <= max ? null : {}
      }
      default:
        return null // 未知规则不报错
    }
  }
}
