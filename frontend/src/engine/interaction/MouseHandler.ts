// ================================================================
// MouseHandler — 鼠标拖拽选区, 支持跨段落/跨行 (架构 §8.2, v20.34)
//
// Selection 模型: anchor/focus 各自独立 paragraphPath + offset
// 同段落: offset 直接比较; 跨段落: 锚点段选中到尾, 终点段从0选中
// ================================================================

import type { Editor } from '../Editor'
import type { Paragraph } from '../document/DocumentModel'
import type { SLIFPage } from '../layout/SLIF'

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

  private onMouseDown = (e: MouseEvent) => {
    this.dragging = true
    this.dragMoved = false
    this.dragStartX = e.clientX
    this.dragStartY = e.clientY

    // 先检查是否在页眉/页脚区域
    const hfSection = this.detectHeaderFooterRegion(e.clientX, e.clientY)
    if (hfSection) {
      // 双击检测
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

    this.editor.getDraw().render(this.editor.getPool(), store.state.runtime)
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

    // 列表标记长度
    const p = para as unknown as { list?: { type: string; level?: number } }
    let markerLen = 0
    if (p.list) {
      const lvl = p.list.level || 1
      const indent = '  '.repeat(lvl - 1)
      if (p.list.type === 'bullet') markerLen = (indent + '• ').length
      else if (p.list.type === 'ordered') markerLen = (indent + '99. ').length
    }

    for (const childId of para.children) {
      const item = page.items.find(it => it.nodeId === childId)
      const text = (pool.nodes.get(childId) as unknown as { text?: string })?.text || ''
      if (item) {
        const itemTextLen = item.text?.length || 1
        const charWidth = item.width / itemTextLen
        if (docX <= item.x + item.width) {
          const charIdx = Math.round((docX - item.x) / charWidth)
          return Math.max(0, accumulated + Math.max(0, Math.min(charIdx, itemTextLen)) - markerLen)
        }
      }
      accumulated += text.length
    }
    return Math.max(0, accumulated - markerLen)
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

  destroy(): void {
    this.container.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
  }
}
