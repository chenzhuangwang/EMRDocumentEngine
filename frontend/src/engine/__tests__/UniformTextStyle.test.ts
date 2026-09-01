// ============================================================
// uniformTextStyle — 选区样式快照 (统一/混合/空) 单测
//
// 回归守护: 工具栏样式按钮联动依赖「统一→值 / 混合→undefined」语义。
// ============================================================

import { describe, it, expect } from 'vitest'
import { uniformTextStyle } from '../document/factory/ElementFormatter'
import type { TextStyle } from '../document/core/DocumentModel'

describe('uniformTextStyle', () => {
  it('空数组返回空对象', () => {
    expect(uniformTextStyle([])).toEqual({})
  })

  it('单一样式原样返回 (含全部字段)', () => {
    const s: TextStyle = { font: 'SimSun', size: 16, bold: true, italic: false, color: '#000000' }
    expect(uniformTextStyle([s])).toEqual({ ...s })
  })

  it('全部一致的多个样式 → 返回该值', () => {
    const a: TextStyle = { bold: true, italic: false, font: 'SimSun' }
    const b: TextStyle = { bold: true, italic: false, font: 'SimSun' }
    expect(uniformTextStyle([a, b]).bold).toBe(true)
    expect(uniformTextStyle([a, b]).italic).toBe(false)
    expect(uniformTextStyle([a, b]).font).toBe('SimSun')
  })

  it('混合样式 → 不一致字段置 undefined (不定态)', () => {
    const bold: TextStyle = { bold: true, font: 'SimSun', size: 16 }
    const normal: TextStyle = { bold: false, font: 'SimSun', size: 16 }
    const out = uniformTextStyle([bold, normal])
    expect(out.bold).toBeUndefined()      // 混合 → 未激活
    expect(out.font).toBe('SimSun')       // 一致 → 保留
    expect(out.size).toBe(16)
  })

  it('部分字段缺失 vs 显式 false 视为不一致 (严格等值)', () => {
    const a: TextStyle = { bold: true }
    const b: TextStyle = {}               // bold 未定义
    expect(uniformTextStyle([a, b]).bold).toBeUndefined()
  })

  it('字体/字号混合 → 下拉框回退默认 (undefined)', () => {
    const a: TextStyle = { font: 'SimSun', size: 16 }
    const b: TextStyle = { font: 'SimHei', size: 20 }
    const out = uniformTextStyle([a, b])
    expect(out.font).toBeUndefined()
    expect(out.size).toBeUndefined()
  })
})
