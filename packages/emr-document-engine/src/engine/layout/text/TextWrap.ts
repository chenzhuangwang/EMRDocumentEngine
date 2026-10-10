// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// TextWrap — 控件(textarea)文本折行纯函数 (契约 §12.6 多行文本域)
//
// wrapControlText(text, wrapAt, measureWidth) → string[]
//   - 先按 '\n' 拆「逻辑行」;
//   - wrapAt == null 或逻辑行宽 ≤ wrapAt → 原样保留(含空串行 → ['']);
//   - 超过 wrapAt 的逻辑行按「逐字符累计宽」软折成多物理行(与引擎
//     paragraph 现有 wordBreak 'break-all' 行为一致; 缺字宽度走 measure)。
//
// 空串语义: text==='' → [''](1 空物理行, 占一行高度)。
// 纯函数、可脱离 DOM 单测。
// ================================================================

export function wrapControlText(
  text: string,
  wrapAt: number | null,
  measureWidth: (t: string) => number,
): string[] {
  const out: string[] = []
  if (text.length === 0) return ['']

  for (const logical of text.split('\n')) {
    if (wrapAt === null || logical.length === 0 || measureWidth(logical) <= wrapAt) {
      out.push(logical)
      continue
    }
    // 超宽逻辑行: 贪心逐字符, 超 wrapAt 即断
    let cur = ''
    for (const ch of logical) {
      const trial = cur + ch
      if (cur !== '' && measureWidth(trial) > wrapAt) {
        out.push(cur)
        cur = ch
      } else {
        cur = trial
      }
    }
    if (cur !== '') out.push(cur)
  }
  return out
}
