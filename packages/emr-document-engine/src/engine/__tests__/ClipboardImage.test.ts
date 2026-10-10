// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ClipboardImage — 图片节点复制 (P2 图片复制)
//
// 验证右键菜单 image 命中「复制」链路:
//   - ClipboardManager.copyImage 把图片包装为「含一个 image 子节点的
//     合成段落」存入内存剪贴板 (图片字段全保留, plainText 置空)。
//   - 粘贴侧复用 InsertNodesCommand.deserializePara 的通用非文本分支
//     恢复图片 (不降级为 text, 字段完整)。
//   - Editor.copyImage 门面按 nodeId 取节点并委托, 非图片/未知 id 返回 false。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { ClipboardManager } from '../command/ClipboardManager'
import { noopClipboard } from './helpers'
import { InsertNodesCommand } from '../command/commands/InsertNodesCommand'
import { buildNodePool } from '../document/core/NodePool'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode, createImageNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'
import type { CommandContext } from '../command/ICommand'

describe('ClipboardManager.copyImage (P2 图片复制)', () => {
  it('复制图片 → paste 返回合成段落, 图片字段完整保留, plainText 置空', () => {
    const cm = new ClipboardManager(noopClipboard)
    const img = createImageNode('k1', 100, 80, 'top-bottom')
    cm.copyImage(img)

    const data = cm.paste()
    expect(data).not.toBeNull()
    expect(data!.plainText).toBe('')
    expect(data!.nodes).toHaveLength(1)

    const para = data!.nodes[0]
    expect(para.type).toBe('paragraph')
    expect(para.children).toHaveLength(1)

    const child = para.children[0]
    expect(child.type).toBe('image')
    expect(child.id).not.toBe(img.id) // 克隆生成全新 id
    expect(child.objectKey).toBe('k1')
    expect(child.width).toBe(100)
    expect(child.height).toBe(80)
    expect(child.wrapMode).toBe('top-bottom')
  })

  it('copyImage 标记为图片数据 (isImageData), 文本复制/回填后恢复非图片', () => {
    const cm = new ClipboardManager(noopClipboard)
    expect(cm.isImageData()).toBe(false)

    cm.copyImage(createImageNode('k1', 10, 10))
    expect(cm.isImageData()).toBe(true)

    cm.setPlainText('hello')
    expect(cm.isImageData()).toBe(false)
  })
})

describe('InsertNodesCommand 反序列化图片 (粘贴回路)', () => {
  function makeCtx(pool: ReturnType<typeof buildNodePool>, doc: DocumentTree): CommandContext {
    return { mode: 'local', doc, pool }
  }

  it('copyImage → InsertNodesCommand 粘贴 → pool 新增 image 节点且字段保留', () => {
    const doc = createDocument('test')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const t1 = createTextNode('abc')
    const para = createParagraph([t1.id])
    allNodes.set(t1.id, t1 as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    const cm = new ClipboardManager(noopClipboard)
    const img = createImageNode('k2', 200, 150, 'inline')
    cm.copyImage(img)
    const data = cm.paste()!

    // offset 3 = "abc" 末尾, 就地拼接图片
    const cmd = new InsertNodesCommand('c1', Date.now(), 'u', [doc.id, para.id], 3, data.nodes)
    cmd.forward(makeCtx(pool, doc))

    const images: Array<Record<string, unknown>> = []
    for (const [, n] of pool.nodes) {
      if ((n as unknown as { type?: string }).type === 'image') {
        images.push(n as unknown as Record<string, unknown>)
      }
    }
    expect(images).toHaveLength(1)
    expect(images[0].objectKey).toBe('k2')
    expect(images[0].width).toBe(200)
    expect(images[0].height).toBe(150)
    expect(images[0].wrapMode).toBe('inline')

    // 段落 children 新增图片 (text + image)
    const paraNode = pool.nodes.get(para.id) as { children?: readonly string[] } | undefined
    expect(paraNode?.children).toHaveLength(2)
    expect(paraNode?.children?.[1]).toBe(images[0].id)
  })
})

describe('Editor.copyImage (门面)', () => {
  /** body: [para1(text), img(block), para2(text + inlineImg)] */
  function makeDoc(): { doc: DocumentTree; ids: Record<string, string> } {
    const doc = createDocument('dn')
    const text1 = createTextNode('第一段')
    const para1 = createParagraph([text1.id])
    const img = createImageNode('img-key', 100, 100, 'top-bottom')
    const text2 = createTextNode('第二段')
    const inlineImg = createImageNode('inline-key', 80, 60, 'top-bottom')
    const para2 = createParagraph([text2.id, inlineImg.id])

    doc.body.children = [para1.id, img.id, para2.id]

    const nodes: Record<string, BaseNode> = {}
    for (const n of [doc, text1, para1, img, text2, inlineImg, para2]) {
      nodes[n.id] = n as unknown as BaseNode
    }
    ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

    return {
      doc,
      ids: { para1: para1.id, img: img.id, inlineImg: inlineImg.id },
    }
  }

  const cleanups: Array<() => void> = []

  function makeEditor() {
    const { doc, ids } = makeDoc()
    const host: DomEditorHost = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container)
    host.input.mount(container)
    const editor = new Editor(host, doc)
    cleanups.push(() => { editor.destroy(); container.remove() })
    return { editor, ids }
  }

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!()
  })

  it('block 级与内联图片均返回 true, 非图片/未知 id 返回 false', () => {
    const { editor, ids } = makeEditor()
    expect(editor.copyImage(ids.img)).toBe(true)
    expect(editor.copyImage(ids.inlineImg)).toBe(true)
    expect(editor.copyImage(ids.para1)).toBe(false)
    expect(editor.copyImage('ghost')).toBe(false)
  })

  it('复制不产生 undo 命令 (纯副作用, 不入 undo 栈)', () => {
    const { editor, ids } = makeEditor()
    expect(editor.canUndo()).toBe(false)
    editor.copyImage(ids.img)
    expect(editor.canUndo()).toBe(false)
  })

  it('复制 block 图片 → 删除源图 → 粘贴仍插入新图片 (复制/删除相互独立)', () => {
    const { editor, ids } = makeEditor()
    const bodyId = editor.getPool().rootIds.body

    // 光标落到 para1, 供粘贴
    editor.collapseSelectionToPoint([bodyId, ids.para1], 0)
    // 复制 block 图片后删除源图 — 内存剪贴板不受删除影响
    expect(editor.copyImage(ids.img)).toBe(true)
    editor.deleteNode(ids.img)
    expect(editor.getPool().nodes.has(ids.img)).toBe(false)

    editor.paste()

    // 粘贴产物: pool 中新增一张 image 节点 (id 不同于原图 / 原内联图)
    const imageIds: string[] = []
    for (const [id, n] of editor.getPool().nodes) {
      if ((n as unknown as { type?: string }).type === 'image') imageIds.push(id)
    }
    expect(imageIds).toContain(ids.inlineImg)
    const pasted = imageIds.filter((id) => id !== ids.img && id !== ids.inlineImg)
    expect(pasted).toHaveLength(1)
  })
})
