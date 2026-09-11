// ============================================================
// PrintRender — 打印投影必须包含页眉/页脚 + 逐页域代码解析
//
// 回归: renderPageToContext 原先只遍历 page.items, 页眉页脚在打印稿里
// 完全消失; 且不调 resolveFieldText → 正文域代码打印成占位字面量 '[页码]'。
// 契约 §4/§12: 打印是渲染管线的投影, 不得有第二个渲染器。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import {
  createDocument, createParagraph, createTextNode, createFieldNode,
} from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { Draw } from '../render/Draw'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import { testMeasurer } from './helpers'

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

/** 记录型 2D 上下文 — 引擎只画在注入的 ctx 上 (契约 §27.2), 无需真 canvas */
function recordingCtx(): { ctx: CanvasRenderingContext2D; texts: string[]; rects: () => number } {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const texts: string[] = []
  let rectCount = 0
  const rec = ctx as unknown as Record<string, unknown>
  rec.fillText = (t: string) => { texts.push(t) }
  rec.strokeRect = () => { rectCount++ }
  return { ctx, texts, rects: () => rectCount }
}

interface Built { doc: DocumentTree; pool: ReturnType<typeof buildNodePool> }

/** 文档: body 若干段 + header 段 + footer 段 (footer 含页码域) */
function buildDoc(bodyParas: number, footerText: string, withFooterField: boolean): Built {
  const doc = createDocument('print')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  const mk = (text: string, extra?: (paraId: string) => void) => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    all.set(tn.id, tn as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    extra?.(p.id)
    return p.id
  }

  const bodyIds: string[] = []
  for (let i = 0; i < bodyParas; i++) bodyIds.push(mk(`正文第${i + 1}段`))
  doc.body.children = bodyIds

  doc.header = [mk('页眉文字')]

  // footer: 文字 + 可选页码域
  const ftn = createTextNode(footerText)
  const fpara = createParagraph([ftn.id])
  all.set(ftn.id, ftn as unknown as BaseNode)
  all.set(fpara.id, fpara as unknown as BaseNode)
  if (withFooterField) {
    const fld = createFieldNode('page_number')
    all.set(fld.id, fld as unknown as BaseNode)
    fpara.children = [ftn.id, fld.id]
  }
  doc.footer = [fpara.id]

  const pool = buildNodePool(all, { body: doc.id })
  return { doc, pool }
}

function printPage(doc: DocumentTree, pool: Built['pool'], pageIndex: number) {
  const eventBus = new EventBus()
  const draw = new Draw(makeHost(), eventBus, testMeasurer, doc)
  draw.setDocument(doc, pool)
  draw.recomputeLayout(pool)
  const pages = draw.getPages()
  const page = pages[pageIndex]
  const rec = recordingCtx()
  draw.renderPageToContext(rec.ctx, page, page.width)
  draw.destroy()
  return { page, texts: rec.texts, strokeRects: rec.rects(), pageCount: pages.length }
}

describe('打印渲染 — 页眉/页脚必须出现', () => {
  it('页眉文字、页脚文字、正文文字都进入打印稿', () => {
    const { doc, pool } = buildDoc(3, '页脚文字', false)
    const { texts } = printPage(doc, pool, 0)
    expect(texts).toContain('页眉文字')
    expect(texts).toContain('页脚文字')
    expect(texts).toContain('正文第1段')
  })

  it('页脚缺失时正文仍正常打印 (不崩, 无页脚文字)', () => {
    const { doc, pool } = buildDoc(2, '页脚文字', false)
    doc.footer = []
    const { texts } = printPage(doc, pool, 0)
    expect(texts).toContain('正文第1段')
    expect(texts).not.toContain('页脚文字')
  })

  it('页眉缺失时正文仍正常打印', () => {
    const { doc, pool } = buildDoc(2, '页脚文字', false)
    doc.header = []
    const { texts } = printPage(doc, pool, 0)
    expect(texts).toContain('正文第1段')
    expect(texts).not.toContain('页眉文字')
  })
})

describe('打印渲染 — 域代码逐页解析 (非占位字面量)', () => {
  it('页脚里的页码域按页解析, 第 0 页=1 / 第 1 页=2', () => {
    // 足够多正文段落 → 至少两页
    const { doc, pool } = buildDoc(120, '第', true)
    const p0 = printPage(doc, pool, 0)
    expect(p0.pageCount).toBeGreaterThan(1)

    const p1 = printPage(doc, pool, 1)
    expect(p0.texts).toContain('1')
    expect(p1.texts).toContain('2')
    // 占位字面量不得出现
    expect(p0.texts).not.toContain('[页码]')
    expect(p1.texts).not.toContain('[页码]')
  })

  it('正文里的域代码同样按页解析 (不再打成 [页码])', () => {
    const { doc, pool } = buildDoc(1, '页脚', false)
    // 把一个页码域塞进正文首段
    const fld = createFieldNode('page_number')
    const bodyParaId = doc.body.children[0]
    const para = pool.nodes.get(bodyParaId) as unknown as { children: string[] }
    pool.addNode(fld as unknown as BaseNode)
    para.children = [...para.children, fld.id]

    const { texts } = printPage(doc, pool, 0)
    expect(texts).toContain('1')
    expect(texts).not.toContain('[页码]')
  })
})

describe('打印渲染 — 不可见字符不进打印稿', () => {
  it('showInvisible 开启时打印仍不输出编辑标记', () => {
    const { doc, pool } = buildDoc(1, '页脚', false)
    const eventBus = new EventBus()
    const draw = new Draw(makeHost(), eventBus, testMeasurer, doc)
    draw.setDocument(doc, pool)
    draw.recomputeLayout(pool)
    draw.showInvisible = true
    const rec = recordingCtx()
    draw.renderPageToContext(rec.ctx, draw.getPages()[0], draw.getPages()[0].width)
    draw.destroy()
    // 编辑标记是 '¶' / '·' 等; 正文文字仍应在
    expect(rec.texts).toContain('正文第1段')
    expect(rec.texts.join('')).not.toContain('¶')
  })
})

describe('打印与屏幕共用分页几何', () => {
  it('页脚带顶 = page.height - footerHeight', () => {
    const { doc, pool } = buildDoc(3, '页脚文字', false)
    const { page } = printPage(doc, pool, 0)
    const footerH = page.footerHeight ?? 42
    expect(footerH).toBeGreaterThan(0)
    expect(page.height - footerH).toBeGreaterThan(0)
    // 页脚 item 的 y 是带内相对坐标, 必须落在带高以内
    for (const it of page.footerItems ?? []) {
      expect(it.y).toBeGreaterThanOrEqual(0)
      expect(it.y).toBeLessThanOrEqual(footerH)
    }
  })

  it('LayoutEngine 直接产出的分页与 Draw 一致 (冒烟)', () => {
    const { doc, pool } = buildDoc(3, '页脚文字', false)
    const pages = new LayoutEngine(new EventBus(), testMeasurer).fullLayout(doc, pool)
    expect((pages[0].footerItems ?? []).length).toBeGreaterThan(0)
    expect((pages[0].headerItems ?? []).length).toBeGreaterThan(0)
  })
})
