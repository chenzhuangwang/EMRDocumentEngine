// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ImageParticleBinding — 图片粒子渲染器 per-Draw 绑定 (回归)
//
// createImageParticle 携带 resolveUrl/onImageLoaded 闭包, 必须绑定到
// 每个 Draw 实例, 而不是注册进模块级单例 particleRegistry。
//
// 根因: particleRegistry 按 type 去重且跨实例共享; 若图片粒子注册进单例,
// React StrictMode / 路由切换导致编辑器卸载重挂载后, 第二个 Draw 会复用
// 首个 Draw 的陈旧闭包 (其 pool 已销毁), 图片按旧 pool 解析不到 URL →
// 只画灰色占位框, 表现为「图片插入不显示」。
//
// 修复: Draw 将图片粒子作为实例字段持有 (见 Draw.imageParticle),
// 单例 registry 中永远不存在 image 条目。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { particleRegistry } from '../render/particles'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

describe('图片粒子渲染器 (per-Draw 绑定)', () => {
  const cleanups: Array<() => void> = []

  function makeEditor(): Editor {
    const doc = createDocument('dn')
    const t = createTextNode('正文')
    const p = createParagraph([t.id])
    doc.body.children = [p.id]

    // Editor 构造走 loadDocumentFromObject → validate 校验引用不悬空,
    // 需把节点内嵌到 doc.nodes (与 serializeDocument 产物同构)。
    const nodes: Record<string, BaseNode> = {}
    for (const n of [doc, t, p]) nodes[n.id] = n as unknown as BaseNode
    ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes

    const host: DomEditorHost = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container)
    host.input.mount(container)
    const editor = new Editor(host, doc)
    cleanups.push(() => { editor.destroy(); container.remove() })
    return editor
  }

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!()
  })

  it('图片粒子绝不注册进模块级单例 registry (卸载重挂载后不残留陈旧闭包)', () => {
    // 模拟 React StrictMode 的「挂载 → 卸载 → 再挂载」
    const first = makeEditor()
    first.destroy()
    makeEditor()

    // 关键不变量: image 条目永远不在单例 registry 中, 而是 Draw 实例字段。
    // 若有人重新把图片粒子 register 进单例, 此断言立即失败 (重挂载 bug 复发)。
    expect(particleRegistry.has('image')).toBe(false)

    // 对照: 无状态粒子 (text) 仍走单例, 证明 registry 本身未被绕过/清空。
    expect(particleRegistry.has('text')).toBe(true)
  })
})
