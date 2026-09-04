// ============================================================
// TemplateImporter 单元测试 (契约 §12.2)
//
// 覆盖:
//   1. 四层路由边界: 语义 → ElementMeta, 运行时 → value,
//      模板设计期 → TemplateDefinitionStore, 表现层 →
//      PresentationStyleStore, 且 SmartTextNode 本身不携带
//      任何后两层字段 (无泄漏)。
//   2. 节点映射: paragraph / text / smarttext(带+无 element) /
//      checkfield / insert/delete / table(含 header/合并)。
//   3. 样式解析: styles.text → TextStyle (font/size/bold)。
//   4. 真实外部模板文件 smoke (文件存在时)。
// ============================================================

import { describe, it, expect, expectTypeOf } from 'vitest'
import { TemplateImporter, isExternalTemplate } from '../import/TemplateImporter'
import type { TemplateImportResult } from '../import/TemplateImporter'
import type { SmartTextNode, TextNode, Table } from '../document/core/DocumentModel'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../document/version/DocumentFormatVersion'

// 真实外部模板经 import.meta.glob(as:'raw') 构建期读入, 不引入 node:* 依赖
// (与 ContractCompliance.test.ts 同款做法)。
const publicJson = import.meta.glob('/public/2ba6fc00649211ed8c15bfca5bfbdae7*.json', {
  as: 'raw',
  eager: true,
}) as Record<string, string>
const REAL_TEMPLATE_KEY = Object.keys(publicJson).find((k) => k.includes('2ba6fc00649211ed8c15bfca5bfbdae7'))

// ---- 小型夹具 (覆盖全部节点类型) ----
const fixture = {
  _id: 'tpl_001',
  categoryId: 'test-template',
  properties: { version: '2.1.0', creator: '测试', createTime: '2023-03-27 16:15:30' },
  styles: {
    text: {
      'st-bold': { fontFamily: 'SimSun', fontSize: '10.5pt', fontWeight: 'bold' },
      'st-normal': { fontFamily: 'SimSun', fontSize: '9pt' },
    },
    paragraph: {},
    table: {},
  },
  globalStyles: [],
  layout: {
    margins: { left: 10, right: 10, top: 10, bottom: 10 },
    paper: { type: 'A4', orientation: 'portrait', width: '210mm', height: '297mm' },
  },
  document: {
    header: {
      id: 'root-header', type: '$root', children: [
        { id: 'para-h', type: 'paragraph', children: [
          { id: 'txt-h', type: 'text', data: '病历首页', style: { id: 'st-bold' } },
        ] },
      ],
    },
    footer: { id: 'root-footer', type: '$root', children: [] },
    body: {
      id: 'root-body', type: '$root', children: [
        {
          id: 'para-1', type: 'paragraph', children: [
            { id: 'txt-1', type: 'text', data: '姓名：', style: { id: 'st-normal' } },
            {
              id: 'st-1', type: 'smarttext', code: 'st-1', label: '姓名：',
              deletable: true, editable: true, tips: '患者姓名',
              borderStyle: 'solid', contentWrap: true, minWidth: '168',
              required: true, readonly: false, privacy: false,
              format: { dataType: 'S1', showType: 'AN', minLength: 2, maxLength: 10 },
              element: {
                id: 'el-1', type: 'element', name: '患者姓名',
                code: { internal: 'HDSD00.11.001', dataElement: 'DE02.01.001.00' },
                labels: [],
              },
              style: { id: 'st-normal' },
            },
          ],
        },
        {
          id: 'para-2', type: 'paragraph', children: [
            { id: 'cb-1', type: 'checkfield', prefix: '1.治愈', value: false, style: { id: 'st-normal' } },
            { id: 'ins-1', type: 'insert', author: '姜波', authorId: 'jiangbo', date: '2023-03-27 16:15:30' },
            { id: 'txt-2', type: 'text', data: '（已插入内容）', style: { id: 'st-normal' } },
          ],
        },
        {
          id: 'para-3', type: 'paragraph', children: [
            { id: 'lbl-1', type: 'smarttext', code: 'lbl-1', label: '放射与病理', borderStyle: 'none', contentWrap: true },
            { id: 'lbl-2', type: 'smarttext', code: '抢救', borderStyle: 'none' },
          ],
        },
        {
          id: 'tbl-1', type: 'table', code: 'diagnosis-table', headerRows: 1, children: [
            {
              id: 'cg-1', type: 'colgroup', children: [
                { id: 'col-1', type: 'col', style: { css: { width: '50%' } } },
                { id: 'col-2', type: 'col', style: { css: { width: '50%' } } },
              ],
            },
            {
              id: 'tb-1', type: 'tablebody', children: [
                {
                  id: 'row-1', type: 'tablerow', children: [
                    { id: 'cell-1', type: 'tablecell', children: [{ id: 'para-c1', type: 'paragraph', children: [{ id: 'txt-c1', type: 'text', data: '诊断', style: { id: 'st-normal' } }] }] },
                    { id: 'cell-2', type: 'tablecell', rowspan: 2, children: [{ id: 'para-c2', type: 'paragraph', children: [{ id: 'txt-c2', type: 'text', data: '编码', style: { id: 'st-normal' } }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  valid: 1,
  scripts: {},
}

function importFixture(): TemplateImportResult {
  return new TemplateImporter().import(fixture)
}

describe('TemplateImporter 节点映射', () => {
  it('document 结构: header/body/footer 分派正确', () => {
    const r = importFixture()
    expect(r.doc.type).toBe('document')
    expect(r.doc.header).toEqual(['para-h'])
    expect(r.doc.footer).toEqual([])
    expect(r.doc.body.children).toEqual(['para-1', 'para-2', 'para-3', 'tbl-1'])
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(r.doc.metadata?.creator).toBe('测试')
    expect(r.doc.metadata?.externalId).toBe('tpl_001')
    expect(r.doc.metadata?.categoryId).toBe('test-template')
    // 白名单收口 (契约 §7.7/§12.2): 无 canonical home 的字段一律 drop
    expect((r.doc.metadata as unknown as Record<string, unknown>)?.version).toBeUndefined()
    expect((r.doc.metadata as unknown as Record<string, unknown>)?.createTime).toBeUndefined()
    expect(r.doc.pageSetup.orientation).toBe('portrait')
    expect(r.doc.pageSetup.width).toBe(794)
  })

  it('text 节点: data → text, 样式引用解析进 TextStyle', () => {
    const r = importFixture()
    const t = r.nodes.get('txt-h') as TextNode
    expect(t.type).toBe('text')
    expect(t.text).toBe('病历首页')
    // st-bold: SimSun + 10.5pt → 14px + bold
    expect(t.font).toBe('SimSun')
    expect(t.size).toBe(14)
    expect(t.bold).toBe(true)
  })

  it('smarttext(带 element) → SmartTextNode, 语义字段进 ElementMeta', () => {
    const r = importFixture()
    const st = r.nodes.get('st-1') as SmartTextNode
    expect(st.type).toBe('smarttext')
    expect(st.text).toBe('[患者姓名]')
    expect(st.element.code.internal).toBe('HDSD00.11.001')
    expect(st.element.code.dataElement).toBe('DE02.01.001.00')
    expect(st.element.name).toBe('患者姓名')
    expect(st.element.format?.dataType).toBe('S1')
    expect(st.element.format?.showType).toBe('AN')
    expect(st.element.required).toBe(true)
    expect(st.element.readonly).toBeUndefined()
    expect(st.element.privacy).toBeUndefined()
    // 9pt → 12px
    expect(st.size).toBe(12)
    expect(st.font).toBe('SimSun')
  })

  it('smarttext 运行时 value (非空字符串) 进 value 字段', () => {
    const withValue = {
      ...fixture,
      document: {
        ...fixture.document,
        body: { id: 'root-body', type: '$root', children: [
          { id: 'para-v', type: 'paragraph', children: [
            { id: 'st-v', type: 'smarttext', code: 'st-v', element: { name: '值', code: { internal: 'X', dataElement: 'Y' } }, value: '已填值' },
          ] },
        ] },
      },
    }
    const st = new TemplateImporter().import(withValue).nodes.get('st-v') as SmartTextNode
    expect(st.value).toBe('已填值')
  })

  it('code-only smarttext → TextNode (静态标签)', () => {
    const r = importFixture()
    const lbl = r.nodes.get('lbl-1') as TextNode
    expect(lbl.type).toBe('text')
    expect(lbl.text).toBe('放射与病理')
    // code !== id → 取 code 作为展示文本
    const lbl2 = r.nodes.get('lbl-2') as TextNode
    expect(lbl2.text).toBe('抢救')
  })

  it('checkfield → TextNode(prefix), insert/delete 标记丢弃', () => {
    const r = importFixture()
    const cb = r.nodes.get('cb-1') as TextNode
    expect(cb.type).toBe('text')
    expect(cb.text).toBe('1.治愈')
    expect(r.nodes.has('ins-1')).toBe(false)  // 修订标记被丢弃
    expect((r.nodes.get('txt-2') as TextNode).text).toBe('（已插入内容）')
  })

  it('table → Table + 列宽百分比 + 表头 + 合并', () => {
    const r = importFixture()
    const t = r.nodes.get('tbl-1') as Table
    expect(t.type).toBe('table')
    expect(t.columns).toHaveLength(2)
    expect(t.columns[0]).toEqual({ width: 50, mode: 'percentage' })
    expect(t.metadata?.code).toBe('diagnosis-table')
    expect(t.children).toEqual(['row-1'])
    const cell2 = r.nodes.get('cell-2') as { rowspan?: number; isHeader?: boolean }
    expect(cell2.rowspan).toBe(2)
    expect(cell2.isHeader).toBe(true)
  })
})

describe('TemplateImporter 四层路由边界 (契约 §12.2)', () => {
  it('模板设计期字段只在 TemplateDefinitionStore, 不在 SmartTextNode', () => {
    const r = importFixture()
    const st = r.nodes.get('st-1') as SmartTextNode
    for (const k of ['deletable', 'editable', 'tips', 'label', 'prefix', 'suffix', 'single']) {
      expect(k in st, `SmartTextNode 不应含字段 ${k}`).toBe(false)
    }
    expect(r.templateDefinitions.get('st-1')).toEqual({
      deletable: true, editable: true, tips: '患者姓名', label: '姓名：',
    })
  })

  it('表现层字段只在 PresentationStyleStore, 不在 SmartTextNode', () => {
    const r = importFixture()
    const st = r.nodes.get('st-1') as SmartTextNode
    for (const k of ['borderStyle', 'contentWrap', 'contentStyle', 'minWidth', 'textAlign']) {
      expect(k in st, `SmartTextNode 不应含字段 ${k}`).toBe(false)
    }
    expect(r.presentationStyles.get('st-1')).toEqual({
      borderStyle: 'solid', contentWrap: true, minWidth: '168',
    })
  })

  it('type-level: 导入结果四层类型互斥 (SmartTextNode 无后两层字段)', () => {
    expectTypeOf<SmartTextNode>().not.toHaveProperty('deletable')
    expectTypeOf<SmartTextNode>().not.toHaveProperty('borderStyle')
  })

  it('无字段的节点不产生空 store 条目', () => {
    const r = importFixture()
    // txt-1 是纯 text, 不应进两个 store
    expect(r.templateDefinitions.has('txt-1')).toBe(false)
    expect(r.presentationStyles.has('txt-1')).toBe(false)
  })

  it('import 可复用, 每次产出独立结果', () => {
    const imp = new TemplateImporter()
    const a = imp.import(fixture)
    const b = imp.import(fixture)
    expect(a.nodes).not.toBe(b.nodes)
    expect(a.nodes.get('st-1')).not.toBe(b.nodes.get('st-1'))
    expect(b.nodes.get('st-1')).toBeDefined()
  })
})

describe('isExternalTemplate 格式判别 (契约 §12.2)', () => {
  it('外部模板 (顶层 document 字段) → true', () => {
    expect(isExternalTemplate(fixture)).toBe(true)
  })

  it('引擎序列化格式 (type=document + body) → false', () => {
    expect(isExternalTemplate({
      type: 'document', id: 'x', body: { mode: 'flow', children: [] }, nodes: {},
    })).toBe(false)
  })

  it('非对象 / 无 document 字段 → false', () => {
    expect(isExternalTemplate(null)).toBe(false)
    expect(isExternalTemplate(undefined)).toBe(false)
    expect(isExternalTemplate('x')).toBe(false)
    expect(isExternalTemplate(42)).toBe(false)
    expect(isExternalTemplate({ styles: {}, layout: {} })).toBe(false)
  })
})

describe('TemplateImporter 真实外部模板 smoke', () => {
  it.skipIf(!REAL_TEMPLATE_KEY)('导入真实 1MB 模板, 校验节点计数', () => {
    const raw = JSON.parse(publicJson[REAL_TEMPLATE_KEY!])
    const r = new TemplateImporter().import(raw)

    const counts: Record<string, number> = {}
    for (const n of r.nodes.values()) counts[n.type] = (counts[n.type] ?? 0) + 1

    expect(counts.document).toBe(1)
    expect(counts.paragraph).toBe(225)
    expect(counts.smarttext).toBe(256)   // 带 element 的 smarttext
    expect(counts.table).toBe(2)
    expect(counts.text).toBe(159)        // 138 段落 text + 10 无element smarttext + 11 checkfield
                                          // (2 个内嵌于 smarttext 的渲染值 text 被吸收, 不单独成节点)
    expect(r.templateDefinitions.size).toBe(256)
    expect(r.presentationStyles.size).toBe(266)  // 全部 smarttext
  })
})
