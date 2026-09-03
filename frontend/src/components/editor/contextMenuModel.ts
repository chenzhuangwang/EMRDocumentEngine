// ============================================================
// contextMenuModel — 右键菜单呈现模型 (UI 层, 纯函数)
//
// 由 EditorContextSnapshot (引擎只读快照) 派生菜单项。
// 菜单项只描述呈现 (id / label / enabled), 不含编辑器逻辑;
// 动作通过 ContextMenuActionId 在 useEditorContextMenu 中分派到 Editor API。
//
// P0 范围 (§七): 仅 复制 / 粘贴 / 删除。
// 禁止项 (§十): 剪切 (严格原子 cut)、图片复制、完整 deleteNode、
// 页眉页脚完整菜单、SmartText 属性面板 — 均不在 P0 实现。
// ============================================================

import type { EditorContextSnapshot } from '@/engine'

export type ContextMenuActionId = 'copy' | 'paste' | 'delete'

export interface ContextMenuItem {
  id: ContextMenuActionId
  label: string
  enabled: boolean
}

export interface ContextMenuModel {
  items: ContextMenuItem[]
}

/**
 * 由上下文快照派生菜单项 (纯函数)。
 *
 * - text / cell: 复制、粘贴、删除 (删除仅在命中点覆盖当前选区时可用)。
 * - blank:       粘贴 (光标位置粘贴)。
 * - 其余种类 (table/image/separator/sectionBreak/headerFooterRegion/smartText):
 *   P0 无对应菜单项, 返回空列表 (不弹出菜单)。
 */
export function buildContextMenuModel(snapshot: EditorContextSnapshot): ContextMenuModel {
  switch (snapshot.kind) {
    case 'text':
    case 'cell':
      return {
        items: [
          { id: 'copy', label: '复制', enabled: true },
          { id: 'paste', label: '粘贴', enabled: true },
          { id: 'delete', label: '删除', enabled: snapshot.coversSelection },
        ],
      }
    case 'blank':
      return {
        items: [
          { id: 'paste', label: '粘贴', enabled: true },
        ],
      }
    default:
      return { items: [] }
  }
}
