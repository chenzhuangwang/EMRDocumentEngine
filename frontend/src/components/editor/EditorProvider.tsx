// ============================================================
// 编辑器提供者 (ModelD) - 桥接 React 和 Canvas 引擎
// ============================================================

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Editor, type DocumentTree } from '@/engine'

interface EditorContextValue {
  editorRef: React.MutableRefObject<Editor | null>
  /** Editor 是否已创建 (editorRef.current 非 null)。子组件 mount effect 依赖它,
   *  避免父级 useEffect 晚于子级 effect 执行导致的 editorRef.current 恒为 null。 */
  ready: boolean
}

const EditorContext = createContext<EditorContextValue | null>(null)

interface EditorProviderProps {
  children: ReactNode
  containerRef: React.RefObject<HTMLDivElement>
  document?: DocumentTree
}

export function EditorProvider({ children, containerRef, document }: EditorProviderProps) {
  const editorRef = useRef<Editor | null>(null)
  const [ready, setReady] = useState(false)

  // 创建 Editor (仅一次)
  useEffect(() => {
    if (!containerRef.current) return
    const editor = new Editor(containerRef.current, document)
    editorRef.current = editor
    setReady(true)
    editor.focus()
    // 如果 document 在 Editor 创建前就已就绪, 立即加载
    if (document) editor.setDocument(document)
    return () => { editor.destroy(); editorRef.current = null; setReady(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // document 变更时重新加载
  useEffect(() => {
    if (editorRef.current && document) {
      editorRef.current.setDocument(document)
    }
  }, [document])

  return (
    <EditorContext.Provider value={{ editorRef, ready }}>
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

export function useEditorReady(): boolean {
  const context = useContext(EditorContext)
  if (!context) throw new Error('useEditorReady must be used within EditorProvider')
  return context.ready
}
