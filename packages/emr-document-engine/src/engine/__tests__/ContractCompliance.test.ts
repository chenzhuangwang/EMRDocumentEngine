// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ContractCompliance — 契约不变量可执行验证
//
// 把 .claude/AI_EDITOR_CONTRACT.md 里可静态判定的 MUST / MUST NOT
// 固化成 CI 测试: 直接扫描 engine 源码, 任何一条违例即 FAIL。
//
// 覆盖:
//   §28  browser global 禁令        (document/window/navigator/…)
//   §10  React 依赖禁令
//   §9   Yjs 依赖禁令
//   §27  engine → platform/UI 依赖方向
//   §19  engine → src/lib 依赖方向    (lib 与 engine 是兄弟目录, §27 之外)
//   §6.1 NodePool 单一变更咽喉       (.nodes.set/delete + nodes 只读暴露 + children readonly)
//   §6.2 非结构字段外部直写禁令      (pageSetup/headerFooterConfig/metadata/modelVersion)
//   §15  EventBus 唯一实现
//   §12.4 WatermarkConfig 单一 canonical home (document/core/DocumentModel)
//   §12.6 VR-3 池内 value 变更单入口 (SetControlValueCommand)
//
// 这类不变量此前靠人肉审计 + 注释约定; 本测试让回归在 CI 直接暴露。
//
// 源码经 node:fs 目录遍历读入 (原为 import.meta.glob)。引擎物理剥离到
// packages/emr-document-engine 之后, Vite 的 root 是 frontend/, 跨 root 的
// glob 不可靠 —— 目录遍历与 root 解耦, 且扫描根由**本文件自身位置**推出,
// 于是这条闸门随包走、不依赖任何外部布局。
// ============================================================

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** <包>/src/engine —— 本文件位于 <包>/src/engine/__tests__/ 之下 */
const ENGINE_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

/** 递归列文件, 返回绝对路径 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else out.push(abs)
  }
  return out
}

// key 沿用 /src/engine/... 形状, 使下面按路径取文件的用例保持可读
const engineSources: Record<string, string> = {}
for (const abs of walk(ENGINE_DIR)) {
  const relPath = abs.slice(ENGINE_DIR.length + 1).replace(/\\/g, '/')
  if (!/\.(ts|tsx)$/.test(relPath)) continue
  engineSources[`/src/engine/${relPath}`] = readFileSync(abs, 'utf8')
}

const ENGINE_FILES = Object.keys(engineSources)
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.d.ts'))
  .sort()

const rel = (f: string) => f.replace(/^\/src\/engine\//, '')

/** 去除注释 — 保留换行与长度, 使后续行号/索引与原文件一致 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 去除字符串字面量 ('' "" ``) — 保留换行与长度 */
function stripStrings(src: string): string {
  return src
    .replace(/'[^'\n]*'/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/"[^"\n]*"/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

function lineOf(src: string, index: number): number {
  let n = 1
  for (let i = 0; i < index; i++) if (src[i] === '\n') n++
  return n
}

// §28 禁用的 browser global。
// document/window/navigator/location 只在「作为全局访问」(后接 . 或 [) 时才算违例,
// 以免把 `document: DocumentTree` 这类合法字段名误报为全局引用。
const FORBIDDEN_GLOBALS: Array<{ name: string; re: RegExp }> = [
  { name: 'document', re: /(^|[^.\w])document[.[]/g },
  { name: 'window', re: /(^|[^.\w])window[.[]/g },
  { name: 'navigator', re: /(^|[^.\w])navigator[.[]/g },
  { name: 'location', re: /(^|[^.\w])location[.[]/g },
  { name: 'localStorage', re: /\blocalStorage\b/g },
  { name: 'sessionStorage', re: /\bsessionStorage\b/g },
  { name: 'indexedDB', re: /\bindexedDB\b/g },
  { name: 'ResizeObserver', re: /\bResizeObserver\b/g },
  { name: 'MutationObserver', re: /\bMutationObserver\b/g },
  { name: 'IntersectionObserver', re: /\bIntersectionObserver\b/g },
  { name: 'requestAnimationFrame', re: /\brequestAnimationFrame\b/g },
  { name: 'requestIdleCallback', re: /\brequestIdleCallback\b/g },
  { name: 'HTMLElement', re: /\bHTMLElement\b/g },
  { name: 'HTMLCanvasElement', re: /\bHTMLCanvasElement\b/g },
  { name: 'FontFace', re: /\bFontFace\b/g },
  { name: 'FontFaceSet', re: /\bFontFaceSet\b/g },
  { name: 'IndexedDB type', re: /\bIDB(Database|Request|Transaction|ObjectStore|Index)\b/g },
]

describe('契约不变量可执行验证 (ContractCompliance)', () => {
  it('§28: engine 不得直接引用 browser global', () => {
    const hits: string[] = []
    for (const file of ENGINE_FILES) {
      const src = stripStrings(stripComments(engineSources[file]))
      for (const { name, re } of FORBIDDEN_GLOBALS) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(src))) hits.push(`${rel(file)}:${lineOf(src, m.index)}  ${name}`)
      }
    }
    expect(hits, `engine 直接引用 browser global (契约 §28):\n  ${hits.join('\n  ')}`).toEqual([])
  })

  it('§10: engine 不得引入 React', () => {
    const re = /from\s+['"](react|react-dom|react\/[^'"]+)['"]/g
    const hits: string[] = []
    for (const file of ENGINE_FILES) {
      const src = engineSources[file]
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) hits.push(`${rel(file)}:${lineOf(src, m.index)}  ${m[1]}`)
    }
    expect(hits, `engine 引入 React (契约 §10):\n  ${hits.join('\n  ')}`).toEqual([])
  })

  it('§9: engine 不得直接引入 Yjs', () => {
    const re = /from\s+['"](yjs|y-[^'"]+)['"]/g
    const hits: string[] = []
    for (const file of ENGINE_FILES) {
      const src = engineSources[file]
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) hits.push(`${rel(file)}:${lineOf(src, m.index)}  ${m[1]}`)
    }
    expect(hits, `engine 直接引入 Yjs (契约 §9):\n  ${hits.join('\n  ')}`).toEqual([])
  })

  it('§12.4: WatermarkConfig 定义唯一, home = document/core/DocumentModel', () => {
    const re = /interface\s+WatermarkConfig\b/g
    const hits: string[] = []
    for (const file of ENGINE_FILES) {
      const src = stripComments(engineSources[file])
      re.lastIndex = 0
      if (re.test(src)) hits.push(rel(file))
    }
    expect(hits, `WatermarkConfig 存在多个/错误定义 (契约 §12.4):\n  ${hits.join('\n  ')}`)
      .toEqual(['document/core/DocumentModel.ts'])
  })

  it('§27: engine 不得反向依赖 platform / UI', () => {
    const re = /from\s+['"]([^'"]+)['"]/g
    const hits: string[] = []
    for (const file of ENGINE_FILES) {
      const src = engineSources[file]
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const spec = m[1]
        if (spec.includes('platform') || /\/(components|pages)\//.test(spec)) {
          hits.push(`${rel(file)}:${lineOf(src, m.index)}  ${spec}`)
        }
      }
    }
    expect(hits, `engine 反向依赖 platform/UI (契约 §27/§1):\n  ${hits.join('\n  ')}`).toEqual([])
  })

  it('§27/§19: engine 不得反向依赖 src/lib (特性层)', () => {
    // §19 与 §32 共同禁止 engine → lib。此前 §27 的闸门只匹配 platform /
    // components / pages, lib/ 漏在网外 —— 而 lib/ 与 engine/ 是 src/ 下的
    // 兄弟目录, 看起来无害, 实际是单向依赖: lib/export/fields.ts:27 已经
    // 导入 engine barrel, 反向一条边即成环, 且 §32 把 "." 与 "./export"
    // 打成两个 bundle。
    //
    // 只匹配相对路径 (../ 开头) 且路径段含 lib —— 避免把 npm 包名里带
    // "lib" 的第三方依赖误判 (如 'libfoo'/'some-lib')。
    const re = /from\s+['"]((?:\.\.\/)+lib\/[^'"]*)['"]/g
    const hits: string[] = []
    for (const file of ENGINE_FILES) {
      const src = engineSources[file]
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        hits.push(`${rel(file)}:${lineOf(src, m.index)}  ${m[1]}`)
      }
    }
    expect(hits, `engine 反向依赖 src/lib (契约 §19/§27/§32):\n  ${hits.join('\n  ')}`).toEqual([])
  })

  it('§12.6/VR-3: 池内节点的 value 变更只有一个入口 (SetControlValueCommand)', () => {
    // 真正的不变量是「**池内**节点的运行时值变更只有一个入口」, 不是
    // 「任何 `.value =` 全仓只出现一处」——后者是假的: 另有
    // ElementFormatter.createSmartTextNode 与 TemplateImporter 两处也在赋值,
    // 但都是**入池前的构造期**赋值, 与 VR-3 无关, 不该被这条闸门抓
    // (设计文档 §2.4.1 的初稿按后者写, 落地当天就会红)。
    //
    // 故扫描「写池节点」的两种形状: updateNode 载荷里的 value, 与
    // deleteNodeField 的 'value' (规范空态 = 删除该键, 契约 §12.6.1)。
    // 期望值写成**非空数组** —— 正则若失效匹配不到任何东西, 这条会红而不是
    // 悄悄通过 (自证非空)。
    const re = /updateNode\s*\([^)]*value\s*:|deleteNodeField\s*\([^)]*['"]value['"]/g
    const hits: string[] = []
    for (const file of ENGINE_FILES) {
      const src = stripComments(engineSources[file])
      re.lastIndex = 0
      if (re.test(src)) hits.push(rel(file))
    }
    expect(hits, `池内 value 变更出现多个入口 (契约 §12.6 VR-3):\n  ${hits.join('\n  ')}`)
      .toEqual(['command/commands/SetControlValueCommand.ts'])
  })

  it('§6.1: 不得绕过 NodePool 直接变更 pool.nodes', () => {
    const re = /\.nodes\.(set|delete)\(/g
    const hits: string[] = []
    for (const file of ENGINE_FILES) {
      const src = engineSources[file]
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) hits.push(`${rel(file)}:${lineOf(src, m.index)}  .nodes.${m[1]}(`)
    }
    expect(hits, `绕过 NodePool 直接变更 pool.nodes (契约 §6.1):\n  ${hits.join('\n  ')}`).toEqual([])
  })

  it('§6.1: NodePool 的 nodes 必须以 ReadonlyMap 暴露 (类型级咽喉)', () => {
    const src = engineSources['/src/engine/document/core/NodePool.ts']
    expect(src).toBeTruthy()
    // nodes 是只读 getter, 内部才是私有 _nodes — 外部拿不到可变 Map
    expect(src, 'NodePool 应暴露 `get nodes(): ReadonlyMap` 而非可变 Map').toMatch(
      /get nodes\(\s*\):\s*ReadonlyMap/,
    )
  })

  it('§15: EventBus 必须是唯一实现 (不得出现第二个 EventBus)', () => {
    const eventBusFiles = ENGINE_FILES.filter((f) => f.endsWith('EventBus.ts'))
    expect(eventBusFiles.map(rel), 'engine 内应只有一个 EventBus 实现').toEqual([
      'interaction/EventBus.ts',
    ])
  })

  it('§6.1: 节点 children 必须 readonly string[] (PROBLEM B 类型级咽喉)', () => {
    const src = engineSources['/src/engine/document/core/DocumentModel.ts']
    expect(src).toBeTruthy()
    // PROBLEM B: children 若声明为可变 string[]，外部可 children.push/splice 绕过咽喉。
    // 契约 §6.1 / 铁律 1 要求 readonly string[]，由类型系统强制 (与 ReadonlyMap 对称)。
    // 注: ClipboardManager 的 sp.children.push 是 SerializedPara 序列化 DTO (§13)，非池内节点，
    // 其 children: SerializedChild[] 可变是合法的——故此处只锁 DocumentModel 的类型声明，不扫全库。
    expect(
      src,
      'DocumentModel 节点 children 必须为 readonly string[]，不得退化为可变 string[]',
    ).not.toMatch(/children:\s*string\[\]/)
  })

  it('§6.2: 非结构字段不得被外部代码直接赋值 (Command 门控 / 加载 / 迁移之外)', () => {
    // 非结构字段 (pageSetup/headerFooterConfig/metadata/modelVersion) 归 DocumentTree 所有,
    // 非 NodePool 职责 (§6.2)。运行时变更必须 Command 门控; 合法直接写入者仅限:
    //   document/io       (加载构造, §14)
    //   document/version  (迁移, §14)
    //   command/commands  (命令门控, 如 HeaderFooterConfigCommand / SetPageSetupCommand)
    //   import            (TemplateImporter 导入构造, 契约 §12.2 声明的加载路径)
    // 例外: state/EditorStore.ts 的 this._state.headerFooterConfig 是 UI 读取投影 (§7.2),
    //       canonical = DocumentTree, 非文档字段赋值, 故单列白名单。
    const NON_STRUCTURAL = 'pageSetup|headerFooterConfig|metadata|modelVersion'
    const re = new RegExp(`\\.(${NON_STRUCTURAL})\\s*=(?!=)`, 'g')
    const writesDocument = (f: string) =>
      f.includes('/document/io/') ||
      f.includes('/document/version/') ||
      f.includes('/command/commands/') ||
      f.includes('/import/')
    const isProjection = (f: string) => f.includes('/state/EditorStore.ts')

    const hits: string[] = []
    for (const file of ENGINE_FILES) {
      if (writesDocument(file) || isProjection(file)) continue
      const src = stripStrings(stripComments(engineSources[file]))
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) hits.push(`${rel(file)}:${lineOf(src, m.index)}  ${m[1]}`)
    }
    expect(
      hits,
      `外部代码直接赋值非结构字段 (契约 §6.2, 白名单 document/io|version|command/commands):\n  ${hits.join('\n  ')}`,
    ).toEqual([])
  })
})
