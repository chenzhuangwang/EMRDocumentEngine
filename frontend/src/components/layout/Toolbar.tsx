// ============================================================
// 工具栏 - 完整实现
// ============================================================

import {
  Bold, Italic, Underline, Undo2, Redo2, Strikethrough,
  Superscript, Subscript, Palette, Table, Image, Download,
  Printer, ChevronDown, AlignLeft, AlignCenter, AlignRight,
  AlignJustify, List, ListOrdered, Indent, Outdent,
  ChevronsUpDown, Type, ListFilter, Calendar, CheckSquare,
  Circle, Hash, RectangleEllipsis, FileText, Heading,
  PanelTop, Eraser, Settings, Paintbrush, Minus,
  Clock, User, Highlighter, Bookmark,
  Combine, Ungroup,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/store'
import { HeaderFooterToolbar } from '@/components/toolbar/HeaderFooterToolbar'

interface ToolbarProps {
  onFormat?: (action: string, value?: unknown) => void
  onInsert?: (elementType: string) => void
  onExportClick?: () => void
  onPrint?: () => void
  onPageSetup?: () => void
  /** 格式刷状态 */
  formatPainterActive?: boolean
}

// ---- 常量 ----

const FONT_FAMILIES = [
  { label: '宋体',   value: 'SimSun' },
  { label: '黑体',   value: 'SimHei' },
  { label: '楷体',   value: 'KaiTi' },
  { label: '仿宋',   value: 'FangSong' },
  { label: '微软雅黑', value: 'Microsoft YaHei' },
  { label: 'Arial',  value: 'Arial' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Courier New',     value: 'Courier New' },
]

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72]

const COLORS = [
  '#000000', '#333333', '#666666', '#999999', '#CCCCCC',
  '#DC2626', '#EA580C', '#F59E0B', '#16A34A', '#2563EB',
  '#7C3AED', '#DB2777', '#0891B2', '#4F46E5',
]

const CONTROLS: ControlItem[] = [
  { type: 'input',    label: '文本输入', description: '单行文本输入框',     icon: <Type size={16} /> },
  { type: 'textarea', label: '文本域',   description: '多行文本输入区域',   icon: <RectangleEllipsis size={16} /> },
  { type: 'number',   label: '数字输入', description: '数值型输入框',       icon: <Hash size={16} /> },
  { type: 'select',   label: '下拉选择', description: '下拉列表选择器',     icon: <ListFilter size={16} /> },
  { type: 'date',     label: '日期选择', description: '日期选择器',         icon: <Calendar size={16} /> },
  { type: 'checkbox', label: '复选框',   description: '多选勾选框',         icon: <CheckSquare size={16} /> },
  { type: 'radio',    label: '单选框',   description: '单选按钮',           icon: <Circle size={16} /> },
]

interface ControlItem {
  type: string; label: string; description: string; icon: React.ReactNode
}

// ================================================================
export function Toolbar({ onFormat, onInsert, onPrint, onExportClick, onPageSetup, formatPainterActive }: ToolbarProps) {
  const paraStyle = useEditorStore((s) => s.paragraphStyle)
  const textStyle = useEditorStore((s) => s.textStyle)
  const canUndo = useEditorStore((s) => s.canUndo)
  const canRedo = useEditorStore((s) => s.canRedo)
  const hfEdit = useEditorStore((s) => s.headerFooterEdit)
  const hfConfig = useEditorStore((s) => s.headerFooterConfig)
  const setHfEdit = useEditorStore((s) => s.setHeaderFooterEdit)
  const setHfConfig = useEditorStore((s) => s.setHeaderFooterConfig)

  // 页眉页脚编辑模式 → 上下文工具栏
  if (hfEdit.active) {
    return (
      <HeaderFooterToolbar
        section={hfEdit.section}
        config={hfConfig}
        onConfigChange={setHfConfig}
        onInsertPageNumber={() => onInsert?.('pageNumber')}
        onInsertDate={() => onInsert?.('currentDate')}
        onClose={() => setHfEdit(false)}
      />
    )
  }

  return (
    <div className="h-toolbar bg-white border-b border-gray-100 flex items-center px-3 gap-0.5 flex-shrink-0 overflow-x-auto select-none">
      {/* 组1：历史操作 */}
      <ToolbarGroup>
        <ToolbarButton title="撤销 (Ctrl+Z)" disabled={!canUndo} onClick={() => onFormat?.('undo')}>
          <Undo2 size={16} />
        </ToolbarButton>
        <ToolbarButton title="重做 (Ctrl+Y)" disabled={!canRedo} onClick={() => onFormat?.('redo')}>
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
        <ToolbarButton title="格式刷" active={formatPainterActive} onClick={() => onFormat?.('formatPainter')}>
          <Paintbrush size={16} />
        </ToolbarButton>
        <ToolbarButton title="加粗 (Ctrl+B)" active={textStyle?.bold} onClick={() => onFormat?.('bold')}>
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton title="斜体 (Ctrl+I)" active={textStyle?.italic} onClick={() => onFormat?.('italic')}>
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton title="下划线 (Ctrl+U)" active={textStyle?.underline} onClick={() => onFormat?.('underline')}>
          <Underline size={16} />
        </ToolbarButton>
        <ToolbarButton title="删除线" active={textStyle?.strikeout} onClick={() => onFormat?.('strikeout')}>
          <Strikethrough size={16} />
        </ToolbarButton>
        <ToolbarButton title="上标" active={textStyle?.superscript} onClick={() => onFormat?.('superscript')}>
          <Superscript size={16} />
        </ToolbarButton>
        <ToolbarButton title="下标" active={textStyle?.subscript} onClick={() => onFormat?.('subscript')}>
          <Subscript size={16} />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton title="清除格式" onClick={() => onFormat?.('clearFormat')}>
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
        <ToolbarButton title="插入分隔线" onClick={() => onInsert?.('separator')}>
          <Minus size={16} />
        </ToolbarButton>
        <ToolbarButton title="插入表格" onClick={() => onInsert?.('table')}>
          <Table size={16} />
        </ToolbarButton>
        <ToolbarButton title="合并单元格" onClick={() => onFormat?.('mergeCells')}>
          <Combine size={16} />
        </ToolbarButton>
        <ToolbarButton title="拆分单元格" onClick={() => onFormat?.('splitCell')}>
          <Ungroup size={16} />
        </ToolbarButton>
        <ToolbarButton title="插入图片" onClick={() => onInsert?.('image')}>
          <Image size={16} />
        </ToolbarButton>
        <InsertControlDropdown onInsert={onInsert} />
        <FieldDropdown onInsert={onInsert} />
        <ToolbarButton title="插入书签" onClick={() => onFormat?.('openBookmark')}>
          <Bookmark size={16} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组7：段落格式 */}
      <ToolbarGroup>
        <ToolbarButton title="左对齐" active={paraStyle?.alignment === 'left' || !paraStyle?.alignment} onClick={() => onFormat?.('alignLeft')}>
          <AlignLeft size={16} />
        </ToolbarButton>
        <ToolbarButton title="居中" active={paraStyle?.alignment === 'center'} onClick={() => onFormat?.('alignCenter')}>
          <AlignCenter size={16} />
        </ToolbarButton>
        <ToolbarButton title="右对齐" active={paraStyle?.alignment === 'right'} onClick={() => onFormat?.('alignRight')}>
          <AlignRight size={16} />
        </ToolbarButton>
        <ToolbarButton title="两端对齐" onClick={() => onFormat?.('alignJustify')}>
          <AlignJustify size={16} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组8：列表 + 缩进 */}
      <ToolbarGroup>
        <ToolbarButton title="无序列表" active={paraStyle?.listType === 'bullet'} onClick={() => onFormat?.('unorderedList')}>
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton title="有序列表" active={paraStyle?.listType === 'ordered'} onClick={() => onFormat?.('orderedList')}>
          <ListOrdered size={16} />
        </ToolbarButton>
        {paraStyle?.listType === 'ordered' && (
          <NumberStyleDropdown
            selected={paraStyle?.numberStyle || 'decimal'}
            onSelect={(ns) => onFormat?.('orderedListNumberStyle', ns)}
          />
        )}
        <ToolbarButton title="减少缩进" onClick={() => onFormat?.('outdent')}>
          <Outdent size={16} />
        </ToolbarButton>
        <ToolbarButton title="增加缩进" onClick={() => onFormat?.('indent')}>
          <Indent size={16} />
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

      {/* 组10：文件操作 */}
      <ToolbarGroup>
        <ToolbarButton title="页面设置" onClick={onPageSetup}>
          <Settings size={16} />
        </ToolbarButton>
        <ToolbarButton title="打印" onClick={onPrint}>
          <Printer size={16} />
        </ToolbarButton>
        <ExportDropdown onExportClick={onExportClick} />
      </ToolbarGroup>
    </div>
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
  const textStyle = useEditorStore((s) => s.textStyle)
  const selected = textStyle?.font || 'SimSun'
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-1 px-2 py-1 text-sm text-gray-700
                            hover:bg-gray-100 rounded-md min-w-[90px] h-8
                            data-[state=open]:bg-gray-100">
          <span className="truncate">{FONT_FAMILIES.find(f => f.value === selected)?.label || '宋体'}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[150px] bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
          sideOffset={4} align="start"
        >
          {FONT_FAMILIES.map(f => (
            <DropdownMenu.Item
              key={f.value}
              className="px-3 py-1.5 text-sm text-gray-700 outline-none cursor-default
                         data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700"
              style={{ fontFamily: f.value }}
              onClick={() => onSelect(f.value)}
            >
              {f.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 字号下拉 ----

function FontSizeDropdown({ onSelect }: { onSelect: (size: number) => void }) {
  const textStyle = useEditorStore((s) => s.textStyle)
  const selected = textStyle?.size || 16
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-1 px-2 py-1 text-sm text-gray-700
                            hover:bg-gray-100 rounded-md min-w-[50px] h-8
                            data-[state=open]:bg-gray-100">
          <span>{selected}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[60px] max-h-[280px] overflow-y-auto overflow-x-hidden bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
          sideOffset={4} align="start"
        >
          {FONT_SIZES.map(s => (
            <DropdownMenu.Item
              key={s}
              className="px-3 py-1.5 text-sm text-gray-700 outline-none cursor-default
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

// ---- 文字颜色选择器 ----

function ColorPicker({ onSelect }: { onSelect: (color: string) => void }) {
  const textStyle = useEditorStore((s) => s.textStyle)
  const currentColor = textStyle?.color || '#000000'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="toolbar-btn data-[state=open]:bg-gray-100 relative"
          title={`文字颜色 (${currentColor})`}
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
          className="bg-white rounded-md shadow-lg border border-gray-200 p-2 z-50"
          sideOffset={4} align="start"
        >
          <div className="grid grid-cols-7 gap-1">
            {COLORS.map(color => (
              <DropdownMenu.Item
                key={color}
                className="w-6 h-6 rounded-sm border border-gray-200 outline-none cursor-pointer
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
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 px-2 py-1 text-sm text-gray-600
                     hover:bg-gray-100 rounded-md h-8 data-[state=open]:bg-gray-100"
          title="插入表单控件"
        >
          <ChevronsUpDown size={14} />
          <span className="hidden lg:inline text-xs">控件</span>
          <ChevronDown size={10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[200px] bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
          sideOffset={4} align="start"
        >
          {CONTROLS.map(({ type, label, description, icon }) => (
            <DropdownMenu.Item
              key={type}
              className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 outline-none cursor-default
                         data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700 transition-colors"
              onClick={() => onInsert?.(type)}
            >
              <span className="flex-shrink-0 text-gray-400">{icon}</span>
              <div className="flex flex-col min-w-0">
                <span className="font-medium">{label}</span>
                <span className="text-xs text-gray-400">{description}</span>
              </div>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 标题样式下拉 (TASK-457) ----

const HEADING_STYLES = [
  { label: '正文', value: 0 },
  { label: '标题 1', value: 1 },
  { label: '标题 2', value: 2 },
  { label: '标题 3', value: 3 },
  { label: '标题 4', value: 4 },
  { label: '标题 5', value: 5 },
  { label: '标题 6', value: 6 },
]

function HeadingDropdown({ onSelect }: { onSelect: (level: number) => void }) {
  const paraStyle = useEditorStore((s) => s.paragraphStyle)
  const selected = paraStyle?.outlineLevel ?? 0
  const label = HEADING_STYLES.find(h => h.value === selected)?.label || '正文'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 px-2 py-1 text-sm text-gray-700
                     hover:bg-gray-100 rounded-md min-w-[70px] h-8
                     data-[state=open]:bg-gray-100"
          title="标题样式"
        >
          <Heading size={14} />
          <span className="truncate">{label}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[120px] bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
          sideOffset={4} align="start"
        >
          {HEADING_STYLES.map(h => (
            <DropdownMenu.Item
              key={h.value}
              className="px-3 py-1.5 text-sm text-gray-700 outline-none cursor-default
                         data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700"
              style={h.value >= 1 ? {
                fontSize: [0, 28, 24, 20, 18, 16, 14][h.value],
                fontWeight: h.value >= 1 ? 'bold' : 'normal',
              } : undefined}
              onClick={() => onSelect(h.value)}
            >
              {h.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 导出下拉 ----

function ExportDropdown({ onExportClick }: { onExportClick?: () => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 px-2 py-1 text-sm text-gray-600
                     hover:bg-gray-100 rounded-md h-8 data-[state=open]:bg-gray-100"
          title="导出"
        >
          <Download size={14} />
          <span className="hidden lg:inline">导出</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[140px] bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
          sideOffset={4} align="end"
        >
          <DropdownMenu.Item
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 outline-none cursor-default
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
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 px-2 py-1 text-sm rounded-md h-8 transition-colors',
            hfEdit.active
              ? 'bg-blue-50 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100',
          )}
          title="页眉页脚"
        >
          <PanelTop size={15} />
          <span className="hidden lg:inline text-xs">页眉页脚</span>
          <ChevronDown size={10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[130px] bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
          sideOffset={4} align="end"
        >
          <DropdownMenu.Item
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm outline-none cursor-default transition-colors',
              hfEdit.active && hfEdit.section === 'header'
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-700 data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700',
            )}
            onClick={() => onEnterEdit('header')}
          >
            <PanelTop size={14} />
            <span>编辑页眉</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm outline-none cursor-default transition-colors',
              hfEdit.active && hfEdit.section === 'footer'
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-700 data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700',
            )}
            onClick={() => onEnterEdit('footer')}
          >
            <PanelTop size={14} className="rotate-180" />
            <span>编辑页脚</span>
          </DropdownMenu.Item>
          {hfEdit.active && (
            <>
              <div className="h-px bg-gray-100 my-1" />
              <DropdownMenu.Item
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 outline-none cursor-default
                           data-[highlighted]:bg-red-50 data-[highlighted]:text-red-600 transition-colors"
                onClick={() => onEnterEdit(hfEdit.section)}
              >
                <span>关闭页眉页脚</span>
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ---- 域代码插入下拉 (R39) ----

const FIELD_ITEMS: { type: string; label: string; icon: React.ReactNode; shortcut?: string }[] = [
  { type: 'pageNumber', label: '页码', icon: <Hash size={14} />, shortcut: 'PAGE' },
  { type: 'totalPages', label: '总页数', icon: <FileText size={14} />, shortcut: 'NUMPAGES' },
  { type: 'currentDate', label: '当前日期', icon: <Calendar size={14} />, shortcut: 'DATE' },
  { type: 'currentTime', label: '当前时间', icon: <Clock size={14} />, shortcut: 'TIME' },
  { type: 'authorName', label: '作者名称', icon: <User size={14} />, shortcut: 'AUTHOR' },
  { type: 'documentTitle', label: '文档标题', icon: <FileText size={14} />, shortcut: 'TITLE' },
  { type: 'lastSavedDate', label: '最后保存日期', icon: <Clock size={14} />, shortcut: 'SAVEDATE' },
  { type: 'printDate', label: '打印日期', icon: <Calendar size={14} />, shortcut: 'PRINTDATE' },
]

function FieldDropdown({ onInsert }: { onInsert?: (type: string) => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          title="插入域代码"
          className="toolbar-btn flex items-center gap-0.5"
        >
          <Hash size={16} />
          <ChevronDown size={10} className="text-gray-400" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[180px] bg-white rounded-md shadow-lg border border-gray-200
                     py-1 z-50 animate-in fade-in-80"
          sideOffset={4}
        >
          <div className="px-2 py-1 text-[10px] text-gray-400 uppercase tracking-wider">
            插入域代码
          </div>
          {FIELD_ITEMS.map(item => (
            <DropdownMenu.Item
              key={item.type}
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-700
                         hover:bg-gray-100 rounded mx-1 cursor-pointer outline-none"
              onClick={() => onInsert?.(item.type)}
            >
              <span className="flex-shrink-0 text-gray-400">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="text-[10px] text-gray-400 font-mono">{item.shortcut}</span>
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
  const textStyle = useEditorStore((s) => s.textStyle)
  const currentHighlight = textStyle?.highlight || 'transparent'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="toolbar-btn data-[state=open]:bg-gray-100 relative"
          title={`文字高亮 (${currentHighlight === 'transparent' ? '无' : currentHighlight})`}
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
          className="bg-white rounded-md shadow-lg border border-gray-200 p-2 z-50"
          sideOffset={4} align="start"
        >
          <div className="grid grid-cols-7 gap-1">
            <DropdownMenu.Item
              className="w-6 h-6 rounded-sm border border-gray-200 outline-none cursor-pointer
                         flex items-center justify-center text-[10px] text-gray-400
                         data-[highlighted]:ring-2 data-[highlighted]:ring-blue-400"
              onClick={() => onSelect('transparent')}
            >
              ✕
            </DropdownMenu.Item>
            {HIGHLIGHT_COLORS.map(color => (
              <DropdownMenu.Item
                key={color}
                className="w-6 h-6 rounded-sm border border-gray-200 outline-none cursor-pointer
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

const NUMBER_STYLES: { label: string; value: string; sample: string }[] = [
  { label: '1, 2, 3',        value: 'decimal',          sample: '1' },
  { label: 'a, b, c',        value: 'lower_alpha',      sample: 'a' },
  { label: 'A, B, C',        value: 'upper_alpha',      sample: 'A' },
  { label: 'i, ii, iii',     value: 'lower_roman',      sample: 'i' },
  { label: 'I, II, III',     value: 'upper_roman',      sample: 'I' },
  { label: '一, 二, 三',     value: 'cjk_ideographic',  sample: '一' },
]

function NumberStyleDropdown({ selected, onSelect }: { selected: string; onSelect: (value: string) => void }) {
  const current = NUMBER_STYLES.find(n => n.value === selected) || NUMBER_STYLES[0]

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-0.5 px-1.5 py-1 text-xs text-gray-500
                     hover:bg-gray-100 rounded-md h-8 data-[state=open]:bg-gray-100"
          title="编号样式"
        >
          <span className="font-mono text-gray-600">{current.sample}</span>
          <ChevronDown size={10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[120px] bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
          sideOffset={4} align="start"
        >
          {NUMBER_STYLES.map(n => (
            <DropdownMenu.Item
              key={n.value}
              className={cn(
                'px-3 py-1.5 text-sm outline-none cursor-default transition-colors',
                n.value === selected
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700',
              )}
              onClick={() => onSelect(n.value)}
            >
              <span className="font-mono">{n.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
