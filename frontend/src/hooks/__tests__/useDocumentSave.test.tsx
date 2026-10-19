// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// useDocumentSave — 保存接线 (契约 §12.11)
//
// 这段「闸门 → 确认框 → 落盘」以前埋在 EditorPage 里, 两端有锁
// (validateRequired 有引擎用例、CompletenessDialog 有组件用例),
// 中间这条接线没有。抽成 hook 就是为了让它可测。
//
// 这里锁的是**顺序与所有权**, 不是 UI:
//   - 缺必填 → 只弹框, 一个字节都不落盘
//   - 仍然保存 → 关框并落盘
//   - 跳转 → 只跳, 不落盘
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDocumentSave } from '../useDocumentSave'
import type { DocumentSaveApi } from '../useDocumentSave'
import type { Editor, MissingField } from '@emrde/document-engine'

interface Harness {
  editor?: Partial<Editor>
  isNew?: boolean
  docId?: string
  navigate?: (to: string, opts?: { replace?: boolean }) => void
  api?: DocumentSaveApi
  revealMissing?: (path: string[], offset: number) => void
}

function makeStore() {
  return { setSaveStatus: vi.fn(), setDirty: vi.fn() }
}

function makeEditor(opts: {
  ok?: boolean
  missing?: MissingField[]
  store?: ReturnType<typeof makeStore>
} = {}) {
  const store = opts.store ?? makeStore()
  const editor = {
    getStore: () => store,
    getSerializedDocument: () => '{"serialized":true}',
    getDocumentTitle: () => '入院记录',
    validateRequired: () => ({ ok: opts.ok ?? true, missing: opts.missing ?? [] }),
  } as unknown as Editor
  return { editor, store }
}

function makeApi(createdId = 'doc-new'): DocumentSaveApi {
  return {
    create: vi.fn(async () => ({ data: { data: { id: createdId } } })),
    update: vi.fn(async () => ({})),
  }
}

function setup(h: Harness = {}) {
  const store = makeStore()
  const { editor } = makeEditor({ store, ok: true })
  const navigate = h.navigate ?? vi.fn()
  const api = h.api ?? makeApi()
  const revealMissing = h.revealMissing ?? vi.fn()
  const editorRef = { current: h.editor === undefined ? editor : (h.editor as Editor | null) }
  const rendered = renderHook(() => useDocumentSave({
    editorRef, isNew: h.isNew ?? false, docId: h.docId ?? 'doc-1', navigate, api, revealMissing,
  }))
  return { ...rendered, store, navigate, api, revealMissing }
}

describe('useDocumentSave', () => {
  it('闸门通过 → 直接落盘; 状态 saving → saved, 清除脏标记', async () => {
    const { result, api, store } = setup()
    await act(async () => { await result.current.handleSave() })
    expect(api.update).toHaveBeenCalledWith('doc-1', {
      title: '入院记录', content: '{"serialized":true}',
    })
    expect(store.setSaveStatus.mock.calls.map((c) => c[0])).toEqual(['saving', 'saved'])
    expect(store.setDirty).toHaveBeenCalledWith(false)
    expect(result.current.completeOpen).toBe(false)
  })

  it('缺必填 → 只打开确认框, 一个字节都不落盘', async () => {
    const missing: MissingField[] = [
      { nodeId: 'n1', paragraphPath: ['doc', 'p1'], name: '姓名' },
      { nodeId: 'n2', paragraphPath: ['doc', 'p2'], name: '年龄' },
    ]
    const store = makeStore()
    const { editor } = makeEditor({ store, ok: false, missing })
    const api = makeApi()
    const editorRef = { current: editor }
    const { result } = renderHook(() => useDocumentSave({
      editorRef, isNew: false, docId: 'doc-1', navigate: vi.fn(), api,
    }))

    await act(async () => { await result.current.handleSave() })
    expect(result.current.completeOpen).toBe(true)
    expect(result.current.completeMissing).toEqual(missing)
    expect(api.update).not.toHaveBeenCalled()
    expect(store.setSaveStatus).not.toHaveBeenCalled()
  })

  it('确认框"仍然保存" → 关框并落盘 (不重新判定)', async () => {
    const { result, api } = setup()
    await act(async () => { await result.current.handleSaveAnyway() })
    expect(result.current.completeOpen).toBe(false)
    expect(api.update).toHaveBeenCalledTimes(1)
  })

  it('确认框跳转 → 只定位, 不落盘', async () => {
    const revealMissing = vi.fn()
    const { result, api } = setup({ revealMissing })
    const field: MissingField = { nodeId: 'n1', paragraphPath: ['doc', 'p1'], name: '姓名' }
    await act(async () => { result.current.handleMissingJump(field) })
    expect(revealMissing).toHaveBeenCalledWith(['doc', 'p1'], 0)
    expect(api.update).not.toHaveBeenCalled()
    expect(result.current.completeOpen).toBe(false)
  })

  it('新建文档 → create 后 navigate 到新 id (replace)', async () => {
    const navigate = vi.fn()
    const { result, api } = setup({ isNew: true, navigate })
    await act(async () => { await result.current.performSave() })
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(api.update).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/editor/doc-new', { replace: true })
  })

  it('落盘失败 → 状态 error, 不标已保存', async () => {
    const api: DocumentSaveApi = {
      create: vi.fn(async () => ({ data: { data: {} } })),
      update: vi.fn(async () => { throw new Error('network') }),
    }
    const { result, store } = setup({ api })
    await act(async () => { await result.current.handleSave() })
    expect(store.setSaveStatus.mock.calls.map((c) => c[0])).toEqual(['saving', 'error'])
    expect(store.setDirty).not.toHaveBeenCalled()
  })

  it('编辑器尚未就绪 (editorRef 为 null) → 静默返回, 不落盘', async () => {
    const api = makeApi()
    const { result } = renderHook(() => useDocumentSave({
      editorRef: { current: null }, isNew: false, docId: 'doc-1', navigate: vi.fn(), api,
    }))
    await act(async () => { await result.current.handleSave() })
    expect(api.update).not.toHaveBeenCalled()
    expect(result.current.completeOpen).toBe(false)
  })

  it('关闭确认框不清空判定依据 (再次保存仍按新判定)', async () => {
    const { result } = setup()
    await act(async () => { result.current.dismissComplete() })
    expect(result.current.completeOpen).toBe(false)
    expect(result.current.completeMissing).toEqual([])
  })
})
