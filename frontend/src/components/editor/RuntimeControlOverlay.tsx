// ================================================================
// RuntimeControlOverlay — 运行时控件交互覆盖层 (契约 §12.6)
//
// 架构 (契约 §12.6 运行时):
//   - Canvas 渲染「静态轻量 widget 提示」, 本组件渲染「当前激活控件」
//     的真实 DOM 交互 widget (input/textarea/number/select/date/checkbox/radio)。
//   - 仅挂载「当前激活的单个控件」DOM (activeControlId), 非全量 7 种。
//   - 值写入唯一路径: Editor.setControlValue → SetControlValueCommand (VR-3),
//     本组件绝不经 NodePool 直接改 value (VR-3/契约 §2.1)。
//   - 几何跟随: rAF 每帧读 Editor.getControlClientRect (与 Canvas 控件盒
//     同源 computeControlBox), 跟随滚动/缩放/布局重算, 不重造 clientX/clientY。
//   - 瞬态 draft: 文本类控件 (input/textarea/number/date) 用本地 React state
//     持有未提交文本, 失焦/回车时一次性 commit = 单个 undo 单元 (无逐键历史)。
//     离散控件 (select/checkbox/radio) 每次显式选择 = 一次 commit = 一个命令。
//   - 非法值 (VR-8/VR-9/VR-10/VR-11/日期) 由引擎命令边界拒绝; 本组件
//     拒绝后回退 draft 到规范值, 不做静默四舍五入/截断。
// ================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorRef, useEditorStoreSnapshot } from './EditorProvider'
import type { Editor } from '@/engine'
import type {
  ControlSnapshot, ControlType, ControlValue, ElementEnumOption,
} from '@/engine'

/** 规范运行时值 → 文本 (显示形式; number 0 必须显示为 "0") */
function valueToText(v: ControlValue | undefined): string {
  if (v === undefined) return ''
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.join('、')
  return v
}

/**
 * 旧文档缺省 controlType 的「仅表现」fallback (VR-15: 绝不写回语义层,
 * 绝不推导为模型事实)。widget 交互形态以 controlType 为准; 缺省时按
 * (multiple/enums/dataType) 落一个只读呈现, 与 controlVisualRecipe 的
 * 视觉分类同理, 不构成反向推导。
 */
function resolveControlType(snap: ControlSnapshot): ControlType {
  if (snap.controlType) return snap.controlType
  if (snap.multiple) return 'checkbox'
  if (snap.options !== undefined) return 'select'
  if (snap.dataType === 'N') return 'number'
  if (snap.dataType === 'D') return 'date'
  if (snap.dataType === 'S2' || snap.dataType === 'S3') return 'textarea'
  return 'input'
}

/**
 * 交互最小可操作尺寸 (契约 §12.6) — 控件盒按内容宽 (空值 ≈ 6px) 计算,
 * 直接套用到覆盖层会让 input 缩成无法点选的细条。这里按控件类型给一个
 * 舒适的最小宽/高, 左/上仍锚定控件盒 (与 computeControlBox 同源, 不重造几何)。
 */
function controlMinSize(type: ControlType, snap: ControlSnapshot): { minWidth: number; minHeight: number } {
  const rows = Math.max(2, snap.minRows ?? 2)
  switch (type) {
    case 'textarea': return { minWidth: 240, minHeight: rows * 22 + 6 }
    case 'number':   return { minWidth: 120, minHeight: 24 }
    case 'select':   return { minWidth: 160, minHeight: 24 }
    case 'date':     return { minWidth: 160, minHeight: 24 }
    case 'checkbox': return { minWidth: 200, minHeight: 24 }
    case 'radio':    return { minWidth: 140, minHeight: 24 }
    case 'input':    return { minWidth: 160, minHeight: 24 }
    default:         return { minWidth: 160, minHeight: 24 }
  }
}

export function RuntimeControlOverlay() {
  const editorRef = useEditorRef()
  const activeId = useEditorStoreSnapshot((s) => s.activeControlId)
  const mode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const overlayRef = useRef<HTMLDivElement>(null)

  const interactive = mode === 'edit' || mode === 'form'

  // 几何跟随 (rAF) — 每帧对齐 Canvas 控件盒 (滚动/缩放/回流同源)
  useEffect(() => {
    if (!activeId || !interactive) return
    let raf = 0
    const tick = () => {
      const ed = editorRef.current
      const el = overlayRef.current
      if (ed && el) {
        const r = ed.getControlClientRect(activeId)
        if (r) {
          el.style.left = `${r.left}px`
          el.style.top = `${r.top}px`
          el.style.width = `${r.width}px`
          el.style.height = `${r.height}px`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [activeId, interactive, editorRef])

  if (!activeId || !interactive) return null
  const ed = editorRef.current
  if (!ed) return null
  const snap = ed.getControlSnapshot(activeId)
  if (!snap) return null

  const type = resolveControlType(snap)
  const min = controlMinSize(type, snap)

  return (
    <div
      ref={overlayRef}
      className="fixed z-40"
      style={{ position: 'fixed', left: 0, top: 0, boxSizing: 'border-box', minWidth: min.minWidth, minHeight: min.minHeight }}
    >
      <ControlWidget key={activeId} nodeId={activeId} snap={snap} editor={ed} type={type} />
    </div>
  )
}

// ================================================================
// 控件分发
// ================================================================

function ControlWidget({ nodeId, snap, editor, type }: { nodeId: string; snap: ControlSnapshot; editor: Editor; type: ControlType }) {
  // 隐私脱敏: Canvas 掩码时 overlay 不得泄露明文 — 只读掩码展示
  if (snap.masked) {
    return (
      <div className="flex h-full w-full items-center rounded border border-dashed border-red-300 bg-red-50 px-2 text-gray-500 select-none" title="隐私字段已脱敏">
        ••••••
      </div>
    )
  }

  // 写锁: 只读展示 (契约 §12.6.3 layer B)
  if (!snap.writable) {
    return <div className="flex h-full w-full items-center overflow-hidden rounded px-2 text-gray-500 select-none">{valueToText(snap.value) || snap.placeholder}</div>
  }

  switch (type) {
    case 'textarea': return <TextareaWidget nodeId={nodeId} snap={snap} editor={editor} />
    case 'number': return <NumberWidget nodeId={nodeId} snap={snap} editor={editor} />
    case 'select': return <SelectWidget nodeId={nodeId} snap={snap} editor={editor} />
    case 'date': return <DateWidget nodeId={nodeId} snap={snap} editor={editor} />
    case 'checkbox': return <CheckboxWidget nodeId={nodeId} snap={snap} editor={editor} />
    case 'radio': return <RadioWidget nodeId={nodeId} snap={snap} editor={editor} />
    case 'input': return <TextWidget nodeId={nodeId} snap={snap} editor={editor} />
    default: return null
  }
}

// ================================================================
// 文本类控件 (input/textarea/number/date) — draft + 失焦/回车 commit
// ================================================================

/** 本地 draft: 初始取规范值; 外部值变更 (undo/redo/切换控件) 时回同步 */
function useDraft(snap: ControlSnapshot) {
  const [draft, setDraft] = useState(() => valueToText(snap.value))
  useEffect(() => { setDraft(valueToText(snap.value)) }, [snap.value])
  return [draft, setDraft] as const
}

/**
 * 激活即聚焦 + 全选现有值 (textarea 光标置尾), 让「点击 → 直接输入/改值」
 * 无需二次点击。rAF 延后一帧聚焦, 避开 mouseup 把焦点抢回画布 (契约 §12.6 交互)。
 */
function useAutoFocus<T extends HTMLInputElement | HTMLTextAreaElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const raf = requestAnimationFrame(() => {
      el.focus()
      if (el instanceof HTMLInputElement && el.type !== 'date') el.select()
      else if (el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length)
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return ref
}

function TextWidget({ nodeId, snap, editor }: { nodeId: string; snap: ControlSnapshot; editor: Editor }) {
  const [draft, setDraft] = useDraft(snap)
  const inputRef = useAutoFocus<HTMLInputElement>()
  const commit = useCallback(() => {
    const r = editor.setControlValue(nodeId, draft)
    if (!r.ok) setDraft(valueToText(snap.value))
  }, [editor, nodeId, draft, snap.value])
  return (
    <input
      ref={inputRef}
      type="text"
      className="h-full w-full rounded border border-blue-400 bg-white px-2 outline-none"
      value={draft}
      placeholder={snap.placeholder}
      maxLength={snap.maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { e.preventDefault(); setDraft(valueToText(snap.value)); editor.deactivateControl() } }}
    />
  )
}

function TextareaWidget({ nodeId, snap, editor }: { nodeId: string; snap: ControlSnapshot; editor: Editor }) {
  const [draft, setDraft] = useDraft(snap)
  const rows = Math.max(2, snap.minRows ?? 2)
  const inputRef = useAutoFocus<HTMLTextAreaElement>()
  const commit = useCallback(() => {
    const r = editor.setControlValue(nodeId, draft)
    if (!r.ok) setDraft(valueToText(snap.value))
  }, [editor, nodeId, draft, snap.value])
  return (
    <textarea
      ref={inputRef}
      className="h-full w-full resize-none rounded border border-blue-400 bg-white px-2 outline-none"
      rows={rows}
      value={draft}
      placeholder={snap.placeholder}
      maxLength={snap.maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setDraft(valueToText(snap.value)); editor.deactivateControl() } }}
    />
  )
}

function NumberWidget({ nodeId, snap, editor }: { nodeId: string; snap: ControlSnapshot; editor: Editor }) {
  const [draft, setDraft] = useDraft(snap)
  const inputRef = useAutoFocus<HTMLInputElement>()
  const commit = useCallback(() => {
    const text = draft.trim()
    if (text === '') { editor.setControlValue(nodeId, undefined); return }
    const n = Number(text)
    if (!Number.isFinite(n)) { setDraft(valueToText(snap.value)); return }
    const r = editor.setControlValue(nodeId, n)
    if (!r.ok) setDraft(valueToText(snap.value))
  }, [editor, nodeId, draft, snap.value])
  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      className="h-full w-full rounded border border-blue-400 bg-white px-2 text-right outline-none"
      value={draft}
      placeholder={snap.placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { e.preventDefault(); setDraft(valueToText(snap.value)); editor.deactivateControl() } }}
    />
  )
}

function DateWidget({ nodeId, snap, editor }: { nodeId: string; snap: ControlSnapshot; editor: Editor }) {
  const [draft, setDraft] = useDraft(snap)
  const inputRef = useAutoFocus<HTMLInputElement>()
  const commit = useCallback(() => {
    const r = editor.setControlValue(nodeId, draft.trim() === '' ? undefined : draft)
    if (!r.ok) setDraft(valueToText(snap.value))
  }, [editor, nodeId, draft, snap.value])
  return (
    <input
      ref={inputRef}
      type="date"
      className="h-full w-full rounded border border-blue-400 bg-white px-2 outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { e.preventDefault(); setDraft(valueToText(snap.value)); editor.deactivateControl() } }}
    />
  )
}

// ================================================================
// 离散控件 (select/radio/checkbox) — 每次显式选择 = 一次 commit
// ================================================================

function SelectWidget({ nodeId, snap, editor }: { nodeId: string; snap: ControlSnapshot; editor: Editor }) {
  const options = snap.options ?? []
  const current = typeof snap.value === 'string' ? snap.value : ''
  return (
    <select
      className="h-full w-full rounded border border-blue-400 bg-white px-2 outline-none"
      value={current}
      onChange={(e) => editor.setControlValue(nodeId, e.target.value === '' ? undefined : e.target.value)}
      autoFocus
    >
      <option value="">{snap.placeholder || '请选择'}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.name}</option>
      ))}
    </select>
  )
}

function RadioWidget({ nodeId, snap, editor }: { nodeId: string; snap: ControlSnapshot; editor: Editor }) {
  const options = snap.options ?? []
  const current = typeof snap.value === 'string' ? snap.value : ''
  return (
    <div className="flex h-full w-full items-center gap-2 overflow-x-auto rounded border border-blue-400 bg-white px-2">
      {options.length === 0 ? (
        <span className="text-xs text-gray-400">{snap.placeholder || '无候选项'}</span>
      ) : (
        options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-sm">
            <input
              type="radio"
              name={`ctrl-${nodeId}`}
              checked={current === o.value}
              onChange={() => editor.setControlValue(nodeId, o.value)}
            />
            {o.name}
          </label>
        ))
      )}
    </div>
  )
}

function CheckboxWidget({ nodeId, snap, editor }: { nodeId: string; snap: ControlSnapshot; editor: Editor }) {
  const options = snap.options ?? []
  const selected = Array.isArray(snap.value) ? snap.value : []
  const toggle = (opt: ElementEnumOption) => {
    const next = selected.includes(opt.value)
      ? selected.filter((v) => v !== opt.value)
      : [...selected, opt.value]
    // 空集合 → undefined (VR-13); 顺序由 validateControlValue 归一 (VR-12)
    editor.setControlValue(nodeId, next.length === 0 ? undefined : next)
  }
  return (
    <div className="flex h-full w-full items-center gap-2 overflow-x-auto rounded border border-blue-400 bg-white px-2">
      {options.length === 0 ? (
        <span className="text-xs text-gray-400">{snap.placeholder || '无候选项'}</span>
      ) : (
        options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-sm">
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              onChange={() => toggle(o)}
            />
            {o.name}
          </label>
        ))
      )}
    </div>
  )
}
