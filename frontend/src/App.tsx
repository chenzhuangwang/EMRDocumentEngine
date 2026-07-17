import { Routes, Route, Navigate } from 'react-router-dom'
import EditorPage from '@/pages/EditorPage'
import HomePage from '@/pages/HomePage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/editor/:id" element={<EditorPage />} />
      <Route path="/editor/new" element={<EditorPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
