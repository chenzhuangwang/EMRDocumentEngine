// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// FormatPainter — 格式刷 feature module (契约 §11.2, Drift 2 反转)
//
// 验证 FormatPainter 的状态机与复制语义, 不实例化完整 Editor:
//   A. copyStyle — 返回完整 TextStyle 字段 (含 undefined/false)。
//   B. activate→copy→deactivate 往返 — 无样式不激活; 有样式激活
//      (host 光标 'copy' + store 同步 true); 停用恢复 '' + false。
// ================================================================

import { describe, it, expect, vi } from 'vitest'
import { FormatPainter } from '../format/FormatPainter'
import type { Editor } from '../Editor'
import type { EditorHost } from '../host/EditorHost'

/** 极简 Editor 桩 — 仅暴露 FormatPainter 激活/复制路径所需的公共原语 */
function makeEditorStub(style: Record<string, unknown> | null) {
  const setFormatPainterActive = vi.fn()
  return {
    getTextStyle: vi.fn(() => style),
    getStore: vi.fn(() => ({ setFormatPainterActive })),
    setFormatPainterActive,
  }
}

/** 极简 EditorHost 桩 — 仅 setCursor */
function makeHostStub() {
  return { input: { setCursor: vi.fn() } } as unknown as EditorHost
}

function makePainter(style: Record<string, unknown> | null) {
  const editor = makeEditorStub(style)
  const host = makeHostStub()
  const painter = new FormatPainter(editor as unknown as Editor, host)
  return { painter, editor, host }
}

describe('FormatPainter — 格式刷 feature module (契约 §11.2)', () => {
  it('copyStyle: 返回完整 TextStyle 字段 (含 undefined/false)', () => {
    const { painter } = makePainter({
      font: 'SimHei', size: 18, bold: true, italic: false,
      underline: undefined, underlineStyle: undefined,
      strikeout: false, color: '#000', highlight: undefined,
      superscript: undefined, subscript: false, letterSpacing: 2,
    })
    const copied = painter.copyStyle()
    expect(copied).toEqual({
      font: 'SimHei', size: 18, bold: true, italic: false,
      underline: undefined, underlineStyle: undefined,
      strikeout: false, color: '#000', highlight: undefined,
      superscript: undefined, subscript: false, letterSpacing: 2,
    })
  })

  it('copyStyle: 无样式返回 null', () => {
    const { painter } = makePainter(null)
    expect(painter.copyStyle()).toBeNull()
  })

  it('activate: 无样式可复制时不激活 (isActive=false, 不写 store/光标)', () => {
    const { painter, editor, host } = makePainter(null)
    expect(painter.isActive).toBe(false)
    painter.setActive(true)
    expect(painter.isActive).toBe(false)
    expect(editor.setFormatPainterActive).not.toHaveBeenCalled()
    expect(host.input.setCursor).not.toHaveBeenCalled()
  })

  it('activate→copy→deactivate 往返: 状态/光标/store 全程同步', () => {
    const { painter, editor, host } = makePainter({ font: 'KaiTi', size: 14 })

    // activate: 复制样式 + 光标 'copy' + store true
    painter.setActive(true)
    expect(painter.isActive).toBe(true)
    expect(host.input.setCursor).toHaveBeenCalledWith('copy')
    expect(editor.setFormatPainterActive).toHaveBeenCalledWith(true)

    // 激活后 copyStyle 仍能复制 (源样式在 cursor 处读取)
    expect(painter.copyStyle()).toEqual({ font: 'KaiTi', size: 14 })

    // deactivate: 光标恢复 '' + store false
    painter.setActive(false)
    expect(painter.isActive).toBe(false)
    expect(host.input.setCursor).toHaveBeenLastCalledWith('')
    expect(editor.setFormatPainterActive).toHaveBeenLastCalledWith(false)
  })
})
