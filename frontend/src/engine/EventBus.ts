// ============================================================
// 事件总线 - 类型安全的发布/订阅系统
// ============================================================

type EventHandler<T = unknown> = (data: T) => void

export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map()

  on<T>(event: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler as EventHandler)
  }

  off<T>(event: string, handler: EventHandler<T>): void {
    this.handlers.get(event)?.delete(handler as EventHandler)
  }

  emit<T>(event: string, data: T): void {
    this.handlers.get(event)?.forEach(handler => {
      try {
        handler(data)
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err)
      }
    })
  }

  removeAll(): void {
    this.handlers.clear()
  }

  hasListeners(event: string): boolean {
    return (this.handlers.get(event)?.size ?? 0) > 0
  }
}
