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

    // ---- 模式检查: 限制编辑操作 ----
    const mode = store.state.runtime.view.mode
    const isReadonly = mode === 'readonly' || mode === 'clean' || mode === 'print'
    const isForm = mode === 'form'
    const isDesign = mode === 'design'
    // 仅设计模式允许所有操作, 其余模式有编辑限制
    const blockEdit = !isDesign && (isReadonly || isForm)

    // Ctrl+Z / Ctrl+Y
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); ed.undo(); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); ed.redo(); return }

    // Ctrl+C: 复制选区
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); ed.copy(); return }
    // Ctrl+V: 粘贴 (模式拦截)
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); if (!blockEdit) ed.paste(); return }
    // Ctrl+X: 剪切 (复制 + 删除选区)
    if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
      e.preventDefault()
      ed.copy()
      if (!blockEdit) {
        const sel = store.state.runtime.selection
        if (sel.active && !this.isSelectionCollapsed(sel)) {
          this.deleteSelection(ed, sel)
        }
      }
      return
    }
    // Ctrl+A: 全选
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); ed.selectAll(); return }
    // Ctrl+Alt+F: 插入脚注 (R31)
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'f') { e.preventDefault(); ed.insertFootnote(); return }

    // ---- 方向键 + 导航键 ----
    const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']
    if (navKeys.includes(e.key)) {
      e.preventDefault()
      if (cursor.paragraphPath.length === 0) return
      this.handleNavigationKey(e.key, e.shiftKey, e.ctrlKey || e.metaKey, ed)
      return
    }

    const id = generateCommandId()
    const ts = Date.now()

    // Enter — 拆段 (模式拦截)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (blockEdit || cursor.paragraphPath.length === 0) return
      ed.execCommand(new SplitParagraphCommand(id, ts, author, cursor.paragraphPath, cursor.offset))
      return
    }

    // Backspace — 有选区则删选区, 无选区则删前一字符
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (blockEdit) return
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
      if (blockEdit) return
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

    // 可见字符 — 有选区则替换选区内容 (模式拦截)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      if (blockEdit) return
      const sel = store.state.runtime.selection
      if (sel.active && !this.isSelectionCollapsed(sel)) {
        this.deleteSelection(ed, sel)
      }
      // 从 store 重新读取光标 (deleteSelection 可能已更新)
      const cur = store.state.runtime.cursor
      let path = cur.paragraphPath
      let offset = cur.offset

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
    const hiOff = fIdx === hi ? sel.focus.offset : sel.anchor.offset

    // 从后往前删, 避免索引漂移
    for (let pi = hi; pi >= lo; pi--) {
      const paraId = siblings[pi]
      if (!paraId) continue
      // 跳过非段落节点 (表格、图片等不会出现在 paragraphPath 中)
      const node = ed.getPool().nodes.get(paraId)
      if (!node || (node.type !== 'paragraph')) continue
      const path = [...sel.anchor.paragraphPath.slice(0, -1), paraId]
      if (pi === lo && pi === hi) {
        // 同段落选区: 仅删除 offset 范围内的字符
        const start = Math.min(loOff, hiOff)
        const end = Math.max(loOff, hiOff)
        if (end > start) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, start, end))
      } else if (pi === hi) {
        // 末段: 删除段落开头到 hiOff 的字符
        if (hiOff > 0) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, 0, hiOff))
      } else if (pi === lo) {
        // 首段: 删除 loOff 到段落末尾的字符
        const para = ed.getPool().nodes.get(paraId) as { children?: string[] } | undefined
        let totalLen = 0
        if (para?.children) {
          for (const cid of para.children) {
            const n = ed.getPool().nodes.get(cid) as { type?: string; text?: string } | undefined
            totalLen += n?.type === 'text' ? (n.text || '').length : 1
          }
        }
        if (loOff < totalLen) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, loOff, totalLen))
      } else {
        // 中间段落: 删除全部内容
        const para = ed.getPool().nodes.get(paraId) as { children?: string[] } | undefined
        let totalLen = 0
        if (para?.children) {
          for (const cid of para.children) {
            const n = ed.getPool().nodes.get(cid) as { type?: string; text?: string } | undefined
            totalLen += n?.type === 'text' ? (n.text || '').length : 1
          }
        }
        if (totalLen > 0) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, 0, totalLen))
      }
    }

    // 跨段落选区: 删除后合并残段, 清除空段落残留
    // 从 lo+1 开始反复合并到 lo, 每次合并后 lo+1 自动指向下一个残段
    if (lo < hi) {
      for (let mergeCount = (hi - lo); mergeCount > 0; mergeCount--) {
        const currentSiblings = doc.body.children
        const nextParaId = currentSiblings[lo + 1]
        if (!nextParaId) break
        const mergePath = [...sel.anchor.paragraphPath.slice(0, -1), nextParaId]
        ed.execCommand(new MergeParagraphCommand(generateCommandId(), Date.now(), 'user', mergePath))
      }
    }
  }

  // ================================================================
  // ================================================================
  // 导航键 — 方向键 + Home/End + PageUp/PageDown
  // 支持 body / header / footer 段落间移动, 区域隔离
  // ================================================================

  private handleNavigationKey(key: string, shift: boolean, ctrl: boolean, ed: Editor): void {
    const store = ed.getStore()
    const cursor = store.state.runtime.cursor
    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const doc = ed.getDocument()
    const pool = ed.getPool()

    // 获取当前段落所属区域的兄弟列表
    const siblings = this.getParagraphSiblings(paraId, doc)
    const idx = siblings.indexOf(paraId)
    if (idx < 0) return

    // 计算段落内文本总长度
    const totalLen = this.getParagraphLength(paraId, pool)

    let newParaId = paraId
    let newOffset = cursor.offset

    switch (key) {
      // ---- 方向键 ----
      case 'ArrowLeft':
        if (cursor.offset > 0) {
          newOffset = cursor.offset - 1
        } else if (idx > 0) {
          newParaId = siblings[idx - 1]
          newOffset = this.getParagraphLength(newParaId, pool)
        }
        break

      case 'ArrowRight':
        if (cursor.offset < totalLen) {
          newOffset = cursor.offset + 1
        } else if (idx < siblings.length - 1) {
          newParaId = siblings[idx + 1]
          newOffset = 0
        }
        break

      case 'ArrowUp':
        if (idx > 0) {
          newParaId = siblings[idx - 1]
          newOffset = Math.min(cursor.offset, this.getParagraphLength(newParaId, pool))
        }
        break

      case 'ArrowDown':
        if (idx < siblings.length - 1) {
          newParaId = siblings[idx + 1]
          newOffset = Math.min(cursor.offset, this.getParagraphLength(newParaId, pool))
        }
        break

      // ---- Home/End ----
      case 'Home':
        if (ctrl) {
          // Ctrl+Home: 跳到当前区域第一个段落开头
          newParaId = siblings[0]
        }
        newOffset = 0
        break

      case 'End':
        if (ctrl) {
          // Ctrl+End: 跳到当前区域最后一个段落末尾
          newParaId = siblings[siblings.length - 1]
          newOffset = this.getParagraphLength(newParaId, pool)
        } else {
          newOffset = totalLen
        }
        break

      // ---- PageUp/PageDown (基于 SLIF 页面跳转) ----
      case 'PageUp':
      case 'PageDown': {
        const pages = ed.getDraw().getPages()
        if (pages.length === 0) break

        // 查找光标所在页面
        const caretPageIndex = this.findCaretPage(ed, paraId)
        if (caretPageIndex < 0) break

        const targetPageIndex = key === 'PageUp'
          ? Math.max(0, caretPageIndex - 1)
          : Math.min(pages.length - 1, caretPageIndex + 1)

        if (targetPageIndex === caretPageIndex) break

        // 在目标页找第一个有内容的 paragraph 并定位
        const targetParaId = this.findFirstParagraphOnPage(pages[targetPageIndex], pool, siblings)
        if (targetParaId) {
          newParaId = targetParaId
          newOffset = Math.min(cursor.offset, this.getParagraphLength(targetParaId, pool))
        }
        break
      }
    }

    // 更新光标位置
    const si = store as unknown as {
      _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean }; selection: { anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean }; active: boolean; granularity: string } } }
    }

    const newPath = [...cursor.paragraphPath.slice(0, -1), newParaId]
    si._state.runtime.cursor = { paragraphPath: newPath, offset: newOffset, visible: true }

    if (shift) {
      // Shift+方向键: 扩展选区 (保持 anchor, 移动 focus)
      const sel = si._state.runtime.selection
      if (!sel.active) {
        // 首次扩展: 设置 anchor 为原光标位置
        sel.anchor = { paragraphPath: [...cursor.paragraphPath], offset: cursor.offset, visible: false }
        sel.active = true
        sel.granularity = 'character'
      }
      sel.focus = { paragraphPath: newPath, offset: newOffset, visible: false }
    } else {
      // 无 Shift: 清除选区
      si._state.runtime.selection = {
        anchor: { paragraphPath: newPath, offset: newOffset, visible: false },
        focus: { paragraphPath: newPath, offset: newOffset, visible: false },
        active: false,
        granularity: 'character',
      }
    }

    ed.getDraw().render(pool, store.state.runtime)
  }

  /** 查找光标所在段落在哪个 SLIF 页面 */
  private findCaretPage(ed: Editor, paraId: string): number {
    const pages = ed.getDraw().getPages()
    for (let i = 0; i < pages.length; i++) {
      const items = pages[i].items
      // 检查 body items
      for (const item of items) {
        if (item.nodeId === paraId) return i
      }
      // 检查 header/footer items
      const hfSets = [pages[i].headerItems || [], pages[i].footerItems || []]
      for (const hfItems of hfSets) {
        for (const item of hfItems) {
          if (item.nodeId === paraId) return i
        }
      }
    }
    return -1
  }

  /** 在 SLIF 页面中找第一个属于 siblings 的段落 ID */
  private findFirstParagraphOnPage(
    page: { items: { nodeId: string }[]; headerItems?: { nodeId: string }[]; footerItems?: { nodeId: string }[] },
    pool: { nodes: Map<string, { type: string; children?: string[] }> },
    siblings: string[],
  ): string | null {
    // 搜索正文 items
    for (const item of page.items) {
      const paraId = this.resolveItemParagraph(item.nodeId, pool)
      if (paraId && siblings.includes(paraId)) return paraId
    }
    // 搜索 header/footer items (PageUp/Down 也适用)
    for (const hfItems of [page.headerItems || [], page.footerItems || []]) {
      for (const item of hfItems) {
        const paraId = this.resolveItemParagraph(item.nodeId, pool)
        if (paraId && siblings.includes(paraId)) return paraId
      }
    }
    return null
  }

  /** 从 nodeId 查找所属段落 ID */
  private resolveItemParagraph(nodeId: string, pool: { nodes: Map<string, { type: string; children?: string[] }> }): string | null {
    for (const [, node] of pool.nodes) {
      if (node.type === 'paragraph' && node.children?.includes(nodeId)) {
        return (node as unknown as { id: string }).id || null
      }
    }
    const self = pool.nodes.get(nodeId)
    if (self?.type === 'paragraph') return nodeId
    return null
  }

  /** 获取段落所在区域的兄弟段落列表 (body / header / footer) */
  private getParagraphSiblings(paraId: string, doc: { body: { children: string[] }; header?: string[]; footer?: string[] }): string[] {
    if (doc.body.children.includes(paraId)) return doc.body.children
    if (doc.header?.includes(paraId)) return doc.header
    if (doc.footer?.includes(paraId)) return doc.footer
    return []
  }

  /** 计算段落文本总长度 (字符数) */
  private getParagraphLength(paraId: string, pool: { nodes: Map<string, { type: string; children?: string[]; text?: string }> }): number {
    const para = pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return 0
    let len = 0
    for (const cid of para.children) {
      const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
      len += n?.type === 'text' ? (n.text || '').length : 1
    }
    return len
  }

  destroy(): void {
    this.container.removeEventListener('keydown', this.onKeyDown)
  }
}
