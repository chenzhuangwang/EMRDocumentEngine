// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ModelUpgrader + MergeMatrix 单元测试 (R77-R78)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  modelUpgrader,
} from '../document/version/ModelUpgrader'
import {
  parseVersion, compareVersions, versionToString, CURRENT_DOCUMENT_VERSION,
  CURRENT_SLIF_VERSION, type SLIFVersion,
} from '../document/version/DocumentFormatVersion'
import { MergeMatrix, buildMergeMatrix } from '../document/table/MergeMatrix'
import { createDocument } from '../document/factory/ElementFormatter'

// ---- ModelUpgrader ----

describe('parseVersion', () => {
  it('should parse version strings', () => {
    expect(parseVersion('4.0.0')).toEqual({ major: 4, minor: 0, patch: 0 })
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })
})

describe('compareVersions', () => {
  it('should compare versions correctly', () => {
    expect(compareVersions('4.0.0', '4.0.0')).toBe(0)
    expect(compareVersions('3.0.0', '4.0.0')).toBeLessThan(0)
    expect(compareVersions('5.0.0', '4.0.0')).toBeGreaterThan(0)
    expect(compareVersions('4.1.0', '4.0.0')).toBeGreaterThan(0)
  })
})

describe('versionToString', () => {
  it('should format version to string', () => {
    expect(versionToString({ major: 4, minor: 0, patch: 0 })).toBe('4.0.0')
  })
})

describe('SLIFVersion 名义独立版本域 (契约 §26.14)', () => {
  it('CURRENT_SLIF_VERSION 与 CURRENT_DOCUMENT_VERSION 是不同对象 (不同版本域)', () => {
    expect(CURRENT_SLIF_VERSION).not.toBe(CURRENT_DOCUMENT_VERSION)
  })

  it('SLIFVersion 带名义标记, 数值与文档格式版本域分离 (各自独立演化)', () => {
    const v: SLIFVersion = CURRENT_SLIF_VERSION
    expect(v.__slifVersionDomain).toBe('SLIF')
    // SLIF 是独立版本域 (契约 §26.14 规则 13/14): 数值不与文档格式版本耦合,
    // 二者各自演化 (文档格式 v4.3 收紧 metadata, SLIF 仍是 4.2)。
    expect(v.major).toBe(4)
    expect(v.minor).toBe(2)
    expect(v.patch).toBe(0)
  })
})

describe('ModelUpgrader', () => {
  it('should upgrade v1→current document', () => {
    const doc = createDocument('测试') as unknown as Record<string, unknown>
    doc.modelVersion = '1.0.0'
    const upgraded = modelUpgrader.upgrade(doc as never)
    const ver = (upgraded as unknown as Record<string, unknown>).modelVersion
    expect(ver).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
  })

  it('should add header/footer fields when upgrading from v1', () => {
    const doc = createDocument('测试') as unknown as Record<string, unknown>
    doc.modelVersion = '1.0.0'
    const upgraded = modelUpgrader.upgrade(doc as never) as unknown as Record<string, unknown>
    expect(upgraded.header).toEqual([])
    expect(upgraded.footer).toEqual([])
  })

  it('should check compatibility for older version', () => {
    const result = modelUpgrader.checkCompatibility('2.0.0')
    expect(result.status).toBe('outdated')
    expect(result.needsUpgrade).toBe(true)
  })

  it('should check compatibility for same version', () => {
    const result = modelUpgrader.checkCompatibility(versionToString(CURRENT_DOCUMENT_VERSION))
    expect(result.status).toBe('current')
    expect(result.needsUpgrade).toBe(false)
  })
})

describe('4.4.0 → 4.5.0 页眉页脚变体字段 (契约 §7.9)', () => {
  it('CURRENT_DOCUMENT_VERSION 为 4.5.0', () => {
    expect(versionToString(CURRENT_DOCUMENT_VERSION)).toBe('4.5.0')
  })

  it('SLIF 版本不随文档格式版本变动 (契约 §26.13/§26.14)', () => {
    const slif = CURRENT_SLIF_VERSION as unknown as SLIFVersion
    const [maj, min, pat] = versionToString(slif).split('.').map(Number)
    // 仍为 4.2.0 — 与文档格式版本 4.5.0 独立
    expect([maj, min, pat]).toEqual([4, 2, 0])
  })

  it('4.4.0 文档 (无变体字段) 可升级且为 no-op (不写回变体字段)', () => {
    const doc = createDocument('测试') as unknown as Record<string, unknown>
    doc.modelVersion = '4.4.0'
    delete doc.firstPageHeader

    const upgraded = modelUpgrader.upgrade(doc as never) as unknown as Record<string, unknown>
    expect(upgraded.modelVersion).toBe('4.5.0')
    // 缺失 ≡ 空: 升级器不得猜测/回填
    expect(upgraded.firstPageHeader).toBeUndefined()
    expect(upgraded.evenPageFooter).toBeUndefined()
  })

  it('4.5.0 为当前版本, 无需升级', () => {
    expect(modelUpgrader.checkCompatibility('4.5.0').needsUpgrade).toBe(false)
  })

  it('4.4.0 视为 outdated 且需要升级', () => {
    const result = modelUpgrader.checkCompatibility('4.4.0')
    expect(result.status).toBe('outdated')
    expect(result.needsUpgrade).toBe(true)
  })
})

// ---- MergeMatrix ----

describe('MergeMatrix', () => {
  it('should place cells without merge', () => {
    const matrix = new MergeMatrix(2, 3)
    expect(matrix.placeCell('cell_0_0', 0, 0)).toBe(true)
    expect(matrix.placeCell('cell_0_1', 0, 1)).toBe(true)
    expect(matrix.placeCell('cell_1_0', 1, 0)).toBe(true)
    expect(matrix.getCell(0, 0)).toBe('cell_0_0')
  })

  it('should reject overlapping cells', () => {
    const matrix = new MergeMatrix(2, 2)
    matrix.placeCell('a', 0, 0)
    expect(matrix.placeCell('b', 0, 0)).toBe(false)
  })

  it('should handle colspan merge', () => {
    const matrix = new MergeMatrix(2, 3)
    matrix.placeCell('merged', 0, 0, 2, 1)
    expect(matrix.isOccupied(0, 0)).toBe(true)
    expect(matrix.isOccupied(0, 1)).toBe(true)
    expect(matrix.isOccupied(0, 2)).toBe(false)
    expect(matrix.getSpan('merged')).toEqual({ colspan: 2, rowspan: 1, col: 0, row: 0 })
  })

  it('should handle rowspan merge', () => {
    const matrix = new MergeMatrix(3, 2)
    matrix.placeCell('merged', 0, 0, 1, 2)
    expect(matrix.isOccupied(0, 0)).toBe(true)
    expect(matrix.isOccupied(1, 0)).toBe(true)
    expect(matrix.isOccupied(2, 0)).toBe(false)
  })

  it('should build from row data', () => {
    const rows = [
      { cells: [{ id: 'a' }, { id: 'b', colspan: 2 }] },
      { cells: [{ id: 'c' }, { id: 'd' }, { id: 'e' }] },
    ]
    const matrix = buildMergeMatrix(rows)
    expect(matrix.rows).toBe(2)
    expect(matrix.cols).toBe(3)
    expect(matrix.getCell(0, 0)).toBe('a')
    expect(matrix.isOccupied(0, 1)).toBe(true) // merged by b
  })
})
