// ============================================================
// PageBreaker 单元测试 (含孤行/寡行控制)
// ============================================================

import { describe, it, expect } from 'vitest'
import { PageBreaker } from '../layout/PageBreaker'
import { type ILine, type IPageSetup, DEFAULT_PAGE_SETUP, ElementType } from '../document/DocumentModel'

// Helper: create a line with given characters and height
function line(chars: string, height = 20): ILine {
  const endsWithNewline = chars.endsWith('\n')
  const value = endsWithNewline ? chars.slice(0, -1) : chars
  return {
    elements: [
      ...(value ? [{ id: 'x', type: ElementType.TEXT, value, size: 16, font: 'SimSun' }] : []),
      ...(endsWithNewline ? [{ id: 'nl', type: ElementType.TEXT, value: '\n', size: 16, font: 'SimSun' }] : []),
    ],
    width: 100,
    height,
    maxAscent: height * 0.8,
    maxDescent: height * 0.2,
  }
}

// A4 portrait with generous content area
const setup: IPageSetup = {
  ...DEFAULT_PAGE_SETUP,
  height: 500,
  marginTop: 20,
  marginBottom: 20,
  headerHeight: 0,
  footerHeight: 0,
}
// content height = 500 - 20 - 20 - 0 - 0 = 460px

const emptyHeaders: ILine[] = []
const emptyFooters: ILine[] = []

describe('PageBreaker', () => {
  const breaker = new PageBreaker()

  describe('breakPages - basic', () => {
    it('should return at least one page for empty lines', () => {
      const pages = breaker.breakPages([], emptyHeaders, emptyFooters, setup)
      expect(pages.length).toBe(1)
      expect(pages[0].lines).toEqual([])
    })

    it('should keep all lines on one page when they fit', () => {
      const lines = [line('aaa'), line('bbb'), line('ccc\n')]
      const pages = breaker.breakPages(lines, emptyHeaders, emptyFooters, setup)
      expect(pages.length).toBe(1)
      expect(pages[0].lines.length).toBe(3)
    })

    it('should split into multiple pages when content overflows', () => {
      // Each line is 20px, content area is 460px → ~23 lines per page
      const lines = Array.from({ length: 50 }, (_, i) => line(`L${i}`))
      const pages = breaker.breakPages(lines, emptyHeaders, emptyFooters, setup)
      expect(pages.length).toBeGreaterThan(1)
    })

    it('should handle explicit page breaks', () => {
      const pageBreak: ILine = {
        elements: [{ id: 'pb', type: ElementType.PAGE_BREAK, value: '' }],
        width: 0,
        height: 0,
        maxAscent: 0,
        maxDescent: 0,
      }
      const lines = [line('a'), pageBreak, line('b')]
      const pages = breaker.breakPages(lines, emptyHeaders, emptyFooters, setup)
      expect(pages.length).toBe(2)
    })
  })

  describe('breakPages - orphan/widow control', () => {
    it('should avoid single orphan line at bottom of page', () => {
      // Fill first page to near capacity, then a 3-line paragraph.
      // With contentHeight=460 and lineHeight=20, max 23 lines per page.
      const fillLines = Array.from({ length: 21 }, (_, i) => line(`f${i}\n`)) // 21 complete paragraphs
      const paragraph = [line('p1'), line('p2'), line('p3\n')] // 3-line paragraph that spans pages

      const pages = breaker.breakPages(
        [...fillLines, ...paragraph],
        emptyHeaders,
        emptyFooters,
        setup
      )

      // The last paragraph should not have a single orphan line
      for (const page of pages) {
        const pageLines = page.lines
        if (pageLines.length === 0) continue

        // Find incomplete paragraphs (last element is not \n)
        // Walk backward from page end
        let trailingLines = 0
        for (let i = pageLines.length - 1; i >= 0; i--) {
          const lastEl = pageLines[i].elements[pageLines[i].elements.length - 1]
          if (lastEl?.value === '\n') break
          trailingLines++
        }
        // No incomplete paragraph should have exactly 1 line (would be orphan)
        if (trailingLines > 0) {
          expect(trailingLines).toBeGreaterThanOrEqual(2)
        }
      }
    })

    it('should produce pages with headerLines and footerLines attached', () => {
      const hdr = [line('Header')]
      const ftr = [line('Footer')]
      const lines = [line('content')]
      const pages = breaker.breakPages(lines, hdr, ftr, setup)
      expect(pages.length).toBe(1)
      expect(pages[0].headerLines).toEqual(hdr)
      expect(pages[0].footerLines).toEqual(ftr)
    })

    it('should handle page numbers correctly', () => {
      const lines = Array.from({ length: 50 }, (_, i) => line(`L${i}\n`))
      const pages = breaker.breakPages(lines, emptyHeaders, emptyFooters, setup)
      for (let i = 0; i < pages.length; i++) {
        expect(pages[i].pageIndex).toBe(i)
      }
    })
  })
})
