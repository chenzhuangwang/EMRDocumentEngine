// ============================================================
// 编辑器主页面 (ModelD)
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { EditorLayout } from '@/components/layout/EditorLayout'
import { EditorProvider, useEditorRef } from '@/components/editor/EditorProvider'
import { ExportDialog } from '@/components/dialogs/ExportDialog'
import { useEditorStore } from '@/store'

export default function EditorPage() {
  const { id: _id } = useParams<{ id: string }>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [documentTitle, setDocumentTitle] = useState('未命名文档')
  const [loading] = useState(false)
  const _setStoreDoc = useEditorStore((s) => s.setDocument)
  const setDirty = useEditorStore((s) => s.setDirty)
  const setSaveStatus = useEditorStore((s) => s.setSaveStatus)

  const handleSave = useCallback(async () => {
    setSaveStatus('saving')
    try {
      // TODO: connect to backend API
      setSaveStatus('saved')
      setDirty(false)
    } catch (err) {
      console.error('保存失败:', err)
      setSaveStatus('error')
    }
  }, [setSaveStatus, setDirty])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  if (loading) {
    return <div className="h-full flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  }

  return (
    <EditorProvider containerRef={containerRef}>
      <EditorPageInner
        containerRef={containerRef}
        documentTitle={documentTitle}
        onTitleChange={setDocumentTitle}
        onSave={handleSave}
      />
    </EditorProvider>
  )
}

function EditorPageInner({
  containerRef, documentTitle, onTitleChange, onSave,
}: {
  containerRef: React.RefObject<HTMLDivElement>
  documentTitle: string
  onTitleChange: (t: string) => void
  onSave: () => void
}) {
  const editorRef = useEditorRef()
  const [exportOpen, setExportOpen] = useState(false)

  const handleFormat = useCallback((action: string, _value?: unknown) => {
    const ed = editorRef.current; if (!ed) return
    switch (action) {
      case 'undo': ed.undo(); break
      case 'redo': ed.redo(); break
      // TODO: v20.34 通过 execCommand(FormatTextCommand) 实现, 需先获取 selection
      case 'bold': case 'italic': case 'underline':
      case 'font': case 'fontSize': case 'color':
        break
    }
  }, [editorRef])
  const handleInsert = useCallback((type: string) => {
    // TODO: v20.34 通过 execCommand 实现表格插入
    void type
  }, [editorRef])
  const handleExport = useCallback((format: string) => {
    if (format === 'json' && editorRef.current) {
      const json = JSON.stringify(editorRef.current.getDocument(), null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url; a.download = `document-${Date.now()}.json`; a.click()
      URL.revokeObjectURL(url)
    }
  }, [editorRef])
  const handlePrint = useCallback(() => window.print(), [])

  return (
    <EditorLayout
      documentTitle={documentTitle}
      onTitleChange={onTitleChange}
      onSave={onSave}
      onFormat={handleFormat}
      onInsert={handleInsert}
      onExportClick={() => setExportOpen(true)}
      onPrint={handlePrint}
    >
      <div ref={containerRef} className="flex-1 bg-[#E5E7EB] relative overflow-hidden" style={{ minHeight: '400px' }} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} onExport={handleExport} />
    </EditorLayout>
  )
}
