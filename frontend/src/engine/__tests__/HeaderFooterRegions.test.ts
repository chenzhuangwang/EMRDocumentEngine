// ============================================================
// HeaderFooterRegions — 页眉页脚变体解析 (契约 §7.9)
//
// 覆盖:
//   1. resolveVariantForPage 真值表 (首页不同 / 奇偶页不同 / 两者同开)
//   2. hfArrayOf / ensureHfArray (只读缺失≡空; 受控写入口惰性创建)
//   3. resolveHfParagraphLocation 覆盖 6 个变体数组 + body 返回 null
//   4. hfParagraphsForExport 回退链
//   5. hfContainers 只含已存在数组
// ============================================================

import { describe, it, expect } from 'vitest'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { DocumentTree } from '../document/core/DocumentModel'
import {
  ensureHfArray, hfArrayOf, hfContainers, hfParagraphsForExport, hfParagraphsForPage,
  isHeaderFooterParagraph, isVariantEnabled, resolveHfParagraphLocation, resolveVariantForPage,
} from '../document/core/HeaderFooterRegions'

function doc(cfg?: { first?: boolean; oddEven?: boolean }): DocumentTree {
  const d = createDocument('hf')
  if (cfg) {
    d.headerFooterConfig = {
      differentFirstPage: cfg.first === true,
      differentOddEven: cfg.oddEven === true,
    }
  }
  return d
}

describe('resolveVariantForPage — Word/WPS 选取语义', () => {
  it('两个开关都关 → 任意页恒 default', () => {
    const d = doc()
    for (const n of [1, 2, 3, 4, 5]) expect(resolveVariantForPage(d, n)).toBe('default')
  })

  it('仅首页不同 → 第 1 页 first, 第 2 页起 default (不回退)', () => {
    const d = doc({ first: true })
    expect(resolveVariantForPage(d, 1)).toBe('first')
    expect(resolveVariantForPage(d, 2)).toBe('default')
    expect(resolveVariantForPage(d, 3)).toBe('default')
  })

  it('仅奇偶页不同 → 奇数页 default, 偶数页 even', () => {
    const d = doc({ oddEven: true })
    expect(resolveVariantForPage(d, 1)).toBe('default')
    expect(resolveVariantForPage(d, 2)).toBe('even')
    expect(resolveVariantForPage(d, 3)).toBe('default')
    expect(resolveVariantForPage(d, 4)).toBe('even')
  })

  it('两者同开 → 第 1 页 first, 第 ≥2 页按奇偶', () => {
    const d = doc({ first: true, oddEven: true })
    expect(resolveVariantForPage(d, 1)).toBe('first')
    expect(resolveVariantForPage(d, 2)).toBe('even')
    expect(resolveVariantForPage(d, 3)).toBe('default')
    expect(resolveVariantForPage(d, 4)).toBe('even')
  })

  it('页码下界钳到 1', () => {
    const d = doc({ first: true })
    expect(resolveVariantForPage(d, 0)).toBe('first')
    expect(resolveVariantForPage(d, -3)).toBe('first')
  })
})

describe('isVariantEnabled — 纯由配置驱动, 不看数组是否存在', () => {
  it('default 恒 true; first/even 随开关', () => {
    const d = doc()
    expect(isVariantEnabled(d, 'default')).toBe(true)
    expect(isVariantEnabled(d, 'first')).toBe(false)
    expect(isVariantEnabled(d, 'even')).toBe(false)
    d.headerFooterConfig = { differentFirstPage: true, differentOddEven: true }
    expect(isVariantEnabled(d, 'first')).toBe(true)
    expect(isVariantEnabled(d, 'even')).toBe(true)
  })

  it('缺 headerFooterConfig 时按默认值 (全 false)', () => {
    const d = createDocument('t')
    delete d.headerFooterConfig
    expect(isVariantEnabled(d, 'first')).toBe(false)
    expect(isVariantEnabled(d, 'even')).toBe(false)
  })
})

describe('hfArrayOf / ensureHfArray', () => {
  it('hfArrayOf 缺失 ≡ 空数组, 且不创建字段', () => {
    const d = doc()
    expect(hfArrayOf(d, 'header', 'first')).toEqual([])
    expect(d.firstPageHeader).toBeUndefined()
  })

  it('ensureHfArray 惰性创建并返回 live 数组', () => {
    const d = doc()
    const arr = ensureHfArray(d, 'footer', 'even')
    expect(d.evenPageFooter).toBe(arr)
    arr.push('p1')
    expect(d.evenPageFooter).toEqual(['p1'])
  })

  it('ensureHfArray 已存在时复用同一引用', () => {
    const d = doc()
    d.header = ['a']
    expect(ensureHfArray(d, 'header', 'default')).toBe(d.header)
  })
})

describe('resolveHfParagraphLocation — 段落归属', () => {
  it('覆盖 6 个变体数组', () => {
    const d = doc()
    d.header = ['h0']
    d.footer = ['f0']
    d.firstPageHeader = ['h1']
    d.firstPageFooter = ['f1']
    d.evenPageHeader = ['h2']
    d.evenPageFooter = ['f2']
    expect(resolveHfParagraphLocation(d, 'h0')).toMatchObject({ band: 'header', variant: 'default', index: 0 })
    expect(resolveHfParagraphLocation(d, 'f0')).toMatchObject({ band: 'footer', variant: 'default', index: 0 })
    expect(resolveHfParagraphLocation(d, 'h1')).toMatchObject({ band: 'header', variant: 'first', index: 0 })
    expect(resolveHfParagraphLocation(d, 'f1')).toMatchObject({ band: 'footer', variant: 'first', index: 0 })
    expect(resolveHfParagraphLocation(d, 'h2')).toMatchObject({ band: 'header', variant: 'even', index: 0 })
    expect(resolveHfParagraphLocation(d, 'f2')).toMatchObject({ band: 'footer', variant: 'even', index: 0 })
  })

  it('返回的 ids 是 live 数组 (结构命令据此 splice)', () => {
    const d = doc()
    d.header = ['x']
    const loc = resolveHfParagraphLocation(d, 'x')
    expect(loc?.ids).toBe(d.header)
  })

  it('记录段落在数组中的下标', () => {
    const d = doc()
    d.footer = ['a', 'b', 'c']
    expect(resolveHfParagraphLocation(d, 'c')?.index).toBe(2)
  })

  it('正文 / 未知段落 → null', () => {
    const d = doc()
    d.body.children = ['bodyPara']
    expect(resolveHfParagraphLocation(d, 'bodyPara')).toBeNull()
    expect(resolveHfParagraphLocation(d, 'nope')).toBeNull()
    expect(isHeaderFooterParagraph(d, 'bodyPara')).toBe(false)
    expect(isHeaderFooterParagraph(d, 'nope')).toBe(false)
  })

  it('isHeaderFooterParagraph 认出任一变体', () => {
    const d = doc()
    d.evenPageFooter = ['z']
    expect(isHeaderFooterParagraph(d, 'z')).toBe(true)
  })
})

describe('hfParagraphsForPage', () => {
  it('按页返回对应变体数组', () => {
    const d = doc({ first: true, oddEven: true })
    d.header = ['odd']
    d.firstPageHeader = ['first']
    d.evenPageHeader = ['even']
    expect(hfParagraphsForPage(d, 'header', 1)).toEqual(['first'])
    expect(hfParagraphsForPage(d, 'header', 2)).toEqual(['even'])
    expect(hfParagraphsForPage(d, 'header', 3)).toEqual(['odd'])
    expect(hfParagraphsForPage(d, 'header', 4)).toEqual(['even'])
  })

  it('开关开而变体数组缺失 → 空 (不回退默认)', () => {
    const d = doc({ first: true })
    d.header = ['odd']
    expect(hfParagraphsForPage(d, 'header', 1)).toEqual([])
  })
})

describe('hfParagraphsForExport — 无分页回退链', () => {
  it('默认变体非空 → 取默认', () => {
    const d = doc({ first: true })
    d.header = ['d']
    d.firstPageHeader = ['f']
    expect(hfParagraphsForExport(d, 'header')).toEqual(['d'])
  })

  it('默认变体为空 → 取首个非空变体 (default → first → even)', () => {
    const d = doc({ first: true })
    d.firstPageHeader = ['f']
    expect(hfParagraphsForExport(d, 'header')).toEqual(['f'])
  })

  it('全空 → 空数组', () => {
    expect(hfParagraphsForExport(doc(), 'footer')).toEqual([])
  })
})

describe('hfContainers — 只含已存在的数组', () => {
  it('缺失变体不产出; 顺序 header(default,first,even) → footer(同)', () => {
    const d = doc()
    d.header = ['h']
    d.evenPageHeader = ['he']
    d.footer = ['f']
    expect(hfContainers(d)).toEqual([d.header, d.evenPageHeader, d.footer])
  })

  it('createDocument 的空默认数组仍计入 (字段存在); 变体字段缺失则不产出', () => {
    const d = doc()
    // createDocument 落 header: [] / footer: [], 变体字段缺失
    expect(hfContainers(d)).toEqual([d.header, d.footer])
  })

  it('显式删除默认数组后 → 不含它们', () => {
    const d = doc()
    delete d.header
    delete d.footer
    expect(hfContainers(d)).toEqual([])
  })
})

describe('段落创建工厂可用 (夹具自检)', () => {
  it('createParagraph/createTextNode 产出可寻址 id', () => {
    const p = createParagraph([createTextNode('t').id])
    expect(typeof p.id).toBe('string')
  })
})
