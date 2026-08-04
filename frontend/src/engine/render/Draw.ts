// ============================================================
// Draw — 纯渲染消费者 (架构 §7.3, v20.34 TASK-426 重构)
//
// 职责: 接收 LayoutEngine 产出的 SLIFPage[] → 驱动 LayeredRenderer
// 不再负责: 布局计算(→LayoutEngine), 事件处理(→Handler),
//           撤销(→CommandUndoRedoStack), 编辑(→CommandManager)
// ============================================================

import type { DocumentTree } from '../document/DocumentModel'
import type { NodePool } from '../document/NodePool'
import type { SLIFPage, SLIFItem } from '../layout/SLIF'
import type { EventBus } from '../interaction/EventBus'
import type { EditorRuntimeState } from '../state/EditorRuntimeState'
import { CoordinateSystem } from '../state/CoordinateSystem'
import { LayoutEngine } from '../layout/LayoutEngine'
import { LayeredRenderer, type WatermarkConfig } from './LayeredRenderer'
import { HitTestIndex } from './HitTestIndex'
import { TextParticle } from './particles/TextParticle'
import { SeparatorParticle } from './particles/SeparatorParticle'
import { ListParticle } from './particles/ListParticle'

interface CaretPos { x: number; y: number; h: number }

export class Draw {
  private container: HTMLElement
  private coordSystem: CoordinateSystem
  private layoutEngine: LayoutEngine
  renderer: LayeredRenderer
  private hitTestIndex: HitTestIndex
  private eventBus: EventBus
  private document: DocumentTree | null = null
  private pool: NodePool | null = null
  private _state: EditorRuntimeState | null = null
  private pages: SLIFPage[] = []

  // 页眉页脚编辑模式 (TASK-470/471 双击激活)
  private hfEditActive = false
  private hfEditSection: 'header' | 'footer' = 'header'

  constructor(
    container: HTMLElement,
    eventBus: EventBus,
    doc?: DocumentTree,
  ) {
    this.container = container
    this.eventBus = eventBus

    const dpr = window.devicePixelRatio || 1
    this.coordSystem = new CoordinateSystem(dpr)
    this.layoutEngine = new LayoutEngine(eventBus)
    this.renderer = new LayeredRenderer(container, this.coordSystem)
    this.hitTestIndex = new HitTestIndex()

    if (doc) this.setDocument(doc)

    this.eventBus.on('render:request', () => this.render())
    this.eventBus.on('layout:changed', (pages: SLIFPage[]) => {
      this.pages = pages
      this.hitTestIndex.rebuild(pages)
    })
  }

  setDocument(doc: DocumentTree, pool?: NodePool): void {
    this.document = doc
    if (pool) this.pool = pool
  }

  setRuntimeState(state: EditorRuntimeState): void { this._state = state }

  getPool(): NodePool | null { return this.pool }
  getState(): EditorRuntimeState | null { return this._state }

  recomputeLayout(pool: NodePool, _invalidation?: string): SLIFPage[] {
    if (!this.document) return []
    this.pool = pool
    // 当前统一全量布局; invalidation scope 预留用于未来增量优化
    this.pages = this.layoutEngine.fullLayout(this.document, pool)
    this.hitTestIndex.rebuild(this.pages)
    return this.pages
  }

  // ================================================================
  // 光标坐标计算 — 共享方法, render() 和 getCaretClientRect() 复用
  //
  // 支持正文 body items + 页眉 headerItems + 页脚 footerItems
  // 关键保护: 找不到目标段落包围盒时, 回退到上次已知正确位置,
  // 绝不跳转到文档左上角 (offsetX+90, 72)
  // ================================================================
  private lastCaretPos: CaretPos = { x: 90, y: 72, h: 16 }

  private computeCaretPos(
    pool: NodePool,
    paragraphPath: string[],
    offset: number,
    offsetX: number,
    visible: { start: number; end: number },
    pageHeight: number,
    scrollOffset: number,
  ): CaretPos {
    const paraId = paragraphPath[paragraphPath.length - 1]
    const para = pool.nodes.get(paraId) as unknown as { children: string[] } | undefined
    const initialX = this.lastCaretPos.x
    const initialY = this.lastCaretPos.y

    let caretX = this.lastCaretPos.x
    let caretY = this.lastCaretPos.y
    let caretH = this.lastCaretPos.h
    let found = false
    let charCount = 0

    if (para) {
      // 列表标记偏移: 标记已拼入首节点, 光标需要跳过标记
      const paraNode = pool.nodes.get(paraId) as unknown as { list?: { type: 'bullet' | 'ordered'; level?: number } } | undefined
      let listMarkerLen = 0
      if (paraNode?.list) {
        const lvl = paraNode.list.level || 1
        listMarkerLen = ListParticle.estimateMarkerWidth(lvl, paraNode.list.type).length
      }

      // 判断该段落属于 body / header / footer 哪个区域
      const section = this.resolveParagraphSection(paraId)

      for (let i = visible.start; i <= visible.end; i++) {
        const page = this.pages[i]
        if (!page) continue
        const pageY = (i - visible.start) * pageHeight - scrollOffset

        // 选择搜索的 item 列表
        let searchItems: SLIFItem[]
        let yOffset = 0
        if (section === 'header') {
          searchItems = page.headerItems || []
          yOffset = 0 // 页眉区从 pageY+0 开始
        } else if (section === 'footer') {
          searchItems = page.footerItems || []
          yOffset = pageHeight - (page.footerHeight || 42) // 页脚区从页面底部偏移
        } else {
          searchItems = page.items
          yOffset = 0
        }

        for (const item of searchItems) {
          if (para.children.includes(item.nodeId) || item.nodeId === paraId) {
            const textLen = item.text?.length || 0
            const adjustedOffset = offset + listMarkerLen
            if (adjustedOffset <= charCount + textLen) {
              const localOff = adjustedOffset - charCount
              const charW = textLen > 0 ? item.width / textLen : 0
              caretX = offsetX + item.x + localOff * charW
              caretY = pageY + yOffset + item.y
              caretH = item.ascent + item.descent
              found = true
              break
            }
            charCount += textLen
          }
        }
        if (found) break
      }
    }

    if (found) {
      this.lastCaretPos = { x: caretX, y: caretY, h: caretH }
    } else {
      // 布局未就绪 → 保持上次位置, 不跳转文档起点
      console.debug(
        `[computeCaretPos] para=${paraId} offset=${offset} NOT FOUND in SLIF pages, ` +
        `keeping lastCaretPos=(${initialX}, ${initialY})`
      )
    }

    return { x: caretX, y: caretY, h: caretH }
  }

  /**
   * 判断段落 ID 属于 body / header / footer 哪个区域
   * 遍历 doc.header[] 和 doc.footer[] 进行匹配
   */
  private resolveParagraphSection(paraId: string): 'body' | 'header' | 'footer' {
    if (!this.document) return 'body'
    if (this.document.header?.includes(paraId)) return 'header'
    if (this.document.footer?.includes(paraId)) return 'footer'
    return 'body'
  }

  /**
   * 页眉/页脚区域命中检测
   * @returns 命中的 nodeId, 或 null
   */
  findHeaderFooterItemAt(
    docX: number,
    localY: number, // 页面内 Y 坐标
    pageIndex: number,
    section: 'header' | 'footer',
  ): { nodeId: string; itemX: number; itemY: number; itemWidth: number; itemHeight: number } | null {
    const page = this.pages[pageIndex]
    if (!page) return null

    const items = section === 'header' ? (page.headerItems || []) : (page.footerItems || [])
    if (items.length === 0) return null

    // 调整 localY: 页脚 items 的 y 是相对于 footer 区顶部的
    // 传入的 localY 需要转换为区域内部坐标
    let regionLocalY = localY
    if (section === 'header') {
      regionLocalY = localY // header 从页面顶部(0)开始
    } else {
      const footerTop = page.height - (page.footerHeight || 42)
      regionLocalY = localY - footerTop
    }

    // 线性扫描 (页眉页脚通常只有少量 item, 不需要空间索引)
    let lastInRow: { nodeId: string; itemX: number; itemY: number; itemWidth: number; itemHeight: number } | null = null
    for (const item of items) {
      const itemBottom = item.y + item.ascent + item.descent
      if (regionLocalY >= item.y && regionLocalY <= itemBottom) {
        lastInRow = {
          nodeId: item.nodeId,
          itemX: item.x, itemY: item.y,
          itemWidth: item.width, itemHeight: item.ascent + item.descent,
        }
        if (docX >= item.x && docX <= item.x + item.width) {
          return lastInRow
        }
      }
    }

    // 行尾扩展命中
    if (lastInRow && docX > lastInRow.itemX + lastInRow.itemWidth) {
      return lastInRow
    }

    // 行首命中
    for (const item of items) {
      if (regionLocalY >= item.y && regionLocalY <= item.y + item.ascent + item.descent && docX < item.x) {
        return { nodeId: item.nodeId, itemX: item.x, itemY: item.y, itemWidth: item.width, itemHeight: item.ascent + item.descent }
      }
    }

    return null
  }

  // ================================================================
  // 主渲染入口
  // 顺序: 静态层(背景) → 内容层(文本) → interact层(选区→光标)
  // ================================================================
  render(pool?: NodePool, runtimeState?: EditorRuntimeState): void {
    if (this.pages.length === 0) return

    const viewportW = this.container.clientWidth
    const viewportH = this.container.clientHeight
    const dpr = this.coordSystem.transform.dpr
    const totalPages = this.pages.length
    const pageHeight = this.pages[0]?.height || 1123
    const pageWidth = this.pages[0]?.width || 794
    const offsetX = Math.max(0, (viewportW - pageWidth) / 2)

    this.renderer.syncSizes(viewportW, viewportH, dpr, pageHeight, totalPages)

    const scrollY = this.coordSystem.transform.scrollY
    const visible = this.layoutEngine.getVisiblePages(scrollY, viewportH)
    // 子页滚动偏移: scrollY 减去看不到的首个完整页, 得到当前页内偏移量 (0 ~ pageHeight)
    const scrollOffset = scrollY - visible.start * pageHeight

    // --- 静态层: 页面背景 ---
    {
      const sctx = this.renderer.getStaticCtx()
      if (sctx) {
        sctx.setTransform(dpr, 0, 0, dpr, offsetX * dpr, 0)
      }
    }
    this.renderer.renderStatic(this.pages, visible, scrollOffset)

    // --- 内容层: 文本粒子 + 分隔线 + 页眉页脚 ---
    const ctx = this.renderer.getContentCtx()
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, viewportW, viewportH)
      ctx.translate(offsetX, 0)
      const contentWidth = pageWidth - 180 // marginLeft(90) + marginRight(90)
      for (let i = visible.start; i <= visible.end; i++) {
        const page = this.pages[i]
        if (!page) continue
        const pageY = (i - visible.start) * pageHeight - scrollOffset
        const headerH = page.headerHeight ?? 42
        const footerH = page.footerHeight ?? 42
        const hasHeader = page.headerItems && page.headerItems.length > 0
        const hasFooter = page.footerItems && page.footerItems.length > 0

        // ================================================================
        // 页眉区域背景 + 分隔线 (无条件渲染, 提供页面结构视觉)
        // ================================================================
        // 背景色区分: 编辑模式下正在编辑的区域用浅蓝, 否则浅灰
        ctx.fillStyle = (this.hfEditActive && this.hfEditSection === 'header')
          ? '#EFF6FF'  // primary-50: 编辑高亮
          : '#F3F4F6'  // gray-100: 非编辑态浅灰 (比 #F9FAFB 略深, 确保可见)
        ctx.fillRect(0, pageY, pageWidth, headerH)

        // 分隔线 (页眉下方, 页眉与正文之间)
        ctx.strokeStyle = '#D1D5DB' // gray-300
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, pageY + headerH)
        ctx.lineTo(pageWidth, pageY + headerH)
        ctx.stroke()

        // --- 页眉文本 (仅在有内容时渲染) ---
        if (hasHeader) {
          ctx.save()
          if (!this.hfEditActive || this.hfEditSection !== 'header') {
            // 非编辑态: 页眉文本变淡
            ctx.globalAlpha = 0.55
          }
          this.renderParticleItems(ctx, page.headerItems!, pageY)
          ctx.restore()
        }

        // --- 正文 ---
        for (const item of page.items) {
          if (item.type === 'separator') {
            SeparatorParticle.render(ctx, {
              id: item.nodeId, type: item.type,
            }, item.x, pageY + item.y, contentWidth)
          } else {
            // 列表标记独立渲染 (TASK-454)
            if (item.listMarker) {
              ListParticle.render(ctx, item.listMarker, item.x, pageY + item.y, item.ascent, {
                font: item.font, size: item.size, bold: item.bold, color: item.color,
              })
            }
            TextParticle.render(ctx, {
              id: item.nodeId, type: item.type, value: item.text || '',
              font: item.font, size: item.size, bold: item.bold, italic: item.italic,
              color: item.color, underline: item.underline,
              strikeout: item.strikeout, superscript: item.superscript, subscript: item.subscript,
            }, item.x, pageY + item.y, {})
          }
        }

        // ================================================================
        // 页眉页脚编辑模式遮罩层
        // ================================================================
        if (this.hfEditActive) {
          ctx.save()
          // 正文区域: 半透明白色遮罩 (非编辑区变暗)
          ctx.globalAlpha = 0.40
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, pageY + headerH, pageWidth, pageHeight - headerH - footerH)

          // 非激活的页眉/页脚区域: 也加遮罩 (背景始终存在, 无条件覆盖)
          if (this.hfEditSection !== 'header') {
            ctx.fillRect(0, pageY, pageWidth, headerH)
          }
          if (this.hfEditSection !== 'footer') {
            ctx.fillRect(0, pageY + pageHeight - footerH, pageWidth, footerH)
          }
          ctx.restore()
        }

        // ================================================================
        // 页脚区域背景 + 分隔线 (无条件渲染, 提供页面结构视觉)
        // ================================================================
        const footerTop = pageHeight - footerH

        // 分隔线 (页脚上方, 正文与页脚之间)
        ctx.strokeStyle = '#D1D5DB' // gray-300
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, pageY + footerTop)
        ctx.lineTo(pageWidth, pageY + footerTop)
        ctx.stroke()

        // 背景色
        ctx.fillStyle = (this.hfEditActive && this.hfEditSection === 'footer')
          ? '#EFF6FF'  // primary-50: 编辑高亮
          : '#F3F4F6'  // gray-100: 非编辑态浅灰
        ctx.fillRect(0, pageY + footerTop, pageWidth, footerH)

        // --- 页脚文本 (仅在有内容时渲染) ---
        if (hasFooter) {
          ctx.save()
          if (!this.hfEditActive || this.hfEditSection !== 'footer') {
            // 非编辑态: 页脚文本变淡
            ctx.globalAlpha = 0.55
          }
          this.renderParticleItems(ctx, page.footerItems!, pageY + footerTop)
          ctx.restore()
        }
      }
    }

    // --- interact 层: 选区 + 光标 ---
    const ictx = this.renderer.getInteractCtx()
    if (!ictx || !pool || !runtimeState) return

    const cursor = runtimeState.cursor
    if (cursor.paragraphPath.length === 0 || !cursor.visible) return

    const caret = this.computeCaretPos(pool, cursor.paragraphPath, cursor.offset, offsetX, visible, pageHeight, scrollOffset)

    ictx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ictx.clearRect(0, 0, viewportW, viewportH)

    // --- 选区高亮 (文字下方, 统一包围盒) ---
    const selection = runtimeState.selection
    if (selection.active) {
      this.renderSelectionUnified(pool, selection, offsetX, visible, pageHeight, scrollOffset, ictx)
    }

    // --- 光标 (文字上方) ---
    ictx.fillStyle = '#000000'
    ictx.fillRect(caret.x, caret.y, 2, caret.h)
  }

  // ================================================================
  // 选区渲染 — 逐 SLIF item 独立底色, 每行宽度跟随内容 (阶梯样式)
  // 首段/末段按 offset 裁剪, 中间段全画
  // ================================================================
  private renderSelectionUnified(
    pool: NodePool,
    selection: EditorRuntimeState['selection'],
    offsetX: number,
    visible: { start: number; end: number },
    pageHeight: number,
    scrollOffset: number,
    ictx: CanvasRenderingContext2D,
  ): void {
    const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1] || ''
    const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1] || ''

    const bodyChildren = pool.getChildren(pool.rootIds.body)
    const aIdx = bodyChildren.indexOf(anchorParaId)
    const fIdx = bodyChildren.indexOf(focusParaId)
    if (aIdx < 0 || fIdx < 0) return

    const lo = Math.min(aIdx, fIdx)
    const hi = Math.max(aIdx, fIdx)
    const samePara = lo === hi

    // 首段/末段的选区 offset — 标准化为 loOff <= hiOff
    const anchorOff = selection.anchor.offset
    const focusOff = selection.focus.offset
    const selMin = Math.min(anchorOff, focusOff)
    const selMax = Math.max(anchorOff, focusOff)

    // 追踪每个段落的累计字符偏移
    const paraOffsets = new Map<string, number>()

    ictx.fillStyle = 'rgba(59, 130, 246, 0.2)'

    for (let i = visible.start; i <= visible.end; i++) {
      const sp = this.pages[i]
      if (!sp) continue
      const spY = (i - visible.start) * pageHeight - scrollOffset
      for (const item of sp.items) {
        const itemParaId = this.findItemParagraph(item.nodeId, pool)
        if (!itemParaId) continue
        const pi = bodyChildren.indexOf(itemParaId)
        if (pi < lo || pi > hi) continue

        // 该 item 在段落内的字符偏移范围
        const itemStart = paraOffsets.get(itemParaId) ?? 0
        const tLen = item.text?.length || 0
        const itemEnd = itemStart + tLen
        const charW = tLen > 0 ? item.width / tLen : 0

        // ---- 第一层: item 级筛选 ----
        let include = true
        if (samePara) {
          include = itemEnd > selMin && itemStart < selMax
        } else if (pi === lo) {
          // 首段: 锚点 offset = (aIdx===lo ? anchorOff : focusOff)
          const loOff = aIdx === lo ? anchorOff : focusOff
          include = itemEnd > loOff
        } else if (pi === hi) {
          // 末段: 锚点 offset = (aIdx===hi ? anchorOff : focusOff)
          const hiOff = aIdx === hi ? anchorOff : focusOff
          include = itemStart < hiOff
        }

        if (!include) { paraOffsets.set(itemParaId, itemEnd); continue }

        // ---- 第二层: item 内像素裁剪 ----
        let localStart = 0
        let localEnd = tLen || 1  // 空段落占位至少 1 个单位宽度

        if (samePara) {
          localStart = Math.max(0, selMin - itemStart)
          localEnd = Math.min(tLen, selMax - itemStart)
        } else if (pi === lo) {
          const loOff = aIdx === lo ? anchorOff : focusOff
          localStart = Math.max(0, loOff - itemStart)
          localEnd = tLen || 1
        } else if (pi === hi) {
          const hiOff = aIdx === hi ? anchorOff : focusOff
          localStart = 0
          localEnd = Math.min(tLen || 1, hiOff - itemStart)
        }

        const dx = localStart * charW
        const dw = tLen > 0
          ? (localEnd - localStart) * charW
          : item.ascent + item.descent  // 空段落用高度作为最小宽度

        ictx.fillRect(offsetX + item.x + dx, spY + item.y, dw, item.ascent + item.descent)

        paraOffsets.set(itemParaId, itemEnd)
      }
    }
  }

  /** 查找 SLIF item 所属段落 ID (保留, 供选区渲染使用) */
  private findItemParagraph(nodeId: string, pool: NodePool): string | null {
    for (const [, node] of pool.nodes) {
      if (node.type === 'paragraph') {
        const para = node as unknown as { children: string[] }
        if (para.children.includes(nodeId) || nodeId === node.id) return node.id
      }
    }
    return null
  }

  /** 渲染 SLIFItem[] — 页眉/页脚/正文共用 (TASK-470) */
  private renderParticleItems(
    ctx: CanvasRenderingContext2D,
    items: SLIFItem[],
    pageY: number,
  ): void {
    for (const item of items) {
      if (item.listMarker) {
        ListParticle.render(ctx, item.listMarker, item.x, pageY + item.y, item.ascent, {
          font: item.font, size: item.size, bold: item.bold, color: item.color,
        })
      }
      TextParticle.render(ctx, {
        id: item.nodeId, type: item.type, value: item.text || '',
        font: item.font, size: item.size, bold: item.bold, italic: item.italic,
        color: item.color, underline: item.underline,
        strikeout: item.strikeout, superscript: item.superscript, subscript: item.subscript,
      }, item.x, pageY + item.y, {})
    }
  }

  // ================================================================
  // 公开 API
  // ================================================================

  getCoordinateSystem(): CoordinateSystem { return this.coordSystem }
  getHitTestIndex(): HitTestIndex { return this.hitTestIndex }
  getPages(): SLIFPage[] { return this.pages }

  hitTest(docX: number, docY: number, pageIndex: number): string | null {
    return this.hitTestIndex.hitTest(docX, docY, pageIndex)
  }

  /**
   * 获取光标在视口中的 Client 矩形 — 供 IME 候选窗定位
   * 复用 computeCaretPos, 加上 canvas.getBoundingClientRect() 转换
   */
  getCaretClientRect(
    pool: NodePool,
    runtimeState: EditorRuntimeState,
  ): { left: number; top: number; width: number; height: number } | null {
    const cursor = runtimeState.cursor
    if (cursor.paragraphPath.length === 0) return null
    if (this.pages.length === 0) return null

    const viewportW = this.container.clientWidth
    const viewportH = this.container.clientHeight
    const scrollY = this.coordSystem.transform.scrollY
    const visible = this.layoutEngine.getVisiblePages(scrollY, viewportH)
    const pageWidth = this.pages[0]?.width || 794
    const pageHeight = this.pages[0]?.height || 1123
    const offsetX = Math.max(0, (viewportW - pageWidth) / 2)
    const scrollOffset = scrollY - visible.start * pageHeight

    const caret = this.computeCaretPos(pool, cursor.paragraphPath, cursor.offset, offsetX, visible, pageHeight, scrollOffset)

    const canvas = this.renderer.getInteractCanvas()
    const canvasRect = canvas?.getBoundingClientRect() ?? this.container.getBoundingClientRect()
    const scale = this.coordSystem.transform.scale

    return {
      left: canvasRect.left + caret.x * scale,
      top: canvasRect.top + caret.y * scale,
      width: Math.max(2 * scale, 1),
      height: caret.h * scale,
    }
  }

  setWatermark(wm: WatermarkConfig): void { this.renderer.prepareWatermark(wm) }

  setScale(scale: number): void {
    this.coordSystem.update({ scale })
    this.eventBus.emit('scale:changed', scale)
  }

  getScale(): number { return this.coordSystem.transform.scale }

  /** 页眉页脚编辑模式状态 */
  isHeaderFooterEditActive(): boolean { return this.hfEditActive }
  /** 当前编辑的页眉/页脚区域 */
  getHeaderFooterEditSection(): 'header' | 'footer' { return this.hfEditSection }

  /** 激活/关闭页眉页脚编辑模式 */
  setHeaderFooterEditActive(active: boolean, section?: 'header' | 'footer'): void {
    this.hfEditActive = active
    if (section) this.hfEditSection = section
  }

  getEventBus(): EventBus { return this.eventBus }

  destroy(): void {
    this.renderer.destroy()
    this.hitTestIndex.clear()
    this.eventBus.off('render:request', () => {})
    this.eventBus.off('layout:changed', () => {})
  }
}
