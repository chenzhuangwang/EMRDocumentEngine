// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// RevisionGate — 修订留痕边界的 CI 硬闸门 (契约 §12.13)
//
// §12.13 有几条是**静默失效**的, 全靠这里钉住:
//
//   A. 盖戳只经 CommandManager 注入的 revision context。
//      若某个新命令自己 `new Date()` 造标记, 屏幕上看不出任何区别 —— 只有
//      undo/redo 时才会发现 at 变了 (§8.3 的字节判据破掉)。所以扫描
//      "谁 new RevisionStamp": 必须正是那三个改文字内容的命令。
//   B. `revision` 不得出现在 TextStyle 里 (§7.3 / §12.13)。
//      放进去不会报错, 但格式刷 (§12.5) 会把"这段是谁改的"刷到无关文字上 ——
//      一个语义上完全错误、界面上完全正常的动作。
//   C. 文字内容写入 (`updateNode(..., { text: ... })`) 只许出现在白名单文件里。
//      白名单里的文件分两类:
//        - 内容变更: 三个盖章命令
//        - 结构性切分/合并: 把节点截断或拼接, 但**不改变文字总量**
//      新增文件写 text = 新的一条内容变更路径 = 必须有人确认它是否要盖章。
//      闸门不会替你判断, 它只让"忘了"这件事变成 CI 红。
//   D. 留痕渲染必须复用既有粒子管线: `TextParticle.render` 只许由
//      ParticleAdapters 调用 (第二套绘制 = 屏幕与打印必然漂移)。
//   E. 闸门自我验证: 扫描器必须真的扫到目标, 且对注入的违规会报警 ——
//      否则"零命中"可能只是根本没扫到东西。
// ============================================================

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'

const PKG_SRC = join(cwd(), '..', 'packages', 'emr-document-engine', 'src')

function walk(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel))
    else out.push(rel)
  }
  return out
}

const FILES = walk(PKG_SRC).filter((f) => /\.ts$/.test(f) && !f.includes('__tests__'))
const SRC: Record<string, string> = {}
for (const rel of FILES) SRC[rel] = readFileSync(join(PKG_SRC, rel), 'utf8')

/** 去掉行注释 / 块注释 / 字符串字面量 —— 注释里提到这些词不是违规 */
function stripNoise(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

const CODE: Record<string, string> = {}
for (const [rel, text] of Object.entries(SRC)) CODE[rel] = stripNoise(text)

const hits = (needle: RegExp | string): string[] =>
  Object.keys(CODE).filter((rel) =>
    typeof needle === 'string' ? CODE[rel].includes(needle) : needle.test(CODE[rel]))

// ================================================================
// A. 盖戳点唯一
// ================================================================

/** 允许构造 RevisionStamp 的文件 —— 契约 §12.13 钦定的三个内容变更命令 */
const STAMP_WHITELIST = new Set([
  'engine/command/commands/InsertTextCommand.ts',
  'engine/command/commands/DeleteRangeCommand.ts',
  'engine/command/commands/ReplaceTextCommand.ts',
])

describe('A. 盖戳只发生在三个内容变更命令 (§12.13)', () => {
  it('`new RevisionStamp()` 只出现在白名单里', () => {
    const found = hits('new RevisionStamp')
    expect(found.length).toBeGreaterThan(0)
    expect(found.filter((f) => !STAMP_WHITELIST.has(f))).toEqual([])
  })

  it('命令不得自己读时钟造标记 (`Date.now()` 与 revision 赋值同文件)', () => {
    // 只有 RevisionStamp.resolve 里会读 ctx.at; 命令自己 `Date.now()` 造 at
    // 会让 redo 每次都换时间戳。命令里出现 `revision: { type:` 字面量即为违规。
    const offenders: string[] = []
    for (const rel of Object.keys(CODE)) {
      if (!rel.startsWith('engine/command/')) continue
      if (STAMP_WHITELIST.has(rel)) continue
      if (/revision\s*:\s*\{\s*type\s*:/.test(CODE[rel])) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('仓库里唯一构造带时钟 RevisionContext 的地方是 Editor.revisionContext', () => {
    // `at:` 后接 Date.now() = 有人自己造了一个"现在"的修订上下文
    const files = Object.keys(CODE).filter((rel) => /at\s*:\s*Date\.now\(\)/.test(CODE[rel]))
    expect(files).toEqual(['engine/Editor.ts'])
  })
})

// ================================================================
// B. revision 不在 TextStyle
// ================================================================

describe('B. revision 不进 TextStyle (§7.3)', () => {
  it('DocumentModel 的 TextStyle 接口体内没有 revision', () => {
    const rel = 'engine/document/core/DocumentModel.ts'
    const src = CODE[rel]
    const m = /export interface TextStyle\s*\{([\s\S]*?)\n\}/.exec(src)
    expect(m, 'TextStyle 接口必须找得到 —— 找不到说明扫描器失效了').toBeTruthy()
    expect(m![1]).not.toMatch(/\brevision\b/)
  })

  it('TextNode 确实带了 revision (闸门不是空断言: 字段必须存在)', () => {
    const rel = 'engine/document/core/DocumentModel.ts'
    const src = CODE[rel]
    const m = /export interface TextNode[^{]*\{([\s\S]*?)\n\}/.exec(src)
    expect(m).toBeTruthy()
    expect(m![1]).toMatch(/\brevision\b/)
  })
})

// ================================================================
// C. 文字内容写入白名单
// ================================================================

/** `updateNode(..., { text: ... })` 的合法落点 */
const TEXT_WRITE_WHITELIST = new Set([
  // 内容变更 (盖章)
  'engine/command/commands/InsertTextCommand.ts',
  'engine/command/commands/DeleteRangeCommand.ts',
  'engine/command/commands/ReplaceTextCommand.ts',
  // 结构性切分/合并: 文字总量不变, 标记原样跟着片段走
  'engine/command/commands/ParagraphUtils.ts',
  'engine/command/commands/SplitParagraphCommand.ts',
  'engine/command/commands/InsertNodesCommand.ts',
  'engine/command/commands/InsertImageCommand.ts',
  'engine/command/commands/InsertControlCommand.ts',
  'engine/command/commands/FormatTextCommand.ts',
  'engine/command/commands/StructuralCommands.ts',
])

describe('C. 写 `text` 的文件在白名单里 (§12.13)', () => {
  it('白名单之外没有新的文字写入路径', () => {
    const found = hits(/\bupdateNode\([\s\S]{0,200}?text\s*:/)
      // 同一行内的简写形式 (`updateNode(id, { text })`) 也算
      .concat(hits(/updateNode\([^)]*\{\s*text\s*[,}]/))
    const unique = [...new Set(found)]
    expect(unique.length).toBeGreaterThan(0)
    expect(unique.filter((f) => !TEXT_WRITE_WHITELIST.has(f))).toEqual([])
  })

  it('三个内容变更命令确实都接了盖戳 (白名单不是摆设)', () => {
    for (const rel of STAMP_WHITELIST) {
      expect(CODE[rel], `${rel} 必须使用 RevisionStamp`).toContain('RevisionStamp')
      expect(CODE[rel], `${rel} 必须拿到 ctx.revision`).toContain('.revision')
    }
  })
})

// ================================================================
// D. 渲染复用既有粒子管线
// ================================================================

describe('D. 留痕渲染复用 TextParticle (§4 / §12.13)', () => {
  it('`TextParticle.render` 的调用方只有 ParticleAdapters (测试除外)', () => {
    const found = hits('TextParticle.render')
    expect(found.filter((f) => !f.endsWith('particles/ParticleAdapters.ts'))).toEqual([])
  })

  it('ParticleAdapters 把 SLIFItem.revision 透传给 TextParticle', () => {
    const rel = 'engine/render/particles/ParticleAdapters.ts'
    expect(CODE[rel]).toContain('revision: item.revision')
  })

  it('SLIF 承载 revision (布局产物), 布局三处都透传', () => {
    expect(CODE['engine/layout/core/SLIF.ts']).toMatch(/revision\?:\s*\{\s*type:\s*string\s*\}/)
    // 三处 SLIF push (正文 / 表格 cell / 页眉页脚) 都从 LineElement 读 revision
    const pushes = (CODE['engine/layout/core/LayoutEngine.ts'].match(/revision:\s*(?:\(el as LineElement\)\.)?el\.revision/g) ?? [])
    expect(pushes.length).toBeGreaterThanOrEqual(2)
    // 元素构造侧统一经 revisionViewOf (开关剥除 + delete 派生删除线)
    expect(CODE['engine/layout/core/LayoutEngine.ts']).toContain('revisionViewOf')
  })
})

// ================================================================
// E. 闸门自检 —— 扫描器不能是空断言
// ================================================================

describe('E. 闸门自检', () => {
  it('扫描器确实读到了引擎源码 (不是空目录)', () => {
    expect(Object.keys(CODE).length).toBeGreaterThan(100)
    expect(Object.keys(CODE).some((f) => f.endsWith('Editor.ts'))).toBe(true)
  })

  it('stripNoise 会去掉注释里的关键词 (避免注释误报)', () => {
    const sample = "// revision\nconst x = { revision: 1 } /* RevisionStamp */"
    const stripped = stripNoise(sample)
    expect(stripped).not.toContain('RevisionStamp')
    expect(stripped).toContain('revision')
  })

  it('注入一条越权写入会被 C 的判据抓到', () => {
    // 直接对判据做正则自检: 新文件若写 updateNode(..., { text: ... }) 必然命中
    const bad = "pool.updateNode(id, { text: 'x' } as Partial<TextNode>)"
    expect(/\bupdateNode\([\s\S]{0,200}?text\s*:/.test(bad)).toBe(true)
    expect(/updateNode\([^)]*\{\s*text\s*[,}]/.test("pool.updateNode(id, { text })")).toBe(true)
  })
})
