// ============================================================
// LineBreaker 单元测试
// ============================================================

import { describe, it, expect } from 'vitest'
import { LineBreaker, type LineBreakOptions } from '../layout/LineBreaker'
import { TextMeasurer } from '../layout/TextMeasurer'
import { ElementType, type IElement } from '../document/DocumentModel'

function makeText(value: string): IElement {
  return { id: `t_${value}`, type: ElementType.TEXT, value, size: 16, font: 'SimSun' }
}

function makeNewline(): IElement {
  return { id: 'nl', type: ElementType.TEXT, value: '\n', size: 16, font: 'SimSun' }
}

const defaultOptions: LineBreakOptions = {
  maxWidth: 600,
  wordBreak: 'break-all',
  defaultFont: 'SimSun',
  defaultSize: 16,
}

describe('LineBreaker', () => {
  const measurer = new TextMeasurer()
  const breaker = new LineBreaker(measurer)

  describe('breakLines', () => {
    it('should return empty array for empty input', () => {
      const result = breaker.breakLines([], defaultOptions)
      expect(result).toEqual([])
    })

    it('should put all text on one line when it fits', () => {
      // LineBreaker receives already-unzipped elements from the pipeline
      const unzipped = [
        { id: 'a', type: ElementType.TEXT, value: 'a', size: 16, font: 'SimSun' },
        { id: 'b', type: ElementType.TEXT, value: 'b', size: 16, font: 'SimSun' },
        { id: 'c', type: ElementType.TEXT, value: 'c', size: 16, font: 'SimSun' },
      ]
      const result = breaker.breakLines(unzipped, { ...defaultOptions, maxWidth: 9999 })
      expect(result.length).toBe(1)
      expect(result[0].elements.map(e => e.value)).toEqual(['a', 'b', 'c'])
    })

    it('should break on newline characters', () => {
      const result = breaker.breakLines(
        [makeText('a'), makeNewline(), makeText('b')],
        defaultOptions
      )
      // Should produce at least 2 lines (one for 'a\n', one for 'b')
      expect(result.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle consecutive newlines', () => {
      const result = breaker.breakLines(
        [makeNewline(), makeNewline()],
        defaultOptions
      )
      // Each \n produces a line
      expect(result.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle page break elements', () => {
      const pageBreak: IElement = { id: 'pb', type: ElementType.PAGE_BREAK, value: '' }
      const result = breaker.breakLines(
        [pageBreak],
        defaultOptions
      )
      expect(result.length).toBe(1)
      expect(result[0].elements[0].type).toBe(ElementType.PAGE_BREAK)
    })

    it('should handle separator elements', () => {
      const sep: IElement = { id: 'sep', type: ElementType.SEPARATOR, value: '', size: 16 }
      const result = breaker.breakLines(
        [sep],
        defaultOptions
      )
      expect(result.length).toBe(1)
      expect(result[0].elements[0].type).toBe(ElementType.SEPARATOR)
    })

    it('should place tables on their own line', () => {
      const table: IElement = { id: 't1', type: ElementType.TABLE, value: '', trList: [] }
      const result = breaker.breakLines(
        [makeText('a'), table, makeText('b')],
        defaultOptions
      )
      // Table should be on its own line
      expect(result.length).toBeGreaterThanOrEqual(3)
    })

    it('should preserve zero-width joiners in output', () => {
      const zwj: IElement = { id: 'zwj', type: ElementType.TEXT, value: '​', size: 16, font: 'SimSun' }
      const result = breaker.breakLines([zwj], defaultOptions)
      expect(result.length).toBe(1)
      expect(result[0].elements[0].value).toBe('​')
    })

    it('should compute proper line metrics', () => {
      const result = breaker.breakLines(
        [makeText('hello')],
        defaultOptions
      )
      expect(result.length).toBe(1)
      expect(result[0].height).toBeGreaterThan(0)
      expect(result[0].maxAscent).toBeGreaterThan(0)
      expect(result[0].maxDescent).toBeGreaterThan(0)
      expect(result[0].width).toBeGreaterThan(0)
    })
  })
})
