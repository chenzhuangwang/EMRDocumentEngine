// ============================================================
// contextMenuModel — 右键菜单呈现模型 (UI 层, 纯函数)
//
// 由 EditorContextSnapshot (引擎只读快照) 派生菜单条目。
// 条目只描述呈现 (kind / id / label / enabled), 不含编辑器逻辑;
// 动作通过 ContextMenuActionId 在 useEditorContextMenu 中分派到 Editor API。
//
// P0 范围 (§七): 复制 / 粘贴 / 删除。
// P1-a 追加: 文本格式 (加粗/斜体/下划线/删除线/清除格式)、
//            段落样式 (对齐)、列表层级 (增减缩进)。
// 禁止项 (§十): 剪切 (严格原子 cut)、图片复制、完整 deleteNode、
// 页眉页脚完整菜单、SmartText 属性面板 — 均不在实现范围。
// ============================================================

import type { EditorContextSnapshot } from '@/engine'

export type ContextMenuActionId =
  | 'copy' | 'paste' | 'delete'
  | 'bold' | 'italic' | 'underline' | 'strikeout' | 'clearFormat'
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignJustify'
  | 'increaseIndent' | 'decreaseIndent'

/** 可点击的菜单项 */
export interface ContextMenuEntryItem {
  kind: 'item'
  id: ContextMenuActionId
  label: string
  enabled: boolean
}

/** 分组分隔符 */
export interface ContextMenuEntrySeparator {
  kind: 'separator'
}

export type ContextMenuEntry = ContextMenuEntryItem | ContextMenuEntrySeparator

export interface ContextMenuModel {
  entries: ContextMenuEntry[]
}

const SEP: ContextMenuEntrySeparator = { kind: 'separator' }

function textFormatEntries(): ContextMenuEntry[] {
  return [
    { kind: 'item', id: 'bold', label: '加粗', enabled: true },
    { kind: 'item', id: 'italic', label: '斜体', enabled: true },
    { kind: 'item', id: 'underline', label: '下划线', enabled: true },
    { kind: 'item', id: 'strikeout', label: '删除线', enabled: true },
    { kind: 'item', id: 'clearFormat', label: '清除格式', enabled: true },
  ]
}

function paragraphStyleEntries(): ContextMenuEntry[] {
  return [
    { kind: 'item', id: 'alignLeft', label: '左对齐', enabled: true },
    { kind: 'item', id: 'alignCenter', label: '居中', enabled: true },
    { kind: 'item', id: 'alignRight', label: '右对齐', enabled: true },
    { kind: 'item', id: 'alignJustify', label: '两端对齐', enabled: true },
  ]
}

function listLevelEntries(): ContextMenuEntry[] {
  return [
    { kind: 'item', id: 'increaseIndent', label: '增加缩进', enabled: true },
    { kind: 'item', id: 'decreaseIndent', label: '减少缩进', enabled: true },
  ]
}

/**
 * 由上下文快照派生菜单条目 (纯函数)。
 *
 * - text / cell: 复制、粘贴、删除 (删除仅在命中点覆盖当前选区时可用) +
 *   文本格式 + 段落样式 + 列表层级。
 * - blank:       粘贴 (光标位置粘贴)。
 * - 其余种类 (table/image/separator/sectionBreak/headerFooterRegion/smartText):
 *   无对应菜单项, 返回空列表 (不弹出菜单)。
 */
export function buildContextMenuModel(snapshot: EditorContextSnapshot): ContextMenuModel {
  switch (snapshot.kind) {
    case 'text':
    case 'cell':
      return {
        entries: [
          { kind: 'item', id: 'copy', label: '复制', enabled: true },
          { kind: 'item', id: 'paste', label: '粘贴', enabled: true },
          { kind: 'item', id: 'delete', label: '删除', enabled: snapshot.coversSelection },
          SEP,
          ...textFormatEntries(),
          SEP,
          ...paragraphStyleEntries(),
          SEP,
          ...listLevelEntries(),
        ],
      }
    case 'blank':
      return {
        entries: [
          { kind: 'item', id: 'paste', label: '粘贴', enabled: true },
        ],
      }
    default:
      return { entries: [] }
  }
}
