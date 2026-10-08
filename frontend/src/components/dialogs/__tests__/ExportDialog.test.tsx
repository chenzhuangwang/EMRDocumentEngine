// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ExportDialog — 三种新格式的入口接线
//
// 锁的是: 三个新格式真的**可选可点** (available: true), 点击回传的 format id
// 与 handleExport 的分支键一致。键不一致的表现是「点了没反应」——既有
// handleExport 对未知格式是静默 no-op, 所以这类错配不会自己暴露。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExportDialog } from '../ExportDialog'
import { locale } from '@/engine/i18n'

/** 当前语言下的文案 —— 不写死中文/英文, 免得断言随默认语言变化而失真 */
const L = (key: Parameters<typeof locale.t>[0]): string => locale.t(key)

/** 打开对话框并返回 onExport 的 mock */
function open() {
  const onExport = vi.fn()
  render(<ExportDialog open onOpenChange={() => {}} onExport={onExport} />)
  return onExport
}

/** 按可见文案点一行格式, 再点「导出」 */
function pick(label: string, onExport: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByText(label))
  fireEvent.click(screen.getByText(L('file.export')))
  return onExport.mock.calls[0]?.[0]
}

describe('ExportDialog — 新格式入口', () => {
  it('OFD / XML(CDA) / 结构化元素 三行都可选 (不是 coming soon)', () => {
    open()
    for (const key of ['export.ofd', 'export.cda', 'export.elements'] as const) {
      const row = screen.getByText(L(key)).closest('button')!
      expect(row.hasAttribute('disabled'), key).toBe(false)
    }
  })

  it('三行都不带「即将推出」标记', () => {
    open()
    const comingSoon = screen.queryAllByText(L('export.comingSoon'))
    // PDF / Word 仍然灰着 → 恰好两个徽标, 新的三个没有
    expect(comingSoon).toHaveLength(2)
  })

  it('点击 OFD 回传 format id "ofd" (与 handleExport 的分支键一致)', () => {
    expect(pick(L('export.ofd'), open())).toBe('ofd')
  })

  it('点击 XML 回传 "cda"', () => {
    expect(pick(L('export.cda'), open())).toBe('cda')
  })

  it('点击结构化元素回传 "elements"', () => {
    expect(pick(L('export.elements'), open())).toBe('elements')
  })

  it('既有格式未被改动 (json 仍是默认选中项)', () => {
    const onExport = open()
    // 不点任何行, 直接导出 → 默认 json
    fireEvent.click(screen.getByText(L('file.export')))
    expect(onExport).toHaveBeenCalledWith('json')
  })
})
