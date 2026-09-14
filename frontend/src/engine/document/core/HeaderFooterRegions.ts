// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// HeaderFooterRegions — 页眉/页脚「变体 → 数组」与「段落归属」的唯一解析器
// (契约 §7.9)
//
// 文档状态 (DocumentTree) 上有 6 个页眉/页脚段落 id 数组:
//   header / footer                  默认变体 (奇数页)
//   firstPageHeader / firstPageFooter 首页变体 (differentFirstPage)
//   evenPageHeader / evenPageFooter   偶数页变体 (differentOddEven)
//
// 本模块是「哪一页用哪组数组」和「这个段落属于哪组」的唯一实现。
// layout / render / command / interaction / feature 一律经此解析,
// 不得在别处重复字段映射或页面选取规则 (契约 §11: 同一逻辑第二次出现即须抽取)。
//
// 纯查询 + 受控写入口: 不依赖 layout/render/host/React, 可安全在非 DOM 运行时导入。
// ================================================================

import {
  DEFAULT_HEADER_FOOTER_CONFIG,
  type DocumentTree,
} from './DocumentModel'

export type HeaderFooterBand = 'header' | 'footer'
export type HeaderFooterVariant = 'default' | 'first' | 'even'

/** 变体字段名 — 本模块内部单一映射事实源 */
type HfArrayField =
  | 'header' | 'footer'
  | 'firstPageHeader' | 'firstPageFooter'
  | 'evenPageHeader' | 'evenPageFooter'

/** 变体 → 字段名 (band 维度) */
const HF_FIELD: Record<HeaderFooterVariant, Record<HeaderFooterBand, HfArrayField>> = {
  default: { header: 'header', footer: 'footer' },
  first: { header: 'firstPageHeader', footer: 'firstPageFooter' },
  even: { header: 'evenPageHeader', footer: 'evenPageFooter' },
}

/** 全部变体 (固定顺序: default → first → even) */
export const HF_VARIANTS: readonly HeaderFooterVariant[] = ['default', 'first', 'even']

/** 全部区域 (固定顺序: header → footer) */
const HF_BANDS: readonly HeaderFooterBand[] = ['header', 'footer']

const EMPTY: readonly string[] = []

/** 变体是否由配置开启 — 纯由开关驱动, **不**由数组是否存在决定。
 *  (开启首页不同即空白第 1 页而不回退默认变体, 与 Word/WPS 一致。) */
export function isVariantEnabled(doc: DocumentTree, variant: HeaderFooterVariant): boolean {
  if (variant === 'default') return true
  const cfg = doc.headerFooterConfig ?? DEFAULT_HEADER_FOOTER_CONFIG
  return variant === 'first' ? cfg.differentFirstPage : cfg.differentOddEven
}

/**
 * 1-based 页码 → 生效变体 (Word/WPS 语义):
 *   1. differentFirstPage && n === 1        → 'first' (不回退)
 *   2. 否则 differentOddEven: 奇 → 'default' / 偶 → 'even' (不回退)
 *   3. 否则                                  → 'default'
 *   两者同开: 第 1 页 'first', 第 ≥2 页按奇偶。
 */
export function resolveVariantForPage(doc: DocumentTree, pageNumber: number): HeaderFooterVariant {
  const n = Math.max(1, Math.floor(pageNumber))
  if (isVariantEnabled(doc, 'first') && n === 1) return 'first'
  if (isVariantEnabled(doc, 'even')) return n % 2 === 1 ? 'default' : 'even'
  return 'default'
}

/** 只读读取某变体的段落 id 数组 — 缺失 ≡ 空 (不创建) */
export function hfArrayOf(
  doc: DocumentTree,
  band: HeaderFooterBand,
  variant: HeaderFooterVariant,
): readonly string[] {
  return doc[HF_FIELD[variant][band]] ?? EMPTY
}

/**
 * 受控写入口 (契约 §6.2: DocumentModel 为其各自域暴露受控变更 API)。
 * 返回 live 数组, 按需惰性创建; 仅 command 层调用。
 */
export function ensureHfArray(
  doc: DocumentTree,
  band: HeaderFooterBand,
  variant: HeaderFooterVariant,
): string[] {
  const field = HF_FIELD[variant][band]
  const existing = doc[field]
  if (!existing) {
    const created: string[] = []
    doc[field] = created
    return created
  }
  return existing
}

/** 某页生效的页眉/页脚段落 (阅读顺序) — 布局/渲染/编辑/UI 的唯一入口 */
export function hfParagraphsForPage(
  doc: DocumentTree,
  band: HeaderFooterBand,
  pageNumber: number,
): readonly string[] {
  return hfArrayOf(doc, band, resolveVariantForPage(doc, pageNumber))
}

/**
 * 无分页导出用: 默认变体非空取默认, 否则取首个非空变体。
 * (HTML/TXT 导出无分页概念, 只能把该区域内容整体输出一次。)
 */
export function hfParagraphsForExport(
  doc: DocumentTree,
  band: HeaderFooterBand,
): readonly string[] {
  const fallback = hfArrayOf(doc, band, 'default')
  if (fallback.length > 0) return fallback
  for (const v of HF_VARIANTS) {
    const arr = hfArrayOf(doc, band, v)
    if (arr.length > 0) return arr
  }
  return EMPTY
}

export interface HfParagraphLocation {
  band: HeaderFooterBand
  variant: HeaderFooterVariant
  /** 该变体的 live 数组 (可变引用, 供结构命令 splice) */
  ids: string[]
  index: number
}

/**
 * 段落 → 页眉/页脚归属。
 * 扫描顺序 header(default,first,even) → footer(default,first,even); 未找到返回 null。
 */
export function resolveHfParagraphLocation(
  doc: DocumentTree,
  paraId: string,
): HfParagraphLocation | null {
  for (const band of HF_BANDS) {
    for (const variant of HF_VARIANTS) {
      const arr = doc[HF_FIELD[variant][band]]
      if (!arr) continue
      const index = arr.indexOf(paraId)
      if (index >= 0) return { band, variant, ids: arr, index }
    }
  }
  return null
}

/** 段落是否属于任一变体的页眉/页脚 (取代散落的 doc.header?.includes 判定) */
export function isHeaderFooterParagraph(doc: DocumentTree, paraId: string): boolean {
  return resolveHfParagraphLocation(doc, paraId) !== null
}

/** 全部**已存在**的变体数组 (不含缺失者) — 供全文档遍历 (查找/QC) */
export function hfContainers(doc: DocumentTree): string[][] {
  const out: string[][] = []
  for (const band of HF_BANDS) {
    for (const variant of HF_VARIANTS) {
      const arr = doc[HF_FIELD[variant][band]]
      if (arr) out.push(arr)
    }
  }
  return out
}
