// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// UpdateDocumentProperties — 文档级元数据 (契约 §7.7/§7.8)
//
// 覆盖:
//   1. normalizeDocumentMetadata 白名单收口 + keywords 规范化
//      (trim/去空/去重, 非数组 drop, 未知字段 drop, 非对象→undefined)。
//   2. UpdateDocumentPropertiesCommand forward (整体替换/清空) + undo 精确还原。
//   3. ModelUpgrader v4.2→v4.3 metadata 白名单迁移。
//   4. DocumentLoader validate 拦截非对象 metadata。
// ============================================================

import { describe, it, expect } from 'vitest'
import { createDocument } from '../document/factory/ElementFormatter'
import { normalizeDocumentMetadata } from '../document/core/DocumentModel'
import type { BaseNode, DocumentTree, DocumentMetadata } from '../document/core/DocumentModel'
import { buildNodePool } from '../document/core/NodePool'
import type { NodePool } from '../document/core/NodePool'
import { UpdateDocumentPropertiesCommand } from '../command/commands/UpdateDocumentPropertiesCommand'
import { CommandManager } from '../command/CommandManager'
import { EventBus } from '../interaction/EventBus'
import { modelUpgrader } from '../document/version/ModelUpgrader'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../document/version/DocumentFormatVersion'
import { loadDocumentFromObject } from '../document/io/DocumentLoader'

function makeDoc(): { doc: DocumentTree; pool: NodePool } {
  const doc = createDocument('test')
  const pool = buildNodePool(new Map([[doc.id, doc as unknown as BaseNode]]), { body: doc.id })
  return { doc, pool }
}

describe('normalizeDocumentMetadata (契约 §7.7)', () => {
  it('非对象 / null / 数组 → undefined', () => {
    expect(normalizeDocumentMetadata(null)).toBeUndefined()
    expect(normalizeDocumentMetadata('x')).toBeUndefined()
    expect(normalizeDocumentMetadata([1, 2])).toBeUndefined()
  })

  it('空对象 → undefined (整体删除语义)', () => {
    expect(normalizeDocumentMetadata({})).toBeUndefined()
  })

  it('未知字段 drop, 已知字符串字段 trim', () => {
    expect(normalizeDocumentMetadata({ foo: 'bar', author: ' 张三 ' })).toEqual({ author: '张三' })
  })

  it('keywords 数组: trim + 去空 + 去重 (保持顺序)', () => {
    expect(normalizeDocumentMetadata({
      keywords: [' 高血压 ', '心内科', '高血压', '', '  '],
    })).toEqual({ keywords: ['高血压', '心内科'] })
  })

  it('keywords 非数组 → drop (仅剩非法键 → undefined)', () => {
    expect(normalizeDocumentMetadata({ keywords: 'a,b' })).toBeUndefined()
  })

  it('字符串字段 trim 后为空 → drop', () => {
    expect(normalizeDocumentMetadata({ department: '   ' })).toBeUndefined()
    expect(normalizeDocumentMetadata({ author: 123 })).toBeUndefined()
  })
})

describe('UpdateDocumentPropertiesCommand (契约 §7.7/§7.8)', () => {
  it('forward 设置 metadata + undo 还原为无', () => {
    const { doc, pool } = makeDoc()
    const manager = new CommandManager(new EventBus(), () => doc, () => pool)

    manager.execute(new UpdateDocumentPropertiesCommand(
      'c1', Date.now(), 'user', { author: '张三', keywords: ['a', 'b'] },
    ))
    expect(doc.metadata).toEqual({ author: '张三', keywords: ['a', 'b'] })

    manager.undo()
    expect(doc.metadata).toBeUndefined()
  })

  it('整体替换覆盖旧值 + undo 精确还原旧 metadata', () => {
    const { doc, pool } = makeDoc()
    doc.metadata = { author: 'A', department: '内科' }
    const manager = new CommandManager(new EventBus(), () => doc, () => pool)

    manager.execute(new UpdateDocumentPropertiesCommand('c1', Date.now(), 'user', { author: 'B' }))
    expect(doc.metadata).toEqual({ author: 'B' })  // 旧 department 被整体替换掉

    manager.undo()
    expect(doc.metadata).toEqual({ author: 'A', department: '内科' })
  })

  it('next undefined → 删除 metadata; undo 还原', () => {
    const { doc, pool } = makeDoc()
    doc.metadata = { author: 'A' }
    const manager = new CommandManager(new EventBus(), () => doc, () => pool)

    manager.execute(new UpdateDocumentPropertiesCommand('c1', Date.now(), 'user', undefined))
    expect(doc.metadata).toBeUndefined()

    manager.undo()
    expect(doc.metadata).toEqual({ author: 'A' })
  })
})

describe('ModelUpgrader v4.2→v4.3 metadata 白名单迁移', () => {
  it('未知键 drop, keywords 规范化, 已知键保留', () => {
    const doc = createDocument('test')
    doc.modelVersion = '4.2.0'
    doc.metadata = {
      creator: ' 张三 ',
      keywords: ['a', 'b', 'a', '', '  '],
      version: '2.1.0',
      createTime: '2023-03-27 16:15:30',
    } as unknown as DocumentMetadata

    const upgraded = modelUpgrader.upgrade(doc)
    expect(upgraded.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(upgraded.metadata).toEqual({ creator: '张三', keywords: ['a', 'b'] })
  })
})

describe('DocumentLoader validate metadata', () => {
  it('metadata 非对象 → LoadError(validate)', () => {
    const doc = createDocument('test')
    const raw = { ...doc, metadata: 'not-an-object' }
    expect(() => loadDocumentFromObject(raw)).toThrow(/doc\.metadata 非对象/)
  })

  it('metadata 为数组 → LoadError(validate)', () => {
    const doc = createDocument('test')
    const raw = { ...doc, metadata: [1, 2] }
    expect(() => loadDocumentFromObject(raw)).toThrow(/doc\.metadata 非对象/)
  })
})
