// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// BoundValues — 批量数据绑定 + 完整性闸门 (契约 §12.10 / §12.11)
//
// 真实 Editor + createDomEditorHost 驱动 (不 mock 命令与校验):
//   读方向 (顺序/未填不过滤/重复键点名) → 写方向 (单撤销单元/歧义不挑赢家/
//   部分成功可判定/无强制转换) → 完整性闸门 (只判定不拦截, 且不产生命令)。
//
// 三条最容易在后续重构里悄悄破掉的事实被钉成会红的断言:
//   1. 读顺序与导出件 collectFields 的 order **逐条一致** (跨区域连续) ——
//      两边都取自 §31 的顺序原语, 不是"碰巧一样";
//   2. 一键多节点**一个都不写** (临床安全: 静默填一个 = 半空的病历);
//   3. 通用控件的合成码撞键是**常态**而非罕见分支 (§2.2.1 记录的副作用)。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createSmartTextNode,
} from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import { DictionaryStore } from '../document/control/Dictionary'
import { collectFields } from '../../lib/export/fields'
import type {
  BaseNode, ControlValue, DocumentTree, ElementMeta, ElementFormat, SmartTextNode,
} from '../document/core/DocumentModel'

// ---- 夹具 ----

/** 一个控件的声明式描述 (元素 + 可选占位符/初值) */
interface ControlSpec {
  element: ElementMeta
  text?: string
  value?: ControlValue
}

/** 区域 = 段落数组; 段落 = 控件数组 (同段落多个控件 = 同键撞车的场地) */
type RegionSpec = ControlSpec[][]

interface Spec {
  body?: RegionSpec
  header?: RegionSpec
  footer?: RegionSpec
}

interface Fixture {
  editor: Editor
  /** 按创建顺序 (正文 → 页眉 → 页脚, 段内按声明顺序) 的控件 nodeId */
  nodeIds: string[]
  /** 段落 id, 与传入的区域规格一一对应 */
  paraIds: { body: string[]; header: string[]; footer: string[] }
}

function makeEditor(
  spec: Spec,
  defs?: Array<[string, TemplateDefinition]>,
): Fixture {
  const doc = createDocument('绑定测试')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode

  const nodeIds: string[] = []
  const mkRegion = (paras: RegionSpec | undefined): string[] =>
    (paras ?? []).map((controls) => {
      const childIds = controls.map((c) => {
        const st = createSmartTextNode(c.text ?? `[${c.element.name}]`, c.element)
        if (c.value !== undefined) st.value = c.value
        nodes[st.id] = st as unknown as BaseNode
        nodeIds.push(st.id)
        return st.id
      })
      const p = createParagraph(childIds)
      nodes[p.id] = p as unknown as BaseNode
      return p.id
    })

  const paraIds = {
    body: mkRegion(spec.body),
    header: mkRegion(spec.header),
    footer: mkRegion(spec.footer),
  }
  doc.body.children = paraIds.body
  doc.header = paraIds.header
  doc.footer = paraIds.footer
  ;(doc as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes

  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)

  const editor = new Editor(host, doc)
  const store = new TemplateDefinitionStore()
  for (const [id, d] of defs ?? []) store.set(id, d)
  editor.setDocument(doc, undefined, { templateDefinitions: store })
  return { editor, nodeIds, paraIds }
}

function valueOf(editor: Editor, nodeId: string): unknown {
  return (editor.getPool().nodes.get(nodeId) as SmartTextNode | undefined)?.value
}

const S1 = (name: string, internal = 'CTL_INPUT', dataElement = 'DE1'): ElementMeta =>
  ({ code: { internal, dataElement }, name, format: { dataType: 'S1' } })

const ENUM = (
  name: string,
  options: { name: string; value: string }[],
  opts: { multiple?: boolean; internal?: string; dataElement?: string; dictionary?: string } = {},
): ElementMeta => ({
  code: { internal: opts.internal ?? 'CTL_SELECT', dataElement: opts.dataElement ?? 'DE_ENUM' },
  name,
  format: {
    dataType: 'S1',
    ...(opts.dictionary ? { dictionary: opts.dictionary } : {}),
    enums: { multiple: opts.multiple ?? false, data: options },
  },
})

const REQUIRED = (name: string, dataElement = 'DE_REQ'): ElementMeta =>
  ({ code: { internal: 'CTL_REQ', dataElement }, name, required: true, format: { dataType: 'S1' } })

/** 通用控件的合成码 (controlLibrary 里手插控件的真实取值, §2.2.1) */
const SYNTHETIC = (name: string): ElementMeta =>
  ({ code: { internal: 'CTL_INPUT', dataElement: 'DE99.99.001' }, name, format: { dataType: 'S1' } })

const EDITABLE: TemplateDefinition = { controlType: 'input', label: '字段：', editable: true }
const LOCKED: TemplateDefinition = { controlType: 'input', label: '字段：', editable: false }

afterEach(() => { document.body.innerHTML = '' })

// ================================================================
// 读方向 (契约 §12.10.2)
// ================================================================

describe('Editor.getBoundValues — 读方向', () => {
  it('顺序 = 正文 → 页眉 → 页脚, 区域内按段落顺序', () => {
    const { editor, paraIds } = makeEditor({
      body: [[{ element: S1('姓名', 'CTL_A', 'DE_A') }], [{ element: S1('年龄', 'CTL_B', 'DE_B') }]],
      header: [[{ element: S1('病案号', 'CTL_C', 'DE_C') }]],
      footer: [[{ element: S1('页码', 'CTL_D', 'DE_D') }]],
    })
    const items = editor.getBoundValues().items
    expect(items.map(i => i.key)).toEqual(['DE_A', 'DE_B', 'DE_C', 'DE_D'])
    expect(items.map(i => i.region)).toEqual(['body', 'body', 'header', 'footer'])
    // 段落归属是 §12.11 闸门跳转的依据, 必须与文档结构对得上
    expect(items[0].paragraphId).toBe(paraIds.body[0])
  })

  it('未填字段**不过滤** —— 「没填」是有意义的事实', () => {
    const { editor } = makeEditor({
      body: [[{ element: S1('姓名'), value: '张三' }, { element: S1('年龄', 'CTL_B', 'DE_B') }]],
    })
    const items = editor.getBoundValues().items
    expect(items).toHaveLength(2)
    expect(items[0].filled).toBe(true)
    expect(items[1].filled).toBe(false)
    expect(items[1].value).toBeUndefined()
    expect(items[1].display).toBe('[年龄]')
    expect(items[1].displaySource).toBe('placeholder')
  })

  it('同键多条**全部返回**, 并在 duplicates 里点名 (读方向不隐藏歧义)', () => {
    const { editor } = makeEditor({
      body: [[{ element: S1('出生日期', 'CTL_X', 'DE_BIRTH') }, { element: S1('出生日期', 'CTL_X', 'DE_BIRTH') }]],
    })
    const p = editor.getBoundValues()
    expect(p.items).toHaveLength(2)
    expect(p.duplicates).toHaveLength(1)
    expect(p.duplicates[0].key).toBe('DE_BIRTH')
    expect(p.duplicates[0].nodeIds).toHaveLength(2)
    expect(new Set(p.duplicates[0].nodeIds)).toEqual(new Set(p.items.map(i => i.nodeId)))
  })

  it('无身份的控件 (两键皆空) 键为空串, 照常返回并按空串参与重复判定', () => {
    const noIdentity = (name: string): ElementMeta =>
      ({ code: { internal: '', dataElement: '' }, name, format: { dataType: 'S1' } })
    const { editor } = makeEditor({
      body: [[{ element: noIdentity('甲') }, { element: noIdentity('乙') }]],
    })
    const p = editor.getBoundValues()
    expect(p.items.map(i => i.key)).toEqual(['', ''])
    expect(p.duplicates).toEqual([{ key: '', nodeIds: p.items.map(i => i.nodeId) }])
  })

  it('默认键 = dataElement, 空则回退 internal (与 single 守卫同口径, 不另立第三套)', () => {
    const internalOnly: ElementMeta =
      ({ code: { internal: 'CTL_INTERNAL', dataElement: '' }, name: '只用标识', format: { dataType: 'S1' } })
    const both: ElementMeta =
      ({ code: { internal: 'CTL_INTERNAL', dataElement: 'DE_WINS' }, name: '两个都有', format: { dataType: 'S1' } })
    const { editor } = makeEditor({ body: [[{ element: internalOnly }, { element: both }]] })
    expect(editor.getBoundValues().items.map(i => i.key)).toEqual(['CTL_INTERNAL', 'DE_WINS'])
  })

  it('keyOf 可注入: 换一把键, 撞车随之消失', () => {
    const byInternal = (el: ElementMeta | undefined): string | undefined => el?.code.internal
    const { editor } = makeEditor({
      body: [[
        { element: S1('甲', 'CTL_A', 'DE_SAME') },
        { element: S1('乙', 'CTL_B', 'DE_SAME') },
      ]],
    })
    expect(editor.getBoundValues().duplicates).toHaveLength(1)          // 默认键撞车
    const alt = editor.getBoundValues({ keyOf: byInternal })
    expect(alt.items.map(i => i.key)).toEqual(['CTL_A', 'CTL_B'])
    expect(alt.duplicates).toEqual([])
  })

  it('显示值: inline 枚举映射回候选 name, 机器码原样保留在 value', () => {
    const { editor } = makeEditor({
      body: [[{ element: ENUM('婚姻', [{ name: '已婚', value: 'Y' }, { name: '未婚', value: 'N' }]), value: 'N' }]],
    })
    const item = editor.getBoundValues().items[0]
    expect(item.value).toBe('N')
    expect(item.display).toBe('未婚')
    expect(item.displaySource).toBe('enum')
  })

  it('字典候选经注入的 DictionaryProvider 解析 (inline 缺席时)', () => {
    const dicts = new DictionaryStore()
    dicts.set('DICT_NATION', [{ name: '汉族', value: 'hz' }])
    const { editor } = makeEditor({
      body: [[{ element: ENUM('民族', [{ name: '汉族', value: 'hz' }], { dictionary: 'DICT_NATION' }), value: 'hz' }]],
    })
    editor.setDictionaries(dicts)
    const item = editor.getBoundValues().items[0]
    expect(item.enumOptions).toEqual([{ name: '汉族', value: 'hz' }])
    expect(item.display).toBe('汉族')
    expect(item.displaySource).toBe('enum')
  })

  it('值不在候选表里 → display 是机器码, displaySource=raw (差异可判定, 不猜)', () => {
    const { editor } = makeEditor({
      body: [[{ element: ENUM('婚姻', [{ name: '已婚', value: 'Y' }]), value: 'ZZZ' }]],
    })
    const item = editor.getBoundValues().items[0]
    expect(item.display).toBe('ZZZ')
    expect(item.displaySource).toBe('raw')
  })

  it('display 经由引擎唯一实现 —— 与导出件 collectFields 逐字相同', () => {
    const dicts = new DictionaryStore()
    dicts.set('DICT_NATION', [{ name: '汉族', value: 'hz' }])
    const { editor } = makeEditor({
      body: [[
        { element: ENUM('婚姻', [{ name: '已婚', value: 'Y' }]), value: 'Y' },
        { element: ENUM('民族', [{ name: '汉族', value: 'hz' }], { dictionary: 'DICT_NATION', dataElement: 'DE_NAT' }), value: 'hz' },
        { element: S1('姓名', 'CTL_N', 'DE_NAME'), value: '张三' },
      ]],
    })
    editor.setDictionaries(dicts)
    const bound = editor.getBoundValues().items
    const exported = collectFields({
      doc: editor.getDocument(), pool: editor.getPool(), optionsOf: (id: string) => dicts.resolve(
        (editor.getPool().nodes.get(id) as SmartTextNode | undefined)?.element?.format?.dictionary ?? '',
      ),
    }).fields
    // 自证非空: 两边同时为空也会"相等", 那不是通过而是哑火
    expect(bound).toHaveLength(3)
    expect(exported).toHaveLength(3)
    expect(exported.map(f => f.display)).toEqual(bound.map(i => i.display))
    expect(exported.map(f => f.displaySource)).toEqual(bound.map(i => i.displaySource))
  })
})

// ================================================================
// 读顺序 = 导出顺序 (§2.4.3 对拍, 跨区域连续)
// ================================================================

describe('读顺序与导出件的 order 逐条一致 (跨区域连续)', () => {
  it('正文 (含表格) / 页眉 / 页脚混排, 两份投影 nodeId 序列相同', () => {
    const { editor } = makeEditor({
      body: [
        [{ element: S1('姓名', 'CTL_A', 'DE_A') }],
        [{ element: ENUM('婚姻', [{ name: '已婚', value: 'Y' }]), value: 'Y' }],
      ],
      header: [[{ element: S1('病案号', 'CTL_C', 'DE_C') }]],
      footer: [[{ element: REQUIRED('签名') }]],
    })
    const bound = editor.getBoundValues().items.map(i => i.nodeId)
    const exported = collectFields({ doc: editor.getDocument(), pool: editor.getPool() })
      .fields.slice().sort((a, b) => a.order - b.order).map(f => f.nodeId)
    expect(bound).toEqual(exported)
    expect(bound).toHaveLength(4)
  })
})

// ================================================================
// 写方向 (契约 §12.10.2 / §12.10.3)
// ================================================================

describe('Editor.setBoundValues — 写方向', () => {
  it('整批是**一个**撤销单元: undo 一次全部还原', () => {
    const { editor, nodeIds } = makeEditor({
      body: [[{ element: S1('姓名', 'CTL_A', 'DE_A') }, { element: S1('年龄', 'CTL_B', 'DE_B') }]],
    })
    const r = editor.setBoundValues({ DE_A: '张三', DE_B: '42' })
    expect(r.applied.map(a => a.key)).toEqual(['DE_A', 'DE_B'])
    expect(valueOf(editor, nodeIds[0])).toBe('张三')
    expect(valueOf(editor, nodeIds[1])).toBe('42')

    editor.undo()
    expect(valueOf(editor, nodeIds[0])).toBeUndefined()
    expect(valueOf(editor, nodeIds[1])).toBeUndefined()
    expect(editor.canUndo()).toBe(false)
  })

  it('redo 把整批重新写回 (撤销单元是完整的一步)', () => {
    const { editor, nodeIds } = makeEditor({
      body: [[{ element: S1('姓名', 'CTL_A', 'DE_A') }, { element: S1('年龄', 'CTL_B', 'DE_B') }]],
    })
    editor.setBoundValues({ DE_A: '张三', DE_B: '42' })
    editor.undo()
    editor.redo()
    expect(valueOf(editor, nodeIds[0])).toBe('张三')
    expect(valueOf(editor, nodeIds[1])).toBe('42')
  })

  it('一个键都没匹配上 → 不产生撤销条目', () => {
    const { editor } = makeEditor({ body: [[{ element: S1('姓名', 'CTL_A', 'DE_A') }]] })
    expect(editor.canUndo()).toBe(false)
    const r = editor.setBoundValues({ DE_NOPE: 'x' })
    expect(r.unmatched).toEqual(['DE_NOPE'])
    expect(r.applied).toEqual([])
    expect(editor.canUndo()).toBe(false)
  })

  it('所有键都歧义 → 同样不产生撤销条目', () => {
    const { editor } = makeEditor({
      body: [[{ element: S1('甲', 'CTL_A', 'DE_SAME') }, { element: S1('乙', 'CTL_B', 'DE_SAME') }]],
    })
    const r = editor.setBoundValues({ DE_SAME: 'x' })
    expect(r.ambiguous[0].key).toBe('DE_SAME')
    expect(r.applied).toEqual([])
    expect(editor.canUndo()).toBe(false)
  })

  it('**一键多节点 → 一个都不写**, 并附候选 nodeId (绝不挑赢家)', () => {
    const { editor, nodeIds } = makeEditor({
      body: [[{ element: S1('出生日期', 'CTL_X', 'DE_BIRTH') }, { element: S1('出生日期', 'CTL_X', 'DE_BIRTH') }]],
    })
    const r = editor.setBoundValues({ DE_BIRTH: '1990-01-01' })
    expect(r.applied).toEqual([])
    expect(r.ambiguous).toHaveLength(1)
    expect(r.ambiguous[0].key).toBe('DE_BIRTH')
    expect(new Set(r.ambiguous[0].candidateNodeIds)).toEqual(new Set(nodeIds))
    // 关键: 两个都没被写
    expect(valueOf(editor, nodeIds[0])).toBeUndefined()
    expect(valueOf(editor, nodeIds[1])).toBeUndefined()
  })

  it('**合成码撞键是常态**: 手插两个通用控件 (DE99.99.001 ×2) 必然歧义', () => {
    const { editor, nodeIds } = makeEditor({
      body: [[{ element: SYNTHETIC('单行文本') }, { element: SYNTHETIC('单行文本') }]],
    })
    expect(editor.getBoundValues().duplicates.map(d => d.key)).toEqual(['DE99.99.001'])
    const r = editor.setBoundValues({ 'DE99.99.001': '手填值' })
    expect(r.ambiguous[0].candidateNodeIds).toHaveLength(2)
    expect(valueOf(editor, nodeIds[0])).toBeUndefined()
    expect(valueOf(editor, nodeIds[1])).toBeUndefined()
  })

  it('歧义键不写、可定键照写 (部分成功是合法结果)', () => {
    const { editor, nodeIds } = makeEditor({
      body: [
        [{ element: S1('甲', 'CTL_A', 'DE_DUP') }, { element: S1('乙', 'CTL_B', 'DE_DUP') }],
        [{ element: S1('姓名', 'CTL_N', 'DE_NAME') }],
      ],
    })
    const r = editor.setBoundValues({ DE_DUP: 'x', DE_NAME: '张三' })
    expect(r.ambiguous.map(a => a.key)).toEqual(['DE_DUP'])
    expect(r.applied.map(a => a.key)).toEqual(['DE_NAME'])
    expect(valueOf(editor, nodeIds[2])).toBe('张三')
  })

  it('非法值携带理由被拒, **其余条目照写** (非静默失败)', () => {
    const { editor, nodeIds } = makeEditor({
      body: [[
        { element: ENUM('婚姻', [{ name: '已婚', value: 'Y' }]), value: undefined },
        { element: S1('姓名', 'CTL_N', 'DE_NAME') },
      ]],
    })
    const r = editor.setBoundValues({ DE_ENUM: 'NOT_A_CODE', DE_NAME: '张三' })
    expect(r.rejected).toEqual([{ key: 'DE_ENUM', reason: 'enum_value_not_allowed' }])
    expect(r.applied.map(a => a.key)).toEqual(['DE_NAME'])
    expect(valueOf(editor, nodeIds[0])).toBeUndefined()
    expect(valueOf(editor, nodeIds[1])).toBe('张三')
  })

  it('**不做医疗语义映射**: HIS 传 sex="1" 而候选是 ["M","F"] → 报错而不是猜', () => {
    const { editor, nodeIds } = makeEditor({
      body: [[{ element: ENUM('性别', [{ name: '男', value: 'M' }, { name: '女', value: 'F' }], { dataElement: 'DE_SEX' }) }]],
    })
    const r = editor.setBoundValues({ DE_SEX: '1' })
    expect(r.rejected).toEqual([{ key: 'DE_SEX', reason: 'enum_value_not_allowed' }])
    expect(r.applied).toEqual([])
    expect(valueOf(editor, nodeIds[0])).toBeUndefined()
  })

  it('写锁控件 (editable:false) → write_locked, 不接受任何写入', () => {
    const { editor, nodeIds } = makeEditor(
      { body: [[{ element: S1('姓名', 'CTL_A', 'DE_A'), value: '原值' }]] },
    )
    const lockedId = nodeIds[0]
    editor.setControlDefinition(lockedId, LOCKED)
    const r = editor.setBoundValues({ DE_A: '新值' })
    expect(r.rejected).toEqual([{ key: 'DE_A', reason: 'write_locked' }])
    expect(valueOf(editor, lockedId)).toBe('原值')
  })

  it('多选值按候选声明顺序归一 (VR-12 不因批量而失守)', () => {
    const { editor, nodeIds } = makeEditor({
      body: [[{
        element: ENUM('过敏史', [
          { name: '青霉素', value: 'pcn' }, { name: '磺胺', value: 'sulfa' },
        ], { multiple: true, dataElement: 'DE_ALLERGY' }),
      }]],
    })
    const r = editor.setBoundValues({ DE_ALLERGY: ['sulfa', 'pcn'] })
    expect(valueOf(editor, nodeIds[0])).toEqual(['pcn', 'sulfa'])
    expect(r.applied[0].value).toEqual(['pcn', 'sulfa'])
  })

  it('清空 (undefined) 经同一道边界, 且撤销能还原原值', () => {
    const { editor, nodeIds } = makeEditor(
      { body: [[{ element: S1('姓名', 'CTL_A', 'DE_A'), value: '原值' }]] },
    )
    const id = nodeIds[0]
    editor.setControlDefinition(id, EDITABLE)
    const r = editor.setBoundValues({ DE_A: undefined })
    expect(r.applied.map(a => a.key)).toEqual(['DE_A'])
    expect(valueOf(editor, id)).toBeUndefined()
    editor.undo()
    expect(valueOf(editor, id)).toBe('原值')
  })

  it('空对象 → 什么都不做, 也不入栈', () => {
    const { editor } = makeEditor({ body: [[{ element: S1('姓名', 'CTL_A', 'DE_A') }]] })
    const r = editor.setBoundValues({})
    expect(r).toEqual({ applied: [], rejected: [], ambiguous: [], unmatched: [] })
    expect(editor.canUndo()).toBe(false)
  })

  it('**全部条目都被拒 → 同样不产生撤销条目** (与"空批不入栈"同一条守卫)', () => {
    const { editor, nodeIds } = makeEditor({
      body: [[{ element: ENUM('婚姻', [{ name: '已婚', value: 'Y' }]), value: undefined }]],
    })
    expect(editor.canUndo()).toBe(false)
    const r = editor.setBoundValues({ DE_ENUM: 'NOT_A_CODE' })
    expect(r.rejected).toHaveLength(1)
    expect(r.applied).toEqual([])
    // 命令确实跑了 (拿到理由), 但一次成功的写都没有 → 不该留一步空撤销
    expect(editor.canUndo()).toBe(false)
    expect(valueOf(editor, nodeIds[0])).toBeUndefined()
  })

  it('空键**不可寻址**: 无身份的控件不能被 "" 写中 (读方向照常返回它)', () => {
    const noIdentity = (name: string): ElementMeta =>
      ({ code: { internal: '', dataElement: '' }, name, format: { dataType: 'S1' } })
    const { editor, nodeIds } = makeEditor({ body: [[{ element: noIdentity('匿名') }]] })

    // 读方向: 照常返回, 键是空串 —— "没有身份"本身是有用的事实
    expect(editor.getBoundValues().items.map(i => i.key)).toEqual([''])

    // 写方向: 空串不是"所有匿名控件的共用地址"
    const r = editor.setBoundValues({ '': '张三' })
    expect(r.unmatched).toEqual([''])
    expect(r.applied).toEqual([])
    expect(valueOf(editor, nodeIds[0])).toBeUndefined()
    expect(editor.canUndo()).toBe(false)
  })
})

// ================================================================
// 完整性闸门 (契约 §12.11)
// ================================================================

describe('Editor.validateRequired — 完整性闸门', () => {
  it('required 且空 → 报缺, 带 nodeId + paragraphPath (供宿主跳转)', () => {
    const { editor, nodeIds, paraIds } = makeEditor({
      body: [[{ element: REQUIRED('主诉') }]],
    })
    const r = editor.validateRequired()
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual([{
      nodeId: nodeIds[0],
      paragraphPath: [editor.getDocument().id, paraIds.body[0]],
      name: '主诉',
    }])
  })

  it('required 已填 → ok; 非 required 空 → 不报', () => {
    const { editor } = makeEditor({
      body: [[
        { element: REQUIRED('主诉'), value: '头痛三天' },
        { element: S1('备注', 'CTL_N', 'DE_NOTE') },
      ]],
    })
    expect(editor.validateRequired()).toEqual({ ok: true, missing: [] })
  })

  it('跨区域: 页眉/页脚里的必填未填也报, 顺序继承阅读顺序', () => {
    const { editor, nodeIds } = makeEditor({
      body: [[{ element: S1('姓名', 'CTL_A', 'DE_A') }]],
      header: [[{ element: REQUIRED('病案号', 'DE_MRN') }]],
      footer: [[{ element: REQUIRED('签名', 'DE_SIGN'), value: '张三' }]],
    })
    const r = editor.validateRequired()
    expect(r.missing.map(m => m.name)).toEqual(['病案号'])
    expect(r.missing[0].nodeId).toBe(nodeIds[1])
  })

  it('**只判定不拦截**: 不产生命令、不入 undo 栈、不改文档', () => {
    const { editor } = makeEditor({ body: [[{ element: REQUIRED('主诉') }]] })
    expect(editor.canUndo()).toBe(false)
    editor.validateRequired()
    expect(editor.canUndo()).toBe(false)
  })

  it('与合规分是**两个事实**: 只缺必填不等于有合规分, 闸门不依赖 runQC', () => {
    const { editor } = makeEditor({ body: [[{ element: REQUIRED('主诉') }]] })
    const r = editor.validateRequired()
    // 结果里不得出现分数/等级字段 (契约 §12.11 明文禁止合并)
    expect(Object.keys(r).sort()).toEqual(['missing', 'ok'])
    expect(Object.keys(r.missing[0]).sort()).toEqual(['name', 'nodeId', 'paragraphPath'])
  })
})

// ================================================================
// 与既有单点 API 的关系 (VR-3 / §12.6 边界不因批量而变)
// ================================================================

describe('批量 API 是单点边界的**新调用方**, 不是第二道边界', () => {
  it('批量写入后 getControlValue 读到的是一模一样的规范值', () => {
    const { editor, nodeIds } = makeEditor({
      body: [[{ element: S1('姓名', 'CTL_A', 'DE_A') }]],
    })
    editor.setBoundValues({ DE_A: '张三' })
    expect(editor.getControlValue(nodeIds[0])).toBe('张三')
  })

  it('单点 setControlValue 的拒绝理由与批量一致 (同一道校验)', () => {
    const el = ENUM('婚姻', [{ name: '已婚', value: 'Y' }])
    const { editor, nodeIds } = makeEditor({ body: [[{ element: el }]] })
    const single = editor.setControlValue(nodeIds[0], 'ZZZ')
    const batch = editor.setBoundValues({ DE_ENUM: 'ZZZ' })
    expect(single).toEqual({ ok: false, reason: 'enum_value_not_allowed' })
    expect(batch.rejected[0].reason).toBe('enum_value_not_allowed')
  })
})
