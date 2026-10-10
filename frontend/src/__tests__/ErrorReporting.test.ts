// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 引擎错误上报链路 — ErrorRecovery → reporter → store → StatusBar
//
// 这条链路的每一环单独看都很小, 但"最后一段没接上"正是本仓库的高频缺陷
// (机制齐备、零接线)。所以端到端测: 引擎报一条错, store 里必须真的出现它。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'
import { reportError, EditorErrorCode, setErrorReporter, safeRenderPage } from '@emrde/document-engine'
import { installErrorReporter } from '../errorReporting'
import { documentLoaderRegistry } from '@emrde/document-engine'
import { useEditorStore } from '../store'

const store = () => useEditorStore.getState()

beforeEach(() => {
  useEditorStore.setState({ lastEngineError: null })
  installErrorReporter()
})

afterEach(() => {
  // 还原默认 reporter: 它是引擎级单例, 会跨测试文件存活
  setErrorReporter((err) => console.error(`[${err.code}] ${err.message}`))
  useEditorStore.setState({ lastEngineError: null })
})

describe('错误上报落点', () => {
  it('引擎报错 → store 收到 (端到端)', () => {
    reportError({ code: EditorErrorCode.E_DOCUMENT_CORRUPTED, message: '导入失败：文件损坏' })

    expect(store().lastEngineError).toEqual({
      code: 'E_DOCUMENT_CORRUPTED',
      message: '导入失败：文件损坏',
    })
  })

  it('safeRenderPage 内部报的错也走同一条链路', () => {
    safeRenderPage(() => { throw new Error('boom') }, 3)

    expect(store().lastEngineError?.code).toBe('E_RENDER_CONTEXT_LOST')
    expect(store().lastEngineError?.message).toContain('pageIndex=3')
  })

  it('同一条错误重复上报不改动 state —— 逐帧失败会每帧报一次', () => {
    const err = { code: EditorErrorCode.E_RENDER_CONTEXT_LOST, message: '页面渲染失败: pageIndex=0' }
    reportError(err)
    const first = store().lastEngineError

    reportError(err)
    // 引用不变 → 订阅者不会重渲染 (状态栏不会被每帧刷一次)
    expect(store().lastEngineError).toBe(first)
  })

  it('换一条错误则正常更新', () => {
    reportError({ code: EditorErrorCode.E_UNKNOWN, message: '第一条' })
    reportError({ code: EditorErrorCode.E_UNKNOWN, message: '第二条' })

    expect(store().lastEngineError?.message).toBe('第二条')
  })
})

describe('关闭之后再弹的规则', () => {
  it('关闭后同一条错误不再弹 —— 否则逐帧失败时那条提示永远关不掉', () => {
    const err = { code: EditorErrorCode.E_RENDER_CONTEXT_LOST, message: '页面渲染失败: pageIndex=0(反复)' }
    reportError(err)
    expect(store().lastEngineError).not.toBeNull()

    store().dismissEngineError()
    expect(store().lastEngineError).toBeNull()

    reportError(err)
    expect(store().lastEngineError).toBeNull()
  })

  it('关闭后换一条 (不同的 code 或 message) 照常显示', () => {
    const err = { code: EditorErrorCode.E_RENDER_CONTEXT_LOST, message: '页面渲染失败: pageIndex=1(反复)' }
    reportError(err)
    store().dismissEngineError()

    reportError({ code: EditorErrorCode.E_DOCUMENT_CORRUPTED, message: '导入失败：x' })
    expect(store().lastEngineError?.code).toBe('E_DOCUMENT_CORRUPTED')
  })

  it('没有错误时关闭是安全的', () => {
    expect(() => store().dismissEngineError()).not.toThrow()
    expect(store().lastEngineError).toBeNull()
  })
})

describe('导入路径: 不再把"读不动"报成"格式不支持"', () => {
  const tooNew = JSON.stringify({
    type: 'document', id: 'x', title: 't', modelVersion: '99.0.0',
    body: { mode: 'flow', children: [] }, header: [], footer: [],
  })

  it('认领了但读不动 → 抛 + 上报真实原因 (带上 loader 名)', () => {
    // 原先 registry.load 把异常吞成 null, 上层只能笼统报"无法识别格式" ——
    // 用户被告知的方向是错的 (文件格式明明认得, 是版本/结构的问题)
    expect(() => documentLoaderRegistry.load(tooNew, 'x.json')).toThrow()
    expect(store().lastEngineError?.message).toContain('JSON')
    expect(store().lastEngineError?.message).toContain('加载失败')
  })

  it('没有 loader 认领 → 返回 null, 不抛也不上报 (这是"格式不支持", 由调用方去说)', () => {
    expect(documentLoaderRegistry.load('just plain text', 'x.txt')).toBeNull()
    expect(store().lastEngineError).toBeNull()
  })
})

describe('入口接线守卫', () => {
  it('main.tsx 必须真的调用 installErrorReporter —— 删掉它没有任何测试会红', () => {
    // 这是本仓库的招牌缺陷: 模块写好了、测试也齐了, 但入口那一行没人接。
    // 静态断言不优雅, 但它守的是一条**没有任何运行时测试能覆盖到**的接线
    // (main.tsx 是应用入口, 测它要拉起整个 App)。
    const main = readFileSync(join(cwd(), 'src/main.tsx'), 'utf8')
    expect(main).toMatch(/^\s*installErrorReporter\(\)/m)
  })
})
