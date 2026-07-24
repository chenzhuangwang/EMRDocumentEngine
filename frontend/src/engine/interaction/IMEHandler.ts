// ============================================================
// IME 输入法处理器 — hidden textarea proxy 模式
//
// 问题：Canvas 元素无法弹出浏览器原生 IME 候选窗
// 方案：composition 期间在光标位置放置透明 textarea，
//       让它捕获 IME 事件，渲染中间态文本到 Canvas，
//       compositionend 时将最终文本写入文档模型。
// ============================================================

import type { IElement } from '../document/DocumentModel'

// ---- 对外接口 ----

export interface IMEContext {
  /** 获取光标所在位置对应的文档坐标（用于定位 textarea） */
  getCursorScreenPosition(): { x: number; y: number; height: number } | null
  /** 获取光标所在元素的样式（用于继承到 composition 文本） */
  getCursorStyle(): Partial<IElement>
  /** 插入最终文本 */
  insertText(text: string, addHistory: boolean): void
  /** 触发 Canvas 重绘 */
  requestRender(): void
  /** 获取当前 composing 文本（由 IMEHandler 维护） */
  getComposingText(): string
  /** 设置 composing 文本 */
  setComposingText(text: string): void
  /** 获取 composing 状态 */
  isComposing(): boolean
  /** 聚焦回 Canvas */
  focusCanvas(): void
  /** 转发非 IME 的 keydown 到 Canvas 键盘处理，返回 true 表示已处理 */
  forwardKeyDown(e: KeyboardEvent): boolean
}

// ---- IMEHandler ----

export class IMEHandler {
  private textarea: HTMLTextAreaElement
  private context: IMEContext

  /** 是否正在 IME 组合中 */
  private _composing: boolean = false

  /** composition 期间的中间态文本 */
  private _composingText: string = ''

  /** Firefox 兼容：compositionend → input 事件顺序修复 */
  private compositionJustEnded: boolean = false

  // bound event refs for cleanup
  private boundOnCompositionStart: (e: CompositionEvent) => void
  private boundOnCompositionUpdate: (e: CompositionEvent) => void
  private boundOnCompositionEnd: (e: CompositionEvent) => void
  private boundOnInput: (e: Event) => void
  private boundOnKeyDown: (e: KeyboardEvent) => void

  constructor(container: HTMLElement, context: IMEContext) {
    this.context = context

    // 创建透明代理 textarea
    this.textarea = document.createElement('textarea')
    this.textarea.className = 'emr-ime-proxy'
    this.applyHiddenStyle()
    container.appendChild(this.textarea)

    // 绑定事件
    this.boundOnCompositionStart = this.onCompositionStart.bind(this)
    this.boundOnCompositionUpdate = this.onCompositionUpdate.bind(this)
    this.boundOnCompositionEnd = this.onCompositionEnd.bind(this)
    this.boundOnInput = this.onInput.bind(this)
    this.boundOnKeyDown = this.onKeyDown.bind(this)

    this.textarea.addEventListener('compositionstart', this.boundOnCompositionStart)
    this.textarea.addEventListener('compositionupdate', this.boundOnCompositionUpdate)
    this.textarea.addEventListener('compositionend', this.boundOnCompositionEnd)
    this.textarea.addEventListener('input', this.boundOnInput)
    this.textarea.addEventListener('keydown', this.boundOnKeyDown)
  }

  // ---- 公开 API ----

  get isComposing(): boolean {
    return this._composing
  }

  get composingText(): string {
    return this._composingText
  }

  /** 聚焦 textarea 并定位到光标位置 — 每次光标移动后都应调用 */
  focus(): void {
    this.positionProxy()
    this.textarea.focus()
  }

  /** 定位代理 textarea 到光标位置（不改变焦点） */
  positionProxy(): void {
    const pos = this.context.getCursorScreenPosition()
    if (!pos) {
      // 光标位置未知，放在视野外
      this.textarea.style.left = '-9999px'
      this.textarea.style.top = '-9999px'
      return
    }
    // 放在光标位置（浏览器会基于 textarea 位置弹出候选窗）
    // 注意：textarea 本身透明不可见，只用于接收 IME 事件
    this.textarea.style.left = `${pos.x}px`
    this.textarea.style.top = `${pos.y}px`
    this.textarea.style.height = `${Math.max(pos.height, 20)}px`
  }

  /** 销毁 */
  destroy(): void {
    this.textarea.removeEventListener('compositionstart', this.boundOnCompositionStart)
    this.textarea.removeEventListener('compositionupdate', this.boundOnCompositionUpdate)
    this.textarea.removeEventListener('compositionend', this.boundOnCompositionEnd)
    this.textarea.removeEventListener('input', this.boundOnInput)
    this.textarea.removeEventListener('keydown', this.boundOnKeyDown)
    if (this.textarea.parentElement) {
      this.textarea.parentElement.removeChild(this.textarea)
    }
  }

  // ---- 私有：隐藏样式 ----

  private applyHiddenStyle(): void {
    const s = this.textarea.style
    s.position = 'absolute'
    s.opacity = '0'
    s.pointerEvents = 'none'
    s.width = '1px'
    s.height = '20px'
    s.left = '-9999px'
    s.top = '-9999px'
    s.zIndex = '-1'
    s.border = 'none'
    s.outline = 'none'
    s.resize = 'none'
    s.overflow = 'hidden'
    // 关键：不能 display:none（否则不会触发 composition 事件）
    // 关键：不能 visibility:hidden（部分浏览器会跳过 IME）
  }

  // ---- 私有：composition 事件 ----

  private onCompositionStart(_e: CompositionEvent): void {
    this._composing = true
    this._composingText = ''
    this.compositionJustEnded = false

    // 定位代理 textarea 到光标位置
    this.positionProxy()

    // 通知 context
    this.context.setComposingText('')
  }

  private onCompositionUpdate(e: CompositionEvent): void {
    if (!this._composing) return

    this._composingText = e.data || ''
    this.context.setComposingText(this._composingText)

    // 刷新 Canvas 显示中间态
    this.context.requestRender()
  }

  private onCompositionEnd(e: CompositionEvent): void {
    this._composing = false
    const finalText = e.data || this._composingText
    this._composingText = ''
    this.context.setComposingText('')

    // 标记 composition 刚刚结束（Firefox 兼容）
    this.compositionJustEnded = true

    if (finalText) {
      // 写入文档模型（带 history）
      this.context.insertText(finalText, true)
    }

    // 清空 textarea 内容
    this.textarea.value = ''

    // 保持 textarea 聚焦（用户可能继续输入）
    // 不需要 refocus，它从未失焦
    this.context.requestRender()

    // 文本插入后光标已前移，立即把 textarea 移到新位置
    // 必须在下一个 compositionstart 之前完成，否则候选窗定位会错
    this.positionProxy()

    // Firefox: input 事件可能在 compositionend 之后才到
    // 用一个微小的延迟清除标记
    setTimeout(() => {
      this.compositionJustEnded = false
    }, 50)
  }

  // ---- 私有：input 事件（Firefox 回退 + 兜底） ----

  private onInput(_e: Event): void {
    // compositionJustEnded：Firefox 下 input 在 compositionend 之后触发，
    // 此时 compositionend 已经处理了 finalText，忽略这个 input
    if (this.compositionJustEnded) return

    // 非 composition 期间的 input（如语音输入、手写输入）— 兜底处理
    if (!this._composing && this.textarea.value) {
      const text = this.textarea.value
      this.context.insertText(text, true)
      this.textarea.value = ''
      this.context.requestRender()
    }
  }

  // ---- 私有：keydown on textarea ----

  private onKeyDown(e: KeyboardEvent): void {
    if (this._composing) {
      // composing 期间：Enter/Escape 对 IME 有特殊含义，放行
      // 其他按键也放行，让浏览器把 keydown 交给 IME
      return
    }

    // 非 composing 期间：转发给 Canvas 的 KeyboardHandler
    const handled = this.context.forwardKeyDown(e)
    if (handled) {
      e.preventDefault()
    }
  }
}
