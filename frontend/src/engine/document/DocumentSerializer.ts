// ================================================================
// DocumentSerializer — 文档序列化/反序列化 (节点扁平表嵌入)
//
// 背景 (footer 无法输入根因修复):
//   DocumentTree 是纯 ID 引用结构 (body.children / header / footer 只存 id),
//   而真实的节点对象 (Paragraph / TextNode / Table ...) 存放在 NodePool 中。
//   旧实现保存时只 JSON.stringify(doc), 丢失了全部节点 payload;
//   加载时 buildNodePool 只注册 doc.id, 导致 InsertTextCommand.forward
//   找不到段落 → 页脚/正文均无法输入。
//
// 本模块提供:
//   - collectDocumentNodes: 从 pool 收集 doc 可达的全部节点 → 扁平 Map (保存用)
//   - serializeDocument:    序列化为 JSON 字符串 (DocumentTree + nodes 扁平表)
//   - buildDocumentPool:    从 DocumentTree 构建 NodePool (加载用, 兼容旧数据)
// ================================================================

import type { BaseNode, DocumentTree } from './DocumentModel'
import { buildNodePool, type NodePool } from './NodePool'

/** 序列化时附在 DocumentTree 上的扁平节点表字段名 */
const NODES_FIELD = 'nodes'

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
    const children = (node as { children?: string[] }).children
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

/**
 * 序列化为 JSON 字符串。
 *
 * 输出结构: { ...DocumentTree, nodes: { [id]: nodeObject } }
 * 扁平表包含 doc 可达的全部节点 payload, 供加载时重建 NodePool。
 */
export function serializeDocument(doc: DocumentTree, pool: NodePool): string {
  const nodes: Record<string, BaseNode> = {}
  for (const [id, node] of collectDocumentNodes(doc, pool)) {
    nodes[id] = node
  }
  return JSON.stringify({ ...doc, [NODES_FIELD]: nodes })
}

/**
 * 从 DocumentTree 构建 NodePool。
 *
 * 若 doc 上内嵌 nodes 字段 (本模块序列化产物) 则一并注册;
 * 兼容旧版无节点 payload 的数据 (仅注册 doc 本身, 由调用方兜底)。
 * extraNodes 用于加载器已单独返回节点映射的场景 (HTML/Markdown 导入)。
 */
export function buildDocumentPool(
  doc: DocumentTree,
  extraNodes?: Map<string, BaseNode>,
): NodePool {
  // 兼容旧数据: 确保 header/footer/body 字段存在
  if (!doc.header) doc.header = []
  if (!doc.footer) doc.footer = []
  if (!doc.body) doc.body = { mode: 'flow', children: [] }

  const nodes = new Map<string, BaseNode>()

  const embedded = (doc as DocumentTree & { [NODES_FIELD]?: Record<string, BaseNode> })[NODES_FIELD]
  if (embedded && typeof embedded === 'object') {
    for (const [id, node] of Object.entries(embedded)) {
      nodes.set(id, node)
    }
  }

  if (extraNodes) {
    for (const [id, node] of extraNodes) {
      nodes.set(id, node)
    }
  }

  // doc 本身必须注册 (buildNodePool Pass 3 校验 body 根存在)
  nodes.set(doc.id, doc)

  // 仅保留已注册到节点表的 root ID, 避免旧数据 (无节点 payload) 的悬空引用触发
  // Pass 3 的 "Root node not found" 校验抛异常 (旧数据本就无法编辑, 应优雅降级)
  const present = (ids: string[] | undefined): string[] => (ids ?? []).filter(id => nodes.has(id))

  return buildNodePool(nodes, {
    body: doc.id,
    header: present(doc.header),
    footer: present(doc.footer),
    footnotes: present(doc.footnotes),
    endnotes: present(doc.endnotes),
  })
}
