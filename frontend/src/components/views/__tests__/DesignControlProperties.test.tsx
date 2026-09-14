// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// DesignControlProperties 组件 — 只读展示不产生回写 (契约 §12.5, P2-A)
//
// 验证属性面板在「初始化/渲染」路径上:
//   - controlType 只读展示 (复用目录 name; undefined → 「未指定」)
//   - 语义身份只读展示 (dataElement/dataType/showType/enums/required/readonly)
//   - 全程不调用 setControlDefinition (展示 ≠ 迁移, 绝不自动回写默认值)
// ================================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorContext, type EditorContextValue } from '../../editor/EditorProvider'
import { DesignControlProperties } from '../DesignControlProperties'
import { EditorStore } from '@/engine/state/EditorStore'
import type { Editor } from '@/engine'
import type { TemplateDefinition } from '@/engine/template/TemplateDefinition'
import type { ElementMeta } from '@/engine/document/core/DocumentModel'

/** 最小 mock Editor: 面板只消费 getControlDefinition / setControlDefinition / getPool */
function makeEditor(def: TemplateDefinition | undefined, element: ElementMeta | undefined) {
  const setControlDefinition = vi.fn()
  const getControlDefinition = vi.fn(() => def)
  const nodes = new Map<string, { element?: ElementMeta; type?: string }>()
  if (element) nodes.set('st-1', { element, type: 'smarttext' })
  const editor = {
    getControlDefinition,
    setControlDefinition,
    getPool: () => ({ nodes }),
  } as unknown as Editor
  return { editor, setControlDefinition, getControlDefinition }
}

/** 渲染在设计模式 + 选中 st-1 的面板 */
function renderPanel(editor: Editor) {
  const store = new EditorStore()
  store.setMode('design')
  store.setDesignSelectedControlId('st-1')
  const value: EditorContextValue = { editorRef: { current: editor }, ready: true, store }
  return render(
    <EditorContext.Provider value={value}>
      <DesignControlProperties />
    </EditorContext.Provider>,
  )
}

describe('DesignControlProperties 只读展示 (P2-A)', () => {
  it('controlType "select" → 展示「下拉选择」, 渲染不触发 setControlDefinition 回写', () => {
    const def: TemplateDefinition = { controlType: 'select', label: '下拉选择：', deletable: true, editable: true }
    const element: ElementMeta = {
      code: { internal: 'CTL_SELECT', dataElement: 'DE99.99.004' },
      name: '选择器', // 与 controlType 展示名区分, 避免 getByText 多匹配
      format: { dataType: 'S1', enums: { data: [] } },
    }
    const { editor, setControlDefinition } = makeEditor(def, element)
    renderPanel(editor)

    expect(screen.getByText('下拉选择')).toBeTruthy() // controlType 只读展示
    expect(screen.getByText('DE99.99.004')).toBeTruthy() // 语义身份只读
    expect(setControlDefinition).not.toHaveBeenCalled()
  })

  it('旧文档 controlType undefined → 展示「未指定」, 不自动回写默认值', () => {
    const def: TemplateDefinition = { label: '姓名：', deletable: true } // 无 controlType
    const element: ElementMeta = { code: { internal: 'CTL_NAME', dataElement: 'DE02.01.039.00' }, name: '患者姓名' }
    const { editor, setControlDefinition } = makeEditor(def, element)
    renderPanel(editor)

    expect(screen.getByText('未指定')).toBeTruthy()
    expect(screen.queryByText('单行文本')).toBeNull() // 绝不猜成 input
    expect(setControlDefinition).not.toHaveBeenCalled()
  })

  it('语义身份区只读展示 dataElement/dataType/showType/enums/required/readonly', () => {
    const def: TemplateDefinition = { controlType: 'radio' }
    const element: ElementMeta = {
      code: { internal: 'CTL_RADIO', dataElement: 'DE99.99.007' },
      name: '单选框',
      format: {
        dataType: 'S1',
        showType: 'AN',
        enums: { data: [{ name: '男', value: 'm' }, { name: '女', value: 'f' }] },
      },
      required: true,
      readonly: false,
    }
    const { editor, setControlDefinition } = makeEditor(def, element)
    renderPanel(editor)

    expect(screen.getByText('语义信息（只读）')).toBeTruthy()
    expect(screen.getByText('DE99.99.007')).toBeTruthy()
    expect(screen.getByText('S1')).toBeTruthy()
    expect(screen.getByText('AN')).toBeTruthy()
    expect(screen.getByText('2 项')).toBeTruthy()
    expect(setControlDefinition).not.toHaveBeenCalled()
  })
})
