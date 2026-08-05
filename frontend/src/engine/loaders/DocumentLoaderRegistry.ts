// ============================================================
// DocumentLoader — 多格式文档加载器 (R63, v6.0)
//
// IDocumentLoader + DocumentLoaderRegistry
// JSON/XML/HTML/Markdown 格式自动检测 + 路由
// ============================================================

import type { DocumentTree } from '../document/DocumentModel'

// ---- 加载器接口 ----

export interface IDocumentLoader {
  /** 支持的文件扩展名列表 (含 '.') */
  readonly extensions: string[]
  /** 加载器名称 */
  readonly name: string
  /** 从文本内容加载为 DocumentTree */
  load(content: string, fileName?: string): DocumentTree
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
  load(content: string, fileName?: string): DocumentTree | null {
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
  load(content: string): DocumentTree {
    return JSON.parse(content) as DocumentTree
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
  load(content: string): DocumentTree {
    const title = content.match(/<title>(.*?)<\/title>/)?.[1] || '导入的HTML文档'
    const bodyText = content.replace(/<[^>]+>/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

    const paragraphs = bodyText.split('\n\n').filter(p => p.trim())
    const bodyChildren: string[] = []

    for (let i = 0; i < paragraphs.length; i++) {
      const paraId = `html_p_${i + 1}`
      const lines = paragraphs[i].trim().split('\n').filter(Boolean)
      const textChildren: string[] = []

      for (let j = 0; j < lines.length; j++) {
        const tid = `${paraId}_t${j + 1}`
        // 注意: 这里创建的节点需要注册到 NodePool, 简化实现
        textChildren.push(tid)
      }
      bodyChildren.push(paraId)
    }

    return {
      type: 'document', id: 'html_import_' + Date.now(), title,
      body: { mode: 'flow', children: bodyChildren },
      header: [], footer: [],
    } as unknown as DocumentTree
  },
  detect(content: string): boolean {
    return /<(!DOCTYPE|html|head|body)[^>]*>/i.test(content)
  },
}

/** Markdown 转 DocumentTree (简化) */
const MarkdownLoader: IDocumentLoader = {
  name: 'Markdown',
  extensions: ['.md', '.markdown'],
  load(content: string): DocumentTree {
    const lines = content.split('\n')
    const title = lines[0]?.replace(/^#+\s*/, '') || '导入的Markdown文档'
    const bodyChildren: string[] = []

    let i = lines[0]?.startsWith('#') ? 1 : 0
    for (; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const paraId = `md_p_${i}`
      bodyChildren.push(paraId)
    }

    return {
      type: 'document', id: 'md_import_' + Date.now(), title,
      body: { mode: 'flow', children: bodyChildren },
      header: [], footer: [],
    } as unknown as DocumentTree
  },
  detect(content: string): boolean {
    return /^(#{1,6}\s|[-*+]\s|\d+\.\s|```|> )/m.test(content)
  },
}

/** XML / HL7 CDA 加载器 (存根) */
const XMLLoader: IDocumentLoader = {
  name: 'XML',
  extensions: ['.xml', '.cda', '.hl7'],
  load(_content: string): DocumentTree {
    return {
      type: 'document', id: 'xml_import_' + Date.now(),
      title: '导入的XML文档',
      body: { mode: 'flow', children: [] },
      header: [], footer: [],
    } as unknown as DocumentTree
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
