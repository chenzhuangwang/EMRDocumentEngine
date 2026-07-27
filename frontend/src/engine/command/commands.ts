// ============================================================
// 具体命令类 — 覆盖所有编辑器操作
// ============================================================

import type { ICommand, ICommandContext, ZoneSnapshot } from './CommandManager'

/**
 * 克隆一个 ZoneSnapshot (JSON deep-clone)。
 * 命令的 before/after 必须独立拷贝，防止外部引用被修改污染历史。
 */
function cloneSnapshot(s: ZoneSnapshot): ZoneSnapshot {
  return {
    header: JSON.parse(JSON.stringify(s.header)),
    main: JSON.parse(JSON.stringify(s.main)),
    footer: JSON.parse(JSON.stringify(s.footer)),
    cursorIndex: s.cursorIndex,
    activeZone: s.activeZone,
  }
}

/** 将快照写入上下文 */
function applySnapshot(ctx: ICommandContext, s: ZoneSnapshot): void {
  ctx.headerElements = s.header
  ctx.mainElements = s.main
  ctx.footerElements = s.footer
  ctx.cursorIndex = s.cursorIndex
  ctx.activeZone = s.activeZone
  ctx.clearFocused()
}

// ============================================================

/**
 * 通用区域编辑命令 — 覆盖文本插入、删除、粘贴、格式化、对齐、
 * 列表切换、缩进调整、元素插入等所有修改 zone 元素数组的操作。
 *
 * 在 mutation 前捕获 before 快照，mutation 后捕获 after 快照。
 * undo → 恢复 before；redo → 恢复 after。
 */
export class ZoneEditCommand implements ICommand {
  readonly description: string
  private before: ZoneSnapshot
  private after: ZoneSnapshot

  constructor(description: string, before: ZoneSnapshot, after: ZoneSnapshot) {
    this.description = description
    this.before = cloneSnapshot(before)
    this.after = cloneSnapshot(after)
  }

  undo(ctx: ICommandContext): void {
    applySnapshot(ctx, this.before)
  }

  redo(ctx: ICommandContext): void {
    applySnapshot(ctx, this.after)
  }
}

// ============================================================

/**
 * 控件值编辑命令 — 覆盖在 focusedControl 上的 Backspace/Delete/字符输入。
 *
 * 控件值修改不影响 zone 元素结构（同一引用更新 ctrl.value），
 * 因此需要单独存储值的变更，而不必存储整个 zone 快照。
 */
export class ControlEditCommand implements ICommand {
  readonly description: string
  private before: ZoneSnapshot
  private after: ZoneSnapshot

  constructor(description: string, before: ZoneSnapshot, after: ZoneSnapshot) {
    this.description = description
    this.before = cloneSnapshot(before)
    this.after = cloneSnapshot(after)
  }

  undo(ctx: ICommandContext): void {
    applySnapshot(ctx, this.before)
  }

  redo(ctx: ICommandContext): void {
    applySnapshot(ctx, this.after)
  }
}

// ============================================================

/**
 * 表格单元格编辑命令 — 覆盖 focusedCell 中的 Backspace/Delete/字符输入。
 *
 * 单元格内容修改影响 td.value 数组，可能改变文档布局（recomputeLayout），
 * 因此需要全量 zone 快照以保证 undo 后布局一致。
 */
export class TableCellEditCommand implements ICommand {
  readonly description: string
  private before: ZoneSnapshot
  private after: ZoneSnapshot

  constructor(description: string, before: ZoneSnapshot, after: ZoneSnapshot) {
    this.description = description
    this.before = cloneSnapshot(before)
    this.after = cloneSnapshot(after)
  }

  undo(ctx: ICommandContext): void {
    applySnapshot(ctx, this.before)
  }

  redo(ctx: ICommandContext): void {
    applySnapshot(ctx, this.after)
  }
}
