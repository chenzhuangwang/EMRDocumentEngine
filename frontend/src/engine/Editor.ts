import type { DocumentTree, BaseNode, Paragraph } from './document/DocumentModel'
import { createDocument, createParagraph } from './document/ElementFormatter'
import { NodePool, buildNodePool } from './document/NodePool'
import { Draw } from './render/Draw'
import { EventBus } from './interaction/EventBus'
import { CommandManager } from './command/CommandManager'
import { InputComposer } from './interaction/IMEHandler'
import { KeyboardHandler } from './interaction/KeyboardHandler'
import { MouseHandler } from './interaction/MouseHandler'
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
  private mouseHandler: MouseHandler
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
    this.mouseHandler = new MouseHandler(this, container)
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

    // document:changed → 重布局 + 重绘 (唯一渲染入口)
    this.eventBus.on('document:changed', () => {
      const t0 = performance.now()
      this.draw.recomputeLayout(this.pool)
      const t1 = performance.now()
      const cursor = this.store.state.runtime.cursor
      console.debug(
        `[Editor] document:changed → recomputeLayout ${(t1 - t0).toFixed(1)}ms, ` +
        `cursor=(${cursor.paragraphPath.join('/')}, offset=${cursor.offset}), ` +
        `bodyChildren=[${this.doc.body.children.join(',')}]`
      )
      this.draw.render(this.pool, this.store.state.runtime)
    })

    // render:request (undo/redo 等) → 使用当前的 pool 和 state
    this.eventBus.on('render:request', () => {
      this.draw.recomputeLayout(this.pool)
      this.draw.render(this.pool, this.store.state.runtime)
    })

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
      const cmd = new InsertTextCommand(
        generateCommandId(), Date.now(), 'user',
        cursor.paragraphPath, cursor.offset, text,
      )
      this.commandManager.execute(cmd)
    })

    // 初始布局 + 首帧渲染
    this.draw.recomputeLayout(this.pool)

    // 初始化光标 — 必须在 render() 之前, 确保首帧即绘制光标
    const cursorPath = this.doc.body.children.length > 0
      ? [this.doc.id, this.doc.body.children[0]]
      : []
    setCursor(this.store, cursorPath, 0)

    this.draw.render(this.pool, this.store.state.runtime)

    // 点击容器 → 命中检测 + 更新光标 + 聚焦
    // 若刚结束拖拽则跳过, 避免覆盖选区
    this._clickToFocus = (e: MouseEvent) => {
      if (this.mouseHandler.wasDragging()) return
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

    const pages = this.draw.getPages()
    if (pages.length === 0) return

    let pageIndex = 0
    let localY = screenY
    for (let i = 0; i < pages.length; i++) {
      if (localY < pages[i].height) { pageIndex = i; break }
      localY -= pages[i].height
      pageIndex = i
    }
    const page = pages[pageIndex]
    if (!page) return

    const viewportW = this.container.clientWidth
    const offsetX = Math.max(0, (viewportW - page.width) / 2)
    const docX = screenX - offsetX
    const docY = localY

    // 命中检测 — 可能返回 null (空段落/点击在内容下方)
    const nodeId = this.draw.getHitTestIndex().hitTest(docX, docY, pageIndex)

    if (nodeId) {
      const para = this.findParagraphContaining(nodeId)
      if (para) {
        const offset = this.computeOffsetAtX(para, docX, page)
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
          const lastParaId = bodyChildren[bodyChildren.length - 1]
          const lastPara = this.pool.nodes.get(lastParaId) as unknown as Paragraph | undefined
          if (lastPara) {
            const endOffset = this.getParagraphTextLength(lastPara)
            setCursor(this.store, [this.doc.id, lastParaId], endOffset)
          }
        }
      } else if (firstItemTop >= 0 && docY < firstItemTop) {
        // 点击在所有内容上方 → 光标移到第一个段落开头
        const bodyChildren = this.doc.body.children
        if (bodyChildren.length > 0) {
          setCursor(this.store, [this.doc.id, bodyChildren[0]], 0)
        }
      }
      // 行间空白 (在内容范围内但未命中任何 item) → 光标保持原位, 不移动
    }

    // 单击清空选区
    const si = this.store as unknown as { _state: { runtime: { selection: { active: boolean } } } }
    si._state.runtime.selection.active = false

    // 无论命中与否都重绘
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
  private getPageContentBottom(page: import('./layout/SLIF').SLIFPage): number {
    if (page.items.length === 0) return -1
    let maxBottom = 0
    for (const item of page.items) {
      const bottom = item.y + item.ascent + item.descent
      if (bottom > maxBottom) maxBottom = bottom
    }
    return maxBottom
  }

  /** 获取页面中第一个 SLIF item 的顶部 Y 坐标, 无内容返回 -1 */
  private getPageContentTop(page: import('./layout/SLIF').SLIFPage): number {
    if (page.items.length === 0) return -1
    return page.items[0].y
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
    this.mouseHandler.destroy()
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
