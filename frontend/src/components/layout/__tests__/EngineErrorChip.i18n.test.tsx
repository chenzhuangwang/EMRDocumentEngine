// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 引擎错误提示随语言变 (i18n 引擎层接线闸门 — EngineErrorChip 篇)
//
// store.lastEngineError 里的 message 是**上报那一刻展开的快照**, 切语言不会变。
// 本批让引擎的错误带上 key+params, 状态栏现译 —— 这里用真实 StatusBar 组件
// 端到端守住: 切语言后那条**已显示**的提示真的换了语言, 而不是停在旧文案。
//
// 同时守住去重键: 若拿 message (随语言变) 做键, 切一次语言同一条错误就会
// 被当成"新错误"重新弹出 —— 用户关不掉。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { EditorContext, type EditorContextValue } from '../../editor/EditorProvider'
import { StatusBar } from '../StatusBar'
import { EditorStore } from '@/engine/state/EditorStore'
import { reportError, EditorErrorCode, setErrorReporter, locale } from '@/engine'
import { bootstrapLocale } from '@/i18n/bootstrap'
import { installErrorReporter } from '@/errorReporting'
import { useEditorStore } from '@/store'

beforeEach(() => {
  bootstrapLocale()
})
afterEach(() => {
  locale.setLocale('zh-CN')
  setErrorReporter((err) => console.error(`[${err.code}] ${err.message}`))
  useEditorStore.setState({ lastEngineError: null })
})

function renderStatusBar() {
  const store = new EditorStore()
  const value: EditorContextValue = { editorRef: { current: null }, ready: true, store }
  render(
    <EditorContext.Provider value={value}>
      <StatusBar wordCount={0} />
    </EditorContext.Provider>,
  )
}

describe('EngineErrorChip — 带键的错误随语言重译', () => {
  it('zh-CN → 显示中文; 切 en-US → 同一条错误显示英文', () => {
    installErrorReporter()
    renderStatusBar()

    // 用引擎真实的 key+params 上报 (模拟 ErrorRecovery 的产出)
    act(() => {
      reportError({
        code: EditorErrorCode.E_RENDER_CONTEXT_LOST,
        key: 'engineError.pageRender',
        params: { pageIndex: 3 },
        message: locale.t('engineError.pageRender', { pageIndex: 3 }),
      })
    })

    expect(screen.getByText('页面渲染失败: pageIndex=3')).toBeTruthy()

    act(() => { locale.setLocale('en-US') })

    // 那条**已经显示的**错误跟着换了语言
    expect(screen.getByText('Page render failed: pageIndex=3')).toBeTruthy()
    expect(screen.queryByText('页面渲染失败: pageIndex=3')).toBeNull()
  })

  it('无键的错误 (UI 自造 message) 保持原样, 不因切语言炸掉', () => {
    installErrorReporter()
    renderStatusBar()

    act(() => {
      reportError({ code: EditorErrorCode.E_UNKNOWN, message: '导入失败：文件损坏' })
    })
    expect(screen.getByText('导入失败：文件损坏')).toBeTruthy()

    act(() => { locale.setLocale('en-US') })

    expect(screen.getByText('导入失败：文件损坏')).toBeTruthy()
  })

  it('切语言不让已关闭的同一条错误重新弹出 (去重键不随语言变)', () => {
    installErrorReporter()
    const err = {
      code: EditorErrorCode.E_RENDER_CONTEXT_LOST,
      key: 'engineError.pageRender' as const,
      params: { pageIndex: 0 },
      message: locale.t('engineError.pageRender', { pageIndex: 0 }),
    }

    act(() => { reportError(err) })
    expect(useEditorStore.getState().lastEngineError).not.toBeNull()

    act(() => { useEditorStore.getState().dismissEngineError() })
    expect(useEditorStore.getState().lastEngineError).toBeNull()

    // 切语言后**同一条**错误再报一次 —— 仍是"已被关掉"的那条, 不该弹
    act(() => { locale.setLocale('en-US') })
    act(() => {
      reportError({ ...err, message: locale.t('engineError.pageRender', { pageIndex: 0 }) })
    })
    expect(useEditorStore.getState().lastEngineError).toBeNull()
  })
})
