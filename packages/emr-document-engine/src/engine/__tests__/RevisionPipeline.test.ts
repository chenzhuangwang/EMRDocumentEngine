// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 修订留痕 — **接线** (契约 §12.13)
//
// 本批最容易静默失效的不是"标记能不能存", 而是**它到底有没有走上那条路**:
//   - 盖戳点没接上      → 开着追踪打字却一条标记都没有 (屏幕上看不出区别)
//   - SLIF 不透传       → 标记存住了, 但 TextParticle 那条 revision 分支是死代码
//   - 视图开关改文档    → 关掉显示, 序列化却变了 (视图开关不该动内容)
//   - redo 重新读时钟   → undo×N→redo×N 后文档不再逐字节相同 (§8.3)
// 四种都不抛错。所以本文件一律走**真实路径**: 真 Editor、真命令、真布局,
// 判据落在 SLIFItem / 池 / 序列化字节上, 不落在中间对象的字段上。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode,
} from '../document/factory/ElementFormatter'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { loadDocument } from '../document/io/DocumentLoader'
import { getFlatPageItems } from '../layout/core/SLIF'
import { InsertTextCommand } from '../command/commands/InsertTextCommand'
import { DeleteRangeCommand } from '../command/commands/DeleteRangeCommand'
import { generateCommandId } from '../command/ICommand'
import { NodeType } from '../document/core/DocumentModel'
import type { BaseNode, DocumentTree, Paragraph, TextNode } from '../document/core/DocumentModel'
import type { SLIFItem } from '../layout/core/SLIF'

/** 段落内文字节点的文字 (非文本子节点用 ␣ 占位) */
function sentence(editor: Editor, paraId: string): string {
  const para = editor.getPool().nodes.get(paraId) as Paragraph
  return para.children.map((id) => {
    const n = editor.getPool().nodes.get(id) as TextNode | undefined
    return n?.type === NodeType.TEXT ? n.text : '␣'
  }).join('')
}

/** 段落内文字节点的标记 (与 sentence 同序, 无标记为 null) */
function marks(editor: Editor, paraId: string): Array<string | null> {
  const para = editor.getPool().nodes.get(paraId) as Paragraph
  return para.children.map((id) => {
    const n = editor.getPool().nodes.get(id) as TextNode | undefined
    return n?.type === NodeType.TEXT ? (n.revision?.type ?? null) : null
  })
}

interface Fixture { editor: Editor; doc: DocumentTree; paraId: string }

function makeFixture(text: string): Fixture {
  const doc = createDocument('修订留痕')
  const t = createTextNode(text)
  const p = createParagraph([t.id])
  doc.body.children = [p.id]
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode
  nodes[t.id] = t as unknown as BaseNode
  nodes[p.id] = p as unknown as BaseNode
  ;(doc as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  editor.setDocument(doc)
  editor.setCurrentUser({ name: '姜波', id: 'jiangbo' })
  return { editor, doc, paraId: p.id }
}

/** 打字 (经 InsertTextCommand —— 真实命令路径, 不是直接改池) */
function typeText(f: Fixture, offset: number, text: string): void {
  f.editor.execCommand(new InsertTextCommand(
    generateCommandId(), Date.now(), 'user', [f.doc.id, f.paraId], offset, text,
  ))
}

/** 删除范围 (经 DeleteRangeCommand) */
function deleteRange(f: Fixture, start: number, end: number): void {
  f.editor.execCommand(new DeleteRangeCommand(
    generateCommandId(), Date.now(), 'user', [f.doc.id, f.paraId], start, end,
  ))
}

const serialized = (f: Fixture): string =>
  serializeDocument(f.editor.getDocument(), f.editor.getPool())

const slifOf = (editor: Editor, nodeId: string): SLIFItem | undefined =>
  editor.getDraw().getPages().flatMap(getFlatPageItems).find((i) => i.nodeId === nodeId)

const childIds = (f: Fixture): readonly string[] =>
  ((f.editor.getPool().nodes.get(f.paraId) as Paragraph).children)

/** 按文字找节点 (插入会把一个节点拆成多段, 下标不可依赖) */
const nodeWithText = (f: Fixture, text: string): TextNode => {
  for (const id of childIds(f)) {
    const n = f.editor.getPool().nodes.get(id) as TextNode | undefined
    if (n?.type === NodeType.TEXT && n.text === text) return n
  }
  throw new Error(`no text node ${text}`)
}

/** 「文字:标记」序列 (含空片段, 便于看清拆分) */
const pieces = (f: Fixture): string[] => childIds(f).map((id) => {
  const n = f.editor.getPool().nodes.get(id) as TextNode | undefined
  return `${n?.text ?? '?'}:${n?.revision?.type ?? '-'}`
})

afterEach(() => { document.body.innerHTML = '' })

// ================================================================
// 盖戳 (§12.13 的单一盖戳点)
// ================================================================

describe('盖戳唯一经 CommandManager 注入的 revision context', () => {
  it('追踪关闭 → 插入与旧行为逐字相同, 一条标记都不产生', () => {
    const f = makeFixture('甲乙')
    expect(f.editor.isTrackingChanges()).toBe(false)

    typeText(f, 1, 'X')
    expect(sentence(f.editor, f.paraId)).toBe('甲X乙')
    expect(marks(f.editor, f.paraId).every((m) => m === null)).toBe(true)

    deleteRange(f, 1, 2)
    expect(sentence(f.editor, f.paraId)).toBe('甲乙')
    expect(marks(f.editor, f.paraId).every((m) => m === null)).toBe(true)
  })

  it('追踪开启 → 插入带上作者与时间 (来自 buildContext, 不是命令自己取)', () => {
    const f = makeFixture('甲乙')
    f.editor.setTrackChanges(true)

    typeText(f, 1, 'X')

    const node = nodeWithText(f, 'X')
    expect(sentence(f.editor, f.paraId)).toBe('甲X乙')
    expect(node.revision?.type).toBe('insert')
    expect(node.revision?.author).toBe('姜波')
    expect(node.revision?.authorId).toBe('jiangbo')
    expect(typeof node.revision?.at).toBe('number')
  })

  it('追踪开启 → 删除**保留原文**并打 delete 标记 (Word 语义)', () => {
    const f = makeFixture('甲乙丙')
    f.editor.setTrackChanges(true)

    deleteRange(f, 1, 2)

    // 文字没消失 —— 它留在这里等接受/拒绝
    expect(sentence(f.editor, f.paraId)).toBe('甲乙丙')
    expect(marks(f.editor, f.paraId)).toEqual([null, 'delete', null])
  })

  it('删掉"待接受的插入" = 取消它, 不叠加 delete (否则接受后会复活)', () => {
    const f = makeFixture('甲乙')
    f.editor.setTrackChanges(true)
    typeText(f, 1, 'X')
    expect(sentence(f.editor, f.paraId)).toBe('甲X乙')

    deleteRange(f, 1, 2)

    expect(sentence(f.editor, f.paraId)).toBe('甲乙')
    expect(marks(f.editor, f.paraId)).toEqual([null])
  })

  it('未设置当前用户时仍然记录"有人改过" (作者缺省, 不是整条丢弃)', () => {
    const f = makeFixture('甲乙')
    f.editor.setCurrentUser(null)
    f.editor.setTrackChanges(true)

    typeText(f, 1, 'X')

    const node = nodeWithText(f, 'X')
    expect(node.revision?.type).toBe('insert')
    expect(node.revision?.author).toBeUndefined()
  })
})

// ================================================================
// SLIF 与渲染 (§12.13 的粒子管线复用)
// ================================================================

describe('标记经 SLIF 到达渲染', () => {
  it('带标记的文字在 SLIFItem 上带 revision; delete 同时带删除线', () => {
    const f = makeFixture('甲乙丙')
    f.editor.setTrackChanges(true)
    deleteRange(f, 1, 2)

    const deletedId = childIds(f)[1]
    const item = slifOf(f.editor, deletedId)
    expect(item?.text).toBe('乙')
    expect(item?.revision).toEqual({ type: 'delete' })
    // 删除线在**布局期**由 delete 派生 (ParticleAdapters 只透传, 见 §12.13)
    expect(item?.strikeout).toBe(true)
  })

  it('插入标记不产生删除线 (只上色)', () => {
    const f = makeFixture('甲乙')
    f.editor.setTrackChanges(true)
    typeText(f, 1, 'X')

    const item = slifOf(f.editor, nodeWithText(f, 'X').id)
    expect(item?.revision).toEqual({ type: 'insert' })
    expect(item?.strikeout).toBeFalsy()
  })
})

// ================================================================
// 视图开关 (§12.13: 关掉显示不得改内容)
// ================================================================

describe('showRevisionMarks 是视图开关', () => {
  it('关掉后 SLIF 里既无标记也无派生删除线, 但文档一个字节都没变', () => {
    const f = makeFixture('甲乙丙')
    f.editor.setTrackChanges(true)
    deleteRange(f, 1, 2)

    const before = serialized(f)
    expect(f.editor.getShowRevisionMarks()).toBe(true)
    const deletedId = childIds(f)[1]
    expect(slifOf(f.editor, deletedId)?.revision).toEqual({ type: 'delete' })

    f.editor.setShowRevisionMarks(false)

    const item = slifOf(f.editor, deletedId)
    expect(item?.revision).toBeUndefined()
    // 删除线也必须一起消失 —— 它是布局期由标记派生的, 不是文档里写死的
    expect(item?.strikeout).toBeFalsy()
    // 文字还在 (视图开关不改文档)
    expect(item?.text).toBe('乙')
    expect(serialized(f)).toBe(before)

    // 开回来 → 逐字恢复
    f.editor.setShowRevisionMarks(true)
    expect(slifOf(f.editor, deletedId)?.revision).toEqual({ type: 'delete' })
    expect(slifOf(f.editor, deletedId)?.strikeout).toBe(true)
    expect(serialized(f)).toBe(before)
  })

  it('开关是幂等的 (同值再设不重排)', () => {
    const f = makeFixture('甲乙')
    f.editor.setTrackChanges(true)
    typeText(f, 1, 'X')
    const pages = f.editor.getDraw().getPages()

    f.editor.setShowRevisionMarks(true)

    expect(f.editor.getDraw().getPages()).toBe(pages)
  })
})

// ================================================================
// 接受 / 拒绝 (§12.13 — 四种组合都要可撤销)
// ================================================================

describe('接受 / 拒绝', () => {
  /** 造一份「甲[X]乙[丙]」—— 插入与删除两种标记各一处 */
  function mixed(): Fixture {
    const f = makeFixture('甲乙丙')
    f.editor.setTrackChanges(true)
    typeText(f, 1, 'X')          // 甲 X 乙丙
    deleteRange(f, 3, 4)         // 甲 X 乙 [丙]
    expect(marks(f.editor, f.paraId)).toEqual([null, 'insert', null, 'delete'])
    return f
  }

  it('接受插入 → 去标记留文字; 接受删除 → 文字消失', () => {
    const f = mixed()
    expect(f.editor.acceptAllRevisions()).toBe(2)

    expect(sentence(f.editor, f.paraId)).toBe('甲X乙')
    expect(marks(f.editor, f.paraId).every((m) => m === null)).toBe(true)
    expect(f.editor.listRevisions()).toEqual([])
  })

  it('拒绝插入 → 文字消失; 拒绝删除 → 去标记留文字', () => {
    const f = mixed()
    expect(f.editor.rejectAllRevisions()).toBe(2)

    expect(sentence(f.editor, f.paraId)).toBe('甲乙丙')
    expect(marks(f.editor, f.paraId).every((m) => m === null)).toBe(true)
  })

  it('listRevisions 带文字与定位路径 —— 审阅面板的数据源', () => {
    const f = mixed()
    const list = f.editor.listRevisions()

    expect(list.map((e) => [e.type, e.text, e.offset])).toEqual([
      ['insert', 'X', 1],
      ['delete', '丙', 3],
    ])
    for (const e of list) {
      // 光标定位路径与全仓一致: [documentRootId, paragraphId]
      expect(e.paragraphPath).toEqual([f.doc.id, f.paraId])
      expect(e.paraId).toBe(f.paraId)
      expect(e.author).toBe('姜波')
    }
  })

  it('逐处接受 (PRD F14.2) —— 只动点名的那一处', () => {
    const f = mixed()
    const insertedId = childIds(f)[1]

    expect(f.editor.acceptRevisions([insertedId])).toBe(1)

    expect(sentence(f.editor, f.paraId)).toBe('甲X乙丙')
    // 待删的那一处原封不动
    expect(f.editor.listRevisions()).toEqual([
      expect.objectContaining({ type: 'delete', author: '姜波' }),
    ])
  })

  it('接受/拒绝都可撤销, 且撤销后标记逐字回来', () => {
    const f = mixed()
    const before = serialized(f)

    f.editor.acceptAllRevisions()
    expect(sentence(f.editor, f.paraId)).toBe('甲X乙')

    f.editor.undo()
    expect(sentence(f.editor, f.paraId)).toBe('甲X乙丙')
    expect(marks(f.editor, f.paraId)).toEqual([null, 'insert', null, 'delete'])
    // 撤销是精确逆: 带 id 的序列化逐字节相同 (§8.3)
    expect(serialized(f)).toBe(before)
  })

  it('编辑 + 逐处决定, 一路撤销回原文 (带 id 序列化逐字节相同)', () => {
    const f = makeFixture('甲乙丙')
    const original = serialized(f)

    f.editor.setTrackChanges(true)
    typeText(f, 1, 'X')          // 甲 X 乙丙
    deleteRange(f, 3, 4)         // 甲 X 乙 [丙]

    const insertId = f.editor.listRevisions().find((e) => e.type === 'insert')!.nodeId
    const deleteId = f.editor.listRevisions().find((e) => e.type === 'delete')!.nodeId
    f.editor.acceptRevisions([deleteId])
    f.editor.rejectRevisions([insertId])
    expect(sentence(f.editor, f.paraId)).toBe('甲乙')

    // 四条命令 (打字 / 删除 / 接受 / 拒绝) 逐条撤销 —— 任何一条的逆不精确都会在此露馅
    let guard = 0
    while (f.editor.canUndo() && guard++ < 20) f.editor.undo()

    expect(sentence(f.editor, f.paraId)).toBe('甲乙丙')
    expect(marks(f.editor, f.paraId).every((m) => m === null)).toBe(true)
    expect(serialized(f)).toBe(original)
  })

  it('没有修订时接受/拒绝是空操作 (返回 0, 不推一条空撤销)', () => {
    const f = makeFixture('甲乙')
    expect(f.editor.acceptAllRevisions()).toBe(0)
    expect(f.editor.rejectAllRevisions()).toBe(0)
    expect(f.editor.canUndo()).toBe(false)
  })

  it('拒绝掉整段待插文字后段落不会空掉 (仍可继续输入)', () => {
    const f = makeFixture('')
    f.editor.setTrackChanges(true)
    typeText(f, 0, '整段都是新写的')
    expect(sentence(f.editor, f.paraId)).toBe('整段都是新写的')

    f.editor.rejectAllRevisions()

    expect(sentence(f.editor, f.paraId)).toBe('')
    expect(() => typeText(f, 0, '还能打字')).not.toThrow()
    expect(sentence(f.editor, f.paraId)).toBe('还能打字')
  })
})

// ================================================================
// 撤销与重放 (§8.3 的判据用在留痕上)
// ================================================================

describe('撤销 / 重做与留痕', () => {
  it('撤销插入 → 标记连同文字一起消失; 重做 → 逐字节相同', () => {
    const f = makeFixture('甲乙')
    f.editor.setTrackChanges(true)
    typeText(f, 1, 'X')
    const after = serialized(f)
    expect(sentence(f.editor, f.paraId)).toBe('甲X乙')

    f.editor.undo()
    expect(sentence(f.editor, f.paraId)).toBe('甲乙')

    // 重放不得重新读时钟: at 若变了, 这里的字节就不相同 (§12.13 / §8.3)
    f.editor.redo()
    expect(sentence(f.editor, f.paraId)).toBe('甲X乙')
    expect(serialized(f)).toBe(after)
  })

  it('追踪关闭时执行的插入, 重做**不因当下开关为开**而长出标记', () => {
    const f = makeFixture('甲乙')
    expect(f.editor.isTrackingChanges()).toBe(false)
    typeText(f, 1, 'X')
    const after = serialized(f)

    f.editor.undo()
    f.editor.setTrackChanges(true)   // 撤销与重做之间把开关打开
    f.editor.redo()

    expect(serialized(f)).toBe(after)
    expect(marks(f.editor, f.paraId).every((m) => m === null)).toBe(true)
  })

  it('撤销追踪删除 → 原文与标记精确还原', () => {
    const f = makeFixture('甲乙丙')
    f.editor.setTrackChanges(true)
    const before = serialized(f)

    deleteRange(f, 1, 2)
    expect(marks(f.editor, f.paraId)).toEqual([null, 'delete', null])

    f.editor.undo()
    expect(serialized(f)).toBe(before)
  })

  it('撤销追踪删除后重做 → 逐字节相同 (快照路径也须可重放)', () => {
    const f = makeFixture('甲乙丙')
    f.editor.setTrackChanges(true)
    deleteRange(f, 1, 2)
    const after = serialized(f)

    f.editor.undo()
    f.editor.redo()

    expect(serialized(f)).toBe(after)
    expect(marks(f.editor, f.paraId)).toEqual([null, 'delete', null])
  })
})

// ================================================================
// 拆分与合并 (§12.13: 标记跟着文字走)
// ================================================================

describe('标记跟着文字走', () => {
  it('在待删文字中间插入 → 拆成多段, 各片段各自保留自己的标记', () => {
    const f = makeFixture('ABCD')
    f.editor.setTrackChanges(true)
    deleteRange(f, 1, 3)                 // A[BC]D
    expect(marks(f.editor, f.paraId)).toEqual([null, 'delete', null])

    typeText(f, 2, 'X')                  // 落在 BC 中间 → B | X | C

    expect(sentence(f.editor, f.paraId)).toBe('ABXCD')
    expect(marks(f.editor, f.paraId)).toEqual([null, 'delete', 'insert', 'delete', null])
  })

  it('同一样式但标记不同 → normalizeParagraph 不合并它们', () => {
    const f = makeFixture('甲乙')
    f.editor.setTrackChanges(true)
    typeText(f, 1, 'X')                  // 甲 X 乙 (X 带 insert)
    f.editor.setTrackChanges(false)
    typeText(f, 0, 'Y')                  // Y 甲X乙 —— Y 无标记, 不得并进 X

    expect(sentence(f.editor, f.paraId)).toBe('Y甲X乙')
    // X 仍独占一段带 insert; Y/甲/乙 三段都不带标记 (空段+'Y'+'甲'+'乙')
    expect(pieces(f).filter((p) => p.endsWith(':insert'))).toEqual(['X:insert'])
  })

  it('同一作者的连续插入合并成一条 run (与 Word 同形)', () => {
    const f = makeFixture('甲乙')
    f.editor.setTrackChanges(true)
    typeText(f, 1, 'X')
    typeText(f, 2, 'Y')

    expect(sentence(f.editor, f.paraId)).toBe('甲XY乙')
    expect(pieces(f)).toEqual(['甲:-', 'XY:insert', '乙:-'])
  })
})

// ================================================================
// 往返 (§12.13: 序列化 → 加载 → 逐字节相同)
// ================================================================

describe('留痕往返', () => {
  it('带留痕的文档序列化 → 加载, 标记在节点 payload 里往返, 且逐字节相同', () => {
    const f = makeFixture('甲乙丙')
    f.editor.setTrackChanges(true)
    deleteRange(f, 1, 2)

    const json = serialized(f)
    const r = loadDocument(json)

    const markedId = childIds(f)[1]
    const reloaded = r.pool.nodes.get(markedId) as TextNode
    expect(reloaded.revision).toEqual(
      expect.objectContaining({ type: 'delete', author: '姜波', authorId: 'jiangbo' }),
    )
    // 逐字节: 加载后再序列化必须与原串相同 (§8.3 的判据)
    expect(serializeDocument(r.doc, r.pool)).toBe(json)
  })
})
