// ================================================================
// InputComposer — IME 输入法抽象层 (架构 §8.4, v20.34)
//
// 封装浏览器 composition 事件差异 (Chrome/Firefox/Safari)
// 向上暴露统一事件, 向下封装 hidden textarea
// ================================================================

export interface CaretRect {
  left: number
  top: number
  width: number
  height: number
}

export class InputComposer {
  private textarea: HTMLTextAreaElement
  composing = false
  private compositionJustEnded = false
  private callbacks = {
    start: [] as (() => void)[],
    update: [] as ((text: string) => void)[],
    end: [] as ((text: string) => void)[],
  }

  constructor(container: HTMLElement) {
    this.textarea = document.createElement('textarea')
    Object.assign(this.textarea.style, {
      position: 'fixed', opacity: '0', width: '1px', height: '1px',
      left: '0', top: '0', border: 'none', outline: 'none',
      resize: 'none', overflow: 'hidden',
      fontSize: '1px', lineHeight: '1px', padding: '0',
    })
    container.appendChild(this.textarea)

    this.textarea.addEventListener('compositionstart', () => {
      this.composing = true; this.compositionJustEnded = false
      this.callbacks.start.forEach(cb => cb())
    })
    this.textarea.addEventListener('compositionupdate', (e: CompositionEvent) => {
      this.callbacks.update.forEach(cb => cb(e.data || ''))
    })
    this.textarea.addEventListener('compositionend', (e: CompositionEvent) => {
      this.composing = false; this.compositionJustEnded = true
      this.textarea.value = ''
      const text = e.data || ''
      if (text) this.callbacks.end.forEach(cb => cb(text))
      setTimeout(() => { this.compositionJustEnded = false }, 50)
    })
    // Firefox/Safari 去重
    this.textarea.addEventListener('input', () => {
      if (this.compositionJustEnded || this.composing) return
      const val = this.textarea.value
      if (val) { this.callbacks.end.forEach(cb => cb(val)); this.textarea.value = '' }
    })
  }

  onCompositionStart(cb: () => void): void { this.callbacks.start.push(cb) }
  onCompositionUpdate(cb: (text: string) => void): void { this.callbacks.update.push(cb) }
  onCompositionEnd(cb: (text: string) => void): void { this.callbacks.end.push(cb) }

  /** 更新隐藏 textarea 位置 — 浏览器据此定位 IME 候选窗 */
  updateCursorRect(rect: CaretRect): void {
    // textarea 放置在光标底部 (rect.top + rect.height)
    // fontSize/lineHeight 设为 1px 消除 textarea 内部文字光标偏移
    Object.assign(this.textarea.style, {
      left: `${rect.left}px`,
      top: `${rect.top + rect.height}px`,
      width: `${Math.max(rect.width, 1)}px`,
      height: `${Math.max(rect.height, 1)}px`,
      fontSize: '1px',
      lineHeight: '1px',
      padding: '0',
    })
  }

  focus(): void { this.textarea.focus() }
  destroy(): void { this.textarea.remove() }
}
