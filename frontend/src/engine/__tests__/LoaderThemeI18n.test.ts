// ============================================================
// DocumentLoader + EditorTheme + i18n 综合测试 (R84-R85)
// ============================================================

import { describe, it, expect } from 'vitest'
import { documentLoaderRegistry } from '../loaders/DocumentLoaderRegistry'
import { createDocument, createParagraph, createTextNode, createSmartTextNode } from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../document/version/DocumentFormatVersion'
import type { BaseNode, ElementMeta } from '../document/core/DocumentModel'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import { EditorTheme } from '../state/EditorTheme'
import { locale, t } from '../i18n/index'
import { testHost } from './helpers'

// ---- DocumentLoaderRegistry ----

describe('DocumentLoaderRegistry', () => {
  it('should have built-in loaders', () => {
    expect(documentLoaderRegistry.getLoaders().length).toBeGreaterThanOrEqual(4)
  })

  it('should find JSON loader by extension', () => {
    const loader = documentLoaderRegistry.findByExtension('test.json')
    expect(loader).toBeDefined()
    expect(loader!.name).toBe('JSON')
  })

  it('should detect JSON format by content', () => {
    const loader = documentLoaderRegistry.detectFormat('{"type":"document","id":"x","title":"test"}')
    expect(loader).toBeDefined()
    expect(loader!.name).toBe('JSON')
  })

  it('should detect HTML format', () => {
    const loader = documentLoaderRegistry.detectFormat('<!DOCTYPE html><html><body></body></html>')
    expect(loader).toBeDefined()
  })

  it('should detect Markdown format', () => {
    const loader = documentLoaderRegistry.detectFormat('# Title\n\nContent here')
    expect(loader).toBeDefined()
  })
})

// ---- DocumentLoaderRegistry load 行为 (契约 §14) ----

describe('DocumentLoaderRegistry load 行为 (契约 §14)', () => {
  it('JSONLoader.load 路由到 canonical DocumentLoader, 旧版本 JSON 自动升级', () => {
    const doc = createDocument('legacy')
    const allNodes = new Map<string, BaseNode>()
    allNodes.set(doc.id, doc as unknown as BaseNode)
    const text = createTextNode('hi')
    const para = createParagraph([text.id])
    allNodes.set(text.id, text as unknown as BaseNode)
    allNodes.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(allNodes, { body: doc.id })

    // 序列化后强制降版本为 1.0.0, 模拟旧文档
    const json = JSON.parse(serializeDocument(doc, pool)) as Record<string, unknown>
    json.modelVersion = '1.0.0'

    const loader = documentLoaderRegistry.findByExtension('test.json')!
    const result = loader.load(JSON.stringify(json))
    expect(result.doc.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(result.nodes.get(para.id)).toBeDefined()
  })

  it('HTML/Markdown/XML import loader 生成的 doc 显式写 modelVersion=CURRENT', () => {
    const html = documentLoaderRegistry.detectFormat('<!DOCTYPE html><html><body>hello</body></html>')!
    expect(html.load('<!DOCTYPE html><html><body>hello</body></html>').doc.modelVersion)
      .toBe(versionToString(CURRENT_DOCUMENT_VERSION))

    const md = documentLoaderRegistry.detectFormat('# Title\n\ncontent')!
    expect(md.load('# Title\n\ncontent').doc.modelVersion)
      .toBe(versionToString(CURRENT_DOCUMENT_VERSION))

    const xml = documentLoaderRegistry.findByExtension('test.xml')!
    expect(xml.load('<root></root>').doc.modelVersion)
      .toBe(versionToString(CURRENT_DOCUMENT_VERSION))
  })
})

// ---- EditorTheme ----

describe('EditorTheme', () => {
  it('should default to standard theme', () => {
    const theme = new EditorTheme(testHost)
    expect(theme.preset).toBe('standard')
  })

  it('should switch to eyeCare theme', () => {
    const theme = new EditorTheme(testHost)
    theme.setTheme('eyeCare')
    expect(theme.preset).toBe('eyeCare')
    expect(theme.colors.pageBg).toBe('#F5F0E8')
  })

  it('should switch to dark theme', () => {
    const theme = new EditorTheme(testHost)
    theme.setTheme('dark')
    expect(theme.preset).toBe('dark')
    expect(theme.colors.textColor).toBe('#E5E5E5')
  })

  it('should reset to standard', () => {
    const theme = new EditorTheme(testHost)
    theme.setTheme('dark')
    theme.reset()
    expect(theme.preset).toBe('standard')
  })
})

// ---- i18n ----

describe('i18n', () => {
  it('should default to zh-CN', () => {
    const mgr = locale
    expect(mgr.getLocale()).toBe('zh-CN')
  })

  it('should translate zh-CN keys', () => {
    expect(t('common.save')).toBe('保存')
    expect(t('editor.undo')).toBe('撤销')
    expect(t('file.print')).toBe('打印')
  })

  it('should switch to en-US', () => {
    locale.setLocale('en-US')
    expect(t('common.save')).toBe('Save')
    expect(t('editor.undo')).toBe('Undo')
    locale.setLocale('zh-CN') // restore
  })

  it('should support partial override', () => {
    locale.extend({ 'common.save': '存储' })
    expect(t('common.save')).toBe('存储')
    locale.setLocale('zh-CN') // reset
  })
})

describe('JSONLoader 导入保留 templateDefinitions (控件 controlType 不丢)', () => {
  it('序列化含控件文档 → registry JSON 加载后 controlType 仍在', () => {
    // 构造: 段落含 checkbox 控件 + TemplateDefinition
    const doc = createDocument('imp')
    const all = new Map<string, BaseNode>()
    all.set(doc.id, doc as unknown as BaseNode)
    const el: ElementMeta = {
      code: { internal: 'CTL_CB', dataElement: 'DE99.99.006' }, name: '症状',
      format: { dataType: 'S1', enums: { multiple: true, data: [{ name: '发热', value: 'fever' }] } },
    }
    const st = createSmartTextNode('[症状]', el)
    const para = createParagraph([st.id])
    all.set(st.id, st as unknown as BaseNode)
    all.set(para.id, para as unknown as BaseNode)
    doc.body.children = [para.id]
    const pool = buildNodePool(all, { body: doc.id })
    const defs = new TemplateDefinitionStore()
    defs.set(st.id, { controlType: 'checkbox', label: '症状：', editable: true })

    const json = serializeDocument(doc, pool, { templateDefinitions: defs })
    const res = documentLoaderRegistry.load(json, 'x.json')!
    expect(res.templateDefinitions?.get(st.id)?.controlType).toBe('checkbox')
    expect(res.templateDefinitions?.get(st.id)?.label).toBe('症状：')
  })
})
