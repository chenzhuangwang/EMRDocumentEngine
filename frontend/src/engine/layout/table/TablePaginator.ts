// ================================================================
// TablePaginator — 表格真正跨页续排 (纯函数分页器)
//
// 职责 (架构 §3 布局产物, 不进 DocumentModel):
//   以 PageBreaker 传入的「当前页可用高」为依据, 把 buildTableRows 产出的
//   逻辑行切成 TableFragment[] (headerRows + bodyRows), 支持:
//     P0  行级跨页 — 整行放入直到放不下, 换页续排
//     P1  单行内切 — 单行超高 (无 rowspan) 按行边界切出 ≤ availableHeight 一片
//     P2  (rowspan 单元格行内切) — 显式不支持, hasRowspanCell 守卫跳过 P1
//
// 分页游标由本闭包自持 (cursorRow / cursorYInRow); PageBreaker 只负责
// 「每次给多少可用高 + 逐页循环」, 不传 startRow、不理解 table/row/cell。
//
// 与 PageBreaker 的契约 (§S2):
//   paginate(availableHeight) → PaginateResult
//     requiresNewPage  = 本页放不下任何内容, 换页后再问 (显式状态, 非 height===0)
//     done             = 整个表格已排完 (末行完整排完)
//     consumedRows     = 本页实际完成的 logical body row 数 (P1 未完成为 0)
// ================================================================

import type { SLIFRow } from '../core/SLIF'
import { tableRowUnitHeight } from '../core/SLIF'

/** 本页承载的表格片段 */
export interface TableFragment {
  /** 渲染重复表头 (逻辑上与 bodyRows 同源, 不参与逻辑行号/命中) */
  headerRows: SLIFRow[]
  /** 本页承载的逻辑行 (P1 时可为单行切片) */
  bodyRows: SLIFRow[]
  /** = Σ(headerRows.height) + Σ(bodyRows.height) + 行隙; 不含 continuationLabel */
  height: number
  /** bodyRows 覆盖的逻辑行区间起点 (全表行号, 含表头) */
  logicalStart: number
  /** bodyRows 覆盖的逻辑行区间终点 (开区间) */
  logicalEnd: number
  /** 非首块 → 渲染「(续表)」 */
  continuation: boolean
}

/** PageBreaker 与 ILine.pageable 共用的唯一返回类型 */
export interface PaginateResult {
  fragment: TableFragment
  /** 本页完成的 logical body row 数 (P1 未完成该行时为 0) */
  consumedRows: number
  /** 本页放不下任何内容, 需换页后再问 (显式状态; 不得用 height===0 表达) */
  requiresNewPage: boolean
  /** 整个表格是否已排完 (末行完整排完) */
  done: boolean
}

export interface TablePaginatorOptions {
  repeatHeader: boolean
  headerCount: number
  /** 块边界尽量不拆在「剩余不足 minRows 行」处 — 本轮接受但未强制 (S1 规则 9, P0 可标注) */
  minRowsBeforeBreak?: number
  /** 每页正文可用高 — 用于区分「整行独占一页,允许溢出」的不可拆分超高行 */
  pageContentHeight: number
}

export function createTablePaginator(
  rows: readonly SLIFRow[],
  _columnWidths: readonly number[],
  opts: TablePaginatorOptions,
): { paginate(availableHeight: number): PaginateResult } {
  const headerCount = opts.repeatHeader ? Math.max(0, Math.floor(opts.headerCount)) : 0
  const headerRows: SLIFRow[] = rows.slice(0, headerCount)
  const bodyRows: SLIFRow[] = rows.slice(headerCount)

  // 自持分页游标: cursorRow = 下一个待产出的完整 body 行; cursorYInRow = 当前行已切出的高度 (P1)
  let cursorRow = 0
  let cursorYInRow = 0

  const headerH = (): number => headerRows.reduce((s, r) => s + tableRowUnitHeight(r), 0)

  const hasRowspanCell = (row: SLIFRow): boolean =>
    row.cells.some((c) => (c.rowspan ?? 1) > 1)

  /** 行的最大 rowspan (无合并 → 1)。rowspan span 视为原子单元: 跨页时整组同页 */
  const maxRowspan = (row: SLIFRow): number =>
    row.cells.reduce((m, c) => Math.max(m, c.rowspan ?? 1), 1)

  /** 以 startIdx 起、覆盖 maxRowspan 行的一段 (group) 的总占高与行数 */
  const groupHeight = (startIdx: number): { count: number; height: number } => {
    const span = maxRowspan(bodyRows[startIdx])
    let height = 0
    let count = 0
    for (let s = 0; s < span && startIdx + s < bodyRows.length; s++) {
      height += tableRowUnitHeight(bodyRows[startIdx + s])
      count++
    }
    return { count, height }
  }

  /** 行的「行边界」: 各 cell item 顶 y (>0, 去重升序) + 行高 */
  const lineBoundaries = (row: SLIFRow): number[] => {
    const set = new Set<number>()
    for (const cell of row.cells) {
      for (const it of cell.items) {
        if (it.y > 0) set.add(it.y)
      }
    }
    const bs = Array.from(set).sort((a, b) => a - b)
    if (row.height > 0 && bs[bs.length - 1] !== row.height) bs.push(row.height)
    return bs
  }

  /** 把 row 的 [a, b) 区间切成一行 (cell 高度 = b-a, items 重锚到 0) */
  const sliceRow = (row: SLIFRow, a: number, b: number): SLIFRow => {
    const h = b - a
    const cells = row.cells.map((c) => ({
      ...c,
      height: h,
      items: c.items
        .filter((it) => it.y < b && it.y + (it.height || 0) > a)
        .map((it) => ({ ...it, y: Math.max(0, it.y - a) })),
    }))
    return { height: h, cells }
  }

  const buildFragment = (
    body: SLIFRow[],
    bodyStartIdx: number,
    bodyEndIdx: number,
    continuation: boolean,
  ): TableFragment => ({
    headerRows,
    bodyRows: body,
    height: headerH() + body.reduce((s, r) => s + tableRowUnitHeight(r), 0),
    logicalStart: headerCount + bodyStartIdx,
    logicalEnd: headerCount + bodyEndIdx,
    continuation,
  })

  /** P1 行内切: 从 from 起切出一片 (≤ avail), 推进 cursorYInRow / cursorRow */
  const sliceRowProgress = (
    row: SLIFRow,
    from: number,
    availForBody: number,
    continuation: boolean,
  ): PaginateResult => {
    const rowIdx = cursorRow
    const boundaries = lineBoundaries(row)
    const upper = from + Math.max(0, availForBody)

    // 最大「落在 (from, upper] 内的行边界」; 若无 (连最小行都放不下) → 取首个 > from 的边界 (溢出一行, 保证推进)
    let cutEnd = -1
    for (const b of boundaries) {
      if (b > from && b <= upper) cutEnd = b
    }
    if (cutEnd < 0) {
      cutEnd = boundaries.find((b) => b > from) ?? row.height
    }
    if (cutEnd <= from) cutEnd = row.height

    const top = sliceRow(row, from, cutEnd)
    const rowDone = cutEnd >= row.height

    if (rowDone) {
      cursorRow = rowIdx + 1
      cursorYInRow = 0
    } else {
      cursorYInRow = cutEnd
    }

    return {
      fragment: buildFragment([top], rowIdx, rowIdx + (rowDone ? 1 : 0), continuation),
      consumedRows: rowDone ? 1 : 0,
      requiresNewPage: false,
      done: cursorRow >= bodyRows.length,
    }
  }

  const paginate = (availableHeight: number): PaginateResult => {
    const continuation = cursorRow > 0 || cursorYInRow > 0

    if (cursorRow >= bodyRows.length) {
      return {
        fragment: buildFragment([], cursorRow, cursorRow, false),
        consumedRows: 0,
        requiresNewPage: false,
        done: true,
      }
    }

    const hh = headerH()
    const availForBody = availableHeight - hh
    const fullBodyAvail = opts.pageContentHeight - hh
    const row = bodyRows[cursorRow]

    // P1 续切: 上一片未切完当前行 (仅无 rowspan 的纯单行)
    if (cursorYInRow > 0) {
      return sliceRowProgress(row, cursorYInRow, availForBody, continuation)
    }

    const group = groupHeight(cursorRow)

    // 整段 (rowspan span 或单行) 放入直到放不下
    if (availForBody >= group.height) {
      let bodyH = 0
      let end = cursorRow
      while (end < bodyRows.length) {
        const g = groupHeight(end)
        if (bodyH + g.height > availForBody) break
        bodyH += g.height
        end += g.count
      }
      const startIdx = cursorRow
      cursorRow = end
      return {
        fragment: buildFragment(bodyRows.slice(startIdx, end), startIdx, end, continuation),
        consumedRows: end - startIdx,
        requiresNewPage: false,
        done: end >= bodyRows.length,
      }
    }

    // 本页剩余放不下该段
    if (group.height > fullBodyAvail) {
      // 段高于整页
      if (!hasRowspanCell(row)) {
        // 纯单行可拆 → P1 行内切
        return sliceRowProgress(row, 0, availForBody, continuation)
      }
      // 含 rowspan 的不可拆分 span → 整段独占一页, 允许视觉溢出 (硬约束 4)
      const startIdx = cursorRow
      cursorRow += group.count
      return {
        fragment: buildFragment(bodyRows.slice(startIdx, cursorRow), startIdx, cursorRow, continuation),
        consumedRows: group.count,
        requiresNewPage: false,
        done: cursorRow >= bodyRows.length,
      }
    }

    // 段能放进整页、只是本页剩余不够 → 换页后再问 (rowspan span 整组同页)
    return {
      fragment: buildFragment([], cursorRow, cursorRow, continuation),
      consumedRows: 0,
      requiresNewPage: true,
      done: false,
    }
  }

  return { paginate }
}
