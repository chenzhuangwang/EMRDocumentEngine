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
      return { status: 'current', needsUpgrade: false, message: '版本一致' }
    }
    if (cmp < 0) {
      return {
        status: 'outdated',
        needsUpgrade: true,
        message: `需升级: ${versionToString(ver)} → ${versionToString(CURRENT_DOCUMENT_VERSION)}`,
      }
    }
    return {
      status: 'too-new',
      needsUpgrade: false,
      message: `文档版本 ${versionToString(ver)} 高于引擎支持版本 ${versionToString(CURRENT_DOCUMENT_VERSION)}`,
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

export const VERSION_COMPATIBILITY: VersionCompatibility = {
  minVersion: { major: 1, minor: 0, patch: 0 },
  currentVersion: CURRENT_DOCUMENT_VERSION,
  forwardCompatible: false,  // 决策 4: 不实现降级
  backwardCompatible: true,
}