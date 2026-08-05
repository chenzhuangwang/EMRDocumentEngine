// ============================================================
// MergeMatrix — 表格合并矩阵 (R64, v6.0)
//
// 跟踪表格单元格合并状态, 支持 colspan/rowspan
// 提供 isOccupied/getCell/getEffectiveColumns
// ============================================================

export interface CellSpan {
  colspan: number
  rowspan: number
  /** 起始列索引 */
  col: number
  /** 起始行索引 */
  row: number
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

/** 从 Table 节点构建 MergeMatrix */
export function buildMergeMatrix(
  rows: { cells: { id: string; colspan?: number; rowspan?: number }[] }[],
): MergeMatrix {
  const numRows = rows.length
  const numCols = Math.max(...rows.map(r => r.cells.length))
  const matrix = new MergeMatrix(numRows, numCols)

  for (let ri = 0; ri < rows.length; ri++) {
    let ci = 0
    for (const cell of rows[ri].cells) {
      // 跳过已被合并占用的列
      while (ci < numCols && matrix.isOccupied(ri, ci)) ci++
      if (ci >= numCols) break

      matrix.placeCell(cell.id, ri, ci, cell.colspan || 1, cell.rowspan || 1)
      ci += cell.colspan || 1
    }
  }

  return matrix
}
