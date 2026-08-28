// ============================================================
// ClipboardSmartText — 含 smarttext 段落复制粘贴完整性
//
// 复现并防止:
//   1. cloneParagraph 把 smarttext 按 text.length 计偏移 (应为 1),
//      导致选区裁剪错位 → 粘贴内容丢失/错乱。
//   2. InsertNodesCommand.deserializePara 把 smarttext 降级为 text,
//      粘贴后结构化字段类型丢失。
// ============================================================

import { describe, it, expect } from 'vitest'
import { ClipboardManager } from '../command/ClipboardManager'
import { noopClipboard } from './helpers'
import { InsertNodesCommand } from '../command/commands/InsertNodesCommand'
import { buildNodePool } from '../document/core/NodePool'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, ElementMeta } from '../document/core/DocumentModel'
import type { CommandContext } from '../command/ICommand'

const ELEMENT: ElementMeta = {
  code: { internal: 'CTL_PATIENT_NAME', dataElement: 'DE02.01.039.00' },
  name: '患者姓名',
}

/** 段落 [text("AB"), smarttext("张三"), text("CD")] — 权威偏移总长 5 */
function makeSmartTextPara() {
  const doc = createDocument('test')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)
  const t1 = createTextNode('AB')
  const st = createSmartTextNode('张三', ELEMENT)
  const t2 = createTextNode('CD')
  const para = createParagraph([t1.id, st.id, t2.id])
  allNodes.set(t1.id, t1 as unknown as BaseNode)
  allNodes.set(st.id, st as unknown as BaseNode)
  allNodes.set(t2.id, t2 as unknown as BaseNode)
  allNodes.set(para.id, para as unknown as BaseNode)
  doc.body.children = [para.id]
  const pool = buildNodePool(allNodes, { body: doc.id })
  return { doc, pool, paraId: para.id, t1, st, t2 }
}

describe('ClipboardManager 含 smarttext 段落复制', () => {
  it('全选复制 → plainText 完整 (smarttext 占 1 偏移)', () => {
    const { doc, pool, paraId } = makeSmartTextPara()
    const cm = new ClipboardManager(noopClipboard)
    // 权威语义: AB=2 + smarttext=1 + CD=2 = 总长 5
    cm.copy([doc.id, paraId], 0, [doc.id, paraId], 5, doc, pool)

    const data = cm.paste()
    expect(data).not.toBeNull()
    expect(data!.plainText).toBe('AB张三CD')
  })

  it('复制 CD (offset 3-5) → 只得到 CD, 不误吞 smarttext', () => {
    const { doc, pool, paraId } = makeSmartTextPara()
    const cm = new ClipboardManager(noopClipboard)
    cm.copy([doc.id, paraId], 3, [doc.id, paraId], 5, doc, pool)

    const data = cm.paste()
    expect(data).not.toBeNull()
    expect(data!.plainText).toBe('CD')
    // 且 children 里没有 smarttext
    const types = data!.nodes[0].children.map(c => c.type)
    expect(types).not.toContain('smarttext')
  })

  it('复制 smarttext 本身 (offset 2-3) → 原子复制完整 text + type', () => {
    const { doc, pool, paraId } = makeSmartTextPara()
    const cm = new ClipboardManager(noopClipboard)
    cm.copy([doc.id, paraId], 2, [doc.id, paraId], 3, doc, pool)

    const data = cm.paste()
    expect(data).not.toBeNull()
    const children = data!.nodes[0].children
    expect(children).toHaveLength(1)
    expect(children[0].type).toBe('smarttext')
    expect(children[0].text).toBe('张三')
    expect(data!.plainText).toBe('张三')
  })
})

describe('InsertNodesCommand 反序列化 smarttext', () => {
  function makeCtx(pool: ReturnType<typeof buildNodePool>, doc: ReturnType<typeof createDocument>): CommandContext {
    return { mode: 'local', doc, pool }
  }

  it('粘贴含 smarttext 的数据 → 新节点保持 type=smarttext (不降级为 text)', () => {
    const { doc, pool, paraId } = makeSmartTextPara()
    const cm = new ClipboardManager(noopClipboard)
    cm.copy([doc.id, paraId], 0, [doc.id, paraId], 5, doc, pool)
    const data = cm.paste()!

    // 光标在段首 (offset 0) 粘贴
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, paraId], 0, data.nodes)
    cmd.forward(makeCtx(pool, doc))

    // 找到新插入的 smarttext 节点
    const smartNodes: { type?: string; text?: string; element?: unknown }[] = []
    for (const [, n] of pool.nodes) {
      if ((n as unknown as { type?: string }).type === 'smarttext') {
        smartNodes.push(n as unknown as { type: string; text: string; element: unknown })
      }
    }
    // 原段落 1 个 + 粘贴 1 个 = 2 个 smarttext
    expect(smartNodes).toHaveLength(2)
    const pasted = smartNodes.find(n => (n.text === '张三'))
    expect(pasted).toBeDefined()
    expect(pasted!.element).toEqual(ELEMENT)
  })
})
