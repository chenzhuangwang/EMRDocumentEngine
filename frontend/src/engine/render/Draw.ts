// ============================================================
// Draw — 纯渲染消费者 (架构 §7.3, v20.34 TASK-426 重构)
//
// 职责: 接收 LayoutEngine 产出的 SLIFPage[] → 驱动 LayeredRenderer
// 不再负责: 布局计算(→LayoutEngine), 事件处理(→Handler),
//           撤销(→CommandUndoRedoStack), 编辑(→CommandManager)
// ============================================================

import type { DocumentTree } from '../document/DocumentModel'
import type { NodePool } from '../document/NodePool'
import type { SLIFPage } from '../layout/SLIF'
import type { EventBus } from '../interaction/EventBus'
import type { EditorRuntimeState } from '../state/EditorRuntimeState'
import { CoordinateSystem } from '../state/CoordinateSystem'
import { LayoutEngine } from '../layout/LayoutEngine'
import { LayeredRenderer, type WatermarkConfig } from './LayeredRenderer'
import { HitTestIndex } from './HitTestIndex'
import { TextParticle } from './particles/TextParticle'

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

  constructor(
    container: HTMLElement,
    eventBus: EventBus,
    doc?: DocumentTree,
  ) {
    this.container = container
    this.eventBus = eventBus

    const dpr = window.devicePixelRatio || 1
    this.coordSystem = new CoordinateSystem(dpr)
    this.layoutEngine = new LayoutEngine(this.coordSystem, eventBus)
    this.renderer = new LayeredRenderer(container, this.coordSystem)
    this.hitTestIndex = new HitTestIndex()

    if (doc) this.setDocument(doc)

    // 监听 EventBus: render 请求
    this.eventBus.on('render:request', () => this.render())
    this.eventBus.on('layout:changed', (pages: SLIFPage[]) => {
      this.pages = pages
      this.hitTestIndex.rebuild(pages)
    })
  }

  /** 设置文档 + 全量布局 */
  setDocument(doc: DocumentTree, pool?: NodePool): void {
    this.document = doc
    if (pool) this.pool = pool
  }

  /** 更新运行时状态 */
  setRuntimeState(state: EditorRuntimeState): void {
    this._state = state
  }

  getPool(): NodePool | null { return this.pool }
  getState(): EditorRuntimeState | null { return this._state }

  /** 全量重新布局 (应调用 layoutEngine.fullLayout) */
  recomputeLayout(pool: NodePool): SLIFPage[] {
    if (!this.document) return []
    this.pool = pool
    this.pages = this.layoutEngine.fullLayout(this.document, pool)
    this.hitTestIndex.rebuild(this.pages)
    return this.pages
  }

  /** 主渲染入口 — 消费 SLIFPage[] 驱动 LayeredRenderer, 可选绘制光标 */
  render(pool?: NodePool, runtimeState?: import('../state/EditorRuntimeState').EditorRuntimeState): void {
    if (this.pages.length === 0) return

    const viewportW = this.container.clientWidth
    const viewportH = this.container.clientHeight
    const dpr = this.coordSystem.transform.dpr
    const totalPages = this.pages.length
    const pageHeight = this.pages[0]?.height || 1123

    this.renderer.syncSizes(viewportW, viewportH, dpr, pageHeight, totalPages)

    // 计算可见页范围
    const scrollY = this.coordSystem.transform.scrollY
    const visible = this.layoutEngine.getVisiblePages(scrollY, viewportH)

    const pageWidth = this.pages[0]?.width || 794
    const offsetX = Math.max(0, (viewportW - pageWidth) / 2)

    // 渲染静态层
    {
      const sctx = this.renderer.getStaticCtx()
      if (sctx) {
        sctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        sctx.translate(offsetX, 0)
      }
    }
    this.renderer.renderStatic(this.pages, visible)

    // 渲染内容层
    const ctx = this.renderer.getContentCtx()
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, viewportW, viewportH)
      ctx.translate(offsetX, 0)
      for (let i = visible.start; i <= visible.end; i++) {
        const page = this.pages[i]
        if (!page) continue
        const pageY = (i - visible.start) * page.height
        for (const item of page.items) {
          const particleInput = {
            id: item.nodeId, type: item.type, value: item.text || '',
            font: item.font, size: item.size, bold: item.bold, italic: item.italic,
            color: item.color, underline: item.underline,
          }
          TextParticle.render(ctx, particleInput, item.x, pageY + item.y, {})
        }
      }
    }

    // 渲染光标 — interact 层
    const ictx = this.renderer.getInteractCtx()
    if (ictx && pool && runtimeState) {
      const cursor = runtimeState.cursor
      if (cursor.paragraphPath.length > 0 && cursor.visible) {
        const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
        const para = pool.nodes.get(paraId) as unknown as { children: string[] } | undefined
        if (para) {
          // 在 SLIF pages 中找段落内文本节点 → 计算光标 X 坐标
          let caretX = offsetX + 90 // 默认 marginLeft
          let caretY = 72 // 默认 marginTop
          let caretH = 18
          let charCount = 0

          for (let i = visible.start; i <= visible.end; i++) {
            const page = this.pages[i]
            if (!page) continue
            const pageY = (i - visible.start) * page.height
            for (const item of page.items) {
              if (para.children.includes(item.nodeId)) {
                const textLen = item.text?.length || 0
                if (cursor.offset <= charCount + textLen) {
                  const localOff = cursor.offset - charCount
                  const charW = textLen > 0 ? item.width / textLen : 0
                  caretX = offsetX + item.x + localOff * charW
                  caretY = pageY + item.y
                  caretH = item.height
                  break
                }
                charCount += textLen
              }
            }
            if (caretX > offsetX + 90) break // found
          }

          ictx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ictx.clearRect(0, 0, viewportW, viewportH)
          ictx.fillStyle = '#000000'
          ictx.fillRect(caretX, caretY, 2, caretH)
        }
      }
    }
  }

  /** 坐标转换工具 */
  getCoordinateSystem(): CoordinateSystem { return this.coordSystem }
  getHitTestIndex(): HitTestIndex { return this.hitTestIndex }
  getPages(): SLIFPage[] { return this.pages }

  /** 命中检测 */
  hitTest(docX: number, docY: number, pageIndex: number): string | null {
    return this.hitTestIndex.hitTest(docX, docY, pageIndex)
  }

  /** 水印 */
  setWatermark(wm: WatermarkConfig): void { this.renderer.prepareWatermark(wm) }

  /** 缩放 */
  setScale(scale: number): void {
    this.coordSystem.update({ scale })
    this.eventBus.emit('scale:changed', scale)
  }

  getScale(): number { return this.coordSystem.transform.scale }

  /** 销毁 */
  destroy(): void {
    this.renderer.destroy()
    this.hitTestIndex.clear()
    this.eventBus.off('render:request', () => {})
    this.eventBus.off('layout:changed', () => {})
  }
}
