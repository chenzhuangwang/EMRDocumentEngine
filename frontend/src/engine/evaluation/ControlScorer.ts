// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlScorer — 控件量表评分 (契约 §12.6.2 layer E)
//
// 只读派生语义: 把选中候选项所携带的 numericValue 汇总成文档级量表分。
//
// 边界 (硬约束, 不得越界):
//   - **不校验、不写入**: 不碰 validateControlValue (layer A/B), 不产生
//     命令, 无 undo 影响。分值是**派生数据**, 不是文档内容, 不序列化。
//   - **不是 QCResult.score**: 那个是合规分 (100 减扣分, qc/QCEngine);
//     两者是不同事实、不同 owner, 不得合并或存进同一字段 (§7.5)。
//   - 纯函数: 无 pool / host / React / 浏览器全局依赖 (§27-§29), 可脱
//     React 测试。
//
// 计分规则:
//   - 空态 (value === undefined) 不计分, 也不报错 —— 未填 ≠ 零分。
//   - 候选项无 numericValue → 该选项贡献 0, 不是错误 ("没有隐式零" 指的是
//     不给它编造分值, 而非拒绝整条记录)。
//   - 选了候选集之外的自由文本值 → 匹配不到选项, 不参与计分。
//   - 整条控件一个可计分选项都没命中 → 计入 uncounted (可从明细里看出
//     是"填了但没配数值", 而非静默当作 0 分)。
// ================================================================

import type { ControlValue, ElementEnumOption } from '../document/core/DocumentModel'

/** 一条待计分控件 —— 由调用方按 §12.6.4 优先级解析好候选集后传入 */
export interface ScorableControl {
  nodeId: string
  /** 控件名 (明细展示用) */
  name: string
  /** 运行时值 (契约 §12.6.1); undefined = 空态 */
  value: ControlValue | undefined
  /**
   * 候选集 —— 调用方按 §12.6.4 解析: inline enums 存在则用 enums.data,
   * 否则用 DictionaryProvider 解析结果。本模块不自行解析候选源。
   */
  candidates: readonly ElementEnumOption[] | undefined
}

export interface ControlScoreItem {
  nodeId: string
  name: string
  /** 命中的候选显示名 (多选按选择序) */
  selected: string[]
  /** 该控件贡献的分值 */
  score: number
}

export interface ScoreResult {
  /** 文档级量表总分 */
  total: number
  /** 逐控件明细 (仅含实际计分的控件) */
  items: ControlScoreItem[]
  /** 有值但无任何候选带 numericValue 的控件数 (填了但不可计分) */
  uncounted: number
  /** 参与计分的控件数 */
  counted: number
}

/**
 * 把 ControlValue 归一为「待匹配的候选 value 字符串列表」。
 * number 走 String() —— 候选 value 恒为字符串 (§12.6.2)。
 */
function selectedValues(value: ControlValue | undefined): string[] {
  if (value === undefined) return []
  if (Array.isArray(value)) return value.filter((v) => v !== '')
  const s = String(value)
  return s === '' ? [] : [s]
}

/**
 * 汇总控件量表分。纯函数, 不抛 —— 输入不完整只影响该条是否计分。
 */
export function scoreControls(controls: readonly ScorableControl[]): ScoreResult {
  const items: ControlScoreItem[] = []
  let total = 0
  let uncounted = 0

  for (const c of controls) {
    const selected = selectedValues(c.value)
    if (selected.length === 0) continue            // 空态: 不计分也不报错
    const candidates = c.candidates
    if (!candidates || candidates.length === 0) continue

    let score = 0
    let hits = 0
    const names: string[] = []
    for (const v of selected) {
      const opt = candidates.find((o) => o.value === v)
      if (!opt) continue                           // 自由文本值: 无候选可匹配
      names.push(opt.name)
      if (typeof opt.numericValue === 'number' && Number.isFinite(opt.numericValue)) {
        score += opt.numericValue
        hits++
      }
    }

    if (hits === 0) { uncounted++; continue }      // 填了但候选项都没配数值
    items.push({ nodeId: c.nodeId, name: c.name, selected: names, score })
    total += score
  }

  return { total, items, uncounted, counted: items.length }
}
