// ============================================================
// 编辑器主页面
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { EditorLayout } from '@/components/layout/EditorLayout'
import { EditorProvider } from '@/components/editor/EditorProvider'
import { useEditorStore } from '@/store'
import { documentApi, type DocumentDetail } from '@/services/api'
import {
  EditorMode,
  PageMode,
  createBlankDocument,
} from '@/engine'

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

  // 格式化操作
  const handleFormat = useCallback((action: string, _value?: unknown) => {
    console.log('Format action:', action)
    // TODO: 通过引擎 command 执行格式化
    setDirty(true)
  }, [setDirty])

  // 元素插入
  const handleInsert = useCallback((elementType: string) => {
    console.log('Insert element:', elementType)
    // TODO: 通过引擎 command 插入元素
    setDirty(true)
  }, [setDirty])

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
      <EditorLayout
        documentTitle={documentTitle}
        onTitleChange={setDocumentTitle}
        onSave={handleSave}
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
    </EditorProvider>
  )
}
