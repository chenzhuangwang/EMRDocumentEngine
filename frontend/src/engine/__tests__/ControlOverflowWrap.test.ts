// ================================================================
// ControlOverflowWrap — 控件内容超宽必须折行, 不得横向溢出正文区 (契约 §12.8)
//
// 回归 (issue): 主诉控件填入一长串无空格数字 → 控件整块横向溢出页面右边界。
// 根因: brackets 配方 (input/number/date/select/遗留 controlType) 的量宽是
// 「整段值宽」且 LineBreaker 视 smarttext 为原子元素 (不逐字拆分) → 整块推出
// 页面; textarea (box) 已有 wrapControlText + 锁宽, 但表格 cell / 页眉页脚
// 路径连 box 分支都没有。
//
// 修复: 三条布局路径 (正文/表格 cell/页眉页脚) 共用 layout/control/
// ControlLayoutHint.smarttextLayoutHint —— 内容宽于可用宽时折行 + 锁盒宽
// + minRows 延展行高; ControlParticle 逐行绘制 ( '[' 首行 / ']' 末行 )。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
  createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import { createControlParticle } from '../render/particles/ControlParticle'
import type { SLIFItem } from '../layout/core/SLIF'
import type { BaseNode, DocumentTree, ElementMeta, ControlValue } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import type { EditorRuntimeState } from '../state/EditorRuntimeState'

/** LayoutEngine 缺省版心 (pageWidth 794 - margin 90*2) */
const CONTENT_W = 794 - 90 - 90
const LONG = '1'.repeat(120)

function docOf(nodes: BaseNode[], bodyIds: string[], extras?: (doc: DocumentTree) => void) {
  const doc = createDocument('wrap')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)
  for (const n of nodes) all.set(n.id, n as unknown as BaseNode)
  doc.body.children = bodyIds
  extras?.(doc)
  const pool: NodePool = buildNodePool(all, { body: doc.id, header: doc.header, footer: doc.footer })
  return { doc, pool }
}

/** 单段落 = [前置文本?] + smarttext(value) */
function paraDoc(
  opts: {
    controlType?: string
    value?: ControlValue
    label?: string
    paragraphText?: string
    elementName?: string
  } = {},
) {
  const el: ElementMeta = {
    code: { internal: 'C', dataElement: 'D' },
    name: opts.elementName ?? '主诉',
    format: { dataType: 'S1' },
  }
  const st = createSmartTextNode(`[${el.name}]`, el, undefined, opts.value)
  const label = createTextNode(opts.paragraphText ?? '主诉：')
  const para = createParagraph([label.id, st.id])
  const { doc, pool } = docOf([label, st, para], [para.id])
  const engine = new LayoutEngine(new EventBus(), testMeasurer)
  const def: TemplateDefinition | undefined = opts.controlType
    ? ({ controlType: opts.controlType, label: opts.label } as TemplateDefinition)
    : undefined
  engine.setControlInfoOf((id) => (id === st.id && def ? def : undefined))
  return { engine, doc, pool, stId: st.id }
}

const itemOf = (pages: ReturnType<LayoutEngine['fullLayout']>, id: string): SLIFItem | undefined =>
  pages.flatMap((p) => p.items ?? []).find((i) => i.nodeId === id)

/** 页面内任何 item 的右边界都不得越过版心右缘 */
function assertNoOverflow(pages: ReturnType<LayoutEngine['fullLayout']>, limit = 90 + CONTENT_W) {
  for (const page of pages) {
    for (const it of page.items ?? []) {
      expect((it.x ?? 0) + (it.width ?? 0), `${it.nodeType}@${it.nodeId}`).toBeLessThanOrEqual(limit + 0.5)
    }
  }
}

describe('控件超宽折行 — 布局 (契约 §12.8)', () => {
  for (const controlType of ['input', 'number', 'date', 'select', 'textarea', undefined]) {
    it(`${controlType ?? '(遗留未落 controlType)'} 长值 → 锁盒宽 + 折行, 不溢出`, () => {
      const { engine, doc, pool, stId } = paraDoc({ controlType, value: LONG })
      const pages = engine.fullLayout(doc, pool)
      assertNoOverflow(pages)
      const item = itemOf(pages, stId)!
      // item.width = 控件盒宽 (推进宽 = 盒宽 + 2*CONTROL_BOX_PADDING), 盒宽锁到版心宽
      expect(item.width).toBeCloseTo(CONTENT_W, 0)
      const lines = item.controlLines ?? []
      expect(lines.length).toBeGreaterThan(1)
      expect(lines.join('')).toBe(LONG)
      // 每行都放得下 (折行口径 ≤ 盒内容宽)
      const widest = Math.max(...lines.map((l) => testMeasurer.measureWidth(l, { font: 'SimSun', size: 16 })))
      expect(widest).toBeLessThanOrEqual(CONTENT_W + 0.5)
    })
  }

  it('折行后行高按行数延展 (多行文本不压到下一行)', () => {
    const { engine, doc, pool, stId } = paraDoc({ controlType: 'input', value: LONG })
    const pages = engine.fullLayout(doc, pool)
    const item = itemOf(pages, stId)!
    const rows = (item.controlLines ?? []).length
    expect(rows).toBeGreaterThan(1)
    // ascent + descent = rows * size (与 LineBreaker minRows 延展同源)
    expect((item.ascent ?? 0) + (item.descent ?? 0)).toBeCloseTo(rows * 16, 0)
  })

  it('短值不受影响 (回归: 宽度仍 = 值宽 + 括号 + 内边距)', () => {
    const { engine, doc, pool, stId } = paraDoc({ controlType: 'input', value: '123' })
    const item = itemOf(engine.fullLayout(doc, pool), stId)!
    const expected = testMeasurer.measureWidth('[123]', { font: 'SimSun', size: 16 })
    expect(item.width).toBeCloseTo(expected, 0)
    expect(item.controlLines).toBeUndefined()
  })

  it('空态占位符仍按占位符量宽 (不折行)', () => {
    const { engine, doc, pool, stId } = paraDoc({ controlType: 'input' })
    const item = itemOf(engine.fullLayout(doc, pool), stId)!
    const expected = testMeasurer.measureWidth('[主诉]', { font: 'SimSun', size: 16 })
    expect(item.width).toBeCloseTo(expected, 0)
  })

  it('label 附属字面量与盒的总推进宽不超过版心 (预留宽先扣除附属字面量)', () => {
    const { engine, doc, pool, stId } = paraDoc({ controlType: 'input', value: LONG, label: '主诉：' })
    const pages = engine.fullLayout(doc, pool)
    assertNoOverflow(pages)
    const item = itemOf(pages, stId)!
    // 盒 + label 都在同一 item 的 width 内 (ControlParticle 从 width 里扣 lead)
    expect(item.width).toBeCloseTo(CONTENT_W, 0)
  })

  it('缩进段落内的长值控件 → 独占起行 + 锁宽扣除缩进, 仍不越过版心右缘', () => {
    const el: ElementMeta = { code: { internal: 'C', dataElement: 'D' }, name: '主诉', format: { dataType: 'S1' } }
    const st = createSmartTextNode('[主诉]', el, undefined, LONG)
    const label = createTextNode('主诉：')
    const para = createParagraph([label.id, st.id], { indent: 40, firstLineIndent: 32 })
    const { doc, pool } = docOf([label, st, para], [para.id])
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    engine.setControlInfoOf((id) => (id === st.id ? { controlType: 'input' } : undefined))

    const pages = engine.fullLayout(doc, pool)
    assertNoOverflow(pages)
    const item = itemOf(pages, st.id)!
    // 可用宽 = 版心 - 块缩进 - 首行缩进 (保守取下限)
    expect(item.width).toBeCloseTo(CONTENT_W - 40 - 32, 0)
    // 独占起行: 前置文本在上一行, 控件从行起点 (版心左缘 + 块缩进) 开始
    const labelItem = itemOf(pages, label.id)!
    expect(item.y).toBeGreaterThan(labelItem.y ?? 0)
    expect(item.x).toBeCloseTo(90 + 40, 0)
  })

  it('锁宽控件独占起行 (不与前置内容挤同一行的剩余宽)', () => {
    const { engine, doc, pool, stId } = paraDoc({ controlType: 'input', value: LONG })
    const pages = engine.fullLayout(doc, pool)
    assertNoOverflow(pages)
    const item = itemOf(pages, stId)!
    expect(item.x).toBeCloseTo(90, 0)
    // 未锁宽 (短值) 时仍与前置文本同行 (行为不变)
    const short = paraDoc({ controlType: 'input', value: '123' })
    const sPages = short.engine.fullLayout(short.doc, short.pool)
    const sItem = itemOf(sPages, short.stId)!
    expect(sItem.x).toBeGreaterThan(90)
  })

  it('表格 cell 内长值 → 不溢出 cell 文本宽', () => {
    const el: ElementMeta = { code: { internal: 'C', dataElement: 'D' }, name: '住址', format: { dataType: 'S1' } }
    const st = createSmartTextNode('[住址]', el, undefined, LONG)
    const para = createParagraph([st.id])
    const cell = createTableCell([para.id])
    const row = createTableRow([cell])
    const table = createTable([{ width: 100, mode: 'percentage' }], [row])
    const { doc, pool } = docOf([st, para, cell, row, table], [table.id])
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    engine.setControlInfoOf((id) => (id === st.id ? { controlType: 'input' } : undefined))

    const pages = engine.fullLayout(doc, pool)
    let cellItem: SLIFItem | undefined
    let cellW = 0
    for (const page of pages) {
      for (const it of page.items ?? []) {
        for (const r of it.rows ?? []) {
          for (const c of r.cells ?? []) {
            const found = (c.items ?? []).find((ci) => ci.nodeId === st.id)
            if (found) { cellItem = found; cellW = c.width ?? 0 }
          }
        }
      }
    }
    expect(cellItem).toBeTruthy()
    expect(cellW).toBeGreaterThan(0)
    // cell 内 item 用 cell 局部坐标: 右边界 ≤ cell 宽
    expect((cellItem!.x ?? 0) + (cellItem!.width ?? 0)).toBeLessThanOrEqual(cellW + 0.5)
    expect((cellItem!.controlLines ?? []).length).toBeGreaterThan(1)
  })

  it('页眉内长值 → 不溢出带区', () => {
    const el: ElementMeta = { code: { internal: 'H', dataElement: 'DH' }, name: '机构', format: { dataType: 'S1' } }
    const st = createSmartTextNode('[机构]', el, undefined, LONG)
    const hp = createParagraph([st.id])
    const bodyText = createTextNode('正文')
    const bodyPara = createParagraph([bodyText.id])
    const doc = createDocument('hf')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    for (const n of [st, hp, bodyText, bodyPara]) all.set(n.id, n as unknown as BaseNode)
    doc.body.children = [bodyPara.id]
    doc.header = [hp.id]
    const pool = buildNodePool(all, { body: doc.id, header: doc.header })
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    engine.setControlInfoOf((id) => (id === st.id ? { controlType: 'input' } : undefined))

    const pages = engine.fullLayout(doc, pool)
    const item = (pages[0].headerItems ?? []).find((i) => i.nodeId === st.id)!
    expect(item).toBeTruthy()
    expect((item.x ?? 0) + (item.width ?? 0)).toBeLessThanOrEqual(90 + CONTENT_W + 0.5)
    expect((item.controlLines ?? []).length).toBeGreaterThan(1)
  })
})

describe('控件超宽折行 — 渲染 (契约 §12.8)', () => {
  function recordingCtx() {
    const texts: Array<{ text: string; x: number; y: number }> = []
    const ctx = {
      font: '',
      fillStyle: '', strokeStyle: '', lineWidth: 1,
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      measureText: (t: string) => ({ width: t.length * 8 } as TextMetrics),
      fillText(text: string, x: number, y: number) { texts.push({ text, x, y }) },
      fillRect() {}, strokeRect() {}, setLineDash() {},
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
      save() {}, restore() {},
    } as unknown as CanvasRenderingContext2D
    return { ctx, texts }
  }

  it('controlLines 多行 → 逐行绘制, 行距 = size, [ 首行 / ] 末行', () => {
    const rec = recordingCtx()
    const lines = ['111111', '222222', '333']
    createControlParticle().render(
      rec.ctx,
      {
        nodeId: 'st-1', nodeType: 'smarttext', type: 'smarttext',
        text: lines.join(''), x: 0, y: 100,
        width: 100, height: 48, ascent: 12.8, descent: 35.2,
        font: 'SimSun', size: 16, controlLines: lines,
      } as SLIFItem,
      0, 100,
      {
        presentationStyleOf: () => undefined,
        templateDefinitionOf: () => ({ controlType: 'input' } as TemplateDefinition),
        elementOf: () => undefined,
        controlValueOf: () => lines.join(''),
      },
    )
    const drawn = lines.map((l) => rec.texts.find((t) => t.text === l))
    expect(drawn.every(Boolean)).toBe(true)
    // 行距 = size (16)
    expect(drawn[1]!.y - drawn[0]!.y).toBeCloseTo(16)
    expect(drawn[2]!.y - drawn[1]!.y).toBeCloseTo(16)
    // 方括号: '[' 在首行基线, ']' 在末行基线
    const open = rec.texts.find((t) => t.text === '[')!
    const close = rec.texts.find((t) => t.text === ']')!
    expect(open.y).toBeCloseTo(drawn[0]!.y)
    expect(close.y).toBeCloseTo(drawn[2]!.y)
    // ']' 紧跟末行文本之后 (不落在框宽右缘)
    expect(close.x).toBeCloseTo(drawn[2]!.x + lines[2].length * 8)
  })

  it('无 controlLines → 单行绘制 (回归, 行为不变)', () => {
    const rec = recordingCtx()
    createControlParticle().render(
      rec.ctx,
      {
        nodeId: 'st-1', nodeType: 'smarttext', type: 'smarttext',
        text: '123', x: 0, y: 100,
        width: 60, height: 16, ascent: 12.8, descent: 3.2,
        font: 'SimSun', size: 16,
      } as SLIFItem,
      0, 100,
      {
        presentationStyleOf: () => undefined,
        templateDefinitionOf: () => ({ controlType: 'input' } as TemplateDefinition),
        elementOf: () => undefined,
        controlValueOf: () => '123',
      },
    )
    expect(rec.texts.some((t) => t.text === '123')).toBe(true)
    expect(rec.texts.some((t) => t.text === '[')).toBe(true)
    expect(rec.texts.some((t) => t.text === ']')).toBe(true)
  })
})

describe('控件超宽折行 — Editor 端到端 (真实命令 + 真实 Draw 布局)', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => { while (cleanups.length > 0) cleanups.pop()!() })

  /** 真实 Editor: 一段 [主诉：][控件] (withLabel=false → 段落只有控件) */
  function makeE2EEditor(withLabel = true) {
    const doc = createDocument('e2e')
    const defs = new TemplateDefinitionStore()
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const el: ElementMeta = { code: { internal: 'CC', dataElement: 'DE' }, name: '主诉', format: { dataType: 'S1' } }
    const st = createSmartTextNode('[主诉]', el)
    const label = createTextNode('主诉：')
    const children = withLabel ? [label.id, st.id] : [st.id]
    const para = createParagraph(children)
    for (const n of [st, label, para]) all.set(n.id, n as unknown as BaseNode)
    doc.body.children = [para.id]
    defs.set(st.id, { controlType: 'input', editable: true } as TemplateDefinition)
    const nodes: Record<string, BaseNode> = {}
    for (const [id, n] of all) nodes[id] = n
    ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes

    const host = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container)
    host.input.mount(container)
    const editor = new Editor(host, doc)
    editor.setDocument(doc, undefined, { templateDefinitions: defs })
    cleanups.push(() => { editor.destroy(); container.remove() })
    return { editor, doc, para, st }
  }

  const caretState = (doc: DocumentTree, paraId: string, offset: number) =>
    ({ cursor: { paragraphPath: [doc.id, paraId], offset, visible: true } } as unknown as EditorRuntimeState)

  it('setControlValue(超长数字) → 页面内无横向溢出, 折成多行', () => {
    const { editor, st } = makeE2EEditor()

    expect(editor.setControlValue(st.id, LONG).ok).toBe(true)

    const pages = editor.getDraw().getPages()
    const item = pages.flatMap((p) => p.items ?? []).find((i) => i.nodeId === st.id)!
    expect(item).toBeTruthy()
    // 版心右缘 = 页面宽 - marginRight (Draw 从 pageSetup 取, 缺省 90)
    const pageWidth = pages[0].width
    for (const p of pages) {
      for (const it of p.items ?? []) {
        expect((it.x ?? 0) + (it.width ?? 0), `${it.nodeType}@${it.nodeId}`)
          .toBeLessThanOrEqual(pageWidth - 90 + 0.5)
      }
    }
    expect(item.controlLines?.join('')).toBe(LONG)
    expect((item.controlLines ?? []).length).toBeGreaterThan(1)
    expect(item.text).toBe(LONG)
  })

  it('折行控件的段落光标 (值之后) = 单行行高, 落在值末尾所在行 (不是整个盒高/盒右缘)', () => {
    const { editor, doc, para, st } = makeE2EEditor()
    expect(editor.setControlValue(st.id, LONG).ok).toBe(true)

    const draw = editor.getDraw()
    const item = draw.getPages().flatMap((p) => p.items ?? []).find((i) => i.nodeId === st.id)!
    const rows = (item.controlLines ?? []).length
    expect(rows).toBeGreaterThan(1)

    // 段落 = '主诉：'(3 字符) + 控件(1 字符) → offset 4 即「控件之后」
    const rect = draw.getCaretClientRect(editor.getPool(), caretState(doc, para.id, 4))!
    expect(rect).not.toBeNull()
    // 高度 = 单个物理行 (修复前 = ascent+descent = rows*16, "画的这么大")
    expect(rect.height).toBeCloseTo(16, 0)
    // 纵向落在末行行顶 (修复前恒在首行行顶)
    expect(rect.top).toBeCloseTo((item.y ?? 0) + (rows - 1) * 16, 0)
    // 横向在末行文本之后, 远早于盒右缘 (修复前恒 = 盒右缘 = 版心右缘)
    expect(rect.left).toBeGreaterThan(item.x ?? 0)
    expect(rect.left).toBeLessThan((item.x ?? 0) + (item.width ?? 0))
  })

  it('折行控件的段落光标 (值之前) = 首行行首', () => {
    const { editor, doc, para, st } = makeE2EEditor(false)
    editor.setControlValue(st.id, LONG)
    const draw = editor.getDraw()
    const item = draw.getPages().flatMap((p) => p.items ?? []).find((i) => i.nodeId === st.id)!
    expect((item.controlLines ?? []).length).toBeGreaterThan(1)

    const rect = draw.getCaretClientRect(editor.getPool(), caretState(doc, para.id, 0))!
    expect(rect.height).toBeCloseTo(16, 0)
    expect(rect.top).toBeCloseTo(item.y ?? 0, 0)
    expect(rect.left).toBeCloseTo(item.x ?? 0, 0)
  })
})
