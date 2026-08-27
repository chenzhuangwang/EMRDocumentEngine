// ============================================================
// Final push: model + utility edge tests (target 200)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  NodeType, generateId, resetIdCounter, DEFAULT_PAGE_SETUP,
} from '../document/core/DocumentModel'
import {
  createDocument, createTextNode, createSmartTextNode,
  createFieldNode, createSeparatorNode, createSectionBreak,
  createImageNode, createSimpleTable, createFootnoteRef, createFootnoteContent,
  extractStyle, sameStyle,
} from '../document/factory/ElementFormatter'
import { sanitizeText } from '../security/SecurityConfig'
import { validateKaTeX } from '../render/KaTeXRenderer'

// ---- ElementFormatter factories ----

describe('ElementFormatter factories', () => {
  it('should create document with defaults', () => {
    const doc = createDocument('测试')
    expect(doc.title).toBe('测试')
    expect(doc.body.children).toEqual([])
    expect(doc.header).toEqual([])
    expect(doc.footer).toEqual([])
  })

  it('should create text node', () => {
    const tn = createTextNode('hello')
    expect(tn.type).toBe('text')
    expect(tn.text).toBe('hello')
  })

  it('should create text node with style', () => {
    const tn = createTextNode('bold', { bold: true, size: 18 })
    expect(tn.bold).toBe(true)
    expect(tn.size).toBe(18)
  })

  it('should create smart text node', () => {
    const element = { code: { internal: 'DE001', dataElement: 'DE001' }, name: '血压' }
    const st = createSmartTextNode('120', element)
    expect(st.type).toBe('smarttext')
    expect(st.element.code.dataElement).toBe('DE001')
  })

  it('should create field node', () => {
    const fn = createFieldNode('page_number')
    expect(fn.type).toBe('field')
    expect(fn.fieldType).toBe('page_number')
    expect(fn.cachedValue).toBeDefined()
  })

  it('should create separator node', () => {
    const sep = createSeparatorNode({ lineStyle: 'dashed' })
    expect(sep.type).toBe('separator')
    expect(sep.lineStyle).toBe('dashed')
  })

  it('should create section break', () => {
    const sb = createSectionBreak('next_page')
    expect(sb.type).toBe('section_break')
    expect(sb.breakType).toBe('next_page')
  })

  it('should create image node', () => {
    const img = createImageNode('obj-key', 400, 300, 'inline')
    expect(img.type).toBe('image')
    expect(img.objectKey).toBe('obj-key')
  })

  it('should create footnote ref and content', () => {
    const ref = createFootnoteRef('fn1')
    const content = createFootnoteContent(ref.id)
    expect(ref.type).toBe('footnote_ref')
    expect(ref.footnoteId).toBe('fn1')
    expect(content.type).toBe('footnote_content')
  })

  it('should create simple table', () => {
    const table = createSimpleTable(2, 3)
    expect(table.type).toBe('table')
    expect(table.children.length).toBe(2) // 2 rows
    expect(table.columns.length).toBe(3)
  })

  it('should reset ID counter', () => {
    resetIdCounter()
    const id1 = generateId()
    resetIdCounter()
    const id2 = generateId()
    expect(id1).toBe(id2) // same counter start
  })
})

// ---- extractStyle / sameStyle ----

describe('style utilities', () => {
  it('should extract style from text node', () => {
    const tn = createTextNode('test', { bold: true, italic: true, color: '#FF0000' })
    const style = extractStyle(tn)
    expect(style.bold).toBe(true)
    expect(style.italic).toBe(true)
    expect(style.color).toBe('#FF0000')
  })

  it('should compare same styles', () => {
    const a = createTextNode('a', { bold: true, size: 16 })
    const b = createTextNode('b', { bold: true, size: 16 })
    expect(sameStyle(a, b)).toBe(true)
  })

  it('should detect different styles', () => {
    const a = createTextNode('a', { bold: true })
    const b = createTextNode('b', { bold: false })
    expect(sameStyle(a, b)).toBe(false)
  })
})

// ---- Security sanitizeText ----

describe('sanitizeText extended', () => {
  it('should escape all HTML entities', () => {
    const result = sanitizeText('<div class="x">&copy;</div>')
    expect(result).toContain('&lt;')
    expect(result).toContain('&gt;')
    expect(result).toContain('&quot;')
    expect(result).toContain('&amp;')
  })
})

// ---- KaTeX validation (DOM required) ----

describe('KaTeX validation', () => {
  it('should validate simple LaTeX', () => {
    expect(validateKaTeX('x^2')).toBe(true)
    expect(validateKaTeX('\\frac{a}{b}')).toBe(true)
    expect(validateKaTeX('\\alpha')).toBe(true)
  })

  it('should reject invalid LaTeX', () => {
    expect(validateKaTeX('\\invalid{')).toBe(false)
  })
})

// ---- DEFAULT_PAGE_SETUP ----

describe('DEFAULT_PAGE_SETUP', () => {
  it('should have valid defaults', () => {
    expect(DEFAULT_PAGE_SETUP.width).toBe(794)
    expect(DEFAULT_PAGE_SETUP.height).toBe(1123)
    expect(DEFAULT_PAGE_SETUP.orientation).toBe('portrait')
  })
})

// ---- NodeType constants ----

describe('NodeType constants', () => {
  it('should define all standard types', () => {
    expect(NodeType.DOCUMENT).toBe('document')
    expect(NodeType.PARAGRAPH).toBe('paragraph')
    expect(NodeType.TEXT).toBe('text')
    expect(NodeType.TABLE).toBe('table')
    expect(NodeType.IMAGE).toBe('image')
    expect(NodeType.SEPARATOR).toBe('separator')
    expect(NodeType.FIELD).toBe('field')
    expect(NodeType.FOOTNOTE_REF).toBe('footnote_ref')
  })

  it('should define comment and bookmark types', () => {
    expect(NodeType.BOOKMARK).toBe('bookmark')
    expect(NodeType.COMMENT_MARKER).toBe('comment_marker')
    expect(NodeType.CROSS_REFERENCE).toBe('cross_reference')
  })

  it('should define section break and footnote content types', () => {
    expect(NodeType.SECTION_BREAK).toBe('section_break')
    expect(NodeType.FOOTNOTE_CONTENT).toBe('footnote_content')
  })
})

// ---- generateId ----

describe('generateId', () => {
  it('should generate unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) ids.add(generateId())
    expect(ids.size).toBe(100)
  })

  it('should generate string IDs', () => {
    const id = generateId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
})

// ---- extractStyle edge ----

describe('extractStyle edge cases', () => {
  it('should handle node without style fields', () => {
    const style = extractStyle({ type: 'text', id: 'x', text: '' })
    expect(style.bold).toBeUndefined()
    expect(style.italic).toBeUndefined()
  })
})
