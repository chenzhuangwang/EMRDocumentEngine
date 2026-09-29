// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// SectionStructureOverlay — 画布上的 Section 结构可视化 (契约 §31.14)
//
// 每个节在正文栏左侧画一条按嵌套深度缩进的细线, 线头显示 sectionCode;
// 被选中的节额外叠一圈高亮框。**纯 DOM 叠加层**, 不参与排版与分页 ——
// Canvas / Draw / LayoutEngine 完全不知道它的存在。
//
// 为什么是叠加层而不是画进 Canvas: 与 TableGrowOverlay / RuntimeControlOverlay
// 同一理由 —— 装饰不参与文档回流, 画进 Canvas 会污染命中测试与分页。
//
// 几何来源: `Editor.getSectionClientRects` (Draw 算的**后代 item 并集**, 逐页一段)。
// 节自身不产出 SLIF item, 所以只能由后代反推; 跨页必须分段, 否则框会盖住页间隙。
//
// 依赖方向单向 (契约 §31.14): overlay → Editor 公开门面。engine 不 import 本文件,
// 关掉它 (或整个不挂载) 后节的结构/命令/选区/序列化/历史全部照常。
// ================================================================

import { useEffect, useState } from 'react'
import { useEditorReady, useEditorRef, useEditorStoreSnapshot } from './EditorProvider'
import { useTranslation } from '@/i18n/useTranslation'
import type { SectionPageRect, SectionTreeEntry } from '@/engine'

/** jsdom 无 rAF → setTimeout 兜底 (与 TableGrowOverlay 同法) */
function raf(cb: FrameRequestCallback): number {
  return typeof requestAnimationFrame !== 'undefined'
    ? requestAnimationFrame(cb)
    : window.setTimeout(() => cb(Date.now()), 16)
}
function caf(id: number): void {
  if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(id)
  else window.clearTimeout(id)
}

/** 后台标签页的轮询间隔 (rAF 被挂起时的兜底节奏 —— 踩过一次的坑) */
const HIDDEN_POLL_MS = 250

/** 竖线距正文栏左缘的基础距离 (再按 depth 缩进) */
const RULE_OFFSET_X = 12
const RULE_INDENT_X = 12

interface Entry {
  id: string
  code: string
  depth: number
  rects: SectionPageRect[]
}

function sameEntries(a: Entry[], b: Entry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]; const y = b[i]
    if (x.id !== y.id || x.code !== y.code || x.depth !== y.depth) return false
    if (x.rects.length !== y.rects.length) return false
    for (let j = 0; j < x.rects.length; j++) {
      const p = x.rects[j]; const q = y.rects[j]
      if (p.pageIndex !== q.pageIndex || p.left !== q.left || p.top !== q.top ||
          p.width !== q.width || p.height !== q.height || p.contentLeft !== q.contentLeft) return false
    }
  }
  return true
}

export function SectionStructureOverlay() {
  const editorRef = useEditorRef()
  // 必须等 ready: 子组件 mount effect 早于 EditorProvider 建 Editor,
  // 此时 editorRef.current 恒为 null —— 直接订阅会静默漏绑 (仓库既有坑)。
  const ready = useEditorReady()
  const mode = useEditorStoreSnapshot((s) => s.runtime.view.mode)
  const showStructure = useEditorStoreSnapshot((s) => s.runtime.view.showSectionStructure)
  const selectedSectionId = useEditorStoreSnapshot((s) => s.selectedSectionId)
  const { t } = useTranslation()

  // 只读/打印/纯文本模式不渲染 (与 TableGrowOverlay 同一门控理由)
  const visible = showStructure && (mode === 'edit' || mode === 'form' || mode === 'design')

  const [sections, setSections] = useState<SectionTreeEntry[]>([])
  const [entries, setEntries] = useState<Entry[]>([])

  // 节清单: 跟随 contentChange 同步 (增删/移动/改 code 都会触发)
  useEffect(() => {
    const ed = editorRef.current
    if (!ready || !ed) return
    const sync = () => {
      const next = ed.listSections()
      setSections((prev) => (
        prev.length === next.length &&
        prev.every((s, i) => s.id === next[i].id && s.depth === next[i].depth && s.sectionCode === next[i].sectionCode)
          ? prev : next
      ))
    }
    sync()
    ed.on('contentChange', sync)
    return () => { ed.off('contentChange', sync) }
  }, [ready, editorRef])

  // 几何: 逐帧读 (滚动/缩放/回流同源)。后台标签页 rAF 被完全挂起 →
  // 退回定时轮询, 否则后台打开编辑器时线永远不出现。
  useEffect(() => {
    if (!visible || sections.length === 0) {
      setEntries((prev) => (prev.length === 0 ? prev : []))
      return
    }
    let cancelled = false
    let cancelScheduled: (() => void) | null = null

    const schedule = () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) {
        const id = window.setTimeout(run, HIDDEN_POLL_MS)
        cancelScheduled = () => window.clearTimeout(id)
      } else {
        const id = raf(run)
        cancelScheduled = () => caf(id)
      }
    }

    function run() {
      if (cancelled) return
      const ed = editorRef.current
      if (ed) {
        const next: Entry[] = []
        for (const s of sections) {
          // 空节没有内容跨度 → 无矩形 → 无线可画 (诚实结果, 非缺陷)
          const rects = ed.getSectionClientRects(s.id)
          if (rects.length === 0) continue
          next.push({ id: s.id, code: s.sectionCode ?? '', depth: s.depth, rects })
        }
        setEntries((prev) => (sameEntries(prev, next) ? prev : next))
      }
      schedule()
    }

    schedule()
    return () => { cancelled = true; cancelScheduled?.() }
  }, [visible, sections, editorRef])

  if (!visible || entries.length === 0) return null

  return (
    // 外层不拦截指针 (否则会吞掉画布点击、光标不动); 只有竖线本身可点。
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
      {entries.map((e) => {
        const selected = e.id === selectedSectionId
        const ruleX = (r: SectionPageRect): number =>
          r.contentLeft - RULE_OFFSET_X - e.depth * RULE_INDENT_X
        return (
          <div key={e.id}>
            {e.rects.map((r, idx) => (
              <div key={`${e.id}-${r.pageIndex}`}>
                {/* 选中高亮框: 整段内容跨度的淡底 + 描边 */}
                {selected && (
                  <div
                    data-section-box={e.id}
                    style={{
                      position: 'fixed',
                      left: r.contentLeft,
                      top: r.top,
                      width: Math.max(0, r.contentRight - r.contentLeft),
                      height: r.height,
                      border: '1px solid rgba(37, 99, 235, 0.55)',
                      background: 'rgba(37, 99, 235, 0.06)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
                {/* 竖线 (可点 → 选中该节) */}
                <div
                  data-section-rule={e.id}
                  role="button"
                  tabIndex={-1}
                  title={t('sectionOverlay.ruleTitle', {
                    code: e.code || t('sectionOverlay.anonymous'),
                  })}
                  onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation() }}
                  onClick={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    editorRef.current?.selectSection(e.id)
                  }}
                  style={{
                    position: 'fixed',
                    left: ruleX(r),
                    top: r.top,
                    width: 3,
                    height: Math.max(1, r.height),
                    background: selected ? 'rgba(37, 99, 235, 0.85)' : 'rgba(37, 99, 235, 0.35)',
                    borderRadius: 2,
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                  }}
                />
                {/* 线头标签: 只在该节首段显示一次, 续页只留线 */}
                {idx === 0 && (
                  <div
                    style={{
                      position: 'fixed',
                      left: ruleX(r) + 6,
                      top: r.top,
                      maxWidth: Math.max(0, r.contentLeft - ruleX(r) - 10),
                      pointerEvents: 'none',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    className={
                      'rounded-sm px-1 text-[10px] leading-4 ' +
                      (selected
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-blue-50/80 text-blue-600/80')
                    }
                  >
                    {e.code || t('sectionOverlay.anonymous')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
