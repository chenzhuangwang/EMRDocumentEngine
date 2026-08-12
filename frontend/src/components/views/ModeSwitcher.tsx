// ============================================================
// ModeSwitcher — 编辑器模式切换下拉 (StatusBar 内嵌)
// ============================================================

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Edit3, Eye, FormInput, Type, PenTool, Printer, ChevronDown } from 'lucide-react'
import type { EditorMode } from '@/engine'

interface ModeSwitcherProps {
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
}

const MODES: { mode: EditorMode; label: string; icon: typeof Edit3 }[] = [
  { mode: 'edit',     label: '编辑',   icon: Edit3 },
  { mode: 'readonly', label: '只读',   icon: Eye },
  { mode: 'form',     label: '表单',   icon: FormInput },
  { mode: 'clean',    label: '纯文本', icon: Type },
  { mode: 'design',   label: '设计',   icon: PenTool },
  { mode: 'print',    label: '打印',   icon: Printer },
]

export function ModeSwitcher({ mode, onModeChange }: ModeSwitcherProps) {
  const current = MODES.find(m => m.mode === mode) || MODES[0]
  const Icon = current.icon

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-gray-600
                     p-0.5 rounded transition-colors hover:bg-gray-100 data-[state=open]:bg-gray-100"
          title="切换编辑器模式"
        >
          <Icon size={12} />
          <span className="hidden sm:inline">{current.label}</span>
          <ChevronDown size={10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[100px] bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
          sideOffset={4} align="end"
        >
          {MODES.map(item => (
            <DropdownMenu.Item
              key={item.mode}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 outline-none
                         cursor-default data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700"
              onClick={() => onModeChange(item.mode)}
            >
              <item.icon size={14} />
              <span>{item.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
