// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// DocumentLoader — 文档加载流水线 (架构 Phase 3, 2026-08-27)
//
// 6 步流水线:
//   1. detect          读取 modelVersion (缺失则视为 '1.0.0')
//   2. checkCompatibility 与 CURRENT_DOCUMENT_VERSION 比较
//   3. upgrade         链式 v_N → v_{N+1} → ... → CURRENT
//   4. validate        结构性验证 (必填字段, 引用不悬空)
//   5. buildModel      补默认字段 (header/footer/orientation)
//   6. buildPool       从 doc 重建 NodePool
//
// 设计文档: knowledge/document-version-system-design.md §2
// ================================================================

import type { BaseNode, DocumentTree } from '../core/DocumentModel'
import { NodeType } from '../core/DocumentModel'
import {
  CHILD_TYPES_OF, HEADER_FOOTER_CHILD_TYPES, illegalChildTypeMessage,
} from '../core/ContainerChildTypes'
import { buildNodePool, type NodePool } from '../core/NodePool'
import { TemplateDefinitionStore } from '../../template/TemplateDefinition'
import type { TemplateDefinition } from '../../template/TemplateDefinition'
import { PresentationStyleStore } from '../../render/presentation/PresentationStyle'
import type { PresentationStyle } from '../../render/presentation/PresentationStyle'
import {
  CURRENT_DOCUMENT_VERSION,
  LEGACY_DOCUMENT_VERSION,
  compareVersions,
  parseVersion,
  versionToString,
  type DocumentFormatVersion,
} from '../version/DocumentFormatVersion'
import { modelUpgrader, type ModelUpgrader } from '../version/ModelUpgrader'
import { locale } from '../../i18n/index'

// ---- 模板 store 顶层字段名 (契约 §12.1, 与 DocumentSerializer 保持一致) ----

const STORE_TEMPLATE_DEFS_FIELD = 'templateDefinitions'
const STORE_PRESENTATION_STYLES_FIELD = 'presentationStyles'

// ---- 错误类型 ----

export class LoadError extends Error {
  /** 错误阶段: detect / parse / compatibility / upgrade / validate / pool */
  phase: 'detect' | 'parse' | 'compatibility' | 'upgrade' | 'validate' | 'pool'

  constructor(phase: LoadError['phase'], message: string) {
    super(`[DocumentLoader.${phase}] ${message}`)
    this.name = 'LoadError'
    this.phase = phase
  }
}

// ---- 选项与结果 ----

export interface DocumentLoadOptions {
  /** 注入的升级器 (默认 module-singleton modelUpgrader) */
  upgrader?: ModelUpgrader
  /** 严格模式: 未知字段抛错 (默认 false, 容错) — 当前实现仅预留, 后续扩展 */
  strict?: boolean
  /** 加载器已从别处解析的额外节点 (HTML/Markdown 导入等) */
  extraNodes?: Map<string, BaseNode>
}

export interface DocumentLoadResult {
  /** 加载后的文档 (已升级到 CURRENT_DOCUMENT_VERSION) */
  doc: DocumentTree
  /** 重建的节点池 */
  pool: NodePool
  /** 加载时文档的实际版本 */
  sourceVersion: DocumentFormatVersion
  /** 是否经过了升级 (false 表示已是当前版本) */
  wasUpgraded: boolean
  /** 升级路径: ['1.0.0', '4.2.0'] — 当前实现仅记录首尾 */
  upgradePath: string[]
  /** 模板设计期 store (从 artifact 顶层字段读回, 缺失 → undefined) — 契约 §12.1 */
  templateDefinitions?: TemplateDefinitionStore
  /** 表现层 store (从 artifact 顶层字段读回, 缺失 → undefined) — 契约 §12.1 */
  presentationStyles?: PresentationStyleStore
}

// ---- 公共 API ----

/** 从 JSON 字符串加载文档 */
export function loadDocument(json: string, options?: DocumentLoadOptions): DocumentLoadResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    const m = (err as Error).message
    throw new LoadError('parse', locale.t('loader.parseFailed', { msg: m }))
  }
  return loadDocumentFromObject(parsed, options)
}

/** 从已解析对象加载 (跳过 JSON.parse) */
export function loadDocumentFromObject(obj: unknown, options?: DocumentLoadOptions): DocumentLoadResult {
  const opts = options ?? {}
  const upgrader = opts.upgrader ?? modelUpgrader

  // ---- [1] detect ----
  if (!obj || typeof obj !== 'object') {
    throw new LoadError('detect', locale.t('loader.notObject'))
  }
  const raw = obj as Record<string, unknown>
  const sourceVer = parseVersion((raw.modelVersion as string) ?? LEGACY_DOCUMENT_VERSION)

  // ---- [2] checkCompatibility ----
  const compat = upgrader.checkCompatibility(sourceVer)
  if (compat.status === 'too-new') {
    throw new LoadError('compatibility', compat.message)
  }

  // ---- [3] upgrade ----
  const upgradePath: string[] = []
  let doc: DocumentTree
  try {
    doc = upgrader.upgrade(raw as unknown as DocumentTree, CURRENT_DOCUMENT_VERSION)
  } catch (err) {
    const m = (err as Error).message
    throw new LoadError('upgrade', locale.t('loader.upgradeFailed', { msg: m }))
  }
  recordUpgradePath(doc, sourceVer, upgradePath)

  // ---- [4] validate ----
  // 传入 **sourceVer** 而非升级后的 modelVersion: 升级链会把 modelVersion 推到
  // CURRENT, 若用升级后的版本做"类型↔版本"一致性校验, 该校验恒真、形同虚设。
  // 谎报版本 / 缺失 modelVersion 的文档正是靠这一步被拦下 (契约 §31.12 X12)。
  validateDocument(doc, opts.extraNodes, sourceVer)

  // ---- [5] buildModel — 补默认字段 ----
  if (!doc.header) doc.header = []
  if (!doc.footer) doc.footer = []
  if (!doc.pageSetup) doc.pageSetup = { ...DEFAULT_PAGE_SETUP_LITERAL }
  if (!doc.pageSetup.orientation) doc.pageSetup.orientation = 'portrait'
  if (!doc.headerFooterConfig) doc.headerFooterConfig = { differentFirstPage: false, differentOddEven: false }

  // ---- [6] buildPool ----
  let pool: NodePool
  try {
    pool = buildPoolFromDocument(doc, opts.extraNodes)
  } catch (err) {
    throw new LoadError('pool', (err as Error).message)
  }

  return {
    doc,
    pool,
    sourceVersion: sourceVer,
    wasUpgraded: upgradePath.length > 0,
    upgradePath,
    templateDefinitions: readTemplateDefinitions(raw),
    presentationStyles: readPresentationStyles(raw),
  }
}

// ---- 内部辅助 ----

/** 记录升级路径 — 比较 source 与 final, 写 [source, final] (链式中间步骤未展开) */
function recordUpgradePath(
  doc: DocumentTree,
  sourceVer: DocumentFormatVersion,
  out: string[],
): void {
  const finalVer = parseVersion(doc.modelVersion ?? versionToString(CURRENT_DOCUMENT_VERSION))
  if (
    finalVer.major === sourceVer.major &&
    finalVer.minor === sourceVer.minor &&
    finalVer.patch === sourceVer.patch
  ) {
    return
  }
  out.push(versionToString(sourceVer), versionToString(finalVer))
}

/** 结构性验证 — 仅检查必填字段 + 引用不悬空, 不涉及业务语义 */
function validateDocument(
  doc: DocumentTree,
  extraNodes: Map<string, BaseNode> | undefined,
  sourceVersion: DocumentFormatVersion,
): void {
  if (!doc.id || typeof doc.id !== 'string') {
    throw new LoadError('validate', locale.t('loader.badDocId'))
  }
  if (!doc.title || typeof doc.title !== 'string') {
    throw new LoadError('validate', locale.t('loader.badDocTitle'))
  }
  if (!doc.body || !Array.isArray(doc.body.children)) {
    throw new LoadError('validate', locale.t('loader.badBodyChildren'))
  }
  // metadata 若存在必须是普通对象 (契约 §7.7): 升级器已对 <4.3 做白名单收口,
  // 此处兜底拦截「已 4.3 但 metadata 是字符串/数组」这类脏数据。
  if (doc.metadata !== undefined &&
      (typeof doc.metadata !== 'object' || doc.metadata === null || Array.isArray(doc.metadata))) {
    throw new LoadError('validate', locale.t('loader.badMetadata'))
  }
  for (const id of validatedRootIds(doc)) {
    if (typeof id !== 'string') {
      throw new LoadError('validate', locale.t('loader.badChildRef', { id: String(id) }))
    }
  }
  // 引用不悬空 (在 extraNodes 与 doc 自带 nodes 中都能找到)
  const knownIds = new Set<string>()
  const embedded = (doc as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes
  if (embedded && typeof embedded === 'object') {
    for (const id of Object.keys(embedded)) knownIds.add(id)
  }
  if (extraNodes) {
    for (const id of extraNodes.keys()) knownIds.add(id)
  }
  for (const id of validatedRootIds(doc)) {
    if (!knownIds.has(id)) {
      throw new LoadError('validate', locale.t('loader.danglingRef', { id }))
    }
  }

  // 结构语义 + 版本一致性 (契约 §31.12 X12 / §14)。
  // 版本闸门只挡"声称更新"的文档; 谎报旧版本 (或缺失 modelVersion 落到 LEGACY)
  // 却含新节点类型的文档必须在这里被拦住 —— 否则新节点会被下游静默丢弃。
  validateStructure(doc, knownIds, knownNodeOf(embedded, extraNodes), sourceVersion)
}

/**
 * 已知 id → 节点 (内嵌扁平表 + 加载器额外解析的节点)。
 * 供结构校验查类型; 两者都没有时返回 undefined (悬空引用已在上一步拦截)。
 */
function knownNodeOf(
  embedded: Record<string, BaseNode> | undefined,
  extraNodes: Map<string, BaseNode> | undefined,
): (id: string) => BaseNode | undefined {
  return (id) => extraNodes?.get(id) ?? embedded?.[id]
}

/** 已知的节点类型集合 — 未知类型即数据损坏 */
const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set<string>(Object.values(NodeType))

/** 结构深度上限 — 防环之外的兜底 (合法文档远达不到: 表→行→格→段→内联 = 5 层) */
const MAX_STRUCTURE_DEPTH = 100

/**
 * 结构语义校验 (契约 §31.12 X12 / §31.10 / §31.13):
 *
 *   1. 节点类型白名单 —— 未知类型不得进入引擎
 *   2. 单父归属 —— 同一节点被两个父引用会让逻辑流重复产出
 *   3. 环检测 —— 自引用/环状引用
 *   4. 深度上限 —— 兜底
 *   5. **modelVersion ↔ 节点类型一致性** —— Section 要求 >= 4.7.0
 *   6. **容器 ↔ 子节点类型** —— 契约 §31.13 的表, 逐层逐节点比对
 *
 * 前四项在 P0 即生效 (它们是"遍历器不会重复产出"的保证); 第五项是版本闸门
 * 之外的第二道防线。两者都要: 闸门挡"声称更新", 一致性校验挡"谎报旧版本"。
 *
 * 第六项是 §31.13 的**加载边界**: 非法持久化文档在任何节点可用之前就被拒,
 * 而不是先建进池、再由下游各自静默处理 (那正是格内 Section 让三个遍历器给出
 * 三种答案的成因)。父类型无契约的子节点 (如 paragraph 的内联类型, 本轮
 * deferred) 不在此判定。
 *
 * 页眉/页脚数组**不经 NodePool** (是 DocumentTree 的 string[] 字段), 故它们的
 * 子类型规则必须在这里单独施加 —— 此前它们与 body 拼在同一个数组里一起走,
 * 那正是不一致猜法的来源之一 (契约 §31.13)。
 */
function validateStructure(
  doc: DocumentTree,
  knownIds: ReadonlySet<string>,
  nodeOf: (id: string) => BaseNode | undefined,
  docVer: DocumentFormatVersion,
): void {
  const parentOf = new Map<string, string>()

  const walk = (
    ids: readonly string[],
    depth: number,
    owner: string,
    ownerType: string,
    allowed: ReadonlySet<string> | undefined,
  ): void => {
    if (depth > MAX_STRUCTURE_DEPTH) {
      throw new LoadError('validate', locale.t('loader.structureTooDeep', { max: String(MAX_STRUCTURE_DEPTH) }))
    }
    for (const id of ids) {
      if (!knownIds.has(id)) continue // 悬空引用已由上面的循环拦截
      const prev = parentOf.get(id)
      if (prev !== undefined) {
        throw new LoadError('validate', locale.t('loader.multiParent', { id, a: prev, b: owner }))
      }
      parentOf.set(id, owner)
      const node = nodeOf(id)
      if (!node) continue
      if (!KNOWN_NODE_TYPES.has(node.type)) {
        throw new LoadError('validate', locale.t('loader.unknownNodeType', { id, type: String(node.type) }))
      }
      // 契约 §31.13: 容器 ↔ 子节点类型 (非法即拒, 不静默跳过)。
      // 父类型无契约 (allowed 为 undefined) 时不越权判定。
      if (allowed && !allowed.has(node.type)) {
        throw new LoadError('validate', illegalChildTypeMessage(ownerType, node.type))
      }
      if (node.type === NodeType.SECTION && compareVersions(docVer, SECTION_MIN_VERSION) < 0) {
        throw new LoadError('validate', locale.t('loader.sectionVersionMismatch', {
          id, ver: versionToString(docVer), min: versionToString(SECTION_MIN_VERSION),
        }))
      }
      const children = (node as { children?: readonly string[] }).children
      if (Array.isArray(children)) {
        walk(children, depth + 1, id, node.type, CHILD_TYPES_OF.get(node.type))
      }
    }
  }

  // body 与各页眉/页脚变体是**两个不同的规则集**, 必须分头走 (契约 §31.13)。
  // 共用同一个 parentOf, 故跨区重复归属仍被第 2 项拦住。
  walk(doc.body.children, 1, doc.id, NodeType.DOCUMENT, CHILD_TYPES_OF.get(NodeType.DOCUMENT))
  for (const [variant, ids] of hfArraysOf(doc)) {
    walk(ids, 1, doc.id, variant, HEADER_FOOTER_CHILD_TYPES)
  }
}

/** 页眉/页脚全部变体数组 + 其区域名 (供校验消息指出是哪个区) */
function hfArraysOf(doc: DocumentTree): Array<[string, readonly string[]]> {
  return [
    ['header', doc.header ?? []],
    ['footer', doc.footer ?? []],
    ['firstPageHeader', doc.firstPageHeader ?? []],
    ['firstPageFooter', doc.firstPageFooter ?? []],
    ['evenPageHeader', doc.evenPageHeader ?? []],
    ['evenPageFooter', doc.evenPageFooter ?? []],
  ]
}

/** 引入 Section 节点类型的最低文档格式版本 (契约 §31.10 / §14) */
const SECTION_MIN_VERSION: DocumentFormatVersion = { major: 4, minor: 7, patch: 0 }

/**
 * 受校验的文档根 id 引用 — 正文 + 页眉/页脚全部变体 (契约 §7.9)。
 * 单一事实源, 供"引用类型校验"与"引用不悬空校验"共用。
 * 脚注/尾注沿用既有行为 (不在此列)。
 */
function validatedRootIds(doc: DocumentTree): string[] {
  return [
    ...doc.body.children,
    ...(doc.header ?? []), ...(doc.footer ?? []),
    ...(doc.firstPageHeader ?? []), ...(doc.firstPageFooter ?? []),
    ...(doc.evenPageHeader ?? []), ...(doc.evenPageFooter ?? []),
  ]
}

/** 从 DocumentTree 重建 NodePool */
function buildPoolFromDocument(
  doc: DocumentTree,
  extraNodes: Map<string, BaseNode> | undefined,
): NodePool {
  const flat = new Map<string, BaseNode>()

  // 优先: extraNodes (加载器已单独解析的节点)
  if (extraNodes) {
    for (const [id, node] of extraNodes) flat.set(id, node)
  }

  // 其次: doc.nodes 内嵌字段 (本模块 serializeDocument 产物)
  const embedded = (doc as DocumentTree & { nodes?: Record<string, BaseNode> }).nodes
  if (embedded && typeof embedded === 'object') {
    for (const [id, node] of Object.entries(embedded)) {
      if (!flat.has(id)) flat.set(id, node)
    }
  }

  // doc 本身必须注册 (buildNodePool Pass 3 校验 body 根存在)
  // 注: doc 以根节点身份入池; 其文档级 metadata (DocumentMetadata) 与
  // 节点级 BaseNode.metadata (Record<string,unknown>) 语义不同, 故显式收窄为 BaseNode。
  flat.set(doc.id, doc as unknown as BaseNode)

  const present = (ids: string[] | undefined): string[] => (ids ?? []).filter(id => flat.has(id))

  return buildNodePool(flat, {
    body: doc.id,
    header: present(doc.header),
    footer: present(doc.footer),
    firstPageHeader: present(doc.firstPageHeader),
    firstPageFooter: present(doc.firstPageFooter),
    evenPageHeader: present(doc.evenPageHeader),
    evenPageFooter: present(doc.evenPageFooter),
    footnotes: present(doc.footnotes),
    endnotes: present(doc.endnotes),
  })
}

/** 内联默认 PageSetup (避免引入循环依赖到 DocumentModel.DEFAULT_PAGE_SETUP) */
const DEFAULT_PAGE_SETUP_LITERAL = {
  width: 794,
  height: 1123,
  marginTop: 72,
  marginBottom: 72,
  marginLeft: 90,
  marginRight: 90,
  orientation: 'portrait' as const,
}

// ---- 模板 store 读回 (契约 §12.1) ----

/** 从 artifact 顶层字段读回 TemplateDefinitionStore (缺失/空 → undefined) */
function readTemplateDefinitions(raw: Record<string, unknown>): TemplateDefinitionStore | undefined {
  const field = raw[STORE_TEMPLATE_DEFS_FIELD]
  if (!field || typeof field !== 'object') return undefined
  const store = new TemplateDefinitionStore()
  for (const [id, def] of Object.entries(field as Record<string, unknown>)) {
    if (def && typeof def === 'object') store.set(id, def as TemplateDefinition)
  }
  return store.size > 0 ? store : undefined
}

/** 从 artifact 顶层字段读回 PresentationStyleStore (缺失/空 → undefined) */
function readPresentationStyles(raw: Record<string, unknown>): PresentationStyleStore | undefined {
  const field = raw[STORE_PRESENTATION_STYLES_FIELD]
  if (!field || typeof field !== 'object') return undefined
  const store = new PresentationStyleStore()
  for (const [id, style] of Object.entries(field as Record<string, unknown>)) {
    if (style && typeof style === 'object') store.set(id, style as PresentationStyle)
  }
  return store.size > 0 ? store : undefined
}