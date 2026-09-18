// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// System modules 综合测试 (R86-R88)
// PerformanceMetrics + ErrorRecovery + PluginManager
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { PerformanceMetrics } from '../PerformanceMetrics'
import { testHost } from './helpers'
import {
  safeRenderParticle, safeRenderPage, safeLoadDocument, safeAsync,
  EditorErrorCode, setErrorReporter,
} from '../ErrorRecovery'
import { PluginManager } from '../plugins/PluginManager'

/**
 * 记录绘制指令的最小 canvas 替身 —— 只关心"占位图落在哪块区域",
 * 不需要真的画 (jsdom 的 canvas 是桩, 拿不到像素)。
 */
function fakeCtx(ops: string[]): CanvasRenderingContext2D {
  return {
    canvas: { width: 800, height: 600 },
    save() {}, restore() {},
    set fillStyle(_v: string) {}, get fillStyle() { return '' },
    set font(_v: string) {}, get font() { return '' },
    set textAlign(_v: string) {}, get textAlign() { return 'start' },
    fillRect(x: number, y: number, w: number, h: number) { ops.push(`fillRect:${x},${y},${w},${h}`) },
    fillText(t: string) { ops.push(`text:${t}`) },
  } as unknown as CanvasRenderingContext2D
}

// ---- PerformanceMetrics ----

describe('PerformanceMetrics', () => {
  let pm: PerformanceMetrics

  beforeEach(() => {
    pm = new PerformanceMetrics(testHost)
    pm.clear()
  })

  it('should record render frame metrics', () => {
    pm.recordRenderFrame(16.5)
    pm.recordRenderFrame(12.3)
    pm.recordRenderFrame(25.1)
    const summary = pm.summarize()
    expect(summary.avgRenderFrameTime).toBeGreaterThan(0)
    expect(summary.sampleCount).toBe(3)
  })

  it('should record layout metrics', () => {
    pm.recordLayout(45.2, 10)
    const entries = pm.getEntries()
    expect(entries[0].name).toBe('layout')
    expect(entries[0].tags?.pages).toBe(10)
  })

  it('should record keystroke metrics', () => {
    pm.recordKeystroke(8.3)
    pm.recordKeystroke(12.1)
    const summary = pm.summarize()
    expect(summary.avgKeystrokeLatency).toBeGreaterThan(0)
  })

  it('should compute P95 correctly', () => {
    for (let i = 0; i < 100; i++) pm.recordRenderFrame(16)
    pm.recordRenderFrame(100) // outlier
    const summary = pm.summarize()
    expect(summary.p95RenderFrameTime).toBeGreaterThanOrEqual(16)
  })
})

// ---- ErrorRecovery ----

describe('ErrorRecovery', () => {
  let errors: unknown[]

  beforeEach(() => {
    errors = []
    setErrorReporter((err) => errors.push(err))
  })

  it('should safe render particle without crash', () => {
    const ok = safeRenderParticle(() => { /* success */ }, 'node_1')
    expect(ok).toBe(true)
    expect(errors.length).toBe(0)
  })

  it('should catch particle render error', () => {
    const ok = safeRenderParticle(() => { throw new Error('render fail') }, 'node_x')
    expect(ok).toBe(false)
    expect(errors.length).toBe(1)
    expect((errors[0] as { code: string }).code).toBe(EditorErrorCode.E_PARTICLE_RENDER_FAILED)
  })

  it('safeLoadDocument: 成功 → 原值透传, recovered=false', () => {
    const result = safeLoadDocument(() => ({ title: 'OK' }), () => ({ title: '恢复的文档' }))
    expect(result.recovered).toBe(false)
    expect(result.value.title).toBe('OK')
    expect(errors.length).toBe(0)
  })

  it('safeLoadDocument: 失败 → 用调用方给的回落值 + 上报, 不抛', () => {
    const result = safeLoadDocument<{ title: string }>(
      () => { throw new Error('corrupt') },
      () => ({ title: '恢复的文档' }),
    )
    expect(result.recovered).toBe(true)
    expect(result.value.title).toBe('恢复的文档')
    expect(errors.length).toBe(1)
    expect((errors[0] as { code: string }).code).toBe(EditorErrorCode.E_DOCUMENT_CORRUPTED)
  })

  it('safeLoadDocument: 回落本身也失败 → 抛原始错误, 且两个错误都被上报', () => {
    expect(() => safeLoadDocument(
      () => { throw new Error('primary') },
      () => { throw new Error('fallback') },
    )).toThrow('primary')

    // 回落失败必须单独可见 —— 否则"容错"等于静默吞掉两类错误
    expect(errors.length).toBe(2)
    expect((errors[1] as { message: string }).message).toContain('回落文档同样加载失败')
  })

  it('safeRenderPage: 给了 rect 只覆盖那一页 —— 否则一页出错会刷满整屏', () => {
    const ops: string[] = []
    const ctx = fakeCtx(ops)

    const ok = safeRenderPage(
      () => { throw new Error('boom') }, 2, ctx, { x: 0, y: 100, width: 200, height: 300 },
    )

    expect(ok).toBe(false)
    expect(ops).toContain('fillRect:0,100,200,300')
    expect(ops).not.toContain(`fillRect:0,0,${ctx.canvas.width},${ctx.canvas.height}`)
    expect(ops.some((o) => o.startsWith('text:页面 3 渲染失败'))).toBe(true)
    expect(errors.length).toBe(1)
  })

  it('safeRenderPage: 不给 rect 则铺满整张 canvas (离屏单页渲染的用法)', () => {
    const ops: string[] = []
    const ctx = fakeCtx(ops)

    safeRenderPage(() => { throw new Error('boom') }, 0, ctx)

    expect(ops).toContain(`fillRect:0,0,${ctx.canvas.width},${ctx.canvas.height}`)
  })

  it('safeRenderPage: 单页失败不影响后续页 (返回值 false 而不是抛)', () => {
    const ctx = fakeCtx([])
    expect(safeRenderPage(() => { throw new Error('x') }, 1, ctx)).toBe(false)
    expect(safeRenderPage(() => { /* ok */ }, 2, ctx)).toBe(true)
  })

  it('should safeAsync return null on error', async () => {
    const result = await safeAsync(
      async () => { throw new Error('fail') },
      EditorErrorCode.E_UNKNOWN, 'test error',
    )
    expect(result).toBeNull()
  })

  it('should safeAsync return value on success', async () => {
    const result = await safeAsync(async () => 'hello')
    expect(result).toBe('hello')
  })
})

// ---- PluginManager ----

describe('PluginManager', () => {
  it('should register and get plugins', () => {
    const mgr = new PluginManager()
    const plugin = {
      id: 'test_plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      enabled: false,
      install: () => {},
      enable() { (this as { enabled: boolean }).enabled = true },
      disable() { (this as { enabled: boolean }).enabled = false },
      destroy() {},
    }
    mgr.register(plugin)
    expect(mgr.getPlugins().length).toBe(1)
    expect(mgr.getPlugins()[0].id).toBe('test_plugin')
  })

  it('should not register duplicate plugin', () => {
    const mgr = new PluginManager()
    const plugin = {
      id: 'dup', name: 'Dup', version: '1', enabled: false,
      install: () => {}, enable() {}, disable() {}, destroy() {},
    }
    mgr.register(plugin)
    mgr.register(plugin)
    expect(mgr.getPlugins().length).toBe(1)
  })

  it('should emit command hooks', () => {
    const mgr = new PluginManager()
    const beforeLog: unknown[] = []
    const afterLog: unknown[] = []

    mgr.register({
      id: 'hook_test', name: 'Hook Test', version: '1', enabled: false,
      install(ctx) {
        ctx.onCommandBefore((cmd) => beforeLog.push(cmd))
        ctx.onCommandAfter((cmd) => afterLog.push(cmd))
      },
      // enable 必须真的置位: 派发会按 enabled 过滤 (契约: disable = 保留扩展但不响应)
      enable() { (this as { enabled: boolean }).enabled = true },
      disable() { (this as { enabled: boolean }).enabled = false },
      destroy() {},
    })

    const hooks = mgr.getHook()
    hooks.emitCommandBefore({ type: 'insert' })
    hooks.emitCommandAfter({ type: 'insert' })

    expect(beforeLog.length).toBe(1)
    expect(afterLog.length).toBe(1)
  })

  it('should get toolbar actions', () => {
    const mgr = new PluginManager()
    mgr.register({
      id: 'tb_test', name: 'TB', version: '1', enabled: false,
      install(ctx) {
        ctx.registerToolbarAction({
          id: 'custom_action',
          label: 'Custom',
          icon: 'Star',
          onClick: () => {},
        })
      },
      enable() { (this as { enabled: boolean }).enabled = true },
      disable() { (this as { enabled: boolean }).enabled = false },
      destroy() {},
    })

    expect(mgr.getToolbarActions().length).toBe(1)
    expect(mgr.getToolbarActions()[0].id).toBe('custom_action')
  })
})

// ---- PluginManager — 启停/卸载语义 + 观察通道 ----

/** 好插件: enable/disable 真的置位 (派发按 enabled 过滤) */
function makePlugin(id: string, install: (ctx: import('../plugins/PluginManager').PluginContext) => void) {
  return {
    id, name: id, version: '1', enabled: false,
    install,
    enable() { (this as { enabled: boolean }).enabled = true },
    disable() { (this as { enabled: boolean }).enabled = false },
    destroy() {},
  }
}

describe('PluginManager — 观察通道与启停', () => {
  it('cursor / scale 钩子收到真实载荷', () => {
    const mgr = new PluginManager()
    const cursors: unknown[] = []
    const scales: number[] = []
    mgr.register(makePlugin('observer', (ctx) => {
      ctx.onCursorMoved((c) => cursors.push(c))
      ctx.onScaleChanged((s) => scales.push(s))
    }))

    const hooks = mgr.getHook()
    hooks.emitCursorMoved({ paragraphPath: ['p1'], offset: 3, visible: true })
    hooks.emitScaleChanged(1.5)

    expect(cursors).toEqual([{ paragraphPath: ['p1'], offset: 3, visible: true }])
    expect(scales).toEqual([1.5])
  })

  it('disable 后不再响应 (契约: 保留已注册扩展, 不响应), 重新 enable 恢复', () => {
    const mgr = new PluginManager()
    const seen: unknown[] = []
    const plugin = makePlugin('toggle', (ctx) => { ctx.onCursorMoved((c) => seen.push(c)) })
    mgr.register(plugin)

    mgr.getHook().emitCursorMoved({ paragraphPath: [], offset: 0, visible: true })
    expect(seen.length).toBe(1)

    plugin.disable()
    mgr.getHook().emitCursorMoved({ paragraphPath: [], offset: 1, visible: true })
    expect(seen.length).toBe(1)   // 禁用期间不该收到

    plugin.enable()
    mgr.getHook().emitCursorMoved({ paragraphPath: [], offset: 2, visible: true })
    expect(seen.length).toBe(2)
  })

  it('unregister 摘掉该插件的钩子与工具栏按钮 (destroy 之后不该还在响应)', () => {
    const mgr = new PluginManager()
    const seen: unknown[] = []
    mgr.register(makePlugin('gone', (ctx) => {
      ctx.onCursorMoved((c) => seen.push(c))
      ctx.registerToolbarAction({ id: 'a', label: 'A', icon: 'Star', onClick: () => {} })
    }))
    expect(mgr.getToolbarActions().length).toBe(1)

    mgr.unregister('gone')

    expect(mgr.getToolbarActions().length).toBe(0)
    mgr.getHook().emitCursorMoved({ paragraphPath: [], offset: 0, visible: true })
    expect(seen.length).toBe(0)
  })

  it('卸载一个插件不影响另一个', () => {
    const mgr = new PluginManager()
    const aSeen: unknown[] = []
    mgr.register(makePlugin('a', (ctx) => { ctx.onCursorMoved((c) => aSeen.push(c)) }))
    mgr.register(makePlugin('b', (ctx) => { ctx.onCursorMoved(() => {}) }))

    mgr.unregister('b')
    mgr.getHook().emitCursorMoved({ paragraphPath: [], offset: 0, visible: true })

    expect(aSeen.length).toBe(1)
  })
})
