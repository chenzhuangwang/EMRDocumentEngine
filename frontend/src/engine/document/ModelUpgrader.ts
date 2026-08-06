// ============================================================
// ModelUpgrader — 语义化版本链升级器 (R67, v6.0)
//
// 支持 MAJOR/MINOR/PATCH 语义化版本迁移
// 链式升级: v1→v2→v3→v4, 向前兼容, breaking flag
// ============================================================

import type { DocumentTree } from '../document/DocumentModel'

// ---- 版本类型 ----

export interface ModelVersion {
  major: number
  minor: number
  patch: number
}

export interface VersionUpgrader {
  /** 源版本范围 */
  from: string
  /** 目标版本 */
  to: string
  /** 是否为 breaking change */
  breaking: boolean
  /** 升级函数 */
  upgrade(doc: DocumentTree): DocumentTree
  /** 降级函数 (可选) */
  downgrade?(doc: DocumentTree): DocumentTree
}

export interface VersionCompatibility {
  /** 最低支持版本 */
  minVersion: string
  /** 当前引擎版本 */
  currentVersion: string
  /** 向前兼容: 可打开高版本文档 (降级展示) */
  forwardCompatible: boolean
  /** 向后兼容: 低版本文档自动升级 */
  backwardCompatible: boolean
}

// ---- 升级器 ----

export class ModelUpgrader {
  private upgraders: VersionUpgrader[] = []
  private downgraders = new Map<string, (doc: DocumentTree) => DocumentTree>()

  /** 注册升级器 */
  register(upgrader: VersionUpgrader): void {
    this.upgraders.push(upgrader)
    if (upgrader.downgrade) {
      this.downgraders.set(upgrader.to, upgrader.downgrade)
    }
  }

  /**
   * 升级文档到最新版本
   * 链式执行: 从 doc.modelVersion 逐级升级到 currentVersion
   */
  upgrade(doc: DocumentTree, targetVersion = '4.0.0'): DocumentTree {
    let current = doc
    const docVer = (doc as unknown as Record<string, string>).modelVersion || '1.0.0'

    // 拓扑排序: 按 from 版本升序
    const sorted = [...this.upgraders].sort((a, b) =>
      compareVersions(a.from, b.from),
    )

    for (const upgrader of sorted) {
      if (compareVersions(docVer, upgrader.to) < 0 &&
          compareVersions(upgrader.from, docVer) >= 0) {
        try {
          current = upgrader.upgrade(current)
          ;(current as unknown as Record<string, string>).modelVersion = upgrader.to
        } catch (err) {
          console.error(`[ModelUpgrader] 升级 ${upgrader.from}→${upgrader.to} 失败:`, err)
        }
      }
    }

    // 确保目标版本
    const finalVer = (current as unknown as Record<string, string>).modelVersion
    if (finalVer && compareVersions(finalVer, targetVersion) < 0) {
      (current as unknown as Record<string, string>).modelVersion = targetVersion
    }

    return current
  }

  /**
   * 降级文档到指定版本 (用于兼容旧版客户端)
   */
  downgrade(doc: DocumentTree, targetVersion: string): DocumentTree {
    let current = doc
    const docVer = (current as unknown as Record<string, string>).modelVersion || '4.0.0'

    while (compareVersions(docVer, targetVersion) > 0) {
      const downgrader = this.downgraders.get(docVer)
      if (!downgrader) break
      current = downgrader(current)
      ;(current as unknown as Record<string, string>).modelVersion = targetVersion
    }

    return current
  }

  /** 检查版本兼容性 */
  checkCompatibility(docVersion: string): {
    compatible: boolean
    needsUpgrade: boolean
    needsDowngrade: boolean
    message: string
  } {
    const currentVer = '4.0.0'
    const cmp = compareVersions(docVersion, currentVer)

    if (cmp === 0) return { compatible: true, needsUpgrade: false, needsDowngrade: false, message: '版本一致' }
    if (cmp < 0) return { compatible: true, needsUpgrade: true, needsDowngrade: false, message: `需升级: ${docVersion} → ${currentVer}` }
    return { compatible: true, needsUpgrade: false, needsDowngrade: true, message: `高版本文档, 降级展示: ${docVersion}` }
  }
}

// ---- 内置升级链 ----

export const modelUpgrader = new ModelUpgrader()

// v1→v2: 新增 modelVersion 字段
modelUpgrader.register({
  from: '1.0.0', to: '2.0.0', breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    const d = doc as unknown as Record<string, unknown>
    if (!d.modelVersion) d.modelVersion = '2.0.0'
    if (!d.header) d.header = []
    if (!d.footer) d.footer = []
    return doc
  },
  downgrade(doc: DocumentTree): DocumentTree {
    const d = doc as unknown as Record<string, unknown>
    delete d.modelVersion
    return doc
  },
})

// v2→v3: body children 迁移为 ID 引用
modelUpgrader.register({
  from: '2.0.0', to: '3.0.0', breaking: true,
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
  from: '3.0.0', to: '4.0.0', breaking: false,
  upgrade(doc: DocumentTree): DocumentTree {
    if (doc.pageSetup && !doc.pageSetup.orientation) {
      doc.pageSetup.orientation = 'portrait'
    }
    return doc
  },
})

// ---- 版本比较工具 ----

export function parseVersion(v: string): ModelVersion {
  const [major, minor, patch] = v.split('.').map(Number)
  return { major: major || 0, minor: minor || 0, patch: patch || 0 }
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (va.major !== vb.major) return va.major - vb.major
  if (va.minor !== vb.minor) return va.minor - vb.minor
  return va.patch - vb.patch
}

export function versionToString(v: ModelVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`
}

// ---- 兼容矩阵 ----

export const VERSION_COMPATIBILITY: VersionCompatibility = {
  minVersion: '1.0.0',
  currentVersion: '4.0.0',
  forwardCompatible: true,
  backwardCompatible: true,
}
