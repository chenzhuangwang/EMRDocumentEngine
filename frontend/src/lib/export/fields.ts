// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// fields — 文档 → 字段清单的**语义投影** (导出特性层, 纯函数)
//
// 三个新导出格式 (结构化元素 JSON / HL7 CDA XML / OFD 结构化数据区) 都要回答
// 同一组问题: 哪些节点算字段? 它的数据元码、名称、值、显示值、候选、所属节是
// 什么? 这份投影就是那**唯一一份**答案 —— 写三遍必然漂移 (契约 §11/§12)。
//
// 显示值: 有候选表就走候选表映射 (枚举值 → 候选 name, 如 'N' → '未婚')。
// **不得改用 smartTextDisplayValue** —— 那个函数返回**原样存储的机器码**
// (如婚姻的 'N'), 而屏幕上渲染的是 '未婚'; 用它会让导出件与屏幕上看到的不一致。
// 既有 TXT/HTML 导出正因此把 '婚姻：N' 写进导出稿 —— 那是既有缺陷, 本轮不改它,
// 但新模块不许复制。字典型枚举与渲染口径的差异见 resolveDisplay 的说明。
//
// 遍历口径 (契约 §31): body 走 bodyParagraphSpine (W3, 含 Section 就地展开与
// 表格 cell 展开), 页眉页脚走 hfParagraphsForExport。**不碰 doc.body.children**
// —— DocumentWalkGate 是 CI 硬闸门。
// ============================================================

import {
  bodyParagraphSpine, hfParagraphsForExport, sectionOf,
} from '@/engine'
import type { ElementEnumOption, ElementMeta, ControlValue } from '@/engine/document/core/DocumentModel'

/** 导出期读取池的最小结构 (只读; 结构上满足引擎的 SpinePool, 契约 §31) */
export interface FieldPool {
  nodes: ReadonlyMap<string, { type: string; children?: readonly string[] }>
}

/** 字段所在区域 */
export type FieldRegion = 'body' | 'header' | 'footer'

interface SmartTextLike {
  type?: string
  text?: string
  value?: ControlValue
  element?: ElementMeta
}

interface ContainerLike {
  type?: string
  children?: readonly string[]
}

export interface FieldLocation {
  /** 所属表格节点 id; 非表格内字段为 null */
  tableId: string | null
  /** 单元格下标; 非表格内字段为 null */
  cellIndex: { row: number; col: number } | null
}

export interface FieldRecord {
  /** 控件节点 id —— 唯一标识, 也是与 OFD 几何对象相认的键 */
  nodeId: string
  /** 全文阅读顺序 (0-based), 跨区域连续 */
  order: number
  name: string
  /** 未填时的显示形式 (含方括号, 如 '[姓名]') */
  placeholder: string
  region: FieldRegion
  sectionId: string | null
  sectionCode: string | null
  location: FieldLocation
  code: { internal: string; dataElement: string }
  /** 设计期 widget 形态 (来自 TemplateDefinition, 按 nodeId 关联); 无则 null */
  controlType: string | null
  dataType: string | null
  /** 运行期值, **原样**(机器码); 未填为 null */
  value: ControlValue | null
  /** 显示值 (枚举值映射回候选 name 后)。见 resolveDisplay 关于字典型枚举的说明 */
  display: string
  /** display 是怎么来的 —— 'raw' 表示该值没能映射成显示名 */
  displaySource: DisplaySource
  /** 是否已填 (undefined / '' / [] 视为未填) */
  filled: boolean
  multiple: boolean
  /** 隐私标记: true 表示该字段受脱敏策略保护。本轮**仍导出真实值**, 此标记供下游识别 */
  masked: boolean
  required: boolean
  readonly: boolean
  /** 枚举候选 (与控件定义同源); 无枚举为 null */
  enumOptions: ElementEnumOption[] | null
  format: {
    showType: string | null
    minLength: number | null
    maxLength: number | null
    dictionary: string | null
    scale: number | null
    minRows: number | null
  }
  /** 设计期属性 (TemplateDefinition); 无则各字段为 null */
  definition: {
    label: string | null
    prefix: string | null
    suffix: string | null
    tips: string | null
    single: boolean | null
    editable: boolean | null
    deletable: boolean | null
  }
}

export interface SectionRecord {
  id: string
  code: string | null
  depth: number
  parentId: string | null
  /** 无 sectionCode 的节 —— 结构化导出里不可按码定位, 必须显式标记而非丢弃 */
  anonymous: boolean
  /** 该 code 在文档中出现了不止一次 (契约 §31.14.10 记录唯一性未强制) */
  codeDuplicate: boolean
}

export interface FieldProjection {
  fields: FieldRecord[]
  sections: SectionRecord[]
  diagnostics: {
    fieldCount: number
    filledCount: number
    /** 出现次数 > 1 的 dataElement 码 (本仓库的 mock 文档编码是退化样本) */
    duplicateElementCodes: string[]
  }
}

/** 设计期属性 (TemplateDefinition) 的最小结构 —— 不引入 engine 的具体容器类 */
export interface TemplateDefinitionLike {
  controlType?: string
  label?: string
  prefix?: string
  suffix?: string
  tips?: string
  single?: boolean
  editable?: boolean
  deletable?: boolean
}

/**
 * 设计期属性来源。
 *
 * 结构类型而非 `ReadonlyMap`: 引擎侧的 TemplateDefinitionStore 是**类** (只保证
 * `get`), 而测试夹具用 Map —— 两边都该能用, 不该为此把仓库里的容器改型。
 */
export interface TemplateDefinitionSource {
  get(nodeId: string): TemplateDefinitionLike | undefined
}

export interface FieldProjectionInput {
  doc: {
    id?: string
    title?: string
    body: { children: readonly string[] }
  }
  pool: FieldPool
  /** 设计期属性来源 (按节点 id); 缺省表示文档无该层 */
  templateDefinitions?: TemplateDefinitionSource
  /**
   * 字典型枚举的候选取值器 (inline `format.enums` 之外的来源)。
   *
   * 注入而非直接读 Editor 的私有 dictionaries: 与 documentExport 的
   * `exportFieldContext(doc, now)` 同思路 —— 保持本模块纯函数、可测。
   * UI 侧可接到 Editor.getControlSnapshot(nodeId).options。
   */
  optionsOf?: (nodeId: string) => readonly ElementEnumOption[] | undefined
  /** 文档级节投影 (来自 sectionTreeOf); 缺省则 sections 为空数组 */
  sectionTree?: readonly {
    id: string
    depth: number
    parentId: string | null
    sectionCode?: string
  }[]
}

/** 「未填」的规范判据 (契约 §12.6.1): undefined / '' / [] 都是未填 */
function isUnfilled(value: ControlValue | undefined): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

/** 枚举候选: 与 Editor.getControlSnapshot 同一条规则 —— inline 存在则用它, 否则用字典型来源 */
function enumOptionsFor(
  nodeId: string,
  element: ElementMeta | undefined,
  optionsOf?: FieldProjectionInput['optionsOf'],
): ElementEnumOption[] | null {
  const inline = element?.format?.enums
  if (inline !== undefined) {
    return inline.data && inline.data.length > 0 ? inline.data : null
  }
  const external = optionsOf?.(nodeId)
  return external && external.length > 0 ? [...external] : null
}

/** 显示值来源 —— 让「为什么这一条是机器码」可判定, 而不是靠猜 */
export type DisplaySource =
  /** 未填, display 是占位符 */
  | 'placeholder'
  /** 值经候选表映射成了显示名 */
  | 'enum'
  /** 值未经映射原样输出 (无候选表, 或候选表里查不到该码) */
  | 'raw'

interface DisplayResult {
  display: string
  source: DisplaySource
}

/**
 * 值 → 显示文本。
 *
 * 与渲染口径的关系: 有 **inline** 枚举时本函数与 `controlValueDisplay` 逐字一致
 * (屏幕也这么显示)。差别只在**字典型枚举**上 —— 渲染路径 (LayoutEngine →
 * controlValueDisplay) 只读 `format.enums.data`, 读不到字典, 因此屏幕会把机器码
 * 原样画出来; 这里改用已解析的候选表 (含注入的字典候选), 于是能给出显示名。
 *
 * 这是**刻意的**: 结构化导出是数据路径, 用户要的就是「机器码 + 显示名都给」;
 * 屏幕上字典枚举显示成码是本引擎的一处渲染缺口 (本轮范围外, 已记录), 导出不必
 * 复制它。`displaySource` 让这一差异可被下游识别。
 */
function resolveDisplay(
  value: ControlValue | undefined,
  placeholder: string,
  options: ElementEnumOption[] | null,
): DisplayResult {
  if (value === undefined || value === '') return { display: placeholder, source: 'placeholder' }
  if (typeof value === 'number') return { display: String(value), source: 'raw' }

  const nameOf = (v: string): { text: string; matched: boolean } => {
    const hit = options?.find((o) => o.value === v)
    return hit ? { text: hit.name, matched: true } : { text: v, matched: false }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return { display: placeholder, source: 'placeholder' }
    const mapped = value.map(nameOf)
    return {
      display: mapped.map((m) => m.text).join('、'),
      source: mapped.some((m) => m.matched) ? 'enum' : 'raw',
    }
  }

  const m = nameOf(value)
  return { display: m.text, source: m.matched ? 'enum' : 'raw' }
}

/**
 * 一次遍历建立 child → parent 索引, 用于解析字段的表格归属。
 *
 * 这是**亲和性解析**(这个节点住在哪个容器里), 不是阅读顺序 —— 契约 §31 禁止
 * 越权的是后者。顺序一律来自 bodyParagraphSpine / hfParagraphsForExport。
 */
function buildParentIndex(pool: FieldPool): Map<string, string> {
  const parent = new Map<string, string>()
  for (const [id, node] of pool.nodes) {
    for (const childId of node.children ?? []) {
      if (!parent.has(childId)) parent.set(childId, id)
    }
  }
  return parent
}

/** 沿 parent 索引上溯, 找最近的 cell 祖先并返回其 (table, cellIndex) 归属 */
function resolveLocation(
  nodeId: string,
  pool: FieldPool,
  parentIndex: Map<string, string>,
): FieldLocation {
  let current = parentIndex.get(nodeId)
  const seen = new Set<string>([nodeId])
  while (current && !seen.has(current)) {
    seen.add(current)
    const node = pool.nodes.get(current) as ContainerLike | undefined
    if (node?.type === 'cell') {
      // cell 的父是 row, row 的父是 table
      const rowId = parentIndex.get(current)
      const tableId = rowId ? parentIndex.get(rowId) ?? null : null
      let cellIndex: { row: number; col: number } | null = null
      if (rowId && tableId) {
        const table = pool.nodes.get(tableId) as ContainerLike | undefined
        const rowIdx = (table?.children ?? []).indexOf(rowId)
        const row = pool.nodes.get(rowId) as ContainerLike | undefined
        const colIdx = (row?.children ?? []).indexOf(current)
        if (rowIdx >= 0 && colIdx >= 0) cellIndex = { row: rowIdx, col: colIdx }
      }
      return { tableId, cellIndex }
    }
    current = parentIndex.get(current)
  }
  return { tableId: null, cellIndex: null }
}

/** 段落的子节点里, 哪些是 smarttext 字段 (按阅读顺序) */
function smartTextChildrenOf(paraId: string, pool: FieldPool): string[] {
  const para = pool.nodes.get(paraId) as ContainerLike | undefined
  const out: string[] = []
  for (const childId of para?.children ?? []) {
    const child = pool.nodes.get(childId) as SmartTextLike | undefined
    if (child?.type === 'smarttext') out.push(childId)
  }
  return out
}

function buildField(
  nodeId: string,
  order: number,
  region: FieldRegion,
  paraId: string,
  input: FieldProjectionInput,
  parentIndex: Map<string, string>,
): FieldRecord {
  const node = (input.pool.nodes.get(nodeId) ?? {}) as SmartTextLike
  const element = node.element
  const value = node.value
  const filled = !isUnfilled(value)
  const placeholder = node.text ?? ''
  const sectionId = sectionOf(paraId, input.pool)
  const sectionCode = sectionId
    ? (input.pool.nodes.get(sectionId) as { sectionCode?: string } | undefined)?.sectionCode ?? null
    : null
  const def = input.templateDefinitions?.get(nodeId)
  const format = element?.format
  const enumOptions = enumOptionsFor(nodeId, element, input.optionsOf)
  const { display, source: displaySource } = resolveDisplay(value, placeholder, enumOptions)

  return {
    nodeId,
    order,
    name: element?.name ?? '',
    placeholder,
    region,
    sectionId,
    sectionCode,
    location: resolveLocation(nodeId, input.pool, parentIndex),
    code: {
      internal: element?.code?.internal ?? '',
      dataElement: element?.code?.dataElement ?? '',
    },
    controlType: def?.controlType ?? null,
    dataType: format?.dataType ?? null,
    // 未填导出 null 而非 undefined: JSON.stringify 会静默吞掉 undefined,
    // 下游就分不清「字段不存在」和「字段没填」。
    value: filled ? value! : null,
    display,
    displaySource,
    filled,
    multiple: format?.enums?.multiple === true,
    masked: element?.privacy?.enabled === true,
    required: element?.required === true,
    readonly: element?.readonly === true,
    enumOptions,
    format: {
      showType: format?.showType ?? null,
      minLength: format?.minLength ?? null,
      maxLength: format?.maxLength ?? null,
      dictionary: format?.dictionary ?? null,
      scale: format?.scale ?? null,
      minRows: format?.minRows ?? null,
    },
    definition: {
      label: def?.label ?? null,
      prefix: def?.prefix ?? null,
      suffix: def?.suffix ?? null,
      tips: def?.tips ?? null,
      single: def?.single ?? null,
      editable: def?.editable ?? null,
      deletable: def?.deletable ?? null,
    },
  }
}

/** 按区域收集字段 (阅读顺序), order 跨区域连续 */
function collectRegion(
  paraIds: readonly string[],
  region: FieldRegion,
  input: FieldProjectionInput,
  parentIndex: Map<string, string>,
  startOrder: number,
): { fields: FieldRecord[]; nextOrder: number } {
  const fields: FieldRecord[] = []
  let order = startOrder
  for (const paraId of paraIds) {
    for (const nodeId of smartTextChildrenOf(paraId, input.pool)) {
      fields.push(buildField(nodeId, order++, region, paraId, input, parentIndex))
    }
  }
  return { fields, nextOrder: order }
}

/**
 * 文档 → 字段清单。
 *
 * 未填字段**不过滤**: 一个字段的「未填」是有意义的事实 (CDA 要出 nullFlavor,
 * JSON 要出 filled:false), 过滤掉会让下游无法区分「没有这个字段」与「没填」。
 */
export function collectFields(input: FieldProjectionInput): FieldProjection {
  const parentIndex = buildParentIndex(input.pool)

  const sections: SectionRecord[] = (input.sectionTree ?? []).map((entry) => {
    const code = entry.sectionCode ?? null
    return {
      id: entry.id,
      code,
      depth: entry.depth,
      parentId: entry.parentId,
      anonymous: code === null,
      codeDuplicate: false, // 下方按 code 计数回填
    }
  })
  const codeCount = new Map<string, number>()
  for (const s of sections) {
    if (s.code !== null) codeCount.set(s.code, (codeCount.get(s.code) ?? 0) + 1)
  }
  for (const s of sections) {
    if (s.code !== null && (codeCount.get(s.code) ?? 0) > 1) s.codeDuplicate = true
  }

  const body = collectRegion(bodyParagraphSpine(input.doc as never, input.pool), 'body', input, parentIndex, 0)
  const header = collectRegion(hfParagraphsForExport(input.doc as never, 'header'), 'header', input, parentIndex, body.nextOrder)
  const footer = collectRegion(hfParagraphsForExport(input.doc as never, 'footer'), 'footer', input, parentIndex, header.nextOrder)

  const fields = [...body.fields, ...header.fields, ...footer.fields]

  const deCount = new Map<string, number>()
  for (const f of fields) {
    if (!f.code.dataElement) continue
    deCount.set(f.code.dataElement, (deCount.get(f.code.dataElement) ?? 0) + 1)
  }
  const duplicateElementCodes = [...deCount.entries()].filter(([, n]) => n > 1).map(([code]) => code).sort()

  return {
    fields,
    sections,
    diagnostics: {
      fieldCount: fields.length,
      filledCount: fields.filter((f) => f.filled).length,
      duplicateElementCodes,
    },
  }
}
