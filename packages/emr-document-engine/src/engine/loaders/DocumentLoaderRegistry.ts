// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DocumentLoader — 多格式文档加载器 (R63, v6.0)
//
// IDocumentLoader + DocumentLoaderRegistry
// JSON/XML/HTML/Markdown 格式自动检测 + 路由
// ============================================================

import type { DocumentTree, BaseNode } from '../document/core/DocumentModel'
import { NodeType, generateId } from '../document/core/DocumentModel'
import { loadDocument } from '../document/io/DocumentLoader'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../document/version/DocumentFormatVersion'
import { reportError, EditorErrorCode } from '../ErrorRecovery'
import { locale } from '../i18n/index'

// ---- 加载结果 ----

export interface LoadResult {
  doc: DocumentTree
  /** 所有节点的映射 (用于构建 NodePool) */
  nodes: Map<string, BaseNode>
  /** 模板设计期属性 (契约 §12.1) — artifact 顶层读回, 缺失 → undefined */
  templateDefinitions?: import('../template/TemplateDefinition').TemplateDefinitionStore
  /** 表现层样式 store (契约 §2.2) — artifact 顶层读回, 缺失 → undefined */
  presentationStyles?: import('../render/presentation/PresentationStyle').PresentationStyleStore
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
    // null 只表示"没有 loader 认领这个格式"
    if (!loader) return null

    try {
      return loader.load(content, fileName)
    } catch (err) {
      // 加载失败**不再吞掉**。"认领了但读不动" (版本过新/结构损坏) 与
      // "不认识这个格式" 是两回事 —— 原先两者都返回 null, 上层只能把
      // 版本过新报成"格式不支持", 把用户指向完全错误的方向。
      // 先上报真实原因, 再抛给调用方 (它才知道该给用户看什么)。
      //
      // 文案保留「哪一个 loader 失败 + 内层原因」的完整形状 (JSON 版与 HTML
      // 版报错长得一样时, 用户无从判断是哪种文件出的问题)。
      //
      // 重译的边界: 外层壳 (loader.failed) 随语言变, 内层详情 msg 是内层
      // LoadError 在内层语言下展开的快照 —— ICU 单层子集不支持嵌套键, 要
      // 让内层也重译得改成结构化错误链。内层是 [DocumentLoader.phase] 开头的
      // 技术详情, 保持原语言可接受。
      const params = { name: loader.name, msg: err instanceof Error ? err.message : String(err) }
      reportError({
        code: EditorErrorCode.E_DOCUMENT_CORRUPTED,
        key: 'loader.failed',
        params,
        message: locale.t('loader.failed', params),
        cause: err,
      })
      throw err
    }
  }

  /** 获取已注册的加载器列表 */
  getLoaders(): IDocumentLoader[] { return [...this.loaders] }
}

// ---- 内置加载器 ----

/** JSON 原生格式加载器 — 路由到 canonical DocumentLoader (契约 §14), 不绕过 ModelUpgrader */
const JSONLoader: IDocumentLoader = {
  name: 'JSON',
  extensions: ['.json', '.emr'],
  load(content: string): LoadResult {
    const result = loadDocument(content)
    return {
      doc: result.doc,
      nodes: new Map(result.pool.nodes),
      templateDefinitions: result.templateDefinitions,
      presentationStyles: result.presentationStyles,
    }
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
    const title = content.match(/<title>(.*?)<\/title>/)?.[1] || locale.t('loader.importedHtml')
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
      modelVersion: versionToString(CURRENT_DOCUMENT_VERSION),
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
    const title = lines[0]?.replace(/^#+\s*/, '') || locale.t('loader.importedMarkdown')

    const docId = generateId()
    const nodes = new Map<string, BaseNode>()
    const paraIds: string[] = []

    const doc: DocumentTree = {
      type: 'document', id: docId, title,
      body: { mode: 'flow', children: paraIds },
      header: [], footer: [],
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' },
      modelVersion: versionToString(CURRENT_DOCUMENT_VERSION),
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
      title: locale.t('loader.importedXml'),
      body: { mode: 'flow', children: [] },
      header: [], footer: [],
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' },
      modelVersion: versionToString(CURRENT_DOCUMENT_VERSION),
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
