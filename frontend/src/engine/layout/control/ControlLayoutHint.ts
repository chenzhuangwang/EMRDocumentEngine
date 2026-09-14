// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ControlLayoutHint — 行内控件盒的量宽 + 折行 (契约 §12.8)
//
// 单一事实源: 正文 / 表格 cell / 页眉页脚三条布局路径共用本函数产出
// smarttext 的 LineElement.control 提示 (width/minRows/lines/rows)。
// 此前三条路径各自复制一份配方分支 (契约 §11: 同一非平凡逻辑第二次出现
// 即必须抽取), 各自漂移 —— 表格/页眉路径缺 box 分支, 填了长值的文本域在
// cell 内同样横向溢出。
//
// 硬约束 (契约 §12.8): 控件盒的**总推进宽** (盒 + label/prefix/suffix
// 附属字面量) 不得超过可用宽。内容宽于可用宽时, 按可用宽把显示文本折成
// 多物理行 (与 textarea 同一机制: wrapControlText + lines/rows/minRows),
// 盒宽锁定为可用宽 —— 控件永不横向溢出正文区, 改为纵向长高。
//
// 依赖方向 (契约 §19): layout → document/control 合法; 本模块不 import
// template 特征层, definition 用弱结构传参 (同 controlInlineLeadTrail)。
// ================================================================

import type { ElementEnumOption } from '../../document/core/DocumentModel'
import type { LineElement } from '../line/LineLayout'
import {
  controlVisualRecipe, controlInlineLeadTrail, stripPlaceholderBrackets,
  AFFORDANCE_GAP, AFFORDANCE_WIDTH,
} from '../../document/control/ControlBox'
import { isControlValueEmpty } from '../../document/control/ControlValue'
import {
  layoutControlOptions, controlOptionsWidth, controlOptionsPlaceholderWidth,
} from '../../document/control/ControlOptions'
import { wrapControlText } from '../text/TextWrap'

/** 控件布局提示 (LineElement.control) */
export type ControlLayoutHint = LineElement['control']

/**
 * 行内控件的量宽输入 —— 全部为「已解析的事实」, 本模块不做语义推导。
 */
export interface SmarttextLayoutInput {
  /** 运行时值 (undefined ≡ 未填, 契约 §12.6.1) */
  value?: unknown
  /** 显示文本: 有值 = 值, 未填 = 占位符 (controlValueDisplay 产物) */
  display: string
  /** 设计期定义 (弱结构: 只取 controlType 与附属字面量) */
  definition?: { controlType?: string; label?: string; prefix?: string; suffix?: string }
  /** 枚举候选 (options 配方预留宽; 直接来自 element.format.enums) */
  options?: readonly ElementEnumOption[]
  /** ElementFormat.minRows (多行文本域最小行数, 契约 §12.6.2 layer D) */
  minRows?: number
}

/**
 * 控件盒布局提示 (量宽 + 必要时折行)。
 *
 * @param availableWidth 控件所在文本区的可用宽 (正文 contentWidth / cell 文本宽)
 * @returns LineElement.control; 无内容提示时为 undefined
 */
export function smarttextLayoutHint(
  input: SmarttextLayoutInput,
  measure: (text: string) => number,
  availableWidth: number,
): ControlLayoutHint {
  const def = input.definition
  const recipe = controlVisualRecipe(def?.controlType)
  // 附属字面量 (契约 §12.1) 占位宽: 盒可用宽须先扣除 label/prefix/suffix,
  // 否则盒 + 附属字面量的总推进宽仍会越过可用宽。
  const { lead, trail } = controlInlineLeadTrail(def, measure)
  const affixW = lead + trail
  const boxAvail = Math.max(0, availableWidth - affixW)

  if (recipe.kind === 'options') {
    // checkbox/radio 内联候选组: 宽由模板候选项决定 (非运行时值)。
    // 候选组折行是多行候选布局 (渲染 + 命中须同源改造), 不在本轮范围内 —— 见 PR。
    const opts = input.options
    const natural = opts && opts.length > 0
      ? controlOptionsWidth(layoutControlOptions(opts, def?.controlType as 'checkbox' | 'radio', measure))
      : controlOptionsPlaceholderWidth(measure)
    return { width: natural + affixW, wrapWidth: boxAvail }
  }

  if (recipe.frame === 'box') {
    // 四边框多行文本域 (textarea): 空态沿用 minRows; 填充态按值折行,
    // 预留 width+minRows+lines (契约 §12.6 多行, 行距 = size)。
    if (isControlValueEmpty(input.value)) {
      const rows = typeof input.minRows === 'number' && input.minRows > 0 ? input.minRows : 0
      return { wrapWidth: boxAvail, ...(rows > 0 ? { minRows: rows } : {}) }
    }
    const str = input.display
    const logical = str.split('\n')
    const naturalW = logical.map((l) => measure(l))
    const needWrap = boxAvail > 0 && naturalW.some((w) => w > boxAvail)
    const physical = needWrap ? wrapControlText(str, boxAvail, measure) : logical
    const colW = needWrap ? boxAvail : Math.max(0, ...naturalW)
    const rowsCount = physical.length
    const reserveRows = Math.max(
      typeof input.minRows === 'number' && input.minRows > 0 ? input.minRows : 1,
      rowsCount,
    )
    return {
      width: colW > 0 ? colW + affixW : undefined,
      minRows: reserveRows,
      lines: physical,
      rows: rowsCount,
      ownLine: needWrap,
      wrapWidth: boxAvail,
    }
  }

  // 方括号框 (input/number/date/select + 遗留未落 controlType):
  // 空态占位符自带 `[ ]`, 填充态补画 `[ value ]`; select/date 只画 affordance。
  // 本分支此前**不折行也不锁宽**, 值一长 (如一百位数字) 即整块横向溢出页面。
  const isEmpty = isControlValueEmpty(input.value)
  const bracketsOn = recipe.affordance == null
  const shown = isEmpty
    ? (bracketsOn ? input.display : stripPlaceholderBrackets(input.display))
    : (bracketsOn ? `[${input.display}]` : input.display)
  const affordanceW = recipe.affordance ? AFFORDANCE_GAP + AFFORDANCE_WIDTH : 0
  // 框内文本可用宽 = 盒可用宽 - 方括号 - affordance。折行与 overlay 编辑面共用
  // 它作宽度上限 (契约 §12.8): 编辑面在「还没提交、盒还窄」时也知道自己能占多宽。
  const wrapWidth = Math.max(1, boxAvail - (bracketsOn ? measure('[') * 2 : 0) - affordanceW)
  // 量宽口径与历史一致 (shown 含方括号 + affordance): 不折行时宽度逐字节不变。
  const natural = measure(shown) + affordanceW

  if (boxAvail > 0 && natural > boxAvail) {
    // 框内文本 (与 ControlParticle 同源): 空态剥离占位符外框, 填充态用值原样。
    const inner = isEmpty ? stripPlaceholderBrackets(input.display) : input.display
    const lines = wrapControlText(inner, wrapWidth, measure)
    return {
      width: boxAvail + affixW,
      // minRows 使整行纵向空间延展为 lines.length 行 (LineBreaker descent 延展),
      // 折行后的多行文本不会压到下一行正文上。
      minRows: lines.length > 1 ? lines.length : undefined,
      lines,
      rows: lines.length,
      // 盒宽按「独占起行」的可用宽锁定 → 必须自己起一行, 否则与前面的文本同行
      // 时右缘会越过版心 (契约 §12.8)。
      ownLine: true,
      wrapWidth,
    }
  }

  return { width: natural + affixW, wrapWidth }
}
