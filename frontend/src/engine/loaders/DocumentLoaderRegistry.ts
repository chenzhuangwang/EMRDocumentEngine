// ============================================================
// DocumentLoader — 多格式文档加载器 (R63, v6.0)
//
// IDocumentLoader + DocumentLoaderRegistry
// JSON/XML/HTML/Markdown 格式自动检测 + 路由
// ============================================================

import type { DocumentTree, BaseNode } from '../document/core/DocumentModel'
import { NodeType, generateId } from '../document/core/DocumentModel'

// ---- 加载结果 ----

export interface LoadResult {
  doc: DocumentTree
  /** 所有节点的映射 (用于构建 NodePool) */
  nodes: Map<string, BaseNode>
}

// ---- 加载器接口 ----

export interface IDocumentLoader {
  /** 支持的文件扩展名列表 (含 '.') */
  readonly extensions: string[]
  /** 加载器名称 */
  readonly name: string
  /** 从文本内容加载为 DocumentTree + nodes */
  load(content: string, fileName?: string): LoadResult
  /** 检测是否可处理此内容 (通过文件头/内容特征) */
  detect?(content: string): boolean
}

// ---- 注册表 ----

export class DocumentLoaderRegistry {
  private loaders: IDocumentLoader[] = []

  /** 注册加载器 (先注册优先匹配) */
  register(loader: IDocumentLoader): void {
    // 同名覆盖
    const idx = this.loaders.findIndex(l => l.name === loader.name)
    if (idx >= 0) this.loaders[idx] = loader
    else this.loaders.push(loader)
  }

  /** 根据文件名扩展名查找加载器 */
  findByExtension(fileName: string): IDocumentLoader | null {
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : ''
    return this.loaders.find(l => l.extensions.includes(ext)) || null
  }

  /** 根据内容特征自动检测格式 */
  detectFormat(content: string): IDocumentLoader | null {
    for (const loader of this.loaders) {
      if (loader.detect?.(content)) return loader
    }
    return null
  }

  /** 加载文档: 先按扩展名, 再按内容检测 */
  load(content: string, fileName?: string): LoadResult | null {
    let loader: IDocumentLoader | null = null

    if (fileName) loader = this.findByExtension(fileName)
    if (!loader) loader = this.detectFormat(content)
    if (!loader) return null

    try {
      return loader.load(content, fileName)
    } catch (err) {
      console.error(`[DocumentLoader] "${loader.name}" 加载失败:`, err)
      return null
    }
  }

  /** 获取已注册的加载器列表 */
  getLoaders(): IDocumentLoader[] { return [...this.loaders] }
}

// ---- 内置加载器 ----

/** JSON 原生格式加载器 */
const JSONLoader: IDocumentLoader = {
  name: 'JSON',
  extensions: ['.json', '.emr'],
  load(content: string): LoadResult {
    const doc = JSON.parse(content) as DocumentTree
    const nodes = new Map<string, BaseNode>()
    nodes.set(doc.id, doc as unknown as BaseNode)
    // 注册 body 子节点
    for (const cid of doc.body.children) {
      nodes.set(cid, { type: 'paragraph' as NodeType, id: cid, children: [] } as unknown as BaseNode)
    }
    return { doc, nodes }
  },
  detect(content: string): boolean {
    const trimmed = content.trim()
    return trimmed.startsWith('{') && trimmed.includes('"type"') && trimmed.includes('"document"')
  },
}

/** HTML 转 DocumentTree (简化) */
const HTMLLoader: IDocumentLoader = {
  name: 'HTML',
  extensions: ['.html', '.htm'],
  load(content: string): LoadResult {
    const title = content.match(/<title>(.*?)<\/title>/)?.[1] || '导入的HTML文档'
    const bodyText = content.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    const paras = bodyText.split('\n\n').filter(p => p.trim())

    const docId = generateId()
    const nodes = new Map<string, BaseNode>()
    const paraIds: string[] = []

    const doc: DocumentTree = {
      type: 'document', id: docId, title,
      body: { mode: 'flow', children: paraIds },
      header: [], footer: [],
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' },
    }
    nodes.set(docId, doc as unknown as BaseNode)

    for (let i = 0; i < paras.length; i++) {
      const paraId = generateId()
      const textId = generateId()
      const text = paras[i].replace(/\n/g, ' ').trim()

      nodes.set(paraId, { type: 'paragraph' as NodeType, id: paraId, children: [textId] } as unknown as BaseNode)
      nodes.set(textId, { type: 'text' as NodeType, id: textId, text, font: 'SimSun', size: 16 } as unknown as BaseNode)
      paraIds.push(paraId)
    }

    return { doc, nodes }
  },
  detect(content: string): boolean {
    return /<(!DOCTYPE|html|head|body)[^>]*>/i.test(content)
  },
}

/** Markdown 转 DocumentTree */
const MarkdownLoader: IDocumentLoader = {
  name: 'Markdown',
  extensions: ['.md', '.markdown'],
  load(content: string): LoadResult {
    const lines = content.split('\n')
    const title = lines[0]?.replace(/^#+\s*/, '') || '导入的Markdown文档'

    const docId = generateId()
    const nodes = new Map<string, BaseNode>()
    const paraIds: string[] = []

    const doc: DocumentTree = {
      type: 'document', id: docId, title,
      body: { mode: 'flow', children: paraIds },
      header: [], footer: [],
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' },
    }
    nodes.set(docId, doc as unknown as BaseNode)

    const startIdx = lines[0]?.startsWith('#') ? 1 : 0
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const paraId = generateId()
      const textId = generateId()
      const text = line.replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s*/, '').replace(/^\d+\.\s*/, '')
      const outlineLevel = line.startsWith('#') ? (line.match(/^#+/)![0].length) : 0

      nodes.set(paraId, { type: 'paragraph' as NodeType, id: paraId, children: [textId], outlineLevel } as unknown as BaseNode)
      nodes.set(textId, { type: 'text' as NodeType, id: textId, text, font: 'SimSun', size: 16 } as unknown as BaseNode)
      paraIds.push(paraId)
    }

    return { doc, nodes }
  },
  detect(content: string): boolean {
    return /^(#{1,6}\s|[-*+]\s|\d+\.\s|```|> )/m.test(content)
  },
}

/** XML / HL7 CDA 加载器 (存根) */
const XMLLoader: IDocumentLoader = {
  name: 'XML',
  extensions: ['.xml', '.cda', '.hl7'],
  load(_content: string): LoadResult {
    const docId = generateId()
    const doc: DocumentTree = {
      type: 'document', id: docId,
      title: '导入的XML文档',
      body: { mode: 'flow', children: [] },
      header: [], footer: [],
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' },
    }
    return { doc, nodes: new Map([[docId, doc as unknown as BaseNode]]) }
  },
  detect(content: string): boolean {
    return content.trim().startsWith('<?xml') || content.trim().startsWith('<')
  },
}

// ---- 全局单例 ----

export const documentLoaderRegistry = new DocumentLoaderRegistry()

// 注册内置加载器
documentLoaderRegistry.register(JSONLoader)
documentLoaderRegistry.register(HTMLLoader)
documentLoaderRegistry.register(MarkdownLoader)
documentLoaderRegistry.register(XMLLoader)
