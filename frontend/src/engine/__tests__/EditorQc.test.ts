// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// Editor.runQC — 质控接入 (契约 §12.2)
//
// 背景: QCEngine 曾是一条完全断线的能力 —— 引擎 + 单测齐备, 但全仓零实例化、
// 面板零渲染。本文件锁住接通后的行为, 尤其是**只读派生** (不产生命令/不改文档)
// 与**问题可定位** (带 paragraphPath, 供面板点击跳转)。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createSmartTextNode, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, ElementMeta } from '../document/core/DocumentModel'

function el(name: string, required: boolean): ElementMeta {
  return { code: { internal: `CTL_${name}`, dataElement: 'DE01' }, name, format: { dataType: 'S1' }, required }
}

/** 标题 + 一段足够长的正文 + 一个 required 控件 (值可选) */
function makeEditor(opts: { withRequired?: boolean; fillValue?: string } = {}) {
  const doc = createDocument('入院记录')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)

  const t = createTextNode('患者一般情况良好，各项体征平稳，无特殊不适主诉。')
  nodes.set(t.id, t as unknown as BaseNode)
  const line = [t.id]

  if (opts.withRequired) {
    const st = createSmartTextNode('[姓名]', el('姓名', true))
    if (opts.fillValue !== undefined) st.value = opts.fillValue
    nodes.set(st.id, st as unknown as BaseNode)
    line.push(st.id)
  }

  const p = createParagraph(line)
  nodes.set(p.id, p as unknown as BaseNode)
  doc.body.children = [p.id]

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
  return { editor, doc, paraId: p.id }
}

describe('Editor.runQC (契约 §12.2)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('返回 QCResult, documentId 指向当前文档', () => {
    const { editor, doc } = makeEditor()
    const result = editor.runQC()
    expect(result.documentId).toBe(doc.id)
    expect(typeof result.score).toBe('number')
    expect(['A', 'B', 'C', 'D']).toContain(result.grade)
    expect(Array.isArray(result.issues)).toBe(true)
  })

  it('只读派生: 不产生命令, 不影响 undo 栈, 不改文档', () => {
    const { editor } = makeEditor({ withRequired: true })
    expect(editor.canUndo()).toBe(false)
    const before = JSON.stringify(editor.getSerializedDocument())

    editor.runQC()
    editor.runQC()

    expect(editor.canUndo()).toBe(false)
    expect(JSON.stringify(editor.getSerializedDocument())).toBe(before)
  })

  it('required 控件为空 → 报 qc_004, 且带 paragraphPath (供面板跳转)', () => {
    const { editor, paraId } = makeEditor({ withRequired: true })
    const issue = editor.runQC().issues.find(i => i.ruleId === 'qc_004')

    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('warning')
    expect(issue!.paragraphPath).toBeDefined()
    expect(issue!.paragraphPath![issue!.paragraphPath!.length - 1]).toBe(paraId)
  })

  it('填上 required 的值 → 重跑后 qc_004 消失 (实时反馈的基础)', () => {
    const { editor } = makeEditor({ withRequired: true, fillValue: '张三' })
    expect(editor.runQC().issues.some(i => i.ruleId === 'qc_004')).toBe(false)
  })

  it('问题随文档变化 (写完再跑≠旧结果)', () => {
    const { editor } = makeEditor({ withRequired: true })
    expect(editor.runQC().issues.some(i => i.ruleId === 'qc_004')).toBe(true)

    // 直接改值再跑 (不经命令, 只为验证 runQC 读的是当下状态而非缓存)
    const pool = editor.getPool()
    for (const [, n] of pool.nodes) {
      if (n.type === 'smarttext') pool.updateNode(n.id, { value: '李四' } as never)
    }
    expect(editor.runQC().issues.some(i => i.ruleId === 'qc_004')).toBe(false)
  })

  it('连续两次 runQC 结果独立 (无隐藏状态污染)', () => {
    const { editor } = makeEditor({ withRequired: true })
    const a = editor.runQC()
    const b = editor.runQC()
    expect(b.issues.length).toBe(a.issues.length)
    expect(b.score).toBe(a.score)
  })
})
