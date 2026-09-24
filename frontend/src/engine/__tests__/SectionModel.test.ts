// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SectionModel — Section 节点类型 + 版本闸门 + 加载校验 (契约 §31 / §14)
//
// P1 的三块内容:
//   1. 模型: Section / SectionChild / BodyChild / NodeType.SECTION
//   2. 版本: CURRENT_DOCUMENT_VERSION → 4.7.0 + 4.6.0 → 4.7.0 显式 no-op
//   3. 校验: validateDocument 的节点类型白名单 / 单父归属 / 环 / 深度 /
//      **modelVersion ↔ 节点类型一致性** (X12 的第二道防线)
//
// 校验必须读**源版本**而不是升级后的版本 —— 升级链会把 modelVersion 推到
// CURRENT, 若用升级后的版本做一致性校验, 该校验恒真、形同虚设。
// 本文件的"谎报 4.6.0 却含 Section"用例就是钉这一点的。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  loadDocumentFromObject, LoadError,
} from '../document/io/DocumentLoader'
import { serializeDocument } from '../document/io/DocumentSerializer'
import {
  createDocument, createParagraph, createTextNode, createSection,
} from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import { NodeType } from '../document/core/DocumentModel'
import type { BaseNode, DocumentTree, Section } from '../document/core/DocumentModel'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../document/version/DocumentFormatVersion'
import { bodyBlockSpine } from '../document/selection/SelectionCollector'
import docJson from '@/mocks/admissionRecord.json'

// ---- 夹具 ----

interface SecFixture {
  doc: DocumentTree
  nodes: Map<string, BaseNode>
  sectionId: string
  paraIds: string[]
  bodyTextIds: string[]
}

/**
 * body = [Section{ P1, P2 }, P3] 的合法 4.7.0 文档。
 * 与 walker 测试不同, 这里刻意走**真实加载链路** (serialize → loadDocumentFromObject),
 * 因为要验证的正是加载校验本身。
 */
function buildSectionDoc(opts: { version?: string } = {}): SecFixture {
  const doc = createDocument('section 文档')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)

  const mk = (text: string): { paraId: string; textId: string } => {
    const t = createTextNode(text)
    const p = createParagraph([t.id])
    nodes.set(t.id, t as unknown as BaseNode)
    nodes.set(p.id, p as unknown as BaseNode)
    return { paraId: p.id, textId: t.id }
  }

  const a = mk('节内第一段')
  const b = mk('节内第二段')
  const c = mk('节后正文')
  const sec = createSection([a.paraId, b.paraId], 'past_history')
  nodes.set(sec.id, sec as unknown as BaseNode)

  doc.body.children = [sec.id, c.paraId]
  if (opts.version) doc.modelVersion = opts.version

  return {
    doc, nodes, sectionId: sec.id,
    paraIds: [a.paraId, b.paraId, c.paraId],
    bodyTextIds: [a.textId, b.textId, c.textId],
  }
}

/** 经真实序列化产物加载 (模拟"新客户端读新文档") */
function loadFixture(f: SecFixture) {
  const pool = buildNodePool(f.nodes, { body: f.doc.id })
  const json = serializeDocument(f.doc, pool)
  return loadDocumentFromObject(JSON.parse(json))
}

/** 序列化产物 (可继续改写再加载) */
type RawDoc = Record<string, unknown> & {
  body: { mode: 'flow'; children: string[] }
  nodes: Record<string, BaseNode>
}

function rawOf(f: SecFixture): RawDoc {
  const pool = buildNodePool(f.nodes, { body: f.doc.id })
  return JSON.parse(serializeDocument(f.doc, pool)) as RawDoc
}

// ================================================================

describe('Section 模型 (契约 §31.10)', () => {
  it('NodeType.SECTION 与 NodeType.SECTION_BREAK 是两个不同的类型', () => {
    expect(NodeType.SECTION).toBe('section')
    expect(NodeType.SECTION_BREAK).toBe('section_break')
    expect(NodeType.SECTION).not.toBe(NodeType.SECTION_BREAK)
  })

  it('createSection 默认无 sectionCode; 显式传入才落字段', () => {
    const anon = createSection()
    expect(anon.type).toBe('section')
    expect(anon.children).toEqual([])
    expect('sectionCode' in anon).toBe(false)

    const named = createSection(['p1'], 'vitals')
    expect(named.sectionCode).toBe('vitals')
  })

  it('CURRENT_DOCUMENT_VERSION 为 4.7.0', () => {
    expect(versionToString(CURRENT_DOCUMENT_VERSION)).toBe('4.7.0')
  })
})

describe('Section round-trip (序列化 ↔ 加载)', () => {
  it('含 Section 的文档往返无损: Section 节点与其子树都在', () => {
    const f = buildSectionDoc()
    const r = loadFixture(f)

    const sec = r.pool.nodes.get(f.sectionId) as Section | undefined
    expect(sec).toBeDefined()
    expect(sec!.type).toBe(NodeType.SECTION)
    expect(sec!.sectionCode).toBe('past_history')
    // Section 的 children 引用完整 (真结构树, 契约 §31.2 Q9①)
    expect([...sec!.children]).toEqual(f.paraIds.slice(0, 2))
    for (const id of f.paraIds) expect(r.pool.nodes.has(id)).toBe(true)
    for (const id of f.bodyTextIds) expect(r.pool.nodes.has(id)).toBe(true)
  })

  it('加载后逻辑流正确: Section 展开, 自身不入列 (契约 §31.3 W2)', () => {
    const f = buildSectionDoc()
    const r = loadFixture(f)
    expect(bodyBlockSpine(r.doc, r.pool)).toEqual(f.paraIds)
  })

  it('body.children 保持真结构 (Section 作为直接子节点仍在原下标 0)', () => {
    const f = buildSectionDoc()
    const r = loadFixture(f)
    expect([...r.doc.body.children]).toEqual([f.sectionId, f.paraIds[2]])
  })
})

describe('加载校验 — 版本 ↔ 节点类型一致性 (契约 §31.12 X12)', () => {
  /**
   * 把 fixture 序列化后**改写 modelVersion** 再加载 —— 这是版本闸门挡不住的
   * 真实攻击面: 文档内容含 Section, 却声称自己是旧版本。
   */
  function loadAsVersion(f: SecFixture, version: string | undefined) {
    const raw = rawOf(f)
    if (version === undefined) delete raw.modelVersion
    else raw.modelVersion = version
    return loadDocumentFromObject(raw)
  }

  it('谎报 4.6.0 却含 Section → 拒绝 (版本闸门挡不住的路径)', () => {
    const f = buildSectionDoc()
    expect(() => loadAsVersion(f, '4.6.0')).toThrow(LoadError)
    expect(() => loadAsVersion(f, '4.6.0')).toThrow(/Section/)
  })

  it('缺失 modelVersion (落到 LEGACY) 却含 Section → 拒绝', () => {
    const f = buildSectionDoc()
    expect(() => loadAsVersion(f, undefined)).toThrow(LoadError)
  })

  it('谎报 4.6.0 且**不含** Section → 不触发一致性校验 (只挡类型, 不挡版本)', () => {
    // 反例保护: 校验的是"文档里有 Section 却声称 < 4.7", 不是"版本 < 4.7 就拒绝"
    const doc = createDocument('旧文档')
    const t = createTextNode('正文')
    const p = createParagraph([t.id])
    const nodes = new Map<string, BaseNode>([
      [doc.id, doc as unknown as BaseNode],
      [t.id, t as unknown as BaseNode],
      [p.id, p as unknown as BaseNode],
    ])
    doc.body.children = [p.id]
    const raw = JSON.parse(serializeDocument(doc, buildNodePool(nodes, { body: doc.id }))) as RawDoc
    raw.modelVersion = '4.6.0'
    const r = loadDocumentFromObject(raw)
    expect(r.doc.modelVersion).toBe('4.7.0')
    expect(r.wasUpgraded).toBe(true)
  })

  it('4.7.0 且含 Section → 通过', () => {
    const f = buildSectionDoc()
    expect(() => loadAsVersion(f, '4.7.0')).not.toThrow()
  })
})

describe('加载校验 — 结构语义 (契约 §31.12 X12)', () => {
  /** 在序列化产物上做一次"脏数据注入", 再走加载 */
  function loadMutated(f: SecFixture, mutate: (raw: RawDoc) => void) {
    const raw = rawOf(f)
    mutate(raw)
    return loadDocumentFromObject(raw)
  }

  it('未知节点类型 → 拒绝 (类型白名单)', () => {
    const f = buildSectionDoc()
    expect(() => loadMutated(f, (raw) => {
      raw.nodes['rogue_1'] = {
        id: 'rogue_1', type: 'not_a_real_type',
      } as unknown as BaseNode
      raw.body.children = [...raw.body.children, 'rogue_1']
    })).toThrow(/Unknown node type|未知节点类型/)
  })

  it('单父归属: 同一段落被 body 与 Section 同时引用 → 拒绝', () => {
    const f = buildSectionDoc()
    expect(() => loadMutated(f, (raw) => {
      // P1 既在 Section.children 里, 又被塞进 body.children
      raw.body.children = [...raw.body.children, f.paraIds[0]]
    })).toThrow(/more than one parent|多个父引用/)
  })

  it('环状引用 → 拒绝 (不会无限递归)', () => {
    const f = buildSectionDoc()
    expect(() => loadMutated(f, (raw) => {
      // Section.children 里塞进它自己
      const sec = raw.nodes[f.sectionId] as unknown as { children: string[] }
      sec.children = [...sec.children, f.sectionId]
    })).toThrow(/more than one parent|多个父引用/)
  })

  it('嵌套深度超上限 → 拒绝', () => {
    const f = buildSectionDoc()
    expect(() => loadMutated(f, (raw) => {
      // 造 120 层嵌套 Section 链
      let prev: string | null = null
      for (let i = 0; i < 120; i++) {
        const s = createSection(prev ? [prev] : [])
        raw.nodes[s.id] = s as unknown as BaseNode
        prev = s.id
      }
      raw.body.children = [prev as string]
    })).toThrow(/deeper than the limit|嵌套超过上限/)
  })
})

describe('加载校验 — 不误伤既有合法文档', () => {
  it('demo 病历文档 (4.5.0, 含嵌套表格) 照常加载', () => {
    const r = loadDocumentFromObject(JSON.parse(JSON.stringify(docJson)))
    expect(r.doc.modelVersion).toBe('4.7.0')
    expect(r.pool.rootIds.body).toBe(r.doc.id)
  })
})
