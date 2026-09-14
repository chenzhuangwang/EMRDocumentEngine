// ============================================================
// HeaderFooterEdit — 页眉/页脚结构编辑 (拆段/并段)
//
// 复现并防止: 页眉/页脚段落存储在 doc.header / doc.footer 独立数组中
// (不在 doc.body.children / pool 的 children 解析内), 导致:
//   1. Enter 拆段 → 新段落误插入 body (页脚文字被搬到正文)
//   2. Backspace 并段 → 静默失败 (找不到上一段)
//   3. 并段时 removeChild 误删已合并的文本节点 → 文字丢失
// 修复: resolveParagraphRegion 统一解析 body/cell/header/footer 区域。
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree, Paragraph, ElementMeta } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { CommandContext } from '../command/ICommand'
import { SplitParagraphCommand } from '../command/commands/SplitParagraphCommand'
import { MergeParagraphCommand } from '../command/commands/MergeParagraphCommand'
import { InsertNodesCommand } from '../command/commands/InsertNodesCommand'
import { InsertControlCommand } from '../command/commands/InsertControlCommand'
import { resolveParagraphRegion, resolveSiblingRange, hfBandEndCaret } from '../state/CaretScope'
import { selectionSpine } from '../document/selection/SelectionCollector'
import type { SerializedPara } from '../command/ClipboardManager'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import type { SLIFItem } from '../layout/core/SLIF'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'

function ctxOf(doc: DocumentTree, pool: NodePool): CommandContext {
  return { mode: 'local', doc, pool }
}

function paraText(pool: NodePool, paraId: string): string {
  const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
  if (!para?.children) return ''
  return para.children.map(cid => {
    const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
    return n?.type === 'text' ? (n.text || '') : ''
  }).join('')
}

/** 构造仅含页脚两段的文档 (footer = [p1, p2]), body 为空 */
function makeFooterDoc(): { doc: DocumentTree; pool: NodePool; p1: Paragraph; p2: Paragraph } {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const t1 = createTextNode('Hello')
  const p1 = createParagraph([t1.id])
  const t2 = createTextNode('World')
  const p2 = createParagraph([t2.id])

  allNodes.set(t1.id, t1 as unknown as BaseNode)
  allNodes.set(p1.id, p1 as unknown as BaseNode)
  allNodes.set(t2.id, t2 as unknown as BaseNode)
  allNodes.set(p2.id, p2 as unknown as BaseNode)

  doc.body.children = []
  doc.header = []
  doc.footer = [p1.id, p2.id]

  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, p1, p2 }
}

describe('resolveParagraphRegion 区域解析', () => {
  it('页脚段落 → footer 区域', () => {
    const { doc, pool, p1 } = makeFooterDoc()
    const region = resolveParagraphRegion(p1.id, doc, pool)
    expect(region?.type).toBe('footer')
    expect(region?.index).toBe(0)
  })

  it('正文段落 → body 区域', () => {
    const { doc, pool, p1 } = makeFooterDoc()
    // 将 p1 移入 body
    doc.body.children = [p1.id]
    doc.footer = []
    const region = resolveParagraphRegion(p1.id, doc, pool)
    expect(region?.type).toBe('body')
  })
})

describe('页脚段落 Enter 拆段 (SplitParagraphCommand)', () => {
  it('页脚段落中点拆分 → 新段落插入 doc.footer, 不泄漏到 body', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const tn = createTextNode('HelloWorld')
    const p1 = createParagraph([tn.id])
    allNodes.set(tn.id, tn as unknown as BaseNode)
    allNodes.set(p1.id, p1 as unknown as BaseNode)
    doc.body.children = []
    doc.header = []
    doc.footer = [p1.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new SplitParagraphCommand('sp', Date.now(), 'u', [doc.id, p1.id], 5)
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(patch).not.toBeNull()
    // 新段落仍在 footer 中
    expect(doc.footer).toHaveLength(2)
    expect(doc.body.children).toHaveLength(0)
    // 左半 "Hello" 留在原段, 右半 "World" 进入新段
    expect(paraText(pool, doc.footer[0])).toBe('Hello')
    expect(paraText(pool, doc.footer[1])).toBe('World')
  })
})

describe('页脚段落 Backspace 并段 (MergeParagraphCommand)', () => {
  it('页脚两段并段 → 文字保留, 段落数减一', () => {
    const { doc, pool, p1, p2 } = makeFooterDoc()

    const cmd = new MergeParagraphCommand('mg', Date.now(), 'u', [doc.id, p2.id])
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(patch).not.toBeNull()
    // 只剩一段, 且不泄漏到 body
    expect(doc.footer).toHaveLength(1)
    expect(doc.body.children).toHaveLength(0)
    // 文字完整合并 (关键: 不被 removeChild 误删)
    expect(paraText(pool, p1.id)).toBe('HelloWorld')
    // p2 已从池中移除
    expect(pool.nodes.get(p2.id)).toBeUndefined()
  })

  it('页脚首段并段 → 无上一段, 静默返回 null (不误删)', () => {
    const { doc, pool, p1 } = makeFooterDoc()
    const cmd = new MergeParagraphCommand('mg', Date.now(), 'u', [doc.id, p1.id])
    const patch = cmd.forward(ctxOf(doc, pool))

    expect(patch).toBeNull()
    // 结构不变
    expect(doc.footer).toHaveLength(2)
    expect(paraText(pool, p1.id)).toBe('Hello')
  })
})

describe('正文并段回归 (文字不丢失)', () => {
  it('正文两段并段 → 第二段文字保留', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const t1 = createTextNode('Hello')
    const p1 = createParagraph([t1.id])
    const t2 = createTextNode('World')
    const p2 = createParagraph([t2.id])
    allNodes.set(t1.id, t1 as unknown as BaseNode)
    allNodes.set(p1.id, p1 as unknown as BaseNode)
    allNodes.set(t2.id, t2 as unknown as BaseNode)
    allNodes.set(p2.id, p2 as unknown as BaseNode)
    doc.body.children = [p1.id, p2.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cmd = new MergeParagraphCommand('mg', Date.now(), 'u', [doc.id, p2.id])
    cmd.forward(ctxOf(doc, pool))

    expect(doc.body.children).toHaveLength(1)
    expect(paraText(pool, p1.id)).toBe('HelloWorld')
  })
})

function textPara(text: string): SerializedPara {
  return { type: 'paragraph', id: 'src', style: {}, children: [{ type: 'text', id: 'src-t', text }] }
}

describe('页脚多段落粘贴 (InsertNodesCommand)', () => {
  it('两段粘贴到页脚段落末尾 → 均落在 doc.footer, 不泄漏到 body', () => {
    const { doc, pool, p1 } = makeFooterDoc()  // footer = [p1("Hello"), p2("World")]

    const cmd = new InsertNodesCommand('ins', Date.now(), 'u', [doc.id, p1.id], 5, [
      textPara('AA'), textPara('BB'),
    ])
    cmd.forward(ctxOf(doc, pool))

    const footer = doc.footer!
    expect(footer).toHaveLength(3)
    expect(doc.body.children).toHaveLength(0)
    expect(paraText(pool, footer[0])).toBe('HelloAA')
    expect(paraText(pool, footer[1])).toBe('BB')
    expect(paraText(pool, footer[2])).toBe('World')
  })

  it('页脚粘贴撤销 → 恢复原页脚结构', () => {
    const { doc, pool, p1 } = makeFooterDoc()

    const cmd = new InsertNodesCommand('ins', Date.now(), 'u', [doc.id, p1.id], 5, [
      textPara('AA'), textPara('BB'),
    ])
    cmd.forward(ctxOf(doc, pool))
    expect(doc.footer).toHaveLength(3)

    const undo = cmd.invert(ctxOf(doc, pool))
    expect(undo).not.toBeNull()
    undo!.forward(ctxOf(doc, pool))

    const footer = doc.footer!
    expect(footer).toHaveLength(2)
    expect(doc.body.children).toHaveLength(0)
    expect(paraText(pool, footer[0])).toBe('Hello')
    expect(paraText(pool, footer[1])).toBe('World')
  })
})

// ---- 页眉/页脚布局: 多行 + 朝版心扩展 (WPS 式) ----

/** footer 段数组: string = 有文本(单行), null = 空段 (无 children) */
function makeHfDoc(footerParas: Array<string | null>): { doc: DocumentTree; pool: NodePool; ids: string[] } {
  const doc = createDocument('hf-layout')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const ids: string[] = []
  for (const t of footerParas) {
    const tn = t === null ? undefined : createTextNode(t)
    const para = tn ? createParagraph([tn.id]) : createParagraph([])
    if (tn) allNodes.set(tn.id, tn as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    ids.push(para.id)
  }
  doc.body.children = []
  doc.header = []
  doc.footer = ids
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, ids }
}

function layoutFooter(doc: DocumentTree, pool: NodePool) {
  const engine = new LayoutEngine(new EventBus(), testMeasurer)
  return engine.fullLayout(doc, pool)
}

describe('页眉/页脚多行布局 (WPS 式朝版心扩展)', () => {
  it('footer 尾随空段 → 该页 footerItems 含空段占位 item (Enter 后光标可落)', () => {
    const { doc, pool, ids } = makeHfDoc(['Hello', null])
    const pages = layoutFooter(doc, pool)
    const emptyParaId = ids[1]
    const found = pages.some(p => (p.footerItems || []).some(it => it.nodeId === emptyParaId))
    expect(found).toBe(true)
  })

  it('footer 行增多 → footerHeight 不封顶随行数增长 (WPS, 正文随后让位)', () => {
    const a = makeHfDoc(['L'])
    const b = makeHfDoc(Array.from({ length: 20 }, () => 'L'))
    const pagesA = layoutFooter(a.doc, a.pool)
    const pagesB = layoutFooter(b.doc, b.pool)
    const h1 = pagesA[0].footerHeight ?? 42
    const h2 = pagesB[0].footerHeight ?? 42
    expect(h2).toBeGreaterThan(h1)
    expect(h2).toBeGreaterThan(72) // 超过默认 marginBottom, 证明不再封顶
  })
})

describe('页眉/页脚选区读序 helper', () => {
  function doc3(): { doc: DocumentTree; pool: NodePool; body: string; h1: string; h2: string; f1: string; f2: string } {
    const doc = createDocument('sel')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const mk = (t: string, childrenOf?: string[]) => {
      const tn = createTextNode(t)
      const p = createParagraph(childrenOf ?? [tn.id])
      all.set(tn.id, tn as unknown as BaseNode)
      all.set(p.id, p as unknown as BaseNode)
      return p.id
    }
    const body = mk('body')
    const h1 = mk('H1'); const h2 = mk('H2')
    const f1 = mk('F1'); const f2 = mk('F2')
    doc.body.children = [body]
    doc.header = [h1, h2]
    doc.footer = [f1, f2]
    return { doc, pool: buildNodePool(all, { body: doc.id }), body, h1, h2, f1, f2 }
  }

  it('footer 两段 → resolveSiblingRange 返回 footer 区域与下标', () => {
    const { doc, pool, f1, f2 } = doc3()
    const r = resolveSiblingRange(doc, pool, f1, f2)
    expect(r?.regionType).toBe('footer')
    expect(r?.aIdx).toBe(0)
    expect(r?.fIdx).toBe(1)
    expect(r?.siblings).toEqual(doc.footer)
  })

  it('body↔header 混选 → resolveSiblingRange / selectionSpine 均 null (区域隔离)', () => {
    const { doc, pool, body, h1 } = doc3()
    expect(resolveSiblingRange(doc, pool, body, h1)).toBeNull()
    expect(selectionSpine(doc, pool, body, h1)).toBeNull()
  })

  it('header 两段 → selectionSpine 返回 header 读序', () => {
    const { doc, pool, h1, h2 } = doc3()
    const sp = selectionSpine(doc, pool, h1, h2)
    expect(sp?.section).toBe('header')
    expect(sp?.spine).toEqual(doc.header)
  })
})

describe('页眉/页脚含 smarttext 控件布局产物', () => {
  it('footer 段含 input 控件 → fullLayout footerItems 含该控件 item', () => {
    const doc = createDocument('hf-ctrl')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const el: ElementMeta = {
      code: { internal: 'CTL_NAME', dataElement: 'DE99.99.001' }, name: '姓名',
      format: { dataType: 'S1' },
    }
    const st = createSmartTextNode('[姓名]', el)
    const p = createParagraph([st.id])
    all.set(st.id, st as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children = []
    doc.header = []
    doc.footer = [p.id]
    const pool = buildNodePool(all, { body: doc.id })
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    const pages = engine.fullLayout(doc, pool)
    const found = pages.some(page => (page.footerItems || []).some(it => it.nodeId === st.id))
    expect(found).toBe(true)
  })

  it('footer 控件填值 → footerItems 显示值 (非占位符)', () => {
    const doc = createDocument('hf-val')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const el: ElementMeta = {
      code: { internal: 'CTL_NAME', dataElement: 'DE99.99.001' }, name: '姓名',
      format: { dataType: 'S1' },
    }
    const st = createSmartTextNode('[姓名]', el)
    st.value = '张三'
    const p = createParagraph([st.id])
    all.set(st.id, st as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children = []
    doc.header = [p.id]
    doc.footer = []
    const pool = buildNodePool(all, { body: doc.id })
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    const pages = engine.fullLayout(doc, pool)
    const item = pages.flatMap(pg => pg.headerItems || []).find(it => it.nodeId === st.id)
    expect(item?.text).toBe('张三')
  })
})

describe('向页眉/页脚插入控件 (InsertControlCommand)', () => {
  it('光标 path=[doc, headerPara] offset0 → 控件落入 doc.header 段且布局可见', () => {
    const doc = createDocument('ins-hf')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const tn = createTextNode('')
    const hp = createParagraph([tn.id])
    all.set(tn.id, tn as unknown as BaseNode)
    all.set(hp.id, hp as unknown as BaseNode)
    doc.body.children = []
    doc.header = [hp.id]
    doc.footer = []
    const pool = buildNodePool(all, { body: doc.id })
    const el: ElementMeta = { code: { internal: 'CTL_NAME', dataElement: 'DE99.99.001' }, name: '姓名', format: { dataType: 'S1' } }
    const cmd = new InsertControlCommand('ic', Date.now(), 'u', [doc.id, hp.id], 0, el, { controlType: 'input', label: '姓名：', editable: true })
    const patch = cmd.forward(ctxOf(doc, pool))
    expect(patch).not.toBeNull()
    const hpNode = pool.nodes.get(hp.id) as { children?: readonly string[] }
    expect(hpNode.children!.length).toBeGreaterThanOrEqual(2) // 空text + 新控件
    const ctrlId = hpNode.children!.find(cid => (pool.nodes.get(cid) as { type?: string })?.type === 'smarttext')
    expect(ctrlId).toBeTruthy()
  })
})

describe('页眉/页脚控件按语义预留宽 (与正文一致)', () => {
  it('footer checkbox → footerItems 宽 = 候选组总宽 (> 纯占位符文本宽)', () => {
    const doc = createDocument('hf-opt')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const el: ElementMeta = {
      code: { internal: 'CTL_SX', dataElement: 'DE99.99.006' }, name: '症状',
      format: { dataType: 'S1', enums: { multiple: true, data: [{ name: '发热', value: 'fever' }, { name: '咳嗽', value: 'cough' }] } },
    }
    const st = createSmartTextNode('[症状]', el)
    const p = createParagraph([st.id])
    all.set(st.id, st as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children = []
    doc.header = []
    doc.footer = [p.id]
    const pool = buildNodePool(all, { body: doc.id })
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    engine.setControlInfoOf((nodeId) => nodeId === st.id
      ? { controlType: 'checkbox', options: el.format!.enums!.data }
      : undefined)
    const pages = engine.fullLayout(doc, pool)
    const item = pages.flatMap(pg => pg.footerItems || []).find(it => it.nodeId === st.id)
    expect(item).toBeTruthy()
    // 候选组宽远超占位符 '[症状]' 的文本宽
    expect((item!.width || 0)).toBeGreaterThan(60)
  })
})

describe('页眉/页脚控件 label 预留宽 (防相邻重叠)', () => {
  function widthWith(label?: string): number {
    const doc = createDocument('lbl')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const el: ElementMeta = { code: { internal: 'C', dataElement: 'D' }, name: '姓名', format: { dataType: 'S1' } }
    const st = createSmartTextNode('[姓名]', el)
    const p = createParagraph([st.id])
    all.set(st.id, st as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children = []
    doc.header = [p.id]
    doc.footer = []
    const pool = buildNodePool(all, { body: doc.id })
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    engine.setControlInfoOf(() => ({ controlType: 'input', label }))
    const item = engine.fullLayout(doc, pool).flatMap(pg => pg.headerItems || []).find(it => it.nodeId === st.id)!
    return item.width || 0
  }
  it('带 label 的控件预留宽 > 不带 label (label 占位计入行内宽)', () => {
    expect(widthWith('文本输入：')).toBeGreaterThan(widthWith(undefined))
  })
})

// ---- 逐页变体布局 (契约 §7.9): 首页不同 / 奇偶页不同 ----

/** 多页文档: body 段足够多 → ≥3 页; 可指定各变体的页脚/页眉文案 */
function makeVariantDoc(opts: {
  bodyParas?: number
  header?: string
  footer?: string
  firstPageHeader?: string
  firstPageFooter?: string
  evenPageHeader?: string
  evenPageFooter?: string
  differentFirstPage?: boolean
  differentOddEven?: boolean
}): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument('hf-variant')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  const mk = (text: string): string => {
    const tn = createTextNode(text)
    const p = createParagraph([tn.id])
    all.set(tn.id, tn as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    return p.id
  }

  doc.body.children = Array.from({ length: opts.bodyParas ?? 200 }, (_, i) => mk(`正文第${i + 1}段`))
  doc.header = opts.header ? [mk(opts.header)] : []
  doc.footer = opts.footer ? [mk(opts.footer)] : []
  if (opts.firstPageHeader) doc.firstPageHeader = [mk(opts.firstPageHeader)]
  if (opts.firstPageFooter) doc.firstPageFooter = [mk(opts.firstPageFooter)]
  if (opts.evenPageHeader) doc.evenPageHeader = [mk(opts.evenPageHeader)]
  if (opts.evenPageFooter) doc.evenPageFooter = [mk(opts.evenPageFooter)]
  doc.headerFooterConfig = {
    differentFirstPage: opts.differentFirstPage === true,
    differentOddEven: opts.differentOddEven === true,
  }

  const pool = buildNodePool(all, { body: doc.id })
  return { doc, pool }
}

const textsOf = (items: SLIFItem[] | undefined) => (items ?? []).map(i => i.text)

describe('逐页页眉/页脚变体布局', () => {
  it('两个开关都关 → 各页共享同一 items 数组 (惰性, 不复制)', () => {
    const { doc, pool } = makeVariantDoc({ header: '页眉', footer: '页脚' })
    const pages = layoutFooter(doc, pool)
    expect(pages.length).toBeGreaterThan(2)
    for (const p of pages) {
      expect(p.headerItems).toBe(pages[0].headerItems)
      expect(p.footerItems).toBe(pages[0].footerItems)
    }
  })

  it('differentFirstPage → 第 1 页用首页变体, 第 2 页起用默认变体', () => {
    const { doc, pool } = makeVariantDoc({
      header: '默认页眉', footer: '默认页脚',
      firstPageHeader: '首页页眉', firstPageFooter: '首页页脚',
      differentFirstPage: true,
    })
    const pages = layoutFooter(doc, pool)
    expect(textsOf(pages[0].footerItems)).toContain('首页页脚')
    expect(textsOf(pages[0].headerItems)).toContain('首页页眉')
    expect(textsOf(pages[1].footerItems)).toContain('默认页脚')
    expect(textsOf(pages[1].headerItems)).toContain('默认页眉')
  })

  it('differentOddEven → 偶数页用 even 变体, 奇数页用默认变体', () => {
    const { doc, pool } = makeVariantDoc({
      header: '默认页眉', footer: '默认页脚',
      evenPageHeader: '偶数页眉', evenPageFooter: '偶数页脚',
      differentOddEven: true,
    })
    const pages = layoutFooter(doc, pool)
    // 第 1 页 (索引 0) 奇数 → 默认
    expect(textsOf(pages[0].footerItems)).toContain('默认页脚')
    // 第 2 页 (索引 1) 偶数 → even
    expect(textsOf(pages[1].footerItems)).toContain('偶数页脚')
    expect(textsOf(pages[1].headerItems)).toContain('偶数页眉')
    // 第 3 页 (索引 2) 奇数 → 默认
    expect(textsOf(pages[2].footerItems)).toContain('默认页脚')
  })

  it('两者同开 → 第 1 页首页变体, 第 2 页 even, 第 3 页默认', () => {
    const { doc, pool } = makeVariantDoc({
      header: '默认页眉', firstPageHeader: '首页页眉', evenPageHeader: '偶数页眉',
      differentFirstPage: true, differentOddEven: true,
    })
    const pages = layoutFooter(doc, pool)
    expect(textsOf(pages[0].headerItems)).toContain('首页页眉')
    expect(textsOf(pages[1].headerItems)).toContain('偶数页眉')
    expect(textsOf(pages[2].headerItems)).toContain('默认页眉')
  })

  it('开关开但变体数组缺失 → 该页带为空 (不回退默认)', () => {
    const { doc, pool } = makeVariantDoc({
      footer: '默认页脚', differentFirstPage: true,
    })
    const pages = layoutFooter(doc, pool)
    expect(pages[0].footerItems ?? []).toHaveLength(0)
    expect(textsOf(pages[1].footerItems)).toContain('默认页脚')
  })

  it('逐页 headerHeight/footerHeight 跟随该页变体的带高', () => {
    const { doc, pool } = makeVariantDoc({
      footer: '默认页脚',
      firstPageFooter: '首页页脚第一行',
      differentFirstPage: true,
    })
    // 让首页页脚明显更高 (多段, 超过 HF_MIN_REGION=42)
    for (let i = 2; i <= 4; i++) {
      const extra = createTextNode(`首页页脚第${i}行`)
      const extraPara = createParagraph([extra.id])
      pool.addNode(extra as unknown as BaseNode)
      pool.addNode(extraPara as unknown as BaseNode)
      doc.firstPageFooter = [...(doc.firstPageFooter ?? []), extraPara.id]
    }

    const pages = layoutFooter(doc, pool)
    const hFirst = pages[0].footerHeight!
    const hDefault = pages[1].footerHeight!
    expect(hFirst).toBeGreaterThan(hDefault)
  })

  it('变体未开启时不为变体数组付出布局代价 (开关关 → 不读 firstPageHeader)', () => {
    // firstPageHeader 存在但开关关闭 → 该内容不得出现在任何页
    const { doc, pool } = makeVariantDoc({
      header: '默认页眉', firstPageHeader: '首页页眉', differentFirstPage: false,
    })
    const pages = layoutFooter(doc, pool)
    for (const p of pages) {
      expect(textsOf(p.headerItems)).not.toContain('首页页眉')
      expect(textsOf(p.headerItems)).toContain('默认页眉')
    }
  })
})

describe('双击进入页眉/页脚的初始落点 (hfBandEndCaret)', () => {
  it('多段页脚 → 落在最后一段的末尾, 而非第一段开头', () => {
    const { doc, pool, p1, p2 } = makeFooterDoc()
    const caret = hfBandEndCaret(doc, pool, 'footer', 1)
    expect(caret).toEqual({ paraPath: [doc.id, p2.id], offset: 'World'.length })
    // 反向保护: 旧行为恒落第一段 offset 0
    expect(caret!.paraPath[1]).not.toBe(p1.id)
    expect(caret!.offset).not.toBe(0)
  })

  it('区域为空 → null (由调用方先建段落)', () => {
    const doc = createDocument('hf-empty')
    const pool = buildNodePool(
      new Map<string, BaseNode>([[doc.id, doc as unknown as BaseNode]]), { body: doc.id },
    )
    expect(hfBandEndCaret(doc, pool, 'header', 1)).toBeNull()
    expect(hfBandEndCaret(doc, pool, 'footer', 1)).toBeNull()
  })

  it('页眉与页脚各自独立 (band 维度不串)', () => {
    const doc = createDocument('hf-both')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const h = createTextNode('H'); const hp = createParagraph([h.id])
    const f = createTextNode('FOOTER'); const fp = createParagraph([f.id])
    for (const n of [h, hp, f, fp]) all.set(n.id, n as unknown as BaseNode)
    doc.body.children = []
    doc.header = [hp.id]
    doc.footer = [fp.id]
    const pool = buildNodePool(all, { body: doc.id })

    expect(hfBandEndCaret(doc, pool, 'header', 1))
      .toEqual({ paraPath: [doc.id, hp.id], offset: 'H'.length })
    expect(hfBandEndCaret(doc, pool, 'footer', 1))
      .toEqual({ paraPath: [doc.id, fp.id], offset: 'FOOTER'.length })
  })

  it('首页变体开启 → 第 1 页落首页变体, 第 2 页回落默认变体 (契约 §7.9)', () => {
    const { doc, pool } = makeVariantDoc({
      differentFirstPage: true, header: '默认页眉', firstPageHeader: '首页页眉',
    })
    const first = hfBandEndCaret(doc, pool, 'header', 1)!
    expect(first.paraPath[1]).toBe(doc.firstPageHeader![0])
    expect(first.offset).toBe('首页页眉'.length)

    const second = hfBandEndCaret(doc, pool, 'header', 2)!
    expect(second.paraPath[1]).toBe(doc.header![0])
    expect(second.offset).toBe('默认页眉'.length)
  })

  it('偶数页变体开启 → 偶页落偶数页变体, 奇页落默认变体', () => {
    const { doc, pool } = makeVariantDoc({
      differentOddEven: true, header: '奇数页页眉', evenPageHeader: '偶数页页眉',
    })
    expect(hfBandEndCaret(doc, pool, 'header', 2)!.paraPath[1]).toBe(doc.evenPageHeader![0])
    expect(hfBandEndCaret(doc, pool, 'header', 1)!.paraPath[1]).toBe(doc.header![0])
  })

  it('段内含控件 → 按「原子 = 1 字符」计, 与点击命中 offset 语义一致', () => {
    const doc = createDocument('hf-ctl-caret')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const el: ElementMeta = {
      code: { internal: 'CTL_NAME', dataElement: 'DE99.99.001' }, name: '姓名',
      format: { dataType: 'S1' },
    }
    // 占位符是 4 个字符 '[姓名]', 但光标语义下控件是原子 1 字符
    const st = createSmartTextNode('[姓名]', el)
    const p = createParagraph([st.id])
    all.set(st.id, st as unknown as BaseNode)
    all.set(p.id, p as unknown as BaseNode)
    doc.body.children = []
    doc.header = [p.id]
    const pool = buildNodePool(all, { body: doc.id })

    expect(hfBandEndCaret(doc, pool, 'header', 1))
      .toEqual({ paraPath: [doc.id, p.id], offset: 1 })
  })
})
