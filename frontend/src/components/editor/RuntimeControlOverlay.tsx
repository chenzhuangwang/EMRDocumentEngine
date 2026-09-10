// ================================================================
// RuntimeControlOverlay — 控件「无缝内联编辑」覆盖层 (契约 §12.6)
//
// 激活输入类控件时, 在 Canvas 已隐藏静态 field 的位置放「同正文文本区」
// 的透明 DOM 编辑面: 无白底/无边框/无圆角, 字体与 Canvas 完全一致
// (getControlEditTarget 提供文本内容区几何+字体), 看起来就是光标直接落
// 在框里正常打字。
//
// 边界 (契约 §12.6/§12.7, VR-3):
//   - 值写入唯一路径 editor.setControlValue → SetControlValueCommand。
//   - 只读/掩码由 MouseHandler 拦截(不激活), 本组件防御分支只读展示。
//   - 统一提交: 文本类 widget 以 activeId 为 key; 切换/点空白/失焦/模式切
//     都会先卸载 → cleanup 幂等提交(settle 后不再提交), 不丢草稿。
//     Escape/discard → 卸载丢弃不提交。
// ================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorRef, useEditorStoreSnapshot } from './EditorProvider'
import { controlRejectMessage } from './controlMessages'
import type { ControlEditTarget, ControlSnapshot, ControlType, Editor } from '@/engine'

const PLACEHOLDER_COLOR = '#9CA3AF'

/** jsdom 无 requestAnimationFrame → setTimeout 兜底 (生产仍用原生) */
function raf(cb: FrameRequestCallback): number {
  return typeof requestAnimationFrame !== 'undefined'
    ? requestAnimationFrame(cb)
    : window.setTimeout(() => cb(Date.now()), 16)
}
function caf(id: number): void {
  if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(id)
  else window.clearTimeout(id)
}

let _measureCtx: CanvasRenderingContext2D | null = null
function textWidth(text: string, font: string): number {
  if (!_measureCtx) {
    try { const c = document.createElement('canvas'); _measureCtx = c.getContext('2d') } catch { _measureCtx = null }
  }
  if (!_measureCtx) return 0
  _measureCtx.font = font
  return _measureCtx.measureText(text).width
}

function sameTarget(a: ControlEditTarget | null, b: ControlEditTarget | null): boolean {
  if (!a || !b) return a === b
  const ta = a.textArea; const tb = b.textArea
  return ta.left === tb.left && ta.top === tb.top && ta.width === tb.width &&
    ta.height === tb.height && ta.right === tb.right && a.fontSizeCss === b.fontSizeCss &&
    a.fontFamily === b.fontFamily && a.align === b.align && a.color === b.color &&
    a.placeholderText === b.placeholderText && a.empty === b.empty &&
    a.masked === b.masked && a.writable === b.writable
}

function valueToText(v: ControlSnapshot['value'] | undefined): string {
  if (v === undefined) return ''
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.join('、')
  return v
}

function resolveControlType(snap: ControlSnapshot): ControlType {
  if (snap.controlType) return snap.controlType
  if (snap.multiple) return 'checkbox'
  if (snap.options !== undefined) return 'select'
  if (snap.dataType === 'N') return 'number'
  if (snap.dataType === 'D') return 'date'
  if (snap.dataType === 'S2' || snap.dataType === 'S3') return 'textarea'
  return 'input'
}

interface RuntimeControlOverlayProps {
  /** 画布滚动容器 (EditorPage 传入) — 内部点击由 MouseHandler 处理, 不触发去激活竞态 */
  canvasContainerRef: React.RefObject<HTMLDivElement | null>
}

export function RuntimeControlOverlay({ canvasContainerRef }: RuntimeControlOverlayProps) {
  const editorRef = useEditorRef()
  const activeId = useEditorStoreSnapshot((s) => s.activeControlId)
  const mode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const interactive = mode === 'edit' || mode === 'form'
  const [target, setTarget] = useState<ControlEditTarget | null>(null)

  // 几何跟随: 每帧读 getControlEditTarget (滚动/缩放/回流同源), 仅数值变化才重渲染
  useEffect(() => {
    if (!activeId || !interactive) return
    let r = 0
    const tick = () => {
      const ed = editorRef.current
      if (ed) {
        const t = ed.getControlEditTarget(activeId)
        setTarget((prev) => (sameTarget(prev, t) ? prev : t))
      }
      r = raf(tick)
    }
    r = raf(tick)
    return () => caf(r)
  }, [activeId, interactive, editorRef])

  // 点 overlay 之外且不在画布容器 → 去激活 (卸载旧 widget → cleanup 提交)
  useEffect(() => {
    if (!activeId || !interactive) return
    const onPointerDown = (e: PointerEvent) => {
      const ed = editorRef.current
      if (!ed) return
      const host = document.getElementById('ctl-overlay-host')
      const t = e.target as Node | null
      if (t && host?.contains(t)) return
      if (t && canvasContainerRef.current?.contains(t)) return
      ed.deactivateControl()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [activeId, interactive, editorRef, canvasContainerRef])

  if (!activeId || !interactive || !target) return null
  const ed = editorRef.current
  if (!ed) return null
  const snap = ed.getControlSnapshot(activeId)
  if (!snap) return null

  if (target.masked || !snap.writable) {
    const text = target.masked ? '••••••' : (valueToText(snap.value) || target.placeholderText)
    return (
      <div
        className="select-none"
        style={{
          position: 'fixed', left: target.textArea.left, top: target.textArea.top,
          width: target.textArea.width, height: target.textArea.height,
          fontFamily: target.fontFamily, fontSize: target.fontSizeCss,
          color: PLACEHOLDER_COLOR, lineHeight: `${target.ascentCss + target.descentCss}px`,
          whiteSpace: 'pre-wrap', overflow: 'hidden', pointerEvents: 'none',
        }}
      >
        {text}
      </div>
    )
  }

  const type = resolveControlType(snap)
  const kind = type === 'textarea' ? 'textarea' : type === 'select' || type === 'checkbox' || type === 'radio' ? 'select' : type
  return (
    <div
      id="ctl-overlay-host"
      data-ctl-overlay
      className="fixed z-40"
      style={{
        position: 'fixed', left: target.textArea.left, top: target.textArea.top,
        width: target.textArea.width, height: target.textArea.height,
      }}
    >
      {kind === 'textarea' ? <TextareaField key={activeId} snap={snap} target={target} editor={ed} />
        : kind === 'number' ? <NumberField key={activeId} snap={snap} target={target} editor={ed} />
          : kind === 'select' ? <SelectField key={activeId} snap={snap} target={target} editor={ed} />
            : kind === 'date' ? <DateField key={activeId} snap={snap} target={target} editor={ed} />
              : <TextField key={activeId} snap={snap} target={target} editor={ed} />}
    </div>
  )
}

/** 统一文本字段状态: onChange 本地草稿; 卸载即提交; 非法值就地提示 */
function useFieldText(snap: ControlSnapshot, editor: Editor) {
  const [draft, setDraft] = useState(() => valueToText(snap.value))
  const [error, setError] = useState<string | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const settledRef = useRef(false)
  const changedRef = useRef(false)

  useEffect(() => { setDraft(valueToText(snap.value)); setError(null) }, [snap.value, snap.nodeId])

  // 幂等提交; 返回是否提交成功 (ok 或无需提交)。非法 → 记 error + 回退, 且置 settled 防静默重试。
  const submit = useCallback((): boolean => {
    if (settledRef.current) return true
    if (!changedRef.current) return true // 未改动: 不置 settled (避免 StrictMode/卸载清理吞掉后续提交)
    settledRef.current = true
    const cur = draftRef.current
    const canon = valueToText(snap.value)
    if (cur === canon) return true
    const r = editor.setControlValue(snap.nodeId, cur === '' ? undefined : cur)
    if (r.ok) return true
    setError(controlRejectMessage(r.reason))
    setDraft(canon)
    return false
  }, [editor, snap.nodeId, snap.value])
  const submitRef = useRef(submit)
  submitRef.current = submit
  // 卸载即提交 (切换/点空白/失焦/模式切)
  useEffect(() => () => { submitRef.current() }, [])
  const done = useCallback(() => { settledRef.current = true }, [])
  const change = useCallback((v: string) => { changedRef.current = true; setError(null); setDraft(v) }, [])
  return { draft, error, change, submit, done }
}

/** 区域内在控件间跳转 (dir +1/-1); 无相邻则退出编辑 */
function goAdjacent(editor: Editor, nodeId: string, dir: 1 | -1): void {
  const next = editor.getAdjacentControlId(nodeId, dir)
  if (next && next !== nodeId) editor.activateControl(next)
  else editor.deactivateControl()
}

/** 校验失败提示 (控件下方小红字) */
function FieldHint({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div
      style={{
        position: 'absolute', left: 0, top: '100%', marginTop: 2,
        color: '#DC2626', fontSize: 12, lineHeight: '14px', whiteSpace: 'nowrap',
        pointerEvents: 'none', zIndex: 50,
      }}
    >
      {msg}
    </div>
  )
}

function useAutoFocus<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const id = raf(() => {
      el.focus()
      if (el instanceof HTMLInputElement && el.type !== 'date') el.select()
      else if (el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length)
    })
    return () => caf(id)
  }, [])
  return ref
}

function baseInputStyle(target: ControlEditTarget): React.CSSProperties {
  return {
    fontFamily: target.fontFamily,
    fontSize: target.fontSizeCss,
    fontWeight: target.bold ? 'bold' : undefined,
    fontStyle: target.italic ? 'italic' : undefined,
    color: target.empty ? PLACEHOLDER_COLOR : target.color,
    caretColor: target.caretColor,
    lineHeight: `${target.fontSizeCss}px`, // 与 Canvas 行距(size*scale)一致
    background: 'transparent',
    border: 'none',
    outline: 'none',
    padding: 0,
    margin: 0,
    boxShadow: 'none',
    borderRadius: 0,
    boxSizing: 'border-box',
  }
}

function TextField({ snap, target, editor }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor }) {
  const { draft, error, change, submit, done } = useFieldText(snap, editor)
  const inputRef = useAutoFocus<HTMLInputElement>()
  const font = `${target.bold ? 'bold ' : ''}${target.italic ? 'italic ' : ''}${target.fontSizeCss}px "${target.fontFamily}"`
  const w = Math.max(target.textArea.width, textWidth(draft || ' ', font) + 2)
  const topOff = target.ascentCss - (target.lineAscentCss || target.ascentCss)
  return (
    <>
      <input
        ref={inputRef}
        data-ctl-overlay
        type="text"
        value={draft}
        placeholder={target.placeholderText}
        style={{ ...baseInputStyle(target), textAlign: 'left', width: w, height: target.textArea.height, position: 'absolute', left: 0, top: topOff }}
        onChange={(e) => change(e.target.value)}
        onBlur={() => { submit() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (submit()) goAdjacent(editor, snap.nodeId, 1) }
          else if (e.key === 'Tab') { e.preventDefault(); submit(); goAdjacent(editor, snap.nodeId, e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') { e.preventDefault(); done(); editor.deactivateControl() }
        }}
      />
      <FieldHint msg={error} />
    </>
  )
}

function NumberField({ snap, target, editor }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor }) {
  const { draft, change, done } = useFieldText(snap, editor)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useAutoFocus<HTMLInputElement>()
  const font = `${target.bold ? 'bold ' : ''}${target.italic ? 'italic ' : ''}${target.fontSizeCss}px "${target.fontFamily}"`
  const w = Math.max(target.textArea.width, textWidth(draft || ' ', font) + 2)
  const topOff = target.ascentCss - (target.lineAscentCss || target.ascentCss)
  // 数值提交: 空 → 清空; 非数字/精度超限 → 就地提示, 不提交。
  // done() 阻断 useFieldText 的字符串卸载提交 (数值语义自管)。
  const commitNumber = (): boolean => {
    done()
    const t = draft.trim()
    if (t === '') { editor.setControlValue(snap.nodeId, undefined); return true }
    const n = Number(t)
    if (!Number.isFinite(n)) { setError('请输入数字'); return false }
    const r = editor.setControlValue(snap.nodeId, n)
    if (r.ok) return true
    setError(controlRejectMessage(r.reason)); return false
  }
  const changeClear = (v: string) => { setError(null); change(v) }
  return (
    <>
      <input
        ref={inputRef}
        data-ctl-overlay
        type="text" inputMode="decimal"
        value={draft}
        placeholder={target.placeholderText}
        style={{
          ...baseInputStyle(target), textAlign: 'right',
          width: w, height: target.textArea.height,
          position: 'absolute', left: Math.min(0, target.textArea.width - w), top: topOff,
        }}
        onChange={(e) => changeClear(e.target.value)}
        onBlur={() => { commitNumber() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (commitNumber()) goAdjacent(editor, snap.nodeId, 1) }
          else if (e.key === 'Tab') { e.preventDefault(); commitNumber(); goAdjacent(editor, snap.nodeId, e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') { e.preventDefault(); editor.deactivateControl() }
        }}
      />
      <FieldHint msg={error} />
    </>
  )
}

function TextareaField({ snap, target, editor }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor }) {
  const { draft, error, change, submit, done } = useFieldText(snap, editor)
  const ref = useAutoFocus<HTMLTextAreaElement>()
  const lineCount = Math.max(1, (draft.match(/\n/g)?.length ?? 0) + 1, target.minRows ?? 1)
  const topOff = target.ascentCss - (target.lineAscentCss || target.ascentCss)
  return (
    <>
      <textarea
        ref={ref}
        data-ctl-overlay
        rows={Math.min(lineCount, 12)}
        value={draft}
        placeholder={target.placeholderText}
        style={{
          ...baseInputStyle(target), textAlign: 'left',
          resize: 'none', whiteSpace: 'pre-wrap', overflowY: 'auto',
          width: '100%', height: '100%', position: 'absolute', left: 0, top: topOff,
        }}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') { e.preventDefault(); submit(); goAdjacent(editor, snap.nodeId, e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') { e.preventDefault(); done(); editor.deactivateControl() }
        }}
      />
      <FieldHint msg={error} />
    </>
  )
}

function SelectField({ snap, target, editor }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor }) {
  const [error, setError] = useState<string | null>(null)
  const current = typeof snap.value === 'string' ? snap.value : ''
  const font = `${target.bold ? 'bold ' : ''}${target.italic ? 'italic ' : ''}${target.fontSizeCss}px "${target.fontFamily}"`
  const w = Math.max(target.textArea.width, textWidth(current || target.placeholderText, font) + 24)
  const topOff = target.ascentCss - (target.lineAscentCss || target.ascentCss)
  return (
    <>
      <select
        data-ctl-overlay
        autoFocus
        value={current}
        style={{ ...baseInputStyle(target), width: w, height: target.textArea.height, cursor: 'pointer', position: 'absolute', left: 0, top: topOff }}
        onChange={(e) => {
          setError(null)
          const r = editor.setControlValue(snap.nodeId, e.target.value === '' ? undefined : e.target.value)
          if (!r.ok) setError(controlRejectMessage(r.reason))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') { e.preventDefault(); goAdjacent(editor, snap.nodeId, e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') { e.preventDefault(); editor.deactivateControl() }
        }}
      >
        <option value="">{target.placeholderText || '请选择'}</option>
        {(snap.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
      </select>
      <FieldHint msg={error} />
    </>
  )
}

function DateField({ snap, target, editor }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor }) {
  const { draft, error, change, submit, done } = useFieldText(snap, editor)
  const ref = useAutoFocus<HTMLInputElement>()
  const font = `${target.bold ? 'bold ' : ''}${target.italic ? 'italic ' : ''}${target.fontSizeCss}px "${target.fontFamily}"`
  const w = Math.max(target.textArea.width, textWidth(draft || 'YYYY-MM-DD', font) + 16)
  const topOff = target.ascentCss - (target.lineAscentCss || target.ascentCss)
  return (
    <>
      <input
        ref={ref}
        data-ctl-overlay
        type="date"
        value={draft}
        style={{ ...baseInputStyle(target), width: w, height: target.textArea.height, position: 'absolute', left: 0, top: topOff }}
        onChange={(e) => change(e.target.value)}
        onBlur={() => { submit() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (submit()) goAdjacent(editor, snap.nodeId, 1) }
          else if (e.key === 'Tab') { e.preventDefault(); submit(); goAdjacent(editor, snap.nodeId, e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') { e.preventDefault(); done(); editor.deactivateControl() }
        }}
      />
      <FieldHint msg={error} />
    </>
  )
}
