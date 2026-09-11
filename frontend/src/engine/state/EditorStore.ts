// ================================================================
// EditorStore — 编辑器全局状态 (替代 Zustand, 零框架依赖)
//
// engine/ 层不依赖任何 UI 框架。EditorStore 是纯 TS 可观察对象，
// React 端通过 EditorProvider 订阅状态变更。
// ================================================================

import { createDefaultRuntimeState, type EditorRuntimeState, type CursorState, type SelectionState, type EditorMode } from './EditorRuntimeState'
import { DEFAULT_HEADER_FOOTER_CONFIG, type DocumentTree, type HeaderFooterConfig, type TextStyle } from '../document/core/DocumentModel'

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict'

/** 光标处段落格式投影 (扁平化 list 字段, 供 Toolbar active 状态) */
export interface ParagraphStyleProjection {
  alignment?: string
  listType?: string
  listLevel?: number
  numberStyle?: string
  continueNumbering?: boolean
  indent?: number
  outlineLevel?: number
  lineHeight?: number
  firstLineIndent?: number
}

export interface EditorStoreState {
  document: DocumentTree | null
  /** 文档标题投影 (canonical owner = DocumentTree.title, 此处为 UI 读取投影) */
  documentTitle: string
  runtime: EditorRuntimeState
  isDirty: boolean
  saveStatus: SaveStatus
  /** 格式刷是否激活 (canonical owner, §7.2) */
  formatPainterActive: boolean
  /**
   * 页眉页脚编辑模式 (canonical owner, §7.2)。
   * `pageIndex` = 编辑目标页「钉子」: 页眉页脚段落每页都有副本, 若不定页,
   * 光标/控件 overlay 会恒解析到第 0 页。瞬态, 不序列化 (契约 §7.2/§7.9)。
   */
  headerFooterEdit: { active: boolean; section: 'header' | 'footer'; pageIndex: number }
  /** 光标处段落格式投影 (canonical owner = DocumentModel, 此处为 UI 读取投影) */
  paragraphStyle: ParagraphStyleProjection | null
  /** 光标处文本样式投影 (canonical owner = DocumentModel, 此处为 UI 读取投影) */
  textStyle: TextStyle | null
  /** 页眉页脚选项投影 (canonical owner = DocumentTree, 此处为 UI 读取投影) */
  headerFooterConfig: HeaderFooterConfig
  /** 设计模式选中的控件节点 id (canonical owner = Editor, 契约 §12.3) — 无选中为 null */
  designSelectedControlId: string | null
  /** 设计模式悬停的控件节点 id (canonical owner = Editor, 契约 §12.3) — 供 UI 悬浮提示, 无悬停为 null */
  designHoveredControlId: string | null
  /** 运行时激活的控件节点 id (canonical owner = Editor, 契约 §12.6 运行时交互) — 瞬态, 不序列化, 无激活为 null */
  activeControlId: string | null
}

type Listener = (state: EditorStoreState) => void

export class EditorStore {
  private _state: EditorStoreState
  private listeners = new Set<Listener>()
  /** 光标/选区变更订阅 (setCursor/setSelection/updateSelection 触发, 不含 setCursorVisible 闪烁) */
  private cursorSelectionListeners = new Set<() => void>()
  /** 单调递增版本号 — 供 useSyncExternalStore 检测变更 (in-place mutation 下引用不变) */
  private version = 0

  constructor(doc?: DocumentTree) {
    this._state = {
      document: doc ?? null,
      documentTitle: doc?.title ?? '',
      runtime: createDefaultRuntimeState(),
      isDirty: false,
      saveStatus: 'saved',
      formatPainterActive: false,
      headerFooterEdit: { active: false, section: 'header', pageIndex: 0 },
      paragraphStyle: null,
      textStyle: null,
      headerFooterConfig: { ...DEFAULT_HEADER_FOOTER_CONFIG },
      designSelectedControlId: null,
      designHoveredControlId: null,
      activeControlId: null,
    }
  }

  get state(): Readonly<EditorStoreState> { return this._state }

  /** 当前版本号 (每次 notify 递增)。React 端 useSyncExternalStore 以此为快照。 */
  getVersion(): number { return this.version }

  /** 更新运行时状态 (按 key 字段级 merge) — 不再自动 mark dirty, 由调用方决定 */
  updateRuntime(patch: Partial<EditorRuntimeState>): void {
    Object.assign(this._state.runtime, patch)
    this.notify()
  }

  /**
   * 设置光标位置 (完整替换).
   *
   * 架构契约 (AI_EDITOR_CONTRACT §6, §7):
   * - 这是 cursor 字段的唯一受控写入入口.
   * - 不通过 Command 系统的事件链, 因此不触发 EventBus 'cursor:moved'.
   * - 调用方负责在 setCursor 后调用 draw.render() 同步画面.
   */
  setCursor(cursor: CursorState): void {
    this._state.runtime.cursor = cursor
    this.notify()
    this.notifyCursorSelectionChanged()
  }

  /**
   * 设置选区 (完整替换).
   *
   * 架构契约 (AI_EDITOR_CONTRACT §6, §7):
   * - 这是 selection 字段的唯一受控写入入口.
   * - 不通过 Command 系统的事件链, 因此不触发 EventBus 'selection:changed'.
   */
  setSelection(selection: SelectionState): void {
    this._state.runtime.selection = selection
    this.notify()
    this.notifyCursorSelectionChanged()
  }

  /**
   * 局部更新选区 (用于 Shift+方向键扩展选区等场景).
   */
  updateSelection(patch: Partial<SelectionState>): void {
    Object.assign(this._state.runtime.selection, patch)
    this.notify()
    this.notifyCursorSelectionChanged()
  }

  /**
   * 仅更新光标可见性 (供光标闪烁使用).
   *
   * 不影响其他光标字段, 避免每 530ms 的闪烁触发不必要的下游计算.
   */
  setCursorVisible(visible: boolean): void {
    if (this._state.runtime.cursor.visible === visible) return
    this._state.runtime.cursor.visible = visible
    this.notify()
  }

  /** 更新文档引用 */
  setDocument(doc: DocumentTree): void {
    this._state.document = doc
    this.notify()
  }

  /** 文档标题投影 — 由 Editor 在 setDocument / 标题命令后同步 (canonical = DocumentTree.title) */
  setDocumentTitle(title: string): void {
    if (this._state.documentTitle === title) return
    this._state.documentTitle = title
    this.notify()
  }

  /** 保存状态 */
  setSaveStatus(status: SaveStatus): void {
    this._state.saveStatus = status
    this.notify()
  }

  setDirty(dirty: boolean): void {
    this._state.isDirty = dirty
    this.notify()
  }

  /** 格式刷激活状态 — 唯一受控写入入口 */
  setFormatPainterActive(active: boolean): void {
    this._state.formatPainterActive = active
    this.notify()
  }

  /** 页眉页脚编辑模式 — 唯一受控写入入口 */
  setHeaderFooterEdit(active: boolean, section?: 'header' | 'footer', pageIndex?: number): void {
    this._state.headerFooterEdit.active = active
    if (section) this._state.headerFooterEdit.section = section
    if (pageIndex !== undefined) this._state.headerFooterEdit.pageIndex = Math.max(0, Math.floor(pageIndex))
    this.notify()
  }

  /** 光标处段落格式投影 — 由 Editor 在文档/光标变化后同步 */
  setParagraphStyle(style: ParagraphStyleProjection | null): void {
    this._state.paragraphStyle = style
    this.notify()
  }

  /** 光标处文本样式投影 — 由 Editor 在文档/光标变化后同步 */
  setTextStyle(style: TextStyle | null): void {
    this._state.textStyle = style
    this.notify()
  }

  /** 页眉页脚选项投影 — 由 Editor.setHeaderFooterConfig 同步 (canonical = DocumentTree) */
  setHeaderFooterConfig(config: HeaderFooterConfig): void {
    this._state.headerFooterConfig = config
    this.notify()
  }

  /** 编辑模式 (edit/readonly/form/clean/design/print) — 唯一受控写入入口 */
  setMode(mode: EditorMode): void {
    this._state.runtime.view.mode = mode
    this.notify()
  }

  /** 设计模式选中控件 (契约 §12.3) — 唯一受控写入入口, 同值不重复通知 */
  setDesignSelectedControlId(id: string | null): void {
    if (this._state.designSelectedControlId === id) return
    this._state.designSelectedControlId = id
    this.notify()
  }

  /** 设计模式悬停控件 (契约 §12.3) — 唯一受控写入入口, 同值不重复通知 */
  setDesignHoveredControlId(id: string | null): void {
    if (this._state.designHoveredControlId === id) return
    this._state.designHoveredControlId = id
    this.notify()
  }

  /** 运行时激活控件 (契约 §12.6 运行时交互) — 瞬态, 唯一受控写入入口, 同值不重复通知 */
  setActiveControlId(id: string | null): void {
    if (this._state.activeControlId === id) return
    this._state.activeControlId = id
    this.notify()
  }

  /** 缩放比例 (0.25–4.0) — 唯一受控写入入口 (渲染用 scale 由 Draw 经 Editor.setScale 同步) */
  setScale(scale: number): void {
    this._state.runtime.view.scale = scale
    this.notify()
  }

  /** 不可见字符显示开关 — 唯一受控写入入口 */
  setShowInvisible(showInvisible: boolean): void {
    this._state.runtime.view.showInvisible = showInvisible
    this.notify()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 订阅光标/选区变更 (setCursor/setSelection/updateSelection)。
   * 供 Editor 在光标/选区移动后重新同步 paragraphStyle/textStyle 投影。
   * 不触发于 setCursorVisible (光标闪烁) 与投影写入 (防回环)。
   */
  onCursorOrSelectionChange(cb: () => void): () => void {
    this.cursorSelectionListeners.add(cb)
    return () => { this.cursorSelectionListeners.delete(cb) }
  }

  private notify(): void {
    this.version++
    this.listeners.forEach(l => { try { l(this._state) } catch {} })
  }

  private notifyCursorSelectionChanged(): void {
    this.cursorSelectionListeners.forEach(cb => { try { cb() } catch {} })
  }
}
