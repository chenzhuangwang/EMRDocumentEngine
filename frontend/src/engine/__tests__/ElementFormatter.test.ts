// ============================================================
// ElementFormatter 单元测试
// ============================================================

import { describe, it, expect } from 'vitest'
import { formatElementList, unzipElementList, zipElementList } from '../document/ElementFormatter'
import { ElementType, type IElement } from '../document/DocumentModel'

function makeText(value: string, overrides?: Partial<IElement>): IElement {
  return { id: `id_${value}`, type: ElementType.TEXT, value, ...overrides }
}

describe('ElementFormatter', () => {
  describe('formatElementList', () => {
    it('should return a single empty text element for empty array', () => {
      const result = formatElementList([])
      expect(result.length).toBe(1)
      expect(result[0].type).toBe(ElementType.TEXT)
      expect(result[0].value).toBe('')
      expect(result[0].id).toBeDefined()
    })

    it('should assign IDs to elements without one', () => {
      const el: IElement = { id: '', type: ElementType.TEXT, value: 'a' }
      const result = formatElementList([el])
      expect(result.length).toBe(1)
      expect(result[0].id).toBeTruthy()
      expect(result[0].id).not.toBe('')
    })

    it('should preserve existing IDs', () => {
      const el: IElement = { id: 'preserved', type: ElementType.TEXT, value: 'a' }
      const result = formatElementList([el])
      expect(result[0].id).toBe('preserved')
    })
  })

  describe('unzipElementList', () => {
    it('should split multi-character text into single characters', () => {
      const result = unzipElementList([makeText('abc')])
      expect(result.length).toBe(3)
      expect(result.map(e => e.value)).toEqual(['a', 'b', 'c'])
    })

    it('should replace empty text with zero-width joiner', () => {
      const result = unzipElementList([makeText('')])
      expect(result.length).toBe(1)
      expect(result[0].value).toBe('​')
    })

    it('should pass through table elements unchanged', () => {
      const table: IElement = { id: 't1', type: ElementType.TABLE, value: '' }
      const result = unzipElementList([table])
      expect(result.length).toBe(1)
      expect(result[0].type).toBe(ElementType.TABLE)
      expect(result[0].id).toBe('t1')
    })

    it('should pass through image elements unchanged', () => {
      const img: IElement = { id: 'img1', type: ElementType.IMAGE, value: '' }
      const result = unzipElementList([img])
      expect(result.length).toBe(1)
      expect(result[0].type).toBe(ElementType.IMAGE)
    })

    it('should pass through control elements unchanged', () => {
      const ctrl: IElement = { id: 'c1', type: ElementType.CONTROL, value: '' }
      const result = unzipElementList([ctrl])
      expect(result.length).toBe(1)
      expect(result[0].type).toBe(ElementType.CONTROL)
    })

    it('should handle newline characters', () => {
      const result = unzipElementList([makeText('\n')])
      expect(result.length).toBe(1)
      expect(result[0].value).toBe('\n')
    })

    it('should handle mixed element types', () => {
      const mixed: IElement[] = [
        makeText('hi'),
        { id: 't1', type: ElementType.TABLE, value: '' },
        makeText('ok'),
      ]
      const result = unzipElementList(mixed)
      expect(result.length).toBe(5) // h, i (2 chars) + table (1) + o, k (2) = 5
    })
  })

  describe('zipElementList', () => {
    it('should merge adjacent identically-styled text elements', () => {
      const unzipped = unzipElementList([makeText('hello')])
      // unzipped = [h, e, l, l, o] all with same style
      const zipped = zipElementList(unzipped)
      expect(zipped.length).toBe(1)
      expect(zipped[0].value).toBe('hello')
    })

    it('should not merge elements with different styles', () => {
      const a = makeText('a', { bold: true })
      const b = makeText('b', { bold: false })
      const result = zipElementList([a, b])
      expect(result.length).toBe(2)
    })

    it('should not merge different element types', () => {
      const text = makeText('a')
      const table: IElement = { id: 't1', type: ElementType.TABLE, value: '' }
      // These shouldn't merge because they're different types
      const result = unzipElementList([text, table])
      // Text 'a' unzips to 1 char, table stays as 1
      expect(result.length).toBe(2)
      // Zipping shouldn't merge text + table
      const zipped = zipElementList(result)
      expect(zipped.length).toBe(2)
    })

    it('should return empty array for empty input', () => {
      expect(zipElementList([])).toEqual([])
    })
  })
})
