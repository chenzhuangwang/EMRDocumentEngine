// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SelectAllImage — 全选覆盖图片 (修复「正文 + 图片, 全选选不中图片」)
//
// 根因: 图片是段落内联子节点 (insertImage 默认 wrapMode=top-bottom),
// 段落本身在 body.children / 展平 spine 中, 但 renderSelectionUnified
// 的 else 分支对 image item 走 findItemParagraph → fillItem, 图片无 text
// → 按 0 长度绘制 ascent×ascent 小方框, 视觉上「选不中」。
// 拖选同理: computeOffsetInItems 对空文本图片 item 一律返回 0 偏移,
// 选区终点落在图片之前, 图片不被覆盖。
//
// 修复:
//   - Draw.renderSelectionUnified 对 image item 高亮整幅 width×height
//     (内联图按段内 1 字符偏移定位, 块级图按 spine 索引定位)。
//   - CharWidthHelper.computeOffsetInItems 对 type='image' 空文本原子
//     按 1 字符解析 (左/右半 → 0/1), 使拖拽选区能覆盖图片。
//
// 本测试用真实 Editor 断言 selectAll 的选区状态覆盖图片段落, 并确认
// 布局产出了可被选区高亮消费的 image SLIF item。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode, createImageNode,
} from '../document/factory/ElementFormatter'
import type { BaseNode, DocumentTree } from '../document/core/DocumentModel'

const cleanups: Array<() => void> = []

/** body = [para("第一段文本"), para(image)] — 图片为段落内联子节点 (同 insertImage) */
function makeEditor(): { editor: Editor; doc: DocumentTree; paraId: string; imageParaId: string } {
  const doc = createDocument('dn')
  const nodes: Record<string, BaseNode> = {}

  const tn1 = createTextNode('第一段文本')
  const para = createParagraph([tn1.id])
  nodes[tn1.id] = tn1 as unknown as BaseNode
  nodes[para.id] = para as unknown as BaseNode

  const img = createImageNode('img-key', 200, 120, 'top-bottom')
  const imagePara = createParagraph([img.id])
  nodes[img.id] = img as unknown as BaseNode
  nodes[imagePara.id] = imagePara as unknown as BaseNode

  doc.body.children = [para.id, imagePara.id]
  nodes[doc.id] = doc as unknown as BaseNode
  ;(doc as unknown as { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host: DomEditorHost = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  cleanups.push(() => { editor.destroy(); container.remove() })

  return { editor, doc, paraId: para.id, imageParaId: imagePara.id }
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

describe('全选覆盖图片 (正文 + 图片)', () => {
  it('selectAll 锚定首段→图片段落末, focus offset=1 (图片占 1 字符)', () => {
    const { editor, doc, paraId, imageParaId } = makeEditor()

    editor.selectAll()
    const sel = editor.getStore().state.runtime.selection

    expect(sel.active).toBe(true)
    expect(sel.anchor.paragraphPath).toEqual([doc.id, paraId])
    expect(sel.anchor.offset).toBe(0)
    expect(sel.focus.paragraphPath).toEqual([doc.id, imageParaId])
    expect(sel.focus.offset).toBe(1)
  })

  it('布局产出 image SLIF item (供选区高亮消费整幅边界)', () => {
    const { editor } = makeEditor()
    const pages = editor.getDraw().getPages()
    const imageItems = pages.flatMap((p) => p.items.filter((it) => it.type === 'image'))
    expect(imageItems).toHaveLength(1)
    expect(imageItems[0].width).toBeGreaterThan(0)
    expect(imageItems[0].height).toBeGreaterThan(0)
  })
})
