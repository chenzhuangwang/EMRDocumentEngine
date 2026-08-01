// ================================================================
// KeyboardHandler — 键盘事件 → Command (架构 §8.1, v20.34)
//
// 读取 EditorStore 的当前光标位置, 构造语义正确的命令
// 空文档首次输入时自动创建段落
// ================================================================

import type { Editor } from '../Editor'
import { createParagraph } from '../document/ElementFormatter'
import { extractStyle } from '../document/ElementFormatter'
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

    // Ctrl+C: 复制选区
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); ed.copy(); return }
    // Ctrl+V: 粘贴
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); ed.paste(); return }
    // Ctrl+X: 剪切
    if ((e.ctrlKey || e.metaKey) && e.key === 'x') { e.preventDefault(); ed.copy(); return }
    // Ctrl+A: 全选
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); ed.selectAll(); return }

    const id = generateCommandId()
    const ts = Date.now()

    // Enter — 拆段
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (cursor.paragraphPath.length === 0) return
      ed.execCommand(new SplitParagraphCommand(id, ts, author, cursor.paragraphPath, cursor.offset))
      return
    }

    // Backspace — 有选区则删选区, 无选区则删前一字符
    if (e.key === 'Backspace') {
      e.preventDefault()
      const sel = store.state.runtime.selection
      if (sel.active && !this.isSelectionCollapsed(sel)) {
        this.deleteSelection(ed, sel)
      } else if (cursor.paragraphPath.length > 0) {
        if (cursor.offset > 0) {
          ed.execCommand(new DeleteRangeCommand(id, ts, author, cursor.paragraphPath, cursor.offset - 1, cursor.offset))
        } else {
          ed.execCommand(new MergeParagraphCommand(id, ts, author, cursor.paragraphPath))
        }
      }
      return
    }

    // Delete — 有选区则删选区, 无选区则删后一字符
    if (e.key === 'Delete') {
      e.preventDefault()
      const sel = store.state.runtime.selection
      if (sel.active && !this.isSelectionCollapsed(sel)) {
        this.deleteSelection(ed, sel)
      } else if (cursor.paragraphPath.length > 0) {
        const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
        const para = ed.getPool().nodes.get(paraId) as { children?: string[] } | undefined
        let totalLen = 0
        if (para?.children) {
          for (const cid of para.children) {
            const n = ed.getPool().nodes.get(cid) as { type?: string; text?: string } | undefined
            totalLen += n?.type === 'text' ? (n.text || '').length : 1
          }
        }
        if (cursor.offset >= totalLen) {
          const doc = ed.getDocument()
          const siblings = doc.body.children
          const idx = siblings.indexOf(paraId)
          if (idx >= 0 && idx < siblings.length - 1) {
            ed.execCommand(new MergeParagraphCommand(id, ts, author, [...cursor.paragraphPath.slice(0, -1), siblings[idx + 1]]))
          }
        } else {
          ed.execCommand(new DeleteRangeCommand(id, ts, author, cursor.paragraphPath, cursor.offset, cursor.offset + 1))
        }
      }
      return
    }

    // 可见字符 — 有选区则替换选区内容
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      const sel = store.state.runtime.selection
      if (sel.active && !this.isSelectionCollapsed(sel)) {
        this.deleteSelection(ed, sel)
      }
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

      // 获取光标处文本样式, 使新输入继承当前格式
      let activeStyle: import('../document/DocumentModel').TextStyle | undefined
      if (path.length > 0) {
        const pool = ed.getPool()
        const paraId = path[path.length - 1]
        const resolved = pool.resolveCharOffset(paraId, offset)
        if (resolved) {
          const tn = pool.nodes.get(resolved.textNodeId) as unknown as Record<string, unknown> | undefined
          if (tn) activeStyle = extractStyle(tn as unknown as import('../document/DocumentModel').TextNode)
        } else {
          // 光标在段尾 → 取最后一个 text node 的样式
          const para = pool.nodes.get(paraId) as { children?: string[] } | undefined
          if (para?.children) {
            for (let i = para.children.length - 1; i >= 0; i--) {
              const n = pool.nodes.get(para.children[i]) as { type?: string } | undefined
              if (n?.type === 'text') {
                activeStyle = extractStyle(n as unknown as import('../document/DocumentModel').TextNode)
                break
              }
            }
          }
        }
      }

      ed.execCommand(new InsertTextCommand(id, ts, author, path, offset, e.key, activeStyle))
    }
  }

  /** 选区是否折叠 (起止位置相同) */
  private isSelectionCollapsed(sel: { anchor: { paragraphPath: string[]; offset: number }; focus: { paragraphPath: string[]; offset: number } }): boolean {
    return sel.anchor.paragraphPath.join('.') === sel.focus.paragraphPath.join('.') && sel.anchor.offset === sel.focus.offset
  }

  /** 删除选区内容: 跨段落逐段删除 */
  private deleteSelection(ed: Editor, sel: { anchor: { paragraphPath: string[]; offset: number }; focus: { paragraphPath: string[]; offset: number } }): void {
    const doc = ed.getDocument()
    const aId = sel.anchor.paragraphPath[sel.anchor.paragraphPath.length - 1]
    const fId = sel.focus.paragraphPath[sel.focus.paragraphPath.length - 1]
    const siblings = doc.body.children
    const aIdx = siblings.indexOf(aId)
    const fIdx = siblings.indexOf(fId)
    if (aIdx < 0 || fIdx < 0) return
    const lo = Math.min(aIdx, fIdx)
    const hi = Math.max(aIdx, fIdx)
    const loOff = aIdx === lo ? sel.anchor.offset : sel.focus.offset
    const hiOff = aIdx === hi ? sel.anchor.offset : sel.focus.offset

    // 从后往前删, 避免索引漂移
    for (let pi = hi; pi >= lo; pi--) {
      const paraId = siblings[pi]
      if (!paraId) continue
      const path = [...sel.anchor.paragraphPath.slice(0, -1), paraId]
      if (pi === lo && pi === hi) {
        const start = Math.min(loOff, hiOff)
        const end = Math.max(loOff, hiOff)
        if (end > start) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, start, end))
      } else if (pi === hi) {
        if (hiOff > 0) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, 0, hiOff))
      } else if (pi === lo) {
        const para = ed.getPool().nodes.get(paraId) as { children?: string[] } | undefined
        let totalLen = 0
        if (para?.children) {
          for (const cid of para.children) {
            const n = ed.getPool().nodes.get(cid) as { type?: string; text?: string } | undefined
            totalLen += n?.type === 'text' ? (n.text || '').length : 1
          }
        }
        if (loOff < totalLen) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, loOff, totalLen))
      }
    }
  }

  destroy(): void {
    this.container.removeEventListener('keydown', this.onKeyDown)
  }
}
