// ============================================================
// ContextMenu — 编辑器右键菜单 (UI 层)
//
// 内部包裹 Radix DropdownMenu (设计 v2 修正 ⑤: 复用 DropdownMenu,
// 不引入独立的 react-context-menu), 以受控 open + 固定定位在右键坐标处呈现。
// 仅承担呈现与回调转发; 菜单项与动作分派见 contextMenuModel / useEditorContextMenu。
// ============================================================

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ContextMenuItem } from './contextMenuModel'

interface ContextMenuProps {
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  onAction: (id: ContextMenuItem['id']) => void
}

export function ContextMenu({ open, x, y, items, onClose, onAction }: ContextMenuProps) {
  // 无菜单项 (P0 对 table/image/separator/sectionBreak/headerFooter/smartText 暂不提供)
  if (items.length === 0) return null

  return (
    <DropdownMenu.Root
      open={open}
      modal={false}
      onOpenChange={(next) => { if (!next) onClose() }}
    >
      <DropdownMenu.Trigger asChild>
        {/* 不可见触发器: 固定定位在右键坐标, 供 Popper 将内容锚定到该点 */}
        <span
          aria-hidden
          style={{ position: 'fixed', left: x, top: y, width: 0, height: 0 }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[160px] bg-white rounded-md shadow-lg border border-gray-200 py-1 z-[1000]"
          side="bottom"
          align="start"
          sideOffset={2}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 outline-none
                         cursor-default data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700
                         data-[disabled]:text-gray-300 data-[disabled]:cursor-not-allowed"
              disabled={!item.enabled}
              onSelect={() => onAction(item.id)}
            >
              <span>{item.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
