// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 编辑位置/坐标计算器 (ModelD)
//
// @deprecated v20.33 — 由 CoordinateSystem 替代, 请使用 CoordinateSystem
// ============================================================

export interface IPosition {
  index: number
  pageIndex: number
  rowIndex: number
  x: number
  y: number
  width: number
  height: number
  ascent: number
  descent: number
}

export interface IPageOffset {
  x: number
  y: number
  pageIndex: number
}

export class Position {
  private positionList: IPosition[] = []
  public headerHeight = 50
  public footerHeight = 40

  constructor() {}

  getIndexByCoord(x: number, y: number): number {
    let closest = 0
    let minDist = Infinity
    for (let i = 0; i < this.positionList.length; i++) {
      const p = this.positionList[i]
      if (x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height) {
        return x > p.x + p.width / 2 ? i + 1 : i
      }
      const dist = Math.sqrt((x - p.x - p.width / 2) ** 2 + (y - p.y - p.height / 2) ** 2)
      if (dist < minDist) { minDist = dist; closest = i }
    }
    return closest
  }

  setPositions(list: IPosition[]): void { this.positionList = list }
  getPositionList(): IPosition[] { return this.positionList }
  clear(): void { this.positionList = [] }
}
