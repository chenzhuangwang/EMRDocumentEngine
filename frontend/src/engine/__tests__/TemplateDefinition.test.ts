// ============================================================
// TemplateDefinition 单元测试 (契约 §12.1)
//
// 覆盖:
//   1. 边界 (type-level + 运行时): SmartTextNode / ElementMeta 不得
//      携带 7 个模板设计期字段 (deletable/editable/tips/label/
//      prefix/suffix/single) —— 它们只属于 TemplateDefinition 层。
//   2. store 读写语义: set/get/has/delete/clear/size/遍历。
// ============================================================

import { describe, it, expect, expectTypeOf } from 'vitest'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import type { SmartTextNode, ElementMeta } from '../document/core/DocumentModel'
import { createSmartTextNode } from '../document/factory/ElementFormatter'

const DESIGN_FIELDS = ['deletable', 'editable', 'tips', 'label', 'prefix', 'suffix', 'single'] as const

describe('TemplateDefinition 边界 (契约 §12.1)', () => {
  it('type-level: SmartTextNode 不得携带模板设计期字段', () => {
    expectTypeOf<SmartTextNode>().not.toHaveProperty('deletable')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('editable')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('tips')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('label')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('prefix')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('suffix')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('single')
  })

  it('type-level: ElementMeta 不得携带模板设计期字段', () => {
    expectTypeOf<ElementMeta>().not.toHaveProperty('deletable')
    expectTypeOf<ElementMeta>().not.toHaveProperty('editable')
    expectTypeOf<ElementMeta>().not.toHaveProperty('tips')
    expectTypeOf<ElementMeta>().not.toHaveProperty('label')
    expectTypeOf<ElementMeta>().not.toHaveProperty('prefix')
    expectTypeOf<ElementMeta>().not.toHaveProperty('suffix')
    expectTypeOf<ElementMeta>().not.toHaveProperty('single')
  })

  it('运行时: createSmartTextNode 结果不含模板设计期字段', () => {
    const element = { code: { internal: 'HDSD00.02.055', dataElement: 'DE08.10.052.00' }, name: '医疗机构组织机构代码' }
    const st = createSmartTextNode('[机构代码]', element)
    for (const k of DESIGN_FIELDS) {
      expect(k in st, `SmartTextNode 不应含字段 ${k}`).toBe(false)
    }
  })
})

describe('TemplateDefinitionStore', () => {
  it('set/get/has 基本读写', () => {
    const store = new TemplateDefinitionStore()
    const id = 'node-1'
    expect(store.has(id)).toBe(false)
    expect(store.get(id)).toBeUndefined()

    store.set(id, { deletable: true, label: '姓名：' })
    expect(store.has(id)).toBe(true)
    expect(store.get(id)?.label).toBe('姓名：')
    expect(store.get(id)?.deletable).toBe(true)
  })

  it('set 同节点覆盖旧值', () => {
    const store = new TemplateDefinitionStore()
    store.set('n', { label: 'a' })
    store.set('n', { label: 'b', editable: false })
    expect(store.get('n')).toEqual({ label: 'b', editable: false })
  })

  it('delete 返回是否确实删除, clear/size 一致', () => {
    const store = new TemplateDefinitionStore()
    store.set('a', {})
    store.set('b', {})
    expect(store.size).toBe(2)
    expect(store.delete('a')).toBe(true)
    expect(store.delete('a')).toBe(false)
    expect(store.size).toBe(1)
    store.clear()
    expect(store.size).toBe(0)
  })

  it('entries/keys/values 遍历', () => {
    const store = new TemplateDefinitionStore()
    store.set('a', { tips: 'x' })
    store.set('b', { single: true })
    expect([...store.keys()].sort()).toEqual(['a', 'b'])
    expect([...store.values()].length).toBe(2)
    const entries = new Map<string, TemplateDefinition>(store.entries())
    expect(entries.get('b')?.single).toBe(true)
  })

  it('不同节点互不影响', () => {
    const store = new TemplateDefinitionStore()
    store.set('x', { prefix: '[' })
    store.set('y', { suffix: ']' })
    expect(store.get('x')?.prefix).toBe('[')
    expect(store.get('x')?.suffix).toBeUndefined()
    expect(store.get('y')?.suffix).toBe(']')
  })
})
