// ================================================================
// EditableGuard — find & replace 的 editable 守卫 (契约 §12.1)
//
// 验证 ReplaceTextCommand 替换 smarttext 运行时值 (value) 时:
//   - editable:false → 跳过, value 不被改写 (只读控件)
//   - editable:true  → 正常改写
//   - 无 store 条目  → 正常改写 (默认可编辑)
//   - 守卫只作用于 smarttext, 不影响 text 节点
// ================================================================

import { describe, it, expect } from 'vitest'
import { ReplaceTextCommand } from '../command/commands/ReplaceTextCommand'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { BaseNode, ElementMeta, SmartTextNode, ControlValue } from '../document/core/DocumentModel'
import type { CommandContext } from '../command/ICommand'

const ELEMENT: ElementMeta = {
  code: { internal: 'CTL_PATIENT_NAME', dataElement: 'DE02.01.039.00' },
  name: '患者姓名',
}

function makeDoc(editable: boolean | undefined) {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const st = createSmartTextNode('[姓名]', ELEMENT, undefined, '张三')
  const para = createParagraph([st.id])
  allNodes.set(st.id, st as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })

  const defs = new TemplateDefinitionStore()
  if (editable !== undefined) defs.set(st.id, { editable })

  return { doc, pool, paraId: para.id, stId: st.id, defs }
}

function replace(
  doc: ReturnType<typeof createDocument>,
  pool: ReturnType<typeof buildNodePool>,
  paraId: string,
  defs: TemplateDefinitionStore | undefined,
): void {
  const ctx: CommandContext = { mode: 'local', doc, pool, templateDefinitions: defs }
  const cmd = new ReplaceTextCommand('c1', Date.now(), 'u', [{
    paragraphPath: [doc.id, paraId], startOffset: 0, endOffset: 2, newText: '李四',
  }])
  cmd.forward(ctx)
}

function valueOf(pool: ReturnType<typeof buildNodePool>, id: string): ControlValue | undefined {
  return (pool.nodes.get(id) as SmartTextNode | undefined)?.value
}

describe('find & replace 的 editable 守卫 (契约 §12.1)', () => {
  it('editable:false → smarttext value 不被改写', () => {
    const { doc, pool, paraId, defs, stId } = makeDoc(false)
    replace(doc, pool, paraId, defs)
    expect(valueOf(pool, stId)).toBe('张三')
  })

  it('editable:true → smarttext value 正常改写', () => {
    const { doc, pool, paraId, defs, stId } = makeDoc(true)
    replace(doc, pool, paraId, defs)
    expect(valueOf(pool, stId)).toBe('李四')
  })

  it('无 store 条目 → 正常改写 (默认可编辑)', () => {
    const { doc, pool, paraId, stId } = makeDoc(undefined)
    replace(doc, pool, paraId, undefined)
    expect(valueOf(pool, stId)).toBe('李四')
  })

  it('守卫只作用于 smarttext, text 节点照常替换', () => {
    // 段落 [text("张三")] + smarttext(editable:false, value="张三")
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const t = createTextNode('张三')
    const st = createSmartTextNode('[姓名]', ELEMENT, undefined, '张三')
    const para = createParagraph([t.id, st.id])
    allNodes.set(t.id, t as unknown as BaseNode)
    allNodes.set(st.id, st as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(allNodes, { body: doc.id })
    const defs = new TemplateDefinitionStore()
    defs.set(st.id, { editable: false })

    // 段落长度: text("张三")=2 + smarttext("张三")=2 → 总长 4
    // 只替换 text 节点 [0,2), smarttext 位于 [2,4)
    const ctx: CommandContext = { mode: 'local', doc, pool, templateDefinitions: defs }
    new ReplaceTextCommand('c1', Date.now(), 'u', [{
      paragraphPath: [doc.id, para.id], startOffset: 0, endOffset: 2, newText: '王五',
    }]).forward(ctx)

    expect((pool.nodes.get(t.id) as unknown as { text: string }).text).toBe('王五')
    expect((pool.nodes.get(st.id) as SmartTextNode).value).toBe('张三')
  })
})
