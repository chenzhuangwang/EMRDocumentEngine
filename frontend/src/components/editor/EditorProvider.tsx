// ============================================================
// 编辑器提供者 (ModelD) - 桥接 React 和 Canvas 引擎
// ============================================================

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { Editor, type DocumentTree } from '@/engine'

interface EditorContextValue {
  editorRef: React.MutableRefObject<Editor | null>
}

const EditorContext = createContext<EditorContextValue | null>(null)

interface EditorProviderProps {
  children: ReactNode
  containerRef: React.RefObject<HTMLDivElement>
  document?: DocumentTree
}

export function EditorProvider({ children, containerRef, document }: EditorProviderProps) {
  const editorRef = useRef<Editor | null>(null)

  // 创建 Editor (仅一次)
  useEffect(() => {
    if (!containerRef.current) return
    const editor = new Editor(containerRef.current, document)
    editorRef.current = editor
    editor.focus()
    // 如果 document 在 Editor 创建前就已就绪, 立即加载
    if (document) editor.setDocument(document)
    return () => { editor.destroy(); editorRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // document 变更时重新加载
  useEffect(() => {
    if (editorRef.current && document) {
      editorRef.current.setDocument(document)
    }
  }, [document])

  return (
    <EditorContext.Provider value={{ editorRef }}>
      {children}
    </EditorContext.Provider>
  )
}

export function useEditor(): Editor | null {
  const context = useContext(EditorContext)
  return context?.editorRef.current ?? null
}

export function useEditorRef(): React.MutableRefObject<Editor | null> {
  const context = useContext(EditorContext)
  if (!context) throw new Error('useEditorRef must be used within EditorProvider')
  return context.editorRef
}
