// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// contextMenuModel 纯函数测试 (P1-a / P1-c)
//
// 验证 buildContextMenuModel 由上下文快照派生菜单条目:
//   - text: 剪切/复制/粘贴/删除 + 文本格式 + 段落样式 + 列表层级;
//     删除始终可用 (覆盖选区删选区, 折叠选区删整段), 剪切仅在覆盖选区时可用。
//   - cell: 同上, 但剪切/删除仅在命中点覆盖选区时可用; 追加删除行/删除列 (P2)。
//   - image: 复制 + 删除 (P2 图片复制)。
//   - blank: 仅粘贴。
//   - 其余种类: 空条目 (不弹菜单)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildContextMenuModel, type ContextMenuActionId, type ContextMenuEntryItem, type ContextMenuStyleInfo } from '../contextMenuModel'
import type { EditorContextSnapshot, ContextRevisionFact } from '@emrde/document-engine'

/** 提取可点击条目 (过滤分隔符) */
function items(snapshot: EditorContextSnapshot): { id: ContextMenuActionId; enabled: boolean }[] {
  return buildContextMenuModel(snapshot).entries
    .filter((e): e is ContextMenuEntryItem => e.kind === 'item')
    .map((e) => ({ id: e.id, enabled: e.enabled }))
}

/** 提取条目 id 顺序 (含分隔符, 便于验证分组) */
function entryKinds(snapshot: EditorContextSnapshot): ('item' | 'separator')[] {
  return buildContextMenuModel(snapshot).entries.map((e) => e.kind)
}

/** 读取某条目的勾选态 (items() 会丢掉 checked) */
function entryChecked(
  snapshot: EditorContextSnapshot, id: ContextMenuActionId,
): boolean | undefined {
  return buildContextMenuModel(snapshot).entries
    .filter((e): e is ContextMenuEntryItem => e.kind === 'item')
    .find((e) => e.id === id)?.checked
}

const base = { pageIndex: 0, localX: 10, localY: 10, sectionFact: null, revisionFact: null }

function textSnapshot(coversSelection: boolean): EditorContextSnapshot {
  return {
    ...base, kind: 'text', paragraphId: 'p1', paragraphPath: ['doc', 'p1'],
    offset: 3, scope: { type: 'body' }, coversSelection,
  }
}

function cellSnapshot(coversSelection: boolean, tableGrowable = false): EditorContextSnapshot {
  return {
    ...base, kind: 'cell', tableId: 't1', row: 0, col: 1,
    paragraphId: 'p1', paragraphPath: ['doc', 'p1'], offset: 3, coversSelection,
    tableGrowable,
  }
}

describe('buildContextMenuModel 菜单条目 (P1-a)', () => {
  it('text 命中: 剪切/复制/粘贴/删除 + 格式/段落/列表, 覆盖选区时剪切/删除可用', () => {
    const snap = textSnapshot(true)
    expect(items(snap)).toEqual([
      { id: 'cut', enabled: true },
      { id: 'copy', enabled: true },
      { id: 'paste', enabled: true },
      { id: 'delete', enabled: true },
      { id: 'bold', enabled: true },
      { id: 'italic', enabled: true },
      { id: 'underline', enabled: true },
      { id: 'strikeout', enabled: true },
      { id: 'clearFormat', enabled: true },
      { id: 'alignLeft', enabled: true },
      { id: 'alignCenter', enabled: true },
      { id: 'alignRight', enabled: true },
      { id: 'alignJustify', enabled: true },
      { id: 'increaseIndent', enabled: true },
      { id: 'decreaseIndent', enabled: true },
    ])
    // 分组: 4 项 + sep + 5 项 + sep + 4 项 + sep + 2 项
    expect(entryKinds(snap)).toEqual([
      'item', 'item', 'item', 'item', 'separator',
      'item', 'item', 'item', 'item', 'item', 'separator',
      'item', 'item', 'item', 'item', 'separator',
      'item', 'item',
    ])
  })

  it('text 命中但未覆盖选区: 剪切不可用, 删除始终可用 (折叠选区删整段)', () => {
    const list = items(textSnapshot(false))
    expect(list.find((i) => i.id === 'cut')).toEqual({ id: 'cut', enabled: false })
    expect(list.find((i) => i.id === 'delete')).toEqual({ id: 'delete', enabled: true })
    expect(list.find((i) => i.id === 'copy')?.enabled).toBe(true)
  })

  it('cell 命中: 同样提供剪切/格式/段落/列表条目 + 删除行/删除列 + 可增长开关', () => {
    const list = items(cellSnapshot(false))
    expect(list.map((i) => i.id)).toEqual([
      'cut', 'copy', 'paste', 'delete',
      'deleteRow', 'deleteColumn',
      'toggleTableGrowable',
      'bold', 'italic', 'underline', 'strikeout', 'clearFormat',
      'alignLeft', 'alignCenter', 'alignRight', 'alignJustify',
      'increaseIndent', 'decreaseIndent',
    ])
  })

  it('cell 命中: 「填写时可增长」勾选态跟随快照 (契约 §12.9)', () => {
    expect(entryChecked(cellSnapshot(false, false), 'toggleTableGrowable')).toBe(false)
    expect(entryChecked(cellSnapshot(false, true), 'toggleTableGrowable')).toBe(true)
  })

  it('blank: 仅粘贴, 无分隔符', () => {
    const snap: EditorContextSnapshot = { ...base, kind: 'blank' }
    expect(items(snap)).toEqual([{ id: 'paste', enabled: true }])
    expect(entryKinds(snap)).toEqual(['item'])
  })

  it('其余种类 (table/separator/sectionBreak/headerFooter): 空条目', () => {
    const others: EditorContextSnapshot[] = [
      { ...base, kind: 'table', tableId: 't1', tableGrowable: false },
      { ...base, kind: 'separator', nodeId: 's1' },
      { ...base, kind: 'sectionBreak', nodeId: 'sb1' },
      { ...base, kind: 'headerFooterRegion', section: 'header' },
    ]
    for (const snap of others) {
      expect(buildContextMenuModel(snap).entries).toEqual([])
    }
  })

  it('smartText (控件): 完整正文菜单 + 分隔后的「属性」', () => {
    const snap: EditorContextSnapshot = { ...base, kind: 'smartText', controlId: 'c1' }
    const list = items(snap)
    // 完整正文项 (剪切/复制/粘贴/删除 + 格式/对齐/缩进)
    expect(list[0]).toEqual({ id: 'cut', enabled: true })
    expect(list.map((i) => i.id)).toEqual([
      'cut', 'copy', 'paste', 'delete',
      'bold', 'italic', 'underline', 'strikeout', 'clearFormat',
      'alignLeft', 'alignCenter', 'alignRight', 'alignJustify',
      'increaseIndent', 'decreaseIndent',
      'properties',
    ])
    // 分隔线分隔: 正文组之间 + 末尾属性前
    expect(entryKinds(snap).slice(-2)).toEqual(['separator', 'item'])
  })

  it('image: 复制 + 删除', () => {
    const snap: EditorContextSnapshot = { ...base, kind: 'image', nodeId: 'img1' }
    expect(items(snap)).toEqual([
      { id: 'copy', enabled: true },
      { id: 'delete', enabled: true },
    ])
    expect(entryKinds(snap)).toEqual(['item', 'item'])
  })
})

// ---- 勾选状态 (P1-a 增量) ----

/** 提取带勾选状态的格式/对齐项 (id → checked) */
function checkedMap(
  snapshot: EditorContextSnapshot,
  style?: ContextMenuStyleInfo,
): Record<string, boolean | undefined> {
  const out: Record<string, boolean | undefined> = {}
  for (const e of buildContextMenuModel(snapshot, style ?? { textStyle: null, paragraphStyle: null }).entries) {
    if (e.kind === 'item' && e.checked !== undefined) out[e.id] = e.checked
  }
  return out
}

const CHECKED_IDS = ['bold', 'italic', 'underline', 'strikeout', 'alignLeft', 'alignCenter', 'alignRight', 'alignJustify']

describe('buildContextMenuModel 勾选状态', () => {
  it('无样式投影 (默认): 格式/对齐项均未勾选', () => {
    const map = checkedMap(textSnapshot(false))
    expect(CHECKED_IDS.every((id) => map[id] === false)).toBe(true)
  })

  it('textStyle 投影反映加粗/斜体/下划线/删除线勾选', () => {
    const map = checkedMap(textSnapshot(false), {
      textStyle: { bold: true, italic: false, underline: true, strikeout: true },
      paragraphStyle: null,
    })
    expect(map.bold).toBe(true)
    expect(map.italic).toBe(false)
    expect(map.underline).toBe(true)
    expect(map.strikeout).toBe(true)
  })

  it('paragraphStyle 投影反映对齐勾选 (仅一项为 true)', () => {
    const map = checkedMap(textSnapshot(false), {
      textStyle: null,
      paragraphStyle: { alignment: 'center' },
    })
    expect(map.alignCenter).toBe(true)
    expect(map.alignLeft).toBe(false)
    expect(map.alignRight).toBe(false)
    expect(map.alignJustify).toBe(false)
  })

  it('复制/粘贴/删除/清除格式/缩进 不携带 checked 字段', () => {
    const entries = buildContextMenuModel(textSnapshot(false)).entries
    for (const e of entries) {
      if (e.kind !== 'item') continue
      if (['cut', 'copy', 'paste', 'delete', 'clearFormat', 'increaseIndent', 'decreaseIndent'].includes(e.id)) {
        expect(e.checked).toBeUndefined()
      }
    }
  })
})

// ============================================================
// Section 操作组 (契约 §31.14) — 由快照上的 sectionFact 派生, 不新增 kind
// ============================================================

/** 带节事实的 text 快照 */
function sectionSnapshot(over: Partial<{
  index: number; siblingCount: number; insertable: boolean; id: string
}> = {}): EditorContextSnapshot {
  return {
    ...base, kind: 'text', paragraphId: 'p1', paragraphPath: ['doc', 'p1'],
    offset: 3, scope: { type: 'body' }, coversSelection: false,
    sectionFact: {
      id: over.id ?? 'sec-1',
      index: over.index ?? 1,
      siblingCount: over.siblingCount ?? 3,
      insertable: over.insertable ?? true,
    },
  }
}

/** 条目 id → enabled (缺失视为 false), 供节操作的开关断言 */
function itemsMap(snapshot: EditorContextSnapshot): Partial<Record<ContextMenuActionId, boolean>> {
  const map: Partial<Record<ContextMenuActionId, boolean>> = {}
  for (const e of items(snapshot)) map[e.id] = e.enabled
  return map
}

describe('buildContextMenuModel — Section 操作组', () => {
  it('sectionFact 为 null (不在任何节里) → 不出现节操作条目', () => {
    const ids = items(textSnapshot(false)).map((i) => i.id)
    expect(ids).not.toContain('deleteSection')
    expect(ids).not.toContain('moveSectionUp')
  })

  it('在节内 → 出现删除/上移/下移/改码/选中, 且都可用', () => {
    const map = itemsMap(sectionSnapshot({ index: 1, siblingCount: 3 }))
    for (const id of ['selectSection', 'deleteSection', 'moveSectionUp', 'moveSectionDown', 'editSectionCode'] as const) {
      expect(map[id], id).toBe(true)
    }
  })

  it('首位 → 上移置灰; 末位 → 下移置灰', () => {
    expect(itemsMap(sectionSnapshot({ index: 0, siblingCount: 3 })).moveSectionUp).toBe(false)
    expect(itemsMap(sectionSnapshot({ index: 0, siblingCount: 3 })).moveSectionDown).toBe(true)
    expect(itemsMap(sectionSnapshot({ index: 2, siblingCount: 3 })).moveSectionUp).toBe(true)
    expect(itemsMap(sectionSnapshot({ index: 2, siblingCount: 3 })).moveSectionDown).toBe(false)
  })

  it('§31.13: 命中在 cell 内 (insertable=false) → 不出现「插入节」', () => {
    const snap: EditorContextSnapshot = {
      ...base, kind: 'cell', tableId: 't1', row: 0, col: 1,
      paragraphId: 'p1', paragraphPath: ['doc', 'p1'], offset: 0,
      coversSelection: false, tableGrowable: false,
      sectionFact: { id: 'sec-1', index: 0, siblingCount: 1, insertable: false },
    }
    const ids = items(snap).map((i) => i.id)
    expect(ids).not.toContain('insertSection')
    // 但该节本身的操作仍可用 (节存在于 cell 之外)
    expect(ids).toContain('deleteSection')
  })

  it('insertable=true → 出现「插入节」', () => {
    const ids = items(sectionSnapshot({ insertable: true })).map((i) => i.id)
    expect(ids).toContain('insertSection')
  })

  it('节操作条目都带 label (中英两语言均有值)', () => {
    const entries = buildContextMenuModel(sectionSnapshot()).entries
      .filter((e): e is ContextMenuEntryItem => e.kind === 'item')
      .filter((e) => ['insertSection', 'selectSection', 'deleteSection', 'moveSectionUp', 'moveSectionDown', 'editSectionCode'].includes(e.id))
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) expect(e.label.length).toBeGreaterThan(0)
  })
})

// ============================================================
// 逐处接受/拒绝修订 (契约 §12.13)
//
// 事实来自快照的 revisionFact (边界采集), UI 不查模型 —— 所以这里只验证
// "事实 → 菜单条目" 这一段。动作分派见 useEditorContextMenu.test.tsx。
// ============================================================

/** 带修订事实的 text 快照 */
function revisionSnapshot(
  revisionFact: ContextRevisionFact,
  kind: 'text' | 'cell' = 'text',
): EditorContextSnapshot {
  const common = {
    ...base,
    paragraphId: 'p1', paragraphPath: ['doc', 'p1'], offset: 3,
    coversSelection: false, revisionFact,
  }
  return kind === 'text'
    ? { ...common, kind: 'text', scope: { type: 'body' } } as EditorContextSnapshot
    : { ...common, kind: 'cell', tableId: 't1', row: 0, col: 0, tableGrowable: false } as EditorContextSnapshot
}

describe('buildContextMenuModel — 逐处接受/拒绝修订 (§12.13)', () => {
  it('无修订事实 → 不出现任何修订条目', () => {
    const ids = items(textSnapshot(false)).map((i) => i.id)
    for (const id of [
      'acceptInsertRevision', 'rejectInsertRevision',
      'acceptDeleteRevision', 'rejectDeleteRevision',
      'acceptModifyRevision', 'rejectModifyRevision',
    ] as const) {
      expect(ids, id).not.toContain(id)
    }
  })

  it('插入 → 接受插入 / 拒绝插入', () => {
    const ids = items(revisionSnapshot({ nodeId: 't1', type: 'insert' })).map((i) => i.id)
    expect(ids).toContain('acceptInsertRevision')
    expect(ids).toContain('rejectInsertRevision')
    expect(ids).not.toContain('acceptDeleteRevision')
  })

  it('删除 → 接受删除 / 拒绝删除', () => {
    const ids = items(revisionSnapshot({ nodeId: 't1', type: 'delete' })).map((i) => i.id)
    expect(ids).toContain('acceptDeleteRevision')
    expect(ids).toContain('rejectDeleteRevision')
    expect(ids).not.toContain('acceptInsertRevision')
  })

  it('修改 (预留类型, 导入可产生) → 接受修改 / 拒绝修改', () => {
    const ids = items(revisionSnapshot({ nodeId: 't1', type: 'modify' })).map((i) => i.id)
    expect(ids).toContain('acceptModifyRevision')
    expect(ids).toContain('rejectModifyRevision')
  })

  it('cell 命中也带修订条目 (表格里的修订一样能逐处处理)', () => {
    const ids = items(revisionSnapshot({ nodeId: 't1', type: 'delete' }, 'cell')).map((i) => i.id)
    expect(ids).toContain('acceptDeleteRevision')
  })

  it('旁注 = 作者 · 时间; 只有作者或只有时间时不拼空段', () => {
    const hintOf = (fact: Parameters<typeof revisionSnapshot>[0]) =>
      buildContextMenuModel(revisionSnapshot(fact)).entries
        .filter((e): e is ContextMenuEntryItem => e.kind === 'item')
        .find((e) => e.id === 'acceptInsertRevision')?.hint

    const at = new Date(2023, 2, 27, 16, 15, 30).getTime()
    expect(hintOf({ nodeId: 't1', type: 'insert', author: '姜波', at })).toBe('姜波 · 2023-03-27 16:15')
    expect(hintOf({ nodeId: 't1', type: 'insert', author: '姜波' })).toBe('姜波')
    expect(hintOf({ nodeId: 't1', type: 'insert', at })).toBe('2023-03-27 16:15')
    expect(hintOf({ nodeId: 't1', type: 'insert' })).toBeUndefined()
  })

  it('修订条目跟在菜单末尾, 且带非空 label', () => {
    const entries = buildContextMenuModel(revisionSnapshot({ nodeId: 't1', type: 'insert' })).entries
    const last = entries[entries.length - 1]
    expect(last.kind).toBe('item')
    expect((last as ContextMenuEntryItem).id).toBe('rejectInsertRevision')
    for (const e of entries) {
      if (e.kind === 'item' && e.id.endsWith('Revision')) expect(e.label.length).toBeGreaterThan(0)
    }
  })
})
