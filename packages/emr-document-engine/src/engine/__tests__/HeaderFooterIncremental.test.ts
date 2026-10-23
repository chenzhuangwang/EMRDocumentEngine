// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 带页眉/页脚的增量布局 (M3b, 契约 §16.1)
//
// 页眉/页脚同时决定两件事: 正文可用区 (带高) 与每页携带的 items。此前文档
// 只要带页眉页脚就一律全量。现在改为比较**几何签名**: 变体数组的段落/子节点
// 版本、变体开关、修订留痕开关、HF 内控件的计算值代次/模板定义版本、域预留宽
// 的取样输入 (页数位数/locale/标题) 全未变, 才允许复用已排好的页。
//
// 判据仍是与全新引擎的全量结果逐字节相同; 另需证明续排真的发生。
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode, createFieldNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, ElementMeta, Paragraph } from '../document/core/DocumentModel'

const SENTENCE = '患者三日前出现发热，伴畏寒乏力，无咳嗽咳痰，无腹痛腹泻，饮食睡眠尚可。'

interface HfOptions {
  /** 页眉/页脚是否带域 (页码/总页数) */
  fields?: boolean
  /** 是否启用首页/奇偶页变体 */
  variants?: boolean
  /** 页眉是否带控件 */
  headerSmart?: boolean
}

function makeHfDoc(n = 120, opts: HfOptions = {}) {
  const doc = createDocument('hf-paging')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const texts: string[] = []

  for (let i = 0; i < n; i++) {
    const t = createTextNode(`第${i + 1}段：${SENTENCE}`)
    const p = createParagraph([t.id]) as Paragraph
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children.push(p.id)
    texts.push(t.id)
  }

  const addPara = (parts: BaseNode[]): Paragraph => {
    const p = createParagraph(parts.map(x => x.id)) as Paragraph
    for (const x of [...parts, p]) all.set(x.id, x as unknown as BaseNode)
    return p
  }

  const headerText = createTextNode('某某医院　病历记录')
  const headerParts: BaseNode[] = [headerText]
  if (opts.fields) headerParts.push(createFieldNode('document_title'))
  if (opts.headerSmart) {
    headerParts.push(createSmartTextNode('[归档号]', {
      code: { internal: 'ARC', dataElement: 'DE-ARC' }, name: '归档号', format: { dataType: 'S1' },
    } as ElementMeta))
  }
  const headerPara = addPara(headerParts)

  const footerParts: BaseNode[] = [createTextNode('第')]
  if (opts.fields) footerParts.push(createFieldNode('page_number'))
  footerParts.push(createTextNode('页'))
  if (opts.fields) {
    footerParts.push(createTextNode('　共'))
    footerParts.push(createFieldNode('total_pages'))
    footerParts.push(createTextNode('页'))
  }
  const footerPara = addPara(footerParts)

  doc.header = [headerPara.id]
  doc.footer = [footerPara.id]

  if (opts.variants) {
    doc.headerFooterConfig = { differentFirstPage: true, differentOddEven: true }
    const firstHeader = addPara([createTextNode('首页页眉')])
    const firstFooter = addPara([createTextNode('首页页脚')])
    const evenHeader = addPara([createTextNode('偶数页页眉')])
    const evenFooter = addPara([createTextNode('偶数页页脚')])
    doc.firstPageHeader = [firstHeader.id]
    doc.firstPageFooter = [firstFooter.id]
    doc.evenPageHeader = [evenHeader.id]
    doc.evenPageFooter = [evenFooter.id]
  }

  return {
    doc,
    pool: buildNodePool(all, { body: doc.id }),
    texts,
    headerTextId: headerText.id,
    footerFirstTextId: footerPara.children.find((id) => {
      const n = all.get(id)
      return n?.type === 'text'
    })!,
  }
}

function newEngine(): LayoutEngine {
  return new LayoutEngine(new EventBus(), testMeasurer)
}

interface FreshOpts {
  gen?: number
  tv?: number
  rev?: boolean
  displays?: Map<string, string>
}

/** 全新引擎 (空分页状态 ⇒ 全量布局) */
function fullPages(
  doc: ReturnType<typeof createDocument>, pool: ReturnType<typeof buildNodePool>, opts: FreshOpts = {},
) {
  const engine = newEngine()
  if (opts.displays) {
    const displays = opts.displays
    engine.setControlInfoOf((id) => ({ computedDisplay: displays.get(id) }))
  }
  engine.setComputedGeneration(opts.gen ?? 0)
  engine.setTemplateDefinitionVersion(opts.tv ?? 0)
  if (opts.rev === false) engine.setShowRevisionMarks(false)
  return engine.fullLayout(doc, pool)
}

function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(obj).sort()) out[key] = walk(obj[key])
      return out
    }
    return v
  }
  return JSON.stringify(walk(value))
}

/** 等宽替换: 一个 CJK 字换另一个 CJK 字 —— 行数、行高都不变 */
function swapChar(text: string, pos: number): string {
  const chars = [...text]
  chars[pos % chars.length] = chars[pos % chars.length] === '患' ? '病' : '患'
  return chars.join('')
}

describe('带页眉/页脚的增量布局 (M3b)', () => {
  it('正文编辑: 页眉页脚未变 → 续排并复用前序页, 结果与全量一致', () => {
    const { doc, pool, texts } = makeHfDoc(120)
    const engine = newEngine()
    const before = engine.fullLayout(doc, pool, 'paragraph')

    const node = pool.nodes.get(texts[40]) as { text: string }
    pool.updateNode(texts[40], { text: swapChar(node.text, 2) } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const stats = engine.getPaginationStats()
    expect(stats.mode).toBe('resume')
    expect(stats.reusedPages).toBeGreaterThan(0)
    expect(pages[0]).toBe(before[0])
    expect(canonical(pages)).toBe(canonical(fullPages(doc, pool)))
  })

  it('页眉内容编辑 → 签名变化, 回落全量, 结果一致', () => {
    const { doc, pool, texts, headerTextId } = makeHfDoc(120)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(headerTextId, { text: '某某医院　病历记录（修订版）' } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('full')
    expect(canonical(pages)).toBe(canonical(fullPages(doc, pool)))
  })

  it('页脚内容编辑 → 回落全量; 随后的正文编辑又恢复续排', () => {
    const { doc, pool, texts, footerFirstTextId } = makeHfDoc(120)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(footerFirstTextId, { text: '第' } as Partial<BaseNode>)
    engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('full')

    // 选后段正文 (前段落在第 0 页时本来就没有前序页可复用)
    pool.updateNode(texts[90], { text: `${SENTENCE}（改）` } as Partial<BaseNode>)
    engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(canonical(engine.getPages())).toBe(canonical(fullPages(doc, pool)))
  })

  it('域 (页码/总页数) 与变体开关: 正文编辑仍可续排, 切换开关回落全量', () => {
    const { doc, pool, texts } = makeHfDoc(120, { fields: true, variants: true })
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(texts[60], { text: swapChar((pool.nodes.get(texts[60]) as { text: string }).text, 1) } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(canonical(pages)).toBe(canonical(fullPages(doc, pool)))

    // 关掉奇偶页不同: 逐页变体解析变了 → 必须全量
    doc.headerFooterConfig = { differentFirstPage: true, differentOddEven: false }
    const pages2 = engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('full')
    expect(canonical(pages2)).toBe(canonical(fullPages(doc, pool)))
  })

  it('页眉内控件: 正文编辑续排; 计算值代次变化回落全量', () => {
    const { doc, pool, texts } = makeHfDoc(120, { headerSmart: true })
    const displays = new Map<string, string>()
    const engine = newEngine()
    engine.setControlInfoOf((id) => ({ computedDisplay: displays.get(id) }))
    engine.fullLayout(doc, pool, 'paragraph')

    pool.updateNode(texts[50], { text: `${SENTENCE}（改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('resume')
    expect(canonical(pages)).toBe(canonical(fullPages(doc, pool, { displays })))

    // 公式重算改写页眉控件显示 → 带页眉的文档必须全量
    const smartId = [...pool.nodes.values()].find(n => n.type === 'smarttext')!.id
    displays.set(smartId, 'ARC-2026-0001')
    engine.setComputedGeneration(1)
    const pages2 = engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('full')
    expect(canonical(pages2)).toBe(canonical(fullPages(doc, pool, { gen: 1, displays })))
  })

  it('修订留痕开关切换 → 回落全量 (HF 删除线是布局期产物)', () => {
    const { doc, pool, texts } = makeHfDoc(80)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    engine.setShowRevisionMarks(false)
    pool.updateNode(texts[20], { text: `${SENTENCE}（改）` } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).toBe('full')
    expect(canonical(pages)).toBe(canonical(fullPages(doc, pool, { rev: false })))
  })

  it('随机 60 步 (正文/页眉/页脚交替编辑): 每步与全新引擎逐字节相同', () => {
    const { doc, pool, texts, headerTextId, footerFirstTextId } = makeHfDoc(120)
    const engine = newEngine()
    engine.fullLayout(doc, pool, 'paragraph')

    let seed = 30303
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    let resumed = 0
    for (let step = 0; step < 60; step++) {
      const action = Math.floor(rand() * 4)
      if (action === 0) {
        const id = headerTextId
        pool.updateNode(id, { text: `某某医院　病历记录（${step}）` } as Partial<BaseNode>)
      } else if (action === 1) {
        pool.updateNode(footerFirstTextId, { text: step % 2 === 0 ? '第' : '第 ' } as Partial<BaseNode>)
      } else {
        const t = texts[Math.floor(rand() * texts.length)]
        const node = pool.nodes.get(t) as { text: string }
        pool.updateNode(t, {
          text: rand() < 0.5 ? swapChar(node.text, Math.floor(rand() * 30)) : `${SENTENCE}（改${step}）`,
        } as Partial<BaseNode>)
      }

      const pages = engine.fullLayout(doc, pool, 'paragraph')
      if (engine.getPaginationStats().mode === 'resume') resumed++
      expect(canonical(pages), `step ${step}`).toBe(canonical(fullPages(doc, pool)))
    }
    expect(resumed).toBeGreaterThan(0)
  })
})
