import type { DocumentTree, BaseNode, Paragraph, ImageNode, HeaderFooterConfig, ElementMeta, WatermarkConfig, DocumentMetadata } from './document/core/DocumentModel'
import { DEFAULT_HEADER_FOOTER_CONFIG } from './document/core/DocumentModel'
import { createDocument, createParagraph, createTextNode, extractStyle, uniformTextStyle, createFieldNode, createSeparatorNode, createFootnoteRef, createFootnoteContent } from './document/factory/ElementFormatter'
import { NodePool, buildNodePool } from './document/core/NodePool'
import { serializeDocument } from './document/io/DocumentSerializer'
import { loadDocumentFromObject } from './document/io/DocumentLoader'
import type { FieldType } from './document/core/DocumentModel'
import { Draw } from './render/Draw'
import type { EditorHost } from './host/EditorHost'
import { AutoSaveManager } from './AutoSaveManager'
import { AutoCorrectEngine } from './AutoCorrectEngine'
import { PerformanceMetrics } from './PerformanceMetrics'
import { PluginManager } from './plugins/PluginManager'
import { EventBus } from './interaction/EventBus'
import { CommandManager } from './command/CommandManager'
import { InputComposer } from './interaction/IMEHandler'
import { KeyboardHandler } from './interaction/KeyboardHandler'
import { MouseHandler } from './interaction/MouseHandler'
import { FormatPainter } from './format/FormatPainter'
import type { ICommand } from './command/ICommand'
import { generateCommandId } from './command/ICommand'
import { InsertTextCommand } from './command/commands/InsertTextCommand'
import { InsertNodesCommand } from './command/commands/InsertNodesCommand'
import { DeleteRangeCommand } from './command/commands/DeleteRangeCommand'
import { FormatTextRangeCommand } from './command/commands/FormatTextCommand'
import { ParagraphStyleCommand } from './command/commands/ParagraphStyleCommand'
import { SetHeaderFooterConfigCommand } from './command/commands/HeaderFooterConfigCommand'
import { MergeParagraphCommand } from './command/commands/MergeParagraphCommand'
import { ClipboardManager } from './command/ClipboardManager'
import { EditorStore } from './state/EditorStore'
import type { EditorRuntimeState, SelectionState, CursorState } from './state/EditorRuntimeState'
import { FindReplaceEngine } from './FindReplaceEngine'
import type { FindOptions, MatchResult } from './FindReplaceEngine'
import { computeOffsetInItems } from './layout/text/CharWidthHelper'
import { FontManager } from './layout/text/FontManager'
import { TextMeasurer } from './layout/text/TextMeasurer'
import { resolveCellPosition, getCaretScope, resolveParagraphRegion, resolveSiblingRange } from './state/CaretScope'
import type { CellPosition } from './state/CaretScope'
import { screenToDoc, findPageByDocY, pageCenteringOffset } from './layout/table/TableCoordUtil'
import { findControlItemAt } from './interaction/ControlHitTest'
import { buildContextSnapshot } from './context/EditorContext'
import type { EditorContextSnapshot } from './context/EditorContext'
import { insertRow, deleteRow, insertColumn, deleteColumn, getCellGridPosition, mergeAdjacentCells, mergeRange, splitCell } from './document/table/TableOps'
import type { CellRange } from './document/table/TableOps'
import {
  collectTextNodeIds, collectSelectionSegments,
  paragraphTextLength, findFirstTextNodeInRange,
  flattenTextContainers, selectionSpine, sectionOf, regionSpine,
} from './document/selection/SelectionCollector'
import type { FormatRange } from './document/selection/SelectionCollector'
import {
  InsertInlineNodeCommand, InsertBlockCommand, InsertFootnoteCommand,
  CreateCommentCommand, AddCommentReplyCommand, ResolveCommentCommand,
  SetPageSetupCommand, TableStructureCommand, EnsureHeaderFooterParagraphCommand,
  EnsureBodyParagraphCommand, RemoveNodesCommand,
} from './command/commands/StructuralCommands'
import { InsertImageCommand } from './command/commands/InsertImageCommand'
import { ReplaceTextCommand } from './command/commands/ReplaceTextCommand'
import type { ReplaceRejection } from './command/commands/ReplaceTextCommand'
import { RemoveControlCommand } from './command/commands/RemoveControlCommand'
import { InsertControlCommand } from './command/commands/InsertControlCommand'
import { UpdateControlDefinitionCommand } from './command/commands/UpdateControlDefinitionCommand'
import { UpdateControlElementCommand, elementEquals, definitionEquals } from './command/commands/UpdateControlElementCommand'
import { UpdateDocumentPropertiesCommand } from './command/commands/UpdateDocumentPropertiesCommand'
import { UpdateDocumentTitleCommand } from './command/commands/UpdateDocumentTitleCommand'
import { TemplateDefinitionStore } from './template/TemplateDefinition'
import type { TemplateDefinition, ControlType } from './template/TemplateDefinition'
import type { PresentationStyleStore } from './render/presentation/PresentationStyle'
import type { DictionaryProvider } from './document/control/Dictionary'
import { NodeType } from './document/core/DocumentModel'
import type { ControlValue, ElementEnumOption, SmartTextNode } from './document/core/DocumentModel'
import { SetControlValueCommand } from './command/commands/SetControlValueCommand'
import { validateControlValue, isControlValueEmpty } from './document/control/ControlValue'
import type { ControlValueValidationResult, ControlValuePermissions } from './document/control/ControlValue'

/**
 * 比较两份 DocumentMetadata 是否语义相等 (键序无关; keywords 数组有序)。
 * 供 applyDocumentProperties 判定「无变化」时跳过命令 (契约 §7.8: 无变化不产生命令)。
 */
function metadataEquals(a: DocumentMetadata | undefined, b: DocumentMetadata | undefined): boolean {
  const ka = a ? Object.keys(a).sort() : []
  const kb = b ? Object.keys(b).sort() : []
  if (ka.length !== kb.length) return false
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false
    const k = ka[i] as keyof DocumentMetadata
    const av = a?.[k]
    const bv = b?.[k]
    if (Array.isArray(av) || Array.isArray(bv)) {
      if (!Array.isArray(av) || !Array.isArray(bv) || av.length !== bv.length) return false
      for (let j = 0; j < av.length; j++) if (av[j] !== bv[j]) return false
    } else if (av !== bv) return false
  }
  return true
}

/**
 * 控件运行时快照 (契约 §12.6) — 供 React runtime overlay 一次性读取
 * 某 smarttext 控件的全部渲染/交互所需投影, 避免 overlay 直接触碰
 * DocumentModel / NodePool / TemplateDefinition 内部结构 (边界不越界)。
 *
 * 投影字段正交 (契约 §12.1): controlType/dataType/showType/enums 各读
 * 各层, 不做反向推导。controlType 缺失 (旧文档) 时保留 undefined,
 * 由表现层按 (dataType/enums) 落一个「仅表现」的 fallback —— 不写回语义层。
 */
export interface ControlSnapshot {
  nodeId: string
  /** 占位符 (未填显示形式, SmartTextNode.text) */
  placeholder: string
  /** 运行时值 (undefined = 未填, 规范空态 §12.6.1) */
  value: ControlValue | undefined
  /** widget 形态 (TemplateDefinition.controlType, 插入或配置弹框写定, 旧文档可缺省) */
  controlType: ControlType | undefined
  /** 数据取值类型 (ElementFormat.dataType) */
  dataType: 'S1' | 'S2' | 'S3' | 'N' | 'D' | undefined
  /** 展示形态 (ElementFormat.showType) */
  showType: 'AN' | 'N' | undefined
  /** 解析后的枚举候选 (inline enums 优先, 否则外部字典候选 §12.6 VR-7) */
  options: readonly ElementEnumOption[] | undefined
  /** 是否多选 (inline enums.multiple === true; 字典无 multiple 恒为单选) */
  multiple: boolean
  /** 枚举是否允许手输自定义值 (inline enums.editable) */
  enumEditable: boolean | undefined
  /** 是否可写 (§12.6.3 layer B: TemplateDefinition.editable !== false 且 ElementMeta.readonly !== true) */
  writable: boolean
  /** 多行文本最小行数 (format.minRows) */
  minRows: number | undefined
  /** 数值精度 (format.scale) */
  scale: number | undefined
  /** 字符串长度约束 (format.minLength/maxLength) */
  minLength: number | undefined
  maxLength: number | undefined
  /** 是否隐私脱敏 (Canvas 掩码时 overlay 不得泄露明文 §12.6 隐私) */
  masked: boolean
  /** 控件旁标签 / 悬浮提示 (TemplateDefinition) */
  label: string | undefined
  tips: string | undefined
}

/** Editor: 引擎编排器 (架构 §3, v20.34) */
export class Editor {
  private detachContainer: () => void
  private detachGlobal: () => void
  private doc: DocumentTree
  private pool: NodePool
  private draw: Draw
  private eventBus: EventBus
  private commandManager: CommandManager
  private store: EditorStore
  private inputComposer: InputComposer
  private keyboardHandler: KeyboardHandler
  private mouseHandler: MouseHandler
  private formatPainter: FormatPainter
  private clipboard: ClipboardManager
  private findReplace: FindReplaceEngine
  private autoSave: AutoSaveManager
  private autoCorrect: AutoCorrectEngine
  private perfMetrics: PerformanceMetrics
  private pluginManager: PluginManager
  private readonly host: EditorHost
  private readonly fontManager: FontManager
  private readonly measurer: TextMeasurer
  // 表格单元格选择
  private _selectedTableId: string | null = null
  private _selectedCellRow = -1
  private _selectedCellCol = -1
  // 单元格框选范围 (网格坐标)
  private _cellRange: CellRange | null = null
  private listeners: EditorListener[] = []
  // 模板设计期属性 (契约 §12.1) + 表现层样式 (契约 §2.2) — per-editor 实例状态 (§7.6)
  private templateDefinitions: TemplateDefinitionStore | null = null
  private presentationStyles: PresentationStyleStore | null = null
  private dictionaries: DictionaryProvider | null = null
  private _clickToFocus: (e: MouseEvent) => void
  private _onWindowFocus: () => void
  private _onVisibilityChange: () => void

  constructor(host: EditorHost, doc?: DocumentTree) {
    this.host = host
    this.fontManager = new FontManager(host)
    this.measurer = new TextMeasurer(host, this.fontManager)
    // 创建默认空文档
    if (!doc) {
      const d = createDocument('未命名文档')
      const para = createParagraph()
      d.body.children = [para.id]
      doc = d
      const allNodes = new Map<string, BaseNode>()
      allNodes.set(d.id, d as unknown as BaseNode)
      allNodes.set(para.id, para)
      this.doc = doc
      this.pool = buildNodePool(allNodes, { body: d.id })
    } else {
      this.doc = doc
      this.pool = loadDocumentFromObject(doc).pool
    }

    this.eventBus = new EventBus()
    this.draw = new Draw(host, this.eventBus, this.measurer, this.doc)
    this.store = new EditorStore(this.doc)
    // 光标/选区移动后实时同步段落/文本样式投影 (工具栏联动), 单一 choke point
    this.store.onCursorOrSelectionChange(() => this.syncStyleProjections())
    this.inputComposer = new InputComposer(host)
    this.keyboardHandler = new KeyboardHandler(this, host)
    this.mouseHandler = new MouseHandler(this, host, this.measurer)
    this.formatPainter = new FormatPainter(this, host)
    this.clipboard = new ClipboardManager(host.platform.clipboard)
    this.findReplace = new FindReplaceEngine()
    this.autoSave = new AutoSaveManager(doc.id, doc.title || '未命名文档', () => this.getSerializedDocument(), host.platform.storage)
    this.autoCorrect = new AutoCorrectEngine()
    this.perfMetrics = new PerformanceMetrics(host)
    this.pluginManager = new PluginManager()
    // 自动保存: 保存状态同步到 EditorStore
    this.autoSave.onSave((type) => {
      if (type === 'saving') this.store.setSaveStatus('saving')
      else if (type === 'saved') this.store.setSaveStatus('saved')
      else if (type === 'error') this.store.setSaveStatus('error')
    })
    // 初始化持久化存储 (异步, 不阻塞构造函数)
    this.autoSave.init().catch(err => console.warn('[AutoSave] storage init failed:', err))
    this.commandManager = new CommandManager(
      this.eventBus,
      () => this.doc,
      () => this.pool,
      () => this.templateDefinitions ?? undefined,
      () => this.dictionaries ?? undefined,
    )

    // 状态变更 → 仅更新 Store, 不渲染
    // 渲染统一由 document:changed 在 recomputeLayout 后触发
    // 确保 render() 始终使用最新的 SLIF 布局 + 最新的光标状态
    this.eventBus.on('state:changed', (patch) => {
      if (patch.cursor) this.store.updateRuntime({ cursor: { ...this.store.state.runtime.cursor, ...patch.cursor, visible: true } })
      if (patch.selection) this.store.updateRuntime({ selection: { ...this.store.state.runtime.selection, ...patch.selection } })
      this.store.setDirty(true)
      // 同步撤销/重做投影 — 事务 (beginMacro/endMacro) 的 endMacro 会在 macro 入栈后
      // 补发 state:changed, 因子命令在事务内已各自 emit 而当时 macro 尚未入栈, 导致
      // history 深度滞后; 此处统一兜底同步, 保证 store.history 反映真实栈深 (RULE 9)。
      this.syncHistoryState()
    })

    // document:changed → 重布局 + 重绘 + 自动保存标记 + 工具栏同步 (唯一渲染入口)
    this.eventBus.on('document:changed', (payload: { invalidation: import('./command/ICommand').InvalidationScope }) => {
      this.commitDocumentChange(payload.invalidation)
    })

    // render:request (undo/redo 等) → 使用当前的 pool 和 state
    this.eventBus.on('render:request', () => {
      this.draw.recomputeLayout(this.pool)
      this.draw.render(this.pool, this.store.state.runtime)
      this.syncHistoryState()
      this.syncUiProjections()
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
      // 空文档 → 自动创建段落 (与 KeyboardHandler 保持一致, 经 Command RULE 4)
      if (cursor.paragraphPath.length === 0) {
        this.commandManager.execute(new EnsureBodyParagraphCommand(generateCommandId(), Date.now(), 'user'))
        cursor = this.store.state.runtime.cursor
      }
      // 获取光标处文本样式 (段尾回退到末尾节点)
      let activeStyle: import('./document/core/DocumentModel').TextStyle | undefined
      const resolved = this.pool.resolveCharOffset(cursor.paragraphPath[cursor.paragraphPath.length - 1], cursor.offset)
      if (resolved) {
        const tn = this.pool.nodes.get(resolved.textNodeId) as unknown as Record<string, unknown> | undefined
        if (tn) activeStyle = extractStyle(tn as unknown as import('./document/core/DocumentModel').TextNode)
      } else {
        const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
        const para = this.pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
        if (para?.children) {
          for (let i = para.children.length - 1; i >= 0; i--) {
            const n = this.pool.nodes.get(para.children[i]) as { type?: string } | undefined
            if (n?.type === 'text') { activeStyle = extractStyle(n as unknown as import('./document/core/DocumentModel').TextNode); break }
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
    this.store.setCursor({ paragraphPath: cursorPath, offset: 0, visible: true })

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
    // 容器事件: click (聚焦+命中) + mouseup (格式刷, 优于 click 因先触发)
    this.detachContainer = this.host.input.attachContainer({
      click: this._clickToFocus,
      mouseup: this.formatPainter.onMouseUp,
    })

    // 外部剪贴板同步: 用户切到外部应用复制后回到编辑器,
    // 焦点/可见性变化时读取系统剪贴板, 覆盖内存里的旧数据。
    this._onWindowFocus = () => { this.syncExternalClipboard() }
    this._onVisibilityChange = () => {
      if (this.host.input.isVisible()) this.syncExternalClipboard()
    }
    this.detachGlobal = this.host.input.attachGlobal({
      focus: this._onWindowFocus,
      visibilitychange: this._onVisibilityChange,
    })

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
    this.syncHistoryState()
    this.store.setDocumentTitle(this.doc.title)
    this.notifyListeners('contentChange', this.doc)
  }

  /**
   * 同步撤销/重做栈深度到 EditorStore.runtime.history (canonical owner, §7.2)。
   * 在 document:changed (执行命令) 与 render:request (undo/redo) 后调用。
   */
  private syncHistoryState(): void {
    this.store.updateRuntime({
      history: {
        canUndo: this.commandManager.canUndo(),
        canRedo: this.commandManager.canRedo(),
        undoDepth: this.commandManager.undoStack.getUndoDepth(),
        redoDepth: this.commandManager.undoStack.getRedoDepth(),
      },
    })
  }

  /**
   * 同步 UI 投影到 EditorStore — 文档/光标/选区变化后调用。
   *
   * paragraphStyle / textStyle / headerFooterConfig 的 canonical owner 是 DocumentTree,
   * EditorStore 仅保存 UI 读取投影 (见 EditorStoreState 字段注释)。因 Editor.setDocument
   * 不更新 store.document, 这些投影必须由 Editor 显式同步。
   */
  private syncUiProjections(): void {
    this.syncStyleProjections()
    this.store.setHeaderFooterConfig(this.getHeaderFooterConfig())
  }

  /** 同步段落/文本样式投影 — 文档/光标/选区变化后调用 (工具栏联动) */
  private syncStyleProjections(): void {
    this.store.setParagraphStyle(this.getParagraphStyle())
    this.store.setTextStyle(this.getTextStyle())
  }

  /** 点击命中检测 → 更新光标到点击位置 */
  private handleClick(e: MouseEvent): void {
    // 页眉页脚编辑模式下, 光标定位已在 MouseHandler.onMouseDown 中完成,
    // 此处不再重复处理 (避免 hitTestIndex 在 body items 中误命中)
    if (this.draw.isHeaderFooterEditActive()) return

    // 格式刷激活时: 点击 = 应用格式到目标段落 (TASK-472)
    if (this.formatPainter.isActive) {
      this.formatPainter.applyToClickTarget(e)
      return
    }

    const hit = this.resolveMouseHit(e)
    if (!hit) return
    const { nodeId, docX, docY, page } = hit

    if (nodeId) {
      const para = this.findParagraphContaining(nodeId)
      if (para) {
        const offset = this.computeOffsetAtX(para, docX, docY, page)
        this.store.setCursor({ paragraphPath: [this.doc.id, para.id], offset, visible: true })
      }
    } else {
      // 未命中 → 判断点击位置相对于内容的位置
      const lastItemBottom = this.getPageContentBottom(page)
      const firstItemTop = this.getPageContentTop(page)

      if (lastItemBottom >= 0 && docY > lastItemBottom) {
        // 点击在所有内容下方 → 光标移到最后一个段落末尾
        const lastParaId = this.findLastParagraphId()
        if (lastParaId) {
          const lastPara = this.pool.nodes.get(lastParaId) as unknown as Paragraph | undefined
          if (lastPara) {
            const endOffset = this.getParagraphTextLength(lastPara)
            this.store.setCursor({ paragraphPath: [this.doc.id, lastParaId], offset: endOffset, visible: true })
          }
        }
      } else if (firstItemTop >= 0 && docY < firstItemTop) {
        // 点击在所有内容上方 → 光标移到第一个段落开头
        const firstParaId = this.findFirstParagraphId()
        if (firstParaId) {
          this.store.setCursor({ paragraphPath: [this.doc.id, firstParaId], offset: 0, visible: true })
        }
      }
      // 行间空白 (在内容范围内但未命中任何 item) → 光标保持原位, 不移动
    }

    // 单击清空选区 (双击/三击已处理选区则跳过)
    if (!this.mouseHandler.wasMultiClick()) {
      this.store.updateSelection({ active: false })
    }

    // 无论命中与否都重绘
    this.draw.render(this.pool, this.store.state.runtime)
  }

  /** 在 pool 中查找包含 nodeId 的 Paragraph */
  findParagraphContaining(nodeId: string): Paragraph | null {
    for (const [, node] of this.pool.nodes) {
      if (node.type === 'paragraph') {
        const para = node as unknown as Paragraph
        if (para.children.includes(nodeId) || nodeId === node.id) return para
      }
    }
    return null
  }

  /** 在 body 中查找第一个段落 ID (跳过 table/separator/section_break), 无则 null */
  private findFirstParagraphId(): string | null {
    const bodyChildren = this.doc.body.children
    for (let i = 0; i < bodyChildren.length; i++) {
      const node = this.pool.nodes.get(bodyChildren[i])
      if (node && node.type === 'paragraph') return bodyChildren[i]
    }
    return null
  }

  /** 在 body 中查找最后一个段落 ID (跳过 table/separator/section_break), 无则 null */
  private findLastParagraphId(): string | null {
    const bodyChildren = this.doc.body.children
    for (let i = bodyChildren.length - 1; i >= 0; i--) {
      const node = this.pool.nodes.get(bodyChildren[i])
      if (node && node.type === 'paragraph') return bodyChildren[i]
    }
    return null
  }

  /**
   * 将鼠标事件解析为「原始命中」— 页面局部坐标 + 命中 nodeId (Level 1)。
   * resolveMouseHit 与 resolveContextAt 共用; 返回 null 表示无页面或目标页面缺失。
   */
  private resolveRawHit(e: MouseEvent): {
    nodeId: string | null
    pageIndex: number
    localX: number
    localY: number
    page: import('./layout/core/SLIF').SLIFPage
  } | null {
    const rect = this.host.viewport.bounds()
    const { scale, scrollY } = this.draw.getCoordinateSystem().transform

    // 屏幕坐标 → 文档坐标 (统一通过 TableCoordUtil, v20.35 修复: 之前缺少 /scale)
    const { x: docX0, y: docY0 } = screenToDoc(e.clientX, e.clientY, scale, scrollY, rect)

    const pages = this.draw.getPages()
    if (pages.length === 0) return null

    // 分页间隙 — 命中检测要把带间隙的文档 Y 反查到正确的 pageIndex + 页面内 localY
    const gap = this.draw.getPageVerticalGap()
    const { pageIndex, localY } = findPageByDocY(docY0, pages, gap)
    const page = pages[pageIndex]
    if (!page) return null

    const viewportW = this.host.viewport.size().width
    const offsetX = pageCenteringOffset(page.width, viewportW, scale)
    const localX = docX0 - offsetX / scale
    // 命中检测 — 可能返回 null (空段落/点击在内容下方)
    const nodeId = this.draw.getHitTestIndex().hitTest(localX, localY, pageIndex)

    return { nodeId, pageIndex, localX, localY, page }
  }

  /**
   * 将鼠标事件解析为文档命中信息 (handleClick 与格式刷 FormatPainter.applyToClickTarget 共用)。
   * 返回 null 表示无页面或目标页面缺失, 调用方据此提前返回。
   * 薄包装: 委托 resolveRawHit, 仅做字段名映射 (保持既有公开签名兼容)。
   */
  resolveMouseHit(e: MouseEvent): {
    nodeId: string | null
    docX: number
    docY: number
    page: import('./layout/core/SLIF').SLIFPage
  } | null {
    const hit = this.resolveRawHit(e)
    if (!hit) return null
    return { nodeId: hit.nodeId, docX: hit.localX, docY: hit.localY, page: hit.page }
  }

  /**
   * 解析右键命中上下文 — 只读编辑器上下文快照 (契约 RULE 10)。
   *
   * 只描述文档/编辑器事实, 不含菜单项、动作或 React 状态; 无副作用。
   * 数据采集: resolveRawHit (坐标变换 + Level 1) → getEntryType / hitTestTable
   * (Level 2) → findControlItemAt (design/edit/form) → 页眉页脚区域边界 →
   * 选区投影, 最终委托纯函数 buildContextSnapshot 判别上下文种类。
   */
  resolveContextAt(e: MouseEvent): EditorContextSnapshot {
    const raw = this.resolveRawHit(e)
    if (!raw) {
      return { kind: 'blank', pageIndex: 0, localX: 0, localY: 0 }
    }
    const { nodeId, pageIndex, localX, localY, page } = raw

    // 1. 页眉/页脚区域 (优先于其他命中)
    let headerFooterSection: 'header' | 'footer' | null = null
    if (localX >= 0 && localX <= page.width) {
      const headerH = page.headerHeight ?? 42
      if (localY >= 0 && localY <= headerH) {
        headerFooterSection = 'header'
      } else {
        const footerH = page.footerHeight ?? 42
        if (localY >= page.height - footerH && localY <= page.height) headerFooterSection = 'footer'
      }
    }

    // 2. 交互模式 (design/edit/form) smarttext 控件命中 — 供右键菜单派生
    //    「属性」动作 (契约 §12.7; 编辑/表单同样可对控件开属性配置)。
    const mode = this.store.state.runtime.view.mode
    const controlId = (mode === 'design' || mode === 'edit' || mode === 'form')
      ? findControlItemAt(page, localX, localY)
      : null

    // 3. Level 1 命中类型
    const hitIndex = this.draw.getHitTestIndex()
    const entryType = nodeId ? hitIndex.getEntryType(pageIndex, nodeId) : null

    // 4. cell / text 命中 (Level 2 或 body 文本)
    let cellPosition: CellPosition | null = null
    let textHit: import('./context/EditorContext').TextHit | null = null

    if (entryType === 'table' && nodeId) {
      const tableItem = hitIndex.getTableItem(pageIndex, nodeId)
      if (tableItem) {
        const tableResult = hitIndex.hitTestTable(tableItem, localX, localY, this.pool, this.doc.id)
        if (tableResult) {
          const paraId = tableResult.paraPath[tableResult.paraPath.length - 1]
          cellPosition = resolveCellPosition(paraId, this.pool)
          if (cellPosition) {
            textHit = {
              paragraphId: paraId,
              paragraphPath: tableResult.paraPath,
              offset: tableResult.offset,
              scope: getCaretScope(tableResult.paraPath, this.pool),
            }
          }
        }
      }
    } else if (nodeId) {
      // 正文文本命中 (nodeId 为 text 节点 id → 反查所属段落)
      const para = this.findParagraphContaining(nodeId)
      if (para) {
        const paraPath = [this.doc.id, para.id]
        textHit = {
          paragraphId: para.id,
          paragraphPath: paraPath,
          offset: this.computeOffsetAtX(para, localX, localY, page),
          scope: getCaretScope(paraPath, this.pool),
        }
      }
    }

    return buildContextSnapshot({
      nodeId,
      entryType,
      pageIndex,
      localX,
      localY,
      headerFooterSection,
      controlId,
      cellPosition,
      textHit,
      siblings: this.resolveHitSiblings(textHit),
      selection: this.store.state.runtime.selection,
    })
  }

  /**
   * 解析命中段落在其作用域内的有序兄弟段落 id (供跨段落选区覆盖判定)。
   * 仅 body / cell 段落返回兄弟数组 (header/footer 命中走 headerFooterRegion 分支,
   * 不参与 isCoversPoint 的 text/cell 覆盖判定)。
   */
  private resolveHitSiblings(textHit: import('./context/EditorContext').TextHit | null): readonly string[] | undefined {
    if (!textHit) return undefined
    const region = resolveParagraphRegion(textHit.paragraphId, this.doc, this.pool)
    if (!region) return undefined
    if (region.type === 'body' || region.type === 'cell') return region.siblings
    return undefined
  }

  /** 根据文档坐标 X/Y 计算段落内的字符偏移 — Phase 5 使用 page.items 直接过滤 */
  computeOffsetAtX(para: Paragraph, docX: number, docY: number, page: import('./layout/core/SLIF').SLIFPage): number {
    // Phase 5: 使用 page.items 直接过滤 (不再需要 getFlatPageItems 展平)
    const related = page.items
      .filter(it => para.children.includes(it.nodeId) || it.nodeId === para.id)
    // items 已按 Y 排序 (LayoutEngine 顺序插入), 此处不需额外 sort
    // 同一行内可能含多个 text item (局部选区格式化会拆分 TextNode),
    // 故越过 item 右边界后需继续检查后续 item, 而非提前返回 (行尾点击定位)。
    return computeOffsetInItems(related, docX, docY, this.measurer)
  }

  /** 计算段落内所有文本节点的总字符数 (文本节点计 text.length, 非文本节点计 1) */
  private getParagraphTextLengthById(paraId: string): number {
    return paragraphTextLength(this.pool, paraId)
  }

  /** 计算段落内所有文本节点的总字符数 (按段落对象) */
  private getParagraphTextLength(para: Paragraph): number {
    return this.getParagraphTextLengthById(para.id)
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
   * 收集选区覆盖的所有文本节点 ID (同段/跨段)。
   * 空选区 (起止重合) 返回空数组。委托 SelectionCollector (§11.2)。
   */
  private collectSelectionTextNodeIds(selection: SelectionState): string[] {
    const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
    const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]
    const sp = selectionSpine(this.doc, this.pool, anchorParaId, focusParaId)
    if (!sp) return []
    const segments = collectSelectionSegments(
      sp.spine, anchorParaId, selection.anchor.offset,
      focusParaId, selection.focus.offset,
    )
    const nodeIds: string[] = []
    for (const s of segments) {
      nodeIds.push(...collectTextNodeIds(this.pool, s.paraId, s.start, s.end))
    }
    return nodeIds
  }

  /**
   * 收集选区覆盖的段落区间 (同段/跨段)。每段一个 FormatRange。
   * 空选区 (起止重合) 返回空数组。跨段遍历委托 SelectionCollector (§11.2)。
   */
  collectSelectionRanges(selection: SelectionState): FormatRange[] {
    const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
    const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]

    // 同段: 保留完整 anchor 段落路径 (原行为)
    if (anchorParaId === focusParaId) {
      const start = Math.min(selection.anchor.offset, selection.focus.offset)
      const end = Math.max(selection.anchor.offset, selection.focus.offset)
      if (start < end) return [{ path: [...selection.anchor.paragraphPath], start, end }]
      return []
    }

    // 跨段: 区域感知读序 (body 展平 / header / footer), 委托 collectSelectionSegments
    const sp = selectionSpine(this.doc, this.pool, anchorParaId, focusParaId)
    if (!sp) return []
    const segments = collectSelectionSegments(
      sp.spine, anchorParaId, selection.anchor.offset,
      focusParaId, selection.focus.offset,
    )
    return segments.map((s) => ({
      path: [this.doc.id, s.paraId],
      start: s.start,
      end: s.end === Number.MAX_SAFE_INTEGER ? paragraphTextLength(this.pool, s.paraId) : s.end,
    }))
  }

  /**
   * 解析本次格式操作的目标段落区间。
   * 优先取选区覆盖的区间；无选区/空选区时回退到光标处整个文本节点。
   * 无法确定目标 (无段落路径或偏移解析失败) 返回 null, 调用方应直接 return。
   */
  private resolveTargetFormatRanges(selection: SelectionState, cursor: CursorState): FormatRange[] | null {
    if (selection.active) {
      const ranges = this.collectSelectionRanges(selection)
      if (ranges.length > 0) return ranges
    }
    // 无选区 → 只作用于光标处整个文本节点 (保留旧行为)
    if (cursor.paragraphPath.length === 0) return null
    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
    if (!resolved) return null
    const node = this.pool.nodes.get(resolved.textNodeId) as { type?: string; text?: string } | undefined
    if (node?.type !== 'text') return null
    const start = this.pool.getCharOffset(paraId, resolved.textNodeId, 0)
    return [{ path: [...cursor.paragraphPath], start, end: start + (node.text || '').length }]
  }

  /** 读取选区区间内首个文本节点的样式 (供 toggle 方向判断) */
  private getFirstRangeTextNodeStyle(range: FormatRange): Record<string, unknown> | null {
    const node = findFirstTextNodeInRange(this.pool, range)
    return node ? (node as unknown as Record<string, unknown>) : null
  }

  /**
   * 将光标定位到指定点并折叠选区 (锚点/焦点跟随该点, active=false)。
   * 供"应用格式后只保留光标"类场景复用, 避免 setCursor + setSelection 组合重复。
   */
  collapseSelectionToPoint(paragraphPath: string[], offset: number): void {
    this.store.setCursor({ paragraphPath, offset, visible: true })
    this.store.setSelection({
      anchor: { paragraphPath: [...paragraphPath], offset, visible: false },
      focus: { paragraphPath: [...paragraphPath], offset, visible: false },
      active: false,
      granularity: 'character',
    })
  }

  getDocument(): DocumentTree { return this.doc }
  /** 模板设计期属性 (契约 §12.1) — 编辑约束消费 (P1); 当前承载 */
  getTemplateDefinitions(): TemplateDefinitionStore | null { return this.templateDefinitions }
  /** 读取控件设计期提示文本 (契约 §12.1 tips) — 供 UI 悬浮提示消费 */
  getTip(nodeId: string): string | undefined {
    return this.templateDefinitions?.get(nodeId)?.tips
  }
  /** 读取控件设计期属性完整定义 (契约 §12.5) — 供设计态属性编辑面板展示 */
  getControlDefinition(nodeId: string): TemplateDefinition | undefined {
    return this.templateDefinitions?.get(nodeId)
  }
  /**
   * 就地编辑控件设计期属性 (契约 §12.5) — 经 UpdateControlDefinitionCommand。
   * 整体替换语义: 传入「编辑后的完整 def」, undefined/空对象 → 删除条目。
   * store 为 per-editor 实例 (§7.6), 惰性建立以支撑空白文档设计态。
   */
  setControlDefinition(nodeId: string, definition?: TemplateDefinition): void {
    if (!this.templateDefinitions) this.templateDefinitions = new TemplateDefinitionStore()
    this.execCommand(new UpdateControlDefinitionCommand(
      generateCommandId(), Date.now(), 'user', nodeId, definition,
    ))
  }
  /** 设计模式选中的控件节点 id (契约 §12.3), 无选中为 null */
  getSelectedControlId(): string | null { return this.store.state.designSelectedControlId }
  /** 设计模式悬停的控件节点 id (契约 §12.3), 无悬停为 null */
  getHoveredControlId(): string | null { return this.store.state.designHoveredControlId }
  /** 选中/清除控件 (设计模式, 契约 §12.3) — null 清除选中, 同步 Draw 高亮并重绘 */
  selectControl(nodeId: string | null): void {
    this.store.setDesignSelectedControlId(nodeId)
    this.draw.designSelectedControlId = nodeId
    this.draw.render(this.pool, this.store.state.runtime)
  }
  /** 更新设计模式悬停控件 (契约 §12.3), null 清除 — 仅供 UI 悬浮提示, 不触发重绘 */
  setHoveredControl(nodeId: string | null): void {
    this.store.setDesignHoveredControlId(nodeId)
  }
  // ================================================================
  // 运行时控件交互 (契约 §12.6) — activeControlId 瞬态 + 值写入唯一路径
  // ================================================================

  /** 当前激活的运行时控件 id (瞬态, 不序列化, 无激活为 null) */
  getActiveControlId(): string | null {
    return this.store.state.activeControlId
  }
  /**
   * 激活/切换运行时控件 (契约 §12.6 运行时交互)。normal 模式点击 smarttext
   * → 激活控件 (而非段落 offset → caret)。null 等价于 deactivateControl()。
   * 激活后同步 Draw 重绘, 使 Canvas 静态 widget 与 React overlay 同帧对齐。
   */
  activateControl(nodeId: string | null): void {
    this.store.setActiveControlId(nodeId)
    // 无缝内联编辑: Draw 同步激活字段 → 渲染时隐藏该控件静态 field (框/值/▼)
    this.draw.activeControlNodeId = nodeId
    this.draw.render(this.pool, this.store.state.runtime)
  }
  /** 取消激活 (契约 §12.6), 清空瞬态 activeControlId 并重绘 */
  deactivateControl(): void {
    this.activateControl(null)
  }
  /**
   * 写入控件运行时值 (契约 §12.6, VR-3 唯一路径) — 先经 validateControlValue
   * 预校验 (与 SetControlValueCommand 同源 permissions/dictionary 候选),
   * 非法值返回拒绝理由 (不执行命令, 不突变), 合法值经 SetControlValueCommand
   * 入 undo 栈。返回的 ok 值即归一化后规范值 (undefined = 清空)。
   */
  setControlValue(nodeId: string, value: ControlValue | undefined): ControlValueValidationResult {
    const node = this.pool.nodes.get(nodeId) as SmartTextNode | undefined
    if (!node || node.type !== NodeType.SMART_TEXT) {
      return { ok: false, reason: 'type_mismatch' }
    }
    const permissions: ControlValuePermissions = {
      editable: this.templateDefinitions?.get(nodeId)?.editable,
    }
    const dictionaryId = node.element.format?.dictionary
    const dictionaryCandidates = dictionaryId ? this.dictionaries?.resolve(dictionaryId) : undefined
    const result = validateControlValue(value, node.element, permissions, dictionaryCandidates)
    if (!result.ok) return result
    this.execCommand(new SetControlValueCommand(
      generateCommandId(), Date.now(), 'user', nodeId, result.value,
    ))
    return result
  }
  /** 读取控件运行时值 (契约 §2.1); 非 smarttext / 缺失返回 undefined */
  getControlValue(nodeId: string): ControlValue | undefined {
    const node = this.pool.nodes.get(nodeId) as SmartTextNode | undefined
    return node && node.type === NodeType.SMART_TEXT ? node.value : undefined
  }
  /**
   * 读取控件运行时快照 (契约 §12.6) — overlay 渲染/交互投影。
   * 非 smarttext 节点返回 null。字段正交, 无反向推导。
   */
  getControlSnapshot(nodeId: string): ControlSnapshot | null {
    const node = this.pool.nodes.get(nodeId) as SmartTextNode | undefined
    if (!node || node.type !== NodeType.SMART_TEXT) return null
    const def = this.templateDefinitions?.get(nodeId)
    const element = node.element
    const format = element.format
    const inlineEnums = format?.enums
    const dictionaryId = format?.dictionary
    const dictionaryCandidates = dictionaryId ? this.dictionaries?.resolve(dictionaryId) : undefined
    const candidates = inlineEnums !== undefined ? inlineEnums.data : dictionaryCandidates
    return {
      nodeId,
      placeholder: node.text,
      value: node.value,
      controlType: def?.controlType,
      dataType: format?.dataType,
      showType: format?.showType,
      options: candidates,
      multiple: inlineEnums?.multiple === true,
      enumEditable: inlineEnums?.editable,
      writable: (def?.editable !== false) && (element.readonly !== true),
      minRows: format?.minRows,
      scale: format?.scale,
      minLength: format?.minLength,
      maxLength: format?.maxLength,
      masked: element.privacy?.enabled === true,
      label: def?.label,
      tips: def?.tips,
    }
  }
  /** 控件视口 Client 矩形 (契约 §12.6 运行时 overlay 定位) — 委托 Draw 几何 */
  getControlClientRect(nodeId: string): { left: number; top: number; width: number; height: number } | null {
    return this.draw.getControlClientRect(nodeId)
  }
  /** 控件无缝内联编辑目标 (契约 §12.6) — 文本内容区几何 + 同 Canvas 字体, 供 overlay 透明无框编辑 */
  getControlEditTarget(nodeId: string): ControlEditTarget | null {
    return this.draw.getControlEditTarget(nodeId)
  }
  /**
   * 运行时填表导航 (契约 §12.6) — 返回 anchor 所属区域内 (页眉 / 正文 / 页脚)
   * 按阅读顺序排列的「可填控件」nodeId 列表: 仅含 smarttext 且可写非脱敏
   * (与 MouseHandler 激活谓词一致)。用于 Tab/回车在区域内跳转。
   */
  getRegionControlIds(anchorNodeId: string): string[] {
    // anchorNodeId 是控件 (smarttext) nodeId; 区域由「其所属段落」判定
    // (sectionOf 判的是段落 id, 直接传控件 id 会被误判为 body)。
    const anchorPara = this.findParagraphContaining(anchorNodeId)
    const section = anchorPara ? sectionOf(anchorPara.id, this.doc) : 'body'
    const spine = regionSpine(this.doc, this.pool, section)
    const ids: string[] = []
    for (const paraId of spine) {
      const para = this.pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
      if (!para?.children) continue
      for (const cid of para.children) {
        const n = this.pool.nodes.get(cid) as { type?: string } | undefined
        if (n?.type !== NodeType.SMART_TEXT) continue
        const snap = this.getControlSnapshot(cid)
        if (snap && !snap.masked && snap.writable) ids.push(cid)
      }
    }
    return ids
  }
  /** 相邻可填控件 (dir +1 下一个 / -1 上一个), 区域内环绕; 无则 null */
  getAdjacentControlId(nodeId: string, dir: 1 | -1): string | null {
    const ids = this.getRegionControlIds(nodeId)
    if (ids.length === 0) return null
    const i = ids.indexOf(nodeId)
    if (i < 0) return ids[0]
    return ids[(i + dir + ids.length) % ids.length]
  }
  /**
   * 原子应用控件配置 (契约 §12.7) — 控件配置弹框「应用/确定」的唯一提交点。
   *
   * 一层一命令: element → UpdateControlElementCommand; definition →
   * UpdateControlDefinitionCommand (整体替换); 值语义不兼容时清空 →
   * SetControlValueCommand。三者经 beginMacro/endMacro 合并为单个 undo 单元
   * (RULE 11)。element 与 definition 均无实质变化时不产生任何命令 (§7.8)。
   *
   * 值复校验 (契约 §12.7): 用 新 element + 新 def 的 permissions/字典 对旧
   * value 复校验, 除 write_locked 外的任何拒绝 → 清空 undefined
   * (write_locked 保留旧记录值)。
   *
   * 占位符同步: 值空 且 text 恰等于 `[oldName]` 时同步为 `[newName]` (不覆盖
   * 作者自定义占位符, 不改已填值)。
   */
  applyControlConfig(
    nodeId: string,
    element: ElementMeta,
    definition?: TemplateDefinition,
    opts?: { clearValueIfIncompatible?: boolean },
  ): void {
    const node = this.pool.nodes.get(nodeId) as SmartTextNode | undefined
    if (!node || node.type !== NodeType.SMART_TEXT) return
    const curDef = this.templateDefinitions?.get(nodeId)
    const elementChanged = !elementEquals(node.element, element)
    const defChanged = !definitionEquals(curDef, definition)
    if (!elementChanged && !defChanged) return

    // 占位符同步 (见上方 JSDoc 规则)
    let nextText: string | undefined
    if (elementChanged) {
      const oldName = node.element.name
      if (oldName !== element.name && node.text === `[${oldName}]` && isControlValueEmpty(node.value)) {
        nextText = `[${element.name}]`
      }
    }

    // 值语义复校验决策 (宏外预判, 纯计算; 用新 element / 新 def 的权限与字典)
    let planClear = false
    if (opts?.clearValueIfIncompatible !== false) {
      const permissions: ControlValuePermissions = { editable: definition?.editable }
      const dictId = element.format?.dictionary
      const dictCandidates = dictId ? this.dictionaries?.resolve(dictId) : undefined
      const check = validateControlValue(node.value, element, permissions, dictCandidates)
      planClear = !check.ok && check.reason !== 'write_locked'
    }

    this.commandManager.beginMacro()
    // 执行顺序 = 宏 undo 逆序的逆序: 值先清 (旧 element 仍可写), def 再改,
    // element 最后换 —— 保证 undo 时先还原 element 再还原 value (值还原需在
    // 旧语义下通过 validateControlValue)。值语义复校验决策基于「新」语义,
    // 但清空命令只校验 undefined (旧 element 非写锁即合法), 两层各自正确。
    if (planClear) {
      this.execCommand(new SetControlValueCommand(
        generateCommandId(), Date.now(), 'user', nodeId, undefined,
      ))
    }
    if (defChanged) this.setControlDefinition(nodeId, definition)
    if (elementChanged) {
      this.execCommand(new UpdateControlElementCommand(
        generateCommandId(), Date.now(), 'user', nodeId, element, nextText,
      ))
    }
    this.commandManager.endMacro()
  }

  /**
   * 删除设计模式选中的控件 (契约 §12.3) — 走 RemoveControlCommand,
   * deletable 守卫 (§12.1) 在命令 forward 内执行。
   * 返回是否实际删除; 守卫拒绝 (deletable:false) 时保留选中并返回 false。
   */
  deleteSelectedControl(): boolean {
    const nodeId = this.store.state.designSelectedControlId
    if (!nodeId) return false
    const para = this.findParagraphContaining(nodeId)
    if (!para) return false
    this.execCommand(new RemoveControlCommand(
      generateCommandId(), Date.now(), 'user', [this.doc.id, para.id], nodeId,
    ))
    if (this.pool.nodes.has(nodeId)) return false // 守卫拒绝 (deletable:false) 或未删除
    this.selectControl(null)
    return true
  }
  /**
   * 节点删除门面 (设计 v2 §6) — 按节点类型路由到既有 Command,
   * 返回是否实际删除 (拒绝/守卫失败返回 false)。
   *
   * 路由:
   *   - body 级段落: RemoveNodesCommand, body 必须保留 ≥1 段落 (删最后一个拒绝)
   *   - image: body 级块图直接从 body 摘除; 段落内联图从所属段落 children 摘除
   *   - body 级 separator/section_break/table: RemoveNodesCommand
   *   - smarttext: RemoveControlCommand (deletable 守卫 §12.1)
   *   - cell / row / column / header·footer 内节点: 拒绝 (P2 再定)
   */
  deleteNode(nodeId: string): boolean {
    const node = this.pool.nodes.get(nodeId)
    if (!node) return false

    switch (node.type) {
      case 'paragraph': {
        // 仅 body 级段落可整段删除; cell 内段落由表格结构 API 管理, 拒绝
        const bodyIdx = this.doc.body.children.indexOf(nodeId)
        if (bodyIdx < 0) return false
        // 守卫: body 必须保留 ≥1 段落
        const bodyParaCount = this.doc.body.children.filter(
          (id) => this.pool.nodes.get(id)?.type === 'paragraph',
        ).length
        if (bodyParaCount <= 1) return false
        this.execCommand(new RemoveNodesCommand(
          generateCommandId(), Date.now(), 'user',
          [{ container: { kind: 'body' }, nodeIds: [nodeId] }],
          [], this.cursorAfterBlockRemoval(bodyIdx),
        ))
        return true
      }
      case 'image': {
        // body 级块级图片: 直接从 body 摘除
        const bodyIdx = this.doc.body.children.indexOf(nodeId)
        if (bodyIdx >= 0) {
          this.execCommand(new RemoveNodesCommand(
            generateCommandId(), Date.now(), 'user',
            [{ container: { kind: 'body' }, nodeIds: [nodeId] }],
            [], this.cursorAfterBlockRemoval(bodyIdx),
          ))
          return true
        }
        // 段落内联图片 (insertImage 默认): 从所属段落 children 摘除, 光标回落到图片原位
        const para = this.findParagraphContaining(nodeId)
        if (para) {
          const offset = this.pool.getCharOffset(para.id, nodeId, 0)
          this.execCommand(new RemoveNodesCommand(
            generateCommandId(), Date.now(), 'user',
            [{ container: { kind: 'paragraph', paraId: para.id }, nodeIds: [nodeId] }],
            [], { paragraphPath: [this.doc.id, para.id], offset, visible: true },
          ))
          return true
        }
        return false
      }
      case 'separator':
      case 'section_break':
      case 'table': {
        const bodyIdx = this.doc.body.children.indexOf(nodeId)
        if (bodyIdx < 0) return false
        this.execCommand(new RemoveNodesCommand(
          generateCommandId(), Date.now(), 'user',
          [{ container: { kind: 'body' }, nodeIds: [nodeId] }],
          [], this.cursorAfterBlockRemoval(bodyIdx),
        ))
        return true
      }
      case 'smarttext': {
        const para = this.findParagraphContaining(nodeId)
        if (!para) return false
        this.execCommand(new RemoveControlCommand(
          generateCommandId(), Date.now(), 'user', [this.doc.id, para.id], nodeId,
        ))
        return !this.pool.nodes.has(nodeId)
      }
      default:
        return false
    }
  }
  /** 删除 body 块级节点后, 光标回落到最近段落 (后一个优先, 否则前一个) */
  private cursorAfterBlockRemoval(bodyIdx: number): Partial<CursorState> | undefined {
    const children = this.doc.body.children
    for (let i = bodyIdx + 1; i < children.length; i++) {
      if (this.pool.nodes.get(children[i])?.type === 'paragraph') {
        return { paragraphPath: [this.doc.id, children[i]], offset: 0, visible: true }
      }
    }
    for (let i = bodyIdx - 1; i >= 0; i--) {
      if (this.pool.nodes.get(children[i])?.type === 'paragraph') {
        return { paragraphPath: [this.doc.id, children[i]], offset: 0, visible: true }
      }
    }
    return undefined
  }
  /** 表现层样式 (契约 §2.2) — 渲染消费 */
  getPresentationStyles(): PresentationStyleStore | null { return this.presentationStyles }
  /** 序列化文档为 JSON 字符串 (含全部节点 payload, 供保存/自动保存使用) */
  getSerializedDocument(): string {
    return serializeDocument(this.doc, this.pool, {
      templateDefinitions: this.templateDefinitions ?? undefined,
      presentationStyles: this.presentationStyles ?? undefined,
    })
  }
  /** 读取文档级元数据 (契约 §7.7) — 供文档属性对话框展示 */
  getDocumentMetadata(): DocumentMetadata | undefined {
    return this.doc.metadata
  }
  /**
   * 设置文档级元数据 (契约 §7.7) — 经 UpdateDocumentPropertiesCommand。
   * 整体替换语义: 传入「编辑后的完整 DocumentMetadata」, undefined/空对象 → 删除。
   * 输入必须已是合法 metadata (边界层已 normalize), 命令本身不校验 (§7.8)。
   */
  setDocumentMetadata(metadata?: DocumentMetadata): void {
    this.execCommand(new UpdateDocumentPropertiesCommand(
      generateCommandId(), Date.now(), 'user', metadata,
    ))
  }
  /** 读取文档标题 (契约 §7.7) — 供文档属性对话框展示 */
  getDocumentTitle(): string {
    return this.doc.title
  }
  /** 设置文档标题 (契约 §7.7) — 经 UpdateDocumentTitleCommand */
  setDocumentTitle(title: string): void {
    this.execCommand(new UpdateDocumentTitleCommand(
      generateCommandId(), Date.now(), 'user', title,
    ))
  }
  /**
   * 原子应用文档属性 (标题 + 元数据) — 文档属性对话框「应用」的唯一提交点。
   *
   * 标题 → UpdateDocumentTitleCommand, 元数据 → UpdateDocumentPropertiesCommand,
   * 二者经 beginMacro/endMacro 合并为单个 undo 单元 (RULE 11): 一次「应用」
   * 对应一次 Ctrl+Z。标题与元数据均无实际变化时 (metadataEquals) 不产生任何命令。
   * 输入 metadata 必须已是边界层经 normalizeDocumentMetadata 规范化后的合法值。
   */
  applyDocumentProperties(title: string, metadata?: DocumentMetadata): void {
    const titleChanged = title !== this.doc.title
    const metadataChanged = !metadataEquals(this.doc.metadata, metadata)
    if (!titleChanged && !metadataChanged) return
    this.commandManager.beginMacro()
    if (titleChanged) this.setDocumentTitle(title)
    if (metadataChanged) this.setDocumentMetadata(metadata)
    this.commandManager.endMacro()
  }
  setDocument(
    doc: DocumentTree,
    nodes?: Map<string, BaseNode>,
    stores?: { templateDefinitions?: TemplateDefinitionStore; presentationStyles?: PresentationStyleStore; dictionaries?: DictionaryProvider },
  ): void {
    // 确保 header/footer 字段存在 (兼容旧版文档数据)
    if (!doc.header) doc.header = []
    if (!doc.footer) doc.footer = []
    this.doc = doc
    this.store.setDocumentTitle(doc.title)
    const loaded = loadDocumentFromObject(doc, { extraNodes: nodes })
    this.pool = loaded.pool
    // 优先级: 显式 stores (外部模板路径) > 加载器从 doc 顶层字段读回 (引擎序列化格式, 契约 §12.1)
    this.templateDefinitions = stores?.templateDefinitions ?? loaded.templateDefinitions ?? null
    this.presentationStyles = stores?.presentationStyles ?? loaded.presentationStyles ?? null
    this.dictionaries = stores?.dictionaries ?? null
    this.draw.setDocument(doc, this.pool, this.presentationStyles, this.templateDefinitions)
    this.draw.recomputeLayout(this.pool)

    // 自动应用文档水印 (R70) — 用 document 域类型直接读取, 契约 §12.4
    if (doc.pageSetup?.watermark) {
      this.draw.setWatermark(doc.pageSetup.watermark)
    }

    const cursorPath = doc.body.children.length > 0
      ? [doc.id, doc.body.children[0]]
      : []
    this.store.setCursor({ paragraphPath: cursorPath, offset: 0, visible: true })
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', doc)
  }

  /**
   * 确保页眉/页脚区域至少有一个段落 (无则创建)
   * 返回第一个段落 ID
   */
  ensureHeaderFooterParagraph(section: 'header' | 'footer'): string {
    const arr = section === 'header'
      ? (this.doc.header ?? (this.doc.header = []))
      : (this.doc.footer ?? (this.doc.footer = []))
    if (arr.length > 0) return arr[0]

    // 经 Command 创建段落 (RULE 4), 命令同步写回 doc.header/footer
    this.commandManager.execute(new EnsureHeaderFooterParagraphCommand(
      generateCommandId(), Date.now(), 'user', section,
    ))
    return arr[0]
  }

  /**
   * 在光标位置插入域代码 (TASK-471)
   * 用于页眉页脚工具栏"插入页码"/"插入日期"等
   */
  insertFieldCode(fieldType: FieldType): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    this.commandManager.execute(new InsertInlineNodeCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath, cursor.offset,
      () => createFieldNode(fieldType),
    ))
  }

  /** 在光标所在段落后插入分隔线 (TASK-462) */
  insertSeparator(): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    this.commandManager.execute(new InsertBlockCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath,
      (pool) => {
        const sep = createSeparatorNode()
        pool.addNode(sep)
        return sep
      },
      { withTrailingParagraph: true, moveCursorToTrailing: true },
    ))
  }

  /** 在光标位置插入脚注引用 + 脚注内容 (R31, Ctrl+Alt+F) */
  insertFootnote(): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    this.commandManager.execute(new InsertFootnoteCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath, cursor.offset,
      (pool) => {
        const fnContent = createFootnoteContent('')
        const contentText = createTextNode('')
        const contentPara = createParagraph([contentText.id])
        fnContent.children = [contentPara.id]
        pool.addNode(fnContent)
        pool.addNode(contentText)
        pool.addNode(contentPara)
        return fnContent
      },
      (fnContentId) => createFootnoteRef(fnContentId),
    ))
  }

  /** 在光标位置插入图片 (TASK-447), dataUrl 为 base64 或 blob URL */
  insertImage(dataUrl: string, naturalW?: number, naturalH?: number): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    this.commandManager.execute(new InsertImageCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath, cursor.offset, dataUrl, naturalW, naturalH,
    ))
  }

  /** 在光标位置后插入表格 (R83) */
  insertTable(rows: number, cols: number): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    this.commandManager.execute(new InsertBlockCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath,
      (pool) => {
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
            pool.addNode(text)
            pool.addNode(para)
            pool.addNode({
              type: 'cell' as const, id: cellId,
              children: [para.id],
              colspan: 1, rowspan: 1,
            } as unknown as BaseNode)
            cellIds.push(cellId)
          }
          pool.addNode({
            type: 'row' as const, id: rowId,
            children: cellIds, height: 24,
          } as unknown as BaseNode)
          rowIds.push(rowId)
        }

        pool.addNode({
          type: 'table' as const, id: tableId,
          columns: Array.from({ length: cols }, () => ({ width: colWidth, mode: 'percentage' as const })),
          children: rowIds,
        } as unknown as BaseNode)
        return pool.nodes.get(tableId) as BaseNode
      },
      { withTrailingParagraph: true, moveCursorToTrailing: false },
    ))
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

    this.commandManager.execute(new TableStructureCommand(
      generateCommandId(), Date.now(), 'user', tableId,
      (pool) => mergeAdjacentCells(pool, tableId, rowIdx, colIdx),
    ))
    this.clearTableSelectionState()
  }

  /** 合并框选矩形为一个单元格 (colspan×rowspan) */
  mergeSelectedRange(range: CellRange): void {
    const tableId = range.tableId

    this.commandManager.execute(new TableStructureCommand(
      generateCommandId(), Date.now(), 'user', tableId,
      (pool) => mergeRange(pool, tableId, range),
    ))
    this.clearTableSelectionState()
  }

  /** 拆分合并的单元格 (支持 colspan 水平拆分 / rowspan 垂直拆分) */
  splitSelectedCell(): void {
    if (!this._selectedTableId || this._selectedCellRow < 0 || this._selectedCellCol < 0) return
    const tableId = this._selectedTableId
    const rowIdx = this._selectedCellRow
    const colIdx = this._selectedCellCol

    this.commandManager.execute(new TableStructureCommand(
      generateCommandId(), Date.now(), 'user', tableId,
      (pool) => splitCell(pool, tableId, rowIdx, colIdx),
    ))
    this.clearTableSelectionState()
  }

  /** 插入行 (选中单元格下方) */
  insertTableRow(): void {
    if (!this._selectedTableId || this._selectedCellRow < 0) return
    const tableId = this._selectedTableId
    const rowIdx = this._selectedCellRow
    this.commandManager.execute(new TableStructureCommand(
      generateCommandId(), Date.now(), 'user', tableId,
      (pool) => { insertRow(pool, tableId, rowIdx); return true },
    ))
    this.clearTableSelectionState()
  }

  /** 删除选中单元格所在行 */
  deleteTableRow(): void {
    if (!this._selectedTableId || this._selectedCellRow < 0) return
    this.deleteTableRowAt(this._selectedTableId, this._selectedCellRow)
  }

  /** 删除指定行 (tableId + 行下标) — 右键菜单/工具栏复用 (RULE 4: 经 TableStructureCommand) */
  deleteTableRowAt(tableId: string, row: number): void {
    this.commandManager.execute(new TableStructureCommand(
      generateCommandId(), Date.now(), 'user', tableId,
      (pool) => { deleteRow(pool, tableId, row); return true },
    ))
    this.clearTableSelectionState()
  }

  /** 插入列 (选中单元格右侧) */
  insertTableColumn(): void {
    if (!this._selectedTableId || this._selectedCellRow < 0 || this._selectedCellCol < 0) return
    const gp = getCellGridPosition(this.pool, this._selectedTableId, this._selectedCellRow, this._selectedCellCol)
    if (!gp) return
    const tableId = this._selectedTableId
    const colIdx = gp.col
    this.commandManager.execute(new TableStructureCommand(
      generateCommandId(), Date.now(), 'user', tableId,
      (pool) => { insertColumn(pool, tableId, colIdx); return true },
    ))
    this.clearTableSelectionState()
  }

  /** 删除选中单元格所在列 */
  deleteTableColumn(): void {
    if (!this._selectedTableId || this._selectedCellRow < 0 || this._selectedCellCol < 0) return
    this.deleteTableColumnAt(this._selectedTableId, this._selectedCellRow, this._selectedCellCol)
  }

  /** 删除指定列 (tableId + 行下标 + 行内 cell 下标 → 网格列) — 右键菜单/工具栏复用 */
  deleteTableColumnAt(tableId: string, row: number, col: number): void {
    const gp = getCellGridPosition(this.pool, tableId, row, col)
    if (!gp) return
    this.commandManager.execute(new TableStructureCommand(
      generateCommandId(), Date.now(), 'user', tableId,
      (pool) => { deleteColumn(pool, tableId, gp.col); return true },
    ))
    this.clearTableSelectionState()
  }

  /** 表格结构变更后的统一收尾: 清选择状态 (重布局/渲染/通知由 Command 事件链完成) */
  private clearTableSelectionState(): void {
    this._selectedTableId = null; this._selectedCellRow = -1; this._selectedCellCol = -1
    this._cellRange = null
    this.draw.cellSelection = null
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

  /**
   * 切换编辑器模式 (edit/readonly/form/clean/design/print)
   *
   * mode 的 canonical owner 是 EditorStore.runtime.view.mode (§7.2),
   * React 端经 useEditorStoreSnapshot 订阅回读。此处仅更新 store,
   * 不再 emit 'mode:changed' (已无监听者) 或空 'state:changed'
   * (后者会误触 setDirty(true), 把切模式当成文档变更)。
   */
  setMode(mode: import('./state/EditorRuntimeState').EditorMode): void {
    this.store.setMode(mode)
    // 切出 edit/form (非交互模式) 且有激活控件 → 去激活 (卸载即提交),
    // 防设计态/只读残留 overlay
    if ((mode !== 'edit' && mode !== 'form') && this.getActiveControlId() !== null) {
      this.deactivateControl()
    }
  }

  /**
   * 插入控件库条目 (设计态, 契约 §12.4) — 经 InsertControlCommand。
   * 同时写入语义层 (SmartTextNode.element) 与设计期层 (TemplateDefinition),
   * single 守卫 (§12.1) 在命令 forward 内执行 (重复 single 控件拒绝插入)。
   * 设计期 store 为 per-editor 实例 (§7.6), 惰性建立以支撑空白文档设计态。
   */
  insertControl(element: ElementMeta, definition?: TemplateDefinition): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return
    if (!this.templateDefinitions) this.templateDefinitions = new TemplateDefinitionStore()
    this.commandManager.execute(new InsertControlCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath, cursor.offset,
      element, definition,
    ))
  }

  /** 插入书签 — 在当前光标位置创建 BookmarkNode */
  insertBookmark(name: string): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const offset = cursor.offset
    this.commandManager.execute(new InsertInlineNodeCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath, cursor.offset,
      () => ({
        type: 'bookmark' as const,
        id: generateCommandId(),
        name,
        targetId: paraId,
        targetOffset: offset,
      } as unknown as BaseNode),
    ))
  }

  /** 获取文档中所有书签/标题/脚注目标 (供 BookmarkDialog 使用) */
  getBookmarkTargets(): { id: string; label: string; type: 'heading' | 'bookmark' | 'footnote'; pageHint?: number }[] {
    const targets: { id: string; label: string; type: 'heading' | 'bookmark' | 'footnote'; pageHint?: number }[] = []
    for (const [, node] of this.pool.nodes) {
      if (node.type === 'bookmark') {
        const bm = node as unknown as { id: string; name: string }
        targets.push({ id: bm.id, label: bm.name || bm.id, type: 'bookmark' })
      } else if (node.type === 'paragraph') {
        const p = node as unknown as { id: string; outlineLevel?: number; children?: readonly string[] }
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
    this.commandManager.execute(new CreateCommentCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath, cursor.offset,
      () => ({
        type: 'comment_marker' as const, id: markerId,
        threadId,
        rangeStart: { path: [...cursor.paragraphPath], offset: Math.max(0, cursor.offset - 1) },
        rangeEnd: { path: [...cursor.paragraphPath], offset: cursor.offset },
      } as unknown as BaseNode),
      () => ({
        id: threadId,
        rangeStart: { path: [...cursor.paragraphPath], offset: Math.max(0, cursor.offset - 1) },
        rangeEnd: { path: [...cursor.paragraphPath], offset: cursor.offset },
        author: 'user',
        createdAt: ts,
        status: 'open' as const,
        baseVersion: 1,
        anchorStatus: 'valid' as const,
        comments: [{ id: generateCommandId(), author: 'user', createdAt: ts, content }],
      }),
    ))
  }

  /** 获取批注列表 */
  getComments(): import('./document/core/DocumentModel').CommentThread[] {
    return this.doc.comments || []
  }

  /** 添加批注回复 */
  addCommentReply(threadId: string, content: string): void {
    this.commandManager.execute(new AddCommentReplyCommand(
      generateCommandId(), Date.now(), 'user', threadId, generateCommandId(), content,
    ))
  }

  /** 解决/重新打开批注 */
  resolveComment(threadId: string, resolved: boolean): void {
    this.commandManager.execute(new ResolveCommentCommand(
      generateCommandId(), Date.now(), 'user', threadId, resolved,
    ))
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
    this.commandManager.execute(new SetPageSetupCommand(
      generateCommandId(), Date.now(), 'user',
      {
        width: values.pageWidth,
        height: values.pageHeight,
        marginTop: values.marginTop,
        marginBottom: values.marginBottom,
        marginLeft: values.marginLeft,
        marginRight: values.marginRight,
        orientation: values.orientation,
      },
    ))
    // 分页渲染间隙 — 存储不修改, 仅影响渲染视口
    if (typeof values.pageVerticalGap === 'number') {
      this.draw.setPageVerticalGap(values.pageVerticalGap)
    }
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

  /**
   * 复制图片节点 (P2 图片复制) — 纯副作用, 不入命令/undo 栈。
   *
   * 由右键菜单 image 命中「复制」分派; 直接按 nodeId 取节点并委托
   * ClipboardManager.copyImage 包装为合成段落存入内存剪贴板, 粘贴复用
   * InsertNodesCommand 管线。返回 false 表示 nodeId 非图片节点或不存在。
   */
  copyImage(nodeId: string): boolean {
    const node = this.pool.nodes.get(nodeId) as unknown as ImageNode | undefined
    if (!node || node.type !== 'image') return false
    this.clipboard.copyImage(node)
    return true
  }

  /** 删除当前选区内容 (跨段落逐段删除 + 合并), 用于粘贴前替换选区 */
  /**
   * 剪切: 复制选区到剪贴板 + 原子删除 (契约 RULE 11)。
   *
   * 复制是副作用 (不入命令栈, 不被 undo/redo); 删除经 deleteSelection()
   * 将 deleteSelectedRange 可能发出的多条 DeleteRange/Merge 命令合并为
   * 单个 undo 单元, 使跨段落剪切也只需一次 undo。
   */
  cut(): void {
    const selection = this.store.state.runtime.selection
    if (!selection.active) return
    this.copy()
    this.deleteSelection()
  }

  /**
   * 原子删除选区 (契约 RULE 11) — 跨段落选区亦打包为单个 undo 单元。
   *
   * deleteSelectedRange 为跨段落选区逐段发出 DeleteRange + MergeParagraph 命令,
   * 未经事务包装时每条命令各占一个 undo 单元, 一次 Ctrl+Z 只能还原其中一条。
   * 此处用 beginMacro/endMacro 将整次删除合并为单个 undo 单元 (与 cut 一致),
   * 使右键「删除」跨段落选区也只需一次 undo。
   */
  deleteSelection(): boolean {
    this.commandManager.beginMacro()
    const result = this.deleteSelectedRange()
    this.commandManager.endMacro()
    return result
  }

  /**
   * 删除选区内容 — v21.0 Phase 4: 区分 body/cell 作用域
   *
   * 同 cell 内选区: 在 cell.children 上操作
   * body 内选区: 在 doc.body.children 上操作 (原有逻辑)
   * 跨域选区: 不允许, 直接返回 false
   */
  deleteSelectedRange(): boolean {
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
      this.store.setCursor({ paragraphPath: selection.anchor.paragraphPath, offset: start, visible: true })
      return true
    }

    // v21.0 Phase 4: 检测 scope 并获取 siblings
    const aCell = resolveCellPosition(aId, this.pool)
    const fCell = resolveCellPosition(fId, this.pool)

    // 跨域选区禁止 / 不同 cell 暂不支持 (resolveSiblingRange 同语义, 保留早期守卫)
    if ((aCell && !fCell) || (!aCell && fCell)) return false
    if (aCell && fCell && (aCell.tableId !== fCell.tableId || aCell.row !== fCell.row || aCell.col !== fCell.col)) return false

    // 区域感知兄弟 (body / header / footer / 同 cell) — resolveSiblingRange
    const range = resolveSiblingRange(this.doc, this.pool, aId, fId)
    if (!range) return false
    const siblings: readonly string[] = range.siblings

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
        const totalLen = this.getParagraphTextLengthById(paraId)
        if (loOff < totalLen) {
          this.commandManager.execute(new DeleteRangeCommand(generateCommandId(), Date.now(), 'user', path, loOff, totalLen))
        }
      } else {
        const totalLen = this.getParagraphTextLengthById(paraId)
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
              const tn = this.pool.nodes.get(aCell.tableId) as { children?: readonly string[] } | undefined
              const rn = this.pool.nodes.get(tn?.children?.[aCell.row] || '') as { children?: readonly string[] } | undefined
              return (this.pool.nodes.get(rn?.children?.[aCell.col] || '') as { children?: readonly string[] } | undefined)?.children || siblings
            })())
          : siblings
        const nextParaId = currentSiblings[lo + 1]
        if (!nextParaId) break
        const mergePath = [...selection.anchor.paragraphPath.slice(0, -1), nextParaId]
        this.commandManager.execute(new MergeParagraphCommand(generateCommandId(), Date.now(), 'user', mergePath))
      }
    }

    const loParaId = siblings[lo]
    this.store.setCursor({ paragraphPath: [...selection.anchor.paragraphPath.slice(0, -1), loParaId], offset: loOff, visible: true })

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
      const clipboard = this.host.platform.clipboard
      if (!clipboard.canRead()) return
      const text = await clipboard.readText()
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
      const clipboard = this.host.platform.clipboard
      if (!clipboard.canRead()) return
      // 图片数据无纯文本表示, 系统剪贴板(纯文本)不可能带来更「新」的图片内容,
      // 用系统文本覆盖会丢失已复制的图片 → 跳过同步。
      if (this.clipboard.isImageData()) return
      clipboard.readText().then((text) => {
        if (text && text !== this.clipboard.getPlainText()) {
          this.clipboard.setPlainText(text)
          console.debug('[Clipboard] external clipboard synced from system')
        }
      }).catch(() => { /* 权限拒绝或非安全上下文, 忽略 */ })
    } catch { /* 忽略 */ }
  }

  /** 切换文本样式 (bold/italic/underline) → FormatTextRangeCommand, 支持段内局部选区 */
  toggleFormat(style: Partial<import('./document/core/DocumentModel').TextStyle>): void {
    const selection = this.store.state.runtime.selection
    const cursor = this.store.state.runtime.cursor

    const ranges = this.resolveTargetFormatRanges(selection, cursor)
    if (!ranges || ranges.length === 0) return

    // Toggle: 读选区首个文本节点已有样式决定方向 (有→false/无→true)
    const firstNode = this.getFirstRangeTextNodeStyle(ranges[0])
    const changes: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(style)) {
      if (val === true && firstNode?.[key as keyof typeof firstNode]) {
        changes[key] = false
      } else {
        changes[key] = val
      }
    }

    const cmd = new FormatTextRangeCommand(
      generateCommandId(), Date.now(), 'user',
      ranges,
      changes as Partial<import('./document/core/DocumentModel').TextStyle>,
      'merge',
    )
    this.commandManager.execute(cmd)
  }

  /** 清除光标/选区处所有文本格式 (TASK-473) */
  clearFormat(): void {
    const selection = this.store.state.runtime.selection
    const cursor = this.store.state.runtime.cursor

    const ranges = this.resolveTargetFormatRanges(selection, cursor)
    if (!ranges || ranges.length === 0) return

    // 全量替换为默认样式 (replace 模式, 未指定字段重置为默认)
    const cmd = new FormatTextRangeCommand(generateCommandId(), Date.now(), 'user', ranges, {}, 'replace')
    this.commandManager.execute(cmd)
  }

  /** 格式刷: 复制光标处文本样式 (TASK-472) — 委托 FormatPainter (§11.2) */
  copyFormatPainterStyle(): Record<string, unknown> | null {
    return this.formatPainter.copyStyle()
  }

  /** 格式刷: 激活/取消 — 委托 FormatPainter, 状态同步到 EditorStore (canonical owner, §7.2) */
  setFormatPainterActive(active: boolean): void {
    this.formatPainter.setActive(active)
  }

  /** 格式刷是否激活 */
  get isFormatPainterActive(): boolean { return this.formatPainter.isActive }

  /** 格式刷: 将样式应用到目标段落的所有文本节点 (TASK-472) — 委托 FormatPainter */
  applyFormatPainter(paraId: string, style: Record<string, unknown>): void {
    this.formatPainter.applyToParagraph(paraId, style)
  }

  /** 设置光标/选区段落的格式 (对齐/缩进/列表) — v20.35 支持跨段落选区 */
  setParagraphStyle(style: Partial<import('./document/core/DocumentModel').ParagraphStyle>): void {
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
            [paraId], { list: { ...para.list, level: newLevel } as import('./document/core/DocumentModel').ListStyle, indent: 0 },
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
              [paraId], { list: { ...para.list, level: newLevel } as import('./document/core/DocumentModel').ListStyle, indent: 0 },
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

  /** 文本节点有效样式 (含标题强制加粗 + 缩放字号), 供选区快照与光标处样式复用 */
  private effectiveTextStyleForNode(textNodeId: string): import('./document/core/DocumentModel').TextStyle | null {
    const node = this.pool.nodes.get(textNodeId)
    if (!node || node.type !== 'text') return null
    const tn = node as unknown as import('./document/core/DocumentModel').TextNode
    // 标题: LayoutEngine 渲染时强制 bold=true + 缩放字号, 工具栏必须同步反映
    const para = this.findParagraphContaining(textNodeId)
    const outlineLevel = (para as unknown as { outlineLevel?: number } | null)?.outlineLevel ?? 0
    const isHeading = outlineLevel > 0
    const HEADING_SCALE: Record<number, number> = { 1: 2.0, 2: 1.5, 3: 1.25, 4: 1.125, 5: 1.0, 6: 0.875 }
    const headingScale = isHeading ? (HEADING_SCALE[outlineLevel] ?? 1) : 1
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

  /** 获取光标/选区文本样式快照 (供 Toolbar 状态同步) */
  getTextStyle(): {
    font?: string; size?: number
    bold?: boolean; italic?: boolean; underline?: boolean
    underlineStyle?: 'single' | 'double' | 'wave'
    strikeout?: boolean; superscript?: boolean; subscript?: boolean
    color?: string; highlight?: string; letterSpacing?: number
  } | null {
    // 有选区 → 选区样式快照 (统一→值, 混合→undefined 不定态)
    const selection = this.store.state.runtime.selection
    if (selection.active) {
      const nodeIds = this.collectSelectionTextNodeIds(selection)
      if (nodeIds.length > 0) {
        const styles: import('./document/core/DocumentModel').TextStyle[] = []
        for (const nid of nodeIds) {
          const s = this.effectiveTextStyleForNode(nid)
          if (s) styles.push(s)
        }
        return styles.length > 0 ? uniformTextStyle(styles) : null
      }
    }

    // 无选区 → 取光标紧邻后方字符格式
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return null
    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
    if (resolved) {
      return this.effectiveTextStyleForNode(resolved.textNodeId)
    }
    // 光标在段尾 → 取最后一个 text node 的样式 (继承上一字符格式)
    const paraChildren = this.pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (paraChildren?.children) {
      for (let i = paraChildren.children.length - 1; i >= 0; i--) {
        const n = this.pool.nodes.get(paraChildren.children[i]) as { type?: string } | undefined
        if (n?.type === 'text') return this.effectiveTextStyleForNode(paraChildren.children[i])
      }
    }
    return null
  }

  /** 单段落格式投影 (alignment 缺省视为 left) */
  private paragraphStyleProjectionOf(paraId: string): { alignment?: string; listType?: string; listLevel?: number; numberStyle?: string; continueNumbering?: boolean; indent?: number; outlineLevel?: number; lineHeight?: number } {
    const para = this.pool.nodes.get(paraId) as Record<string, unknown> | undefined
    const list = para?.list as { type?: string; level?: number; numberStyle?: string; continueNumbering?: boolean } | undefined
    return {
      alignment: (para?.alignment as string | undefined) ?? 'left',
      listType: list?.type,
      listLevel: list?.level,
      numberStyle: list?.numberStyle,
      continueNumbering: list?.continueNumbering,
      indent: para?.indent as number | undefined,
      outlineLevel: para?.outlineLevel as number | undefined,
      lineHeight: para?.lineHeight as number | undefined,
    }
  }

  /** 获取光标/选区段落格式 (供 Toolbar active 状态) — 多段落统一→值, 混合→undefined */
  getParagraphStyle(): { alignment?: string; listType?: string; listLevel?: number; numberStyle?: string; continueNumbering?: boolean; indent?: number; outlineLevel?: number; lineHeight?: number } | null {
    const paraIds = this.getSelectedParagraphIds()
    if (paraIds.length === 0) return null

    const projections = paraIds.map(id => this.paragraphStyleProjectionOf(id))
    const KEYS = ['alignment', 'listType', 'listLevel', 'numberStyle', 'continueNumbering', 'indent', 'outlineLevel', 'lineHeight'] as const
    const merged: { alignment?: string; listType?: string; listLevel?: number; numberStyle?: string; continueNumbering?: boolean; indent?: number; outlineLevel?: number; lineHeight?: number } = {}
    const first = projections[0]
    for (const k of KEYS) (merged as Record<string, unknown>)[k] = (first as Record<string, unknown>)[k]
    for (let i = 1; i < projections.length; i++) {
      const p = projections[i]
      for (const k of KEYS) {
        if ((merged as Record<string, unknown>)[k] !== (p as Record<string, unknown>)[k]) {
          (merged as Record<string, unknown>)[k] = undefined
        }
      }
    }
    return merged
  }

  /** 收集当前选区涉及的所有段落 ID */
  private getSelectedParagraphIds(): string[] {
    const selection = this.store.state.runtime.selection
    const cursor = this.store.state.runtime.cursor

    if (selection.active) {
      const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
      const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]
      if (anchorParaId && focusParaId && anchorParaId !== focusParaId) {
        const sp = selectionSpine(this.doc, this.pool, anchorParaId, focusParaId)
        if (sp) {
          const aIdx = sp.spine.indexOf(anchorParaId)
          const fIdx = sp.spine.indexOf(focusParaId)
          if (aIdx >= 0 && fIdx >= 0) {
            const lo = Math.min(aIdx, fIdx)
            const hi = Math.max(aIdx, fIdx)
            const ids: string[] = []
            for (let i = lo; i <= hi; i++) ids.push(sp.spine[i])
            return ids
          }
        }
      }
    }

    // 单段落: 光标所在段落
    if (cursor.paragraphPath.length === 0) return []
    return [cursor.paragraphPath[cursor.paragraphPath.length - 1]]
  }

  /** 全选: 选区覆盖整篇文档所有段落 (含表格 cell 内段落) */
  selectAll(): void {
    // 页眉/页脚编辑态 → 选整个页眉/页脚区 (WPS 对齐); 否则正文(含表格 cell)
    const hf = this.store.state.headerFooterEdit
    let spine: string[]
    if (hf.active && (hf.section === 'header' || hf.section === 'footer')) {
      spine = hf.section === 'header' ? [...(this.doc.header ?? [])] : [...(this.doc.footer ?? [])]
    } else {
      spine = flattenTextContainers(this.pool, this.doc.body.children)
    }
    if (spine.length === 0) return
    const firstParaId = spine[0]
    const lastParaId = spine[spine.length - 1]
    const totalLen = this.getParagraphTextLengthById(lastParaId)
    this.store.setSelection({
      anchor: { paragraphPath: [this.doc.id, firstParaId], offset: 0, visible: false },
      focus: { paragraphPath: [this.doc.id, lastParaId], offset: totalLen, visible: false },
      active: true,
      granularity: 'character',
    })
    this.draw.render(this.pool, this.store.state.runtime)
  }

  getEventBus(): EventBus { return this.eventBus }
  getDraw(): Draw { return this.draw }
  getPool(): NodePool { return this.pool }
  getInputComposer(): InputComposer { return this.inputComposer }
  getKeyboardHandler(): KeyboardHandler { return this.keyboardHandler }
  getStore(): EditorStore { return this.store }

  setRuntimeState(state: EditorRuntimeState): void { this.draw.setRuntimeState(state) }
  setScale(scale: number): void {
    this.draw.setScale(scale)
    this.store.setScale(scale)
  }
  /** 页眉页脚编辑模式切换 — 同步 EditorStore (canonical owner, §7.2) 与 Draw (渲染镜像) */
  setHeaderFooterEditActive(active: boolean, section?: 'header' | 'footer'): void {
    this.draw.setHeaderFooterEditActive(active, section)
    this.store.setHeaderFooterEdit(active, section)
  }
  /** 页眉页脚编辑模式是否激活 */
  isHeaderFooterEditActive(): boolean { return this.store.state.headerFooterEdit.active }
  /** 当前编辑的页眉/页脚区域 */
  getHeaderFooterEditSection(): 'header' | 'footer' { return this.store.state.headerFooterEdit.section }
  /** 页眉页脚选项 (canonical owner = DocumentTree) */
  getHeaderFooterConfig(): HeaderFooterConfig {
    return this.doc.headerFooterConfig ?? { ...DEFAULT_HEADER_FOOTER_CONFIG }
  }
  /** 变更页眉页脚选项 — 走 Command 系统 (支持 undo/redo) 并同步 EditorStore 投影 */
  setHeaderFooterConfig(patch: Partial<HeaderFooterConfig>): void {
    this.commandManager.execute(new SetHeaderFooterConfigCommand(generateCommandId(), Date.now(), 'user', patch))
    this.store.setHeaderFooterConfig(this.getHeaderFooterConfig())
  }
  /** 获取字数统计 (R36) */
  getWordCount(): { chars: number; words: number; paragraphs: number; selectedChars?: number; selectedWords?: number } {
    let chars = 0
    let words = 0
    const bodyChildren = this.doc.body.children

    for (const childId of bodyChildren) {
      const node = this.pool.nodes.get(childId)
      if (!node) continue
      const n = node as { type?: string; children?: readonly string[] }

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
      // 复用 collectSelectionTextNodeIds: 同段/跨段选区统一收集 (修复跨段选区计数缺失)
      const nodeIds = this.collectSelectionTextNodeIds(sel)
      let selText = ''
      for (const nid of nodeIds) {
        const n = this.pool.nodes.get(nid) as { text?: string } | undefined
        if (n?.text) selText += n.text
      }
      selectedChars = [...selText].length
      selectedWords = (selText.match(/[\w一-鿿]+/g) || []).length
    }

    return { chars, words, paragraphs, selectedChars, selectedWords }
  }

  /** 设置数字水印 (R35) — 先应用渲染器, 再经 command 落盘 doc.pageSetup.watermark (§12.4) */
  setWatermark(config: WatermarkConfig): void {
    // 先更新渲染器水印状态, 使随后 command 触发的同步 document:changed render 显示新水印
    this.draw.setWatermark(config)
    // 再经 SetPageSetupCommand 持久化 (undoable + dirty + serialize/load 往返)
    this.commandManager.execute(new SetPageSetupCommand(
      generateCommandId(), Date.now(), 'user',
      { watermark: config },
    ))
  }

  /** 自动更正: IME 输入后检测光标前文本是否需要替换 (R43) */
  private applyAutoCorrect(paragraphPath: string[]): void {
    const paraId = paragraphPath[paragraphPath.length - 1]
    if (!paraId) return

    // 获取段落完整文本
    const para = this.pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
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
  setShowInvisible(v: boolean): void {
    this.draw.showInvisible = v
    this.store.setShowInvisible(v)
  }
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

  replace(query: string, replacement: string, result: MatchResult, options?: FindOptions): ReplaceRejection[] {
    const newText = this.findReplace.computeReplacement(query, result.matchedText, replacement, options)
    const cmd = new ReplaceTextCommand(
      generateCommandId(), Date.now(), 'user',
      [{
        paragraphPath: result.paragraphPath,
        startOffset: result.startOffset,
        endOffset: result.endOffset,
        newText,
      }],
    )
    this.commandManager.execute(cmd)
    // 契约 §26: 返回被拒绝的替换明细 (空 = 替换成功), 供 UI 表达「拒绝 + 理由」
    return [...cmd.rejected]
  }

  /** 全部替换结果: replaced = 成功替换节点数, rejected = 被拒绝明细 (含理由) */
  replaceAll(query: string, replacement: string, options?: FindOptions): { replaced: number; rejected: ReplaceRejection[] } {
    const results = this.findReplace.findAll(query, this.doc, this.pool, options)
    if (results.length === 0) return { replaced: 0, rejected: [] }

    const edits = results.map(r => ({
      paragraphPath: r.paragraphPath,
      startOffset: r.startOffset,
      endOffset: r.endOffset,
      newText: this.findReplace.computeReplacement(query, r.matchedText, replacement, options),
    }))
    const cmd = new ReplaceTextCommand(generateCommandId(), Date.now(), 'user', edits)
    this.commandManager.execute(cmd)
    // 契约 §26: replaced 取实际成功节点数, rejected 携带理由 (非静默失败)
    return { replaced: cmd.appliedCount, rejected: [...cmd.rejected] }
  }

  highlightAll(query: string, options?: FindOptions): MatchResult[] {
    return this.findReplace.highlightAll(query, this.doc, this.pool, options)
  }

  /** 为打印准备页面 — 返回每页 canvas dataURL 数组 */
  preparePrintPages(): string[] {
    const pages = this.draw.getPages()
    const result: string[] = []
    const surface = this.host.surface
    const dpr = surface.devicePixelRatio() || 1

    for (const page of pages) {
      const offscreen = surface.createOffscreen(page.width * dpr, page.height * dpr)
      const pctx = offscreen.ctx

      pctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      pctx.fillStyle = '#FFFFFF'
      pctx.fillRect(0, 0, page.width, page.height)

      // 渲染页面内容 (复用现有渲染管线)
      this.draw.renderPageToContext(pctx, page, page.width)
      result.push(offscreen.toDataURL('image/png'))
    }
    return result
  }

  /** 插入交叉引用 — 在当前光标位置创建 CrossReferenceNode */
  insertCrossReference(targetId: string, refType: string, displayText: string): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    this.commandManager.execute(new InsertInlineNodeCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath, cursor.offset,
      () => ({
        type: 'cross_reference' as const,
        id: generateCommandId(),
        refType, targetRef: targetId, displayText,
        font: 'SimSun', size: 16, bold: false, italic: false,
        underline: true, color: '#2563EB',  // 蓝色下划线表示链接
      } as unknown as BaseNode),
    ))
  }

  /** 插入分节符 — 在当前段落后创建 SectionBreak */
  insertSectionBreak(): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    this.commandManager.execute(new InsertBlockCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath,
      (pool) => {
        const breakNode = {
          type: 'section_break' as const,
          id: generateCommandId(),
          breakType: 'next_page' as const,
          nextPageSetup: { ...this.doc.pageSetup },
        } as unknown as BaseNode
        pool.addNode(breakNode)
        return breakNode
      },
      { withTrailingParagraph: true, moveCursorToTrailing: true },
    ))
  }

  /** 注册演示插件 (验证 PluginManager 系统) */
  getPluginManager(): PluginManager { return this.pluginManager }

  destroy(): void {
    this.listeners = []
    this.detachContainer()
    this.detachGlobal()
    this.keyboardHandler.destroy()
    this.mouseHandler.destroy()
    this.inputComposer.destroy()
    this.draw.destroy()
    this.autoSave.destroy()
  }

  /** 获取 AutoSaveManager (供页面卸载时立即保存) */
  getAutoSave(): AutoSaveManager { return this.autoSave }
  getPerfMetrics(): PerformanceMetrics { return this.perfMetrics }

  /** 获取字体管理器 (字体注册等前向兼容访问) */
  getFontManager(): FontManager { return this.fontManager }
  /** 获取文本测量器 (测量/命中测试前向兼容访问) */
  getTextMeasurer(): TextMeasurer { return this.measurer }

  on(event: EditorEventType, cb: (...args: unknown[]) => void): void {
    this.listeners.push({ event, callback: cb })
  }
  off(event: EditorEventType, cb: (...args: unknown[]) => void): void {
    this.listeners = this.listeners.filter(l => !(l.event === event && l.callback === cb))
  }
  private notifyListeners(event: EditorEventType, ...args: unknown[]): void {
    // 文档内容/光标变化后, 在通知 React 监听器前先同步 UI 投影 (保证快照读取到最新值)
    if (event === 'contentChange') this.syncUiProjections()
    this.listeners.filter(l => l.event === event).forEach(l => {
      try { l.callback(...args) } catch (err) { console.error(`[Editor] "${event}" listener error:`, err) }
    })
  }
}

export type EditorEventType = 'ready' | 'contentChange' | 'modeChange' | 'selectionChange' | 'save'
export interface EditorListener { event: EditorEventType; callback: (...args: unknown[]) => void }

/**
 * 控件无缝内联编辑目标 (契约 §12.6) — 由 Draw.getControlEditTarget 产出,
 * 供 RuntimeControlOverlay 做透明无框的同字体编辑对齐。字段为 CSS px。
 */
export interface ControlEditTarget {
  /** 文本编辑内容区 (方括号框=括号内 / textarea=内容区), CSS px */
  textArea: { left: number; top: number; width: number; height: number; right: number }
  /** 文本基线相对内容区顶的高度 (ascent*scale), 供 line-height/垂直对齐 */
  ascentCss: number
  descentCss: number
  /** 字体真实行 ascent (CSS px) — overlay 用它抵消 DOM 输入框与 Canvas 的基线差 */
  lineAscentCss: number
  fontFamily: string
  /** overlay 应设的 css font-size = size*scale */
  fontSizeCss: number
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  bracketOn: boolean
  affordance: 'dropdown' | 'calendar' | null
  color: string
  caretColor: string
  /** 空态占位名 (已剥方括号), 作 native placeholder */
  placeholderText: string
  empty: boolean
  writable: boolean
  masked: boolean
  minRows?: number
}

/** IEditor 公共 API (SDK 集成面) */
export interface IEditor {
  getDocument(): DocumentTree
  setDocument(doc: DocumentTree): void
  execCommand(command: ICommand): void
  undo(): void; redo(): void
  canUndo(): boolean; canRedo(): boolean
  copy(): void; paste(): void
  cut(): void
  deleteSelectedRange(): boolean
  deleteNode(nodeId: string): boolean
  getActiveControlId(): string | null
  activateControl(nodeId: string | null): void
  deactivateControl(): void
  setControlValue(nodeId: string, value: ControlValue | undefined): ControlValueValidationResult
  getControlValue(nodeId: string): ControlValue | undefined
  getControlSnapshot(nodeId: string): ControlSnapshot | null
  getControlClientRect(nodeId: string): { left: number; top: number; width: number; height: number } | null
  getControlEditTarget(nodeId: string): ControlEditTarget | null
  getRegionControlIds(anchorNodeId: string): string[]
  getAdjacentControlId(nodeId: string, dir: 1 | -1): string | null
  applyControlConfig(
    nodeId: string,
    element: ElementMeta,
    definition?: TemplateDefinition,
    opts?: { clearValueIfIncompatible?: boolean },
  ): void
  toggleFormat(style: Partial<import('./document/core/DocumentModel').TextStyle>): void
  setParagraphStyle(style: Partial<import('./document/core/DocumentModel').ParagraphStyle>): void
  resolveContextAt(e: MouseEvent): import('./context/EditorContext').EditorContextSnapshot
  getWordCount(): { chars: number; words: number; paragraphs: number; selectedChars?: number; selectedWords?: number }
  on(event: EditorEventType, cb: (...args: unknown[]) => void): void
  off(event: EditorEventType, cb: (...args: unknown[]) => void): void
  destroy(): void
}
