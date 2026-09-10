// ================================================================
// InsertControlCommand — 设计态控件库插入 (契约 §12.4)
//
// 验证:
//   A. 插入 smarttext — 落 SmartTextNode.element + 占位文本 [name], 无 value。
//   B. 写入 TemplateDefinition — 落 ctx.templateDefinitions[nodeId]。
//   C. single 守卫 — 条目 single:true 且文档已有同身份 smarttext → 拒绝
//      (forward 返回 null, 不插入、不写 store)。
//   D. single !== true — 同身份可重复插入 (不触发守卫)。
//   E. invert — 摘除节点 + 删除 TemplateDefinition 条目 (无孤儿定义)。
// ================================================================

import { describe, it, expect } from 'vitest'
import { InsertControlCommand } from '../command/commands/InsertControlCommand'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import type { BaseNode, ElementMeta, SmartTextNode, Paragraph } from '../document/core/DocumentModel'
import type { CommandContext, StatePatch } from '../command/ICommand'

const ELEMENT_NAME: ElementMeta = {
  code: { internal: 'CTL_PATIENT_NAME', dataElement: 'DE02.01.039.00' },
  name: '患者姓名',
}

const DEFINITION = { label: '姓名：', tips: '患者姓名', deletable: true, editable: true, single: true }

interface DocHarness {
  doc: ReturnType<typeof createDocument>
  pool: ReturnType<typeof buildNodePool>
  paraId: string
  defs: TemplateDefinitionStore
}

/** 段落 = 文本节点 "abc" + (可选) 已存在的 smarttext 控件 */
function makeDoc(existingElement?: ElementMeta): DocHarness {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const text = createTextNode('abc')
  const children: string[] = [text.id]
  allNodes.set(text.id, text as unknown as BaseNode)
  if (existingElement) {
    const st = createSmartTextNode('[已有]', existingElement)
    children.push(st.id)
    allNodes.set(st.id, st as unknown as BaseNode)
  }
  const para = createParagraph(children)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, paraId: para.id, defs: new TemplateDefinitionStore() }
}

function insert(
  h: DocHarness,
  element: ElementMeta,
  definition?: TemplateDefinition,
): { patch: StatePatch | null; cmd: InsertControlCommand } {
  const ctx: CommandContext = { mode: 'local', doc: h.doc, pool: h.pool, templateDefinitions: h.defs }
  const cmd = new InsertControlCommand('c1', Date.now(), 'u', [h.doc.id, h.paraId], 3, element, definition)
  const patch = cmd.forward(ctx)
  return { patch, cmd }
}

function smartChildren(h: DocHarness): SmartTextNode[] {
  const para = h.pool.nodes.get(h.paraId) as Paragraph
  return para.children
    .map((id) => h.pool.nodes.get(id))
    .filter((n): n is SmartTextNode => n?.type === 'smarttext')
}

describe('InsertControlCommand — 控件库插入 (契约 §12.4)', () => {
  it('插入 smarttext: element + 占位文本 [name], 无 value', () => {
    const h = makeDoc()
    const { patch } = insert(h, ELEMENT_NAME)
    expect(patch).not.toBeNull()

    const sts = smartChildren(h)
    expect(sts.length).toBe(1)
    expect(sts[0].element.code.dataElement).toBe('DE02.01.039.00')
    expect(sts[0].text).toBe('[患者姓名]')
    expect(sts[0].value).toBeUndefined()
  })

  it('写入 TemplateDefinition 到 store (ctx.templateDefinitions)', () => {
    const h = makeDoc()
    insert(h, ELEMENT_NAME, DEFINITION)
    const st = smartChildren(h)[0]
    expect(h.defs.get(st.id)).toEqual(DEFINITION)
  })

  it('未注入 store → 仍插入节点, 但不写定义 (不抛错)', () => {
    const h = makeDoc()
    const ctx: CommandContext = { mode: 'local', doc: h.doc, pool: h.pool } // 无 templateDefinitions
    const cmd = new InsertControlCommand('c1', Date.now(), 'u', [h.doc.id, h.paraId], 3, ELEMENT_NAME, DEFINITION)
    const patch = cmd.forward(ctx)
    expect(patch).not.toBeNull()
    expect(smartChildren(h).length).toBe(1)
  })

  it('single:true 且文档已有同身份 → 拒绝 (返回 null, 不插入、不写 store)', () => {
    const h = makeDoc(ELEMENT_NAME) // 已存在同身份 smarttext
    const { patch } = insert(h, ELEMENT_NAME, DEFINITION) // single:true
    expect(patch).toBeNull()
    expect(smartChildren(h).length).toBe(1) // 仅保留已存在的那个
    expect(h.defs.size).toBe(0)
  })

  it('single !== true (未标记) 且同身份 → 允许重复插入', () => {
    const h = makeDoc(ELEMENT_NAME)
    const { patch } = insert(h, ELEMENT_NAME, { deletable: true }) // 无 single
    expect(patch).not.toBeNull()
    expect(smartChildren(h).length).toBe(2)
  })

  it('invert: 摘除节点 + 删除 TemplateDefinition 条目 (无孤儿定义)', () => {
    const h = makeDoc()
    const { cmd } = insert(h, ELEMENT_NAME, DEFINITION)
    const st = smartChildren(h)[0]
    expect(h.pool.nodes.has(st.id)).toBe(true)
    expect(h.defs.get(st.id)).toEqual(DEFINITION)

    const ctx: CommandContext = { mode: 'local', doc: h.doc, pool: h.pool, templateDefinitions: h.defs }
    const inverse = cmd.invert(ctx)
    expect(inverse).not.toBeNull()
    inverse!.forward(ctx)

    expect(h.pool.nodes.has(st.id)).toBe(false)
    expect(smartChildren(h).length).toBe(0)
    expect(h.defs.has(st.id)).toBe(false)
  })

  it('定义保真: controlType/dataType/showType/enums 原样落两层 (不降级)', () => {
    const element: ElementMeta = {
      code: { internal: 'CTL_CHECKBOX', dataElement: 'DE99.99.006' },
      name: '复选框',
      format: { dataType: 'S1', enums: { multiple: true, data: [] } },
    }
    const def: TemplateDefinition = { controlType: 'checkbox', label: '复选框：', deletable: true, editable: true }
    const h = makeDoc()
    insert(h, element, def)
    const st = smartChildren(h)[0]

    // 语义层: dataType + enums 保真
    expect(st.element.format?.dataType).toBe('S1')
    expect(st.element.format?.enums?.multiple).toBe(true)
    // 设计期层: controlType 保真
    expect(h.defs.get(st.id)?.controlType).toBe('checkbox')
    expect(h.defs.get(st.id)?.label).toBe('复选框：')
  })
})

describe('InsertControlCommand — 文本中间插入 (拆分文本节点)', () => {
  it('"abcdef" 在 offset=3 插入 → 文本拆为 "abc"/"def", 控件在两者之间', () => {
    const doc = createDocument('mid-insert')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const tn = createTextNode('abcdef')
    const para = createParagraph([tn.id])
    all.set(tn.id, tn as unknown as BaseNode)
    all.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(all, { body: doc.id })
    const defs = new TemplateDefinitionStore()
    const ctx: CommandContext = { mode: 'local', doc, pool, templateDefinitions: defs }

    const el: ElementMeta = { code: { internal: 'CTL_X', dataElement: 'DE99.99.001' }, name: 'X' }
    const cmd = new InsertControlCommand('ic', Date.now(), 'u', [doc.id, para.id], 3, el)
    const patch = cmd.forward(ctx)
    expect(patch).not.toBeNull()

    const p = pool.nodes.get(para.id) as unknown as { children: readonly string[] }
    const kinds = p.children.map(cid => (pool.nodes.get(cid) as { type?: string; text?: string }))
    expect(kinds.length).toBe(3)
    expect(kinds[0].type).toBe('text'); expect(kinds[0].text).toBe('abc')
    expect(kinds[1].type).toBe('smarttext')
    expect(kinds[2].type).toBe('text'); expect(kinds[2].text).toBe('def')
  })
})
