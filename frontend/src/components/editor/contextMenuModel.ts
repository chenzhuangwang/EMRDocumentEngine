// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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
// P2:        表格结构删除 — cell 命中追加「删除行」「删除列」(经
//            Editor.deleteTableRowAt / deleteTableColumnAt, 复用 TableOps)。
//            单格删除 (矩形网格下语义歧义) 与整表删除均不在范围。
// P2:        图片复制 — image 命中追加「复制」(经 Editor.copyImage →
//            ClipboardManager.copyImage, 复用粘贴管线)。
// P3:        smartText 设计模式右键「属性」(Control Config Dialog, 契约 §12.7)。
// 禁止项 (§十): 单格删除、header/footer 完整菜单 — 均不在实现范围。
//
// v6.1: label 走 i18n。**纯函数不能挂 hook** —— t() 由调用方
// (useEditorContextMenu) 注入; 未注入时回退 zh-CN 字面量。
// ============================================================

import type { EditorContextSnapshot } from '@/engine'
import type { LocaleMessages, LocaleParams } from '@/engine'

/** 翻译函数形态 (由调用方注入 useTranslation().t) */
type T = (key: keyof LocaleMessages, params?: LocaleParams) => string

/** ContextMenuActionId → i18n 键 (单一映射, 不重复两份字面量) */
const LABEL_KEYS: Record<ContextMenuActionId, keyof LocaleMessages> = {
  cut: 'editor.contextMenu.cut',
  copy: 'editor.contextMenu.copy',
  paste: 'editor.contextMenu.paste',
  delete: 'editor.contextMenu.delete',
  deleteRow: 'editor.contextMenu.deleteRow',
  deleteColumn: 'editor.contextMenu.deleteColumn',
  toggleTableGrowable: 'editor.contextMenu.toggleTableGrowable',
  bold: 'editor.contextMenu.bold',
  italic: 'editor.contextMenu.italic',
  underline: 'editor.contextMenu.underline',
  strikeout: 'editor.contextMenu.strikeout',
  clearFormat: 'editor.contextMenu.clearFormat',
  alignLeft: 'editor.contextMenu.alignLeft',
  alignCenter: 'editor.contextMenu.alignCenter',
  alignRight: 'editor.contextMenu.alignRight',
  alignJustify: 'editor.contextMenu.alignJustify',
  increaseIndent: 'editor.contextMenu.increaseIndent',
  decreaseIndent: 'editor.contextMenu.decreaseIndent',
  properties: 'editor.contextMenu.properties',
  insertSection: 'editor.contextMenu.insertSection',
  selectSection: 'editor.contextMenu.selectSection',
  deleteSection: 'editor.contextMenu.deleteSection',
  moveSectionUp: 'editor.contextMenu.moveSectionUp',
  moveSectionDown: 'editor.contextMenu.moveSectionDown',
  editSectionCode: 'editor.contextMenu.editSectionCode',
}

/** zh-CN 兜底 (t 未注入时) —— 与 editor.contextMenu.* 的 zh-CN 值保持一致 */
const FALLBACK: Record<ContextMenuActionId, string> = {
  cut: '剪切', copy: '复制', paste: '粘贴', delete: '删除',
  deleteRow: '删除行', deleteColumn: '删除列', toggleTableGrowable: '填写时可增长',
  bold: '加粗', italic: '斜体', underline: '下划线', strikeout: '删除线', clearFormat: '清除格式',
  alignLeft: '左对齐', alignCenter: '居中', alignRight: '右对齐', alignJustify: '两端对齐',
  increaseIndent: '增加缩进', decreaseIndent: '减少缩进',
  properties: '属性…',
  insertSection: '插入节', selectSection: '选中本节', deleteSection: '删除本节',
  moveSectionUp: '本节上移', moveSectionDown: '本节下移',
  editSectionCode: '设置节代码…',
}

/** id → 显示文案 (t 注入时走 i18n, 否则回退 zh-CN 字面量) */
function labelOf(id: ContextMenuActionId, t?: T): string {
  const key = LABEL_KEYS[id]
  if (t && key) return t(key)
  return FALLBACK[id]
}

export type ContextMenuActionId =
  | 'cut' | 'copy' | 'paste' | 'delete'
  | 'deleteRow' | 'deleteColumn' | 'toggleTableGrowable'
  | 'bold' | 'italic' | 'underline' | 'strikeout' | 'clearFormat'
  | 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignJustify'
  | 'increaseIndent' | 'decreaseIndent'
  | 'properties'
  | 'insertSection' | 'selectSection' | 'deleteSection'
  | 'moveSectionUp' | 'moveSectionDown' | 'editSectionCode'

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

/** 正文文本菜单分组 (text/smartText 共用) */
function textBodyEntries(coversSelection: boolean, style: ContextMenuStyleInfo, t?: T): ContextMenuEntry[] {
  return [
    { kind: 'item', id: 'cut', label: labelOf('cut', t), enabled: coversSelection },
    { kind: 'item', id: 'copy', label: labelOf('copy', t), enabled: true },
    { kind: 'item', id: 'paste', label: labelOf('paste', t), enabled: true },
    { kind: 'item', id: 'delete', label: labelOf('delete', t), enabled: true },
    SEP,
    ...textFormatEntries(style, t),
    SEP,
    ...paragraphStyleEntries(style, t),
    SEP,
    ...listLevelEntries(t),
  ]
}

function textFormatEntries(style: ContextMenuStyleInfo, t?: T): ContextMenuEntry[] {
  const ts = style.textStyle
  return [
    { kind: 'item', id: 'bold', label: labelOf('bold', t), enabled: true, checked: ts?.bold === true },
    { kind: 'item', id: 'italic', label: labelOf('italic', t), enabled: true, checked: ts?.italic === true },
    { kind: 'item', id: 'underline', label: labelOf('underline', t), enabled: true, checked: ts?.underline === true },
    { kind: 'item', id: 'strikeout', label: labelOf('strikeout', t), enabled: true, checked: ts?.strikeout === true },
    { kind: 'item', id: 'clearFormat', label: labelOf('clearFormat', t), enabled: true },
  ]
}

function paragraphStyleEntries(style: ContextMenuStyleInfo, t?: T): ContextMenuEntry[] {
  const align = style.paragraphStyle?.alignment
  return [
    { kind: 'item', id: 'alignLeft', label: labelOf('alignLeft', t), enabled: true, checked: align === 'left' },
    { kind: 'item', id: 'alignCenter', label: labelOf('alignCenter', t), enabled: true, checked: align === 'center' },
    { kind: 'item', id: 'alignRight', label: labelOf('alignRight', t), enabled: true, checked: align === 'right' },
    { kind: 'item', id: 'alignJustify', label: labelOf('alignJustify', t), enabled: true, checked: align === 'justify' },
  ]
}

function listLevelEntries(t?: T): ContextMenuEntry[] {
  return [
    { kind: 'item', id: 'increaseIndent', label: labelOf('increaseIndent', t), enabled: true },
    { kind: 'item', id: 'decreaseIndent', label: labelOf('decreaseIndent', t), enabled: true },
  ]
}

const NO_STYLE: ContextMenuStyleInfo = { textStyle: null, paragraphStyle: null }

/**
 * Section 操作组 (契约 §31.14) —— 追加在正文菜单末尾, **不改 kind**。
 *
 * 条目来源是快照上的 `sectionFact` (边界采集的附加事实), 而不是某个新 kind:
 * Section 没有可命中的 item, 新增 `kind: 'section'` 永远不可达, 还会顶掉
 * 用户此刻真正需要的文本菜单 (见 ContextBase.sectionFact 的注释)。
 *
 * enable 全部由事实推导, 不撒谎:
 *   - 「插入节」需要命中块的真实父容器是 body / section (§31.13; cell 内非法)
 *   - 上移/下移在首/末位置灰 —— 与 Editor.moveSectionUp/Down 的前置边界检查一致
 *     (那里返回 false 且不进 undo 栈, 二者同源)
 *   - 其余仅要求"命中点在某节里"
 */
function sectionEntries(fact: EditorContextSnapshot['sectionFact'], t?: T): ContextMenuEntry[] {
  const inSection = fact !== null
  const entries: ContextMenuEntry[] = []
  if (fact?.insertable) {
    entries.push({ kind: 'item', id: 'insertSection', label: labelOf('insertSection', t), enabled: true })
  }
  entries.push(
    { kind: 'item', id: 'selectSection', label: labelOf('selectSection', t), enabled: inSection },
    { kind: 'item', id: 'editSectionCode', label: labelOf('editSectionCode', t), enabled: inSection },
    { kind: 'item', id: 'moveSectionUp', label: labelOf('moveSectionUp', t), enabled: inSection && fact!.index > 0 },
    {
      kind: 'item', id: 'moveSectionDown', label: labelOf('moveSectionDown', t),
      enabled: inSection && fact!.index < fact!.siblingCount - 1,
    },
    { kind: 'item', id: 'deleteSection', label: labelOf('deleteSection', t), enabled: inSection },
  )
  // 整组都不可用 (既不在节里、也不可插入) → 不显示, 避免空占位
  return entries.some((e) => e.kind === 'item' && e.enabled) ? [SEP, ...entries] : []
}

/**
 * 由上下文快照 + 样式投影派生菜单条目 (纯函数)。
 *
 * - text (body 段): 剪切、复制、粘贴、删除 + 文本格式 (含勾选) + 段落样式 (含勾选)
 *   + 列表层级。删除始终可用 — 覆盖选区删选区, 折叠选区删整段 (设计 v2 §6)。
 * - cell:          同上, 但剪切/删除仅在命中点覆盖当前选区时可用
 *   (折叠选区不删 cell 段落, P2 再定); 追加「删除行」「删除列」
 *   (P2 表格结构删除)。
 * - image:         复制 + 删除 (复制经 Editor.copyImage, 删除经 Editor.deleteNode
 *   门面)。
 * - blank:         粘贴 (光标位置粘贴)。
 * - smartText:     交互模式 (design/edit/form) 控件右键 → 「属性」(设计态业务
 *   动作, 经 ContextMenuActionId 'properties' 由 EditorPage 映射到 Control
 *   Config Dialog)。resolveContextAt 只在上述模式上报控件命中, 故属性项
 *   天然不出现在只读/打印模式的正文右键里。
 * - 其余种类 (table/separator/sectionBreak/headerFooterRegion):
 *   无对应菜单项, 返回空列表 (不弹出菜单)。
 *
 * @param t 可选翻译函数 (useTranslation().t); 缺省回退 zh-CN 字面量
 */
export function buildContextMenuModel(
  snapshot: EditorContextSnapshot,
  style: ContextMenuStyleInfo = NO_STYLE,
  t?: T,
): ContextMenuModel {
  switch (snapshot.kind) {
    case 'text':
      return { entries: [...textBodyEntries(snapshot.coversSelection, style, t), ...sectionEntries(snapshot.sectionFact, t)] }
    case 'cell':
      return {
        entries: [
          { kind: 'item', id: 'cut', label: labelOf('cut', t), enabled: snapshot.coversSelection },
          { kind: 'item', id: 'copy', label: labelOf('copy', t), enabled: true },
          { kind: 'item', id: 'paste', label: labelOf('paste', t), enabled: true },
          { kind: 'item', id: 'delete', label: labelOf('delete', t), enabled: snapshot.coversSelection },
          SEP,
          { kind: 'item', id: 'deleteRow', label: labelOf('deleteRow', t), enabled: true },
          { kind: 'item', id: 'deleteColumn', label: labelOf('deleteColumn', t), enabled: true },
          SEP,
          // 可增长表开关 (契约 §12.9)。设计期属性, 但 cell 命中在全部模式可达 ——
          // 真正的强制在命令层 (非可增长表 append 必被拒), 此处只提供入口。
          {
            kind: 'item', id: 'toggleTableGrowable', label: labelOf('toggleTableGrowable', t),
            enabled: true, checked: snapshot.tableGrowable,
          },
          SEP,
          ...textFormatEntries(style, t),
          SEP,
          ...paragraphStyleEntries(style, t),
          SEP,
          ...listLevelEntries(t),
          ...sectionEntries(snapshot.sectionFact, t),
        ],
      }
    case 'image':
      return {
        entries: [
          { kind: 'item', id: 'copy', label: labelOf('copy', t), enabled: true },
          { kind: 'item', id: 'delete', label: labelOf('delete', t), enabled: true },
        ],
      }
    case 'blank':
      return {
        entries: [
          { kind: 'item', id: 'paste', label: labelOf('paste', t), enabled: true },
        ],
      }
    case 'smartText':
      // 控件右键 = 完整正文菜单 + 分隔后的「属性」(控件删除走 deleteSelectedControl)
      return {
        entries: [
          ...textBodyEntries(true, style, t),
          SEP,
          { kind: 'item', id: 'properties', label: labelOf('properties', t), enabled: true },
        ],
      }
    default:
      return { entries: [] }
  }
}