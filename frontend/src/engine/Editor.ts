import type { DocumentTree, BaseNode, Paragraph } from './document/DocumentModel'
import { createDocument, createParagraph } from './document/ElementFormatter'
import { NodePool, buildNodePool } from './document/NodePool'
import { Draw } from './render/Draw'
import { EventBus } from './interaction/EventBus'
import { CommandManager } from './command/CommandManager'
import { InputComposer } from './interaction/IMEHandler'
import { KeyboardHandler } from './interaction/KeyboardHandler'
import type { ICommand } from './command/ICommand'
import { generateCommandId } from './command/ICommand'
import { InsertTextCommand } from './command/commands/InsertTextCommand'
import { EditorStore } from './state/EditorStore'
import type { EditorRuntimeState } from './state/EditorRuntimeState'

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
  private listeners: EditorListener[] = []
  private _clickToFocus: (e: MouseEvent) => void

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
      const fn = new Map<string, BaseNode>()
      fn.set(this.doc.id, this.doc)
      this.pool = buildNodePool(fn, { body: this.doc.id })
    }

    this.eventBus = new EventBus()
    this.draw = new Draw(container, this.eventBus, this.doc)
    this.store = new EditorStore(this.doc)
    this.inputComposer = new InputComposer(container)
    this.keyboardHandler = new KeyboardHandler(this, container)
    this.commandManager = new CommandManager(
      this.eventBus,
      () => this.doc,
      () => this.pool,
    )

    // 状态变更 → 更新 Store + 重绘光标
    this.eventBus.on('state:changed', (patch) => {
      if (patch.cursor) this.store.updateRuntime({ cursor: { ...this.store.state.runtime.cursor, ...patch.cursor } })
      if (patch.selection) this.store.updateRuntime({ selection: { ...this.store.state.runtime.selection, ...patch.selection } })
      this.store.setDirty(true)
      // 光标位置变化 → 立即重绘
      this.draw.render(this.pool, this.store.state.runtime)
    })

    // document:changed → 重布局 + 重绘
    this.eventBus.on('document:changed', () => {
      this.draw.recomputeLayout(this.pool)
      this.draw.render(this.pool, this.store.state.runtime)
    })

    // IME 输入法: compositionend → InsertTextCommand
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
      const cmd = new InsertTextCommand(
        generateCommandId(), Date.now(), 'user',
        cursor.paragraphPath, cursor.offset, text,
      )
      this.commandManager.execute(cmd)
    })

    // 初始布局 + 首帧渲染
    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)

    // 初始化光标
    const cursorPath = this.doc.body.children.length > 0
      ? [this.doc.id, this.doc.body.children[0]]
      : []
    setCursor(this.store, cursorPath, 0)

    // 点击容器 → 命中检测 + 更新光标 + 聚焦
    this._clickToFocus = (e: MouseEvent) => {
      this.inputComposer.focus()
      this.handleClick(e)
    }
    container.addEventListener('click', this._clickToFocus)

    this.notifyListeners('ready')
  }

  /** 点击命中检测 → 更新光标到点击位置 */
  private handleClick(e: MouseEvent): void {
    const rect = this.container.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top + this.draw.getCoordinateSystem().transform.scrollY

    // 找到点击所在的页面
    const pages = this.draw.getPages()
    if (pages.length === 0) return

    // 计算 pageIndex 和 page-local Y
    let pageIndex = 0
    let localY = screenY
    for (let i = 0; i < pages.length; i++) {
      if (localY < pages[i].height) { pageIndex = i; break }
      localY -= pages[i].height
      pageIndex = i
    }
    const page = pages[pageIndex]
    if (!page) return

    // 从 A4 居中偏移还原文档坐标
    const viewportW = this.container.clientWidth
    const offsetX = Math.max(0, (viewportW - page.width) / 2)
    const docX = screenX - offsetX
    const docY = localY

    // 命中检测
    const nodeId = this.draw.getHitTestIndex().hitTest(docX, docY, pageIndex)
    if (!nodeId) return

    // 反查 nodeId 所属段落 + 字符偏移
    const para = this.findParagraphContaining(nodeId)
    if (!para) return

    const offset = this.computeOffsetAtX(para, docX, page)
    setCursor(this.store, [this.doc.id, para.id], offset)
    this.draw.render(this.pool, this.store.state.runtime)
  }

  /** 在 pool 中查找包含 nodeId 的 Paragraph */
  private findParagraphContaining(nodeId: string): Paragraph | null {
    for (const [, node] of this.pool.nodes) {
      if (node.type === 'paragraph') {
        const para = node as unknown as Paragraph
        if (para.children.includes(nodeId)) return para
      }
    }
    return null
  }

  /** 根据文档坐标 X 计算段落内的字符偏移 */
  private computeOffsetAtX(para: Paragraph, docX: number, page: import('./layout/SLIF').SLIFPage): number {
    let accumulated = 0
    // 遍历段落 children, 用 SLIF page items 的位置信息估算
    for (const childId of para.children) {
      const item = page.items.find(it => it.nodeId === childId)
      const text = (this.pool.nodes.get(childId) as unknown as { text?: string })?.text || ''
      if (item) {
        const charWidth = item.width / Math.max(text.length, 1)
        if (docX <= item.x + item.width) {
          const charIdx = Math.round((docX - item.x) / charWidth)
          return accumulated + Math.max(0, Math.min(charIdx, text.length))
        }
      }
      accumulated += text.length
    }
    return accumulated
  }

  getDocument(): DocumentTree { return this.doc }
  setDocument(doc: DocumentTree): void {
    this.doc = doc
    const fn = new Map<string, BaseNode>()
    fn.set(doc.id, doc)
    this.pool = buildNodePool(fn, { body: doc.id })
    this.draw.setDocument(doc, this.pool)
    this.draw.recomputeLayout(this.pool)

    const cursorPath = doc.body.children.length > 0
      ? [doc.id, doc.body.children[0]]
      : []
    setCursor(this.store, cursorPath, 0)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', doc)
  }

  execCommand(command: ICommand): void { this.commandManager.execute(command) }
  undo(): void { this.commandManager.undo() }
  redo(): void { this.commandManager.redo() }
  canUndo(): boolean { return this.commandManager.canUndo() }
  canRedo(): boolean { return this.commandManager.canRedo() }

  getEventBus(): EventBus { return this.eventBus }
  getDraw(): Draw { return this.draw }
  getPool(): NodePool { return this.pool }
  getInputComposer(): InputComposer { return this.inputComposer }
  getKeyboardHandler(): KeyboardHandler { return this.keyboardHandler }
  getStore(): EditorStore { return this.store }

  setRuntimeState(state: EditorRuntimeState): void { this.draw.setRuntimeState(state) }
  setScale(scale: number): void { this.draw.setScale(scale) }
  getScale(): number { return this.draw.getScale() }

  /** 聚焦编辑器 — 激活隐藏 textarea 以接收键盘/IME 事件 */
  focus(): void { this.inputComposer.focus() }

  destroy(): void {
    this.listeners = []
    this.container.removeEventListener('click', this._clickToFocus)
    this.keyboardHandler.destroy()
    this.inputComposer.destroy()
    this.draw.destroy()
  }

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

type EditorEventType = 'ready' | 'contentChange' | 'modeChange' | 'selectionChange' | 'save'
interface EditorListener { event: EditorEventType; callback: (...args: unknown[]) => void }
