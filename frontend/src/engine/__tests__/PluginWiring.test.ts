// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 插件系统接线 (契约 §12) — 接线审计 P2
//
// 背景: PluginManager 框架齐备, 但
//   ① register 后从未 enable() —— 生命周期停在第 1 步;
//   ② getHook() 的 6 类发射器零调用 —— 插件的钩子永不触发;
//   ③ PluginContext.registerParticle 是空 stub (注释写"由 ParticleRegistry
//      桥接"但没人桥);
//   ④ getToolbarActions() 零调用 —— 插件注册的按钮无处可去。
// 本文件锁住修好后的行为。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { particleRegistry } from '../render/particles/ParticleRegistry'
import { InsertTextCommand } from '../command/commands/InsertTextCommand'
import { generateCommandId } from '../command/ICommand'
import type { IPlugin, PluginContext } from '../plugins/PluginManager'
import type { IParticle } from '../render/particles/IParticle'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

/** 记录所有生命周期与钩子调用 */
function makeProbePlugin() {
  const calls: string[] = []
  let enabledFlag = false
  const plugin: IPlugin = {
    id: 'test.probe', name: 'Probe', version: '1.0.0',
    // IPlugin.enabled 是只读 —— 用 getter 实现, 断言走 calls 而非直接改字段
    get enabled() { return enabledFlag },
    install(ctx: PluginContext) {
      calls.push('install')
      ctx.onCommandBefore(() => calls.push('commandBefore'))
      ctx.onCommandAfter(() => calls.push('commandAfter'))
      ctx.onBeforeSave((d) => { calls.push('beforeSave'); return d })
      ctx.onAfterLoad((d) => { calls.push('afterLoad'); return d })
      ctx.onBeforeLayout(() => calls.push('beforeLayout'))
      ctx.onAfterLayout(() => calls.push('afterLayout'))
      ctx.registerToolbarAction({ id: 'probe.hello', label: '探针', icon: 'puzzle', onClick: () => calls.push('toolbarClick') })
      ctx.registerParticle({
        type: 'probe_particle',
        render: () => { /* noop */ },
      } as unknown as IParticle)
    },
    enable() { calls.push('enable'); enabledFlag = true },
    disable() { calls.push('disable'); enabledFlag = false },
    destroy() { calls.push('destroy') },
  }
  return { plugin, calls }
}

function makeEditor() {
  const doc = createDocument('插件测试')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)
  const t = createTextNode('正文')
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
  return { editor, doc, paraId: p.id }
}

describe('插件系统接线 (契约 §12)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('register → install 且 enable (生命周期不再停在 install)', () => {
    const { editor } = makeEditor()
    const { plugin, calls } = makeProbePlugin()
    editor.getPluginManager().register(plugin)

    expect(calls).toContain('install')
    expect(calls).toContain('enable')
    expect(plugin.enabled).toBe(true)
  })

  it('unregister → disable 且 destroy', () => {
    const { editor } = makeEditor()
    const { plugin, calls } = makeProbePlugin()
    editor.getPluginManager().register(plugin)
    editor.getPluginManager().unregister('test.probe')

    expect(calls).toContain('disable')
    expect(calls).toContain('destroy')
  })

  it('命令执行 → commandBefore / commandAfter 各触发一次', () => {
    const { editor, paraId, doc } = makeEditor()
    const { plugin, calls } = makeProbePlugin()
    editor.getPluginManager().register(plugin)
    calls.length = 0

    editor.execCommand(new InsertTextCommand(
      generateCommandId(), Date.now(), 'user', [doc.id, paraId], 0, 'X',
    ))

    expect(calls.filter(c => c === 'commandBefore')).toHaveLength(1)
    expect(calls.filter(c => c === 'commandAfter')).toHaveLength(1)
  })

  it('重新加载文档 → afterLoad 触发', () => {
    const { editor } = makeEditor()
    const { plugin, calls } = makeProbePlugin()
    editor.getPluginManager().register(plugin)
    calls.length = 0

    const fresh = createDocument('第二份')
    const t = createTextNode('x')
    const p = createParagraph([t.id])
    const raw: Record<string, BaseNode> = {}
    raw[fresh.id] = fresh as unknown as BaseNode
    raw[t.id] = t as unknown as BaseNode
    raw[p.id] = p as unknown as BaseNode
    fresh.body.children = [p.id]
    ;(fresh as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = raw

    editor.setDocument(fresh)
    expect(calls).toContain('afterLoad')
  })

  it('序列化 → beforeSave 触发 (且只影响产物, 不回写运行时文档)', () => {
    const { editor } = makeEditor()
    const { plugin, calls } = makeProbePlugin()
    editor.getPluginManager().register(plugin)
    calls.length = 0

    const before = editor.getDocument().title
    editor.getSerializedDocument()

    expect(calls).toContain('beforeSave')
    expect(editor.getDocument().title).toBe(before)
  })

  it('布局 → beforeLayout / afterLayout 环绕 (含 setDocument 的初始布局)', () => {
    const { editor } = makeEditor()
    const { plugin, calls } = makeProbePlugin()
    editor.getPluginManager().register(plugin)
    calls.length = 0

    const fresh = createDocument('第三份')
    const t = createTextNode('y')
    const p = createParagraph([t.id])
    const raw: Record<string, BaseNode> = {}
    raw[fresh.id] = fresh as unknown as BaseNode
    raw[t.id] = t as unknown as BaseNode
    raw[p.id] = p as unknown as BaseNode
    fresh.body.children = [p.id]
    ;(fresh as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = raw
    editor.setDocument(fresh)

    const before = calls.filter(c => c === 'beforeLayout').length
    const after = calls.filter(c => c === 'afterLayout').length
    expect(before).toBeGreaterThan(0)
    expect(after).toBe(before)          // 成对, 不漏 after
  })

  it('registerParticle → 落到 ParticleRegistry (不再是空 stub)', () => {
    const { editor } = makeEditor()
    const { plugin } = makeProbePlugin()
    // 注: particleRegistry 是模块级单例, 跨用例共享 —— 只断言"注册后存在",
    // 不断言初始不存在 (前面的用例可能已注册过)。
    editor.getPluginManager().register(plugin)
    expect(particleRegistry.has('probe_particle')).toBe(true)
  })

  it('getPluginToolbarActions → UI 能拿到插件注册的按钮', () => {
    const { editor } = makeEditor()
    const { plugin, calls } = makeProbePlugin()
    editor.getPluginManager().register(plugin)

    const actions = editor.getPluginToolbarActions()
    expect(actions.map(a => a.id)).toContain('probe.hello')

    actions.find(a => a.id === 'probe.hello')!.onClick()
    expect(calls).toContain('toolbarClick')
  })
})
