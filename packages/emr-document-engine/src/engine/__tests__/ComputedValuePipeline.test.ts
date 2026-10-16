// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// 计算值的**接线** (契约 §12.12.5 / §12.12.8) —— 从 Editor 到 SLIFItem 的整条路
//
// 为什么不接着 ComputedValues.test.ts 写: 那个文件测的是集合**自己** —— 注入式
// deps、不碰文档、一个夹具一个时钟计数, 它绿只说明求值对。而本批最容易静默失效的
// 不是求值, 是**接线**:
//   - 集合建好了但 Draw 拿不到        → 公式一条都不生效, 页面显示占位符
//   - 键索引没跟着 element 改名重建   → 公式指向改掉的旧键
//   - 换文档沿用上一份文档的键索引    → 公式指向**别人文档里的节点 id**
// 三种都不抛错, 只是**算错**, 而且看上去完全正常。所以本文件一律走真实路径:
// 真 Editor、真池、真命令、真布局, 断言真的 SLIFItem。
// (仓库教训: 测试自造夹具会掩盖接线缺陷 —— 那正是本文件存在的理由。)
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import { getFlatPageItems } from '../layout/core/SLIF'
import { paragraphTextLength } from '../document/selection/SelectionCollector'
import { NodeType } from '../document/core/DocumentModel'
import type { Paragraph } from '../document/core/DocumentModel'
import type { BaseNode, ControlValue, DocumentTree, ElementMeta } from '../document/core/DocumentModel'
import type { SLIFPage } from '../layout/core/SLIF'

/** 一个控件规格 —— `name` 只在测试里做引用键 */
interface CtrlSpec {
  name: string
  /** 绑定键 (§12.10.1) */
  key: string
  value?: ControlValue
  /** 写进 TemplateDefinition.formula (§12.12.1) */
  formula?: string
  dataType?: 'S1' | 'N'
  required?: boolean
  placeholder?: string
}

/** 段落的一个孩子: 纯文本 或 按名引用的控件 */
type Child = string | { ctrl: string }

interface Built {
  doc: DocumentTree
  /** 控件名 → nodeId */
  id: Record<string, string>
  defs: TemplateDefinitionStore
  paras: string[]
}

function buildDoc(body: Child[][], ctrls: CtrlSpec[]): Built {
  const doc = createDocument('计算值接线')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode
  const id: Record<string, string> = {}

  for (const c of ctrls) {
    const element: ElementMeta = {
      code: { internal: c.key, dataElement: c.key },
      name: c.name,
      format: { dataType: c.dataType ?? 'S1' },
      ...(c.required ? { required: true } : {}),
    }
    const st = createSmartTextNode(c.placeholder ?? `[${c.name}]`, element, undefined, c.value)
    nodes[st.id] = st as unknown as BaseNode
    id[c.name] = st.id
  }

  const paras = body.map((children) => {
    const childIds = children.map((ch) => {
      if (typeof ch === 'string') {
        const t = createTextNode(ch)
        nodes[t.id] = t as unknown as BaseNode
        return t.id
      }
      return id[ch.ctrl]
    })
    const p = createParagraph(childIds)
    nodes[p.id] = p as unknown as BaseNode
    return p.id
  })
  doc.body.children = paras
  ;(doc as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes

  // 公式住在 per-editor 的 TemplateDefinitionStore (§12.12.1), 随 artifact 顶层
  // 字段序列化; 这里按 §12.10 的顶层 stores 注入 (与 BoundValues 同一路径)。
  const defs = new TemplateDefinitionStore()
  for (const c of ctrls) {
    if (c.formula === undefined) continue
    defs.set(id[c.name], { controlType: 'input', formula: c.formula })
  }
  return { doc, id, defs, paras }
}

interface Fixture extends Built { editor: Editor }

function makeFixture(body: Child[][], ctrls: CtrlSpec[]): Fixture {
  const built = buildDoc(body, ctrls)
  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, built.doc)
  editor.setDocument(built.doc, undefined, { templateDefinitions: built.defs })
  return { ...built, editor }
}

/** 布局结果里某节点的文本 (无该项 → undefined, 即"根本没排出来") */
function laidOutText(editor: Editor, nodeId: string): string | undefined {
  for (const page of editor.getDraw().getPages()) {
    const hit = getFlatPageItems(page).find((i) => i.nodeId === nodeId)
    if (hit) return hit.text
  }
  return undefined
}

function firstPage(editor: Editor): SLIFPage {
  const pages = editor.getDraw().getPages()
  expect(pages.length).toBeGreaterThan(0)
  return pages[0]
}

afterEach(() => { document.body.innerHTML = '' })

// ================================================================
// 计算值进入布局 (§12.12.8)
// ================================================================

describe('计算值进入布局 (§12.12.8)', () => {
  it('公式控件的 SLIFItem.text = 算出的值 (Editor → Draw → LayoutEngine 整条路)', () => {
    const f = makeFixture([[{ ctrl: '源' }, { ctrl: '合计' }]], [
      { name: '源', key: 'SRC', value: 2, dataType: 'N' },
      { name: '合计', key: 'TOTAL', formula: '[SRC] + 1' },
    ])

    // 布局排出来的就是算出的值。没有公式时这里会是占位符 '[合计]' ——
    // 也就是"接线断了"的唯一可见症状。
    expect(laidOutText(f.editor, f.id['合计'])).toBe('3')
    // 同一条读路径的另一个入口取到同一个值 (两份读法同源)
    expect(f.editor.getComputedDisplay(f.id['合计'])).toBe('3')
  })

  it('无公式的控件逐字不变: 有值显值, 未填显占位符', () => {
    const f = makeFixture([[{ ctrl: '姓名' }, { ctrl: '年龄' }]], [
      { name: '姓名', key: 'NAME', value: '张三' },
      { name: '年龄', key: 'AGE', placeholder: '[未填]' },
    ])
    expect(laidOutText(f.editor, f.id['姓名'])).toBe('张三')
    expect(laidOutText(f.editor, f.id['年龄'])).toBe('[未填]')
    expect(f.editor.getComputedDisplay(f.id['年龄'])).toBeUndefined()
  })

  it('改依赖值 → 布局跟着变 (命令路径; 值的版本比对是兜底)', () => {
    const f = makeFixture([[{ ctrl: '源' }, { ctrl: '合计' }]], [
      { name: '源', key: 'SRC', value: 2, dataType: 'N' },
      { name: '合计', key: 'TOTAL', formula: '[SRC] + 1' },
    ])
    expect(laidOutText(f.editor, f.id['合计'])).toBe('3')

    expect(f.editor.setControlValue(f.id['源'], 10).ok).toBe(true)
    expect(laidOutText(f.editor, f.id['合计'])).toBe('11')
  })

  it('批量绑定 (§12.10.3) 写进来的值同样带动计算值 —— 另一条写值的路', () => {
    const f = makeFixture([[{ ctrl: '源' }, { ctrl: '合计' }]], [
      { name: '源', key: 'SRC', value: 2, dataType: 'N' },
      { name: '合计', key: 'TOTAL', formula: '[SRC] + 1' },
    ])
    const r = f.editor.setBoundValues({ SRC: 7 })
    expect(r.applied).toHaveLength(1)
    expect(laidOutText(f.editor, f.id['合计'])).toBe('8')
  })

  it('改公式 → 布局跟着变 (定义表版本 + 改公式的命令必须触发重排)', () => {
    const f = makeFixture([[{ ctrl: '源' }, { ctrl: '合计' }]], [
      { name: '源', key: 'SRC', value: 2, dataType: 'N' },
      { name: '合计', key: 'TOTAL', formula: '[SRC] + 1' },
    ])
    expect(laidOutText(f.editor, f.id['合计'])).toBe('3')

    // 作者化面的提交路径 (§12.12.9 的弹框最终也走这里)
    f.editor.setControlDefinition(f.id['合计'], { controlType: 'input', formula: '[SRC] * 3' })
    expect(laidOutText(f.editor, f.id['合计'])).toBe('6')

    // 删掉公式 → 退回占位符 (公式的**消失**同样是一次重排)
    f.editor.setControlDefinition(f.id['合计'], undefined)
    expect(laidOutText(f.editor, f.id['合计'])).toBe('[合计]')
  })

  it('元素改名 = 绑定键改名 → 公式重新解析 (键索引必须重建)', () => {
    const f = makeFixture([[{ ctrl: '源' }, { ctrl: '合计' }]], [
      { name: '源', key: 'SRC', value: 2, dataType: 'N' },
      { name: '合计', key: 'TOTAL', formula: '[SRC] + 1' },
    ])
    expect(laidOutText(f.editor, f.id['合计'])).toBe('3')

    // 把「源」的键从 SRC 改成 SRC2: element 住在节点上, 改它既不动结构版本
    // (pool.structureVersion) 也不动定义表版本 —— 键索引是第三个信号。
    const renamed: ElementMeta = {
      code: { internal: 'SRC2' }, name: '源', format: { dataType: 'N' },
    }
    f.editor.applyControlConfig(f.id['源'], renamed)

    // 旧键再也解析不出 → 整个公式不求值, 报"未找到引用", 显示退回占位符。
    // (键索引若没重建, 这里仍会显示 '3' —— 静默算错, 且看起来完全正常。)
    expect(laidOutText(f.editor, f.id['合计'])).toBe('[合计]')
    const errs = f.editor.getFormulaErrors()
    expect(errs.map((e) => [e.nodeId, e.error.code])).toEqual([
      [f.id['合计'], 'unresolved_reference'],
    ])

    // 反向: 公式改成新键 → 又算得出来
    f.editor.setControlDefinition(f.id['合计'], { controlType: 'input', formula: '[SRC2] * 5' })
    expect(laidOutText(f.editor, f.id['合计'])).toBe('10')
  })

  it('换文档不沿用上一份文档的键索引 (计数器会撞号, 判据必须是身份)', () => {
    const a = makeFixture([[{ ctrl: '源' }, { ctrl: '合计' }]], [
      { name: '源', key: 'SRC', value: 2, dataType: 'N' },
      { name: '合计', key: 'TOTAL', formula: '[SRC] + 1' },
    ])
    expect(laidOutText(a.editor, a.id['合计'])).toBe('3')

    // 第二份文档刻意把两个计数器都撞成一样的值: 结构版本同为 0 (双方都没跑过
    // 结构命令), 定义表版本同为 1 (各有一条公式)。于是"只比数字"的判据会认为
    // 什么都没变, 而键索引其实指向**上一份文档的节点 id** —— 那个 id 在新池里
    // 不存在, 值读成"没填"。这里断言的是新文档自己的源值 (5) 算出的 6。
    const b = buildDoc([[{ ctrl: '源B' }, { ctrl: '合计B' }]], [
      { name: '源B', key: 'SRC', value: 5, dataType: 'N' },
      { name: '合计B', key: 'TOTAL', formula: '[SRC] + 1' },
    ])
    expect(b.doc.id).not.toBe(a.doc.id)
    a.editor.setDocument(b.doc, undefined, { templateDefinitions: b.defs })

    expect(laidOutText(a.editor, b.id['合计B'])).toBe('6')
  })
})

// ================================================================
// 可见性 SHOW / HIDE (§12.12.5)
// ================================================================

describe('可见性 SHOW / HIDE (§12.12.5)', () => {
  /** 触发式公式住在**另一个**控件上, 指向要藏的那个键 (参考实现的写法) */
  const HIDE_WHEN_MALE = '[SW] == 1 ? HIDE([OBST]) : SHOW([OBST])'

  it('HIDE 的控件不产出 SLIFItem, 段内其余文字照旧', () => {
    const f = makeFixture([['性别：', { ctrl: '开关' }, ' 孕产史：', { ctrl: '孕产史' }]], [
      { name: '开关', key: 'SW', value: 1, dataType: 'N', formula: HIDE_WHEN_MALE },
      { name: '孕产史', key: 'OBST', value: '无' },
    ])

    // 隐藏 = **根本没有这一项** (于是自然不可命中、光标也进不去), 不是画成透明
    expect(laidOutText(f.editor, f.id['孕产史'])).toBeUndefined()
    expect(f.editor.isControlVisible(f.id['孕产史'])).toBe(false)
    // 触发器自己照常显示 (指令式公式不产出显示值)
    expect(laidOutText(f.editor, f.id['开关'])).toBe('1')
  })

  it('开关一翻 → 控件回到布局里 (可见性是依赖驱动的重算, 不是一次性的)', () => {
    const f = makeFixture([['性别：', { ctrl: '开关' }, ' 孕产史：', { ctrl: '孕产史' }]], [
      { name: '开关', key: 'SW', value: 1, dataType: 'N', formula: HIDE_WHEN_MALE },
      { name: '孕产史', key: 'OBST', value: '无' },
    ])
    expect(laidOutText(f.editor, f.id['孕产史'])).toBeUndefined()

    expect(f.editor.setControlValue(f.id['开关'], 2).ok).toBe(true)
    expect(laidOutText(f.editor, f.id['孕产史'])).toBe('无')
    expect(f.editor.isControlVisible(f.id['孕产史'])).toBe(true)
  })

  it('已知边界 (契约 §12.12.5 登记的): 隐藏控件没有 SLIFItem, 却仍占 1 个字符偏移', () => {
    // 段落 = 文本'前' + 隐藏控件 + 文本'后'。三个孩子, 逻辑长度 3 (非文本孩子
    // 一律计 1, SelectionCollector.paragraphTextLength), 而排出来的项只有两项。
    // **这就是那段契约要求必须有用例的原因**: 点选/命中的 x 坐标是按**排出来的项**
    // 折算偏移的 (computeOffsetInItems), 而键盘/选区按**逻辑长度**算 —— 跨过隐藏
    // 控件时两个口径差一个单位。
    const f = makeFixture([['前', { ctrl: '开关' }, { ctrl: '孕产史' }, '后']], [
      { name: '开关', key: 'SW', value: 1, dataType: 'N', formula: HIDE_WHEN_MALE },
      { name: '孕产史', key: 'OBST', value: '无' },
    ])
    const paraId = f.paras[0]
    const para = f.editor.getPool().nodes.get(paraId) as Paragraph
    expect(para.type).toBe(NodeType.PARAGRAPH)

    expect(paragraphTextLength(f.editor.getPool(), paraId)).toBe(4)

    const page = firstPage(f.editor)
    const tail = getFlatPageItems(page).find((i) => i.text === '后')
    expect(tail).toBeDefined()
    expect(getFlatPageItems(page).some((i) => i.nodeId === f.id['孕产史'])).toBe(false)

    // 点在'后'的右端 → 命中路径给出的偏移 = 3 (只数排出来的三段可见内容),
    // 而段落的逻辑末尾是 4: 用户看到自己点在最后, 拿到的偏移却落在**隐藏控件与
    // '后'之间** —— 在这里打字会插到'后'前面。两个口径今天就是不一致的。
    const offset = f.editor.computeOffsetAtX(
      para, (tail!.x + (tail!.width ?? 0)) + 1, tail!.y + 1, page,
    )
    expect(offset).toBe(3)

    // 若哪天要修这条边界 (隐藏控件计 0, 或给它排一个零宽项), 上面这几条断言会
    // 一起变红 —— 那正是需要有人来做决定的地方, 而不是让它悄悄漂移。
  })
})

// ================================================================
// 与 §12.11 完整性闸门的边界
// ================================================================

describe('计算值不算"已填" (§12.11 闸门看不见它)', () => {
  it('必填控件算得出值, 但 value 为空 → validateRequired 仍报它缺', () => {
    const f = makeFixture([[{ ctrl: '源' }, { ctrl: '合计' }]], [
      { name: '源', key: 'SRC', value: 2, dataType: 'N' },
      { name: '合计', key: 'TOTAL', formula: '[SRC] + 1', dataType: 'N', required: true },
    ])

    // 屏幕上有值 …
    expect(laidOutText(f.editor, f.id['合计'])).toBe('3')
    // … 闸门仍然说它没填。理由见 §12.12.1 第 3 条: 医生没看过的字段凭"引擎算出来
    // 的值"通过闸门, 与被静默填一半是同一种事故。
    const r = f.editor.validateRequired()
    expect(r.ok).toBe(false)
    expect(r.missing.map((m) => m.nodeId)).toContain(f.id['合计'])

    // 医生自己填了 → 才不再报缺。注意此时**显示**仍是算出来的 3 —— 显示归公式
    // (派生值优先, §12.12.8), 而闸门看的是医生自己写下的 value。两件事各有其主:
    // 派生值永不落盘 (§12.12.1), 所以闸门不可能被它骗过; 反之医生写下的那个值
    // 也不因为"算得出来"就免于校验。
    expect(f.editor.setControlValue(f.id['合计'], 99).ok).toBe(true)
    expect(f.editor.validateRequired().missing.map((m) => m.nodeId)).not.toContain(f.id['合计'])
    expect(laidOutText(f.editor, f.id['合计'])).toBe('3')
  })
})
