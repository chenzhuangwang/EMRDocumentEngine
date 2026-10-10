// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// DirtyTracker — 脏区追踪器 (架构 §7.5, v5.0 / Step 5)
//
// 职责:
//   - 标记编辑操作后的脏段落 (dirty paragraphs)
//   - 标记脏页面范围 (需重排的页面)
//   - 标记节点级脏 (供 QCEngine/SmartText 使用)
//   - 为增量布局和增量渲染提供脏区信息
// ================================================================

// ---- DirtyScope — 脏区范围 ----

export interface DirtyScope {
  paragraphIds: Set<string>
  pageIndices: Set<number>
  fullDocument: boolean
}

// ---- DirtyTracker ----

export class DirtyTracker {
  private dirty: DirtyScope
  private _version = 0
  private _dirtyNodeIds = new Set<string>()
  private _dirtySmartTextNodes = new Set<string>()

  constructor() {
    this.dirty = { paragraphIds: new Set(), pageIndices: new Set(), fullDocument: false }
  }

  get version(): number { return this._version }

  // ---- 段落级脏标记 ----

  markParagraph(paragraphId: string): void {
    if (this.dirty.fullDocument) return
    this.dirty.paragraphIds.add(paragraphId)
    this._version++
  }

  /** @deprecated 使用 markParagraph */
  markParagraphDirty(paragraphId: string): void { this.markParagraph(paragraphId) }

  markParagraphs(paragraphIds: string[]): void {
    if (this.dirty.fullDocument) return
    for (const id of paragraphIds) this.dirty.paragraphIds.add(id)
    this._version++
  }

  markFullDocument(): void {
    this.dirty.fullDocument = true
    this.dirty.paragraphIds.clear()
    this.dirty.pageIndices.clear()
    this._version++
  }

  /** @deprecated 使用 markFullDocument */
  markFullLayout(): void { this.markFullDocument() }

  markPages(pageIndices: number[]): void {
    for (const pi of pageIndices) this.dirty.pageIndices.add(pi)
    this._version++
  }

  // ---- 节点级脏标记 ----

  markNodeDirty(nodeId: string): void {
    this._dirtyNodeIds.add(nodeId)
    this._version++
  }

  markSmartTextDirty(nodeId: string): void {
    this._dirtySmartTextNodes.add(nodeId)
    this._version++
  }

  // ---- 查询 ----

  get needsFullLayout(): boolean { return this.dirty.fullDocument }
  isFullDocument(): boolean { return this.dirty.fullDocument }
  getDirtyParagraphIds(): ReadonlySet<string> { return this.dirty.paragraphIds }
  getDirtyPageIndices(): ReadonlySet<number> { return this.dirty.pageIndices }
  getDirtyNodeIds(): ReadonlySet<string> { return this._dirtyNodeIds }
  queryDirtySmartTextNodes(): Set<string> { return this._dirtySmartTextNodes }

  hasDirtyParagraphs(): boolean { return this.dirty.fullDocument || this.dirty.paragraphIds.size > 0 }
  hasDirtyPages(): boolean { return this.dirty.pageIndices.size > 0 }
  isParagraphDirty(paragraphId: string): boolean { return this.dirty.fullDocument || this.dirty.paragraphIds.has(paragraphId) }
  isPageDirty(pageIndex: number): boolean { return this.dirty.fullDocument || this.dirty.pageIndices.has(pageIndex) }

  snapshot(): DirtyScope {
    return {
      paragraphIds: new Set(this.dirty.paragraphIds),
      pageIndices: new Set(this.dirty.pageIndices),
      fullDocument: this.dirty.fullDocument,
    }
  }

  // ---- 生命周期 ----

  clear(): void {
    this.dirty.paragraphIds.clear()
    this.dirty.pageIndices.clear()
    this.dirty.fullDocument = false
    this._dirtyNodeIds.clear()
    this._dirtySmartTextNodes.clear()
    this._version++
  }

  clearPages(): void { this.dirty.pageIndices.clear() }
}
