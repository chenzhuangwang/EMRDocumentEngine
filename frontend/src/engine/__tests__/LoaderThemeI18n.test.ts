// ============================================================
// DocumentLoader + EditorTheme + i18n 综合测试 (R84-R85)
// ============================================================

import { describe, it, expect } from 'vitest'
import { documentLoaderRegistry } from '../loaders/DocumentLoaderRegistry'
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
