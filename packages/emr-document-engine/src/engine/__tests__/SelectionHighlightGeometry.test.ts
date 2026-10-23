// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// SelectionHighlightGeometry — 选区高亮的**像素几何**回归
//
// 功能清单 🟡「选区高亮渲染」: 范围计算已与复制/删除同源，但高亮画在哪、
// 多宽一直只有"不抛错"级别覆盖。本文件捕获 interact 层的 fillRect，
// 断言：
//   - 段内 [1,3) 的高亮从第二个字符起、宽=所选字符宽;
//   - 选中行内图片时整块高亮 (与「非文本计 1」一致);
//   - 页眉选区**每页**都画 (页眉整区重排, offset 每页独立).
//
// 坐标口径: 页面 y = 累积页高 - scrollY + item.y; 行内 x = item.x + 前缀宽。
// 度量用 setup.ts 的 canvas mock: 16px ASCII 每字符 8.8px。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode, createImageNode,
} from '../document/factory/ElementFormatter'
import { STANDARD_CANVAS_TOKENS, withAlpha } from '../state/canvasTokens'
import { getFlatPageItems } from '../layout/core/SLIF'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

// ---- fillRect 记录器 (setUp.ts 的 mock ctx 之上再包一层, 透明) ----

interface FillOp { x: number; y: number; w: number; h: number; fill: string }
const fills: FillOp[] = []

;(function installFillRecorder() {
  const proto = HTMLCanvasElement.prototype
  const orig = proto.getContext
  proto.getContext = function (this: HTMLCanvasElement, id: string, opts?: unknown) {
    const ctx = orig.call(this, id, opts) as CanvasRenderingContext2D | null
    if (id === '2d' && ctx) {
      const fn = ctx.fillRect.bind(ctx)
      ;(ctx as unknown as { fillRect: (x: number, y: number, w: number, h: number) => void }).fillRect =
        (x: number, y: number, w: number, h: number) => {
          fills.push({ x, y, w, h, fill: String(ctx.fillStyle) })
          fn(x, y, w, h)
        }
    }
    return ctx
  } as typeof proto.getContext
})()

const SELECTION_FILL = withAlpha(STANDARD_CANVAS_TOKENS.selectionBg, 0.2)

function selectionFills(): FillOp[] {
  return fills.filter((f) => f.fill === SELECTION_FILL)
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
  fills.length = 0
})

// ---- 夹具 ----

interface Fixture { editor: Editor; doc: DocumentTree; paras: string[]; textId: string }

function makeEditor(options: { longBody?: boolean } = {}): Fixture {
  const doc = createDocument('选区几何')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode
  const add = <T extends { id: string }>(n: T): T => {
    nodes[n.id] = n as unknown as BaseNode
    return n
  }
  const mkPara = (children: string[]): string => {
    const p = add(createParagraph(children))
    doc.body.children.push(p.id)
    return p.id
  }

  const t = add(createTextNode('abcdef'))
  const p = mkPara([t.id])

  // 行内图片段落: 前后[img]尾
  const t2a = add(createTextNode('前后'))
  const img = add(createImageNode('img-key', 40, 20, 'inline'))
  const t2b = add(createTextNode('尾'))
  mkPara([t2a.id, img.id, t2b.id])

  // 页眉 (default)
  const ht = add(createTextNode('页眉文字'))
  const hp = add(createParagraph([ht.id]))
  doc.header = [hp.id]

  // 足够多的正文段落 → 多页, 供「页眉每页都画」断言
  if (options.longBody) {
    for (let i = 0; i < 120; i++) {
      const tx = add(createTextNode(`第${i + 1}段：患者三日前出现发热，伴畏寒乏力。`))
      mkPara([tx.id])
    }
  }

  ;(doc as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  return {
    editor, doc,
    paras: [...doc.body.children],
    textId: t.id,
  }
}

function select(f: Fixture, paraId: string, aOff: number, fOff: number): void {
  f.editor.getStore().setSelection({
    anchor: { paragraphPath: [f.doc.id, paraId], offset: aOff, visible: false },
    focus: { paragraphPath: [f.doc.id, paraId], offset: fOff, visible: false },
    active: true,
    granularity: 'character',
  })
}

function render(f: Fixture): void {
  fills.length = 0
  f.editor.getDraw().render(f.editor.getPool(), f.editor.getStore().state.runtime)
}

// ================================================================
// 断言
// ================================================================

describe('选区高亮几何', () => {
  it('段内 [1,3): 起点 = item.x + 首字符宽, 宽 = 两个字符, 高 = 行 ascent+descent', () => {
    const f = makeEditor()
    select(f, f.paras[0], 1, 3)
    render(f)

    const page = f.editor.getDraw().getPages()[0]
    const item = getFlatPageItems(page).find((i) => i.nodeId === f.textId)!
    const rects = selectionFills()

    expect(rects).toHaveLength(1)
    // mock 度量: 16px ASCII 每字符 8.8
    expect(rects[0].x).toBeCloseTo(item.x + 8.8, 5)
    expect(rects[0].w).toBeCloseTo(8.8 * 2, 5)
    expect(rects[0].y).toBeCloseTo(item.y, 5)
    expect(rects[0].h).toBeCloseTo(item.ascent + item.descent, 5)
  })

  it('选中行内图片: 整块高亮, 宽 = 图片宽', () => {
    const f = makeEditor()
    select(f, f.paras[1], 2, 3)  // 前后[img]尾 → 图片占 1 offset
    render(f)

    const page = f.editor.getDraw().getPages()[0]
    const imgItem = getFlatPageItems(page).find((i) => i.type === 'image')!
    const rects = selectionFills()

    expect(rects).toHaveLength(1)
    expect(rects[0].x).toBeCloseTo(imgItem.x, 5)
    expect(rects[0].w).toBeCloseTo(imgItem.width, 5)
  })

  it('页眉选区: 每页都画 (offset 每页独立, 不跨页累加)', () => {
    const f = makeEditor({ longBody: true })
    const headerPara = f.doc.header[0]
    select(f, headerPara, 1, 3)
    render(f)

    const pageCount = f.editor.getDraw().getPages().length
    expect(pageCount).toBeGreaterThan(1)
    // 每页一条, X 与宽完全一致 (页眉整区重排)
    const rects = selectionFills()
    expect(rects).toHaveLength(pageCount)
    const first = rects[0]
    for (const r of rects) {
      expect(r.x).toBeCloseTo(first.x, 5)
      expect(r.w).toBeCloseTo(first.w, 5)
    }
  })
})
