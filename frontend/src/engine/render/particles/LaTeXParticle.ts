// ============================================================
// LaTeXParticle — 数学公式渲染器 (R58, v6.0)
//
// 纯 Canvas 2D 渲染简单数学公式, 无需 KaTeX/MathJax
// 支持: 上下标/分式/根号/希腊字母/积分符号
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/SLIF'

// ---- 希腊字母映射 ----

const GREEK: Record<string, string> = {
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ',
  '\\delta': 'δ', '\\epsilon': 'ε', '\\theta': 'θ',
  '\\lambda': 'λ', '\\mu': 'μ', '\\pi': 'π',
  '\\sigma': 'σ', '\\omega': 'ω', '\\Omega': 'Ω',
  '\\Delta': 'Δ', '\\Sigma': 'Σ', '\\Pi': 'Π',
  '\\pm': '±', '\\times': '×', '\\div': '÷',
  '\\leq': '≤', '\\geq': '≥', '\\neq': '≠',
  '\\approx': '≈', '\\infty': '∞', '\\sqrt': '√',
  '\\int': '∫', '\\sum': '∑', '\\prod': '∏',
  '\\partial': '∂', '\\nabla': '∇', '\\cdot': '·',
}

// ---- Token 类型 ----

export type LaTeXToken =
  | { type: 'text'; value: string }
  | { type: 'sup'; value: string }
  | { type: 'sub'; value: string }
  | { type: 'frac'; num: string; den: string }
  | { type: 'sqrt'; inner: string }

type Token = LaTeXToken

// ---- 简单 LaTeX 解析器 ----

export function tokenize(latex: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < latex.length) {
    // 分式 \frac{num}{den}
    if (latex.startsWith('\\frac{', i)) {
      const braceStart = i + 5  // position of {
      const numEnd = findMatchingBrace(latex, braceStart)
      const num = latex.slice(braceStart + 1, numEnd)
      const denStart = numEnd + 1  // position of second {
      const denEnd = findMatchingBrace(latex, denStart)
      const den = latex.slice(denStart + 1, denEnd)
      tokens.push({ type: 'frac', num, den })
      i = denEnd + 1
      continue
    }

    // 根号 \sqrt{inner}
    if (latex.startsWith('\\sqrt{', i)) {
      const braceStart = i + 5  // position of {
      const end = findMatchingBrace(latex, braceStart)
      tokens.push({ type: 'sqrt', inner: latex.slice(braceStart + 1, end) })
      i = end + 1
      continue
    }

    // 上标 ^{...}
    if (latex[i] === '^' && latex[i + 1] === '{') {
      const braceStart = i + 1  // position of {
      const end = findMatchingBrace(latex, braceStart)
      tokens.push({ type: 'sup', value: latex.slice(braceStart + 1, end) })
      i = end + 1
      continue
    }

    // 下标 _{...}
    if (latex[i] === '_' && latex[i + 1] === '{') {
      const braceStart = i + 1  // position of {
      const end = findMatchingBrace(latex, braceStart)
      tokens.push({ type: 'sub', value: latex.slice(braceStart + 1, end) })
      i = end + 1
      continue
    }

    // 希腊字母/符号
    let matched = false
    for (const [cmd, char] of Object.entries(GREEK)) {
      if (latex.startsWith(cmd, i)) {
        tokens.push({ type: 'text', value: char })
        i += cmd.length
        matched = true
        break
      }
    }
    if (matched) continue

    // 普通文本
    tokens.push({ type: 'text', value: latex[i] })
    i++
  }

  return tokens
}

function findMatchingBrace(s: string, start: number): number {
  let depth = 0
  for (let j = start; j < s.length; j++) {
    if (s[j] === '{') depth++
    else if (s[j] === '}') {
      depth--
      if (depth === 0) return j
    }
  }
  return s.length
}

// ---- 粒子 ----

export function createLaTeXParticle(): IParticle {
  return {
    type: 'latex',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, _options?: RenderOptions): void {
      const latex = item.text || ''
      if (!latex) return

      const fontSize = item.size || 16
      const fontFamily = item.font || 'serif'
      const color = item.color || '#1F2937'

      ctx.save()
      ctx.fillStyle = color

      try {
        const tokens = tokenize(latex)
        renderFormula(ctx, tokens, x, y, fontSize, fontFamily, color)
      } catch {
        // 解析失败: 原样渲染 LaTeX 源码
        ctx.font = `${fontSize}px "${fontFamily}"`
        ctx.fillText(latex, x, y + fontSize * 0.8)
      }

      ctx.restore()
    },
  }
}

/** 递归渲染公式 token 列表 */
function renderFormula(
  ctx: CanvasRenderingContext2D,
  tokens: Token[],
  x: number, y: number,
  fontSize: number, fontFamily: string, color: string,
): number {
  let cx = x

  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        ctx.font = `italic ${fontSize}px "${fontFamily}"`
        ctx.fillStyle = color
        const metrics = ctx.measureText(token.value)
        ctx.fillText(token.value, cx, y + fontSize * 0.8)
        cx += metrics.width
        break
      }
      case 'sup': {
        const supSize = fontSize * 0.7
        ctx.font = `${supSize}px "${fontFamily}"`
        ctx.fillStyle = color
        ctx.fillText(token.value, cx, y)
        cx += ctx.measureText(token.value).width
        break
      }
      case 'sub': {
        const subSize = fontSize * 0.7
        ctx.font = `${subSize}px "${fontFamily}"`
        ctx.fillStyle = color
        ctx.fillText(token.value, cx, y + fontSize)
        cx += ctx.measureText(token.value).width
        break
      }
      case 'frac': {
        const smallSize = fontSize * 0.7
        const numW = ctx.measureText(token.num).width
        const denW = ctx.measureText(token.den).width
        const fracW = Math.max(numW, denW)

        ctx.font = `${smallSize}px "${fontFamily}"`
        ctx.fillStyle = color

        // 分子 (居中)
        ctx.fillText(token.num, cx + (fracW - numW) / 2, y + smallSize * 0.6)
        // 分母 (居中)
        ctx.fillText(token.den, cx + (fracW - denW) / 2, y + fontSize * 1.1)
        // 分数线
        const lineY = y + fontSize * 0.65
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, lineY)
        ctx.lineTo(cx + fracW, lineY)
        ctx.stroke()

        cx += fracW + 4
        break
      }
      case 'sqrt': {
        const innerW = ctx.measureText(token.inner).width
        const totalW = innerW + fontSize * 0.5

        ctx.font = `${fontSize}px "${fontFamily}"`
        ctx.fillStyle = color

        // 根号符号
        ctx.fillText('√', cx, y + fontSize * 0.85)
        // 内部文字
        ctx.fillText(token.inner, cx + fontSize * 0.4, y + fontSize * 0.8)

        // 上划线 (overline)
        const overlineY = y + fontSize * 0.15
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx + fontSize * 0.35, overlineY)
        ctx.lineTo(cx + totalW, overlineY)
        ctx.stroke()

        cx += totalW + 4
        break
      }
    }
  }

  return cx
}
