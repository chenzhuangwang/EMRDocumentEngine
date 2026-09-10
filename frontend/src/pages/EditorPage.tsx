// ============================================================
// 编辑器主页面 (ModelD)
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { EditorLayout } from '@/components/layout/EditorLayout'
import { ReadingModeOverlay } from '@/components/views/ReadingMode'
import { DesignControlPalette } from '@/components/views/DesignControlPalette'
import { DesignControlProperties } from '@/components/views/DesignControlProperties'
import { EditorProvider, useEditorRef, useEditorReady, useEditorStoreSnapshot } from '@/components/editor/EditorProvider'
import { RuntimeControlOverlay } from '@/components/editor/RuntimeControlOverlay'
import { stripWidgetDefaultLabels, stripWidgetDefaultLabelsFromObject } from '@/platform/data/controlLibrary'
import { useEditorContextMenu } from '@/components/editor/useEditorContextMenu'
import { ContextMenu } from '@/components/editor/ContextMenu'
import { ExportDialog } from '@/components/dialogs/ExportDialog'
import { FindReplaceDialog } from '@/components/dialogs/FindReplaceDialog'
import { PrintDialog } from '@/components/dialogs/PrintDialog'
import { PageSetupDialog } from '@/components/dialogs/PageSetupDialog'
import { PasteSpecialDialog, type PasteFormat } from '@/components/dialogs/PasteSpecialDialog'
import { BookmarkDialog } from '@/components/dialogs/BookmarkDialog'
import { DocumentPropertiesDialog } from '@/components/dialogs/DocumentPropertiesDialog'
import { ControlInputDialog } from '@/components/dialogs/ControlInputDialog'
import { ControlChoiceDialog } from '@/components/dialogs/ControlChoiceDialog'
import { initialConfigForCreate, controlFamilyOf } from '@/components/dialogs/controlConfigShared'
import type { ControlConfigData } from '@/components/dialogs/controlConfigShared'
import { documentApi, templateApi } from '@/services/api'
import { documentLoaderRegistry } from '@/engine/loaders/DocumentLoaderRegistry'
import { templateImporter, isExternalTemplate } from '@/engine'
import { TOCGenerator } from '@/engine/render/TOCGenerator'
import { ListParticle } from '@/engine/render/particles/ListParticle'
import type { OutlineItem } from '@/components/sidebar/OutlineNav'
import type { EditorMode, ElementMeta } from '@/engine'
import type { ListStyle } from '@/engine/document/core/DocumentModel'

/** 生成列表标记文本 (供 TXT/HTML 导出) */
function getListMarker(list: ListStyle, orderNum?: number): string {
  const level = list.level || 1
  const indent = '  '.repeat(level - 1)
  if (list.type === 'bullet') {
    const bulletChar = list.bulletChar || ListParticle.resolveBulletChar(level)
    return indent + bulletChar + ' '
  }
  // ordered list
  const num = orderNum ?? (list.startAt || 1)
  const numberStyle = list.numberStyle || 'decimal'
  return indent + ListParticle.formatOrderedNumberRaw(num, numberStyle) + '. '
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const containerRef = useRef<HTMLDivElement>(null)
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
        try {
          const parsed = JSON.parse(detail.content)
          // 打开旧文档同样清理库默认标签 (与导入/导出一致)
          stripWidgetDefaultLabelsFromObject((parsed as { templateDefinitions?: Record<string, import('@/engine').TemplateDefinition> }).templateDefinitions)
          setLoadedDoc(parsed)
        } catch { /* 忽略解析错误 */ }
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
        isNew={isNew}
        docId={id}
      />
    </EditorProvider>
  )
}

function EditorPageInner({
  containerRef, isNew, docId,
}: {
  containerRef: React.RefObject<HTMLDivElement>
  isNew: boolean
  docId?: string
}) {
  const editorRef = useEditorRef()
  const ready = useEditorReady()
  const navigate = useNavigate()

  // ---- 控件配置弹框 (契约 §12.7): 向导 (create) + 右键属性 (edit) ----
  type WizardKind = 'textInput' | 'radio' | 'checkbox'
  const [controlWizard, setControlWizard] = useState<{ open: boolean; kind: WizardKind }>({ open: false, kind: 'textInput' })
  const [controlEdit, setControlEdit] = useState<{ open: boolean; nodeId: string }>({ open: false, nodeId: '' })
  const openControlEdit = useCallback((controlId: string) => setControlEdit({ open: true, nodeId: controlId }), [])
  // 通用菜单只发 'properties' id; 弹框映射在设计态业务层这里完成 (契约 §12.7)。
  const contextMenu = useEditorContextMenu({ onProperty: openControlEdit })

  // 弹框关闭后 Radix 会把焦点回弹到触发器/做焦点陷阱, 故延后一帧再交回编辑器
  const refocusEditor = useCallback(() => {
    requestAnimationFrame(() => editorRef.current?.focus())
  }, [editorRef])

  // 向导确定 → 插到当前光标 (create); 属性确定 → 经 applyControlConfig 原子提交 (edit)
  const applyWizardResult = useCallback((r: ControlConfigData) => {
    const ed = editorRef.current
    if (ed) ed.insertControl(r.element, r.definition)
    setControlWizard((s) => ({ ...s, open: false }))
    refocusEditor()
  }, [editorRef, refocusEditor])
  const applyControlEdit = useCallback((r: ControlConfigData) => {
    const ed = editorRef.current
    if (ed) ed.applyControlConfig(controlEdit.nodeId, r.element, r.definition)
    // 应用后清除选中 (控件高亮/选中态随弹框关闭一并取消)
    ed?.selectControl(null)
    setControlEdit({ open: false, nodeId: '' })
    refocusEditor()
  }, [editorRef, controlEdit.nodeId, refocusEditor])
  const closeControlEdit = useCallback(() => {
    // 取消选中态, 再关闭属性弹框 (契约 §12.7 属性为瞬态操作)
    editorRef.current?.selectControl(null)
    setControlEdit({ open: false, nodeId: '' })
    refocusEditor()
  }, [editorRef, refocusEditor])

  const [exportOpen, setExportOpen] = useState(false)
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  const [pasteSpecialOpen, setPasteSpecialOpen] = useState(false)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [documentPropertiesOpen, setDocumentPropertiesOpen] = useState(false)
  const [tableInsertOpen, setTableInsertOpen] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [findMatchCount, setFindMatchCount] = useState(0)
  const [findMatchIndex, setFindMatchIndex] = useState(-1)
  const findResultsRef = useRef<import('@/engine').MatchResult[]>([])
  const zoom = useEditorStoreSnapshot((s) => s.runtime.view.scale)
  const showInvisible = useEditorStoreSnapshot((s) => s.runtime.view.showInvisible)
  const editorMode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const readingMode = editorMode === 'readonly'
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([])
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docFileInputRef = useRef<HTMLInputElement>(null)
  const [templates, setTemplates] = useState<{ name: string; items: { id: string; name: string; description?: string }[] }[]>([])

  // 滚动双向同步: DOM container.scrollTop ↔ CoordinateSystem.scrollY
  // 注意: editorRef.current 在子组件 effect 执行时可能尚未就绪 (EditorProvider 用
  // useEffect 创建 Editor, 父级 effect 晚于子级 effect 执行), 故监听器绑定到恒就绪的
  // container, 回调内再惰性解析 editor, 避免因 editor 未就绪而漏绑滚动同步。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onScroll = () => {
      const editor = editorRef.current
      if (!editor) return
      editor.syncScrollPosition(container.scrollTop)
      // 当前页码 — 基于累加高度 (含分页间隙) 反查 pageIndex
      const pages = editor.getDraw().getPages()
      if (pages.length > 0) {
        const scale = editor.getDraw().getCoordinateSystem().transform.scale
        const gap = editor.getDraw().getPageVerticalGap()
        const docScrollY = container.scrollTop / scale
        // 二分查找: 找到第一个 docSlotY > docScrollY 的页面
        let acc = 0; let pageIdx = 0
        for (let i = 0; i < pages.length; i++) {
          const slot = pages[i].height + gap
          if (docScrollY < acc + pages[i].height) { pageIdx = i; break }
          acc += slot
          pageIdx = i
        }
        setCurrentPageIndex(Math.min(pages.length - 1, pageIdx))
      }
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [editorRef, containerRef])

  // 缩放: Ctrl+滚轮 (绑在容器 div 上, 避免 Chrome 对 document 强制 passive)
  useEffect(() => {
    const container = containerRef.current
    if (!container || !ready) return
    const editor = editorRef.current
    if (!editor) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const delta = -e.deltaY * 0.005
      const cur = editor.getStore().state.runtime.view.scale
      const newZoom = Math.min(4, Math.max(0.25, cur + delta))
      editor.setScale(newZoom)
      editor.getDraw().render(editor.getPool(), editor.getStore().state.runtime)
    }
    // Chrome 73+ 对 document/window/body 上的 wheel 强制 passive, 必须绑在普通 DOM 元素上
    container.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => container.removeEventListener('wheel', onWheel, { capture: true })
  }, [ready, editorRef, containerRef])

  // 缩放: Ctrl+plus/minus + Ctrl+0 重置
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const ed = editorRef.current
      if (!ed) return
      const cur = ed.getStore().state.runtime.view.scale
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        const nz = Math.min(4, cur + 0.1)
        ed.setScale(nz); ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
      } else if (e.key === '-') {
        e.preventDefault()
        const nz = Math.max(0.25, cur - 0.1)
        ed.setScale(nz); ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
      } else if (e.key === '0') {
        e.preventDefault()
        ed.setScale(1); ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editorRef])

  const handleScaleChange = useCallback((newScale: number) => {
    const ed = editorRef.current
    if (ed) {
      ed.setScale(newScale)
      ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
    }
  }, [editorRef])

  const handleToggleInvisible = useCallback(() => {
    const ed = editorRef.current
    if (ed) {
      const nv = !ed.getStore().state.runtime.view.showInvisible
      ed.setShowInvisible(nv)
      ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
    }
  }, [editorRef])

  // 编辑器模式切换 (EditorStore.runtime.view.mode 为 canonical owner, 经 useEditorStoreSnapshot 回读)
  const handleEditorModeChange = useCallback((newMode: EditorMode) => {
    const editor = editorRef.current
    if (editor) {
      editor.setMode(newMode)
      // 切换到受限模式时清除格式刷状态
      if (newMode === 'readonly' || newMode === 'clean' || newMode === 'print') {
        if (editor.isFormatPainterActive) {
          editor.setFormatPainterActive(false)
        }
        // 退出运行时交互: 清除激活控件 (契约 §12.6 瞬态)
        if (editor.getActiveControlId() !== null) {
          editor.deactivateControl()
        }
      }
    }
  }, [editorRef])

  // 字数统计 + 段落样式 + 大纲 — 订阅 contentChange 事件
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const update = () => {
      const wc = editor.getWordCount()
      setWordCount(wc.words)
      setPageCount(editor.getDraw().getPages().length)

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
              if (n.type === 'paragraph' && (n as { children?: readonly string[] }).children?.includes(item.nodeId)) {
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
    store.setCursor({
      paragraphPath: item.paragraphPath,
      offset: 0, visible: true,
    })
    store.setSelection({
      anchor: { paragraphPath: item.paragraphPath, offset: 0, visible: false },
      focus: { paragraphPath: item.paragraphPath, offset: 0, visible: false },
      active: false, granularity: 'character',
    })
    setActiveOutlineId(item.id)

    // 滚动到目标页面 — 按累加高度 (含分页间隙) 计算 scrollTop
    const pages = editor.getDraw().getPages()
    if (pages.length > 0 && item.pageIndex >= 0 && item.pageIndex < pages.length) {
      const gap = editor.getDraw().getPageVerticalGap()
      let acc = 0
      for (let i = 0; i < item.pageIndex; i++) acc += pages[i].height + gap
      container.scrollTop = acc * editor.getDraw().getCoordinateSystem().transform.scale
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
      const ed = editorRef.current
      if (!ed) return

      // 外部模板 JSON → TemplateImporter (契约 §12.2)。以顶层 `document` 字段
      // 为锚点判别, 与引擎自身序列化格式 (type=document + body) 无损区分。
      const trimmed = text.trim()
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(text)
          if (isExternalTemplate(parsed)) {
            const result = templateImporter.import(parsed)
            ed.setDocument(result.doc, result.nodes, {
              templateDefinitions: result.templateDefinitions,
              presentationStyles: result.presentationStyles,
            })
            return
          }
        } catch { /* 非 JSON → 回落 registry */ }
      }

      const result = documentLoaderRegistry.load(text, file.name)
      if (result?.doc) {
        // 导入清理: 旧版控件向导会把控件库默认标签(如 '文本输入：')写进
        // templateDefinitions; 这里把「等于库默认标签」的 label 去掉, 避免导入后
        // 出现用户并不想要的多余标签文字 (契约 §12.1)。
        stripWidgetDefaultLabels(result.templateDefinitions)
        // 传入加载器展开的节点映射 + 设计期/表现层 store, 据此重建 NodePool
        // (契约 §12.1: templateDefinitions 必须随导入恢复, 否则控件丢失 controlType)
        ed.setDocument(result.doc, result.nodes, {
          templateDefinitions: result.templateDefinitions,
          presentationStyles: result.presentationStyles,
        })
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
      store.setCursor({ paragraphPath: r.paragraphPath, offset: r.endOffset, visible: true })
      store.setSelection({ anchor: { paragraphPath: r.paragraphPath, offset: r.startOffset, visible: false }, focus: { paragraphPath: r.paragraphPath, offset: r.endOffset, visible: false }, active: true, granularity: 'character' })
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
    store.setCursor({ paragraphPath: r.paragraphPath, offset: r.endOffset, visible: true })
    store.setSelection({ anchor: { paragraphPath: r.paragraphPath, offset: r.startOffset, visible: false }, focus: { paragraphPath: r.paragraphPath, offset: r.endOffset, visible: false }, active: true, granularity: 'character' })
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
    store.setCursor({ paragraphPath: r.paragraphPath, offset: r.endOffset, visible: true })
    store.setSelection({ anchor: { paragraphPath: r.paragraphPath, offset: r.startOffset, visible: false }, focus: { paragraphPath: r.paragraphPath, offset: r.endOffset, visible: false }, active: true, granularity: 'character' })
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
    const editor = editorRef.current
    if (!editor) return
    const store = editor.getStore()
    store.setSaveStatus('saving')
    try {
      // 序列化含节点 payload 的完整 JSON 字符串 (后端 content 为 String 字段)
      const content = editor.getSerializedDocument()
      if (isNew) {
        const res = await documentApi.create({ title: editor.getDocumentTitle(), content })
        const newId = res.data.data?.id
        if (newId) navigate(`/editor/${newId}`, { replace: true })
        console.debug('[EditorPage] created:', newId)
      } else if (docId) {
        await documentApi.update(docId, { title: editor.getDocumentTitle(), content })
        console.debug('[EditorPage] updated:', docId)
      }
      store.setSaveStatus('saved')
      store.setDirty(false)
    } catch (err) {
      console.error('保存失败:', err)
      store.setSaveStatus('error')
    }
  }, [isNew, docId, editorRef])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // 无缝内联编辑: 焦点在控件 overlay 内 → 让原生控件处理 (Tab/退格/方向/
      // Ctrl+B/I 等不落到正文), 仅保留 Ctrl+S 保存。
      const target = e.target as HTMLElement | null
      if (target && target.closest('[data-ctl-overlay]')) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setFindReplaceOpen(true) }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') { e.preventDefault(); setFindReplaceOpen(true) }
      // Ctrl+Shift+8: 切换格式标记显示 (Word 兼容快捷键)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === '8') { e.preventDefault(); handleToggleInvisible() }
      // Ctrl+Shift+L: 快速切换无序列表 (Word 兼容)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') { e.preventDefault(); handleFormat('toggleBulletList') }
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
      // ESC: 取消格式刷 (setFormatPainterActive 内部同步 EditorStore)
      if (e.key === 'Escape') {
        const ed = editorRef.current
        if (ed?.isFormatPainterActive) { ed.setFormatPainterActive(false) }
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
      // 格式刷: 切换激活状态 (引擎内部处理样式复制+Zustand同步)
      case 'formatPainter':
        ed.setFormatPainterActive(!ed.isFormatPainterActive)
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
      case 'toggleBulletList': {
        // Ctrl+Shift+L: 快速切换无序列表
        const ps = ed.getParagraphStyle()
        if (ps?.listType === 'bullet') {
          ed.setParagraphStyle({ list: undefined, indent: undefined })
        } else {
          ed.setParagraphStyle({ list: { type: 'bullet', level: 1 } as unknown as import('@/engine').ListStyle, indent: 0 })
        }
        break
      }
      case 'unorderedList': {
        const ps = ed.getParagraphStyle()
        const turningOn = ps?.listType !== 'bullet'
        ed.setParagraphStyle({ list: turningOn ? { type: 'bullet', level: 1 } as unknown as import('@/engine').ListStyle : undefined, indent: turningOn ? 0 : undefined })
        break
      }
      case 'orderedList': {
        const ps = ed.getParagraphStyle()
        const turningOn = ps?.listType !== 'ordered'
        ed.setParagraphStyle({ list: turningOn ? { type: 'ordered', level: 1, numberStyle: 'decimal' } as unknown as import('@/engine').ListStyle : undefined, indent: turningOn ? 0 : undefined })
        break
      }
      case 'orderedListNumberStyle': {
        // 仅切换编号样式，保留列表类型和层级
        const ns = String(_value ?? 'decimal')
        const ps = ed.getParagraphStyle()
        ed.setParagraphStyle({ list: { type: 'ordered', level: ps?.listLevel ?? 1, numberStyle: ns } as unknown as import('@/engine').ListStyle })
        break
      }
      case 'continueNumbering': {
        const ps = ed.getParagraphStyle()
        if (ps?.listType === 'ordered') {
          const turningOn = !ps?.continueNumbering
          ed.setParagraphStyle({ list: { type: 'ordered', level: ps?.listLevel ?? 1, numberStyle: ps?.numberStyle ?? 'decimal', continueNumbering: turningOn } as unknown as import('@/engine').ListStyle })
        }
        break
      }
      case 'indent': {
        const ps = ed.getParagraphStyle()
        if (ps?.listType) {
          // 列表段落: 增加嵌套层级
          ed.adjustListLevel(1)
        } else {
          ed.adjustIndent(24)
        }
        break
      }
      case 'outdent': {
        const ps = ed.getParagraphStyle()
        if (ps?.listType) {
          // 列表段落: 减少嵌套层级 (level<1 时取消列表)
          ed.adjustListLevel(-1)
        } else {
          // 非列表: 清空段落块缩进 (首行缩进由「首行缩进」按钮单独清)
          ed.setParagraphStyle({ indent: 0 })
        }
        break
      }
      case 'firstLineIndent': {
        const ps = ed.getParagraphStyle()
        // 单按钮切换: 有首行缩进 → 清空; 无 → 设 2 字符(32px)
        ed.setParagraphStyle({ firstLineIndent: (ps?.firstLineIndent ?? 0) > 0 ? undefined : 32 })
        break
      }
      case 'lineHeight': ed.setParagraphStyle({ lineHeight: Number(_value ?? 1.5) }); break
      case 'spaceBefore': ed.setParagraphStyle({ spaceBefore: Number(_value ?? 0) }); break
      case 'spaceAfter': ed.setParagraphStyle({ spaceAfter: Number(_value ?? 0) }); break
      case 'letterSpacing': ed.toggleFormat({ letterSpacing: Number(_value ?? 0) }); break
      case 'mergeCells': ed.mergeSelectedCells(); break
      case 'splitCell': ed.splitSelectedCell(); break
      case 'insertRow': ed.insertTableRow(); break
      case 'deleteRow': ed.deleteTableRow(); break
      case 'insertColumn': ed.insertTableColumn(); break
      case 'deleteColumn': ed.deleteTableColumn(); break
      // 标题样式: outlineLevel 0=正文, 1-6=Heading
      case 'heading':
        ed.setParagraphStyle({ outlineLevel: Number(_value ?? 0) })
        break
      // 页眉页脚编辑模式切换
      case 'headerFooterEnter': {
        const section = _value as 'header' | 'footer'
        const isActive = ed.isHeaderFooterEditActive()
        const currentSection = ed.getHeaderFooterEditSection()

        if (isActive && currentSection === section) {
          // 已在编辑同一区域 → 关闭
          ed.setHeaderFooterEditActive(false)
        } else {
          // 激活或切换区域
          ed.setHeaderFooterEditActive(true, section)

          // 确保目标区域有段落 (无则创建)
          const doc = ed.getDocument()
          const targetIds = section === 'header' ? doc.header! : doc.footer!
          if (targetIds.length === 0) {
            ed.ensureHeaderFooterParagraph(section)
          }

          // 自动将光标定位到对应区域的第一个段落
          const firstParaId = targetIds[0]
          const store = ed.getStore()
          store.setCursor({
            paragraphPath: [doc.id, firstParaId],
            offset: 0,
            visible: true,
          })
          store.setSelection({
            anchor: { paragraphPath: [doc.id, firstParaId], offset: 0, visible: false },
            focus: { paragraphPath: [doc.id, firstParaId], offset: 0, visible: false },
            active: false,
            granularity: 'character',
          })
        }
        // 重布局以包含新创建的段落
        ed.getDraw().recomputeLayout(ed.getPool())
        ed.getDraw().render(ed.getPool(), ed.getStore().state.runtime)
        break
      }
      // 关闭页眉页脚编辑模式
      case 'headerFooterClose': ed.setHeaderFooterEditActive(false); break
      // 页眉页脚选项变更 (canonical = DocumentTree, 经 Command 系统)
      case 'headerFooterConfig':
        ed.setHeaderFooterConfig(_value as Partial<import('@/engine').HeaderFooterConfig>)
        break
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
      // 使用完整序列化 (含节点 payload), 再附加目录信息
      const serialized = JSON.parse(ed.getSerializedDocument()) as Record<string, unknown>
      // 导出清理: 未填标签(等于控件库默认值, 如 '文本输入：')不写入 JSON,
      // 与导入侧 stripWidgetDefaultLabels 对齐 (导入导出一致)。
      stripWidgetDefaultLabelsFromObject(serialized.templateDefinitions as Record<string, import('@/engine').TemplateDefinition> | undefined)
      serialized._toc = toc
      const json = JSON.stringify(serialized, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url; a.download = `document-${Date.now()}.json`; a.click()
      URL.revokeObjectURL(url)
    } else if (format === 'txt') {
      const lines: string[] = []
      // 有序列表编号计数器: 按 level 追踪
      const orderedCounters = new Map<number, number>()
      let lastListLevel = 0
      for (const paraId of doc.body.children) {
        const para = pool.nodes.get(paraId) as { children?: readonly string[]; list?: ListStyle } | undefined
        if (para?.children) {
          let line = ''
          // 列表标记
          if (para.list) {
            const level = para.list.level || 1
            // 非有序 → 重置计数器
            if (para.list.type !== 'ordered' || level !== lastListLevel) {
              if (lastListLevel > 0) orderedCounters.delete(lastListLevel)
            }
            lastListLevel = level
            if (para.list.type === 'ordered' && !para.list.startAt) {
              const count = (orderedCounters.get(level) || 0) + 1
              orderedCounters.set(level, count)
              line += getListMarker(para.list, count)
            } else {
              if (para.list.startAt) {
                orderedCounters.set(level, para.list.startAt)
              }
              line += getListMarker(para.list)
            }
          } else {
            lastListLevel = 0
          }
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
      const result: string[] = ['<!DOCTYPE html><html><head><meta charset="utf-8"><title>', doc.title, '</title></head><body>']
      const orderedCounters = new Map<number, number>()
      let inListType = ''       // 'bullet' | 'ordered' | ''
      let inListLevel = 0

      const flushList = () => {
        if (inListType) { result.push(inListType === 'ordered' ? '</ol>' : '</ul>'); inListType = ''; inListLevel = 0 }
      }

      for (const paraId of doc.body.children) {
        const para = pool.nodes.get(paraId) as { children?: readonly string[]; outlineLevel?: number; alignment?: string; list?: ListStyle } | undefined
        if (!para?.children) continue

        // 收集段落文本
        let text = ''
        let bold = false; let italic = false; let underline = false
        const fragments: string[] = []
        const flushText = () => {
          if (!text) return
          let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          if (bold) html = `<strong>${html}</strong>`
          if (italic) html = `<em>${html}</em>`
          if (underline) html = `<u>${html}</u>`
          fragments.push(html)
          text = ''
        }
        for (const childId of para.children) {
          const node = pool.nodes.get(childId) as { text?: string; type?: string; bold?: boolean; italic?: boolean; underline?: boolean } | undefined
          if (node?.type === 'text') {
            if (node.bold !== bold || node.italic !== italic || node.underline !== underline) {
              flushText()
              bold = !!node.bold; italic = !!node.italic; underline = !!node.underline
            }
            text += (node.text || '')
          }
        }
        flushText()
        const htmlText = fragments.join('')

        if (para.list) {
          const listType = para.list.type
          const level = para.list.level || 1

          // 列表类型或层级变化 → 刷新旧列表, 开新列表
          if (inListType !== listType || inListLevel !== level) {
            flushList()
            inListType = listType; inListLevel = level
            orderedCounters.clear()
            result.push(listType === 'ordered' ? '<ol>' : '<ul>')
          }

          // 生成标记
          let marker = ''
          if (listType === 'ordered' && !para.list.startAt) {
            const count = (orderedCounters.get(level) || 0) + 1
            orderedCounters.set(level, count)
            marker = getListMarker(para.list, count)
          } else {
            if (para.list.startAt) orderedCounters.set(level, para.list.startAt)
            marker = getListMarker(para.list)
          }

          result.push(`<li>${marker}${htmlText}</li>`)
        } else {
          flushList()
          if (htmlText) result.push(`<p>${htmlText}</p>`)
        }
      }
      flushList()
      result.push('</body></html>')
      const blob = new Blob([result.join('\n')], { type: 'text/html' })
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
        stripWidgetDefaultLabelsFromObject((doc as { templateDefinitions?: Record<string, import('@/engine').TemplateDefinition> }).templateDefinitions)
        ed.setDocument(doc)
      }
    } catch (err) {
      console.error('加载模板失败:', err)
    }
  }, [editorRef])

  // 从后端加载模板列表
  useEffect(() => {
    templateApi.list().then(res => {
      const items = res.data.data || []
      setTemplates([{ name: '医疗文书', items: items.map((t: { id: string; name: string; description?: string }) => ({ id: t.id, name: t.name, description: t.description })) }])
    }).catch(() => { /* 加载失败, 保持空列表 */ })
  }, [])

  return (
    <ReadingModeOverlay active={readingMode} onToggle={() => handleEditorModeChange('edit')}>
    <EditorLayout
      readingMode={readingMode}
      mode={editorMode}
      onModeChange={handleEditorModeChange}
      onSave={handleSave}
      onImportDocument={() => docFileInputRef.current?.click()}
      onDocumentProperties={() => setDocumentPropertiesOpen(true)}
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
        // 表单控件 3 类向导 (契约 §12.7): 打开对应配置弹框, 确定后再插到光标
        if (type === 'textInput' || type === 'radio' || type === 'checkbox') {
          setControlWizard({ open: true, kind: type })
          return
        }
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
      <div
        ref={containerRef}
        className="flex-1 bg-[#E5E7EB] relative overflow-y-auto overflow-x-hidden"
        style={{ minHeight: '400px' }}
        onContextMenu={contextMenu.onContextMenu}
      />
      <DesignControlTooltip />
      <RuntimeControlOverlay canvasContainerRef={containerRef} />
      <ContextMenu
        open={contextMenu.open}
        x={contextMenu.x}
        y={contextMenu.y}
        entries={contextMenu.entries}
        onClose={contextMenu.close}
        onAction={contextMenu.runAction}
      />
      <DesignControlPalette />
      <DesignControlProperties />
      {/* 通用控件向导 (工具栏 3 类, create) — 契约 §12.7 */}
      {controlWizard.open && controlWizard.kind === 'textInput' ? (
        <ControlInputDialog
          open
          mode="create"
          initial={initialConfigForCreate('textInput')}
          onClose={() => setControlWizard({ open: false, kind: controlWizard.kind })}
          onApply={applyWizardResult}
        />
      ) : controlWizard.open ? (
        <ControlChoiceDialog
          open
          mode="create"
          initial={initialConfigForCreate(controlWizard.kind)}
          onClose={() => setControlWizard({ open: false, kind: controlWizard.kind })}
          onApply={applyWizardResult}
        />
      ) : null}
      {/* 设计模式右键「属性」(edit) — 以命中控件为目标, 按家族开弹框 */}
      {controlEdit.open && (() => {
        const ed = editorRef.current
        if (!ed) return null
        const node = ed.getPool()?.nodes.get(controlEdit.nodeId) as { type?: string; element?: ElementMeta } | undefined
        if (!node || node.type !== 'smarttext' || !node.element) return null
        const definition = ed.getControlDefinition(controlEdit.nodeId)
        const family = controlFamilyOf(node.element, definition)
        const initial = { element: node.element, definition }
        return family === 'choice' ? (
          <ControlChoiceDialog open mode="edit" initial={initial} onClose={closeControlEdit} onApply={applyControlEdit} />
        ) : (
          <ControlInputDialog open mode="edit" initial={initial} onClose={closeControlEdit} onApply={applyControlEdit} />
        )
      })()}
      <DocumentPropertiesDialog
        open={documentPropertiesOpen}
        onClose={() => setDocumentPropertiesOpen(false)}
        initialTitle={(() => { const ed = editorRef.current; return ed ? ed.getDocumentTitle() : undefined })()}
        initialValues={(() => { const ed = editorRef.current; return ed ? ed.getDocumentMetadata() : undefined })()}
        onApply={({ title, metadata }) => {
          const ed = editorRef.current
          if (ed) ed.applyDocumentProperties(title, metadata)
        }}
      />
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

// ---- 设计模式控件悬浮提示 (契约 §12.3 tips 消费点) ----

function DesignControlTooltip() {
  const editorRef = useEditorRef()
  const mode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const hoveredId = useEditorStoreSnapshot((s) => s.designHoveredControlId)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  // 仅设计模式跟踪鼠标位置 (tooltip 跟随光标), 非设计模式清空
  useEffect(() => {
    if (mode !== 'design') { setPos(null); return }
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [mode])

  const tip = hoveredId ? editorRef.current?.getTip(hoveredId) : undefined
  if (mode !== 'design' || !hoveredId || !tip || !pos) return null

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-xs rounded-md bg-gray-900/95 px-2.5 py-1.5 text-xs text-white shadow-lg"
      style={{ left: pos.x + 14, top: pos.y + 14 }}
    >
      {tip}
    </div>
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
