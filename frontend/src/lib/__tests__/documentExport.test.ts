// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// documentExport — 导出构建 (页眉/页脚必须包含)
//
// 回归: 原 handleExport 的 TXT/HTML 两个分支只遍历 doc.body.children,
// 页眉页脚完全丢失; 且内层只收 text 子节点, smarttext / 域代码被丢弃。
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  buildExportHtml, buildExportText, collectParagraphText, getListMarker,
} from '../documentExport'
import type { ExportPool } from '../documentExport'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode, createFieldNode,
} from '@/engine/document/factory/ElementFormatter'
import type { DocumentTree, BaseNode, ElementMeta } from '@/engine/document/core/DocumentModel'

const NOW = new Date('2026-09-11T10:30:00')

interface Built { doc: DocumentTree; pool: ExportPool }

function build(opts: {
  body?: string[]
  header?: string[]
  footer?: string[]
  firstPageHeader?: string[]
  differentFirstPage?: boolean
}): Built {
  const doc = createDocument('导出测试')
  const nodes = new Map<string, BaseNode>()
  nodes.set(doc.id, doc as unknown as BaseNode)

  const mkPara = (text: string, children?: string[]) => {
    const tn = createTextNode(text)
    const p = createParagraph(children ?? [tn.id])
    nodes.set(tn.id, tn as unknown as BaseNode)
    nodes.set(p.id, p as unknown as BaseNode)
    return p.id
  }

  const bodyIds = (opts.body ?? []).map(t => mkPara(t))
  doc.body.children = bodyIds
  doc.header = (opts.header ?? []).map(t => mkPara(t))
  doc.footer = (opts.footer ?? []).map(t => mkPara(t))
  if (opts.firstPageHeader) {
    doc.firstPageHeader = opts.firstPageHeader.map(t => mkPara(t))
    doc.headerFooterConfig = { differentFirstPage: opts.differentFirstPage ?? true, differentOddEven: false }
  }

  return { doc, pool: { nodes } as unknown as ExportPool }
}

/** 在 doc/pool 上加一个 smarttext 子节点 */
function addSmartText(built: Built, paraId: string, placeholder: string, value?: string): void {
  const el: ElementMeta = { code: { internal: 'C1', dataElement: 'DE1' }, name: '姓名', format: { dataType: 'S1' } }
  const st = createSmartTextNode(placeholder, el)
  if (value !== undefined) st.value = value
  ;(built.pool.nodes as Map<string, unknown>).set(st.id, st)
  const para = built.pool.nodes.get(paraId) as unknown as { children: string[] }
  para.children = [...para.children, st.id]
}

/** 在 doc/pool 上加一个域代码子节点 */
function addField(built: Built, paraId: string, fieldType: 'page_number' | 'document_title'): void {
  const fld = createFieldNode(fieldType)
  ;(built.pool.nodes as Map<string, unknown>).set(fld.id, fld)
  const para = built.pool.nodes.get(paraId) as unknown as { children: string[] }
  para.children = [...para.children, fld.id]
}

describe('TXT 导出 — 页眉/页脚必须出现', () => {
  it('顺序为 页眉 → 正文 → 页脚', () => {
    const b = build({ header: ['页眉文字'], body: ['正文第一段', '正文第二段'], footer: ['页脚文字'] })
    const txt = buildExportText(b.doc, b.pool, NOW)
    const iHead = txt.indexOf('页眉文字')
    const iBody = txt.indexOf('正文第一段')
    const iFoot = txt.indexOf('页脚文字')
    expect(iHead).toBeGreaterThanOrEqual(0)
    expect(iBody).toBeGreaterThan(iHead)
    expect(iFoot).toBeGreaterThan(iBody)
  })

  it('页眉/页脚各只输出一次 (导出无分页)', () => {
    const b = build({ header: ['HEAD'], body: ['A', 'B', 'C'], footer: ['FOOT'] })
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt.split('HEAD').length - 1).toBe(1)
    expect(txt.split('FOOT').length - 1).toBe(1)
  })

  it('页眉页脚皆空时不崩且只有正文', () => {
    const b = build({ body: ['只有正文'] })
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).toBe('只有正文')
  })

  it('无正文只有页脚时仍输出页脚', () => {
    const b = build({ body: [], footer: ['仅页脚'] })
    expect(buildExportText(b.doc, b.pool, NOW)).toBe('仅页脚')
  })
})

describe('TXT 导出 — smarttext / 域代码', () => {
  it('smarttext 输出显示值 (非空值优先), 不再被丢弃', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], '[姓名]', '张三')
    expect(collectParagraphText(b.doc.body.children[0], b.pool, b.doc, NOW)).toBe('张三')
  })

  it('smarttext 未填 → 输出占位符', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], '[姓名]')
    expect(collectParagraphText(b.doc.body.children[0], b.pool, b.doc, NOW)).toBe('[姓名]')
  })

  it('域代码输出解析文本, 不再打成占位字面量', () => {
    const b = build({ body: [''] })
    addField(b, b.doc.body.children[0], 'document_title')
    expect(collectParagraphText(b.doc.body.children[0], b.pool, b.doc, NOW)).toBe('导出测试')
  })

  it('页脚内的域代码同样参与导出', () => {
    const b = build({ body: ['正文'], footer: ['第', ' 页'] })
    // 在页脚首段插入 document_title 域
    addField(b, b.doc.footer![0], 'document_title')
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).toContain('第导出测试')
  })
})

describe('TXT 导出 — 页眉变体回退', () => {
  it('仅填首页页眉 (differentFirstPage) → 导出仍含页眉内容', () => {
    const b = build({ body: ['正文'], firstPageHeader: ['首页页眉'] })
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).toContain('首页页眉')
  })

  it('默认页眉非空时优先默认变体', () => {
    const b = build({ body: ['正文'], header: ['默认页眉'], firstPageHeader: ['首页页眉'] })
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).toContain('默认页眉')
    expect(txt).not.toContain('首页页眉')
  })
})

describe('HTML 导出 — 页眉/页脚块', () => {
  it('页眉包在 <header>, 页脚包在 <footer>, 且正文在其间', () => {
    const b = build({ header: ['页眉'], body: ['正文'], footer: ['页脚'] })
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).toContain('<header>')
    expect(html).toContain('</header>')
    expect(html).toContain('<footer>')
    expect(html).toContain('</footer>')
    expect(html.indexOf('页眉')).toBeLessThan(html.indexOf('正文'))
    expect(html.indexOf('正文')).toBeLessThan(html.indexOf('页脚'))
  })

  it('页眉页脚为空 → 不产出 header/footer 标签', () => {
    const b = build({ body: ['正文'] })
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).not.toContain('<header>')
    expect(html).not.toContain('<footer>')
    expect(html).toContain('<p>正文</p>')
  })

  it('smarttext 与域代码进入 HTML 文本', () => {
    const b = build({ body: [''] })
    addSmartText(b, b.doc.body.children[0], '[姓名]', '张三')
    addField(b, b.doc.body.children[0], 'document_title')
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).toContain('张三')
    expect(html).toContain('导出测试')
  })

  it('HTML 转义 < > &', () => {
    const b = build({ body: ['a<b>&c'] })
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).toContain('a&lt;b&gt;&amp;c')
  })
})

describe('列表标记与既有行为保持一致', () => {
  it('无序列表带项目符号', () => {
    const b = build({ body: ['项目'] })
    const para = b.pool.nodes.get(b.doc.body.children[0]) as unknown as { list?: unknown }
    para.list = { type: 'bullet', level: 1 }
    const txt = buildExportText(b.doc, b.pool, NOW)
    expect(txt).not.toBe('项目')
    expect(txt).toContain('项目')
  })

  it('有序列表按 level 递增编号', () => {
    const b = build({ body: ['甲', '乙'] })
    for (const id of b.doc.body.children) {
      ;(b.pool.nodes.get(id) as unknown as { list?: unknown }).list = { type: 'ordered', level: 1 }
    }
    const txt = buildExportText(b.doc, b.pool, NOW)
    const lines = txt.split('\n')
    expect(lines[0]).toContain(getListMarker({ type: 'ordered', level: 1 }, 1))
    expect(lines[1]).toContain(getListMarker({ type: 'ordered', level: 1 }, 2))
  })

  it('HTML 列表产出 <ol>/<li>', () => {
    const b = build({ body: ['甲', '乙'] })
    for (const id of b.doc.body.children) {
      ;(b.pool.nodes.get(id) as unknown as { list?: unknown }).list = { type: 'ordered', level: 1 }
    }
    const html = buildExportHtml(b.doc, b.pool, NOW)
    expect(html).toContain('<ol>')
    expect(html).toContain('</ol>')
    expect(html).toContain('<li>')
  })

  it('页眉块内列表编号独立于正文 (计数器按块重置)', () => {
    const b = build({ header: ['页眉甲', '页眉乙'], body: ['正文甲'] })
    for (const id of [b.doc.header![0], b.doc.header![1], b.doc.body.children[0]]) {
      ;(b.pool.nodes.get(id) as unknown as { list?: unknown }).list = { type: 'ordered', level: 1 }
    }
    const txt = buildExportText(b.doc, b.pool, NOW)
    // 块间以空行分隔 → 过滤空行后取各块的行
    const lines = txt.split('\n').filter(l => l !== '')
    // 页眉两条 → 1, 2; 正文块重新从 1 开始
    expect(lines[0]).toContain(getListMarker({ type: 'ordered', level: 1 }, 1))
    expect(lines[1]).toContain(getListMarker({ type: 'ordered', level: 1 }, 2))
    expect(lines[2]).toContain(getListMarker({ type: 'ordered', level: 1 }, 1))
  })
})
