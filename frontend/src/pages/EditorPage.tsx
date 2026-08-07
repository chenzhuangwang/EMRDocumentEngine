// ============================================================
// 编辑器主页面 (ModelD)
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { EditorLayout } from '@/components/layout/EditorLayout'
import { ReadingModeOverlay } from '@/components/views/ReadingMode'
import { EditorProvider, useEditorRef } from '@/components/editor/EditorProvider'
import { ExportDialog } from '@/components/dialogs/ExportDialog'
import { FindReplaceDialog } from '@/components/dialogs/FindReplaceDialog'
import { PrintDialog } from '@/components/dialogs/PrintDialog'
import { PageSetupDialog } from '@/components/dialogs/PageSetupDialog'
import { PasteSpecialDialog, type PasteFormat } from '@/components/dialogs/PasteSpecialDialog'
import { BookmarkDialog } from '@/components/dialogs/BookmarkDialog'
import { useEditorStore } from '@/store'
import { documentApi, templateApi } from '@/services/api'
import { generateCommandId } from '@/engine/command/ICommand'
import { InsertTextCommand } from '@/engine/command/commands/InsertTextCommand'
import { documentLoaderRegistry } from '@/engine/loaders/DocumentLoaderRegistry'
import { buildNodePool } from '@/engine/document/NodePool'
import { TOCGenerator } from '@/engine/render/TOCGenerator'
import type { OutlineItem } from '@/components/sidebar/OutlineNav'

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

/** HTML 导出: 文本格式标签 */
function applyHtmlTags(text: string, bold: boolean, italic: boolean, underline: boolean): string {
  let result = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (bold) result = `<strong>${result}</strong>`
  if (italic) result = `<em>${result}</em>`
  if (underline) result = `<u>${result}</u>`
  return `<p>${result}</p>`
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
  const [pasteSpecialOpen, setPasteSpecialOpen] = useState(false)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [tableInsertOpen, setTableInsertOpen] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [findMatchCount, setFindMatchCount] = useState(0)
  const [findMatchIndex, setFindMatchIndex] = useState(-1)
  const findResultsRef = useRef<import('@/engine').MatchResult[]>([])
  const [zoom, setZoom] = useState(1)
  const [showInvisible, setShowInvisible] = useState(false)
  const [readingMode, setReadingMode] = useState(false)
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([])
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docFileInputRef = useRef<HTMLInputElement>(null)
  const [templates, setTemplates] = useState<{ name: string; items: { id: string; name: string; description?: string }[] }[]>([])
  const setDirty = useEditorStore((s) => s.setDirty)
  const setSaveStatus = useEditorStore((s) => s.setSaveStatus)
  const setParaStyle = useEditorStore((s) => s.setParagraphStyle)
  const setTextStyle = useEditorStore((s) => s.setTextStyle)
  const setFormatPainter = useEditorStore((s) => s.setFormatPainter)
  const formatPainterActive = useEditorStore((s) => s.formatPainter.active)
  const setCanUndoRedo = useEditorStore((s) => s.setCanUndoRedo)
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

  // 格式刷状态同步: Editor ↔ Zustand store
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.setOnFormatPainterChange((active) => {
      setFormatPainter(active)
    })
  }, [editorRef, setFormatPainter])

  // 滚动双向同步: DOM container.scrollTop ↔ CoordinateSystem.scrollY
  useEffect(() => {
    const editor = editorRef.current
    const container = containerRef.current
    if (!editor || !container) return

    const onScroll = () => {
      editor.syncScrollPosition(container.scrollTop)
      // 当前页码 (基于滚动位置)
      const pages = editor.getDraw().getPages()
      if (pages.length > 0) {
        const pageH = pages[0].height
        setCurrentPageIndex(Math.min(pages.length - 1, Math.floor(container.scrollTop / pageH)))
      }
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [editorRef, containerRef])

  // 缩放: Ctrl+滚轮
  useEffect(() => {
    const editor = editorRef.current
    const container = containerRef.current
    if (!editor || !container) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const delta = -e.deltaY * 0.005 // 向上滚=放大, 向下=缩小
      const newZoom = Math.min(4, Math.max(0.25, zoom + delta))
      setZoom(newZoom)
      editor.setScale(newZoom)
      editor.getDraw().render(editor.getPool(), editor.getStore().state.runtime)
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [editorRef, containerRef, zoom])

  // 缩放: Ctrl+plus/minus + Ctrl+0 重置
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setZoom(z => {
          const nz = Math.min(4, z + 0.1)
          const ed = editorRef.current
          if (ed) { ed.setScale(nz); ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime) }
          return nz
        })
      } else if (e.key === '-') {
        e.preventDefault()
        setZoom(z => {
          const nz = Math.max(0.25, z - 0.1)
          const ed = editorRef.current
          if (ed) { ed.setScale(nz); ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime) }
          return nz
        })
      } else if (e.key === '0') {
        e.preventDefault()
        setZoom(1)
        const ed = editorRef.current
        if (ed) { ed.setScale(1); ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime) }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editorRef])

  const handleScaleChange = useCallback((newScale: number) => {
    setZoom(newScale)
    const ed = editorRef.current
    if (ed) {
      ed.setScale(newScale)
      ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
    }
  }, [editorRef])

  const handleToggleInvisible = useCallback(() => {
    setShowInvisible(v => {
      const nv = !v
      const ed = editorRef.current
      if (ed) {
        ed.setShowInvisible(nv)
        ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
      }
      return nv
    })
  }, [editorRef])

  // 字数统计 + 段落样式 + 大纲 — 订阅 contentChange 事件
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const update = () => {
      const wc = editor.getWordCount()
      setWordCount(wc.words)
      setPageCount(editor.getDraw().getPages().length)
      setParaStyle(editor.getParagraphStyle())
      setTextStyle(editor.getTextStyle())
      setCanUndoRedo(editor.canUndo(), editor.canRedo())

      // 大纲: 提取所有 outlineLevel > 0 的标题段落
      const doc = editor.getDocument()
      const pool = editor.getPool()
      const pages = editor.getDraw().getPages()
      const paraPageMap = new Map<string, number>()
      for (let pi = 0; pi < pages.length; pi++) {
        for (const item of pages[pi].items) {
          const para = pool.nodes.get(item.nodeId)
          if (para && !paraPageMap.has(item.nodeId)) {
            // 递归查找所属段落
            for (const [, n] of pool.nodes) {
              if (n.type === 'paragraph' && (n as { children?: string[] }).children?.includes(item.nodeId)) {
                paraPageMap.set((n as unknown as { id: string }).id, pi)
              }
            }
          }
        }
      }

      const items: OutlineItem[] = []
      const tocGen = new TOCGenerator({ maxLevel: 6 })
      const entries = tocGen.extractEntries(doc, pool, paraPageMap)
      for (const entry of entries) {
        items.push({
          id: entry.paragraphId,
          paragraphPath: [doc.id, entry.paragraphId],
          level: entry.level,
          text: entry.text,
          pageIndex: entry.pageNumber - 1,
        })
      }
      setOutlineItems(items)
    }
    editor.on('contentChange', update)
    update() // 初始计算
    return () => { editor.off('contentChange', update) }
  }, [editorRef])

  /** 大纲点击: 跳转光标到目标段落 + 滚动到对应页面 */
  const handleOutlineClick = useCallback((item: OutlineItem) => {
    const editor = editorRef.current
    const container = containerRef.current
    if (!editor || !container) return

    // 更新光标到目标段落开头
    const store = editor.getStore()
    const si = store as unknown as {
      _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean }; selection: { active: boolean; granularity: string; anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean } } } }
    }
    si._state.runtime.cursor = {
      paragraphPath: item.paragraphPath,
      offset: 0, visible: true,
    }
    si._state.runtime.selection = {
      anchor: { paragraphPath: item.paragraphPath, offset: 0, visible: false },
      focus: { paragraphPath: item.paragraphPath, offset: 0, visible: false },
      active: false, granularity: 'character',
    }
    setActiveOutlineId(item.id)

    // 滚动到目标页面
    const pages = editor.getDraw().getPages()
    if (pages.length > 0 && item.pageIndex >= 0 && item.pageIndex < pages.length) {
      const pageHeight = pages[0].height
      container.scrollTop = item.pageIndex * pageHeight
    }

    editor.getDraw().render(editor.getPool(), editor.getStore().state.runtime)
  }, [editorRef, containerRef])

  /** 图片文件选择 → 读取为 dataUrl → 插入编辑器 */
  const handleImageFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onload = () => {
        editorRef.current?.insertImage(dataUrl, img.naturalWidth, img.naturalHeight)
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
    // 重置 input 以允许重复选择同一文件
    e.target.value = ''
  }, [editorRef])

  const handleDocFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const result = documentLoaderRegistry.load(text, file.name)
      if (result?.doc) {
        const ed = editorRef.current
        if (ed) {
          const map = new Map<string, import('@/engine/document/DocumentModel').BaseNode>()
          map.set(result.doc.id, result.doc)
          const pool = buildNodePool(map, { body: result.doc.id })
          ed.setDocument(result.doc)
          ed.getDraw().render(pool, ed.getStore().state.runtime)
        }
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [editorRef])

  // 查找 (TASK-452)
  const handleFind = useCallback((query: string, options: { caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }) => {
    const ed = editorRef.current
    if (!ed || !query) return
    const results = ed.findAll(query, options)
    findResultsRef.current = results
    setFindMatchCount(results.length)
    setFindMatchIndex(results.length > 0 ? 0 : -1)
    // 选中第一个结果
    if (results.length > 0) {
      ed.highlightAll(query, options)
      const r = results[0]
      const store = ed.getStore()
      const si = store as unknown as { _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean }; selection: { anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean }; active: boolean; granularity: string } } } }
      si._state.runtime.cursor = { paragraphPath: r.paragraphPath, offset: r.endOffset, visible: true }
      si._state.runtime.selection = { anchor: { paragraphPath: r.paragraphPath, offset: r.startOffset, visible: false }, focus: { paragraphPath: r.paragraphPath, offset: r.endOffset, visible: false }, active: true, granularity: 'character' }
      ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
    }
  }, [editorRef])

  const handleFindNext = useCallback(() => {
    const ed = editorRef.current
    const results = findResultsRef.current
    if (!ed || results.length === 0) return
    const next = (findMatchIndex + 1) % results.length
    setFindMatchIndex(next)
    const r = results[next]
    const store = ed.getStore()
    const si = store as unknown as { _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean }; selection: { anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean }; active: boolean; granularity: string } } } }
    si._state.runtime.cursor = { paragraphPath: r.paragraphPath, offset: r.endOffset, visible: true }
    si._state.runtime.selection = { anchor: { paragraphPath: r.paragraphPath, offset: r.startOffset, visible: false }, focus: { paragraphPath: r.paragraphPath, offset: r.endOffset, visible: false }, active: true, granularity: 'character' }
    ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
  }, [editorRef, findMatchIndex])

  const handleFindPrevious = useCallback(() => {
    const ed = editorRef.current
    const results = findResultsRef.current
    if (!ed || results.length === 0) return
    const prev = (findMatchIndex - 1 + results.length) % results.length
    setFindMatchIndex(prev)
    const r = results[prev]
    const store = ed.getStore()
    const si = store as unknown as { _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean }; selection: { anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean }; active: boolean; granularity: string } } } }
    si._state.runtime.cursor = { paragraphPath: r.paragraphPath, offset: r.endOffset, visible: true }
    si._state.runtime.selection = { anchor: { paragraphPath: r.paragraphPath, offset: r.startOffset, visible: false }, focus: { paragraphPath: r.paragraphPath, offset: r.endOffset, visible: false }, active: true, granularity: 'character' }
    ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
  }, [editorRef, findMatchIndex])

  const handleReplace = useCallback((replacement: string) => {
    const ed = editorRef.current
    const results = findResultsRef.current
    if (!ed || results.length === 0 || findMatchIndex < 0) return
    const r = results[findMatchIndex]
    ed.replace(r.matchedText, replacement, r)
    // 重新查找更新结果
    const newResults = ed.findAll(r.matchedText, { caseSensitive: true, wholeWord: false, useRegex: false })
    findResultsRef.current = newResults
    setFindMatchCount(newResults.length)
    setFindMatchIndex(newResults.length > 0 ? Math.min(findMatchIndex, newResults.length - 1) : -1)
  }, [editorRef, findMatchIndex])

  const handleReplaceAll = useCallback((replacement: string) => {
    const ed = editorRef.current
    const results = findResultsRef.current
    if (!ed || results.length === 0) return
    const query = results[0]?.matchedText || ''
    if (query) {
      ed.replaceAll(query, replacement)
      findResultsRef.current = []
      setFindMatchCount(0)
      setFindMatchIndex(-1)
    }
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
      // Ctrl+Shift+8: 切换格式标记显示 (Word 兼容快捷键)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '8') { e.preventDefault(); handleToggleInvisible() }
      // Word 兼容文本格式快捷键
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); handleFormat('bold') }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); handleFormat('italic') }
      if ((e.ctrlKey || e.metaKey) && e.key === 'u') { e.preventDefault(); handleFormat('underline') }
      // Ctrl+P: 打印 (Word 兼容)
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); setPrintOpen(true) }
      // Ctrl+Shift+V: 选择性粘贴
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') { e.preventDefault(); setPasteSpecialOpen(true) }
      // Tab: 增加缩进 (Word 兼容)
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); handleFormat('indent') }
      // Shift+Tab: 减少缩进
      if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); handleFormat('outdent') }
      // ESC: 取消格式刷
      if (e.key === 'Escape') {
        const ed = editorRef.current
        if (ed?.isFormatPainterActive) { ed.setFormatPainterActive(false); setFormatPainter(false) }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, handleToggleInvisible])

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
      case 'clearFormat': ed.clearFormat(); break
      case 'openBookmark': setBookmarkOpen(true); break
      // 格式刷: 切换激活状态
      case 'formatPainter':
        if (ed.isFormatPainterActive) {
          ed.setFormatPainterActive(false)
          setFormatPainter(false)
        } else {
          const style = ed.copyFormatPainterStyle()
          if (style) {
            ed.setFormatPainterActive(true)
            setFormatPainter(true, style)
          }
        }
        break
      case 'font': ed.toggleFormat({ font: String(_value ?? 'SimSun') }); break
      case 'fontSize': ed.toggleFormat({ size: Number(_value ?? 16) }); break
      case 'color': ed.toggleFormat({ color: String(_value ?? '#000000') }); break
      case 'highlight': ed.toggleFormat({ highlight: _value === 'transparent' ? undefined : String(_value ?? '#FFFF00') } as Partial<import('@/engine').TextStyle>); break
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
      case 'lineHeight': ed.setParagraphStyle({ lineHeight: Number(_value ?? 1.5) }); break
      case 'spaceBefore': ed.setParagraphStyle({ spaceBefore: Number(_value ?? 0) }); break
      case 'spaceAfter': ed.setParagraphStyle({ spaceAfter: Number(_value ?? 0) }); break
      case 'letterSpacing': ed.toggleFormat({ letterSpacing: Number(_value ?? 0) }); break
      case 'mergeCells': ed.mergeSelectedCells(); break
      case 'splitCell': ed.splitSelectedCell(); break
      // 标题样式: outlineLevel 0=正文, 1-6=Heading
      case 'heading':
        ed.setParagraphStyle({ outlineLevel: Number(_value ?? 0) })
        break
      // 页眉页脚编辑模式切换
      case 'headerFooterEnter': {
        const section = _value as 'header' | 'footer'
        const draw = ed.getDraw()
        const isActive = draw.isHeaderFooterEditActive()
        const currentSection = draw.getHeaderFooterEditSection()

        if (isActive && currentSection === section) {
          // 已在编辑同一区域 → 关闭
          draw.setHeaderFooterEditActive(false)
          setHfEdit(false)
          ed.getEventBus().emit('body:click')
        } else {
          // 激活或切换区域
          draw.setHeaderFooterEditActive(true, section)
          setHfEdit(true, section)

          // 确保目标区域有段落 (无则创建)
          const doc = ed.getDocument()
          const targetIds = section === 'header' ? doc.header! : doc.footer!
          if (targetIds.length === 0) {
            const paraId = ed.ensureHeaderFooterParagraph(section)
            targetIds.push(paraId)
          }

          // 自动将光标定位到对应区域的第一个段落
          const firstParaId = targetIds[0]
          const store = ed.getStore()
          const si = store as unknown as {
            _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean }; selection: { active: boolean; granularity: string; anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean } } } }
          }
          si._state.runtime.cursor = {
            paragraphPath: [doc.id, firstParaId],
            offset: 0,
            visible: true,
          }
          si._state.runtime.selection = {
            anchor: { paragraphPath: [doc.id, firstParaId], offset: 0, visible: false },
            focus: { paragraphPath: [doc.id, firstParaId], offset: 0, visible: false },
            active: false,
            granularity: 'character' as const,
          }

          ed.getEventBus().emit('headerFooter:dblclick', section)
        }
        // 重布局以包含新创建的段落
        ed.getDraw().recomputeLayout(ed.getPool())
        ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
        break
      }
    }
  }, [editorRef])

  const handleExport = useCallback((format: string) => {
    const ed = editorRef.current
    if (!ed) return
    const doc = ed.getDocument()
    const pool = ed.getPool()

    if (format === 'json') {
      const tocGen = new TOCGenerator()
      const toc = tocGen.extractEntries(doc, pool)
      const json = JSON.stringify({ ...doc, _toc: toc }, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url; a.download = `document-${Date.now()}.json`; a.click()
      URL.revokeObjectURL(url)
    } else if (format === 'txt') {
      const lines: string[] = []
      for (const paraId of doc.body.children) {
        const para = pool.nodes.get(paraId) as { children?: string[] } | undefined
        if (para?.children) {
          let line = ''
          for (const childId of para.children) {
            const node = pool.nodes.get(childId) as { text?: string; type?: string } | undefined
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
    } else if (format === 'html') {
      const lines: string[] = ['<!DOCTYPE html><html><head><meta charset="utf-8"><title>', doc.title, '</title></head><body>']
      for (const paraId of doc.body.children) {
        const para = pool.nodes.get(paraId) as { children?: string[]; outlineLevel?: number; alignment?: string } | undefined
        if (!para?.children) continue
        let text = ''
        let bold = false; let italic = false; let underline = false
        for (const childId of para.children) {
          const node = pool.nodes.get(childId) as { text?: string; type?: string; bold?: boolean; italic?: boolean; underline?: boolean; font?: string; size?: number } | undefined
          if (node?.type === 'text') {
            if (node.bold !== bold || node.italic !== italic || node.underline !== underline) {
              if (text) { lines.push(applyHtmlTags(text, bold, italic, underline)); text = '' }
              bold = !!node.bold; italic = !!node.italic; underline = !!node.underline
            }
            text += (node.text || '')
          }
        }
        if (text) lines.push(applyHtmlTags(text, bold, italic, underline))
      }
      lines.push('</body></html>')
      const blob = new Blob([lines.join('\n')], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url; a.download = `document-${Date.now()}.html`; a.click()
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
    <ReadingModeOverlay active={readingMode} onToggle={() => setReadingMode(v => !v)}>
    <EditorLayout
      readingMode={readingMode}
      documentTitle={documentTitle}
      onTitleChange={onTitleChange}
      onSave={handleSave}
      onFormat={handleFormat}
      onInsert={(type: string) => {
        const ed = editorRef.current
        if (!ed) return
        // 域代码: 工具栏插入域 (TASK-471 + R39)
        if (type === 'pageNumber') { ed.insertFieldCode('page_number'); return }
        if (type === 'currentDate') { ed.insertFieldCode('current_date'); return }
        if (type === 'totalPages') { ed.insertFieldCode('total_pages'); return }
        if (type === 'currentTime') { ed.insertFieldCode('current_time'); return }
        if (type === 'authorName') { ed.insertFieldCode('author_name'); return }
        if (type === 'documentTitle') { ed.insertFieldCode('document_title'); return }
        if (type === 'lastSavedDate') { ed.insertFieldCode('last_saved_date'); return }
        if (type === 'printDate') { ed.insertFieldCode('print_date'); return }
        // 分隔线插入
        if (type === 'separator') { ed.insertSeparator(); return }
        // 图片: 触发文件选择器
        if (type === 'image') { fileInputRef.current?.click(); return }
        // 表格插入: 默认 3x3 网格
        if (type === 'table') { setTableInsertOpen(true); return }
        // 分节符
        if (type === 'sectionBreak') { ed.insertSectionBreak(); return }
        // 表单控件 → SmartTextNode 创建
        if (type === 'input') { ed.insertSmartText('文本输入', 'S1'); return }
        if (type === 'textarea') { ed.insertSmartText('文本域', 'S2'); return }
        if (type === 'number') { ed.insertSmartText('数字输入', 'N'); return }
        if (type === 'date') { ed.insertSmartText('日期选择', 'D'); return }
        if (type === 'select') { ed.insertSmartText('下拉选择', 'S1'); return }
        if (type === 'checkbox') { ed.insertSmartText('复选框', 'S1'); return }
        if (type === 'radio') { ed.insertSmartText('单选框', 'S1'); return }
        const placeholder = PLACEHOLDER_MAP[type] || `[${type}]`
        const cursor = ed.getStore().state.runtime.cursor
        if (cursor.paragraphPath.length === 0) return
        ed.execCommand(new InsertTextCommand(generateCommandId(), Date.now(), 'user', cursor.paragraphPath, cursor.offset, placeholder))
      }}
      onExportClick={() => setExportOpen(true)}
      onPrint={() => setPrintOpen(true)}
      onPageSetup={() => setPageSetupOpen(true)}
      commentThreads={(() => { const ed = editorRef.current; return ed ? ed.getComments() : [] })()}
      onAddCommentReply={(threadId, content) => editorRef.current?.addCommentReply(threadId, content)}
      onResolveCommentThread={(threadId) => {
        const ed = editorRef.current
        if (!ed) return
        const threads = ed.getComments()
        const t = threads.find(c => c.id === threadId)
        ed.resolveComment(threadId, t?.status !== 'resolved')
      }}
      formatPainterActive={formatPainterActive}
      wordCount={wordCount}
      pageCount={pageCount}
      pageIndex={currentPageIndex + 1}
      scale={zoom}
      onScaleChange={handleScaleChange}
      showInvisible={showInvisible}
      onToggleInvisible={handleToggleInvisible}
      outlineItems={outlineItems}
      activeOutlineId={activeOutlineId}
      onOutlineClick={handleOutlineClick}
      onTemplateSelect={handleTemplateSelect}
      templates={templates}
    >
      <div ref={containerRef} className="flex-1 bg-[#E5E7EB] relative overflow-y-auto overflow-x-hidden" style={{ minHeight: '400px' }} />
      {/* 隐藏的文件选择器 (TASK-447 图片插入) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFile}
      />
      <input
        ref={docFileInputRef}
        type="file"
        accept=".json,.emr,.html,.htm,.md,.markdown,.xml"
        className="hidden"
        onChange={handleDocFile}
      />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} onExport={handleExport} />
      <FindReplaceDialog
        open={findReplaceOpen}
        onClose={() => setFindReplaceOpen(false)}
        matchCount={findMatchCount}
        currentMatchIndex={findMatchIndex}
        onFind={handleFind}
        onFindNext={handleFindNext}
        onFindPrevious={handleFindPrevious}
        onReplace={handleReplace}
        onReplaceAll={handleReplaceAll}
      />
      <PrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        totalPages={pageCount}
        onPrint={(_settings) => {
          const ed = editorRef.current
          if (!ed) return
          const pageImages = ed.preparePrintPages()
          const w = window.open('', '_blank', `width=${screen.width},height=${screen.height}`)
          if (!w) return
          w.document.write('<html><head><title>打印</title><style>')
          w.document.write('@page{size:A4;margin:0}body{margin:0;display:flex;flex-direction:column;align-items:center}')
          w.document.write('img{width:210mm;height:auto;page-break-after:always}img:last-child{page-break-after:auto}')
          w.document.write('</style></head><body>')
          for (const url of pageImages) {
            w.document.write(`<img src="${url}" />`)
          }
          w.document.write('</body></html>')
          w.document.close()
          setTimeout(() => { w.print(); w.close() }, 300)
        }}
      />
      <PageSetupDialog
        open={pageSetupOpen}
        onClose={() => setPageSetupOpen(false)}
        onApply={(values) => {
          const ed = editorRef.current
          if (ed) ed.applyPageSetup(values)
          setPageSetupOpen(false)
        }}
      />
      <PasteSpecialDialog
        open={pasteSpecialOpen}
        onClose={() => setPasteSpecialOpen(false)}
        onPaste={(format: PasteFormat) => {
          const ed = editorRef.current
          if (ed) ed.pasteSpecial(format)
          setPasteSpecialOpen(false)
        }}
      />
      {tableInsertOpen && (
        <TableSizePicker
          onSelect={(r, c) => { editorRef.current?.insertTable(r, c); setTableInsertOpen(false) }}
          onCancel={() => setTableInsertOpen(false)}
        />
      )}
      <BookmarkDialog
        open={bookmarkOpen}
        onClose={() => setBookmarkOpen(false)}
        targets={(() => { const ed = editorRef.current; return ed ? ed.getBookmarkTargets() : [] })()}
        onInsertBookmark={(name) => {
          const ed = editorRef.current
          if (ed) ed.insertBookmark(name)
          setBookmarkOpen(false)
        }}
        onInsertCrossReference={(targetId, refType, displayText) => {
          const ed = editorRef.current
          if (ed) ed.insertCrossReference(targetId, refType, displayText)
          setBookmarkOpen(false)
        }}
      />
    </EditorLayout>
    </ReadingModeOverlay>
  )
}

// ---- 内联表格尺寸选择器 ----

function TableSizePicker({ onSelect, onCancel }: { onSelect: (rows: number, cols: number) => void; onCancel: () => void }) {
  const [hoverCols, setHoverCols] = useState(1)
  const [hoverRows, setHoverRows] = useState(1)
  const maxC = 8; const maxR = 10

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-xs text-gray-500 mb-2">{hoverRows}×{hoverCols} 表格</div>
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${maxC}, 24px)` }}>
          {Array.from({ length: maxR }, (_, r) =>
            Array.from({ length: maxC }, (_, c) => (
              <div
                key={`${r}-${c}`}
                className="w-6 h-6 rounded-sm border cursor-pointer transition-colors"
                style={{ backgroundColor: r < hoverRows && c < hoverCols ? '#3B82F6' : '#E5E7EB', borderColor: r < hoverRows && c < hoverCols ? '#2563EB' : '#D1D5DB' }}
                onMouseEnter={() => { setHoverRows(r + 1); setHoverCols(c + 1) }}
                onClick={() => onSelect(r + 1, c + 1)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
