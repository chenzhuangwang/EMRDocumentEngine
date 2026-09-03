# 文档格式版本系统 — 架构设计 (Phase 1)

> **目标**: 在项目尚未积累生产数据时, 把文档格式 / 版本 / 加载 / 迁移 / 序列化的架构**一次设计到位**, 避免未来几十万份 EMR 文档沉淀后被迫做大重构。
>
> **日期**: 2026-08-27
>
> **范围**: `frontend/src/engine/document/` + 关联加载/序列化代码
>
> **约束**: 架构设计阶段, 不写代码。

---

## 0. 背景与时机

当前 `ModelUpgrader` 是"半成品":

- 升级器类已实现 (`register` / `upgrade` / `downgrade` / `checkCompatibility`)
- 3 个升级规则已注册 (v1→v2 / v2→v3 / v3→v4)
- **但生产代码从未调用** `modelUpgrader.upgrade()` — 加载流程不接升级器
- `DocumentModel.modelVersion` 用 `(doc as unknown as Record<string, string>)` 强转访问 — 类型层无强制
- `SLIF` 独立维护 `SLIF_VERSION = '4.0'` — 与 `modelVersion` 是两个独立版本号

**为什么不"先这样, 以后再改"**:

- "以后再改" = 几十万份已落库 EMR 文档 + 已经在产的多版本客户端
- 那时改 = 强制全量升级 + 数据迁移 + 兼容性回归

**为什么是"现在"**:

- 项目尚未真正依赖这套机制 (升级器零生产调用)
- 此时调整类型 + 加固版本字段 + 接通加载流程, 成本极低
- 之后可以放心地引入 v5 / v6, 升级路径已知

---

## 1. 5 个核心概念

### 1.1 EditorVersion (引擎代码版本)

引擎自身版本, 标识**当前代码**。随每个 release 变化。

```ts
/** 引擎代码版本 (semver) */
export interface EditorVersion {
  major: number
  minor: number
  patch: number
}

/** 当前引擎版本 */
export const EDITOR_VERSION: EditorVersion = { major: 21, minor: 0, patch: 0 }
```

**vs DocumentFormatVersion**:
- EditorVersion = "当前是哪个版本的代码"
- DocumentFormatVersion = "当前代码能读写哪个版本的文档格式"
- 通常两者绑定 (Editor v21 → 支持 DocFormat v4), 但要分开定义

### 1.2 DocumentFormatVersion (文档格式版本)

**文档 schema 的语义化版本**。仅在**文档格式发生破坏性变化**时升级。

```ts
/** 文档格式版本 (semver) */
export interface DocumentFormatVersion {
  major: number
  minor: number
  patch: number
}

/** 当前引擎支持的最高文档格式版本 */
export const CURRENT_DOCUMENT_VERSION: DocumentFormatVersion = { major: 4, minor: 0, patch: 0 }
```

**Major 版本**: 破坏性变更 (字段重命名, 类型变化, 必填字段新增)
**Minor 版本**: 向后兼容的功能性新增 (可选字段)
**Patch 版本**: 注释 / 字段顺序调整等无影响变更

注意: **Major 通常不需要递增**, 因为升级器负责任意 v_N → v_N+1 链式升级。

### 1.3 SLIFVersion (派生)

**SLIF 是 layout 的中间输出**, 不是独立文档格式。它的 schema 严格派生自 DocumentFormatVersion:

```ts
/** SLIF 版本与文档格式版本同源 */
export type SLIFVersion = DocumentFormatVersion

/** 当前 SLIF 版本 */
export const CURRENT_SLIF_VERSION: SLIFVersion = CURRENT_DOCUMENT_VERSION
```

**理由**: SLIF 的字段 (pageIndex / width / height / items / ...) 不会独立于文档格式变化。强行拆分会引入两份需要同步演化的版本号, 维护成本高。

如果未来出现真实需求 ("SLIF 演化了但文档没变"), 那是另一个问题, 单独评估。

### 1.4 DocumentLoader (加载器)

**纯函数**, 非类。一次性操作, 无状态。命名参数注入依赖。

```ts
export interface LoadOptions {
  /** 注入的升级器 (默认 module-singleton modelUpgrader) */
  upgrader?: ModelUpgrader
  /** 严格模式: 未知字段抛错 (默认 false, 兼容旧文档多出的字段) */
  strict?: boolean
}

export interface LoadResult {
  /** 加载后的文档 (已升级到当前版本) */
  doc: DocumentTree
  /** 重建的节点池 */
  pool: NodePool
  /** 加载时文档的实际版本 */
  sourceVersion: DocumentFormatVersion
  /** 是否经过了升级 */
  wasUpgraded: boolean
  /** 升级链: ['1.0.0', '2.0.0', '3.0.0', '4.0.0'] 表示经历了完整链 */
  upgradePath: string[]
}

/** 从 JSON 字符串加载文档 */
export function loadDocument(json: string, options?: LoadOptions): LoadResult

/** 从已解析对象加载 (跳过 JSON.parse) */
export function loadDocumentFromObject(obj: unknown, options?: LoadOptions): LoadResult
```

### 1.5 DocumentSerializer (序列化器)

**纯函数**, 单方向。

```ts
/** 序列化为 JSON 字符串 (含 modelVersion) */
export function serializeDocument(doc: DocumentTree, pool: NodePool): string
```

输出固定 `modelVersion: '4.0.0'`, 加载时按此版本检查。

### 1.6 ModelUpgrader (升级器)

**类**, 持有注册链 + 单例 module-singleton。

```ts
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

export class ModelUpgrader {
  register(upgrader: VersionUpgrader): void
  upgrade(doc: DocumentTree, target?: DocumentFormatVersion): DocumentTree
  checkCompatibility(version: DocumentFormatVersion): CompatibilityResult
}
```

**移除 `downgrade()`** — EMR 场景下"用旧引擎打开新文档"无意义, 不实现降级。

---

## 2. 加载流水线

`loadDocument()` 的 6 步流水线:

```
JSON.parse
   ↓
[1] detect         ← 读取 obj.modelVersion (缺失则 '1.0.0')
   ↓
[2] checkCompatibility ← 与 CURRENT_DOCUMENT_VERSION 比较
   ↓
[3] upgrade        ← 链式 v_N → v_{N+1} → ... → CURRENT
   ↓
[4] validate       ← 结构性验证 (必填字段存在, 引用不悬空)
   ↓
[5] buildModel     ← 标准化 DocumentTree (补默认 header/footer/orientation)
   ↓
[6] buildPool      ← 从 doc 重建 NodePool (调用现有 buildNodePool)
   ↓
LoadResult
```

### 2.1 各步骤详解

**[1] detect**

```ts
function detectVersion(obj: unknown): DocumentFormatVersion {
  const raw = (obj as { modelVersion?: string }).modelVersion
  if (!raw) return { major: 1, minor: 0, patch: 0 }  // 旧文档无版本字段, 视为 v1
  return parseVersion(raw)
}
```

**[2] checkCompatibility**

```ts
function checkCompatibility(version: DocumentFormatVersion):
  | { status: 'current' }
  | { status: 'outdated'; needsUpgrade: true }
  | { status: 'too-new'; message: string }  // 拒绝加载
```

**[3] upgrade**

调用 `modelUpgrader.upgrade(doc, CURRENT_DOCUMENT_VERSION)`, 链式执行所有匹配规则。最终 `doc.modelVersion === '4.0.0'`。

**[4] validate**

结构性验证, **不涉及业务语义**:

- `doc.id` 存在 + 是 string
- `doc.body.children` 是 string[]
- 所有 `body.children[i]` 都能在 pool.nodes 中找到 (引用不悬空)
- `doc.header` / `doc.footer` / `doc.footnotes` / `doc.endnotes` 都是 string[] (或 undefined → [])
- 失败抛 `LoadError` (新增 Error 子类)

**[5] buildModel**

补默认字段 (从现有 `buildDocumentPool` 抽出):
- `doc.header ??= []`
- `doc.footer ??= []`
- `doc.body ??= { mode: 'flow', children: [] }`
- `doc.pageSetup.orientation ??= 'portrait'`

**[6] buildPool**

调用现有 `buildDocumentPool(doc)`。 Loader 拥有它的全部职责。

---

## 3. DocumentModel 类型强化

### 3.1 移除 `modelVersion` 强转

**Before** (当前代码):

```ts
const docVer = (doc as unknown as Record<string, string>).modelVersion || '1.0.0'
```

**After**:

```ts
// DocumentModel.ts
export interface DocumentTree {
  id: string
  title: string
  body: FlowBody
  header?: string[]
  footer?: string[]
  pageSetup: PageSetup
  /** 文档格式版本 (由 DocumentSerializer 写入, DocumentLoader 读取) */
  modelVersion: string
}
```

**modelVersion 是 string (不是 DocumentFormatVersion 对象)**, 因为:
- JSON 序列化友好 (对象无法直接 stringify)
- 与现有 magic string 比较兼容
- 解析时统一走 `parseVersion()` 转结构化

### 3.2 移除 SLIF 独立版本常量

```ts
// layout/core/SLIF.ts — Before
export const SLIF_VERSION = '4.0'

// layout/core/SLIF.ts — After
import type { SLIFVersion } from '../document/DocumentFormatVersion'
export const CURRENT_SLIF_VERSION: SLIFVersion = CURRENT_DOCUMENT_VERSION
```

---

## 4. 4 个设计决策 (确认)

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| 1 | SLIFVersion 独立? | ❌ 派生自 DocumentFormatVersion | ⚠️ 已废止 — 契约 §26.14 要求 SLIFVersion 为名义独立类型 |
| 2 | DocumentLoader 类还是函数? | ✅ 纯函数 + 命名参数 | 无状态, 注入轻量 |
| 3 | validate 范围? | ✅ Loader 只做结构性 | 业务规则会变, Loader 应稳定 |
| 4 | downgrade 保留? | ❌ 删除 | EMR 场景无需"用旧引擎开新文档" |

---

## 5. Phase 2-4 拆解

### Phase 2: 实现版本核心 (代码 + 类型)

| 文件 | 操作 |
|---|---|
| `document/EditorVersion.ts` | 新增: EditorVersion 接口 + EDITOR_VERSION 常量 |
| `document/DocumentFormatVersion.ts` | 新增: DocumentFormatVersion 接口 + CURRENT_DOCUMENT_VERSION 常量 + parseVersion/compareVersions 迁移 |
| `document/DocumentModel.ts` | 修改: DocumentTree.modelVersion 显式声明 (去除强转) |
| `document/ModelUpgrader.ts` | 修改: 删除 downgrade(), 接 DocumentFormatVersion 结构化类型 |
| `layout/core/SLIF.ts` | 修改: SLIF_VERSION 常量改为引用 DocumentFormatVersion |
| `engine/index.ts` | 修改: 新增 EditorVersion / DocumentFormatVersion 重导出 |

### Phase 3: 接通加载流程 (流水线)

| 文件 | 操作 |
|---|---|
| `document/DocumentLoader.ts` | 新增: 6 步流水线 (detect → checkCompatibility → upgrade → validate → buildModel → buildPool) |
| `document/DocumentSerializer.ts` | 修改: serializeDocument 写入固定 modelVersion, 删除重复的"补默认字段"逻辑 (迁移到 Loader) |
| `document/buildNodePool.ts` (或 NodePool.ts) | 修改: 不再补默认字段 (改由 Loader 负责), 仅负责从 doc + nodes 重建 pool |
| `engine/Editor.ts` | 修改: 加载时调用 loadDocument() 替换直接 buildDocumentPool() |

### Phase 4: 测试

新文件: `__tests__/DocumentLoader.test.ts`

测试用例:
- ✅ v1 → v4 (经历完整 3 步升级链)
- ✅ v2 → v4 (跳过 v1→v2)
- ✅ v3 → v4 (跳过 v1→v3)
- ✅ v4 → v4 (无升级)
- ❌ v5 → v4 (拒绝: 文档版本高于引擎)
- ❌ malformed modelVersion (parseVersion 抛错 → LoadError)
- ❌ 缺必填字段 (validate 失败)
- ❌ 引用悬空 (validate 失败)
- ❌ JSON 格式错误 (JSON.parse 失败 → LoadError)
- ✅ 缺 modelVersion 字段 (默认 v1, 自动升级)
- ✅ 未知额外字段 (默认容错, strict 模式抛错)

### Phase 5 (暂不执行): 目录清理

待 Phase 1-4 完成后, 用户决定如何拆分 `document/` 子目录。当前不在本次范围。

---

## 6. 不在本次范围

- ❌ 不拆 `document/` 为多级子目录 (Phase 5 才动)
- ❌ 不实现 `downgrade()` (决策 4)
- ❌ 不引入 v4→v5 升级规则 (等真有 v5 需求时再加)
- ❌ 不动 layout/ (已重构, 与本次正交)
- ❌ 不动 state/ (已清理, 与本次正交)
- ❌ 不持久化/版本号服务化 (Loader 只做加载, 不做 HTTP 调用)

---

## 7. 验证标准 (Phase 1 完成的标志)

本文档已就以下问题给出明确答案:

- ✅ 5 个核心概念的类型签名
- ✅ 加载流水线伪代码
- ✅ 4 个设计决策及其理由
- ✅ Phase 2-4 的拆解
- ✅ Phase 4 的测试用例清单

---

## 8. 待用户确认

- [ ] 文档已审完, 可以开始 Phase 2 (代码实现)
- [ ] Phase 2-4 一次完成, 还是分阶段评审
- [ ] Phase 4 测试用例清单是否完整
- [ ] 实施过程中如遇未覆盖的设计问题, 是回头修订文档还是单点决策

确认后开始 Phase 2。