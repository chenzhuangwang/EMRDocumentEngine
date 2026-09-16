// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 水印 (契约 §12.4) — 设置 / 移除 / 读取 / undo / 序列化往返 / 换文档不残留
//
// 背景: 水印曾是一条完全断线的能力 (WatermarkDialog 零 import、
// setWatermark 零调用), 且 API 只有"设"没有"删"。本文件锁住接通后的行为,
// 尤其是**移除路径**与**切文档清除** —— 少了任一条, 水印就会变成
// "能设不能删 / 换文档残留上一份"的半成品。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { loadDocumentFromObject } from '../document/io/DocumentLoader'
import type { BaseNode, DocumentTree, WatermarkConfig } from '../document/core/DocumentModel'

const WM: WatermarkConfig = {
  type: 'tile', text: '内部资料', fontSize: 48, color: '#000000',
  opacity: 0.08, rotation: 45, spacing: 200,
}

function makeDoc(marker: string, watermark?: WatermarkConfig): DocumentTree {
  const doc = createDocument(marker)
  const t = createTextNode('正文')
  const p = createParagraph([t.id])
  doc.body.children = [p.id]
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode
  nodes[t.id] = t as unknown as BaseNode
  nodes[p.id] = p as unknown as BaseNode
  ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes
  if (watermark && doc.pageSetup) doc.pageSetup.watermark = { ...watermark }
  return doc
}

function makeEditor(watermark?: WatermarkConfig): { editor: Editor; doc: DocumentTree } {
  const doc = makeDoc('水印', watermark)
  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)
  return { editor, doc }
}

describe('Editor 水印 API (契约 §12.4)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('初始无水印 → getWatermark() 为 undefined', () => {
    const { editor } = makeEditor()
    expect(editor.getWatermark()).toBeUndefined()
  })

  it('setWatermark(config) → 写入 doc.pageSetup.watermark 且可读回', () => {
    const { editor } = makeEditor()
    editor.setWatermark(WM)

    expect(editor.getWatermark()).toMatchObject({ type: 'tile', text: '内部资料', opacity: 0.08 })
    expect(editor.getDocument().pageSetup?.watermark?.text).toBe('内部资料')
  })

  it('setWatermark(null) → 移除水印 (不是留下空壳对象)', () => {
    const { editor } = makeEditor(WM)
    expect(editor.getWatermark()).toBeDefined()

    editor.setWatermark(null)
    expect(editor.getWatermark()).toBeUndefined()
    expect(editor.getDocument().pageSetup?.watermark).toBeUndefined()
  })

  it('设置与移除都可 undo (文档内容变更 → 走命令)', () => {
    const { editor } = makeEditor()

    editor.setWatermark(WM)
    expect(editor.canUndo()).toBe(true)
    editor.undo()
    expect(editor.getWatermark()).toBeUndefined()

    editor.redo()
    expect(editor.getWatermark()?.text).toBe('内部资料')

    editor.setWatermark(null)
    expect(editor.getWatermark()).toBeUndefined()
    editor.undo()
    expect(editor.getWatermark()?.text).toBe('内部资料')
  })

  it('图片水印的 imageUrl/imageScale 一并保留 (契约 §12.4)', () => {
    const { editor } = makeEditor()
    editor.setWatermark({ type: 'image', imageUrl: 'data:image/png;base64,AAA', imageScale: 0.4 })
    expect(editor.getWatermark()).toMatchObject({
      type: 'image', imageUrl: 'data:image/png;base64,AAA', imageScale: 0.4,
    })
  })

  it('序列化 → 加载 往返保留水印', () => {
    const { editor } = makeEditor()
    editor.setWatermark(WM)

    // getSerializedDocument 返回 JSON 字符串 (不是对象)
    const json = JSON.parse(editor.getSerializedDocument()) as unknown
    const reloaded = loadDocumentFromObject(json)
    expect(reloaded.doc.pageSetup?.watermark?.text).toBe('内部资料')
  })

  it('移除后序列化不含 watermark 键 (缺失 = 无水印)', () => {
    const { editor } = makeEditor(WM)
    editor.setWatermark(null)

    const json = JSON.parse(editor.getSerializedDocument()) as { pageSetup?: Record<string, unknown> }
    expect(json.pageSetup).toBeDefined()                     // 前置: pageSetup 本身还在
    expect('watermark' in (json.pageSetup ?? {})).toBe(false)
  })

  it('切换到无水印文档 → 旧水印被清除, 不残留', () => {
    const { editor } = makeEditor(WM)
    expect(editor.getWatermark()).toBeDefined()

    const next = makeDoc('第二份')          // 无 watermark
    editor.setDocument(next)
    expect(editor.getWatermark()).toBeUndefined()
  })

  it('切换到有水印文档 → 应用新文档的水印 (不是沿用旧的)', () => {
    const { editor } = makeEditor(WM)

    const next = makeDoc('第二份', { ...WM, text: '第二份的水印' })
    editor.setDocument(next)
    expect(editor.getWatermark()?.text).toBe('第二份的水印')
  })
})
