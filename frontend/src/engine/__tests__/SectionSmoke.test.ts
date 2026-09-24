// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// SectionSmoke — Section 全链路冒烟验收 (P0–P3 合并验收)
//
// 前面四批各自锁住了自己的出口判据; 本文件把**整条链路**串起来跑一遍,
// 用真实 Editor + 真实加载/序列化/布局/命令, 回答一个问题:
//
//   "一份含 Section 的真实文档, 从加载到编辑到保存到再加载, 全程正确吗?"
//
// 链路: JSON → DocumentLoader → Editor → 布局 → 编辑 (节内) → 撤销/重做
//       → 序列化 → 再加载 → 逐项比对 → 导出 / QC / 查找
//
// 这是"端到端冒烟", 不是单元测试 —— 因此断言只看**用户可感知的事实**
// (页面里有没有这行字、字数对不对、导出里有没有这一节), 不看内部实现细节。
// ============================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost, type DomEditorHost } from '../../platform/dom'
import { loadDocumentFromObject } from '../document/io/DocumentLoader'
import { bodyBlockSpine, bodyParagraphSpine, sectionsOf, sectionOf } from '../document/selection/SelectionCollector'
import { resolveParagraphRegion, resolveBlockParent } from '../state/CaretScope'
import { SplitParagraphCommand } from '../command/commands/SplitParagraphCommand'
import { generateCommandId } from '../command/ICommand'
import { getFlatPageItems } from '../layout/core/SLIF'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../document/version/DocumentFormatVersion'
import { buildExportText, buildExportHtml } from '@/lib/documentExport'
import type { DocumentTree } from '../document/core/DocumentModel'

const cleanups: Array<() => void> = []

/**
 * 一份"含 Section 的真实文档"的 JSON —— 模拟**新客户端保存的 4.7.0 文档**。
 *
 *   body = [ P_头, Section{ P_主诉, Table{C1,C2}, Section{ P_既往 } }, P_尾 ]
 *
 * 刻意包含: 节内表格 (压 W3 展开)、嵌套节 (压递归)、节前后正文 (压边界)。
 */
function makeDocJson(): Record<string, unknown> {
  const n: Record<string, unknown> = {}
  const para = (id: string, text: string) => {
    n[`${id}_t`] = { id: `${id}_t`, type: 'text', text }
    n[id] = { id, type: 'paragraph', children: [`${id}_t`] }
    return id
  }

  const pHead = para('p_head', '节前抬头')
  const pChief = para('p_chief', '主诉: 头痛三天')
  const c1 = para('p_c1', '表内甲')
  const c2 = para('p_c2', '表内乙')
  n['cell_1'] = { id: 'cell_1', type: 'cell', children: [c1] }
  n['cell_2'] = { id: 'cell_2', type: 'cell', children: [c2] }
  n['row_1'] = { id: 'row_1', type: 'row', children: ['cell_1', 'cell_2'] }
  n['tbl_1'] = {
    id: 'tbl_1', type: 'table', columns: [{ width: 50 }, { width: 50 }], children: ['row_1'],
  }
  const pPast = para('p_past', '既往史: 无')
  n['sec_inner'] = { id: 'sec_inner', type: 'section', sectionCode: 'past_history', children: [pPast] }
  n['sec_outer'] = {
    id: 'sec_outer', type: 'section', sectionCode: 'chief_complaint',
    children: [pChief, 'tbl_1', 'sec_inner'],
  }
  const pTail = para('p_tail', '节后落款')

  return {
    type: 'document', id: 'doc_smoke', title: '冒烟验收病历',
    pageSetup: {
      width: 794, height: 1123, marginTop: 72, marginBottom: 72,
      marginLeft: 90, marginRight: 90, orientation: 'portrait',
    },
    body: { mode: 'flow', children: [pHead, 'sec_outer', pTail] },
    header: [], footer: [],
    headerFooterConfig: { differentFirstPage: false, differentOddEven: false },
    modelVersion: versionToString(CURRENT_DOCUMENT_VERSION),
    nodes: n,
  }
}

interface Smoke {
  editor: Editor
  doc: DocumentTree
}

function mount(json: unknown = makeDocJson()): Smoke {
  const loaded = loadDocumentFromObject(json)
  const host: DomEditorHost = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, loaded.doc)
  cleanups.push(() => { editor.destroy(); container.remove() })
  return { editor, doc: loaded.doc }
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

/** 页面上实际画出来的文本 (与渲染/命中同源的展平) */
function renderedText(s: Smoke): string[] {
  return s.editor.getDraw().getPages()
    .flatMap(getFlatPageItems)
    .filter(it => it.type === 'text')
    .map(it => it.text ?? '')
}

// ================================================================

describe('冒烟 1 — 加载: 含 Section 的 4.7.0 文档全程无异常', () => {
  it('加载后结构正确: 节在真结构里, 内容在逻辑流里', () => {
    const s = mount()
    // 真结构: body 直接子节点含 Section
    expect([...s.doc.body.children]).toEqual(['p_head', 'sec_outer', 'p_tail'])
    // 逻辑流: 节展开, 自身不入列; 嵌套节递归展开
    expect(bodyBlockSpine(s.doc, s.editor.getPool()))
      .toEqual(['p_head', 'p_chief', 'tbl_1', 'p_past', 'p_tail'])
    // 段落流: 表格展开为 cell 段落
    expect(bodyParagraphSpine(s.doc, s.editor.getPool()))
      .toEqual(['p_head', 'p_chief', 'p_c1', 'p_c2', 'p_past', 'p_tail'])
  })

  it('W4/R1: 节枚举与归属正确 (嵌套取最近)', () => {
    const s = mount()
    expect(sectionsOf(s.doc, s.editor.getPool())).toEqual(['sec_outer', 'sec_inner'])
    expect(sectionOf('p_past', s.editor.getPool())).toBe('sec_inner')
    expect(sectionOf('p_chief', s.editor.getPool())).toBe('sec_outer')
    expect(sectionOf('p_head', s.editor.getPool())).toBeNull()
    expect(sectionOf('tbl_1', s.editor.getPool())).toBe('sec_outer')
  })

  it('R2: 节内段落/表格的真实容器是节', () => {
    const s = mount()
    expect(resolveParagraphRegion('p_chief', s.doc, s.editor.getPool())?.type).toBe('section')
    expect(resolveBlockParent('tbl_1', s.doc, s.editor.getPool()))
      .toEqual({ kind: 'section', containerId: 'sec_outer', index: 1 })
  })
})

describe('冒烟 2 — 布局: 节内内容真的画出来了', () => {
  it('节内段落 / 节内表格 cell / 嵌套节内容 / 节前后正文 全部上屏', () => {
    const s = mount()
    const values = renderedText(s)
    for (const expected of ['节前抬头', '主诉: 头痛三天', '表内甲', '表内乙', '既往史: 无', '节后落款']) {
      expect(values.some(v => v.includes(expected)), `页面缺少: ${expected}`).toBe(true)
    }
  })

  it('Section 自身不产出任何绘制项 (它是容器, 不是内容)', () => {
    const s = mount()
    const nodeIds = s.editor.getDraw().getPages()
      .flatMap(getFlatPageItems)
      .map(it => it.nodeId)
    expect(nodeIds).not.toContain('sec_outer')
    expect(nodeIds).not.toContain('sec_inner')
  })
})

describe('冒烟 3 — 编辑: 节内编辑全程正确', () => {
  it('节内段落回车拆段 → 新段落落在节内', () => {
    const s = mount()
    s.editor.execCommand(new SplitParagraphCommand(
      generateCommandId(), Date.now(), 'smoke', [s.doc.id, 'p_chief'], 4,
    ))
    const sec = s.editor.getPool().nodes.get('sec_outer') as unknown as { children: string[] }
    expect(sec.children[0]).toBe('p_chief')
    expect(sec.children).toHaveLength(4) // [chief, 新段, table, inner]
    expect(s.editor.getPool().nodes.get(sec.children[1])?.type).toBe('paragraph')
    // body 结构未变
    expect([...s.doc.body.children]).toEqual(['p_head', 'sec_outer', 'p_tail'])
  })

  it('节内编辑可撤销 (撤销后结构与文本都回到原样)', () => {
    const s = mount()
    s.editor.execCommand(new SplitParagraphCommand(
      generateCommandId(), Date.now(), 'smoke', [s.doc.id, 'p_chief'], 4,
    ))
    s.editor.undo()
    const sec = s.editor.getPool().nodes.get('sec_outer') as unknown as { children: string[] }
    expect(sec.children).toEqual(['p_chief', 'tbl_1', 'sec_inner'])
    const text = renderedText(s).join('')
    expect(text).toContain('主诉: 头痛三天')
  })

  it('节内查找替换可达, 且不影响节外内容', () => {
    const s = mount()
    const { replaced } = s.editor.replaceAll('头痛', '头晕')
    expect(replaced).toBeGreaterThan(0)
    const text = renderedText(s).join('')
    expect(text).toContain('头晕')
    expect(text).not.toContain('头痛')
    expect(text).toContain('节后落款')
  })

  it('整节删除 → 节内全部内容从页面消失; undo → 全部回来', () => {
    const s = mount()
    expect(s.editor.deleteNode('sec_outer')).toBe(true)
    let text = renderedText(s).join('')
    expect(text).toContain('节前抬头')
    expect(text).toContain('节后落款')
    expect(text).not.toContain('主诉')
    expect(text).not.toContain('既往史')

    s.editor.undo()
    text = renderedText(s).join('')
    expect(text).toContain('主诉: 头痛三天')
    expect(text).toContain('既往史: 无')
    expect([...s.doc.body.children]).toEqual(['p_head', 'sec_outer', 'p_tail'])
  })
})

describe('冒烟 4 — 统计与质控', () => {
  it('字数统计含节内与节内表格的文本', () => {
    const s = mount()
    const wc = s.editor.getWordCount()
    // 节前抬头(4) + "主诉: 头痛三天"(8) + 表内甲(3) + 表内乙(3) + "既往史: 无"(6) + 节后落款(4) = 28
    expect(wc.chars).toBe(28)
    expect(wc.paragraphs).toBe(6)
  })

  it('QC 能跑通且节级规则正确 (有 sectionCode 的节不报 unnamed)', () => {
    const s = mount()
    const result = s.editor.runQC()
    const sectionIssues = result.issues.filter(i => i.ruleId === 'qc_007' || i.ruleId === 'qc_008')
    expect(sectionIssues).toHaveLength(0) // 两个节都有 code 且有内容
    expect(result.documentId).toBe('doc_smoke')
  })

  it('QC 对空节/匿名节报警并可定位', () => {
    const json = makeDocJson() as Record<string, unknown>
    const nodes = json.nodes as Record<string, unknown>
    nodes['sec_anon'] = { id: 'sec_anon', type: 'section', children: ['p_anon'] }
    nodes['p_anon'] = { id: 'p_anon', type: 'paragraph', children: ['p_anon_t'] }
    nodes['p_anon_t'] = { id: 'p_anon_t', type: 'text', text: '匿名节内容' }
    nodes['sec_empty'] = { id: 'sec_empty', type: 'section', sectionCode: 'empty', children: [] }
    ;(json.body as { children: string[] }).children = ['p_head', 'sec_outer', 'sec_anon', 'sec_empty', 'p_tail']

    const s = mount(json)
    const issues = s.editor.runQC().issues
    expect(issues.some(i => i.ruleId === 'qc_007' && i.nodeId === 'sec_anon')).toBe(true)
    expect(issues.some(i => i.ruleId === 'qc_008' && i.nodeId === 'sec_empty')).toBe(true)
    // 空节无段落可跳 → 只给 nodeId; 匿名节可跳到节内首段
    const unnamed = issues.find(i => i.ruleId === 'qc_007')!
    expect(unnamed.paragraphPath?.[1]).toBe('p_anon')
  })
})

describe('冒烟 5 — 保存与再加载: 往返无损', () => {
  it('serialize → load → 结构/内容/节语义逐项一致', () => {
    const s = mount()
    // 先做一次节内编辑, 确保往返的是"编辑后"的文档
    s.editor.execCommand(new SplitParagraphCommand(
      generateCommandId(), Date.now(), 'smoke', [s.doc.id, 'p_past'], 3,
    ))

    const json = s.editor.getSerializedDocument()
    const reloaded = loadDocumentFromObject(JSON.parse(json))
    const s2: Smoke = { editor: s.editor, doc: reloaded.doc }

    // 版本
    expect(reloaded.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    // 真结构
    expect([...reloaded.doc.body.children]).toEqual([...s.doc.body.children])
    // 逻辑流 (含编辑后的新段落)
    const pool2 = reloaded.pool
    expect(bodyBlockSpine(reloaded.doc, pool2)).toEqual(bodyBlockSpine(s.doc, s.editor.getPool()))
    // 节语义
    expect(sectionsOf(reloaded.doc, pool2)).toEqual(sectionsOf(s.doc, s.editor.getPool()))
    expect(sectionOf('p_past', pool2)).toBe('sec_inner')
    // 节代码保真
    const sec = pool2.nodes.get('sec_outer') as unknown as { sectionCode?: string }
    expect(sec.sectionCode).toBe('chief_complaint')
    // 渲染产物一致 (同一份文档 → 同样的文本)
    expect(renderedText(s2).join('|')).toBe(renderedText(s).join('|'))
  })

  it('再加载的文档可继续编辑 (节内拆段仍落在节内)', () => {
    const s = mount()
    const reloaded = loadDocumentFromObject(JSON.parse(s.editor.getSerializedDocument()))
    const host: DomEditorHost = createDomEditorHost()
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.surface.mount(container); host.input.mount(container)
    const editor2 = new Editor(host, reloaded.doc)
    cleanups.push(() => { editor2.destroy(); container.remove() })

    editor2.execCommand(new SplitParagraphCommand(
      generateCommandId(), Date.now(), 'smoke', [reloaded.doc.id, 'p_chief'], 2,
    ))
    const sec = reloaded.pool.nodes.get('sec_outer') as unknown as { children: string[] }
    expect(sec.children).toHaveLength(4)
    expect(sec.children[0]).toBe('p_chief')
  })
})

describe('冒烟 6 — 导出', () => {
  it('TXT/HTML 导出含节内与节内表格文本 (平坦格式丢节结构是固有限制)', () => {
    const s = mount()
    const pool = { nodes: s.editor.getPool().nodes }
    const txt = buildExportText(s.doc, pool)
    const html = buildExportHtml(s.doc, pool)
    for (const expected of ['节前抬头', '主诉: 头痛三天', '表内甲', '既往史: 无', '节后落款']) {
      expect(txt, `TXT 缺少: ${expected}`).toContain(expected)
    }
    expect(html).toContain('表内甲')
    expect(html).toContain('</html>')
  })
})
