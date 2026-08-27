// ============================================================
// MergeMatrix — 表格合并矩阵 (R64, v21.0)
//
// 跟踪表格单元格合并状态, 支持 colspan/rowspan。
// 提供空间命中查找 findCellAt() 用于二级碰撞检测。
// ============================================================

export interface CellSpan {
  colspan: number
  rowspan: number
  /** 起始列索引 */
  col: number
  /** 起始行索引 */
  row: number
}

/** findCellAt 返回的单元格命中信息 */
export interface CellGridHit {
  /** 命中的单元格 ID */
  cellId: string
  /** 命中位置的行索引 */
  row: number
  /** 命中位置的列索引 */
  col: number
  /** 合并跨度 (若该单元格有 colspan/rowspan) */
  span?: CellSpan
}

export class MergeMatrix {
  private matrix: (string | null)[][]
  private rowCount: number
  private colCount: number
  private spans = new Map<string, CellSpan>()

  constructor(rows: number, cols: number) {
    this.rowCount = rows
    this.colCount = cols
    this.matrix = Array.from({ length: rows }, () => new Array(cols).fill(null))
  }

  /** 尝试放置单元格, 返回是否成功 */
  placeCell(cellId: string, row: number, col: number, colspan = 1, rowspan = 1): boolean {
    // 检查范围是否合法
    if (row + rowspan > this.rowCount || col + colspan > this.colCount) return false

    // 检查所有格子是否空闲
    for (let r = row; r < row + rowspan; r++) {
      for (let c = col; c < col + colspan; c++) {
        if (this.matrix[r][c] !== null) return false
      }
    }

    // 填充
    for (let r = row; r < row + rowspan; r++) {
      for (let c = col; c < col + colspan; c++) {
        this.matrix[r][c] = cellId
      }
    }

    if (colspan > 1 || rowspan > 1) {
      this.spans.set(cellId, { colspan, rowspan, col, row })
    }

    return true
  }

  /** 检查某位置是否被合并单元格占用 */
  isOccupied(row: number, col: number): boolean {
    return row < this.rowCount && col < this.colCount && this.matrix[row][col] !== null
  }

  /** 获取某位置的单元格 ID */
  getCell(row: number, col: number): string | null {
    if (row >= this.rowCount || col >= this.colCount) return null
    return this.matrix[row][col]
  }

  /** 获取合并单元格的 span 信息 */
  getSpan(cellId: string): CellSpan | undefined {
    return this.spans.get(cellId)
  }

  /**
   * 空间命中查找: 根据文档坐标定位单元格。
   *
   * Phase 2 将用于二级碰撞检测:
   *   Level 1 (HitTestIndex) 命中 table 外框
   *   → Level 2 (MergeMatrix.findCellAt) 定位具体 cell
   *   → 在 SLIFCell.innerItems 上做局部字符偏移计算
   *
   * @param docX          相对于表格原点的 x 坐标 (逻辑 px)
   * @param docY          相对于表格原点的 y 坐标 (逻辑 px)
   * @param columnWidths  每列的实际像素宽度 (含 colspan 合并后的各列宽)
   * @param rowHeights    每行的实际像素高度
   * @returns 命中的单元格信息, 或 null (坐标在表格外)
   */
  findCellAt(
    docX: number,
    docY: number,
    columnWidths: number[],
    rowHeights: number[],
  ): CellGridHit | null {
    // 超出表格下边界
    if (docY < 0 || docX < 0) return null

    // 用累积行高定位行
    let row = -1
    let accumY = 0
    for (let r = 0; r < rowHeights.length; r++) {
      if (docY < accumY + rowHeights[r]) {
        row = r
        break
      }
      accumY += rowHeights[r]
    }
    if (row < 0) return null // Y 超出表格总高度

    // 用累积列宽定位列
    let col = -1
    let accumX = 0
    for (let c = 0; c < columnWidths.length; c++) {
      if (docX < accumX + columnWidths[c]) {
        col = c
        break
      }
      accumX += columnWidths[c]
    }
    if (col < 0) return null // X 超出表格总宽度

    // 检查该位置是否在合并矩阵中有单元格
    if (row >= this.rowCount || col >= this.colCount) return null
    const cellId = this.matrix[row][col]
    if (!cellId) return null

    const span = this.spans.get(cellId)

    return { cellId, row, col, span }
  }

  /** 获取有效列宽 (考虑合并) */
  computeEffectiveColumnWidths(
    defaultWidths: number[],
  ): number[] {
    // 合并单元格的列宽度 = colspan 的列之和
    const widths = [...defaultWidths]
    return widths
  }

  get rows(): number { return this.rowCount }
  get cols(): number { return this.colCount }
}

/** buildMergeMatrix 的构建选项 */
export interface BuildMergeMatrixOptions {
  /** 显式列数 (渲染层命中时传 colWidths.length); 缺省按 sum(colspan) 推算 */
  numCols?: number
  /** 命中检测过渡期: 渲染尚未展开 rowspan 时置 true, 将 rowspan 视为 1 */
  ignoreRowspan?: boolean
}

/** 从 Table 节点构建 MergeMatrix */
export function buildMergeMatrix(
  rows: { cells: { id?: string; colspan?: number; rowspan?: number }[] }[],
  opts?: BuildMergeMatrixOptions,
): MergeMatrix {
  const numRows = rows.length
  // 列数: 显式 numCols > sum(colspan) 推算。
  // 修复 v21.0 前 max(cells.length) 在 colspan 下低估列数的问题。
  const numCols = opts?.numCols
    ?? Math.max(1, ...rows.map(r => r.cells.reduce((s, c) => s + (c.colspan || 1), 0)))
  const matrix = new MergeMatrix(numRows, numCols)

  for (let ri = 0; ri < rows.length; ri++) {
    let ci = 0
    for (const cell of rows[ri].cells) {
      // 跳过已被合并占用的列
      while (ci < numCols && matrix.isOccupied(ri, ci)) ci++
      if (ci >= numCols) break

      const colspan = cell.colspan || 1
      const rowspan = opts?.ignoreRowspan ? 1 : (cell.rowspan || 1)
      matrix.placeCell(cell.id ?? `cell_${ri}_${ci}`, ri, ci, colspan, rowspan)
      ci += colspan
    }
  }

  return matrix
}
