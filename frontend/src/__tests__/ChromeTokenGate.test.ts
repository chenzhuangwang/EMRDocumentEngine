// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ChromeTokenGate — "容器变色、内部仍白底" 的 CI 硬闸门
//
// chrome 主题化的真实失败模式不是"某个组件没换", 而是**换了一半**: 外层
// 面板跟着 token 走了, 里面的对话框/输入框/侧栏还钉死在白灰上 —— 深色模式
// 下表现为一块块刺眼白洞, 靠肉眼扫 40 个文件基本发现不了。
//
// 所以把"不得再有中性色 class"变成 CI 会红的事实, 而不是一条约定。
//
// 扫描范围必须含 `src/index.css`: `.toolbar-btn` 的 @apply 写在 CSS 里, 且被
// Toolbar/HeaderBar 大量复用 —— 只扫 tsx 的闸门会漏掉这个最高杠杆点。
//
// 与 `scripts/retheme-chrome.mjs` 是**两套独立实现**, 刻意不复用: 闸门自己
// 数一遍才知道 codemod 有没有漏; 共用一份逻辑会让两者的盲区也共用。
// 改白名单时两处都要改 (此文件 + 脚本的 KEEP), 否则闸门会红。
// ============================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'

// 构建期读入 UI 源码文本 (key 为 /src/... 相对项目根)
const uiSources = import.meta.glob('/src/{components,pages}/**/*.{ts,tsx}', {
  as: 'raw',
  eager: true,
}) as Record<string, string>

/**
 * index.css 必须一并扫 —— 但拿到它的文本并不直白, 两条**看起来**该 work 的路
 * 都静默返回空串, 记在这里免得下一个人再踩:
 * - `import.meta.glob('/src/index.css', …)` (旧 `as:'raw'` 写法) → `''`
 * - 新式 `{ query: '?raw' }` 与 `import css from '../index.css?raw'` → 同样是 `''`
 *   (vitest 默认 `css: false` 把 CSS 桩掉了, 绕不过去)
 *
 * 两种失败都是**静默**的: 断言拿到空字符串, 一条违例都找不出来, 闸门照样全绿。
 * 这正是下面那条"扫描覆盖"用例存在的理由 —— 闸门自己漏扫比没有闸门更危险。
 *
 * 所以走 node:fs 直读 (声明见同目录 nodeShims.d.ts)。
 */
const indexCss = readFileSync(join(cwd(), 'src/index.css'), 'utf8')

const SOURCES: Record<string, string> = {
  ...uiSources,
  '/src/index.css': indexCss,
}

const FILES = Object.keys(SOURCES)
  .filter((f) => !f.includes('/__tests__/'))
  .sort()

/** 闸门必须真的扫到这些文件 —— 否则下面的空数组断言全是假通过 */
const MUST_SCAN = ['/src/index.css']

/** 任意 bg/text/border/divide 前缀下的白/黑/灰 */
const NEUTRAL_CLASS_RE =
  /(?<![\w-])(bg|text|border|divide)-(white|black|gray-\d{2,3})(\/\d{1,3})?(?![\w-])/g

/**
 * 中性色 hex (与 tailwind.config.ts 的 gray 调色板 + 纯白一致)。
 * 内联 style / SVG fill 不走 Tailwind, 上面那条类闸门对它们完全失明 ——
 * 而深色下最刺眼的白洞往往就出在这里 (表格选择器的空格子、小预览图的纸面)。
 */
const NEUTRAL_HEX_RE =
  /#(?:fff|ffffff|f9fafb|f3f4f6|e5e7eb|d1d5db|9ca3af|6b7280|4b5563|374151|1f2937|111827)\b/gi

/**
 * 刻意豁免 —— 每一项都必须写清"为什么它不是外壳面色", 否则不许进这张表。
 */
const ALLOWED: Array<{ re: RegExp; why: string }> = [
  { re: /^text-white$/, why: '坐落在 primary/语义色底上的白字, 跟主题走反而丢对比度' },
  { re: /^bg-black\/(20|30|40)$/, why: '模态遮罩: 语义是"压暗底层", 本就不该随主题反色' },
  { re: /^bg-gray-900\/95$/, why: '深色 toast: 自身已是深色, 不参与反色' },
]

/** 行级豁免标记 —— 内容本体 (如打印预览的 A4 纸面) 必须保持纸白 */
const KEEP_MARK = 'retheme-keep'

/**
 * 把整份源码切成"可扫描的行": 注释不算代码。
 *
 * 但有两处不能一刀切:
 * 1. `retheme-keep` 标记**写在注释里**, 先抹注释等于把豁免标记也抹了 ——
 *    所以含标记的行整行跳过, 且判定发生在抹注释之前;
 * 2. 解释性注释里会**引用原色值** (如"原为 #E5E7EB"), 那是文档不是代码,
 *    不抹掉就会把注释当成违例。
 *
 * 跨行块注释与行号的对应关系靠"用空格填充、保留换行"维持, 行号不失真。
 */
function scannableLines(src: string): Array<{ line: string; no: number }> {
  const blanked = src.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.includes(KEEP_MARK) ? m : m.replace(/[^\n]/g, ' '),
  )
  return blanked.split('\n').map((line, i) => {
    const raw = src.split('\n')[i] ?? ''
    if (raw.includes(KEEP_MARK)) return { line: '', no: i + 1 }
    // 只抹"独立成注释"的 `//` (前面是行首或空白): 避免把 'https://…' 截断
    return { line: line.replace(/(^|\s)\/\/[^\n]*$/, '$1'), no: i + 1 }
  })
}

function forEachFile(visit: (file: string, line: string, no: number) => void): void {
  for (const file of FILES) {
    const src = SOURCES[file]
    for (const { line, no } of scannableLines(src)) {
      if (line) visit(file.replace(/^\/src\//, 'src/'), line, no)
    }
  }
}

function collect(re: RegExp, allow?: (token: string) => boolean): string[] {
  const hits: string[] = []
  forEachFile((file, line, no) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      if (allow?.(m[0])) continue
      hits.push(`${file}:${no}  ${m[0]}`)
    }
  })
  return hits
}

describe('chrome token 闸门 (ChromeTokenGate)', () => {
  it('闸门自身扫到了该扫的文件 (否则下面全是假通过)', () => {
    const missing = MUST_SCAN.filter((f) => !FILES.includes(f))
    expect(missing, `闸门没扫到这些文件, 它们的违例不会被发现: ${missing.join(', ')}`).toEqual([])
    // components / pages 必须真的读进来了 (glob 写错时这里会红)
    expect(FILES.some((f) => f.startsWith('/src/components/'))).toBe(true)
    expect(FILES.some((f) => f.startsWith('/src/pages/'))).toBe(true)
  })

  it('UI 层不得再出现中性色 class —— 一律走 chrome-* / line-* token', () => {
    const hits = collect(NEUTRAL_CLASS_RE, (t) => ALLOWED.some((a) => a.re.test(t)))
    expect(
      hits,
      'UI 层仍在直接使用白/黑/灰 class (外壳会"换一半", 深色下留白洞):\n  ' +
      `${hits.join('\n  ')}\n\n` +
      '改法: bg-white→bg-chrome / bg-gray-50→bg-chrome-subtle / bg-gray-100→bg-chrome-muted /\n' +
      '      bg-gray-200→bg-chrome-strong / border-gray-200→border-line / text-gray-500→text-chrome-ink-tertiary\n' +
      '      (完整映射见 scripts/retheme-chrome.mjs 的 MAP)\n' +
      '确属"内容本体/遮罩/彩色底白字"的, 加进本文件 ALLOWED 并把理由写清, 或在该行标 retheme-keep。',
    ).toEqual([])
  })

  it('内联样式 / 属性里也不得写死中性色 hex —— 类闸门看不见它们', () => {
    const hits = collect(NEUTRAL_HEX_RE)
    expect(
      hits,
      '内联样式/属性里写死了中性色 hex (深色下会留白洞):\n  ' +
      `${hits.join('\n  ')}\n\n` +
      '改法: rgb(var(--emr-surface-strong, 229 231 235)) 之类, 用 chrome token + standard 兜底值;\n' +
      '确属"内容本体"(纸面/文档页面上绘制的东西)的, 在该行标 retheme-keep 并写明理由。',
    ).toEqual([])
  })

  it('浅底主色牌片必须走 accent token —— primary-50/100/200 是固定浅色', () => {
    // 中性色换完了, 不代表外壳就换干净了: `bg-primary-50` 这类**浅色品牌底**
    // 同样是固定 hex, 深色下就是一块块近白的亮斑 (实测侧栏「新建模板」按钮
    // 是一整块 #EFF6FF)。它跟中性色是两种漏法, 得各有一条闸门。
    //
    // 允许保留的实心品牌色 (bg-primary-600 + text-white 的实心按钮、
    // border-primary-400/500 的选中描边、ring-primary-* 焦点环、bg-primary-500
    // 的状态点) 都是**中等明度以上**, 深色下依然成立, 故不在禁止之列。
    const LIGHT_BRAND_TINT = /(?<![\w-])(bg|border)-primary-(50|100|200)(\/\d{1,3})?(?![\w-])/g
    const hits = collect(LIGHT_BRAND_TINT)
    expect(
      hits,
      '浅底主色牌片仍是固定浅色 (深色下会是一块亮斑):\n  ' +
      `${hits.join('\n  ')}\n\n` +
      '改法: bg-primary-50→bg-chrome-accent / bg-primary-100→bg-chrome-accent-strong /\n' +
      '      bg-primary-200→bg-chrome-accent-stronger / 其上的字→text-chrome-accent-ink',
    ).toEqual([])
  })

  it('base 层的表单底色兜底必须排除覆盖层输入框', () => {
    // 这条守的不是"有没有写", 而是**排除项还在不在**。
    // index.css 的 base 层给所有无底色的 input/select/textarea 兜了 chrome 底,
    // 防它们在深色下留白洞; 但运行时控件覆盖层 (data-ctl-overlay) 贴在文档页面上,
    // 必须透出画布 —— 一旦有人把那个 :not([data-ctl-overlay]) 删掉, 纸面上会凭空
    // 多出一块灰底, 而 RuntimeControlOverlay.test 只看 className, 察觉不到。
    const css = SOURCES['/src/index.css']
    expect(
      css,
      'index.css 的表单兜底规则丢了 [data-ctl-overlay] 排除项 —— 覆盖层输入框会被上底色, 破坏就地编辑的 WYSIWYG',
    ).toMatch(/input:not\(\[data-ctl-overlay\]\)/)
    expect(css).toMatch(/select:not\(\[data-ctl-overlay\]\)/)
    expect(css).toMatch(/textarea:not\(\[data-ctl-overlay\]\)/)
  })
})
