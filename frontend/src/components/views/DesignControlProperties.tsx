// ============================================================
// DesignControlProperties — 设计态控件属性编辑面板 (契约 §12.5)
//
// 仅在设计模式 + 有选中控件时渲染的浮动面板: 读取选中控件的
// TemplateDefinition (§12.1) 完整定义, 就地编辑全部 7 个字段
// (label/tips/prefix/suffix 文本; deletable/editable/single 布尔),
// 经 Editor.setControlDefinition 整体回写。
//
// 只消费引擎公共 API (getControlDefinition / setControlDefinition),
// 不直接改 pool / store (§12.5)。文本字段 onBlur 提交、布尔字段即时
// 提交, 避免逐字污染 undo 栈。
// ============================================================

import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useEditorRef, useEditorStoreSnapshot } from '@/components/editor/EditorProvider'
import type { TemplateDefinition } from '@/engine/template/TemplateDefinition'

type StringField = 'label' | 'tips' | 'prefix' | 'suffix'
type BoolField = 'deletable' | 'editable' | 'single'

const STRING_FIELDS: { key: StringField; label: string }[] = [
  { key: 'label', label: '标签' },
  { key: 'tips', label: '提示' },
  { key: 'prefix', label: '前缀' },
  { key: 'suffix', label: '后缀' },
]

const BOOL_FIELDS: { key: BoolField; label: string }[] = [
  { key: 'deletable', label: '可删除' },
  { key: 'editable', label: '可编辑' },
  { key: 'single', label: '单值' },
]

/** 从完整 def 清洗出「有实际值的字段」; 空串视为清除该字段 */
function cleanDefinition(def: TemplateDefinition): TemplateDefinition | undefined {
  const cleaned: TemplateDefinition = {}
  for (const k of Object.keys(def) as (keyof TemplateDefinition)[]) {
    const v = def[k]
    if (typeof v === 'string' && v.trim() === '') continue
    if (v === undefined) continue
    cleaned[k] = v as never
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

export function DesignControlProperties() {
  const editorRef = useEditorRef()
  const mode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const selectedId = useEditorStoreSnapshot((s) => s.designSelectedControlId)
  const [draft, setDraft] = useState<TemplateDefinition>({})

  // 选中控件变化 → 载入其当前完整 def 到本地草稿
  useEffect(() => {
    const editor = editorRef.current
    if (mode !== 'design' || !selectedId || !editor) { setDraft({}); return }
    setDraft(editor.getControlDefinition(selectedId) ?? {})
  }, [mode, selectedId, editorRef])

  if (mode !== 'design' || !selectedId) return null

  const editor = editorRef.current
  if (!editor) return null

  // 选中控件显示名 (element.name)
  const node = editor.getPool().nodes.get(selectedId) as
    { element?: { name?: string } } | undefined
  const title = node?.element?.name ?? '控件'

  const commit = (next: TemplateDefinition) => {
    setDraft(next)
    editor.setControlDefinition(selectedId, cleanDefinition(next))
  }

  const setString = (key: StringField, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }
  const commitString = () => {
    commit(draft)
  }

  const toggleBool = (key: BoolField, value: boolean) => {
    commit({ ...draft, [key]: value })
  }

  const clearAll = () => {
    setDraft({})
    editor.setControlDefinition(selectedId, undefined)
  }

  return (
    <div className="fixed right-[17.5rem] top-16 z-40 w-64 flex flex-col rounded-lg border border-gray-200 bg-white shadow-lg">
      {/* 面板头 */}
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-xs font-medium text-gray-700 truncate">{title}</span>
        <button
          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
          onClick={clearAll}
          title="清除全部设计期属性"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* 字段编辑 */}
      <div className="max-h-[70vh] overflow-y-auto p-2.5 space-y-2">
        {/* 文本字段 */}
        {STRING_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-[11px] text-gray-400">{label}</label>
            <input
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-700
                         focus:outline-none focus:border-blue-400"
              value={(draft[key] as string | undefined) ?? ''}
              onChange={(e) => setString(key, e.target.value)}
              onBlur={commitString}
            />
          </div>
        ))}

        {/* 布尔字段 */}
        <div className="pt-1 space-y-1.5 border-t border-gray-100">
          {BOOL_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between text-xs text-gray-700">
              <span>{label}</span>
              <input
                type="checkbox"
                className="rounded text-blue-500"
                checked={(draft[key] as boolean | undefined) ?? false}
                onChange={(e) => toggleBool(key, e.target.checked)}
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
