// ================================================================
// MouseHandler — 鼠标拖拽选区, 支持跨段落/跨行 (架构 §8.2, v20.34)
//
// Selection 模型: anchor/focus 各自独立 paragraphPath + offset
// 同段落: offset 直接比较; 跨段落: 锚点段选中到尾, 终点段从0选中
// ================================================================

import type { Editor } from '../Editor'
import type { Paragraph } from '../document/DocumentModel'
import type { SLIFPage } from '../layout/SLIF'
import { cumulativeCharWidths, findCharIndexAtX } from '../layout/CharWidthHelper'

/** 双击时间阈值 (ms) */
const DOUBLE_CLICK_THRESHOLD = 400
/** 双击位置阈值 (px) — 两次点击坐标差在此范围内视为双击 */
const DOUBLE_CLICK_DISTANCE = 8

export class MouseHandler {
  private editor: Editor
  private container: HTMLElement
  private dragging = false
  private dragMoved = false

  // 选区锚点 — mousedown 时记录, 整个拖拽期间不变
  private anchorParaPath: string[] = []
  private anchorOffset = 0

  // 鼠标按下位置 (用于阈值判定)
  private dragStartX = 0
  private dragStartY = 0

  // 双击检测
  private lastClickTime = 0
  private lastClickX = 0
  private lastClickY = 0

  // 三击检测
  private clickCount = 0
  private clickCountTimer: ReturnType<typeof setTimeout> | null = null

  // 双击/三击标记: 阻止后续 click 事件清空选区 (Editor.handleClick 检查)
  private _wasMultiClick = false

  constructor(editor: Editor, container: HTMLElement) {
    this.editor = editor
    this.container = container
    container.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
  }

  /** click 事件到来时检查: 拖拽过就不要重复处理光标 */
  wasDragging(): boolean {
    if (this.dragMoved) { this.dragMoved = false; return true }
    return false
  }

  /** click 事件到来时检查: 双击/三击已处理选区, 不要清空 */
  wasMultiClick(): boolean {
    if (this._wasMultiClick) { this._wasMultiClick = false; return true }
    return false
  }

  private onMouseDown = (e: MouseEvent) => {
    this.dragging = true
    this.dragMoved = false
    this.dragStartX = e.clientX
    this.dragStartY = e.clientY

    // 先检查是否在页眉/页脚区域
    const hfSection = this.detectHeaderFooterRegion(e.clientX, e.clientY)

    // --- 页眉页脚编辑模式下, 单击定位光标 ---
    if (hfSection && this.editor.getDraw().isHeaderFooterEditActive() && this.editor.getDraw().getHeaderFooterEditSection() === hfSection) {
      // 双击检测 (用于切换编辑的 header/footer 区域)
      const now = Date.now()
      const dx = Math.abs(e.clientX - this.lastClickX)
      const dy = Math.abs(e.clientY - this.lastClickY)
      const dt = now - this.lastClickTime

      this.lastClickTime = now
      this.lastClickX = e.clientX
      this.lastClickY = e.clientY

      if (dt < DOUBLE_CLICK_THRESHOLD && dx < DOUBLE_CLICK_DISTANCE && dy < DOUBLE_CLICK_DISTANCE) {
        // 双击: 重新激活 (已在编辑模式, 保持)
        this.editor.getDraw().setHeaderFooterEditActive(true, hfSection)
        this.editor.getEventBus().emit('headerFooter:dblclick', hfSection)
        return
      }

      // 单击: 在页眉/页脚区域内定位光标
      const hfResult = this.hitTestHeaderFooter(e.clientX, e.clientY, hfSection)
      if (hfResult) {
        const store = this.editor.getStore()
        const si = store as unknown as {
          _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean }; selection: { active: boolean; granularity: string; anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean } } } }
        }

        si._state.runtime.cursor = {
          paragraphPath: [...hfResult.paraPath],
          offset: hfResult.offset,
          visible: true,
        }

        si._state.runtime.selection = {
          anchor: { paragraphPath: [...hfResult.paraPath], offset: hfResult.offset, visible: false },
          focus: { paragraphPath: [...hfResult.paraPath], offset: hfResult.offset, visible: false },
          active: false,
          granularity: 'character' as const,
        }

        this.anchorParaPath = [...hfResult.paraPath]
        this.anchorOffset = hfResult.offset

        this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
      }
      return
    }

    if (hfSection) {
      // 页眉/页脚区域, 但编辑模式未激活或区域不匹配
      const now = Date.now()
      const dx = Math.abs(e.clientX - this.lastClickX)
      const dy = Math.abs(e.clientY - this.lastClickY)
      const dt = now - this.lastClickTime

      this.lastClickTime = now
      this.lastClickX = e.clientX
      this.lastClickY = e.clientY

      if (dt < DOUBLE_CLICK_THRESHOLD && dx < DOUBLE_CLICK_DISTANCE && dy < DOUBLE_CLICK_DISTANCE) {
        // 双击页眉/页脚 → 激活编辑模式
        this.editor.getDraw().setHeaderFooterEditActive(true, hfSection)
        this.editor.getEventBus().emit('headerFooter:dblclick', hfSection)

        // 确保目标区域有段落 (无则创建) + 光标定位到第一个段落
        const doc = this.editor.getDocument()
        const paraId = this.editor.ensureHeaderFooterParagraph(hfSection)
        const store = this.editor.getStore()
        const si = store as unknown as {
          _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean }; selection: { active: boolean; granularity: string; anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean } } } }
        }
        si._state.runtime.cursor = {
          paragraphPath: [doc.id, paraId],
          offset: 0,
          visible: true,
        }
        si._state.runtime.selection = {
          anchor: { paragraphPath: [doc.id, paraId], offset: 0, visible: false },
          focus: { paragraphPath: [doc.id, paraId], offset: 0, visible: false },
          active: false,
          granularity: 'character' as const,
        }
        this.anchorParaPath = [doc.id, paraId]
        this.anchorOffset = 0
        this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
        return
        return
      }
      // 单击不处理 (拖拽选区对 header/footer 无意义)
      return
    }

    // 在正文区域点击 → 如果当前在页眉页脚编辑模式, 退出
    const draw = this.editor.getDraw()
    if (draw.isHeaderFooterEditActive()) {
      draw.setHeaderFooterEditActive(false)
      this.editor.getEventBus().emit('body:click')
      return
    }

    // 正常正文命中检测 → 设置光标 + 记录选区锚点
    const result = this.hitTest(e.clientX, e.clientY)
    if (!result) return

    const store = this.editor.getStore()
    const si = store as unknown as {
      _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean }; selection: { active: boolean; granularity: string; anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean } } } }
    }

    // --- 双击/三击检测 ---
    const now = Date.now()
    const dx = Math.abs(e.clientX - this.lastClickX)
    const dy = Math.abs(e.clientY - this.lastClickY)
    const dt = now - this.lastClickTime

    this.lastClickTime = now
    this.lastClickX = e.clientX
    this.lastClickY = e.clientY

    if (dt < DOUBLE_CLICK_THRESHOLD && dx < DOUBLE_CLICK_DISTANCE && dy < DOUBLE_CLICK_DISTANCE) {
      this.clickCount++
      if (this.clickCountTimer) { clearTimeout(this.clickCountTimer); this.clickCountTimer = null }
    } else {
      this.clickCount = 1
    }

    // 超时重置: 若在 DOUBLE_CLICK_THRESHOLD 内没有新的点击, 重置计数
    if (this.clickCountTimer) clearTimeout(this.clickCountTimer)
    this.clickCountTimer = setTimeout(() => { this.clickCount = 0 }, DOUBLE_CLICK_THRESHOLD)

    if (this.clickCount === 2) {
      // 双击 → 选中当前词
      const para = this.editor.getPool().nodes.get(result.paraPath[result.paraPath.length - 1]) as { children?: string[] } | undefined
      if (para?.children) {
        const fullText = this.getParagraphFullText(para)
        const { start, end } = this.findWordBoundaries(fullText, result.offset)
        this._wasMultiClick = true
        si._state.runtime.cursor = {
          paragraphPath: [...result.paraPath],
          offset: end,
          visible: true,
        }
        si._state.runtime.selection = {
          anchor: { paragraphPath: [...result.paraPath], offset: start, visible: false },
          focus: { paragraphPath: [...result.paraPath], offset: end, visible: false },
          active: start !== end,
          granularity: 'character',
        }
        this.anchorParaPath = [...result.paraPath]
        this.anchorOffset = start
        this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
        return
      }
    } else if (this.clickCount >= 3) {
      // 三击 → 选中整段
      const para = this.editor.getPool().nodes.get(result.paraPath[result.paraPath.length - 1]) as { children?: string[] } | undefined
      if (para?.children) {
        const totalLen = this.getParagraphFullText(para).length
        this._wasMultiClick = true
        si._state.runtime.cursor = {
          paragraphPath: [...result.paraPath],
          offset: totalLen,
          visible: true,
        }
        si._state.runtime.selection = {
          anchor: { paragraphPath: [...result.paraPath], offset: 0, visible: false },
          focus: { paragraphPath: [...result.paraPath], offset: totalLen, visible: false },
          active: totalLen > 0,
          granularity: 'character',
        }
        this.anchorParaPath = [...result.paraPath]
        this.anchorOffset = 0
        this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
        return
      }
    }

    // 更新光标到点击位置
    si._state.runtime.cursor = {
      paragraphPath: [...result.paraPath],
      offset: result.offset,
      visible: true,
    }

    // 清空选区, 记录新选区锚点
    si._state.runtime.selection = {
      anchor: { paragraphPath: [...result.paraPath], offset: result.offset, visible: false },
      focus: { paragraphPath: [...result.paraPath], offset: result.offset, visible: false },
      active: false,
      granularity: 'character' as const,
    }

    this.anchorParaPath = [...result.paraPath]
    this.anchorOffset = result.offset

    // 检查是否在表格单元格内 → 选中单元格 (Shift+Click 用于合并/拆分)
    if (!e.shiftKey) {
      const tableInfo = this.findTableAndCell(result.paraPath)
      if (tableInfo) {
        this.editor.selectTableCell(tableInfo.tableId, tableInfo.row, tableInfo.col)
        return
      }
    }

    this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
  }

  /** 查找段落所属的表格和单元格位置 */
  private findTableAndCell(paraPath: string[]): { tableId: string; row: number; col: number } | null {
    if (paraPath.length < 2) return null
    const paraId = paraPath[paraPath.length - 1]
    const pool = this.editor.getPool()

    for (const [, node] of pool.nodes) {
      if (node.type !== 'cell') continue
      const cell = node as unknown as { id: string; children?: string[] }
      if (!cell.children?.includes(paraId)) continue

      // 找到 cell → 向上找到 row 和 table
      for (const [, n2] of pool.nodes) {
        if (n2.type !== 'row') continue
        const r = n2 as unknown as { id: string; children?: string[] }
        const colIdx = r.children?.indexOf(cell.id)
        if (colIdx === undefined || colIdx < 0) continue

        for (const [, n3] of pool.nodes) {
          if (n3.type !== 'table') continue
          const t = n3 as unknown as { id: string; children?: string[] }
          const rowIdx = t.children?.indexOf(r.id)
          if (rowIdx !== undefined && rowIdx >= 0) {
            return { tableId: t.id, row: rowIdx, col: colIdx }
          }
        }
      }
    }
    return null
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.dragging) return

    // 阈值判定
    if (!this.dragMoved) {
      const dx = Math.abs(e.clientX - this.dragStartX)
      const dy = Math.abs(e.clientY - this.dragStartY)
      if (dx < 3 && dy < 3) return
      this.dragMoved = true
    }

    const result = this.hitTest(e.clientX, e.clientY)
    if (!result) return

    const focusParaPath = result.paraPath
    const focusOffset = result.offset

    const store = this.editor.getStore()
    const si = store as unknown as {
      _state: { runtime: { selection: { anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean }; active: boolean; granularity: string } } }
    }

    const samePara = this.anchorParaPath.join('.') === focusParaPath.join('.')

    if (samePara) {
      // 同段落: offset 直接比较, start <= end
      const start = Math.min(this.anchorOffset, focusOffset)
      const end = Math.max(this.anchorOffset, focusOffset)
      si._state.runtime.selection = {
        anchor: { paragraphPath: [...this.anchorParaPath], offset: start, visible: false },
        focus: { paragraphPath: [...focusParaPath], offset: end, visible: false },
        active: start !== end,
        granularity: 'character',
      }
    } else {
      // 跨段落: anchor 保留下原始位置, focus 用当前段落+offset
      si._state.runtime.selection = {
        anchor: { paragraphPath: [...this.anchorParaPath], offset: this.anchorOffset, visible: false },
        focus: { paragraphPath: [...focusParaPath], offset: focusOffset, visible: false },
        active: true,
        granularity: 'character',
      }
    }

    this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
  }

  private onMouseUp = () => {
    this.dragging = false
  }

  /** 命中检测 — 返回段落路径 + 字符偏移 */
  private hitTest(clientX: number, clientY: number): { paraPath: string[]; offset: number } | null {
    const rect = this.container.getBoundingClientRect()
    const screenX = clientX - rect.left
    const screenY = clientY - rect.top + this.editor.getDraw().getCoordinateSystem().transform.scrollY

    const pages = this.editor.getDraw().getPages()
    if (pages.length === 0) return null

    let pageIndex = 0; let localY = screenY
    for (let i = 0; i < pages.length; i++) {
      if (localY < pages[i].height) { pageIndex = i; break }
      localY -= pages[i].height; pageIndex = i
    }
    const page = pages[pageIndex]
    if (!page) return null

    const viewportW = this.container.clientWidth
    const offsetX = Math.max(0, (viewportW - page.width) / 2)
    const docX = screenX - offsetX

    const nodeId = this.editor.getDraw().getHitTestIndex().hitTest(docX, localY, pageIndex)
    if (!nodeId) return null

    const para = this.findParagraphContaining(nodeId)
    if (!para) return null

    const offset = this.computeOffsetAtX(para, docX, page)
    const doc = this.editor.getDocument()
    return { paraPath: [doc.id, para.id], offset }
  }

  private findParagraphContaining(nodeId: string): Paragraph | null {
    for (const [, node] of this.editor.getPool().nodes) {
      if (node.type === 'paragraph') {
        const para = node as unknown as Paragraph
        if (para.children.includes(nodeId) || nodeId === node.id) return para
      }
    }
    return null
  }

  private computeOffsetAtX(para: Paragraph, docX: number, page: SLIFPage): number {
    let accumulated = 0
    const pool = this.editor.getPool()

    for (const childId of para.children) {
      const item = page.items.find(it => it.nodeId === childId)
      const textNode = pool.nodes.get(childId) as unknown as { text?: string; font?: string; size?: number; bold?: boolean; italic?: boolean } | undefined
      const text = textNode?.text || ''
      if (item) {
        const bodyText = item.text || ''
        const bodyW = item.markerWidth != null ? item.width - item.markerWidth : item.width
        if (docX <= item.x + bodyW) {
          const relativeX = docX - item.x
          // 逐字符累积宽度, 正确区分半角/全角字符像素宽度
          const cumWidths = cumulativeCharWidths(bodyText, {
            font: textNode?.font || item.font || 'SimSun',
            size: textNode?.size || item.size || 16,
            bold: textNode?.bold ?? item.bold,
            italic: textNode?.italic ?? item.italic,
          })
          const charIdx = findCharIndexAtX(relativeX, cumWidths, bodyText.length || 0)
          return Math.max(0, accumulated + charIdx)
        }
      }
      accumulated += text.length
    }
    return Math.max(0, accumulated)
  }

  /** 检测点击位置是否在页眉/页脚区域 */
  private detectHeaderFooterRegion(clientX: number, clientY: number): 'header' | 'footer' | null {
    const rect = this.container.getBoundingClientRect()
    const screenY = clientY - rect.top + this.editor.getDraw().getCoordinateSystem().transform.scrollY

    const pages = this.editor.getDraw().getPages()
    if (pages.length === 0) return null

    // 计算点击在哪一页
    let pageIndex = 0; let localY = screenY
    for (let i = 0; i < pages.length; i++) {
      if (localY < pages[i].height) { pageIndex = i; break }
      localY -= pages[i].height; pageIndex = i
    }
    const page = pages[pageIndex]
    if (!page) return null

    // 检查视口偏移
    const viewportW = this.container.clientWidth
    const offsetX = Math.max(0, (viewportW - page.width) / 2)
    const docX = clientX - rect.left - offsetX
    if (docX < 0 || docX > page.width) return null // 超出页面宽度

    // 页眉区域: y 0 ~ headerHeight
    const headerH = page.headerHeight ?? 42
    if (localY >= 0 && localY <= headerH) return 'header'

    // 页脚区域: y from pageHeight - footerHeight to pageHeight
    const footerH = page.footerHeight ?? 42
    if (localY >= page.height - footerH && localY <= page.height) return 'footer'

    return null
  }

  /**
   * 页眉/页脚区域命中检测 — 返回段落路径 + 字符偏移
   * 仅在页眉页脚编辑模式下使用
   */
  private hitTestHeaderFooter(
    clientX: number,
    clientY: number,
    section: 'header' | 'footer',
  ): { paraPath: string[]; offset: number } | null {
    const rect = this.container.getBoundingClientRect()
    const screenX = clientX - rect.left
    const screenY = clientY - rect.top + this.editor.getDraw().getCoordinateSystem().transform.scrollY

    const pages = this.editor.getDraw().getPages()
    if (pages.length === 0) return null

    let pageIndex = 0; let localY = screenY
    for (let i = 0; i < pages.length; i++) {
      if (localY < pages[i].height) { pageIndex = i; break }
      localY -= pages[i].height; pageIndex = i
    }
    const page = pages[pageIndex]
    if (!page) return null

    const viewportW = this.container.clientWidth
    const offsetX = Math.max(0, (viewportW - page.width) / 2)
    const docX = screenX - offsetX

    // 使用 Draw 的页眉页脚命中检测
    const result = this.editor.getDraw().findHeaderFooterItemAt(docX, localY, pageIndex, section)
    if (!result) return null

    // 查找该 nodeId 所属的段落
    const para = this.findParagraphContaining(result.nodeId)
    if (!para) return null

    // 计算段落内的字符偏移
    const items = section === 'header' ? (page.headerItems || []) : (page.footerItems || [])
    let accumulated = 0
    for (const childId of para.children) {
      const item = items.find(it => it.nodeId === childId)
      const text = (this.editor.getPool().nodes.get(childId) as unknown as { text?: string })?.text || ''
      if (item) {
        const itemTextLen = item.text?.length || 1
        const charWidth = item.width / itemTextLen
        if (docX <= item.x + item.width) {
          const charIdx = Math.round((docX - item.x) / charWidth)
          return {
            paraPath: [this.editor.getDocument().id, para.id],
            offset: Math.max(0, accumulated + Math.max(0, Math.min(charIdx, itemTextLen))),
          }
        }
      }
      accumulated += text.length
    }
    return { paraPath: [this.editor.getDocument().id, para.id], offset: Math.max(0, accumulated) }
  }

  destroy(): void {
    this.container.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
    if (this.clickCountTimer) clearTimeout(this.clickCountTimer)
  }

  /** 获取段落全部文本 (拼接所有 TextNode) */
  private getParagraphFullText(para: { children?: string[] }): string {
    const pool = this.editor.getPool()
    let text = ''
    if (para.children) {
      for (const cid of para.children) {
        const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
        if (n?.type === 'text') text += n.text || ''
      }
    }
    return text
  }

  /** 查找词边界 — 以 offset 为中心向两侧扩展, 匹配 \w 字符序列 (含中文等) */
  private findWordBoundaries(text: string, offset: number): { start: number; end: number } {
    if (text.length === 0) return { start: 0, end: 0 }
    const clamped = Math.max(0, Math.min(offset, text.length))
    // 词字符正则: Unicode 字母/数字 + CJK 字符
    const wordRe = /[\w一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/
    let start = clamped
    let end = clamped
    // 如果点击位置在非词字符上, 退化为字符选区
    const char = text.charAt(clamped) || text.charAt(Math.max(0, clamped - 1)) || ''
    if (!wordRe.test(char)) {
      // 点击在空白/标点上: 选相邻空白
      while (start > 0 && !wordRe.test(text.charAt(start - 1))) start--
      while (end < text.length && !wordRe.test(text.charAt(end))) end++
      return { start, end }
    }
    while (start > 0 && wordRe.test(text.charAt(start - 1))) start--
    while (end < text.length && wordRe.test(text.charAt(end))) end++
    return { start, end }
  }
}
