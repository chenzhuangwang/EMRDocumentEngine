// ============================================================
// 工具栏 - 完整实现
// ============================================================

import {
  Bold, Italic, Underline, Undo2, Redo2, Strikethrough,
  Superscript, Subscript, Palette, Table, Image, Download,
  Printer, ChevronDown, AlignLeft, AlignCenter, AlignRight,
  AlignJustify, List, ListOrdered, Indent, Outdent,
  ChevronsUpDown, Type, ListFilter, Calendar, CheckSquare,
  Circle, Hash, RectangleEllipsis, FileText, FileJson,
} from 'lucide-react'
import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

interface ToolbarProps {
  onFormat?: (action: string, value?: unknown) => void
  onInsert?: (elementType: string) => void
  onExport?: (format: string) => void
  onPrint?: () => void
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
export function Toolbar({ onFormat, onInsert, onExport, onPrint }: ToolbarProps) {
  return (
    <div className="h-toolbar bg-white border-b border-gray-100 flex items-center px-3 gap-0.5 flex-shrink-0 overflow-x-auto select-none">
      {/* 组1：历史操作 */}
      <ToolbarGroup>
        <ToolbarButton title="撤销 (Ctrl+Z)" onClick={() => onFormat?.('undo')}>
          <Undo2 size={16} />
        </ToolbarButton>
        <ToolbarButton title="重做 (Ctrl+Y)" onClick={() => onFormat?.('redo')}>
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

      {/* 组3：文本样式 */}
      <ToolbarGroup>
        <ToolbarButton title="加粗 (Ctrl+B)" onClick={() => onFormat?.('bold')}>
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton title="斜体 (Ctrl+I)" onClick={() => onFormat?.('italic')}>
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton title="下划线 (Ctrl+U)" onClick={() => onFormat?.('underline')}>
          <Underline size={16} />
        </ToolbarButton>
        <ToolbarButton title="删除线" onClick={() => onFormat?.('strikeout')}>
          <Strikethrough size={16} />
        </ToolbarButton>
        <ToolbarButton title="上标" onClick={() => onFormat?.('superscript')}>
          <Superscript size={16} />
        </ToolbarButton>
        <ToolbarButton title="下标" onClick={() => onFormat?.('subscript')}>
          <Subscript size={16} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组4：文字颜色 */}
      <ToolbarGroup>
        <ColorPicker onSelect={(color) => onFormat?.('color', color)} />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组5：元素插入 */}
      <ToolbarGroup>
        <ToolbarButton title="插入表格" onClick={() => onInsert?.('table')}>
          <Table size={16} />
        </ToolbarButton>
        <ToolbarButton title="插入图片" onClick={() => onInsert?.('image')}>
          <Image size={16} />
        </ToolbarButton>
        <InsertControlDropdown onInsert={onInsert} />
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组6：段落格式 */}
      <ToolbarGroup>
        <ToolbarButton title="左对齐" onClick={() => onFormat?.('alignLeft')}>
          <AlignLeft size={16} />
        </ToolbarButton>
        <ToolbarButton title="居中" onClick={() => onFormat?.('alignCenter')}>
          <AlignCenter size={16} />
        </ToolbarButton>
        <ToolbarButton title="右对齐" onClick={() => onFormat?.('alignRight')}>
          <AlignRight size={16} />
        </ToolbarButton>
        <ToolbarButton title="两端对齐" onClick={() => onFormat?.('alignJustify')}>
          <AlignJustify size={16} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组7：列表 + 缩进 */}
      <ToolbarGroup>
        <ToolbarButton title="无序列表" onClick={() => onFormat?.('unorderedList')}>
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton title="有序列表" onClick={() => onFormat?.('orderedList')}>
          <ListOrdered size={16} />
        </ToolbarButton>
        <ToolbarButton title="减少缩进" onClick={() => onFormat?.('outdent')}>
          <Outdent size={16} />
        </ToolbarButton>
        <ToolbarButton title="增加缩进" onClick={() => onFormat?.('indent')}>
          <Indent size={16} />
        </ToolbarButton>
      </ToolbarGroup>

      {/* 弹性空间 */}
      <div className="flex-1" />

      {/* 组8：文件操作 */}
      <ToolbarGroup>
        <ToolbarButton title="打印" onClick={onPrint}>
          <Printer size={16} />
        </ToolbarButton>
        <ExportDropdown onExport={onExport} />
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
  const [selected, setSelected] = useState('SimSun')
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
              onClick={() => { setSelected(f.value); onSelect(f.value) }}
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
  const [selected, setSelected] = useState(16)
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
          className="min-w-[60px] max-h-[280px] overflow-y-auto bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
          sideOffset={4} align="start"
        >
          {FONT_SIZES.map(s => (
            <DropdownMenu.Item
              key={s}
              className="px-3 py-1.5 text-sm text-gray-700 outline-none cursor-default
                         data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700 text-center"
              onClick={() => { setSelected(s); onSelect(s) }}
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
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="toolbar-btn data-[state=open]:bg-gray-100"
          title="文字颜色"
        >
          <Palette size={16} />
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

// ---- 导出下拉 ----

function ExportDropdown({ onExport }: { onExport?: (format: string) => void }) {
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
            onClick={() => onExport?.('pdf')}
          >
            <FileText size={14} />
            <span>导出 PDF</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 outline-none cursor-default
                       data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700"
            onClick={() => onExport?.('word')}
          >
            <FileText size={14} />
            <span>导出 Word</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 outline-none cursor-default
                       data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700"
            onClick={() => onExport?.('json')}
          >
            <FileJson size={14} />
            <span>导出 JSON</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
