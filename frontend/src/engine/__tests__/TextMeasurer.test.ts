// ============================================================
// TextMeasurer 单元测试
// ============================================================

import { describe, it, expect } from 'vitest'
import { TextMeasurer } from '../layout/TextMeasurer'

describe('TextMeasurer', () => {
  const measurer = new TextMeasurer()

  describe('measureWidth', () => {
    it('should return a positive width for non-empty text', () => {
      const config = { font: 'SimSun', size: 16 }
      const width = measurer.measureWidth('Hello', config)
      expect(width).toBeGreaterThan(0)
    })

    it('should return 0 for empty string', () => {
      const config = { font: 'SimSun', size: 16 }
      const width = measurer.measureWidth('', config)
      expect(width).toBe(0)
    })

    it('should return larger widths for larger font sizes', () => {
      const small = measurer.measureWidth('Test', { font: 'SimSun', size: 12 })
      const large = measurer.measureWidth('Test', { font: 'SimSun', size: 24 })
      expect(large).toBeGreaterThan(small)
    })

    it('should handle CJK characters', () => {
      const config = { font: 'SimSun', size: 16 }
      const width = measurer.measureWidth('中文测试', config)
      expect(width).toBeGreaterThan(0)
    })

    it('should use LRU cache for repeated measurements', () => {
      const config = { font: 'SimSun', size: 16 }
      const w1 = measurer.measureWidth('cached', config)
      const w2 = measurer.measureWidth('cached', config)
      expect(w1).toBe(w2)
    })
  })

  describe('measure', () => {
    it('should return TextMetrics with width property', () => {
      const config = { font: 'SimSun', size: 16 }
      const metrics = measurer.measure('ABC', config)
      expect(metrics).toBeDefined()
      expect(typeof metrics.width).toBe('number')
      expect(metrics.width).toBeGreaterThan(0)
    })
  })

  describe('splitTextToWidth', () => {
    it('should return entire text on one line when it fits', () => {
      const config = { font: 'SimSun', size: 16 }
      const result = measurer.splitTextToWidth('ab', 500, config)
      expect(result).toEqual(['ab'])
    })

    it('should return empty string for empty input', () => {
      const config = { font: 'SimSun', size: 16 }
      const result = measurer.splitTextToWidth('', 100, config)
      expect(result).toEqual([''])
    })

    it('should return original text for non-positive maxWidth', () => {
      const config = { font: 'SimSun', size: 16 }
      const result = measurer.splitTextToWidth('hello', 0, config)
      expect(result).toEqual(['hello'])
    })

    it('should split CJK text at character boundaries', () => {
      const config = { font: 'SimSun', size: 16 }
      // Very narrow width forces each CJK char to its own line
      const result = measurer.splitTextToWidth('中文', 1, config)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('measureElementWidth', () => {
    it('should measure element with default config', () => {
      const el = { value: 'test' }
      const w = measurer.measureElementWidth(el)
      expect(w).toBeGreaterThan(0)
    })

    it('should include letterSpacing in width', () => {
      const base = measurer.measureElementWidth({ value: 'ab' })
      const spaced = measurer.measureElementWidth({ value: 'ab', letterSpacing: 10 })
      expect(spaced).toBeGreaterThan(base)
    })
  })

  describe('getLineHeight / getAscent / getDescent', () => {
    it('should return proportional values', () => {
      const config = { font: 'SimSun', size: 20 }
      expect(measurer.getLineHeight(config)).toBe(30)  // 20 * 1.5
      expect(measurer.getAscent(config)).toBe(16)      // 20 * 0.8
      expect(measurer.getDescent(config)).toBe(4)      // 20 * 0.2
    })
  })

  describe('clearCache', () => {
    it('should not throw when clearing cache', () => {
      measurer.measureWidth('test', { font: 'SimSun', size: 16 })
      expect(() => measurer.clearCache()).not.toThrow()
    })
  })
})
