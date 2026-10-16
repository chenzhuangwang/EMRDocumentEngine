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
import { createDocument, createSimpleTable } from '../document/factory/ElementFormatter'
import { loadDocumentFromObject } from '../document/io/DocumentLoader'
import { serializeDocument } from '../document/io/DocumentSerializer'
import { TemplateDefinitionStore } from '../template/TemplateDefinition'

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
  it('SLIF 版本不随文档格式版本变动 (契约 §26.13/§26.14)', () => {
    const slif = CURRENT_SLIF_VERSION as unknown as SLIFVersion
    const [maj, min, pat] = versionToString(slif).split('.').map(Number)
    // 仍为 4.2.0 — 与文档格式版本 (现 4.7.0) 独立
    expect([maj, min, pat]).toEqual([4, 2, 0])
  })

  it('4.4.0 文档 (无变体字段) 可升级且为 no-op (不写回变体字段)', () => {
    const doc = createDocument('测试') as unknown as Record<string, unknown>
    doc.modelVersion = '4.4.0'
    delete doc.firstPageHeader

    const upgraded = modelUpgrader.upgrade(doc as never) as unknown as Record<string, unknown>
    // 升级链会一路走到 CURRENT_DOCUMENT_VERSION (4.4 → 4.5 → 4.6, 后段亦为 no-op)
    expect(upgraded.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    // 缺失 ≡ 空: 升级器不得猜测/回填
    expect(upgraded.firstPageHeader).toBeUndefined()
    expect(upgraded.evenPageFooter).toBeUndefined()
  })

  it('当前版本无需升级', () => {
    const cur = versionToString(CURRENT_DOCUMENT_VERSION)
    expect(modelUpgrader.checkCompatibility(cur).needsUpgrade).toBe(false)
  })

  it('4.4.0 视为 outdated 且需要升级', () => {
    const result = modelUpgrader.checkCompatibility('4.4.0')
    expect(result.status).toBe('outdated')
    expect(result.needsUpgrade).toBe(true)
  })
})

describe('4.5.0 → 4.6.0 Table.dynamicRows (契约 §12.9)', () => {
  it('4.5.0 文档可升级到当前版本 (no-op, 不写回任何表字段)', () => {
    const doc = createDocument('测试') as unknown as Record<string, unknown>
    doc.modelVersion = '4.5.0'

    const upgraded = modelUpgrader.upgrade(doc as never) as unknown as Record<string, unknown>
    // 升级链会一路走到 CURRENT_DOCUMENT_VERSION (4.5 → 4.6 → 4.7, 后段亦为 no-op)
    expect(upgraded.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    // 缺失 ≡ 固定表 (即旧行为): 升级器不得猜测/回填任何表
    const raw = (doc as unknown as { nodes?: Record<string, { type?: string; dynamicRows?: unknown }> }).nodes
    for (const node of Object.values(raw ?? {})) {
      if (node?.type === 'table') expect(node.dynamicRows).toBeUndefined()
    }
  })

  it('4.5.0 视为 outdated 且需要升级', () => {
    const result = modelUpgrader.checkCompatibility('4.5.0')
    expect(result.status).toBe('outdated')
    expect(result.needsUpgrade).toBe(true)
  })

  it('dynamicRows 经序列化往返保留 (它是文档内容, 契约 §12.9)', () => {
    const doc = createDocument('测试')
    const table = createSimpleTable(2, 2)
    table.dynamicRows = true
    ;(doc as unknown as { nodes?: Record<string, unknown> }).nodes = { [table.id]: table }

    const json = JSON.parse(JSON.stringify(doc)) as { nodes: Record<string, { dynamicRows?: boolean }> }
    expect(json.nodes[table.id].dynamicRows).toBe(true)
  })
})

describe('4.6.0 → 4.7.0 Section 结构容器 (契约 §31)', () => {
  it('CURRENT_SLIF_VERSION 未随之变动 (契约 §26.13/§26.14)', () => {
    const v = CURRENT_SLIF_VERSION as SLIFVersion
    expect([v.major, v.minor, v.patch]).toEqual([4, 2, 0])
    expect(CURRENT_SLIF_VERSION).not.toBe(CURRENT_DOCUMENT_VERSION)
  })

  it('4.6.0 文档 (无 Section 节点) 可升级且为 no-op (不注入 Section)', () => {
    const doc = createDocument('测试') as unknown as Record<string, unknown>
    doc.modelVersion = '4.6.0'

    const upgraded = modelUpgrader.upgrade(doc as never) as unknown as Record<string, unknown>
    // 升到**当前**版本 (不止 4.7.0 —— 后面还有 4.8.0 那一档)
    expect(upgraded.modelVersion).toBe(versionToString(CURRENT_DOCUMENT_VERSION))
    // Section 是新增节点类型: 旧文档里没有就不该有, 升级器不得凭空注入
    const raw = (doc as unknown as { nodes?: Record<string, { type?: string }> }).nodes
    for (const node of Object.values(raw ?? {})) {
      expect(node?.type).not.toBe('section')
    }
  })

  it('4.6.0 视为 outdated 且需要升级', () => {
    const result = modelUpgrader.checkCompatibility('4.6.0')
    expect(result.status).toBe('outdated')
    expect(result.needsUpgrade).toBe(true)
  })

  it('纯 NO-OP 升级步骤仍令 wasUpgraded 为真 (契约 §31.12)', () => {
    // "无数据重写" ≠ "wasUpgraded === false" —— 该标志的含义是 source ≠ final
    const r = loadDocumentFromObject({
      type: 'document', id: 'd1', title: 't',
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' },
      body: { mode: 'flow', children: [] },
      modelVersion: '4.6.0',
      nodes: {},
    })
    expect(r.wasUpgraded).toBe(true)
    // upgradePath 记的是 **[源, 终]** 两档, 不是逐档 (recordUpgradePath 只 push 首末)
    expect(r.upgradePath).toEqual(['4.6.0', '4.8.0'])
  })
})

// ================================================================
// 4.7.0 → 4.8.0 TemplateDefinition.formula (契约 §12.12)
//
// **这一档存在的理由就是本组用例的第一条**: 容器 templateDefinitions 早就存在,
// 但仓库的规则是「新增可选字段即升版本」(controlType 是确证: 它装在同一个容器里,
// 照样把 4.3.x 推到 4.4.0)。把版本钉在这里, 让以后每次升级都是一次有意识的动作。
// ================================================================

describe('4.7.0 → 4.8.0 TemplateDefinition.formula (契约 §12.12)', () => {
  it('CURRENT_DOCUMENT_VERSION 为 4.8.0', () => {
    expect(versionToString(CURRENT_DOCUMENT_VERSION)).toBe('4.8.0')
  })

  it('4.7.0 文档可升级且为 no-op (不凭空注入 formula)', () => {
    const doc = createDocument('测试') as unknown as Record<string, unknown>
    doc.modelVersion = '4.7.0'
    const defs = { n1: { controlType: 'input', label: '姓名：' } }

    const upgraded = modelUpgrader.upgrade({ ...doc, templateDefinitions: defs } as never) as unknown as {
      modelVersion: string
      templateDefinitions?: Record<string, Record<string, unknown>>
    }
    expect(upgraded.modelVersion).toBe('4.8.0')
    // 无公式的旧定义读出来就是原样 —— 不得被回填成空串或默认值
    expect(upgraded.templateDefinitions?.n1).toEqual(defs.n1)
    expect('formula' in (upgraded.templateDefinitions?.n1 ?? {})).toBe(false)
  })

  it('4.7.0 视为 outdated; 4.8.0 视为 current', () => {
    expect(modelUpgrader.checkCompatibility('4.7.0').status).toBe('outdated')
    expect(modelUpgrader.checkCompatibility('4.7.0').needsUpgrade).toBe(true)
    const cur = modelUpgrader.checkCompatibility('4.8.0')
    expect(cur.status).toBe('current')
    expect(cur.needsUpgrade).toBe(false)
  })

  it('纯 NO-OP 步骤仍令 wasUpgraded 为真 (source ≠ final)', () => {
    const r = loadDocumentFromObject({
      type: 'document', id: 'd1', title: 't',
      pageSetup: { width: 794, height: 1123, marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90, orientation: 'portrait' },
      body: { mode: 'flow', children: [] },
      modelVersion: '4.7.0',
      nodes: {},
    })
    expect(r.wasUpgraded).toBe(true)
    expect(r.upgradePath).toEqual(['4.7.0', '4.8.0'])
  })

  it('formula 随 templateDefinitions 往返 (序列化 → 加载) 不丢', () => {
    const raw = {
      type: 'document', id: 'd1', title: '带公式',
      pageSetup: {
        width: 794, height: 1123, marginTop: 72, marginBottom: 72,
        marginLeft: 90, marginRight: 90, orientation: 'portrait',
      },
      body: { mode: 'flow', children: ['p1'] },
      modelVersion: versionToString(CURRENT_DOCUMENT_VERSION),
      nodes: {
        p1: { type: 'paragraph', id: 'p1', children: ['st1'] },
        st1: {
          type: 'smarttext', id: 'st1', text: '[年龄]',
          element: {
            code: { internal: 'CTL_AGE', dataElement: 'DE_AGE' }, name: '年龄',
            format: { dataType: 'N' },
          },
        },
      },
    }
    const first = loadDocumentFromObject(raw as never)
    // templateDefinitions 是 per-editor store, 不随 nodes 走 —— 单独喂给序列化器
    const store = first.templateDefinitions ?? new TemplateDefinitionStore()
    store.set('st1', { controlType: 'number', formula: 'GETAGE([DE_BIRTH])' })

    const json = serializeDocument(first.doc, first.pool, { templateDefinitions: store })
    const back = loadDocumentFromObject(JSON.parse(json))
    expect(back.templateDefinitions?.get('st1')?.formula).toBe('GETAGE([DE_BIRTH])')
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
