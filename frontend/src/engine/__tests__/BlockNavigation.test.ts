// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// BlockNavigation — 块感知方向键导航回归测试 (Phase 6)
//
// 复现并防止: 方向键在「文字 / 表格 / 图片」之间切换卡顿、卡死。
//   - 正文 ArrowUp/Down 在完整块序列上移动, 段落保列, 表格进入首/末 cell, 图片跳过
//   - cell 内 ArrowUp/Down 沿网格跨行, 越界跳出表格
//   - cell 边界 ArrowLeft/Right 沿阅读顺序移动, 越界跳出表格
//
// 这些逻辑位于 KeyboardHandler 的私有方法 navigateBlock 及其依赖,
// 均为纯函数 (不触碰 this.editor), 通过 handler 实例直接调用。
// ================================================================

import { describe, it, expect } from 'vitest'
import { KeyboardHandler } from '../interaction/KeyboardHandler'
import type { Editor } from '../Editor'
import { testHost } from './helpers'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode,
  createTable, createTableRow, createTableCell, createImageNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, Paragraph } from '../document/core/DocumentModel'

/** 构造一个不依赖真实 DOM/Editor 的 KeyboardHandler (导航方法为纯函数) */
function makeHandler(): KeyboardHandler {
  const container = {
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLElement
  testHost.input.mount(container)
  return new KeyboardHandler({} as unknown as Editor, testHost)
}

/** 注册文本 + 段落, 返回段落 */
function mkPara(allNodes: Map<string, BaseNode>, text: string): Paragraph {
  const tn = createTextNode(text)
  const para = createParagraph([tn.id])
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  return para
}

/** 2×2 表格 fixture, body = [paraBefore, table, paraAfter] */
function makeTableFixture() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const mkCell = (text: string) => {
    const para = mkPara(allNodes, text)
    const cell = createTableCell([para.id])
    allNodes.set(cell.id, cell as unknown as BaseNode)
    return { cell, para }
  }
  const { cell: c00, para: p00 } = mkCell('aa')
  const { cell: c01, para: p01 } = mkCell('bbb')
  const { cell: c10, para: p10 } = mkCell('c')
  const { cell: c11, para: p11 } = mkCell('dddd')
  const row0 = createTableRow([c00, c01])
  const row1 = createTableRow([c10, c11])
  const table = createTable(
    [{ width: 50, mode: 'percentage' }, { width: 50, mode: 'percentage' }],
    [row0, row1],
  )
  for (const n of [table, row0, row1]) allNodes.set(n.id, n as unknown as BaseNode)

  const paraBefore = mkPara(allNodes, 'before')
  const paraAfter = mkPara(allNodes, 'after')
  doc.body.children = [paraBefore.id, table.id, paraAfter.id]

  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, table, c00, c01, c10, c11, p00, p01, p10, p11, paraBefore, paraAfter }
}

describe('块感知方向键导航 (KeyboardHandler.navigateBlock)', () => {
  it('正文 ArrowDown 进入表格首 cell (首行首列)', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, paraBefore, p00 } = makeTableFixture()
    const r = nav.call(h, paraBefore.id, doc, pool, 1, 'vertical', 2)
    expect(r).toEqual({ paraId: p00.id, offset: 0 })
  })

  it('正文 ArrowDown 跨图片: 跳过 image 落到下一段落', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const p1 = mkPara(allNodes, 'one')
    const img = createImageNode('k1', 100, 80, 'top-bottom')
    allNodes.set(img.id, img as unknown as BaseNode)
    const p2 = mkPara(allNodes, 'two')
    doc.body.children = [p1.id, img.id, p2.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    expect(nav.call(h, p1.id, doc, pool, 1, 'vertical', 0)).toEqual({ paraId: p2.id, offset: 0 })
  })

  it('cell 内 ArrowDown 跨行: (0,0) → (1,0)', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p00, p10 } = makeTableFixture()
    expect(nav.call(h, p00.id, doc, pool, 1, 'vertical', 1)).toEqual({ paraId: p10.id, offset: 1 })
  })

  it('cell 内 ArrowUp 跨行: (1,1) → (0,1)', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p11, p01 } = makeTableFixture()
    expect(nav.call(h, p11.id, doc, pool, -1, 'vertical', 0)).toEqual({ paraId: p01.id, offset: 0 })
  })

  it('末行 cell ArrowDown 跳出表格到下一段落', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p11, paraAfter } = makeTableFixture()
    expect(nav.call(h, p11.id, doc, pool, 1, 'vertical', 3)).toEqual({ paraId: paraAfter.id, offset: 3 })
  })

  it('首行 cell ArrowUp 跳出表格到上一段落 (保列)', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p00, paraBefore } = makeTableFixture()
    // paraBefore 长度 6, 保列 offset 2 → 2
    expect(nav.call(h, p00.id, doc, pool, -1, 'vertical', 2)).toEqual({ paraId: paraBefore.id, offset: 2 })
  })

  it('cell 边界 ArrowRight: (0,0) 末尾 → (0,1) 开头', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p00, p01 } = makeTableFixture()
    expect(nav.call(h, p00.id, doc, pool, 1, 'horizontal', 0)).toEqual({ paraId: p01.id, offset: 0 })
  })

  it('cell 边界 ArrowLeft: (0,1) 开头 → (0,0) 末尾', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p01, p00 } = makeTableFixture()
    // p00 文本 'aa' 长度 2 → 末尾偏移 2
    expect(nav.call(h, p01.id, doc, pool, -1, 'horizontal', 0)).toEqual({ paraId: p00.id, offset: 2 })
  })

  it('首 cell 边界 ArrowLeft 跳出表格到上一段落末尾', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p00, paraBefore } = makeTableFixture()
    // paraBefore 'before' 长度 6
    expect(nav.call(h, p00.id, doc, pool, -1, 'horizontal', 0)).toEqual({ paraId: paraBefore.id, offset: 6 })
  })

  it('末 cell 边界 ArrowRight 跳出表格到下一段落开头', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p11, paraAfter } = makeTableFixture()
    expect(nav.call(h, p11.id, doc, pool, 1, 'horizontal', 0)).toEqual({ paraId: paraAfter.id, offset: 0 })
  })

  it('正文首段 ArrowUp 越界: 无移动 (返回 null)', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, paraBefore } = makeTableFixture()
    expect(nav.call(h, paraBefore.id, doc, pool, -1, 'vertical', 0)).toBeNull()
  })
})

describe('多段落 cell 内部导航', () => {
  /** 1×1 表格, cell 内含两个段落 p0/p1, body = [paraBefore, table, paraAfter] */
  function makeMultiParaCellFixture() {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)

    const p0 = mkPara(allNodes, 'one')
    const p1 = mkPara(allNodes, 'two')
    const cell = createTableCell([p0.id, p1.id])
    allNodes.set(cell.id, cell as unknown as BaseNode)
    const row = createTableRow([cell])
    const table = createTable([{ width: 100, mode: 'percentage' }], [row])
    for (const n of [table, row]) allNodes.set(n.id, n as unknown as BaseNode)

    const paraBefore = mkPara(allNodes, 'before')
    const paraAfter = mkPara(allNodes, 'after')
    doc.body.children = [paraBefore.id, table.id, paraAfter.id]

    const pool = buildNodePool(allNodes, { body: doc.id })
    return { doc, pool, table, cell, p0, p1, paraBefore, paraAfter }
  }

  it('cell 内 ArrowRight: 段首段落末尾 → 同 cell 下一段落开头', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p0, p1 } = makeMultiParaCellFixture()
    expect(nav.call(h, p0.id, doc, pool, 1, 'horizontal', 0)).toEqual({ paraId: p1.id, offset: 0 })
  })

  it('cell 内 ArrowDown: 段首段落 → 同 cell 下一段落 (保列)', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p0, p1 } = makeMultiParaCellFixture()
    expect(nav.call(h, p0.id, doc, pool, 1, 'vertical', 1)).toEqual({ paraId: p1.id, offset: 1 })
  })

  it('cell 内 ArrowUp: 末段 → 同 cell 上一段落', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p0, p1 } = makeMultiParaCellFixture()
    expect(nav.call(h, p1.id, doc, pool, -1, 'vertical', 0)).toEqual({ paraId: p0.id, offset: 0 })
  })

  it('cell 首段首字符 ArrowLeft: 越过 cell 边界跳出到上一正文段落末尾', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, p0, paraBefore } = makeMultiParaCellFixture()
    // paraBefore 'before' 长度 6
    expect(nav.call(h, p0.id, doc, pool, -1, 'horizontal', 0)).toEqual({ paraId: paraBefore.id, offset: 6 })
  })
})

describe('表格进入角点 (从正文进入表格)', () => {
  it('ArrowLeft 从表格后段落进入表格末行末列 cell', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, paraAfter, p11 } = makeTableFixture()
    expect(nav.call(h, paraAfter.id, doc, pool, -1, 'horizontal', 0)).toEqual({ paraId: p11.id, offset: 0 })
  })

  it('ArrowUp 从表格后段落进入表格末行首列 cell', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, paraAfter, p10 } = makeTableFixture()
    expect(nav.call(h, paraAfter.id, doc, pool, -1, 'vertical', 0)).toEqual({ paraId: p10.id, offset: 0 })
  })
})
