// ============================================================
// 编辑器入口 (Facade) - 对外统一 API
// ============================================================

import {
  type IElement,
  type IEditorOption,
  type IDocument,
  EditorMode,
  PageMode,
} from './document/DocumentModel'
import { Draw } from './render/Draw'
import { EventBus } from './EventBus'

export class Editor {
  private draw: Draw
  private eventBus: EventBus

  // 监听器
  private listeners: EditorListener[] = []

  constructor(
    container: HTMLElement,
    data?: { header?: IElement[]; main?: IElement[]; footer?: IElement[] },
    options?: Partial<IEditorOption>
  ) {
    this.draw = new Draw(container, options)
    this.eventBus = this.draw.getEventBus()

    // 设置初始数据
    if (data) {
      this.draw.setValue(
        data.header || [],
        data.main || [],
        data.footer || []
      )
    }

    // 转发内部事件
    this.setupEventForwarding()

    // 通知就绪
    this.notifyListeners('ready')
  }

  private setupEventForwarding(): void {
    this.eventBus.on('contentChange', () => {
      this.notifyListeners('contentChange', this.getValue())
    })
    this.eventBus.on('modeChange', (data) => {
      this.notifyListeners('modeChange', data)
    })
  }

  // ==================== 数据操作 ====================

  getValue(): { header: IElement[]; main: IElement[]; footer: IElement[] } {
    return this.draw.getValue()
  }

  setValue(data: { header?: IElement[]; main?: IElement[]; footer?: IElement[] }): void {
    this.draw.setValue(
      data.header || [],
      data.main || [],
      data.footer || []
    )
  }

  getDocument(title: string, author: string): IDocument {
    const value = this.draw.getValue()
    const pageSetup = this.draw.getPageSetup()
    const now = new Date().toISOString()
    return {
      id: `doc_${Date.now()}`,
      title,
      header: value.header,
      main: value.main,
      footer: value.footer,
      pageSetup,
      metadata: {
        author,
        createdAt: now,
        updatedAt: now,
        version: 1,
        status: 'draft',
      },
    }
  }

  // ==================== 模式控制 ====================

  setMode(mode: EditorMode): void {
    this.draw.setMode(mode)
  }

  getMode(): EditorMode {
    return this.draw.options.mode || EditorMode.EDIT
  }

  setPageMode(mode: PageMode): void {
    this.draw.setPageMode(mode)
  }

  // ==================== 历史操作 ====================

  undo(): void {
    this.draw.undo()
  }

  redo(): void {
    this.draw.redo()
  }

  canUndo(): boolean {
    return this.draw.canUndo()
  }

  canRedo(): boolean {
    return this.draw.canRedo()
  }

  // ==================== 监听器 ====================

  on(event: EditorEventType, callback: (...args: unknown[]) => void): void {
    this.listeners.push({ event, callback })
  }

  off(event: EditorEventType, callback: (...args: unknown[]) => void): void {
    this.listeners = this.listeners.filter(
      l => !(l.event === event && l.callback === callback)
    )
  }

  private notifyListeners(event: EditorEventType, ...args: unknown[]): void {
    this.listeners
      .filter(l => l.event === event)
      .forEach(l => l.callback(...args))
  }

  // ==================== 生命周期 ====================

  focus(): void {
    this.draw.focus()
  }

  destroy(): void {
    this.listeners = []
    this.draw.destroy()
  }
}

// ==================== 类型 ====================

type EditorEventType = 'ready' | 'contentChange' | 'modeChange' | 'selectionChange' | 'save';

interface EditorListener {
  event: EditorEventType;
  callback: (...args: unknown[]) => void;
}
