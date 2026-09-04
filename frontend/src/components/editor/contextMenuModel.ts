// ============================================================
// contextMenuModel — 右键菜单呈现模型 (UI 层, 纯函数)
//
// 由 EditorContextSnapshot (引擎只读快照) + 光标处样式投影
// (EditorStoreState.textStyle / paragraphStyle) 派生菜单条目。
// 条目只描述呈现 (kind / id / label / enabled / checked), 不含编辑器逻辑;
// 动作通过 ContextMenuActionId 在 useEditorContextMenu 中分派到 Editor API。
//
// P0 范围 (§七): 复制 / 粘贴 / 删除。
// P1-a 追加: 文本格式 (加粗/斜体/下划线/删除线/清除格式)、
//            段落样式 (对齐)、列表层级 (增减缩进)。
// P1-a 增量: 勾选状态 (checked) — 由样式投影推导, 反映光标处当前格式。
// P1-b:      剪切 (严格原子 cut, 契约 RULE 11)。
// P1-c:      删除段落 (body 段折叠选区「删除」即删整段) + image 删除
//            (经 Editor.deleteNode 门面, 设计 v2 §6)。
// 禁止项 (§十): 图片复制、cell/row/column 删除、header/footer 完整菜单、
// SmartText 属性面板 — 均不在实现范围。
// ============================================================

import type { EditorContextSnapshot } from '@/engine'

export type ContextMenuActionId =
  | 'cut' | 'copy' | 'paste' | 'delete'
  | 'bold' | 'italic' | 'underline' | 'strikeout' | 'clearFormat'
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignJustify'
  | 'increaseIndent' | 'decreaseIndent'

/** 可点击的菜单项 */
export interface ContextMenuEntryItem {
  kind: 'item'
  id: ContextMenuActionId
  label: string
  enabled: boolean
  /** 选中态 (格式/对齐项); 无状态动作 (复制/粘贴/删除/清除格式/缩进) 不设置 */
  checked?: boolean
}

/** 分组分隔符 */
export interface ContextMenuEntrySeparator {
  kind: 'separator'
}

export type ContextMenuEntry = ContextMenuEntryItem | ContextMenuEntrySeparator

export interface ContextMenuModel {
  entries: ContextMenuEntry[]
}

/** 样式投影输入 (与 EditorStoreState.textStyle / paragraphStyle 结构兼容) */
export interface ContextMenuStyleInfo {
  textStyle: { bold?: boolean; italic?: boolean; underline?: boolean; strikeout?: boolean } | null
  paragraphStyle: { alignment?: string } | null
}

const SEP: ContextMenuEntrySeparator = { kind: 'separator' }

function textFormatEntries(style: ContextMenuStyleInfo): ContextMenuEntry[] {
  const ts = style.textStyle
  return [
    { kind: 'item', id: 'bold', label: '加粗', enabled: true, checked: ts?.bold === true },
    { kind: 'item', id: 'italic', label: '斜体', enabled: true, checked: ts?.italic === true },
    { kind: 'item', id: 'underline', label: '下划线', enabled: true, checked: ts?.underline === true },
    { kind: 'item', id: 'strikeout', label: '删除线', enabled: true, checked: ts?.strikeout === true },
    { kind: 'item', id: 'clearFormat', label: '清除格式', enabled: true },
  ]
}

function paragraphStyleEntries(style: ContextMenuStyleInfo): ContextMenuEntry[] {
  const align = style.paragraphStyle?.alignment
  return [
    { kind: 'item', id: 'alignLeft', label: '左对齐', enabled: true, checked: align === 'left' },
    { kind: 'item', id: 'alignCenter', label: '居中', enabled: true, checked: align === 'center' },
    { kind: 'item', id: 'alignRight', label: '右对齐', enabled: true, checked: align === 'right' },
    { kind: 'item', id: 'alignJustify', label: '两端对齐', enabled: true, checked: align === 'justify' },
  ]
}

function listLevelEntries(): ContextMenuEntry[] {
  return [
    { kind: 'item', id: 'increaseIndent', label: '增加缩进', enabled: true },
    { kind: 'item', id: 'decreaseIndent', label: '减少缩进', enabled: true },
  ]
}

const NO_STYLE: ContextMenuStyleInfo = { textStyle: null, paragraphStyle: null }

/**
 * 由上下文快照 + 样式投影派生菜单条目 (纯函数)。
 *
 * - text (body 段): 剪切、复制、粘贴、删除 + 文本格式 (含勾选) + 段落样式 (含勾选)
 *   + 列表层级。删除始终可用 — 覆盖选区删选区, 折叠选区删整段 (设计 v2 §6)。
 * - cell:          同上, 但剪切/删除仅在命中点覆盖当前选区时可用
 *   (折叠选区不删 cell 段落, P2 再定)。
 * - image:         仅「删除」 (经 Editor.deleteNode 门面)。
 * - blank:         粘贴 (光标位置粘贴)。
 * - 其余种类 (table/separator/sectionBreak/headerFooterRegion/smartText):
 *   无对应菜单项, 返回空列表 (不弹出菜单)。
 */
export function buildContextMenuModel(
  snapshot: EditorContextSnapshot,
  style: ContextMenuStyleInfo = NO_STYLE,
): ContextMenuModel {
  switch (snapshot.kind) {
    case 'text':
      return {
        entries: [
          { kind: 'item', id: 'cut', label: '剪切', enabled: snapshot.coversSelection },
          { kind: 'item', id: 'copy', label: '复制', enabled: true },
          { kind: 'item', id: 'paste', label: '粘贴', enabled: true },
          { kind: 'item', id: 'delete', label: '删除', enabled: true },
          SEP,
          ...textFormatEntries(style),
          SEP,
          ...paragraphStyleEntries(style),
          SEP,
          ...listLevelEntries(),
        ],
      }
    case 'cell':
      return {
        entries: [
          { kind: 'item', id: 'cut', label: '剪切', enabled: snapshot.coversSelection },
          { kind: 'item', id: 'copy', label: '复制', enabled: true },
          { kind: 'item', id: 'paste', label: '粘贴', enabled: true },
          { kind: 'item', id: 'delete', label: '删除', enabled: snapshot.coversSelection },
          SEP,
          ...textFormatEntries(style),
          SEP,
          ...paragraphStyleEntries(style),
          SEP,
          ...listLevelEntries(),
        ],
      }
    case 'image':
      return {
        entries: [
          { kind: 'item', id: 'delete', label: '删除', enabled: true },
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
