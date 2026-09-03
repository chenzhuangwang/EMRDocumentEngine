// ============================================================
// MouseHandler 鼠标键守卫测试 (P0-1)
//
// 验证 onMouseDown 顶部的 `if (e.button !== 0) return`:
//   - 右键/中键 (button 1/2) 在进入任何编辑器交互前即返回。
//   - 左键 (button 0) 正常进入命中处理流程。
//
// 通过真实 MouseHandler + DOM 事件分发验证; editor 用最小桩替代,
// 不构造完整 Editor (与既有测试约定一致)。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { MouseHandler } from '../interaction/MouseHandler'
import type { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { testMeasurer } from './helpers'

/** 构造挂载到独立容器的 MouseHandler (每测隔离, 不污染共享 testHost) */
function makeHandler(editor: Editor) {
  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.input.mount(container)
  const handler = new MouseHandler(editor, host, testMeasurer)
  return { container, handler }
}

/** 设计模式最小桩编辑器: 命中处理最终落在 selectControl, 作为「已进入处理」的信号 */
function makeDesignEditor() {
  return {
    getStore: vi.fn(() => ({ state: { runtime: { view: { mode: 'design' as const } } } })),
    getDraw: vi.fn(() => ({
      getCoordinateSystem: () => ({ transform: { scale: 1, scrollY: 0 } }),
      getPages: () => [],
    })),
    selectControl: vi.fn(),
  } as unknown as Editor
}

describe('MouseHandler 鼠标键守卫', () => {
  it('忽略非左键 (右键/中键不触发任何编辑器交互)', () => {
    const editor = makeDesignEditor()
    const { container, handler } = makeHandler(editor)

    for (const button of [1, 2]) {
      container.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true, clientX: 40, clientY: 40 }))
    }

    expect(editor.getStore).not.toHaveBeenCalled()
    expect(editor.selectControl).not.toHaveBeenCalled()

    handler.destroy()
    container.remove()
  })

  it('左键正常进入命中处理', () => {
    const editor = makeDesignEditor()
    const { container, handler } = makeHandler(editor)

    container.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 40, clientY: 40 }))

    expect(editor.getStore).toHaveBeenCalledTimes(1)
    expect(editor.selectControl).toHaveBeenCalledTimes(1)

    handler.destroy()
    container.remove()
  })
})
