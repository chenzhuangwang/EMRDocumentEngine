// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// FormatPainter — 格式刷 feature module (契约 §11.2, Drift 2 反转)
//
// 承载格式刷的完整编排: 复制光标处样式 → 拖拽选区/点击段落应用。
// 瞬态样式 state (`style`) 归本模块所有; 激活布尔仍经 EditorStore
// 走 canonical owner (§7.2), 本模块只负责 host 光标 + store 同步。
//
// 依赖方向 (§19): 本模块 import type { Editor } (type-only), 与
// MouseHandler / KeyboardHandler 同模式 — 构造注入 Editor + host,
// 通过 Editor 的公共编排原语 (getTextStyle / collectSelectionRanges /
// collapseSelectionToPoint / resolveMouseHit / findParagraphContaining /
// computeOffsetAtX / execCommand / getDraw / getPool / getStore /
// getDocument) 完成 hit-test 与命令执行, 不反向持有私有状态。
// ================================================================

import type { Editor } from '../Editor'
import type { EditorHost } from '../host/EditorHost'
import type { TextStyle } from '../document/core/DocumentModel'
import { FormatPainterCommand, FormatTextRangeCommand } from '../command/commands/FormatTextCommand'
import { generateCommandId } from '../command/ICommand'

export class FormatPainter {
  private editor: Editor
  private host: EditorHost
  /** 已复制的样式快照 (完整序列化对象, 含 undefined/false); null = 未激活 */
  private style: Record<string, unknown> | null = null

  constructor(editor: Editor, host: EditorHost) {
    this.editor = editor
    this.host = host
  }

  /** 格式刷是否激活 */
  get isActive(): boolean { return this.style !== null }

  /** 复制光标处文本样式 (TASK-472), 返回完整的序列化样式对象 */
  copyStyle(): Record<string, unknown> | null {
    const ts = this.editor.getTextStyle()
    if (!ts) return null
    // 必须包含所有 TextStyle 字段 (含 undefined/false) —
    // 格式刷是"替换"而非"合并", 源没有的属性目标也应清除
    return {
      font: ts.font, size: ts.size,
      bold: ts.bold, italic: ts.italic, underline: ts.underline,
      underlineStyle: ts.underlineStyle, strikeout: ts.strikeout,
      color: ts.color, highlight: ts.highlight,
      superscript: ts.superscript, subscript: ts.subscript,
      letterSpacing: ts.letterSpacing,
    }
  }

  /** 激活/取消 — 状态同步到 EditorStore (canonical owner, §7.2) */
  setActive(active: boolean): void {
    if (active) {
      const style = this.copyStyle()
      if (!style) return // 无样式可复制, 不激活
      this.style = style
      this.host.input.setCursor('copy')
    } else {
      this.style = null
      this.host.input.setCursor('')
    }
    this.editor.getStore().setFormatPainterActive(active)
  }

  /** mouseup 事件 — 拖拽选区预览后松手应用格式 (先于 click 触发) */
  onMouseUp = (e: MouseEvent) => {
    const style = this.style
    if (!style) return

    const selection = this.editor.getStore().state.runtime.selection
    if (selection.active) {
      // 拖拽选区 → 收集选区内的文本节点并批量应用格式
      this.applyToSelection(style)
    } else {
      // 单击 (无拖拽) → 应用到整个段落 (命中原有 hit-test 逻辑)
      this.applyToClickTarget(e)
    }
  }

  /** 点击目标段落时应用样式 */
  applyToClickTarget(e: MouseEvent): void {
    const style = this.style
    if (!style) return

    const hit = this.editor.resolveMouseHit(e)
    if (!hit) { this.setActive(false); return }
    const { nodeId, docX, docY, page } = hit

    if (nodeId) {
      const para = this.editor.findParagraphContaining(nodeId)
      if (para) {
        // 定位光标到目标位置 + 清除旧选区, 确保 document:changed 触发 contentChange 时
        // getTextStyle() 读到的是目标段落的格式, 而非旧光标位置
        const cursorOffset = this.editor.computeOffsetAtX(para, docX, docY, page)
        const paraPath = [this.editor.getDocument().id, para.id]
        this.editor.collapseSelectionToPoint(paraPath, cursorOffset)
        // applyToParagraph 内部 execCommand → document:changed → recomputeLayout + render
        // → notifyListeners('contentChange') → 工具栏读取当前光标位置格式 = 目标段落的新格式 ✓
        this.applyToParagraph(para.id, style)
      }
    }

    // 单次使用后退出: setActive 内部会同步通知 React 层
    this.setActive(false)

    // 刷新光标位置 (applyToParagraph 内已通过 document:changed 触发 render, 此处 render 确保光标正确显示)
    this.editor.getDraw().render(this.editor.getPool(), this.editor.getStore().state.runtime)
  }

  /** 将样式应用到目标段落的所有文本节点 (TASK-472) */
  applyToParagraph(paraId: string, style: Record<string, unknown>): void {
    const pool = this.editor.getPool()
    const para = pool.nodes.get(paraId) as { children?: readonly string[] } | undefined
    if (!para?.children) return
    const nodeIds: string[] = []
    for (const cid of para.children) {
      const n = pool.nodes.get(cid) as { type?: string } | undefined
      if (n?.type === 'text') nodeIds.push(cid)
    }
    if (nodeIds.length === 0) return
    const cmd = new FormatPainterCommand(
      generateCommandId(), Date.now(), 'user',
      nodeIds,
      style as Partial<TextStyle>,
    )
    this.editor.execCommand(cmd)
  }

  /** 将样式应用到当前选区内的所有文本节点 (拖拽松手/批量) */
  private applyToSelection(style: Record<string, unknown>): void {
    const selection = this.editor.getStore().state.runtime.selection
    const ranges = this.editor.collectSelectionRanges(selection)

    if (ranges.length === 0) {
      this.setActive(false)
      return
    }

    // 移动光标到焦点位置 (拖拽终点) + 清除选区 → 格式应用后只显示光标
    this.editor.collapseSelectionToPoint([...selection.focus.paragraphPath], selection.focus.offset)

    // 执行格式刷命令 (FormatTextRangeCommand → document:changed → recomputeLayout + render + contentChange)
    const cmd = new FormatTextRangeCommand(
      generateCommandId(), Date.now(), 'user',
      ranges,
      style as Partial<TextStyle>,
      'replace',
    )
    this.editor.execCommand(cmd)

    // 停用格式刷 (同步通知 React 层)
    this.setActive(false)

    // 最终渲染: 确保光标正确显示 (document:changed 已触发一次 render, 此处为保险)
    this.editor.getDraw().render(this.editor.getPool(), this.editor.getStore().state.runtime)
  }
}
