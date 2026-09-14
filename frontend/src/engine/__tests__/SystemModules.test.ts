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
  safeRenderParticle, safeLoadDocument, safeAsync,
  EditorErrorCode, setErrorReporter,
} from '../ErrorRecovery'
import { PluginManager } from '../plugins/PluginManager'

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

  it('should safe load valid document', () => {
    const result = safeLoadDocument(() => ({
      type: 'document' as const, id: 'test', title: 'OK',
      body: { mode: 'flow' as const, children: [] },
      header: [], footer: [],
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' as const },
    }))
    expect(result.recovered).toBe(false)
    expect(result.doc.title).toBe('OK')
  })

  it('should recover from corrupt document', () => {
    const result = safeLoadDocument(() => { throw new Error('corrupt') }, 'Recovered')
    expect(result.recovered).toBe(true)
    expect(result.doc.title).toBe('Recovered')
    expect(result.doc.body.children).toEqual([])
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
      enable() {}, disable() {}, destroy() {},
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
      enable() {}, disable() {}, destroy() {},
    })

    expect(mgr.getToolbarActions().length).toBe(1)
    expect(mgr.getToolbarActions()[0].id).toBe('custom_action')
  })
})
