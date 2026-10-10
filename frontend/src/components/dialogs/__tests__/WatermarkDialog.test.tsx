// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// WatermarkDialog (契约 §12.4)
//
// 重点: **移除入口只在已有水印时出现**。水印是文档内容, 若只有"应用"没有
// "移除", 功能就是单向的 (能设不能删) —— 那正是这条链路此前的问题之一。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WatermarkDialog } from '../WatermarkDialog'
import type { WatermarkConfig } from '@emrde/document-engine'

const EXISTING: WatermarkConfig = {
  type: 'tile', text: '内部资料', fontSize: 48, color: '#000000',
  opacity: 0.08, rotation: 45, spacing: 200,
}

function renderDialog(props: {
  initialConfig?: Partial<WatermarkConfig>
  onApply?: (c: WatermarkConfig) => void
  onRemove?: () => void
}) {
  const onClose = vi.fn()
  render(<WatermarkDialog open onClose={onClose} {...props} />)
  return { onClose }
}

describe('WatermarkDialog', () => {
  it('应用 → 回传当前配置并关闭', () => {
    const onApply = vi.fn()
    const { onClose } = renderDialog({ onApply })
    fireEvent.change(screen.getByDisplayValue('内部资料'), { target: { value: '机密' } })
    fireEvent.click(screen.getByRole('button', { name: '应用水印' }))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect((onApply.mock.calls[0][0] as WatermarkConfig).text).toBe('机密')
    expect(onClose).toHaveBeenCalled()
  })

  it('未传 onRemove (文档本无水印) → 不出现移除入口', () => {
    renderDialog({ onApply: vi.fn() })
    expect(screen.queryByRole('button', { name: /移除水印/ })).toBeNull()
  })

  it('传入 onRemove (已有水印) → 出现移除入口, 点击回传并关闭', () => {
    const onRemove = vi.fn()
    const { onClose } = renderDialog({ onRemove })
    fireEvent.click(screen.getByRole('button', { name: /移除水印/ }))

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('initialConfig 播种字段 (以现值为初值, 不是每次回到默认值)', () => {
    // 刻意用与 DEFAULTS 不同的值 —— 否则"播种生效"与"用了默认值"无法区分
    renderDialog({ initialConfig: { ...EXISTING, text: '机密密级', rotation: 30 }, onApply: vi.fn() })
    expect(screen.getByDisplayValue('机密密级')).toBeTruthy()
    expect(screen.getByDisplayValue('30')).toBeTruthy()
    expect(screen.queryByDisplayValue('内部资料')).toBeNull()
  })

  it('无水印 (initialConfig 为空) → 用默认值', () => {
    renderDialog({ onApply: vi.fn() })
    expect(screen.getByDisplayValue('内部资料')).toBeTruthy()
  })
})
