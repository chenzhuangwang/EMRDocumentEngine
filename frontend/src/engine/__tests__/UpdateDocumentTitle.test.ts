// ============================================================
// UpdateDocumentTitle — 文档标题命令 (契约 §7.7 / §7.8)
//
// 覆盖:
//   1. UpdateDocumentTitleCommand forward 整体替换 doc.title + undo 精确还原。
//   2. serialize 输出 type + changes.title。
//   (Editor.applyDocumentProperties 的原子分组/无变化守卫见
//    ApplyDocumentProperties.test.ts)
// ============================================================

import { describe, it, expect } from 'vitest'
import { createDocument } from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import { buildNodePool } from '../document/core/NodePool'
import type { NodePool } from '../document/core/NodePool'
import { UpdateDocumentTitleCommand } from '../command/commands/UpdateDocumentTitleCommand'
import { CommandManager } from '../command/CommandManager'
import { EventBus } from '../interaction/EventBus'

function makeDoc(): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument('原始标题')
  const pool = buildNodePool(new Map([[doc.id, doc as unknown as BaseNode]]), { body: doc.id })
  return { doc, pool }
}

describe('UpdateDocumentTitleCommand (契约 §7.7/§7.8)', () => {
  it('forward 整体替换标题 + undo 精确还原', () => {
    const { doc, pool } = makeDoc()
    const manager = new CommandManager(new EventBus(), () => doc, () => pool)

    manager.execute(new UpdateDocumentTitleCommand('c1', Date.now(), 'user', '新标题'))
    expect(doc.title).toBe('新标题')

    manager.undo()
    expect(doc.title).toBe('原始标题')
  })

  it('空串也是合法标题 (title 无删除语义)', () => {
    const { doc, pool } = makeDoc()
    const manager = new CommandManager(new EventBus(), () => doc, () => pool)

    manager.execute(new UpdateDocumentTitleCommand('c1', Date.now(), 'user', ''))
    expect(doc.title).toBe('')

    manager.undo()
    expect(doc.title).toBe('原始标题')
  })

  it('serialize 输出 type + changes.title', () => {
    const cmd = new UpdateDocumentTitleCommand('c9', 123, 'user', '序列化标题')
    expect(cmd.serialize()).toEqual({
      type: 'update-document-title', id: 'c9', timestamp: 123,
      author: 'user', changes: { title: '序列化标题' },
    })
  })
})
