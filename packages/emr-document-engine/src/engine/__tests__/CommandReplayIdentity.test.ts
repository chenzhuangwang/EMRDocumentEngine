// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// CommandReplayIdentity — forward 的「节点身份幂等」闸门 (契约 §8.3)
//
// 判据只有一条, 而且必须是**带 id 的**判据:
//
//     execute → undo×N → redo×N
//     之后序列化必须与 execute 之后逐字节相同。
//
// 只比形状抓不到这个缺陷 —— 一个悬空引用 (后续命令的 forward 返回 null 被静默
// 丢弃) 在形状上"看起来只是少了个节点", 而 id 对比能直接指认。
//
// 每条链都在同一夹具上跑: body = [P0("alpha")]。
// ============================================================

import { describe, it, expect } from 'vitest'
import { CommandManager } from '../command/CommandManager'
import { EventBus } from '../interaction/EventBus'
import {
  InsertSectionCommand, InsertBlockCommand, EnsureBodyParagraphCommand,
  EnsureHeaderFooterParagraphCommand, EnsureCellParagraphCommand,
  InsertInlineNodeCommand, InsertFootnoteCommand, CreateCommentCommand,
  RemoveNodesCommand, TableStructureCommand,
} from '../command/commands/StructuralCommands'
import { SplitParagraphCommand } from '../command/commands/SplitParagraphCommand'
import { InsertTextCommand } from '../command/commands/InsertTextCommand'
import { InsertImageCommand } from '../command/commands/InsertImageCommand'
import { InsertNodesCommand } from '../command/commands/InsertNodesCommand'
import { AppendTableRowCommand } from '../command/commands/AppendTableRowCommand'
import { DeleteRangeCommand } from '../command/commands/DeleteRangeCommand'
import { FormatTextRangeCommand } from '../command/commands/FormatTextCommand'
import { insertRow } from '../document/table/TableOps'
import type { SerializedPara } from '../command/ClipboardManager'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import { generateCommandId } from '../command/ICommand'
import { buildNodePool, type NodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSeparatorNode, createFieldNode,
  createFootnoteRef, createFootnoteContent, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, CommentThread, DocumentTree } from '../document/core/DocumentModel'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { sectionsOf } from '../document/selection/SelectionCollector'

interface Fixture {
  doc: DocumentTree
  pool: NodePool
  p0: string
  cm: CommandManager
}

/** body = [P0("alpha")] */
function makeCtx(defs?: TemplateDefinitionStore): Fixture {
  const doc = createDocument('replay')
  const nodes = new Map<string, BaseNode>([[doc.id, doc as unknown as BaseNode]])
  const mk = (text: string): string => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    nodes.set(tn.id, tn as unknown as BaseNode)
    nodes.set(p.id, p as unknown as BaseNode)
    return p.id
  }
  const p0 = mk('alpha')
  doc.body.children = [p0]
  const pool = buildNodePool(nodes, { body: doc.id })
  const d = doc as DocumentTree
  return {
    doc: d, pool, p0,
    cm: new CommandManager(new EventBus(), () => d, () => pool, () => defs),
  }
}

/**
 * 造一个 1×1 表 (格内一个段落) 插到 body 末尾。`withSmartControl` 时段落内放一个
 * smarttext 控件 (供 AppendTableRow 的控件克隆 / 定义重写路径取证)。
 */
function addTableFixture(
  f: Fixture, opts: { withSmartControl?: boolean } = {},
): { tableId: string; srcSmartId: string | null } {
  const childIds: string[] = []
  let srcSmartId: string | null = null
  if (opts.withSmartControl) {
    const st = createSmartTextNode('x', { code: { internal: 'CTL_X', dataElement: 'DE.1' }, name: '字段' })
    f.pool.addNode(st as unknown as BaseNode)
    srcSmartId = st.id
    childIds.push(st.id)
  } else {
    const t = createTextNode('x')
    f.pool.addNode(t as unknown as BaseNode)
    childIds.push(t.id)
  }
  const para = createParagraph(childIds)
  f.pool.addNode(para as unknown as BaseNode)

  const cellId = 'tc1'
  f.pool.addNode({ type: 'cell', id: cellId, children: [para.id], colspan: 1, rowspan: 1 } as unknown as BaseNode)
  const rowId = 'tr1'
  f.pool.addNode({ type: 'row', id: rowId, children: [cellId], height: 24 } as unknown as BaseNode)
  const tableId = 'tbl1'
  f.pool.addNode({
    type: 'table', id: tableId,
    columns: [{ width: 100, mode: 'percentage' as const }],
    children: [rowId], dynamicRows: true,
  } as unknown as BaseNode)
  f.pool.insertChild(f.doc.id, tableId, 1)
  return { tableId, srcSmartId }
}

/**
 * 跑一条链并核对 §8.3:
 *   undo 必须精确回到执行前; redo 必须精确回到执行后 (含 id)。
 * setup 在基线之前跑 (用于把夹具摆成"空文档"之类的起始态)。
 */
function expectReplayIdentity(
  name: string,
  run: (f: Fixture) => number,
  setup?: (f: Fixture) => void,
): void {
  const f = makeCtx()
  setup?.(f)
  const before = serializeDocument(f.doc, f.pool)
  const n = run(f)
  const after = serializeDocument(f.doc, f.pool)

  // 自证: 命令必须真的改了文档, 否则「undo/redo 相等」是空断言 (测试无意义)
  expect(after === before, `${name}: 命令未产生变更 — 该用例没有验证力`).toBe(false)

  for (let i = 0; i < n; i++) f.cm.undo()
  const undone = serializeDocument(f.doc, f.pool)
  expect(undone === before, `${name}: undo 未精确还原 → ${firstDiff(before, undone)}`).toBe(true)

  for (let i = 0; i < n; i++) f.cm.redo()
  const redone = serializeDocument(f.doc, f.pool)
  expect(redone === after, `${name}: redo 未精确还原 (含节点 id) → ${firstDiff(after, redone)}`).toBe(true)

  // 第二轮 undo→redo: 抓「快照被重放改写」——若重放注册的是快照对象本身, 首次重放
  // 就会把快照改成末态, 第二轮拿到的已不是「铸造那一刻」的样子。
  for (let i = 0; i < n; i++) f.cm.undo()
  expect(serializeDocument(f.doc, f.pool) === before, `${name}: 第 2 轮 undo 未精确还原`).toBe(true)
  for (let i = 0; i < n; i++) f.cm.redo()
  expect(serializeDocument(f.doc, f.pool) === after, `${name}: 第 2 轮 redo 未精确还原`).toBe(true)
}

/** 给出首个差异位置的上下文, 便于失败时定位 */
export function firstDiff(a: string, b: string): string {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `@${i} want…${a.slice(Math.max(0, i - 70), i + 70)}… got…${b.slice(Math.max(0, i - 70), i + 70)}…`
    }
  }
  return '(identical)'
}

describe('契约 §8.3 — forward 的节点身份幂等 (redo 链不断)', () => {
  // ---- 对照组: 不铸造容器的链 ----

  it('对照: 同段内两次打字 (无铸造容器)', () => {
    expectReplayIdentity('typing×2', (f) => {
      f.cm.execute(new InsertTextCommand(generateCommandId(), 1, 'test', [f.doc.id, f.p0], 0, 'X'))
      f.cm.execute(new InsertTextCommand(generateCommandId(), 2, 'test', [f.doc.id, f.p0], 1, 'Y'))
      return 2
    })
  })

  it('对照: 单条插入节', () => {
    expectReplayIdentity('single-section', (f) => {
      f.cm.execute(new InsertSectionCommand(generateCommandId(), 1, 'test', f.doc.id, 1))
      return 1
    })
  })

  // ---- 受损链: 后一条命令以**前一条铸出的节点**为目标 ----

  it('节内嵌节: 第 2 条节插进第 1 条铸出的节里', () => {
    expectReplayIdentity('section-in-section', (f) => {
      f.cm.execute(new InsertSectionCommand(generateCommandId(), 1, 'test', f.doc.id, 1))
      const s1 = sectionsOf(f.doc, f.pool)[0]!
      f.cm.execute(new InsertSectionCommand(generateCommandId(), 2, 'test', s1, 0))
      return 2
    })
  })

  it('分隔线 2 连插: 第 2 条锚定第 1 条铸出的尾段落', () => {
    expectReplayIdentity('separator-chain', (f) => {
      let anchor = f.p0
      for (let i = 0; i < 2; i++) {
        f.cm.execute(new InsertBlockCommand(
          generateCommandId(), i, 'test', [f.doc.id, anchor],
          (pool) => {
            const s = createSeparatorNode()
            pool.addNode(s as unknown as BaseNode)
            return s as unknown as BaseNode
          },
          { withTrailingParagraph: true },
        ))
        const blocks = f.pool.getChildren(f.doc.id)
        anchor = blocks[blocks.length - 1]!
      }
      return 2
    })
  })

  it('拆分段落 → 在新段打字: 第 2 条锚定第 1 条铸出的段落', () => {
    expectReplayIdentity('split-then-type', (f) => {
      f.cm.execute(new SplitParagraphCommand(generateCommandId(), 1, 'test', [f.doc.id, f.p0], 3))
      const blocks = f.pool.getChildren(f.doc.id)
      f.cm.execute(new InsertTextCommand(
        generateCommandId(), 2, 'test', [f.doc.id, blocks[blocks.length - 1]!], 0, 'X',
      ))
      return 2
    })
  })

  it('补 body 段落 → 在新段打字 (空文档起步)', () => {
    expectReplayIdentity('ensure-body-then-type', (f) => {
      f.cm.execute(new EnsureBodyParagraphCommand(generateCommandId(), 1, 'test'))
      const blocks = f.pool.getChildren(f.doc.id)
      f.cm.execute(new InsertTextCommand(
        generateCommandId(), 2, 'test', [f.doc.id, blocks[0]!], 0, 'X',
      ))
      return 2
    }, (f) => {
      // 清空 body 制造空文档 (经受控 API); 基线在清空之后取
      f.pool.detachChild(f.doc.id, 0)
    })
  })

  it('补页眉段落 → 在页眉段打字', () => {
    expectReplayIdentity('ensure-hf-then-type', (f) => {
      f.cm.execute(new EnsureHeaderFooterParagraphCommand(generateCommandId(), 1, 'test', 'header'))
      const hf = f.doc.header ?? []
      f.cm.execute(new InsertTextCommand(
        generateCommandId(), 2, 'test', [f.doc.id, hf[0]!], 0, 'H',
      ))
      return 2
    })
  })

  it('补 cell 段落 → 在 cell 段打字', () => {
    // 空 cell: 直接构造一个只有 cell 的最小表
    const f = makeCtx()
    const tableId = 't1'
    const rowId = 'r1'
    const cellId = 'c1'
    f.pool.addNode({ type: 'cell', id: cellId, children: [], colspan: 1, rowspan: 1 } as unknown as BaseNode)
    f.pool.addNode({ type: 'row', id: rowId, children: [cellId], height: 24 } as unknown as BaseNode)
    f.pool.addNode({
      type: 'table', id: tableId,
      columns: [{ width: 100, mode: 'percentage' as const }],
      children: [rowId],
    } as unknown as BaseNode)
    f.pool.insertChild(f.doc.id, tableId, 1)

    const before = serializeDocument(f.doc, f.pool)
    f.cm.execute(new EnsureCellParagraphCommand(generateCommandId(), 1, 'test', cellId))

    const cell = f.pool.nodes.get(cellId) as unknown as { children: string[] }
    f.cm.execute(new InsertTextCommand(
      generateCommandId(), 2, 'test', [f.doc.id, cell.children[0]!], 0, 'C',
    ))
    const after2 = serializeDocument(f.doc, f.pool)

    f.cm.undo(); f.cm.undo()
    expect(serializeDocument(f.doc, f.pool), 'cell 链: undo 未精确还原').toBe(before)
    f.cm.redo(); f.cm.redo()
    expect(serializeDocument(f.doc, f.pool), 'cell 链: redo 未精确还原').toBe(after2)
  })

  it('插入内联域 → 光标随后在其后打字', () => {
    expectReplayIdentity('inline-node', (f) => {
      f.cm.execute(new InsertInlineNodeCommand(
        generateCommandId(), 1, 'test', [f.doc.id, f.p0], 0,
        () => createFieldNode('page_number'),
      ))
      return 1
    })
  })
})

describe('契约 §8.3 — P1/P2/P3 铸造点补齐', () => {
  it('插入图片 (文本中间拆分)', () => {
    expectReplayIdentity('insert-image', (f) => {
      f.cm.execute(new InsertImageCommand(
        generateCommandId(), 1, 'test', [f.doc.id, f.p0], 3,
        'data:image/png;base64,AAAA', 100, 50,
      ))
      return 1
    })
  })

  it('插入图片 → 在图片后打字 (锚定铸出的图片)', () => {
    expectReplayIdentity('image-then-type', (f) => {
      f.cm.execute(new InsertImageCommand(
        generateCommandId(), 1, 'test', [f.doc.id, f.p0], 3,
        'data:image/png;base64,AAAA', 100, 50,
      ))
      f.cm.execute(new InsertTextCommand(generateCommandId(), 2, 'test', [f.doc.id, f.p0], 4, 'Z'))
      return 2
    })
  })

  it('插入脚注 (内容 + 引用)', () => {
    // 夹具**不**预置空 footnotes[]: 撤销须把删空的 footnotes 删回「缺失」态
    // (契约 §7.9 可选字段「缺失 ≡ 无内容」), 预置反而会掩盖它。
    expectReplayIdentity('insert-footnote', (f) => {
      f.cm.execute(new InsertFootnoteCommand(
        generateCommandId(), 1, 'test', [f.doc.id, f.p0], 3,
        (pool) => {
          const fnContent = createFootnoteContent('')
          const contentText = createTextNode('')
          const contentPara = createParagraph([contentText.id])
          fnContent.children = [contentPara.id]
          pool.addNode(fnContent as unknown as BaseNode)
          pool.addNode(contentText as unknown as BaseNode)
          pool.addNode(contentPara as unknown as BaseNode)
          return fnContent
        },
        (fnContentId) => createFootnoteRef(fnContentId),
      ))
      return 1
    })
  })

  it('创建批注 (标记 + 线程)', () => {
    expectReplayIdentity('create-comment', (f) => {
      const markerId = 'mk1'
      const threadId = 'th1'
      const range = { path: [f.doc.id, f.p0], offset: 0 }
      f.cm.execute(new CreateCommentCommand(
        generateCommandId(), 1, 'test', [f.doc.id, f.p0], 3,
        () => ({ type: 'comment_marker', id: markerId, threadId, rangeStart: range, rangeEnd: range } as unknown as BaseNode),
        () => ({
          id: threadId, rangeStart: range, rangeEnd: range, author: 'test', createdAt: 1,
          status: 'open', baseVersion: 1, anchorStatus: 'valid', comments: [],
        } as unknown as CommentThread),
      ))
      return 1
    })
  })

  it('粘贴 2 段 → 在第 2 段打字 (锚定铸出的粘贴段落)', () => {
    expectReplayIdentity('paste-then-type', (f) => {
      const pasted: SerializedPara[] = [
        { type: 'paragraph', id: 'src1', style: {}, children: [{ type: 'text', id: 'x1', text: 'PA' }] },
        { type: 'paragraph', id: 'src2', style: {}, children: [{ type: 'text', id: 'x2', text: 'ST' }] },
      ]
      f.cm.execute(new InsertNodesCommand(generateCommandId(), 1, 'test', [f.doc.id, f.p0], 2, pasted))
      const blocks = f.pool.getChildren(f.doc.id)
      const last = blocks[blocks.length - 1]!
      f.cm.execute(new InsertTextCommand(generateCommandId(), 2, 'test', [f.doc.id, last], 0, 'Z'))
      return 2
    })
  })

  it('表格结构: 插入行', () => {
    // 表格先由 setup 放进夹具 (基线在 setup 之后取), 否则基线不含表、undo 无从对照
    let tableId = ''
    expectReplayIdentity('table-insert-row', (f) => {
      f.cm.execute(new TableStructureCommand(
        generateCommandId(), 1, 'test', tableId,
        (pool) => { insertRow(pool, tableId, 0); return true },
      ))
      return 1
    }, (f) => { tableId = addTableFixture(f).tableId })
  })

  it('追加表格行: 行 id 与设计期定义在 redo 后均稳定', () => {
    const defs = new TemplateDefinitionStore()
    const f = makeCtx(defs)
    const { tableId, srcSmartId } = addTableFixture(f, { withSmartControl: true })
    defs.set(srcSmartId!, { label: '源' })

    const before = serializeDocument(f.doc, f.pool)
    f.cm.execute(new AppendTableRowCommand(generateCommandId(), 1, 'test', tableId))
    const after = serializeDocument(f.doc, f.pool)
    expect(after === before, '追加行未产生变更 (测试无意义)').toBe(false)
    const defKeysAfter = [...defs.entries()].map(([k]) => k).sort()
    // 新行的控件应带设计期定义 (克隆自源)
    expect(defKeysAfter.length).toBe(2)

    f.cm.undo()
    expect(serializeDocument(f.doc, f.pool), '追加行: undo 未精确还原').toBe(before)
    f.cm.redo()
    expect(serializeDocument(f.doc, f.pool), '追加行: redo 未精确还原 (含 id)').toBe(after)
    expect([...defs.entries()].map(([k]) => k).sort(), '追加行: redo 后定义丢失/漂移').toEqual(defKeysAfter)
  })

  it('删除整段内容 → 补空文本节点', () => {
    expectReplayIdentity('delete-range-empty-text', (f) => {
      f.cm.execute(new DeleteRangeCommand(generateCommandId(), 1, 'test', [f.doc.id, f.p0], 0, 5))
      return 1
    })
  })

  it('删除唯一段落 → 补 body 空段落', () => {
    expectReplayIdentity('remove-nodes-ensure-body', (f) => {
      f.cm.execute(new RemoveNodesCommand(
        generateCommandId(), 1, 'test',
        [{ container: { kind: 'body' }, nodeIds: [f.p0] }], [], undefined,
        { ensureBodyParagraph: true },
      ))
      return 1
    })
  })

  it('格式化选区 (段中拆分边界)', () => {
    expectReplayIdentity('format-range', (f) => {
      f.cm.execute(new FormatTextRangeCommand(
        generateCommandId(), 1, 'test',
        [{ path: [f.doc.id, f.p0], start: 1, end: 3 }], { bold: true },
      ))
      return 1
    })
  })

  it('只读查询不应物化可选文档级数组 (契约 §7.9)', () => {
    const f = makeCtx()
    // 删一个**不存在**的首页变体段落: 只读解析拿去 indexOf, 不得凭空造出
    // firstPageHeader: [] —— 键的存在性本身是被序列化出去的文档形状
    f.cm.execute(new RemoveNodesCommand(
      generateCommandId(), 1, 'test',
      [{ container: { kind: 'header', variant: 'first' }, nodeIds: ['nope'] }],
    ))
    expect('firstPageHeader' in f.doc, '只读查询物化了 firstPageHeader').toBe(false)
    expect(f.doc.firstPageHeader).toBeUndefined()
  })

  it('插入脚注 → 撤销: footnotes 删空后删键 (非留 [])', () => {
    const f = makeCtx()
    const before = serializeDocument(f.doc, f.pool)
    f.cm.execute(new InsertFootnoteCommand(
      generateCommandId(), 1, 'test', [f.doc.id, f.p0], 3,
      (pool) => {
        const c = createFootnoteContent('')
        const t = createTextNode('')
        const p = createParagraph([t.id])
        c.children = [p.id]
        pool.addNode(c as unknown as BaseNode); pool.addNode(t as unknown as BaseNode)
        pool.addNode(p as unknown as BaseNode)
        return c
      },
      (id) => createFootnoteRef(id),
    ))
    expect(Array.isArray(f.doc.footnotes) && f.doc.footnotes.length === 1).toBe(true)
    f.cm.undo()
    expect('footnotes' in f.doc, '撤销后 footnotes 未删键').toBe(false)
    expect(serializeDocument(f.doc, f.pool), '撤销未回到执行前的字节').toBe(before)
  })
})
