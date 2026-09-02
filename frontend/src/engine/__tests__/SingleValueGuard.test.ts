// ================================================================
// SingleValueGuard — 粘贴期 single 唯一性守卫 (契约 §12.1)
//
// 验证 InsertNodesCommand 粘贴 smarttext 时:
//   - 目标文档已存在同身份数据元且 single:true → 丢弃重复实例
//   - 同身份但非 single → 允许重复
//   - 文档无该数据元 → 允许
//   - dataElement 空 → 回退 internal 作为身份
// 导入期不去重 (模板可跨区块引用同一数据元), 故此处只测粘贴路径。
// ================================================================

import { describe, it, expect } from 'vitest'
import { InsertNodesCommand } from '../command/commands/InsertNodesCommand'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { BaseNode, ElementMeta, SmartTextNode } from '../document/core/DocumentModel'
import type { CommandContext } from '../command/ICommand'
import type { SerializedPara } from '../command/ClipboardManager'

const ELEMENT_NAME: ElementMeta = {
  code: { internal: 'CTL_PATIENT_NAME', dataElement: 'DE02.01.039.00' },
  name: '患者姓名',
}
const ELEMENT_AGE: ElementMeta = {
  code: { internal: 'CTL_AGE', dataElement: 'DE02.01.030.00' },
  name: '年龄',
}
const ELEMENT_INTERNAL_ONLY: ElementMeta = {
  code: { internal: 'CTL_NO_DE', dataElement: '' },
  name: '无数据元码',
}

function makeDocWithSmartText(element: ElementMeta, single: boolean | undefined) {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const st = createSmartTextNode('[姓名]', element)
  const para = createParagraph([st.id])
  allNodes.set(st.id, st as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })

  const defs = new TemplateDefinitionStore()
  if (single !== undefined) defs.set(st.id, { single })

  return { doc, pool, paraId: para.id, stId: st.id, defs }
}

function makePastePara(element: ElementMeta): SerializedPara {
  return {
    type: 'paragraph',
    id: 'p-paste',
    style: {},
    children: [{ type: 'smarttext', id: 'st-paste', text: '[姓名]', element }],
  }
}

function paste(
  doc: ReturnType<typeof createDocument>,
  pool: ReturnType<typeof buildNodePool>,
  paraId: string,
  defs: TemplateDefinitionStore,
  para: SerializedPara,
): void {
  const ctx: CommandContext = { mode: 'local', doc, pool, templateDefinitions: defs }
  const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 0, [para])
  cmd.forward(ctx)
}

function smartTextCount(pool: ReturnType<typeof buildNodePool>): number {
  let n = 0
  for (const [, node] of pool.nodes) {
    if ((node as SmartTextNode).type === 'smarttext') n++
  }
  return n
}

describe('粘贴期 single 唯一性守卫 (契约 §12.1)', () => {
  it('目标文档已有 single:true 同身份数据元 → 粘贴重复实例被丢弃', () => {
    const { doc, pool, paraId, defs } = makeDocWithSmartText(ELEMENT_NAME, true)
    paste(doc, pool, paraId, defs, makePastePara(ELEMENT_NAME))
    expect(smartTextCount(pool)).toBe(1) // 仅保留原实例
  })

  it('同身份但非 single → 允许重复粘贴', () => {
    const { doc, pool, paraId, defs } = makeDocWithSmartText(ELEMENT_NAME, false)
    paste(doc, pool, paraId, defs, makePastePara(ELEMENT_NAME))
    expect(smartTextCount(pool)).toBe(2)
  })

  it('文档无该数据元 → 允许粘贴', () => {
    const { doc, pool, paraId, defs } = makeDocWithSmartText(ELEMENT_NAME, true)
    paste(doc, pool, paraId, defs, makePastePara(ELEMENT_AGE))
    expect(smartTextCount(pool)).toBe(2) // 姓名 + 年龄
  })

  it('dataElement 空 → 回退 internal 作为身份判重', () => {
    const { doc, pool, paraId, defs } = makeDocWithSmartText(ELEMENT_INTERNAL_ONLY, true)
    paste(doc, pool, paraId, defs, makePastePara(ELEMENT_INTERNAL_ONLY))
    expect(smartTextCount(pool)).toBe(1)
  })

  it('无 store (templateDefinitions 未注入) → 不拦截', () => {
    const { doc, pool, paraId } = makeDocWithSmartText(ELEMENT_NAME, true)
    // 构造不含 store 的 ctx
    const ctx: CommandContext = { mode: 'local', doc, pool }
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 0, [makePastePara(ELEMENT_NAME)])
    cmd.forward(ctx)
    expect(smartTextCount(pool)).toBe(2) // 无守卫信息 → 放行
  })
})
