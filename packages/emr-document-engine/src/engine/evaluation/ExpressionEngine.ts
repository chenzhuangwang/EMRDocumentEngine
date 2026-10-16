// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ExpressionEngine — 计算式求值器 (契约 §12.12.2 / §12.12.3 / §12.12.4)
//
// **绝不 eval**: 参考实现让作者写裸 JS 并执行它, 那等于拿模板文件当攻击面。
// 本模块是白名单文法的词法 + Pratt 解析 + 树遍历求值。
//
// 纯净性 (§27-§29): 不触任何宿主全局。**时间事实经 context 注入** ——
// 本文件内不得出现 `new Date()`(§12.12.7, 静态闸门守)。形状照
// FieldFormatter.FieldTextContext: 一个 document 域的纯函数 + 调用方填充的
// 上下文对象。
//
// 三层各自的职责, 不互相越界:
//   tokenize  字符 → token (不认识 `$`/模板串/正则, 遇到就报错, 不静默跳过)
//   parse     token → AST (语法错误带位置)
//   evaluate  AST × context → 结果 (语义错误带码)
//
// **求值器不认识文档**。引用怎么解析、撞键怎么办 (§12.12.3) 由调用方经
// `resolveRef` 回答 —— 它才拿得到 §12.10 的投影。这样本模块可脱文档单测,
// 也不会为了查一个键而反向依赖 document/。
// ================================================================

import type { ControlValue } from '../document/core/DocumentModel'

// ---- 值与结果 ----

/** 表达式内部值。`undefined` 是**空态**(引用的控件未填), 不是"没有值" */
export type CalcValue = number | string | boolean | undefined

/** 错误码 —— 必须**可分类** (契约 §12.12.9: 不许塌成"公式有误") */
export type CalcErrorCode =
  /** 词法/语法错误 */
  | 'syntax'
  /** 引用的键在文档里找不到 */
  | 'unresolved_reference'
  /** 一个键命中多个控件 → 不求值, 绝不挑一个 (§12.10.2 / §12.12.3) */
  | 'ambiguous_reference'
  /** 函数未注册 */
  | 'unknown_function'
  /** 实参个数/类型不符 */
  | 'bad_arguments'
  /** 参与了算术/比较, 但是空态 */
  | 'empty_reference'
  /** 字符串不是数字却参与了算术/数值比较 (§12.12.4) */
  | 'not_a_number'
  /** 引用了自己或成环 (§12.12.6, 由调用方在建图时报出) */
  | 'cycle'
  /** 结果类型不能当作显示值 */
  | 'not_displayable'

export interface CalcError {
  code: CalcErrorCode
  /** 人读说明 (英文, 供宿主 i18n 前兜底) */
  message: string
  /** 出错位置 (语法错误有; 语义错误一般无) */
  position?: number
  /** 撞键时附候选, 供宿主交给实施方去改键 (§12.10.2 的姿态) */
  candidateNodeIds?: string[]
}

/** 一次可见性指令 —— SHOW/HIDE 产生 */
export interface VisibilityDirective {
  /** 被指向的键 (SHOW/HIDE 的实参) */
  key: string
  visible: boolean
}

export type CalcResult =
  | {
    ok: true
    /**
     * 计算式角色由**表达式自己**决定, 不由宿主配置:
     *   含 SHOW/HIDE  → 'visibility' (X-EMR 的触发式 `if(..) SHOW(#x) else HIDE(#x)`)
     *   不含          → 'value'     (X-EMR 的赋值式 `= id1 + id2`)
     * 两种形式的判别因此是一致的, 而不是靠字符串前缀猜。
     */
    role: 'value'
    value: number | string
  }
  | {
    ok: true
    role: 'visibility'
    directive: VisibilityDirective
  }
  | { ok: false; error: CalcError }

// ---- 上下文 ----

/** 引用解析结果 —— 撞键与未找到在这里表达, 因为只有调用方拿得到投影 */
export type RefResolution =
  | { ok: true; value: ControlValue | undefined }
  | { ok: false; error: CalcError }

/** 已注册的纯函数 (内置或集成方注册)。入参已归一, 返回 CalcValue */
export type CalcFunction = (args: readonly CalcValue[]) => CalcValue | CalcError

export interface CalcContext {
  /**
   * 键 → 控件原始值。未填 = `{ ok: true, value: undefined }`。
   * 未找到 / 撞键 → `{ ok: false, error }` (后者带 candidateNodeIds)。
   */
  resolveRef(key: string): RefResolution
  /**
   * 时间基准 (契约 §12.12.7): 由**持有 computed-value set 的一方**在重算那
   * 一刻读一次并传进来。本模块不得读钟 —— 否则布局与绘制会拿到两个时刻。
   */
  now: Date
  /** 集成方注册的函数 (信任级别等同插件, §12.12.2) */
  functions?: ReadonlyMap<string, CalcFunction>
}

// ================================================================
// 1. 词法
// ================================================================

type TokenKind =
  | 'number' | 'string' | 'ref' | 'ident'
  | 'op' | 'lparen' | 'rparen' | 'comma' | 'question' | 'colon'
  | 'eof'

interface Token {
  kind: TokenKind
  /** number: 规范化后的数字文本; string/ref/ident/op: 原文 */
  text: string
  position: number
}

/** 双字符运算符必须先于单字符匹配, 否则 `<=` 会被读成 `<` + `=` */
const TWO_CHAR_OPS = ['==', '!=', '<=', '>=', '&&', '||'] as const
const ONE_CHAR_OPS = ['+', '-', '*', '/', '%', '<', '>', '!'] as const

function isDigit(ch: string): boolean { return ch >= '0' && ch <= '9' }
function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
}
function isIdentPart(ch: string): boolean { return isIdentStart(ch) || isDigit(ch) }
function isSpace(ch: string): boolean { return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' }

function syntaxError(message: string, position: number): CalcError {
  return { code: 'syntax', message, position }
}

/**
 * 字符 → token。**不认识就报错**, 不静默跳过 ——
 * 允许的字符集是白名单的一部分, 模板串 / 正则 / `$` 之类在这里就被挡下。
 */
function tokenize(src: string): Token[] | CalcError {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (isSpace(ch)) { i++; continue }

    // 数字 (不含正负号 —— 一元负号由 parser 处理, 否则 `1 -2` 会有歧义)
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1] ?? ''))) {
      const start = i
      while (i < src.length && (isDigit(src[i]) || src[i] === '.')) i++
      const text = src.slice(start, i)
      if ((text.match(/\./g) ?? []).length > 1) return syntaxError(`bad number "${text}"`, start)
      out.push({ kind: 'number', text, position: start })
      continue
    }

    // 字符串字面量: 只认单/双引号, 不支持转义序列之外的任何特殊形式
    if (ch === '\'' || ch === '"') {
      const quote = ch
      const start = i
      i++
      let text = ''
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          const next = src[i + 1]
          if (next === undefined) return syntaxError('unterminated string', start)
          text += next === 'n' ? '\n' : next === 't' ? '\t' : next
          i += 2
          continue
        }
        text += src[i]
        i++
      }
      if (i >= src.length) return syntaxError('unterminated string', start)
      i++ // 收尾引号
      out.push({ kind: 'string', text, position: start })
      continue
    }

    // 引用: [键] —— 键里的任何字符都允许 (键是配置里给的, 不是本模块的语法)
    if (ch === '[') {
      const start = i
      const end = src.indexOf(']', i + 1)
      if (end < 0) return syntaxError('unterminated reference "["', start)
      const key = src.slice(i + 1, end).trim()
      if (key === '') return syntaxError('empty reference "[]"', start)
      out.push({ kind: 'ref', text: key, position: start })
      i = end + 1
      continue
    }

    // `#键` 是 `[键]` 的糖 (参考实现写 SHOW(#id)) —— 同一件事不留两种语义
    if (ch === '#') {
      const start = i
      i++
      const keyStart = i
      while (i < src.length && !isSpace(src[i]) && src[i] !== ')' && src[i] !== ',') i++
      const key = src.slice(keyStart, i).trim()
      if (key === '') return syntaxError('empty reference "#"', start)
      out.push({ kind: 'ref', text: key, position: start })
      continue
    }

    // 标识符 / 函数名 / 真值字面量
    if (isIdentStart(ch)) {
      const start = i
      while (i < src.length && isIdentPart(src[i])) i++
      out.push({ kind: 'ident', text: src.slice(start, i), position: start })
      continue
    }

    // 双字符运算符优先
    const two = src.slice(i, i + 2)
    if ((TWO_CHAR_OPS as readonly string[]).includes(two)) {
      out.push({ kind: 'op', text: two, position: i })
      i += 2
      continue
    }
    if ((ONE_CHAR_OPS as readonly string[]).includes(ch)) {
      out.push({ kind: 'op', text: ch, position: i })
      i++
      continue
    }

    if (ch === '(') { out.push({ kind: 'lparen', text: ch, position: i }); i++; continue }
    if (ch === ')') { out.push({ kind: 'rparen', text: ch, position: i }); i++; continue }
    if (ch === ',') { out.push({ kind: 'comma', text: ch, position: i }); i++; continue }
    if (ch === '?') { out.push({ kind: 'question', text: ch, position: i }); i++; continue }
    if (ch === ':') { out.push({ kind: 'colon', text: ch, position: i }); i++; continue }

    return syntaxError(`unexpected character "${ch}"`, i)
  }
  out.push({ kind: 'eof', text: '', position: src.length })
  return out
}

// ================================================================
// 2. 语法 (Pratt / 优先级爬升)
// ================================================================

export type Ast =
  | { kind: 'literal'; value: number | string | boolean }
  | { kind: 'ref'; key: string }
  | { kind: 'unary'; op: '!' | '-'; operand: Ast }
  | { kind: 'binary'; op: string; left: Ast; right: Ast }
  | { kind: 'ternary'; cond: Ast; then: Ast; else: Ast }
  | { kind: 'call'; name: string; args: Ast[] }

/** 二元运算符优先级 (大者紧) —— 表驱动, 免得 8 层递归函数写得看不出来 */
const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
}

/** 真值字面量 —— 大小写不敏感, 与函数名同一条路径 */
const LITERAL_IDENTS: Record<string, boolean> = { true: true, false: false }

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos] }
  private next(): Token { return this.tokens[this.pos++] }

  /** 解析结束后剩下的 token —— 供 parseFormula 检查尾渣 */
  rest(): Token { return this.peek() }

  parseExpression(minPrecedence = 0): Ast | CalcError {
    let left = this.parseUnary()
    if (this.isError(left)) return left

    for (;;) {
      const tok = this.peek()
      // 三元挂在最低优先级之上, 右结合
      if (tok.kind === 'question' && minPrecedence <= 0) {
        this.next()
        const then = this.parseExpression()
        if (this.isError(then)) return then
        if (this.peek().kind !== 'colon') {
          return syntaxError('expected ":" in ternary', this.peek().position)
        }
        this.next()
        const otherwise = this.parseExpression()
        if (this.isError(otherwise)) return otherwise
        left = { kind: 'ternary', cond: left, then, else: otherwise }
        continue
      }
      if (tok.kind !== 'op') break
      const prec = BINARY_PRECEDENCE[tok.text]
      if (prec === undefined || prec < minPrecedence) break
      this.next()
      // 全部左结合: 右操作数用 prec+1 收, 于是 `a - b - c` = `(a-b)-c`
      const right = this.parseExpression(prec + 1)
      if (this.isError(right)) return right
      left = { kind: 'binary', op: tok.text, left, right }
    }
    return left
  }

  private parseUnary(): Ast | CalcError {
    const tok = this.peek()
    if (tok.kind === 'op' && (tok.text === '!' || tok.text === '-')) {
      this.next()
      const operand = this.parseUnary()
      if (this.isError(operand)) return operand
      return { kind: 'unary', op: tok.text as '!' | '-', operand }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): Ast | CalcError {
    const tok = this.next()
    switch (tok.kind) {
      case 'number': {
        const n = Number(tok.text)
        if (!Number.isFinite(n)) return syntaxError(`bad number "${tok.text}"`, tok.position)
        return { kind: 'literal', value: n }
      }
      case 'string':
        return { kind: 'literal', value: tok.text }
      case 'ref':
        return { kind: 'ref', key: tok.text }
      case 'ident': {
        const lit = LITERAL_IDENTS[tok.text.toLowerCase()]
        if (lit !== undefined) return { kind: 'literal', value: lit }
        if (this.peek().kind !== 'lparen') {
          // 裸标识符**不是**引用: 引用必须显式 (§12.12.3 要求引用可被静态收集,
          // 裸标识符会让依赖索引漏掉引用, 于是"改 A 了 X 不重算"这种静默错)
          return syntaxError(
            `bare identifier "${tok.text}" — references must be written as [key]`,
            tok.position,
          )
        }
        this.next() // consume '('
        const args: Ast[] = []
        if (this.peek().kind !== 'rparen') {
          for (;;) {
            const arg = this.parseExpression()
            if (this.isError(arg)) return arg
            args.push(arg)
            if (this.peek().kind === 'comma') { this.next(); continue }
            break
          }
        }
        if (this.peek().kind !== 'rparen') {
          return syntaxError(`expected ")" closing call to ${tok.text}`, this.peek().position)
        }
        this.next()
        return { kind: 'call', name: tok.text, args }
      }
      case 'lparen': {
        const inner = this.parseExpression()
        if (this.isError(inner)) return inner
        if (this.peek().kind !== 'rparen') {
          return syntaxError('expected ")"', this.peek().position)
        }
        this.next()
        return inner
      }
      case 'eof':
        return syntaxError('unexpected end of expression', tok.position)
      default:
        return syntaxError(`unexpected token "${tok.text}"`, tok.position)
    }
  }

  private isError(v: Ast | CalcError): v is CalcError {
    return (v as CalcError).code !== undefined
  }
}

/** 表达式 → AST。语法/词法错误在这里一次报清, 不抛异常 */
export function parseFormula(src: string): Ast | CalcError {
  const tokens = tokenize(src)
  if (!Array.isArray(tokens)) return tokens
  const parser = new Parser(tokens)
  const ast = parser.parseExpression()
  if ((ast as CalcError).code !== undefined) return ast as CalcError
  // 尾部必须干净: `1 + 2 3` 之类的残渣要报错, 不能只算前半段
  const rest = parser.rest()
  if (rest.kind !== 'eof') {
    return syntaxError(`unexpected trailing token "${rest.text}"`, rest.position)
  }
  return ast as Ast
}

// ================================================================
// 3. 求值
// ================================================================

/** 严格布尔: 只接受 boolean, 不引入 truthiness (§12.12.4 不许 NaN 之类继续算) */
function asBool(v: CalcValue): boolean | CalcError {
  if (typeof v === 'boolean') return v
  return { code: 'bad_arguments', message: 'operand must be a boolean' }
}

function isErr(v: unknown): v is CalcError {
  return typeof v === 'object' && v !== null && (v as CalcError).code !== undefined
}

/**
 * 数字归一 (契约 §12.12.4): 数字原样; **能完整解析为有限数字的字符串**按数字;
 * 空态报 empty_reference; 其余 (含 string[]) 报 not_a_number。
 *
 * 这是**读路径**的宽松。与 §12.10.3「写入不做强制转换」不冲突 —— 那条管的是把
 * 外部值写进文档, 这条管的是把文档里的值拿去算, 方向相反。两者不得互为先例。
 */
function asNumber(v: CalcValue): number | CalcError {
  if (typeof v === 'number') return v
  if (v === undefined) return { code: 'empty_reference', message: 'referenced control is empty' }
  if (typeof v === 'string') {
    const t = v.trim()
    if (t !== '' && Number.isFinite(Number(t))) return Number(t)
    return { code: 'not_a_number', message: `"${v}" is not a number` }
  }
  return { code: 'not_a_number', message: 'operand is not a number' }
}

/** `+` 的字符串连接分支: 两侧都是**非数字**字符串时才连接, 否则走数值加法 */
function tryNumeric(v: CalcValue): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const t = v.trim()
    if (t !== '' && Number.isFinite(Number(t))) return Number(t)
  }
  return null
}

interface EvalState {
  directives: VisibilityDirective[]
}

function evaluateAst(ast: Ast, ctx: CalcContext, state: EvalState): CalcValue | CalcError {
  switch (ast.kind) {
    case 'literal':
      return ast.value

    case 'ref': {
      const r = ctx.resolveRef(ast.key)
      // 撞键/未找到的错误**原样往上抛** —— 本模块不认识文档, 不替调用方做决定
      if (!r.ok) return r.error
      // string[] 在这里保持数组身份不进来(ControlValue 可能是数组), 用下标语义
      // 会引入隐式规则; 故多选值一律当"不可算"处理, 交给显式函数(SUM)去接。
      const v = r.value
      if (Array.isArray(v)) return { code: 'not_a_number', message: 'multi-select value cannot be used in an expression' }
      return v
    }

    case 'unary': {
      const operand = evaluateAst(ast.operand, ctx, state)
      if (isErr(operand)) return operand
      if (ast.op === '!') {
        const b = asBool(operand)
        return isErr(b) ? b : !b
      }
      const n = asNumber(operand)
      return isErr(n) ? n : -n
    }

    case 'ternary': {
      const cond = evaluateAst(ast.cond, ctx, state)
      if (isErr(cond)) return cond
      const b = asBool(cond)
      if (isErr(b)) return b
      // 只求值命中的那一支 —— 另一支里的引用不许影响结果(短路)
      return evaluateAst(b ? ast.then : ast.else, ctx, state)
    }

    case 'binary':
      return evaluateBinary(ast, ctx, state)

    case 'call':
      return evaluateCall(ast, ctx, state)
  }
}

function evaluateBinary(
  ast: Extract<Ast, { kind: 'binary' }>,
  ctx: CalcContext,
  state: EvalState,
): CalcValue | CalcError {
  const op = ast.op

  // 逻辑运算短路: 右侧不成立时右侧不求值
  if (op === '&&' || op === '||') {
    const left = evaluateAst(ast.left, ctx, state)
    if (isErr(left)) return left
    const lb = asBool(left)
    if (isErr(lb)) return lb
    if (op === '&&' && !lb) return false
    if (op === '||' && lb) return true
    const right = evaluateAst(ast.right, ctx, state)
    if (isErr(right)) return right
    const rb = asBool(right)
    return isErr(rb) ? rb : rb
  }

  const left = evaluateAst(ast.left, ctx, state)
  if (isErr(left)) return left
  const right = evaluateAst(ast.right, ctx, state)
  if (isErr(right)) return right

  switch (op) {
    case '+': {
      // 空态先单独判, 否则会被下面的"混合类型"规则抢先拦下, 错误码从
      // empty_reference 退化成 not_a_number —— "没填"与"不是数字"是两个事实,
      // 作者看到前者才知道该去补哪个字段。
      if (left === undefined || right === undefined) {
        return { code: 'empty_reference', message: 'referenced control is empty' }
      }
      // 三条规则, 按顺序判, 不留"看情况":
      //   两侧都能当数字   → 数值加法 ('3' + '4' = 7)
      //   两侧都是字符串   → 连接     ('张' + '三' = '张三')
      //   一侧数字一侧非数字串 → **报错** —— 想拼标签就写 TEXT(n) 显式说明意图。
      // 之所以不对混合情形做"聪明"处理: `'第' + 3` 到底是要 '第3' 还是要报错,
      // 只有作者知道; 猜错了就是静默产出错误的病历文本。
      const ln = tryNumeric(left)
      const rn = tryNumeric(right)
      if (ln !== null && rn !== null) return ln + rn
      if (typeof left === 'string' && typeof right === 'string') return left + right
      return {
        code: 'not_a_number',
        message: 'cannot add a number to text — use TEXT(value) to convert explicitly',
      }
    }
    case '-': case '*': case '/': case '%': {
      const a = asNumber(left)
      if (isErr(a)) return a
      const b = asNumber(right)
      if (isErr(b)) return b
      if ((op === '/' || op === '%') && b === 0) {
        return { code: 'bad_arguments', message: 'division by zero' }
      }
      if (op === '-') return a - b
      if (op === '*') return a * b
      if (op === '/') return a / b
      return a % b
    }
    case '==': case '!=': {
      const bothNumeric = tryNumeric(left) !== null && tryNumeric(right) !== null
      const eq = bothNumeric
        ? tryNumeric(left) === tryNumeric(right)
        : normalizeForEquality(left) === normalizeForEquality(right)
      return op === '==' ? eq : !eq
    }
    case '<': case '<=': case '>': case '>=': {
      const a = asNumber(left)
      if (isErr(a)) return a
      const b = asNumber(right)
      if (isErr(b)) return b
      if (op === '<') return a < b
      if (op === '<=') return a <= b
      if (op === '>') return a > b
      return a >= b
    }
    default:
      return { code: 'syntax', message: `unknown operator "${op}"` }
  }
}

/** 相等比较里的空态: undefined 与空串视为同一个"没填" */
function normalizeForEquality(v: CalcValue): string | number | boolean {
  if (v === undefined) return ''
  return v
}

function evaluateCall(
  ast: Extract<Ast, { kind: 'call' }>,
  ctx: CalcContext,
  state: EvalState,
): CalcValue | CalcError {
  const name = ast.name.toUpperCase()

  // SHOW/HIDE 是**指令**而不是普通函数: 实参必须是引用(键), 产生一条可见性指令。
  // 它们不返回数值 —— 含 SHOW/HIDE 的公式角色是 'visibility' (§12.12 的触发式)。
  if (name === 'SHOW' || name === 'HIDE') {
    if (ast.args.length !== 1) {
      return { code: 'bad_arguments', message: `${name} takes exactly one reference` }
    }
    const arg = ast.args[0]
    if (arg.kind !== 'ref') {
      return { code: 'bad_arguments', message: `${name} requires a [key] reference` }
    }
    const visible = name === 'SHOW'
    state.directives.push({ key: arg.key, visible })
    // 返回这条指令断言的真值 —— 于是它能进三元/逻辑式, 而 HIDE 的那一支是 false
    return visible
  }

  // IF 是**特殊形式而不是普通函数**: 普通调用会先把三个实参全求值, 那样
  // `IF(c, a, b)` 就失去了短路 —— 未命中那一支里的引用会照样报错。三元 `?:`
  // 一直是短路的, IF 必须与它同语义, 否则同一件事的两种写法会给出不同结果。
  if (name === 'IF') {
    if (ast.args.length !== 3) return { code: 'bad_arguments', message: 'IF takes three arguments' }
    const cond = evaluateAst(ast.args[0], ctx, state)
    if (isErr(cond)) return cond
    const b = asBool(cond)
    if (isErr(b)) return b
    return evaluateAst(b ? ast.args[1] : ast.args[2], ctx, state)
  }

  const fn = BUILTINS[name] ?? ctx.functions?.get(name)
  if (!fn) return { code: 'unknown_function', message: `unknown function "${ast.name}"` }

  const args: CalcValue[] = []
  for (const a of ast.args) {
    const v = evaluateAst(a, ctx, state)
    if (isErr(v)) return v
    args.push(v)
  }
  const r = fn(args, ctx)
  return isErr(r) ? r : r
}

// ================================================================
// 4. 内置函数 (闭表, §12.12.2)
// ================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm[:ss]` → Date; 非法返回 null */
function parseDateLike(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, hh, mi, ss] = m
  const date = new Date(
    Number(y), Number(mo) - 1, Number(d),
    Number(hh ?? 0), Number(mi ?? 0), Number(ss ?? 0),
  )
  // 反查一遍, 挡掉 2026-02-30 这类"合法形状但不存在"的日期
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 ||
      date.getDate() !== Number(d)) return null
  return date
}

/** 实参取日期: 字符串按 YYYY-MM-DD 解析; 空态原样返回(调用方决定语义) */
function argDate(v: CalcValue): Date | null | CalcError {
  if (v === undefined) return null
  if (typeof v !== 'string') return { code: 'bad_arguments', message: 'date argument must be a string' }
  const d = parseDateLike(v)
  if (!d) return { code: 'bad_arguments', message: `"${v}" is not a date (expected YYYY-MM-DD)` }
  return d
}

/** 实参取数字 */
function argNumber(v: CalcValue): number | CalcError {
  const n = asNumber(v)
  return n
}

const BUILTINS: Record<string, (args: readonly CalcValue[], ctx: CalcContext) => CalcValue | CalcError> = {
  /**
   * GETAGE(出生日期) — 周岁。空态返回空态 (控件显示占位符), **不是 0**:
   * "还没填出生日期"与"今天刚出生"是两件事, 混起来是临床错误。
   */
  GETAGE: (args, ctx) => {
    if (args.length !== 1) return { code: 'bad_arguments', message: 'GETAGE takes one date' }
    const d = argDate(args[0])
    if (isErr(d)) return d
    if (d === null) return undefined
    const now = ctx.now
    let age = now.getFullYear() - d.getFullYear()
    const beforeBirthday =
      now.getMonth() < d.getMonth() ||
      (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())
    if (beforeBirthday) age--
    // 出生日期在未来 → 负岁是数据错误, 不返回负数让下游去猜
    if (age < 0) return { code: 'bad_arguments', message: 'birth date is in the future' }
    return age
  },

  DIFF_DATE_DAYS: (args, ctx) => {
    if (args.length !== 2) return { code: 'bad_arguments', message: 'DIFF_DATE_DAYS takes two dates' }
    const a = argDate(args[0]); if (isErr(a)) return a
    const b = argDate(args[1]); if (isErr(b)) return b
    if (a === null || b === null) return undefined
    return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY)
  },

  DIFF_DATE_HOURS: (args, ctx) => {
    if (args.length !== 2) return { code: 'bad_arguments', message: 'DIFF_DATE_HOURS takes two dates' }
    const a = argDate(args[0]); if (isErr(a)) return a
    const b = argDate(args[1]); if (isErr(b)) return b
    if (a === null || b === null) return undefined
    return Math.round((b.getTime() - a.getTime()) / (60 * 60 * 1000))
  },

  /** SUM(...) — 逐项数值化相加; 空态项跳过 (缺失项不加 0, 也不报错) */
  SUM: (args) => {
    let total = 0
    for (const a of args) {
      if (a === undefined) continue
      const n = asNumber(a)
      if (isErr(n)) return n
      total += n
    }
    return total
  },

  /** ROUND(值, 小数位) — 小数位缺省 0 */
  ROUND: (args) => {
    if (args.length < 1 || args.length > 2) {
      return { code: 'bad_arguments', message: 'ROUND takes one or two arguments' }
    }
    const n = argNumber(args[0]); if (isErr(n)) return n
    const digits = args.length === 2 ? argNumber(args[1]) : 0
    if (isErr(digits)) return digits
    if (!Number.isInteger(digits) || digits < 0 || digits > 10) {
      return { code: 'bad_arguments', message: 'ROUND digits must be an integer 0..10' }
    }
    const f = Math.pow(10, digits)
    return Math.round(n * f) / f
  },

  /** TEXT(值) — 显式转字符串。存在的理由是 `+` 的混合情形报错而不是猜:
   *  `'第' + 3` 被拒, 作者写 `'第' + TEXT(3)` 说明意图。 */
  TEXT: (args) => {
    if (args.length !== 1) return { code: 'bad_arguments', message: 'TEXT takes one argument' }
    const v = args[0]
    if (v === undefined) return ''
    return typeof v === 'string' ? v : String(v)
  },

  /** LEN(字符串) — 便于拼住院号之类的定长判断 */
  LEN: (args) => {
    if (args.length !== 1) return { code: 'bad_arguments', message: 'LEN takes one argument' }
    const v = args[0]
    if (v === undefined) return 0
    return typeof v === 'string' ? v.length : String(v).length
  },
}

// ================================================================
// 5. 对外入口
// ================================================================

/**
 * 求值一条公式。
 *
 * 角色由表达式自己决定: 注册了 SHOW/HIDE 指令 → 'visibility'; 否则 → 'value'。
 * 两种结果互斥: 一条公式要么算一个显示值, 要么指挥别处的可见性
 * (参考实现的 `= a + b` 与 `if(..) SHOW(#x) else HIDE(#x)` 正好落在两边)。
 */
export function evaluateFormula(src: string, ctx: CalcContext): CalcResult {
  const ast = parseFormula(src)
  if (isErr(ast)) return { ok: false, error: ast }

  const state: EvalState = { directives: [] }
  const value = evaluateAst(ast, ctx, state)
  if (isErr(value)) return { ok: false, error: value }

  if (state.directives.length > 0) {
    // 一条公式只产一条指令 —— 短路保证同一分支里的多个 SHOW/HIDE 不会同时生效,
    // 但真的写了两条(如 `SHOW([A]) + SHOW([B])`)就不该猜哪一条算数。
    if (state.directives.length > 1) {
      return {
        ok: false,
        error: {
          code: 'bad_arguments',
          message: 'a formula must produce exactly one visibility directive',
        },
      }
    }
    return { ok: true, role: 'visibility', directive: state.directives[0] }
  }

  // 值是空态或布尔 → 不是可显示的派生值。空态**不是错误**(未填的出生日期算不出
  // 年龄是正常状态), 但调用方要能区分; 故这里明确报 not_displayable 让上层
  // 决定是"显示占位符"还是"报错"。
  if (value === undefined) {
    return { ok: false, error: { code: 'empty_reference', message: 'formula produced no value' } }
  }
  if (typeof value === 'boolean') {
    return {
      ok: false,
      error: {
        code: 'not_displayable',
        message: 'a value formula must produce a number or a string (use SHOW/HIDE to control visibility)',
      },
    }
  }
  return { ok: true, role: 'value', value }
}

/**
 * 作者可用的名字 —— 内置函数 **+ 特殊形式**。
 *
 * 特殊形式 (SHOW / HIDE / IF) 不写在 BUILTINS 里, 因为它们必须在求值阶段
 * 特殊对待 (SHOW/HIDE 产指令, IF 要短路), 但对作者而言它们和函数一样是
 * 可用的名字, 所以作者化面的提示与文档必须看见它们 —— 漏了它们, 提示就
 * 在骗人。
 */
export function builtinFunctionNames(): string[] {
  return [...Object.keys(BUILTINS), ...SPECIAL_FORM_NAMES].sort()
}

/** 求值阶段特殊对待的名字 (§12.12.2 / §12.12.5) */
export const SPECIAL_FORM_NAMES = ['IF', 'SHOW', 'HIDE'] as const
