// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// platform/react — React 适配器出口 (契约 §10 / §32)
//
// 分发分包的 `./react` 子路径入口。React 是这一层的 peer dependency,
// 引擎核心 (./) 与宿主实现 (./dom) 均不含 React (§32.4)。
// ============================================================

export {
  EditorProvider,
  EditorContext,
  useEditor,
  useEditorRef,
  useEditorReady,
  useEditorStoreSnapshot,
} from './EditorProvider'
export type { EditorContextValue, EditorProviderProps } from './EditorProvider'
