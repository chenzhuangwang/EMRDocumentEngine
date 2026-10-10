// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 编辑器提供者 (ModelD) — 应用侧接线
//
// 通用 React 适配器已抽到 platform/react (契约 §10 / §32, 随 ./react 分包
// 分发); 本文件只做**应用特有的绑定**:
//
//   themePreset  ← useUIStore.themePreset   (应用级 UI 状态, §7.1)
//   dictionaries ← createDictionaryStore()  (platform/data 的医疗码表目录)
//
// 分包不知道 useUIStore, 也不知道医疗字典 —— 这两个绑定只属于本应用。
// 不再是「第二套 Provider 实现」: 创建 Editor 的全部逻辑都在 platform/react,
// 这里只喂参数并原样 re-export hook, 既有引用点不改。
// ============================================================

import { useRef, type ReactNode } from 'react'
import { EditorProvider as ReactEditorProvider } from '@emrde/document-engine/react'
import { createDictionaryStore } from '@/platform/data/dictionaryStore'
import { useUIStore } from '@/store'
import type { DocumentTree } from '@emrde/document-engine'

// hooks 与 context 原样转出 —— 既有 `from '@/components/editor/EditorProvider'`
// 的 10 处引用 (含 8 个测试) 全部保持不变。
export {
  EditorContext,
  useEditor,
  useEditorRef,
  useEditorReady,
  useEditorStoreSnapshot,
} from '@emrde/document-engine/react'
export type { EditorContextValue } from '@emrde/document-engine/react'

interface EditorProviderProps {
  children: ReactNode
  containerRef: React.RefObject<HTMLDivElement>
  document?: DocumentTree
}

export function EditorProvider({ children, containerRef, document }: EditorProviderProps) {
  // 画布主题的 canonical owner 是应用 UI store (§7.1); 受控传给适配器。
  // 只有本组件重渲染, children 元素引用不变, 子树不会跟着重绘。
  const themePreset = useUIStore((s) => s.themePreset)

  // 码表候选源在 Provider 生命周期内保持同一实例: 适配器只在创建 Editor 时
  // 读它, 每次渲染重建纯属浪费 (目录是静态数据, 但要遍历装配)。
  const dictionariesRef = useRef<ReturnType<typeof createDictionaryStore> | null>(null)
  if (dictionariesRef.current === null) dictionariesRef.current = createDictionaryStore()

  return (
    <ReactEditorProvider
      containerRef={containerRef}
      document={document}
      themePreset={themePreset}
      dictionaries={dictionariesRef.current}
    >
      {children}
    </ReactEditorProvider>
  )
}
