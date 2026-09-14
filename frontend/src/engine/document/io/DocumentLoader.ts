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
import { buildNodePool, type NodePool } from '../core/NodePool'
import { TemplateDefinitionStore } from '../../template/TemplateDefinition'
import type { TemplateDefinition } from '../../template/TemplateDefinition'
import { PresentationStyleStore } from '../../render/presentation/PresentationStyle'
import type { PresentationStyle } from '../../render/presentation/PresentationStyle'
import {
  CURRENT_DOCUMENT_VERSION,
  LEGACY_DOCUMENT_VERSION,
  parseVersion,
  versionToString,
  type DocumentFormatVersion,
} from '../version/DocumentFormatVersion'
import { modelUpgrader, type ModelUpgrader } from '../version/ModelUpgrader'

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
    throw new LoadError('parse', `JSON.parse 失败: ${(err as Error).message}`)
  }
  return loadDocumentFromObject(parsed, options)
}

/** 从已解析对象加载 (跳过 JSON.parse) */
export function loadDocumentFromObject(obj: unknown, options?: DocumentLoadOptions): DocumentLoadResult {
  const opts = options ?? {}
  const upgrader = opts.upgrader ?? modelUpgrader

  // ---- [1] detect ----
  if (!obj || typeof obj !== 'object') {
    throw new LoadError('detect', '文档必须是对象')
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
    throw new LoadError('upgrade', `升级失败: ${(err as Error).message}`)
  }
  recordUpgradePath(doc, sourceVer, upgradePath)

  // ---- [4] validate ----
  validateDocument(doc, opts.extraNodes)

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
): void {
  if (!doc.id || typeof doc.id !== 'string') {
    throw new LoadError('validate', 'doc.id 缺失或非字符串')
  }
  if (!doc.title || typeof doc.title !== 'string') {
    throw new LoadError('validate', 'doc.title 缺失或非字符串')
  }
  if (!doc.body || !Array.isArray(doc.body.children)) {
    throw new LoadError('validate', 'doc.body.children 缺失或非数组')
  }
  // metadata 若存在必须是普通对象 (契约 §7.7): 升级器已对 <4.3 做白名单收口,
  // 此处兜底拦截「已 4.3 但 metadata 是字符串/数组」这类脏数据。
  if (doc.metadata !== undefined &&
      (typeof doc.metadata !== 'object' || doc.metadata === null || Array.isArray(doc.metadata))) {
    throw new LoadError('validate', 'doc.metadata 非对象')
  }
  for (const id of validatedRootIds(doc)) {
    if (typeof id !== 'string') {
      throw new LoadError('validate', `children 包含非字符串引用: ${String(id)}`)
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
      throw new LoadError('validate', `引用悬空 (节点未在 nodes/extraNodes 中): ${id}`)
    }
  }
}

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