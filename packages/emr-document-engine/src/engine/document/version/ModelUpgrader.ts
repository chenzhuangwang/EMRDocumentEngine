// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ModelUpgrader — 文档格式版本升级器 (架构 Phase 2, 2026-08-27)
//
// 责任: 维护 v_N → v_{N+1} 链式升级规则, 由 DocumentLoader 调用。
//
// 演化链 (已注册):
//   v1.0.0 → v2.0.0  新增 modelVersion 字段
//   v2.0.0 → v3.0.0  body.children 迁移为 ID 引用 (breaking)
//   v3.0.0 → v4.0.0  新增 pageSetup.orientation 默认值
//   v4.0.0 → v4.1.0  ElementFormat 新增可选字段 (scale/minRows/enums)
//   v4.1.0 → v4.2.0  SmartTextNode 新增可选字段 value (运行时值)
//   v4.2.0 → v4.3.0  DocumentTree.metadata 收紧为 DocumentMetadata (白名单收口)
//   v4.3.0 → v4.4.0  TemplateDefinition 新增可选字段 controlType (控件 widget 形态)
//   v4.4.0 → v4.5.0  页眉页脚逐页变体 (firstPage/evenPage 段落数组, 契约 §7.9) — 显式 NO-OP
//   v4.5.0 → v4.6.0  Table 新增可选字段 dynamicRows (填写时可增长, 契约 §12.9) — 显式 NO-OP
//   v4.6.0 → v4.7.0  新增 Section 结构容器节点类型 (契约 §31) — 显式 NO-OP
//   v4.7.0 → v4.8.0  TemplateDefinition 新增可选字段 formula (契约 §12.12) — 显式 NO-OP
//   v4.8.0 → v4.9.0  TextNode 新增可选字段 revision (契约 §12.13) — 显式 NO-OP
//
// 不实现 downgrade(): EMR 场景下不需要"用旧引擎开新文档"。
// 详见 knowledge/document-version-system-design.md §4 决策 4。
// ================================================================

import type { DocumentTree } from '../core/DocumentModel'
import { normalizeDocumentMetadata } from '../core/DocumentModel'
import {
  CURRENT_DOCUMENT_VERSION,
  LEGACY_DOCUMENT_VERSION,
  compareVersions,
  parseVersion,
  versionToString,
  type DocumentFormatVersion,
} from './DocumentFormatVersion'
import { locale } from '../../i18n/index'

// ---- 升级器接口 ----

export interface VersionUpgrader {
  /** 源版本 */
  from: DocumentFormatVersion
  /** 目标版本 */
  to: DocumentFormatVersion
  /** 是否为 breaking change (仅语义标记, 不影响逻辑) */
  breaking: boolean
  /** 升级函数 */
  upgrade(doc: DocumentTree): DocumentTree
}

export type CompatibilityStatus = 'current' | 'outdated' | 'too-new'

export interface CompatibilityResult {
  status: CompatibilityStatus
  /** status === 'current' 时不需要升级/降级 */
  needsUpgrade: boolean
  /**
   * 人类可读的说明 (按**当前语言**展开)。
   *
   * 注意它只有 `too-new` 分支的 message 会被消费 (DocumentLoader 抛出去),
   * 其余分支仅作诊断。因为它是"已展开的快照", 上层拿到的就是当时语言的文本 ——
   * 用户可见的那条由 DocumentLoaderRegistry 用 `loader.failed` 重新组装。
   */
  message: string
}

// ---- 升级器类 ----

export class ModelUpgrader {
  private upgraders: VersionUpgrader[] = []

  /** 注册升级器 */
  register(upgrader: VersionUpgrader): void {
    this.upgraders.push(upgrader)
  }

  /**
   * 升级文档到目标版本 (默认 CURRENT_DOCUMENT_VERSION)
   * 链式执行: 从 doc.modelVersion 逐级升级到 target
   */
  upgrade(doc: DocumentTree, target: DocumentFormatVersion = CURRENT_DOCUMENT_VERSION): DocumentTree {
    let current = doc
    const docVer = parseVersion(doc.modelVersion ?? LEGACY_DOCUMENT_VERSION)

    // 拓扑排序: 按 from 版本升序
    const sorted = [...this.upgraders].sort((a, b) => compareVersions(a.from, b.from))

    for (const upgrader of sorted) {
      if (compareVersions(docVer, upgrader.to) < 0 &&
          compareVersions(upgrader.from, docVer) >= 0) {
        try {
          current = upgrader.upgrade(current)
          current.modelVersion = versionToString(upgrader.to)
        } catch (err) {
          console.error(`[ModelUpgrader] 升级 ${versionToString(upgrader.from)}→${versionToString(upgrader.to)} 失败:`, err)
        }
      }
    }

    // 确保目标版本
    const finalVer = parseVersion(current.modelVersion ?? LEGACY_DOCUMENT_VERSION)
    if (compareVersions(finalVer, target) < 0) {
      current.modelVersion = versionToString(target)
    }

    return current
  }

  /** 检查版本兼容性 */
  checkCompatibility(docVersion: string | DocumentFormatVersion): CompatibilityResult {
    const ver = typeof docVersion === 'string' ? parseVersion(docVersion) : docVersion
    const cmp = compareVersions(ver, CURRENT_DOCUMENT_VERSION)

    if (cmp === 0) {
      return { status: 'current', needsUpgrade: false, message: locale.t('loader.versionCurrent') }
    }
    if (cmp < 0) {
      return {
        status: 'outdated',
        needsUpgrade: true,
        message: locale.t('loader.versionOutdated', {
          ver: versionToString(ver), current: versionToString(CURRENT_DOCUMENT_VERSION),
        }),
      }
    }
    return {
      status: 'too-new',
      needsUpgrade: false,
      message: locale.t('loader.versionTooNew', {
        ver: versionToString(ver), current: versionToString(CURRENT_DOCUMENT_VERSION),
      }),
    }
  }
}

// ---- 内置升级链 ----

export const modelUpgrader = new ModelUpgrader()

// v1→v2: 新增 modelVersion 字段
modelUpgrader.register({
  from: { major: 1, minor: 0, patch: 0 },
  to: { major: 2, minor: 0, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    if (!doc.modelVersion) doc.modelVersion = '2.0.0'
    if (!doc.header) doc.header = []
    if (!doc.footer) doc.footer = []
    return doc
  },
})

// v2→v3: body children 迁移为 ID 引用
modelUpgrader.register({
  from: { major: 2, minor: 0, patch: 0 },
  to: { major: 3, minor: 0, patch: 0 },
  breaking: true,
  upgrade(doc: DocumentTree): DocumentTree {
    // 确保 body.children 是 string[] (某些旧版本可能是嵌套对象)
    const body = doc.body as unknown as Record<string, unknown>
    if (body.children && Array.isArray(body.children)) {
      body.children = body.children.map((c: unknown) =>
        typeof c === 'string' ? c : (c as Record<string, unknown>).id || String(c),
      )
    }
    return doc
  },
})

// v3→v4: 新增 pageSetup.orientation 默认值
modelUpgrader.register({
  from: { major: 3, minor: 0, patch: 0 },
  to: { major: 4, minor: 0, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    if (doc.pageSetup && !doc.pageSetup.orientation) {
      doc.pageSetup.orientation = 'portrait'
    }
    return doc
  },
})

// v4.0→v4.1: ElementFormat 新增可选字段 (scale/minRows/enums)
// 纯向后兼容: 新字段均可选, 旧文档无需数据迁移, 仅标记版本号。
modelUpgrader.register({
  from: { major: 4, minor: 0, patch: 0 },
  to: { major: 4, minor: 1, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    return doc
  },
})

// v4.1→v4.2: SmartTextNode 新增可选字段 value (运行时值, 契约 §2.1)
// 纯向后兼容: value 可选, 旧文档 text 即占位符, 读取方回退 text, 无需数据迁移。
modelUpgrader.register({
  from: { major: 4, minor: 1, patch: 0 },
  to: { major: 4, minor: 2, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    return doc
  },
})

// v4.2→v4.3: DocumentTree.metadata 从 Record<string,unknown> 收紧为 DocumentMetadata
// (契约 §7.7): 白名单收口 —— 未知键丢弃, keywords 规范化为 string[] (trim/去空/去重)。
// 历史文档 metadata 里的任意 properties.* (smuggled) 在此被一次性清除, 而不是在
// 某次编辑时偷偷丢字段。已知键 (creator/author/... 与 externalId/categoryId) 保留。
modelUpgrader.register({
  from: { major: 4, minor: 2, patch: 0 },
  to: { major: 4, minor: 3, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    if (doc.metadata !== undefined) {
      doc.metadata = normalizeDocumentMetadata(doc.metadata)
    }
    return doc
  },
})

// v4.3→v4.4: TemplateDefinition 新增可选字段 controlType (契约 §12.1)
// 纯向后兼容: controlType 可选且不在节点 payload 里 (存于 artifact 顶层
// templateDefinitions), 旧文档缺失时保持 undefined, 绝不猜测/回填。no-op。
modelUpgrader.register({
  from: { major: 4, minor: 3, patch: 0 },
  to: { major: 4, minor: 4, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    return doc
  },
})

// v4.4→v4.5: DocumentTree 新增可选页眉/页脚变体数组
// (firstPageHeader/firstPageFooter/evenPageHeader/evenPageFooter, 契约 §7.9)
// 纯向后兼容: 字段全部可选, 缺失 ≡ 该变体无内容 (空带), 不预创建、不回填。no-op。
modelUpgrader.register({
  from: { major: 4, minor: 4, patch: 0 },
  to: { major: 4, minor: 5, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    return doc
  },
})

// v4.5→v4.6: Table 新增可选字段 dynamicRows (填写时可增长, 契约 §12.9)
// 纯向后兼容: 字段可选, 缺失 ≡ 固定表 (即旧行为), 不重写、不回填。no-op。
modelUpgrader.register({
  from: { major: 4, minor: 5, patch: 0 },
  to: { major: 4, minor: 6, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    return doc
  },
})

// v4.6→v4.7: 新增 Section 结构容器节点类型 (契约 §31.10)
// 纯向后兼容: Section 是**新增的节点类型**, 旧的 body.children 结构完全不变
// (没有任何既有节点被改写或删除), 旧文档里没有 Section 节点, 读出来就是原样。
// 不重写、不回填 —— 与 4.3→4.4 (controlType) / 4.4→4.5 (页眉脚变体) / 4.5→4.6
// (dynamicRows) 同一约定。
//
// 注意: 类型新增意味着"文档里出现了本引擎可能不认识的节点"这件事本身需要
// 防线 —— 版本闸门只挡住**声称更新**的文档, 挡不住**谎报旧版本**的文档
// (契约 §31.12 / §14)。第二条防线是 load-time 的 modelVersion ↔ 节点类型
// 一致性校验, 见 DocumentLoader.validateDocument。
modelUpgrader.register({
  from: { major: 4, minor: 6, patch: 0 },
  to: { major: 4, minor: 7, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    return doc
  },
})

// v4.7→v4.8: TemplateDefinition 新增可选字段 formula (契约 §12.12)
// 纯向后兼容: 公式是**新增的可选字段**, 旧文档的 templateDefinitions 里没有它,
// 每个控件读出来就是原样 (无公式 = 无派生值)。不重写、不回填。
//
// 为什么容器字段已存在仍要升版本 —— 这是本步存在的唯一理由, 写在这里免得下
// 一个人以为这一档可以省:
//   规则是「**新增可选字段**就升版本」, 不是「新增顶层字段才升版本」。
//   controlType 就是这条规则的确证: 它同样是 TemplateDefinition 的字段、同样
//   装在同一个 templateDefinitions 顶层字段里, 照样把版本从 4.3.x 推到 4.4.0。
//   本文件的版本史 (ElementFormat 加字段 → 4.1 / SmartTextNode 加字段 → 4.2 /
//   TemplateDefinition 加字段 → 4.4) 是**一条一致的规则**, 没有例外。
//   容器已存在买到的是"**不需要任何数据搬运**" —— 那是这一档为什么是 NO-OP,
//   不是为什么可以跳过。
modelUpgrader.register({
  from: { major: 4, minor: 7, patch: 0 },
  to: { major: 4, minor: 8, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    return doc
  },
})

// v4.8→v4.9: TextNode 新增可选字段 revision (契约 §12.13)
// 纯向后兼容: revision 可选, 旧文档每个 TextNode 都没有标记 = 没有修订。
//
// 与上一档的区别: formula 住在 templateDefinitions 这个**已存在**的顶层容器里,
// revision 则直接加在 TextNode 上 —— 版本规则相同 ("新增可选字段就升版本"),
// 但"容器已存在"那层论证不适用。它仍然是 NO-OP, 因为不需要任何数据搬运:
// 缺失的字段按 undefined 读, 语义就是"无修订"。
modelUpgrader.register({
  from: { major: 4, minor: 8, patch: 0 },
  to: { major: 4, minor: 9, patch: 0 },
  breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    return doc
  },
})

// ---- 兼容矩阵 ----

export interface VersionCompatibility {
  /** 最低支持版本 */
  minVersion: DocumentFormatVersion
  /** 当前引擎版本 */
  currentVersion: DocumentFormatVersion
  /** 向前兼容: 可打开高版本文档 (降级展示) — 当前不实现降级, 字段保留供未来 */
  forwardCompatible: boolean
  /** 向后兼容: 低版本文档自动升级 */
  backwardCompatible: boolean
}

