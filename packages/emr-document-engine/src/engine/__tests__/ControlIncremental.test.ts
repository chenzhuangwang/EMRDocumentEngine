// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 含控件文档的增量布局 (M3a, 契约 §16.1)
//
// 控件的几何来自段落之外的两类输入:
//   - 计算值 (显示值/可见性)   → ComputedValues 代次  → 段落键 `#cv`
//   - 模板定义 (controlType/label/prefix/suffix) → TemplateDefinitionStore
//     版本 → 段落键 `#tv`
// 段落/表格的节点版本只覆盖"节点自身改了", 覆盖不到这两类 —— 所以键里缺任一段,
// 换值或换外观都会静默复用旧行。
//
// 用例必须证明: (1) 控件段落真的进了缓存; (2) 值/外观变化真的只让控件段落失效;
// (3) 每步结果与全新引擎的全量排版逐字节相同 (增量少做了事但没少对结果)。
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import { controlVisualType } from '../document/control/ControlBox'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import type { BaseNode, ElementMeta, Paragraph, SmartTextNode } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'

const SENTENCE = '患者三日前出现发热，伴畏寒乏力，无咳嗽咳痰，无腹痛腹泻，饮食睡眠尚可。'

const CONTROL_ELEMENT: ElementMeta = {
  code: { internal: 'BP', dataElement: 'DE-BP' },
  name: '血压',
  format: { dataType: 'S1' },
}

/** 控件侧的段落外状态 —— 与 Draw 每趟同步给布局的代次/版本同构 */
interface ControlState {
  displays: Map<string, string>
  hidden: Set<string>
  def: { label?: string; prefix?: string; suffix?: string; controlType?: string } | undefined
  gen: number
  tv: number
}

function makeState(): ControlState {
  return { displays: new Map(), hidden: new Set(), def: undefined, gen: 0, tv: 0 }
}

/** 与 Draw.recomputeLayout 的同步顺序一致: 代次/版本在布局前写入 */
function syncEngine(engine: LayoutEngine, state: ControlState): void {
  engine.setComputedGeneration(state.gen)
  engine.setTemplateDefinitionVersion(state.tv)
}

/** 与 Draw.setControlInfoOf 同源的桩 (含 controlVisualType 枚举回退) */
function wireControlInfo(engine: LayoutEngine, pool: NodePool, state: ControlState): void {
  engine.setControlInfoOf((nodeId) => {
    const el = (pool.nodes.get(nodeId) as SmartTextNode | undefined)?.element
    const hasEnums = el?.format?.enums !== undefined
    return {
      controlType: state.def?.controlType
        ?? controlVisualType(state.def?.controlType, hasEnums, el?.format?.enums?.multiple === true),
      options: el?.format?.enums?.data,
      label: state.def?.label,
      prefix: state.def?.prefix,
      suffix: state.def?.suffix,
      computedDisplay: state.displays.get(nodeId),
      visible: state.hidden.has(nodeId) ? false : undefined,
    }
  })
}

function makeEngine(pool: NodePool, state: ControlState): LayoutEngine {
  const engine = new LayoutEngine(new EventBus(), testMeasurer)
  wireControlInfo(engine, pool, state)
  syncEngine(engine, state)
  return engine
}

/** 每 20 段最后一段带一个控件 (段落子节点 = text + smarttext) */
function makeControlDoc(paragraphCount = 120, every = 20) {
  const doc = createDocument('ctrl-paging')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const texts: string[] = []
  const smartIds: string[] = []
  const paras: string[] = []

  for (let i = 0; i < paragraphCount; i++) {
    const t = createTextNode(`第${i + 1}段：${SENTENCE}`)
    all.set(t.id, t as unknown as BaseNode)
    const children = [t.id]
    if (i % every === every - 1) {
      const st = createSmartTextNode('[血压]', CONTROL_ELEMENT)
      all.set(st.id, st as unknown as BaseNode)
      children.push(st.id)
      smartIds.push(st.id)
    }
    const p = createParagraph(children) as Paragraph
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children.push(p.id)
    texts.push(t.id)
    paras.push(p.id)
  }

  return { doc, pool: buildNodePool(all, { body: doc.id }), texts, paras, smartIds }
}

/** 正文段 + 含控件表格 + 正文段 */
function makeTableControlDoc(leading: number, rows: number, trailing: number) {
  const doc = createDocument('ctrl-table')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const texts: string[] = []
  const smartIds: string[] = []

  for (let i = 0; i < leading + trailing; i++) {
    const t = createTextNode(`第${i + 1}段：${SENTENCE}`)
    const p = createParagraph([t.id]) as Paragraph
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children.push(p.id)
    texts.push(t.id)
  }

  const rowIds: string[] = []
  for (let r = 0; r < rows; r++) {
    const t = createTextNode(`体征${r + 1}：`)
    const st = createSmartTextNode('[血压]', CONTROL_ELEMENT)
    const p = createParagraph([t.id, st.id]) as Paragraph
    const cell = createTableCell([p.id])
    const row = createTableRow([cell])
    for (const n of [t, st, p, cell, row]) all.set(n.id, n as unknown as BaseNode)
    rowIds.push(row.id)
    smartIds.push(st.id)
  }
  const table = createTable([{ width: 400 }], rowIds.map(id => all.get(id)! as never))
  all.set(table.id, table as unknown as BaseNode)
  doc.body.children.splice(leading, 0, table.id)

  return { doc, pool: buildNodePool(all, { body: doc.id }), texts, smartIds, tableId: table.id }
}

/** 全量引擎 (空分页状态 ⇒ allowIncremental=false ⇒ 必定全量) */
function fullPages(pool: NodePool, doc: ReturnType<typeof createDocument>, state: ControlState) {
  return makeEngine(pool, state).fullLayout(doc, pool)
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

/** 在页 (含表格 cell) 中找某节点的 SLIF item */
function findItem(
  pages: ReturnType<LayoutEngine['fullLayout']>,
  nodeId: string,
): { width?: number; text?: string } | undefined {
  for (const page of pages) {
    for (const it of page.items ?? []) {
      if (it.nodeId === nodeId) return it as { width?: number; text?: string }
      for (const r of (it.rows ?? [])) {
        for (const c of (r.cells ?? [])) {
          const hit = (c.items ?? []).find(ci => ci.nodeId === nodeId)
          if (hit) return hit as { width?: number; text?: string }
        }
      }
    }
  }
  return undefined
}

describe('含控件文档的增量布局 (M3a)', () => {
  it('控件段落进入行缓存: 无改动重排整份复用且零重算', () => {
    const { doc, pool, smartIds } = makeControlDoc(120)
    expect(smartIds.length).toBe(6)
    const state = makeState()
    const engine = makeEngine(pool, state)

    engine.fullLayout(doc, pool, 'paragraph')
    const first = engine.getParagraphCacheStats()
    // 含控件段落也在缓存里 (M3a 前它们一律不可缓存)
    expect(first.size).toBe(120)
    expect(first.misses).toBe(120)

    engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('reuse-all')
    const second = engine.getParagraphCacheStats()
    expect(second.misses).toBe(first.misses)
    expect(second.hits - first.hits).toBe(120)
  })

  it('控件显示值变化 (代次+1): 只有含控件段落重算, 其余命中, 结果一致', () => {
    const { doc, pool, smartIds } = makeControlDoc(120)
    const state = makeState()
    const engine = makeEngine(pool, state)
    engine.fullLayout(doc, pool, 'paragraph')
    const before = engine.getParagraphCacheStats()

    state.displays.set(smartIds[0], '120/80')
    state.gen = 1
    engine.setComputedGeneration(1)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const after = engine.getParagraphCacheStats()
    // 代次是全局段: 每个含控件的段落键都变 —— 恰好重算这 6 段
    expect(after.misses - before.misses).toBe(smartIds.length)
    expect(after.hits - before.hits).toBe(120 - smartIds.length)
    // 值真的落到了布局产物上 (不是只换了个键)
    expect(findItem(pages, smartIds[0])?.text).toBe('120/80')
    expect(canonical(pages)).toBe(canonical(fullPages(pool, doc, state)))
  })

  it('模板定义版本变化: 控件段落重算并采用新外观, 其余命中, 结果一致', () => {
    const { doc, pool, smartIds } = makeControlDoc(120)
    const state = makeState()
    const engine = makeEngine(pool, state)
    const beforePages = engine.fullLayout(doc, pool, 'paragraph')
    const beforeWidth = findItem(beforePages, smartIds[0])?.width
    const before = engine.getParagraphCacheStats()

    // 定义改了 (盒左侧加了 prefix), 节点版本与计算值代次都不动
    state.def = { prefix: '血压：' }
    state.tv = 1
    engine.setTemplateDefinitionVersion(1)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const after = engine.getParagraphCacheStats()
    expect(after.misses - before.misses).toBe(smartIds.length)
    expect(after.hits - before.hits).toBe(120 - smartIds.length)
    const afterWidth = findItem(pages, smartIds[0])?.width
    expect(afterWidth).toBeGreaterThan(beforeWidth ?? 0)
    expect(canonical(pages)).toBe(canonical(fullPages(pool, doc, state)))
  })

  it('表格含控件: 表格后正文编辑仍可续排, 结果一致', () => {
    const { doc, pool, texts } = makeTableControlDoc(90, 6, 40)
    const state = makeState()
    const engine = makeEngine(pool, state)
    engine.fullLayout(doc, pool, 'paragraph')

    // 表格之后的正文段编辑: 表格键不变 ⇒ 前序页 (含表格所在页) 可复用
    const target = texts[texts.length - 5]
    pool.updateNode(target, { text: '表格后正文已修改。' } as Partial<BaseNode>)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    const stats = engine.getPaginationStats()
    expect(stats.mode).toBe('resume')
    expect(stats.reusedPages).toBeGreaterThan(0)
    expect(canonical(pages)).toBe(canonical(fullPages(pool, doc, state)))
  })

  it('表格内含控件: 模板定义版本变化使表格键失效, 结果与全量一致', () => {
    const { doc, pool, texts } = makeTableControlDoc(90, 6, 40)
    const state = makeState()
    const engine = makeEngine(pool, state)
    engine.fullLayout(doc, pool, 'paragraph')

    // 先做一次正文编辑让分页状态处于"可续排"状态
    pool.updateNode(texts[5], { text: '前置正文已修改。' } as Partial<BaseNode>)
    engine.fullLayout(doc, pool, 'paragraph')

    // 定义前缀加宽 → cell 行高/宽变化。表格键含 #tv, 必须从表格起始页重排;
    // 若键里漏了 #tv, 续排会复用表格之后的旧页 → 与全量不一致。
    state.def = { prefix: '血压（mmHg）：' }
    state.tv = 1
    engine.setTemplateDefinitionVersion(1)
    const pages = engine.fullLayout(doc, pool, 'paragraph')

    expect(engine.getPaginationStats().mode).not.toBe('reuse-all')
    expect(canonical(pages)).toBe(canonical(fullPages(pool, doc, state)))
  })

  it('随机 60 步 (正文/控件值/可见性/外观): 每步与全新引擎逐字节相同', () => {
    const { doc, pool, texts, smartIds } = makeControlDoc(120)
    const state = makeState()
    const engine = makeEngine(pool, state)
    engine.fullLayout(doc, pool, 'paragraph')

    let seed = 606060
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const prefixes = ['', '血压：', '静息血压（mmHg）：']
    let resumed = 0

    for (let step = 0; step < 60; step++) {
      const action = Math.floor(rand() * 5)
      if (action <= 1) {
        const t = texts[Math.floor(rand() * texts.length)]
        pool.updateNode(t, { text: `${SENTENCE}（改${Math.floor(rand() * 9)}）` } as Partial<BaseNode>)
      } else if (action === 2) {
        const id = smartIds[Math.floor(rand() * smartIds.length)]
        state.displays.set(id, `${Math.floor(rand() * 90) + 90}/${Math.floor(rand() * 60) + 60}`)
        state.gen++
        engine.setComputedGeneration(state.gen)
      } else if (action === 3) {
        const id = smartIds[Math.floor(rand() * smartIds.length)]
        if (rand() < 0.5) state.hidden.add(id)
        else state.hidden.delete(id)
        state.gen++
        engine.setComputedGeneration(state.gen)
      } else {
        state.def = { prefix: prefixes[Math.floor(rand() * prefixes.length)] }
        state.tv++
        engine.setTemplateDefinitionVersion(state.tv)
      }

      const pages = engine.fullLayout(doc, pool, 'paragraph')
      if (engine.getPaginationStats().mode === 'resume') resumed++
      expect(canonical(pages), `step ${step}`).toBe(canonical(fullPages(pool, doc, state)))
    }
    // 至少有一次真的走了续排 (否则本用例退化成全量对比)
    expect(resumed).toBeGreaterThan(0)
  })
})
