// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// useDocumentSave — 保存流程的接线 (契约 §12.11)
//
// 从 EditorPage 抽出来的唯一理由是**可测**: 这段「闸门 → 确认框 → 落盘」
// 以前埋在 1600 行的页面组件里, 没有任何用例锁, 只能靠人读代码确认。
//
// 归属边界 (契约 §12.11):
//   引擎只判定 (Editor.validateRequired), 拦不拦是应用侧的事;
//   保存的所有权在应用侧, 引擎不拥有保存。
//
// 闸门**不硬拦**: 缺必填项时弹确认框, 三个出口 —— 跳到第一处 / 仍然保存 /
// 取消。临床场景下硬拦会丢工作, 而"存了一份不全的病历"至少是可见的。
// ============================================================

import { useCallback, useState } from 'react'
import type { RefObject } from 'react'
import type { Editor, MissingField } from '@emrde/document-engine'
import { documentApi } from '@/services/api'

/**
 * 保存用到的后端接口 (最小结构类型)。
 * 抽成参数是为了测试能注入假实现 —— EditorPage 不必为了可测而改。
 */
export interface DocumentSaveApi {
  create(data: { title: string; content?: unknown }): Promise<{ data: { data?: { id?: string } } }>
  update(id: string, data: { title?: string; content?: unknown }): Promise<unknown>
}

export interface UseDocumentSaveOptions {
  editorRef: RefObject<Editor | null>
  /** 新建文档: 落盘走 create, 成功后 navigate 到新 id */
  isNew: boolean
  /** 既有文档 id (isNew 时忽略) */
  docId?: string
  navigate: (to: string, opts?: { replace?: boolean }) => void
  /** 后端接口 (默认 documentApi); 测试注入假实现 */
  api?: DocumentSaveApi
  /** 缺项跳转 —— 与质控/批注共用 revealLocation, 不另写一套定位 */
  revealMissing?: (paragraphPath: string[], offset: number) => void
}

export interface UseDocumentSaveResult {
  completeOpen: boolean
  completeMissing: MissingField[]
  /** 真正落盘 (不带闸门) — Ctrl+S / 工具栏 / 确认框的"仍然保存"共用 */
  performSave: () => Promise<void>
  /** 保存入口: 先过完整性闸门, 再落盘 */
  handleSave: () => Promise<void>
  /** 确认框"仍然保存" — 用户已看过缺项并明确选择继续 */
  handleSaveAnyway: () => Promise<void>
  /** 确认框条目跳转 */
  handleMissingJump: (field: MissingField) => void
  /** 确认框"取消" / 点遮罩关闭 */
  dismissComplete: () => void
}

const CLOSED = { open: false, missing: [] as MissingField[] }

export function useDocumentSave(options: UseDocumentSaveOptions): UseDocumentSaveResult {
  const { editorRef, isNew, docId, navigate, revealMissing } = options
  const api = options.api ?? documentApi
  const [complete, setComplete] = useState<{ open: boolean; missing: MissingField[] }>(CLOSED)

  /** 真正落盘 (不带闸门) —— Ctrl+S / 工具栏 / 确认框的"仍然保存"共用同一条路径 */
  const performSave = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const store = editor.getStore()
    store.setSaveStatus('saving')
    try {
      // 序列化含节点 payload 的完整 JSON 字符串 (后端 content 为 String 字段)
      const content = editor.getSerializedDocument()
      if (isNew) {
        const res = await api.create({ title: editor.getDocumentTitle(), content })
        const newId = res.data.data?.id
        if (newId) navigate(`/editor/${newId}`, { replace: true })
        console.debug('[EditorPage] created:', newId)
      } else if (docId) {
        await api.update(docId, { title: editor.getDocumentTitle(), content })
        console.debug('[EditorPage] updated:', docId)
      }
      store.setSaveStatus('saved')
      store.setDirty(false)
    } catch (err) {
      console.error('保存失败:', err)
      store.setSaveStatus('error')
    }
  }, [api, docId, editorRef, isNew, navigate])

  const handleSave = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const { ok, missing } = editor.validateRequired()
    if (!ok) {
      setComplete({ open: true, missing })
      return
    }
    await performSave()
  }, [editorRef, performSave])

  const handleSaveAnyway = useCallback(async () => {
    setComplete(CLOSED)
    await performSave()
  }, [performSave])

  const handleMissingJump = useCallback((field: MissingField) => {
    revealMissing?.(field.paragraphPath, 0)
    setComplete(CLOSED)
  }, [revealMissing])

  const dismissComplete = useCallback(() => setComplete(CLOSED), [])

  return {
    completeOpen: complete.open,
    completeMissing: complete.missing,
    performSave,
    handleSave,
    handleSaveAnyway,
    handleMissingJump,
    dismissComplete,
  }
}
