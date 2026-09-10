// ================================================================
// RuntimeControlSmoke — 运行时控件端到端冒烟测试 (契约 §12.6)
//
// 通过「真实 Editor」驱动完整链路 (不 mock Command/校验/序列化):
//   插入(工厂同源) → 快照 → 运行时写入 → 规范值 → 校验拒绝 →
//   undo/redo → 序列化 → 重新加载往返。
//
// 覆盖 7 种控件 (input/textarea/number/select/radio/checkbox/date)
// 与 6 类校验拒绝 (write_locked / type_mismatch / enum_value_not_allowed /
// number_scale_exceeded / string_length_out_of_range / date_format_invalid)。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import { loadDocumentFromObject } from '../document/io/DocumentLoader'
import {
  createDocument, createParagraph, createSmartTextNode, createTextNode,
} from '../document/factory/ElementFormatter'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import type { TemplateDefinition } from '../template/TemplateDefinition'
import type { BaseNode, DocumentTree, ElementMeta, ControlValue, SmartTextNode } from '../document/core/DocumentModel'

// ---- 7 种控件用例: 语义 element + 设计期 def + 合法值 + (可选) 非法值 ----
interface Case {
  key: string
  element: ElementMeta
  def: TemplateDefinition
  legal: ControlValue
  /** 期望的规范值 (checkbox 归一为枚举声明顺序; 其余与 legal 相同) */
  canonical: ControlValue
  illegal?: { value: unknown; reason: string }
}

const CASES: Case[] = [
  {
    key: 'input',
    element: { code: { internal: 'CTL_INPUT', dataElement: 'DE99.99.001' }, name: '文本输入', format: { dataType: 'S1' } },
    def: { controlType: 'input', label: '文本输入：', editable: true },
    legal: '张三', canonical: '张三',
  },
  {
    key: 'textarea',
    element: { code: { internal: 'CTL_TEXTAREA', dataElement: 'DE99.99.002' }, name: '文本域', format: { dataType: 'S2' } },
    def: { controlType: 'textarea', label: '文本域：', editable: true },
    legal: '主诉：咳嗽三日', canonical: '主诉：咳嗽三日',
  },
  {
    key: 'number',
    element: { code: { internal: 'CTL_NUMBER', dataElement: 'DE99.99.003' }, name: '数字输入', format: { dataType: 'N', showType: 'N', scale: 1 } },
    def: { controlType: 'number', label: '数字输入：', editable: true },
    legal: 42, canonical: 42,
    illegal: { value: '42', reason: 'type_mismatch' },
  },
  {
    key: 'select',
    element: {
      code: { internal: 'CTL_SELECT', dataElement: 'DE99.99.004' }, name: '下拉选择',
      format: { dataType: 'S1', enums: { data: [{ name: '轻度', value: 'mild' }, { name: '中度', value: 'moderate' }, { name: '重度', value: 'severe' }] } },
    },
    def: { controlType: 'select', label: '下拉选择：', editable: true },
    legal: 'mild', canonical: 'mild',
    illegal: { value: 'xx', reason: 'enum_value_not_allowed' },
  },
  {
    key: 'radio',
    element: {
      code: { internal: 'CTL_RADIO', dataElement: 'DE99.99.007' }, name: '单选框',
      format: { dataType: 'S1', enums: { data: [{ name: '是', value: 'Y' }, { name: '否', value: 'N' }] } },
    },
    def: { controlType: 'radio', label: '单选框：', editable: true },
    legal: 'Y', canonical: 'Y',
  },
  {
    key: 'checkbox',
    element: {
      code: { internal: 'CTL_CHECKBOX', dataElement: 'DE99.99.006' }, name: '复选框',
      format: { dataType: 'S1', enums: { multiple: true, data: [{ name: '发热', value: 'fever' }, { name: '咳嗽', value: 'cough' }, { name: '乏力', value: 'fatigue' }] } },
    },
    def: { controlType: 'checkbox', label: '复选框：', editable: true },
    legal: ['cough', 'fever'], canonical: ['fever', 'cough'], // VR-12: 按枚举声明顺序归一
    illegal: { value: ['xx'], reason: 'enum_value_not_allowed' }, // 越界成员 (数组形态正确)
  },
  {
    key: 'date',
    element: { code: { internal: 'CTL_DATE', dataElement: 'DE99.99.005' }, name: '日期选择', format: { dataType: 'D' } },
    def: { controlType: 'date', label: '日期选择：', editable: true },
    legal: '2026-09-08', canonical: '2026-09-08',
    illegal: { value: '2026/09/08', reason: 'date_format_invalid' },
  },
]

describe('运行时控件端到端冒烟 (契约 §12.6)', () => {
  const cleanups: Array<() => void> = []

  /** 构造真实 Editor: 一个段落内含全部 7 个 smarttext + 各自 TemplateDefinition */
  function makeEditor(cases: Case[]): { editor: Editor; idOf: (key: string) => string } {
    const doc = createDocument('smoke')
    const defs = new TemplateDefinitionStore()
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)

    const idByKey = new Map<string, string>()
    const children: string[] = []
    for (const c of cases) {
      const st = createSmartTextNode(`[${c.element.name}]`, c.element)
      idByKey.set(c.key, st.id)
      children.push(st.id)
      allNodes.set(st.id, st as unknown as BaseNode)
      defs.set(st.id, c.def)
    }
    const para = createParagraph(children)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]

    // Editor 构造走 loadDocumentFromObject → validate 校验引用不悬空,
    // 需把节点内嵌到 doc.nodes (与 serializeDocument 产物同构)。
    const nodes: Record<string, BaseNode> = {}
    for (const [id, n] of allNodes) nodes[id] = n
    ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes

    const host: DomEditorHost = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container)
    host.input.mount(container)
    const editor = new Editor(host, doc)
    // 构造器只经 loadDocumentFromObject 重建 pool, 不回填 templateDefinitions;
    // 通过公共 setDocument 注入 per-editor 定义 store (与真实加载路径同源)。
    editor.setDocument(doc, undefined, { templateDefinitions: defs })
    cleanups.push(() => { editor.destroy(); container.remove() })
    return { editor, idOf: (key: string) => idByKey.get(key)! }
  }

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()!()
  })

  it('快照: 7 控件 controlType/dataType/options/writable/placeholder 正确', () => {
    const { editor, idOf } = makeEditor(CASES)
    for (const c of CASES) {
      const snap = editor.getControlSnapshot(idOf(c.key))!
      expect(snap, c.key).not.toBeNull()
      expect(snap.controlType, `${c.key} controlType`).toBe(c.def.controlType)
      expect(snap.dataType, `${c.key} dataType`).toBe(c.element.format?.dataType)
      expect(snap.writable, `${c.key} writable`).toBe(true)
      expect(snap.placeholder, `${c.key} placeholder`).toBe(`[${c.element.name}]`)
      // 枚举控件暴露候选
      if (c.element.format?.enums) {
        expect(snap.options?.map((o) => o.value)).toEqual(c.element.format.enums.data?.map((o) => o.value))
      }
      expect(snap.value, `${c.key} 初始值为空`).toBeUndefined()
    }
  })

  it('7 控件合法写入 → 规范值落 DocumentModel.value', () => {
    const { editor, idOf } = makeEditor(CASES)
    for (const c of CASES) {
      const r = editor.setControlValue(idOf(c.key), c.legal)
      expect(r.ok, `${c.key} 写入应成功: ${JSON.stringify(r)}`).toBe(true)
      expect(editor.getControlValue(idOf(c.key))).toEqual(c.canonical)
    }
  })

  it('number 0 是合法值 (不被 falsy 吞掉)', () => {
    const { editor, idOf } = makeEditor(CASES)
    const r = editor.setControlValue(idOf('number'), 0)
    expect(r.ok).toBe(true)
    expect(editor.getControlValue(idOf('number'))).toBe(0)
  })

  it('清空 (undefined) → value 归空, 不报错', () => {
    const { editor, idOf } = makeEditor(CASES)
    editor.setControlValue(idOf('input'), '张三')
    expect(editor.getControlValue(idOf('input'))).toBe('张三')
    const r = editor.setControlValue(idOf('input'), undefined)
    expect(r.ok).toBe(true)
    expect(editor.getControlValue(idOf('input'))).toBeUndefined()
  })

  it('校验拒绝: 6 类非法值均被命令边界拒绝, 值不变', () => {
    const { editor, idOf } = makeEditor(CASES)
    // 用例自带非法值 (type_mismatch / enum_value_not_allowed / date_format_invalid)
    for (const c of CASES.filter((x) => x.illegal)) {
      const r = editor.setControlValue(idOf(c.key), c.illegal!.value as ControlValue)
      expect(r.ok, `${c.key} 应被拒绝`).toBe(false)
      expect((r as { reason?: string }).reason).toBe(c.illegal!.reason)
      expect(editor.getControlValue(idOf(c.key))).toBeUndefined()
    }

    // number scale 超限 → 拒绝, 不四舍五入 (VR-10)
    const scaleR = editor.setControlValue(idOf('number'), 42.55)
    expect(scaleR.ok).toBe(false)
    expect((scaleR as { reason?: string }).reason).toBe('number_scale_exceeded')

    // 只读 (element.readonly) → 写锁拒绝 (VR-8)
    const roCases: Case[] = [{
      key: 'ro',
      element: { code: { internal: 'CTL_RO', dataElement: 'DE99.99.099' }, name: '只读', readonly: true, format: { dataType: 'S1' } },
      def: { controlType: 'input', editable: true } as TemplateDefinition,
      legal: 'x' as ControlValue, canonical: 'x' as ControlValue,
    }]
    const ro = makeEditor(roCases)
    const roSnap = ro.editor.getControlSnapshot(ro.idOf('ro'))!
    expect(roSnap.writable).toBe(false)
    const roR = ro.editor.setControlValue(ro.idOf('ro'), '改')
    expect(roR.ok).toBe(false)
    expect((roR as { reason?: string }).reason).toBe('write_locked')
  })

  it('string maxLength 越界 → 拒绝, 不截断 (VR-11)', () => {
    const cases: Case[] = [{
      key: 'limited',
      element: { code: { internal: 'CTL_LIMIT', dataElement: 'DE99.99.098' }, name: '限长', format: { dataType: 'S1', maxLength: 3 } },
      def: { controlType: 'input', editable: true } as TemplateDefinition,
      legal: 'abc' as ControlValue, canonical: 'abc' as ControlValue,
    }]
    const { editor, idOf } = makeEditor(cases)
    expect(editor.setControlValue(idOf('limited'), 'abc').ok).toBe(true)
    const r = editor.setControlValue(idOf('limited'), 'abcdef')
    expect(r.ok).toBe(false)
    expect((r as { reason?: string }).reason).toBe('string_length_out_of_range')
    expect(editor.getControlValue(idOf('limited'))).toBe('abc')
  })

  it('undo/redo: 值写入可撤销、可重做', () => {
    const { editor, idOf } = makeEditor(CASES)
    // 初始值 (undo 的旧值)
    editor.setControlValue(idOf('input'), '旧值')
    expect(editor.getControlValue(idOf('input'))).toBe('旧值')

    editor.setControlValue(idOf('input'), '新值')
    expect(editor.getControlValue(idOf('input'))).toBe('新值')
    expect(editor.canUndo()).toBe(true)

    editor.undo()
    expect(editor.getControlValue(idOf('input'))).toBe('旧值')
    expect(editor.canRedo()).toBe(true)

    editor.redo()
    expect(editor.getControlValue(idOf('input'))).toBe('新值')
  })

  it('激活/取消激活: activeControlId 瞬态正确', () => {
    const { editor, idOf } = makeEditor(CASES)
    expect(editor.getActiveControlId()).toBeNull()
    editor.activateControl(idOf('input'))
    expect(editor.getActiveControlId()).toBe(idOf('input'))
    editor.deactivateControl()
    expect(editor.getActiveControlId()).toBeNull()
  })

  it('序列化: value + definition 落盘, store 不混入 node payload', () => {
    const { editor, idOf } = makeEditor(CASES)
    editor.setControlValue(idOf('input'), '张三')
    editor.setControlValue(idOf('checkbox'), ['cough', 'fever'])

    const json = editor.getSerializedDocument()
    const parsed = JSON.parse(json)

    const inputId = idOf('input')
    const checkId = idOf('checkbox')
    // 值在 node payload
    expect(parsed.nodes[inputId].value).toBe('张三')
    expect(parsed.nodes[checkId].value).toEqual(['fever', 'cough'])
    // 定义在顶层 templateDefinitions
    expect(parsed.templateDefinitions[inputId].controlType).toBe('input')
    // store 字段绝不混入 node payload (契约 §12.1)
    expect(parsed.nodes[inputId].controlType).toBeUndefined()
    expect(parsed.nodes[inputId].editable).toBeUndefined()
  })

  it('序列化 → 重新加载往返: value/definition/controlType 无损', () => {
    const { editor, idOf } = makeEditor(CASES)
    editor.setControlValue(idOf('input'), '张三')
    editor.setControlValue(idOf('number'), 42)
    editor.setControlValue(idOf('date'), '2026-09-08')
    editor.setControlValue(idOf('checkbox'), ['cough', 'fever'])

    const loaded = loadDocumentFromObject(JSON.parse(editor.getSerializedDocument()))

    const nodeValue = (id: string): ControlValue | undefined =>
      (loaded.pool.nodes.get(id) as SmartTextNode | undefined)?.value

    expect(nodeValue(idOf('input'))).toBe('张三')
    expect(nodeValue(idOf('number'))).toBe(42)
    expect(nodeValue(idOf('date'))).toBe('2026-09-08')
    expect(nodeValue(idOf('checkbox'))).toEqual(['fever', 'cough'])

    // definition 往返无损
    expect(loaded.templateDefinitions?.get(idOf('input'))?.controlType).toBe('input')
    expect(loaded.templateDefinitions?.get(idOf('checkbox'))?.controlType).toBe('checkbox')
    // 语义层 dataType/enums 往返无损
    const selectNode = loaded.pool.nodes.get(idOf('select')) as SmartTextNode
    expect(selectNode.element.format?.dataType).toBe('S1')
    expect(selectNode.element.format?.enums?.data?.map((o) => o.value)).toEqual(['mild', 'moderate', 'severe'])
  })
})

describe('控件填表导航 (区域内顺序 + 相邻环绕)', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => { while (cleanups.length > 0) cleanups.pop()!() })
  // 复用同一 makeEditor 逻辑不方便跨 describe; 这里构造精简版 (单段多控件)
  function navEditor(els: Array<{ key: string; element: ElementMeta; def: TemplateDefinition; readonly?: boolean }>) {
    const doc = createDocument('nav')
    const defs = new TemplateDefinitionStore()
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const idByKey = new Map<string, string>()
    const children: string[] = []
    for (const c of els) {
      const st = createSmartTextNode(`[${c.element.name}]`, c.element)
      idByKey.set(c.key, st.id)
      children.push(st.id)
      allNodes.set(st.id, st as unknown as BaseNode)
      defs.set(st.id, c.def)
    }
    const para = createParagraph(children)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const nodes: Record<string, BaseNode> = {}
    for (const [id, n] of allNodes) nodes[id] = n
    ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes
    const host = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container); host.input.mount(container)
    const editor = new Editor(host, doc)
    editor.setDocument(doc, undefined, { templateDefinitions: defs })
    cleanups.push(() => { editor.destroy(); container.remove() })
    return { editor, idOf: (k: string) => idByKey.get(k)! }
  }
  const ai: ElementMeta = { code: { internal: 'C1', dataElement: 'D1' }, name: 'A', format: { dataType: 'S1' } }
  const def1: TemplateDefinition = { controlType: 'input', editable: true }
  const roEl: ElementMeta = { code: { internal: 'C2', dataElement: 'D2' }, name: 'B', readonly: true, format: { dataType: 'S1' } }

  it('getRegionControlIds 按文档顺序返回可填控件, 跳过只读', () => {
    const { editor, idOf } = navEditor([
      { key: 'a', element: ai, def: def1 },
      { key: 'ro', element: roEl, def: def1 },
      { key: 'b', element: { ...ai, code: { internal: 'C3', dataElement: 'D3' }, name: 'C' }, def: def1 },
    ])
    expect(editor.getRegionControlIds(idOf('a'))).toEqual([idOf('a'), idOf('b')])
  })

  it('getAdjacentControlId 区域内环绕', () => {
    const { editor, idOf } = navEditor([
      { key: 'a', element: ai, def: def1 },
      { key: 'b', element: { ...ai, code: { internal: 'C3', dataElement: 'D3' }, name: 'C' }, def: def1 },
    ])
    expect(editor.getAdjacentControlId(idOf('a'), 1)).toBe(idOf('b'))
    expect(editor.getAdjacentControlId(idOf('b'), 1)).toBe(idOf('a'))  // 环绕
    expect(editor.getAdjacentControlId(idOf('a'), -1)).toBe(idOf('b')) // 反向环绕
  })

  it('仅一个只读控件 → 无相邻可填控件 (null)', () => {
    const { editor, idOf } = navEditor([{ key: 'ro', element: roEl, def: def1 }])
    expect(editor.getRegionControlIds(idOf('ro'))).toEqual([])
    expect(editor.getAdjacentControlId(idOf('ro'), 1)).toBeNull()
  })
})

describe('Tab 跳转后上一控件值提交并反映到布局', () => {
  it('activate A → 填值 → activate B: A 值与布局文本均为该值', () => {
    const doc = createDocument('tab')
    const defs = new TemplateDefinitionStore()
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const mk = (name: string, internal: string, de: string) => {
      const el: ElementMeta = { code: { internal, dataElement: de }, name, format: { dataType: 'S1' } }
      const st = createSmartTextNode(`[${name}]`, el)
      all.set(st.id, st as unknown as BaseNode)
      defs.set(st.id, { controlType: 'input', editable: true })
      return st.id
    }
    const a = mk('甲', 'C1', 'D1'); const b = mk('乙', 'C2', 'D2')
    const para = createParagraph([a, b])
    all.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const nodes: Record<string, BaseNode> = {}
    for (const [id, n] of all) nodes[id] = n
    ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes
    const host = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container); host.input.mount(container)
    const editor = new Editor(host, doc)
    editor.setDocument(doc, undefined, { templateDefinitions: defs })

    editor.activateControl(a)
    expect(editor.setControlValue(a, '张三').ok).toBe(true)
    editor.activateControl(b) // 跳到下一个

    expect(editor.getControlValue(a)).toBe('张三')
    const item = editor.getDraw().getPages().flatMap(p => p.items).find(it => it.nodeId === a)
    expect(item?.text).toBe('张三')
    editor.destroy(); container.remove()
  })
})

describe('区域导航: 页眉控件不跳到正文', () => {
  it('页眉两控件 + 正文一控件 → 页眉内环绕, 不跨到正文', () => {
    const doc = createDocument('hf-nav')
    const defs = new TemplateDefinitionStore()
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const mk = (name: string, internal: string, de: string) => {
      const el: ElementMeta = { code: { internal, dataElement: de }, name, format: { dataType: 'S1' } }
      const st = createSmartTextNode(`[${name}]`, el)
      all.set(st.id, st as unknown as BaseNode)
      defs.set(st.id, { controlType: 'input', editable: true })
      return st.id
    }
    const h1 = mk('姓', 'H1', 'DH1'); const h2 = mk('名', 'H2', 'DH2'); const b1 = mk('正文', 'B1', 'DB1')
    const hp = createParagraph([h1, h2])
    const bp = createParagraph([b1])
    all.set(hp.id, hp as unknown as BaseNode)
    all.set(bp.id, bp as unknown as BaseNode)
    doc.header = [hp.id]
    doc.footer = []
    doc.body.children = [bp.id]
    const nodes: Record<string, BaseNode> = {}
    for (const [id, n] of all) nodes[id] = n
    ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes
    const host = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container); host.input.mount(container)
    const editor = new Editor(host, doc)
    editor.setDocument(doc, undefined, { templateDefinitions: defs })

    expect(editor.getRegionControlIds(h1)).toEqual([h1, h2])   // 仅页眉
    expect(editor.getAdjacentControlId(h1, 1)).toBe(h2)
    expect(editor.getAdjacentControlId(h2, 1)).toBe(h1)         // 页眉内环绕, 不跳 b1
    editor.destroy(); container.remove()
  })
})

describe('空文档惰性 templateDefinitions 同步到 Draw (select 不再回退 radio)', () => {
  it('insertControl(select) 后布局为 field 下拉宽 (非候选组 radio 宽)', () => {
    const doc = createDocument('fresh')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const tn = createTextNode('')
    const para = createParagraph([tn.id])
    all.set(tn.id, tn as unknown as BaseNode)
    all.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const nodes: Record<string, BaseNode> = {}
    for (const [id, n] of all) nodes[id] = n
    ;(doc as unknown as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes
    const host = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container); host.input.mount(container)
    const editor = new Editor(host, doc)  // templateDefinitions 为 null
    editor.setDocument(doc)
    editor.getStore().setCursor({ paragraphPath: [doc.id, para.id], offset: 0, visible: true })

    const el: ElementMeta = {
      code: { internal: 'SEL', dataElement: 'DE' }, name: '症状',
      format: { dataType: 'S1', enums: { data: [{ name: '发热', value: 'f' }, { name: '咳嗽', value: 'k' }] } },
    }
    editor.insertControl(el, { controlType: 'select', editable: true })

    const p = editor.getPool().nodes.get(para.id) as unknown as { children: readonly string[] }
    const cid = p.children.find(c => (editor.getPool().nodes.get(c) as { type?: string })?.type === 'smarttext')!
    const item = editor.getDraw().getPages().flatMap(pg => pg.items).find(it => it.nodeId === cid)
    expect(item).toBeTruthy()
    // select → field/brackets 预留宽 = '[症状]' + affordance, 远小于候选组总宽
    expect((item as { width: number }).width).toBeLessThan(80)
    expect(editor.getControlSnapshot(cid)?.controlType).toBe('select')
    editor.destroy(); container.remove()
  })
})
