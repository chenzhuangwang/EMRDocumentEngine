import { describe, it, expect } from 'vitest'
import { createDomTextHost } from './DomTextHost'

describe('DomTextHost', () => {
  it('measure 返回宽度 (mock canvas: CJK=fontSize, latin=0.55×fontSize)', () => {
    const host = createDomTextHost()
    expect(host.measure('中', '16px "SimSun"').width).toBeCloseTo(16)
    expect(host.measure('a', '16px "SimSun"').width).toBeCloseTo(8.8)
  })

  it('getFontMetrics 返回 upem=1000 归一化度量', () => {
    const host = createDomTextHost()
    const fm = host.getFontMetrics('SimSun', 400, 'normal')
    expect(fm.fullWidthAdvance).toBe(1000)
    expect(fm.halfWidthAdvance).toBe(550)
    expect(fm.capHeight).toBe(662)
    expect(fm.xHeight).toBe(458)
  })

  it('isGlyphAvailable 空白字符恒为 true', () => {
    const host = createDomTextHost()
    expect(host.isGlyphAvailable('SimSun', ' ')).toBe(true)
    expect(host.isGlyphAvailable('SimSun', '')).toBe(true)
  })

  it('onReady 在无 FontFaceSet 环境 resolve (不 throw)', async () => {
    const host = createDomTextHost()
    await expect(host.onReady()).resolves.toBeUndefined()
  })
})
