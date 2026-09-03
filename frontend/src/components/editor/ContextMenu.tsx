// ============================================================
// ContextMenu — 编辑器右键菜单 (UI 层)
//
// 内部包裹 Radix DropdownMenu (设计 v2 修正 ⑤: 复用 DropdownMenu,
// 不引入独立的 react-context-menu), 以受控 open + 固定定位在右键坐标处呈现。
// 仅承担呈现与回调转发; 菜单条目与动作分派见 contextMenuModel / useEditorContextMenu。
// ============================================================

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ContextMenuActionId, ContextMenuEntry } from './contextMenuModel'

interface ContextMenuProps {
  open: boolean
  x: number
  y: number
  entries: ContextMenuEntry[]
  onClose: () => void
  onAction: (id: ContextMenuActionId) => void
}

const ITEM_CLASS =
  'flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 outline-none ' +
  'cursor-default data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700 ' +
  'data-[disabled]:text-gray-300 data-[disabled]:cursor-not-allowed'

export function ContextMenu({ open, x, y, entries, onClose, onAction }: ContextMenuProps) {
  // 无菜单条目 (table/image/separator/sectionBreak/headerFooter/smartText 暂不提供)
  if (entries.length === 0) return null

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
          {entries.map((entry, i) =>
            entry.kind === 'separator' ? (
              <DropdownMenu.Separator key={`sep-${i}`} className="h-px my-1 bg-gray-200" />
            ) : (
              <DropdownMenu.Item
                key={entry.id}
                className={ITEM_CLASS}
                disabled={!entry.enabled}
                onSelect={() => onAction(entry.id)}
              >
                <span className="w-4 flex-shrink-0 text-center text-blue-600">
                  {entry.checked ? '✓' : ''}
                </span>
                <span>{entry.label}</span>
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
