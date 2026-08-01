import { Routes, Route, Navigate } from 'react-router-dom'
import EditorPage from '@/pages/EditorPage'
import HomePage from '@/pages/HomePage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      {/* 测试快捷入口: /editor 直接进入编辑器 */}
      <Route path="/editor" element={<EditorPage />} />
      <Route path="/editor/:id" element={<EditorPage />} />
      <Route path="/editor/new" element={<EditorPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
