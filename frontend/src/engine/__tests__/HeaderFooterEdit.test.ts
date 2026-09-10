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
import { resolveParagraphRegion, resolveSiblingRange } from '../state/CaretScope'
import { selectionSpine } from '../document/selection/SelectionCollector'
import type { SerializedPara } from '../command/ClipboardManager'
import { LayoutEngine } from '../layout/core/LayoutEngine'
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
