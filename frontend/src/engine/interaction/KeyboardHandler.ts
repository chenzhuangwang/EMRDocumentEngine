// ================================================================
// KeyboardHandler — 键盘事件 → Command (架构 §8.1, v20.34)
//
// 读取 EditorStore 的当前光标位置, 构造语义正确的命令
// 空文档首次输入时自动创建段落
// ================================================================

import type { Editor } from '../Editor'
import { createParagraph } from '../document/ElementFormatter'
import { InsertTextCommand } from '../command/commands/InsertTextCommand'
import { DeleteRangeCommand } from '../command/commands/DeleteRangeCommand'
import { SplitParagraphCommand } from '../command/commands/SplitParagraphCommand'
import { MergeParagraphCommand } from '../command/commands/MergeParagraphCommand'
import { generateCommandId } from '../command/ICommand'

export class KeyboardHandler {
  private editor: Editor
  private container: HTMLElement

  constructor(editor: Editor, container: HTMLElement) {
    this.editor = editor
    this.container = container
    container.addEventListener('keydown', this.onKeyDown)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const ed = this.editor
    const store = ed.getStore()
    const cursor = store.state.runtime.cursor
    const author = 'user'

    // Ctrl+Z / Ctrl+Y
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); ed.undo(); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); ed.redo(); return }

    const id = generateCommandId()
    const ts = Date.now()

    // Enter — 拆段
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (cursor.paragraphPath.length === 0) return
      ed.execCommand(new SplitParagraphCommand(id, ts, author, cursor.paragraphPath, cursor.offset))
      return
    }

    // Backspace
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (cursor.paragraphPath.length === 0) return
      if (cursor.offset > 0) {
        ed.execCommand(new DeleteRangeCommand(id, ts, author, cursor.paragraphPath, cursor.offset - 1, cursor.offset))
      } else {
        ed.execCommand(new MergeParagraphCommand(id, ts, author, cursor.paragraphPath))
      }
      return
    }

    // Delete
    if (e.key === 'Delete') {
      e.preventDefault()
      if (cursor.paragraphPath.length === 0) return
      ed.execCommand(new DeleteRangeCommand(id, ts, author, cursor.paragraphPath, cursor.offset, cursor.offset + 1))
      return
    }

    // 可见字符
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      let path = cursor.paragraphPath
      let offset = cursor.offset

      // 空文档 → 首次输入自动创建段落
      if (path.length === 0) {
        const doc = ed.getDocument()
        const pool = ed.getPool()
        const para = createParagraph()
        pool.nodes.set(para.id, para)
        doc.body.children = [para.id]
        path = [doc.id, para.id]
        offset = 0
        // 持久化光标位置
        const storeInternal = store as unknown as { _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean } } } }
        storeInternal._state.runtime.cursor = { paragraphPath: path, offset: 0, visible: true }
      }

      ed.execCommand(new InsertTextCommand(id, ts, author, path, offset, e.key))
    }
  }

  destroy(): void {
    this.container.removeEventListener('keydown', this.onKeyDown)
  }
}
