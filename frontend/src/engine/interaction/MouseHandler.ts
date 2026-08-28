// ================================================================
// MouseHandler — 鼠标拖拽选区, 支持跨段落/跨行 (架构 §8.2, v20.34)
//
// Selection 模型: anchor/focus 各自独立 paragraphPath + offset
// 同段落: offset 直接比较; 跨段落: 锚点段选中到尾, 终点段从0选中
// ================================================================

import type { Editor } from '../Editor'
import type { Paragraph } from '../document/core/DocumentModel'
import type { SLIFPage } from '../layout/core/SLIF'
import { cumulativeCharWidths, findCharIndexAtX } from '../layout/text/CharWidthHelper'
import { screenToDoc, findPageByDocY, pageCenteringOffset } from '../layout/table/TableCoordUtil'
import { HitTestIndex } from '../render/HitTestIndex'
import { getCellGridPosition } from '../document/table/TableOps'

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

  // 单元格框选拖拽状态
  private cellBoxActive = false
  private cellBoxTableId = ''

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
    this.cellBoxActive = false
    this.dragStartX = e.clientX
    this.dragStartY = e.clientY

    // 先检查是否在页眉/页脚区域
    const hfSection = this.detectHeaderFooterRegion(e.clientX, e.clientY)

    // --- 页眉页脚编辑模式下, 单击定位光标 ---
    if (hfSection && this.editor.isHeaderFooterEditActive() && this.editor.getHeaderFooterEditSection() === hfSection) {
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
        this.editor.setHeaderFooterEditActive(true, hfSection)
        return
      }

      // 单击: 在页眉/页脚区域内定位光标
      const hfResult = this.hitTestHeaderFooter(e.clientX, e.clientY, hfSection)
      if (hfResult) {
        const store = this.editor.getStore()

        store.setCursor({
          paragraphPath: [...hfResult.paraPath],
          offset: hfResult.offset,
          visible: true,
        })

        store.setSelection({
          anchor: { paragraphPath: [...hfResult.paraPath], offset: hfResult.offset, visible: false },
          focus: { paragraphPath: [...hfResult.paraPath], offset: hfResult.offset, visible: false },
          active: false,
          granularity: 'character',
        })

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
        this.editor.setHeaderFooterEditActive(true, hfSection)

        // 确保目标区域有段落 (无则创建) + 光标定位到第一个段落
        const doc = this.editor.getDocument()
        const paraId = this.editor.ensureHeaderFooterParagraph(hfSection)
        const store = this.editor.getStore()
        store.setCursor({
          paragraphPath: [doc.id, paraId],
          offset: 0,
          visible: true,
        })
        store.setSelection({
          anchor: { paragraphPath: [doc.id, paraId], offset: 0, visible: false },
          focus: { paragraphPath: [doc.id, paraId], offset: 0, visible: false },
          active: false,
          granularity: 'character',
        })
        this.anchorParaPath = [doc.id, paraId]
        this.anchorOffset = 0
        // 重布局让新创建的页眉/页脚段落在 page.footerItems/page.headerItems 中出现
        this.editor.getDraw().recomputeLayout(this.editor.getPool())
        this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
        return
      }
      // 单击不处理 (拖拽选区对 header/footer 无意义)
      return
    }

    // 在正文区域点击 → 如果当前在页眉页脚编辑模式, 退出
    if (this.editor.isHeaderFooterEditActive()) {
      this.editor.setHeaderFooterEditActive(false)
      return
    }

    // 正常正文命中检测 → 设置光标 + 记录选区锚点
    const result = this.hitTest(e.clientX, e.clientY)
    if (!result) return

    const store = this.editor.getStore()

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
        store.setCursor({
          paragraphPath: [...result.paraPath],
          offset: end,
          visible: true,
        })
        store.setSelection({
          anchor: { paragraphPath: [...result.paraPath], offset: start, visible: false },
          focus: { paragraphPath: [...result.paraPath], offset: end, visible: false },
          active: start !== end,
          granularity: 'character',
        })
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
        store.setCursor({
          paragraphPath: [...result.paraPath],
          offset: totalLen,
          visible: true,
        })
        store.setSelection({
          anchor: { paragraphPath: [...result.paraPath], offset: 0, visible: false },
          focus: { paragraphPath: [...result.paraPath], offset: totalLen, visible: false },
          active: totalLen > 0,
          granularity: 'character',
        })
        this.anchorParaPath = [...result.paraPath]
        this.anchorOffset = 0
        this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
        return
      }
    }

    // 更新光标到点击位置
    store.setCursor({
      paragraphPath: [...result.paraPath],
      offset: result.offset,
      visible: true,
    })

    // 清空选区, 记录新选区锚点
    store.setSelection({
      anchor: { paragraphPath: [...result.paraPath], offset: result.offset, visible: false },
      focus: { paragraphPath: [...result.paraPath], offset: result.offset, visible: false },
      active: false,
      granularity: 'character',
    })

    this.anchorParaPath = [...result.paraPath]
    this.anchorOffset = result.offset

    // 检查是否在表格单元格内 → 启动单元格框选 (拖拽扩展)
    if (!e.shiftKey) {
      const tableInfo = this.findTableAndCell(result.paraPath)
      if (tableInfo) {
        this.editor.selectTableCell(tableInfo.tableId, tableInfo.row, tableInfo.col)
        this.cellBoxActive = true
        this.cellBoxTableId = tableInfo.tableId
        return
      }
    }

    // 非表格区域点击 → 清除表格框选
    this.editor.clearTableSelection()
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

    // 单元格框选拖拽 → 扩展框选终点
    if (this.cellBoxActive) {
      const result = this.hitTest(e.clientX, e.clientY)
      if (result) {
        const tableInfo = this.findTableAndCell(result.paraPath)
        if (tableInfo && tableInfo.tableId === this.cellBoxTableId) {
          const gp = getCellGridPosition(this.editor.getPool(), tableInfo.tableId, tableInfo.row, tableInfo.col)
          if (gp) this.editor.extendCellBoxSelection(tableInfo.tableId, gp.row, gp.col)
        }
      }
      return
    }

    const result = this.hitTest(e.clientX, e.clientY)
    if (!result) return

    const focusParaPath = result.paraPath
    const focusOffset = result.offset

    const store = this.editor.getStore()

    const samePara = this.anchorParaPath.join('.') === focusParaPath.join('.')

    if (samePara) {
      // 同段落: offset 直接比较, start <= end
      const start = Math.min(this.anchorOffset, focusOffset)
      const end = Math.max(this.anchorOffset, focusOffset)
      store.setSelection({
        anchor: { paragraphPath: [...this.anchorParaPath], offset: start, visible: false },
        focus: { paragraphPath: [...focusParaPath], offset: end, visible: false },
        active: start !== end,
        granularity: 'character',
      })
    } else {
      // 跨段落: anchor 保留下原始位置, focus 用当前段落+offset
      store.setSelection({
        anchor: { paragraphPath: [...this.anchorParaPath], offset: this.anchorOffset, visible: false },
        focus: { paragraphPath: [...focusParaPath], offset: focusOffset, visible: false },
        active: true,
        granularity: 'character',
      })
    }

    this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
  }

  private onMouseUp = () => {
    this.dragging = false
    this.cellBoxActive = false
  }

  /** 命中检测 — Phase 2: 二级碰撞检测
   *  Level 1: HitTestIndex 顶级块索引
   *  Level 2: 命中 table 外框 → hitTestTable() cell 内精确定位
   */
  private hitTest(clientX: number, clientY: number): { paraPath: string[]; offset: number } | null {
    const rect = this.container.getBoundingClientRect()
    const coord = this.editor.getDraw().getCoordinateSystem()
    const { scale, scrollY } = coord.transform

    // 屏幕坐标 → 文档坐标 (统一通过 TableCoordUtil)
    const { x: docX0, y: docY0 } = screenToDoc(clientX, clientY, scale, scrollY, rect)

    const pages = this.editor.getDraw().getPages()
    if (pages.length === 0) return null

    // 分页间隙 — 与渲染同源, 命中检测才能在带间隙的文档 Y 里正确定位到 pageIndex
    const gap = this.editor.getDraw().getPageVerticalGap()
    const { pageIndex, localY } = findPageByDocY(docY0, pages, gap)
    const page = pages[pageIndex]
    if (!page) return null

    const viewportW = this.container.clientWidth
    const offsetX = pageCenteringOffset(page.width, viewportW, scale)
    const docX = docX0 - offsetX / scale

    // Level 1: 顶级块索引命中
    const hitIndex = this.editor.getDraw().getHitTestIndex()
    const nodeId = hitIndex.hitTest(docX, localY, pageIndex)
    if (!nodeId) return null

    const doc = this.editor.getDocument()

    // Level 2: 命中表格 → cell 内精确定位
    const entryType = hitIndex.getEntryType(pageIndex, nodeId)
    if (entryType === 'table') {
      const tableItem = hitIndex.getTableItem(pageIndex, nodeId)
      if (tableItem) {
        const tableResult = HitTestIndex.hitTestTable(tableItem, docX, localY, this.editor.getPool(), doc.id)
        if (tableResult) return tableResult
      }
      // 表格命中但 Level 2 失败 → 不 fallback 到 getFlatPageItems
      return null
    }

    // 正文段落命中 → 现有流程
    const para = this.findParagraphContaining(nodeId)
    if (para) {
      const offset = this.computeOffsetAtX(para, docX, localY, page)
      return { paraPath: [doc.id, para.id], offset }
    }

    // 命中图片/分隔符/分节符等非段落块 → 定位到最近段落 (避免图片成为导航死区)
    const nearest = this.findNearestParagraph(nodeId)
    if (nearest) {
      const offset = this.computeOffsetAtX(nearest, docX, localY, page)
      return { paraPath: [doc.id, nearest.id], offset }
    }
    return null
  }

  /** 查找 nodeId 所属段落, 无则返回 null */
  private findParagraphContaining(nodeId: string): Paragraph | null {
    for (const [, node] of this.editor.getPool().nodes) {
      if (node.type === 'paragraph') {
        const para = node as unknown as Paragraph
        if (para.children.includes(nodeId) || nodeId === node.id) return para
      }
    }
    return null
  }

  /**
   * 定位非段落正文块 (image/separator/section_break) 附近的段落。
   * 优先取正文块序列中前一个最近的段落, 否则取后一个。
   */
  private findNearestParagraph(nodeId: string): Paragraph | null {
    const doc = this.editor.getDocument()
    const pool = this.editor.getPool()
    const idx = doc.body.children.indexOf(nodeId)
    if (idx < 0) return null
    for (let i = idx - 1; i >= 0; i--) {
      const n = pool.nodes.get(doc.body.children[i])
      if (n?.type === 'paragraph') return n as unknown as Paragraph
    }
    for (let i = idx + 1; i < doc.body.children.length; i++) {
      const n = pool.nodes.get(doc.body.children[i])
      if (n?.type === 'paragraph') return n as unknown as Paragraph
    }
    return null
  }

  private computeOffsetAtX(para: Paragraph, docX: number, docY: number, page: SLIFPage): number {
    // Phase 2: 使用 page.items 直接过滤 (不再需要 getFlatPageItems 展平)
    // 正文段落的文本行 items 直接存在于 page.items 中
    const related = page.items
      .filter(it => para.children.includes(it.nodeId) || it.nodeId === para.id)
    // items 已按 Y 排序 (LayoutEngine 顺序插入)

    let accumulated = 0

    for (const item of related) {
      const itemText = (item as { text?: string }).text || ''
      const bodyW = (item as { markerWidth?: number }).markerWidth != null
        ? item.width - (item as { markerWidth: number }).markerWidth
        : item.width

      // 命中当前行?
      const yHit = docY >= item.y && docY <= item.y + item.ascent + item.descent
      if (yHit) {
        if (docX < item.x) return accumulated
        if (docX <= item.x + bodyW) {
          const relativeX = docX - item.x
          const cumWidths = cumulativeCharWidths(itemText, {
            font: item.font || 'SimSun', size: item.size || 16,
            bold: item.bold, italic: item.italic,
          })
          const charIdx = findCharIndexAtX(relativeX, cumWidths, itemText.length || 0)
          return Math.max(0, accumulated + charIdx)
        }
        return accumulated + itemText.length
      }

      accumulated += itemText.length
    }

    return Math.max(0, accumulated)
  }

  /** 检测点击位置是否在页眉/页脚区域 */
  private detectHeaderFooterRegion(clientX: number, clientY: number): 'header' | 'footer' | null {
    const rect = this.container.getBoundingClientRect()
    const coord = this.editor.getDraw().getCoordinateSystem()
    const { scale, scrollY } = coord.transform

    const { x: docX0, y: docY0 } = screenToDoc(clientX, clientY, scale, scrollY, rect)

    const pages = this.editor.getDraw().getPages()
    if (pages.length === 0) return null

    // 分页间隙 — 同 hitTest, 把带间隙的 docY 反查到 pageIndex + 页面内 localY
    const gap = this.editor.getDraw().getPageVerticalGap()
    const { pageIndex, localY } = findPageByDocY(docY0, pages, gap)
    const page = pages[pageIndex]
    if (!page) return null

    // 检查是否在页面宽度内
    const offsetX = pageCenteringOffset(page.width, this.container.clientWidth, scale)
    const docX = docX0 - offsetX / scale
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
    const coord = this.editor.getDraw().getCoordinateSystem()
    const { scale, scrollY } = coord.transform

    const { x: docX0, y: docY0 } = screenToDoc(clientX, clientY, scale, scrollY, rect)

    const pages = this.editor.getDraw().getPages()
    if (pages.length === 0) return null

    // 分页间隙 — 同 hitTest / detectHeaderFooterRegion
    const gap = this.editor.getDraw().getPageVerticalGap()
    const { pageIndex, localY } = findPageByDocY(docY0, pages, gap)
    const page = pages[pageIndex]
    if (!page) return null

    const offsetX = pageCenteringOffset(page.width, this.container.clientWidth, scale)
    const docX = docX0 - offsetX / scale

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
