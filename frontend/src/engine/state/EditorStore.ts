// ================================================================
// EditorStore — 编辑器全局状态 (替代 Zustand, 零框架依赖)
//
// engine/ 层不依赖任何 UI 框架。EditorStore 是纯 TS 可观察对象，
// React 端通过 EditorProvider 订阅状态变更。
// ================================================================

import { createDefaultRuntimeState, type EditorRuntimeState } from './EditorRuntimeState'
import type { DocumentTree } from '../document/DocumentModel'

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict'

export interface EditorStoreState {
  document: DocumentTree | null
  runtime: EditorRuntimeState
  isDirty: boolean
  saveStatus: SaveStatus
}

type Listener = (state: EditorStoreState) => void

export class EditorStore {
  private _state: EditorStoreState
  private listeners = new Set<Listener>()

  constructor(doc?: DocumentTree) {
    this._state = {
      document: doc ?? null,
      runtime: createDefaultRuntimeState(),
      isDirty: false,
      saveStatus: 'saved',
    }
  }

  get state(): Readonly<EditorStoreState> { return this._state }

  /** 更新运行时状态 (按 key 字段级 merge) */
  updateRuntime(patch: Partial<EditorRuntimeState>): void {
    Object.assign(this._state.runtime, patch)
    this._state.isDirty = true
    this.notify()
  }

  /** 更新文档引用 */
  setDocument(doc: DocumentTree): void {
    this._state.document = doc
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

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    this.listeners.forEach(l => { try { l(this._state) } catch {} })
  }
}
