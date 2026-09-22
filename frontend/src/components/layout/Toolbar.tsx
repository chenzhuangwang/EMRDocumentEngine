// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 工具栏 - 完整实现
// ============================================================

import {
  Bold, Italic, Underline, Undo2, Redo2, Strikethrough,
  Superscript, Subscript, Palette, Table, Image, Download,
  Printer, ChevronDown, AlignLeft, AlignCenter, AlignRight,
  AlignJustify, List, ListOrdered, Indent, Outdent,
  ChevronsUpDown, Type, Calendar, CheckSquare,
  Circle, Hash, FileText, Heading,
  PanelTop, Eraser, Settings, Paintbrush, Minus, WrapText,
  Clock, User, Highlighter, Bookmark,
  Combine, Ungroup,
  Rows3, Rows, Columns3, Columns,
  Droplets, Puzzle,
} from 'lucide-react'
import type { ToolbarAction } from '@/engine/plugins/PluginManager'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import { useEditorStoreSnapshot } from '@/components/editor/EditorProvider'
import { HeaderFooterToolbar } from '@/components/toolbar/HeaderFooterToolbar'
import { resolveVariantForPage, type HeaderFooterVariant } from '@/engine'
import { useTranslation } from '@/i18n/useTranslation'

interface ToolbarProps {
  onFormat?: (action: string, value?: unknown) => void
  onInsert?: (elementType: string) => void
  onExportClick?: () => void
  onPrint?: () => void
  onPageSetup?: () => void
  /** 水印设置 (契约 §12.4) */
  onWatermark?: () => void
  /** 插件注册的工具栏动作 (契约 §12) */
  pluginActions?: ToolbarAction[]
}

// ---- 常量 ----

// 字体: 双语两套 label, UI 按 locale 选
// 技术名 value (SimSun 等) 是字体标识, 不翻译
type FontFamilyItem = { value: string; labelZh: string; labelEn: string }
const FONT_FAMILIES: FontFamilyItem[] = [
  { value: 'SimSun',           labelZh: '宋体',     labelEn: 'SimSun' },
  { value: 'SimHei',           labelZh: '黑体',     labelEn: 'SimHei' },
  { value: 'KaiTi',            labelZh: '楷体',     labelEn: 'KaiTi' },
  { value: 'FangSong',         labelZh: '仿宋',     labelEn: 'FangSong' },
  { value: 'Microsoft YaHei',  labelZh: '微软雅黑', labelEn: 'Microsoft YaHei' },
  { value: 'Arial',            labelZh: 'Arial',    labelEn: 'Arial' },
  { value: 'Times New Roman',  labelZh: 'Times New Roman', labelEn: 'Times New Roman' },
  { value: 'Courier New',      labelZh: 'Courier New',     labelEn: 'Courier New' },
]

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72]

const COLORS = [
  '#000000', '#333333', '#666666', '#999999', '#CCCCCC',
  '#DC2626', '#EA580C', '#F59E0B', '#16A34A', '#2563EB',
  '#7C3AED', '#DB2777', '#0891B2', '#4F46E5',
]

// 通用控件插入向导 (契约 §12.7): 收拢为 3 类工具, 点选后开对应配置弹框
// (EditorPage 路由), 不再直接插默认控件。
interface ControlItem {
  type: string; labelKey: 'dialog.controlType.input' | 'dialog.controlType.radio' | 'dialog.controlType.checkbox'
  descZh: string; descEn: string; icon: React.ReactNode
}
const CONTROLS: ControlItem[] = [
  { type: 'textInput', labelKey: 'dialog.controlType.input',    descZh: '单行/多行/数字/日期', descEn: 'Single/Multi/Number/Date', icon: <Type size={16} /> },
  { type: 'radio',     labelKey: 'dialog.controlType.radio',    descZh: '单选候选',             descEn: 'Single-choice candidates', icon: <Circle size={16} /> },
  { type: 'checkbox',  labelKey: 'dialog.controlType.checkbox', descZh: '多选候选',             descEn: 'Multi-choice candidates',  icon: <CheckSquare size={16} /> },
]

// 双语两套 label, UI 按 locale 选 —— 技术名(value)不翻译
const HEADING_STYLES: { value: number; labelZh: string; labelEn: string }[] = [
  { value: 0, labelZh: '正文',   labelEn: 'Body' },
  { value: 1, labelZh: '标题 1', labelEn: 'Heading 1' },
  { value: 2, labelZh: '标题 2', labelEn: 'Heading 2' },
  { value: 3, labelZh: '标题 3', labelEn: 'Heading 3' },
  { value: 4, labelZh: '标题 4', labelEn: 'Heading 4' },
  { value: 5, labelZh: '标题 5', labelEn: 'Heading 5' },
  { value: 6, labelZh: '标题 6', labelEn: 'Heading 6' },
]

const NUMBER_STYLES: { labelZh: string; labelEn: string; value: string; sample: string }[] = [
  { labelZh: '1, 2, 3',   labelEn: '1, 2, 3',   value: 'decimal',         sample: '1' },
  { labelZh: 'a, b, c',   labelEn: 'a, b, c',   value: 'lower_alpha',     sample: 'a' },
  { labelZh: 'A, B, C',   labelEn: 'A, B, C',   value: 'upper_alpha',     sample: 'A' },
  { labelZh: 'i, ii, iii',labelEn: 'i, ii, iii',value: 'lower_roman',     sample: 'i' },
  { labelZh: 'I, II, III',labelEn: 'I, II, III',value: 'upper_roman',     sample: 'I' },
  { labelZh: '一, 二, 三',labelEn: '一, 二, 三',value: 'cjk_ideographic', sample: '一' },
]

const FIELD_ITEMS: { type: string; labelZh: string; labelEn: string; icon: React.ReactNode; shortcut?: string }[] = [
  { type: 'pageNumber',   labelZh: '页码',         labelEn: 'Page Number',      icon: <Hash size={14} />,    shortcut: 'PAGE' },
  { type: 'totalPages',   labelZh: '总页数',       labelEn: 'Total Pages',      icon: <FileText size={14} />,shortcut: 'NUMPAGES' },
  { type: 'currentDate',  labelZh: '当前日期',     labelEn: 'Current Date',     icon: <Calendar size={14} />,shortcut: 'DATE' },
  { type: 'currentTime',  labelZh: '当前时间',     labelEn: 'Current Time',     icon: <Clock size={14} />,   shortcut: 'TIME' },
  { type: 'authorName',   labelZh: '作者名称',     labelEn: 'Author',           icon: <User size={14} />,    shortcut: 'AUTHOR' },
  { type: 'documentTitle',labelZh: '文档标题',     labelEn: 'Document Title',   icon: <FileText size={14} />,shortcut: 'TITLE' },
  { type: 'lastSavedDate',labelZh: '最后保存日期', labelEn: 'Last Saved Date',  icon: <Clock size={14} />,   shortcut: 'SAVEDATE' },
  { type: 'printDate',    labelZh: '打印日期',     labelEn: 'Print Date',       icon: <Calendar size={14} />,shortcut: 'PRINTDATE' },
]

// ================================================================
export function Toolbar({ onFormat, onInsert, onPrint, onExportClick, onPageSetup, onWatermark, pluginActions }: ToolbarProps) {
  const { t } = useTranslation()
  const paraStyle = useEditorStoreSnapshot((s) => s.paragraphStyle)
  const textStyle = useEditorStoreSnapshot((s) => s.textStyle)
  const canUndo = useEditorStoreSnapshot((s) => s.runtime.history.canUndo)
  const canRedo = useEditorStoreSnapshot((s) => s.runtime.history.canRedo)
  const formatPainterActive = useEditorStoreSnapshot((s) => s.formatPainterActive)
  const hfEdit = useEditorStoreSnapshot((s) => s.headerFooterEdit)
  const hfConfig = useEditorStoreSnapshot((s) => s.headerFooterConfig)
  const hfDoc = useEditorStoreSnapshot((s) => s.document)
  // 生效变体 — 复用引擎唯一解析规则 (契约 §7.9), 不得在 UI 里再写一份选取逻辑
  const hfVariant: HeaderFooterVariant = hfDoc
    ? resolveVariantForPage(hfDoc, hfEdit.pageIndex + 1)
    : 'default'

  return (
    <>
    <div className="h-toolbar bg-chrome border-b border-line-subtle flex items-center px-3 gap-0.5 flex-shrink-0 overflow-x-auto select-none">
      {/* 组1：历史操作 */}
      <ToolbarGroup>
        <ToolbarButton title={`${t('editor.undo')} (Ctrl+Z)`} disabled={!canUndo} onClick={() => onFormat?.('undo')}>
          <Undo2 size={16} />
        </ToolbarButton>
        <ToolbarButton title={`${t('editor.redo')} (Ctrl+Y)`} disabled={!canRedo} onClick={() => onFormat?.('redo')}>
          <Redo2 size={16} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组2：字体 / 字号 */}
      <ToolbarGroup>
        <FontDropdown onSelect={(v) => onFormat?.('font', v)} />
        <FontSizeDropdown onSelect={(v) => onFormat?.('fontSize', v)} />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组3：标题样式 */}
      <ToolbarGroup>
        <HeadingDropdown onSelect={(level) => onFormat?.('heading', level)} />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组4：文本样式 */}
      <ToolbarGroup>
        <ToolbarButton title={t('editor.formatPainter')} active={formatPainterActive} onClick={() => onFormat?.('formatPainter')}>
          <Paintbrush size={16} />
        </ToolbarButton>
        <ToolbarButton title={`${t('editor.format.bold')} (Ctrl+B)`} active={textStyle?.bold} onClick={() => onFormat?.('bold')}>
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton title={`${t('editor.format.italic')} (Ctrl+I)`} active={textStyle?.italic} onClick={() => onFormat?.('italic')}>
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton title={`${t('editor.format.underline')} (Ctrl+U)`} active={textStyle?.underline} onClick={() => onFormat?.('underline')}>
          <Underline size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.format.strikethrough')} active={textStyle?.strikeout} onClick={() => onFormat?.('strikeout')}>
          <Strikethrough size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.format.superscript')} active={textStyle?.superscript} onClick={() => onFormat?.('superscript')}>
          <Superscript size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.format.subscript')} active={textStyle?.subscript} onClick={() => onFormat?.('subscript')}>
          <Subscript size={16} />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton title={t('editor.clearFormat')} onClick={() => onFormat?.('clearFormat')}>
          <Eraser size={16} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组5：文字颜色 */}
      <ToolbarGroup>
        <ColorPicker onSelect={(color) => onFormat?.('color', color)} />
        <HighlightPicker onSelect={(color) => onFormat?.('highlight', color)} />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组6：元素插入 */}
      <ToolbarGroup>
        <ToolbarButton title={t('editor.insert.separator')} onClick={() => onInsert?.('separator')}>
          <Minus size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.insert.table')} onClick={() => onInsert?.('table')}>
          <Table size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.table.mergeCell')} onClick={() => onFormat?.('mergeCells')}>
          <Combine size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.table.splitCell')} onClick={() => onFormat?.('splitCell')}>
          <Ungroup size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.table.insertRow')} onClick={() => onFormat?.('insertRow')}>
          <Rows3 size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.table.deleteRow')} onClick={() => onFormat?.('deleteRow')}>
          <Rows size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.table.insertColumn')} onClick={() => onFormat?.('insertColumn')}>
          <Columns3 size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.table.deleteColumn')} onClick={() => onFormat?.('deleteColumn')}>
          <Columns size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.insert.image')} onClick={() => onInsert?.('image')}>
          <Image size={16} />
        </ToolbarButton>
        <InsertControlDropdown onInsert={onInsert} />
        <FieldDropdown onInsert={onInsert} />
        <ToolbarButton title={t('editor.insert.bookmark')} onClick={() => onFormat?.('openBookmark')}>
          <Bookmark size={16} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组7：段落格式 */}
      <ToolbarGroup>
        <ToolbarButton title={t('editor.format.alignLeft')} active={paraStyle?.alignment === 'left'} onClick={() => onFormat?.('alignLeft')}>
          <AlignLeft size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.format.alignCenter')} active={paraStyle?.alignment === 'center'} onClick={() => onFormat?.('alignCenter')}>
          <AlignCenter size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.format.alignRight')} active={paraStyle?.alignment === 'right'} onClick={() => onFormat?.('alignRight')}>
          <AlignRight size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.format.alignJustify')} active={paraStyle?.alignment === 'justify'} onClick={() => onFormat?.('alignJustify')}>
          <AlignJustify size={16} />
        </ToolbarButton>
        <LineHeightDropdown onSelect={(v) => onFormat?.('lineHeight', v)} />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组8：列表 + 缩进 */}
      <ToolbarGroup>
        <ToolbarButton title={t('editor.list.bullet')} active={paraStyle?.listType === 'bullet'} onClick={() => onFormat?.('unorderedList')}>
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.list.ordered')} active={paraStyle?.listType === 'ordered'} onClick={() => onFormat?.('orderedList')}>
          <ListOrdered size={16} />
        </ToolbarButton>
        {paraStyle?.listType === 'ordered' && (
          <NumberStyleDropdown
            selected={paraStyle?.numberStyle || 'decimal'}
            onSelect={(ns) => onFormat?.('orderedListNumberStyle', ns)}
          />
        )}
        {paraStyle?.listType === 'ordered' && (
          <ToolbarButton
            title={t('editor.list.continueNumbering')}
            active={paraStyle?.continueNumbering}
            onClick={() => onFormat?.('continueNumbering')}
          >
            <WrapText size={16} />
          </ToolbarButton>
        )}
        <ToolbarButton title={t('editor.list.outdent')} onClick={() => onFormat?.('outdent')}>
          <Outdent size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.list.indent')} onClick={() => onFormat?.('indent')}>
          <Indent size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('editor.list.firstLineIndent')} active={(paraStyle?.firstLineIndent ?? 0) > 0} onClick={() => onFormat?.('firstLineIndent')}>
          <span className="text-sm">首行</span>
        </ToolbarButton>
      </ToolbarGroup>

      {/* 弹性空间 */}
      <div className="flex-1" />

      {/* 组9：页眉页脚 */}
      <ToolbarGroup>
        <HeaderFooterDropdown
          hfEdit={hfEdit}
          onEnterEdit={(section) => onFormat?.('headerFooterEnter', section)}
        />
      </ToolbarGroup>

      {/* 插件动作组 (契约 §12) — 插件经 registerToolbarAction 注册的按钮。
          此前 getToolbarActions() 零调用, 插件注册的按钮无处可去。 */}
      {pluginActions && pluginActions.length > 0 && (
        <ToolbarGroup>
          {pluginActions.map((a) => (
            <ToolbarButton key={a.id} title={a.label} onClick={a.onClick}>
              <Puzzle size={16} />
            </ToolbarButton>
          ))}
        </ToolbarGroup>
      )}

      {/* 组10：文件操作 */}
      <ToolbarGroup>
        <ToolbarButton title={t('toolbar.pageSetup')} onClick={onPageSetup}>
          <Settings size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('toolbar.watermark')} onClick={onWatermark}>
          <Droplets size={16} />
        </ToolbarButton>
        <ToolbarButton title={t('toolbar.print')} onClick={onPrint}>
          <Printer size={16} />
        </ToolbarButton>
        <ExportDropdown onExportClick={onExportClick} />
      </ToolbarGroup>
    </div>

      {/* 页眉页脚上下文条 — 保留完整主工具栏 (不替换), 在其下方追加一行 (契约 §7.9) */}
      {hfEdit.active && (
        <HeaderFooterToolbar
          section={hfEdit.section}
          config={hfConfig}
          onConfigChange={(patch) => onFormat?.('headerFooterConfig', patch)}
          onInsertPageNumber={() => onInsert?.('pageNumber')}
          onInsertDate={() => onInsert?.('currentDate')}
          onClose={() => onFormat?.('headerFooterClose')}
          pageNumber={hfEdit.pageIndex + 1}
          variant={hfVariant}
        />
      )}
    </>
  )
}

// ================================================================
// 子组件
// ================================================================

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="toolbar-btn-group">{children}</div>
}

function ToolbarDivider() {
  return <div className="toolbar-divider" />
}

function ToolbarButton({
  title, active, disabled, onClick, children,
}: {
  title: string; active?: boolean; disabled?: boolean
  onClick?: () => void; children: React.ReactNode
}) {
  return (
    <button
      className={cn('toolbar-btn', active && 'toolbar-btn-active')}
      title={title} disabled={disabled} onClick={onClick}
    >
      {children}
    </button>
  )
}

// ---- 字体下拉 ----

function FontDropdown({ onSelect }: { onSelect: (font: string) => void }) {
  const textStyle = useEditorStoreSnapshot((s) => s.textStyle)
  const selected = textStyle?.font || 'SimSun'
  const { t } = useTranslation()
  const isEN = t('headerBar.brand') === 'EMR Editor' ? false : true
  const found = FONT_FAMILIES.find(f => f.value === selected)
  const currentLabel = found ? (isEN ? found.labelEn : found.labelZh) : (isEN ? 'SimSun' : '宋体')
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-1 px-2 py-1 text-sm text-chrome-ink-body
                            hover:bg-chrome-muted rounded-md min-w-[90px] h-8
                            data-[state=open]:bg-chrome-muted">
          <span className="truncate">{currentLabel}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[150px] bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4} align="start"
        >
          {FONT_FAMILIES.map(f => (
            <DropdownMenu.Item
              key={f.value}
              className="px-3 py-1.5 text-sm text-chrome-ink-body outline-none cursor-default
                         data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700"
              style={{ fontFamily: f.value }}
              onClick={() => onSelect(f.value)}
            >
              {isEN ? f.labelEn : f.labelZh}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 字号下拉 ----

function FontSizeDropdown({ onSelect }: { onSelect: (size: number) => void }) {
  const textStyle = useEditorStoreSnapshot((s) => s.textStyle)
  const selected = textStyle?.size || 16
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-1 px-2 py-1 text-sm text-chrome-ink-body
                            hover:bg-chrome-muted rounded-md min-w-[50px] h-8
                            data-[state=open]:bg-chrome-muted">
          <span>{selected}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[60px] max-h-[280px] overflow-y-auto overflow-x-hidden bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4} align="start"
        >
          {FONT_SIZES.map(s => (
            <DropdownMenu.Item
              key={s}
              className="px-3 py-1.5 text-sm text-chrome-ink-body outline-none cursor-default
                         data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700 text-center"
              onClick={() => onSelect(s)}
            >
              {s}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 行距下拉 (段落行间距倍率) ----

const LINE_HEIGHTS = [1, 1.15, 1.5, 2, 2.5]

function LineHeightDropdown({ onSelect }: { onSelect: (v: number) => void }) {
  const paraStyle = useEditorStoreSnapshot((s) => s.paragraphStyle)
  const { t } = useTranslation()
  const selected = paraStyle?.lineHeight || 1
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          title={t('toolbar.lineHeight')}
          className="flex items-center gap-1 px-2 py-1 text-sm text-chrome-ink-body
                     hover:bg-chrome-muted rounded-md min-w-[50px] h-8
                     data-[state=open]:bg-chrome-muted"
        >
          <span>{selected}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[64px] bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4} align="start"
        >
          {LINE_HEIGHTS.map(v => (
            <DropdownMenu.Item
              key={v}
              className="px-3 py-1.5 text-sm text-chrome-ink-body outline-none cursor-default
                         data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700 text-center"
              onClick={() => onSelect(v)}
            >
              {v}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 文字颜色选择器 ----

function ColorPicker({ onSelect }: { onSelect: (color: string) => void }) {
  const textStyle = useEditorStoreSnapshot((s) => s.textStyle)
  const { t } = useTranslation()
  const currentColor = textStyle?.color || '#000000'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="toolbar-btn data-[state=open]:bg-chrome-muted relative"
          title={`${t('editor.color.text')} (${currentColor})`}
        >
          <Palette size={16} />
          {/* 当前颜色指示器 */}
          <span
            className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full"
            style={{ backgroundColor: currentColor }}
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="bg-chrome rounded-md shadow-lg border border-line p-2 z-50"
          sideOffset={4} align="start"
        >
          <div className="grid grid-cols-7 gap-1">
            {COLORS.map(color => (
              <DropdownMenu.Item
                key={color}
                className="w-6 h-6 rounded-sm border border-line outline-none cursor-pointer
                           data-[highlighted]:ring-2 data-[highlighted]:ring-blue-400 data-[highlighted]:ring-offset-1"
                style={{ backgroundColor: color }}
                onClick={() => onSelect(color)}
              />
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 控件插入下拉 ----

function InsertControlDropdown({ onInsert }: { onInsert?: (type: string) => void }) {
  const { t } = useTranslation()
  const isEN = t('headerBar.brand') === 'EMR Editor' ? false : true
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 px-2 py-1 text-sm text-chrome-ink-secondary
                     hover:bg-chrome-muted rounded-md h-8 data-[state=open]:bg-chrome-muted"
          title={t('editor.insert.control')}
        >
          <ChevronsUpDown size={14} />
          <span className="hidden lg:inline text-xs">{t('toolbar.controlShort')}</span>
          <ChevronDown size={10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[200px] bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4} align="start"
        >
          {CONTROLS.map(({ type, labelKey, descZh, descEn, icon }) => (
            <DropdownMenu.Item
              key={type}
              className="flex items-center gap-3 px-3 py-2 text-sm text-chrome-ink-body outline-none cursor-default
                         data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700 transition-colors"
              onClick={() => onInsert?.(type)}
            >
              <span className="flex-shrink-0 text-chrome-ink-muted">{icon}</span>
              <div className="flex flex-col min-w-0">
                <span className="font-medium">{t(labelKey)}</span>
                <span className="text-xs text-chrome-ink-muted">{isEN ? descEn : descZh}</span>
              </div>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 标题样式下拉 (TASK-457) ----

function HeadingDropdown({ onSelect }: { onSelect: (level: number) => void }) {
  const paraStyle = useEditorStoreSnapshot((s) => s.paragraphStyle)
  const selected = paraStyle?.outlineLevel ?? 0
  const { t } = useTranslation()
  const isEN = t('headerBar.brand') === 'EMR Editor' ? false : true
  const found = HEADING_STYLES.find(h => h.value === selected)
  const label = found ? (isEN ? found.labelEn : found.labelZh) : (isEN ? 'Body' : '正文')

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 px-2 py-1 text-sm text-chrome-ink-body
                     hover:bg-chrome-muted rounded-md min-w-[70px] h-8
                     data-[state=open]:bg-chrome-muted"
          title={t('toolbar.headingStyle')}
        >
          <Heading size={14} />
          <span className="truncate">{label}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[120px] bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4} align="start"
        >
          {HEADING_STYLES.map(h => (
            <DropdownMenu.Item
              key={h.value}
              className="px-3 py-1.5 text-sm text-chrome-ink-body outline-none cursor-default
                         data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700"
              style={h.value >= 1 ? {
                fontSize: [0, 28, 24, 20, 18, 16, 14][h.value],
                fontWeight: h.value >= 1 ? 'bold' : 'normal',
              } : undefined}
              onClick={() => onSelect(h.value)}
            >
              {(isEN ? h.labelEn : h.labelZh)}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 导出下拉 ----

function ExportDropdown({ onExportClick }: { onExportClick?: () => void }) {
  const { t } = useTranslation()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 px-2 py-1 text-sm text-chrome-ink-secondary
                     hover:bg-chrome-muted rounded-md h-8 data-[state=open]:bg-chrome-muted"
          title={t('toolbar.export')}
        >
          <Download size={14} />
          <span className="hidden lg:inline">{t('toolbar.export')}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[140px] bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4} align="end"
        >
          <DropdownMenu.Item
            className="flex items-center gap-2 px-3 py-2 text-sm text-chrome-ink-body outline-none cursor-default
                       data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700"
            onClick={onExportClick}
          >
            <FileText size={14} />
            <span>导出文档...</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 页眉页脚编辑入口下拉 ----

function HeaderFooterDropdown({
  hfEdit,
  onEnterEdit,
}: {
  hfEdit: { active: boolean; section: 'header' | 'footer' }
  onEnterEdit: (section: 'header' | 'footer') => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 px-2 py-1 text-sm rounded-md h-8 transition-colors',
            hfEdit.active
              ? 'bg-blue-50 text-blue-700'
              : 'text-chrome-ink-secondary hover:bg-chrome-muted',
          )}
          title={t('editor.hf.title')}
        >
          <PanelTop size={15} />
          <span className="hidden lg:inline text-xs">{t('editor.hf.title')}</span>
          <ChevronDown size={10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[130px] bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4} align="end"
        >
          <DropdownMenu.Item
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm outline-none cursor-default transition-colors',
              hfEdit.active && hfEdit.section === 'header'
                ? 'bg-blue-50 text-blue-700'
                : 'text-chrome-ink-body data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700',
            )}
            onClick={() => onEnterEdit('header')}
          >
            <PanelTop size={14} />
            <span>{t('editor.hf.headerHint')}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm outline-none cursor-default transition-colors',
              hfEdit.active && hfEdit.section === 'footer'
                ? 'bg-blue-50 text-blue-700'
                : 'text-chrome-ink-body data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700',
            )}
            onClick={() => onEnterEdit('footer')}
          >
            <PanelTop size={14} className="rotate-180" />
            <span>{t('editor.hf.footerHint')}</span>
          </DropdownMenu.Item>
          {hfEdit.active && (
            <>
              <div className="h-px bg-chrome-muted my-1" />
              <DropdownMenu.Item
                className="flex items-center gap-2 px-3 py-2 text-sm text-chrome-ink-tertiary outline-none cursor-default
                           data-[highlighted]:bg-red-50 data-[highlighted]:text-red-600 transition-colors"
                onClick={() => onEnterEdit(hfEdit.section)}
              >
                <span>{t('editor.hf.close')}</span>
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 域代码插入下拉 (R39) ----

function FieldDropdown({ onInsert }: { onInsert?: (type: string) => void }) {
  const { t } = useTranslation()
  const isEN = t('headerBar.brand') === 'EMR Editor' ? false : true
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          title={t('toolbar.insertField')}
          className="toolbar-btn flex items-center gap-0.5"
        >
          <Hash size={16} />
          <ChevronDown size={10} className="text-chrome-ink-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[180px] bg-chrome rounded-md shadow-lg border border-line
                     py-1 z-50 animate-in fade-in-80"
          sideOffset={4}
        >
          <div className="px-2 py-1 text-[10px] text-chrome-ink-muted uppercase tracking-wider">
            {t('toolbar.insertField')}
          </div>
          {FIELD_ITEMS.map(item => (
            <DropdownMenu.Item
              key={item.type}
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-chrome-ink-body
                         hover:bg-chrome-muted rounded mx-1 cursor-pointer outline-none"
              onClick={() => onInsert?.(item.type)}
            >
              <span className="flex-shrink-0 text-chrome-ink-muted">{item.icon}</span>
              <span className="flex-1">{isEN ? item.labelEn : item.labelZh}</span>
              {item.shortcut && (
                <span className="text-[10px] text-chrome-ink-muted font-mono">{item.shortcut}</span>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 文字高亮选择器 ----

const HIGHLIGHT_COLORS = [
  '#FFFF00', '#90EE90', '#87CEEB', '#FFB6C1',
  '#DDA0DD', '#F0E68C', '#FFD700', '#FFA07A',
]

function HighlightPicker({ onSelect }: { onSelect: (color: string) => void }) {
  const textStyle = useEditorStoreSnapshot((s) => s.textStyle)
  const { t } = useTranslation()
  const currentHighlight = textStyle?.highlight || 'transparent'
  const highlightLabel = currentHighlight === 'transparent' ? t('editor.font.highlightNone') : currentHighlight

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="toolbar-btn data-[state=open]:bg-chrome-muted relative"
          title={`${t('editor.color.highlight')} (${highlightLabel})`}
        >
          <Highlighter size={16} />
          <span
            className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full"
            style={{ backgroundColor: currentHighlight === 'transparent' ? '#94A3B8' : currentHighlight }}
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="bg-chrome rounded-md shadow-lg border border-line p-2 z-50"
          sideOffset={4} align="start"
        >
          <div className="grid grid-cols-7 gap-1">
            <DropdownMenu.Item
              className="w-6 h-6 rounded-sm border border-line outline-none cursor-pointer
                         flex items-center justify-center text-[10px] text-chrome-ink-muted
                         data-[highlighted]:ring-2 data-[highlighted]:ring-blue-400"
              onClick={() => onSelect('transparent')}
            >
              ✕
            </DropdownMenu.Item>
            {HIGHLIGHT_COLORS.map(color => (
              <DropdownMenu.Item
                key={color}
                className="w-6 h-6 rounded-sm border border-line outline-none cursor-pointer
                           data-[highlighted]:ring-2 data-[highlighted]:ring-blue-400 data-[highlighted]:ring-offset-1"
                style={{ backgroundColor: color }}
                onClick={() => onSelect(color)}
              />
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 编号样式下拉 ----

function NumberStyleDropdown({ selected, onSelect }: { selected: string; onSelect: (value: string) => void }) {
  const current = NUMBER_STYLES.find(n => n.value === selected) || NUMBER_STYLES[0]
  const { t } = useTranslation()
  const isEN = t('headerBar.brand') === 'EMR Editor' ? false : true

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-0.5 px-1.5 py-1 text-xs text-chrome-ink-tertiary
                     hover:bg-chrome-muted rounded-md h-8 data-[state=open]:bg-chrome-muted"
          title={t('toolbar.numberStyle')}
        >
          <span className="font-mono text-chrome-ink-secondary">{current.sample}</span>
          <ChevronDown size={10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[120px] bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4} align="start"
        >
          {NUMBER_STYLES.map(n => (
            <DropdownMenu.Item
              key={n.value}
              className={cn(
                'px-3 py-1.5 text-sm outline-none cursor-default transition-colors',
                n.value === selected
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-chrome-ink-body data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700',
              )}
              onClick={() => onSelect(n.value)}
            >
              <span className="font-mono">{isEN ? n.labelEn : n.labelZh}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
