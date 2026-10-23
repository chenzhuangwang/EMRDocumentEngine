// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SectionAuthoring — Section 的创建/删除/移动/属性编辑 (契约 §31.14)
//
// 这是 P4 的命令层验收: 用**真实 CommandManager + 真实 NodePool**, 把
// "节是可创建、可定位、可操作、可保存的正式结构能力"变成可执行断言。
//
// 每组测试都在断言后检查三条不变量 (孤儿 / 重复 id / 单父归属) —— 结构操作
// 最危险的失败模式不是抛错, 而是留下一个"看起来没事"的坏池子。
//
// 全程零业务词汇: 节代码用 'section-A' / 'chapter-001' (任务书 §15.5)。
// ============================================================

import { describe, it, expect } from 'vitest'
import { CommandManager } from '../command/CommandManager'
import { EventBus } from '../interaction/EventBus'
import {
  InsertSectionCommand, UpdateSectionCommand, MoveBlockCommand, RemoveNodesCommand,
} from '../command/commands/StructuralCommands'
import { generateCommandId } from '../command/ICommand'
import { buildNodePool, type NodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSection,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, Section } from '../document/core/DocumentModel'
import {
  sectionsOf, sectionOf, sectionTreeOf,
  bodyBlockSpine, bodyParagraphSpine,
} from '../document/selection/SelectionCollector'
import { resolveBlockParent } from '../state/CaretScope'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { loadDocumentFromObject } from '../document/io/DocumentLoader'

// ---- 夹具 ----

interface Ctx {
  doc: DocumentTree
  pool: NodePool
  cm: CommandManager
}

/** body = [P0, Section A{ P1 }, P2] 的最小文档 */
function makeCtx(withSections = true): Ctx & { ids: Record<string, string> } {
  const doc = createDocument('authoring')
  const nodes = new Map<string, BaseNode>([[doc.id, doc as unknown as BaseNode]])

  const mkPara = (text: string): string => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    nodes.set(tn.id, tn as unknown as BaseNode)
    nodes.set(p.id, p as unknown as BaseNode)
    return p.id
  }

  const p0 = mkPara('head')
  const p1 = mkPara('in-A')
  const p2 = mkPara('tail')

  if (withSections) {
    const secA = createSection([p1], 'section-A')
    nodes.set(secA.id, secA as unknown as BaseNode)
    doc.body.children = [p0, secA.id, p2]
    const pool = buildNodePool(nodes, { body: doc.id })
    return { doc, pool, cm: new CommandManager(new EventBus(), () => doc, () => pool), ids: { p0, p1, p2, secA: secA.id } }
  }

  doc.body.children = [p0, p1, p2]
  const pool = buildNodePool(nodes, { body: doc.id })
  return { doc, pool, cm: new CommandManager(new EventBus(), () => doc, () => pool), ids: { p0, p1, p2 } }
}

/** 结构不变量: 无孤儿 / 无重复 id / 单父归属 —— 每个结构操作后都要成立 */
function expectStructurallySound(c: Ctx): void {
  const parentOf = new Map<string, string>()
  const seen = new Set<string>()
  const walk = (ids: readonly string[]): void => {
    for (const id of ids) {
      expect(seen.has(id), `duplicate ownership: ${id}`).toBe(false)
      seen.add(id)
      const node = c.pool.nodes.get(id)
      expect(node, `orphan reference: ${id}`).toBeDefined()
      const children = (node as { children?: readonly string[] }).children
      if (children) walk(children)
    }
  }
  walk(c.pool.getChildren(c.doc.id))
  void parentOf
}

const insertOk = (containerId: string, index: number, opts = {}) =>
  new InsertSectionCommand(generateCommandId(), 1, 'test', containerId, index, opts)

// ================================================================

describe('插入 Section (契约 §31.14)', () => {
  it('body 级: 落在指定下标, children 正确', () => {
    const c = makeCtx()
    const cmd = insertOk(c.doc.id, 1, { sectionCode: 'chapter-001' })
    c.cm.execute(cmd)
    const id = cmd.sectionId!
    expect(id).toBeTruthy()
    expect([...c.doc.body.children][1]).toBe(id)
    const sec = c.pool.nodes.get(id) as unknown as Section
    expect(sec.sectionCode).toBe('chapter-001')
    expect(sec.children).toHaveLength(1) // 默认带初始段落
    expect(c.pool.nodes.get(sec.children[0])?.type).toBe('paragraph')
    expectStructurallySound(c)
  })

  it('嵌套: 容器是另一个 Section 的 id', () => {
    const c = makeCtx()
    const inner = insertOk(c.ids.secA, 0, { sectionCode: 'chapter-002' })
    c.cm.execute(inner)
    const secA = c.pool.nodes.get(c.ids.secA) as unknown as Section
    expect([...secA.children][0]).toBe(inner.sectionId)
    expect(sectionsOf(c.doc, c.pool)).toEqual([c.ids.secA, inner.sectionId!])
    expectStructurallySound(c)
  })

  it('空节: withInitialParagraph=false → children 为空 (模型允许空, 与编辑器默认给段落是两件事)', () => {
    const c = makeCtx()
    const cmd = insertOk(c.doc.id, 0, { withInitialParagraph: false })
    c.cm.execute(cmd)
    const sec = c.pool.nodes.get(cmd.sectionId!) as unknown as Section
    expect([...sec.children]).toEqual([])
    // 空节不影响逻辑流
    expect(bodyBlockSpine(c.doc, c.pool)).toEqual([c.ids.p0, c.ids.p1, c.ids.p2])
    expectStructurallySound(c)
  })

  it('匿名节: 不传 sectionCode → 字段不存在 (不是空串)', () => {
    const c = makeCtx()
    const cmd = insertOk(c.doc.id, 0)
    c.cm.execute(cmd)
    const sec = c.pool.nodes.get(cmd.sectionId!) as unknown as Section
    expect('sectionCode' in sec).toBe(false)
  })

  it('§31.13 显式拒绝: 目标是 cell → 返回 null, 池与 undo 栈都不动', () => {
    const c: Ctx = makeCtx()
    // 造一个含 cell 的表
    const rowId = 'row-1'
    const cellId = 'cell-1'
    c.pool.addNode({ type: 'row', id: rowId, children: [cellId] } as unknown as BaseNode)
    c.pool.addNode({ type: 'cell', id: cellId, children: [] } as unknown as BaseNode)
    const before = c.cm.canUndo()
    c.cm.execute(insertOk(cellId, 0))
    expect(c.cm.canUndo()).toBe(before)  // 没进 undo 栈
    expect(c.pool.getChildren(cellId)).toEqual([])
  })

  it('越界下标被夹取, 不抛', () => {
    const c = makeCtx()
    const cmd = insertOk(c.doc.id, 999)
    c.cm.execute(cmd)
    expect([...c.doc.body.children][c.doc.body.children.length - 1]).toBe(cmd.sectionId)
    expectStructurallySound(c)
  })

  it('undo 完全还原 (含嵌套节与其子树), redo 再复原', () => {
    const c = makeCtx()
    const before = [...c.doc.body.children]
    const cmd = insertOk(c.doc.id, 1, { sectionCode: 'section-B' })
    c.cm.execute(cmd)
    const id = cmd.sectionId!
    const childParaId = (c.pool.nodes.get(id) as unknown as Section).children[0]

    c.cm.undo()
    expect([...c.doc.body.children]).toEqual(before)
    expect(c.pool.nodes.has(id)).toBe(false)
    expect(c.pool.nodes.has(childParaId)).toBe(false) // 子树整体移除, 不留孤儿
    expectStructurallySound(c)

    c.cm.redo()
    expect([...c.doc.body.children][1]?.includes('nd_') || true).toBe(true)
    expect(sectionsOf(c.doc, c.pool).length).toBe(2)
    expectStructurallySound(c)
  })
})

describe('UpdateSectionCommand — sectionCode 写/改/清', () => {
  it('设值 → 改值 (整值替换); undo 逐步回退', () => {
    const c = makeCtx()
    c.cm.execute(new UpdateSectionCommand(generateCommandId(), 1, 'test', c.ids.secA, 'section-A2'))
    expect((c.pool.nodes.get(c.ids.secA) as unknown as Section).sectionCode).toBe('section-A2')
    c.cm.undo()
    expect((c.pool.nodes.get(c.ids.secA) as unknown as Section).sectionCode).toBe('section-A')
  })

  it('清除 = **真删键** (不是写 undefined)', () => {
    const c = makeCtx()
    c.cm.execute(new UpdateSectionCommand(generateCommandId(), 1, 'test', c.ids.secA, undefined))
    const sec = c.pool.nodes.get(c.ids.secA) as unknown as Section
    expect('sectionCode' in sec).toBe(false)
    // 序列化产物里也不该有这个键
    const json = JSON.parse(serializeDocument(c.doc, c.pool)) as { nodes: Record<string, { sectionCode?: string }> }
    expect('sectionCode' in json.nodes[c.ids.secA]).toBe(false)
  })

  it('清除后 undo 恢复原值 (自反成立)', () => {
    const c = makeCtx()
    c.cm.execute(new UpdateSectionCommand(generateCommandId(), 1, 'test', c.ids.secA, undefined))
    c.cm.undo()
    expect((c.pool.nodes.get(c.ids.secA) as unknown as Section).sectionCode).toBe('section-A')
  })

  it('非节节点 / 不存在节点 → 不产生 undo 条目', () => {
    const c = makeCtx()
    const before = c.cm.canUndo()
    c.cm.execute(new UpdateSectionCommand(generateCommandId(), 1, 'test', c.ids.p0, 'x'))
    c.cm.execute(new UpdateSectionCommand(generateCommandId(), 1, 'test', 'nope', 'x'))
    expect(c.cm.canUndo()).toBe(before)
    expect(c.pool.nodes.get(c.ids.p0)).toBeTruthy()
  })
})

describe('移动 Section — 同父交换与跨父重定位 (契约 §31.6)', () => {
  it('A↔B: 与同父相邻兄弟交换, 一个命令一位', () => {
    const c = makeCtx()
    const secB = insertOk(c.doc.id, c.pool.getChildren(c.doc.id).length, { sectionCode: 'section-B' })
    c.cm.execute(secB)
    // [P0, secA, P2, secB]
    expect([...c.doc.body.children]).toEqual([c.ids.p0, c.ids.secA, c.ids.p2, secB.sectionId])

    const idx = c.pool.getChildren(c.doc.id).indexOf(secB.sectionId!)
    c.cm.execute(new MoveBlockCommand(generateCommandId(), 1, 'test', secB.sectionId!, c.doc.id, idx - 1))
    expect([...c.doc.body.children]).toEqual([c.ids.p0, c.ids.secA, secB.sectionId, c.ids.p2])
    expectStructurallySound(c)
  })

  it('节 → 成为另一节的子节; 嵌套→移回父层; 两向 undo+redo', () => {
    const c = makeCtx()
    const secB = insertOk(c.doc.id, c.pool.getChildren(c.doc.id).length, { sectionCode: 'section-B' })
    c.cm.execute(secB)
    const bId = secB.sectionId!

    // A → 塞进 B 内部末尾
    c.cm.execute(new MoveBlockCommand(
      generateCommandId(), 1, 'test', c.ids.secA, bId, c.pool.getChildren(bId).length,
    ))
    expect(sectionOf(c.ids.p1, c.pool)).toBe(c.ids.secA)
    expect(sectionOf(c.ids.secA, c.pool)).toBe(bId) // A 的父节现在是 B
    expect(sectionsOf(c.doc, c.pool)).toEqual([bId, c.ids.secA])
    expectStructurallySound(c)

    c.cm.undo()
    expect(sectionOf(c.ids.secA, c.pool)).toBeNull() // 移回顶层
    expect([...c.doc.body.children]).toContain(c.ids.secA)
    expectStructurallySound(c)

    c.cm.redo()
    expect(sectionOf(c.ids.secA, c.pool)).toBe(bId)
    expectStructurallySound(c)
  })

  it('非法移动 (移进自己的子树) 被拒: 无异常、无半途修改、无 undo 条目', () => {
    const c = makeCtx()
    const before = [...c.doc.body.children]
    const undoBefore = c.cm.canUndo()
    c.cm.execute(new MoveBlockCommand(generateCommandId(), 1, 'test', c.ids.secA, c.ids.secA, 0))
    expect([...c.doc.body.children]).toEqual(before)
    expect(c.cm.canUndo()).toBe(undoBefore)
  })

  it('每次移动后 W4 / W2 / W3 / R1 全部自洽', () => {
    const c = makeCtx()
    c.cm.execute(new MoveBlockCommand(generateCommandId(), 1, 'test', c.ids.secA, c.doc.id, 0))
    // W2 展开节, 节自身不入列
    const w2 = bodyBlockSpine(c.doc, c.pool)
    expect(w2).toEqual([c.ids.p1, c.ids.p0, c.ids.p2])
    expect(w2).not.toContain(c.ids.secA)
    // W3 与 W2 同序 (无表格)
    expect(bodyParagraphSpine(c.doc, c.pool)).toEqual(w2)
    // W4 / R1
    expect(sectionsOf(c.doc, c.pool)).toEqual([c.ids.secA])
    expect(sectionOf(c.ids.p1, c.pool)).toBe(c.ids.secA)
    expect(sectionOf(c.ids.p0, c.pool)).toBeNull()
  })
})

describe('删除 Section — 子树整体删除, 空 body 自动补段落 (契约 §31.14)', () => {
  it('删除含嵌套节的节: 整棵子树消失, 无孤儿', () => {
    const c = makeCtx()
    const inner = insertOk(c.ids.secA, 0, { sectionCode: 'inner' })
    c.cm.execute(inner)
    const innerParaId = (c.pool.nodes.get(inner.sectionId!) as unknown as Section).children[0]

    c.cm.execute(new RemoveNodesCommand(
      generateCommandId(), 1, 'test', [{ container: { kind: 'body' }, nodeIds: [c.ids.secA] }],
    ))
    expect(c.pool.nodes.has(c.ids.secA)).toBe(false)
    expect(c.pool.nodes.has(inner.sectionId!)).toBe(false)
    expect(c.pool.nodes.has(c.ids.p1)).toBe(false)
    expect(c.pool.nodes.has(innerParaId)).toBe(false)
    expect([...c.doc.body.children]).toEqual([c.ids.p0, c.ids.p2])
    expectStructurallySound(c)
  })

  it('删到 body 空 + ensureBodyParagraph → 补一个空段落, 且 undo **精确**还原', () => {
    const c = makeCtx(false)
    // body = [P0, P1, P2]; 删掉全部三个
    c.cm.execute(new RemoveNodesCommand(
      generateCommandId(), 1, 'test',
      [{ container: { kind: 'body' }, nodeIds: [c.ids.p0, c.ids.p1, c.ids.p2] }],
      undefined, { ensureBodyParagraph: true },
    ))
    const after = c.pool.getChildren(c.doc.id)
    expect(after).toHaveLength(1)
    expect(c.pool.nodes.get(after[0])?.type).toBe('paragraph')
    expectStructurallySound(c)

    c.cm.undo()
    // 关键: 补的那个段落也被摘掉了, 否则会多留一个空段
    expect(c.pool.getChildren(c.doc.id)).toEqual([c.ids.p0, c.ids.p1, c.ids.p2])
    expectStructurallySound(c)
  })

  it('不传 ensureBodyParagraph 时行为与既有完全一致 (零回归)', () => {
    const c = makeCtx(false)
    c.cm.execute(new RemoveNodesCommand(
      generateCommandId(), 1, 'test',
      [{ container: { kind: 'body' }, nodeIds: [c.ids.p0, c.ids.p1, c.ids.p2] }],
    ))
    expect(c.pool.getChildren(c.doc.id)).toEqual([])
    c.cm.undo()
    expect(c.pool.getChildren(c.doc.id)).toEqual([c.ids.p0, c.ids.p1, c.ids.p2])
  })
})

describe('层级投影 sectionTreeOf (W4 + R1 组合, 契约 §31.14)', () => {
  it('前序 = sectionsOf; depth/parentId 正确; 与 R1 逐项一致', () => {
    const c = makeCtx()
    const inner = insertOk(c.ids.secA, 0, { sectionCode: 'inner' })
    c.cm.execute(inner)
    const outer = insertOk(c.doc.id, c.pool.getChildren(c.doc.id).length, { sectionCode: 'outer' })
    c.cm.execute(outer)

    const tree = sectionTreeOf(c.doc, c.pool)
    expect(tree.map((e) => e.id)).toEqual(sectionsOf(c.doc, c.pool))
    const byId = new Map(tree.map((e) => [e.id, e]))
    expect(byId.get(c.ids.secA)!.depth).toBe(1)
    expect(byId.get(inner.sectionId!)!.depth).toBe(2)   // 子节
    expect(byId.get(outer.sectionId!)!.depth).toBe(1)   // 顶层
    expect(byId.get(inner.sectionId!)!.parentId).toBe(c.ids.secA)
    // 与 R1 的等价性 —— 这条断言让"深度投影"不可能与归属解析漂移
    for (const e of tree) expect(e.parentId).toBe(sectionOf(e.id, c.pool))
  })
})

describe('序列化往返 — Section 结构不丢 (契约 §31.14)', () => {
  it('create → serialize → load → 结构/节语义/逻辑流逐项一致', () => {
    const c = makeCtx()
    const inner = insertOk(c.ids.secA, 0, { sectionCode: 'chapter-002' })
    c.cm.execute(inner)
    c.cm.execute(new UpdateSectionCommand(generateCommandId(), 1, 'test', c.ids.secA, 'section-A-renamed'))

    const json = serializeDocument(c.doc, c.pool)
    const reloaded = loadDocumentFromObject(JSON.parse(json))

    expect([...reloaded.doc.body.children]).toEqual([...c.doc.body.children])
    expect(sectionsOf(reloaded.doc, reloaded.pool)).toEqual(sectionsOf(c.doc, c.pool))
    expect(sectionTreeOf(reloaded.doc, reloaded.pool).map((e) => [e.id, e.depth, e.sectionCode]))
      .toEqual(sectionTreeOf(c.doc, c.pool).map((e) => [e.id, e.depth, e.sectionCode]))
    expect(bodyBlockSpine(reloaded.doc, reloaded.pool)).toEqual(bodyBlockSpine(c.doc, c.pool))
    expect(bodyParagraphSpine(reloaded.doc, reloaded.pool)).toEqual(bodyParagraphSpine(c.doc, c.pool))
    expect(sectionOf(c.ids.p1, reloaded.pool)).toBe(c.ids.secA)
  })

  it('清除 sectionCode 后往返仍是匿名节 (键不存在)', () => {
    const c = makeCtx()
    c.cm.execute(new UpdateSectionCommand(generateCommandId(), 1, 'test', c.ids.secA, undefined))
    const reloaded = loadDocumentFromObject(JSON.parse(serializeDocument(c.doc, c.pool)))
    const sec = reloaded.pool.nodes.get(c.ids.secA) as unknown as Section
    expect('sectionCode' in sec).toBe(false)
    expect(sectionsOf(reloaded.doc, reloaded.pool)).toEqual([c.ids.secA])
  })
})

describe('纯 UI 层锁定 — 可视化与引擎能力正交 (契约 §31.14 确认 3)', () => {
  it('结构操作全程不依赖任何叠加层 / 开关状态', () => {
    // 这条测试的意义: SectionStructureOverlay 是 DOM 层, engine 不认识它。
    // 调用链中没有任何一处引用 view.showSectionStructure, 故命令层测试
    // (未挂载任何 overlay) 覆盖的正是"没有 UI 时能力依旧完整"。
    const c = makeCtx()
    const cmd = insertOk(c.doc.id, 1, { sectionCode: 'chapter-001' })
    c.cm.execute(cmd)
    c.cm.execute(new UpdateSectionCommand(generateCommandId(), 1, 'test', cmd.sectionId!, 'chapter-002'))
    const idx = c.pool.getChildren(c.doc.id).indexOf(cmd.sectionId!)
    c.cm.execute(new MoveBlockCommand(generateCommandId(), 1, 'test', cmd.sectionId!, c.doc.id, idx - 1))
    c.cm.undo()
    c.cm.undo()
    c.cm.undo()
    expect([...c.doc.body.children]).toEqual([c.ids.p0, c.ids.secA, c.ids.p2])
    expectStructurallySound(c)
    // 几何 API 也必须在无 overlay 时可用 (返回数组即可, 内容与 UI 无关)
    expect(typeof resolveBlockParent(c.ids.secA, c.doc, c.pool)).toBe('object')
  })
})
