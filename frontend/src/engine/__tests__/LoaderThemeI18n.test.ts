// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// DocumentLoader + EditorTheme + i18n 综合测试 (R84-R85)
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { documentLoaderRegistry } from '../loaders/DocumentLoaderRegistry'
import { createDocument, createParagraph, createTextNode, createSmartTextNode } from '../document/factory/ElementFormatter'
import { buildNodePool } from '../document/core/NodePool'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { CURRENT_DOCUMENT_VERSION, versionToString } from '../document/version/DocumentFormatVersion'
import type { BaseNode, ElementMeta } from '../document/core/DocumentModel'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'
import { EditorTheme } from '../state/EditorTheme'
import { LocaleManager, formatMessage } from '../i18n/index'
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
//
// 一律 `new LocaleManager()` —— 早期版本这里直接操全局单例, `extend()` 写进去的
// 覆盖**不会随 setLocale 清掉**, 于是"存储"这个覆盖会泄漏给后面所有用例。
// 单例本身的行为 (bootstrap 用的那条路径) 由 i18n bootstrap 的测试覆盖。

describe('i18n', () => {
  it('默认 zh-CN', () => {
    expect(new LocaleManager().getLocale()).toBe('zh-CN')
  })

  it('内置语言包可直接翻译', () => {
    const mgr = new LocaleManager()
    expect(mgr.t('common.save')).toBe('保存')
    expect(mgr.t('editor.undo')).toBe('撤销')
    expect(mgr.t('file.print')).toBe('打印')
  })

  it('切换 en-US', () => {
    const mgr = new LocaleManager()
    mgr.setLocale('en-US')
    expect(mgr.t('common.save')).toBe('Save')
    expect(mgr.t('editor.undo')).toBe('Undo')
  })

  it('extend 部分覆盖', () => {
    const mgr = new LocaleManager()
    mgr.extend({ 'common.save': '存储' })
    expect(mgr.t('common.save')).toBe('存储')
    // 未覆盖的键不受影响
    expect(mgr.t('common.cancel')).toBe('取消')
  })

  it('extend 的覆盖在切语言后依然生效 (覆盖的是"这套界面", 不是某种语言)', () => {
    const mgr = new LocaleManager()
    mgr.extend({ 'common.save': '存储' })
    mgr.setLocale('en-US')
    expect(mgr.t('common.save')).toBe('存储')
  })

  it('缺键时返回键本身并告警 (可见的失败, 不是空串)', () => {
    const mgr = new LocaleManager()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mgr.t('nope.notAKey' as never)).toBe('nope.notAKey')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('i18n 订阅 (切语言后 UI 必须能重渲染)', () => {
  it('setLocale 通知订阅者并递增版本', () => {
    const mgr = new LocaleManager()
    const seen: string[] = []
    const v0 = mgr.getVersion()

    mgr.subscribe(() => seen.push(mgr.getLocale()))
    mgr.setLocale('en-US')

    expect(seen).toEqual(['en-US'])
    expect(mgr.getVersion()).toBe(v0 + 1)
  })

  it('setLocale 同值早退 —— 不白刷订阅者', () => {
    const mgr = new LocaleManager()
    const listener = vi.fn()
    mgr.subscribe(listener)

    mgr.setLocale('zh-CN') // 与当前值相同
    expect(listener).not.toHaveBeenCalled()
    expect(mgr.getVersion()).toBe(0)
  })

  it('extend 也通知 (文案变了, 界面同样要刷)', () => {
    const mgr = new LocaleManager()
    const listener = vi.fn()
    mgr.subscribe(listener)

    mgr.extend({ 'common.save': '存储' })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('取消订阅后不再收到通知', () => {
    const mgr = new LocaleManager()
    const listener = vi.fn()
    const off = mgr.subscribe(listener)

    off()
    mgr.setLocale('en-US')
    expect(listener).not.toHaveBeenCalled()
  })

  it('单个订阅者抛异常不阻断其余订阅者 (且不静默吞掉)', () => {
    const mgr = new LocaleManager()
    const good = vi.fn()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    mgr.subscribe(() => { throw new Error('boom') })
    mgr.subscribe(good)

    expect(() => mgr.setLocale('en-US')).not.toThrow()
    expect(good).toHaveBeenCalledOnce()
    expect(err).toHaveBeenCalledOnce()
    err.mockRestore()
  })
})

describe('formatMessage — 插值', () => {
  it('替换已提供的参数', () => {
    expect(formatMessage('第 {current} 页 / 共 {total} 页', { current: 3, total: 12 }, 'zh-CN'))
      .toBe('第 3 页 / 共 12 页')
  })

  it('未提供的参数保留字面 —— 可见的失败, 不静默变空串', () => {
    expect(formatMessage('第 {current} 页 / 共 {total} 页', { current: 3 }, 'zh-CN'))
      .toBe('第 3 页 / 共 {total} 页')
  })

  it('无参数的模板原样返回', () => {
    expect(formatMessage('保存', undefined, 'zh-CN')).toBe('保存')
  })

  it('未闭合的 { 原样输出, 不吞掉后面的内容', () => {
    expect(formatMessage('a{b 页', undefined, 'zh-CN')).toBe('a{b 页')
  })

  it('值为 0 / 空串也要插进去 (不能用 truthiness 判存在)', () => {
    expect(formatMessage('{n} 项', { n: 0 }, 'zh-CN')).toBe('0 项')
    expect(formatMessage('[{s}]', { s: '' }, 'zh-CN')).toBe('[]')
  })
})

describe('formatMessage — 复数 (ICU 单层子集)', () => {
  const en = '{n, plural, one {# control} other {# controls}}'

  it('en-US: 1 走 one 分支', () => {
    expect(formatMessage(en, { n: 1 }, 'en-US')).toBe('1 control')
  })

  it('en-US: 其余走 other 分支', () => {
    expect(formatMessage(en, { n: 2 }, 'en-US')).toBe('2 controls')
    expect(formatMessage(en, { n: 0 }, 'en-US')).toBe('0 controls')
  })

  it('zh-CN: 只有 other 一条, 任何数都走它', () => {
    const zh = '{n, plural, other {# 个控件}}'
    expect(formatMessage(zh, { n: 1 }, 'zh-CN')).toBe('1 个控件')
    expect(formatMessage(zh, { n: 5 }, 'zh-CN')).toBe('5 个控件')
  })

  it('分支内可嵌套普通插值', () => {
    const tpl = '{n, plural, one {# {unit}} other {# {unit}s}}'
    expect(formatMessage(tpl, { n: 1, unit: '页' }, 'en-US')).toBe('1 页')
    expect(formatMessage(tpl, { n: 3, unit: '页' }, 'en-US')).toBe('3 页s')
  })

  it('缺 n 时保留整段字面, 不静默变空串', () => {
    expect(formatMessage(en, undefined, 'en-US')).toBe(en)
  })

  it('缺命中分支时回落 other', () => {
    // en-US 的 3 命中 other; 这里故意只给 one, 走不到就回落空 —— 但 other 存在时必须命中
    expect(formatMessage('{n, plural, other {# 项}}', { n: 7 }, 'en-US')).toBe('7 项')
  })

  it('内置语言包走完整链路 (t + 插值/复数)', () => {
    const mgr = new LocaleManager()
    expect(mgr.t('editor.pageOf', { current: 2, total: 9 })).toBe('第 2 页 / 共 9 页')
    expect(mgr.t('editor.controlCount', { n: 3 })).toBe('3 个控件')

    mgr.setLocale('en-US')
    expect(mgr.t('editor.pageOf', { current: 2, total: 9 })).toBe('Page 2 of 9')
    expect(mgr.t('editor.controlCount', { n: 1 })).toBe('1 control')
    expect(mgr.t('editor.controlCount', { n: 4 })).toBe('4 controls')
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
