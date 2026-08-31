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
//   §6.1 NodePool 单一变更咽喉       (.nodes.set/delete + nodes 只读暴露)
//   §15  EventBus 唯一实现
//
// 这类不变量此前靠人肉审计 + 注释约定; 本测试让回归在 CI 直接暴露。
// 源码经 import.meta.glob(as:'raw') 在构建期读入, 不引入 node:* 依赖。
// ============================================================

import { describe, it, expect } from 'vitest'

// 构建期读入 engine 全部源文件文本 (key 为 /src/engine/... 相对项目根)
const engineSources = import.meta.glob('/src/engine/**/*.{ts,tsx}', {
  as: 'raw',
  eager: true,
}) as Record<string, string>

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
})
