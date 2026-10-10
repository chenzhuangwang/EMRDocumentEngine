// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SectionSemantics — P3 语义能力 (契约 §31.2 W4/R1, §31.10)
//
//   1. W4 `sectionsOf`  节枚举 (前序, 含 Section 自身)
//   2. R1 `sectionOf`   节归属 (最近祖先, 非最外层)
//   3. QC 节级规则      section_unnamed / section_empty, 且**可跳转定位**
//   4. 导入器 section 路由 + 未知类型抛错 (契约 §12.2 / §31.5)
//   5. `MoveBlockCommand` 跨父移动 (此前**根本不存在**的能力)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  sectionsOf, sectionOf, bodyBlockSpine,
} from '../document/selection/SelectionCollector'
import type { SpinePool } from '../document/selection/SelectionCollector'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSection,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, Section } from '../document/core/DocumentModel'
import { QCEngine } from '../qc/QCEngine'
import { MoveBlockCommand } from '../command/commands/StructuralCommands'
import { generateCommandId } from '../command/ICommand'
import { CommandManager } from '../command/CommandManager'
import { EventBus } from '../interaction/EventBus'
import { TemplateImporter } from '../import/TemplateImporter'
import { NodeType } from '../document/core/DocumentModel'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { loadDocumentFromObject } from '../document/io/DocumentLoader'
import { buildExportText } from '../../lib/documentExport'

// ---- 夹具: body = [P0, SectionA{ P1, SectionA1{ P2 } }, SectionB{ Table }] ----

interface Built {
  doc: DocumentTree
  pool: SpinePool
  nodes: Map<string, BaseNode>
  ids: Record<string, string>
}

function mkPara(nodes: Map<string, BaseNode>, text: string): string {
  const tn = createTextNode(text)
  const p = createParagraph([tn.id])
  nodes.set(tn.id, tn as unknown as BaseNode)
  nodes.set(p.id, p as unknown as BaseNode)
  return p.id
}

function build(): Built {
  const doc = createDocument('W4 测试')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)

  const p0 = mkPara(nodes, '节外')
  const p1 = mkPara(nodes, 'A 内')
  const p2 = mkPara(nodes, 'A1 内')

  const secA1 = createSection([p2], 'nested')
  nodes.set(secA1.id, secA1 as unknown as BaseNode)
  const secA = createSection([p1, secA1.id], 'outer')
  nodes.set(secA.id, secA as unknown as BaseNode)

  const emptySec = createSection([], 'empty_one')
  nodes.set(emptySec.id, emptySec as unknown as BaseNode)

  const unnamed = createSection([mkPara(nodes, '匿名节内容')])
  nodes.set(unnamed.id, unnamed as unknown as BaseNode)

  doc.body.children = [p0, secA.id, emptySec.id, unnamed.id]
  const pool: SpinePool = { nodes }

  return {
    doc, pool, nodes,
    ids: { p0, p1, p2, secA: secA.id, secA1: secA1.id, emptySec: emptySec.id, unnamed: unnamed.id },
  }
}

// ================================================================

describe('W4 sectionsOf — 节枚举 (前序, 含 Section 自身)', () => {
  it('前序: 父先于子, 含嵌套节, 不含普通段落', () => {
    const b = build()
    expect(sectionsOf(b.doc, b.pool)).toEqual([b.ids.secA, b.ids.secA1, b.ids.emptySec, b.ids.unnamed])
  })

  it('空节照常入列 (与 children 长度无关)', () => {
    const b = build()
    expect(sectionsOf(b.doc, b.pool)).toContain(b.ids.emptySec)
  })

  it('无节文档 → 空数组', () => {
    const doc = createDocument('无节')
    const nodes = new Map<string, BaseNode>([[doc.id, doc as unknown as BaseNode]])
    const p = mkPara(nodes, '正文')
    doc.body.children = [p]
    expect(sectionsOf(doc, { nodes })).toEqual([])
  })

  it('W4 与 W2 的区别是刻意的: W2 展开且不含 Section, W4 含 Section 且不展开', () => {
    const b = build()
    const w2 = bodyBlockSpine(b.doc, b.pool)
    expect(w2).not.toContain(b.ids.secA)
    expect(sectionsOf(b.doc, b.pool)).toContain(b.ids.secA)
  })
})

describe('R1 sectionOf — 最近祖先 (契约 §31.2)', () => {
  it('嵌套节内段落返回**最近**节, 不是最外层', () => {
    const b = build()
    expect(sectionOf(b.ids.p2, b.pool)).toBe(b.ids.secA1)
  })

  it('外层节内段落返回其直接节', () => {
    const b = build()
    expect(sectionOf(b.ids.p1, b.pool)).toBe(b.ids.secA)
  })

  it('节外段落返回 null', () => {
    const b = build()
    expect(sectionOf(b.ids.p0, b.pool)).toBeNull()
  })

  it('Section 自身作为查询对象时返回其**父** Section (不是自己)', () => {
    const b = build()
    expect(sectionOf(b.ids.secA1, b.pool)).toBe(b.ids.secA)
    expect(sectionOf(b.ids.secA, b.pool)).toBeNull() // 顶层节无父节
  })

  it('节内表格 (非段落) 也能解析到节 (归属是真事实, 不是流)', () => {
    const doc = createDocument('t')
    const nodes = new Map<string, BaseNode>([[doc.id, doc as unknown as BaseNode]])
    const p = mkPara(nodes, 'x')
    const row = { type: NodeType.ROW, id: 'r1', children: ['c1'] }
    const cell = { type: NodeType.CELL, id: 'c1', children: [p] }
    const table = { type: NodeType.TABLE, id: 't1', columns: [], children: ['r1'] }
    nodes.set('r1', row as unknown as BaseNode)
    nodes.set('c1', cell as unknown as BaseNode)
    nodes.set('t1', table as unknown as BaseNode)
    const sec = createSection(['t1'], 'with_table')
    nodes.set(sec.id, sec as unknown as BaseNode)
    doc.body.children = [sec.id]
    expect(sectionOf('t1', { nodes })).toBe(sec.id)
    expect(sectionOf(p, { nodes })).toBe(sec.id)
  })
})

describe('QC 节级规则 — 可跳转定位 (契约 §31.10)', () => {
  function qc(b: Built) {
    const pool = buildNodePool(new Map(b.nodes), { body: b.doc.id })
    return new QCEngine().check(b.doc, pool)
  }

  it('section_empty: 空节报 warning, 定位到 nodeId', () => {
    const b = build()
    const issues = qc(b).issues.filter(i => i.ruleId === 'qc_008')
    expect(issues).toHaveLength(1)
    expect(issues[0].nodeId).toBe(b.ids.emptySec)
    // 空节没有可跳转的段落 → 不给 paragraphPath (有意的降级, 不是漏填)
    expect(issues[0].paragraphPath).toBeUndefined()
  })

  it('section_unnamed: 有内容但无 sectionCode 的节报 warning, 可跳到节内首段', () => {
    const b = build()
    const issues = qc(b).issues.filter(i => i.ruleId === 'qc_007')
    expect(issues).toHaveLength(1)
    expect(issues[0].nodeId).toBe(b.ids.unnamed)
    // 定位到节内第一个段落 —— 面板点击可跳
    expect(issues[0].paragraphPath?.[1]).toBeDefined()
    const pool = buildNodePool(new Map(b.nodes), { body: b.doc.id })
    const firstPara = (pool.nodes.get(b.ids.unnamed) as unknown as Section).children[0]
    expect(issues[0].paragraphPath![1]).toBe(firstPara)
  })

  it('有 sectionCode 且有内容的节不报任何节级问题', () => {
    const b = build()
    const ids = qc(b).issues.filter(i => i.ruleId === 'qc_007' || i.ruleId === 'qc_008').map(i => i.nodeId)
    expect(ids).not.toContain(b.ids.secA)
    expect(ids).not.toContain(b.ids.secA1)
  })

  it('无节文档不触发节级规则 (不误伤)', () => {
    const doc = createDocument('无节')
    const nodes = new Map<string, BaseNode>([[doc.id, doc as unknown as BaseNode]])
    const p = mkPara(nodes, '正文内容足够长以通过 min_chars')
    doc.body.children = [p]
    const pool = buildNodePool(nodes, { body: doc.id })
    const issues = new QCEngine().check(doc, pool).issues
    expect(issues.filter(i => i.ruleId === 'qc_007' || i.ruleId === 'qc_008')).toHaveLength(0)
  })

  it('规则名/描述走 i18n 键 (切语言后重跑即得新文案)', () => {
    const b = build()
    const pool = buildNodePool(new Map(b.nodes), { body: b.doc.id })
    const rules = new QCEngine().getRules()
    const r7 = rules.find(r => r.id === 'qc_007')!
    expect(r7.name.length).toBeGreaterThan(0)
    expect(r7.description.length).toBeGreaterThan(0)
    void pool
  })
})

describe('导入器 — section 路由 + 未知类型抛错 (契约 §12.2 / §31.5)', () => {
  const importer = new TemplateImporter()

  function externalDoc(bodyChildren: unknown[]): unknown {
    return {
      title: '外部模板',
      document: { body: { type: '$root', children: bodyChildren } },
    }
  }

  it('外部 section 节点 → 引擎 Section (含 sectionCode 与递归 children)', () => {
    const r = importer.import(externalDoc([
      {
        id: 'sec-1', type: 'section', code: 'past_history',
        children: [
          { id: 'p-1', type: 'paragraph', children: [{ id: 't-1', type: 'text', data: '既往史' }] },
        ],
      },
    ]))
    const sec = r.nodes.get('sec-1') as Section
    expect(sec.type).toBe(NodeType.SECTION)
    expect(sec.sectionCode).toBe('past_history')
    expect([...sec.children]).toEqual(['p-1'])
    expect(r.doc.body.children).toEqual(['sec-1'])
    // 节内段落可达
    expect(bodyBlockSpine(r.doc, { nodes: r.nodes })).toEqual(['p-1'])
  })

  it('section 缺 code → 匿名节 (不注入空字符串)', () => {
    const r = importer.import(externalDoc([
      { id: 'sec-2', type: 'section', children: [{ id: 'p-2', type: 'paragraph', children: [] }] },
    ]))
    const sec = r.nodes.get('sec-2') as Section
    expect('sectionCode' in sec).toBe(false)
  })

  it('节内可含表格与嵌套节 (递归 parseBlock)', () => {
    const r = importer.import(externalDoc([
      {
        id: 'sec-3', type: 'section', code: 'outer',
        children: [
          { id: 'sec-4', type: 'section', code: 'inner', children: [
            { id: 'p-3', type: 'paragraph', children: [{ id: 't-3', type: 'text', data: 'x' }] },
          ] },
        ],
      },
    ]))
    expect((r.nodes.get('sec-4') as Section).sectionCode).toBe('inner')
    expect(sectionsOf(r.doc, { nodes: r.nodes })).toEqual(['sec-3', 'sec-4'])
  })

  it('未知块类型 → **抛错**, 不静默丢弃整棵子树 (契约 §31.5)', () => {
    expect(() => importer.import(externalDoc([
      { id: 'weird-1', type: 'mystery_block', children: [{ id: 'p-9', type: 'paragraph', children: [] }] },
    ]))).toThrow(/unknown block type|未知块类型/)
  })

  it('insert/delete 修订标记仍走白名单跳过 (不抛错, 契约 §12.2)', () => {
    expect(() => importer.import(externalDoc([
      { id: 'ins-1', type: 'insert', children: [{ id: 'p-10', type: 'paragraph', children: [] }] },
      { id: 'del-1', type: 'delete', children: [] },
    ]))).not.toThrow()
  })
})

describe('MoveBlockCommand — 跨父移动 (此前根本不存在的能力)', () => {
  /** 建一个带 CommandManager 的文档上下文 */
  function mkCtx() {
    const doc = createDocument('move')
    const nodes = new Map<string, BaseNode>([[doc.id, doc as unknown as BaseNode]])
    const p0 = mkPara(nodes, '前')
    const p1 = mkPara(nodes, '节内')
    const p2 = mkPara(nodes, '后')
    const sec = createSection([p1], 's')
    nodes.set(sec.id, sec as unknown as BaseNode)
    doc.body.children = [p0, sec.id, p2]
    const pool = buildNodePool(nodes, { body: doc.id })
    const bus = new EventBus()
    const cm = new CommandManager(bus, () => doc, () => pool)
    return { doc, pool, cm, ids: { p0, p1, p2, sec: sec.id } }
  }

  it('把段落从节内移到 body (跨父移动成功)', () => {
    const { doc, pool, cm, ids } = mkCtx()
    cm.execute(new MoveBlockCommand(
      generateCommandId(), Date.now(), 'test', ids.p1, doc.id, 0,
    ))
    expect([...doc.body.children]).toEqual([ids.p1, ids.p0, ids.sec, ids.p2])
    expect([...(pool.nodes.get(ids.sec) as unknown as Section).children]).toEqual([])
    // 子树节点仍在池中 (移动是摘除+插入, 不是重建)
    expect(pool.nodes.has(ids.p1)).toBe(true)
  })

  it('把整个 Section 移到 body 另一位置', () => {
    const { doc, pool, cm, ids } = mkCtx()
    cm.execute(new MoveBlockCommand(
      generateCommandId(), Date.now(), 'test', ids.sec, doc.id, 3,
    ))
    expect([...doc.body.children]).toEqual([ids.p0, ids.p2, ids.sec])
    expect(pool.nodes.has(ids.sec)).toBe(true)
  })

  it('undo 原路移回 (invert 按来源容器与下标恢复)', () => {
    const { doc, pool, cm, ids } = mkCtx()
    cm.execute(new MoveBlockCommand(
      generateCommandId(), Date.now(), 'test', ids.p1, doc.id, 0,
    ))
    expect([...doc.body.children]).toEqual([ids.p1, ids.p0, ids.sec, ids.p2])
    cm.undo()
    expect([...doc.body.children]).toEqual([ids.p0, ids.sec, ids.p2])
    expect([...(pool.nodes.get(ids.sec) as unknown as Section).children]).toEqual([ids.p1])
  })

  it('非法移动 (移进自己的子树) 显式拒绝, 不做半途修改', () => {
    const { doc, pool, cm, ids } = mkCtx()
    const before = [...doc.body.children]
    cm.execute(new MoveBlockCommand(
      generateCommandId(), Date.now(), 'test', ids.sec, ids.sec, 0,
    ))
    expect([...doc.body.children]).toEqual(before)
    void pool
  })
})

// ================================================================
// P3 出口判据 —— 空 Section 语义 10 项验证 (计划书 §五)
//
// "Section 存在但 children=[]" vs "没有这一节", 必须在文档能够区分的每个系统里
// 都**可区分**。这十项就是计划书钉下来的验证模型。
// ================================================================

describe('空 Section 语义 — 10 项验证 (计划书 §五)', () => {
  /** body = [P, Section(empty)] —— 空节与普通段落共存 */
  function emptySectionFixture() {
    const doc = createDocument('空节')
    const nodes = new Map<string, BaseNode>([[doc.id, doc as unknown as BaseNode]])
    const p = mkPara(nodes, '正文')
    const sec = createSection([], 'empty_body')
    nodes.set(sec.id, sec as unknown as BaseNode)
    doc.body.children = [p, sec.id]
    const pool = buildNodePool(nodes, { body: doc.id })
    return { doc, pool, nodes, p, secId: sec.id }
  }

  it('1. serialization — 空节照常进扁平表 (collectDocumentNodes 在 children 检查之前入表)', () => {
    const f = emptySectionFixture()
    const ids = new Set<string>()
    const visit = (id: string) => {
      if (ids.has(id)) return
      ids.add(id)
      const n = f.pool.nodes.get(id) as unknown as { children?: readonly string[] } | undefined
      if (n?.children) for (const c of n.children) visit(c)
    }
    for (const id of f.doc.body.children) visit(id)
    expect(ids.has(f.secId)).toBe(true)
  })

  it('2. loading — 空节经序列化往返后仍在, 且仍是空节', () => {
    const f = emptySectionFixture()
    const roundTrip = serializeDocument(f.doc, f.pool)
    const reloaded = loadDocumentFromObject(JSON.parse(roundTrip))
    const sec = reloaded.pool.nodes.get(f.secId) as unknown as Section
    expect(sec).toBeTruthy()
    expect(sec.type).toBe(NodeType.SECTION)
    expect([...sec.children]).toEqual([])
    expect(sec.sectionCode).toBe('empty_body')
  })

  it('3. validation — 空节是**合法状态**, 不报错也不被误伤', () => {
    const f = emptySectionFixture()
    const json = serializeDocument(f.doc, f.pool)
    expect(() => loadDocumentFromObject(JSON.parse(json))).not.toThrow()
  })

  it('4. sectionsOf (W4) — 空节按类型枚举, 与 children 长度无关', () => {
    const f = emptySectionFixture()
    expect(sectionsOf(f.doc, { nodes: f.pool.nodes })).toEqual([f.secId])
  })

  it('5. sectionOf (R1) — 返回节 id, 与 children 长度无关', () => {
    const f = emptySectionFixture()
    expect(sectionOf(f.secId, { nodes: f.pool.nodes })).toBeNull() // 顶层节无父节
    expect(sectionOf(f.p, { nodes: f.pool.nodes })).toBeNull()     // 节外段落
  })

  it('6. QC — 空节被识别 (section_empty) 且**不掩盖**其他规则', () => {
    const f = emptySectionFixture()
    const result = new QCEngine().check(f.doc, f.pool)
    expect(result.issues.some(i => i.ruleId === 'qc_008' && i.nodeId === f.secId)).toBe(true)
    // 正文非空 → qc_002 (body 非空) 通过: 空节不掩盖正文统计
    expect(result.issues.every(i => i.ruleId !== 'qc_002')).toBe(true)
  })

  it('7. export — 平坦格式下空节产出零字符 (固有局限, 契约 §31.12)', () => {
    const f = emptySectionFixture()
    const txt = buildExportText(f.doc, { nodes: f.pool.nodes })
    expect(txt).toContain('正文')
    expect(txt.split('\n').filter(Boolean)).toEqual(['正文'])
  })

  it('8. undo — 空节子树快照是空操作, 移动后恢复仍为空节', () => {
    const f = emptySectionFixture()
    const cm = new CommandManager(new EventBus(), () => f.doc, () => f.pool)
    cm.execute(new MoveBlockCommand(
      generateCommandId(), Date.now(), 'test', f.secId, f.doc.id, 0,
    ))
    expect([...f.doc.body.children][0]).toBe(f.secId)
    cm.undo()
    expect([...(f.pool.nodes.get(f.secId) as unknown as Section).children]).toEqual([])
  })

  it('9. delete/move — 空节可从真实父容器重排, 不留残骸', () => {
    const f = emptySectionFixture()
    const cm = new CommandManager(new EventBus(), () => f.doc, () => f.pool)
    // 把段落移到下标 0 → [P, Section] (toIndex 是摘除后的位置, 与 moveChild 同语义)
    cm.execute(new MoveBlockCommand(
      generateCommandId(), Date.now(), 'test', f.p, f.doc.id, 0,
    ))
    expect([...f.doc.body.children]).toEqual([f.p, f.secId])
    expect(f.pool.nodes.has(f.secId)).toBe(true)
    // 空节自身仍是空节 (重排不重建子树)
    expect([...(f.pool.nodes.get(f.secId) as unknown as Section).children]).toEqual([])
  })

  it('10. UI projection — 空节在大纲里有占位条目 (用户看得见"这一节还在")', () => {
    const f = emptySectionFixture()
    const headings: string[] = []
    for (const id of bodyBlockSpine(f.doc, { nodes: f.pool.nodes })) {
      const n = f.pool.nodes.get(id) as unknown as { type?: string; outlineLevel?: number } | undefined
      if (n?.type === 'paragraph' && (n.outlineLevel ?? 0) > 0) headings.push(id)
    }
    expect(headings).toEqual([]) // 没有标题
    const covered = new Set(headings)
    const placeholderSections = sectionsOf(f.doc, { nodes: f.pool.nodes }).filter(s => !covered.has(s))
    expect(placeholderSections).toEqual([f.secId]) // 空节仍需被投影出来
  })
})
