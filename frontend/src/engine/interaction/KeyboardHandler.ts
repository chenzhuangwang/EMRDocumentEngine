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
import type { SLIFPage } from '../layout/core/SLIF'
import { resolveCellPosition, getCaretScope, getAdjacentCell, resolveParagraphRegion } from '../state/CaretScope'
import { buildCellGrid } from '../document/TableOps'
import type { TableGrid, GridCell } from '../document/TableOps'
import type { NodePool } from '../document/NodePool'

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

    // ---- Tab / Shift+Tab: 表格 cell 间导航 (Phase 4) ----
    if (e.key === 'Tab') {
      e.preventDefault()
      if (cursor.paragraphPath.length === 0) return
      const scope = getCaretScope(cursor.paragraphPath, ed.getPool())
      if (scope.type === 'cell') {
        this.navigateCell(ed, scope, e.shiftKey ? -1 : 1)
      }
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

    // Shift+Enter — 软换行 (在同一段落/列表项内换行, 不创建新列表项)
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      if (blockEdit || cursor.paragraphPath.length === 0) return
      ed.execCommand(new InsertTextCommand(id, ts, author, cursor.paragraphPath, cursor.offset, '\n'))
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
          // 段落末尾按 Delete → 合并该区域 (body/cell/header/footer) 内的下一段落
          const pool = ed.getPool()
          const doc = ed.getDocument()
          const region = resolveParagraphRegion(paraId, doc, pool)
          if (region && region.index >= 0 && region.index < region.siblings.length - 1) {
            const nextParaId = region.siblings[region.index + 1]
            const nextNode = pool.nodes.get(nextParaId)
            if (nextNode?.type === 'paragraph') {
              ed.execCommand(new MergeParagraphCommand(id, ts, author, [...cursor.paragraphPath.slice(0, -1), nextParaId]))
            }
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

  /** 删除选区内容: 跨段落逐段删除 — v21.0 Phase 4 区分 body/cell 作用域 */
  private deleteSelection(ed: Editor, sel: { anchor: { paragraphPath: string[]; offset: number }; focus: { paragraphPath: string[]; offset: number } }): void {
    const pool = ed.getPool()
    const doc = ed.getDocument()
    const aId = sel.anchor.paragraphPath[sel.anchor.paragraphPath.length - 1]
    const fId = sel.focus.paragraphPath[sel.focus.paragraphPath.length - 1]

    // 同段落选区 — 直接删除偏移范围
    if (aId === fId) {
      const start = Math.min(sel.anchor.offset, sel.focus.offset)
      const end = Math.max(sel.anchor.offset, sel.focus.offset)
      if (end > start) {
        ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', sel.anchor.paragraphPath, start, end))
      }
      return
    }

    // v21.0 Phase 4: 检测 scope
    const aCell = resolveCellPosition(aId, pool)
    const fCell = resolveCellPosition(fId, pool)

    // 跨域选区禁止 — 不删除任何内容
    if ((aCell && !fCell) || (!aCell && fCell)) return
    if (aCell && fCell && (aCell.tableId !== fCell.tableId || aCell.row !== fCell.row || aCell.col !== fCell.col)) return

    let siblings: string[]
    if (aCell) {
      const tableNode = pool.nodes.get(aCell.tableId) as { children?: string[] } | undefined
      if (!tableNode?.children) return
      const rowNode = pool.nodes.get(tableNode.children[aCell.row]) as { children?: string[] } | undefined
      if (!rowNode?.children) return
      const cellNode = pool.nodes.get(rowNode.children[aCell.col]) as { children?: string[] } | undefined
      if (!cellNode?.children) return
      siblings = cellNode.children
    } else {
      siblings = doc.body.children
    }

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
      const node = pool.nodes.get(paraId)
      if (!node || (node.type !== 'paragraph')) continue
      const path = [...sel.anchor.paragraphPath.slice(0, -1), paraId]
      if (pi === lo && pi === hi) {
        const start = Math.min(loOff, hiOff)
        const end = Math.max(loOff, hiOff)
        if (end > start) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, start, end))
      } else if (pi === hi) {
        if (hiOff > 0) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, 0, hiOff))
      } else if (pi === lo) {
        const para = pool.nodes.get(paraId) as { children?: string[] } | undefined
        let totalLen = 0
        if (para?.children) {
          for (const cid of para.children) {
            const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
            totalLen += n?.type === 'text' ? (n.text || '').length : 1
          }
        }
        if (loOff < totalLen) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, loOff, totalLen))
      } else {
        const para = pool.nodes.get(paraId) as { children?: string[] } | undefined
        let totalLen = 0
        if (para?.children) {
          for (const cid of para.children) {
            const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
            totalLen += n?.type === 'text' ? (n.text || '').length : 1
          }
        }
        if (totalLen > 0) ed.execCommand(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, 0, totalLen))
      }
    }

    // 跨段落选区: 合并残段
    if (lo < hi) {
      for (let mergeCount = (hi - lo); mergeCount > 0; mergeCount--) {
        const currentSiblings = aCell
          ? ((() => {
              const tn = pool.nodes.get(aCell.tableId) as { children?: string[] } | undefined
              const rn = pool.nodes.get(tn?.children?.[aCell.row] || '') as { children?: string[] } | undefined
              return (pool.nodes.get(rn?.children?.[aCell.col] || '') as { children?: string[] } | undefined)?.children || siblings
            })())
          : doc.body.children
        const nextParaId = currentSiblings[lo + 1]
        if (!nextParaId) break
        const mergePath = [...sel.anchor.paragraphPath.slice(0, -1), nextParaId]
        ed.execCommand(new MergeParagraphCommand(generateCommandId(), Date.now(), 'user', mergePath))
      }
    }
  }

  /** Tab / Shift+Tab: 在表格 cell 间移动光标 (Phase 4) */
  private navigateCell(
    ed: Editor,
    scope: { tableId: string; row: number; col: number },
    direction: 1 | -1,
  ): void {
    const pool = ed.getPool()
    const target = getAdjacentCell(pool, scope.tableId, scope.row, scope.col, direction)
    if (!target) return

    // 目标 cell 的第一个段落 (空 cell 则创建)
    let targetParaId = this.firstParagraphInCell(pool, target.cellId)
    if (!targetParaId) targetParaId = this.ensureCellParagraph(pool, target.cellId)
    if (!targetParaId) return

    // 更新光标到目标段落开头 + 清空选区
    const doc = ed.getDocument()
    const store = ed.getStore()
    const si = store as unknown as {
      _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean }; selection: { anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean }; active: boolean; granularity: string } } }
    }
    const path = [doc.id, targetParaId]
    si._state.runtime.cursor = { paragraphPath: path, offset: 0, visible: true }
    si._state.runtime.selection = {
      anchor: { paragraphPath: path, offset: 0, visible: false },
      focus: { paragraphPath: path, offset: 0, visible: false },
      active: false,
      granularity: 'character',
    }

    ed.getDraw().render(pool, store.state.runtime)
  }

  /** 查找 cell 内第一个段落 ID */
  private firstParagraphInCell(
    pool: { nodes: Map<string, { type?: string; children?: string[] }> },
    cellId: string,
  ): string | null {
    const cell = pool.nodes.get(cellId)
    if (!cell?.children) return null
    for (const id of cell.children) {
      if (pool.nodes.get(id)?.type === 'paragraph') return id
    }
    return null
  }

  /** 空 cell 创建空段落 (供 Tab 导航落点) */
  private ensureCellParagraph(
    pool: { nodes: Map<string, { type?: string; children?: string[] }> },
    cellId: string,
  ): string | null {
    const cell = pool.nodes.get(cellId)
    if (!cell) return null
    const para = createParagraph()
    cell.children = [...(cell.children || []), para.id]
    pool.nodes.set(para.id, para)
    return para.id
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

    // 计算段落内文本总长度
    const totalLen = this.getParagraphLength(paraId, pool)

    let newParaId = paraId
    let newOffset = cursor.offset

    switch (key) {
      // ---- 方向键: 块感知导航 (正文块序列 + 表格内网格移动) ----
      case 'ArrowLeft':
        if (cursor.offset > 0) {
          newOffset = cursor.offset - 1
        } else {
          const target = this.navigateBlock(paraId, doc, pool, -1, 'horizontal', cursor.offset)
          if (target) { newParaId = target.paraId; newOffset = target.offset }
        }
        break

      case 'ArrowRight':
        if (cursor.offset < totalLen) {
          newOffset = cursor.offset + 1
        } else {
          const target = this.navigateBlock(paraId, doc, pool, 1, 'horizontal', cursor.offset)
          if (target) { newParaId = target.paraId; newOffset = target.offset }
        }
        break

      case 'ArrowUp': {
        const target = this.navigateBlock(paraId, doc, pool, -1, 'vertical', cursor.offset)
        if (target) { newParaId = target.paraId; newOffset = target.offset }
        break
      }

      case 'ArrowDown': {
        const target = this.navigateBlock(paraId, doc, pool, 1, 'vertical', cursor.offset)
        if (target) { newParaId = target.paraId; newOffset = target.offset }
        break
      }

      // ---- Home/End: 区域段落导航 ----
      case 'Home': {
        const siblings = this.getParagraphSiblings(paraId, doc, pool)
        if (siblings.indexOf(paraId) >= 0) {
          if (ctrl) newParaId = siblings[0]
          newOffset = 0
        }
        break
      }

      case 'End': {
        const siblings = this.getParagraphSiblings(paraId, doc, pool)
        if (siblings.indexOf(paraId) >= 0) {
          if (ctrl) {
            newParaId = siblings[siblings.length - 1]
            newOffset = this.getParagraphLength(newParaId, pool)
          } else {
            newOffset = totalLen
          }
        }
        break
      }

      // ---- PageUp/PageDown (基于 SLIF 页面跳转) ----
      case 'PageUp':
      case 'PageDown': {
        const siblings = this.getParagraphSiblings(paraId, doc, pool)
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

  /** 查找光标所在段落在哪个 SLIF 页面
   *
   *  v21.0 Phase 3: 不再使用 getFlatPageItems。
   *  直接搜索 page.items + table cell innerItems + header/footer items。
   */
  private findCaretPage(ed: Editor, paraId: string): number {
    const pages = ed.getDraw().getPages()
    for (let i = 0; i < pages.length; i++) {
      if (this.pageContainsParagraph(pages[i], paraId)) return i
    }
    return -1
  }

  /** 检查页面是否包含指定段落 (含 body items + table cell items + header/footer items) */
  private pageContainsParagraph(page: SLIFPage, paraId: string): boolean {
    // 1. 检查 page.items 顶级块 (正文段落 / 分隔符等)
    for (const item of page.items) {
      if (item.nodeId === paraId) return true
      // 2. 表格: 深入 rows → cells → innerItems
      if (item.type === 'table' && item.rows) {
        for (const row of item.rows) {
          for (const cell of row.cells) {
            for (const ci of cell.items) {
              if (ci.nodeId === paraId) return true
            }
          }
        }
      }
    }
    // 3. header/footer items
    for (const hfItems of [page.headerItems || [], page.footerItems || []]) {
      for (const item of hfItems) {
        if (item.nodeId === paraId) return true
      }
    }
    return false
  }

  /** 在 SLIF 页面中找第一个属于 siblings 的段落 ID
   *
   *  v21.0 Phase 3: 不再使用 getFlatPageItems。
   *  直接搜索 page.items + table cell innerItems + header/footer items。
   */
  private findFirstParagraphOnPage(
    page: SLIFPage,
    pool: { nodes: Map<string, { type: string; children?: string[] }> },
    siblings: string[],
  ): string | null {
    // 1. 搜索正文顶级块
    for (const item of page.items) {
      if (siblings.includes(item.nodeId)) return item.nodeId
      // 2. 表格: 深入 cell innerItems
      if (item.type === 'table' && item.rows) {
        for (const row of item.rows) {
          for (const cell of row.cells) {
            for (const ci of cell.items) {
              if (siblings.includes(ci.nodeId)) return ci.nodeId
            }
          }
        }
      }
    }
    // 3. header/footer items
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

  /** 获取段落所在区域的兄弟段落列表 (body / header / footer), 过滤掉非段落节点
   *
   *  v20.35: 单元格内段落返回扩展 siblings, 包含表格前后段落,
   *  使 ArrowUp/ArrowDown 可以跳出/跳入表格。
   */
  private getParagraphSiblings(paraId: string, doc: { body: { children: string[] }; header?: string[]; footer?: string[] }, pool?: { nodes: Map<string, { type: string; children?: string[] }> }): string[] {
    const filterParas = (ids: string[]) => {
      if (!pool) return ids.filter(id => id === paraId || true)  // 无 pool 时不过滤
      return ids.filter(id => {
        if (id === paraId) return true
        const node = pool.nodes.get(id)
        return node?.type === 'paragraph'
      })
    }
    if (doc.body.children.includes(paraId)) return filterParas(doc.body.children)

    // 检查 paraId 是否在表格单元格内 — 向上回溯到 table, 返回扩展 siblings
    if (pool) {
      for (const [, n] of pool.nodes) {
        if (n.type !== 'cell') continue
        const cell = n as unknown as { id: string; children?: string[] }
        if (!cell.children?.includes(paraId)) continue

        // 找到该 cell 内的所有段落
        const cellParas = cell.children.filter(cid => {
          const cn = pool.nodes.get(cid)
          return cn?.type === 'paragraph'
        })

        // 向上找到 row → table
        let tableId: string | null = null
        for (const [, rn] of pool.nodes) {
          if (rn.type !== 'row') continue
          const row = rn as unknown as { id: string; children?: string[] }
          if (!row.children?.includes(cell.id)) continue
          // 找到 table
          for (const [, tn] of pool.nodes) {
            if (tn.type !== 'table') continue
            const table = tn as unknown as { id: string; children?: string[] }
            if (table.children?.includes(row.id)) { tableId = table.id; break }
          }
          break
        }

        if (!tableId) return cellParas  // 无法定位 table, 保留 cell 内段落

        // 在 body.children 中定位 table, 查找前后段落
        const tableIdx = doc.body.children.indexOf(tableId)
        if (tableIdx < 0) return cellParas

        let prevPara: string | null = null
        let nextPara: string | null = null

        // 向前查找最近的 paragraph
        for (let i = tableIdx - 1; i >= 0; i--) {
          const node = pool.nodes.get(doc.body.children[i])
          if (node?.type === 'paragraph') { prevPara = doc.body.children[i]; break }
        }
        // 向后查找最近的 paragraph
        for (let i = tableIdx + 1; i < doc.body.children.length; i++) {
          const node = pool.nodes.get(doc.body.children[i])
          if (node?.type === 'paragraph') { nextPara = doc.body.children[i]; break }
        }

        // 构建扩展 siblings: [prevPara?, ...cellParas, nextPara?]
        const result: string[] = []
        if (prevPara) result.push(prevPara)
        result.push(...cellParas)
        if (nextPara) result.push(nextPara)
        return result
      }
    }
    if (doc.header?.includes(paraId)) return filterParas(doc.header)
    if (doc.footer?.includes(paraId)) return filterParas(doc.footer)
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

  // ================================================================
  // 块感知导航 (Phase 6) — 正文块序列 + 表格内网格移动
  //
  // 修复方向键在「文字 / 表格 / 图片」之间切换不流畅、卡死的问题:
  //   1. 正文 ArrowUp/Down 在完整块序列 (paragraph/table/image/separator) 上移动:
  //      段落落点保列; 表格进入首/末 cell; 图片/分隔符/分节符跳过。
  //   2. cell 内 ArrowUp/Down 沿网格跨行移动, 越过表格边界跳出到相邻块。
  //   3. cell 边界 ArrowLeft/Right 沿阅读顺序移动, 越过边界跳出表格。
  // ================================================================

  /** 段落定位: 正文块下标 / 单元格(阅读坐标) / 页眉页脚下标 */
  private locateParagraph(
    paraId: string,
    doc: { body: { children: string[] }; header?: string[]; footer?: string[] },
    pool: NodePool,
  ):
    | { kind: 'body'; index: number }
    | { kind: 'cell'; tableId: string; tableIndex: number; row: number; col: number }
    | { kind: 'header'; index: number }
    | { kind: 'footer'; index: number }
    | null {
    const bi = doc.body.children.indexOf(paraId)
    if (bi >= 0) return { kind: 'body', index: bi }
    const cellPos = resolveCellPosition(paraId, pool)
    if (cellPos) {
      const ti = doc.body.children.indexOf(cellPos.tableId)
      return { kind: 'cell', tableId: cellPos.tableId, tableIndex: ti, row: cellPos.row, col: cellPos.col }
    }
    const hi = doc.header?.indexOf(paraId)
    if (hi !== undefined && hi >= 0) return { kind: 'header', index: hi }
    const fi = doc.footer?.indexOf(paraId)
    if (fi !== undefined && fi >= 0) return { kind: 'footer', index: fi }
    return null
  }

  /** 方向键块导航统一入口 */
  private navigateBlock(
    paraId: string,
    doc: { body: { children: string[] }; header?: string[]; footer?: string[] },
    pool: NodePool,
    dir: 1 | -1,
    mode: 'horizontal' | 'vertical',
    cursorOffset: number,
  ): { paraId: string; offset: number } | null {
    const loc = this.locateParagraph(paraId, doc, pool)
    if (!loc) return null

    if (loc.kind === 'header' || loc.kind === 'footer') {
      // 页眉/页脚区域隔离: 仅在该区域段落间移动
      const region = loc.kind === 'header' ? doc.header! : doc.footer!
      const targetIdx = loc.index + dir
      if (targetIdx >= 0 && targetIdx < region.length) {
        const targetId = region[targetIdx]
        return { paraId: targetId, offset: this.landingOffset(targetId, pool, dir, mode, cursorOffset) }
      }
      return null
    }

    if (loc.kind === 'body') {
      return this.navigateSequence(doc.body.children, pool, loc.index, dir, mode, cursorOffset)
    }

    // cell 段落: 先在 cell 内部段落/块序列上移动, 边界再跨 cell
    const cellId = this.cellIdAt(pool, loc.tableId, loc.row, loc.col)
    const cell = cellId ? (pool.nodes.get(cellId) as { children?: string[] } | undefined) : undefined
    if (cell?.children) {
      const cellIdx = cell.children.indexOf(paraId)
      if (cellIdx >= 0) {
        const within = this.navigateSequence(cell.children, pool, cellIdx, dir, mode, cursorOffset)
        if (within) return within
      }
    }

    return mode === 'horizontal'
      ? this.navigateCellHorizontal(doc, pool, loc, dir)
      : this.navigateCellVertical(doc, pool, loc, dir, cursorOffset)
  }

  /** 块序列导航: 从 startIndex 沿 dir 找下一个可落点块 (段落落点, 表格进入, 其他跳过) */
  private navigateSequence(
    blocks: string[],
    pool: NodePool,
    startIndex: number,
    dir: 1 | -1,
    mode: 'horizontal' | 'vertical',
    cursorOffset: number,
  ): { paraId: string; offset: number } | null {
    for (let i = startIndex + dir; i >= 0 && i < blocks.length; i += dir) {
      const blockId = blocks[i]
      const node = pool.nodes.get(blockId)
      if (node?.type === 'paragraph') {
        return { paraId: blockId, offset: this.landingOffset(blockId, pool, dir, mode, cursorOffset) }
      }
      if (node?.type === 'table') {
        // 进入表格: 前向走首行首列; 后向垂直走末行首列, 后向水平走末行末列
        const edge = dir === 1 ? 'top-left' : (mode === 'vertical' ? 'bottom-left' : 'bottom-right')
        const enter = this.enterTable(pool, blockId, edge)
        if (enter) return { paraId: enter, offset: 0 }
        // 空表 → 继续找下一个块
      }
      // image / separator / section_break → 跳过
    }
    return null
  }

  /** cell 内水平移动 (阅读顺序), 越界跳出表格 */
  private navigateCellHorizontal(
    doc: { body: { children: string[] } },
    pool: NodePool,
    loc: { kind: 'cell'; tableId: string; tableIndex: number; row: number; col: number },
    dir: 1 | -1,
  ): { paraId: string; offset: number } | null {
    const target = getAdjacentCell(pool, loc.tableId, loc.row, loc.col, dir)
    if (target) {
      const enter = this.enterCellAtEdge(pool, target.cellId, dir)
      if (enter) return enter
    }
    // 表格边界 → 跳出到相邻块
    if (loc.tableIndex < 0) return null
    return this.navigateSequence(doc.body.children, pool, loc.tableIndex, dir, 'horizontal', 0)
  }

  /** cell 内垂直移动 (网格坐标), 越界跳出表格 */
  private navigateCellVertical(
    doc: { body: { children: string[] } },
    pool: NodePool,
    loc: { kind: 'cell'; tableId: string; tableIndex: number; row: number; col: number },
    dir: 1 | -1,
    cursorOffset: number,
  ): { paraId: string; offset: number } | null {
    const grid = buildCellGrid(pool, loc.tableId)
    const cellId = this.cellIdAt(pool, loc.tableId, loc.row, loc.col)
    const gc = cellId ? grid.byId.get(cellId) : undefined
    if (gc) {
      const targetRow = gc.row + dir
      if (targetRow >= 0 && targetRow < grid.numRows) {
        const targetCell = this.findCellInRow(grid, targetRow, gc.col)
        if (targetCell) {
          const paraId = this.firstParagraphInCell(pool, targetCell.cellId) ?? this.ensureCellParagraph(pool, targetCell.cellId)
          if (paraId) {
            return { paraId, offset: Math.min(cursorOffset, this.getParagraphLength(paraId, pool)) }
          }
        }
        return null
      }
    }
    // 越过表格边界 → 跳出
    if (loc.tableIndex < 0) return null
    return this.navigateSequence(doc.body.children, pool, loc.tableIndex, dir, 'vertical', cursorOffset)
  }

  /** 落点偏移: 垂直保列, 水平按方向到段首(→)/段尾(←) */
  private landingOffset(
    paraId: string,
    pool: { nodes: Map<string, { type: string; children?: string[]; text?: string }> },
    dir: 1 | -1,
    mode: 'horizontal' | 'vertical',
    cursorOffset: number,
  ): number {
    const len = this.getParagraphLength(paraId, pool)
    if (mode === 'vertical') return Math.min(cursorOffset, len)
    return dir === 1 ? 0 : len
  }

  /** 进入表格某角 cell 的第一个段落 */
  private enterTable(
    pool: { nodes: Map<string, { type?: string; children?: string[] }> },
    tableId: string,
    edge: 'top-left' | 'bottom-left' | 'bottom-right',
  ): string | null {
    const table = pool.nodes.get(tableId)
    if (!table?.children?.length) return null
    const rowIdx = edge === 'top-left' ? 0 : table.children.length - 1
    const row = pool.nodes.get(table.children[rowIdx])
    if (!row?.children?.length) return null
    const cellIdx = edge === 'bottom-right' ? row.children.length - 1 : 0
    const cellId = row.children[cellIdx]
    if (!cellId) return null
    return this.firstParagraphInCell(pool, cellId) ?? this.ensureCellParagraph(pool, cellId)
  }

  /** 进入相邻 cell 的落点: 前向段首(offset 0), 后向末段段尾 */
  private enterCellAtEdge(
    pool: NodePool,
    cellId: string,
    dir: 1 | -1,
  ): { paraId: string; offset: number } | null {
    const paraId = dir === 1
      ? this.firstParagraphInCell(pool, cellId) ?? this.ensureCellParagraph(pool, cellId)
      : this.lastParagraphInCell(pool, cellId) ?? this.ensureCellParagraph(pool, cellId)
    if (!paraId) return null
    return { paraId, offset: dir === 1 ? 0 : this.getParagraphLength(paraId, pool) }
  }

  /** 查找 cell 内最后一个段落 ID */
  private lastParagraphInCell(
    pool: { nodes: Map<string, { type?: string; children?: string[] }> },
    cellId: string,
  ): string | null {
    const cell = pool.nodes.get(cellId)
    if (!cell?.children?.length) return null
    for (let i = cell.children.length - 1; i >= 0; i--) {
      if (pool.nodes.get(cell.children[i])?.type === 'paragraph') return cell.children[i]
    }
    return null
  }

  /** 取 (行下标, 列下标) 处的 cellId (阅读坐标) */
  private cellIdAt(
    pool: { nodes: Map<string, { type?: string; children?: string[] }> },
    tableId: string,
    row: number,
    col: number,
  ): string | null {
    const table = pool.nodes.get(tableId)
    const rowNode = pool.nodes.get(table?.children?.[row] || '')
    return rowNode?.children?.[col] || null
  }

  /** 在网格目标行内找与当前列对齐的 cell (含 colspan 覆盖, 退化为左侧最近) */
  private findCellInRow(grid: TableGrid, row: number, col: number): GridCell | undefined {
    const rowCells = grid.cells.filter(gc => gc.row === row)
    if (rowCells.length === 0) return undefined
    const exact = rowCells.find(gc => gc.col <= col && col < gc.col + gc.colspan)
    if (exact) return exact
    const leftAligned = rowCells.filter(gc => gc.col <= col).sort((a, b) => b.col - a.col)[0]
    if (leftAligned) return leftAligned
    return rowCells[0]
  }

  destroy(): void {
    this.container.removeEventListener('keydown', this.onKeyDown)
  }
}
