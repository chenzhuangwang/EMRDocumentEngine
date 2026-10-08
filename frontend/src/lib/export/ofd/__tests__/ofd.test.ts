// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// buildOfd — 合成 SLIF 夹具 (无 canvas, 完全确定)
//
// 桩测量端口按「每个码点固定宽度」算推进量, 于是所有几何断言都是精确值,
// 与真实字体无关。真实文档的回归另见 ofd.demo.test.ts。
//
// 断言策略: **看条目名 + 解析后的 XML**, 绝不断言原始字节 —— ZIP 会带时间戳,
// 逐字节断言是假失败的头号来源。(唯一例外是固定的 zipTime 下的确定性用例。)
// ============================================================

import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildOfd } from '../buildOfd'
import { MM_PER_PX, DEFAULT_HF_BAND_HEIGHT } from '../ofdModel'
import type { CharAdvancePort } from '../ofdModel'
import type { SLIFItem, SLIFPage } from '@/engine'

const NOW = new Date('2026-09-29T12:00:00Z')
const ZIP_TIME = new Date('2026-01-01T00:00:00Z')

/** 桩: 每个码点 16px —— 使 Σadvance === len(text) * 16 */
const charAdvance: CharAdvancePort = (text) => [...text].map(() => 16)

const LABELS = {
  patientInfo: '患者信息', admissionNo: '住院号', visitTime: '就诊时间',
  documentType: '文书类型', author: '书写医生', submittedAt: '提交时间',
  diagnosis: '诊断', procedure: '手术信息',
} as const

const PROVENANCE = {
  generator: 'EMRDocumentEngine 21.0.0', license: 'MPL-2.0',
  copyright: 'Copyright (c) 2026 陈庄旺', token: '1|9a449383|2026|MPL-2.0|21.0.0',
}

/** 造一个文本 run */
function textItem(over: Partial<SLIFItem> & { nodeId: string; text: string }): SLIFItem {
  return {
    nodeType: 'text',
    type: 'text',
    x: 90, y: 72, width: 160, height: 20,
    ascent: 16, descent: 4,
    font: 'SimSun', size: 16,
    ...over,
  } as SLIFItem
}

function page(over: Partial<SLIFPage> & { pageIndex: number }): SLIFPage {
  return { width: 794, height: 1123, items: [], ...over } as SLIFPage
}

function makeInput(pages: SLIFPage[], over: Record<string, unknown> = {}) {
  return {
    pages,
    charAdvance,
    document: { id: 'doc_1', title: '入院记录', modelVersion: '4.5.0' },
    labels: LABELS,
    provenance: PROVENANCE,
    now: NOW,
    zipTime: ZIP_TIME,
    ...over,
  }
}

function unzip(bytes: Uint8Array): Record<string, string> {
  const raw = unzipSync(bytes)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) out[k] = strFromU8(v)
  return out
}

function parseOk(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  expect(doc.getElementsByTagName('parsererror').length, 'XML 必须良构').toBe(0)
  return doc
}

function byLocal(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name)
}

/**
 * 单元格边框路径。
 *
 * 每页还有两条**高度为 0** 的路径 —— 页眉/页脚分隔线 (Draw.paintPage 无条件画)。
 * 按高度区分, 免得把分隔线算成单元格边框。
 */
function cellBorders(content: Document): Element[] {
  return byLocal(content, 'PathObject').filter((p) => {
    if (p.getAttribute('Stroke') !== 'true') return false
    const h = Number(p.getAttribute('Boundary')!.split(' ')[3])
    return h > 0
  })
}

describe('buildOfd — 包结构', () => {
  it('条目集合完整且 OFD.xml 排在最前 (入口先被找到)', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0, items: [textItem({ nodeId: 'n1', text: '主诉' })] })]))
    expect(r.entryNames).toEqual([
      'OFD.xml',
      'Doc_0/Document.xml',
      'Doc_0/Extensions.xml',
      'Doc_0/PublicRes.xml',
      'Doc_0/Pages/Page_0/Content.xml',
      'Doc_0/Attachments/ClinicalData.xml',
    ])
  })

  it('每个分件都是良构 XML; OFD 各分件带 ofd 命名空间', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0, items: [textItem({ nodeId: 'n1', text: '主诉' })] })]))
    const files = unzip(r.bytes)
    for (const [name, xml] of Object.entries(files)) {
      if (!name.endsWith('.xml')) continue
      parseOk(xml) // 每个分件都必须良构
      if (name.includes('Attachments/')) continue // 数据区用自有命名空间 (ofdHMapping)
      expect(xml, name).toContain('http://www.ofdspec.org/2016')
    }
  })

  it('多页 → 每页一个 Content.xml', () => {
    const r = buildOfd(makeInput([
      page({ pageIndex: 0 }), page({ pageIndex: 1 }), page({ pageIndex: 2 }),
    ]))
    expect(r.entryNames).toContain('Doc_0/Pages/Page_0/Content.xml')
    expect(r.entryNames).toContain('Doc_0/Pages/Page_1/Content.xml')
    expect(r.entryNames).toContain('Doc_0/Pages/Page_2/Content.xml')
  })

  it('同一输入 + 同一 zipTime ⇒ 逐字节相同 (可复现, 签章前提)', () => {
    const mk = () => buildOfd(makeInput([page({ pageIndex: 0, items: [textItem({ nodeId: 'n1', text: '主诉' })] })]))
    expect(Array.from(mk().bytes)).toEqual(Array.from(mk().bytes))
  })

  it('Document.xml 的 MaxUnitID 不小于任何对象 ID', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0, items: [textItem({ nodeId: 'n1', text: '主诉' })] })]))
    const doc = parseOk(unzip(r.bytes)['Doc_0/Document.xml'])
    const maxUnit = Number(byLocal(doc, 'MaxUnitID')[0].textContent)
    const ids = byLocal(parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml']), 'TextObject')
      .map((e) => Number(e.getAttribute('ID')))
    expect(maxUnit).toBeGreaterThanOrEqual(Math.max(...ids))
  })

  it('全文档 ID 唯一 (页 ID / 层 ID / 对象 ID 共用一个分配器)', () => {
    // 回归: 页 ID 与层 ID 曾各自 = 页索引派生, 于是第 1 页的 Page ID 与
    // 第 0 页的 Layer ID 撞成同一个号 —— OFD 要求单元 ID 全文档唯一。
    const r = buildOfd(makeInput([
      page({ pageIndex: 0, items: [textItem({ nodeId: 'a', text: '第一页' })] }),
      page({ pageIndex: 1, items: [textItem({ nodeId: 'b', text: '第二页' })] }),
      page({ pageIndex: 2, items: [textItem({ nodeId: 'c', text: '第三页' })] }),
    ]))
    const files = unzip(r.bytes)
    const ids: number[] = []

    const doc = parseOk(files['Doc_0/Document.xml'])
    for (const p of byLocal(doc, 'Page')) ids.push(Number(p.getAttribute('ID')))

    for (const name of Object.keys(files)) {
      if (!name.includes('/Pages/')) continue
      const content = parseOk(files[name])
      for (const layer of byLocal(content, 'Layer')) ids.push(Number(layer.getAttribute('ID')))
      for (const obj of byLocal(content, 'TextObject')) ids.push(Number(obj.getAttribute('ID')))
      for (const obj of byLocal(content, 'PathObject')) ids.push(Number(obj.getAttribute('ID')))
    }

    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size, `ID 有重复: ${ids.join(',')}`).toBe(ids.length)
  })
})

describe('buildOfd — 页面几何 (毫米)', () => {
  it('PhysicalBox 用 SLIF 实测尺寸换算, 不用 doc.pageSetup', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0 })]))
    const doc = parseOk(unzip(r.bytes)['Doc_0/Document.xml'])
    const box = byLocal(doc, 'PhysicalBox')[0].textContent!
    // 794px / 1123px @96dpi → A4 的毫米值
    expect(box).toBe(`0 0 ${(794 * 25.4 / 96).toFixed(3)} ${(1123 * 25.4 / 96).toFixed(3)}`)
  })

  it('页眉项 y 相对页顶; 页脚项 y 相对页脚带顶 (与 Draw.paintPage 同口径)', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      headerItems: [textItem({ nodeId: 'h1', text: '页眉', y: 10 })],
      footerItems: [textItem({ nodeId: 'f1', text: '页脚', y: 8 })],
      headerHeight: 42, footerHeight: 42,
    })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    const texts = byLocal(content, 'TextObject')
    const boundaryY = (t: Element) => Number(t.getAttribute('Boundary')!.split(' ')[1])
    const mmOf = (px: number) => Number((px * MM_PER_PX).toFixed(3))

    // 页眉: y = 10
    expect(texts.some((t) => Math.abs(boundaryY(t) - mmOf(10)) < 0.002)).toBe(true)
    // 页脚带顶 = 1123 - 42 = 1081; 项 y = 8 → 1089
    expect(texts.some((t) => Math.abs(boundaryY(t) - mmOf(1123 - 42 + 8)) < 0.002)).toBe(true)
  })

  it('页眉/页脚分隔线用同一个默认带高 (?? 42), 缺省也不漂', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0 })]))
    const content = unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml']
    const mmOf = (px: number) => Number((px * MM_PER_PX).toFixed(3))
    expect(content).toContain(`M 0.000 ${mmOf(DEFAULT_HF_BAND_HEIGHT).toFixed(3)}`)
  })
})

describe('buildOfd — 文本与逐字形 DeltaX', () => {
  it('DeltaX 长度等于码点数, 且总和等于布局记录的 item.width (右边界被钉住)', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      items: [textItem({ nodeId: 'n1', text: '主诉头痛三天', width: 160 })],
    })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    const code = byLocal(content, 'TextCode')[0]
    const delta = code.getAttribute('DeltaX')!.split(/\s+/).map(Number)
    expect(delta).toHaveLength([...'主诉头痛三天'].length) // 6
    // 桩测量是等宽 16px, 但 item.width=160 是布局给的 → 归一化后总和必须是 160px 的毫米值
    expect(delta.reduce((a, b) => a + b, 0)).toBeCloseTo(160 * MM_PER_PX, 2)
  })

  it('代理对按一个字形计算 (emoji 不被拆成两个推进量)', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      items: [textItem({ nodeId: 'n1', text: 'a\u{1F600}b', width: 48 })],
    })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    const delta = byLocal(content, 'TextCode')[0].getAttribute('DeltaX')!.split(/\s+/)
    expect(delta).toHaveLength(3)
  })

  it('TextCode 文本原样保留 (含 XML 元字符时不破坏良构)', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      items: [textItem({ nodeId: 'n1', text: 'a<b>&"c"' })],
    })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    expect(byLocal(content, 'TextCode')[0].textContent).toBe('a<b>&"c"')
  })

  it('字号缺失时回退到 16px 并留警告, Size 绝不为 0 (为 0 会被阅读器静默跳过 → 空白页)', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      items: [
        textItem({ nodeId: 'n1', text: '甲' }),
        textItem({ nodeId: 'n2', text: '乙', size: undefined } as never),
      ],
    })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    const sizes = byLocal(content, 'TextObject').map((t) => Number(t.getAttribute('Size')))
    expect(sizes).toHaveLength(2)
    for (const s of sizes) expect(s).toBeGreaterThan(0)
    // 缺字号不是静默回退 —— 要留下可追的痕迹
    expect(r.warnings.some((w) => w.code === 'zero-size-text')).toBe(true)
  })

  it('粗体/斜体落到 Weight / Italic', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      items: [textItem({ nodeId: 'n1', text: '强调', bold: true, italic: true })],
    })]))
    const t = byLocal(parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml']), 'TextObject')[0]
    expect(t.getAttribute('Weight')).toBe('700')
    expect(t.getAttribute('Italic')).toBe('true')
  })

  it('下划线/删除线/高亮出为 PathObject (OFD 的 TextObject 没有这些属性)', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      items: [textItem({ nodeId: 'n1', text: '甲', underline: true, strikeout: true, highlight: '#FFFF00' })],
    })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    expect(byLocal(content, 'TextObject')).toHaveLength(1)
    // 高亮填充 + 下划线 + 删除线 = 3 条路径
    expect(byLocal(content, 'PathObject').length).toBeGreaterThanOrEqual(3)
  })

  it('列表标记单独出一个 TextObject (渲染层由 ListParticle 分开绘制)', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      items: [textItem({
        nodeId: 'n1', text: '第一项', listMarker: '1. ', listMarkerX: 70, markerWidth: 20,
      } as never)],
    })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    const texts = byLocal(content, 'TextObject').map((t) => t.textContent)
    expect(texts).toContain('1. ')
    expect(texts).toContain('第一项')
  })
})

describe('buildOfd — 域代码逐页解析 (不使用占位符)', () => {
  it('域项用注入的解析器取真实值', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      items: [textItem({ nodeId: 'f1', type: 'field', nodeType: 'field', text: '1', fieldType: 'page_number' } as never)],
    })], {
      resolveFieldText: (item: { fieldType?: string }, pageIndex: number) =>
        item.fieldType === 'page_number' ? String(pageIndex + 1) : '',
    }))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    const texts = byLocal(content, 'TextCode').map((t) => t.textContent)
    // 第 1 页的页码域应产出 '1' —— 关键是它来自解析器, 而不是原样照抄占位符
    expect(texts).toContain('1')
    expect(texts).not.toContain('[页码]')
  })

  it('未注入解析器时, 域项原样输出 (退化但不崩)', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      items: [textItem({ nodeId: 'f1', type: 'field', nodeType: 'field', text: '[页码]' } as never)],
    })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    expect(byLocal(content, 'TextCode').map((t) => t.textContent)).toContain('[页码]')
  })
})

describe('buildOfd — 表格', () => {
  const tableItem: SLIFItem = {
    nodeId: 'tbl1', nodeType: 'table', type: 'table', x: 90, y: 200,
    width: 600, height: 60, ascent: 0, descent: 0, font: 'SimSun', size: 16,
    rows: [
      { height: 30, cells: [
        { id: 'c1', x: 0, y: 0, width: 300, height: 30, isHeader: true,
          items: [textItem({ nodeId: 'n1', text: '项目', x: 0, y: 4, width: 60 })] },
        { id: 'c2', x: 300, y: 0, width: 300, height: 30, isHeader: true,
          items: [textItem({ nodeId: 'n2', text: '结果', x: 0, y: 4, width: 60 })] },
      ] },
    ],
  } as unknown as SLIFItem

  it('每个单元格都有描边路径, 表头另有填充', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0, items: [tableItem] })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    expect(cellBorders(content)).toHaveLength(2)  // 2 个单元格各一条外框
    const filled = byLocal(content, 'PathObject').filter((p) => p.getAttribute('Fill') === 'true')
    expect(filled).toHaveLength(2)                // 两个都是表头 → 各一个底纹
    expect(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml']).toContain('Value="243 244 246"')
  })

  it('单元格内文本进入导出, 定位含 CELL_PAD 内边距', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0, items: [tableItem] })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    const texts = byLocal(content, 'TextCode').map((t) => t.textContent)
    expect(texts).toEqual(['项目', '结果'])
  })

  it('**跨页重复表头 (headerRows) 不丢** —— getFlatPageItems 会静默漏掉它', () => {
    const continuation = {
      ...tableItem,
      rows: [
        { height: 30, cells: [
          { id: 'c9', x: 0, y: 0, width: 300, height: 30,
            items: [textItem({ nodeId: 'n9', text: '续页数据', x: 0, y: 4, width: 60 })] },
        ] },
      ],
      // 续页片段: 重复表头在 headerRows 里
      headerRows: [
        { height: 30, cells: [
          { id: 'ch1', x: 0, y: 0, width: 300, height: 30, isHeader: true,
            items: [textItem({ nodeId: 'nh1', text: '重复表头', x: 0, y: 4, width: 60 })] },
        ] },
      ],
    } as unknown as SLIFItem

    const r = buildOfd(makeInput([
      page({ pageIndex: 0 }),
      page({ pageIndex: 1, items: [continuation] }),
    ]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_1/Content.xml'])
    const texts = byLocal(content, 'TextCode').map((t) => t.textContent)
    expect(texts).toContain('重复表头')
    expect(texts).toContain('续页数据')
    // 重复表头那一格也要有边框 (它同样在 allRows 里)
    expect(cellBorders(content)).toHaveLength(2)
  })

  it('嵌套表递归产出内层单元格的边框', () => {
    const nested = {
      nodeId: 'inner', nodeType: 'table', type: 'table', x: 0, y: 0,
      width: 100, height: 30, ascent: 0, descent: 0, font: 'SimSun', size: 16,
      rows: [{ height: 30, cells: [
        { id: 'ic1', x: 0, y: 0, width: 100, height: 30,
          items: [textItem({ nodeId: 'in1', text: '内层', x: 0, y: 4, width: 60 })] },
      ] }],
    } as unknown as SLIFItem

    const outer = {
      ...tableItem,
      rows: [{ height: 30, cells: [
        { id: 'oc1', x: 0, y: 0, width: 600, height: 30, items: [nested] },
      ] }],
      headerRows: undefined,
    } as unknown as SLIFItem

    const r = buildOfd(makeInput([page({ pageIndex: 0, items: [outer] })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    const texts = byLocal(content, 'TextCode').map((t) => t.textContent)
    expect(texts).toContain('内层')
    // 外层 1 格 + 内层 1 格 = 2 条单元格描边 (页眉/页脚分隔线不计, 见 cellBorders)
    expect(cellBorders(content)).toHaveLength(2)
  })
})

describe('buildOfd — 图片', () => {
  const PNG_1x1 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  const imgItem = {
    nodeId: 'img1', nodeType: 'image', type: 'image', x: 100, y: 300,
    width: 100, height: 80, ascent: 0, descent: 0, font: 'SimSun', size: 16,
  } as unknown as SLIFItem

  it('图片落成 Res/ 文件 + MultiMedia + ImageObject', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0, items: [imgItem] })], {
      images: new Map([['img1', PNG_1x1]]),
    }))
    expect(r.entryNames).toContain('Doc_0/Res/Image_0.png')
    expect(r.entryNames).toContain('Doc_0/DocumentRes.xml')

    const files = unzip(r.bytes)
    const res = parseOk(files['Doc_0/DocumentRes.xml'])
    expect(byLocal(res, 'MultiMedia')[0].getAttribute('Format')).toBe('PNG')
    const content = parseOk(files['Doc_0/Pages/Page_0/Content.xml'])
    expect(byLocal(content, 'ImageObject')).toHaveLength(1)
  })

  it('同一张图重复出现只落一份资源文件', () => {
    const r = buildOfd(makeInput([page({
      pageIndex: 0,
      items: [imgItem, { ...imgItem, nodeId: 'img2', y: 400 } as unknown as SLIFItem],
    })], { images: new Map([['img1', PNG_1x1], ['img2', PNG_1x1]]) }))
    expect(r.entryNames.filter((n) => n.startsWith('Doc_0/Res/'))).toHaveLength(1)
    expect(r.model.images).toHaveLength(1)
  })

  it('缺图片资源: 不产出指向空资源的 ImageObject, 改出占位框 + 警告', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0, items: [imgItem] })]))
    const content = parseOk(unzip(r.bytes)['Doc_0/Pages/Page_0/Content.xml'])
    expect(byLocal(content, 'ImageObject')).toHaveLength(0)
    expect(byLocal(content, 'PathObject').length).toBeGreaterThanOrEqual(1)
    expect(r.warnings.some((w) => w.code === 'missing-image')).toBe(true)
  })
})

describe('buildOfd — 结构化数据区 (业务字段不编造)', () => {
  it('派生得出的字段带 derived="true", 派生不出的显式 derived="false"', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0 })], {
      document: {
        id: 'doc_1', title: '入院记录', modelVersion: '4.5.0',
        metadata: { author: '李医生', updatedAt: '2026-07-17T14:20:00Z' },
      },
    }))
    const data = parseOk(unzip(r.bytes)['Doc_0/Attachments/ClinicalData.xml'])
    const metas = byLocal(data, 'meta')
    const byKey = new Map(metas.map((m) => [m.getAttribute('key'), m]))

    expect(byKey.get('documentType')!.getAttribute('derived')).toBe('true')
    expect(byKey.get('author')!.textContent).toBe('李医生')
    expect(byKey.get('author')!.getAttribute('derived')).toBe('true')
    expect(byKey.get('submittedAt')!.getAttribute('derived')).toBe('true')

    // 模型里根本没有的: 明确标为未派生, 且不带值
    for (const key of ['admissionNo', 'visitTime', 'diagnosis', 'procedure', 'patientInfo']) {
      const node = byKey.get(key)!
      expect(node.getAttribute('derived'), key).toBe('false')
      expect(node.textContent, key).toBe('')
    }
  })

  it('数据区自带人读标签 (机器键是 ASCII, 标签由 UI 注入)', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0 })]))
    const data = parseOk(unzip(r.bytes)['Doc_0/Attachments/ClinicalData.xml'])
    const meta = byLocal(data, 'meta').find((m) => m.getAttribute('key') === 'admissionNo')!
    expect(meta.getAttribute('label')).toBe('住院号')
  })

  it('未对齐 OFD-H: 显式标注 ofdHAligned="false", 不自称符合', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0 })]))
    const data = unzip(r.bytes)['Doc_0/Attachments/ClinicalData.xml']
    expect(data).toContain('ofdHAligned="false"')
    // 不得出现任何 OFD-H 正式术语 (今日未取得正文, 编术语就是伪造)
    expect(data).not.toContain('ofdHName=')
  })

  it('Extensions.xml 指向数据区 (OFD-H 工具无需扫附件)', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0 })]))
    const ext = parseOk(unzip(r.bytes)['Doc_0/Extensions.xml'])
    const extension = byLocal(ext, 'Extension')[0]
    expect(extension.getAttribute('Name')).toBe('EMRDE-StructuredData')
    const ref = byLocal(ext, 'ClinicalDataRef')[0]
    expect(ref.textContent).toBe('Attachments/ClinicalData.xml')
    // Document.xml 必须声明 Extensions, 否则扩展位形同虚设
    expect(unzip(r.bytes)['Doc_0/Document.xml']).toContain('<ofd:Extensions>')
  })

  it('DocID 缺省用溯源 token (32 位 ASCII, 将来签章可绑定)', () => {
    const r = buildOfd(makeInput([page({ pageIndex: 0 })]))
    const entry = parseOk(unzip(r.bytes)['OFD.xml'])
    expect(byLocal(entry, 'DocID')[0].textContent).toBe(PROVENANCE.token)
  })
})
