import type { DocumentTree, BaseNode, Paragraph, TextNode } from './document/DocumentModel'
import { createDocument, createParagraph, createTextNode, extractStyle, createFieldNode, createSeparatorNode, createFootnoteRef, createFootnoteContent, createSmartTextNode } from './document/ElementFormatter'
import { NodePool, buildNodePool } from './document/NodePool'
import { buildDocumentPool, serializeDocument } from './document/DocumentSerializer'
import type { FieldType } from './document/DocumentModel'
import { Draw } from './render/Draw'
import { AutoSaveManager } from './AutoSaveManager'
import { AutoCorrectEngine } from './AutoCorrectEngine'
import { PerformanceMetrics } from './PerformanceMetrics'
import { PluginManager } from './plugins/PluginManager'
import { EventBus } from './interaction/EventBus'
import { CommandManager } from './command/CommandManager'
import { InputComposer } from './interaction/IMEHandler'
import { KeyboardHandler } from './interaction/KeyboardHandler'
import { MouseHandler } from './interaction/MouseHandler'
import type { ICommand } from './command/ICommand'
import { generateCommandId } from './command/ICommand'
import { InsertTextCommand } from './command/commands/InsertTextCommand'
import { InsertNodesCommand } from './command/commands/InsertNodesCommand'
import { DeleteRangeCommand } from './command/commands/DeleteRangeCommand'
import { FormatTextCommand } from './command/commands/FormatTextCommand'
import { ClearFormatCommand } from './command/commands/FormatTextCommand'
import { FormatPainterCommand } from './command/commands/FormatTextCommand'
import { ParagraphStyleCommand } from './command/commands/ParagraphStyleCommand'
import { MergeParagraphCommand } from './command/commands/MergeParagraphCommand'
import { ClipboardManager } from './command/ClipboardManager'
import { EditorStore } from './state/EditorStore'
import type { EditorRuntimeState } from './state/EditorRuntimeState'
import { FindReplaceEngine } from './FindReplaceEngine'
import type { FindOptions, MatchResult } from './FindReplaceEngine'
import { cumulativeCharWidths, findCharIndexAtX } from './layout/text/CharWidthHelper'
import { resolveCellPosition } from './state/CaretScope'
import { screenToDoc, findPageByDocY, pageCenteringOffset } from './layout/table/TableCoordUtil'
import { insertRow, deleteRow, insertColumn, deleteColumn, getCellGridPosition, buildCellGrid, normalizeRange } from './document/TableOps'
import type { CellRange } from './document/TableOps'
import { createTableCell } from './document/ElementFormatter'

/** 辅助: 绕开 Readonly 直接写 store._state.runtime.cursor */
type StoreInternal = { _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean } } } }

function setCursor(store: EditorStore, path: string[], offset: number): void {
  const si = store as unknown as StoreInternal
  si._state.runtime.cursor = { paragraphPath: path, offset, visible: true }
}

export class Editor {
  private container: HTMLElement
  private doc: DocumentTree
  private pool: NodePool
  private draw: Draw
  private eventBus: EventBus
  private commandManager: CommandManager
  private store: EditorStore
  private inputComposer: InputComposer
  private keyboardHandler: KeyboardHandler
  private mouseHandler: MouseHandler
  private clipboard: ClipboardManager
  private findReplace: FindReplaceEngine
  private autoSave: AutoSaveManager
  private autoCorrect: AutoCorrectEngine
  private perfMetrics: PerformanceMetrics
  private pluginManager: PluginManager
  private _formatPainterStyle: Record<string, unknown> | null = null
  // 表格单元格选择
  private _selectedTableId: string | null = null
  private _selectedCellRow = -1
  private _selectedCellCol = -1
  // 单元格框选范围 (网格坐标)
  private _cellRange: CellRange | null = null
  private listeners: EditorListener[] = []
  private _clickToFocus: (e: MouseEvent) => void
  private _onWindowFocus: () => void
  private _onVisibilityChange: () => void

  constructor(container: HTMLElement, doc?: DocumentTree) {
    this.container = container
    // 创建默认空文档
    if (!doc) {
      const d = createDocument('未命名文档')
      const para = createParagraph()
      d.body.children = [para.id]
      doc = d
      const allNodes = new Map<string, BaseNode>()
      allNodes.set(d.id, d)
      allNodes.set(para.id, para)
      this.doc = doc
      this.pool = buildNodePool(allNodes, { body: d.id })
    } else {
      this.doc = doc
      this.pool = buildDocumentPool(doc)
    }

    this.eventBus = new EventBus()
    this.draw = new Draw(container, this.eventBus, this.doc)
    this.store = new EditorStore(this.doc)
    this.inputComposer = new InputComposer(container)
    this.keyboardHandler = new KeyboardHandler(this, container)
    this.mouseHandler = new MouseHandler(this, container)
    this.clipboard = new ClipboardManager()
    this.findReplace = new FindReplaceEngine()
    this.autoSave = new AutoSaveManager(doc.id, doc.title || '未命名文档', () => this.getSerializedDocument())
    this.autoCorrect = new AutoCorrectEngine()
    this.perfMetrics = new PerformanceMetrics()
    this.pluginManager = new PluginManager()
    // 自动保存: 保存状态同步到 EditorStore
    this.autoSave.onSave((type) => {
      if (type === 'saving') this.store.setSaveStatus('saving')
      else if (type === 'saved') this.store.setSaveStatus('saved')
      else if (type === 'error') this.store.setSaveStatus('error')
    })
    // 初始化 IndexedDB (异步, 不阻塞构造函数)
    this.autoSave.init().catch(err => console.warn('[AutoSave] IndexedDB init failed:', err))
    this.commandManager = new CommandManager(
      this.eventBus,
      () => this.doc,
      () => this.pool,
    )

    // 状态变更 → 仅更新 Store, 不渲染
    // 渲染统一由 document:changed 在 recomputeLayout 后触发
    // 确保 render() 始终使用最新的 SLIF 布局 + 最新的光标状态
    this.eventBus.on('state:changed', (patch) => {
      if (patch.cursor) this.store.updateRuntime({ cursor: { ...this.store.state.runtime.cursor, ...patch.cursor, visible: true } })
      if (patch.selection) this.store.updateRuntime({ selection: { ...this.store.state.runtime.selection, ...patch.selection } })
      this.store.setDirty(true)
    })

    // document:changed → 重布局 + 重绘 + 自动保存标记 + 工具栏同步 (唯一渲染入口)
    this.eventBus.on('document:changed', (payload: { invalidation: import('./command/ICommand').InvalidationScope }) => {
      this.commitDocumentChange(payload.invalidation)
    })

    // render:request (undo/redo 等) → 使用当前的 pool 和 state
    this.eventBus.on('render:request', () => {
      this.draw.recomputeLayout(this.pool)
      this.draw.render(this.pool, this.store.state.runtime)
    })

    // ---- 初始化 ----

    // IME 输入法: compositionstart → 更新候选窗位置
    this.inputComposer.onCompositionStart(() => {
      const rect = this.draw.getCaretClientRect(this.pool, this.store.state.runtime)
      if (rect) this.inputComposer.updateCursorRect(rect)
    })

    // IME 输入法: compositionupdate → 跟随光标移动
    this.inputComposer.onCompositionUpdate((_text) => {
      const rect = this.draw.getCaretClientRect(this.pool, this.store.state.runtime)
      if (rect) this.inputComposer.updateCursorRect(rect)
    })
    this.inputComposer.onCompositionEnd((text) => {
      let cursor = this.store.state.runtime.cursor
      // 空文档 → 自动创建段落 (与 KeyboardHandler 保持一致)
      if (cursor.paragraphPath.length === 0) {
        const para = createParagraph()
        this.pool.nodes.set(para.id, para)
        this.doc.body.children = [para.id]
        const path: string[] = [this.doc.id, para.id]
        setCursor(this.store, path, 0)
        cursor = this.store.state.runtime.cursor
      }
      // 获取光标处文本样式 (段尾回退到末尾节点)
      let activeStyle: import('./document/DocumentModel').TextStyle | undefined
      const resolved = this.pool.resolveCharOffset(cursor.paragraphPath[cursor.paragraphPath.length - 1], cursor.offset)
      if (resolved) {
        const tn = this.pool.nodes.get(resolved.textNodeId) as unknown as Record<string, unknown> | undefined
        if (tn) activeStyle = extractStyle(tn as unknown as import('./document/DocumentModel').TextNode)
      } else {
        const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
        const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
        if (para?.children) {
          for (let i = para.children.length - 1; i >= 0; i--) {
            const n = this.pool.nodes.get(para.children[i]) as { type?: string } | undefined
            if (n?.type === 'text') { activeStyle = extractStyle(n as unknown as import('./document/DocumentModel').TextNode); break }
          }
        }
      }

      const cmd = new InsertTextCommand(
        generateCommandId(), Date.now(), 'user',
        cursor.paragraphPath, cursor.offset, text, activeStyle,
      )
      this.commandManager.execute(cmd)

      // 自动更正检查 (R43): IME 输入后检测光标前文本是否需要替换
      this.applyAutoCorrect(cursor.paragraphPath)
    })

    // 初始布局 + 首帧渲染
    this.draw.recomputeLayout(this.pool)

    // 初始化光标 — 必须在 render() 之前, 确保首帧即绘制光标
    const cursorPath = this.doc.body.children.length > 0
      ? [this.doc.id, this.doc.body.children[0]]
      : []
    setCursor(this.store, cursorPath, 0)

    this.draw.render(this.pool, this.store.state.runtime)

    // 启动光标闪烁 — 首次渲染后, 光标已在 interact 层绘制
    this.draw.renderer.setRenderCallback(() => {
      this.draw.render(this.pool, this.store.state.runtime)
    })
    this.draw.renderer.startCursorBlink(this.store.state.runtime)

    // 注册演示插件 (验证 PluginManager 系统)
    this.pluginManager.register({
      id: 'emr.demo',
      name: 'Demo Plugin',
      version: '1.0.0',
      enabled: true,
      install: (ctx) => { console.debug('[Plugin:demo] installed', ctx) },
      enable: () => { console.debug('[Plugin:demo] enabled') },
      disable: () => { console.debug('[Plugin:demo] disabled') },
      destroy: () => { console.debug('[Plugin:demo] destroyed') },
    })

    // 点击容器 → 命中检测 + 更新光标 + 聚焦
    // 若刚结束拖拽则跳过, 避免覆盖选区
    this._clickToFocus = (e: MouseEvent) => {
      this.inputComposer.focus()
      if (this.mouseHandler.wasDragging()) return
      this.handleClick(e)
    }
    container.addEventListener('click', this._clickToFocus)

    // 外部剪贴板同步: 用户切到外部应用复制后回到编辑器,
    // 焦点/可见性变化时读取系统剪贴板, 覆盖内存里的旧数据。
    this._onWindowFocus = () => { this.syncExternalClipboard() }
    this._onVisibilityChange = () => {
      if (document.visibilityState === 'visible') this.syncExternalClipboard()
    }
    window.addEventListener('focus', this._onWindowFocus)
    document.addEventListener('visibilitychange', this._onVisibilityChange)

    // 格式刷 mouseup: 拖拽选区预览后松手应用格式 (优于 click 因为 mouseup 先触发)
    container.addEventListener('mouseup', this._onMouseUp)

    this.notifyListeners('ready')
  }

  /** 获取文档总高度 (CSS pixels, 供滚动 spacer 使用) — 含分页间隙 */
  getTotalDocHeight(): number {
    const pages = this.draw.getPages()
    if (pages.length === 0) return 0
    const gap = this.draw.getPageVerticalGap()
    if (gap === 0) return pages.length * pages[0].height
    // 含间隙的总高度 = sum(pageHeight) + (N-1) * gap
    let total = 0
    for (const p of pages) total += p.height
    return total + (pages.length - 1) * gap
  }

  /** 外部滚动同步 → 反偏移画布 + 更新 scrollY + 重渲染 */
  syncScrollPosition(scrollTop: number): void {
    const coord = this.draw.getCoordinateSystem()
    // 容器 CSS 像素 → 文档坐标: scrollY = scrollTop / scale
    const docScrollY = scrollTop / coord.transform.scale
    if (docScrollY !== coord.transform.scrollY) {
      coord.update({ scrollY: docScrollY })
      this.draw.renderer.fixCanvasScrollOffset(scrollTop)
      this.draw.render(this.pool, this.store.state.runtime)
    }
  }

  /**
   * 固定文档变更流水线 — 所有文档变动的唯一渲染入口 (v20.35)
   *
   * 强制顺序:
   *   1. 重布局 (全量/增量) → 更新嵌套 SLIF 树
   *   2. HitTestIndex 全量重建 (recomputeLayout 内部)
   *   3. 渲染 (含光标)
   *   4. 自动保存标记
   *   5. 工具栏/状态栏同步 (notifyListeners 'contentChange')
   */
  private commitDocumentChange(invalidation: import('./command/ICommand').InvalidationScope): void {
    const t0 = performance.now()
    this.draw.recomputeLayout(this.pool, invalidation)
    const t1 = performance.now()
    const cursor = this.store.state.runtime.cursor
    console.debug(
      `[Editor] document:changed(${invalidation}) → recomputeLayout ${(t1 - t0).toFixed(1)}ms, ` +
      `cursor=(${cursor.paragraphPath.join('/')}, offset=${cursor.offset}), ` +
      `bodyChildren=[${this.doc.body.children.join(',')}]`
    )
    this.perfMetrics.recordLayout(t1 - t0)
    this.draw.render(this.pool, this.store.state.runtime)
    this.autoSave.markDirty()
    this.notifyListeners('contentChange', this.doc)
  }

  /** 点击命中检测 → 更新光标到点击位置 */
  private handleClick(e: MouseEvent): void {
    // 页眉页脚编辑模式下, 光标定位已在 MouseHandler.onMouseDown 中完成,
    // 此处不再重复处理 (避免 hitTestIndex 在 body items 中误命中)
    if (this.draw.isHeaderFooterEditActive()) return

    // 格式刷激活时: 点击 = 应用格式到目标段落 (TASK-472)
    if (this._formatPainterStyle) {
      this.handleFormatPainterApply(e)
      return
    }

    const rect = this.container.getBoundingClientRect()
    const { scale, scrollY } = this.draw.getCoordinateSystem().transform

    // 屏幕坐标 → 文档坐标 (统一通过 TableCoordUtil, v20.35 修复: 之前缺少 /scale)
    const { x: docX0, y: docY0 } = screenToDoc(e.clientX, e.clientY, scale, scrollY, rect)

    const pages = this.draw.getPages()
    if (pages.length === 0) return

    // 分页间隙 — 命中检测要把带间隙的文档 Y 反查到正确的 pageIndex + 页面内 localY
    const gap = this.draw.getPageVerticalGap()
    const { pageIndex, localY } = findPageByDocY(docY0, pages, gap)
    const page = pages[pageIndex]
    if (!page) return

    const viewportW = this.container.clientWidth
    const offsetX = pageCenteringOffset(page.width, viewportW, scale)
    const docX = docX0 - offsetX / scale
    const docY = localY

    // 命中检测 — 可能返回 null (空段落/点击在内容下方)
    const nodeId = this.draw.getHitTestIndex().hitTest(docX, docY, pageIndex)

    if (nodeId) {
      const para = this.findParagraphContaining(nodeId)
      if (para) {
        const offset = this.computeOffsetAtX(para, docX, docY, page)
        setCursor(this.store, [this.doc.id, para.id], offset)
      }
    } else {
      // 未命中 → 判断点击位置相对于内容的位置
      const lastItemBottom = this.getPageContentBottom(page)
      const firstItemTop = this.getPageContentTop(page)

      if (lastItemBottom >= 0 && docY > lastItemBottom) {
        // 点击在所有内容下方 → 光标移到最后一个段落末尾
        const bodyChildren = this.doc.body.children
        if (bodyChildren.length > 0) {
          // 从后往前找最后一个段落 (跳过 table/separator/section_break)
          let lastParaId: string | null = null
          for (let i = bodyChildren.length - 1; i >= 0; i--) {
            const node = this.pool.nodes.get(bodyChildren[i])
            if (node && node.type === 'paragraph') { lastParaId = bodyChildren[i]; break }
          }
          if (lastParaId) {
            const lastPara = this.pool.nodes.get(lastParaId) as unknown as Paragraph | undefined
            if (lastPara) {
              const endOffset = this.getParagraphTextLength(lastPara)
              setCursor(this.store, [this.doc.id, lastParaId], endOffset)
            }
          }
        }
      } else if (firstItemTop >= 0 && docY < firstItemTop) {
        // 点击在所有内容上方 → 光标移到第一个段落开头
        const bodyChildren = this.doc.body.children
        if (bodyChildren.length > 0) {
          // 从前往后找第一个段落 (跳过 table/separator/section_break)
          let firstParaId: string | null = null
          for (let i = 0; i < bodyChildren.length; i++) {
            const node = this.pool.nodes.get(bodyChildren[i])
            if (node && node.type === 'paragraph') { firstParaId = bodyChildren[i]; break }
          }
          if (firstParaId) {
            setCursor(this.store, [this.doc.id, firstParaId], 0)
          }
        }
      }
      // 行间空白 (在内容范围内但未命中任何 item) → 光标保持原位, 不移动
    }

    // 单击清空选区 (双击/三击已处理选区则跳过)
    if (!this.mouseHandler.wasMultiClick()) {
      const si = this.store as unknown as { _state: { runtime: { selection: { active: boolean } } } }
      si._state.runtime.selection.active = false
    }

    // 无论命中与否都重绘
    this.draw.render(this.pool, this.store.state.runtime)
  }

  /** 在 pool 中查找包含 nodeId 的 Paragraph */
  private findParagraphContaining(nodeId: string): Paragraph | null {
    for (const [, node] of this.pool.nodes) {
      if (node.type === 'paragraph') {
        const para = node as unknown as Paragraph
        if (para.children.includes(nodeId) || nodeId === node.id) return para
      }
    }
    return null
  }

  /** 根据文档坐标 X/Y 计算段落内的字符偏移 — Phase 5 使用 page.items 直接过滤 */
  private computeOffsetAtX(para: Paragraph, docX: number, docY: number, page: import('./layout/core/SLIF').SLIFPage): number {
    // Phase 5: 使用 page.items 直接过滤 (不再需要 getFlatPageItems 展平)
    const related = page.items
      .filter(it => para.children.includes(it.nodeId) || it.nodeId === para.id)
    // items 已按 Y 排序 (LayoutEngine 顺序插入), 此处不需额外 sort

    let accumulated = 0
    for (const item of related) {
      const itemText = (item as { text?: string }).text || ''
      const bodyW = (item as { markerWidth?: number }).markerWidth != null
        ? item.width - (item as { markerWidth: number }).markerWidth
        : item.width

      // 命中当前行?
      const yHit = docY >= item.y && docY <= item.y + item.ascent + item.descent
      if (yHit) {
        // X 在 item 左侧 → 光标放在 item 行首
        if (docX < item.x) return accumulated
        // X 在 item 内部 → 逐字计算偏移
        if (docX <= item.x + bodyW) {
          const relativeX = docX - item.x
          const cumWidths = cumulativeCharWidths(itemText, {
            font: item.font || 'SimSun', size: item.size || 16,
            bold: item.bold, italic: item.italic,
          })
          const charIdx = findCharIndexAtX(relativeX, cumWidths, itemText.length || 0)
          return Math.max(0, accumulated + charIdx)
        }
        // X 在 item 右侧 → 光标放在 item 行尾
        return accumulated + itemText.length
      }

      accumulated += itemText.length
    }

    return Math.max(0, accumulated)
  }

  /** 计算段落内所有文本节点的总字符数 */
  private getParagraphTextLength(para: Paragraph): number {
    let len = 0
    for (const childId of para.children) {
      const node = this.pool.nodes.get(childId)
      if (node && (node as unknown as { type: string }).type === 'text') {
        len += ((node as unknown as { text: string }).text || '').length
      } else {
        len += 1
      }
    }
    return len
  }

  /** 获取页面中最后一个 SLIF item 的底部 Y 坐标, 无内容返回 -1 */
  private getPageContentBottom(page: import('./layout/core/SLIF').SLIFPage): number {
    if (page.items.length === 0) return -1
    let maxBottom = 0
    for (const item of page.items) {
      const bottom = item.y + item.ascent + item.descent
      if (bottom > maxBottom) maxBottom = bottom
    }
    return maxBottom
  }

  /** 获取页面中第一个 SLIF item 的顶部 Y 坐标, 无内容返回 -1 */
  private getPageContentTop(page: import('./layout/core/SLIF').SLIFPage): number {
    if (page.items.length === 0) return -1
    return page.items[0].y
  }

  /**
   * 收集段落中偏移范围内的所有文本节点 ID
   * @param paraId 段落 ID
   * @param startOffset 起始字符偏移 (inclusive)
   * @param endOffset 结束字符偏移 (exclusive), 传 Number.MAX_SAFE_INTEGER 表示到段落末尾
   */
  private collectTextNodeIds(paraId: string, startOffset: number, endOffset: number): string[] {
    const ids: string[] = []
    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return ids
    let offset = 0
    for (const cid of para.children) {
      const n = this.pool.nodes.get(cid) as { type?: string; text?: string } | undefined
      const len = n?.type === 'text' ? ((n.text as string) || '').length : 1
      if (n?.type === 'text' && offset + len > startOffset && offset < endOffset) {
        ids.push(cid)
      }
      offset += len
    }
    return ids
  }

  getDocument(): DocumentTree { return this.doc }
  /** 序列化文档为 JSON 字符串 (含全部节点 payload, 供保存/自动保存使用) */
  getSerializedDocument(): string {
    return serializeDocument(this.doc, this.pool)
  }
  setDocument(doc: DocumentTree, nodes?: Map<string, BaseNode>): void {
    // 确保 header/footer 字段存在 (兼容旧版文档数据)
    if (!doc.header) doc.header = []
    if (!doc.footer) doc.footer = []
    this.doc = doc
    this.pool = buildDocumentPool(doc, nodes)
    this.draw.setDocument(doc, this.pool)
    this.draw.recomputeLayout(this.pool)

    // 自动应用文档水印 (R70)
    const ps = doc.pageSetup as { watermark?: import('./render/LayeredRenderer').WatermarkConfig } | undefined
    if (ps?.watermark) {
      this.draw.setWatermark(ps.watermark)
    }

    const cursorPath = doc.body.children.length > 0
      ? [doc.id, doc.body.children[0]]
      : []
    setCursor(this.store, cursorPath, 0)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', doc)
  }

  /**
   * 确保页眉/页脚区域至少有一个段落 (无则创建)
   * 返回第一个段落 ID
   */
  ensureHeaderFooterParagraph(section: 'header' | 'footer'): string {
    const targetIds = section === 'header' ? this.doc.header! : this.doc.footer!
    if (targetIds.length > 0) return targetIds[0]

    // 创建空白段落 + 空文本节点
    const para = createParagraph()
    const textNode = createTextNode('')
    para.children = [textNode.id]

    // 加入文档和池
    targetIds.push(para.id)
    this.pool.nodes.set(para.id, para)
    this.pool.nodes.set(textNode.id, textNode)

    return para.id
  }

  /**
   * 在光标位置插入域代码 (TASK-471)
   * 用于页眉页脚工具栏"插入页码"/"插入日期"等
   */
  insertFieldCode(fieldType: FieldType): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const fn = createFieldNode(fieldType)

    // 注册到 NodePool
    this.pool.nodes.set(fn.id, fn)

    // 插入到段落 children 的光标偏移处
    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return

    // 找到光标所在的文本节点位置，在后面插入 FieldNode
    const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
    if (resolved) {
      const idx = para.children.indexOf(resolved.textNodeId)
      para.children.splice(idx + 1, 0, fn.id)
    } else {
      // 段尾: 追加到最后
      para.children.push(fn.id)
    }

    // 触发重布局+重绘
    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 创建一个空段落 (空 text 节点 + 段落) 并注册进 pool, 返回段落 id。
   *  用于非段落块 (表格/分隔线/分节符) 之后, 保证光标可定位到该块之后继续书写。 */
  private createTrailingParagraph(): string {
    const text = createTextNode('')
    const para = createParagraph([text.id])
    this.pool.nodes.set(text.id, text)
    this.pool.nodes.set(para.id, para)
    return para.id
  }

  /** 在光标所在段落后插入分隔线 (TASK-462) */
  insertSeparator(): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const idx = this.doc.body.children.indexOf(paraId)
    if (idx < 0) return

    const sep = createSeparatorNode()
    this.pool.nodes.set(sep.id, sep)
    this.doc.body.children.splice(idx + 1, 0, sep.id)

    // 分隔线后创建空段落, 确保光标可定位到分隔线之后继续书写 (与 insertTable 一致)
    const trailParaId = this.createTrailingParagraph()
    this.doc.body.children.splice(
      this.doc.body.children.indexOf(sep.id) + 1, 0, trailParaId,
    )
    setCursor(this.store, [this.doc.id, trailParaId], 0)

    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 在光标位置插入脚注引用 + 脚注内容 (R31, Ctrl+Alt+F) */
  insertFootnote(): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return

    // 创建脚注内容 (空段落, 用户后续编辑)
    const fnContent = createFootnoteContent('')
    const contentText = createTextNode('')
    const contentPara = createParagraph([contentText.id])
    fnContent.children = [contentPara.id]
    this.pool.nodes.set(fnContent.id, fnContent)
    this.pool.nodes.set(contentText.id, contentText)
    this.pool.nodes.set(contentPara.id, contentPara)

    // 注册到文档级别
    if (!this.doc.footnotes) this.doc.footnotes = []
    this.doc.footnotes.push(fnContent.id)

    // 创建脚注引用 (标记在正文中)
    const fnRef = createFootnoteRef(fnContent.id)
    fnContent.refId = fnRef.id
    this.pool.nodes.set(fnRef.id, fnRef)

    // 插入引用到光标位置
    const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
    if (resolved) {
      const idx = para.children.indexOf(resolved.textNodeId)
      para.children.splice(idx + 1, 0, fnRef.id)
    } else {
      para.children.push(fnRef.id)
    }

    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 在光标位置插入图片 (TASK-447), dataUrl 为 base64 或 blob URL */
  insertImage(dataUrl: string, naturalW?: number, naturalH?: number): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    // 限制显示宽度不超过内容区域
    const maxW = 794 - 180 // pageWidth - margins
    const displayW = Math.min(naturalW || maxW, maxW)
    const displayH = naturalW && naturalH
      ? (displayW / naturalW) * naturalH
      : 200

    const imgNode = {
      type: 'image' as const,
      id: generateCommandId(),
      src: dataUrl,
      width: displayW,
      height: displayH,
      naturalWidth: naturalW,
      naturalHeight: naturalH,
      wrapMode: 'top-bottom' as const,
    }

    this.pool.nodes.set(imgNode.id, imgNode)

    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (para?.children) {
      const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
      if (resolved) {
        const target = this.pool.nodes.get(resolved.textNodeId)
        const idx = para.children.indexOf(resolved.textNodeId)
        if (target && (target as { type?: string }).type === 'text') {
          const text = (target as unknown as { text: string }).text
          const lo = resolved.localOffset
          if (lo > 0 && lo < text.length) {
            // 光标在文本中间 → 拆分文本, 图片插入拆分点
            const afterNode = createTextNode(text.slice(lo), extractStyle(target as unknown as TextNode))
            this.pool.nodes.set(afterNode.id, afterNode)
            this.pool.updateNode(target.id, { text: text.slice(0, lo) } as Partial<TextNode>)
            para.children.splice(idx + 1, 0, imgNode.id, afterNode.id)
          } else {
            // 光标在文本首/尾 → 图片插到文本前/后
            para.children.splice(idx + (lo === 0 ? 0 : 1), 0, imgNode.id)
          }
        } else {
          // 内联非文本节点 (image/field/footnote_ref) → localOffset 0=前, 1=后
          para.children.splice(idx + (resolved.localOffset >= 1 ? 1 : 0), 0, imgNode.id)
        }
      } else {
        para.children.push(imgNode.id)
      }
    }

    // 光标移到图片之后 (图片占 1 字符), 使后续输入落在图片之后而非之前
    const afterOffset = this.pool.getCharOffset(paraId, imgNode.id, 1)
    setCursor(this.store, [this.doc.id, paraId], afterOffset)

    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 在光标位置后插入表格 (R83) */
  insertTable(rows: number, cols: number): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]

    const tableId = generateCommandId()
    const colWidth = 100 / Math.max(cols, 1)
    const rowIds: string[] = []

    for (let r = 0; r < rows; r++) {
      const rowId = generateCommandId()
      const cellIds: string[] = []
      for (let c = 0; c < cols; c++) {
        const cellId = generateCommandId()
        const text = createTextNode('')
        const para = createParagraph([text.id])
        this.pool.nodes.set(text.id, text)
        this.pool.nodes.set(para.id, para)
        this.pool.nodes.set(cellId, {
          type: 'cell' as const, id: cellId,
          children: [para.id],
          colspan: 1, rowspan: 1,
        } as unknown as BaseNode)
        cellIds.push(cellId)
      }
      this.pool.nodes.set(rowId, {
        type: 'row' as const, id: rowId,
        children: cellIds, height: 24,
      } as unknown as BaseNode)
      rowIds.push(rowId)
    }

    this.pool.nodes.set(tableId, {
      type: 'table' as const, id: tableId,
      columns: Array.from({ length: cols }, () => ({ width: colWidth, mode: 'percentage' as const })),
      children: rowIds,
    } as unknown as BaseNode)

    // 在光标段落后插入表格
    const idx = this.doc.body.children.indexOf(paraId)
    if (idx >= 0) {
      this.doc.body.children.splice(idx + 1, 0, tableId)
    } else {
      this.doc.body.children.push(tableId)
    }

    // 表格后创建空段落, 确保光标可定位到表格之后
    const trailText = createTextNode('')
    const trailPara = createParagraph([trailText.id])
    this.pool.nodes.set(trailText.id, trailText)
    this.pool.nodes.set(trailPara.id, trailPara)
    this.doc.body.children.splice(
      this.doc.body.children.indexOf(tableId) + 1, 0, trailPara.id,
    )

    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 选中表格单元格 (供鼠标点击使用) — 同时启动单格框选 */
  selectTableCell(tableId: string, row: number, col: number): void {
    if (this._selectedTableId === tableId && this._selectedCellRow === row && this._selectedCellCol === col) {
      // 再次点击同一单元格 → 清除选择
      this.clearTableSelection()
    } else {
      this._selectedTableId = tableId; this._selectedCellRow = row; this._selectedCellCol = col
      // 同步框选为单格 (网格坐标)
      const gp = getCellGridPosition(this.pool, tableId, row, col)
      if (gp) this.startCellBoxSelection(tableId, gp.row, gp.col)
      else this.draw.render(this.pool, this.store.state.runtime)
    }
  }

  /** 开始框选 (锚点 = 起点, 单格) */
  startCellBoxSelection(tableId: string, row: number, col: number): void {
    this._cellRange = { tableId, startRow: row, startCol: col, endRow: row, endCol: col }
    this.syncCellSelection()
  }

  /** 扩展框选终点到 (row, col) (网格坐标) */
  extendCellBoxSelection(tableId: string, row: number, col: number): void {
    if (!this._cellRange || this._cellRange.tableId !== tableId) return
    this._cellRange.endRow = row
    this._cellRange.endCol = col
    this.syncCellSelection()
  }

  /** 清除表格选择 (焦点 cell + 框选) */
  clearTableSelection(): void {
    this._selectedTableId = null; this._selectedCellRow = -1; this._selectedCellCol = -1
    this._cellRange = null
    this.draw.cellSelection = null
    this.draw.render(this.pool, this.store.state.runtime)
  }

  get selectedTableId(): string | null { return this._selectedTableId }
  get selectedCellRow(): number { return this._selectedCellRow }
  get selectedCellCol(): number { return this._selectedCellCol }
  get cellRange(): CellRange | null { return this._cellRange }

  /** 同步框选到 Draw + 重渲染 */
  private syncCellSelection(): void {
    this.draw.cellSelection = this._cellRange ? { ...this._cellRange } : null
    this.draw.render(this.pool, this.store.state.runtime)
  }

  /** 合并选中的相邻单元格 (单格右合并 / 框选矩形合并) */
  mergeSelectedCells(): void {
    // 框选多格 → 矩形合并
    if (this._cellRange && (this._cellRange.startRow !== this._cellRange.endRow || this._cellRange.startCol !== this._cellRange.endCol)) {
      this.mergeSelectedRange(this._cellRange)
      return
    }
    if (!this._selectedTableId || this._selectedCellRow < 0 || this._selectedCellCol < 0) return
    const tableId = this._selectedTableId
    const rowIdx = this._selectedCellRow
    const colIdx = this._selectedCellCol
    const table = this.pool.nodes.get(tableId) as { children?: string[] } | undefined
    if (!table?.children) return
    const rowId = table.children[rowIdx]
    if (!rowId) return
    const row = this.pool.nodes.get(rowId) as { children?: string[] } | undefined
    if (!row?.children) return
    const cellId = row.children[colIdx]
    const nextCellId = row.children[colIdx + 1]
    if (!cellId || !nextCellId) return

    const cell = this.pool.nodes.get(cellId) as { colspan?: number; rowspan?: number; children?: string[] } | undefined
    const nextCell = this.pool.nodes.get(nextCellId) as { colspan?: number; rowspan?: number; children?: string[] } | undefined
    if (!cell || !nextCell) return

    // 仅支持同一行内相邻、且两侧均未跨行的合并 (跨行合并方向复杂, 暂不支持)
    if ((cell.rowspan || 1) > 1 || (nextCell.rowspan || 1) > 1) return

    // 水平合并: colspan 累加右侧单元格的 colspan
    cell.colspan = (cell.colspan || 1) + (nextCell.colspan || 1)
    // 右侧单元格内容并入当前单元格
    cell.children = [...(cell.children || []), ...(nextCell.children || [])]
    this.pool.nodes.delete(nextCellId)
    row.children.splice(colIdx + 1, 1)

    this.afterTableMutation()
  }

  /** 合并框选矩形为一个单元格 (colspan×rowspan) */
  mergeSelectedRange(range: CellRange): void {
    const { r0, r1, c0, c1 } = normalizeRange(range)
    if (r0 === r1 && c0 === c1) return
    const grid = buildCellGrid(this.pool, range.tableId)
    const boxCells = grid.cells.filter(gc => gc.row >= r0 && gc.row <= r1 && gc.col >= c0 && gc.col <= c1)
    if (boxCells.length < 2) return

    // 左上角 cell 作为合并目标
    const target = boxCells.find(gc => gc.row === r0 && gc.col === c0)
    if (!target) return
    const targetCell = this.pool.nodes.get(target.cellId) as { colspan?: number; rowspan?: number; children?: string[] } | undefined
    if (!targetCell) return

    // 其余 cell 内容并入目标 cell, 并从各自行移除
    for (const gc of boxCells) {
      if (gc.cellId === target.cellId) continue
      const cell = this.pool.nodes.get(gc.cellId) as { children?: string[] } | undefined
      if (cell?.children?.length) {
        targetCell.children = [...(targetCell.children || []), ...cell.children]
        // 关键: 清空引用, 防止 removeChild 级联删除已并入目标 cell 的段落
        cell.children = []
      }
      const row = this.pool.nodes.get(grid.rowIds[gc.row]) as { id: string; children?: string[] } | undefined
      const idx = row?.children?.indexOf(gc.cellId)
      if (row && idx !== undefined && idx >= 0) this.pool.removeChild(row.id, idx)
    }

    // 目标 cell span = 矩形宽×高
    const spanCol = c1 - c0 + 1
    const spanRow = r1 - r0 + 1
    if (spanCol > 1) targetCell.colspan = spanCol; else delete targetCell.colspan
    if (spanRow > 1) targetCell.rowspan = spanRow; else delete targetCell.rowspan

    this.afterTableMutation()
  }

  /** 拆分合并的单元格 (支持 colspan 水平拆分 / rowspan 垂直拆分) */
  splitSelectedCell(): void {
    if (!this._selectedTableId || this._selectedCellRow < 0 || this._selectedCellCol < 0) return
    const tableId = this._selectedTableId
    const rowIdx = this._selectedCellRow
    const colIdx = this._selectedCellCol
    const table = this.pool.nodes.get(tableId) as { children?: string[] } | undefined
    if (!table?.children) return
    const rowId = table.children[rowIdx]
    if (!rowId) return
    const row = this.pool.nodes.get(rowId) as { children?: string[] } | undefined
    if (!row?.children) return
    const cellId = row.children[colIdx]
    if (!cellId) return
    const cell = this.pool.nodes.get(cellId) as { colspan?: number; rowspan?: number; children?: string[] } | undefined
    if (!cell) return

    const colspan = cell.colspan || 1
    const rowspan = cell.rowspan || 1
    if (colspan <= 1 && rowspan <= 1) return

    // 新单元格 (含一个空段落)
    const text = createTextNode('')
    const para = createParagraph([text.id])
    this.pool.nodes.set(text.id, text as unknown as BaseNode)
    this.pool.nodes.set(para.id, para as unknown as BaseNode)
    const newCell = createTableCell([para.id])
    this.pool.nodes.set(newCell.id, newCell as unknown as BaseNode)

    if (colspan > 1) {
      // 水平拆分: 原 cell 缩为 colspan=1, 右侧新增 cell (保留剩余 colspan + 相同 rowspan)
      cell.colspan = 1
      if (colspan > 2) newCell.colspan = colspan - 1
      if (rowspan > 1) newCell.rowspan = rowspan
      row.children.splice(colIdx + 1, 0, newCell.id)
    } else {
      // 垂直拆分: 原 cell 缩为 rowspan=1, 下一行对应列新增 cell (保留剩余 rowspan)
      const rowBelowId = table.children[rowIdx + 1]
      const rowBelow = rowBelowId
        ? (this.pool.nodes.get(rowBelowId) as { children?: string[] } | undefined)
        : undefined
      if (!rowBelow?.children) { this.pool.nodes.delete(newCell.id); return }

      cell.rowspan = 1
      if (rowspan > 2) newCell.rowspan = rowspan - 1
      if (colspan > 1) newCell.colspan = colspan

      // 在下一行中, 找到网格列对应的插入点
      const gp = getCellGridPosition(this.pool, tableId, rowIdx, colIdx)
      const targetCol = gp?.col ?? colIdx
      const grid = buildCellGrid(this.pool, tableId)
      let insertIdx = rowBelow.children.length
      for (let i = 0; i < rowBelow.children.length; i++) {
        const gc = grid.byId.get(rowBelow.children[i])
        if (gc && gc.col > targetCol) { insertIdx = i; break }
      }
      rowBelow.children.splice(insertIdx, 0, newCell.id)
    }

    this.afterTableMutation()
  }

  /** 插入行 (选中单元格下方) */
  insertTableRow(): void {
    if (!this._selectedTableId || this._selectedCellRow < 0) return
    insertRow(this.pool, this._selectedTableId, this._selectedCellRow)
    this.afterTableMutation()
  }

  /** 删除选中单元格所在行 */
  deleteTableRow(): void {
    if (!this._selectedTableId || this._selectedCellRow < 0) return
    deleteRow(this.pool, this._selectedTableId, this._selectedCellRow)
    this.afterTableMutation()
  }

  /** 插入列 (选中单元格右侧) */
  insertTableColumn(): void {
    if (!this._selectedTableId || this._selectedCellRow < 0 || this._selectedCellCol < 0) return
    const gp = getCellGridPosition(this.pool, this._selectedTableId, this._selectedCellRow, this._selectedCellCol)
    if (!gp) return
    insertColumn(this.pool, this._selectedTableId, gp.col)
    this.afterTableMutation()
  }

  /** 删除选中单元格所在列 */
  deleteTableColumn(): void {
    if (!this._selectedTableId || this._selectedCellRow < 0 || this._selectedCellCol < 0) return
    const gp = getCellGridPosition(this.pool, this._selectedTableId, this._selectedCellRow, this._selectedCellCol)
    if (!gp) return
    deleteColumn(this.pool, this._selectedTableId, gp.col)
    this.afterTableMutation()
  }

  /** 表格结构变更后的统一收尾: 清选择 + 重布局 + 渲染 + 通知 */
  private afterTableMutation(): void {
    this._selectedTableId = null; this._selectedCellRow = -1; this._selectedCellCol = -1
    this._cellRange = null
    this.draw.cellSelection = null
    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 选择性粘贴 (Ctrl+Shift+V) — keep-source / match-destination / plain-text */
  pasteSpecial(format: 'keep-source' | 'match-destination' | 'plain-text'): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    let data = this.clipboard.paste()
    if (!data || data.nodes.length === 0) {
      this.pasteFromSystem()
      return
    }

    if (format === 'plain-text') {
      data = this.clipboard.pasteAsPlainText()
    } else if (format === 'match-destination') {
      data = this.clipboard.pasteMatchingDestination(this.getTextStyle() || undefined)
    }
    // keep-source: use data as-is

    if (!data || data.nodes.length === 0) return
    const cmd = new InsertNodesCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath, cursor.offset,
      data.nodes,
    )
    this.commandManager.execute(cmd)
  }

  /** 切换编辑器模式 (edit/readonly/form/clean/design/print) */
  setMode(mode: import('./state/EditorRuntimeState').EditorMode): void {
    this.store.state.runtime.view.mode = mode
    this.eventBus.emit('mode:changed', mode)
    this.eventBus.emit('state:changed', {})
  }

  /** 插入 SmartTextNode (医疗结构化文本) */
  insertSmartText(name: string, format?: 'S1' | 'S2' | 'S3' | 'N' | 'D'): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const meta: import('./document/DocumentModel').ElementMeta = {
      code: { internal: `CTL_${name.toUpperCase()}`, dataElement: `DE99.99.${name}` },
      name,
      format: format ? { dataType: format } : undefined,
    }
    const smartNode = createSmartTextNode(`[${name}]`, meta)
    this.pool.nodes.set(smartNode.id, smartNode)

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
    if (resolved) {
      const para = this.pool.nodes.get(paraId) as { children?: string[] }
      if (para?.children) {
        const idx = para.children.indexOf(resolved.textNodeId)
        if (idx >= 0) para.children.splice(idx + 1, 0, smartNode.id)
        else para.children.push(smartNode.id)
      }
    } else {
      const para = this.pool.nodes.get(paraId) as { children?: string[] }
      if (para?.children) para.children.push(smartNode.id)
    }

    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 插入书签 — 在当前光标位置创建 BookmarkNode */
  insertBookmark(name: string): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const bookmarkId = generateCommandId()
    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const bookmark: BaseNode = {
      type: 'bookmark' as const, id: bookmarkId,
      name,
      targetId: paraId,
      targetOffset: cursor.offset,
    } as unknown as BaseNode
    this.pool.nodes.set(bookmarkId, bookmark)

    const para = this.pool.nodes.get(paraId) as { children?: string[] }
    if (para?.children) {
      const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
      if (resolved) {
        const idx = para.children.indexOf(resolved.textNodeId)
        if (idx >= 0) para.children.splice(idx + 1, 0, bookmarkId)
        else para.children.push(bookmarkId)
      } else {
        para.children.push(bookmarkId)
      }
    }
    this.notifyListeners('contentChange', this.doc)
  }

  /** 获取文档中所有书签/标题/脚注目标 (供 BookmarkDialog 使用) */
  getBookmarkTargets(): { id: string; label: string; type: 'heading' | 'bookmark' | 'footnote'; pageHint?: number }[] {
    const targets: { id: string; label: string; type: 'heading' | 'bookmark' | 'footnote'; pageHint?: number }[] = []
    for (const [, node] of this.pool.nodes) {
      if (node.type === 'bookmark') {
        const bm = node as unknown as { id: string; name: string }
        targets.push({ id: bm.id, label: bm.name || bm.id, type: 'bookmark' })
      } else if (node.type === 'paragraph') {
        const p = node as unknown as { id: string; outlineLevel?: number; children?: string[] }
        if (p.outlineLevel && p.outlineLevel > 0) {
          const text = p.children?.map(cid => {
            const cn = this.pool.nodes.get(cid) as { text?: string } | undefined
            return cn?.text || ''
          }).join('') || `标题${p.outlineLevel}`
          targets.push({ id: p.id, label: text, type: 'heading' })
        }
      } else if (node.type === 'footnote_content') {
        const fn = node as unknown as { id: string }
        targets.push({ id: fn.id, label: `脚注 ${fn.id.slice(-4)}`, type: 'footnote' })
      }
    }
    return targets
  }

  /** 创建批注 — 在当前选区/光标位置创建 CommentMarker */
  createComment(content: string): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const markerId = generateCommandId()
    const threadId = generateCommandId()
    const ts = Date.now()
    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]

    // 创建 CommentMarker
    const marker: BaseNode = {
      type: 'comment_marker' as const, id: markerId,
      threadId,
      rangeStart: { path: [...cursor.paragraphPath], offset: Math.max(0, cursor.offset - 1) },
      rangeEnd: { path: [...cursor.paragraphPath], offset: cursor.offset },
    } as unknown as BaseNode
    this.pool.nodes.set(markerId, marker)

    // 插入到光标所在的文本节点之后
    const para = this.pool.nodes.get(paraId) as { children?: string[] }
    if (para?.children) {
      const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
      if (resolved) {
        const idx = para.children.indexOf(resolved.textNodeId)
        if (idx >= 0) para.children.splice(idx + 1, 0, markerId)
        else para.children.push(markerId)
      } else {
        para.children.push(markerId)
      }
    }

    // 初始化 comments 数组并添加 thread
    if (!this.doc.comments) this.doc.comments = []
    this.doc.comments.push({
      id: threadId,
      rangeStart: { path: [...cursor.paragraphPath], offset: Math.max(0, cursor.offset - 1) },
      rangeEnd: { path: [...cursor.paragraphPath], offset: cursor.offset },
      author: 'user',
      createdAt: ts,
      status: 'open' as const,
      baseVersion: 1,
      anchorStatus: 'valid' as const,
      comments: [{ id: generateCommandId(), author: 'user', createdAt: ts, content }],
    })

    this.notifyListeners('contentChange', this.doc)
  }

  /** 获取批注列表 */
  getComments(): import('./document/DocumentModel').CommentThread[] {
    return this.doc.comments || []
  }

  /** 添加批注回复 */
  addCommentReply(threadId: string, content: string): void {
    if (!this.doc.comments) return
    const thread = this.doc.comments.find(t => t.id === threadId)
    if (thread) {
      thread.comments.push({ id: generateCommandId(), author: 'user', createdAt: Date.now(), content })
      this.notifyListeners('contentChange', this.doc)
    }
  }

  /** 解决/重新打开批注 */
  resolveComment(threadId: string, resolved: boolean): void {
    if (!this.doc.comments) return
    const thread = this.doc.comments.find(t => t.id === threadId)
    if (thread) {
      thread.status = resolved ? 'resolved' : 'reopened'
      this.notifyListeners('contentChange', this.doc)
    }
  }

  execCommand(command: ICommand): void { this.commandManager.execute(command) }
  undo(): void { this.commandManager.undo() }
  redo(): void { this.commandManager.redo() }
  canUndo(): boolean { return this.commandManager.canUndo() }

  /** 应用页面设置 — 更新 DocumentTree.pageSetup + 分页渲染间隙, 然后重排重绘 */
  applyPageSetup(values: {
    marginTop: number; marginBottom: number; marginLeft: number; marginRight: number
    pageWidth: number; pageHeight: number; orientation: 'portrait' | 'landscape'
    pageVerticalGap?: number
  }): void {
    this.doc.pageSetup.width = values.pageWidth
    this.doc.pageSetup.height = values.pageHeight
    this.doc.pageSetup.marginTop = values.marginTop
    this.doc.pageSetup.marginBottom = values.marginBottom
    this.doc.pageSetup.marginLeft = values.marginLeft
    this.doc.pageSetup.marginRight = values.marginRight
    this.doc.pageSetup.orientation = values.orientation
    // 分页渲染间隙 — 存储不修改, 仅影响渲染视口
    if (typeof values.pageVerticalGap === 'number') {
      this.draw.setPageVerticalGap(values.pageVerticalGap)
    }
    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }
  canRedo(): boolean { return this.commandManager.canRedo() }

  /** 复制: 选区范围 → 深度克隆 → 内存剪贴板 + 系统剪贴板 */
  copy(): void {
    console.debug('[Editor] copy() called')
    const runtime = this.store.state.runtime
    const sel = runtime.selection
    const cursor = runtime.cursor

    if (sel.active) {
      this.clipboard.copy(
        sel.anchor.paragraphPath, sel.anchor.offset,
        sel.focus.paragraphPath, sel.focus.offset,
        this.doc, this.pool,
      )
    } else if (cursor.paragraphPath.length > 0) {
      // 无选区: 复制光标所在整段
      const para = this.pool.nodes.get(cursor.paragraphPath[cursor.paragraphPath.length - 1])
      if (para) {
        const len = this.getParagraphTextLength(para as unknown as Paragraph)
        this.clipboard.copy(
          cursor.paragraphPath, 0,
          cursor.paragraphPath, len,
          this.doc, this.pool,
        )
      }
    }
  }

  /** 删除当前选区内容 (跨段落逐段删除 + 合并), 用于粘贴前替换选区 */
  /**
   * 删除选区内容 — v21.0 Phase 4: 区分 body/cell 作用域
   *
   * 同 cell 内选区: 在 cell.children 上操作
   * body 内选区: 在 doc.body.children 上操作 (原有逻辑)
   * 跨域选区: 不允许, 直接返回 false
   */
  private deleteSelectedRange(): boolean {
    const selection = this.store.state.runtime.selection
    if (!selection.active) return false

    const aId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
    const fId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]
    const aOff = selection.anchor.offset
    const fOff = selection.focus.offset

    // 同段落选区 — 不需要查找 siblings, 直接删除偏移范围
    if (aId === fId) {
      const start = Math.min(aOff, fOff)
      const end = Math.max(aOff, fOff)
      if (end > start) {
        this.commandManager.execute(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', selection.anchor.paragraphPath, start, end))
      }
      setCursor(this.store, selection.anchor.paragraphPath, start)
      return true
    }

    // v21.0 Phase 4: 检测 scope 并获取 siblings
    const aCell = resolveCellPosition(aId, this.pool)
    const fCell = resolveCellPosition(fId, this.pool)

    // 跨域选区禁止
    if ((aCell && !fCell) || (!aCell && fCell)) return false
    // 不同 cell 的选区暂不支持
    if (aCell && fCell && (aCell.tableId !== fCell.tableId || aCell.row !== fCell.row || aCell.col !== fCell.col)) return false

    let siblings: string[]

    if (aCell) {
      // 同 cell 内选区: 使用 cell.children
      const tableNode = this.pool.nodes.get(aCell.tableId) as { children?: string[] } | undefined
      if (!tableNode?.children) return false
      const rowNode = this.pool.nodes.get(tableNode.children[aCell.row]) as { children?: string[] } | undefined
      if (!rowNode?.children) return false
      const cellNode = this.pool.nodes.get(rowNode.children[aCell.col]) as { children?: string[] } | undefined
      if (!cellNode?.children) return false
      siblings = cellNode.children
    } else {
      // body 内选区
      siblings = this.doc.body.children
    }

    const aIdx = siblings.indexOf(aId)
    const fIdx = siblings.indexOf(fId)
    if (aIdx < 0 || fIdx < 0) return false

    const lo = Math.min(aIdx, fIdx)
    const hi = Math.max(aIdx, fIdx)
    const loOff = aIdx === lo ? aOff : fOff
    const hiOff = fIdx === hi ? fOff : aOff

    // 从后往前删, 避免索引漂移
    for (let pi = hi; pi >= lo; pi--) {
      const paraId = siblings[pi]
      if (!paraId) continue
      const node = this.pool.nodes.get(paraId)
      if (!node || node.type !== 'paragraph') continue
      const path = [...selection.anchor.paragraphPath.slice(0, -1), paraId]

      if (pi === lo && pi === hi) {
        const start = Math.min(loOff, hiOff)
        const end = Math.max(loOff, hiOff)
        if (end > start) {
          this.commandManager.execute(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, start, end))
        }
      } else if (pi === hi) {
        if (hiOff > 0) {
          this.commandManager.execute(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, 0, hiOff))
        }
      } else if (pi === lo) {
        const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
        let totalLen = 0
        if (para?.children) {
          for (const cid of para.children) {
            const n = this.pool.nodes.get(cid) as { type?: string; text?: string } | undefined
            totalLen += n?.type === 'text' ? (n.text || '').length : 1
          }
        }
        if (loOff < totalLen) {
          this.commandManager.execute(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, loOff, totalLen))
        }
      } else {
        const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
        let totalLen = 0
        if (para?.children) {
          for (const cid of para.children) {
            const n = this.pool.nodes.get(cid) as { type?: string; text?: string } | undefined
            totalLen += n?.type === 'text' ? (n.text || '').length : 1
          }
        }
        if (totalLen > 0) {
          this.commandManager.execute(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, 0, totalLen))
        }
      }
    }

    // 跨段落选区: 合并残段
    if (lo < hi) {
      for (let mergeCount = hi - lo; mergeCount > 0; mergeCount--) {
        const currentSiblings = aCell
          ? ((() => {
              const tn = this.pool.nodes.get(aCell.tableId) as { children?: string[] } | undefined
              const rn = this.pool.nodes.get(tn?.children?.[aCell.row] || '') as { children?: string[] } | undefined
              return (this.pool.nodes.get(rn?.children?.[aCell.col] || '') as { children?: string[] } | undefined)?.children || siblings
            })())
          : this.doc.body.children
        const nextParaId = currentSiblings[lo + 1]
        if (!nextParaId) break
        const mergePath = [...selection.anchor.paragraphPath.slice(0, -1), nextParaId]
        this.commandManager.execute(new MergeParagraphCommand(generateCommandId(), Date.now(), 'user', mergePath))
      }
    }

    const loParaId = siblings[lo]
    setCursor(this.store, [...selection.anchor.paragraphPath.slice(0, -1), loParaId], loOff)

    return true
  }

  /** 粘贴: 先删选区再插入 (支持 undo/redo) */
  paste(): void {
    // 有选区时先删除选中内容
    this.deleteSelectedRange()

    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const data = this.clipboard.paste()
    if (!data || data.nodes.length === 0) {
      // 内存剪贴板为空 → 尝试从系统剪贴板读取纯文本兜底
      this.pasteFromSystem()
      return
    }

    const cmd = new InsertNodesCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath, cursor.offset,
      data.nodes,
    )
    this.commandManager.execute(cmd)
  }

  /** 从系统剪贴板读取纯文本 → 构造 ClipboardData → InsertNodesCommand */
  private async pasteFromSystem(): Promise<void> {
    try {
      const text = await navigator.clipboard?.readText()
      if (text) {
        this.clipboard.setPlainText(text)
        const data = this.clipboard.paste()
        if (data && data.nodes.length > 0 && this.store.state.runtime.cursor.paragraphPath.length > 0) {
          const cursor = this.store.state.runtime.cursor
          const cmd = new InsertNodesCommand(
            generateCommandId(), Date.now(), 'user',
            cursor.paragraphPath, cursor.offset,
            data.nodes,
          )
          this.commandManager.execute(cmd)
        }
      }
    } catch { /* 权限拒绝或非 HTTPS, 忽略 */ }
  }

  /**
   * 同步系统剪贴板 → 内存剪贴板 (焦点/可见性变化时调用)。
   *
   * 场景: 用户在编辑器内复制后, 又到外部应用复制了新内容, 回到编辑器粘贴。
   * 此时系统剪贴板已被外部改写, 但内存剪贴板仍是旧数据。通过对比两者的
   * 纯文本, 若不一致则用系统剪贴板内容覆盖内存, 使粘贴得到最新外部内容。
   */
  private syncExternalClipboard(): void {
    try {
      if (!navigator.clipboard?.readText) return
      navigator.clipboard.readText().then((text) => {
        if (text && text !== this.clipboard.getPlainText()) {
          this.clipboard.setPlainText(text)
          console.debug('[Clipboard] external clipboard synced from system')
        }
      }).catch(() => { /* 权限拒绝或非安全上下文, 忽略 */ })
    } catch { /* 忽略 */ }
  }

  /** 切换文本样式 (bold/italic/underline) → FormatTextCommand, 支持选区 */
  toggleFormat(style: Partial<import('./document/DocumentModel').TextStyle>): void {
    const selection = this.store.state.runtime.selection
    const cursor = this.store.state.runtime.cursor

    let nodeIds: string[] = []

    if (selection.active) {
      const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
      const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]

      if (anchorParaId === focusParaId) {
        // 同段落选区: 收集选区范围内所有 text node
        const start = Math.min(selection.anchor.offset, selection.focus.offset)
        const end = Math.max(selection.anchor.offset, selection.focus.offset)
        if (start < end) {
          nodeIds = this.collectTextNodeIds(anchorParaId, start, end)
        }
      } else {
        // 跨段落选区: 遍历 anchor→focus 之间所有段落, 逐段收集 text node
        const bodyChildren = this.doc.body.children
        const aIdx = bodyChildren.indexOf(anchorParaId)
        const fIdx = bodyChildren.indexOf(focusParaId)
        if (aIdx >= 0 && fIdx >= 0) {
          const lo = Math.min(aIdx, fIdx)
          const hi = Math.max(aIdx, fIdx)
          // 与 Draw.renderSelectionUnified 逻辑一致: 首段偏移 = 索引较小端对应的 anchor/focus offset
          const loOff = aIdx === lo ? selection.anchor.offset : selection.focus.offset
          const hiOff = aIdx === hi ? selection.anchor.offset : selection.focus.offset
          const INF = Number.MAX_SAFE_INTEGER

          for (let i = lo; i <= hi; i++) {
            const paraId = bodyChildren[i]
            if (i === lo && i === hi) {
              // 防御性: samePara 已在上方拦截, 此处仅在极端边界触发
              if (loOff < hiOff) nodeIds.push(...this.collectTextNodeIds(paraId, loOff, hiOff))
            } else if (i === lo) {
              // 首段: 从 loOff 到段落末尾的全部文本节点
              nodeIds.push(...this.collectTextNodeIds(paraId, loOff, INF))
            } else if (i === hi) {
              // 末段: 从段落开头到 hiOff 的全部文本节点
              nodeIds.push(...this.collectTextNodeIds(paraId, 0, hiOff))
            } else {
              // 中间段: 全部文本节点
              nodeIds.push(...this.collectTextNodeIds(paraId, 0, INF))
            }
          }
        }
      }
    }

    if (nodeIds.length === 0) {
      // 无选区 → 只格式化光标处节点
      if (cursor.paragraphPath.length === 0) return
      const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
      const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
      if (!resolved) return
      nodeIds = [resolved.textNodeId]
    }

    // Toggle: 读首个节点已有样式决定方向
    const firstNode = this.pool.nodes.get(nodeIds[0]) as unknown as { bold?: boolean; italic?: boolean; underline?: boolean } | undefined
    const changes: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(style)) {
      if (val === true && firstNode?.[key as keyof typeof firstNode]) {
        changes[key] = false
      } else {
        changes[key] = val
      }
    }

    const cmd = new FormatTextCommand(
      generateCommandId(), Date.now(), 'user',
      nodeIds,
      changes as Partial<import('./document/DocumentModel').TextStyle>,
    )
    this.commandManager.execute(cmd)
  }

  /** 清除光标/选区处所有文本格式 (TASK-473) */
  clearFormat(): void {
    const selection = this.store.state.runtime.selection
    const cursor = this.store.state.runtime.cursor
    let nodeIds: string[] = []

    if (selection.active) {
      const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
      const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]

      if (anchorParaId === focusParaId) {
        const start = Math.min(selection.anchor.offset, selection.focus.offset)
        const end = Math.max(selection.anchor.offset, selection.focus.offset)
        if (start < end) nodeIds = this.collectTextNodeIds(anchorParaId, start, end)
      } else {
        const bodyChildren = this.doc.body.children
        const aIdx = bodyChildren.indexOf(anchorParaId)
        const fIdx = bodyChildren.indexOf(focusParaId)
        if (aIdx >= 0 && fIdx >= 0) {
          const lo = Math.min(aIdx, fIdx)
          const hi = Math.max(aIdx, fIdx)
          const loOff = aIdx === lo ? selection.anchor.offset : selection.focus.offset
          const hiOff = aIdx === hi ? selection.anchor.offset : selection.focus.offset
          const INF = Number.MAX_SAFE_INTEGER
          for (let i = lo; i <= hi; i++) {
            const paraId = bodyChildren[i]
            if (i === lo && i === hi) {
              if (loOff < hiOff) nodeIds.push(...this.collectTextNodeIds(paraId, loOff, hiOff))
            } else if (i === lo) {
              nodeIds.push(...this.collectTextNodeIds(paraId, loOff, INF))
            } else if (i === hi) {
              nodeIds.push(...this.collectTextNodeIds(paraId, 0, hiOff))
            } else {
              nodeIds.push(...this.collectTextNodeIds(paraId, 0, INF))
            }
          }
        }
      }
    }

    if (nodeIds.length === 0) {
      if (cursor.paragraphPath.length === 0) return
      const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
      const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
      if (!resolved) return
      nodeIds = [resolved.textNodeId]
    }

    const cmd = new ClearFormatCommand(generateCommandId(), Date.now(), 'user', nodeIds)
    this.commandManager.execute(cmd)
  }

  /** 格式刷: 复制光标处文本样式 (TASK-472), 返回完整的序列化样式对象 */
  copyFormatPainterStyle(): Record<string, unknown> | null {
    const ts = this.getTextStyle()
    if (!ts) return null
    // 必须包含所有 TextStyle 字段 (含 undefined/false) —
    // 格式刷是"替换"而非"合并", 源没有的属性目标也应清除
    return {
      font: ts.font, size: ts.size,
      bold: ts.bold, italic: ts.italic, underline: ts.underline,
      underlineStyle: ts.underlineStyle, strikeout: ts.strikeout,
      color: ts.color, highlight: ts.highlight,
      superscript: ts.superscript, subscript: ts.subscript,
      letterSpacing: ts.letterSpacing,
    }
  }

  /** 格式刷: mouseup 事件 — 拖拽选区预览后松手应用格式 (先于 click 触发) */
  private _onMouseUp = (e: MouseEvent) => {
    if (!this._formatPainterStyle) return

    const selection = this.store.state.runtime.selection
    if (selection.active) {
      // 拖拽选区 → 收集选区内的文本节点并批量应用格式
      this.applyFormatPainterToSelection(this._formatPainterStyle)
    } else {
      // 单击 (无拖拽) → 应用到整个段落 (命中原有 hit-test 逻辑)
      this.handleFormatPainterApply(e)
    }
  }

  /** 格式刷: 将样式应用到当前选区内的所有文本节点 (拖拽松手/批量) */
  private applyFormatPainterToSelection(style: Record<string, unknown>): void {
    const selection = this.store.state.runtime.selection
    const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
    const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]

    let nodeIds: string[] = []

    if (anchorParaId === focusParaId) {
      // 同段落选区
      const start = Math.min(selection.anchor.offset, selection.focus.offset)
      const end = Math.max(selection.anchor.offset, selection.focus.offset)
      if (start < end) {
        nodeIds = this.collectTextNodeIds(anchorParaId, start, end)
      }
    } else {
      // 跨段落选区
      const bodyChildren = this.doc.body.children
      const aIdx = bodyChildren.indexOf(anchorParaId)
      const fIdx = bodyChildren.indexOf(focusParaId)
      if (aIdx >= 0 && fIdx >= 0) {
        const lo = Math.min(aIdx, fIdx)
        const hi = Math.max(aIdx, fIdx)
        const loOff = aIdx === lo ? selection.anchor.offset : selection.focus.offset
        const hiOff = aIdx === hi ? selection.anchor.offset : selection.focus.offset
        const INF = Number.MAX_SAFE_INTEGER

        for (let i = lo; i <= hi; i++) {
          const paraId = bodyChildren[i]
          if (i === lo && i === hi) {
            if (loOff < hiOff) nodeIds.push(...this.collectTextNodeIds(paraId, loOff, hiOff))
          } else if (i === lo) {
            nodeIds.push(...this.collectTextNodeIds(paraId, loOff, INF))
          } else if (i === hi) {
            nodeIds.push(...this.collectTextNodeIds(paraId, 0, hiOff))
          } else {
            nodeIds.push(...this.collectTextNodeIds(paraId, 0, INF))
          }
        }
      }
    }

    if (nodeIds.length === 0) {
      this.setFormatPainterActive(false)
      return
    }

    // 移动光标到焦点位置 (拖拽终点) + 清除选区 → 格式应用后只显示光标
    const focusPath = [...selection.focus.paragraphPath]
    const focusOffset = selection.focus.offset
    setCursor(this.store, focusPath, focusOffset)
    const si = this.store as unknown as {
      _state: { runtime: { selection: { anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean }; active: boolean; granularity: string } } }
    }
    si._state.runtime.selection = {
      anchor: { paragraphPath: focusPath, offset: focusOffset, visible: false },
      focus: { paragraphPath: focusPath, offset: focusOffset, visible: false },
      active: false,
      granularity: 'character',
    }

    // 执行格式刷命令 (FormatPainterCommand → document:changed → recomputeLayout + render + contentChange)
    const cmd = new FormatPainterCommand(
      generateCommandId(), Date.now(), 'user',
      nodeIds,
      style as Partial<import('./document/DocumentModel').TextStyle>,
    )
    this.commandManager.execute(cmd)

    // 停用格式刷 (同步通知 React 层)
    this.setFormatPainterActive(false)

    // 最终渲染: 确保光标正确显示 (document:changed 已触发一次 render, 此处为保险)
    this.draw.render(this.pool, this.store.state.runtime)
  }

  /** 格式刷: 激活/取消 — 同步通知 React 层 */
  setFormatPainterActive(active: boolean): void {
    if (active) {
      const style = this.copyFormatPainterStyle()
      if (!style) return // 无样式可复制, 不激活
      this._formatPainterStyle = style
      this.container.style.cursor = 'copy'
    } else {
      this._formatPainterStyle = null
      this.container.style.cursor = ''
    }
    // 统一通过回调同步到 React 层 (Zustand store)
    this.notifyFormatPainterChange(active)
  }

  /** 格式刷是否激活 */
  get isFormatPainterActive(): boolean { return this._formatPainterStyle !== null }

  /** 格式刷: 点击目标段落时应用样式 */
  private handleFormatPainterApply(e: MouseEvent): void {
    if (!this._formatPainterStyle) return

    const rect = this.container.getBoundingClientRect()
    const { scale, scrollY } = this.draw.getCoordinateSystem().transform

    const { x: docX0, y: docY0 } = screenToDoc(e.clientX, e.clientY, scale, scrollY, rect)

    const pages = this.draw.getPages()
    if (pages.length === 0) { this.setFormatPainterActive(false); return }

    // 分页间隙 — 把带间隙的文档 Y 反查到正确的 pageIndex + 页面内 localY
    const gap = this.draw.getPageVerticalGap()
    const { pageIndex, localY } = findPageByDocY(docY0, pages, gap)
    const page = pages[pageIndex]
    if (!page) { this.setFormatPainterActive(false); return }

    const offsetX = pageCenteringOffset(page.width, this.container.clientWidth, scale)
    const docX = docX0 - offsetX / scale

    const nodeId = this.draw.getHitTestIndex().hitTest(docX, localY, pageIndex)
    if (nodeId) {
      const para = this.findParagraphContaining(nodeId)
      if (para) {
        // 定位光标到目标位置 + 清除旧选区, 确保 document:changed 触发 contentChange 时
        // getTextStyle() 读到的是目标段落的格式, 而非旧光标位置
        const cursorOffset = this.computeOffsetAtX(para, docX, localY, page)
        const paraPath = [this.doc.id, para.id]
        setCursor(this.store, paraPath, cursorOffset)
        // 同步清除选区 — anchor/focus 跟随新光标位置, active=false
        const si = this.store as unknown as {
          _state: { runtime: { selection: { anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean }; active: boolean; granularity: string } } }
        }
        si._state.runtime.selection = {
          anchor: { paragraphPath: [...paraPath], offset: cursorOffset, visible: false },
          focus: { paragraphPath: [...paraPath], offset: cursorOffset, visible: false },
          active: false,
          granularity: 'character',
        }
        // applyFormatPainter 内部 commandManager.execute → document:changed → recomputeLayout + render
        // → notifyListeners('contentChange') → 工具栏读取当前光标位置格式 = 目标段落的新格式 ✓
        this.applyFormatPainter(para.id, this._formatPainterStyle)
      }
    }

    // 单次使用后退出: setFormatPainterActive 内部会同步通知 React 层
    this.setFormatPainterActive(false)

    // 刷新光标位置 (applyFormatPainter 内已通过 document:changed 触发 render, 此处 render 确保光标正确显示)
    this.draw.render(this.pool, this.store.state.runtime)
  }

  private onFormatPainterChange: ((active: boolean) => void) | null = null

  /** 注册格式刷状态变更回调 (供 React 层同步) */
  setOnFormatPainterChange(cb: (active: boolean) => void): void {
    this.onFormatPainterChange = cb
  }

  private notifyFormatPainterChange(active: boolean): void {
    this.onFormatPainterChange?.(active)
  }

  /** 格式刷: 将样式应用到目标段落的所有文本节点 (TASK-472) */
  applyFormatPainter(paraId: string, style: Record<string, unknown>): void {
    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return
    const nodeIds: string[] = []
    for (const cid of para.children) {
      const n = this.pool.nodes.get(cid) as { type?: string } | undefined
      if (n?.type === 'text') nodeIds.push(cid)
    }
    if (nodeIds.length === 0) return
    const cmd = new FormatPainterCommand(
      generateCommandId(), Date.now(), 'user',
      nodeIds,
      style as Partial<import('./document/DocumentModel').TextStyle>,
    )
    this.commandManager.execute(cmd)
  }

  /** 设置光标/选区段落的格式 (对齐/缩进/列表) — v20.35 支持跨段落选区 */
  setParagraphStyle(style: Partial<import('./document/DocumentModel').ParagraphStyle>): void {
    const paraIds = this.getSelectedParagraphIds()
    if (paraIds.length === 0) return
    const ts = Date.now()
    for (const paraId of paraIds) {
      const cmd = new ParagraphStyleCommand(
        generateCommandId(), ts, 'user',
        [paraId], style,
      )
      this.commandManager.execute(cmd)
    }
  }

  /** 调整选中段落的缩进 (逐段独立计算, 支持跨段落选区) */
  adjustIndent(delta: number): void {
    const paraIds = this.getSelectedParagraphIds()
    if (paraIds.length === 0) return
    const ts = Date.now()
    for (const paraId of paraIds) {
      const para = this.pool.nodes.get(paraId) as { indent?: number } | undefined
      const cur = para?.indent ?? 0
      const newIndent = Math.max(0, cur + delta)
      const cmd = new ParagraphStyleCommand(
        generateCommandId(), ts, 'user',
        [paraId], { indent: newIndent },
      )
      this.commandManager.execute(cmd)
    }
  }

  /**
   * 调整列表嵌套层级
   * - 列表段落: delta>0 增加 level (Tab), delta<0 减少 level (Shift+Tab)
   * - level<1 时移除列表 (取消列表)
   * - 非列表段落: 回退到 adjustIndent 行为
   */
  adjustListLevel(delta: number): void {
    const paraIds = this.getSelectedParagraphIds()
    if (paraIds.length === 0) return
    const ts = Date.now()
    for (const paraId of paraIds) {
      const para = this.pool.nodes.get(paraId) as {
        list?: { type: 'bullet' | 'ordered'; level?: number; numberStyle?: string }
        indent?: number
      } | undefined
      if (para?.list) {
        if (delta > 0) {
          // Tab: 增加嵌套层级
          const newLevel = (para.list.level || 1) + delta
          const cmd = new ParagraphStyleCommand(
            generateCommandId(), ts, 'user',
            [paraId], { list: { ...para.list, level: newLevel } as import('./document/DocumentModel').ListStyle, indent: 0 },
          )
          this.commandManager.execute(cmd)
        } else {
          // Shift+Tab: 减少嵌套层级
          const currentLevel = para.list.level || 1
          const newLevel = currentLevel + delta // delta 为负值
          if (newLevel < 1) {
            // 取消列表: 移除 list 属性
            const cmd = new ParagraphStyleCommand(
              generateCommandId(), ts, 'user',
              [paraId], { list: undefined, indent: 0 },
            )
            this.commandManager.execute(cmd)
          } else {
            const cmd = new ParagraphStyleCommand(
              generateCommandId(), ts, 'user',
              [paraId], { list: { ...para.list, level: newLevel } as import('./document/DocumentModel').ListStyle, indent: 0 },
            )
            this.commandManager.execute(cmd)
          }
        }
      } else {
        // 非列表段落: 保持原有的像素缩进行为
        const cur = para?.indent ?? 0
        const newIndent = Math.max(0, cur + delta * 24)
        const cmd = new ParagraphStyleCommand(
          generateCommandId(), ts, 'user',
          [paraId], { indent: newIndent },
        )
        this.commandManager.execute(cmd)
      }
    }
  }

  /** 获取光标处文本样式 (供 Toolbar 状态同步) */
  getTextStyle(): {
    font?: string; size?: number
    bold?: boolean; italic?: boolean; underline?: boolean
    underlineStyle?: 'single' | 'double' | 'wave'
    strikeout?: boolean; superscript?: boolean; subscript?: boolean
    color?: string; highlight?: string; letterSpacing?: number
  } | null {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return null
    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]

    // 读取段落 outlineLevel: LayoutEngine 对标题强制加粗+缩放字号 (见 HEADING_SCALE)
    const para = this.pool.nodes.get(paraId) as { children?: string[]; outlineLevel?: number } | undefined
    const outlineLevel = para?.outlineLevel ?? 0
    const isHeading = outlineLevel > 0
    const HEADING_SCALE: Record<number, number> = { 1: 2.0, 2: 1.5, 3: 1.25, 4: 1.125, 5: 1.0, 6: 0.875 }
    const headingScale = isHeading ? (HEADING_SCALE[outlineLevel] ?? 1) : 1

    const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
    let tn: { font?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; underlineStyle?: 'single' | 'double' | 'wave'; strikeout?: boolean; superscript?: boolean; subscript?: boolean; color?: string; highlight?: string; letterSpacing?: number } | undefined
    if (resolved) {
      tn = this.pool.nodes.get(resolved.textNodeId) as typeof tn
    } else {
      // 光标在段尾 → 取最后一个 text node 的样式
      const paraChildren = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
      if (paraChildren?.children) {
        for (let i = paraChildren.children.length - 1; i >= 0; i--) {
          const n = this.pool.nodes.get(paraChildren.children[i]) as { type?: string } & typeof tn
          if (n?.type === 'text') { tn = n; break }
        }
      }
    }
    if (!tn) return null
    // 标题: LayoutEngine 渲染时强制 bold=true + 缩放字号, 工具栏必须同步反映
    const baseSize = tn.size || 16
    return {
      font: tn.font,
      size: isHeading ? Math.round(baseSize * headingScale) : tn.size,
      bold: isHeading ? true : tn.bold,
      italic: tn.italic,
      underline: tn.underline,
      underlineStyle: tn.underlineStyle,
      strikeout: tn.strikeout,
      superscript: tn.superscript,
      subscript: tn.subscript,
      color: tn.color,
      highlight: tn.highlight,
      letterSpacing: tn.letterSpacing,
    }
  }

  /** 获取光标/选区首段落的格式 (供 Toolbar active 状态) */
  getParagraphStyle(): { alignment?: string; listType?: string; listLevel?: number; numberStyle?: string; continueNumbering?: boolean; indent?: number; outlineLevel?: number } | null {
    const paraIds = this.getSelectedParagraphIds()
    if (paraIds.length === 0) return null
    const paraId = paraIds[0]
    const para = this.pool.nodes.get(paraId) as Record<string, unknown> | undefined
    if (!para) return null
    return {
      alignment: para.alignment as string | undefined,
      listType: para.list ? (para.list as { type: string }).type : undefined,
      listLevel: para.list ? (para.list as { level?: number }).level : undefined,
      numberStyle: para.list ? (para.list as { numberStyle?: string }).numberStyle : undefined,
      continueNumbering: para.list ? (para.list as { continueNumbering?: boolean }).continueNumbering : undefined,
      indent: para.indent as number | undefined,
      outlineLevel: para.outlineLevel as number | undefined,
    }
  }

  /** 收集当前选区涉及的所有段落 ID */
  private getSelectedParagraphIds(): string[] {
    const selection = this.store.state.runtime.selection
    const cursor = this.store.state.runtime.cursor

    if (selection.active) {
      const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
      const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]
      if (anchorParaId && focusParaId && anchorParaId !== focusParaId) {
        const bodyChildren = this.doc.body.children
        const aIdx = bodyChildren.indexOf(anchorParaId)
        const fIdx = bodyChildren.indexOf(focusParaId)
        if (aIdx >= 0 && fIdx >= 0) {
          const lo = Math.min(aIdx, fIdx)
          const hi = Math.max(aIdx, fIdx)
          const ids: string[] = []
          for (let i = lo; i <= hi; i++) ids.push(bodyChildren[i])
          return ids
        }
      }
    }

    // 单段落: 光标所在段落
    if (cursor.paragraphPath.length === 0) return []
    return [cursor.paragraphPath[cursor.paragraphPath.length - 1]]
  }

  /** 全选: 选区覆盖整篇文档所有段落 */
  selectAll(): void {
    const bodyChildren = this.doc.body.children
    if (bodyChildren.length === 0) return
    const firstParaId = bodyChildren[0]
    const lastParaId = bodyChildren[bodyChildren.length - 1]
    const lastPara = this.pool.nodes.get(lastParaId) as unknown as { children?: string[] } | undefined
    const totalLen = lastPara ? this.getParagraphTextLength(lastPara as unknown as Paragraph) : 0
    const si = this.store as unknown as {
      _state: { runtime: { selection: { anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean }; active: boolean; granularity: string } } }
    }
    si._state.runtime.selection = {
      anchor: { paragraphPath: [this.doc.id, firstParaId], offset: 0, visible: false },
      focus: { paragraphPath: [this.doc.id, lastParaId], offset: totalLen, visible: false },
      active: true,
      granularity: 'character',
    }
    this.draw.render(this.pool, this.store.state.runtime)
  }

  getEventBus(): EventBus { return this.eventBus }
  getDraw(): Draw { return this.draw }
  getPool(): NodePool { return this.pool }
  getInputComposer(): InputComposer { return this.inputComposer }
  getKeyboardHandler(): KeyboardHandler { return this.keyboardHandler }
  getStore(): EditorStore { return this.store }

  setRuntimeState(state: EditorRuntimeState): void { this.draw.setRuntimeState(state) }
  setScale(scale: number): void { this.draw.setScale(scale) }
  /** 获取字数统计 (R36) */
  getWordCount(): { chars: number; words: number; paragraphs: number; selectedChars?: number; selectedWords?: number } {
    let chars = 0
    let words = 0
    const bodyChildren = this.doc.body.children

    for (const childId of bodyChildren) {
      const node = this.pool.nodes.get(childId)
      if (!node) continue
      const n = node as { type?: string; children?: string[] }

      if (n.type === 'paragraph' && n.children) {
        for (const cid of n.children) {
          const cn = this.pool.nodes.get(cid) as { type?: string; text?: string } | undefined
          if (cn?.type === 'text' && cn.text) {
            const t = cn.text
            chars += [...t].length  // 字符数 (含CJK)
            // 英文单词数: 按空白/标点分割
            words += (t.match(/[\w一-鿿]+/g) || []).length
          }
        }
      }
    }

    const paragraphs = bodyChildren.filter(id => {
      const n = this.pool.nodes.get(id)
      return n && (n as { type?: string }).type === 'paragraph'
    }).length

    // 选区统计
    let selectedChars: number | undefined
    let selectedWords: number | undefined
    const sel = this.store.state.runtime.selection
    if (sel.active) {
      const anchorParaId = sel.anchor.paragraphPath[sel.anchor.paragraphPath.length - 1]
      const focusParaId = sel.focus.paragraphPath[sel.focus.paragraphPath.length - 1]
      if (anchorParaId === focusParaId) {
        const start = Math.min(sel.anchor.offset, sel.focus.offset)
        const end = Math.max(sel.anchor.offset, sel.focus.offset)
        const nodeIds = this.collectTextNodeIds(anchorParaId, start, end)
        let selText = ''
        for (const nid of nodeIds) {
          const n = this.pool.nodes.get(nid) as { text?: string } | undefined
          if (n?.text) selText += n.text
        }
        selectedChars = [...selText].length
        selectedWords = (selText.match(/[\w一-鿿]+/g) || []).length
      }
    }

    return { chars, words, paragraphs, selectedChars, selectedWords }
  }

  /** 设置数字水印 (R35) */
  setWatermark(config: import('./render/LayeredRenderer').WatermarkConfig): void {
    this.draw.setWatermark(config)
  }

  /** 自动更正: IME 输入后检测光标前文本是否需要替换 (R43) */
  private applyAutoCorrect(paragraphPath: string[]): void {
    const paraId = paragraphPath[paragraphPath.length - 1]
    if (!paraId) return

    // 获取段落完整文本
    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return
    let fullText = ''
    for (const cid of para.children) {
      const n = this.pool.nodes.get(cid) as { type?: string; text?: string } | undefined
      if (n?.type === 'text') fullText += n.text || ''
    }

    const cursor = this.store.state.runtime.cursor
    const result = this.autoCorrect.checkAtCursor(fullText, cursor.offset)
    if (!result) return

    // 执行替换: 删除匹配文本 + 插入替换文本
    if (result.end > result.start) {
      this.commandManager.execute(new DeleteRangeCommand(
        generateCommandId(), Date.now(), 'user',
        paragraphPath, result.start, result.end,
      ))
    }
    this.commandManager.execute(new InsertTextCommand(
      generateCommandId(), Date.now(), 'user',
      paragraphPath, result.start, result.replacement,
    ))

    console.debug(`[AutoCorrect] "${fullText.slice(result.start, result.end)}" → "${result.replacement}"`)
  }

  /** 不可见字符显示切换 (TASK-475) */
  setShowInvisible(v: boolean): void { this.draw.showInvisible = v }
  getShowInvisible(): boolean { return this.draw.showInvisible }

  /** 聚焦编辑器 */
  focus(): void { this.inputComposer.focus() }

  // ---- 查找替换 (委托 FindReplaceEngine) ----

  findAll(query: string, options?: FindOptions): MatchResult[] {
    return this.findReplace.findAll(query, this.doc, this.pool, options)
  }

  findNext(query: string, options?: FindOptions): MatchResult | null {
    const cursor = this.store.state.runtime.cursor
    return this.findReplace.findNext(query, cursor.paragraphPath, cursor.offset, this.doc, this.pool, options)
  }

  findPrevious(query: string, options?: FindOptions): MatchResult | null {
    const cursor = this.store.state.runtime.cursor
    return this.findReplace.findPrevious(query, cursor.paragraphPath, cursor.offset, this.doc, this.pool, options)
  }

  replace(query: string, replacement: string, result: MatchResult, options?: FindOptions): void {
    const replaced = this.findReplace.replace(query, replacement, result, this.doc, this.pool, options)
    if (replaced) {
      const si = this.store as unknown as { _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean } } } }
      si._state.runtime.cursor = { paragraphPath: replaced.paragraphPath, offset: replaced.offset, visible: true }
      this.draw.render(this.pool, this.store.state.runtime)
    }
  }

  replaceAll(query: string, replacement: string, options?: FindOptions): number {
    const count = this.findReplace.replaceAll(query, replacement, this.doc, this.pool, options)
    if (count > 0) {
      this.draw.recomputeLayout(this.pool)
      this.draw.render(this.pool, this.store.state.runtime)
    }
    return count
  }

  highlightAll(query: string, options?: FindOptions): MatchResult[] {
    return this.findReplace.highlightAll(query, this.doc, this.pool, options)
  }

  /** 为打印准备页面 — 返回每页 canvas dataURL 数组 */
  preparePrintPages(): string[] {
    const pages = this.draw.getPages()
    const result: string[] = []
    const dpr = window.devicePixelRatio || 1

    for (const page of pages) {
      const canvas = document.createElement('canvas')
      canvas.width = page.width * dpr
      canvas.height = page.height * dpr
      const pctx = canvas.getContext('2d')
      if (!pctx) continue

      pctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      pctx.fillStyle = '#FFFFFF'
      pctx.fillRect(0, 0, page.width, page.height)

      // 渲染页面内容 (复用现有渲染管线)
      this.draw.renderPageToContext(pctx, page, page.width)
      result.push(canvas.toDataURL('image/png'))
    }
    return result
  }

  /** 插入交叉引用 — 在当前光标位置创建 CrossReferenceNode */
  insertCrossReference(targetId: string, refType: string, displayText: string): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const refId = generateCommandId()
    const refNode: BaseNode = {
      type: 'cross_reference' as const, id: refId,
      refType, targetRef: targetId, displayText,
      font: 'SimSun', size: 16, bold: false, italic: false,
      underline: true, color: '#2563EB',  // 蓝色下划线表示链接
    } as unknown as BaseNode
    this.pool.nodes.set(refId, refNode)

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const para = this.pool.nodes.get(paraId) as { children?: string[] }
    if (para?.children) {
      const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
      if (resolved) {
        const idx = para.children.indexOf(resolved.textNodeId)
        if (idx >= 0) para.children.splice(idx + 1, 0, refId)
        else para.children.push(refId)
      } else {
        para.children.push(refId)
      }
    }

    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 插入分节符 — 在当前段落后创建 SectionBreak */
  insertSectionBreak(): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const breakId = generateCommandId()
    const breakNode: BaseNode = {
      type: 'section_break' as const, id: breakId,
      breakType: 'next_page' as const,
      nextPageSetup: { ...this.doc.pageSetup },
    } as unknown as BaseNode
    this.pool.nodes.set(breakId, breakNode)

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const idx = this.doc.body.children.indexOf(paraId)
    if (idx >= 0) {
      this.doc.body.children.splice(idx + 1, 0, breakId)
    } else {
      this.doc.body.children.push(breakId)
    }

    // 分节符后创建空段落, 光标落到新页/新节, 确保可继续书写 (与 insertTable 一致)
    const trailParaId = this.createTrailingParagraph()
    this.doc.body.children.splice(
      this.doc.body.children.indexOf(breakId) + 1, 0, trailParaId,
    )
    setCursor(this.store, [this.doc.id, trailParaId], 0)

    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 注册演示插件 (验证 PluginManager 系统) */
  getPluginManager(): PluginManager { return this.pluginManager }

  destroy(): void {
    this.listeners = []
    this.container.removeEventListener('click', this._clickToFocus)
    this.container.removeEventListener('mouseup', this._onMouseUp)
    window.removeEventListener('focus', this._onWindowFocus)
    document.removeEventListener('visibilitychange', this._onVisibilityChange)
    this.keyboardHandler.destroy()
    this.mouseHandler.destroy()
    this.inputComposer.destroy()
    this.draw.destroy()
    this.autoSave.destroy()
  }

  /** 获取 AutoSaveManager (供页面卸载时立即保存) */
  getAutoSave(): AutoSaveManager { return this.autoSave }
  getPerfMetrics(): PerformanceMetrics { return this.perfMetrics }

  on(event: EditorEventType, cb: (...args: unknown[]) => void): void {
    this.listeners.push({ event, callback: cb })
  }
  off(event: EditorEventType, cb: (...args: unknown[]) => void): void {
    this.listeners = this.listeners.filter(l => !(l.event === event && l.callback === cb))
  }
  private notifyListeners(event: EditorEventType, ...args: unknown[]): void {
    this.listeners.filter(l => l.event === event).forEach(l => {
      try { l.callback(...args) } catch (err) { console.error(`[Editor] "${event}" listener error:`, err) }
    })
  }
}

export type EditorEventType = 'ready' | 'contentChange' | 'modeChange' | 'selectionChange' | 'save'
export interface EditorListener { event: EditorEventType; callback: (...args: unknown[]) => void }

/** IEditor 公共 API (SDK 集成面) */
export interface IEditor {
  getDocument(): DocumentTree
  setDocument(doc: DocumentTree): void
  execCommand(command: ICommand): void
  undo(): void; redo(): void
  canUndo(): boolean; canRedo(): boolean
  copy(): void; paste(): void
  toggleFormat(style: Partial<import('./document/DocumentModel').TextStyle>): void
  setParagraphStyle(style: Partial<import('./document/DocumentModel').ParagraphStyle>): void
  getWordCount(): { chars: number; words: number; paragraphs: number; selectedChars?: number; selectedWords?: number }
  on(event: EditorEventType, cb: (...args: unknown[]) => void): void
  off(event: EditorEventType, cb: (...args: unknown[]) => void): void
  destroy(): void
}
