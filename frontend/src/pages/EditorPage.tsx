// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 编辑器主页面 (ModelD)
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from '@/i18n/useTranslation'
import { EditorLayout } from '@/components/layout/EditorLayout'
import { ReadingModeOverlay } from '@/components/views/ReadingMode'
import { DesignControlPalette } from '@/components/views/DesignControlPalette'
import { DesignControlProperties } from '@/components/views/DesignControlProperties'
import { EditorProvider, useEditorRef, useEditorReady, useEditorStoreSnapshot } from '@/components/editor/EditorProvider'
import { RuntimeControlOverlay } from '@/components/editor/RuntimeControlOverlay'
import { TableGrowOverlay } from '@/components/editor/TableGrowOverlay'
import { SectionStructureOverlay } from '@/components/editor/SectionStructureOverlay'
import { stripWidgetDefaultLabels, stripWidgetDefaultLabelsFromObject } from '@/platform/data/controlLibrary'
import { useEditorContextMenu } from '@/components/editor/useEditorContextMenu'
import { ContextMenu } from '@/components/editor/ContextMenu'
import { ExportDialog } from '@/components/dialogs/ExportDialog'
import { FindReplaceDialog } from '@/components/dialogs/FindReplaceDialog'
import { PrintDialog } from '@/components/dialogs/PrintDialog'
import { PageSetupDialog } from '@/components/dialogs/PageSetupDialog'
import { WatermarkDialog } from '@/components/dialogs/WatermarkDialog'
import { addRecentDocument } from '@/components/sidebar/RecentDocuments'
import { PrintPreviewDialog } from '@/components/dialogs/PrintPreviewDialog'
import { PerfPanel } from '@/components/panels/PerfPanel'
import { PasteSpecialDialog, type PasteFormat } from '@/components/dialogs/PasteSpecialDialog'
import { BookmarkDialog } from '@/components/dialogs/BookmarkDialog'
import { SectionCodeDialog } from '@/components/dialogs/SectionCodeDialog'
import { CompletenessDialog } from '@/components/dialogs/CompletenessDialog'
import { DocumentPropertiesDialog } from '@/components/dialogs/DocumentPropertiesDialog'
import { ControlInputDialog } from '@/components/dialogs/ControlInputDialog'
import { ControlChoiceDialog } from '@/components/dialogs/ControlChoiceDialog'
import { initialConfigForCreate, controlFamilyOf } from '@/components/dialogs/controlConfigShared'
import type { ControlConfigData, ReferenceKey } from '@/components/dialogs/controlConfigShared'
import { documentApi, templateApi } from '@/services/api'
import { printHistory } from '@/services/PrintHistoryService'
import { resolvePrintRange, selectPrintPages, buildPrintRecord, printDocKey } from '@emrde/document-engine/export'
import { getMockDocumentDetail } from '@/mocks/documents'
import { documentLoaderRegistry } from '@emrde/document-engine'
import { templateImporter, isExternalTemplate, hfParagraphsForPage, reportError, EditorErrorCode, locale, sectionTreeOf, resolveFieldText } from '@emrde/document-engine'
import { TOCGenerator } from '@emrde/document-engine'
import { buildExportHtml, buildExportText } from '@emrde/document-engine/export'
import { collectFields } from '@emrde/document-engine/export'
import { buildElementsDocument } from '@emrde/document-engine/export'
import { buildCdaXml } from '@emrde/document-engine/export'
import { buildOfd } from '@emrde/document-engine/export'
import { cumulativeCharWidths } from '@emrde/document-engine'
import {
  provenanceMetaTags, provenanceRecord, stampExportHtml, stampExportObject, stampExportText, stampExportXml,
} from '@emrde/document-engine/export'
import type { OutlineItem, SectionOutlineAction } from '@/components/sidebar/OutlineNav'
import { buildOutlineItems } from '@/components/sidebar/outlineModel'
import type { EditorMode, ScoreResult, WatermarkConfig, PerfSummary } from '@emrde/document-engine'
import type { QCIssue, QCResult } from '@emrde/document-engine'
import type { MissingField } from '@emrde/document-engine'
import type { CalcResult } from '@emrde/document-engine'

/**
 * 触发一次下载 (Blob → object URL → 隐藏 <a> 点击 → 释放)。
 *
 * 只给**新增**的导出分支用: 既有的 json/txt/html 三条分支保持各自原样的内联
 * 写法不动 —— 那条路径已在浏览器里跑通, 不该为了整齐而在本轮被改写。
 */
function downloadBlob(payload: string | Uint8Array, mime: string, ext: string): void {
  const blob = new Blob([payload as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = window.document.createElement('a')
  a.href = url; a.download = `document-${Date.now()}.${ext}`; a.click()
  URL.revokeObjectURL(url)
}

/**
 * 收集文档里图片节点的运行期资源 (ImageNode.src, data URL)。
 *
 * 走**结构树** (池里的 children) 而不是阅读顺序: 我们只是在做一次全池扫描,
 * 与遍历口径无关 (契约 §31.1 的判据是「按不按阅读顺序读」, 这里不读顺序)。
 * SLIFItem.imageUrl 是声明了但布局从不填充的死字段, 不能用。
 */
function collectImageSources(pool: { nodes: ReadonlyMap<string, unknown> }): Map<string, string> {
  const out = new Map<string, string>()
  for (const [id, node] of pool.nodes) {
    const n = node as { type?: string; src?: string }
    if (n.type === 'image' && typeof n.src === 'string' && n.src) out.set(id, n.src)
  }
  return out
}

/** 质控防抖窗口 —— 质控比字数统计贵得多, 不该跟着每次按键跑 */
const QC_DEBOUNCE_MS = 600

/**
 * 把已渲染的页面图交给浏览器打印 (开新窗口 + w.print())。
 * 打印与打印预览共用同一条输出路径 —— 预览后点打印看到的就是这里的结果。
 *
 * 注: 这个函数**不在 React 渲染树里** (在文件模块层), 用 module-level t() 拿当前
 * 语言 —— 浏览器打印 HTML <title> 必须用 string literal, 不支持动态语言;
 * 这里我们读一次并缓存, 用户切语言后下一次开打印窗口就会用新语言 (开新窗口
 * 触发新函数执行)。
 */
function openPrintWindow(pageImages: string[]): void {
  if (pageImages.length === 0) return
  const title = locale.t('editorPage.printingTitle')
  const w = window.open('', '_blank', `width=${screen.width},height=${screen.height}`)
  if (!w) return
  w.document.write(`<html><head><title>${title}</title>${provenanceMetaTags()}<style>`)
  w.document.write('@page{size:A4;margin:0}body{margin:0;display:flex;flex-direction:column;align-items:center}')
  w.document.write('img{width:210mm;height:auto;page-break-after:always}img:last-child{page-break-after:auto}')
  w.document.write('</style></head><body>')
  for (const url of pageImages) {
    w.document.write(`<img src="${url}" />`)
  }
  w.document.write('</body></html>')
  w.document.close()
  setTimeout(() => { w.print(); w.close() }, 300)
}

/**
 * 控件配置弹框要的两件事 —— **同一次** `getBoundValues()` 快照得出的两个视图。
 *
 * 一份投影两处用 (撞键提示 + 公式的可引用键清单), 而不是各建一份: 两份清单必然
 * 漂移, 而且会漂移成"UI 说能引用、求值说歧义"这种最难查的形态 (契约 §12.12.9)。
 */
interface KeyFacts {
  /** 各键被**其他**控件占用的次数 (撞键提示用, 已按 excludeNodeId 排除自身) */
  usage: Map<string, number>
  /** 可引用的键去重清单 (公式「计算」tab 用) */
  refs: ReferenceKey[]
}

export default function EditorPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [loadedDoc, setLoadedDoc] = useState<unknown>(undefined)
  const [loading, setLoading] = useState(false)
  const isNew = !id || id === 'new'

  // 直接从内置 Mock 加载文档 (非新建时); 后端加载逻辑暂时不动 (见 src/mocks/documents.ts)
  useEffect(() => {
    if (isNew) return
    setLoading(true)
    Promise.resolve(getMockDocumentDetail(id!))
      .then(detail => {
        // 无匹配 mock (或该条目无正文) → 保持原有空文档行为
        if (!detail?.content) return
        try {
          const parsed = JSON.parse(detail.content)
          // 打开旧文档同样清理库默认标签 (与导入/导出一致)
          stripWidgetDefaultLabelsFromObject((parsed as { templateDefinitions?: Record<string, import('@emrde/document-engine').TemplateDefinition> }).templateDefinitions)
          setLoadedDoc(parsed)
          // 记入最近文档 (首页 RecentDocuments 的数据源; localStorage 持久化)
          addRecentDocument({ id: id!, title: detail.title, lastOpenedAt: Date.now() })
        } catch { /* 忽略解析错误 */ }
      })
      .finally(() => setLoading(false))
  }, [id]) // eslint-disable-line

  if (loading) {
    return <div className="h-full flex items-center justify-center"><div className="text-chrome-ink-muted">{t('editorPage.loading')}</div></div>
  }

  return (
    <EditorProvider containerRef={containerRef} document={loadedDoc as import('@emrde/document-engine').DocumentTree | undefined}>
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
  const { t } = useTranslation()

  // ---- 控件配置弹框 (契约 §12.7): 向导 (create) + 右键属性 (edit) ----
  type WizardKind = 'textInput' | 'radio' | 'checkbox'
  const [controlWizard, setControlWizard] = useState<{ open: boolean; kind: WizardKind }>({ open: false, kind: 'textInput' })
  const [controlEdit, setControlEdit] = useState<{ open: boolean; nodeId: string }>({ open: false, nodeId: '' })
  /**
   * 各绑定键被**其他**控件占用的次数 (契约 §12.10.1) — 供控件配置弹框的撞键提示;
   * 同一份快照再给出公式「计算」tab 的可引用键清单 (§12.12.9)。
   *
   * 排除 excludeNodeId 是有意的: 提示要回答的是「改完之后会跟谁撞」, 不是「现在
   * 跟谁撞」。既然自身被排除, 判定就只有一条规则 —— others >= 1 即撞 (弹框里
   * 展示的 n 再 +1 把自己算回去)。
   *
   * 空键 (无身份的控件) 不计入: 它们既不为绑定服务, 也不该在输入框里被"撞中"。
   * 可引用键清单同样跳过空键 —— 它无法被引用, 正是 §12.12.3 的"未找到"。
   */
  const keyFactsOf = useCallback((excludeNodeId?: string): KeyFacts => {
    const usage = new Map<string, number>()
    const ed = editorRef.current
    if (!ed) return { usage, refs: [] }
    const projection = ed.getBoundValues()
    for (const item of projection.items) {
      if (item.key === '') continue
      if (excludeNodeId !== undefined && item.nodeId === excludeNodeId) continue
      usage.set(item.key, (usage.get(item.key) ?? 0) + 1)
    }
    // 可引用键: 投影里有身份的键去重。撞键的标出来 —— 公式引用它必报歧义 (§12.12.3),
    // 而"哪些键撞了"直接取投影自己的 duplicates, 不在这里再数一遍 (两份必然漂移)。
    const dupKeys = new Set(projection.duplicates.map((d) => d.key))
    const seen = new Set<string>()
    const refs: ReferenceKey[] = []
    for (const item of projection.items) {
      if (item.key === '' || seen.has(item.key)) continue
      seen.add(item.key)
      refs.push({ key: item.key, name: item.name, ambiguous: dupKeys.has(item.key) })
    }
    return { usage, refs }
  }, [editorRef])

  /** 撞键提示 + 可引用键的文档快照 — 打开弹框时取一次 (见 keyFactsOf) */
  const [controlKeyFacts, setControlKeyFacts] = useState<KeyFacts>({ usage: new Map(), refs: [] })

  const openControlEdit = useCallback((controlId: string) => {
    setControlKeyFacts(keyFactsOf(controlId))
    setControlEdit({ open: true, nodeId: controlId })
  }, [keyFactsOf])

  /**
   * 公式试算 (§12.12.9) —— 弹框不碰 evaluation/ 内部, 唯一入口是 Editor.evaluateFormula。
   *
   * `forNodeId` 传正在编辑的控件: 试算它的新公式时, 引用它自己的键读的是**原始值**
   * 而不是它当前算出来的结果 (否则像在照镜子)。
   */
  const previewFormula = useCallback((formula: string, forNodeId?: string): CalcResult => {
    const ed = editorRef.current
    // 兜底只为满足类型: 该 message 不会出现在界面上 (作者化面按**错误码**渲染文案)
    if (!ed) return { ok: false, error: { code: 'syntax', message: 'editor not ready' } }
    return ed.evaluateFormula(formula, forNodeId)
  }, [editorRef])
  const previewForCreate = useCallback((f: string) => previewFormula(f), [previewFormula])
  const previewForEdit = useCallback(
    (f: string) => previewFormula(f, controlEdit.nodeId),
    [previewFormula, controlEdit.nodeId],
  )
  // 通用菜单只发 'properties' id; 弹框映射在设计态业务层这里完成 (契约 §12.7)。
  // 节代码对话框 (单字段): 记录目标节 id, 打开时从引擎读当前值
  const [sectionCodeTarget, setSectionCodeTarget] = useState<{ open: boolean; sectionId: string }>(
    { open: false, sectionId: '' },
  )
  const contextMenu = useEditorContextMenu({
    onProperty: openControlEdit,
    onEditSectionCode: (sectionId) => setSectionCodeTarget({ open: true, sectionId }),
  })

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
  /** 质控结果 (契约 §12.2) — 只读派生, null = 尚未检查 */
  const [qcResult, setQcResult] = useState<QCResult | null>(null)
  /**
   * 保存前的必填未填确认框 (契约 §12.11)。missing 是**弹框打开那一刻**的快照:
   * 弹框期间用户可能已经填了几个, 但"缺哪些"以本次保存的判定为准 —— 用户选
   * "仍然保存"后不再重新判定 (避免"越填越弹")。
   */
  const [completeness, setCompleteness] = useState<{ open: boolean; missing: MissingField[] }>(
    { open: false, missing: [] },
  )

  /** 打印预览的页面图 (null = 未打开预览) */
  const [printPages, setPrintPages] = useState<string[] | null>(null)
  const [previewPage, setPreviewPage] = useState(0)
  /** 引擎性能汇总 (PerformanceMetrics.summarize) — 供 PerfPanel 显示 */
  const [perfSummary, setPerfSummary] = useState<PerfSummary | null>(null)
  /**
   * 水印对话框初值 —— 必须**开时快照进 state**, 不能每次 render 现算:
   * 现算会给出新对象引用, 而对话框的 `useEffect([open, initialConfig])`
   * 每次引用变化都会重置草稿, 把用户正在改的字段冲掉。
   */
  const [watermarkOpen, setWatermarkOpen] = useState(false)
  const [watermarkInitial, setWatermarkInitial] = useState<WatermarkConfig | undefined>(undefined)
  const [pasteSpecialOpen, setPasteSpecialOpen] = useState(false)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [documentPropertiesOpen, setDocumentPropertiesOpen] = useState(false)
  const [tableInsertOpen, setTableInsertOpen] = useState(false)
  const [wordCount, setWordCount] = useState(0)
  /** 控件量表评分 (契约 §12.6.2 layer E) — 只读派生, 随 contentChange 重算 */
  const [scaleScore, setScaleScore] = useState<ScoreResult | null>(null)
  const [pageCount, setPageCount] = useState(1)
  // 打印历史 (PrintHistoryService): 仅在对话框打开时读, 免得每次重渲染都摸 localStorage
  const printHistoryForDoc = useMemo(
    () => (printOpen ? printHistory.getByDocument(printDocKey(docId)) : []),
    [printOpen, docId],
  )
  // 续打断点: 上一次没打到末页 → 提示从下一页继续
  const printResumeFrom = useMemo(() => {
    if (!printOpen) return null
    const rec = printHistory.findResumePoint(printDocKey(docId))
    const last = rec?.lastCompletedPage
    return last != null && last < pageCount ? last + 1 : null
    // pageCount 变化时要重算 (文档变长后断点可能已不再是"未打完")
  }, [printOpen, docId, pageCount])
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [findMatchCount, setFindMatchCount] = useState(0)
  const [findMatchIndex, setFindMatchIndex] = useState(-1)
  const findResultsRef = useRef<import('@emrde/document-engine').MatchResult[]>([])
  const zoom = useEditorStoreSnapshot((s) => s.runtime.view.scale)
  const showInvisible = useEditorStoreSnapshot((s) => s.runtime.view.showInvisible)
  const showSectionStructure = useEditorStoreSnapshot((s) => s.runtime.view.showSectionStructure)
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

  /**
   * 节结构显示开关 (契约 §31.14) —— 只写 store (叠加层订阅它)。
   * 刻意**不调 draw.render**: Canvas 永远不画节结构, 这正是"不影响分页"的保证。
   */
  const handleToggleSectionStructure = useCallback(() => {
    const ed = editorRef.current
    if (ed) ed.setShowSectionStructure(!ed.getShowSectionStructure())
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
    // 必须等 ready: EditorPageInner 是 EditorProvider 的**子组件**, 子 effect
    // 先于父 effect 执行, 此刻 editorRef.current 仍为 null。少了 !ready 守卫,
    // 这个 effect 会在 mount 时静默 return 且再不重跑 (editorRef 是稳定引用) ——
    // 字数/大纲/量表分会永远停在初始值。与下方滚动同步 effect 同一坑。
    if (!ready || !editor) return
    const update = () => {
      const wc = editor.getWordCount()
      setWordCount(wc.words)
      setPageCount(editor.getDraw().getPages().length)
      // 量表评分 (§12.6.2 layer E): 只读派生, 与字数同频重算, 不产生命令
      setScaleScore(editor.computeControlScore())
      // 性能汇总 (原先 PerformanceMetrics 只写不读, getPerfMetrics 零调用)
      setPerfSummary(editor.getPerfMetrics()?.summarize() ?? null)

      // 大纲: outlineLevel > 0 的标题段落 + **没有标题段的节**占位条目
      // (契约 §31.10)。节与标题正交: 有标题的节由标题代表, 无标题的节 (含空节)
      // 否则在大纲里完全不可见 —— 用户看不出"既往史节还在"。
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

      // 大纲投影 (纯函数, 见 components/sidebar/outlineModel.ts):
      // 真结构树前序 → 节行在其内容之前, 嵌套节按 depth 缩进, 空节不再把
      // Section id 写进段落槽。标题文本/级别/页码复用 TOCGenerator。
      setOutlineItems(buildOutlineItems(
        doc,
        pool as unknown as Parameters<typeof buildOutlineItems>[1],
        paraPageMap,
        { anonymousSectionLabel: locale.t('outline.sectionFallback') },
      ))
    }
    editor.on('contentChange', update)
    update() // 初始计算
    return () => { editor.off('contentChange', update) }
  }, [ready, editorRef])

  /**
   * 质控: contentChange 后**防抖**重算 (契约 §12.2)。
   *
   * 单独一个 effect 承载自己的防抖与清理 —— 与字数/大纲虽同频但语义独立,
   * 且质控比字数贵得多, 不该跟着每次按键跑。首次挂载立即算一次, 避免面板
   * 空着等用户先敲一下。
   */
  useEffect(() => {
    const editor = editorRef.current
    if (!ready || !editor) return          // 同上: 必须等 EditorProvider 就绪
    let timer: number | undefined
    const run = () => setQcResult(editor.runQC())
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(run, QC_DEBOUNCE_MS)
    }
    editor.on('contentChange', schedule)
    run()
    return () => {
      editor.off('contentChange', schedule)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [ready, editorRef])

  /** 光标定位到指定位置并滚动使其可见 —— 质控问题与批注跳转共用同一机制 */
  const revealLocation = useCallback((path: string[], offset: number) => {
    const editor = editorRef.current
    const container = containerRef.current
    if (!editor || path.length === 0) return

    editor.collapseSelectionToPoint(path, offset)
    const rect = editor.getCaretClientRect()
    if (rect && container) {
      const cRect = container.getBoundingClientRect()
      const bottom = rect.top + rect.height
      const TOP_INSET = 80
      const BOTTOM_INSET = 40
      if (rect.top < cRect.top + TOP_INSET) {
        container.scrollTop -= (cRect.top + TOP_INSET - rect.top)
      } else if (bottom > cRect.bottom - BOTTOM_INSET) {
        container.scrollTop += (bottom - (cRect.bottom - BOTTOM_INSET))
      }
    }
    editor.focus()
  }, [editorRef, containerRef])

  /** 质控问题跳转 (契约 §12.2) */
  const handleQcIssueClick = useCallback((issue: QCIssue) => {
    if (issue.paragraphPath) revealLocation(issue.paragraphPath, 0)
  }, [revealLocation])

  /** 批注条目跳转 (此前该回调未接线, 点批注无反应) */
  const handleSelectCommentThread = useCallback((threadId: string) => {
    const thread = (editorRef.current?.getComments() ?? []).find((t) => t.id === threadId)
    if (thread) revealLocation(thread.rangeStart.path, thread.rangeStart.offset)
  }, [editorRef, revealLocation])

  /** 大纲点击: 跳转光标到目标段落 + 滚动到对应页面 */
  const handleOutlineClick = useCallback((item: OutlineItem) => {
    const editor = editorRef.current
    const container = containerRef.current
    if (!editor || !container) return

    const store = editor.getStore()

    if (item.kind === 'section' && item.sectionId) {
      // 节行: 选中该节 (Editor.selectSection 负责落光标 + 折叠选区 + 写 id)。
      // 空节没有段落 → paragraphPath 为空, **绝不**把节 id 当段落写进去
      // (那会造出 CursorState 解析不出的非法路径, 光标画不出来也不滚动)。
      editor.selectSection(item.sectionId)
      setActiveOutlineId(item.id)
      const rects = editor.getSectionClientRects(item.sectionId)
      const pageIndex = rects[0]?.pageIndex ?? -1
      if (pageIndex >= 0) {
        const pages = editor.getDraw().getPages()
        if (pageIndex < pages.length) {
          const gap = editor.getDraw().getPageVerticalGap()
          let acc = 0
          for (let i = 0; i < pageIndex; i++) acc += pages[i].height + gap
          container.scrollTop = acc * editor.getDraw().getCoordinateSystem().transform.scale
        }
      }
      return
    }

    // 标题行: 光标到目标段落开头
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

  /**
   * 大纲节行操作 → Editor 门面 (契约 §31.14)。全部经 Command, 不在此改文档。
   * 'insertAfter' / 'insertChild' 是「插入节」的两个落位:
   *   之后 = 与选中节同级, 紧随其后; 子节 = 落在选中节内部末尾。
   */
  const handleSectionOutlineAction = useCallback((action: SectionOutlineAction, item: OutlineItem) => {
    const editor = editorRef.current
    const sectionId = item.sectionId
    if (!editor || !sectionId) return
    switch (action) {
      case 'up': editor.moveSectionUp(sectionId); break
      case 'down': editor.moveSectionDown(sectionId); break
      case 'insertAfter': editor.insertSection({ afterBlockId: sectionId }); break
      case 'insertChild': editor.insertChildSection(sectionId); break
      case 'editCode': setSectionCodeTarget({ open: true, sectionId }); break
      case 'delete': editor.deleteNode(sectionId); break
    }
  }, [editorRef])

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

      try {
        const result = documentLoaderRegistry.load(text, file.name)
        if (!result?.doc) {
          // 没有 loader 认领这个格式。原先这里是**静默 return**: 用户点了导入却
          // 什么都没发生, 分不清是"格式不支持"还是"程序坏了"。
          reportError({
            code: EditorErrorCode.E_DOCUMENT_CORRUPTED,
            message: locale.t('editorPage.importUnknownFormat', { name: file.name }),
          })
          return
        }
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
      } catch (err) {
        // registry 现在对"认领了但读不动"**会抛**(不再吞成 null), 所以这里能拿到
        // 真实原因; 这一处不接的话异常会从 reader.onload 冒出去, 用户侧毫无反馈。
        reportError({
          code: EditorErrorCode.E_DOCUMENT_CORRUPTED,
          message: locale.t('editorPage.importError', { msg: err instanceof Error ? err.message : String(err) }),
          cause: err,
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

  /** 真正落盘 (不带闸门) —— Ctrl+S / 工具栏 / 确认框的"仍然保存"共用同一条路径 */
  const performSave = useCallback(async () => {
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
  }, [isNew, docId, editorRef, navigate])

  /**
   * 保存入口 (契约 §12.11): 先过完整性闸门, **再**落盘。
   *
   * 闸门**不硬拦** —— 缺必填项时弹确认框列出未填项 (可点击跳转), 三个出口:
   * 跳到第一处 / 仍然保存 / 取消。理由是临床工作流: 医生要中途存草稿时硬拦会
   * 丢工作, 而"存了一份不全的病历"至少是**可见**的 (确认框明说了缺什么)。
   *
   * 引擎只判定 (Editor.validateRequired), 拦不拦是本组件的事 —— 保存的所有权
   * 在应用侧, 引擎不拥有保存 (§12.11)。
   */
  const handleSave = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const { ok, missing } = editor.validateRequired()
    if (!ok) {
      setCompleteness({ open: true, missing })
      return
    }
    await performSave()
  }, [editorRef, performSave])

  /** 确认框"仍然保存" — 用户已看过缺项并明确选择继续 */
  const handleSaveAnyway = useCallback(async () => {
    setCompleteness({ open: false, missing: [] })
    await performSave()
  }, [performSave])

  /** 确认框条目跳转 — 与质控问题/批注共用 revealLocation, 不另写一套定位 */
  const handleMissingJump = useCallback((field: MissingField) => {
    revealLocation(field.paragraphPath, 0)
    setCompleteness({ open: false, missing: [] })
  }, [revealLocation])

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
      case 'highlight': ed.toggleFormat({ highlight: _value === 'transparent' ? undefined : String(_value ?? '#FFFF00') } as Partial<import('@emrde/document-engine').TextStyle>); break
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
          ed.setParagraphStyle({ list: { type: 'bullet', level: 1 } as unknown as import('@emrde/document-engine').ListStyle, indent: 0 })
        }
        break
      }
      case 'unorderedList': {
        const ps = ed.getParagraphStyle()
        const turningOn = ps?.listType !== 'bullet'
        ed.setParagraphStyle({ list: turningOn ? { type: 'bullet', level: 1 } as unknown as import('@emrde/document-engine').ListStyle : undefined, indent: turningOn ? 0 : undefined })
        break
      }
      case 'orderedList': {
        const ps = ed.getParagraphStyle()
        const turningOn = ps?.listType !== 'ordered'
        ed.setParagraphStyle({ list: turningOn ? { type: 'ordered', level: 1, numberStyle: 'decimal' } as unknown as import('@emrde/document-engine').ListStyle : undefined, indent: turningOn ? 0 : undefined })
        break
      }
      case 'orderedListNumberStyle': {
        // 仅切换编号样式，保留列表类型和层级
        const ns = String(_value ?? 'decimal')
        const ps = ed.getParagraphStyle()
        ed.setParagraphStyle({ list: { type: 'ordered', level: ps?.listLevel ?? 1, numberStyle: ns } as unknown as import('@emrde/document-engine').ListStyle })
        break
      }
      case 'continueNumbering': {
        const ps = ed.getParagraphStyle()
        if (ps?.listType === 'ordered') {
          const turningOn = !ps?.continueNumbering
          ed.setParagraphStyle({ list: { type: 'ordered', level: ps?.listLevel ?? 1, numberStyle: ps?.numberStyle ?? 'decimal', continueNumbering: turningOn } as unknown as import('@emrde/document-engine').ListStyle })
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
          // 激活或切换区域 (缺省钉在正在看的那页)
          ed.setHeaderFooterEditActive(true, section)

          // 目标段落: 按编辑目标页的生效变体取 (契约 §7.9); 无则创建
          const doc = ed.getDocument()
          let firstParaId = hfParagraphsForPage(
            doc, section, ed.getHeaderFooterEditPageIndex() + 1,
          )[0]
          if (!firstParaId) {
            firstParaId = ed.ensureHeaderFooterParagraph(section)
          }
          if (!firstParaId) break // 极端情况 (非 local 命令被拒) — 不设无效光标路径

          // 自动将光标定位到对应区域的第一个段落
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
        ed.setHeaderFooterConfig(_value as Partial<import('@emrde/document-engine').HeaderFooterConfig>)
        break
    }
  }, [editorRef])

  const handleExport = useCallback((format: string) => {
    const ed = editorRef.current
    if (!ed) return
    const doc = ed.getDocument()
    const pool = ed.getPool()
    /** 计算值 (契约 §12.12.1): 导出件与屏幕必须读到同一份 memo, 不各自求值 */
    const computedDisplayOf = (id: string) => ed.getComputedDisplay(id)

    if (format === 'json') {
      const tocGen = new TOCGenerator()
      const toc = tocGen.extractEntries(doc, pool)
      // 使用完整序列化 (含节点 payload), 再附加目录信息
      const serialized = JSON.parse(ed.getSerializedDocument()) as Record<string, unknown>
      // 导出清理: 未填标签(等于控件库默认值, 如 '文本输入：')不写入 JSON,
      // 与导入侧 stripWidgetDefaultLabels 对齐 (导入导出一致)。
      stripWidgetDefaultLabelsFromObject(serialized.templateDefinitions as Record<string, import('@emrde/document-engine').TemplateDefinition> | undefined)
      serialized._toc = toc
      // 取证溯源标识: 附加 _provenance 顶层字段 (与 _toc 同类, 加载侧容忍未知顶层字段)
      stampExportObject(serialized)
      const json = JSON.stringify(serialized, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url; a.download = `document-${Date.now()}.json`; a.click()
      URL.revokeObjectURL(url)
    } else if (format === 'txt') {
      // 页眉 + 正文 + 页脚 (含 smarttext 显示值 / 域代码), 见 lib/documentExport
      // displayOf: 计算值 (契约 §12.12.1) —— 导出件必须与屏幕显示同一个值, 否则
      // 屏幕上写着"40 岁"、TXT 里是个占位符, 而两边都对得上各自的代码。
      // stampExportText: 末尾追加不可见溯源标识 (不进入文档模型, 不改纯函数输出)
      const blob = new Blob([stampExportText(buildExportText(doc, pool, new Date(), computedDisplayOf))], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url; a.download = `document-${Date.now()}.txt`; a.click()
      URL.revokeObjectURL(url)
    } else if (format === 'html') {
      // stampExportHtml: head 内注入可读 meta, 正文末尾注入不可见溯源标识
      const blob = new Blob([stampExportHtml(buildExportHtml(doc, pool, new Date(), computedDisplayOf))], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = window.document.createElement('a')
      a.href = url; a.download = `document-${Date.now()}.html`; a.click()
      URL.revokeObjectURL(url)
    } else if (format === 'elements') {
      // 结构化元素: 全部输入项数据 (机器码 + 显示名 + 候选表), 见 lib/export/fields。
      // 与 XML / OFD 数据区共用同一份语义投影 —— 三处不会各自漂移。
      const projection = collectFields({
        doc, pool,
        templateDefinitions: ed.getTemplateDefinitions() ?? undefined,
        // 字典型枚举的候选源 (契约 §12.6): 与屏幕 overlay 同一条取值路径
        optionsOf: (nodeId) => ed.getControlSnapshot(nodeId)?.options ?? undefined,
        sectionTree: sectionTreeOf(doc, pool),
      })
      const payload = buildElementsDocument({
        projection,
        document: {
          id: doc.id,
          title: doc.title,
          modelVersion: (doc as unknown as { modelVersion?: string }).modelVersion,
          pageSetup: doc.pageSetup,
          layout: {
            pageWidth: ed.getDraw().getPages()[0]?.width ?? 0,
            pageHeight: ed.getDraw().getPages()[0]?.height ?? 0,
            pageCount: ed.getDraw().getPages().length,
          },
          metadata: doc.metadata,
          stats: (() => {
            const wc = ed.getWordCount()
            return { paragraphs: wc.paragraphs, words: wc.words, chars: wc.chars }
          })(),
        },
        now: new Date(),
      })
      stampExportObject(payload)
      downloadBlob(JSON.stringify(payload, null, 2), 'application/json', 'elements.json')
    } else if (format === 'cda') {
      // HL7 CDA 骨架: 节按 sectionCode 分组, 字段码与显示名同时在, 见 lib/export/cdaExport。
      // 与「导出文档」那份 JSON 不同 —— 那份是完整节点树 (回环用), 这份是交换/归档用。
      const built = buildCdaXml({
        projection: collectFields({
          doc, pool,
          templateDefinitions: ed.getTemplateDefinitions() ?? undefined,
          optionsOf: (nodeId) => ed.getControlSnapshot(nodeId)?.options ?? undefined,
          sectionTree: sectionTreeOf(doc, pool),
        }),
        document: {
          id: doc.id,
          title: doc.title,
          authorName: doc.metadata?.author ?? doc.metadata?.creator,
          custodianName: doc.metadata?.department,
          effectiveTime: doc.metadata?.updatedAt ? new Date(doc.metadata.updatedAt) : undefined,
        },
        now: new Date(),
        language: locale.getLocale(),
      })
      const xml = stampExportXml(built.xml)
      downloadBlob(xml, 'application/xml', 'cda.xml')
      if (built.droppedChars > 0) {
        // 不静默: 剔除过 XML 不允许的字符就该明说 —— 产物与原文并非逐字一致
        reportError({
          code: EditorErrorCode.E_DOCUMENT_CORRUPTED,
          message: locale.t('export.droppedChars', { n: built.droppedChars }),
        })
      }
    } else if (format === 'ofd') {
      // OFD 版式文档: 版式与分页取自 SLIF (与屏幕/打印同一份布局), 结构化数据
      // 取自同一份字段投影 (与「结构化元素」「XML」同源)。见 lib/export/ofd/。
      // 先重排一次: 页面几何必须是最新的 (与 handleCommand 里同一处幂等调用)
      const draw = ed.getDraw()
      const pages = draw.recomputeLayout(pool)
      const measurer = ed.getTextMeasurer()

      const built = buildOfd({
        pages,
        images: collectImageSources(pool),
        // 逐字形推进量: 与布局同一把尺子 —— OFD 的 DeltaX 由它派生,
        // 使每行右边界钉在布局记录的位置 (字体被替换也不会重排)
        charAdvance: (text, cfg) => cumulativeCharWidths(text, cfg, measurer),
        // 域代码逐页解析: 与渲染层同一个解析器, 否则页码会导出成 '[页码]'
        resolveFieldText: (item, pageIndex) => resolveFieldText(item.fieldType, item.text, {
          pageNumber: pageIndex + 1,
          totalPages: pages.length,
          documentTitle: doc.title,
          now: new Date(),
          locale: locale.getLocale(),
        }),
        projection: collectFields({
          doc, pool,
          templateDefinitions: ed.getTemplateDefinitions() ?? undefined,
          optionsOf: (nodeId) => ed.getControlSnapshot(nodeId)?.options ?? undefined,
          sectionTree: sectionTreeOf(doc, pool),
        }),
        document: {
          id: doc.id,
          title: doc.title,
          modelVersion: (doc as unknown as { modelVersion?: string }).modelVersion,
          metadata: doc.metadata,
        },
        labels: {
          patientInfo: t('ofd.meta.patientInfo'), admissionNo: t('ofd.meta.admissionNo'),
          visitTime: t('ofd.meta.visitTime'), documentType: t('ofd.meta.documentType'),
          author: t('ofd.meta.author'), submittedAt: t('ofd.meta.submittedAt'),
          diagnosis: t('ofd.meta.diagnosis'), procedure: t('ofd.meta.procedure'),
        },
        provenance: provenanceRecord(),
        now: new Date(),
        // 固定 mtime: 同一文档两次导出应逐字节相同 (可复现, 也是将来签章的前提)。
        // 必须是 ZIP 的 DOS 时间能表示的年份 —— 该字段只有 7 位存年 (相对 1980),
        // 可表示区间是 1980..2099; 传 epoch 0 (1970) 会让 fflate 直接抛
        // "date not in range 1980-2099", 导出在写字节前就失败。
        // 也不能取 1980 这一下界: DOS 时间按**本地时间**编码, 西半球的 1980-01-01T00:00Z
        // 会退到 1979 年。取区间中段, 与测试里的 ZIP_TIME 保持同一个值。
        zipTime: new Date('2026-01-01T00:00:00Z'),
      })

      downloadBlob(built.bytes, 'application/ofd', 'ofd')
      const warnCount = built.warnings.length + (built.droppedChars > 0 ? 1 : 0)
      if (warnCount > 0) {
        reportError({
          code: EditorErrorCode.E_DOCUMENT_CORRUPTED,
          message: locale.t('export.ofdWarnings', { n: warnCount }),
        })
      }
    }
  }, [editorRef, t])

  const handleTemplateSelect = useCallback(async (templateId: string) => {
    const ed = editorRef.current
    if (!ed) return
    try {
      const res = await templateApi.getById(templateId)
      const detail = res.data.data
      if (detail) {
        const doc = JSON.parse(detail.content)
        stripWidgetDefaultLabelsFromObject((doc as { templateDefinitions?: Record<string, import('@emrde/document-engine').TemplateDefinition> }).templateDefinitions)
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
      setTemplates([{ name: t('mock.template.medical'), items: items.map((it: { id: string; name: string; description?: string }) => ({ id: it.id, name: it.name, description: it.description })) }])
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
        // 分节符 (Word 的页面设置边界, 与结构容器 Section 是两回事)
        if (type === 'sectionBreak') { ed.insertSectionBreak(); return }
        // 结构容器 Section (契约 §31.14)
        if (type === 'section') { ed.insertSection(); return }
        // 表单控件 3 类向导 (契约 §12.7): 打开对应配置弹框, 确定后再插到光标
        if (type === 'textInput' || type === 'radio' || type === 'checkbox') {
          // 撞键提示的文档快照, **在打开这一刻取一次** —— 不放在渲染里, 否则弹框里
          // 每敲一个字符都要把全文投影重算一遍 (契约 §12.10.2 的投影不便宜)。
          setControlKeyFacts(keyFactsOf())
          setControlWizard({ open: true, kind: type })
          return
        }
      }}
      onExportClick={() => setExportOpen(true)}
      onPrint={() => setPrintOpen(true)}
      pluginActions={editorRef.current?.getPluginToolbarActions()}
      onPageSetup={() => setPageSetupOpen(true)}
      onWatermark={() => {
        // 以**现值为初值**打开 (没有水印则 undefined → 对话框用默认值)
        setWatermarkInitial(editorRef.current?.getWatermark())
        setWatermarkOpen(true)
      }}
      commentThreads={(() => { const ed = editorRef.current; return ed ? ed.getComments() : [] })()}
      onSelectCommentThread={handleSelectCommentThread}
      onAddCommentReply={(threadId, content) => editorRef.current?.addCommentReply(threadId, content)}
      qcResult={qcResult}
      onQcIssueClick={handleQcIssueClick}
      onQcRecheck={() => setQcResult(editorRef.current?.runQC() ?? null)}
      // 批注创建: 锚点取文档当前选区/光标, 返回 false 时面板显示提示
      onNewComment={(content) => editorRef.current?.createComment(content) ?? false}
      getCommentExcerpt={(threadId) => editorRef.current?.getCommentExcerpt(threadId) ?? ''}
      onResolveCommentThread={(threadId) => {
        const ed = editorRef.current
        if (!ed) return
        const threads = ed.getComments()
        const t = threads.find(c => c.id === threadId)
        ed.resolveComment(threadId, t?.status !== 'resolved')
      }}
      wordCount={wordCount}
      scaleScore={scaleScore}
      pageCount={pageCount}
      pageIndex={currentPageIndex + 1}
      scale={zoom}
      onScaleChange={handleScaleChange}
      showInvisible={showInvisible}
      showSectionStructure={showSectionStructure}
      onToggleSectionStructure={handleToggleSectionStructure}
      onToggleInvisible={handleToggleInvisible}
      outlineItems={outlineItems}
      activeOutlineId={activeOutlineId}
      onOutlineClick={handleOutlineClick}
      onSectionAction={handleSectionOutlineAction}
      onTemplateSelect={handleTemplateSelect}
      templates={templates}
    >
      <div
        ref={containerRef}
        className="flex-1 bg-chrome-desk relative overflow-y-auto overflow-x-hidden"
        style={{ minHeight: '400px' }}
        onContextMenu={contextMenu.onContextMenu}
      />
      <DesignControlTooltip />
      <RuntimeControlOverlay canvasContainerRef={containerRef} />
      <TableGrowOverlay />
      <SectionStructureOverlay />
      {/* 性能面板 (接线审计 P2: 此前 PerformanceMetrics 只写不读、PerfPanel 零挂载) */}
      <PerfPanel summary={perfSummary ?? undefined} />
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
          otherKeyUsage={controlKeyFacts.usage}
          referenceKeys={controlKeyFacts.refs}
          onPreviewFormula={previewForCreate}
          onClose={() => setControlWizard({ open: false, kind: controlWizard.kind })}
          onApply={applyWizardResult}
        />
      ) : controlWizard.open ? (
        <ControlChoiceDialog
          open
          mode="create"
          initial={initialConfigForCreate(controlWizard.kind)}
          otherKeyUsage={controlKeyFacts.usage}
          referenceKeys={controlKeyFacts.refs}
          onPreviewFormula={previewForCreate}
          onClose={() => setControlWizard({ open: false, kind: controlWizard.kind })}
          onApply={applyWizardResult}
        />
      ) : null}
      {/* 设计模式右键「属性」(edit) — 以命中控件为目标, 按家族开弹框 */}
      {controlEdit.open && (() => {
        const ed = editorRef.current
        if (!ed) return null
        const element = ed.getElement(controlEdit.nodeId)
        if (!element) return null
        const definition = ed.getControlDefinition(controlEdit.nodeId)
        const family = controlFamilyOf(element, definition)
        const initial = { element, definition }
        return family === 'choice' ? (
          <ControlChoiceDialog open mode="edit" initial={initial} otherKeyUsage={controlKeyFacts.usage} referenceKeys={controlKeyFacts.refs} onPreviewFormula={previewForEdit} onClose={closeControlEdit} onApply={applyControlEdit} />
        ) : (
          <ControlInputDialog open mode="edit" initial={initial} otherKeyUsage={controlKeyFacts.usage} referenceKeys={controlKeyFacts.refs} onPreviewFormula={previewForEdit} onClose={closeControlEdit} onApply={applyControlEdit} />
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
        history={printHistoryForDoc}
        initialSettings={{ resumeFromPage: printResumeFrom }}
        onPreview={() => {
          const ed = editorRef.current
          if (!ed) return
          setPrintPages(ed.preparePrintPages())
          setPreviewPage(0)
          setPrintOpen(false)
        }}
        onPrint={(settings) => {
          const ed = editorRef.current
          if (!ed) return
          const all = ed.preparePrintPages()
          // 页码范围**真的生效**: 钳制后切片再交给打印窗口。原先这里直接丢掉
          // settings —— 页码框、续打断点全是摆设, 而且那样记下的历史范围是假的。
          const range = resolvePrintRange(settings.pageRange, all.length)
          openPrintWindow(selectPrintPages(all, range))

          // 记入打印历史 (PrintHistoryService)。规则见 lib/printJob.ts。
          printHistory.addRecord(buildPrintRecord({
            documentId: docId,
            documentTitle: ed.getDocumentTitle(),
            settings,
            range,
            totalPages: all.length,
          }))
        }}
      />
      {/* 应用内打印预览 (接线审计 P2: PrintPreviewDialog 此前零挂载点) */}
      <PrintPreviewDialog
        open={printPages !== null}
        onOpenChange={(o) => { if (!o) setPrintPages(null) }}
        pageCount={printPages?.length ?? 0}
        currentPage={previewPage}
        onPageChange={(p) => setPreviewPage(Math.max(0, Math.min((printPages?.length ?? 1) - 1, p)))}
        onPrint={() => {
          if (printPages) openPrintWindow(printPages)
          setPrintPages(null)
        }}
      >
        {printPages?.[previewPage]
          ? <img src={printPages[previewPage]} alt={locale.t('editorPage.previewAlt', { page: previewPage + 1 })}
                 className="max-w-full max-h-full object-contain shadow-lg" />
          : null}
      </PrintPreviewDialog>
      <PageSetupDialog
        open={pageSetupOpen}
        onClose={() => setPageSetupOpen(false)}
        onApply={(values) => {
          const ed = editorRef.current
          if (ed) ed.applyPageSetup(values)
          setPageSetupOpen(false)
        }}
      />
      <WatermarkDialog
        open={watermarkOpen}
        onClose={() => setWatermarkOpen(false)}
        initialConfig={watermarkInitial}
        onApply={(config) => { editorRef.current?.setWatermark(config) }}
        // 仅当文档已有水印时提供移除入口 (契约 §12.4: 文档内容不可只写不删)
        onRemove={watermarkInitial ? () => { editorRef.current?.setWatermark(null) } : undefined}
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
      <SectionCodeDialog
        open={sectionCodeTarget.open}
        onClose={() => setSectionCodeTarget((s) => ({ ...s, open: false }))}
        current={editorRef.current?.getSectionCode(sectionCodeTarget.sectionId)}
        onConfirm={(code) => {
          editorRef.current?.setSectionCode(sectionCodeTarget.sectionId, code)
          setSectionCodeTarget((s) => ({ ...s, open: false }))
        }}
      />
      {/* 保存前完整性闸门 (契约 §12.11) — 只列缺项, 不硬拦 */}
      <CompletenessDialog
        open={completeness.open}
        missing={completeness.missing}
        onJump={handleMissingJump}
        onSaveAnyway={handleSaveAnyway}
        onClose={() => setCompleteness({ open: false, missing: [] })}
      />
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
      <div className="bg-chrome rounded-lg shadow-xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-xs text-chrome-ink-tertiary mb-2">{hoverRows}×{hoverCols} 表格</div>
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${maxC}, 24px)` }}>
          {Array.from({ length: maxR }, (_, r) =>
            Array.from({ length: maxC }, (_, c) => (
              <div
                key={`${r}-${c}`}
                className="w-6 h-6 rounded-sm border cursor-pointer transition-colors"
                style={{
                  // 内联样式吃不到 Tailwind 类, 直接读 chrome token (兜底值 = standard 原值)。
                  // 空档位原为 #E5E7EB/#D1D5DB: 不跟着主题走的话, 深色下这张表格选择器
                  // 会是一片刺眼的白格。选中态用 primary, 属品牌色, 不参与主题化。
                  backgroundColor: r < hoverRows && c < hoverCols
                    ? '#3B82F6'
                    : 'rgb(var(--emr-surface-strong, 229 231 235))',
                  borderColor: r < hoverRows && c < hoverCols
                    ? '#2563EB'
                    : 'rgb(var(--emr-line-strong, 209 213 219))',
                }}
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
