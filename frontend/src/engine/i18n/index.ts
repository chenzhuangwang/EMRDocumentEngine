// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// i18n — 国际化基础 (R53, v6.0)
//
// LocaleMessages + setLocale/getLocale + 内置 zh-CN/en-US
// 支持第三方部分覆盖
//
// 订阅机制 (v6.1 补): UI 切语言后必须重渲染, 而 setLocale 原先只改字段不通知。
// 这里补 subscribe/getVersion/version, 形状**照抄 EditorStore** (同一个仓库里
// 只该有一种可观察对象范式)。React 侧绑定在 src/i18n/useTranslation.ts。
//
// 契约 §27.3: `locale` 仍是 app-wide 单例, 只是多带了订阅装置 —— 它**不得**
// 挪进 EditorStore/Zustand (那会造成 §7.5 duplicate state, 并把"语言"降级成
// per-Editor 事实)。其余模块级单例仍禁止携带可变状态。
//
// ⚠ 采用度现状: 本文件机制齐备, 但 `components/`、`pages/` 目前**零处**使用
// t() —— 全仓文案仍硬编码, 切到 en-US 界面文字不会变。见功能清单 156 行。
// ============================================================

export type Locale = 'zh-CN' | 'en-US'

/** 插值/复数参数 —— 值一律先转字符串再插入 */
export type LocaleParams = Record<string, string | number>

export interface LocaleMessages {
  // 通用
  'common.save': string
  'common.cancel': string
  'common.confirm': string
  'common.delete': string
  'common.close': string
  'common.search': string
  'common.loading': string
  'common.noData': string
  // 编辑器
  'editor.undo': string
  'editor.redo': string
  'editor.copy': string
  'editor.cut': string
  'editor.paste': string
  'editor.selectAll': string
  'editor.bold': string
  'editor.italic': string
  'editor.underline': string
  'editor.strikethrough': string
  'editor.fontSize': string
  'editor.fontFamily': string
  'editor.alignLeft': string
  'editor.alignCenter': string
  'editor.alignRight': string
  'editor.bulletList': string
  'editor.orderedList': string
  // 插值 / 复数示范键 (为两种形态留真实样例, 不是文案替换)
  /** 插值: `{current}` / `{total}` */
  'editor.pageOf': string
  /** 复数: ICU 单层 `{n, plural, one {…} other {…}}` */
  'editor.controlCount': string
  // 文件
  'file.new': string
  'file.open': string
  'file.save': string
  'file.export': string
  'file.print': string
  'file.properties': string
  // 状态
  'status.saved': string
  'status.saving': string
  'status.unsaved': string
  'status.error': string
}

// ---- 内置语言包 ----

const zhCN: LocaleMessages = {
  'common.save': '保存',
  'common.cancel': '取消',
  'common.confirm': '确认',
  'common.delete': '删除',
  'common.close': '关闭',
  'common.search': '搜索',
  'common.loading': '加载中...',
  'common.noData': '暂无数据',
  'editor.undo': '撤销',
  'editor.redo': '重做',
  'editor.copy': '复制',
  'editor.cut': '剪切',
  'editor.paste': '粘贴',
  'editor.selectAll': '全选',
  'editor.bold': '加粗',
  'editor.italic': '斜体',
  'editor.underline': '下划线',
  'editor.strikethrough': '删除线',
  'editor.fontSize': '字号',
  'editor.fontFamily': '字体',
  'editor.alignLeft': '左对齐',
  'editor.alignCenter': '居中',
  'editor.alignRight': '右对齐',
  'editor.bulletList': '无序列表',
  'editor.orderedList': '有序列表',
  // 中文不区分单复数, plural 分支自然塌成一条
  'editor.pageOf': '第 {current} 页 / 共 {total} 页',
  'editor.controlCount': '{n, plural, other {# 个控件}}',
  'file.new': '新建',
  'file.open': '打开',
  'file.save': '保存',
  'file.export': '导出',
  'file.print': '打印',
  'file.properties': '文档属性',
  'status.saved': '已保存',
  'status.saving': '保存中...',
  'status.unsaved': '未保存',
  'status.error': '保存失败',
}

const enUS: LocaleMessages = {
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.search': 'Search',
  'common.loading': 'Loading...',
  'common.noData': 'No Data',
  'editor.undo': 'Undo',
  'editor.redo': 'Redo',
  'editor.copy': 'Copy',
  'editor.cut': 'Cut',
  'editor.paste': 'Paste',
  'editor.selectAll': 'Select All',
  'editor.bold': 'Bold',
  'editor.italic': 'Italic',
  'editor.underline': 'Underline',
  'editor.strikethrough': 'Strikethrough',
  'editor.fontSize': 'Font Size',
  'editor.fontFamily': 'Font',
  'editor.alignLeft': 'Align Left',
  'editor.alignCenter': 'Center',
  'editor.alignRight': 'Align Right',
  'editor.bulletList': 'Bullet List',
  'editor.orderedList': 'Numbered List',
  'editor.pageOf': 'Page {current} of {total}',
  'editor.controlCount': '{n, plural, one {# control} other {# controls}}',
  'file.new': 'New',
  'file.open': 'Open',
  'file.save': 'Save',
  'file.export': 'Export',
  'file.print': 'Print',
  'file.properties': 'Properties',
  'status.saved': 'Saved',
  'status.saving': 'Saving...',
  'status.unsaved': 'Unsaved',
  'status.error': 'Save Error',
}

// ---- 消息格式化 (纯函数, 可单测; 无副作用) ----

/** ICU 单层子集的头部: `n, plural, one {…} other {…}` */
const PLURAL_HEAD = /^(\w+)\s*,\s*plural\s*,\s*([\s\S]+)$/

/** 返回 `text[start]` 处 `{` 的配对 `}` 下标; 不成对返回 -1 */
function matchBrace(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 从 `one {…} other {…}` 里挑出当前复数规则命中的分支 (缺则回落 other) */
function selectPluralBranch(body: string, n: number, locale: Locale): string {
  const branches = new Map<string, string>()
  let i = 0
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++
    const keyStart = i
    while (i < body.length && /[A-Za-z]/.test(body[i])) i++
    const key = body.slice(keyStart, i)
    if (!key) break
    while (i < body.length && /\s/.test(body[i])) i++
    if (body[i] !== '{') break
    const end = matchBrace(body, i)
    if (end < 0) break
    branches.set(key, body.slice(i + 1, end))
    i = end + 1
  }

  const rule = new Intl.PluralRules(locale).select(n)
  return branches.get(rule) ?? branches.get('other') ?? ''
}

function interpolate(text: string, params: LocaleParams, locale: Locale): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== '{') { out += text[i]; i++; continue }

    const end = matchBrace(text, i)
    // 未闭合的 `{` 原样输出 —— 不吞掉后面的内容
    if (end < 0) { out += text[i]; i++; continue }

    const inner = text.slice(i + 1, end)
    const plural = PLURAL_HEAD.exec(inner)

    if (plural) {
      const n = Number(params[plural[1]])
      if (!Number.isFinite(n)) {
        // 参数缺失/非数字 → 保留字面 `{n, plural, …}`, 让问题看得见, 不静默变空串
        out += `{${inner}}`
      } else {
        const branch = selectPluralBranch(plural[2], n, locale)
        // ICU 的 `#` 是"当前数值"占位符 (中文分支塌成一条时也要能写出数字)
        out += interpolate(branch.replace(/#/g, String(n)), params, locale)
      }
    } else {
      const name = inner.trim()
      out += Object.prototype.hasOwnProperty.call(params, name)
        ? String(params[name])
        : `{${name}}`   // 未提供参数 → 保留字面, 可见的失败
    }

    i = end + 1
  }
  return out
}

/**
 * 把模板串展开成最终文案。
 *
 * 支持 (刻意只做这两件, 不引 intl-messageformat —— 见文件头的"不做"):
 * - 插值 `{name}` — 未提供的参数**保留字面** `{name}`
 * - 复数 `{n, plural, one {…} other {…}}` 单层, 分支选择用 `Intl.PluralRules`,
 *   分支内可用 `#` 表示数值, 也可嵌套 `{name}`
 */
export function formatMessage(
  template: string,
  params: LocaleParams | undefined,
  locale: Locale,
): string {
  return interpolate(template, params ?? {}, locale)
}

// ---- 引擎 ----

const PACKS: Record<Locale, LocaleMessages> = { 'zh-CN': zhCN, 'en-US': enUS }

export class LocaleManager {
  private current: Locale = 'zh-CN'
  private messages: LocaleMessages
  private overrides: Partial<LocaleMessages> = {}
  /** 语言变更订阅者 (React 侧 useSyncExternalStore 用) */
  private listeners = new Set<() => void>()
  /** 单调递增版本号 — 供 useSyncExternalStore 检测变更 (与 EditorStore 同范式) */
  private version = 0

  constructor() {
    this.messages = { ...PACKS['zh-CN'] }
  }

  getLocale(): Locale { return this.current }

  /** 当前版本号 (每次 notify 递增) */
  getVersion(): number { return this.version }

  /**
   * 切换语言。
   *
   * 同值早退: 对齐 EditorStore.setDocumentTitle 的守卫 —— 否则 bootstrap 里
   * 一次 setLocale(getLocale()) 就会白刷一遍全部订阅者。
   */
  setLocale(locale: Locale): void {
    if (locale === this.current) return
    this.current = locale
    this.messages = { ...PACKS[locale], ...this.overrides }
    this.notify()
  }

  /** 第三方部分覆盖 (合并到当前语言包) */
  extend(patch: Partial<LocaleMessages>): void {
    this.overrides = { ...this.overrides, ...patch }
    this.messages = { ...this.messages, ...patch }
    this.notify()
  }

  /** 订阅语言变更; 返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 获取单个翻译 (可带插值/复数参数) */
  t(key: keyof LocaleMessages, params?: LocaleParams): string {
    const template = this.messages[key]
    if (template === undefined) {
      // 缺键 → 返回键本身 (可见的失败, 不是空串) + 一条 warn。
      // 不做 dev-only 门控: 引擎不依赖打包器的 env 注入 (那会把 §27/§29 的
      // host 无关性撕开一个口子), 且仓库既有 31 处 console 诊断也都是无条件的。
      console.warn(`[i18n] 缺少文案键: ${String(key)}`)
      return String(key)
    }
    return formatMessage(template, params, this.current)
  }

  private notify(): void {
    this.version++
    // 单个订阅者抛错不阻断其余, 但**不静默吞掉** —— 订阅者多半是 React 渲染,
    // 吞了就等于界面悄悄不更新 (EventBus 的 listener 处理也是这个口径)。
    this.listeners.forEach(l => {
      try { l() } catch (err) { console.error('[i18n] locale listener error:', err) }
    })
  }
}

/** 全局单例 (契约 §27.3: app-wide 共享, 不得挪进 store) */
export const locale = new LocaleManager()

/** 便捷翻译函数 (不带订阅 —— 需要随语言重渲染的组件请用 useTranslation) */
export function t(key: keyof LocaleMessages, params?: LocaleParams): string {
  return locale.t(key, params)
}
