// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ofd.demo — 真实病历文档回归 (内置 demo, 走真实排版管线)
//
// 合成夹具覆盖不到真实文档的形状: 嵌套表、跨列、控件占位符、页眉页脚变体、
// 域代码混排。这份拿 admissionRecord.json 跑**真实 Draw**, 把 LayoutEngine
// 产出的 SLIF 直接喂给 OFD 构建器。
//
// 本机没有任何 OFD 阅读器, 端到端无法自动验证; 这里能锁住的是: 不崩、页数
// 对得上、包能被独立实现解开、每个控件都进了结构化数据区。**不能**证明合规。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildOfd, type OfdBuildInput } from '../buildOfd'
import { collectFields } from '../../fields'
import { sectionTreeOf, resolveFieldText, locale } from '@/engine'
import { Draw } from '@/engine/render/Draw'
import { EventBus } from '@/engine/interaction/EventBus'
import { buildNodePool } from '@/engine/document/core/NodePool'
import { createDomEditorHost, type DomEditorHost } from '@/platform/dom'
import { cumulativeCharWidths } from '@/engine/layout/text/CharWidthHelper'
import type { DocumentTree, BaseNode } from '@/engine/document/core/DocumentModel'
import type { TemplateDefinition } from '@/engine/template/TemplateDefinition'
import { testMeasurer } from '@/engine/__tests__/helpers'
import docJson from '@/mocks/admissionRecord.json'

const NOW = new Date('2026-09-29T12:00:00Z')
const ZIP_TIME = new Date('2026-01-01T00:00:00Z')

const LABELS = {
  patientInfo: '患者信息', admissionNo: '住院号', visitTime: '就诊时间',
  documentType: '文书类型', author: '书写医生', submittedAt: '提交时间',
  diagnosis: '诊断', procedure: '手术信息',
} as const

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

/** 挂载好的 host — LayeredRenderer 需要 surface.mount(container) 后才能建层 */
function makeHost(): DomEditorHost {
  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  cleanups.push(() => container.remove())
  return host
}

function loadDemo() {
  const doc = docJson as unknown as DocumentTree
  const raw = (docJson as unknown as { nodes: Record<string, BaseNode> }).nodes
  const nodes = new Map(Object.entries(raw))
  // 文档根节点不在 `nodes` 里 (它在 JSON 顶层) —— buildNodePool 要求它也在池中,
  // 否则 "Root node not found"
  nodes.set(doc.id, doc as unknown as BaseNode)
  const defsRaw = (docJson as unknown as { templateDefinitions?: Record<string, TemplateDefinition> }).templateDefinitions
  return { doc, nodes, templateDefinitions: defsRaw ? new Map(Object.entries(defsRaw)) : undefined }
}

/** 走真实排版管线拿 SLIF 页 + 一个真实的逐字形测宽端口 */
function buildPages() {
  const { doc, nodes, templateDefinitions } = loadDemo()
  const pool = buildNodePool(nodes, { body: doc.id })
  const eventBus = new EventBus()
  const draw = new Draw(makeHost(), eventBus, testMeasurer, doc)
  draw.setDocument(doc, pool)
  const pages = draw.recomputeLayout(pool)
  const poolView = { nodes: nodes as ReadonlyMap<string, { type: string; children?: readonly string[] }> }
  return { doc, pool: poolView, pages, templateDefinitions }
}

/** demo 的通用构建参数 */
function ofdInput(
  pages: ReturnType<typeof buildPages>['pages'],
  extra: Partial<OfdBuildInput> = {},
): OfdBuildInput {
  return {
    pages,
    charAdvance: (text, cfg) => cumulativeCharWidths(text, cfg, testMeasurer),
    labels: LABELS,
    document: {},
    provenance: {
      generator: 'EMRDocumentEngine', license: 'MPL-2.0',
      copyright: 'Copyright (c) 2026 陈庄旺', token: '1|9a449383|2026|MPL-2.0|21.0.0',
    },
    now: NOW,
    zipTime: ZIP_TIME,
    ...extra,
  }
}


describe('OFD — 内置 demo 病历文档 (真实排版)', () => {
  it('不崩, 且页数与排版结果一致', () => {
    const { doc, pages } = buildPages()
    expect(pages.length).toBeGreaterThan(0)

    const r = buildOfd(ofdInput(pages, { document: { id: doc.id, title: doc.title, modelVersion: '4.5.0' } }))

    expect(r.model.pages).toHaveLength(pages.length)
    expect(r.bytes.length).toBeGreaterThan(0)
    expect(r.entryNames.filter((n) => n.includes('/Pages/'))).toHaveLength(pages.length)
  })

  it('包能被独立实现 (fflate) 解开, 每个分件良构', () => {
    const { doc, pages } = buildPages()
    const r = buildOfd(ofdInput(pages, { document: { id: doc.id, title: doc.title } }))
    const files = unzipSync(r.bytes)
    expect(Object.keys(files)).toEqual(r.entryNames)
    for (const [name, bytes] of Object.entries(files)) {
      if (!name.endsWith('.xml')) continue
      const parsed = new DOMParser().parseFromString(strFromU8(bytes), 'text/xml')
      expect(parsed.getElementsByTagName('parsererror').length, name).toBe(0)
    }
  })

  it('每个控件都写进了结构化数据区 (一个不落)', () => {
    const { doc, pool, pages } = buildPages()
    const projection = collectFields({ doc, pool, sectionTree: sectionTreeOf(doc, pool) })

    const r = buildOfd(ofdInput(pages, {
      projection, document: { id: doc.id, title: doc.title },
    }))

    const data = strFromU8(unzipSync(r.bytes)['Doc_0/Attachments/ClinicalData.xml'])
    for (const f of projection.fields) {
      expect(data, f.name).toContain(`nodeId="${f.nodeId}"`)
    }
    expect(projection.fields).toHaveLength(28)
  })

  it('枚举控件的机器码与显示名在数据区里都在 (婚姻 N/未婚)', () => {
    const { doc, pool, pages } = buildPages()
    const projection = collectFields({ doc, pool, sectionTree: sectionTreeOf(doc, pool) })
    const r = buildOfd(ofdInput(pages, { projection, document: { id: doc.id, title: doc.title } }))
    const data = strFromU8(unzipSync(r.bytes)['Doc_0/Attachments/ClinicalData.xml'])
    expect(data).toContain('value="N"')
    expect(data).toContain('display="未婚"')
    expect(data).toContain('display="维吾尔族"')
  })

  it('域代码逐页解析, 不导出占位符', () => {
    const { doc, pages } = buildPages()
    const r = buildOfd(ofdInput(pages, {
      document: { id: doc.id, title: doc.title },
      resolveFieldText: (item: { fieldType?: string; text?: string }, pageIndex: number) =>
        resolveFieldText(item.fieldType, item.text, {
          pageNumber: pageIndex + 1,
          totalPages: pages.length,
          documentTitle: doc.title,
          now: NOW,
          locale: locale.getLocale(),
        }),
    }))
    const all = r.model.pages
      .flatMap((p) => p.objects.filter((o) => o.kind === 'text'))
      .map((o) => (o as { text: string }).text)
    // demo 页脚含页码域: 解析后应是数字, 不该留下 '[页码]'
    expect(all.some((t) => /^\d+$/.test(t))).toBe(true)
    expect(all).not.toContain('[页码]')
  })

  it('页面上真的有内容产出 (不是空包)', () => {
    const { doc, pages } = buildPages()
    const r = buildOfd(ofdInput(pages, { document: { id: doc.id, title: doc.title } }))
    const textCount = r.model.pages.reduce(
      (n, p) => n + p.objects.filter((o) => o.kind === 'text').length, 0,
    )
    const pathCount = r.model.pages.reduce(
      (n, p) => n + p.objects.filter((o) => o.kind === 'path').length, 0,
    )
    expect(textCount).toBeGreaterThan(50)  // demo 有 54 个段落
    expect(pathCount).toBeGreaterThan(0)   // 表格边框 + 页眉页脚分隔线
  })
})
