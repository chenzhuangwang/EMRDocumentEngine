// ============================================================
// 编辑器主页面
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { EditorLayout } from '@/components/layout/EditorLayout'
import { EditorProvider, useEditorRef } from '@/components/editor/EditorProvider'
import { useEditorStore } from '@/store'
import { documentApi, type DocumentDetail } from '@/services/api'
import {
  EditorMode,
  PageMode,
  createBlankDocument,
} from '@/engine'
import type { Editor } from '@/engine'

/** Helper: open file picker and insert selected image into the document. */
function pickAndInsertImage(editor: Editor, onDirty: (d: boolean) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const src = reader.result as string
      // Insert at a reasonable display size — cap to 400px wide, maintain aspect ratio
      const displayWidth = 400
      const displayHeight = 300
      editor.insertImage(src, displayWidth, displayHeight)
      onDirty(true)
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [documentTitle, setDocumentTitle] = useState('未命名文档')
  const [loading, setLoading] = useState(false)
  const setDocument = useEditorStore((s) => s.setDocument)
  const setDirty = useEditorStore((s) => s.setDirty)
  const setSaveStatus = useEditorStore((s) => s.setSaveStatus)

  // 加载文档
  useEffect(() => {
    if (id && id !== 'new') {
      loadDocument(id)
    } else {
      // 新建文档
      const newDoc = createBlankDocument('未命名文档', '当前用户')
      setDocument({
        id: newDoc.id,
        title: newDoc.title,
        content: {
          header: newDoc.header,
          main: newDoc.main,
          footer: newDoc.footer,
        },
        pageSetup: {
          width: newDoc.pageSetup.width,
          height: newDoc.pageSetup.height,
          marginTop: newDoc.pageSetup.marginTop,
          marginBottom: newDoc.pageSetup.marginBottom,
          marginLeft: newDoc.pageSetup.marginLeft,
          marginRight: newDoc.pageSetup.marginRight,
          orientation: newDoc.pageSetup.orientation,
        },
        metadata: {
          author: newDoc.metadata.author,
          createdAt: newDoc.metadata.createdAt,
          updatedAt: newDoc.metadata.updatedAt,
          version: newDoc.metadata.version,
          status: newDoc.metadata.status,
        },
      })
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDocument(docId: string) {
    setLoading(true)
    try {
      const res = await documentApi.getById(docId)
      const doc: DocumentDetail = res.data.data
      setDocument(doc)
      setDocumentTitle(doc.title)
    } catch (err) {
      console.error('加载文档失败:', err)
    } finally {
      setLoading(false)
    }
  }

  // 保存文档
  const handleSave = useCallback(async () => {
    const doc = useEditorStore.getState().document
    if (!doc) return

    setSaveStatus('saving')
    try {
      await documentApi.update(doc.id, {
        title: documentTitle,
        content: doc.content,
      })
      setSaveStatus('saved')
      setDirty(false)
    } catch (err) {
      console.error('保存失败:', err)
      setSaveStatus('error')
    }
  }, [documentTitle, setSaveStatus, setDirty])

  // Ctrl+S 快捷键保存
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    )
  }

  return (
    <EditorProvider
      containerRef={containerRef}
      options={{
        mode: EditorMode.EDIT,
        pageMode: PageMode.PAGING,
      }}
    >
      <EditorPageInner
        containerRef={containerRef}
        documentTitle={documentTitle}
        onTitleChange={setDocumentTitle}
        onSave={handleSave}
        onDirty={setDirty}
      />
    </EditorProvider>
  )
}

// ---- 内部组件：必须在 EditorProvider 内部才能用 useEditorRef ----

function EditorPageInner({
  containerRef,
  documentTitle,
  onTitleChange,
  onSave,
  onDirty,
}: {
  containerRef: React.RefObject<HTMLDivElement>
  documentTitle: string
  onTitleChange: (title: string) => void
  onSave: () => void
  onDirty: (dirty: boolean) => void
}) {
  const editorRef = useEditorRef()

  // 格式化操作 — 对接引擎实时生效
  const handleFormat = useCallback((action: string, _value?: unknown) => {
    const editor = editorRef.current
    if (!editor) return

    switch (action) {
      case 'undo':          editor.undo(); break
      case 'redo':          editor.redo(); break
      case 'bold':          editor.toggleBold(); break
      case 'italic':        editor.toggleItalic(); break
      case 'underline':     editor.toggleUnderline(); break
      case 'strikeout':     editor.toggleStrikeout(); break
      case 'superscript':   editor.toggleSuperscript(); break
      case 'subscript':     editor.toggleSubscript(); break
      case 'alignLeft':
      case 'alignCenter':
      case 'alignRight':
      case 'alignJustify':  editor.setAlignment(action); break
      default:
        console.warn('[EditorPage] Unknown format action:', action)
    }
    onDirty(true)
  }, [editorRef, onDirty])

  // 元素插入 — 对接引擎插入元素
  const handleInsert = useCallback((elementType: string) => {
    const editor = editorRef.current
    if (!editor) return

    switch (elementType) {
      case 'table':
        editor.insertTable(3, 3)
        onDirty(true)
        break
      case 'input':
      case 'select':
      case 'date':
      case 'checkbox':
      case 'number':
      case 'textarea':
        editor.insertControl(elementType)
        onDirty(true)
        break
      case 'image':
        pickAndInsertImage(editor, onDirty)
        break
      default:
        console.warn('[EditorPage] Unknown insert type:', elementType)
    }
  }, [editorRef, onDirty])

  return (
    <EditorLayout
      documentTitle={documentTitle}
      onTitleChange={onTitleChange}
      onSave={onSave}
      onFormat={handleFormat}
      onInsert={handleInsert}
    >
      {/* Canvas 编辑器容器 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-[#E5E7EB] relative"
        style={{ minHeight: 0 }}
      />
    </EditorLayout>
  )
}
