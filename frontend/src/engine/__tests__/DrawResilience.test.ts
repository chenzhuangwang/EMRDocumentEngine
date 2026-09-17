// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// P1 清理: 渲染容错接线 + 文档总高度单一来源
//
// ① ErrorRecovery 此前零调用, 而渲染路径**完全没有 try/catch** —— 单个节点
//    渲染抛错会中断整帧。现按节点包 safeRenderParticle (Level 1)。
// ② Editor.getTotalDocHeight 原先把公式**内联重写**了一遍, 而 LayeredRenderer
//    用的是 TableCoordUtil 的共享实现 —— 两份会各自漂移。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { particleRegistry } from '../render/particles/ParticleRegistry'
import type { IParticle } from '../render/particles/IParticle'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

function makeEditor(paraCount = 6) {
  const doc = createDocument('容错测试')
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

describe('渲染容错: 单个节点失败不中断整帧 (ErrorRecovery Level 1)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('某类粒子渲染抛错 → render() 不抛, 其余内容照常渲染', () => {
    const editor = makeEditor()
    const draw = editor.getDraw()

    // 先正常渲染一次, 确认基线可用
    expect(() => draw.render(editor.getPool(), editor.getStore().state.runtime)).not.toThrow()

    // 让文本粒子抛错 (monkey-patch 已注册实例, finally 还原)
    const textParticle = particleRegistry.get('text') as IParticle
    expect(textParticle).toBeDefined()
    const originalRender = textParticle.render
    textParticle.render = () => { throw new Error('boom: 模拟单个节点渲染失败') }

    try {
      // 关键: 不冒泡 —— 否则整帧渲染中断, 用户看到的是一片空白
      expect(() => draw.render(editor.getPool(), editor.getStore().state.runtime)).not.toThrow()
      expect(() => draw.renderPageToContext(
        document.createElement('canvas').getContext('2d')!, draw.getPages()[0], 794,
      )).not.toThrow()
    } finally {
      textParticle.render = originalRender
    }
  })

  it('还原后渲染恢复 (确认上面的成功不是因为永久禁用了粒子)', () => {
    const editor = makeEditor()
    const draw = editor.getDraw()
    const textParticle = particleRegistry.get('text') as IParticle
    const originalRender = textParticle.render
    textParticle.render = () => { throw new Error('boom') }
    draw.render(editor.getPool(), editor.getStore().state.runtime)
    textParticle.render = originalRender

    expect(() => draw.render(editor.getPool(), editor.getStore().state.runtime)).not.toThrow()
  })
})

describe('getTotalDocHeight: 与 TableCoordUtil 单一来源', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('等于「页高之和 + (N-1) × 页间距」(独立算一遍对照)', () => {
    const editor = makeEditor()
    const pages = editor.getDraw().getPages()
    const gap = editor.getDraw().getPageVerticalGap()

    expect(pages.length).toBeGreaterThan(0)
    const expected = pages.reduce((s, p) => s + p.height, 0) + (pages.length - 1) * gap
    expect(editor.getTotalDocHeight()).toBe(expected)
  })

  it('多页文档同样成立 (含分页间隙)', () => {
    const editor = makeEditor(60)
    const pages = editor.getDraw().getPages()
    const gap = editor.getDraw().getPageVerticalGap()
    expect(pages.length).toBeGreaterThan(1)          // 前置: 确实是多页
    const expected = pages.reduce((s, p) => s + p.height, 0) + (pages.length - 1) * gap
    expect(editor.getTotalDocHeight()).toBe(expected)
  })
})
