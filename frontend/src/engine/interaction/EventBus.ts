// ================================================================
// EventBus — 引擎事件总线 (架构 §8.1, v20.34)
//
// 类型安全的事件载荷 (EventPayloadMap)
// Handler → EventBus (emit) | Draw ← EventBus (listen)
// ================================================================

import type { StatePatch } from '../command/ICommand'
import type { CursorState, SelectionState, EditorMode } from '../state/EditorRuntimeState'
import type { InvalidationScope } from '../command/ICommand'
import type { SLIFPage } from '../layout/SLIF'

// ---- EventPayloadMap — 每种事件的类型化载荷 ----

export interface EventPayloadMap {
  'render:request': []
  'layout:changed': [slifPages: SLIFPage[]]
  'state:changed': [patch: StatePatch]
  'document:changed': [{ invalidation: InvalidationScope; dirtyNodeIds: string[] }]
  'cursor:moved': [cursor: CursorState]
  'selection:changed': [selection: SelectionState]
  'mode:changed': [mode: EditorMode]
  'scale:changed': [scale: number]
  'yjs:synced': []
  'qc:completed': [result: unknown]
  'save:versionConflict': []
}

export type EngineEvent = keyof EventPayloadMap

// ---- EventBus ----

export type EventHandler<E extends EngineEvent> = (...args: EventPayloadMap[E]) => void

export class EventBus {
  private listeners = new Map<EngineEvent, Set<EventHandler<EngineEvent>>>()

  on<E extends EngineEvent>(event: E, handler: EventHandler<E>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler as EventHandler<EngineEvent>)
  }

  off<E extends EngineEvent>(event: E, handler: EventHandler<E>): void {
    this.listeners.get(event)?.delete(handler as EventHandler<EngineEvent>)
  }

  emit<E extends EngineEvent>(event: E, ...args: EventPayloadMap[E]): void {
    this.listeners.get(event)?.forEach(handler => {
      try {
        ;(handler as (...a: unknown[]) => void)(...args)
      } catch (err) {
        console.error(`[EventBus] Error in ${event} handler:`, err)
      }
    })
  }

  /** 清空所有监听器 (dispose) */
  clear(): void {
    this.listeners.clear()
  }
}
