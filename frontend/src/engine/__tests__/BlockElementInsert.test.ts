// ============================================================
// BlockElementInsert — 非段落块 (分隔线 / 分节符) 之后空段落的布局与导航
//
// 复现并防止「在最后一个段落后插入分隔线/分节符后, 光标无法落到该块之后」。
// insertSeparator / insertSectionBreak 与 insertTable 一致, 会在块后创建空段落,
// 保证方向键与点击都能落到块之后继续书写。此处验证该空段落的布局产物 + 导航。
// ============================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { KeyboardHandler } from '../interaction/KeyboardHandler'
import type { Editor } from '../Editor'
import { buildNodePool } from '../document/NodePool'
import {
  createDocument, createParagraph, createTextNode,
  createSeparatorNode, createSectionBreak,
} from '../document/ElementFormatter'
import type { BaseNode, Paragraph } from '../document/DocumentModel'

/** 构造不依赖真实 DOM/Editor 的 KeyboardHandler (导航方法为纯函数) */
function makeHandler(): KeyboardHandler {
  const container = {
    addEventListener: () => {}, removeEventListener: () => {},
  } as unknown as HTMLElement
  return new KeyboardHandler({} as unknown as Editor, container)
}

/** 注册文本 + 段落 */
function mkPara(allNodes: Map<string, BaseNode>, text: string): Paragraph {
  const tn = createTextNode(text)
  const para = createParagraph([tn.id])
  allNodes.set(tn.id, tn as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  return para
}

/** 读取段落第一个 text 节点 id */
function paraTextId(pool: ReturnType<typeof buildNodePool>, paraId: string): string {
  return (pool.nodes.get(paraId) as unknown as { children?: string[] }).children![0]
}

describe('分隔线后空段落: 布局 + 导航', () => {
  function makeSeparatorFixture() {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const before = mkPara(allNodes, 'before')
    const sep = createSeparatorNode()
    allNodes.set(sep.id, sep as unknown as BaseNode)
    const trail = mkPara(allNodes, '') // 同 insertSeparator 产出
    doc.body.children = [before.id, sep.id, trail.id]
    const pool = buildNodePool(allNodes, { body: doc.id })
    const engine = new LayoutEngine(new EventBus())
    const pages = engine.fullLayout(doc, pool)
    return { doc, pool, pages, before, sep, trail }
  }

  it('空尾随段落在分隔线下方产生可命中的布局 item', () => {
    const { pages, trail, pool } = makeSeparatorFixture()
    const items = pages.flatMap(p => p.items)
    const sepItem = items.find(i => i.type === 'separator')
    expect(sepItem).toBeDefined()

    const trailItem = items.find(i => i.nodeId === paraTextId(pool, trail.id))
    expect(trailItem).toBeDefined()
    expect(trailItem!.y).toBe(sepItem!.y + sepItem!.height)
  })

  it('ArrowDown 从分隔线上方段落落到空尾随段落 (跳过 separator)', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, before, trail } = makeSeparatorFixture()
    expect(nav.call(h, before.id, doc, pool, 1, 'vertical', 0)).toEqual({ paraId: trail.id, offset: 0 })
  })

  it('ArrowUp 从空尾随段落落到分隔线上方段落 (跳过 separator)', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, before, trail } = makeSeparatorFixture()
    expect(nav.call(h, trail.id, doc, pool, -1, 'vertical', 0)).toEqual({ paraId: before.id, offset: 0 })
  })
})

describe('分节符后空段落: 分页 + 导航', () => {
  function makeSectionBreakFixture() {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const before = mkPara(allNodes, 'before')
    const sb = createSectionBreak('next_page')
    allNodes.set(sb.id, sb as unknown as BaseNode)
    const trail = mkPara(allNodes, '') // 同 insertSectionBreak 产出
    doc.body.children = [before.id, sb.id, trail.id]
    const pool = buildNodePool(allNodes, { body: doc.id })
    const engine = new LayoutEngine(new EventBus())
    const pages = engine.fullLayout(doc, pool)
    return { doc, pool, pages, before, sb, trail }
  }

  it('分节符触发分页, 空尾随段落落在下一页', () => {
    const { pages, trail, pool } = makeSectionBreakFixture()
    expect(pages.length).toBe(2)
    const trailTextId = paraTextId(pool, trail.id)
    // 空尾随段落位于第二页 (分节符后)
    expect(pages[1].items.some(i => i.nodeId === trailTextId)).toBe(true)
    expect(pages[0].items.some(i => i.nodeId === trailTextId)).toBe(false)
  })

  it('ArrowDown 从分节符前段落落到下一页空尾随段落 (跳过 section_break)', () => {
    const h = makeHandler()
    const nav = (h as unknown as { navigateBlock: (...a: unknown[]) => unknown }).navigateBlock
    const { doc, pool, before, trail } = makeSectionBreakFixture()
    expect(nav.call(h, before.id, doc, pool, 1, 'vertical', 0)).toEqual({ paraId: trail.id, offset: 0 })
  })
})
