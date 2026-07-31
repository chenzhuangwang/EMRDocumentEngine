// ================================================================
// MouseHandler — 鼠标拖拽选区 (架构 §8.2, v20.34)
//
// 状态机: idle → mousedown(记录起点) → mousemove(更新选区) → mouseup(确认)
// 单击不拖拽 → 不触发选区, 由 Editor.handleClick 处理光标定位
// ================================================================

import type { Editor } from '../Editor'

export class MouseHandler {
  private editor: Editor
  private container: HTMLElement
  private dragStartX = 0
  private dragStartY = 0
  private dragging = false
  private readonly DRAG_THRESHOLD = 3 // px, 超过此阈值才视为拖拽

  constructor(editor: Editor, container: HTMLElement) {
    this.editor = editor
    this.container = container
    container.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
  }

  private onMouseDown = (e: MouseEvent) => {
    this.dragStartX = e.clientX
    this.dragStartY = e.clientY
    this.dragging = false
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.dragging) {
      // 超过阈值才开始拖拽选区
      const dx = Math.abs(e.clientX - this.dragStartX)
      const dy = Math.abs(e.clientY - this.dragStartY)
      if (dx < this.DRAG_THRESHOLD && dy < this.DRAG_THRESHOLD) return
      this.dragging = true
    }

    // 实时更新选区终点并重绘
    const store = this.editor.getStore()
    const cursor = store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    // 计算选区结束位置 (复用 Editor 的命中检测逻辑)
    const rect = this.container.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top + this.editor.getDraw().getCoordinateSystem().transform.scrollY

    const pages = this.editor.getDraw().getPages()
    if (pages.length === 0) return

    let pageIndex = 0; let localY = screenY
    for (let i = 0; i < pages.length; i++) {
      if (localY < pages[i].height) { pageIndex = i; break }
      localY -= pages[i].height; pageIndex = i
    }
    const page = pages[pageIndex]
    if (!page) return

    const viewportW = this.container.clientWidth
    const offsetX = Math.max(0, (viewportW - page.width) / 2)
    const docX = screenX - offsetX
    const docY = localY

    const nodeId = this.editor.getDraw().getHitTestIndex().hitTest(docX, docY, pageIndex)
    if (!nodeId) return

    // 计算选区终点的字符偏移
    const pool = this.editor.getPool()
    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const para = pool.nodes.get(paraId) as unknown as { children: string[] } | undefined
    if (!para) return

    let endOffset = 0; let accumulated = 0
    for (const childId of para.children) {
      const item = page.items.find(it => it.nodeId === childId)
      const text = (pool.nodes.get(childId) as unknown as { text?: string })?.text || ''
      if (item) {
        const charWidth = item.width / Math.max(text.length, 1)
        if (docX <= item.x + item.width) {
          const charIdx = Math.round((docX - item.x) / charWidth)
          endOffset = accumulated + Math.max(0, Math.min(charIdx, text.length))
          break
        }
      }
      accumulated += text.length
    }

    // 更新选区状态
    const storeInternal = store as unknown as { _state: { runtime: { selection: { anchor: unknown; focus: unknown; active: boolean; granularity: string } } } }
    storeInternal._state.runtime.selection = {
      anchor: { paragraphPath: cursor.paragraphPath, offset: cursor.offset, visible: false },
      focus: { paragraphPath: cursor.paragraphPath, offset: endOffset, visible: false },
      active: endOffset !== cursor.offset,
      granularity: 'character',
    }

    // 重绘选区
    this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
  }

  private onMouseUp = () => {
    this.dragging = false
  }

  isDragging(): boolean { return this.dragging }

  destroy(): void {
    this.container.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
  }
}
