// ============================================================
// contextMenuModel 纯函数测试 (P1-a)
//
// 验证 buildContextMenuModel 由上下文快照派生菜单条目:
//   - text/cell: 复制/粘贴/删除 + 文本格式 + 段落样式 + 列表层级,
//     且删除仅在命中点覆盖选区时可用。
//   - blank: 仅粘贴。
//   - 其余种类: 空条目 (不弹菜单)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildContextMenuModel, type ContextMenuActionId, type ContextMenuEntryItem } from '../contextMenuModel'
import type { EditorContextSnapshot } from '@/engine'

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

const base = { pageIndex: 0, localX: 10, localY: 10 }

function textSnapshot(coversSelection: boolean): EditorContextSnapshot {
  return {
    ...base, kind: 'text', paragraphId: 'p1', paragraphPath: ['doc', 'p1'],
    offset: 3, scope: { type: 'body' }, coversSelection,
  }
}

function cellSnapshot(coversSelection: boolean): EditorContextSnapshot {
  return {
    ...base, kind: 'cell', tableId: 't1', row: 0, col: 1,
    paragraphId: 'p1', paragraphPath: ['doc', 'p1'], offset: 3, coversSelection,
  }
}

describe('buildContextMenuModel 菜单条目 (P1-a)', () => {
  it('text 命中: 复制/粘贴/删除 + 格式/段落/列表, 覆盖选区时删除可用', () => {
    const snap = textSnapshot(true)
    expect(items(snap)).toEqual([
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
    // 分组: 3 项 + sep + 5 项 + sep + 4 项 + sep + 2 项
    expect(entryKinds(snap)).toEqual([
      'item', 'item', 'item', 'separator',
      'item', 'item', 'item', 'item', 'item', 'separator',
      'item', 'item', 'item', 'item', 'separator',
      'item', 'item',
    ])
  })

  it('text 命中但未覆盖选区: 删除不可用, 其余可用', () => {
    const list = items(textSnapshot(false))
    expect(list.find((i) => i.id === 'delete')).toEqual({ id: 'delete', enabled: false })
    expect(list.find((i) => i.id === 'copy')?.enabled).toBe(true)
  })

  it('cell 命中: 同样提供格式/段落/列表条目', () => {
    const list = items(cellSnapshot(false))
    expect(list.map((i) => i.id)).toEqual([
      'copy', 'paste', 'delete',
      'bold', 'italic', 'underline', 'strikeout', 'clearFormat',
      'alignLeft', 'alignCenter', 'alignRight', 'alignJustify',
      'increaseIndent', 'decreaseIndent',
    ])
  })

  it('blank: 仅粘贴, 无分隔符', () => {
    const snap: EditorContextSnapshot = { ...base, kind: 'blank' }
    expect(items(snap)).toEqual([{ id: 'paste', enabled: true }])
    expect(entryKinds(snap)).toEqual(['item'])
  })

  it('其余种类 (table/image/separator/sectionBreak/headerFooter/smartText): 空条目', () => {
    const others: EditorContextSnapshot[] = [
      { ...base, kind: 'table', tableId: 't1' },
      { ...base, kind: 'image', nodeId: 'img1' },
      { ...base, kind: 'separator', nodeId: 's1' },
      { ...base, kind: 'sectionBreak', nodeId: 'sb1' },
      { ...base, kind: 'headerFooterRegion', section: 'header' },
      { ...base, kind: 'smartText', controlId: 'c1' },
    ]
    for (const snap of others) {
      expect(buildContextMenuModel(snap).entries).toEqual([])
    }
  })
})
