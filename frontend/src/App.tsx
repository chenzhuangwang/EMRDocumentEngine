// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import { Routes, Route, Navigate } from 'react-router-dom'
import EditorPage from '@/pages/EditorPage'
import HomePage from '@/pages/HomePage'
import ComparePage from '@/pages/ComparePage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      {/* 测试快捷入口: /editor 直接进入编辑器 */}
      <Route path="/editor" element={<EditorPage />} />
      <Route path="/editor/:id" element={<EditorPage />} />
      <Route path="/editor/new" element={<EditorPage />} />
      <Route path="/compare/:oldId/:newId" element={<ComparePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
