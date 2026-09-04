// ================================================================
// TemplateStore 序列化往返 (契约 §12.1)
//
// 验证两个 per-editor store 作为模板 artifact 顶层字段:
//   - serializeDocument(stores) → 顶层 templateDefinitions/presentationStyles
//   - 往返无损: serialize → loadDocumentFromObject → 读回 store
//   - 纯 record (无 store) → 不输出顶层字段 (向后兼容)
//   - store 绝不混入 node payload
// ================================================================

import { describe, it, expect } from 'vitest'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { loadDocumentFromObject } from '../document/io/DocumentLoader'
import { createDocument, createParagraph, createSmartTextNode } from '../document/factory/ElementFormatter'
import { buildNodePool, type NodePool } from '../document/core/NodePool'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import { PresentationStyleStore } from '../render/presentation/PresentationStyle'
import type { PresentationStyle } from '../render/presentation/PresentationStyle'

function makeDocWithSmartText(): { doc: DocumentTree; pool: NodePool; stId: string } {
  const doc = createDocument('st-store')
  const all = new Map<string, BaseNode>()
  all.set(doc.id, doc as unknown as BaseNode)

  const element = { code: { internal: 'DE001', dataElement: 'DE02.10.001' }, name: '患者姓名' }
  const st = createSmartTextNode('[患者姓名]', element)
  const para = createParagraph([st.id])

  all.set(st.id, st as unknown as BaseNode)
  all.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  doc.header = []
  doc.footer = []

  const pool = buildNodePool(all, { body: doc.id })
  return { doc, pool, stId: st.id }
}

const DEF: TemplateDefinition = {
  deletable: false, editable: false, tips: '请填写患者姓名',
  label: '姓名：', prefix: '（', suffix: '）', single: true,
  controlType: 'input',
}

const STYLE: PresentationStyle = {
  borderStyle: 'solid', contentWrap: false,
  contentStyle: 'display:inline-block;min-width:16px',
  minWidth: 168, textAlign: 'center',
}

function makeStores(stId: string) {
  const tds = new TemplateDefinitionStore()
  tds.set(stId, DEF)
  const pss = new PresentationStyleStore()
  pss.set(stId, STYLE)
  return { tds, pss }
}

describe('TemplateStore 序列化 (契约 §12.1)', () => {
  it('serializeDocument(stores) → 顶层 templateDefinitions/presentationStyles 字段', () => {
    const { doc, pool, stId } = makeDocWithSmartText()
    const { tds, pss } = makeStores(stId)
    const parsed = JSON.parse(serializeDocument(doc, pool, { templateDefinitions: tds, presentationStyles: pss }))

    expect(parsed.templateDefinitions).toBeDefined()
    expect(parsed.presentationStyles).toBeDefined()
    expect(parsed.templateDefinitions[stId]).toEqual(DEF)
    expect(parsed.presentationStyles[stId]).toEqual(STYLE)
  })

  it('往返无损: serialize → loadDocumentFromObject → 读回 store', () => {
    const { doc, pool, stId } = makeDocWithSmartText()
    const { tds, pss } = makeStores(stId)
    const json = serializeDocument(doc, pool, { templateDefinitions: tds, presentationStyles: pss })

    const loaded = loadDocumentFromObject(JSON.parse(json))
    expect(loaded.templateDefinitions?.get(stId)).toEqual(DEF)
    expect(loaded.presentationStyles?.get(stId)).toEqual(STYLE)
  })

  it('纯 record (无 store) → 不输出顶层字段 (向后兼容)', () => {
    const { doc, pool } = makeDocWithSmartText()
    const parsed = JSON.parse(serializeDocument(doc, pool))
    expect(parsed.templateDefinitions).toBeUndefined()
    expect(parsed.presentationStyles).toBeUndefined()
  })

  it('空 store → 不输出顶层字段', () => {
    const { doc, pool } = makeDocWithSmartText()
    const parsed = JSON.parse(serializeDocument(doc, pool, {
      templateDefinitions: new TemplateDefinitionStore(),
      presentationStyles: new PresentationStyleStore(),
    }))
    expect(parsed.templateDefinitions).toBeUndefined()
    expect(parsed.presentationStyles).toBeUndefined()
  })

  it('store 绝不混入 node payload', () => {
    const { doc, pool, stId } = makeDocWithSmartText()
    const { tds, pss } = makeStores(stId)
    const parsed = JSON.parse(serializeDocument(doc, pool, { templateDefinitions: tds, presentationStyles: pss }))

    const stPayload = parsed.nodes[stId]
    expect(stPayload.templateDefinitions).toBeUndefined()
    expect(stPayload.presentationStyles).toBeUndefined()
    expect(stPayload.deletable).toBeUndefined()
    expect(stPayload.borderStyle).toBeUndefined()
  })

  it('缺失顶层字段时 load → store 为 undefined', () => {
    const { doc, pool } = makeDocWithSmartText()
    const json = serializeDocument(doc, pool)
    const loaded = loadDocumentFromObject(JSON.parse(json))
    expect(loaded.templateDefinitions).toBeUndefined()
    expect(loaded.presentationStyles).toBeUndefined()
  })

  it('旧文档定义缺失 controlType → load 后保持 undefined (不猜测, 契约 §12.1)', () => {
    const { doc, pool, stId } = makeDocWithSmartText()
    const tds = new TemplateDefinitionStore()
    tds.set(stId, { deletable: true, label: '姓名：' }) // 无 controlType (旧 artifact)
    const json = serializeDocument(doc, pool, { templateDefinitions: tds })

    const loaded = loadDocumentFromObject(JSON.parse(json))
    expect(loaded.templateDefinitions?.get(stId)?.controlType).toBeUndefined()
    expect(loaded.templateDefinitions?.get(stId)?.label).toBe('姓名：')
  })
})
