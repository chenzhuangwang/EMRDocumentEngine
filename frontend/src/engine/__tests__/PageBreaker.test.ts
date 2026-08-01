// ============================================================
// PageBreaker 单元测试 (含孤行/寡行控制)
// ============================================================

import { describe, it, expect } from 'vitest'
import { PageBreaker, type ILine } from '../layout/PageBreaker'
import { DEFAULT_PAGE_SETUP, type PageSetup } from '../document/DocumentModel'

// Helper: create a line with given characters and height
function line(chars: string, height = 20): ILine {
  const endsWithNewline = chars.endsWith('\n')
  const value = endsWithNewline ? chars.slice(0, -1) : chars
  return {
    elements: [
      ...(value ? [{ id: 'x', type: 'text', value, size: 16, font: 'SimSun' }] : []),
      ...(endsWithNewline ? [{ id: 'nl', type: 'text', value: '\n', size: 16, font: 'SimSun' }] : []),
    ],
    width: 100,
    height,
    maxAscent: height * 0.8,
    maxDescent: height * 0.2,
  }
}

const setup: PageSetup = {
  ...DEFAULT_PAGE_SETUP,
  height: 500,
  marginTop: 20,
  marginBottom: 20,
}

const emptyHeaders: ILine[] = []
const emptyFooters: ILine[] = []

describe('PageBreaker', () => {
  const breaker = new PageBreaker()

  it('should return at least one page for empty lines', () => {
    const pages = breaker.breakPages([], emptyHeaders, emptyFooters, setup)
    expect(pages.length).toBe(1)
  })

  it('should keep all lines on one page when they fit', () => {
    const lines = [line('aaa'), line('bbb'), line('ccc\n')]
    const pages = breaker.breakPages(lines, emptyHeaders, emptyFooters, setup)
    expect(pages.length).toBe(1)
  })

  it('should split into multiple pages when content overflows', () => {
    const lines = Array.from({ length: 50 }, (_, i) => line(`L${i}`))
    const pages = breaker.breakPages(lines, emptyHeaders, emptyFooters, setup)
    expect(pages.length).toBeGreaterThan(1)
  })

  it('should handle explicit page breaks', () => {
    const pageBreakLine: ILine = {
      elements: [{ id: 'pb', type: 'page_break', value: '' }],
      width: 0, height: 0, maxAscent: 0, maxDescent: 0,
    }
    const pages = breaker.breakPages([line('a'), pageBreakLine, line('b')], emptyHeaders, emptyFooters, setup)
    expect(pages.length).toBe(2)
  })

  it('should avoid single orphan line at bottom of page', () => {
    const fillLines = Array.from({ length: 21 }, (_, i) => line(`f${i}\n`))
    const paragraph = [line('p1'), line('p2'), line('p3\n')]
    const pages = breaker.breakPages([...fillLines, ...paragraph], emptyHeaders, emptyFooters, setup)
    for (const page of pages) {
      let trailingLines = 0
      for (let i = page.lines.length - 1; i >= 0; i--) {
        const lastEl = page.lines[i].elements[page.lines[i].elements.length - 1]
        if (lastEl?.value === '\n') break
        trailingLines++
      }
      if (trailingLines > 0) expect(trailingLines).toBeGreaterThanOrEqual(2)
    }
  })

  it('should attach header/footer lines to pages', () => {
    const hdr = [line('Header')]
    const ftr = [line('Footer')]
    const pages = breaker.breakPages([line('content')], hdr, ftr, setup)
    expect(pages[0].headerLines).toEqual(hdr)
    expect(pages[0].footerLines).toEqual(ftr)
  })
})
