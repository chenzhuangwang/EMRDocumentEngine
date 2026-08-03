// ============================================================
// 编辑器主页面 (ModelD)
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { EditorLayout } from '@/components/layout/EditorLayout'
import { EditorProvider, useEditorRef } from '@/components/editor/EditorProvider'
import { ExportDialog } from '@/components/dialogs/ExportDialog'
import { FindReplaceDialog } from '@/components/dialogs/FindReplaceDialog'
import { PrintDialog } from '@/components/dialogs/PrintDialog'
import { PageSetupDialog } from '@/components/dialogs/PageSetupDialog'
import { useEditorStore } from '@/store'
import { documentApi, templateApi } from '@/services/api'
import { generateCommandId } from '@/engine/command/ICommand'
import { InsertTextCommand } from '@/engine/command/commands/InsertTextCommand'
import { TOCGenerator } from '@/engine/render/TOCGenerator'

const PLACEHOLDER_MAP: Record<string, string> = {
  'control-input': '[文本输入]',
  'control-select': '[下拉选择]',
  'control-date': '[日期选择]',
  'control-checkbox': '[复选框]',
  'control-radio': '[单选框]',
  'control-number': '[数字输入]',
  'table': '[表格]',
  'image': '[图片]',
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [documentTitle, setDocumentTitle] = useState('未命名文档')
  const [loadedDoc, setLoadedDoc] = useState<unknown>(undefined)
  const [loading, setLoading] = useState(false)
  const isNew = !id || id === 'new'

  // 从后端加载文档 (非新建时)
  useEffect(() => {
    if (isNew) return
    setLoading(true)
    documentApi.getById(id!).then(res => {
      const detail = res.data.data
      if (detail) {
        setDocumentTitle(detail.title)
        try { setLoadedDoc(JSON.parse(detail.content)) } catch { /* 忽略解析错误 */ }
      }
    }).catch(err => {
      console.error('加载文档失败:', err)
    }).finally(() => setLoading(false))
  }, [id]) // eslint-disable-line

  if (loading) {
    return <div className="h-full flex items-center justify-center"><div className="text-gray-400">加载中...</div></div>
  }

  return (
    <EditorProvider containerRef={containerRef} document={loadedDoc as import('@/engine').DocumentTree | undefined}>
      <EditorPageInner
        containerRef={containerRef}
        documentTitle={documentTitle}
        onTitleChange={setDocumentTitle}
        isNew={isNew}
        docId={id}
      />
    </EditorProvider>
  )
}

function EditorPageInner({
  containerRef, documentTitle, onTitleChange, isNew, docId,
}: {
  containerRef: React.RefObject<HTMLDivElement>
  documentTitle: string
  onTitleChange: (t: string) => void
  isNew: boolean
  docId?: string
}) {
  const editorRef = useEditorRef()
  const navigate = useNavigate()
  const [exportOpen, setExportOpen] = useState(false)
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [templates, setTemplates] = useState<{ name: string; items: { id: string; name: string; description?: string }[] }[]>([])
  const setDirty = useEditorStore((s) => s.setDirty)
  const setSaveStatus = useEditorStore((s) => s.setSaveStatus)
  const setParaStyle = useEditorStore((s) => s.setParagraphStyle)
  const setHfEdit = useEditorStore((s) => s.setHeaderFooterEdit)

  // 页眉页脚事件桥接: EventBus → Zustand store
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const bus = editor.getEventBus()
    const handleDblClick = (section: 'header' | 'footer') => {
      setHfEdit(true, section)
    }
    const handleBodyClick = () => {
      setHfEdit(false)
    }
    bus.on('headerFooter:dblclick', handleDblClick)
    bus.on('body:click', handleBodyClick)
    return () => {
      bus.off('headerFooter:dblclick', handleDblClick)
      bus.off('body:click', handleBodyClick)
    }
  }, [editorRef, setHfEdit])

  // 字数统计 + 段落样式 — 订阅 contentChange 事件
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const update = () => {
      const doc = editor.getDocument()
      let count = 0
      for (const paraId of doc.body.children) {
        const para = editor.getPool().nodes.get(paraId) as { children?: string[] } | undefined
        if (para?.children) {
          for (const childId of para.children) {
            const node = editor.getPool().nodes.get(childId) as { text?: string; type?: string } | undefined
            if (node?.type === 'text') count += (node.text || '').length
          }
        }
      }
      setWordCount(count)
      setPageCount(editor.getDraw().getPages().length)
      setParaStyle(editor.getParagraphStyle())
    }
    editor.on('contentChange', update)
    update() // 初始计算
    return () => { editor.off('contentChange', update) }
  }, [editorRef])

  const handleSave = useCallback(async () => {
    setSaveStatus('saving')
    try {
      const editor = editorRef.current
      if (!editor) return
      const content = JSON.stringify(editor.getDocument())
      if (isNew) {
        const res = await documentApi.create({ title: documentTitle, content: JSON.parse(content) })
        const newId = res.data.data?.id
        if (newId) navigate(`/editor/${newId}`, { replace: true })
        console.debug('[EditorPage] created:', newId)
      } else if (docId) {
        await documentApi.update(docId, { title: documentTitle, content: JSON.parse(content) })
        console.debug('[EditorPage] updated:', docId)
      }
      setSaveStatus('saved')
      setDirty(false)
    } catch (err) {
      console.error('保存失败:', err)
      setSaveStatus('error')
    }
  }, [setSaveStatus, setDirty, documentTitle, isNew, docId, editorRef])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setFindReplaceOpen(true) }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') { e.preventDefault(); setFindReplaceOpen(true) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  const handleFormat = useCallback((action: string, _value?: unknown) => {
    const ed = editorRef.current; if (!ed) return
    switch (action) {
      case 'undo': ed.undo(); break
      case 'redo': ed.redo(); break
      case 'bold': ed.toggleFormat({ bold: true }); break
      case 'italic': ed.toggleFormat({ italic: true }); break
      case 'underline': ed.toggleFormat({ underline: true }); break
      case 'strikeout': ed.toggleFormat({ strikeout: true }); break
      case 'superscript': ed.toggleFormat({ superscript: true }); break
      case 'subscript': ed.toggleFormat({ subscript: true }); break
      case 'font': ed.toggleFormat({ font: String(_value ?? 'SimSun') }); break
      case 'fontSize': ed.toggleFormat({ size: Number(_value ?? 16) }); break
      case 'color': ed.toggleFormat({ color: String(_value ?? '#000000') }); break
      // 段落格式
      case 'alignLeft': ed.setParagraphStyle({ alignment: 'left' }); break
      case 'alignCenter': ed.setParagraphStyle({ alignment: 'center' }); break
      case 'alignRight': ed.setParagraphStyle({ alignment: 'right' }); break
      case 'alignJustify': ed.setParagraphStyle({ alignment: 'justify' }); break
      case 'unorderedList': {
        const ps = ed.getParagraphStyle()
        ed.setParagraphStyle({ list: ps?.listType === 'bullet' ? undefined : { type: 'bullet', level: 1 } as unknown as import('@/engine').ListStyle })
        break
      }
      case 'orderedList': {
        const ps = ed.getParagraphStyle()
        ed.setParagraphStyle({ list: ps?.listType === 'ordered' ? undefined : { type: 'ordered', level: 1 } as unknown as import('@/engine').ListStyle })
        break
      }
      case 'indent': ed.adjustIndent(24); break
      case 'outdent': ed.adjustIndent(-24); break
    }
  }, [editorRef])

  const handleExport = useCallback((format: string) => {
    const ed = editorRef.current
    if (!ed) return
    if (format === 'json') {
      const doc = ed.getDocument()
      const pool = ed.getPool()
      const tocGen = new TOCGenerator()
      const toc = tocGen.extractEntries(doc, pool)
      const json = JSON.stringify({ ...doc, _toc: toc }, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url; a.download = `document-${Date.now()}.json`; a.click()
      URL.revokeObjectURL(url)
    } else if (format === 'txt') {
      const doc = ed.getDocument()
      const lines: string[] = []
      for (const paraId of doc.body.children) {
        const para = ed.getPool().nodes.get(paraId) as { children?: string[] } | undefined
        if (para?.children) {
          let line = ''
          for (const childId of para.children) {
            const node = ed.getPool().nodes.get(childId) as { text?: string; type?: string } | undefined
            if (node?.type === 'text') line += (node.text || '')
          }
          lines.push(line)
        }
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url; a.download = `document-${Date.now()}.txt`; a.click()
      URL.revokeObjectURL(url)
    }
  }, [editorRef])

  const handleTemplateSelect = useCallback(async (templateId: string) => {
    const ed = editorRef.current
    if (!ed) return
    try {
      const res = await templateApi.getById(templateId)
      const detail = res.data.data
      if (detail) {
        const doc = JSON.parse(detail.content)
        ed.setDocument(doc)
        onTitleChange(detail.title || '未命名文档')
      }
    } catch (err) {
      console.error('加载模板失败:', err)
    }
  }, [editorRef, onTitleChange])

  // 从后端加载模板列表
  useEffect(() => {
    templateApi.list().then(res => {
      const items = res.data.data || []
      setTemplates([{ name: '医疗文书', items: items.map((t: { id: string; name: string; description?: string }) => ({ id: t.id, name: t.name, description: t.description })) }])
    }).catch(() => { /* 加载失败, 保持空列表 */ })
  }, [])

  return (
    <EditorLayout
      documentTitle={documentTitle}
      onTitleChange={onTitleChange}
      onSave={handleSave}
      onFormat={handleFormat}
      onInsert={(type: string) => {
        const ed = editorRef.current
        if (!ed) return
        const placeholder = PLACEHOLDER_MAP[type] || `[${type}]`
        const cursor = ed.getStore().state.runtime.cursor
        if (cursor.paragraphPath.length === 0) return
        ed.execCommand(new InsertTextCommand(generateCommandId(), Date.now(), 'user', cursor.paragraphPath, cursor.offset, placeholder))
      }}
      onExportClick={() => setExportOpen(true)}
      onPrint={() => setPrintOpen(true)}
      wordCount={wordCount}
      pageCount={pageCount}
      onTemplateSelect={handleTemplateSelect}
      templates={templates}
    >
      <div ref={containerRef} className="flex-1 bg-[#E5E7EB] relative overflow-hidden" style={{ minHeight: '400px' }} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} onExport={handleExport} />
      <FindReplaceDialog
        open={findReplaceOpen}
        onClose={() => setFindReplaceOpen(false)}
      />
      <PrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        totalPages={pageCount}
        onPrint={(settings) => {
          console.debug('[EditorPage] print settings:', settings)
          window.print()
        }}
      />
      <PageSetupDialog
        open={pageSetupOpen}
        onClose={() => setPageSetupOpen(false)}
        onApply={(values) => {
          console.debug('[EditorPage] page setup values:', values)
          setPageSetupOpen(false)
        }}
      />
    </EditorLayout>
  )
}
