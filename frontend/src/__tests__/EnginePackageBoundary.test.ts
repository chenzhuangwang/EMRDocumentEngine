// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// EnginePackageBoundary — 分发分包边界的 CI 硬闸门 (契约 §32)
//
// §32.6 是一条**静默生效**的规则, 所以必须机器守着:
//
//   包 manifest 一旦落进应用别名指向的目录, Vite 解析应用别名就会读到它的
//   exports 而改指 dist/index.js —— 而深路径仍解析到源码。应用里于是出现
//   两份引擎实例, 模块级状态 (ErrorRecovery 的 reporter、locale 单例、
//   id 计数器) 一分为二。
//
//   它不是"跑不起来", 而是**接线静默失效**: 实测把包放回 src/engine 并构建出
//   dist 后, ErrorReporting.test.ts 会红 —— store 上报落到了另一份引擎上。
//
// 物理剥离之后 (包根 = packages/emr-document-engine) 这件事从结构上已经不可能,
// 但闸门留着当回归守卫 —— 把包搬回去只要一条 mv, 而代价是静默的。
//
// 这条闸门盯三件事:
//   A. frontend/src 下不得存在声明入口字段的 package.json (§32.6)
//   B. 分包 manifest 存在且覆盖四个子路径 (§32)
//   C. 进入分包的源码不得使用构建期别名 (§32.1)
// ============================================================

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cwd } from 'node:process'

/** 应用源码根 */
const SRC = join(cwd(), 'src')
/** 引擎包根 —— manifest 与构建产物都在这里 (§32.6) */
const PKG_DIR = join(cwd(), '..', 'packages', 'emr-document-engine')
/** 包内源码根 —— 四棵子树 (engine / platform / lib) 都在其下 */
const PKG_SRC = join(PKG_DIR, 'src')

/** 递归列出目录下全部文件 (仓库相对 cwd, 正斜杠) */
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

const SRC_FILES = walk(SRC)
const PKG_FILES = walk(PKG_SRC)

// 构建期读入源码文本 —— 遍历方式从 import.meta.glob 改成 node:fs:
// glob 以 Vite root (frontend/) 为基准, 跨 root 扫包外目录不可靠。
const sources: Record<string, string> = {}
for (const rel of PKG_FILES) {
  if (!/\.(ts|tsx)$/.test(rel)) continue
  sources[`/src/${rel}`] = readFileSync(join(PKG_SRC, rel), 'utf8')
}

describe('§32.6 分包 manifest 不得落在应用别名指向的目录里', () => {
  it('闸门确实扫到了源文件 (漏扫比没闸门更危险)', () => {
    // 与被测对象无关, 但保证 walk 真的在工作 —— 否则下面的空数组断言是假通过
    expect(SRC_FILES.length).toBeGreaterThan(50)
    expect(PKG_FILES).toContain('engine/index.ts')
    expect(PKG_FILES.length).toBeGreaterThan(150)
  })

  it('frontend/src 下不存在 package.json (存在即可能劫持应用别名解析)', () => {
    const offenders = SRC_FILES.filter((f) => f === 'package.json' || f.endsWith('/package.json'))
    expect(
      offenders,
      '契约 §32.6: 包 manifest/构建产物不得长在应用别名指向的目录里 —— 它会让别名改指构建产物, 应用出现两份引擎实例',
    ).toEqual([])
  })

  it('包根也不在应用别名指向的目录内 (包根与应用源码树是两个目录)', () => {
    expect(PKG_DIR.startsWith(SRC)).toBe(false)
  })
})

describe('§32 分包 manifest 形状', () => {
  const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as {
    name: string
    private?: boolean
    license?: string
    exports?: Record<string, { types?: string; import?: string; require?: string }>
    files?: string[]
  }

  it('是私有的 MPL-2.0 包 (决策: 不做 publish 配置)', () => {
    expect(manifest.name).toBe('@emrde/document-engine')
    expect(manifest.private).toBe(true)
    expect(manifest.license).toBe('MPL-2.0')
  })

  it('四个子路径都有 types / import / require 三条件', () => {
    for (const sub of ['.', './dom', './react', './export']) {
      const entry = manifest.exports?.[sub]
      expect(entry, `exports 缺子路径 ${sub}`).toBeTruthy()
      expect(entry?.types, `${sub} 缺 types 条件 (TS 消费方解析不到声明)`).toMatch(/^\.\/dist\/types\//)
      expect(entry?.import, `${sub} 缺 import 条件`).toMatch(/^\.\/dist\/.+\.js$/)
      expect(entry?.require, `${sub} 缺 require 条件`).toMatch(/^\.\/dist\/.+\.cjs$/)
    }
  })

  it('exports 的四条 types 指向包内真实存在的源码位置 (构建后由 tsc 产出)', () => {
    // outDir=dist/types + rootDir=src ⇒ 声明路径与源码路径一一对应。
    // 对不上时消费方会在安装后才发现, 所以在这里提前钉住映射本身。
    const map: Record<string, string> = {
      '.': 'engine/index.ts',
      './dom': 'platform/dom/index.ts',
      './react': 'platform/react/index.ts',
      './export': 'lib/export/index.ts',
    }
    for (const [sub, entry] of Object.entries(manifest.exports ?? {})) {
      if (sub === './package.json') continue
      const srcPath = map[sub]
      expect(srcPath, `exports 出现未预期的子路径 ${sub}`).toBeTruthy()
      expect(entry.types, `${sub} 的 types 与源码路径不对应`).toBe(
        `./dist/types/${srcPath.replace(/\.ts$/, '.d.ts')}`,
      )
      expect(PKG_FILES, `${sub} 的入口源码不存在`).toContain(srcPath)
    }
  })

  it('files 只放分发物 + 许可证 (源码不进包, 由构建产物承载)', () => {
    expect(manifest.files).toEqual(['dist', 'README.md', 'LICENSE', 'NOTICE'])
  })
})

describe('§32.1 进入分包的源码不得使用构建期别名', () => {
  /** 会随分发入口一起打包的源码集合 (引擎核心 / DOM 宿主 / React 适配 / 导出层) */
  const packaged = Object.keys(sources).filter((f) => {
    if (f.includes('/__tests__/')) return false
    if (f.startsWith('/src/engine/')) return true
    if (f.startsWith('/src/platform/dom/')) return true
    if (f.startsWith('/src/platform/react/')) return true
    if (f.startsWith('/src/lib/export/')) return true
    return ['/src/lib/documentExport.ts', '/src/lib/printJob.ts', '/src/lib/provenance.ts'].includes(f)
  })

  it('扫描集合非空且含四个入口与包内三棵子树 (防闸门自己漏扫)', () => {
    expect(packaged.length).toBeGreaterThan(100)
    expect(packaged).toContain('/src/engine/index.ts')
    expect(packaged).toContain('/src/platform/dom/index.ts')
    expect(packaged).toContain('/src/platform/react/index.ts')
    expect(packaged).toContain('/src/lib/export/index.ts')
    // 四棵子树都必须真的落在包里 —— 少一棵就意味着源码又漂回应用树了
    expect(PKG_FILES).toContain('lib/documentExport.ts')
    expect(PKG_FILES).toContain('platform/dom/DomPlatformHost.ts')
    expect(PKG_FILES).toContain('platform/react/EditorProvider.tsx')
  })

  it('无 @/ 说明符 (别名不会被 tsc 改写, 留在 .d.ts 里外部项目解析不了)', () => {
    const hits: string[] = []
    for (const file of packaged) {
      sources[file].split('\n').forEach((line, i) => {
        // 注释里出现 @/ 是文档 (例如解释"为什么这里不能用别名"), 不是说明符
        if (/^\s*(?:\*|\/\*|\/\/)/.test(line)) return
        if (/\bfrom\s+['"]@\//.test(line)) hits.push(`${file}:${i + 1}`)
      })
    }
    expect(hits, `契约 §32.1: 分包源码不得使用 @/ 别名\n  ${hits.join('\n  ')}`).toEqual([])
  })
})
