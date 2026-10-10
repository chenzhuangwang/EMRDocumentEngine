// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 插件观察通道接线 (Editor → EventBus → PluginManager → 插件)
//
// `SystemModules.test.ts` 测的是 PluginManager **自身**能派发钩子; 这里测的是
// 引擎那两条事件**真的转到了**插件 —— 少了 Editor 里那两行转发, PluginManager
// 的钩子再完备也永远收不到东西 (本仓库的高频缺陷: 机制齐备、零接线)。
//
// 接线前的事实: `cursor:moved` / `scale:changed` 由 CommandManager / Draw 发出,
// 但全仓没有任何订阅者 —— 是 emit 给空气的空通道。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import type { PluginContext } from '../plugins/PluginManager'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import type { CursorState } from '../state/EditorRuntimeState'

function makeEditor() {
  const doc = createDocument('插件观察测试')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)
  const t = createTextNode('内容')
  const p = createParagraph([t.id])
  nodes.set(t.id, t as unknown as BaseNode)
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
  return editor
}

/** 注册一个只做观察的插件, 返回它收到的东西 */
function observe(editor: Editor, id = 'observer') {
  const cursors: CursorState[] = []
  const scales: number[] = []
  const plugin = {
    id, name: id, version: '1', enabled: false,
    install(ctx: PluginContext) {
      ctx.onCursorMoved((c) => cursors.push(c))
      ctx.onScaleChanged((s) => scales.push(s))
    },
    enable() { (this as { enabled: boolean }).enabled = true },
    disable() { (this as { enabled: boolean }).enabled = false },
    destroy() {},
  }
  editor.getPluginManager().register(plugin)
  return { plugin, cursors, scales }
}

afterEach(() => { document.body.innerHTML = '' })

describe('插件观察通道', () => {
  it('EventBus 的 cursor:moved → 插件收到光标', () => {
    const editor = makeEditor()
    const { cursors } = observe(editor)

    const cursor: CursorState = { paragraphPath: ['nd_x'], offset: 2, visible: true }
    editor.getEventBus().emit('cursor:moved', cursor)

    expect(cursors).toEqual([cursor])
  })

  it('setScale → 插件收到缩放 (经 Draw 的 scale:changed 转出)', () => {
    const editor = makeEditor()
    const { scales } = observe(editor)

    editor.setScale(1.5)

    expect(scales).toEqual([1.5])
  })

  it('禁用的插件收不到 (观察通道同样遵守 disable 语义)', () => {
    const editor = makeEditor()
    const { plugin, cursors, scales } = observe(editor)

    plugin.disable()
    editor.getEventBus().emit('cursor:moved', { paragraphPath: [], offset: 0, visible: true })
    editor.setScale(2)

    expect(cursors.length).toBe(0)
    expect(scales.length).toBe(0)

    plugin.enable()
    editor.getEventBus().emit('cursor:moved', { paragraphPath: [], offset: 1, visible: true })
    expect(cursors.length).toBe(1)
  })

  it('卸载后收不到 (destroy 之后不该还在被回调)', () => {
    const editor = makeEditor()
    const { cursors } = observe(editor)
    const mgr = editor.getPluginManager()

    mgr.unregister('observer')
    editor.getEventBus().emit('cursor:moved', { paragraphPath: [], offset: 0, visible: true })

    expect(cursors.length).toBe(0)
  })

  it('内置 demo 插件也在同一条通道上 (它注册了缩放观察)', () => {
    const editor = makeEditor()
    const ids = editor.getPluginManager().getPlugins().map((p) => p.id)

    expect(ids).toContain('emr.demo')
    // 它已注册钩子 → 派发不抛
    expect(() => editor.setScale(1.25)).not.toThrow()
  })
})
