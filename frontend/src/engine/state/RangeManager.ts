// ============================================================
// 选区管理器 - 管理文本选择范围
// ============================================================

export class RangeManager {
  private _start: number = -1
  private _end: number = -1
  private _isSelecting: boolean = false

  /** 是否有活动选区（起点 ≠ 终点） */
  get hasRange(): boolean {
    return this._start >= 0 && this._end >= 0 && this._start !== this._end
  }

  /** 选区起点 */
  get start(): number {
    return Math.min(this._start, this._end)
  }

  /** 选区终点 */
  get end(): number {
    return Math.max(this._start, this._end)
  }

  /** 原始起点（未排序） */
  get rawStart(): number { return this._start }
  get rawEnd(): number { return this._end }

  /** 正在拖选中 */
  get isSelecting(): boolean { return this._isSelecting }

  /** 设置光标位置（无选区） */
  setSelectionPoint(index: number): void {
    if (index < 0 || !Number.isFinite(index)) return
    this._start = index
    this._end = index
    this._isSelecting = false
  }

  /** 开始拖选 */
  startDrag(index: number): void {
    if (index < 0 || !Number.isFinite(index)) return
    this._start = index
    this._end = index
    this._isSelecting = true
  }

  /** 拖选扩展 */
  extendTo(index: number): void {
    if (!this._isSelecting) return
    if (index < 0 || !Number.isFinite(index)) return
    this._end = index
  }

  /** 结束拖选 */
  endDrag(): void {
    this._isSelecting = false
    // 如果起点=终点，清除选区（这是单击不是拖选）
    if (this._start === this._end) {
      this._start = -1
      this._end = -1
    }
  }

  /** 清除选区 */
  clear(): void {
    this._start = -1
    this._end = -1
    this._isSelecting = false
  }

  /** 检查某个索引是否在选区内 */
  contains(index: number): boolean {
    if (!this.hasRange) return false
    return index >= this.start && index < this.end
  }
}
