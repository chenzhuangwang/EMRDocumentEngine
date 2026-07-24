// ============================================================
// 编辑器提供者 - 桥接 React 和 Canvas 引擎
// ============================================================

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { Editor } from '@/engine'
import type { IEditorOption, IElement } from '@/engine'

interface EditorContextValue {
  editorRef: React.MutableRefObject<Editor | null>
}

const EditorContext = createContext<EditorContextValue | null>(null)

interface EditorProviderProps {
  children: ReactNode
  containerRef: React.RefObject<HTMLDivElement>
  data?: { header?: IElement[]; main?: IElement[]; footer?: IElement[] }
  options?: Partial<IEditorOption>
}

export function EditorProvider({ children, containerRef, data, options }: EditorProviderProps) {
  const editorRef = useRef<Editor | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const editor = new Editor(containerRef.current, data, options)
    editorRef.current = editor

    // Auto-focus the canvas so it can receive keyboard events
    const timer = setTimeout(() => editor.focus(), 100)

    return () => {
      clearTimeout(timer)
      editor.destroy()
      editorRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external data changes into the editor (e.g. async-loaded document)
  useEffect(() => {
    if (editorRef.current && data) {
      editorRef.current.setValue(data)
    }
  }, [data])

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
  if (!context) {
    throw new Error('useEditorRef must be used within EditorProvider')
  }
  return context.editorRef
}
