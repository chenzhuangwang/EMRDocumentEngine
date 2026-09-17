// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ErrorRecovery 接线验证 (Level 2 / Level 3)
//
// `SystemModules.test.ts` 测的是三个 safe* 包装**自身**的行为; 这里测的是
// 它们**真的接在渲染/加载路径上了** —— 本仓库的高频陷阱正是"机制齐备、
// 零接线", 只测包装函数等于没测这条链路。
//
// 接线前的实际后果:
//   Level 2 未接 → 任一页抛错会冒泡出 rAF 回调, **整帧不画** (其余页 + 光标一起没)
//   Level 3 未接 → 损坏文档让 Editor.setDocument 直接抛, 导入静默失败
// ================================================================

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { setErrorReporter, EditorErrorCode, type EditorError } from '../ErrorRecovery'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

let errors: EditorError[]

beforeEach(() => {
  errors = []
  setErrorReporter((err) => errors.push(err))
})

afterEach(() => {
  document.body.innerHTML = ''
  // 还原默认 reporter, 免得影响后续测试文件 (单例, 跨用例仍在)
  setErrorReporter((err) => console.error(`[${err.code}] ${err.message}`))
})

function makeEditor(paraCount: number) {
  const doc = createDocument('容错接线测试')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)
  const ids: string[] = []
  for (let i = 0; i < paraCount; i++) {
    const t = createTextNode(`第 ${i} 段文字内容，这里放足够多的字让它折行占位。`.repeat(3))
    const p = createParagraph([t.id])
    nodes.set(t.id, t as unknown as BaseNode)
    nodes.set(p.id, p as unknown as BaseNode)
    ids.push(p.id)
  }
  doc.body.children = ids
  const raw: Record<string, BaseNode> = {}
  for (const [id, n] of nodes) raw[id] = n
  ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = raw

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)
  return editor
}

describe('Level 2 接线: 单页渲染失败只损失那一页', () => {
  it('某页抛错 → render() 不抛, 且后续页照常处理', () => {
    const editor = makeEditor(40)
    const draw = editor.getDraw()
    const pages = draw.getPages()
    expect(pages.length).toBeGreaterThanOrEqual(2)

    // jsdom 里视口高度为 0, 默认只命中 1 页 —— 显式放开可见范围, 才能验证
    // "第 1 页失败之后第 2 页仍被处理" 这条性质
    const le = (draw as unknown as {
      layoutEngine: { getVisiblePages: (...a: unknown[]) => { start: number; end: number } }
    }).layoutEngine
    const originalRange = le.getVisiblePages
    le.getVisiblePages = () => ({ start: 0, end: pages.length - 1 })

    // 让"页眉下方分隔线"抛错 —— 它不在 safeRenderParticle 的覆盖范围内,
    // 正是原先会冒泡出 rAF、导致整帧不画的那一类
    const target = draw as unknown as { drawHfSeparator: (...a: unknown[]) => void }
    const original = target.drawHfSeparator
    let calls = 0
    target.drawHfSeparator = (...args: unknown[]) => {
      calls++
      if (calls === 1) throw new Error('boom: 模拟第 1 页渲染失败')
      return original.apply(draw, args)
    }

    try {
      expect(() => draw.render(editor.getPool(), editor.getStore().state.runtime)).not.toThrow()
      // 第 1 页在第 1 次调用就炸了; 之后第 2 页的页眉/页脚两条分隔线仍要走完 → >= 3
      expect(calls).toBeGreaterThanOrEqual(3)
    } finally {
      target.drawHfSeparator = original
      le.getVisiblePages = originalRange
    }

    const renderErrors = errors.filter((e) => e.code === EditorErrorCode.E_RENDER_CONTEXT_LOST)
    expect(renderErrors.length).toBe(1)
    expect(renderErrors[0].context).toEqual({ pageIndex: 0 })
  })

  it('打印离屏渲染同样被兜住 (整页抛错 → 不冒泡)', () => {
    const editor = makeEditor(6)
    const draw = editor.getDraw()
    const target = draw as unknown as { paintPage: () => void }
    const original = target.paintPage
    target.paintPage = () => { throw new Error('boom: 打印整页失败') }

    try {
      expect(() => draw.renderPageToContext(
        document.createElement('canvas').getContext('2d')!, draw.getPages()[0], 794,
      )).not.toThrow()
    } finally {
      target.paintPage = original
    }

    expect(errors.filter((e) => e.code === EditorErrorCode.E_RENDER_CONTEXT_LOST).length).toBe(1)
  })
})

describe('Level 3 接线: 损坏文档不再让导入静默失败', () => {
  it('setDocument 收到无法加载的文档 → 回落到空白文档 + 上报, 不抛', () => {
    const editor = makeEditor(2)
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 版本号远高于当前模型 → loadDocumentFromObject 在 checkCompatibility 抛 too-new
    const corrupt = {
      type: 'document', id: 'corrupt', title: '坏文档',
      modelVersion: '99.0.0',
      body: { mode: 'flow', children: [] },
      header: [], footer: [],
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' },
    } as unknown as DocumentTree

    expect(() => editor.setDocument(corrupt)).not.toThrow()

    expect(errors.some((e) => e.code === EditorErrorCode.E_DOCUMENT_CORRUPTED)).toBe(true)
    // 回落文档必须是可用的空白文档, 而不是那份坏的
    const doc = editor.getStore().state.document!
    expect(doc.modelVersion).not.toBe('99.0.0')
    expect(doc.body.children).toEqual([])
    // 池与文档必须一致 —— 只换文档不换池会让渲染读到上一份
    expect(editor.getPool().nodes.get(doc.id)).toBeDefined()

    warn.mockRestore()
  })

  it('回落文档用 createDocument() 造 —— 默认值不抄第二份 (pageSetup 与工厂同源)', () => {
    const editor = makeEditor(2)
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reference = createDocument('参照')

    editor.setDocument({ not: 'a document' } as unknown as DocumentTree)

    const doc = editor.getStore().state.document!
    expect(doc.pageSetup).toEqual(reference.pageSetup)
    warn.mockRestore()
  })
})
