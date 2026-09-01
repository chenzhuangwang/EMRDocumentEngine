// ================================================================
// DocumentSerializer — 文档序列化 (节点扁平表嵌入)
//
// 背景 (footer 无法输入根因修复):
//   DocumentTree 是纯 ID 引用结构 (body.children / header / footer 只存 id),
//   而真实的节点对象 (Paragraph / TextNode / Table ...) 存放在 NodePool 中。
//   旧实现保存时只 JSON.stringify(doc), 丢失了全部节点 payload;
//   加载时 buildNodePool 只注册 doc.id, 导致 InsertTextCommand.forward
//   找不到段落 → 页脚/正文均无法输入。
//
// 本模块 (Phase 3 后) 只负责写出 (serialize):
//   - collectDocumentNodes: 从 pool 收集 doc 可达的全部节点 → 扁平 Map
//   - serializeDocument:    序列化为 JSON 字符串
//                            (DocumentTree + nodes 扁平表 + 显式 modelVersion)
//
// 模板 artifact 扩展 (契约 §12.1):
//   序列化时把两个 per-editor store 作为 TOP-LEVEL 字段一并写出
//   (templateDefinitions / presentationStyles), 与 nodes 平级, 绝不混入
//   节点 payload。见 serializeDocument 的 stores 参数。
//
// 加载链路已迁移至 DocumentLoader:
//   loadDocument(json) / loadDocumentFromObject(obj, options)
//   — 负责 detect / checkCompatibility / upgrade / validate / buildModel / buildPool,
//     并读回上述两个顶层字段到 DocumentLoadResult。
//
// 反序列化测试不再覆盖本模块 — 见 __tests__/DocumentLoader.test.ts。
// ================================================================

import type { BaseNode, DocumentTree } from '../core/DocumentModel'
import type { NodePool } from '../core/NodePool'
import { versionToString, CURRENT_DOCUMENT_VERSION } from '../version/DocumentFormatVersion'
import type { TemplateDefinitionStore } from '../../template/TemplateDefinition'
import type { PresentationStyleStore } from '../../render/presentation/PresentationStyle'

/** 序列化时附在 DocumentTree 上的扁平节点表字段名 */
const NODES_FIELD = 'nodes'

/** 序列化时附在 DocumentTree 上的模板设计期字段 (顶层, 契约 §12.1) */
const TEMPLATE_DEFS_FIELD = 'templateDefinitions'

/** 序列化时附在 DocumentTree 上的表现层字段 (顶层, 契约 §12.1) */
const PRESENTATION_STYLES_FIELD = 'presentationStyles'

/** 序列化时写入的 modelVersion (Phase 3 起显式声明) */
const MODEL_VERSION_STRING = versionToString(CURRENT_DOCUMENT_VERSION)

/** serializeDocument 的 store 参数 (可选, 缺省表示纯 record 不含设计期/表现层字段) */
export interface SerializeStores {
  templateDefinitions?: TemplateDefinitionStore
  presentationStyles?: PresentationStyleStore
}

/**
 * 收集文档可达的全部节点 (不含 doc 本身), 返回扁平 Map。
 *
 * 遍历入口: body.children + header / footer / footnotes / endnotes,
 * 随后沿每个节点的 children 递归 (覆盖表格 → 行 → 单元格 → 段落 → 内联节点)。
 */
export function collectDocumentNodes(doc: DocumentTree, pool: NodePool): Map<string, BaseNode> {
  const result = new Map<string, BaseNode>()
  const visited = new Set<string>()

  const visit = (id: string | undefined | null): void => {
    if (!id || visited.has(id)) return
    visited.add(id)
    const node = pool.nodes.get(id)
    if (!node) return
    result.set(id, node)
    const children = (node as { children?: readonly string[] }).children
    if (Array.isArray(children)) {
      for (const cid of children) visit(cid)
    }
  }

  for (const cid of doc.body.children) visit(cid)
  for (const ids of [doc.header, doc.footer, doc.footnotes, doc.endnotes]) {
    if (Array.isArray(ids)) for (const id of ids) visit(id)
  }

  return result
}

/** store → { [nodeId]: def } 普通对象 (供 JSON 序列化) */
function storeToObject<T>(store: { entries(): IterableIterator<[string, T]> }): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [id, def] of store.entries()) out[id] = def
  return out
}

/**
 * 序列化为 JSON 字符串。
 *
 * 输出结构: { ...DocumentTree, modelVersion: '4.2.0', nodes: { [id]: nodeObject },
 *             templateDefinitions?: { [nodeId]: def },
 *             presentationStyles?: { [nodeId]: style } }
 * 扁平表包含 doc 可达的全部节点 payload, 供 DocumentLoader 重建 NodePool;
 * 两个 store (契约 §12.1) 作为顶层字段 SIBLING 于 nodes, 绝不写入节点 payload。
 */
export function serializeDocument(doc: DocumentTree, pool: NodePool, stores?: SerializeStores): string {
  const nodes: Record<string, BaseNode> = {}
  for (const [id, node] of collectDocumentNodes(doc, pool)) {
    nodes[id] = node
  }

  const out: Record<string, unknown> = {
    ...doc,
    modelVersion: MODEL_VERSION_STRING,
    [NODES_FIELD]: nodes,
  }

  if (stores?.templateDefinitions && stores.templateDefinitions.size > 0) {
    out[TEMPLATE_DEFS_FIELD] = storeToObject(stores.templateDefinitions)
  }
  if (stores?.presentationStyles && stores.presentationStyles.size > 0) {
    out[PRESENTATION_STYLES_FIELD] = storeToObject(stores.presentationStyles)
  }

  return JSON.stringify(out)
}
