// ============================================================
// contextMenuModel 纯函数测试 (P1-a / P1-c)
//
// 验证 buildContextMenuModel 由上下文快照派生菜单条目:
//   - text: 剪切/复制/粘贴/删除 + 文本格式 + 段落样式 + 列表层级;
//     删除始终可用 (覆盖选区删选区, 折叠选区删整段), 剪切仅在覆盖选区时可用。
//   - cell: 同上, 但剪切/删除仅在命中点覆盖选区时可用。
//   - image: 仅「删除」。
//   - blank: 仅粘贴。
//   - 其余种类: 空条目 (不弹菜单)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildContextMenuModel, type ContextMenuActionId, type ContextMenuEntryItem, type ContextMenuStyleInfo } from '../contextMenuModel'
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

  it('cell 命中: 同样提供剪切/格式/段落/列表条目', () => {
    const list = items(cellSnapshot(false))
    expect(list.map((i) => i.id)).toEqual([
      'cut', 'copy', 'paste', 'delete',
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

  it('其余种类 (table/separator/sectionBreak/headerFooter/smartText): 空条目', () => {
    const others: EditorContextSnapshot[] = [
      { ...base, kind: 'table', tableId: 't1' },
      { ...base, kind: 'separator', nodeId: 's1' },
      { ...base, kind: 'sectionBreak', nodeId: 'sb1' },
      { ...base, kind: 'headerFooterRegion', section: 'header' },
      { ...base, kind: 'smartText', controlId: 'c1' },
    ]
    for (const snap of others) {
      expect(buildContextMenuModel(snap).entries).toEqual([])
    }
  })

  it('image: 仅「删除」', () => {
    const snap: EditorContextSnapshot = { ...base, kind: 'image', nodeId: 'img1' }
    expect(items(snap)).toEqual([{ id: 'delete', enabled: true }])
    expect(entryKinds(snap)).toEqual(['item'])
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
