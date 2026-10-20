// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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
import { getFlatPageItems, tableHeaderRowsHeight } from '../layout/core/SLIF'

/**
 * Section 在视口中的**分段**矩形 (契约 §31.14) —— 每个它触及的页一段。
 * 坐标与 getTableClientRect / getControlClientRect 同源 (视口 client 坐标)。
 */
export interface SectionPageRect {
  pageIndex: number
  left: number
  top: number
  width: number
  height: number
  /** 该页正文栏左缘 — 供叠加层画左侧竖线 (取自 pageSetup 页边距, 不随段落缩进漂移) */
  contentLeft: number
  /** 该页正文栏右缘 */
  contentRight: number
}
import type { EventBus } from '../interaction/EventBus'
import { locale } from '../i18n/index'
import type { EditorRuntimeState } from '../state/EditorRuntimeState'
import type { EditorHost } from '../host/EditorHost'
import { CoordinateSystem } from '../state/CoordinateSystem'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import type { ComputedValues } from '../evaluation/ComputedValues'
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
import { computeControlBox, stripPlaceholderBrackets, controlVisualType, controlInlineLeadTrail } from '../document/control/ControlBox'
import { computeFieldRegion } from '../document/control/ControlFieldGeometry'
import { isControlValueEmpty } from '../document/control/ControlValue'
import type { PresentationStyleStore } from './presentation/PresentationStyle'
import type { TemplateDefinitionStore } from '../template/TemplateDefinition'
import { createChartParticle } from './particles/ChartParticle'
import { createBarcodeParticle } from './particles/BarcodeParticle'
import { particleRegistry } from './particles/ParticleRegistry'
import { textParticle, separatorParticle, listParticle, fieldParticle } from './particles/ParticleAdapters'
import { buildCellGrid } from '../document/table/TableOps'
import { regionIdOf, selectionSpine, paragraphTextLength, bodyParagraphSpine, sectionsOf, sectionOf } from '../document/selection/SelectionCollector'
import { COMMENT_HIGHLIGHT, commentHighlight } from './particles/CommentParticle'
import { safeRenderParticle, safeRenderPage } from '../ErrorRecovery'
import { resolveHfParagraphLocation } from '../document/core/HeaderFooterRegions'
import { resolveFieldText as formatFieldText } from '../document/factory/FieldFormatter'
import { EditorTheme, STANDARD_CANVAS_TOKENS } from '../state/EditorTheme'
import type { CanvasTokenSet } from '../state/canvasTokens'
import { asRgb, withAlpha } from '../state/canvasTokens'

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
  /** 上一次命中索引重建的起始页 (诊断: 等于总页数表示整份复用, 未重建) */
  private lastHitRebuildStart = 0
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
  /**
   * 计算值集合 (契约 §12.12.7/§12.12.8)。由 Editor 构造并注入 —— 它是
   * **per-editor 的派生状态**, 不是文档内容。
   *
   * Draw 只读它, 且只在**每趟开头** `ensure()` 一次 (见 recomputeLayout /
   * render): 布局与渲染读同一份 memo, 于是同一控件的盒宽与绘制的文字**构造上**
   * 一致 —— 而两者是相隔很远的两趟, 各自求值就会分叉。
   */
  private computedValues: ComputedValues | null = null
  private templateDefinitionOf = (nodeId: string) => this.templateDefinitions?.get(nodeId)

  // 语义元数据 (契约 §2.1) — 控件 dataType 分类 / 隐私脱敏读取源, 随 setDocument 更新
  private elementOf = (nodeId: string) => (this.pool?.nodes.get(nodeId) as SmartTextNode | undefined)?.element

  // 控件规范运行时值 (契约 §12.6.1) — widget affordance 读取源 (区别于 SLIFItem.text 显示串)
  private controlValueOf = (nodeId: string) => (this.pool?.nodes.get(nodeId) as SmartTextNode | undefined)?.value

  // 页眉页脚编辑模式 (TASK-470/471 双击激活)
  private hfEditActive = false
  private hfEditSection: 'header' | 'footer' = 'header'
  /**
   * 编辑目标页「钉子」下标 (契约 §7.2/§7.9)。页眉页脚段落每页都有副本,
   * 不定页时光标/控件 overlay 会恒解析到第 0 页 (computeCaretPos 取首个命中)。
   */
  private hfEditPageIndex = 0

  // 不可见字符显示 (TASK-475)
  private _showInvisible = false
  /**
   * 修订留痕显示开关 (契约 §12.13) — 纯视图开关, 默认开。
   * 与 showInvisible 不同, 打印**不**强制关闭: 留痕是内容标注而非编辑辅助标记。
   */
  private _showRevisionMarks = true

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

  // 列宽拖拽参考线 (由 Editor 注入) — draw-time overlay 交互态, 页面内逻辑坐标。
  // 不进 DocumentModel、不进命令 (§7.2): 拖动期间只更新此字段, 松开才提交列宽命令。
  columnResizeGuide: { pageIndex: number; x: number; top: number; bottom: number } | null = null

  // 当前激活的控件节点 id (无缝内联编辑, 契约 §12.6 运行时交互, 由 Editor 注入)
  // — 该控件渲染时隐藏静态 field (框/值/affordance), 由 DOM overlay 承担文本面
  activeControlNodeId: string | null = null

  /** 画布主题引用 (Editor 构造注入; 用于 render() 入口拍 tokenSet 快照) */
  private theme: EditorTheme | null = null

  constructor(
    host: EditorHost,
    eventBus: EventBus,
    measurer: TextMeasurer,
    doc?: DocumentTree,
    theme?: EditorTheme,
    computedValues?: ComputedValues | null,
  ) {
    this.host = host
    this.measurer = measurer
    this.eventBus = eventBus
    if (theme) this.theme = theme
    // 计算值集合 (契约 §12.12.7): **在构造处**收下, 不在 setDocument。
    //
    // 判据是"它随什么走": templateDefinitions 随**文档**走 (从 artifact 读回,
    // 换文档即换), 所以走 setDocument; 而计算值集合是 **per-editor 派生状态**,
    // 与 Editor 同生命周期, 身份一次定死。放进 setDocument 会漏掉"文档从头到尾
    // 没换过"的路径 —— `new Editor(host, doc)` 之后再没人调 setDocument, 于是
    // Draw 手上永远是 null, 公式**一条都不生效**且不报错 (死接缝)。
    this.computedValues = computedValues ?? null

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
        label: def?.label, prefix: def?.prefix, suffix: def?.suffix,
        // 计算值 (契约 §12.12.8): 布局据此量宽与决定是否跳过。**只读 memo, 不在这里
        // 重算** —— ensure() 由每趟开头调 (见 recomputeLayout / render), 放进这个
        // 逐控件回调里会退化成 O(N²)。
        computedDisplay: this.computedValues?.displayOf(nodeId),
        visible: this.computedValues?.visibleOf(nodeId),
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
      // 只同步页数组。命中索引的重建在 recomputeLayout 里按分页模式做:
      // 这里若无条件全量重建, 增量分页省下的工作会被立刻还回去 (M2b)。
      this.pages = pages
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
    // 换文档 → 段落行缓存与分页状态都必须清空: 新文档的节点版本可能从 0
    // 重新开始, 键会撞上上一份文档的同名段落 (M2a/M2b)
    this.layoutEngine.clearParagraphLineCache()
    this.layoutEngine.clearPaginationState()
  }

  setRuntimeState(state: EditorRuntimeState): void { this._state = state }

  getPool(): NodePool | null { return this.pool }
  getState(): EditorRuntimeState | null { return this._state }

  recomputeLayout(pool: NodePool, invalidation?: string): SLIFPage[] {
    if (!this.document) return []
    this.pool = pool
    // 修订留痕显示开关同步给布局 (契约 §12.13): 删除线是布局期产物,
    // 关标记必须连它一起关 —— 否则用户关掉标记后删除线还在。
    this.layoutEngine.setShowRevisionMarks(this._showRevisionMarks)
    // 计算值: 布局趟开头 ensure() 一次 (契约 §12.12.7)。脏了才真算, 时钟在那时读
    // 一次; 不脏则连钟都不读 —— 于是同一份文档的布局与渲染必然读到同一个值。
    this.computedValues?.ensure()
    // 计算值代次同步给布局: 表格键里含代次 —— 改公式/改模板定义让显示值变了
    // 但节点版本不变, 只有代次能证明"表格的行高/分页可能变了" (契约 §16.1)
    this.layoutEngine.setComputedGeneration(this.computedValues?.generation ?? 0)
    // invalidation 交给布局: 只有段落级失效才允许增量分页 (M2b, 契约 §16.1)
    this.pages = this.layoutEngine.fullLayout(this.document, pool, invalidation)

    // 命中索引跟随分页结果: 整份复用时不重建; 续排时只重建受影响页起
    const pagination = this.layoutEngine.getPaginationStats()
    if (pagination.mode === 'reuse-all') {
      this.lastHitRebuildStart = this.pages.length
    } else if (pagination.mode === 'resume' && pagination.reusedPages > 0) {
      this.lastHitRebuildStart = pagination.reusedPages
      this.hitTestIndex.rebuildFrom(this.pages, pagination.reusedPages)
    } else {
      this.lastHitRebuildStart = 0
      this.hitTestIndex.rebuild(this.pages)
    }
    return this.pages
  }

  /** 命中索引重建统计 (诊断/测试用; 不参与渲染决策) */
  getHitIndexStats(): { rebuildStartPage: number; totalPages: number } {
    return { rebuildStartPage: this.lastHitRebuildStart, totalPages: this.pages.length }
  }

  // ================================================================
  /**
   * 批注高亮 (契约 §12.2) —— 按 doc.comments 的 range 逐 item 解析并填充。
   *
   * 主题化 (v6.1): 颜色读 tokenSet.commentHighlight (alpha 0.45);
   *   tokenSet 缺时回退 COMMENT_HIGHLIGHT 常量。
   *
   * 为什么不用 CommentParticle: particleRegistry 未注册 'comment', 且布局不为
   * comment_marker 产出 SLIF item —— 那个粒子的 render() 实际不会被调用。这里
   * 直接从 doc.comments 解析, 屏幕 (静态层) 与打印 (renderPageToContext) 共用
   * 同一实现, 保证两边一致 (契约 §12: 打印是文档投影, 必须包含屏幕上的一切)。
   *
   * 字符定位口径必须与 computeCaretPos 一致 (文本计 text.length、原子内联计 1
   * 且不产出字符; 逐字符宽度用 cumulativeWidthUpTo), 否则高亮会与光标错位。
   */
  private drawCommentHighlightsForPage(
    ctx: CanvasRenderingContext2D, page: SLIFPage, pageY: number,
    tokens: CanvasTokenSet | null,
  ): void {
    const threads = this.document?.comments
    const pool = this.pool
    if (!threads || threads.length === 0 || !pool) return

    ctx.save()
    ctx.fillStyle = tokens ? commentHighlight(tokens) : COMMENT_HIGHLIGHT
    for (const thread of threads) {
      const startPara = thread.rangeStart.path[thread.rangeStart.path.length - 1]
      const endPara = thread.rangeEnd.path[thread.rangeEnd.path.length - 1]
      const para = pool.nodes.get(startPara) as { type?: string; children?: readonly string[] } | undefined
      if (!para?.children) continue

      const start = thread.rangeStart.offset
      // 跨段落范围 (本 API 已不产出, 但历史/导入数据可能有): 画到该段末尾
      const end = endPara === startPara
        ? thread.rangeEnd.offset
        : paragraphTextLength(pool, startPara)
      if (end <= start) continue

      let charCount = 0
      for (const item of getFlatPageItems(page)) {
        if (!para.children.includes(item.nodeId)) continue
        const isAtomic = item.nodeType === 'smarttext' || item.nodeType === 'image' ||
          item.nodeType === 'field' || item.nodeType === 'cross_reference' ||
          item.nodeType === 'footnote_ref' || item.nodeType === 'bookmark'
        const unitLen = isAtomic ? 1 : (item.text?.length || 0)
        const itemStart = charCount
        charCount += unitLen
        if (isAtomic || unitLen === 0) continue       // 原子内联无文字可高亮
        const from = Math.max(start, itemStart)
        const to = Math.min(end, itemStart + unitLen)
        if (from >= to) continue
        const fontSpec = {
          font: item.font || 'SimSun', size: item.size || 16,
          bold: item.bold, italic: item.italic,
        }
        const x0 = item.x + cumulativeWidthUpTo(item.text || '', from - itemStart, fontSpec, this.measurer)
        const x1 = item.x + cumulativeWidthUpTo(item.text || '', to - itemStart, fontSpec, this.measurer)
        if (x1 > x0) {
          ctx.fillRect(x0, pageY + item.y, x1 - x0, item.ascent + item.descent)
        }
      }
    }
    ctx.restore()
  }

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
    preferredPageIndex?: number,
  ): CaretPos | null {
    const paraId = paragraphPath[paragraphPath.length - 1]
    const para = pool.nodes.get(paraId) as unknown as { children: readonly string[] } | undefined
    if (!para) return null

    // 文档空间滚动位置 — 直接读取, 每次都准确反映当前滚动
    const scrollY = this.coordSystem.transform.scrollY

    // 判断该段落属于 body / header / footer 哪个**带** (band)
    const section = this.resolveBandOf(paraId)
    let charCount = 0

    // 遍历所有页面查找 (而非 visible.start..visible.end) — 避免与画布 overscan 不一致。
    // 页眉/页脚段落每页都有副本 → 按「优先页」顺序遍历, 使光标落在正在编辑的那页
    // (契约 §7.9); 正文段落只存在于一页, 顺序无关。
    for (const i of this.pageOrder(preferredPageIndex)) {
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
              // 折行控件 (契约 §12.8): 值折成多物理行后, 光标必须落在「值末尾所在
              // 那一行」—— 横向在该行文本之后、纵向在该行行顶、高度为单行行高。
              // 用整盒 ascent+descent 会让光标高成一整个盒、并停在盒右缘 (版心右缘)。
              const lines = item.controlLines
              if (lines && lines.length > 0) {
                return this.wrappedControlCaret(item, lines, localOff, pageY + yOffset)
              }
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
   * 折行控件的段落光标 (契约 §12.8)。
   *
   * 值被折成多物理行后, 整个盒高 = 行数 × 字号, 盒宽 = 版心宽。若沿用「原子 item」
   * 的光标公式 (x = 盒右缘, h = ascent+descent), 光标会高成一整个盒、并停在版心
   * 右缘 —— 离值末尾很远。本方法改按「值末尾所在那一行」定位:
   *   - 值之前 (localOff 0) → 盒左缘 / 首行行顶;
   *   - 值之后 → 末行文本之后 / 末行行顶;
   *   - 高度 = 单个物理行 (字号, 与 ControlParticle 的行距同一 pitch);
   *   - 行内横向复用 computeFieldRegion 的文本区几何 (渲染/命中/overlay 同源)。
   */
  private wrappedControlCaret(
    item: SLIFItem,
    lines: readonly string[],
    localOff: number,
    itemTop: number,
  ): CaretPos {
    const size = item.size || 16
    const fontFamily = item.font || 'SimSun'
    const fontConfig = { font: fontFamily, size, bold: item.bold, italic: item.italic }
    const measure = (t: string) => this.measurer.measureWidth(t, fontConfig)
    const after = localOff >= 1
    // 值之前: 与既有「原子 item」约定一致 (盒左缘), 只是高度收成单行
    if (!after) return { x: item.x, y: itemTop + item.y, h: size }

    const rowIdx = lines.length - 1
    const rowText = lines[rowIdx] || ''

    const lt = this.controlLeadTrail(item.nodeId, fontFamily, size, item.bold, item.italic)
    const style = this.presentationStyleOf?.(item.nodeId)
    const region = computeFieldRegion({
      controlType: this.templateDefinitionOf?.(item.nodeId)?.controlType,
      lineLeft: item.x + lt.lead,
      lineTop: itemTop + item.y,
      layoutWidth: Math.max(0, ((item.width || 0) - (item.markerWidth || 0)) - lt.lead - lt.trail),
      ascent: item.ascent,
      descent: item.descent,
      minWidth: style?.minWidth,
      borderStyle: style?.borderStyle,
      measure,
    })

    // 行内横向: 文本区左缘 + 末行推进宽。center/right 对齐时粒子按「最宽行」整块
    // 平移, 这里按同一口径近似还原 (左对齐为精确值)。
    let textLeft = region.textX
    if (region.align === 'center' || region.align === 'right') {
      const widest = Math.max(0, ...lines.map((l) => measure(l)))
      textLeft = region.align === 'center'
        ? region.textX + Math.max(0, (region.contentW - widest) / 2)
        : region.textRightX - widest
    }
    return {
      // 落在末行文本之后 + 该行闭合方括号之后 (与单行原子「盒右缘」口径一致)
      x: textLeft + measure(rowText) + region.bracketW,
      y: itemTop + item.y + rowIdx * size,
      h: size,
    }
  }

  /**
   * 段落属于 body / header / footer 哪个**页带** (band)。
   *
   * 命名刻意避开 "Section": 本引擎里 `Section` 是文档结构容器 (契约 §31),
   * 而这里回答的是"页眉带 / 页脚带 / 正文"—— 两个概念无关, 同名会误导。
   * 归属唯一经 HeaderFooterRegions 解析 (含首页/偶数页变体, 契约 §7.9)。
   */
  private resolveBandOf(paraId: string): 'body' | 'header' | 'footer' {
    if (!this.document) return 'body'
    return resolveHfParagraphLocation(this.document, paraId)?.band ?? 'body'
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

    // 计算值: 渲染趟开头 ensure() 一次 (契约 §12.12.7)。渲染**不重排** —— 它画的
    // 是上一次布局产出的 SLIF, 而滚动/缩放每次都跑 render; 不在这里 ensure 就会
    // 让"布局用旧值、绘制用新值"成为可能。
    this.computedValues?.ensure()

    // ---- 画布主题 token 拍快照 (Draw 同步持表) ----
    const tokens: CanvasTokenSet = this.theme?.tokenSet ?? STANDARD_CANVAS_TOKENS
    this.renderer.setTokens(tokens)

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
    this.renderer.renderStatic(this.pages, visible, scrollOffset, (ctx, page, _i, pageY) => {
      this.drawCommentHighlightsForPage(ctx, page, pageY, tokens)
    })

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
        // 逐页容错: 单页抛错只损失这一页。rect **必须**给 ——
        // 不给的话 safeRenderPage 的占位图会刷满整张 canvas (那是离屏单页渲染的语义)
        safeRenderPage(
          () => this.renderPageContent(ctx, page, i, pageY, pageWidth, pageHeight, contentWidth),
          i,
          ctx,
          { x: 0, y: pageY, width: pageWidth, height: pageHeight },
        )
      }
    }

    // --- interact 层: 选区 + 光标 ---
    // 恢复内容层的裁剪区域
    if (ctx) ctx.restore()
    const ictx = this.renderer.getInteractCtx()
    if (!ictx || !pool || !runtimeState) return

    const cursor = runtimeState.cursor
    // 无有效光标位置 → 跳过 interact 层渲染 (列宽拖拽参考线除外 — 无光标也要画)
    const noCaret = cursor.paragraphPath.length === 0
    if (noCaret && !this.columnResizeGuide) return

    ictx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0)
    ictx.clearRect(0, 0, viewportW / scale, viewportH / scale)
    // 页面居中: 与 content 层相同偏移
    ictx.translate(offsetX / scale, 0)

    if (!noCaret) {
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
        const caret = this.computeCaretPos(pool, cursor.paragraphPath, cursor.offset, pageVerticalGap, this.hfPreferredPage)
        if (caret) {
          ictx.fillStyle = asRgb(tokens.cursorColor)
          ictx.fillRect(caret.x, caret.y, 2, caret.h)
        }
      }
    }

    // --- 列宽拖拽参考线 (最上层 — 拖动中只读 guide, 不读 columns) ---
    if (this.columnResizeGuide) {
      this.renderColumnResizeGuide(this.columnResizeGuide, pageVerticalGap, ictx)
    }
  }

  /**
   * 单页内容层渲染 (页眉 / 正文 / 页脚 + 分隔线 + 编辑态蒙层)。
   *
   * 从 render() 的页循环里抽出来, 只为能给它套 safeRenderPage 做**逐页**容错:
   * 原先整段 inline, 任何一页抛错都会冒泡出 rAF 回调, 导致**整帧不画** ——
   * 其余页和光标一起没。抽出后出错只损失那一页。
   */
  private renderPageContent(
    ctx: CanvasRenderingContext2D,
    page: SLIFPage,
    pageIndex: number,
    pageY: number,
    pageWidth: number,
    pageHeight: number,
    contentWidth: number,
  ): void {
        const headerH = page.headerHeight ?? 42
        const footerH = page.footerHeight ?? 42
        const hasHeader = page.headerItems && page.headerItems.length > 0
        const hasFooter = page.footerItems && page.footerItems.length > 0

        const tokens = this.theme?.tokenSet ?? STANDARD_CANVAS_TOKENS

        // ================================================================
        // 页眉区域 + 分隔线
        // ================================================================
        // 分隔线 (页眉下方) — 0.5px细线, 浅灰
        this.drawHfSeparator(ctx, pageWidth, pageY + headerH)

        // 编辑模式: 激活区域用虚线边框标记
        if (this.hfEditActive && this.hfEditSection === 'header') {
          ctx.save()
          ctx.strokeStyle = asRgb(tokens.hfFocusRing)
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
          this.renderParticleItems(ctx, page.headerItems!, pageY, pageIndex)
          ctx.restore()
        }

        // --- 正文 ---
        for (const item of page.items) {
          safeRenderParticle(() => this.renderBodyItem(ctx, item, pageY, pageIndex, contentWidth, tokens), item.nodeId)
        }

        // ================================================================
        // 页眉页脚编辑模式遮罩层
        // ================================================================
        if (this.hfEditActive) {
          ctx.save()
          ctx.globalAlpha = 0.15
          ctx.fillStyle = withAlpha(tokens.hfMask, 0.15)
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
        this.drawHfSeparator(ctx, pageWidth, pageY + footerTop)

        // 编辑模式: 激活区域用虚线边框标记
        if (this.hfEditActive && this.hfEditSection === 'footer') {
          ctx.save()
          ctx.strokeStyle = asRgb(tokens.hfFocusRing)
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
          this.renderParticleItems(ctx, page.footerItems!, pageY + footerTop, pageIndex)
          ctx.restore()
        }
  }

  /**
   * 列宽拖拽参考线 (draw-time overlay, 契约 §7.2 交互态)
   *
   * 页面内逻辑坐标 → canvas Y 与内容层同源 (accumulatedHeightTo - scrollY),
   * 故 50% / 200% 缩放下参考线与渲染的列边界始终对齐。
   */
  private renderColumnResizeGuide(
    guide: { pageIndex: number; x: number; top: number; bottom: number },
    pageVerticalGap: number,
    ictx: CanvasRenderingContext2D,
  ): void {
    const pageY = accumulatedHeightTo(guide.pageIndex, this.pages, pageVerticalGap)
      - this.coordSystem.transform.scrollY
    const tokens = this.theme?.tokenSet ?? STANDARD_CANVAS_TOKENS
    ictx.save()
    ictx.strokeStyle = asRgb(tokens.selectionBorder)
    ictx.lineWidth = 1.5
    ictx.beginPath()
    ictx.moveTo(guide.x, pageY + guide.top)
    ictx.lineTo(guide.x, pageY + guide.bottom)
    ictx.stroke()
    ictx.restore()
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

    // 区域: 同 header/footer (含变体) 的选区 → 专用高亮 (每页独立 offset); 跨区/跨变体拒绝。
    // 同区判定复用 SelectionCollector 的区域身份 (单一事实源, 契约 §7.9)。
    const aLoc = resolveHfParagraphLocation(this.document, anchorParaId)
    if (regionIdOf(anchorParaId, this.document) !== regionIdOf(focusParaId, this.document)) return
    if (aLoc) {
      this.fillRegionSelection(pool, selection, aLoc.band, pageVerticalGap, ictx)
      return
    }

    // 展平 body → 阅读顺序 (契约 §31.3 W3: 表格展开为 cell 段落)。cell 段落不在
    // body.children, 若不展平, body↔table 跨域选区 indexOf=-1 被整体丢弃
    // (「全选/拖选选不中表格」)。
    const spine = this.document ? bodyParagraphSpine(this.document, pool) : []
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

    const tokens = this.theme?.tokenSet ?? STANDARD_CANVAS_TOKENS
    ictx.fillStyle = withAlpha(tokens.selectionBg, 0.2)

    // 当前文档滚动位置 — 直接读取, 与 computeCaretPos 同源
    const scrollY = this.coordSystem.transform.scrollY

    // 单个文本 run 的裁剪 + 填充: 基于 paraId 在 spine 中的索引与段内累计偏移
    // 计算是否落入 [lo,hi] 选区范围, 落入则按逐字符像素宽度裁剪后 fillRect。
    // 原子内联节点 (控件/图片/域等) 按「1 字符」计偏移 (与光标/命中同源), 并按整宽填充。
    const fillItem = (
      paraId: string,
      text: string,
      x: number, y: number, ascent: number, descent: number,
      fontCfg: { font: string; size: number; bold?: boolean; italic?: boolean },
      atomic = false, atomicW?: number,
    ): void => {
      const pi = spine.indexOf(paraId)
      if (pi < lo || pi > hi) return

      const itemStart = paraOffsets.get(paraId) ?? 0
      const tLen = text?.length || 0
      const unitLen = atomic ? 1 : tLen
      const itemEnd = itemStart + unitLen

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
      let localEnd = unitLen || 1  // 空段落占位至少 1 个单位宽度
      if (samePara) {
        localStart = Math.max(0, selMin - itemStart)
        localEnd = Math.min(unitLen, selMax - itemStart)
      } else if (pi === lo) {
        localStart = Math.max(0, (aIdx === lo ? anchorOff : focusOff) - itemStart)
        localEnd = unitLen || 1
      } else if (pi === hi) {
        localStart = 0
        localEnd = Math.min(unitLen || 1, (aIdx === hi ? anchorOff : focusOff) - itemStart)
      }

      paraOffsets.set(paraId, itemEnd)
      if (!include) return

      if (atomic) {
        // 原子节点: 部分覆盖即整块高亮 (与「非文本计 1」一致)
        if (localStart < localEnd) ictx.fillRect(x, y, atomicW ?? (ascent + descent), ascent + descent)
        return
      }

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
          let rowY = item.y + tableHeaderRowsHeight(item)
          for (const row of item.rows || []) {
            const rowHeight = Math.max(row.height || 24, 24)
            for (const c of row.cells) {
              const cellX = item.x + (c.x || 0)
              const cellY = spY + rowY
              for (const ci of c.items || []) {
                const paraId = this.findItemParagraph(ci.nodeId, pool)
                if (!paraId) continue
                const ciAtomic = ci.type === 'smarttext' || ci.type === 'image' ||
                  ci.type === 'field' || ci.type === 'cross_reference' || ci.type === 'footnote_ref'
                fillItem(
                  paraId, ci.text || '',
                  cellX + CELL_PAD + (ci.x || 0), cellY + (ci.y || 0),
                  ci.ascent, ci.descent,
                  { font: ci.font || 'SimSun', size: ci.size || 16, bold: ci.bold, italic: ci.italic },
                  ciAtomic, ci.width,
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
          // 正文段落: 顶级 item (smarttext 等原子节点按 1 字符计偏移, 整宽高亮)
          const paraId = this.findItemParagraph(item.nodeId, pool)
          if (!paraId) continue
          const atomic = item.type === 'smarttext' || item.type === 'field' ||
            item.type === 'cross_reference' || item.type === 'footnote_ref'
          fillItem(
            paraId, item.text || '',
            item.x, spY + item.y, item.ascent, item.descent,
            { font: item.font || 'SimSun', size: item.size || 16, bold: item.bold, italic: item.italic },
            atomic, item.width,
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

    const tokens = this.theme?.tokenSet ?? STANDARD_CANVAS_TOKENS
    ictx.fillStyle = withAlpha(tokens.selectionBg, 0.2)
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
        const isAtomic = item.type === 'smarttext' || item.type === 'image' ||
          item.type === 'field' || item.type === 'cross_reference' || item.type === 'footnote_ref'
        const tLen = isAtomic ? 1 : text.length
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

        if (isAtomic) {
          if (localStart < localEnd) ictx.fillRect(item.x, spY + bandTop + item.y, item.width, item.ascent + item.descent)
          continue
        }
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

    const tokens = this.theme?.tokenSet ?? STANDARD_CANVAS_TOKENS
    ictx.save()
    ictx.fillStyle = withAlpha(tokens.selectionBgCell, 0.16)
    ictx.strokeStyle = withAlpha(tokens.selectionBorder, 0.85)
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
        let rowY = item.y + tableHeaderRowsHeight(item)
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
    const tokens = this.theme?.tokenSet ?? STANDARD_CANVAS_TOKENS
    ictx.save()
    ictx.fillStyle = withAlpha(tokens.selectionBorder, 0.10) // primary-600 @ 10%
    ictx.strokeStyle = asRgb(tokens.selectionBorder)        // primary-600
    ictx.lineWidth = 1.5
    ictx.setLineDash([5, 3])

    const scrollY = this.coordSystem.transform.scrollY

    // 优先页在前: 页眉/页脚控件每页都有副本, 取首个命中会恒落第 0 页 (契约 §7.9)
    for (const i of this.pageOrder(this.hfPreferredPage)) {
      const page = this.pages[i]
      if (!page) continue
      const spY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY
      for (const { item, bandTop } of this.controlCandidatesForNode(page, nodeId)) {
        // 选中框须与 ControlParticle 的控件视觉盒同源几何 (computeControlBox, 单一事实源) —
        // 历史 bug: 两处各算各的几何, 且把 item.y (行顶) 当基线, 选中框与控件盒/光标错位。
        const fontSize = item.size || 16
        const ascent = item.ascent > 0 ? item.ascent : fontSize * 0.8
        const descent = item.descent > 0 ? item.descent : fontSize * 0.2
        const layoutW0 = (item.width || 0) - (item.markerWidth || 0)
        const lt0 = this.controlLeadTrail(nodeId, item.font || 'SimSun', item.size || 16, item.bold, item.italic)
        const box = computeControlBox(item.x + lt0.lead, spY + bandTop + item.y, Math.max(0, layoutW0 - lt0.lead - lt0.trail), ascent, descent, this.presentationStyleOf(nodeId)?.minWidth)
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

  /**
   * 渲染单个**正文** SLIFItem (separator / image / footnote / table / 文本·域·控件)。
   *
   * 屏幕画布 (render) 与打印离屏 (renderPageToContext) 共用同一分派 — 契约 §4:
   * 打印是渲染管线的投影, 不得有第二个渲染器或第二份域代码解析。
   * @param separatorContentWidth separator 粒子的可用宽 (两处调用方取值不同, 故由调用方传入)
   * @param showInvisible 覆盖不可见字符显示 — 打印必须强制 false (编辑标记不进打印稿);
   *                      缺省跟随屏幕设置
   */
  private renderBodyItem(
    ctx: CanvasRenderingContext2D,
    item: SLIFItem,
    pageY: number,
    pageIndex: number,
    separatorContentWidth: number,
    tokens: CanvasTokenSet | null,
    showInvisible: boolean = this._showInvisible,
  ): void {
    if (item.type === 'separator') {
      const sepRenderer = particleRegistry.get('separator')
      if (sepRenderer) {
        sepRenderer.render(ctx, item, item.x, pageY + item.y, { contentWidth: separatorContentWidth, tokenSet: tokens ?? undefined })
      }
    } else if (item.type === 'image') {
      this.imageParticle.render(ctx, item, item.x, pageY + item.y, { tokenSet: tokens ?? undefined })
    } else if (item.type === 'footnote') {
      // 脚注引用: 上标编号 (R31)
      const fp = createFootnoteParticle()
      fp.render(ctx, item, item.x, pageY + item.y, {
        pageIndex, totalPages: this.pages.length,
        tokenSet: tokens ?? undefined,
      })
    } else if (item.type === 'table') {
      // 表格渲染 (R37) — cell 内 smarttext 经 TableParticle 委托 registry (§4)
      const tp = createTableParticle()
      tp.render(ctx, item, item.x, pageY + item.y, {
        showInvisible,
        pageIndex,
        presentationStyleOf: this.presentationStyleOf,
        templateDefinitionOf: this.templateDefinitionOf,
        elementOf: this.elementOf,
        controlValueOf: this.controlValueOf,
        activeControlId: this.activeControlNodeId,
        tokenSet: tokens ?? undefined,
      })
    } else {
      // 文本/域代码/控件 — 通过 ParticleRegistry 调度 (含列表标记)
        const textRenderer = particleRegistry.get(item.nodeType || item.type) || particleRegistry.get('text')
      if (textRenderer) {
        textRenderer.render(ctx, { ...item, text: this.resolveFieldText(item, pageIndex) }, item.x, pageY + item.y, {
          showInvisible,
          pageIndex,
          presentationStyleOf: this.presentationStyleOf,
          templateDefinitionOf: this.templateDefinitionOf,
          elementOf: this.elementOf,
          controlValueOf: this.controlValueOf,
          activeControlId: this.activeControlNodeId,
          tokenSet: tokens ?? undefined,
        })
      }
    }
  }

  /** 页眉/页脚带分隔线 (0.5px 浅灰) — 屏幕渲染与打印同源 */
  private drawHfSeparator(ctx: CanvasRenderingContext2D, pageWidth: number, y: number): void {
    const tokens = this.theme?.tokenSet ?? STANDARD_CANVAS_TOKENS
    ctx.strokeStyle = asRgb(tokens.hfDivider)
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(pageWidth, y)
    ctx.stroke()
  }

  /**
   * 渲染 SLIFItem[] — 页眉/页脚/正文共用 (TASK-470)
   * @param showInvisible 覆盖不可见字符显示 (打印强制 false); 缺省跟随屏幕设置
   */
  private renderParticleItems(
    ctx: CanvasRenderingContext2D,
    items: SLIFItem[],
    pageY: number,
    pageIndex: number,
    showInvisible: boolean = this._showInvisible,
  ): void {
    const tokens = this.theme?.tokenSet ?? null
    for (const item of items) {
      // 按**节点**兜错 (ErrorRecovery Level 1): 单个节点渲染失败只丢它自己,
      // 不让整帧渲染中断 —— 渲染路径此前完全没有 try/catch。
      safeRenderParticle(
        () => this.renderOneItem(ctx, item, pageY, pageIndex, showInvisible, tokens),
        item.nodeId,
      )
    }
  }

  /** 渲染单个 item (页眉/页脚/正文共用); 由 renderParticleItems 逐项安全包裹 */
  private renderOneItem(
    ctx: CanvasRenderingContext2D,
    item: SLIFItem,
    pageY: number,
    pageIndex: number,
    showInvisible: boolean,
    tokens: CanvasTokenSet | null,
  ): void {
    if (item.type === 'image') {
      const imgUrl = this.resolveImageUrl(item)
      if (imgUrl) {
        this.renderImage(ctx, imgUrl, item.x, pageY + item.y, item.width, item.height, tokens)
      }
      return
    }
    // 文本/域代码 — 通过 Registry 调度 (含列表标记)
    const textRenderer = particleRegistry.get(item.nodeType || item.type)
    if (textRenderer) {
      textRenderer.render(ctx, { ...item, text: this.resolveFieldText(item, pageIndex) }, item.x, pageY + item.y, {
        showInvisible,
        pageIndex,
        presentationStyleOf: this.presentationStyleOf,
        templateDefinitionOf: this.templateDefinitionOf,
        elementOf: this.elementOf,
        controlValueOf: this.controlValueOf,
        activeControlId: this.activeControlNodeId,
        tokenSet: tokens ?? undefined,
      })
    }
  }

  // ================================================================
  // 公开 API
  // ================================================================

  getCoordinateSystem(): CoordinateSystem { return this.coordSystem }
  getHitTestIndex(): HitTestIndex { return this.hitTestIndex }
  getPages(): SLIFPage[] { return this.pages }
  /**
   * 段落 id → 页下标 (0-based) —— 供 UI 显示"目标在第几页"(书签/交叉引用目标列表)。
   * 未布局 / 段落不在任何页 → undefined。
   */
  getParagraphPageIndex(paraId: string): number | undefined {
    return this.layoutEngine.getParaPageMap().get(paraId)
  }
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

    const caret = this.computeCaretPos(pool, cursor.paragraphPath, cursor.offset, pageVerticalGap, this.hfPreferredPage)
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
  /** 控件附属字面量 (label/prefix/suffix) 的内联占位 (lead/trail) — 与布局/渲染同源 */
  private controlLeadTrail(nodeId: string, fontFamily: string, fontSize: number, bold?: boolean, italic?: boolean): { lead: number; trail: number } {
    const def = this.templateDefinitionOf?.(nodeId)
    const m = (t: string) => this.measurer.measureWidth(t, { font: fontFamily, size: fontSize, bold, italic })
    return controlInlineLeadTrail(def, m)
  }

  /** 某页内 nodeId 的控件布局项(正文展平 + 页眉 + 页脚), 附带页面顶部偏移 bandTop */
  private controlCandidatesForNode(page: SLIFPage, nodeId: string): Array<{ item: SLIFItem; bandTop: number }> {
    const out: Array<{ item: SLIFItem; bandTop: number }> = []
    for (const item of getFlatPageItems(page)) {
      if (item.nodeId === nodeId && item.nodeType === 'smarttext') out.push({ item, bandTop: 0 })
    }
    for (const item of page.headerItems ?? []) {
      if (item.nodeId === nodeId && item.nodeType === 'smarttext') out.push({ item, bandTop: 0 })
    }
    const footerTop = page.height - (page.footerHeight ?? 42)
    for (const item of page.footerItems ?? []) {
      if (item.nodeId === nodeId && item.nodeType === 'smarttext') out.push({ item, bandTop: footerTop })
    }
    return out
  }

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

    // 优先页在前: 页眉/页脚控件每页都有副本, 取首个命中会恒落第 0 页 (契约 §7.9)
    for (const i of this.pageOrder(this.hfPreferredPage)) {
      const page = this.pages[i]
      if (!page) continue
      const spY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY
      for (const { item, bandTop } of this.controlCandidatesForNode(page, nodeId)) {
        const fontSize = item.size || 16
        const ascent = item.ascent > 0 ? item.ascent : fontSize * 0.8
        const descent = item.descent > 0 ? item.descent : fontSize * 0.2
        const layoutW0 = (item.width || 0) - (item.markerWidth || 0)
        const lt0 = this.controlLeadTrail(nodeId, item.font || 'SimSun', item.size || 16, item.bold, item.italic)
        const box = computeControlBox(item.x + lt0.lead, spY + bandTop + item.y, Math.max(0, layoutW0 - lt0.lead - lt0.trail), ascent, descent, this.presentationStyleOf(nodeId)?.minWidth)
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
   * 表格整块客户区矩形 (契约 §12.9) —— 供填写态在表尾挂「+ 添加行」入口。
   *
   * 跨页表在每页各有一个 item (LayoutEngine.createTableItemFromFragment),
   * 取**最后一页**的那个 —— 追加行发生在表尾。坐标转换与
   * getControlClientRect 同源, 不另立一套。
   */
  getTableClientRect(
    tableId: string,
  ): { left: number; top: number; width: number; height: number } | null {
    if (this.pages.length === 0) return null

    const viewportW = this.host.viewport.size().width
    const scale = this.coordSystem.transform.scale
    const pageWidth = this.pages[0]?.width || 794
    const visiblePageW = pageWidth * scale
    const offsetX = Math.max(0, (viewportW - visiblePageW) / 2)
    const pageVerticalGap = this.renderer.getPageVerticalGap()
    const scrollY = this.coordSystem.transform.scrollY
    const surface = this.renderer.getInteractSurface()
    const canvasRect = surface?.getBoundingClientRect() ?? { left: 0, top: 0 }

    let box: { x: number; y: number; width: number; height: number } | null = null
    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]
      if (!page) continue
      // 必须遍历 page.items 本体: getFlatPageItems 明确**剔除表格容器 item**
      // (只展平 cell 内嵌项), 用展平列表永远匹配不到表。
      for (const item of page.items) {
        if (item.nodeId !== tableId || item.nodeType !== 'table') continue
        const spY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY
        box = { x: item.x, y: spY + item.y, width: item.width, height: item.height }
      }
    }
    if (!box) return null

    return {
      left: canvasRect.left + box.x * scale + offsetX,
      top: canvasRect.top + box.y * scale,
      width: box.width * scale,
      height: box.height * scale,
    }
  }

  /**
   * Section 在视口中的**分段**矩形 —— 每个它触及的页一段 (契约 §31.14)。
   *
   * 为什么分段而不是一个框: Section 可以跨页断开, 取各页并集会把页间隙也框进去
   * (视觉错误)。故按页分组返回, 叠加层每页画一段线/框。
   *
   * 为什么取"后代 item 的并集": Section 被 W2 就地展开, **不产出任何属于它自己的
   * SLIF item** —— 它没有几何。但它有后代, 后代有 item, 并集就是它的跨度。
   *
   * 后代集必须**含内联节点 id**: 段落文本 item 的 `nodeId` 是内联节点
   * (text/smarttext/field/…) 的 id, 只有**空段落**的占位 item 才用段落 id
   * (LayoutEngine 的两条产出路径)。
   *
   * 扫描必须**两处都扫**: `page.items` (表格容器 item 在这里) +
   * `getFlatPageItems(page)` (cell 内嵌项在这里, 且该函数明确剔除表格容器)。
   *
   * 归属必须**向祖先链累加**: 取"最近节"只能画出最内层, 外层节会留下空洞,
   * 嵌套时明显错。故每个 item 归属到最近节后, 再沿 R1 链累加到每个祖先。
   *
   * 空 Section (无后代) 没有 item —— 返回 [] 是诚实结果 (没有内容就没有跨度)。
   */
  getAllSectionClientRects(): Map<string, SectionPageRect[]> {
    const result = new Map<string, SectionPageRect[]>()
    const pool = this.pool
    const doc = this.document
    if (!pool || !doc || this.pages.length === 0) return result

    // 1. 目标节集合 (W4, 前序) + 每个节的祖先链 (R1 上溯, 记忆化)
    const sectionOrder = sectionsOf(doc, pool)
    if (sectionOrder.length === 0) return result
    const chainOf = (sectionId: string): string[] => {
      const cached = chainCache.get(sectionId)
      if (cached) return cached
      const chain: string[] = [sectionId]
      let cur = sectionId
      for (;;) {
        const parent = sectionOf(cur, pool)
        if (!parent || chain.includes(parent)) break
        chain.push(parent)
        cur = parent
      }
      chainCache.set(sectionId, chain)
      return chain
    }
    const chainCache = new Map<string, string[]>()

    // 2. 逐页扫 item; 每个 item 归属最近节, 再累加到祖先链上的每个节
    const viewportW = this.host.viewport.size().width
    const scale = this.coordSystem.transform.scale
    const pageWidth = this.pages[0]?.width || 794
    const offsetX = Math.max(0, (viewportW - pageWidth * scale) / 2)
    const pageVerticalGap = this.renderer.getPageVerticalGap()
    const scrollY = this.coordSystem.transform.scrollY
    const surface = this.renderer.getInteractSurface()
    const canvasRect = surface?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const marginLeft = doc.pageSetup?.marginLeft ?? 90
    const marginRight = doc.pageSetup?.marginRight ?? 90

    // 每 (nodeId) → 最近节 的记忆表 (同一内联节点在一页内被多个 item 共用)
    const ownerOf = new Map<string, string | null>()

    type Ink = { top: number; bottom: number; left: number; right: number }
    const inkOf = new Map<string, Map<number, Ink>>() // sectionId → pageIndex → ink

    const accumulate = (nodeId: string, pageIndex: number, ink: Ink): void => {
      let owner = ownerOf.get(nodeId)
      if (owner === undefined) {
        owner = sectionOf(nodeId, pool)
        ownerOf.set(nodeId, owner)
      }
      if (!owner) return
      for (const sectionId of chainOf(owner)) {
        let perPage = inkOf.get(sectionId)
        if (!perPage) { perPage = new Map(); inkOf.set(sectionId, perPage) }
        const prev = perPage.get(pageIndex)
        if (!prev) { perPage.set(pageIndex, { ...ink }); continue }
        if (ink.top < prev.top) prev.top = ink.top
        if (ink.bottom > prev.bottom) prev.bottom = ink.bottom
        if (ink.left < prev.left) prev.left = ink.left
        if (ink.right > prev.right) prev.right = ink.right
      }
    }

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]
      if (!page) continue
      for (const item of page.items) {
        accumulate(item.nodeId, i, {
          top: item.y, bottom: item.y + (item.height || 0),
          left: item.x, right: item.x + (item.width || 0),
        })
      }
      // getFlatPageItems 展平 cell 内嵌项 (表格容器 item 不在其中, 故两处都要扫)
      for (const item of getFlatPageItems(page)) {
        accumulate(item.nodeId, i, {
          top: item.y, bottom: item.y + (item.height || 0),
          left: item.x, right: item.x + (item.width || 0),
        })
      }
    }

    // 3. 换算为视口 client 坐标 (与 getTableClientRect 同源变换)
    for (const [sectionId, perPage] of inkOf) {
      const rects: SectionPageRect[] = []
      for (const [pageIndex, ink] of [...perPage.entries()].sort((a, b) => a[0] - b[0])) {
        const spY = accumulatedHeightTo(pageIndex, this.pages, pageVerticalGap) - scrollY
        rects.push({
          pageIndex,
          left: canvasRect.left + ink.left * scale + offsetX,
          top: canvasRect.top + (spY + ink.top) * scale,
          width: (ink.right - ink.left) * scale,
          height: (ink.bottom - ink.top) * scale,
          // 正文栏左右缘 — 供叠加层画左侧竖线 (取自 pageSetup 页边距, 不随段落
          // 缩进/对齐漂移; 段落 item.x 含 indent, 不能用它当栏缘)
          contentLeft: canvasRect.left + marginLeft * scale + offsetX,
          contentRight: canvasRect.left + (pageWidth - marginRight) * scale + offsetX,
        })
      }
      if (rects.length > 0) result.set(sectionId, rects)
    }
    return result
  }

  /**
   * 单个 Section 的分段矩形 (取 getAllSectionClientRects 的子集)。
   * 空节返回 [] —— 空节没有内容跨度, 这是诚实结果而非缺陷。
   */
  getSectionClientRects(sectionId: string): SectionPageRect[] {
    return this.getAllSectionClientRects().get(sectionId) ?? []
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
    /** 框内文本可用宽 (契约 §12.8): 编辑面贴宽到此为止, 超出即折行 */
    availableWidth: number
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

    // 优先页在前: 页眉/页脚控件每页都有副本, 取首个命中会恒落第 0 页 (契约 §7.9)
    for (const i of this.pageOrder(this.hfPreferredPage)) {
      const page = this.pages[i]
      if (!page) continue
      const spY = accumulatedHeightTo(i, this.pages, pageVerticalGap) - scrollY
      for (const { item, bandTop } of this.controlCandidatesForNode(page, nodeId)) {

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

        const lt2 = this.controlLeadTrail(nodeId, fontFamily, fontSize, item.bold, item.italic)
        const region = computeFieldRegion({
          controlType: def?.controlType,
          lineLeft: item.x + lt2.lead,
          lineTop: spY + bandTop + item.y,
          layoutWidth: Math.max(0, ((item.width || 0) - (item.markerWidth || 0)) - lt2.lead - lt2.trail),
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
          // 画布主题 token — RuntimeControlOverlay DOM 文本/光标色 (与 ControlParticle 同源 tokenSet)
          ...(() => {
            const ovTokens = this.theme?.tokenSet ?? STANDARD_CANVAS_TOKENS
            const ovPlaceholder = asRgb(ovTokens.placeholder)
            const ovFallbackInk = asRgb(ovTokens.fallbackInk)
            return {
              color: masked ? ovPlaceholder : (empty ? ovPlaceholder : (item.color || ovFallbackInk)),
              caretColor: ovFallbackInk,
            }
          })(),
          placeholderText: stripPlaceholderBrackets(node.text || ''),
          empty,
          writable,
          masked,
          minRows: el?.format?.minRows,
          // 框内文本可用宽 (契约 §12.8): 布局裁决的折行宽 = overlay 编辑面上限
          availableWidth: item.wrapWidth ?? region.contentW,
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

  /** 设置/清除数字水印 (R35); 传 null 清除 (换到无水印文档时用) */
  setWatermark(config: WatermarkConfig | null): void {
    this.renderer.prepareWatermark(config)
  }

  /** 域代码动态值计算 (TASK-471) */
  /** 域代码显示文本 — 委托 document 域纯函数, 注入本渲染器的时间/页面事实 */
  private resolveFieldText(item: { fieldType?: string; text?: string }, pageIndex: number): string {
    return formatFieldText(item.fieldType, item.text, {
      pageNumber: pageIndex + 1,
      totalPages: this.pages.length,
      documentTitle: this.document?.title,
      now: new Date(),
      // 每次渲染现读 —— 语言可变, 缓存会把格式冻在首次渲染那一刻
      locale: locale.getLocale(),
    })
  }

  /** 不可见字符显示 (TASK-475) */
  get showInvisible(): boolean { return this._showInvisible }
  set showInvisible(v: boolean) { this._showInvisible = v }
  get showRevisionMarks(): boolean { return this._showRevisionMarks }
  set showRevisionMarks(v: boolean) { this._showRevisionMarks = v }

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
    tokens: CanvasTokenSet | null,
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
    const t = tokens ?? this.theme?.tokenSet ?? STANDARD_CANVAS_TOKENS
    ctx.save()
    ctx.fillStyle = asRgb(t.imagePlaceholder)
    ctx.fillRect(x, y, width, height)
    ctx.strokeStyle = asRgb(t.imagePlaceholderBorder)
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

  /** 激活/关闭页眉页脚编辑模式 (pageIndex 缺省保持原钉子) */
  setHeaderFooterEditActive(active: boolean, section?: 'header' | 'footer', pageIndex?: number): void {
    this.hfEditActive = active
    if (section) this.hfEditSection = section
    if (pageIndex !== undefined) this.hfEditPageIndex = Math.max(0, Math.floor(pageIndex))
  }

  /** 当前编辑目标页下标 (0-based) */
  getHeaderFooterEditPageIndex(): number { return this.hfEditPageIndex }
  /** 重钉编辑目标页 */
  setHeaderFooterEditPage(pageIndex: number): void {
    this.hfEditPageIndex = Math.max(0, Math.floor(pageIndex))
  }

  /**
   * 当前可见的首个页面下标 — 派生值, 不新增 scroll 事实源
   * (与 render() 同源: getVisiblePages(scrollY, viewportH / scale))。
   * 供"进入页眉页脚编辑时默认钉在正在看的那页"。
   */
  getActivePageIndex(): number {
    if (this.pages.length === 0) return 0
    const scale = this.coordSystem.transform.scale || 1
    const viewportH = this.host.viewport.size().height
    const { start } = this.layoutEngine.getVisiblePages(
      this.coordSystem.transform.scrollY, viewportH / scale,
    )
    return Math.min(Math.max(0, start), this.pages.length - 1)
  }

  /**
   * 页遍历顺序 — 优先页在前, 其余按自然序补足。
   * 页眉/页脚段落每页都有副本, 「取首个命中」会恒落第 0 页; 用优先页纠正
   * (契约 §7.9)。preferred 越界时退化为自然序。
   */
  private pageOrder(preferred?: number): number[] {
    const n = this.pages.length
    const out: number[] = []
    const hasPreferred = preferred !== undefined && preferred >= 0 && preferred < n
    if (hasPreferred) out.push(preferred!)
    for (let i = 0; i < n; i++) {
      if (i !== (hasPreferred ? preferred : -1)) out.push(i)
    }
    return out
  }

  /** 页眉页脚编辑期的优先页 (非编辑态 → undefined, 保持原行为) */
  private get hfPreferredPage(): number | undefined {
    return this.hfEditActive ? this.hfEditPageIndex : undefined
  }

  /**
   * 渲染单个 SLIF 页面到离屏 Canvas 上下文 (用于打印)。
   *
   * 与屏幕渲染 (render) 同源 — 契约 §4/§12: 打印是渲染管线的投影, 必须包含
   * 页眉 + 页脚, 并复用粒子管线 (域代码逐页解析 / 控件 presentation 上下文)。
   * 页面局部坐标 (item.y 相对页顶; 页眉项 y 相对页顶=带顶, 页脚项 y 相对带顶)。
   */
  renderPageToContext(ctx: CanvasRenderingContext2D, page: SLIFPage, pageWidth: number): void {
    // 离屏整页渲染: 这里刻意**不给** rect —— 整张 canvas 就是这一页, 占满整张是对的。
    // (屏幕多页画布那条路必须给 rect, 见 renderPageContent 的调用点)
    safeRenderPage(() => this.paintPage(ctx, page, pageWidth), page.pageIndex, ctx)
  }

  /** 整页绘制本体 (打印离屏)。拆出来只为让 safeRenderPage 能兜住它。 */
  private paintPage(ctx: CanvasRenderingContext2D, page: SLIFPage, pageWidth: number): void {
    const pageIndex = page.pageIndex
    const headerH = page.headerHeight ?? 42
    const footerTop = page.height - (page.footerHeight ?? 42)

    // --- 页眉 + 分隔线 ---
    if (page.headerItems && page.headerItems.length > 0) {
      this.renderParticleItems(ctx, page.headerItems, 0, pageIndex, false)
    }
    this.drawHfSeparator(ctx, pageWidth, headerH)

    // --- 批注高亮: 必须在正文之前画 (同一 ctx 上文字会盖住它), 契约 §12.2 ---
    this.drawCommentHighlightsForPage(ctx, page, 0, this.theme?.tokenSet ?? null)

    // --- 正文 (含表格/脚注; separator 可用宽与旧打印行为保持一致) ---
    for (const item of page.items) {
      safeRenderParticle(
        () => this.renderBodyItem(ctx, item, 0, pageIndex, pageWidth - item.x - 90, this.theme?.tokenSet ?? null, false),
        item.nodeId,
      )
    }

    // --- 页脚分隔线 + 页脚 ---
    this.drawHfSeparator(ctx, pageWidth, footerTop)
    if (page.footerItems && page.footerItems.length > 0) {
      this.renderParticleItems(ctx, page.footerItems, footerTop, pageIndex, false)
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
