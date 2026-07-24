// ============================================================
// 工具栏
// ============================================================

import {
  Bold,
  Italic,
  Underline,
  Undo2,
  Redo2,
  Strikethrough,
  Superscript,
  Subscript,
  Palette,
  Table,
  Image,
  Download,
  Printer,
  ChevronDown,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Indent,
  Outdent,
  ChevronsUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToolbarProps {
  onFormat?: (action: string, value?: unknown) => void
  onInsert?: (elementType: string) => void
  onExport?: (format: string) => void
  onPrint?: () => void
}

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

      {/* 组2：文本格式化 */}
      <ToolbarGroup>
        <FontSelector />
        <FontSizeSelector />
      </ToolbarGroup>

      <ToolbarDivider />

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

      <ToolbarGroup>
        <ToolbarButton title="文字颜色">
          <Palette size={16} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* 组3：元素插入 */}
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

      {/* 组4：段落格式 */}
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

      <ToolbarGroup>
        <ToolbarButton title="无序列表">
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton title="有序列表">
          <ListOrdered size={16} />
        </ToolbarButton>
        <ToolbarButton title="减少缩进">
          <Outdent size={16} />
        </ToolbarButton>
        <ToolbarButton title="增加缩进">
          <Indent size={16} />
        </ToolbarButton>
      </ToolbarGroup>

      {/* 弹性空间 */}
      <div className="flex-1" />

      {/* 组5：文件操作 */}
      <ToolbarGroup>
        <button
          className="flex items-center gap-1 px-2 py-1 text-sm text-gray-600
                     hover:bg-gray-100 rounded-md transition-colors"
          onClick={onPrint}
        >
          <Printer size={14} />
          <span className="hidden lg:inline">打印</span>
        </button>

        <ExportDropdown onExport={onExport} />
      </ToolbarGroup>
    </div>
  )
}

// ---- 子组件 ----

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="toolbar-btn-group">{children}</div>
}

function ToolbarDivider() {
  return <div className="toolbar-divider" />
}

function ToolbarButton({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className={cn('toolbar-btn', active && 'toolbar-btn-active')}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function FontSelector() {
  return (
    <button className="flex items-center gap-1 px-2 py-1 text-sm text-gray-700
                       hover:bg-gray-100 rounded-md min-w-[90px] h-8">
      <span className="truncate">宋体</span>
      <ChevronDown size={12} />
    </button>
  )
}

function FontSizeSelector() {
  return (
    <button className="flex items-center gap-1 px-2 py-1 text-sm text-gray-700
                       hover:bg-gray-100 rounded-md min-w-[50px] h-8">
      <span>16</span>
      <ChevronDown size={12} />
    </button>
  )
}

function InsertControlDropdown({ onInsert }: { onInsert?: (type: string) => void }) {
  return (
    <div className="relative group">
      <button
        className="flex items-center gap-1 px-2 py-1 text-sm text-gray-600
                   hover:bg-gray-100 rounded-md h-8"
        title="插入控件"
      >
        <ChevronsUpDown size={14} />
        <span className="hidden lg:inline text-xs">控件</span>
        <ChevronDown size={10} />
      </button>
      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200
                      rounded-md shadow-lg py-1 min-w-[120px] z-50
                      hidden group-hover:block">
        {[
          { type: 'input', label: '文本输入' },
          { type: 'select', label: '下拉选择' },
          { type: 'date', label: '日期选择' },
          { type: 'checkbox', label: '复选框' },
          { type: 'number', label: '数字输入' },
          { type: 'textarea', label: '文本域' },
        ].map(({ type, label }) => (
          <button
            key={type}
            className="block w-full text-left px-3 py-1.5 text-sm text-gray-700
                       hover:bg-gray-50"
            onClick={() => onInsert?.(type)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ExportDropdown({ onExport: _onExport }: { onExport?: (format: string) => void }) {
  return (
    <button
      className="flex items-center gap-1 px-2 py-1 text-sm text-gray-600
                 hover:bg-gray-100 rounded-md transition-colors"
      title="导出"
    >
      <Download size={14} />
      <span className="hidden lg:inline">导出</span>
      <ChevronDown size={12} />
    </button>
  )
}
