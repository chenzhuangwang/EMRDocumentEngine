// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 引擎侧文案随语言变 (i18n 引擎层接线闸门 — QC / 错误提示篇)
//
// 引擎层此前把「已翻译好的中文」直接存进数据结构:
//   - QCIssue.ruleName / .message ← QCEngine 的规则字面量 (面板直接渲染)
//   - store.lastEngineError.message ← ErrorRecovery 的 message 快照
// 于是切语言后这些**已算出的结果**永远是旧语言, 除非重跑/重报。
//
// 本批改成: QC 规则存 i18n 键、check() 时现展开; 错误带 key+params, UI 现译。
// 这里守住两条:
//   A. 重跑 runQC() 就拿到新语言 (不缓存语言)
//   B. 错误带 key, 且 errorKeyOf 的去重不因切语言而失效
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QCEngine } from '../qc/QCEngine'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { buildNodePool, type NodePool } from '../document/core/NodePool'
import { locale } from '../i18n/index'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

function makeDoc(): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument('入院记录')
  const t1 = createTextNode('这是一份足够长的正文内容用于通过字数阈值校验。')
  const para = createParagraph([t1.id])
  doc.body.children = [para.id]
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)
  nodes.set(t1.id, t1 as unknown as BaseNode)
  nodes.set(para.id, para as unknown as BaseNode)
  return { doc, pool: buildNodePool(nodes, { body: doc.id }) }
}

/** 造一份必然触发 qc_002 (空 body) 的文档, 保证有 issue 可断言 */
function makeEmptyBodyDoc(): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument('只有标题')
  doc.body.children = []
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)
  return { doc, pool: buildNodePool(nodes, { body: doc.id }) }
}

beforeEach(() => { locale.setLocale('zh-CN') })
afterEach(() => { locale.setLocale('zh-CN') })

describe('QCEngine 规则文案随语言变', () => {
  it('zh-CN → 规则名与描述是中文', () => {
    const rules = new QCEngine().getRules()
    const r2 = rules.find((r) => r.id === 'qc_002')!
    expect(r2.name).toBe('文档包含正文内容')
    expect(r2.description).toBe('文档 body 至少包含一个段落')
  })

  it('en-US → 同一份规则表变成英文 (getRules 现读语言包)', () => {
    locale.setLocale('en-US')
    const rules = new QCEngine().getRules()
    const r2 = rules.find((r) => r.id === 'qc_002')!
    expect(r2.name).toBe('Document contains body content')
    expect(r2.description).toBe('The document body must contain at least one paragraph')
  })

  it('**不缓存语言**: 同一个 QCEngine 实例切语言后重跑即得新文案', () => {
    const engine = new QCEngine()
    const { doc, pool } = makeEmptyBodyDoc()

    const zh = engine.check(doc, pool)
    const issueZh = zh.issues.find((i) => i.ruleId === 'qc_002')!
    expect(issueZh.ruleName).toBe('文档包含正文内容')

    locale.setLocale('en-US')

    const en = engine.check(doc, pool)
    const issueEn = en.issues.find((i) => i.ruleId === 'qc_002')!
    expect(issueEn.ruleName).toBe('Document contains body content')
    expect(issueEn.ruleName).not.toBe(issueZh.ruleName)
  })

  it('自定义规则不受影响 (仍是现成字符串, 不参与 i18n)', () => {
    const engine = new QCEngine([
      { id: 'custom_1', name: '院内自定义规则', description: '说明', severity: 'info', check: 'min_chars:0' },
    ])
    locale.setLocale('en-US')
    const custom = engine.getRules().find((r) => r.id === 'custom_1')!
    expect(custom.name).toBe('院内自定义规则')
  })

  it('评分与判定不受文案语言影响 (规则 id / severity 是稳定锚点)', () => {
    const { doc, pool } = makeDoc()
    const zh = new QCEngine().check(doc, pool)
    locale.setLocale('en-US')
    const en = new QCEngine().check(doc, pool)
    expect(en.score).toBe(zh.score)
    expect(en.grade).toBe(zh.grade)
    expect(en.issues.map((i) => i.ruleId).sort()).toEqual(zh.issues.map((i) => i.ruleId).sort())
  })
})
