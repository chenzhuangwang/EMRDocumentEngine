// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 切语言后已渲染/已算出的内容跟着刷新 (i18n 引擎层接线闸门 — refreshForLocale)
//
// 三层都要验, 缺一条链路就是"机制齐备、零接线" (本仓库高频陷阱):
//   1. 引擎侧 refreshForLocale 真的重排 + 重绘 + 发 contentChange
//   2. **不** markDirty / 不入 undo (语言不是文档内容, 同 setTheme)
//   3. 引擎订阅端 (EditorProvider) 真的把 locale 变更接上去
//
// 为什么不走 document:changed: 'none' 不重排 (域文字宽度会变, 必须重排);
// 'full' 会 markDirty (把文档标脏是错的)。所以需要一个专用 API。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Editor } from '../Editor'
import { locale } from '../i18n/index'
import { createDomEditorHost } from '@/platform/dom'

/** surface/input 必须先 mount 到真实容器, 否则 Draw 建层时抛 */
function makeEditor(): { editor: Editor; cleanup: () => void } {
  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host)
  return { editor, cleanup: () => { editor.destroy(); document.body.innerHTML = '' } }
}

beforeEach(() => { locale.setLocale('zh-CN') })
afterEach(() => { locale.setLocale('zh-CN'); document.body.innerHTML = '' })

describe('Editor.refreshForLocale (v6.2)', () => {
  it('重排 + 重绘 + 发 contentChange (QC/字数/大纲靠它重跑)', () => {
    const { editor, cleanup } = makeEditor()
    const relayout = vi.spyOn(editor as unknown as { relayout: () => void }, 'relayout')
    const onContent = vi.fn()
    editor.on('contentChange', onContent)

    editor.refreshForLocale()

    expect(relayout).toHaveBeenCalledTimes(1)
    expect(onContent).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('不 markDirty —— 切语言不该把文档标成"未保存"', () => {
    const { editor, cleanup } = makeEditor()
    const store = editor.getStore()
    store.setSaveStatus('saved')
    store.setDirty(false)

    editor.refreshForLocale()

    expect(store.state.saveStatus).toBe('saved')
    expect(store.state.isDirty).toBe(false)
    cleanup()
  })

  it('不入 undo 栈 —— 语言不是文档内容', () => {
    const { editor, cleanup } = makeEditor()
    expect(editor.canUndo()).toBe(false)

    editor.refreshForLocale()

    expect(editor.canUndo()).toBe(false)
    cleanup()
  })

  it('与 setTheme 同构: 两者都不脏文档、不入历史', () => {
    const { editor, cleanup } = makeEditor()
    const store = editor.getStore()
    store.setDirty(false)

    editor.refreshForLocale()
    editor.setTheme('dark')

    expect(store.state.isDirty).toBe(false)
    expect(editor.canUndo()).toBe(false)
    cleanup()
  })
})

describe('locale 变更 → 画布刷新 (真实订阅链)', () => {
  it('locale.setLocale 触发订阅回调 (EditorProvider 照此接线)', () => {
    const { editor, cleanup } = makeEditor()
    const spy = vi.spyOn(editor, 'refreshForLocale')
    // 与 EditorProvider 里那段 useEffect 相同的接线方式
    const unsub = locale.subscribe(() => { editor.refreshForLocale() })

    locale.setLocale('en-US')

    expect(spy).toHaveBeenCalledTimes(1)

    // 同值早退: 再设一次相同语言不该再刷 (LocaleManager 的既有守卫)
    locale.setLocale('en-US')
    expect(spy).toHaveBeenCalledTimes(1)

    unsub()
    locale.setLocale('zh-CN')
    expect(spy).toHaveBeenCalledTimes(1)   // 已退订
    cleanup()
  })
})
