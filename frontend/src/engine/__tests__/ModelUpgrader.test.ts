// ============================================================
// ModelUpgrader + MergeMatrix 单元测试 (R77-R78)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  modelUpgrader,
} from '../document/version/ModelUpgrader'
import {
  parseVersion, compareVersions, versionToString, CURRENT_DOCUMENT_VERSION,
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
