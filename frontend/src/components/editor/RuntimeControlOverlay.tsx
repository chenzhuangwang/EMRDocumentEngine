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
// 折行口径单一来源: 编辑面的换行位置与布局/静态渲染必须一致 (契约 §12.8)
import { wrapControlText } from '@/engine/layout/text/TextWrap'
import type { ControlEditTarget, ControlSnapshot, ControlType, ControlValue, Editor } from '@/engine'

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
  if (snap.dataType === 'DT') return 'datetime'
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

  // 点 overlay 之外的任何位置 → 去激活 (卸载旧 widget → cleanup 提交)。
  // 用 capture 在 MouseHandler 的 mousedown 之前运行: 若点到别的控件, MouseHandler
  // 随后会重新激活它, 净效果=切换; 若点到空白, 则提交并退出编辑。
  useEffect(() => {
    if (!activeId || !interactive) return
    const onPointerDown = (e: PointerEvent) => {
      const ed = editorRef.current
      if (!ed) return
      const host = document.getElementById('ctl-overlay-host')
      const t = e.target as HTMLElement | null
      // 点在编辑控件本体(input/select/textarea)或提示文字上 → 视为内部, 不退出;
      // 其余 (含 host 内空白、画布空白、工具栏等) → 提交并退出编辑。
      if (t && host?.contains(t) && t.closest('input,select,textarea')) return
      ed.deactivateControl()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [activeId, interactive, editorRef, canvasContainerRef])

  // 校验失败浮层提示: 由 overlay 自身渲染, 不随字段 widget 卸载消失 (点空白/切控件时也能看到)
  const [reject, setReject] = useState<{ id: number; text: string; left: number; top: number } | null>(null)
  const rejectTimer = useRef<number | null>(null)
  const showReject = useCallback((nodeId: string, text: string) => {
    const r = editorRef.current?.getControlClientRect(nodeId)
    setReject({
      id: Date.now(), text,
      left: r?.left ?? 0,
      top: (r ? r.top + r.height : 0) + 2,
    })
    if (rejectTimer.current) window.clearTimeout(rejectTimer.current)
    rejectTimer.current = window.setTimeout(() => setReject(null), 2600)
  }, [editorRef])
  useEffect(() => () => { if (rejectTimer.current) window.clearTimeout(rejectTimer.current) }, [])
  const rejectFly = reject ? (
    <div
      data-ctl-overlay
      style={{
        position: 'fixed', left: reject.left, top: reject.top,
        color: '#DC2626', fontSize: 12, lineHeight: '14px', whiteSpace: 'nowrap',
        zIndex: 60, pointerEvents: 'none',
      }}
    >{reject.text}</div>
  ) : null

  if (!activeId || !interactive || !target) return rejectFly
  const ed = editorRef.current
  if (!ed) return rejectFly
  const snap = ed.getControlSnapshot(activeId)
  if (!snap) return rejectFly
  const onReject = (text: string) => showReject(activeId, text)

  if (target.masked || !snap.writable) {
    const text = target.masked ? '••••••' : (valueToText(snap.value) || target.placeholderText)
    return (
      <>
        {rejectFly}
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
      </>
    )
  }

  const type = resolveControlType(snap)
  const kind = type === 'textarea' ? 'textarea' : type === 'select' || type === 'checkbox' || type === 'radio' ? 'select' : type
  return (
    <>
      {rejectFly}
      <div
        id="ctl-overlay-host"
        data-ctl-overlay
        className="fixed z-40"
        style={{
          position: 'fixed', left: target.textArea.left, top: target.textArea.top,
          width: target.textArea.width, height: target.textArea.height,
        }}
      >
        {kind === 'textarea' ? <TextareaField key={activeId} snap={snap} target={target} editor={ed} onReject={onReject} />
          : kind === 'number' ? <NumberField key={activeId} snap={snap} target={target} editor={ed} onReject={onReject} />
            : kind === 'select' ? <SelectField key={activeId} snap={snap} target={target} editor={ed} onReject={onReject} />
              : kind === 'date' ? <DateField key={activeId} snap={snap} target={target} editor={ed} onReject={onReject} />
                : kind === 'datetime' ? <DateTimeField key={activeId} snap={snap} target={target} editor={ed} onReject={onReject} />
                  : <TextField key={activeId} snap={snap} target={target} editor={ed} onReject={onReject} />}
      </div>
    </>
  )
}

/** 统一文本字段状态: onChange 本地草稿; 卸载即提交; 非法值就地提示。
 *  numeric=true → 提交时把草稿解析为数字 (空→undefined, 非数字→提示)。 */
function useFieldText(snap: ControlSnapshot, editor: Editor, numeric = false, onReject?: (msg: string) => void) {
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
    let value: ControlValue | undefined = cur === '' ? undefined : cur
    if (numeric) {
      const t = cur.trim()
      if (t === '') value = undefined
      else {
        const n = Number(t)
        if (!Number.isFinite(n)) { setError('请输入数字'); onReject?.('请输入数字'); setDraft(canon); return false }
        value = n
      }
    }
    const r = editor.setControlValue(snap.nodeId, value)
    if (r.ok) return true
    const msg = controlRejectMessage(r.reason)
    setError(msg)
    onReject?.(msg)
    setDraft(canon)
    return false
  }, [editor, snap.nodeId, snap.value, numeric, onReject])
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

/**
 * 激活时聚焦 (selectAll=true → 全选, 便于整体覆盖输入)。
 * 原生 date/datetime-local 不 .select() (会破坏其原生交互)。
 */
function useAutoFocus<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selectAll = false) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const id = raf(() => {
      el.focus()
      if (el instanceof HTMLInputElement && (el.type === 'date' || el.type === 'datetime-local')) return
      if (el instanceof HTMLSelectElement) return
      if (selectAll) el.select()
      else if (el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length)
    })
    return () => caf(id)
  }, [selectAll])
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

/** 文本类控件编辑面的 Enter/Tab/Escape 行为 (单行面与多行面一致: Enter 提交并跳转,
 *  不插入换行 —— 这两个控件语义上是单行字段)。
 *  opts.discard: 传了 → Escape 丢弃草稿 (TextField 语义, 见文件头注释);
 *  不传 → 保持 NumberField 既有行为 (Escape 仅退出, 卸载清理时仍提交)。 */
function fieldKeyHandler(
  e: React.KeyboardEvent,
  editor: Editor,
  nodeId: string,
  submit: () => boolean,
  opts?: { discard: () => void },
): void {
  if (e.key === 'Enter') { e.preventDefault(); if (submit()) goAdjacent(editor, nodeId, 1) }
  else if (e.key === 'Tab') { e.preventDefault(); submit(); goAdjacent(editor, nodeId, e.shiftKey ? -1 : 1) }
  else if (e.key === 'Escape') { e.preventDefault(); opts?.discard(); editor.deactivateControl() }
}

/**
 * 控件编辑面 (契约 §12.8) — 恒用 <textarea> 承载, 尺寸随草稿走:
 *   - 宽度贴住草稿、封顶 = 文本区宽; 超出部分逐字符折行 (wordBreak break-all 与
 *     布局同口径), 行数用同一个 wrapControlText 计算 → 编辑中的换行位置与提交后
 *     的静态渲染一致;
 *   - 高度 = 行数 × 字号 → 输入多少看到多少, 且不出滚动条 (用户: "跟正常输入一样");
 *     旧实现的两难: 单行 <input> 宽度 = max(文本区宽, 草稿宽) 会把输入框撑出页面
 *     右边界, 改成恒 = 文本区宽后又只能看见末尾几个字;
 *   - 元素类型恒定 (不随草稿长短在 input/textarea 之间切换) → 输入中不丢焦点。
 */
interface GrowingFieldProps {
  target: ControlEditTarget
  draft: string
  error: string | null
  align: 'left' | 'right'
  /** 激活时全选 (单行语义字段: 便于整体覆盖输入) */
  selectAll: boolean
  /** 高度下限 (多行文本域 ElementFormat.minRows) */
  minRows?: number
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

function GrowingField({ target, draft, error, align, selectAll, minRows, onChange, onBlur, onKeyDown }: GrowingFieldProps) {
  const ref = useAutoFocus<HTMLTextAreaElement>(selectAll)
  const font = `${target.fontSizeCss}px "${target.fontFamily}"`
  const measure = (t: string) => textWidth(t, font)
  // 空态按占位符量宽 (与静态渲染的空态盒同宽), 否则贴住草稿
  const measured = draft === '' ? target.placeholderText : draft
  const naturalW = Math.max(0, ...measured.split('\n').map(measure))
  const w = Math.max(1, Math.min(target.textArea.width, naturalW + 2))
  const rows = Math.max(1, minRows ?? 1, wrapControlText(draft, w, measure).length)
  const topOff = target.ascentCss - (target.lineAscentCss || target.ascentCss)
  return (
    <>
      <textarea
        ref={ref}
        data-ctl-overlay
        value={draft}
        placeholder={target.placeholderText}
        style={{
          ...baseInputStyle(target), textAlign: align, resize: 'none',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflow: 'hidden',
          width: w, height: rows * target.fontSizeCss,
          position: 'absolute', left: 0, top: topOff,
        }}
        onChange={onChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      <FieldHint msg={error} />
    </>
  )
}

function TextField({ snap, target, editor, onReject }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor; onReject?: (msg: string) => void }) {
  const { draft, error, change, submit, done } = useFieldText(snap, editor, false, onReject)
  return (
    <GrowingField
      target={target} draft={draft} error={error} align="left" selectAll
      onChange={(e) => change(e.target.value)}
      onBlur={() => { submit() }}
      onKeyDown={(e) => fieldKeyHandler(e, editor, snap.nodeId, submit, { discard: done })}
    />
  )
}

function NumberField({ snap, target, editor, onReject }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor; onReject?: (msg: string) => void }) {
  const { draft, error, change, submit } = useFieldText(snap, editor, true, onReject)
  return (
    <GrowingField
      target={target} draft={draft} error={error} align="right" selectAll
      onChange={(e) => change(e.target.value)}
      onBlur={() => { submit() }}
      onKeyDown={(e) => fieldKeyHandler(e, editor, snap.nodeId, submit)}
    />
  )
}

function TextareaField({ snap, target, editor, onReject }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor; onReject?: (msg: string) => void }) {
  const { draft, error, change, submit, done } = useFieldText(snap, editor, false, onReject)
  // 多行文本域: Enter 换行 (不提交), Tab 提交并跳转, Escape 丢弃
  return (
    <GrowingField
      target={target} draft={draft} error={error} align="left" selectAll={false}
      minRows={target.minRows}
      onChange={(e) => change(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Tab') { e.preventDefault(); submit(); goAdjacent(editor, snap.nodeId, e.shiftKey ? -1 : 1) }
        else if (e.key === 'Escape') { e.preventDefault(); done(); editor.deactivateControl() }
      }}
    />
  )
}

function SelectField({ snap, target, editor, onReject }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor; onReject?: (msg: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const current = typeof snap.value === 'string' ? snap.value : ''
  const font = `${target.bold ? 'bold ' : ''}${target.italic ? 'italic ' : ''}${target.fontSizeCss}px "${target.fontFamily}"`
  const w = Math.max(target.textArea.width, textWidth(current || target.placeholderText, font) + 24)
  const topOff = target.ascentCss - (target.lineAscentCss || target.ascentCss)
  const ref = useRef<HTMLSelectElement>(null)
  // 首次进入即展开原生下拉 (避免"点两下才出选项"): 激活通常由用户点击触发, 仍在
  // 用户激活窗口内, showPicker 可用; 不支持则退化为聚焦 (点开即用)。
  useEffect(() => {
    const id = raf(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      try { (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.() } catch { /* 忽略 */ }
    })
    return () => caf(id)
  }, [])
  return (
    <>
      <select
        ref={ref}
        data-ctl-overlay
        value={current}
        style={{ ...baseInputStyle(target), width: w, height: target.textArea.height, cursor: 'pointer', position: 'absolute', left: 0, top: topOff }}
        onChange={(e) => {
          setError(null)
          const r = editor.setControlValue(snap.nodeId, e.target.value === '' ? undefined : e.target.value)
          if (!r.ok) { const m = controlRejectMessage(r.reason); setError(m); onReject?.(m) }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') { e.preventDefault(); goAdjacent(editor, snap.nodeId, e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') { e.preventDefault(); editor.deactivateControl() }
        }}
      >
        <option value="">请选择</option>
        {(snap.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
      </select>
      <FieldHint msg={error} />
    </>
  )
}

function DateField({ snap, target, editor, onReject }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor; onReject?: (msg: string) => void }) {
  const { draft, error, change, submit, done } = useFieldText(snap, editor, false, onReject)
  const ref = useAutoFocus<HTMLInputElement>()
  const font = `${target.bold ? 'bold ' : ''}${target.italic ? 'italic ' : ''}${target.fontSizeCss}px "${target.fontFamily}"`
  const w = Math.max(target.textArea.width, textWidth(draft || 'YYYY-MM-DD', font) + 28)
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

function DateTimeField({ snap, target, editor, onReject }: { snap: ControlSnapshot; target: ControlEditTarget; editor: Editor; onReject?: (msg: string) => void }) {
  const { draft, error, change, submit, done } = useFieldText(snap, editor, false, onReject)
  const ref = useAutoFocus<HTMLInputElement>()
  const font = `${target.bold ? 'bold ' : ''}${target.italic ? 'italic ' : ''}${target.fontSizeCss}px "${target.fontFamily}"`
  // 规范值 'YYYY-MM-DD HH:mm:ss' ↔ HTML datetime-local 'YYYY-MM-DDTHH:mm:ss'
  const htmlValue = draft ? draft.replace(' ', 'T') : ''
  const w = Math.max(target.textArea.width, textWidth('2026-09-11 08:30:00', font) + 38)
  const topOff = target.ascentCss - (target.lineAscentCss || target.ascentCss)
  return (
    <>
      <input
        ref={ref}
        data-ctl-overlay
        type="datetime-local"
        step="1"
        value={htmlValue}
        style={{ ...baseInputStyle(target), width: w, height: target.textArea.height, position: 'absolute', left: 0, top: topOff }}
        onChange={(e) => change(e.target.value ? e.target.value.replace('T', ' ') : '')}
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
