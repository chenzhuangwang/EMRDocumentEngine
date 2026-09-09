// ============================================================
// Draw — 纯渲染消费者 (架构 §7.3, v20.34 TASK-426 重构)
//
// 职责: 接收 LayoutEngine 产出的 SLIFPage[] → 驱动 LayeredRenderer
// 不再负责: 布局计算(→LayoutEngine), 事件处理(→Handler),
//           撤销(→CommandUndoRedoStack), 编辑(→CommandManager)
// ============================================================

import type { DocumentTree, WatermarkConfig, SmartTextNode } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { SLIFPage, SLIFItem } from '../layout/core/SLIF'
import { getFlatPageItems } from '../layout/core/SLIF'
import type { EventBus } from '../interaction/EventBus'
import type { EditorRuntimeState } from '../state/EditorRuntimeState'
import type { EditorHost } from '../host/EditorHost'
import { CoordinateSystem } from '../state/CoordinateSystem'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import type { TextMeasurer } from '../layout/text/TextMeasurer'
import { LayeredRenderer } from './LayeredRenderer'
import { HitTestIndex } from './HitTestIndex'
import { MemoryManager } from '../layout/viewport/MemoryManager'
import { cumulativeWidthUpTo } from '../layout/text/CharWidthHelper'
import { accumulatedHeightTo } from '../layout/table/TableCoordUtil'
import { createFootnoteParticle } from './particles/FootnoteParticle'
import { createTableParticle } from './particles/TableParticle'
import { createImageParticle } from './particles/ImageParticle'
import { createControlParticle } from './particles/ControlParticle'
import { computeControlBox, stripPlaceholderBrackets, controlVisualType } from '../document/control/ControlBox'
import { computeFieldRegion } from '../document/control/ControlFieldGeometry'
import { isControlValueEmpty } from '../document/control/ControlValue'
import type { PresentationStyleStore } from './presentation/PresentationStyle'
import type { TemplateDefinitionStore } from '../template/TemplateDefinition'
import { createChartParticle } from './particles/ChartParticle'
import { createBarcodeParticle } from './particles/BarcodeParticle'
import { particleRegistry } from './particles/ParticleRegistry'
import { textParticle, separatorParticle, listParticle, fieldParticle } from './particles/ParticleAdapters'
import { buildCellGrid } from '../document/table/TableOps'
import { flattenTextContainers, sectionOf, selectionSpine } from '../document/selection/SelectionCollector'

interface CaretPos { x: number; y: number; h: number }

/**
 * 默认分页渲染间隙 (CSS 像素)。
 *
 * 仅作用在渲染视口偏移, 不修改 SLIFPage.height / SLIFItem.y / 文档数据模型。
 * 设为 0 可恢复旧版"页面紧贴"行为; 通过 Draw.setPageVerticalGap() 可调整。
 */
const DEFAULT_PAGE_VERTICAL_GAP = 20

export class Draw {
  private host: EditorHost
  private measurer: TextMeasurer
  private coordSystem: CoordinateSystem
  private layoutEngine: LayoutEngine
  renderer: LayeredRenderer
  private hitTestIndex: HitTestIndex
  private eventBus: EventBus
  private document: DocumentTree | null = null
  private pool: NodePool | null = null
  private _state: EditorRuntimeState | null = null
  private pages: SLIFPage[] = []

  // 表现层样式 (契约 §2.2) — per-editor 实例状态 (§7.6), 随 setDocument 更新
  private presentationStyles: PresentationStyleStore | null = null
  private presentationStyleOf = (nodeId: string) => this.presentationStyles?.get(nodeId)

  // 模板设计期属性 (契约 §12.1) — per-editor 实例状态 (§7.6), 随 setDocument 更新
  private templateDefinitions: TemplateDefinitionStore | null = null
  private templateDefinitionOf = (nodeId: string) => this.templateDefinitions?.get(nodeId)

  // 语义元数据 (契约 §2.1) — 控件 dataType 分类 / 隐私脱敏读取源, 随 setDocument 更新
  private elementOf = (nodeId: string) => (this.pool?.nodes.get(nodeId) as SmartTextNode | undefined)?.element

  // 控件规范运行时值 (契约 §12.6.1) — widget affordance 读取源 (区别于 SLIFItem.text 显示串)
  private controlValueOf = (nodeId: string) => (this.pool?.nodes.get(nodeId) as SmartTextNode | undefined)?.value

  // 页眉页脚编辑模式 (TASK-470/471 双击激活)
  private hfEditActive = false
  private hfEditSection: 'header' | 'footer' = 'header'

  // 不可见字符显示 (TASK-475)
  private _showInvisible = false

  // 图片缓存: URL → CanvasImageSource (容量 50, LRU 淘汰)
  private imageCache = new MemoryManager<string>(50)

  // 图片粒子渲染器 — 绑定到本 Draw 实例 (resolveUrl/onImageLoaded 闭包指向本实例)。
  // 不得注册进模块级单例 particleRegistry: 单例按 type 去重, 编辑器重挂载
  // (React StrictMode / 路由切换) 后第二个 Draw 会复用首个 Draw 的陈旧闭包,
  // 按已销毁的旧 pool 解析 URL → 图片只画灰色占位框而不显示内容。
  private imageParticle: ReturnType<typeof createImageParticle>

  // rAF 合并渲染 (TASK-484): 同一帧多次 render() 调用仅执行最后一次
  private _rafId: number | null = null

  // 脏区域裁剪 (TASK-483): 非 null 时仅重绘该区域
  private dirtyRect: { x: number; y: number; w: number; h: number } | null = null

  // 单元格框选范围 (网格坐标, 由 Editor 注入)
  cellSelection: { tableId: string; startRow: number; startCol: number; endRow: number; endCol: number } | null = null

  // 设计模式选中的控件节点 id (契约 §12.3, 由 Editor 注入) — 高亮 overlay
  designSelectedControlId: string | null = null

  // 当前激活的控件节点 id (无缝内联编辑, 契约 §12.6 运行时交互, 由 Editor 注入)
  // — 该控件渲染时隐藏静态 field (框/值/affordance), 由 DOM overlay 承担文本面
  activeControlNodeId: string | null = null

  constructor(
    host: EditorHost,
    eventBus: EventBus,
    measurer: TextMeasurer,
    doc?: DocumentTree,
  ) {
    this.host = host
    this.measurer = measurer
    this.eventBus = eventBus

    const dpr = this.host.surface.devicePixelRatio() || 1
    this.coordSystem = new CoordinateSystem(dpr)
    this.layoutEngine = new LayoutEngine(eventBus, measurer)
    // 运行时控件内联渲染预留宽信息源 (契约 §12.6 表单模式内联渲染) —
    // 闭包运行时读取 templateDefinitions/pool (随 setDocument/setRuntimeState 更新),
    // 供布局为 checkbox/radio 预留候选项宽。正交读取, 无反向推导。
    this.layoutEngine.setControlInfoOf((nodeId) => {
      const def = this.templateDefinitions?.get(nodeId)
      const el = (this.pool?.nodes.get(nodeId) as SmartTextNode | undefined)?.element
      const hasEnums = el?.format?.enums !== undefined
      return {
        controlType: def?.controlType ?? controlVisualType(def?.controlType, hasEnums, el?.format?.enums?.multiple === true),
        options: el?.format?.enums?.data,
      }
    })
    this.renderer = new LayeredRenderer(this.host, this.coordSystem)
    this.hitTestIndex = new HitTestIndex(this.measurer)

    // 默认分页渲染间隙 (仅视口偏移, 不影响存储坐标)
    // 20px ≈ 标准文档"分页符留白" — 视觉上明确分隔相邻页面
    this.layoutEngine.setPageVerticalGap(DEFAULT_PAGE_VERTICAL_GAP)
    this.renderer.setPageVerticalGap(DEFAULT_PAGE_VERTICAL_GAP)

    if (doc) this.setDocument(doc)

    this.eventBus.on('render:request', () => this.render())
    this.eventBus.on('layout:changed', (pages: SLIFPage[]) => {
      this.pages = pages
      this.hitTestIndex.rebuild(pages)
    })

    // 图片粒子渲染器 — 绑定到本 Draw 实例 (见字段声明注释, 不进单例 registry)
    this.imageParticle = createImageParticle(
      (nodeId) => this.resolveImageUrl({ nodeId }),
      () => { if (this.pool && this._state) this.scheduleRender(this.pool, this._state) },
      this.host,
    )
    // 注册控件/SmartText 粒子渲染器
    if (!particleRegistry.has('smarttext')) {
      particleRegistry.register(createControlParticle())
    }
    // 注册图表/条码粒子渲染器 (预留)
    if (!particleRegistry.has('chart')) {
      particleRegistry.register(createChartParticle())
    }
    if (!particleRegistry.has('barcode')) {
      particleRegistry.register(createBarcodeParticle())
    }
    // 注册核心粒子适配器 (替换 Direct Class Call → Registry)
    if (!particleRegistry.has('text')) {
      particleRegistry.register(textParticle)
    }
    if (!particleRegistry.has('separator')) {
      particleRegistry.register(separatorParticle)
    }
    if (!particleRegistry.has('listmarker')) {
      particleRegistry.register(listParticle)
    }
    if (!particleRegistry.has('field')) {
      particleRegistry.register(fieldParticle)
    }
  }

  setDocument(doc: DocumentTree, pool?: NodePool, presentationStyles?: PresentationStyleStore | null, templateDefinitions?: TemplateDefinitionStore | null): void {
    this.document = doc
    if (pool) this.pool = pool
    this.presentationStyles = presentationStyles ?? null
    this.templateDefinitions = templateDefinitions ?? null
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
  //
  // 关键设计 (修复滚动时光标偏移 / 跳位 — 见 cheerful-snacking-hamming 方案):
  //   1. 遍历所有页面查找光标所属段落 (而非仅 visible 范围)。
  //      这消除了 getVisiblePages 无 overscan + LayeredRenderer 画布有 OVERSCAN_PAGES=1
  //      导致的不一致 — 旧版本下, 光标所在页落在画布 overscan 区但不在 visible 范围时,
  //      会回退到陈旧的 canvas-Y, 引发滚动时偏移与跳位。
  //   2. 直接使用 this.coordSystem.transform.scrollY 计算 canvas-Y:
  //      canvas-Y = doc-Y - scrollY。scrollY 始终反映真实滚动位置, 无需维护缓存。
  //   3. 找不到目标段落时返回 null — 由调用方决定是否绘制,
  //      不再使用 lastCaretPos 缓存, 避免陈旧坐标污染。
  // ================================================================
  private computeCaretPos(
    pool: NodePool,
    paragraphPath: string[],
    offset: number,
    pageVerticalGap: number = 0,
  ): CaretPos | null {
    const paraId = paragraphPath[paragraphPath.length - 1]
    const para = pool.nodes.get(paraId) as unknown as { children: readonly string[] } | undefined
    if (!para) return null

    // 文档空间滚动位置 — 直接读取, 每次都准确反映当前滚动
    const scrollY = this.coordSystem.transform.scrollY

    // 判断该段落属于 body / header / footer 哪个区域
    const section = this.resolveParagraphSection(paraId)
    let charCount = 0

    // 遍历所有页面查找 (而非 visible.start..visible.end) — 避免与画布 overscan 不一致
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]
      if (!page) continue
      // 每页 canvas Y = 该页累加文档 Y (含 pageVerticalGap) - 当前 scrollY
      const pageY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY

      // 选择搜索的 item 列表
      let searchItems: SLIFItem[]
      let yOffset = 0
      if (section === 'header') {
        searchItems = page.headerItems || []
        yOffset = 0 // 页眉区从 pageY+0 开始
      } else if (section === 'footer') {
        searchItems = page.footerItems || []
        yOffset = page.height - (page.footerHeight || 42) // 页脚区从页面底部偏移
      } else {
        searchItems = getFlatPageItems(page)
        yOffset = 0
      }

      for (const item of searchItems) {
        if (para.children.includes(item.nodeId) || item.nodeId === paraId) {
          const displayLen = item.text?.length || 0
          // 非文本内联原子 (smarttext/image/field/cross_reference…) 按 1 字符推进,
          // 与 cursor offset / NodePool.resolveCharOffset 的「非 text 计 1」一致。
          const isAtomic = item.nodeType === 'smarttext' || item.nodeType === 'image' ||
            item.nodeType === 'field' || item.nodeType === 'cross_reference' ||
            item.nodeType === 'footnote_ref' || item.nodeType === 'bookmark'
          const unitLen = isAtomic ? 1 : displayLen
          // item.x 已偏移过标记宽度, cursor offset 是正文内偏移, 无需调整
          if (offset <= charCount + unitLen) {
            const localOff = offset - charCount
            if (isAtomic) {
              // 原子: 0=前 (item.x), 1=后 (item.x + bodyW)
              const bodyW = (item.width || 0) - (item.markerWidth || 0)
              return {
                x: localOff >= 1 ? item.x + bodyW : item.x,
                y: pageY + yOffset + item.y,
                h: item.ascent + item.descent,
              }
            }
            // 逐字符累积宽度: 正确区分半角/全角字符, 避免中英文混排光标偏移
            const cumWidth = cumulativeWidthUpTo(item.text || '', localOff, {
              font: item.font || 'SimSun',
              size: item.size || 16,
              bold: item.bold,
              italic: item.italic,
            }, this.measurer)
            return {
              x: item.x + cumWidth,
              y: pageY + yOffset + item.y,
              h: item.ascent + item.descent,
            }
          }
          charCount += unitLen
        }
      }
    }

    // 段落不在任何页 — 布局未就绪或 cursor.path 已失效
    // 返回 null 让调用方决定跳过绘制, 不再用陈旧的 lastCaretPos
    console.debug(
      `[computeCaretPos] para=${paraId} offset=${offset} NOT FOUND in SLIF pages`,
    )
    return null
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

  /**
   * rAF 合并渲染 (TASK-484)
   * 同一帧内多次调用 scheduleRender 仅执行最后一次 render
   * 用于高频场景: 连续输入/滚动/缩放
   */
  scheduleRender(pool?: NodePool, runtimeState?: EditorRuntimeState): void {
    if (this._rafId !== null) return  // 已有待执行的渲染帧
    this._rafId = this.host.surface.requestFrame(() => {
      this._rafId = null
      this.render(pool, runtimeState)
    })
  }

  render(pool?: NodePool, runtimeState?: EditorRuntimeState): void {
    if (this.pages.length === 0) return

    const viewport = this.host.viewport.size()
    const viewportW = viewport.width
    const viewportH = viewport.height
    const dpr = this.coordSystem.transform.dpr
    const scale = this.coordSystem.transform.scale
    const pageHeight = this.pages[0]?.height || 1123
    const pageWidth = this.pages[0]?.width || 794
    // 页面水平居中: 缩放后页面可视宽度 = pageWidth * scale
    const visiblePageW = pageWidth * scale
    const offsetX = Math.max(0, (viewportW - visiblePageW) / 2)

    // 分页间隙 — 仅作用在渲染视口偏移, 不影响 SLIF 存储坐标
    const pageVerticalGap = this.renderer.getPageVerticalGap()

    this.renderer.syncSizes(viewportW, viewportH, dpr, this.pages)

    // scrollY 存储为文档坐标 (含间隙), 直接用于文档空间计算
    const scrollY = this.coordSystem.transform.scrollY
    const docViewportH = viewportH / scale
    const visible = this.layoutEngine.getVisiblePages(scrollY, docViewportH)
    // 子页滚动偏移: scrollY 减去可见首页的累加文档顶部 Y
    // (累加 = sum(pageHeight) + visible.start * pageVerticalGap)
    const visibleStartDocY = accumulatedHeightTo(visible.start, this.pages, pageVerticalGap)
    const scrollOffset = scrollY - visibleStartDocY
    // canvas 物理像素偏移: offsetX 是 CSS 像素居中偏移, 需转换为物理像素
    const physOffsetX = offsetX * dpr

    // --- 静态层: 页面背景 ---
    {
      const sctx = this.renderer.getStaticCtx()
      if (sctx) {
        sctx.setTransform(scale * dpr, 0, 0, scale * dpr, physOffsetX, 0)
      }
    }
    this.renderer.renderStatic(this.pages, visible, scrollOffset)

    // --- 内容层: 文本粒子 + 分隔线 + 页眉页脚 ---
    const ctx = this.renderer.getContentCtx()
    if (ctx) {
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0)
      // TASK-483: 脏区域裁剪 — 仅清除和重绘变更区域
      if (this.dirtyRect) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(this.dirtyRect.x, this.dirtyRect.y, this.dirtyRect.w, this.dirtyRect.h)
        ctx.clip()
        this.dirtyRect = null
      }
      ctx.clearRect(0, 0, viewportW / scale, viewportH / scale)
      // offsetX 已是 CSS 像素, 在文档空间需除以 scale
      ctx.translate(offsetX / scale, 0)
      const contentWidth = pageWidth - 180 // marginLeft(90) + marginRight(90)
      for (let i = visible.start; i <= visible.end; i++) {
        const page = this.pages[i]
        if (!page) continue
        // 每页 canvas Y = 该页累加顶部 (含间隙) - 当前 scrollY
        const pageY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - (visibleStartDocY + scrollOffset)
        const headerH = page.headerHeight ?? 42
        const footerH = page.footerHeight ?? 42
        const hasHeader = page.headerItems && page.headerItems.length > 0
        const hasFooter = page.footerItems && page.footerItems.length > 0

        // ================================================================
        // 页眉区域 + 分隔线
        // ================================================================
        // 分隔线 (页眉下方) — 0.5px细线, 浅灰
        ctx.strokeStyle = '#CCCCCC'
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(0, pageY + headerH)
        ctx.lineTo(pageWidth, pageY + headerH)
        ctx.stroke()

        // 编辑模式: 激活区域用虚线边框标记
        if (this.hfEditActive && this.hfEditSection === 'header') {
          ctx.save()
          ctx.strokeStyle = '#93C5FD' // primary-300
          ctx.lineWidth = 1
          ctx.setLineDash([4, 3])
          ctx.strokeRect(1, pageY + 1, pageWidth - 2, headerH - 2)
          ctx.setLineDash([])
          ctx.restore()
        }

        // --- 页眉文本 (仅在有内容时渲染) ---
        if (hasHeader) {
          ctx.save()
          if (!this.hfEditActive || this.hfEditSection !== 'header') {
            // 非编辑态: 页眉文本变淡
            ctx.globalAlpha = 0.55
          }
          this.renderParticleItems(ctx, page.headerItems!, pageY, i)
          ctx.restore()
        }

        // --- 正文 ---
        for (const item of page.items) {
          if (item.type === 'separator') {
            const sepRenderer = particleRegistry.get('separator')
            if (sepRenderer) {
              sepRenderer.render(ctx, item, item.x, pageY + item.y, { contentWidth })
            }
          } else if (item.type === 'image') {
            this.imageParticle.render(ctx, item, item.x, pageY + item.y)
          } else if (item.type === 'footnote') {
            // 脚注引用: 上标编号 (R31)
            const fp = createFootnoteParticle()
            fp.render(ctx, item, item.x, pageY + item.y, {
              pageIndex: i, totalPages: this.pages.length,
            })
          } else if (item.type === 'table') {
            // 表格渲染 (R37) — cell 内 smarttext 经 TableParticle 委托 registry (§4)
            const tp = createTableParticle()
            tp.render(ctx, item, item.x, pageY + item.y, {
              showInvisible: this._showInvisible,
              pageIndex: i,
              presentationStyleOf: this.presentationStyleOf,
              templateDefinitionOf: this.templateDefinitionOf,
              elementOf: this.elementOf,
              controlValueOf: this.controlValueOf,
              activeControlId: this.activeControlNodeId,
            })
          } else {
            // 文本/域代码/控件 — 通过 ParticleRegistry 调度 (含列表标记)
            const textRenderer = particleRegistry.get(item.nodeType || item.type) || particleRegistry.get('text')
            if (textRenderer) {
              textRenderer.render(ctx, { ...item, text: this.resolveFieldText(item, i) }, item.x, pageY + item.y, {
                showInvisible: this._showInvisible,
                pageIndex: i,
                presentationStyleOf: this.presentationStyleOf,
                templateDefinitionOf: this.templateDefinitionOf,
                elementOf: this.elementOf,
                controlValueOf: this.controlValueOf,
                activeControlId: this.activeControlNodeId,
              })
            }
          }
        }

        // ================================================================
        // 页眉页脚编辑模式遮罩层
        // ================================================================
        if (this.hfEditActive) {
          ctx.save()
          ctx.globalAlpha = 0.15
          ctx.fillStyle = '#6B7280' // gray-500, 轻淡蒙层
          // 正文区域变暗
          ctx.fillRect(0, pageY + headerH, pageWidth, pageHeight - headerH - footerH)
          // 非激活的页眉/页脚区域也变暗
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

        // 分隔线 (页脚上方) — 0.5px细线, 浅灰
        ctx.strokeStyle = '#CCCCCC'
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(0, pageY + footerTop)
        ctx.lineTo(pageWidth, pageY + footerTop)
        ctx.stroke()

        // 编辑模式: 激活区域用虚线边框标记
        if (this.hfEditActive && this.hfEditSection === 'footer') {
          ctx.save()
          ctx.strokeStyle = '#93C5FD' // primary-300
          ctx.lineWidth = 1
          ctx.setLineDash([4, 3])
          ctx.strokeRect(1, pageY + footerTop + 1, pageWidth - 2, footerH - 2)
          ctx.setLineDash([])
          ctx.restore()
        }

        // --- 页脚文本 (仅在有内容时渲染) ---
        if (hasFooter) {
          ctx.save()
          if (!this.hfEditActive || this.hfEditSection !== 'footer') {
            // 非编辑态: 页脚文本变淡
            ctx.globalAlpha = 0.55
          }
          this.renderParticleItems(ctx, page.footerItems!, pageY + footerTop, i)
          ctx.restore()
        }
      }
    }

    // --- interact 层: 选区 + 光标 ---
    // 恢复内容层的裁剪区域
    if (ctx) ctx.restore()
    const ictx = this.renderer.getInteractCtx()
    if (!ictx || !pool || !runtimeState) return

    const cursor = runtimeState.cursor
    // 无有效光标位置 → 跳过 interact 层渲染
    if (cursor.paragraphPath.length === 0) return

    ictx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0)
    ictx.clearRect(0, 0, viewportW / scale, viewportH / scale)
    // 页面居中: 与 content 层相同偏移
    ictx.translate(offsetX / scale, 0)

    // --- 选区高亮 (文字下方, 统一包围盒) — 无缝编辑激活期间隐藏 (消除双光标) ---
    const selection = runtimeState.selection
    if (selection.active && !this.activeControlNodeId) {
      this.renderSelectionUnified(pool, selection, pageVerticalGap, ictx)
    }

    // --- 单元格框选高亮 (文字下方) ---
    if (this.cellSelection) {
      this.renderCellSelection(pool, this.cellSelection, pageVerticalGap, ictx)
    }

    // --- 设计模式控件选中高亮 (契约 §12.3, draw-time overlay) ---
    if (this.designSelectedControlId) {
      this.renderDesignSelection(this.designSelectedControlId, pageVerticalGap, ictx)
    }

    // --- 光标 (文字上方, 仅在 visible 时绘制; 无缝编辑激活时隐藏, 由 DOM 光标承担) ---
    if (cursor.visible && !this.activeControlNodeId) {
      const caret = this.computeCaretPos(pool, cursor.paragraphPath, cursor.offset, pageVerticalGap)
      if (caret) {
        ictx.fillStyle = '#000000'
        ictx.fillRect(caret.x, caret.y, 2, caret.h)
      }
    }
  }

  // ================================================================
  // 选区渲染 — 逐 SLIF item 独立底色, 每行宽度跟随内容 (阶梯样式)
  // 首段/末段按 offset 裁剪, 中间段全画
  //
  // 修复滚动选区偏移 (cheerful-snacking-hamming 方案):
  //   遍历所有页面 (而非 visible 范围), 保证 anchor/focus 所在的所有页面都能正确绘制选区。
  // ================================================================
  private renderSelectionUnified(
    pool: NodePool,
    selection: EditorRuntimeState['selection'],
    pageVerticalGap: number = 0,
    ictx: CanvasRenderingContext2D,
  ): void {
    const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1] || ''
    const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1] || ''
    if (!this.document) return

    // 区域: 同 header/footer 的选区 → 专用高亮 (每页独立 offset); 跨区拒绝。
    const aSec = sectionOf(anchorParaId, this.document)
    const fSec = sectionOf(focusParaId, this.document)
    if (aSec !== fSec) return
    if (aSec === 'header' || aSec === 'footer') {
      this.fillRegionSelection(pool, selection, aSec, pageVerticalGap, ictx)
      return
    }

    // 展平 body → 阅读顺序 (表格展开为 cell 段落)。cell 段落不在 body.children,
    // 若不展平, body↔table 跨域选区 indexOf=-1 被整体丢弃 (「全选/拖选选不中表格」)。
    const bodyChildren = pool.getChildren(pool.rootIds.body)
    const spine = flattenTextContainers(pool, bodyChildren)
    const aIdx = spine.indexOf(anchorParaId)
    const fIdx = spine.indexOf(focusParaId)
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

    // 当前文档滚动位置 — 直接读取, 与 computeCaretPos 同源
    const scrollY = this.coordSystem.transform.scrollY

    // 单个文本 run 的裁剪 + 填充: 基于 paraId 在 spine 中的索引与段内累计偏移
    // 计算是否落入 [lo,hi] 选区范围, 落入则按逐字符像素宽度裁剪后 fillRect。
    const fillItem = (
      paraId: string,
      text: string,
      x: number, y: number, ascent: number, descent: number,
      fontCfg: { font: string; size: number; bold?: boolean; italic?: boolean },
    ): void => {
      const pi = spine.indexOf(paraId)
      if (pi < lo || pi > hi) return

      const itemStart = paraOffsets.get(paraId) ?? 0
      const tLen = text?.length || 0
      const itemEnd = itemStart + tLen

      // ---- 第一层: item 级筛选 ----
      let include = true
      if (samePara) {
        include = itemEnd > selMin && itemStart < selMax
      } else if (pi === lo) {
        include = itemEnd > (aIdx === lo ? anchorOff : focusOff)
      } else if (pi === hi) {
        include = itemStart < (aIdx === hi ? anchorOff : focusOff)
      }

      let localStart = 0
      let localEnd = tLen || 1  // 空段落占位至少 1 个单位宽度
      if (samePara) {
        localStart = Math.max(0, selMin - itemStart)
        localEnd = Math.min(tLen, selMax - itemStart)
      } else if (pi === lo) {
        localStart = Math.max(0, (aIdx === lo ? anchorOff : focusOff) - itemStart)
        localEnd = tLen || 1
      } else if (pi === hi) {
        localStart = 0
        localEnd = Math.min(tLen || 1, (aIdx === hi ? anchorOff : focusOff) - itemStart)
      }

      paraOffsets.set(paraId, itemEnd)
      if (!include) return

      // 逐字符累积宽度: 正确区分半角/全角字符像素宽度
      const dx = cumulativeWidthUpTo(text || '', localStart, fontCfg, this.measurer)
      const dw = tLen > 0
        ? cumulativeWidthUpTo(text || '', localEnd, fontCfg, this.measurer) - dx
        : ascent + descent  // 空段落用高度作为最小宽度

      ictx.fillRect(x + dx, y, dw, ascent + descent)
    }

    const CELL_PAD = 6 // 与 TableParticle.CELL_PADDING 一致

    // 遍历所有页面 — 选区可能跨越 visible 之外的页面
    for (let i = 0; i < this.pages.length; i++) {
      const sp = this.pages[i]
      if (!sp) continue
      // 每页 canvas Y = 该页累加文档 Y (含间隙) - 当前 scrollY
      const spY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY
      for (const item of sp.items) {
        if (item.type === 'table') {
          // cell 段落: 遍历 rows/cells/items (cell 局部坐标 → 页面坐标)
          let rowY = item.y
          for (const row of item.rows || []) {
            const rowHeight = Math.max(row.height || 24, 24)
            for (const c of row.cells) {
              const cellX = item.x + (c.x || 0)
              const cellY = spY + rowY
              for (const ci of c.items || []) {
                const paraId = this.findItemParagraph(ci.nodeId, pool)
                if (!paraId) continue
                fillItem(
                  paraId, ci.text || '',
                  cellX + CELL_PAD + (ci.x || 0), cellY + (ci.y || 0),
                  ci.ascent, ci.descent,
                  { font: ci.font || 'SimSun', size: ci.size || 16, bold: ci.bold, italic: ci.italic },
                )
              }
            }
            rowY += rowHeight + 1
          }
        } else if (item.type === 'image') {
          // 图片 (段落内联或 body 块级): 高亮整幅图片边界, 而非按文本 item 逐字符。
          // 图片无 text, 旧 fillItem 以 0 长度计算, 只会画出一个 ascent×ascent
          // 的小方框 (或块级图因 findItemParagraph 返回 null 被整体跳过),
          // 导致「全选/拖选选不中图片」。
          const ownerParaId = this.findItemParagraph(item.nodeId, pool)
          if (ownerParaId) {
            // 内联图: 归属段落, 按段内 1 字符偏移定位 (与 paragraphTextLength 一致)
            const pi = spine.indexOf(ownerParaId)
            if (pi < lo || pi > hi) continue
            const itemStart = paraOffsets.get(ownerParaId) ?? 0
            const itemEnd = itemStart + 1
            let include = true
            if (samePara) {
              include = itemEnd > selMin && itemStart < selMax
            } else if (pi === lo) {
              include = itemEnd > (aIdx === lo ? anchorOff : focusOff)
            } else if (pi === hi) {
              include = itemStart < (aIdx === hi ? anchorOff : focusOff)
            }
            paraOffsets.set(ownerParaId, itemEnd)
            if (!include) continue
          } else {
            // 块级图: nodeId 即 body 顶层 child (spine 成员), 按索引直接定位
            const pi = spine.indexOf(item.nodeId)
            if (pi < lo || pi > hi) continue
          }
          ictx.fillRect(item.x, spY + item.y, item.width, item.height)
        } else {
          // 正文段落: 顶级 item
          const paraId = this.findItemParagraph(item.nodeId, pool)
          if (!paraId) continue
          fillItem(
            paraId, item.text || '',
            item.x, spY + item.y, item.ascent, item.descent,
            { font: item.font || 'SimSun', size: item.size || 16, bold: item.bold, italic: item.italic },
          )
        }
      }
    }
  }

  /** 页眉/页脚区域选区高亮 — 逐页遍历 headerItems/footerItems, 每页独立 offset 累加
   *  (header/footer 每页整区重排、内容相同, 绝不跨页共享 offset)。 */
  private fillRegionSelection(
    pool: NodePool,
    selection: EditorRuntimeState['selection'],
    section: 'header' | 'footer',
    pageVerticalGap: number = 0,
    ictx: CanvasRenderingContext2D,
  ): void {
    const doc = this.document!
    const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1] || ''
    const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1] || ''
    const sp = selectionSpine(doc, pool, anchorParaId, focusParaId)
    if (!sp) return
    const spine = sp.spine
    const aIdx = spine.indexOf(anchorParaId)
    const fIdx = spine.indexOf(focusParaId)
    if (aIdx < 0 || fIdx < 0) return
    const lo = Math.min(aIdx, fIdx)
    const hi = Math.max(aIdx, fIdx)
    const samePara = lo === hi
    const anchorOff = selection.anchor.offset
    const focusOff = selection.focus.offset
    const selMin = Math.min(anchorOff, focusOff)
    const selMax = Math.max(anchorOff, focusOff)

    ictx.fillStyle = 'rgba(59, 130, 246, 0.2)'
    const scrollY = this.coordSystem.transform.scrollY

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]
      if (!page) continue
      const spY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY
      const items = section === 'header' ? page.headerItems : page.footerItems
      if (!items || items.length === 0) continue
      const bandTop = section === 'footer' ? (page.height - (page.footerHeight ?? 42)) : 0
      const paraOffsets = new Map<string, number>() // 每页独立, 防重复副本叠加
      for (const item of items) {
        const paraId = this.findItemParagraph(item.nodeId, pool)
        if (!paraId) continue
        const pi = spine.indexOf(paraId)
        if (pi < lo || pi > hi) continue
        const text = item.text || ''
        const tLen = text.length
        const itemStart = paraOffsets.get(paraId) ?? 0
        const itemEnd = itemStart + tLen

        let include = true
        if (samePara) {
          include = itemEnd > selMin && itemStart < selMax
        } else if (pi === lo) {
          include = itemEnd > (aIdx === lo ? anchorOff : focusOff)
        } else if (pi === hi) {
          include = itemStart < (aIdx === hi ? anchorOff : focusOff)
        }

        let localStart = 0
        let localEnd = tLen || 1
        if (samePara) {
          localStart = Math.max(0, selMin - itemStart)
          localEnd = Math.min(tLen, selMax - itemStart)
        } else if (pi === lo) {
          localStart = Math.max(0, (aIdx === lo ? anchorOff : focusOff) - itemStart)
          localEnd = tLen || 1
        } else if (pi === hi) {
          localStart = 0
          localEnd = Math.min(tLen || 1, (aIdx === hi ? anchorOff : focusOff) - itemStart)
        }
        paraOffsets.set(paraId, itemEnd)
        if (!include) continue

        const fontCfg = { font: item.font || 'SimSun', size: item.size || 12, bold: item.bold, italic: item.italic }
        const dx = cumulativeWidthUpTo(text || '', localStart, fontCfg, this.measurer)
        const dw = tLen > 0
          ? cumulativeWidthUpTo(text || '', localEnd, fontCfg, this.measurer) - dx
          : item.ascent + item.descent
        ictx.fillRect(item.x + dx, spY + bandTop + item.y, dw, item.ascent + item.descent)
      }
    }
  }

  /** 渲染单元格框选高亮 — 高亮范围内 (起始网格坐标落在矩形内) 的单元格
   *  遍历所有页面 — 选区可能跨越 visible 之外的页面 (cheerful-snacking-hamming 方案)
   */
  private renderCellSelection(
    pool: NodePool,
    range: { tableId: string; startRow: number; startCol: number; endRow: number; endCol: number },
    pageVerticalGap: number = 0,
    ictx: CanvasRenderingContext2D,
  ): void {
    const r0 = Math.min(range.startRow, range.endRow)
    const r1 = Math.max(range.startRow, range.endRow)
    const c0 = Math.min(range.startCol, range.endCol)
    const c1 = Math.max(range.startCol, range.endCol)

    // 选中 cell id 集合
    const selected = new Set<string>()
    for (const gc of buildCellGrid(pool, range.tableId).cells) {
      if (gc.row >= r0 && gc.row <= r1 && gc.col >= c0 && gc.col <= c1) selected.add(gc.cellId)
    }

    ictx.save()
    ictx.fillStyle = 'rgba(59, 130, 246, 0.16)'
    ictx.strokeStyle = 'rgba(37, 99, 235, 0.85)'
    ictx.lineWidth = 1.5

    // 当前文档滚动位置 — 直接读取
    const scrollY = this.coordSystem.transform.scrollY

    for (let i = 0; i < this.pages.length; i++) {
      const sp = this.pages[i]
      if (!sp) continue
      // 每页 canvas Y = 该页累加文档 Y (含间隙) - 当前 scrollY
      const spY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY
      for (const item of sp.items) {
        if (item.type !== 'table' || item.nodeId !== range.tableId) continue
        let rowY = item.y
        for (const row of item.rows || []) {
          const rowHeight = Math.max(row.height || 24, 24)
          for (const cell of row.cells) {
            if (!cell.id || !selected.has(cell.id)) continue
            const cw = cell.width || 40
            const ch = cell.height || rowHeight
            const cellX = item.x + (cell.x || 0)
            const cellY = spY + rowY
            ictx.fillRect(cellX, cellY, cw, ch)
            ictx.strokeRect(cellX + 0.5, cellY + 0.5, cw - 1, ch - 1)
          }
          rowY += rowHeight + 1
        }
      }
    }
    ictx.restore()
  }

  /** 渲染设计模式控件选中高亮 (契约 §12.3) — 虚线边框 draw-time overlay, 不触发回流
   *  遍历所有页面 (选中控件可能位于 visible 之外) — 与 renderCellSelection 同源方案
   */
  private renderDesignSelection(
    nodeId: string,
    pageVerticalGap: number = 0,
    ictx: CanvasRenderingContext2D,
  ): void {
    ictx.save()
    ictx.fillStyle = 'rgba(37, 99, 235, 0.10)' // primary-600 @ 10%
    ictx.strokeStyle = '#2563EB'               // primary-600
    ictx.lineWidth = 1.5
    ictx.setLineDash([5, 3])

    const scrollY = this.coordSystem.transform.scrollY

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]
      if (!page) continue
      const spY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY
      for (const item of getFlatPageItems(page)) {
        if (item.nodeId !== nodeId || item.nodeType !== 'smarttext') continue
        // 选中框须与 ControlParticle 的控件视觉盒同源几何 (computeControlBox, 单一事实源) —
        // 历史 bug: 两处各算各的几何, 且把 item.y (行顶) 当基线, 选中框与控件盒/光标错位。
        const fontSize = item.size || 16
        const ascent = item.ascent > 0 ? item.ascent : fontSize * 0.8
        const descent = item.descent > 0 ? item.descent : fontSize * 0.2
        const box = computeControlBox(item.x, spY + item.y, (item.width || 0) - (item.markerWidth || 0), ascent, descent, this.presentationStyleOf(nodeId)?.minWidth)
        ictx.fillRect(box.x, box.y, box.w, box.h)
        ictx.strokeRect(box.x, box.y, box.w, box.h)
      }
    }

    ictx.setLineDash([])
    ictx.restore()
  }

  /** 查找 SLIF item 所属段落 ID (保留, 供选区渲染使用) */
  private findItemParagraph(nodeId: string, pool: NodePool): string | null {
    for (const [, node] of pool.nodes) {
      if (node.type === 'paragraph') {
        const para = node as unknown as { children: readonly string[] }
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
    pageIndex: number,
  ): void {
    for (const item of items) {
      if (item.type === 'image') {
        const imgUrl = this.resolveImageUrl(item)
        if (imgUrl) {
          this.renderImage(ctx, imgUrl, item.x, pageY + item.y, item.width, item.height)
        }
        continue
      }
      // 文本/域代码 — 通过 Registry 调度 (含列表标记)
      const textRenderer = particleRegistry.get(item.nodeType || item.type)
      if (textRenderer) {
        textRenderer.render(ctx, { ...item, text: this.resolveFieldText(item, pageIndex) }, item.x, pageY + item.y, {
          showInvisible: this._showInvisible,
          pageIndex,
          presentationStyleOf: this.presentationStyleOf,
          templateDefinitionOf: this.templateDefinitionOf,
          elementOf: this.elementOf,
          controlValueOf: this.controlValueOf,
          activeControlId: this.activeControlNodeId,
        })
      }
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

    const viewportW = this.host.viewport.size().width
    const scale = this.coordSystem.transform.scale
    const pageWidth = this.pages[0]?.width || 794
    const visiblePageW = pageWidth * scale
    const offsetX = Math.max(0, (viewportW - visiblePageW) / 2)
    // 分页间隙 — 与 Draw.render() 同源, 保证光标 / 鼠标命中在同一坐标系
    const pageVerticalGap = this.renderer.getPageVerticalGap()

    const caret = this.computeCaretPos(pool, cursor.paragraphPath, cursor.offset, pageVerticalGap)
    if (!caret) return null

    const surface = this.renderer.getInteractSurface()
    const canvasRect = surface?.getBoundingClientRect() ?? { left: 0, top: 0 }

    return {
      left: canvasRect.left + caret.x * scale + offsetX,
      top: canvasRect.top + caret.y * scale,
      width: Math.max(2 * scale, 1),
      height: caret.h * scale,
    }
  }

  /**
   * 获取 smarttext 控件在视口中的 Client 矩形 — 供 React runtime overlay 定位
   * (契约 §12.6)。与 renderDesignSelection 同源几何 (computeControlBox, 单一
   * 事实源), 复用 getCaretClientRect 的 scale/offsetX/canvasRect 转换, 保证
   * overlay 与 Canvas 静态 widget 逐像素对齐。
   */
  getControlClientRect(
    nodeId: string,
  ): { left: number; top: number; width: number; height: number } | null {
    if (this.pages.length === 0) return null

    const viewportW = this.host.viewport.size().width
    const scale = this.coordSystem.transform.scale
    const pageWidth = this.pages[0]?.width || 794
    const visiblePageW = pageWidth * scale
    const offsetX = Math.max(0, (viewportW - visiblePageW) / 2)
    const pageVerticalGap = this.renderer.getPageVerticalGap()
    const scrollY = this.coordSystem.transform.scrollY

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]
      if (!page) continue
      const spY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY
      for (const item of getFlatPageItems(page)) {
        if (item.nodeId !== nodeId || item.nodeType !== 'smarttext') continue
        const fontSize = item.size || 16
        const ascent = item.ascent > 0 ? item.ascent : fontSize * 0.8
        const descent = item.descent > 0 ? item.descent : fontSize * 0.2
        const box = computeControlBox(item.x, spY + item.y, (item.width || 0) - (item.markerWidth || 0), ascent, descent, this.presentationStyleOf(nodeId)?.minWidth)
        const surface = this.renderer.getInteractSurface()
        const canvasRect = surface?.getBoundingClientRect() ?? { left: 0, top: 0 }
        return {
          left: canvasRect.left + box.x * scale + offsetX,
          top: canvasRect.top + box.y * scale,
          width: box.w * scale,
          height: box.h * scale,
        }
      }
    }
    return null
  }

  /**
   * 获取 smarttext 控件的「无缝内联编辑目标」(契约 §12.6 运行时交互)。
   *
   * 与 getControlClientRect 同坐标转换, 但返回的是 **文本编辑内容区**
   * (方括号框=括号内、textarea=内容区) 而非整盒, 且携带与 Canvas 绘制一致
   * 的字体/字号(CSS px = size*scale)/基线/颜色/对齐 —— 供 RuntimeControlOverlay
   * 透明无框地对齐, 不再复制 inset/字体规则。
   */
  getControlEditTarget(
    nodeId: string,
  ): {
    textArea: { left: number; top: number; width: number; height: number; right: number }
    ascentCss: number
    descentCss: number
    /** 字体真实行 ascent (fontBoundingBox, CSS px) — overlay 用它抵消 DOM 基线差 */
    lineAscentCss: number
    fontFamily: string
    fontSizeCss: number
    bold: boolean
    italic: boolean
    align: 'left' | 'center' | 'right'
    bracketOn: boolean
    affordance: 'dropdown' | 'calendar' | null
    color: string
    caretColor: string
    placeholderText: string
    empty: boolean
    writable: boolean
    masked: boolean
    minRows?: number
  } | null {
    if (this.pages.length === 0) return null
    const node = this.pool?.nodes.get(nodeId) as SmartTextNode | undefined
    if (!node || node.type !== 'smarttext') return null

    const viewportW = this.host.viewport.size().width
    const scale = this.coordSystem.transform.scale
    const pageWidth = this.pages[0]?.width || 794
    const visiblePageW = pageWidth * scale
    const offsetX = Math.max(0, (viewportW - visiblePageW) / 2)
    const pageVerticalGap = this.renderer.getPageVerticalGap()
    const scrollY = this.coordSystem.transform.scrollY

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]
      if (!page) continue
      const spY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY
      for (const item of getFlatPageItems(page)) {
        if (item.nodeId !== nodeId || item.nodeType !== 'smarttext') continue

        const fontSize = item.size || 16
        const fontFamily = item.font || 'SimSun'
        const ascent = item.ascent > 0 ? item.ascent : fontSize * 0.8
        const descent = item.descent > 0 ? item.descent : fontSize * 0.2
        const measure = (t: string) => this.measurer.measureWidth(t, {
          font: fontFamily, size: fontSize, bold: item.bold, italic: item.italic,
        })
        const fm = this.measurer.measure('M', { font: fontFamily, size: fontSize, bold: item.bold, italic: item.italic })
        const lineAscentCss = (fm.fontBoundingBoxAscent ?? fm.actualBoundingBoxAscent ?? fontSize * 0.8) * scale
        const style = this.presentationStyleOf?.(nodeId)
        const def = this.templateDefinitionOf?.(nodeId)
        const el = node.element
        const controlValue = node.value
        const empty = isControlValueEmpty(controlValue)
        const masked = el?.privacy?.enabled === true
        const writable = (def?.editable !== false) && el?.readonly !== true

        const region = computeFieldRegion({
          controlType: def?.controlType,
          lineLeft: item.x,
          lineTop: spY + item.y,
          layoutWidth: (item.width || 0) - (item.markerWidth || 0),
          ascent,
          descent,
          minWidth: style?.minWidth,
          borderStyle: style?.borderStyle,
          textAlignOverride: style?.textAlign as 'left' | 'center' | 'right' | undefined,
          measure,
        })

        const surface = this.renderer.getInteractSurface()
        const canvasRect = surface?.getBoundingClientRect() ?? { left: 0, top: 0 }
        const regionW = (region.textRightX - region.textX) * scale
        return {
          textArea: {
            left: canvasRect.left + region.textX * scale + offsetX,
            top: canvasRect.top + region.box.y * scale,
            width: regionW,
            right: canvasRect.left + region.textRightX * scale + offsetX,
            height: (ascent + descent) * scale,
          },
          ascentCss: ascent * scale,
          descentCss: descent * scale,
          lineAscentCss,
          fontFamily,
          fontSizeCss: fontSize * scale,
          bold: !!item.bold,
          italic: !!item.italic,
          align: region.align,
          bracketOn: region.bracketOn,
          affordance: region.affordance,
          color: masked ? '#9CA3AF' : (empty ? '#9CA3AF' : (item.color || '#374151')),
          caretColor: '#374151',
          placeholderText: stripPlaceholderBrackets(node.text || ''),
          empty,
          writable,
          masked,
          minRows: el?.format?.minRows,
        }
      }
    }
    return null
  }

  setScale(scale: number): void {
    const oldScale = this.coordSystem.transform.scale
    // 缩放变更时重新转换 scrollY: 保持视觉滚动位置不变
    const cssScrollTop = this.coordSystem.transform.scrollY * oldScale
    this.coordSystem.update({ scale, scrollY: cssScrollTop / scale })
    this.eventBus.emit('scale:changed', scale)
  }

  /**
   * 设置分页渲染间隙 — 仅影响渲染视口偏移, 不修改 SLIF 存储坐标。
   * 调用后自动触发 syncSizes + render 重绘。
   *
   * 默认 20 — 让页面之间的间距可见; 设置为 0 可恢复旧版"页面紧贴"行为。
   */
  setPageVerticalGap(gap: number): void {
    const changed = this.renderer.setPageVerticalGap(gap)
    this.layoutEngine.setPageVerticalGap(gap)
    if (changed) {
      // 触发 spacer 高度 + canvas 高度同步, 并重绘以应用新偏移
      const viewport = this.host.viewport.size()
      const viewportW = viewport.width
      const viewportH = viewport.height
      const dpr = this.coordSystem.transform.dpr
      if (this.pages.length > 0) {
        this.renderer.syncSizes(viewportW, viewportH, dpr, this.pages)
        this.render(this.pool ?? undefined, this._state ?? undefined)
      }
    }
  }

  /** 获取当前分页渲染间隙 (供 hitTest 调用方使用) */
  getPageVerticalGap(): number {
    return this.renderer.getPageVerticalGap()
  }

  /** 设置脏区域裁剪 (TASK-483): 仅重绘该区域, 渲染后自动清除 */
  setDirtyRect(rect: { x: number; y: number; w: number; h: number } | null): void {
    this.dirtyRect = rect
  }

  getScale(): number { return this.coordSystem.transform.scale }

  /** 设置数字水印 (R35) */
  setWatermark(config: WatermarkConfig): void {
    this.renderer.prepareWatermark(config)
  }

  /** 域代码动态值计算 (TASK-471) */
  private resolveFieldText(item: { fieldType?: string; text?: string }, pageIndex: number): string {
    if (!item.fieldType) return item.text || ''
    const total = this.pages.length
    const now = new Date()
    switch (item.fieldType) {
      case 'page_number': return String(pageIndex + 1)
      case 'total_pages': return String(total)
      case 'current_date': return now.toLocaleDateString('zh-CN')
      case 'current_time': return now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      case 'document_title': return this.document?.title || ''
      case 'author_name': return 'user' // 暂取默认
      case 'last_saved_date': return now.toLocaleDateString('zh-CN')
      case 'print_date': return now.toLocaleDateString('zh-CN')
      default: return item.text || `[${item.fieldType}]`
    }
  }

  /** 不可见字符显示 (TASK-475) */
  get showInvisible(): boolean { return this._showInvisible }
  set showInvisible(v: boolean) { this._showInvisible = v }

  /** 从 pool 中解析图片 URL */
  private resolveImageUrl(item: { nodeId: string }): string | null {
    if (!this.pool) return null
    const node = this.pool.nodes.get(item.nodeId) as { src?: string } | undefined
    return node?.src || null
  }

  /** 渲染图片 (TASK-447), 带内存缓存 */
  private renderImage(
    ctx: CanvasRenderingContext2D,
    url: string,
    x: number, y: number,
    width: number, height: number,
  ): void {
    const cached = this.imageCache.get<CanvasImageSource>(url)
    if (cached) {
      ctx.drawImage(cached, x, y, width, height)
      return
    }
    // 异步加载首帧, 后续帧从缓存读取
    this.host.surface.loadImage(url).then((img) => {
      this.imageCache.set(url, img.source)
      // 触发重绘以显示图片
      if (this.pool && this._state) {
        this.scheduleRender(this.pool, this._state)
      }
    })
    // 加载中绘制占位矩形
    ctx.save()
    ctx.fillStyle = '#E5E7EB'
    ctx.fillRect(x, y, width, height)
    ctx.strokeStyle = '#9CA3AF'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 2])
    ctx.strokeRect(x, y, width, height)
    ctx.setLineDash([])
    ctx.restore()
  }

  /** 页眉页脚编辑模式状态 */
  isHeaderFooterEditActive(): boolean { return this.hfEditActive }
  /** 当前编辑的页眉/页脚区域 */
  getHeaderFooterEditSection(): 'header' | 'footer' { return this.hfEditSection }

  /** 激活/关闭页眉页脚编辑模式 */
  setHeaderFooterEditActive(active: boolean, section?: 'header' | 'footer'): void {
    this.hfEditActive = active
    if (section) this.hfEditSection = section
  }

  /** 渲染单个 SLIF 页面到离屏 Canvas 上下文 (用于打印) */
  renderPageToContext(ctx: CanvasRenderingContext2D, page: SLIFPage, pageWidth: number): void {
    for (const item of page.items) {
      if (item.type === 'separator') {
        const sepRenderer = particleRegistry.get('separator')
        if (sepRenderer) {
          sepRenderer.render(ctx, item, item.x, item.y, { contentWidth: pageWidth - item.x - 90 })
        }
      } else if (item.type === 'image') {
        this.imageParticle.render(ctx, item, item.x, item.y)
      } else {
        // 文本/域代码 — 通过 Registry 调度 (含列表标记)
        const textRenderer = particleRegistry.get(item.nodeType || item.type)
        if (textRenderer) {
          textRenderer.render(ctx, { ...item, text: item.text || '' }, item.x, item.y, { showInvisible: false })
        }
      }
    }
  }

  getEventBus(): EventBus { return this.eventBus }

  destroy(): void {
    this.renderer.destroy()
    this.hitTestIndex.clear()
    this.eventBus.off('render:request', () => {})
    this.eventBus.off('layout:changed', () => {})
  }
}
