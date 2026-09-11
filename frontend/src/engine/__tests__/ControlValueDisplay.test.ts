// ================================================================
// controlValueDisplay — 枚举控件显示候选 name (非内部 value)
// ================================================================

import { describe, it, expect } from 'vitest'
import { LayoutEngine } from '../layout/core/LayoutEngine'
import { EventBus } from '../interaction/EventBus'
import { testMeasurer } from './helpers'
import { createDocument, createParagraph, createSmartTextNode } from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode, ElementMeta, SmartTextNode } from '../document/core/DocumentModel'

describe('枚举控件显示 name (契约 §12.6.1 值↔候选)', () => {
  function layoutText(value: unknown): string | undefined {
    const doc = createDocument('disp')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const el: ElementMeta = {
      code: { internal: 'NAT', dataElement: 'DE' }, name: '民族',
      format: { dataType: 'S1', enums: { data: [{ name: '汉族', value: 'hz' }, { name: '回族', value: 'hui' }] } },
    }
    const st = createSmartTextNode('[民族]', el)
    if (value !== undefined) (st as SmartTextNode).value = value as never
    const para = createParagraph([st.id])
    all.set(st.id, st as unknown as BaseNode)
    all.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(all, { body: doc.id })
    const engine = new LayoutEngine(new EventBus(), testMeasurer)
    engine.setControlInfoOf(() => ({ controlType: 'select', options: el.format!.enums!.data }))
    const item = engine.fullLayout(doc, pool).flatMap(p => p.items).find(it => it.nodeId === st.id)
    return item?.text
  }

  it('单值 hz → 显示候选 name 汉族', () => {
    expect(layoutText('hz')).toBe('汉族')
  })
  it('空值 → 占位符', () => {
    expect(layoutText(undefined)).toBe('[民族]')
  })
})
