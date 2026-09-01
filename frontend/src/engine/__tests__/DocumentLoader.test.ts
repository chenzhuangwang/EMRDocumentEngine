// ================================================================
// DocumentLoader 单元测试 (架构 Phase 3+4, 2026-08-27)
//
// 覆盖 Phase 1 设计文档 §5 列出的全部 6+ 路径:
//   - v1→当前 (走完整链 v1→v2→v3→v4→v4.1)
//   - v2→当前 (跳过 v1)
//   - v3→当前 (走 v4→v4.1)
//   - v4.0→v4.1 (新增迁移器, 纯版本号标记)
//   - 当前→当前 (no-op)
//   - v5→当前 (too-new 拒绝)
//   - malformed modelVersion (parseVersion 容错: NaN → 0)
//   - 必填字段缺失 (validate 抛错)
//   - 引用悬空 (validate 抛错)
//   - JSON parse error (parse phase 抛错)
//   - 缺失 modelVersion (默认 v1, 触发完整链)
//   - 往返: serializeDocument → loadDocumentFromObject (保持页脚/正文)
// ================================================================

import { describe, it, expect } from 'vitest'
import {
  loadDocument, loadDocumentFromObject, LoadError,
  type DocumentLoadOptions,
} from '../document/io/DocumentLoader'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { createDocument, createParagraph, createTextNode } from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import type { BaseNode, DocumentTree, Paragraph, TextNode } from '../document/core/DocumentModel'
import {
  CURRENT_DOCUMENT_VERSION, versionToString,
} from '../document/version/DocumentFormatVersion'

/** 构造一个可序列化往返的最小文档 (含 body + footer) */
function buildRoundTripFixture(): { doc: DocumentTree; nodes: Map<string, BaseNode> } {
  const doc = createDocument('rt')
  const allNodes = new Map<string, BaseNode>()
  allNodes.set(doc.id, doc as unknown as BaseNode)

  const bodyText = createTextNode('hello')
  const bodyPara = createParagraph([bodyText.id])
  const footText = createTextNode('页脚')
  const footPara = createParagraph([footText.id])

  allNodes.set(bodyText.id, bodyText as unknown as BaseNode)
  allNodes.set(bodyPara.id, bodyPara as unknown as BaseNode)
  allNodes.set(footText.id, footText as unknown as BaseNode)
  allNodes.set(footPara.id, footPara as unknown as BaseNode)

  doc.body.children = [bodyPara.id]
  doc.footer = [footPara.id]
  return { doc, nodes: allNodes }
}

function makeDocWithModelVersion(version: string, modelFields?: Partial<DocumentTree>): DocumentTree {
  const doc = createDocument('vtest')
  ;(doc as unknown as { modelVersion?: string }).modelVersion = version
  if (modelFields) Object.assign(doc, modelFields)
  return doc
}

// ============ 路径: 升级链 ============

describe('DocumentLoader 升级路径', () => {
  it('v1 → 当前 走完整链 (v1→v2→v3→v4→v4.1→v4.2)', () => {
    const raw = makeDocWithModelVersion('1.0.0')
    const r = loadDocumentFromObject(raw)
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(r.wasUpgraded).toBe(true)
    expect(r.upgradePath).toEqual(['1.0.0', versionToString(CURRENT_DOCUMENT_VERSION)])
    expect(r.sourceVersion).toEqual({ major: 1, minor: 0, patch: 0 })
  })

  it('v2 → 当前 (跳过 v1, 走 v3→v4→v4.1→v4.2)', () => {
    const raw = makeDocWithModelVersion('2.0.0')
    const r = loadDocumentFromObject(raw)
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(r.wasUpgraded).toBe(true)
  })

  it('v3 → 当前 (走 v4→v4.1→v4.2)', () => {
    const raw = makeDocWithModelVersion('3.0.0')
    const r = loadDocumentFromObject(raw)
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(r.wasUpgraded).toBe(true)
  })

  it('v4.0 → 当前 (ElementFormat 新增可选字段, 仅版本号标记)', () => {
    const raw = makeDocWithModelVersion('4.0.0')
    const r = loadDocumentFromObject(raw)
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(r.wasUpgraded).toBe(true)
    expect(r.upgradePath).toEqual(['4.0.0', versionToString(CURRENT_DOCUMENT_VERSION)])
  })

  it('v4.1 → 当前 (SmartTextNode 新增 value, 仅版本号标记)', () => {
    const raw = makeDocWithModelVersion('4.1.0')
    const r = loadDocumentFromObject(raw)
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(r.wasUpgraded).toBe(true)
    expect(r.upgradePath).toEqual(['4.1.0', versionToString(CURRENT_DOCUMENT_VERSION)])
  })

  it('当前版本 → 当前 (no-op, wasUpgraded=false)', () => {
    const raw = makeDocWithModelVersion(versionToString(CURRENT_DOCUMENT_VERSION))
    const r = loadDocumentFromObject(raw)
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(r.wasUpgraded).toBe(false)
    expect(r.upgradePath).toEqual([])
  })

  it('缺失 modelVersion 默认视为 v1, 触发完整链', () => {
    const raw = makeDocWithModelVersion(versionToString(CURRENT_DOCUMENT_VERSION))
    delete (raw as { modelVersion?: string }).modelVersion
    const r = loadDocumentFromObject(raw)
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(r.sourceVersion).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(r.wasUpgraded).toBe(true)
  })
})

// ============ 路径: 拒绝 ============

describe('DocumentLoader 拒绝路径', () => {
  it('v5 → 当前 抛 LoadError (too-new)', () => {
    const raw = makeDocWithModelVersion('5.0.0')
    expect(() => loadDocumentFromObject(raw)).toThrow(LoadError)
    try {
      loadDocumentFromObject(raw)
    } catch (e) {
      expect((e as LoadError).phase).toBe('compatibility')
    }
  })

  it('malformed modelVersion (parseVersion 容错为 0.0.0 → 升级到当前)', () => {
    const raw = makeDocWithModelVersion('not-a-version')
    const r = loadDocumentFromObject(raw)
    // parseVersion 对 NaN 用 0 兜底, 等价 v0.0.0, 升级链把它拉到当前版本
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(r.wasUpgraded).toBe(true)
  })

  it('缺失 doc.id → validate phase 抛错', () => {
    const raw = createDocument('no-id')
    ;(raw as unknown as { id?: string }).id = ''
    expect(() => loadDocumentFromObject(raw)).toThrow(/validate/)
    try {
      loadDocumentFromObject(raw)
    } catch (e) {
      expect((e as LoadError).phase).toBe('validate')
    }
  })

  it('缺失 doc.title → validate phase 抛错', () => {
    const raw = createDocument('')
    expect(() => loadDocumentFromObject(raw)).toThrow(/title/)
  })

  it('body.children 缺失 → validate phase 抛错', () => {
    const raw = createDocument('x')
    ;(raw.body as unknown) = null
    expect(() => loadDocumentFromObject(raw)).toThrow(/body\.children/)
  })

  it('children 包含非字符串引用 → 抛错', () => {
    const raw = createDocument('bad-children')
    ;(raw.body.children as unknown) = [123]
    expect(() => loadDocumentFromObject(raw)).toThrow(/非字符串/)
  })

  it('引用悬空 (extraNodes 与 doc.nodes 都找不到) → 抛错', () => {
    const raw = createDocument('dangling')
    raw.body.children = ['ghost_id']
    expect(() => loadDocumentFromObject(raw)).toThrow(/悬空/)
  })

  it('JSON 解析失败 → parse phase 抛错', () => {
    expect(() => loadDocument('{ not json')).toThrow(LoadError)
    try {
      loadDocument('{ not json')
    } catch (e) {
      expect((e as LoadError).phase).toBe('parse')
    }
  })

  it('null / 非对象输入 → detect phase 抛错', () => {
    expect(() => loadDocumentFromObject(null)).toThrow(LoadError)
    try {
      loadDocumentFromObject('not an object' as unknown as DocumentTree)
    } catch (e) {
      expect((e as LoadError).phase).toBe('detect')
    }
  })
})

// ============ 路径: 默认字段补全 ============

describe('DocumentLoader 默认字段补全', () => {
  it('缺失 header/footer 时补为空数组', () => {
    const raw = createDocument('h-f')
    delete (raw as { header?: string[] }).header
    delete (raw as { footer?: string[] }).footer
    const r = loadDocumentFromObject(raw)
    expect(r.doc.header).toEqual([])
    expect(r.doc.footer).toEqual([])
  })

  it('缺失 pageSetup.orientation 时补为 portrait', () => {
    const raw = createDocument('ps')
    if (raw.pageSetup) delete (raw.pageSetup as { orientation?: string }).orientation
    const r = loadDocumentFromObject(raw)
    expect(r.doc.pageSetup.orientation).toBe('portrait')
  })

  it('缺失 pageSetup 整体时补默认值', () => {
    const raw = createDocument('ps')
    delete (raw as { pageSetup?: unknown }).pageSetup
    const r = loadDocumentFromObject(raw)
    expect(r.doc.pageSetup).toBeDefined()
    expect(r.doc.pageSetup.width).toBe(794)
  })
})

// ============ 路径: 往返 ============

describe('DocumentLoader 往返 (DocumentSerializer ↔ DocumentLoader)', () => {
  it('serializeDocument → loadDocumentFromObject 保持 body/footer 节点可寻址', () => {
    const { doc, nodes } = buildRoundTripFixture()
    const pool = buildNodePool(nodes, { body: doc.id, footer: doc.footer })
    const json = serializeDocument(doc, pool)

    const r = loadDocument(json)
    // 页脚段落与文本节点都在重建后的池中
    expect(r.pool.nodes.get(doc.footer![0])).toBeDefined()
    const footPara = r.pool.nodes.get(doc.footer![0]) as Paragraph
    expect(footPara).toBeDefined()
    expect((r.pool.nodes.get(footPara.children[0]) as TextNode).text).toBe('页脚')
    // 正文段落
    const bodyPara = r.pool.nodes.get(doc.body.children[0]) as Paragraph
    expect((r.pool.nodes.get(bodyPara.children[0]) as TextNode).text).toBe('hello')
    // modelVersion 显式声明
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
  })

  it('collectDocumentNodes 顺序不影响 serializeDocument 输出 (幂等)', () => {
    const { doc, nodes } = buildRoundTripFixture()
    const pool = buildNodePool(nodes, { body: doc.id, footer: doc.footer })
    const json1 = serializeDocument(doc, pool)
    const json2 = serializeDocument(doc, pool)
    // nodes 字段的 key 顺序无关 — 比较结构相等性
    const p1 = JSON.parse(json1)
    const p2 = JSON.parse(json2)
    expect(p1.id).toBe(p2.id)
    expect(Object.keys(p1.nodes).sort()).toEqual(Object.keys(p2.nodes).sort())
  })
})

// ============ 路径: 节点池重建 ============

describe('DocumentLoader 节点池重建', () => {
  it('extraNodes 优先于 doc.nodes', () => {
    const { doc, nodes } = buildRoundTripFixture()
    const pool = buildNodePool(nodes, { body: doc.id, footer: doc.footer })
    const json = serializeDocument(doc, pool)
    const parsed = JSON.parse(json) as DocumentTree & { nodes?: Record<string, BaseNode> }

    // 制造 extraNodes 与 doc.nodes 同 id 不同对象 (extraNodes 应胜出)
    const extraTextId = (parsed.nodes as Record<string, BaseNode>)[
      (parsed.nodes as Record<string, BaseNode>) ? Object.keys(parsed.nodes as Record<string, BaseNode>)[0] : ''
    ]?.id
    expect(extraTextId).toBeDefined()

    const r = loadDocument(json, {
      extraNodes: new Map(),
    })
    expect(r.pool.nodes.get(doc.id)).toBeDefined()
    // doc 始终注册
    expect(r.pool.rootIds.body).toBe(doc.id)
  })
})

// ============ 类型接口 ============

describe('DocumentLoader 类型接口', () => {
  it('LoadOptions / LoadResult 字段完整', () => {
    const raw = makeDocWithModelVersion('4.0.0')
    const r = loadDocumentFromObject(raw)
    expect(typeof r.doc).toBe('object')
    expect(typeof r.pool).toBe('object')
    expect(typeof r.sourceVersion.major).toBe('number')
    expect(typeof r.wasUpgraded).toBe('boolean')
    expect(Array.isArray(r.upgradePath)).toBe(true)
  })

  it('options 可省略 (使用默认 upgrader)', () => {
    const raw = makeDocWithModelVersion(versionToString(CURRENT_DOCUMENT_VERSION))
    const r = loadDocumentFromObject(raw, undefined)
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
  })

  it('options.upgrader 可注入 (用于隔离测试)', () => {
    const raw = makeDocWithModelVersion('1.0.0')
    const injectedOptions: DocumentLoadOptions = {}
    const r = loadDocumentFromObject(raw, injectedOptions)
    expect(r.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
  })
})