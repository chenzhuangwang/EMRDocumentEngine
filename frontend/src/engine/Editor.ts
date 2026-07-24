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

    // 转发内部事件（必须在 setValue 之前，否则 setValue 触发的
    // contentChange 事件会在 listener 注册前发射而丢失）
    this.setupEventForwarding()

    // 设置初始数据
    if (data) {
      this.draw.setValue(
        data.header || [],
        data.main || [],
        data.footer || []
      )
    }

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

  // ==================== 格式化操作 ====================

  toggleBold(): void { this.draw.toggleBold() }
  toggleItalic(): void { this.draw.toggleItalic() }
  toggleUnderline(): void { this.draw.toggleUnderline() }
  toggleStrikeout(): void { this.draw.toggleStrikeout() }
  toggleSuperscript(): void { this.draw.toggleSuperscript() }
  toggleSubscript(): void { this.draw.toggleSubscript() }
  setAlignment(alignment: string): void { this.draw.setAlignment(alignment) }
  insertTable(rows: number, cols: number): void { this.draw.insertTable(rows, cols) }
  insertControl(controlType: string): void { this.draw.insertControl(controlType) }
  insertImage(src: string, width: number, height: number): void { this.draw.insertImage(src, width, height) }

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
      .forEach(l => {
        try {
          l.callback(...args)
        } catch (err) {
          console.error(`[Editor] Error in "${event}" listener:`, err)
        }
      })
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
