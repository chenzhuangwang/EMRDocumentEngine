// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// UndoRedoEquivalence — 随机命令序列的撤销/重做等价闸门 (契约 §8.2)
//
// 为什么要有这条闸门:
//   43 个命令类各自手写 invert, 单命令都有零散断言, 真正的风险在**组合** ——
//   拆分段落后在新段打字、合并段落后撤销、表格追加行后撤销再撤销前一条.
//   每一步的 invert 都建立在"该命令执行后的状态"上, 任何两条命令对彼此铸出
//   的节点/样式/结构的假设不一致, 点测试几乎必漏; 而撤销损坏是**静默**的
//   (内容看起来还在, 只是少了或错位), 会随保存进入病历.
//
// 判据 (与增量排版同一套硬门):
//   逐步撤销: 第 k 次 undo 后必须与第 n-k 步的序列化快照**逐字节相同**;
//   逐步重做: 第 k 次 redo 后必须与前向第 k 个快照逐字节相同.
//   只验"撤到底 = 初始"会漏掉中间态错位, 所以逐步比较.
//
// 合并窗口: 命令时间戳每题 +1000ms, 避开 500ms 自动合并窗口 —— 于是 undo 栈
//   与成功命令一一对应, 快照可以直接按下标对齐. 合并本身由 UndoMerge.test 守.
//
// 覆盖范围 (2026-10-21 扩充): 正文段落与**表格 cell 内的段落**都参与随机选取;
// 动作含输入/删除/格式/段落样式/拆段/并段/清格式/列表开关/表格追加行/
// 控件值变更/控件删除/表格结构(插删行列·合并/拆分格)/插入图片/插入脚注/
// 查找替换/复制粘贴(经 Editor 门面, 覆盖 ClipboardManager 序列化 +
// InsertNodesCommand)/剪切(copy + 删除选区, 宏单元)/接受·拒绝修订/
// **创建批注(Editor 门面 + 直接命令两条链)/批注状态变更/块移动/插入节/
// 批量绑定值/文档标题与元数据/页眉页脚变体开关/页面几何/节代码/
// 控件语义层与设计期定义/批注回复/表格可增长标记**.
// 快照带上 templateDefinitions: 设计期定义存在 store 而非文档树里, 不带它
// 就等于"恢复定义"根本不在判据里 —— 闸门会假绿.
// 第三条种子开启修订追踪 (setTrackChanges + 当前用户): 输入/删除都会留下
// 标记, 接受/拒绝修订也在随机动作里 —— 标记的撤销/重做同样要求逐字节还原.
// 控件与新旧动作先确定性地各做一次, 并有「动作真的入过栈」的假覆盖守卫 ——
// 否则表格结构/剪切可能先把夹具抽空, 后面的 case 全部空转, 闸门看起来
// 覆盖了实际没跑 (动作池扩到 24 种后随机稀释, 守卫更要靠确定性预演兜底).
// cell/控件/粘贴编辑此前从未进入随机组合 —— 扩充后抓到六处真实缺陷
// (前四处是撤销精确性, 后两处由粘贴动作暴露):
//   1. 原地输入会 normalize 并掉**早已存在**的相邻同样式 run, 轻量反转还原不出;
//   2. 往**空 run** 里输入, 反转删字后节点被摘除并铸新 id, 原 id/样式丢失;
//   3. 拆段的逆操作 (并段) 整段 normalize, 并掉拆段前就有的 run 边界;
//   4. 拆点恰在 run 边界时, 并段会在接缝处把两个本应独立的 run 合并 ——
//      拆段撤销改为按拆段前整段快照恢复 (RestoreSplitCommand);
//   5. 光标落在行内非文本节点 (图片等) 上粘贴: InsertNodesCommand 把该节点
//      当文本切片, 直接 TypeError (契约 §6.3);
//   6. 粘贴整段 normalize 目的地段落, 并掉与粘贴无关的 run; 撤销按 id
//      恢复 children, 被并节点的身份与文字还原不出 (改为只并接缝, §8.2)。
// 1-4 均改为"会破坏 run 身份的命令先拍整段快照"或"并段只合并接缝一对"。
// 动作池扩到批注/块移动/插入节/批量绑定后抓到的第 10 处缺陷:
//   Editor.createComment 在线程工厂**内部**铸造首条内容的 id —— 工厂在
//   redo 时会再跑一次, 重做后的批注条目 id 与首次不同 (契约 §8.3 MintedOnce
//   同一规则: 铸造一次, 重放复用同一批 id)。改为铸造前取定。
// ================================================================

import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '../Editor'
import { createDomEditorHost } from '../../platform/dom'
import {
  createDocument, createParagraph, createTextNode, createTable, createTableRow, createTableCell,
} from '../document/factory/ElementFormatter'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { generateCommandId, type ICommand } from '../command/ICommand'
import { InsertTextCommand } from '../command/commands/InsertTextCommand'
import { DeleteRangeCommand } from '../command/commands/DeleteRangeCommand'
import { FormatTextCommand, ClearFormatCommand } from '../command/commands/FormatTextCommand'
import { ParagraphStyleCommand } from '../command/commands/ParagraphStyleCommand'
import { SplitParagraphCommand } from '../command/commands/SplitParagraphCommand'
import { MergeParagraphCommand } from '../command/commands/MergeParagraphCommand'
import { AppendTableRowCommand } from '../command/commands/AppendTableRowCommand'
import { SetControlValueCommand } from '../command/commands/SetControlValueCommand'
import { RemoveControlCommand } from '../command/commands/RemoveControlCommand'
import { SetHeaderFooterConfigCommand } from '../command/commands/HeaderFooterConfigCommand'
import { UpdateDocumentTitleCommand } from '../command/commands/UpdateDocumentTitleCommand'
import { UpdateDocumentPropertiesCommand } from '../command/commands/UpdateDocumentPropertiesCommand'
import { SetTableGrowableCommand } from '../command/commands/SetTableGrowableCommand'
import { UpdateControlElementCommand } from '../command/commands/UpdateControlElementCommand'
import { UpdateControlDefinitionCommand } from '../command/commands/UpdateControlDefinitionCommand'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import {
  TableStructureCommand, InsertFootnoteCommand,
  SetPageSetupCommand, UpdateSectionCommand, AddCommentReplyCommand,
} from '../command/commands/StructuralCommands'
import {
  CreateCommentCommand, ResolveCommentCommand, MoveBlockCommand, InsertSectionCommand,
} from '../command/commands/StructuralCommands'
import { SetBoundValuesCommand } from '../command/commands/SetBoundValuesCommand'
import { InsertImageCommand } from '../command/commands/InsertImageCommand'
import { ReplaceTextCommand } from '../command/commands/ReplaceTextCommand'
import {
  buildCellGrid, insertRow, deleteRow, insertColumn, deleteColumn,
  mergeAdjacentCells, splitCell,
} from '../document/table/TableOps'
import { createSmartTextNode } from '../document/factory/ElementFormatter'
import type {
  BaseNode, CommentThread, ControlValue, DocumentMetadata, DocumentTree, ElementMeta,
  FootnoteContent, Paragraph, SmartTextNode, TextNode,
} from '../document/core/DocumentModel'

afterEach(() => { document.body.innerHTML = '' })

/** 夹具控件的元素声明 (最低限度: 名称 + 文本类型) */
const CONTROL_ELEMENT = {
  code: 'E1', name: '血压', format: { dataType: 'S1' },
} as unknown as ElementMeta

// ---- 夹具: 4 段正文 (含一个控件) + 一张 2×2 表格 (cell 内也含一个控件) ----

interface Fixture { editor: Editor; doc: DocumentTree; tableId: string; defs: TemplateDefinitionStore }

function makeFixture(): Fixture {
  const doc = createDocument('撤销等价闸门')
  const nodes: Record<string, BaseNode> = {}
  nodes[doc.id] = doc as unknown as BaseNode
  const add = <T extends { id: string }>(n: T): T => {
    nodes[n.id] = n as unknown as BaseNode
    return n
  }
  const addParagraph = (text: string): Paragraph => {
    const t = add(createTextNode(text))
    const p = add(createParagraph([t.id]) as Paragraph)
    doc.body.children.push(p.id)
    return p
  }

  const p1 = addParagraph('甲乙丙丁戊己')
  // 段落里放一个控件 —— EMR 文档的常态, 让输入/删除/拆段/撤销都经过内联非文本节点
  p1.children = [...p1.children, add(createSmartTextNode('[血压]', CONTROL_ELEMENT)).id]
  addParagraph('庚辛壬癸子丑')
  addParagraph('寅卯辰巳午未')
  addParagraph('申酉戌亥')

  const rowIds: string[] = []
  for (let r = 0; r < 2; r++) {
    const cellIds: string[] = []
    for (let c = 0; c < 2; c++) {
      const t = add(createTextNode(`格${r}${c}`))
      const p = add(createParagraph([t.id]) as Paragraph)
      // cell 段落里也放一个控件 (控件删除/值变更在 cell 内的撤销同样要精确)
      if (r === 0 && c === 0) {
        p.children = [...p.children, add(createSmartTextNode('[体重]', CONTROL_ELEMENT)).id]
      }
      const cell = add(createTableCell([p.id]))
      cellIds.push(cell.id)
    }
    const row = add(createTableRow())
    row.children = cellIds
    rowIds.push(row.id)
  }
  const table = add(createTable([{ width: 50 }, { width: 50 }]))
  table.children = rowIds
  doc.body.children.push(table.id)

  ;(doc as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes = nodes
  const host = createDomEditorHost()
  const container = document.createElement('div')
  document.body.appendChild(container)
  host.surface.mount(container)
  host.input.mount(container)
  const editor = new Editor(host, doc)
  // 设计期命令 (UpdateControlDefinitionCommand) 经 ctx.templateDefinitions 取 store;
  // 快照也要带上它 —— 否则"定义恢复"根本不在判据里, 用例会假绿。
  const defs = new TemplateDefinitionStore()
  editor.setDocument(doc, undefined, { templateDefinitions: defs })
  return { editor, doc, tableId: table.id, defs }
}

// ---- 读数 ----

/**
 * 规范化快照: 键排序后序列化。
 *
 * 判据要的是"内容 + 节点身份 + 数组顺序"逐字节相同; 对象**键的插入顺序**
 * 不是判据 —— `Object.assign` 写样式的先后会让同一份文档输出不同的键序,
 * 那是序列化噪声, 不是撤销缺陷。数组顺序 (children、body.children) 保持原样比较。
 */
function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const src = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(src).sort()) {
        const item = src[key]
        if (item === undefined) continue
        out[key] = walk(item)
      }
      return out
    }
    return v
  }
  return JSON.stringify(walk(value))
}

const snapshot = (f: Fixture): string =>
  canonicalJson(JSON.parse(serializeDocument(
    f.editor.getDocument(), f.editor.getPool(), { templateDefinitions: f.defs },
  )))

const undoDepth = (f: Fixture): number =>
  f.editor.getStore().state.runtime.history.undoDepth

function bodyParagraphs(f: Fixture): Paragraph[] {
  const pool = f.editor.getPool()
  return f.editor.getDocument().body.children
    .map((id) => pool.nodes.get(id))
    .filter((n): n is Paragraph => (n as { type?: string } | undefined)?.type === 'paragraph')
}

/**
 * 可编辑段落 = 正文段落 + 表格 cell 内的段落。
 *
 * cell 段落与正文段落走同一批命令类 (路径都是 [docId, paraId]), 但容器不同:
 * 删空、拆段、格式还原在 cell 里更容易与 normalize/merge 撞车, 而这里一旦
 * 出错是静默的。原来的闸门只选正文段落, cell 编辑从未被随机组合覆盖过。
 */
function editableParagraphs(f: Fixture): Paragraph[] {
  const pool = f.editor.getPool()
  const out: Paragraph[] = []
  const pushPara = (node: unknown): void => {
    if ((node as { type?: string } | undefined)?.type === 'paragraph') out.push(node as Paragraph)
  }
  for (const id of f.editor.getDocument().body.children) {
    const node = pool.nodes.get(id) as { type?: string; children?: readonly string[] } | undefined
    if (node?.type === 'table') {
      for (const rowId of node.children ?? []) {
        const row = pool.nodes.get(rowId) as { children?: readonly string[] } | undefined
        for (const cellId of row?.children ?? []) {
          const cell = pool.nodes.get(cellId) as { children?: readonly string[] } | undefined
          for (const paraId of cell?.children ?? []) pushPara(pool.nodes.get(paraId))
        }
      }
      continue
    }
    pushPara(node)
  }
  return out
}

function textLengthOf(f: Fixture, para: Paragraph): number {
  const pool = f.editor.getPool()
  let n = 0
  for (const id of para.children) {
    const node = pool.nodes.get(id) as TextNode | undefined
    if (node?.type === 'text') n += (node.text ?? '').length
  }
  return n
}

/** 夹具里现存的控件节点 (id + 所在段落) */
function controlNodes(f: Fixture): { id: string; paraId: string }[] {
  const pool = f.editor.getPool()
  const out: { id: string; paraId: string }[] = []
  for (const p of editableParagraphs(f)) {
    for (const childId of p.children) {
      const node = pool.nodes.get(childId) as { type?: string } | undefined
      if (node?.type === 'smarttext') out.push({ id: childId, paraId: p.id })
    }
  }
  return out
}

// ---- 固定种子 LCG (确定性: 失败可复现) ----

interface Rng { int(max: number): number }

function makeRng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
  return { int: (max: number) => Math.floor(next() * max) }
}

// ---- 随机命令 (每次都基于当前文档状态选一个合法目标) ----

const CHARS = ['甲', '乙', '丙', '丁', '随访']
const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const
/** 脚注铸造用的唯一键 (同一次测试进程内不重复) */
let footnoteSeq = 0
/** 批注回复的唯一 id */
let replySeq = 0

/** 非命令型随机动作: 走 Editor 门面 (copy→paste / cut / createComment / 接受·拒绝修订), 由真实命令链落栈 */
interface EditorAction { action: 'copy-paste' | 'cut' | 'create-comment' | 'accept-all' | 'reject-all' }
/**
 * 需要在**执行时**才确定目标的命令 (如"更新当前存在的某个 Section"):
 * 预演阶段构造命令时, 目标 id 由前一条预演命令铸造, 只能延迟到执行时取。
 */
interface FactoryAction { make: (f: Fixture) => ICommand | null }
type RandomAction = ICommand | EditorAction | FactoryAction

function isEditorAction(a: ICommand | EditorAction | FactoryAction): a is EditorAction { return 'action' in a }
function isFactoryAction(a: ICommand | EditorAction | FactoryAction): a is FactoryAction { return 'make' in a }

/**
 * 复制一段文本 → 在随机光标处粘贴。
 *
 * 走公开门面而不是直接构造 InsertNodesCommand: 这条链上还有
 * ClipboardManager 的序列化/反序列化与 deleteSelectedRange 前置判断,
 * 撤销缺陷往隐藏在这两处 (剪贴板里的节点 id 与池内 id 的对应关系)。
 */
function runCopyPaste(f: Fixture, rng: Rng): void {
  const src = editableParagraphs(f).filter((p) => textLengthOf(f, p) > 0)
  if (src.length === 0) return
  const from = src[rng.int(src.length)]
  const len = textLengthOf(f, from)
  // 非空区间: 空选区复制会被 ClipboardManager 拒绝, 动作就静默落空
  const start = rng.int(len)
  const end = start + 1 + rng.int(len - start)
  f.editor.getStore().setSelection({
    anchor: { paragraphPath: [f.doc.id, from.id], offset: start, visible: false },
    focus: { paragraphPath: [f.doc.id, from.id], offset: end, visible: false },
    active: true,
    granularity: 'character',
  })
  f.editor.copy()

  // 粘贴点: 清掉选区 (active=false) 后再落光标, 避免 paste 前置删除产生额外栈单元
  const to = src[rng.int(src.length)]
  const dlen = textLengthOf(f, to)
  const caret = { paragraphPath: [f.doc.id, to.id], offset: rng.int(dlen + 1), visible: true }
  f.editor.getStore().setSelection({
    anchor: caret, focus: caret, active: false, granularity: 'character',
  })
  f.editor.paste()
}

/**
 * 剪切: copy + deleteSelection (宏单元)。验证跨段/单元格内删除与
 * 宏包装的一次撤销 (契约 RULE 11) —— 选区删除若各占一个栈单元,
 * 这里立刻会红。
 */
function runCut(f: Fixture, rng: Rng): void {
  const cands = editableParagraphs(f).filter((p) => textLengthOf(f, p) > 0)
  if (cands.length === 0) return
  const p = cands[rng.int(cands.length)]
  const len = textLengthOf(f, p)
  const start = rng.int(len)
  const end = start + 1 + rng.int(len - start)
  f.editor.getStore().setSelection({
    anchor: { paragraphPath: [f.doc.id, p.id], offset: start, visible: false },
    focus: { paragraphPath: [f.doc.id, p.id], offset: end, visible: false },
    active: true,
    granularity: 'character',
  })
  f.editor.cut()
}

/** 接受/拒绝全部修订 (经 Editor 门面; 修订决定是快照恢复类命令) */
function runRevisionDecision(f: Fixture, action: 'accept-all' | 'reject-all'): void {
  if (action === 'accept-all') f.editor.acceptAllRevisions()
  else f.editor.rejectAllRevisions()
}

/**
 * 经 Editor 门面建批注 (契约 §12.2)。
 *
 * 这条链上还有 resolveCommentAnchor: 无光标/跨段选区会被拒绝。它同时覆盖
 * Editor 里那对「铸造前取定 id/时间戳」的工厂 —— 工厂在 redo 时会再跑一次,
 * 在工厂内铸 id/读钟会让重做后的线程逐字节漂移。
 */
function runEditorCreateComment(f: Fixture, rng: Rng): void {
  const cands = editableParagraphs(f).filter((p) => textLengthOf(f, p) > 0)
  if (cands.length === 0) return
  const p = cands[rng.int(cands.length)]
  const len = textLengthOf(f, p)
  // 光标前一个字符是锚点, offset 必须 ≥ 1
  const offset = 1 + rng.int(len)
  const caret = { paragraphPath: [f.doc.id, p.id], offset, visible: true }
  f.editor.getStore().setSelection({
    anchor: caret, focus: caret, active: false, granularity: 'character',
  })
  f.editor.createComment(`批注${offset}`)
}

function makeRandomCommand(f: Fixture, rng: Rng, nextTs: () => number): RandomAction | null {
  const doc = f.editor.getDocument()
  const pool = f.editor.getPool()
  const paras = editableParagraphs(f)
  if (paras.length === 0) return null

  switch (rng.int(34)) {
    case 0: {
      const p = paras[rng.int(paras.length)]
      const len = textLengthOf(f, p)
      const offset = rng.int(len + 1)
      return new InsertTextCommand(
        generateCommandId(), nextTs(), 'user', [doc.id, p.id], offset, CHARS[rng.int(CHARS.length)],
      )
    }
    case 1: {
      const candidates = paras.filter((p) => textLengthOf(f, p) >= 2)
      if (candidates.length === 0) return null
      const p = candidates[rng.int(candidates.length)]
      const len = textLengthOf(f, p)
      const start = rng.int(len)
      const end = start + 1 + rng.int(len - start)
      return new DeleteRangeCommand(
        generateCommandId(), nextTs(), 'user', [doc.id, p.id], start, end,
      )
    }
    case 2: {
      const textIds = paras.flatMap((p) => p.children.filter(
        (id) => (pool.nodes.get(id) as { type?: string } | undefined)?.type === 'text',
      ))
      if (textIds.length === 0) return null
      const id = textIds[rng.int(textIds.length)]
      const changes = [
        { bold: true }, { italic: true }, { underline: true }, { size: 18 },
      ][rng.int(4)]
      return new FormatTextCommand(generateCommandId(), nextTs(), 'user', [id], changes)
    }
    case 3: {
      const p = paras[rng.int(paras.length)]
      return new ParagraphStyleCommand(
        generateCommandId(), nextTs(), 'user', [p.id],
        { alignment: ALIGNMENTS[rng.int(ALIGNMENTS.length)] },
      )
    }
    case 4: {
      const p = paras[rng.int(paras.length)]
      const len = textLengthOf(f, p)
      const offset = rng.int(len + 1)
      return new SplitParagraphCommand(generateCommandId(), nextTs(), 'user', [doc.id, p.id], offset)
    }
    case 5: {
      // 合并只取正文同容器相邻段落 (cell 内的合并语义另有专门用例)
      const body = doc.body.children
      const mergeable: number[] = []
      for (let i = 1; i < body.length; i++) {
        const prev = pool.nodes.get(body[i - 1]) as { type?: string } | undefined
        const cur = pool.nodes.get(body[i]) as { type?: string } | undefined
        if (prev?.type === 'paragraph' && cur?.type === 'paragraph') mergeable.push(i)
      }
      if (mergeable.length === 0) return null
      const i = mergeable[rng.int(mergeable.length)]
      return new MergeParagraphCommand(generateCommandId(), nextTs(), 'user', [doc.id, body[i]])
    }
    case 6: {
      // 清除格式: 与 FormatTextCommand 的 invert 走同一条样式还原路径
      const textIds = paras.flatMap((p) => p.children.filter(
        (id) => (pool.nodes.get(id) as { type?: string } | undefined)?.type === 'text',
      ))
      if (textIds.length === 0) return null
      return new ClearFormatCommand(
        generateCommandId(), nextTs(), 'user', [textIds[rng.int(textIds.length)]],
      )
    }
    case 7: {
      // 列表开关: 编号是跨段落派生状态, 撤销必须连编号一起还原
      const p = paras[rng.int(paras.length)]
      const list = rng.int(2) === 0
        ? { type: 'bullet' as const, level: 1 }
        : { type: 'ordered' as const, level: 1 }
      return new ParagraphStyleCommand(generateCommandId(), nextTs(), 'user', [p.id], { list })
    }
    case 8: {
      // 控件值变更: 撤销必须逐字段还原 (含"清空"= undefined 的规范空态)
      const controls = controlNodes(f)
      if (controls.length === 0) return null
      const c = controls[rng.int(controls.length)]
      const values: (ControlValue | undefined)[] = ['120/80', 37.5, undefined]
      return new SetControlValueCommand(
        generateCommandId(), nextTs(), 'user', c.id, values[rng.int(values.length)],
      )
    }
    case 9: {
      // 删除控件: 从段落摘除节点, 撤销必须把节点与位置原样放回。
      // 保留最后一个控件 —— 否则控件值变更会因夹具被删空而静默空转
      // (假覆盖守卫会红, 但更根本的是别把随机池抽干)。
      const controls = controlNodes(f)
      if (controls.length < 2) return null
      const c = controls[rng.int(controls.length)]
      return new RemoveControlCommand(
        generateCommandId(), nextTs(), 'user', [doc.id, c.paraId], c.id,
      )
    }
    case 10: {
      // 表格结构: 插入/删除行列 (会改 span、铸新行/格, 且表格可落在 cell 外)
      const pool = f.editor.getPool()
      const grid = buildCellGrid(pool, f.tableId)
      const tableId = f.tableId
      const kind = rng.int(6)
      if (kind === 0 && grid.numRows < 4) {
        const at = rng.int(grid.numRows)
        return new TableStructureCommand(generateCommandId(), nextTs(), 'user', tableId,
          (p) => { insertRow(p, tableId, at); return true })
      }
      if (kind === 1 && grid.numRows > 1) {
        const at = rng.int(grid.numRows)
        return new TableStructureCommand(generateCommandId(), nextTs(), 'user', tableId,
          (p) => { deleteRow(p, tableId, at); return true })
      }
      if (kind === 2 && grid.numCols < 4) {
        const at = rng.int(grid.numCols)
        return new TableStructureCommand(generateCommandId(), nextTs(), 'user', tableId,
          (p) => { insertColumn(p, tableId, at); return true })
      }
      if (kind === 3 && grid.numCols > 1) {
        const at = rng.int(grid.numCols)
        return new TableStructureCommand(generateCommandId(), nextTs(), 'user', tableId,
          (p) => { deleteColumn(p, tableId, at); return true })
      }
      if (kind === 4 && grid.numCols > 1) {
        // 合并相邻格: 直接改 colspan / children 并摘除右侧格 (无版本冒泡)
        const r = rng.int(grid.numRows)
        const c = rng.int(grid.numCols - 1)
        return new TableStructureCommand(generateCommandId(), nextTs(), 'user', tableId,
          (p) => mergeAdjacentCells(p, tableId, r, c))
      }
      if (kind === 5) {
        // 拆分已合并的格: 非合并格返回 false → 命令不入栈 (闸门按未入栈处理)
        const r = rng.int(grid.numRows)
        const c = rng.int(grid.numCols)
        return new TableStructureCommand(generateCommandId(), nextTs(), 'user', tableId,
          (p) => splitCell(p, tableId, r, c))
      }
      return null
    }
    case 11: {
      // 插入行内图片: 会在段落中间切开文本并铸造图片/后半段节点
      const p = paras[rng.int(paras.length)]
      const len = textLengthOf(f, p)
      const offset = rng.int(len + 1)
      const w = 40 + rng.int(80)
      const h = 30 + rng.int(60)
      return new InsertImageCommand(
        generateCommandId(), nextTs(), 'user', [doc.id, p.id], offset,
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        w, h,
      )
    }
    case 12: {
      // 插入脚注: 内容节点进文档级 doc.footnotes, 引用节点进段落 —— 复合命令,
      // 撤销要同时摘掉两处并按 id 还原 (契约 §8.3)
      const p = paras[rng.int(paras.length)]
      const len = textLengthOf(f, p)
      const offset = rng.int(len + 1)
      const key = `fn${footnoteSeq++}`
      return new InsertFootnoteCommand(generateCommandId(), nextTs(), 'user', [doc.id, p.id], offset,
        (pool) => {
          const t = createTextNode(`脚注${key}`)
          const para = createParagraph([t.id])
          const content = {
            type: 'footnote_content', id: `fn-content-${key}`, refId: '', children: [para.id],
          } as unknown as FootnoteContent
          pool.addNode(t as unknown as BaseNode)
          pool.addNode(para as unknown as BaseNode)
          pool.addNode(content as unknown as BaseNode)
          return content
        },
        (contentId) => ({
          type: 'footnote_ref', id: `fn-ref-${key}`, refId: contentId, footnoteId: contentId,
        } as unknown as BaseNode))
    }
    case 13:
      return { action: 'copy-paste' }
    case 14: {
      // 查找替换: ReplaceTextCommand (单次替换; 内部会断言段落快照后 normalize)
      const cands = paras.filter((p) => textLengthOf(f, p) > 0)
      if (cands.length === 0) return null
      const p = cands[rng.int(cands.length)]
      const len = textLengthOf(f, p)
      const start = rng.int(len)
      const end = start + 1 + rng.int(len - start)
      return new ReplaceTextCommand(generateCommandId(), nextTs(), 'user', [{
        paragraphPath: [doc.id, p.id], startOffset: start, endOffset: end,
        newText: CHARS[rng.int(CHARS.length)],
      }])
    }
    case 15:
      return { action: 'cut' }
    case 16:
      // 接受/拒绝修订只在追踪开启时有意义 (未追踪时返回 null, 不浪费执行预算)
      return f.editor.isTrackingChanges() ? { action: 'accept-all' } : null
    case 17:
      return f.editor.isTrackingChanges() ? { action: 'reject-all' } : null
    case 18:
      // 经 Editor 门面建批注 (锚点解析 + 铸造前取定 id/时间戳)
      return { action: 'create-comment' }
    case 19: {
      // 批注状态: open/reopened/resolved 三态, 撤销必须精确还原原状态
      const threads = f.editor.getDocument().comments ?? []
      if (threads.length === 0) return null
      const t = threads[rng.int(threads.length)]
      return new ResolveCommentCommand(
        generateCommandId(), nextTs(), 'user', t.id, rng.int(2) === 0,
      )
    }
    case 20: {
      // 块移动: 换容器下标 (body 内)。撤销必须移回原容器原下标
      const body = doc.body.children
      if (body.length < 2) return null
      const nodeId = body[rng.int(body.length)]
      return new MoveBlockCommand(
        generateCommandId(), nextTs(), 'user', nodeId, doc.id, rng.int(body.length),
      )
    }
    case 21: {
      // 插入节: 铸造节 + 初始段落 (MintedOnce), 撤销经 RemoveNodesCommand
      const idx = rng.int(doc.body.children.length + 1)
      return new InsertSectionCommand(generateCommandId(), nextTs(), 'user', doc.id, idx)
    }
    case 22: {
      // 批量绑定值: 整批一个撤销单元, 撤销按旧值逐节点还原
      const controls = controlNodes(f)
      if (controls.length === 0) return null
      // 去重: 真实调用侧按「键 → 唯一节点」解析, 同一节点不会在一批里出现两次
      const picked: { id: string }[] = []
      const pool2 = f.editor.getPool()
      for (const c of controls) {
        if (picked.some((x) => x.id === c.id)) continue
        if (pool2.nodes.get(c.id)) picked.push(c)
      }
      if (picked.length === 0) return null
      const count = 1 + rng.int(Math.min(2, picked.length))
      const entries = []
      for (let i = 0; i < count; i++) {
        const c = picked[(rng.int(picked.length) + i) % picked.length]
        const value: ControlValue | undefined = ['120/80', '118/76', 37.5, undefined][rng.int(4)]
        entries.push({ key: `bound-${i}`, nodeId: c.id, value })
      }
      return new SetBoundValuesCommand(generateCommandId(), nextTs(), 'user', entries)
    }
    case 23:
      return new AppendTableRowCommand(generateCommandId(), nextTs(), 'user', f.tableId)
    case 24: {
      // 文档标题: 落在 doc 顶层字段, 撤销必须精确还原原串
      return new UpdateDocumentTitleCommand(
        generateCommandId(), nextTs(), 'user', `闸门标题${rng.int(99)}`,
      )
    }
    case 25: {
      // 文档元数据: 整体替换/清除 (白名单字段由 normalizeDocumentMetadata 收口)
      const metas: DocumentMetadata[] = [
        { author: `user${rng.int(9)}` },
        { department: '内科', keywords: ['血压', '随访'] },
        {},
      ]
      return new UpdateDocumentPropertiesCommand(
        generateCommandId(), nextTs(), 'user', metas[rng.int(metas.length)],
      )
    }
    case 26: {
      // 页眉页脚变体开关: 改的是逐页变体解析, 撤销要精确回到旧组合
      return new SetHeaderFooterConfigCommand(generateCommandId(), nextTs(), 'user', {
        differentFirstPage: rng.int(2) === 0,
        differentOddEven: rng.int(2) === 0,
      })
    }
    case 27: {
      // 页面几何: 纸张/页边距变化会清分页状态, 撤销后版面与文档值一起还原
      const setups = [
        { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90 },
        { width: 595, height: 842, marginTop: 50, marginBottom: 50, marginLeft: 60, marginRight: 60 },
        { width: 1000, height: 700, marginTop: 40, marginBottom: 40, marginLeft: 40, marginRight: 40 },
      ]
      return new SetPageSetupCommand(generateCommandId(), nextTs(), 'user', { ...setups[rng.int(setups.length)] })
    }
    case 28: {
      // 节代码: undefined = 真删键 (匿名节), 撤销需区分「缺失」与「写 undefined」
      const section = [...pool.nodes.values()].find((n) => n.type === 'section') as { id: string } | undefined
      if (!section) return null
      return new UpdateSectionCommand(
        generateCommandId(), nextTs(), 'user', section.id,
        rng.int(4) === 0 ? undefined : `S${rng.int(9)}`,
      )
    }
    case 29: {
      // 控件语义层: element 整体替换 (含 text), 撤销按 element/text 双快照还原
      const controls = controlNodes(f)
      if (controls.length === 0) return null
      const c = controls[rng.int(controls.length)]
      const node = pool.nodes.get(c.id) as SmartTextNode | undefined
      if (!node?.element) return null
      const next = JSON.parse(JSON.stringify(node.element)) as ElementMeta
      next.name = `改名${rng.int(9)}`
      return new UpdateControlElementCommand(
        generateCommandId(), nextTs(), 'user', c.id, next, `[${next.name}]`,
      )
    }
    case 30: {
      // 设计期定义: 条目新增/改写/删除都由 store 快照逆操作还原 (快照含 store)
      const controls = controlNodes(f)
      if (controls.length === 0) return null
      const c = controls[rng.int(controls.length)]
      const defs = [{ controlType: 'input' as const }, { controlType: 'textarea' as const }, {}]
      return new UpdateControlDefinitionCommand(
        generateCommandId(), nextTs(), 'user', c.id, defs[rng.int(defs.length)],
      )
    }
    case 31: {
      // 批注回复: 追加到线程 comments 数组, 撤销按 reply id 精确摘除
      const threads = f.editor.getDocument().comments ?? []
      if (threads.length === 0) return null
      const t = threads[rng.int(threads.length)]
      return new AddCommentReplyCommand(
        generateCommandId(), nextTs(), 'user', t.id, `reply-${replySeq++}`, `已阅${rng.int(9)}`,
      )
    }
    case 32: {
      // 表格可增长标记: absent 与 false 在序列化上不等价 (契约 §12.9)
      return new SetTableGrowableCommand(
        generateCommandId(), nextTs(), 'user', f.tableId, rng.int(2) === 0,
      )
    }
    default:
      return new AppendTableRowCommand(generateCommandId(), nextTs(), 'user', f.tableId)
  }
}

// ---- 闸门 ----

function runGate(seed: number, target: number, tracking = false): void {
  const f = makeFixture()
  if (tracking) {
    // 修订追踪: 输入/删除都会留下标记, 接受/拒绝修订成为随机动作
    f.editor.setCurrentUser({ name: '审稿人', id: 'reviewer-1' })
    f.editor.setTrackChanges(true)
  }
  const rng = makeRng(seed)
  let ts = 1_700_000_000_000
  const nextTs = (): number => (ts += 1000)

  const snapshots: string[] = [snapshot(f)]
  const kinds: string[] = []
  const kindsSeen = new Set<string>()

  // 覆盖保证: 控件动作先确定性地各做一次, 再进入随机序列。
  // 只靠随机抽取的话, 表格结构操作可能先把夹具里的控件删光, 之后的控件
  // case 全部空转 —— 闸门看着覆盖了, 实际没跑 (假覆盖)。
  const prelude: RandomAction[] = []
  {
    const controls = controlNodes(f)
    if (controls.length > 0) {
      prelude.push(new SetControlValueCommand(
        generateCommandId(), nextTs(), 'user', controls[0].id, '120/80',
      ))
    }
    if (controls.length > 1) {
      prelude.push(new RemoveControlCommand(
        generateCommandId(), nextTs(), 'user', [f.doc.id, controls[1].paraId], controls[1].id,
      ))
    }
    // 批注/块移动/节/批量绑定 — 同样先确定性地各做一次, 防止随机序列把它们饿死
    {
      const firstPara = editableParagraphs(f)[0]
      const threadId = 'th-prelude'
      const markerId = 'mk-prelude'
      const range = { path: [f.doc.id, firstPara.id], offset: 0 }
      const createdAt = nextTs()
      prelude.push(new CreateCommentCommand(
        generateCommandId(), nextTs(), 'user', [f.doc.id, firstPara.id], 0,
        () => ({
          type: 'comment_marker', id: markerId, threadId, rangeStart: range, rangeEnd: range,
        } as unknown as BaseNode),
        () => ({
          id: threadId, rangeStart: range, rangeEnd: range, author: 'user',
          createdAt, status: 'open', baseVersion: 1, anchorStatus: 'valid', comments: [],
        } as unknown as CommentThread),
      ))
      // open → reopened: 撤销必须精确回到 open (不是笼统的"未解决")
      prelude.push(new ResolveCommentCommand(generateCommandId(), nextTs(), 'user', threadId, false))
    }
    {
      const body = f.editor.getDocument().body.children
      if (body.length > 1) {
        prelude.push(new MoveBlockCommand(
          generateCommandId(), nextTs(), 'user', body[body.length - 1], f.doc.id, 0,
        ))
      }
      prelude.push(new InsertSectionCommand(
        generateCommandId(), nextTs(), 'user', f.doc.id, 1,
      ))
    }
    {
      const controls = controlNodes(f)
      if (controls.length > 0) {
        prelude.push(new SetBoundValuesCommand(generateCommandId(), nextTs(), 'user', [
          { key: 'bound-prelude', nodeId: controls[0].id, value: '120/80' },
        ]))
      }
    }
    {
      // 文档级字段 / 页面几何 / 节 / 设计期定义 / 批注回复 / 表格标记 ——
      // 随机池扩到 34 种后每种都被稀释, 预演保证守卫断言的不是空转。
      const controls = controlNodes(f)
      prelude.push(new UpdateDocumentTitleCommand(generateCommandId(), nextTs(), 'user', '闸门标题'))
      prelude.push(new UpdateDocumentPropertiesCommand(generateCommandId(), nextTs(), 'user', { author: 'user' }))
      prelude.push(new SetHeaderFooterConfigCommand(generateCommandId(), nextTs(), 'user', { differentFirstPage: true }))
      prelude.push(new SetPageSetupCommand(generateCommandId(), nextTs(), 'user', {
        width: 700, height: 900, marginTop: 60, marginBottom: 60, marginLeft: 70, marginRight: 70,
      }))
      prelude.push({
        make: (fx) => {
          const section = [...fx.editor.getPool().nodes.values()]
            .find((n) => n.type === 'section') as { id: string } | undefined
          return section
            ? new UpdateSectionCommand(generateCommandId(), nextTs(), 'user', section.id, 'S-prelude')
            : null
        },
      })
      if (controls.length > 0) {
        prelude.push(new UpdateControlElementCommand(
          generateCommandId(), nextTs(), 'user', controls[0].id,
          { ...CONTROL_ELEMENT, name: '血压改' } as ElementMeta, '[血压改]',
        ))
        prelude.push(new UpdateControlDefinitionCommand(
          generateCommandId(), nextTs(), 'user', controls[0].id, { controlType: 'input' },
        ))
      }
      prelude.push(new AddCommentReplyCommand(
        generateCommandId(), nextTs(), 'user', 'th-prelude', 'reply-prelude', '已阅',
      ))
      prelude.push(new SetTableGrowableCommand(generateCommandId(), nextTs(), 'user', f.tableId, true))
    }
    // 动作池扩到 24 种后, 查找替换 / 复制粘贴 / 剪切在 60 步里可能抽不到 ——
    // 它们正是以前抓到过缺陷的动作, 不能因稀释而静默退出覆盖。各确定性做一次:
    // 替换放在剪切之前 (剪切可能把某段抽空); 粘贴只追加、不删字。
    {
      const withText = editableParagraphs(f).find((p) => textLengthOf(f, p) >= 1)
      if (withText) {
        prelude.push(new ReplaceTextCommand(generateCommandId(), nextTs(), 'user', [{
          paragraphPath: [f.doc.id, withText.id], startOffset: 0, endOffset: 1, newText: '甲',
        }]))
      }
      const anchor = withText ?? editableParagraphs(f)[0]
      if (anchor) {
        prelude.push(new InsertImageCommand(
          generateCommandId(), nextTs(), 'user', [f.doc.id, anchor.id], 0,
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          60, 40,
        ))
        const key = `fnprelude${footnoteSeq++}`
        prelude.push(new InsertFootnoteCommand(
          generateCommandId(), nextTs(), 'user', [f.doc.id, anchor.id], 0,
          (pool) => {
            const t = createTextNode(`脚注${key}`)
            const para = createParagraph([t.id])
            const content = {
              type: 'footnote_content', id: `fn-content-${key}`, refId: '', children: [para.id],
            } as unknown as FootnoteContent
            pool.addNode(t as unknown as BaseNode)
            pool.addNode(para as unknown as BaseNode)
            pool.addNode(content as unknown as BaseNode)
            return content
          },
          (contentId) => ({
            type: 'footnote_ref', id: `fn-ref-${key}`, refId: contentId, footnoteId: contentId,
          } as unknown as BaseNode),
        ))
      }
      prelude.push(new TableStructureCommand(
        generateCommandId(), nextTs(), 'user', f.tableId,
        (p) => { insertRow(p, f.tableId, 0); return true },
      ))
      prelude.push({ action: 'create-comment' })
      prelude.push({ action: 'copy-paste' })
      prelude.push({ action: 'cut' })
    }
  }

  let executed = 0
  let attempts = 0

  while (executed < target && attempts < target * 8) {
    attempts++
    const depthBefore = undoDepth(f)
    const pending = prelude.length > 0 ? prelude.shift()! : makeRandomCommand(f, rng, nextTs)
    if (!pending) continue
    // 延迟构造的动作 (需要执行时才知道目标 id) 在这里落成真实命令
    const action: ICommand | EditorAction | null = isFactoryAction(pending) ? pending.make(f) : pending
    if (!action) continue

    const kind = isEditorAction(action)
      ? (action.action === 'copy-paste' ? 'insert-nodes'
        : action.action === 'cut' ? 'cut'
        : action.action === 'create-comment' ? 'editor-create-comment'
        : action.action)
      : action.type
    if (isEditorAction(action)) {
      if (action.action === 'copy-paste') runCopyPaste(f, rng)
      else if (action.action === 'cut') runCut(f, rng)
      else if (action.action === 'create-comment') runEditorCreateComment(f, rng)
      else runRevisionDecision(f, action.action)
    } else {
      f.editor.execCommand(action)
    }
    const depthAfter = undoDepth(f)

    if (depthAfter === depthBefore + 1) {
      snapshots.push(snapshot(f))
      kinds.push(kind)
      kindsSeen.add(kind)
      executed++
      continue
    }

    // 未入栈: 命令 forward 失败 (或已合并 —— 本题时间戳间隔 1000ms, 不应发生).
    // 无论哪种, 文档都不应被改动, 栈深也不应变.
    expect(depthAfter, `seed ${seed} attempt ${attempts}: 栈深既未 +1 也未保持`).toBe(depthBefore)
    expect(snapshot(f), `seed ${seed} attempt ${attempts}: 未入栈却改了文档`)
      .toBe(snapshots[snapshots.length - 1])
  }
  expect(executed, `seed ${seed}: 未能生成足量会入栈的命令`).toBe(target)

  // 逐步撤销 —— 每一次都必须回到对应历史快照
  for (let k = snapshots.length - 1; k >= 1; k--) {
    f.editor.undo()
    expect(undoDepth(f), `seed ${seed} undo ${k}: 栈深`).toBe(k - 1)
    expect(snapshot(f), `seed ${seed} undo step ${k} (${kinds[k - 1]})`).toBe(snapshots[k - 1])
  }
  expect(f.editor.canUndo()).toBe(false)

  // 逐步重做 —— 每一次都必须回到前向快照
  for (let k = 1; k < snapshots.length; k++) {
    f.editor.redo()
    expect(snapshot(f), `seed ${seed} redo step ${k} (${kinds[k - 1]})`).toBe(snapshots[k])
  }
  expect(f.editor.canRedo()).toBe(false)

  // 假覆盖守卫: 控件动作必须真的入过栈 —— 否则新增 case 只是空转,
  // 闸门看起来覆盖了控件, 实际一条都没执行 (夹具/选择逻辑退化的典型症状)。
  expect(kindsSeen.has('set-control-value'), `seed ${seed}: 控件值变更从未入栈`).toBe(true)
  expect(kindsSeen.has('remove-control'), `seed ${seed}: 删除控件从未入栈`).toBe(true)
  expect(kindsSeen.has('table-structure'), `seed ${seed}: 表格结构操作从未入栈`).toBe(true)
  expect(kindsSeen.has('insert-image'), `seed ${seed}: 插入图片从未入栈`).toBe(true)
  expect(kindsSeen.has('insert-footnote'), `seed ${seed}: 插入脚注从未入栈`).toBe(true)
  expect(kindsSeen.has('insert-nodes'), `seed ${seed}: 复制粘贴从未入栈`).toBe(true)
  expect(kindsSeen.has('replace-text'), `seed ${seed}: 查找替换从未入栈`).toBe(true)
  expect(kindsSeen.has('cut'), `seed ${seed}: 剪切从未入栈`).toBe(true)
  expect(kindsSeen.has('create-comment'), `seed ${seed}: 创建批注从未入栈`).toBe(true)
  expect(kindsSeen.has('editor-create-comment'), `seed ${seed}: Editor 门面建批注从未入栈`).toBe(true)
  expect(kindsSeen.has('resolve-comment'), `seed ${seed}: 批注状态变更从未入栈`).toBe(true)
  expect(kindsSeen.has('move-block'), `seed ${seed}: 块移动从未入栈`).toBe(true)
  expect(kindsSeen.has('insert-section'), `seed ${seed}: 插入节从未入栈`).toBe(true)
  expect(kindsSeen.has('set-bound-values'), `seed ${seed}: 批量绑定值从未入栈`).toBe(true)
  expect(kindsSeen.has('update-document-title'), `seed ${seed}: 改标题从未入栈`).toBe(true)
  expect(kindsSeen.has('update-document-properties'), `seed ${seed}: 改文档属性从未入栈`).toBe(true)
  expect(kindsSeen.has('set-header-footer-config'), `seed ${seed}: 页眉页脚变体开关从未入栈`).toBe(true)
  expect(kindsSeen.has('set-page-setup'), `seed ${seed}: 页面几何从未入栈`).toBe(true)
  expect(kindsSeen.has('update-section'), `seed ${seed}: 节代码从未入栈`).toBe(true)
  expect(kindsSeen.has('update-control-element'), `seed ${seed}: 控件语义层从未入栈`).toBe(true)
  expect(kindsSeen.has('update-control-definition'), `seed ${seed}: 控件定义从未入栈`).toBe(true)
  expect(kindsSeen.has('add-comment-reply'), `seed ${seed}: 批注回复从未入栈`).toBe(true)
  expect(kindsSeen.has('set-table-growable'), `seed ${seed}: 表格可增长标记从未入栈`).toBe(true)
  if (tracking) {
    // 追踪模式下必须真的做过至少一次修订决定, 否则案例只是空转
    const decided = kindsSeen.has('accept-all') || kindsSeen.has('reject-all')
    expect(decided, `seed ${seed}: 接受/拒绝修订从未入栈`).toBe(true)
  }
}

describe('撤销/重做等价闸门 (契约 §8.2)', () => {
  it('随机 80 条混合命令: 逐步撤销/逐步重做与历史快照逐字节相同 (seed 20261020)', () => {
    runGate(20261020, 80)
  }, 120_000)

  it('随机 60 条混合命令: 另一条种子同样逐字节相同 (seed 777)', () => {
    runGate(777, 60)
  }, 120_000)

  it('修订追踪开启: 随机 60 条命令 (含接受/拒绝修订) 逐步撤销/重做一致 (seed 424242)', () => {
    runGate(424242, 60, true)
  }, 120_000)
})
