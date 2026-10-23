// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 页面几何接线 (契约 §16 PAGE GEOMETRY)
//
// `DocumentTree.pageSetup` 是纸张/页边距的唯一所有者, 但布局曾把 794×1123
// 硬编码在 LayoutEngine.config 里、从不接收文档值 —— 页面设置对话框改的是
// doc.pageSetup, 屏幕上的版心却纹丝不动 (静默死接缝)。
//
// 本文件锁三条:
//   1. 换文档时文档自带的页面设置真的进了布局 (宽度/高度/页边距);
//   2. applyPageSetup 改设置后版面立刻变, 撤销后精确还原;
//   3. 几何变化清掉分页状态, 下一趟是全量而不是复用旧页。
// 一律走真实 Editor/Draw 路径, 不直接给 LayoutEngine 喂 config —— 那只测
// "引擎会排版", 测不出"文档值有没有被推过去"。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode, DocumentTree, PageSetup, Paragraph } from '../document/core/DocumentModel'

afterEach(() => { document.body.innerHTML = '' })

const SENTENCE = '患者三日前出现发热，伴畏寒乏力，无咳嗽咳痰，无腹痛腹泻，饮食睡眠尚可。'

const NARROW: PageSetup = {
  width: 500, height: 700,
  marginTop: 40, marginBottom: 40, marginLeft: 30, marginRight: 30,
  orientation: 'portrait',
}

function makeDoc(pageSetup?: PageSetup, withSeparator = false) {
  const doc = createDocument('页面几何', undefined, pageSetup)
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  const textIds: string[] = []
  for (let i = 0; i < 12; i++) {
    const t = createTextNode(`第${i + 1}段：${SENTENCE}${SENTENCE}`)
    const p = createParagraph([t.id]) as Paragraph
    all.set(t.id, t as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children.push(p.id)
    textIds.push(t.id)
  }
  if (withSeparator) {
    const sep = { type: 'separator', id: 'sep-geometry', lineStyle: 'solid' } as unknown as BaseNode
    all.set(sep.id, sep)
    doc.body.children.push(sep.id)
  }
  // Editor 的加载器按 artifact 形态读取 doc.nodes (与序列化文件同构)
  ;(doc as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes =
    Object.fromEntries(all)
  return { doc, pool: buildNodePool(all, { body: doc.id }), textIds }
}

function makeEditor(doc: DocumentTree): Editor {
  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)
  return editor
}

// ---- 线段记录器: 捕获 moveTo/lineTo → stroke 的线段 (分隔线几何) ----

interface LineOp { x1: number; y1: number; x2: number; y2: number }
const lineOps: LineOp[] = []

;(function installLineRecorder() {
  const proto = HTMLCanvasElement.prototype
  const orig = proto.getContext
  proto.getContext = function (this: HTMLCanvasElement, id: string, opts?: unknown) {
    const ctx = orig.call(this, id, opts) as CanvasRenderingContext2D | null
    if (id === '2d' && ctx && !(ctx as unknown as { __lineRec?: boolean }).__lineRec) {
      ;(ctx as unknown as { __lineRec?: boolean }).__lineRec = true
      let mx = NaN, my = NaN, lx = NaN, ly = NaN
      const moveTo = ctx.moveTo.bind(ctx)
      const lineTo = ctx.lineTo.bind(ctx)
      const stroke = ctx.stroke.bind(ctx)
      ;(ctx as unknown as { moveTo: (x: number, y: number) => void }).moveTo = (x, y) => {
        mx = x; my = y; lx = NaN; ly = NaN; moveTo(x, y)
      }
      ;(ctx as unknown as { lineTo: (x: number, y: number) => void }).lineTo = (x, y) => {
        lx = x; ly = y; lineTo(x, y)
      }
      ;(ctx as unknown as { stroke: () => void }).stroke = () => {
        if (!Number.isNaN(mx) && !Number.isNaN(lx)) lineOps.push({ x1: mx, y1: my, x2: lx, y2: ly })
        stroke()
      }
    }
    return ctx
  } as typeof proto.getContext
})()

describe('页面几何接线 (契约 §16)', () => {
  it('换文档: 文档自带的 pageSetup 进入布局与 SLIF 页尺寸', () => {
    const { doc } = makeDoc(NARROW)
    const editor = makeEditor(doc)
    const pages = editor.getDraw().getPages()
    expect(pages.length).toBeGreaterThan(0)
    expect(pages[0].width).toBe(NARROW.width)
    expect(pages[0].height).toBe(NARROW.height)
  })

  it('页边距参与版心: 首个正文 item 的 x 取文档 marginLeft', () => {
    const { doc } = makeDoc(NARROW)
    const editor = makeEditor(doc)
    const item = editor.getDraw().getPages()[0].items.find((it) => it.nodeType === 'text')!
    expect(item.x).toBe(NARROW.marginLeft)
  })

  it('分隔线按文档版心宽绘制 (不再写死 90+90)', () => {
    const { doc } = makeDoc(NARROW, true)
    lineOps.length = 0
    makeEditor(doc)
    const expectedEnd = NARROW.width - NARROW.marginRight
    const sep = lineOps.find(
      (l) => Math.abs(l.y1 - l.y2) < 0.01 && Math.abs(l.x1 - NARROW.marginLeft) < 0.5,
    )
    expect(sep, '没有找到正文分隔线').toBeTruthy()
    expect(sep!.x2).toBeCloseTo(expectedEnd, 0)
  })

  it('applyPageSetup 改变版面; 撤销后精确还原', () => {
    const { doc } = makeDoc()
    const editor = makeEditor(doc)
    expect(editor.getDraw().getPages()[0].width).toBe(794)

    editor.applyPageSetup({
      pageWidth: NARROW.width, pageHeight: NARROW.height,
      marginTop: NARROW.marginTop, marginBottom: NARROW.marginBottom,
      marginLeft: NARROW.marginLeft, marginRight: NARROW.marginRight,
      orientation: 'portrait',
    })
    let pages = editor.getDraw().getPages()
    expect(pages[0].width).toBe(NARROW.width)
    expect(pages[0].height).toBe(NARROW.height)
    const afterItem = pages[0].items.find((it) => it.nodeType === 'text')!
    expect(afterItem.x).toBe(NARROW.marginLeft)

    editor.undo()
    pages = editor.getDraw().getPages()
    expect(pages[0].width).toBe(794)
    expect(pages[0].height).toBe(1123)
    expect(doc.pageSetup.width).toBe(794)
  })

  it('几何变化清掉分页状态: 下一趟全量, 未变时整份复用', () => {
    const { doc, pool } = makeDoc()
    const engine = new LayoutEngine(new EventBus(), testMeasurer)

    engine.setPageSetup(doc.pageSetup)
    engine.fullLayout(doc, pool, 'paragraph')
    engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('reuse-all')

    engine.setPageSetup(NARROW)
    const pages = engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('full')
    expect(pages[0].width).toBe(NARROW.width)
    expect(pages[0].height).toBe(NARROW.height)

    engine.fullLayout(doc, pool, 'paragraph')
    expect(engine.getPaginationStats().mode).toBe('reuse-all')
  })

  it('未提供 pageSetup 时沿用默认纸张 (794×1123)', () => {
    const { doc, pool } = makeDoc()
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    engine.setPageSetup(undefined)
    const pages = engine.fullLayout(doc, pool)
    expect(pages[0].width).toBe(794)
    expect(pages[0].height).toBe(1123)
  })
})
