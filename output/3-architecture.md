# 架构设计文档 - 文档编辑器引擎

> 版本: v20.34 | 日期: 2026-07-30 | 阶段: docs
>
> **v20.34 变更**: P1 收尾 —— P1-1 四条流水线时序图; P1-2 EditorProvider→Zustand桥; P1-3 产品/SDK双默认; P1-5 paragraphPath 末段语义纠正; P1-7 MVP 限定10页验收

---

## 1. 总体架构

### 1.1 架构图

```
┌────────────────────────────────────────────────────────────────┐
│                        浏览器 (Browser)                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   React UI 层                             │  │
│  │  Toolbar | Sidebar | StatusBar | Dialogs | Right-Click    │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │                   引擎核心层 (Engine Core)                 │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  Editor (Facade)                                    │  │  │
│  │  │  ┌──────────────────────────────────────────────┐  │  │  │
│  │  │  │ EditorRuntimeState               │  │  │  │
│  │  │  │ cursor | selection | viewMode | scroll | IME │  │  │  │
│  │  │  └──────────────────────────────────────────────┘  │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Command System                                    │  │  │
│  │  │  ICommand → InsertText | DeleteText | FormatText   │  │  │
│  │  │           | InsertElement | ModifyElement | ...    │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Layout Engines                                    │  │  │
│  │  │  TextMeasurer | LineBreaker | PageBreaker          │  │  │
│  │  │  + IncrementalLayout (局部增量布局)                 │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Render Pipeline                                   │  │  │
│  │  │  Draw → IParticle[] → Canvas (增量渲染)             │  │  │
│  │  │  TextParticle | ImageParticle | TableParticle      │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Interaction Layer                                 │  │  │
│  │  │  EventBus → MouseHandler | KeyboardHandler         │  │  │
│  │  │           | IMEHandler | ClipboardHandler           │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  State Layer                                       │  │  │
│  │  │  CoordinateSystem | UndoRedoStack | TreePath       │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Document Model (ModelD)                           │  │  │
│  │  │  DocumentTree → body: FlowBody → BlockNode[]        │  │  │
│  │  │  + ElementFormatter (工厂/遍历/快照)               │  │  │
│  │  │  + ModelValidator (校验器)                   │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Auto-Save Engine                           │  │  │
│  │  │  Debounce → IndexedDB → API → Recovery             │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │                   服务层 (Services)                        │  │
│  │  API Client | WebSocket Client | Auth | Cache           │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                               │
                    HTTP/WS     │
                               │
┌────────────────────────────────────────────────────────────────┐
│                     Java SpringBoot 后端                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  API 网关层 (REST + WebSocket)                           │  │
│  │  + modelVersion 版本兼容中间件                     │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  业务服务层                                              │  │
│  │  DocumentService | TemplateService | ExportService       │  │
│  │  CollaborationService | PermissionService | AuditService │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  数据访问层 (乐观锁 version 字段                   │  │
│  │  Mybatis-Plus | Redis Cache                              │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  基础设施层                                              │  │
│  │  MySQL 8.0 JSON | Redis 7 | MinIO | RabbitMQ            │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计原则

**三大铁律** :

| 原则                   | 含义                                                                        | 反模式                                     |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| **接口抽象**     | 所有跨模块边界通过 interface 通信；具体实现可替换，不修改调用方             | 直接 `new` 具体类、硬编码 Canvas API     |
| **数据增量**     | 编辑后仅重新计算受影响的数据，非全量重建；所有缓存通过 version 判断有效性   | 全量 recomputeLayout()、全画布 clearRect() |
| **计算渲染分离** | 布局计算 (layout/) 不接触 Canvas；渲染 (render/) 只消费布局结果，不重复测量 | Draw.ts 中混用 measureText + fillText      |

**七项具体原则**:

1. **静态文档与运行时状态分离**：`DocumentTree` 仅存储持久化数据，光标/选区/滚动/IME 等运行时状态归属独立的 `EditorRuntimeState`
2. **命令模式驱动编辑**：所有文档变更封装为 `ICommand`，天然支持 Undo/Redo/协作操作重放
3. **ID 链路路径替代下标路径**：用 `string[]` (节点 ID 链) 替代 `TreePathItem[]` (下标索引链)，插入/删除后路径自动稳定
4. **统一坐标系统**：逻辑文档坐标 ↔ Canvas 画布坐标 ↔ 屏幕像素坐标，三层转换由 `CoordinateSystem` 集中管理
5. **增量布局与增量渲染**：编辑后仅重算受影响区域，仅重绘脏区，保证长文档编辑 60fps
6. **插件化粒子接口**：统一 `IParticle` 接口，Text/Image/Table/Control 实现各自渲染逻辑
7. **前后端契约优先**：API 契约 + JSON Schema 校验 + modelVersion 版本兼容策略

**三大铁律如何保障 WASM 平滑接入**:

```
                    ITextShaper (接口抽象)
                   /                    \
    CanvasTextShaper              HarfBuzzShaper (WASM)
    (L1 快速, 内置)               (L2 精确, 懒加载)

TextMeasurer 依赖 ITextShaper 接口，不感知底层实现。
升级路径: CanvasTextShaper → HarfBuzzShaper，零调用方改动。

                    IMeasurer (接口抽象)
                   /           \
         TextMeasurer        HarfBuzzMeasurer (WASM)

同样适用于 FontFallback、LineBreaker —— 任何需要精确字体度量的模块
只需注入不同的 IMeasurer 实现，WASM 模块可平滑接入。
```

### 1.3 ModelA → ModelD 架构演进

| 维度       | ModelA              | ModelD (重构后)       | ModelD (目标架构)                      |
| ---------- | ------------------- | --------------------- | -------------------------------------- |
| 文档模型   | 扁平 `IElement[]`   | 树形 `DocumentTree`   | 树形 + metadata 扩展                   |
| 运行时状态 | 散落 Draw.ts        | 散落 Draw.ts          | **独立 EditorRuntimeState**      |
| 编辑驱动   | 内联方法调用        | 内联方法调用          | **Command 命令模式**             |
| 撤销/重做  | HistoryManager      | 内联 JSON 快照        | **UndoRedoStack + Command 增量** |
| 光标定位   | 数组下标            | treePath (pi,bi,ii)   | **ID 链路路径 string[]**         |
| 坐标系统   | 多处重复换算        | 多处重复换算          | **统一 CoordinateSystem**        |
| 粒子渲染   | 无统一接口          | 无统一接口            | **IParticle 统一接口**           |
| 布局渲染   | 全量重算            | 全量重算              | **增量布局 + 增量渲染**          |
| 模型校验   | 无                  | 无                    | **ModelValidator + JSON Schema** |

## 2. 文档数据模型

### 2.1 存储模型

核心设计决策:

1. **存储去分页化**: `DocumentTree` 不再包含 `pages: Page[]`，改为单一 `body: FlowBody`。分页是布局引擎运行时输出（SLIFPage[]），不进入存储模型。此变更从根本上解决"插入文字后跨 Page 搬运节点"的架构级矛盾。
2. **children 全部 ID 化**: 所有 `children` 字段直接从 `BaseNode[]` 改为 `string[]`，一步到位，不存在引用→ID 的过渡期。
3. **分级版本号**: NodePool 使用 `structureVersion`（增删节点 +1）+ `nodeVersions: Map<string, number>`（节点内容/样式变更时单独 +1），LayoutCache 按节点版本比对。与 §7.4 InvalidationScope 对齐。
4. **路径体系统一**: 废弃 `TreePath = TreePathItem[]`（下标索引），全局统一使用 `string[]`（ID 链路）。insertAt/removeAt 签名全部改为 ID 路径。
5. **补齐 ImageNode**: BlockNode 增加 ImageNode 类型。MinIO 上传链路 + EditorSecurityConfig 权限串联。
6. **dataType 补 S2 + privacy 脱敏链路**: ElementFormat.dataType 增加 `'S2'`（枚举型）；ElementMeta.privacy 增加 `maskChar` 字段，渲染层按用户权限脱敏。

```typescript
// ================================================================
// 存储模型 — 去分页化
// ================================================================
interface PageSetup {
  width: number; height: number
  marginTop: number; marginBottom: number; marginLeft: number; marginRight: number
  orientation: 'portrait' | 'landscape'
  watermark?: WatermarkConfig
}
interface DocumentTree {
  type: 'document'; id: string; title: string
  pageSetup: PageSetup
  /** 唯一正文 (替代 pages: Page[]) */
  body: FlowBody
  /** 页眉/页脚 — 布局引擎在每页渲染时引用 */
  header?: string[]; footer?: string[]  // header/footer BlockNode ID[] (v20.4: 统一 ID 引用)
  metadata?: Record<string, unknown>
}
// pages: Page[] 降级为布局引擎输出 (SLIFPage[])
// 存储层不再包含 Page 概念

const DEFAULT_PAGE_SETUP: PageSetup = {
  width: 794, height: 1123,
  marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90,
  orientation: 'portrait',
}

interface FlowBody { mode: 'flow'; children: string[] }  // BodyChild ID[] (BlockNode | SectionBreak)
// 移除 PageBody = BlockNode[] | FlowBody union, 根除双模防御成本

// ================================================================
// ================================================================
// NodePool — 权威定义（§2.5 的 5 条铁律 + Duplicate ID 已合入）
// ================================================================

/** 节点池不可违反的 5 条铁律 (代码层面强制执行):
 *
 * 1. 【单向引用】父子关系仅通过父节点的 children: string[] 维护。
 *    节点本身不存储 parentId，禁止双向引用。
 *
 * 2. 【顺序保证】children 数组的顺序 = 文档中的逻辑顺序。
 *    渲染、遍历、选区计算全部依赖此顺序，禁止非确定性排序。
 *
 * 3. 【统一入口】所有 children 数组的增删改必须通过 NodePool 的工具函数:
 *    insertChild / removeChild / moveChild。禁止直接 push/splice。
 *    insertChild 强制检查 Duplicate ID，绕过此入口会导致脏数据入库。
 *
 * 4. 【ID 不可变】节点 ID 一旦分配，永不修改。cloneWithNewIds() 生成全新 ID。
 *    updateNode() 拒绝修改 id 和 type 字段。
 *
 * 5. 【遍历范式】所有树遍历必须通过 traversePool()，按 children 顺序深度优先。
 *    禁止直接递归 children 数组做业务逻辑。
 */
class NodePool {
  nodes = new Map<string, BaseNode>()
  private _structureVersion = 0                    // 增删节点时 ++
  private _nodeVersions = new Map<string, number>() // 节点内容/样式变更时单独 ++

  get structureVersion(): number { return this._structureVersion }
  getNodeVersion(nodeId: string): number { return this._nodeVersions.get(nodeId) ?? 0 }

  /** 插入子节点 (唯一合法入口, 铁律 3) */
  insertChild(parentId: string, childId: string, index: number): void {
    const parent = this.nodes.get(parentId)
    if (!parent || !('children' in parent)) throw new Error(`Parent ${parentId} not found or has no children`)
    if (this.nodes.has(childId)) throw new Error(`Duplicate ID: ${childId}`)  // 铁律 3: ID 唯一性
    const children = (parent as any).children as string[]
    children.splice(index, 0, childId)
    this._structureVersion++
  }

  /** 删除子节点 (唯一合法入口, 铁律 3) — 级联回收后代，修复孤儿泄漏 */
  removeChild(parentId: string, index: number): string {
    const parent = this.nodes.get(parentId)
    if (!parent || !('children' in parent)) throw new Error(`Parent ${parentId} not found or has no children`)
    const children = (parent as any).children as string[]
    const removedId = children.splice(index, 1)[0]
    const descendantIds = this.collectDescendants(removedId)
    for (const id of descendantIds) { this.nodes.delete(id); this._nodeVersions.delete(id) }
    this._structureVersion++
    return removedId
  }

  /** 移动子节点 (唯一合法入口, 铁律 3) */
  moveChild(parentId: string, fromIndex: number, toIndex: number): void {
    const parent = this.nodes.get(parentId)
    if (!parent || !('children' in parent)) throw new Error(`Parent ${parentId} not found or has no children`)
    const children = (parent as any).children as string[]
    const [moved] = children.splice(fromIndex, 1)
    children.splice(toIndex, 0, moved)
    this._structureVersion++
  }

  private collectDescendants(nodeId: string): string[] {
    const result: string[] = [nodeId]
    const node = this.nodes.get(nodeId)
    if (node && 'children' in node) {
      for (const childId of (node as any).children as string[]) {
        result.push(...this.collectDescendants(childId))
      }
    }
    return result
  }

  /** 更新节点内容/样式 (铁律 4: 拒绝修改 id/type) */
  updateNode(nodeId: string, changes: Partial<BaseNode>): void {
    if ('id' in changes || 'type' in changes) throw new Error('id and type are immutable')
    const node = this.nodes.get(nodeId)
    if (node) {
      Object.assign(node, changes)
      this._nodeVersions.set(nodeId, (this._nodeVersions.get(nodeId) ?? 0) + 1)
    }
  }

  getChildren(parentId: string): readonly string[] {
    return (this.nodes.get(parentId) as any)?.children ?? []
  }
  getChildNodes(parentId: string): readonly BaseNode[] {
    return this.getChildren(parentId).map(id => this.nodes.get(id)!).filter(Boolean)
  }

  // ================================================================
  // 公共方法 (v20.21: 从 §4.1/§6.3b/§11.2 分散引用收拢到权威定义)
  // ================================================================

  /** rootIds 存储 —— buildNodePool 注入后由 QCEngine §11.2 等使用 */
  rootIds: {
    body: string; header?: string[]; footer?: string[]
    footnotes?: string[]; endnotes?: string[]
  } = { body: '' }

  /** 单独 bump 节点版本 (供外部无需修改属性时使用, 如 NodePoolProjection §13.3.2) */
  bumpNodeVersion(nodeId: string): void {
    this._nodeVersions.set(nodeId, (this._nodeVersions.get(nodeId) ?? 0) + 1)
  }

  /** 字符偏移 → (textNodeId, localOffset) — 全文档唯一合法的 offset 解析入口 */
  resolveCharOffset(paragraphId: string, charOffset: number): { textNodeId: string; localOffset: number } | null {
    const para = this.nodes.get(paragraphId) as any
    if (!para) return null
    let remaining = charOffset
    for (const childId of para.children) {
      const node = this.nodes.get(childId)
      if (node?.type === 'text') {
        const len = (node as any).text.length
        if (remaining <= len) return { textNodeId: childId, localOffset: remaining }
        remaining -= len
      } else {
        if (remaining <= 1) return { textNodeId: childId, localOffset: Math.min(remaining, 1) }
        remaining -= 1
      }
    }
    return null
  }

  /** 计算给定节点的全局字符偏移 */
  getCharOffset(paragraphId: string, textNodeId: string, localOffset: number): number {
    const para = this.nodes.get(paragraphId) as any
    let offset = 0
    for (const childId of para.children) {
      if (childId === textNodeId) return offset + localOffset
      const node = this.nodes.get(childId)
      if (node?.type === 'text') offset += (node as any).text.length
      else offset += 1
    }
    return offset
  }

  /** 移除孤儿叶子节点 — 无级联回收 + 版本维护 (v20.30: 替代直接操作私有字段)
   *  仅用于 normalizeParagraph 合并后回收已被合并的 TextNode。
   *  被回收节点必须为叶子(无 children), 否则抛异常。 */
  removeOrphanLeaf(nodeId: string): void {
    const node = this.nodes.get(nodeId)
    if (node && 'children' in node && (node as any).children?.length > 0) {
      throw new Error(`removeOrphanLeaf: ${nodeId} is not a leaf node`)
    }
    this.nodes.delete(nodeId)
    this._nodeVersions.delete(nodeId)
    this._structureVersion++
  }
}

// ================================================================
// buildNodePool — 两遍构建 (v19.5 修复先有鸡还是先有蛋的问题)
// ================================================================
// 旧版本 bug: collect() 递归中 pool.nodes.get(childId) 取子节点时
// 子节点尚未注册。修复为两遍构建:
//   Pass 1: BFS/DFS 遍历序列化 JSON 全量注册 nodes.set()
//   Pass 2: 校验所有 children 引用的 ID 在 nodes 中存在（输出 orphan_reference 警告）

/**
 * buildNodePool — 扁平节点注册 (v19.15 重写, 修复 P0-1)
 *
 * 输入: DocumentLoader 已将 JSON 序列化数据展开为扁平 Map + 根 ID 集合
 * 不再依赖树遍历——children 为 ID 数组时无法递归到子节点对象。
 * 同时显式注册 body/header/footer/footnotes/endnotes 五个区域，
 * 确保从根不可达的节点（脚注/尾注内容）也能被 O(1) 查找。
 */
function buildNodePool(
  flatNodes: Map<string, BaseNode>,
  rootIds: {
    body: string           // DocumentTree.body.id
    header?: string[]      // header BlockNode IDs
    footer?: string[]      // footer BlockNode IDs
    footnotes?: string[]   // FootnoteContent IDs (§2.12)
    endnotes?: string[]    // FootnoteContent IDs (§2.12)
  }
): NodePool {
  const pool = new NodePool()

  // Pass 1: 全量注册
  for (const [id, node] of flatNodes) {
    if (pool.nodes.has(id)) {
      console.warn(`[NodePool] Duplicate ID: ${id}, skipping`)
      continue
    }
    pool.nodes.set(id, node)
  }

  // Pass 2: 校验引用完整性 (遍历所有已注册节点的 children)
  for (const node of flatNodes.values()) {
    if ('children' in node) {
      for (const childId of (node as any).children as string[]) {
        if (!pool.nodes.has(childId)) {
          console.warn(`[NodePool] Orphan reference: ${node.id} → ${childId}`)
        }
      }
    }
  }

  // Pass 3: 校验 rootIds 指向的节点存在
  const rootIdSet = new Set([
    rootIds.body,
    ...(rootIds.header ?? []),
    ...(rootIds.footer ?? []),
    ...(rootIds.footnotes ?? []),
    ...(rootIds.endnotes ?? []),
  ])
  for (const id of rootIdSet) {
    if (!pool.nodes.has(id)) {
      throw new Error(`[NodePool] Root node not found: ${id}`)
    }
  }

  // Pass 4: 存储 rootIds 到 NodePool 实例
  pool.rootIds = rootIds

  return pool
}
// DocumentLoader 契约:
//   load(json) → { flatNodes: Map<string,BaseNode>, rootIds: {body, header?, footer?, footnotes?, endnotes?} }
//   → buildNodePool(flatNodes, rootIds) → NodePool
//   详见 §19 JSONDocumentLoader

// 树遍历 — 基于 NodePool (铁律 5)
function traversePool(pool: NodePool, rootId: string, visitor: (node: BaseNode, depth: number) => void): void {
  const visited = new Set<string>()
  const walk = (id: string, depth: number) => {
    if (visited.has(id)) throw new Error(`Cycle detected: ${id}`)
    visited.add(id)
    const node = pool.nodes.get(id); if (!node) return
    visitor(node, depth)
    if ('children' in node) {
      for (const childId of (node as any).children as string[]) walk(childId, depth + 1)
    }
  }
  walk(rootId, 0)
}
// 统一: ID 链路 string[] + NodePool 驱动遍历
```

### 2.2 节点类型定义

```typescript
// ================================================================
// 节点类型标识
// ================================================================
const NodeType = {
  DOCUMENT: 'document', PARAGRAPH: 'paragraph', TABLE: 'table',
  ROW: 'row', CELL: 'cell', TEXT: 'text', SMART_TEXT: 'smarttext',
  IMAGE: 'image', SEPARATOR: 'separator', SECTION_BREAK: 'section_break',
  BOOKMARK: 'bookmark', CROSS_REFERENCE: 'cross_reference', FIELD: 'field',
  FOOTNOTE_REF: 'footnote_ref', FOOTNOTE_CONTENT: 'footnote_content',
  COMMENT_MARKER: 'comment_marker',
} as const

// ================================================================
// 样式
// ================================================================
interface TextStyle {
  font?: string; size?: number; bold?: boolean; italic?: boolean
  underline?: boolean; underlineStyle?: 'single' | 'double' | 'wave'
  strikeout?: boolean; color?: string; highlight?: string
  superscript?: boolean; subscript?: boolean; letterSpacing?: number
}
interface ParagraphStyle {
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indent?: number; lineHeight?: number; spaceBefore?: number; spaceAfter?: number
}

// ================================================================
// BaseNode — children 全部为 string[] (ID 引用)
// ================================================================
interface BaseNode {
  id: string; type: NodeType
  metadata?: Record<string, unknown>  // locked/undeletable/annotations/tags
}

// ================================================================
// 医疗数据元
// ================================================================
interface ElementCode { internal: string; dataElement: string }
interface ElementFormat {
  dataType: 'S1' | 'S2' | 'S3' | 'N' | 'D'   // 补 S2 (枚举型)
  showType?: 'AN' | 'N'
  minLength?: number; maxLength?: number
  dictionary?: string   // 字典/码表 ID (需要关联 'S2' 枚举值校验)
}
interface ElementMeta {
  code: ElementCode; name: string; labels?: string[]
  format?: ElementFormat; required?: boolean
  readonly?: boolean
  /** 隐私脱敏 */
  privacy?: {
    enabled: boolean
    maskChar: string   // 脱敏替换字符, 默认 '*'
    maskRule: 'full' | 'partial'  // 全量脱敏 | 部分脱敏 (保留首尾各 1 字符)
  }
}

// ================================================================
// 节点层次 — 所有 children 均为 string[] (NodePool ID 引用)
// ================================================================
interface TextNode extends BaseNode, TextStyle {
  type: 'text'; text: string
}
interface SmartTextNode extends BaseNode, TextStyle {
  type: 'smarttext'; text: string; element: ElementMeta
}
interface ImageNode extends BaseNode {
  type: 'image'
  src?: string          // data URL / blob URL (浏览器本地)
  objectKey?: string    // MinIO object key (持久化引用)
  width: number; height: number
  naturalWidth?: number; naturalHeight?: number
  wrapMode: 'inline' | 'square' | 'top-bottom'
}
type InlineNode = TextNode | SmartTextNode | ImageNode | BookmarkNode | CrossReferenceNode | FieldNode

interface Paragraph extends BaseNode, ParagraphStyle {
  type: 'paragraph'; children: string[]   // InlineNode ID[]
}
interface Table extends BaseNode {
  type: 'table'; columns: ColumnDefinition[]; children: string[]  // TableRow ID[]
  pageBreak?: TablePageBreakRule
}
interface TableRow extends BaseNode {
  type: 'row'; height?: number; children: string[]  // TableCell ID[]
}
interface TableCell extends BaseNode {
  type: 'cell'; colspan?: number; rowspan?: number
  children: string[]   // BlockNode ID[]
  backgroundColor?: string; verticalAlign?: 'top' | 'middle' | 'bottom'; isHeader?: boolean
}
type BlockNode = Paragraph | Table | ImageNode | SeparatorNode
/** body.children 的实际元素类型: BlockNode 或分节标记 (v19.15, 修复 P0-2) */
type BodyChild = BlockNode | SectionBreak
```

### 2.3 隐私脱敏渲染链路

```typescript
/**
 * 渲染层按用户权限脱敏:
 *   SmartTextNode.element.privacy.enabled === true 时,
 *   根据 currentUserLevel 和节点权限级别决定是否打码
 *
 * 打码规则:
 *   - userLevel < 要求级别 → 脱敏
 *   - maskRule='full'    → 全部替换为 maskChar (如 "***")
 *   - maskRule='partial' → 保留首尾各 1 字符，中间替换 (如 "张*")
 *   - 脱敏后文字不可选中、不可复制 (SelectionState 跳过脱敏节点)
 *
 * 与 EditorSecurityConfig 的关系: data.allowCopy=false 时,
 *   脱敏字段在剪贴板中直接替换为 maskChar，而非原文。
 */
function applyPrivacyMask(node: SmartTextNode, userLevel: number): string {
  const p = node.element.privacy
  if (!p?.enabled || userLevel >= 3) return node.text  // 高权限用户看原文
  if (p.maskRule === 'full') return p.maskChar.repeat(node.text.length)
  // partial: 保留首尾
  const len = node.text.length
  if (len <= 2) return p.maskChar.repeat(len)
  return node.text[0] + p.maskChar.repeat(len - 2) + node.text[len - 1]
}
```

### 2.4 节点工厂与树操作

移除 createPage/createFlowBody/flowBodyToArray/arrayToFlowBody/getBodyBlocks——存储模型去分页化后不再需要。PageBreaker 输出 SLIFPage[] 为布局产物，非存储结构。

```typescript
createDocument(title, body?, pageSetup?)     → DocumentTree   // body: FlowBody (children: string[])
createParagraph(children?, style?)            → Paragraph       // children: string[]
createTextNode(text, style?)                  → TextNode
createSmartTextNode(text, element, style?)    → SmartTextNode
createImageNode(objectKey, width, height, wrapMode?) → ImageNode
createTable(columns?, rows?)                  → Table           // columns: ColumnDefinition[], rows: TableRow[]
createTableRow(cells?, height?)               → TableRow
createTableCell(blockIds?, opts?)             → TableCell
createSimpleTable(rows, cols)                 → Table

// 树操作 — 统一 ID 链路 string[]
insertAt(tree, pool, parentId: string, childId: string, index: number): boolean
removeAt(tree, pool, parentId: string, index: number): boolean
findById(pool, rootId: string, id: string): BaseNode | undefined   // O(1)
findByDE(pool, rootId, deCode): SmartTextNode[]
findByInternal(pool, rootId, internalCode): SmartTextNode[]

deepClone(node) → 深克隆; cloneWithNewIds(node) → 克隆 + 重新生成 ID
takeSnapshot(tree) → JSON; restoreSnapshot(json) → DocumentTree
```

### 2.5 节点池核心语义规则

**5 条铁律** 已作为权威定义合入 §2.1 NodePool 类实现中（含 `insertChild` Duplicate ID 检查、`updateNode` id/type 不可变检查、`removeChild` 级联回收、`moveChild` 统一入口、`traversePool` 遍历范式）。本节不再重复类定义。以下仅保留规则说明供快速参考:

1. **单向引用** — children: string[]，节点不存储 parentId
2. **顺序保证** — children 数组顺序 = 文档逻辑顺序
3. **统一入口** — insertChild/removeChild/moveChild 为唯一合法入口
4. **ID 不可变** — id 分配后永不修改，updateNode() 拒绝 id/type 变更
5. **遍历范式** — 必须通过 traversePool()，禁止直接递归 children

`buildNodePool` 已修复为两遍构建（Pass 1 全量注册 → Pass 2 引用校验），详见 §2.1。
### 2.6 移除 FlowBody 双模

```
v10.0 直接删除 PageBody = BlockNode[] | FlowBody union。
所有 header/footer 从 BlockNode[] 改为 string[]（ID 引用, v20.4: 统一 ID 化）。header/footer 节点同样注册到 NodePool 和 buildNodePool 的 rootIds 中。
所有代码中 getBodyBlocks() 防御调用移除。
旧数据 upgrader: wrapArrayToFlowBody() (v3.0→v4.0 breaking upgrader 中执行)
```

### 2.7 分节模型 (Section Break)

**问题**: 当前 `DocumentTree` 的 `pageSetup` 是文档级单例，无法支持同一文档内不同区域独立设置纸张方向/页边距/页眉页脚。医学场景如病历正文 A4 纵向 + 检查报告表格 A3 横向，需要分节机制。

**方案**: `DocumentTree.body.children` 中可插入 `SectionBreak` 节点，将 FlowBody 分为多个逻辑节。每节的 `pageSetup` 覆盖文档级默认值。

```typescript
interface SectionBreak extends BaseNode {
  type: 'section_break'
  /** 分节类型 */
  breakType: 'next_page' | 'continuous' | 'even_page' | 'odd_page'
  /** 下一节的页面设置 (为空则继承文档级 pageSetup) */
  nextPageSetup?: Partial<PageSetup>
  /** 下一节的页眉/页脚 (为空则继承文档级 header/footer) */
  nextHeader?: string[]   // header BlockNode ID[] (v20.4: 统一 ID 引用, 注册到 NodePool)
  nextFooter?: string[]
  /** 下一节页码起始值 (为空则接续上一节) */
  nextPageNumberStart?: number
  /** 下一节首页是否不同 */
  nextFirstPageDifferent?: boolean
}

// DocumentTree 修改:
interface DocumentTree {
  // ... 现有字段不变
  body: FlowBody  // children 中可混入 SectionBreak 节点
}

// 布局引擎按节分组:
// 遍历 body.children → 遇到 SectionBreak 时切换当前节的 pageSetup →
// 后续 BlockNode 使用新节的设置进行分页
// PageBreaker 输出时标记每页所属的 sectionIndex
```

**与 FlowBody 的关系**: SectionBreak 不是 BlockNode，它不产生可见内容，仅作为分节标记插入在 `body.children` 中。布局引擎遍历时将其视为节边界——SectionBreak 之前的 BlockNode 用上一节的设置分页，之后的用下一节的设置。

### 2.8 书签与交叉引用

```typescript
/** 书签节点 — 文档中的命名锚点 */
interface BookmarkNode extends BaseNode {
  type: 'bookmark'
  name: string               // 书签名 (唯一)
  targetId: string           // 被标记的节点 ID
  targetOffset?: number      // 节点内的字符偏移 (可选, 精确到字符位置)
}

/** 交叉引用节点 — 引用文档内其他位置 */
interface CrossReferenceNode extends BaseNode, TextStyle {
  type: 'cross_reference'
  /** 引用类型 */
  refType: 'bookmark' | 'heading' | 'footnote' | 'page_number'
  /** 引用的目标书签名/标题ID/脚注ID */
  targetRef: string
  /** 显示文本 (如 "详见体格检查 第 3 页", 布局引擎自动填充页码) */
  displayText: string
}

// 布局引擎在渲染时解析 CrossReferenceNode:
//   1. 按 refType 查找目标 (bookmark → BookmarkNode, heading → Paragraph.id)
//   2. 计算目标所在页码
//   3. 将 displayText 中的 {page} 占位符替换为实际页码
//   4. 页码变化时标记该 CrossReferenceNode 所在区域为渲染脏

// 书签和交叉引用存储在 body.children 中 (InlineNode 级别, 统一定义见 §2.2)
```

### 2.9 动态字段节点 (FieldNode)

**问题**: Word 的域 (Field) 支持自动更新的动态内容——当前日期、总页数、作者名等。医学文书的签名日期、打印日期等需要自动填充。

**方案**: 新增 `FieldNode` 作为一种特殊 InlineNode，布局引擎在每次渲染时计算其当前值。

```typescript
/** 动态字段类型 */
type FieldType =
  | 'current_date'        // 当前日期 (yyyy-MM-dd)
  | 'current_time'        // 当前时间 (HH:mm)
  | 'page_number'         // 当前页码
  | 'total_pages'         // 文档总页数
  | 'author_name'         // 当前编辑者姓名
  | 'document_title'      // 文档标题
  | 'last_saved_date'     // 上次保存日期
  | 'print_date'          // 打印日期 (打印时固化)

interface FieldNode extends BaseNode, TextStyle {
  type: 'field'
  fieldType: FieldType
  /** 自定义格式 (如 'yyyy年MM月dd日') */
  format?: string
  /** 缓存值 (上次计算结果, 用于判断是否需要更新) */
  cachedValue?: string
  /** 缓存版本 (与对应数据源的 version 比对) */
  cachedVersion?: number
}

// 渲染时:
//   FieldResolver.resolve(fieldNode, context) → 当前值
//   如 { fieldType: 'current_date', format: 'yyyy-MM-dd' } → '2026-07-29'

// 缓存策略:
//   'current_date' — 每 60s 检查一次
//   'current_time' — 每 60s 检查一次
//   'page_number'  — 分页结果变化时自动更新
//   'total_pages'  — 分页结果变化时自动更新
//   'author_name'  — 文档加载时计算一次
//   'print_date'   — 打印时固化 (resolved → 写入 TextNode, 移除 FieldNode)

// FieldNode/FootnoteRef 属于 InlineNode (统一定义见 §2.2)
```

### 2.10 列表与编号

**问题**: 医学文书常用列表（症状清单、诊断依据、治疗措施等），当前 `ParagraphStyle` 无列表相关属性。

**方案**: 扩展 `ParagraphStyle`，增加列表类型和层级。列表是段落属性而非独立节点类型——任何 Paragraph 都可以变为列表项。

```typescript
interface ParagraphStyle {
  // ... 现有字段
  /** 列表属性 (非列表段落为 null) */
  list?: {
    type: 'bullet' | 'ordered'       // 无序/有序
    level: number                     // 缩进层级 (0-8)
    /** 有序列表的编号样式 */
    numberStyle?: 'decimal' | 'lower_alpha' | 'upper_alpha'
                | 'lower_roman' | 'upper_roman' | 'cjk_ideographic'
    /** 无序列表的项目符号 (默认按层级自动: •/◦/▪) */
    bulletChar?: string
    /** 编号起始值 (有序列表, 默认 1) */
    startAt?: number
    /** 编号是否继续上一列表项 */
    continueNumbering?: boolean
  }
}

// 多级缩进: Tab 键增加 level, Shift+Tab 减少 level
// 回车键: 继承当前列表属性, 创建同层新列表项
// 连续两次回车: 退出列表, 恢复为普通段落 (list=null)
```

### 2.11 标题与大纲

**问题**: 医学病历的结构（主诉、现病史、既往史等）天然是标题层级。需要 Heading 概念支撑目录生成和大纲导航。

**方案**: 标题是 Paragraph 的 `outlineLevel` 属性，不创建独立节点类型。

```typescript
interface Paragraph extends BaseNode, ParagraphStyle {
  type: 'paragraph'
  children: string[]
  /** 大纲级别 (0=正文, 1-6=Heading 1-6, 对应 Word 标题样式) */
  outlineLevel?: number  // 0 | 1 | 2 | 3 | 4 | 5 | 6
}

// 大纲提取: traverse body.children → 收集 outlineLevel > 0 的 Paragraph
// 目录生成: outlineLevel 1-6 → 缩进层级 + 页码 → 渲染为 TOC 页面
// 大纲导航: 侧边栏点击标题 → scrollToPage(该 Paragraph 所在页)
```

### 2.12 脚注/尾注

**问题**: 医学文书引用参考文献、检查结果需要脚注。脚注包含两部分——正文中的标记（上标数字）和页面底部的注释文本。

**方案**: 脚注作为 InlineNode 插入在正文中，布局引擎收集当前页的脚注并渲染在页面底部。

```typescript
/** 脚注引用节点 — 正文中的上标标记 */
interface FootnoteRef extends BaseNode, TextStyle {
  type: 'footnote_ref'
  /** 引用的脚注内容 ID (指向 FootnoteContent 节点) */
  footnoteId: string
  /** 脚注编号 — 运行时缓存, 不持久化 (v20.5: 布局引擎分配, 序列化时丢弃)
   *   编号取决于分页结果(每页编号/连续编号), 属于布局产物而非存储模型 */
  number?: number  // excluded from JSON serialization
}

/** 脚注内容节点 — 存储在 FlowBody 末尾的专门区域 */
interface FootnoteContent extends BaseNode {
  type: 'footnote_content'
  /** 被引用的 ID (由 FootnoteRef.footnoteId 指向) */
  refId: string
  /** 脚注文本内容 */
  children: string[]   // InlineNode ID[] (TextNode 序列)
}

// DocumentTree 增加脚注存储区域:
interface DocumentTree {
  // ... 现有字段
  /** 脚注内容区 (FootnoteContent ID[], 注册到 NodePool, v20.25: 统一 ID 引用) */
  footnotes?: string[]
  /** 尾注内容区 (FootnoteContent ID[], 注册到 NodePool) */
  endnotes?: string[]
}

// 脚注布局规则:
//   1. 遍历 body.children → 遇到 FootnoteRef 时收集其 footnoteId
//   2. 从 footnotes[] 中按 footnoteId 查找 FootnoteContent
//   3. 编号规则: 每页重新编号 或 全文连续编号 (PageSetup 可配置)
//   4. 页面底部分配脚注区域 (扣除正文空间)
//   5. 如果当前页空间不够 → 脚注可延续到下一页
//   6. 尾注渲染在文档最后一页的专门区域
```

### 2.13 查找与替换引擎

**问题**: 查找替换是编辑器标配功能，需要引擎级搜索工具——遍历文档树、匹配文本、返回命中位置列表。

**方案**: `FindReplaceEngine` 作为 NodePool 遍历层之上的搜索工具，不耦合 UI。

```typescript
interface FindOptions {
  /** 搜索文本 */
  query: string
  /** 区分大小写 */
  caseSensitive?: boolean
  /** 全词匹配 */
  wholeWord?: boolean
  /** 正则表达式模式 */
  regex?: boolean
  /** 搜索范围 (默认全文) */
  scope?: { startPath: string[]; endPath: string[] }
  /** 搜索方向 */
  direction?: 'forward' | 'backward'
}

interface FindResult {
  /** 命中节点的 ID 链路径 */
  path: string[]
  /** 节点内的字符偏移 */
  offset: number
  /** 匹配文本长度 */
  length: number
  /** 匹配文本 */
  text: string
}

class FindReplaceEngine {
  /**
   * 在文档中查找所有匹配项
   * 遍历 body.children → 每个 Paragraph 的 children → TextNode.text
   * 对每个 TextNode.text 执行 String.indexOf / RegExp.exec
   */
  findAll(doc: DocumentTree, pool: NodePool, options: FindOptions): FindResult[]

  /** 查找下一个匹配项 (从当前光标位置起) */
  findNext(doc: DocumentTree, pool: NodePool, options: FindOptions, from: CursorState): FindResult | null

  /** 查找上一个匹配项 */
  findPrevious(doc: DocumentTree, pool: NodePool, options: FindOptions, from: CursorState): FindResult | null

  /**
   * 替换单个匹配项 → 构造 DeleteRangeCommand + InsertTextCommand
   * 返回替换后的新光标位置 (定位到替换文本末尾)
   */
  replace(result: FindResult, replacement: string): [ICommand, ICommand]

  /** 替换所有匹配项 → 构造 MacroCommand 批量替换 (作为单次 Undo 单元) */
  replaceAll(doc: DocumentTree, pool: NodePool, options: FindOptions, replacement: string): MacroCommand

  /** 高亮所有匹配项 → 返回所有匹配的 RenderRect[] (用于交互层 overlay) */
  highlightAll(doc: DocumentTree, pool: NodePool, options: FindOptions): RenderRect[]
}

// 查找结果导航: 命中列表 + 当前索引 → Enter 跳到下一个, Shift+Enter 回到上一个
// 替换预览: 替换前高亮当前命中项 (与选区高亮不同色), 用户确认后执行替换
```

### 2.14 分隔线 (SeparatorNode)

```typescript
/** 水平分隔线 — BlockNode 级别，在文档流中占一行 */
interface SeparatorNode extends BaseNode {
  type: 'separator'
  /** 线型: solid | dashed | dotted | double */
  lineStyle?: 'solid' | 'dashed' | 'dotted' | 'double'
  /** 线宽 (px) */
  width?: number
  /** 颜色 */
  color?: string
  /** 宽度模式: 'full'=整行宽 | 'fixed'=固定宽度 */
  widthMode?: 'full' | 'fixed'
  /** 固定宽度值 (widthMode='fixed' 时) */
  fixedWidth?: number
  /** 对齐 (widthMode='fixed' 时) */
  alignment?: 'left' | 'center' | 'right'
}

// SeparatorNode 属于 BlockNode (统一定义见 §2.2)

// 渲染: SeparatorParticle → 在所在行中心绘制水平线
// 默认样式: solid, 1px, #D1D5DB, full-width
```

### 2.15 文档批注模型

**问题**: 质控审核需要创建批注——选中文本后添加意见。当前架构 `.interact` Canvas 层名提到了 `AnnotationLayer`，但没有批注节点模型。

**方案**: `CommentNode` 作为 InlineNode 插入在正文中标记批注范围，`CommentThread` 存储批注内容和回复线程。

```typescript
/** 批注标记节点 — 正文中的批注锚点 (渲染为高亮背景 + 批注图标) */
interface CommentMarker extends BaseNode {
  type: 'comment_marker'
  /** 引用的批注线程 ID */
  threadId: string
  /** 批注范围 (标记的节点路径 + 偏移) */
  rangeStart: { path: string[]; offset: number }
  rangeEnd:   { path: string[]; offset: number }
}

/** 批注线程 — 一条批注及其回复 */
interface CommentThread {
  id: string
  /** 批注范围 (用于定位到正文) */
  rangeStart: { path: string[]; offset: number }
  rangeEnd:   { path: string[]; offset: number }
  /** 创建者 */
  author: string
  /** 创建时间 */
  createdAt: number
  /** 批注状态 */
  status: 'open' | 'resolved' | 'reopened'
  /** 批注内容 (第一条为主批注, 后续为回复) */
  comments: CommentEntry[]
}

interface CommentEntry {
  id: string
  author: string
  content: string        // 批注文本 (纯文本)
  createdAt: number
  editedAt?: number
}

// ================================================================
// 协作场景锚点漂移防护 (v20.1)
// ================================================================
// 问题: CommentMarker 用 (path, offset) 绝对锚点存储在文档内，
// CommentThread 存在后端 t_comment 表——split-brain 锚定。
// 远端插入文本后 path/offset 所指向的逻辑位置已漂移。
//
// 修复:
//   1. CommentThread 增加 baseVersion 字段——创建批注时的文档版本号
//   2. 加载批注时若当前文档 version > baseVersion，触发重锚定:
//      reanchor(thread, oldVersion, currentDoc) → 通过版本 diff 计算锚点位移
//   3. 渲染层: 重锚定失败的批注降级为页面级批注(保留内容但失去精确定位)
// ================================================================

interface CommentThread {
  // ... 现有字段
  /** 创建时的文档版本 (指向 t_document.version, 非 model_version, 用于协作重锚定, v20.1) */
  baseVersion: number
  /** 重锚定状态 */
  anchorStatus: 'valid' | 'reanchored' | 'degraded'
  // degraded: 锚点已失效，降级为页面级批注
}

// DocumentTree 不直接存储批注 (批注存储在独立的 t_comment 表):
//   1. CommentMarker 可选插入到 body.children (仅当需要在特定位置渲染锚点)
//   2. CommentThread 通过 REST API 管理 (CRUD + resolve)
//   3. 渲染: Interaction 层读取当前文档的 CommentThread[] → 渲染锚点高亮 + 侧边栏批注面板

// 批注面板 (UI):
//   侧边栏 CommentPanel:
//     ├── 批注列表 (按创建时间/位置排序)
//     │   ├── 主批注 → 点击跳转到正文位置
//     │   └── 回复线程
//     ├── 新建批注输入框
//     └── 筛选: 全部/未解决/已解决/我的批注
```

## 3. 字体与文本度量体系

**背景**: 当前 `TextMeasurer` 直接使用 Canvas `measureText()` + LRU 缓存。这套方案在以下场景有根本性缺陷：布局抖动（字体未加载完成时测量结果为 fallback 字体尺寸）、跨端排版不一致（不同 OS 的系统字体度量不同）、前后端导出不一致（后端 Java 字体度量 ≠ 浏览器 Canvas 度量）、无字体降级链（生僻字显示方框）。

字体管理层是比 TextMeasurer/LineBreaker/PageBreaker 更底层的 P0 基础设施。缺少这一层，所有上层布局计算都不可靠。

### 3.1 字体加载与管理

```typescript
// ================================================================
// 字体描述符 — 统一标识一个逻辑字体
// ================================================================
interface FontDescriptor {
  /** 字体家族名 (如 'SimSun', 'Arial') */
  family: string
  /** 字重 (400=normal, 700=bold) */
  weight: number
  /** 样式 (normal/italic) */
  style: 'normal' | 'italic'
  /** 字体来源 */
  source: 'system' | 'embedded' | 'url'
  /** 嵌入式字体的 URL (source='url' 时) */
  url?: string
}

// ================================================================
// 字体变体 — 特定 family+weight+style 的加载结果
// ================================================================
interface FontVariant {
  descriptor: FontDescriptor
  /** 是否已加载完成 (FontFace.loaded) */
  loaded: boolean
  /** 字体度量数据 (加载后填充) */
  metrics: FontMetrics | null
}

/** 字体度量 — 与字号无关的通用度量值 */
interface FontMetrics {
  /** 升部 (ascent)，单位: 字体设计单位 (upem=1000) */
  ascent: number
  /** 降部 (descent)，单位: upem */
  descent: number
  /** 行间距 (line gap) */
  lineGap: number
  /** 大写字母高度 */
  capHeight: number
  /** x 高度 */
  xHeight: number
  /** 全角字符宽度 (CJK 特征值) */
  fullWidthAdvance: number
  /** 半角字符宽度 */
  halfWidthAdvance: number
}

// ================================================================
// 字体管理器 — 全局单例
// ================================================================
class FontManager {
  /** 已注册的字体变体 (按 family+weight+style 索引) */
  private variants = new Map<string, FontVariant>()

  /** 字体加载 Promise 缓存 (避免重复加载) */
  private loadingPromises = new Map<string, Promise<FontFace[]>>()

  /** 系统字体列表 (懒加载) */
  private systemFonts: string[] | null = null

  /**
   * 注册嵌入式字体 (CSS @font-face 等价)
   *
   * @returns Promise，在所有字体文件加载完成后 resolve
   */
  async registerFont(descriptor: FontDescriptor): Promise<void> {
    const key = fontKey(descriptor)
    if (this.variants.has(key)) return

    const fontFace = new FontFace(descriptor.family, `url(${descriptor.url})`, {
      weight: String(descriptor.weight),
      style: descriptor.style,
    })
    await fontFace.load()
    document.fonts.add(fontFace)

    this.variants.set(key, {
      descriptor,
      loaded: true,
      metrics: await this.extractMetrics(descriptor.family, descriptor.weight, descriptor.style),
    })
  }

  /**
   * 批量注册 (页面初始化时调用)
   */
  async registerAll(fonts: FontDescriptor[]): Promise<void> {
    // 并行加载，单字体失败不阻塞其他字体
    const results = await Promise.allSettled(fonts.map(f => this.registerFont(f)))
    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length > 0) {
      console.warn(`[FontManager] ${failed.length}/${fonts.length} fonts failed to load`)
    }
  }

  /**
   * 获取字体变体 — 先查已注册，再查系统字体
   */
  getVariant(family: string, weight = 400, style: 'normal' | 'italic' = 'normal'): FontVariant | null {
    const key = fontKey({ family, weight, style, source: 'system' })
    // 1. 已注册的嵌入式字体
    if (this.variants.has(key)) return this.variants.get(key)!
    // 2. 尝试精确匹配 weight
    for (const w of candidateWeights(weight)) {
      const k = fontKey({ family, weight: w, style, source: 'system' })
      if (this.variants.has(k)) return this.variants.get(k)!
    }
    return null
  }

  /** 查询系统可用字体列表 */
  async querySystemFonts(): Promise<string[]> {
    if (this.systemFonts) return this.systemFonts
    // 使用 queryLocalFonts API (Chrome 103+)
    if ('queryLocalFonts' in window) {
      const fonts = await (window as any).queryLocalFonts()
      this.systemFonts = [...new Set(fonts.map((f: any) => f.family))]
    } else {
      // 降级: 常见中文字体列表
      this.systemFonts = ['SimSun', 'SimHei', 'Microsoft YaHei', 'FangSong', 'KaiTi',
                           'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC']
    }
    return this.systemFonts
  }

  /** 确保指定字体已加载 (未加载则等待) */
  async ensureReady(family: string): Promise<FontVariant | null> {
    const variant = this.getVariant(family)
    if (variant?.loaded) return variant
    // 等待 document.fonts.ready
    await document.fonts.ready
    return this.getVariant(family)
  }

  /** 从字体文件中提取精确度量数据 (v19.9: opentype.js 替代 Canvas 启发式估算) */
  private async extractMetrics(family: string, weight: number, style: string): Promise<FontMetrics> {
    // 走 FontMetricsParser —— 解析字体文件 hhea/OS2 表，所有值来自字体文件，零估算
    const fontBuffer = await this.getFontBuffer(family, weight, style)
    return FontMetricsParser.parse(fontBuffer)
  }

  /** 获取已注册字体的 ArrayBuffer (用于 opentype.js 解析) */
  private async getFontBuffer(family: string, weight: number, style: string): Promise<ArrayBuffer> {
    const variant = this.getVariant(family, weight, style)
    if (!variant?.descriptor.url) throw new Error(`Font ${family} has no URL for parsing`)
    const resp = await fetch(variant.descriptor.url)
    return resp.arrayBuffer()
  }
}

// 字体文件缓存: 已解析的 ArrayBuffer 缓存，避免重复 fetch 字体文件
const fontBufferCache = new Map<string, ArrayBuffer>()
```

### 3.1b 字体度量解析器 — FontMetricsParser (v19.9 新增)

**问题**: Canvas API 的 `measureText()` 仅返回 `width`/`fontBoundingBoxAscent`/`fontBoundingBoxDescent`，**不提供 lineGap**。旧版 `extractMetrics()` 设置 `lineGap: 0` 并注释"用 heuristics 估算"——这与 PRD §4.7 铁律"行高唯一来源 = FontMetrics，禁止启发式估算"直接矛盾。医疗打印"0 像素偏移"目标下，lineGap 为零会在 20+ 页文档中累积为跨页断点漂移。

**方案**: 用 opentype.js (前端) / Apache FontBox (后端) 直接解析字体文件二进制表。ascent/descent/lineGap 均定义在 OpenType `hhea` 表(水平排版)中，capHeight/xHeight 在 `OS/2` 表中——这些都是字体设计师设定的固定值，不依赖任何渲染 API。

```typescript
/**
 * FontMetricsParser — 字体度量解析器
 *
 * TS/Java 双实现。对同一 .ttf/.otf 文件输出必须 bit 级一致（纳入黄金测试）。
 * 前端: opentype.js 解析 ArrayBuffer
 * 后端: Apache FontBox 解析同一字体文件
 * 契约: parse(fontBuffer: ArrayBuffer, upem: number): FontMetrics
 */
class FontMetricsParser {
  /**
   * 从字体文件二进制数据中提取度量
   *
   * @param fontBuffer 字体文件的 ArrayBuffer (.ttf / .otf)
   * @returns FontMetrics — 所有值直接来自字体表，零估算
   */
  static parse(fontBuffer: ArrayBuffer): FontMetrics {
    const font = opentype.parse(fontBuffer)

    // hhea 表 — 水平排版的升部/降部/行间距
    const hhea = font.tables.hhea
    const ascent  = hhea.ascender   // 字体设计单位 (upm=1000 或 2048)
    const descent = -hhea.descender // hhea.descender 为负值，取反
    const lineGap = hhea.lineGap

    // OS/2 表 — 大小写高度
    const os2 = font.tables.os2
    const capHeight = os2.sCapHeight
    const xHeight   = os2.sxHeight

    // 全角/半角宽度: 从 glyph 'M' (半角) 和 CJK 全角字符的 advanceWidth 提取
    // 使用 Unicode U+4E2D ('中') 作为 CJK 代表字符
    const unitsPerEm = font.unitsPerEm
    const halfWidthAdvance = font.charToGlyph('M')?.advanceWidth
      ?? font.charToGlyph('a')?.advanceWidth ?? unitsPerEm * 0.5
    const fullWidthAdvance = font.charToGlyph('中')?.advanceWidth
      ?? unitsPerEm  // CJK 全角 ≈ upm

    return {
      ascent,
      descent,
      lineGap,       // 来自字体文件, 非 0, 非启发式
      capHeight,
      xHeight,
      fullWidthAdvance,
      halfWidthAdvance,
    }
  }
}

// Java 端等价实现:
// class FontMetricsParser {
//   static FontMetrics parse(byte[] fontBytes) {
//     TrueTypeFont font = new TrueTypeFont(new RandomAccessReadBuffer(fontBytes));
//     HheaTable hhea = font.getHhea();  // ascent/descent/lineGap
//     Os2Table os2 = font.getOs2();     // capHeight/xHeight
//     return FontMetrics.of(hhea, os2, font.getUnitsPerEm());
//   }
// }

// 黄金测试 (CI 门禁):
//   given: 同一 SimSun.ttf 文件的 ArrayBuffer
//   when:  FontMetricsParser.parse(buffer) 分别在 TS 和 Java 执行
//   then:  { ascent, descent, lineGap, capHeight, xHeight,
//            fullWidthAdvance, halfWidthAdvance }
//          全部 7 个字段逐位相等 (bit-identical)
//   error: 任何字段不一致 → CI 直接失败
```

// 全局单例
const fontManager = new FontManager()
```

### 3.2 增量分页算法 (v19.6 修复)

**问题**: 文本内容变更后全量重分页 O(n)，与 "连续打字 >55fps" 指标直接矛盾。

**方案**: PageStartTable 断点快照 + 逐页早停 + blockIndex 整数二分查找。

```typescript
/**
 * PageStartTable — 每页的断点快照
 * 编辑后从脏区所在页起向后增量重排，每完成一页即与旧表比对 (startBlockId, startLineOffset)，
 * 一致则接续旧表尾部并终止。百页文档单字符编辑的重排范围收敛到 1~2 页。
 */
interface PageStartEntry {
  pageIndex: number
  /** 该页第一个 BlockNode 在 flowBody.children 中的下标 (用于 O(1) 二分定位) */
  blockIndex: number
  /** 该页第一个 BlockNode 的 ID */
  startBlockId: string
  /** 该页第一行的行号 (在 startBlockId 段落内的行偏移, 处理段落跨页断点漂移) */
  startLineOffset: number
  /** 该页的累计内容高度 (用于快速计算后续页面偏移) */
  cumulativeHeight: number
}

class PageStartTable {
  private entries: PageStartEntry[] = []

  /** 全量构建 (v20.1: 单遍累加 O(n), 原 O(n²)) */
  build(pages: SLIFPage[], flowBody: FlowBody): void {
    let runningHeight = 0
    this.entries = pages.map(p => {
      const entry = {
        pageIndex: p.pageIndex,
        blockIndex: flowBody.children.indexOf(p.items[0]?.nodeId ?? flowBody.children[0]),
        startBlockId: p.items[0]?.nodeId ?? "",
        startLineOffset: p.items[0]?.lineOffset ?? 0,
        cumulativeHeight: runningHeight
      }
      runningHeight += p.height
      return entry
    })
  }
   * 增量重分页 — 逐页早停
   *
   * @param dirtyBlockId 脏 BlockNode ID
   * @returns 更新后的 SLIFPage[] + 新的 PageStartTable
   */ // v20.1: pool 参数从外部注入 (修复未声明变量)
  incrementalRepaginate(
    dirtyBlockId: string,
    currentPages: SLIFPage[],
    oldTable: PageStartTable,
    flowBody: FlowBody,
    pageSetup: PageSetup,
  ): { pages: SLIFPage[]; newTable: PageStartTable } {
    // 1. 用 blockIndex (整数) 二分查找脏 BlockNode 所在页
    const dirtyBlockIdx = flowBody.children.indexOf(dirtyBlockId)
    const dirtyPageIndex = this.findPageByBlockIdx(dirtyBlockIdx, oldTable)
    if (dirtyPageIndex < 0) return { pages: currentPages, newTable: oldTable }

    // 2. 从该页断点重新排
    const stableFrom = oldTable.entries[dirtyPageIndex]
    const newPages: SLIFPage[] = currentPages.slice(0, dirtyPageIndex)
    let pageSetupToUse = pageSetup  // 可能被 SectionBreak 覆盖 (§2.7)

    let blockIdx = stableFrom.blockIndex
    let remainingHeight = pageSetupToUse.height - pageSetupToUse.marginTop - pageSetupToUse.marginBottom
    let currentPageItems: SLIFItem[] = []
    let currentPageStartBlockIdx = blockIdx
    let currentPageStartLineOffset = 0

    for (; blockIdx < flowBody.children.length; blockIdx++) {
      const blockId = flowBody.children[blockIdx]
      const block = pool.nodes.get(blockId)!
      if (!block) continue

      // 处理分节符: 切换 pageSetup
      if (block.type === 'section_break') {
        const sb = block as SectionBreak
        // 分节符前的剩余内容形成当前页
        if (currentPageItems.length > 0) {
          newPages.push({ pageIndex: newPages.length, width: pageSetupToUse.width,
                          height: pageSetupToUse.height, items: currentPageItems })
        }
        pageSetupToUse = { ...pageSetup, ...sb.nextPageSetup }
        remainingHeight = pageSetupToUse.height - pageSetupToUse.marginTop - pageSetupToUse.marginBottom
        currentPageItems = []
        currentPageStartBlockIdx = blockIdx + 1
        currentPageStartLineOffset = 0
        continue
      }

      const blockItems = this.layoutBlock(block, pageSetupToUse)
      const blockHeight = this.measureBlockHeight(blockItems)

      // 块级元素超出剩余高度 → 分页
      if (blockHeight > remainingHeight && currentPageItems.length > 0) {
        newPages.push({ pageIndex: newPages.length, width: pageSetupToUse.width,
                        height: pageSetupToUse.height, items: currentPageItems })

        // ---- 逐页早停检查 (v19.6 修正) ----
        const oldEntry = oldTable.entries[newPages.length]
        if (oldEntry) {
          const newStart = newPages[newPages.length - 1].items[0]
          if (newStart &&
              newStart.nodeId === oldEntry.startBlockId &&
              (newStart.lineOffset ?? 0) === oldEntry.startLineOffset) {
            // 断点一致 → 接续旧表尾部，终止重排
            newPages.push(...currentPages.slice(newPages.length))
            return {
              pages: newPages,
              newTable: new PageStartTable() // build 延迟到全量校验时
            }
          }
        }

        // 断点不一致 → 继续重排下一页
        currentPageItems = []
        currentPageStartBlockIdx = blockIdx
        currentPageStartLineOffset = 0
        remainingHeight = pageSetupToUse.height - pageSetupToUse.marginTop - pageSetupToUse.marginBottom

        // 表格跨页: 表头重复
        if (block.type === 'table' && (block as Table).pageBreak?.repeatHeader) {
          // 在新页顶部插入表头行
        }
      }

      currentPageItems.push(...blockItems)
      remainingHeight -= blockHeight
    }
    if (currentPageItems.length > 0) {
      newPages.push({ pageIndex: newPages.length, width: pageSetupToUse.width,
                      height: pageSetupToUse.height, items: currentPageItems })
    }
    return { pages: newPages, newTable: new PageStartTable() }
  }

  /**
   * 按 blockIndex (flowBody.children 中的整数下标) 二分查找所在页
   *
   * v19.6 修正: 旧版用 startBlockId 字符串字典序比较，节点 ID 随机生成（如 para_8f2c），
   * 字典序与文档顺序无关。修正为 flowBody.children.indexOf() 预计算的 blockIndex 整数二分。
   */
  private findPageByBlockIdx(blockIdx: number, table: PageStartTable): number {
    let lo = 0, hi = table.entries.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const entry = table.entries[mid]
      if (entry.blockIndex <= blockIdx) {
        // 检查是否是包含 blockIdx 的最后一页
        const nextEntry = table.entries[mid + 1]
        if (!nextEntry || nextEntry.blockIndex > blockIdx) return mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return 0
  }
}
```

**性能保证**:
- 脏页定位: O(log N) 整数二分（N = 页数）
- 重排范围: 遇到断点一致的页即终止，收敛到 1~2 页
- 早停条件: `(startBlockId, startLineOffset)` 两个键同时匹配才接续旧表
- 100 页文档第 50 页插入 1 字符 → 重排页数 ≤ 2，第 52 页起复用旧布局
### 3.3 行高统一收口

**问题**: TextMeasurer 启发式 (size×1.5/0.8/0.2) 与 FontManager 精确度量 (ascent/descent/lineGap) 并存，必然导致字体加载前后行高跳变。

**方案**: 删除 TextMeasurer 全部启发式方法，行高唯一来源 = FontMetrics。

```typescript
/**
 * LineHeightResolver — 行高计算唯一入口
 *
 * 公式: lineHeight = (fontMetrics.ascent + fontMetrics.descent + fontMetrics.lineGap)
 *                     × (fontSize / upem) × paragraphStyle.lineHeight
 * 其中 upem = 1000 (extractMetrics 中固定)
 *
 * 字体未就绪期间: 禁止进入编辑态 (§3.6 策略)，禁止布局计算。
 * 字体就绪后: 一次性用精确 FontMetrics 重建 PageStartTable (一次性操作，非每帧)。
 */
function resolveLineHeight(node: InlineNode, paragraphStyle: ParagraphStyle, fontMgr: FontManager): number {
  const family = (node as TextNode).font || 'SimSun'
  const size = (node as TextNode).size || 16
  const variant = fontMgr.getVariant(family, (node as TextNode).bold ? 700 : 400)
  if (!variant?.metrics) return size * 1.5  // 最后兜底 (仅无字体信息时)
  const m = variant.metrics
  const base = (m.ascent + m.descent + m.lineGap) * (size / 1000)
  return base * (paragraphStyle.lineHeight ?? 1.0)
}

// TextMeasurer 删除: getLineHeight() / getAscent() / getDescent() (全部启发式)
// TextMeasurer 保留: measureWidth() / measureWidthPrecise() / measureChars()
```

### 3.4 LineBreaker 契约重定义

**问题**: LineElement 类型残留 ModelA 概念 (page_break/separator/control/latex)，与 ModelD 的 InlineNode[] 不兼容。

**方案**: LineBreaker 输入直接使用 ModelD 原生类型。

```typescript
interface LineBreakInput {
  /** 内联节点序列 (TextNode | SmartTextNode | ImageNode) */
  nodes: InlineNode[]
  /** 段落样式 */
  style: ParagraphStyle
}

interface LineBreakOptions {
  maxWidth: number
  wordBreak: 'break-all' | 'break-word' | 'keep-all'
  /** 避头尾字符 (中文排版规范) */
  lineStartForbidden: string   // 不可出现于行首 (如 」、。)
  lineEndForbidden: string     // 不可出现于行尾 (如 「、（)
}

// 删除: LineElement, page_break/separator/control/latex 类型
// page_break → BlockNode 层级的 PageBreakNode 或 ParagraphStyle.pageBreakBefore
// separator   → BlockNode 层级的 SeparatorNode
// control     → SmartTextNode (ModelD 原生)
// latex       → 远期作为 InlineNode 子类型
```

### 3.5 测量缓存与字体检测修正

```typescript
// 缓存键: (char, fontKey) 粒度
// fontKey = `${family}:${weight}:${style}`
// CJK 常用 ~7000 字 × 有限字体组合 → 实际唯一 key 量可控
// 容量: 10000 (而非 2000), LRU 淘汰低频条目

class TextMeasurer {
  private static readonly MAX_CACHE_SIZE = 10000

  measureChars(text: string, config: FontConfig): CharMetrics[] {
    const chars = [...text]
    return chars.map((char, i) => {
      const width = this.measureWidth(char, config)  // 读缓存
      // kerning 仅 Latin 相邻时计算 (CJK 无 kerning)
      const kerning = (i > 0 && isLatin(chars[i-1]) && isLatin(char))
        ? this.measureWidth(chars[i-1] + char, config) - this.measureWidth(chars[i-1], config) - width
        : 0
      return { char, width, kerning }
    })
  }
}

// 缺字检测: 使用 FontFaceSet API (原生、可靠)
function detectMissingGlyphs(text: string, family: string): Set<string> {
  const missing = new Set<string>()
  for (const char of new Set([...text])) {
    if (!document.fonts.check(`12px "${family}"`, char)) {
      missing.add(char)
    }
  }
  return missing
}
// 删除: 基于宽度比较的 hack (w1===0 && w2>0 不可靠)

// 脚本检测: 使用 Unicode Property Escapes (ES2018+)
function detectScript(char: string): UnicodeScript {
  if (/\p{Script=Han}/u.test(char))  return 'Hans'
  if (/\p{Script=Latin}/u.test(char)) return 'Latin'
  if (/\p{Script=Hiragana}/u.test(char) || /\p{Script=Katakana}/u.test(char)) return 'Kana'
  if (/\p{Script=Hangul}/u.test(char)) return 'Hangul'
  return 'Latin'  // 数字/标点/符号默认归 Latin (而非 Hans)
}
// 删除: 手写码点范围表 (0x4E00-0x9FFF 等)
```

### 3.6 字体加载防抖策略

**问题**: 医疗场景排版稳定性要求极高。字体异步加载导致换行/分页偏移属于严重问题。

**规则**:

```typescript
/**
 * 字体加载策略:
 *
 * 1. 核心字体 (SimSun, SimHei) 必须预加载，在 FontManager.registerAll() 中优先注册
 * 2. 编辑器初始化流程:
 *    Editor 构造 → FontManager.ensureReady(['SimSun', 'SimHei']) → 字体就绪
 *    → 展示加载占位 UI (骨架屏/进度条, 不依赖具体字体度量)
 *    → 字体就绪后 → 隐藏占位 → 进入编辑态 → 首次 reLayout
 *
 * 3. 非核心字体 (用户自定义字体) 异步加载，不阻塞编辑态:
 *    加载完成前 → 使用 fallback 字体度量 (FontFallback 降级链)
 *    加载完成后 → 仅重绘受影响区域 (DirtyTracker 标记该字体对应的所有文本)
 *
 * 4. 字体加载失败 → 降级到系统默认字体 + console.warn + 上报 font_error
 *    不阻塞编辑，但状态栏显示 "部分字体未加载"
 *
 * 5. 禁止行为:
 *    - 字体未就绪时进入编辑态 (用户输入后全文重排 → 严重 UX 问题)
 *    - 字体加载完成后全量 reLayout (应仅标记该字体对应的内容为脏)
 */
```

## 4. 运行时状态与编辑器模式

### 4.1 EditorRuntimeState — 运行时状态模型

**问题**: 光标、选区、视图模式、IME 临时状态、滚动位置等运行时数据当前散落在 `Draw.ts` 的私有字段中，与持久化的 `DocumentTree` 混杂。

**方案**: 将运行时状态标准化为独立的 `EditorRuntimeState` 结构，与 `DocumentTree` 并列为 Editor 的两大数据源。

```typescript
// ================================================================
// 运行时状态 — 不持久化、不参与协作同步、仅在前端内存中
// ================================================================
interface EditorRuntimeState {
  // ---- 光标 (标准化) ----
  cursor: CursorState

  // ---- 选区 (标准化) ----
  selection: SelectionState

  // ---- 视图 ----
  view: ViewState

  // ---- IME ----
  ime: IMEState

  // ---- Undo/Redo (由 CommandManager 管理) ----
  history: HistoryState
}

// ================================================================
// 光标 — 统一两层位置模型
// ================================================================
interface CursorState {
  /**
   * 段落定位: ID 链路路径
   * 格式: [documentRootId, regionRootId, ..., paragraphId]  (v20.23: 补区域根)
   *
   * 区域根是路径第二段的语义锚点:
   *   正文段落:   [docId, bodyRootId, ..., paragraphId]
   *   页眉段落:   [docId, headerRootId, ..., paragraphId]
   *   页脚段落:   [docId, footerRootId, ..., paragraphId]
   *   脚注编辑区: [docId, footnoteRootId, ..., paragraphId] (footnoteRootId = FootnoteContent 所在区域的根)
   *
   * 示例:
   *   ['doc_1', 'body_root', 'para_3']        — 正文第 3 段
   *   ['doc_1', 'header_root', 'para_h1']     — 页眉内段落
   *   ['doc_1', 'footnote_fc01', 'tn_02']     — 脚注内容中的 TextNode
   *
   * bodyRootId/headerRootId/footerRootId 来自 DocumentTree 各区域根节点 ID
   */
  paragraphPath: string[]

  /**
   * 字符偏移: 在该段落全部可见文本中的 UTF-16 码元偏移 (0..totalTextLength)
   *
   * 单一语义，不与节点类型耦合:
   *   - Run 模型下，一个 Paragraph 可能只有 1 个 TextNode 承载全文
   *   - offset 始终是"用户看到的光标在第几个字符后"，不是 children 数组下标
   *   - 内部由 NodePool.resolveCharOffset() 转换为 (textNodeId, localOffset)
   *
   * Surrogate pair 处理: offset 按 UTF-16 码元计数 (与 JS string.length 一致)
   */
  offset: number

  visible: boolean
}

// resolveCharOffset/getCharOffset (v20.21) — 权威定义已合入 §2.1 NodePool, 此处仅引用
// 见 §2.1 NodePool 类定义

interface SelectionState {
  /** 选区起点 */
  anchor: CursorState
  /** 选区终点 (光标位置) */
  focus: CursorState
  /** 是否正在拖拽选区 */
  active: boolean
}

// 选区判断工具:
function isCollapsed(sel: SelectionState): boolean {
  return sel.anchor.paragraphPath.join('.') === sel.focus.paragraphPath.join('.')
      && sel.anchor.offset === sel.focus.offset
}
function getSelectedRange(sel: SelectionState): { start: CursorState; end: CursorState } {
  // 比较 anchor 和 focus 的先后顺序
}

// ================================================================
// 视图状态
// ================================================================
interface ViewState {
  /** 编辑器模式 */
  mode: EditorMode

  /** 页面模式 */
  pageMode: PageMode

  /** 缩放比例 (0.25 .. 4.0) */
  scale: number

  /** 滚动位置 (文档坐标系的像素偏移) */
  scroll: { x: number; y: number }

  /** 当前可见的页面索引范围 (用于虚拟滚动) */
  visiblePages: { start: number; end: number }
}

// ================================================================
// IME 输入法临时状态
// ================================================================
interface IMEState {
  /** 是否处于组合输入中 */
  composing: boolean

  /** 组合中的临时文本 (拼音/笔画未确认态) */
  compositionText: string

  /** 组合文本的插入位置路径 */
  compositionAnchor: CursorState
}

// ================================================================
// 历史记录状态
// ================================================================
interface HistoryState {
  /** 是否可以撤销 */
  canUndo: boolean
  /** 是否可以重做 */
  canRedo: boolean
  /** 当前历史栈深度 */
  undoDepth: number
  /** 当前重做栈深度 */
  redoDepth: number
}
```

#### EditorRuntimeState 生命周期

```
初始化
  Editor(container, doc) → 创建默认 EditorRuntimeState
    cursor: 文档起始位置
    selection: { active: false }
    view: { mode: 'edit', pageMode: 'paging', scale: 1, scroll: {0,0} }
    ime: { composing: false }

每次编辑操作
  Command.execute() → 更新 DocumentTree + 返回 StatePatch
  StatePatch 合并到 EditorRuntimeState (cursor/selection/history 更新)

每次渲染
  Draw.render(document, state) → 使用 state 决定光标位置/选区高亮/IME 预览

销毁
  Editor.destroy() → state 丢弃 (不持久化)
```

#### EditorRuntimeState 与 Zustand 的关系

```typescript
// Zustand store 持有 EditorRuntimeState 的可观察引用
// React UI 组件 (Toolbar/StatusBar) 订阅 state 变化
interface EditorStoreState {
  document: DocumentTree | null       // 持久化数据
  runtime: EditorRuntimeState         // 运行时数据 (不持久化)
  isDirty: boolean
  saveStatus: SaveStatus
}
```

### 4.2 编辑器模式

```typescript
enum EditorMode {
  EDIT     = 'edit',      // 标准编辑 — 所有节点按权限规则判断可编辑性
  READONLY = 'readonly',  // 只读 — 全局不可编辑，仅滚动/缩放/选区复制
  FORM     = 'form',      // 表单 — 仅 SmartTextNode 可编辑，TextNode 只读
  DESIGN   = 'design',    // 模板设计 — 忽略节点只读限制，所有区域可编辑
  CLEAN    = 'clean',     // 清洁模式 — 隐藏留痕标记，其他同 READONLY
  PRINT    = 'print',     // 打印预览 — 不可编辑，显示分页/页眉页脚/水印
}

enum PageMode {
  PAGING  = 'paging',   // 分页视图 (A4 纸张模拟, 默认)
  LINKAGE = 'linkage',  // 连续滚动 (不分页, 长文档模式)
}
```

### 4.3 StatePatch 与失效传播

```typescript
/** 变更影响范围 — 由 Command.forward() 返回 */
type InvalidationScope =
  | 'none'                          // 无影响 (如缩放)
  | 'node'                          // 仅该节点 (样式变更)
  | 'paragraph'                     // 该段落 (文本内容变更)
  | 'paragraph_and_downstream'      // 该段落 + 后续偏移 (行高变化)
  | 'block'                         // 该块级元素
  | 'flowbody'                      // 所在 FlowBody (块级插入/删除)
  | 'table'                         // 表格结构变更
  | 'page_setup'                    // 全文档 (页面设置变更)
  | 'full'                          // 全量失效 (兜底)

interface StatePatch {
  cursor?: Partial<CursorState>
  selection?: Partial<SelectionState>
  /** 命令执行后返回的布局失效范围 */
  invalidation?: InvalidationScope
}
```

## 5. 权限与安全模型

### 5.1 权限优先级规则

**问题**: `SmartTextNode.element.readonly` (节点级) 和 `EditorMode` (全局级) 叠加时，无明确优先级规则。

**规则**:

```
编辑权限 = 全局模式权限 AND 节点级权限
删除权限 = 编辑权限 AND NOT 节点标记为不可删除

保护层级 (低 → 高):
  L0: 无保护 — 自由编辑、自由删除
  L1: EditorMode 模式 — 控制全局编辑开关
  L2: BaseNode.metadata.locked — 段落/表格内容锁定 (不可修改内容, 可删除)
  L3: SmartTextNode.element.readonly — 字段级只读 (不可修改, 可删除)
  L4: BaseNode.metadata.undeletable — 节点不可删除 (内容可编辑, 结构不可删)
  L5: locked + undeletable 叠加 — 完全冻结 (不可编辑 + 不可删除)
  L6: 修订权限 (IRevision) — 高权限用户可修改低权限用户的留痕内容

叠加规则:
  1. EditorMode.READONLY → 全局只读，忽略所有节点权限
  2. EditorMode.FORM → 仅 SmartTextNode 可编辑 (TextNode 只读)
  3. EditorMode.DESIGN → 忽略 L2/L3/L4 节点权限 (设计模式)
  4. EditorMode.EDIT → 遵循 L2-L4 节点权限
  5. L2 (段落锁定) → 该段落内所有 InlineNode 不可编辑
  6. L3 (字段只读) → 该 SmartTextNode 不可编辑
  7. L4 (不可删除) → Delete/Backspace 跳过该节点；Cut/拖拽删除 被阻止
  8. L5 (完全冻结) → 不可编辑 + 不可删除 (如模板固定标题行)
  9. L6 (修订权限) → revision.level < currentUser.level 时内容不可修改

模板场景示例:
  入院记录模板:
    "主诉" 段落标签    → { undeletable: true }           (L4, 结构不可删)
    "主诉内容" 字段    → SmartTextNode { required: true } (可编辑, 可删除重新插入)
    医院 Logo 图片     → { locked: true, undeletable: true } (L5, 完全冻结)
```

### 5.2 编辑/删除权限判定函数

```typescript
/**
 * 判断给定节点是否可删除
 */
function isDeletable(node: BaseNode, mode: EditorMode): boolean {
  if (mode === 'readonly' || mode === 'print') return false
  if (mode === 'design') return true
  if (node.metadata?.undeletable === true) return false
  return true
}

/**
 * 判断给定节点是否可编辑
 */
function isEditable(
  node: BaseNode,
  mode: EditorMode,
  userLevel: number,
): boolean {
  if (mode === 'readonly' || mode === 'print') return false
  if (mode === 'design') return true
  if (node.metadata?.locked === true) return false          // L2
  if (isSmartTextNode(node) && node.element.readonly === true) return false  // L3
  // L4 (undeletable) 不影响编辑, 只影响删除
  if (mode === 'form') return isSmartTextNode(node)
  return mode === 'edit'
}
```

### 5.3 脱敏渲染与权限联动

脱敏渲染链路详见 §2.3。脱敏字段的可见性由 `userLevel` 控制，与 `EditorSecurityConfig.data` 权限联动 —— 当 `allowCopy=false` 时，脱敏字段在剪贴板中直接替换为 maskChar。

## 6. Command 命令体系

核心设计决策:

1. **Run 模型**: TextNode.text 存连续同样式文本（非单字符），InsertTextCommand 做字符串插入 + 相邻同样式合并
2. **invert 契约**: `invert(document: DocumentTree): ICommand` — 传入当前文档现场，不依赖实例状态
3. **不可变**: MergeableCommand.merge() 返回新命令，不 mutate 入栈命令
4. **合并 vs 事务边界**: 500ms 自动合并仅 InsertTextCommand/DeleteRangeCommand；事务 API 仅 UI 宏操作
5. **旧栈废弃**: UndoRedoStack（快照版）@deprecated，Ctrl+Z 由 CommandManager 仲裁
6. **位置分层契约 (v19.4)**: Command 对外签名统一为 `(paragraphPath: string[], charOffset: number)`——字符级偏移。`forward()` 内部第一步强制经 `pool.resolveCharOffset()` 落到 `(textNodeId, localOffset)`，所有树操作只作用于解析后的节点级坐标。**数组下标只允许存在于 forward/invert 函数体内部，禁止出现在任何接口签名、构造函数参数、serialize() 载荷中**。违反此规则的代码在 Run 模型下必然越界。

### 6.1 命令接口 — CommandContext 联合上下文 (v20.8)

**问题**: Phase 1 的 `forward(doc, pool)` 与 Phase 2 的 `forward(ydoc, origin)` 签名互斥，所有 Command 实现类在切换时需全部重写。这正是要规避的大规模重构。

**方案**: 从 Phase 1 起就使用 `CommandContext` 联合类型。Command 实现类处理两态分支，Phase 1→2 切换时**接口签名不变，CommandManager 切换注入的 context**。

```typescript
/** 命令执行上下文 — Phase 1 单用户 vs Phase 2 CRDT 的统一入口 */
type CommandContext =
  | { mode: 'local'; doc: DocumentTree; pool: NodePool }     // Phase 1
  | { mode: 'collab'; ydoc: Y.Doc; origin: string }          // Phase 2

interface ICommand {
  readonly type: string; readonly id: string
  readonly timestamp: number; readonly author: string

  /** 统一入口 — 根据 context.mode 分发到 local/collab 实现 */
  forward(ctx: CommandContext): StatePatch | null

  /** 仅在 local 模式有效 — collab 模式下 Y.UndoManager 接管撤销 */
  invert?(ctx: CommandContext): ICommand  // optional: collab 模式返回 null

  serialize(): SerializedCommand
}

// Phase 1 调用: command.forward({ mode: 'local', doc, pool })
// Phase 2 调用: command.forward({ mode: 'collab', ydoc, origin: localUserId })
// 重写成本: CommandManager 一处切换 context, Command 实现类不变
```

**Command 实现类两态分支示例**:

```typescript
class InsertTextCommand extends PositionalCommand {
  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode === 'local') {
      // Phase 1: 操作 DocumentTree + NodePool
      const { doc, pool } = ctx
      // ... 现有 local 实现 ...
    } else {
      // Phase 2: 操作 Y.Doc
      const { ydoc, origin } = ctx
      ydoc.transact(() => {
        // ... Y.Doc 操作 ...
      }, origin)
    }
  }
}
```

**重写成本估算 (v20.8 坦诚)**:

| 阶段切换 | 修改范围 | 成本 |
|----------|----------|------|
| CommandManager | 1 处: 注入 context 从 local → collab | O(1) |
| Command 实现类 | ~8 个类: 每个增加 `if (ctx.mode === 'collab')` 分支 | O(n) per class |
| invert() | collab 模式返回 null, Y.UndoManager 接管 | 删除调用点 |
| 总成本 | 不可为零, 但**接口签名稳定**——不强制在 Phase 1 时预先编写 collab 分支 | 可接受 |

#### ICommand 生命周期与不可变契约 (v20.9)

**问题**: `DeleteRangeCommand.deletedText` / `FormatTextCommand.oldStyles` 是 `forward()` 执行时填充的实例字段。`invert()` 依赖"同一实例先 forward 后 invert"。但 ICommand 同时又声明为"不可变纯数据"——实例字段在 forward 前后状态不同。

**澄清**: "不可变"指**命令入栈后**（`forward()` 执行完成并将 snapshot 写入实例字段后，这些字段即为 frozen）。`serialize()` 将这些 snapshot 嵌入载荷，`deserialize()` 从载荷恢复 snapshot，使 invert 可以脱离 forward 时序。

```typescript
interface ICommand {
  // ... 基本字段

  /** 执行操作并填充内部快照 (deletedText/oldStyles 等).
   *  调用后实例字段 frozen, 不可再次 forward. */
  forward(ctx: CommandContext): StatePatch | null

  /** 从 forward 后的快照构造逆操作.
   *  前置条件: forward() 已在此实例上调用, 或使用 deserialize() 从载荷恢复. */
  invert?(ctx: CommandContext): ICommand

  /** 序列化为传输载荷 (含快照: deletedText/oldStyles 等) */
  serialize(): SerializedCommand

  /** 从序列化载荷恢复命令 (含快照, 可直接 invert, 不依赖 forward 时序).
   *  每个 Command 子类必须实现自己的静态工厂. */
  static deserialize(data: SerializedCommand): ICommand
}

// 使用模式:
//   A. 运行时 undo: cmd.forward(ctx) → undoStack.push(cmd) → cmd.invert(ctx)
//      (同一实例, forward 填充快照 → invert 读取快照)
//   B. 协作重放: serialized = cmd.serialize() → 发送到远端 →
//      remoteCmd = InsertTextCommand.deserialize(serialized) →
//      remoteCmd.invert(ctx)  // 从载荷恢复, 无需 forward()
//   C. 文档比较: savedCmd = deserialize(loadedSerialized) →
//      savedCmd.invert(ctx)  // 从历史记录恢复逆操作
```

**"不可变纯数据"的生命周期**:
`构造函数` → 纯参数入栈 | `forward()` → 填充快照 (一次写入) | frozen → `serialize()` 读取 | `deserialize()` 从载荷恢复 (纯数据重建)

### 6.2 Run 模型文本存储 — 字符偏移语义修正 (v19.4)

**关键约定**: `CursorState.offset` / `InsertTextCommand.offset` / `DeleteRangeCommand.startOffset/endOffset` **统一为段落内可见文本的 UTF-16 字符偏移**。所有 Command 必须通过 `pool.resolveCharOffset(paragraphId, offset)` 将字符偏移转换为 `(textNodeId, localOffset)` 后再操作节点。**严禁**将 offset 直接作为 `para.children` 数组下标——Run 模型下一个 Paragraph 可能只有 1 个 TextNode 承载全文，offset=50 时 `para.children[49]` 必然越界。

```typescript
// TextNode.text 存储连续同样式文本（非单字符）
// 文档 "Hello World"（均为默认样式）→ 1 个 TextNode { text: "Hello World" }
// 文档 "Hello **World**"（World 加粗）→ 2 个 TextNode: { text: "Hello " }, { text: "World", bold: true }

class InsertTextCommand extends PositionalCommand {
  readonly type = 'insert-text'

  forward(ctx: CommandContext): StatePatch {  // v20.8: 统一签名
    if (ctx.mode !== 'local') return null     // collab 分支在 Phase 2 实现
    const { doc, pool } = ctx
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph
    if (!para) return null

    // Step 1: 字符偏移 → (textNodeId, localOffset)
    const resolved = pool.resolveCharOffset(para.id, this.offset)
    const textNodeId = resolved?.textNodeId ?? null
    const localOffset = resolved?.localOffset ?? 0
    const style = this.style ?? { font: 'SimSun', size: 16 }

    // Step 2: 定位 TextNode，在文本层面做插入/拆分
    if (textNodeId) {
      const textNode = pool.nodes.get(textNodeId) as TextNode
      if (textNode && sameStyle(textNode, style)) {
        // 样式一致 → 在 localOffset 处直接插入字符串
        const newText = textNode.text.slice(0, localOffset) + this.text + textNode.text.slice(localOffset)
        pool.updateNode(textNode.id, { text: newText })
        normalizeParagraph(para, pool)  // 合并相邻同样式 TextNode
        return { cursor: { paragraphPath: this.path, offset: this.offset + [...this.text].length } }
      }
      // 样式不同 → 拆分 TextNode + 插入新 TextNode
      const before = textNode.text.slice(0, localOffset)
      const after = textNode.text.slice(localOffset)
      pool.updateNode(textNode.id, { text: before || '' })
      const newNode = createTextNode(this.text, style)
      pool.nodes.set(newNode.id, newNode)
      const idx = para.children.indexOf(textNodeId)
      pool.insertChild(para.id, newNode.id, idx + 1)
      if (after) {
        const afterNode = createTextNode(after, extractStyle(textNode))
        pool.nodes.set(afterNode.id, afterNode)
        pool.insertChild(para.id, afterNode.id, idx + 2)
      }
    } else {
      // offset=0 或空段落 → 在 para.children 头部插入
      const newNode = createTextNode(this.text, style)
      pool.nodes.set(newNode.id, newNode)
      pool.insertChild(para.id, newNode.id, 0)
    }
    normalizeParagraph(para, pool)
    return { cursor: { paragraphPath: this.path, offset: this.offset + [...this.text].length } }
  }

  invert?(ctx: CommandContext): ICommand | null {
    return new DeleteRangeCommand(generateId(), Date.now(), this.author,
      this.path, this.offset, this.offset + [...this.text].length)
  }
  serialize(): SerializedCommand {
    return { type: 'insert-text', id: this.id, timestamp: this.timestamp, author: this.author,
             path: this.path, offset: this.offset, text: this.text, style: this.style }
  }
}

function extractStyle(node: TextNode): TextStyle {
  return { font: node.font, size: node.size, bold: node.bold, italic: node.italic,
           color: node.color, underline: node.underline, strikeout: node.strikeout }
}
function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return a.font === b.font && a.size === b.size && a.bold === b.bold && a.italic === b.italic
      && a.color === b.color && a.underline === b.underline && a.strikeout === b.strikeout
}
function normalizeParagraph(para: Paragraph, pool: NodePool): void {
  // Step 1: 单遍扫描构建合并后的 children (不边遍历边改数组)
  const merged: string[] = []
  const orphans: string[] = []
  let prev: TextNode | null = null

  for (const childId of para.children) {
    const node = pool.nodes.get(childId)
    if (node?.type === 'text' && prev && sameStyle(prev, node as TextNode)) {
      // 当前 TextNode 与上一个样式相同 → 合并文本到 prev, 标记当前为孤儿
      pool.updateNode(prev.id, { text: prev.text + (node as TextNode).text })
      orphans.push(childId)
      // prev 不变 (合并后 prev 仍是连续同样式的最后一个)
    } else {
      merged.push(childId)
      prev = node?.type === 'text' ? node as TextNode : null
    }
  }

  // Step 2: 原子替换 children (无索引错乱)
  ;(para as any).children = merged

  // Step 3: 批量回收孤儿节点 (走公共方法 removeOrphanLeaf, v20.30 修破窗)
  for (const id of orphans) {
    pool.removeOrphanLeaf(id)
  }
}
// 复杂度: O(n) 单遍扫描, 无 splice/indexOf
// 正确性: merged[] 构建过程中不修改 para.children, 无跳过元素问题
```
### 6.3 invert 契约修正 — 字符偏移语义修正 (v19.4)

```typescript
class DeleteRangeCommand extends PositionalCommand {
  readonly type = 'delete-range'

  forward(ctx: CommandContext): StatePatch {
    if (ctx.mode !== 'local') return null
    const { doc, pool } = ctx
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph
    if (!para) return null

    // Step 1: 字符偏移 → (textNodeId, localOffset) 解析
    const start = pool.resolveCharOffset(para.id, this.startOffset)
    const end = pool.resolveCharOffset(para.id, this.endOffset)
    if (!start || !end) return null

    // Step 2: 提取被删文本 (用于 serialize 内嵌和 invert 恢复)
    let deletedText = ''
    if (start.textNodeId === end.textNodeId) {
      // 单 TextNode 内删除
      const node = pool.nodes.get(start.textNodeId) as TextNode
      deletedText = node.text.slice(start.localOffset, end.localOffset)
      const newText = node.text.slice(0, start.localOffset) + node.text.slice(end.localOffset)
      if (newText) {
        pool.updateNode(node.id, { text: newText })
      } else {
        // 文本全删 → 移除 TextNode
        pool.removeChild(para.id, para.children.indexOf(start.textNodeId))
      }
    } else {
      // 跨 TextNode 删除 — 遍历 children 按字符偏移确定起止边界
      let offset = 0
      const toRemove: string[] = []
      for (const childId of para.children) {
        const node = pool.nodes.get(childId)
        const len = node?.type === 'text' ? (node as TextNode).text.length : 1
        const nodeEnd = offset + len
        if (nodeEnd <= this.startOffset) { offset = nodeEnd; continue }      // 未到达范围
        if (offset >= this.endOffset) break                                   // 已超出范围

        if (node?.type === 'text') {
          const localStart = Math.max(0, this.startOffset - offset)
          const localEnd = Math.min(len, this.endOffset - offset)
          if (localStart === 0 && localEnd === len) {
            // 全节点在范围内 → 整节点删除
            deletedText += (node as TextNode).text
            toRemove.push(childId)
          } else {
            // 部分在范围内 → 截断文本
            const t = (node as TextNode).text
            deletedText += t.slice(localStart, localEnd)
            const newText = t.slice(0, localStart) + t.slice(localEnd)
            pool.updateNode(node.id, { text: newText })
          }
          offset = nodeEnd
        } else {
          // 非文本节点 (ImageNode/SmartTextNode 等) → 占 1 个字符位置
          if (offset >= this.startOffset) { deletedText += '\uFFFD'; toRemove.push(childId) }
          offset = nodeEnd
        }
      }
      for (const id of toRemove) pool.removeChild(para.id, para.children.indexOf(id))
    }

    // Step 3: 删除后合并相邻同样式 TextNode
    normalizeParagraph(para, pool)
    // 返回 StatePatch — offset 保持字符语义
    return { cursor: { paragraphPath: this.path, offset: this.startOffset } }
  }

  invert?(ctx: CommandContext): ICommand | null {
    // 逆操作: 在 startOffset (字符偏移) 处插入被删文本
    return new InsertTextCommand(generateId(), Date.now(), this.author, this.path, this.startOffset, this.deletedText)
  }

  serialize(): SerializedCommand {
    return { type: 'delete-range', id: this.id, timestamp: this.timestamp, author: this.author,
             path: this.path, startOffset: this.startOffset, endOffset: this.endOffset,
             deletedText: this.deletedText }  // 内嵌被删文本，协作端可重放
  }
}
```
### 6.3b 样式命令的 invert — 样式快照式 (v19.14 补充)

**问题**: InsertTextCommand 的 invert 内嵌 `this.text`、DeleteRangeCommand 内嵌 `this.deletedText`——文本编辑的 invert 是闭环的。但 FormatTextCommand 和 FormatPainterCommand 没有 invert 设计：涂抹前目标节点的旧样式如何入栈撤销？

**方案**: 样式命令的 forward() 在修改前先提取目标节点旧样式快照，内嵌在 serialize() 中。invert() 将旧样式作为逆操作的参数恢复。

```typescript
class FormatTextCommand extends PositionalCommand {
  readonly type = 'format-text'
  private oldStyles: Map<string, Partial<TextStyle>> = new Map()  // nodeId → 旧样式快照

  forward(ctx: CommandContext): StatePatch {
    for (const nodeId of this.nodeIds) {
      const node = pool.nodes.get(nodeId) as TextNode | null
      if (!node) continue
      // Step 1: 快照旧样式 (撤销所需)
      this.oldStyles.set(nodeId, extractStyle(node))
      // Step 2: 应用新样式 (merge 模式——只覆盖传入了的字段, 保留未传入字段)
      const merged = { ...extractStyle(node), ...this.changes }
      pool.updateNode(nodeId, merged)
      pool.bumpNodeVersion(nodeId)
    }
    return { invalidation: 'node' }  // 仅样式变更, 不影响布局/分页
  }

  invert?(ctx: CommandContext): ICommand | null {
    // 逆操作: 将每个节点的样式恢复为旧值
    return new FormatTextCommand(generateId(), Date.now(), this.author,
      this.nodeIds,
      Object.fromEntries(this.oldStyles)  // 旧样式作为逆操作的 changes
    )
  }

  serialize(): SerializedCommand {
    return { type: 'format-text', id: this.id, timestamp: this.timestamp,
             author: this.author, nodeIds: this.nodeIds, changes: this.changes,
             oldStyles: Object.fromEntries(this.oldStyles) }  // 内嵌旧样式快照
  }
}

class FormatPainterCommand extends PositionalCommand {
  readonly type = 'format-painter'
  private oldStyles: Map<string, Partial<TextStyle>> = new Map()

  forward(ctx: CommandContext): StatePatch {
    for (const nodeId of this.targetNodeIds) {
      const node = pool.nodes.get(nodeId) as TextNode | null
      if (!node) continue
      this.oldStyles.set(nodeId, extractStyle(node))
      pool.updateNode(nodeId, { ...this.sourceStyle })  // 直接覆写为目标样式
      pool.bumpNodeVersion(nodeId)
    }
    return { invalidation: 'node' }
  }

  invert?(ctx: CommandContext): ICommand | null {
    return new FormatTextCommand(generateId(), Date.now(), this.author,
      this.targetNodeIds, Object.fromEntries(this.oldStyles))
  }

  serialize(): SerializedCommand {
    return { type: 'format-painter', id: this.id, timestamp: this.timestamp,
             author: this.author, targetNodeIds: this.targetNodeIds,
             sourceStyle: this.sourceStyle,
             oldStyles: Object.fromEntries(this.oldStyles) }
  }
}

// ClearFormatCommand (格式清除, PRD F1.11): 本质是 FormatTextCommand 的特化
// changes = { font: undefined, size: undefined, bold: false, italic: false,
//             underline: false, strikeout: false, color: undefined, highlight: undefined }
// invert 恢复旧样式，与 FormatTextCommand 复用同一 invert 逻辑
```

**撤销闭环完整性 (v19.14)**:

| 命令 | forward 内嵌数据 | invert 策略 |
|------|-----------------|-------------|
| InsertTextCommand | `this.text` (插入的文本) | 删除插入范围 → DeleteRangeCommand |
| DeleteRangeCommand | `this.deletedText` (被删文本) | 插入被删文本 → InsertTextCommand |
| **FormatTextCommand** | `this.oldStyles` (旧样式快照) | 恢复旧样式 → FormatTextCommand(oldStyles as changes) |
| **FormatPainterCommand** | `this.oldStyles` (旧样式快照) | 恢复旧样式 → FormatTextCommand |
| MacroCommand | 子命令各自的载荷 | 子命令逆序 + 各自 invert |

### 6.4 合并与事务边界

```typescript
// 合并: 仅 InsertTextCommand/DeleteRangeCommand，500ms 窗口
// 事务: 仅 UI 宏操作 (替换全部/批量格式刷)，显式 beginTransaction/commitTransaction
// 两套机制不重叠

interface MergeableCommand extends ICommand {
  /** 返回新命令（不可变），不修改 this */
  canMergeWith(other: ICommand): boolean
  mergeWith(other: ICommand): ICommand
}

class CommandUndoRedoStack {
  private undoStack: ICommand[] = []
  private readonly MERGE_WINDOW_MS = 500

  execute(command: ICommand, ctx: CommandContext): StatePatch | null {
    // Step 1: 先执行 forward (若抛异常, 栈不受影响)
    const patch = command.forward(ctx)
    if (!patch) return null  // forward 失败, 不入栈

    // Step 2: forward 成功后入栈
    const last = this.undoStack[this.undoStack.length - 1]
    if (last && this.canMerge(last, command)) {
      const merged = (last as MergeableCommand).mergeWith(command)
      this.undoStack[this.undoStack.length - 1] = merged
    } else {
      this.undoStack.push(command)
    }
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift()
    this.redoStack = []
    return patch
  }

  private canMerge(last: ICommand, next: ICommand): boolean {
    if (last.type !== next.type) return false
    if (last.author !== next.author) return false
    if (next.timestamp - last.timestamp > this.MERGE_WINDOW_MS) return false
    if (!('canMergeWith' in last)) return false
    return (last as MergeableCommand).canMergeWith(next)
  }
}
```

### 6.5 Command 子系统类图

```
┌──────────────────────────────────────────────────────────┐
│                       IEditor                             │
│  execCommand(cmd: ICommand): void                         │
│  undo(): void   redo(): void                              │
│  canUndo(): boolean  canRedo(): boolean                   │
└──────────┬───────────────────────────────────────────────┘
           │ 持有
           ▼
┌──────────────────────────────────────────────────────────┐
│                    CommandManager                         │
│  - undoStack: CommandUndoRedoStack   (唯一历史栈)         │
│  - dirtyTracker: DirtyTracker                             │
│  - eventBus: EventBus                                     │
│                                                           │
│  execute(cmd): StatePatch | null                          │
│    → cmd.forward({ mode: "local", doc, pool })            │
│    → undoStack.execute(cmd)                               │
│    → dispatchInvalidation(patch.invalidation)  ← v20.22   │
│    → eventBus.emit('document:changed',                    │
│        { invalidation: patch.invalidation,                 │
│          dirtyNodeIds: dirtyTracker.queryDirtyNodes() })   │
│  undo(): void                                             │
│    → undoStack.undo(doc, pool)  // 走新栈                  │
│    → eventBus.emit('render:request')                      │
│  redo(): void  // 同上                                    │
└──────────────────────────────────────────────────────────┘

// dispatchInvalidation (v20.22 强制映射):
//   'node'           → dirtyTracker.markSmartTextDirty(nodeId)
//   'paragraph'      → dirtyTracker.markParagraphDirty(paraId)
//   'paragraph_and_downstream' → markParagraphDirty + markRectDirty(后续)
//   'flowbody'|'table'|'page_setup'|'full' → dirtyTracker.markFullLayout()
//   详见 §7.3 InvalidationScope → 动作映射表

// ================================================================
// 四条流水线汇合时序图 (v20.34, 修复 P1-1)
// ================================================================
//
// CommandManager.execute(cmd)
//   │
//   ├─→ cmd.forward(ctx) → StatePatch { cursor?, selection?, invalidation }
//   │
//   ├─→ dispatchInvalidation(invalidation)
//   │     ├─ 'node'   → dirtyTracker.markSmartTextDirty
//   │     ├─ 'paragraph' → dirtyTracker.markParagraphDirty
//   │     └─ 'flowbody'|'full' → dirtyTracker.markFullLayout
//   │
//   ├─→ eventBus.emit('document:changed', { invalidation, dirtyNodeIds })
//   │     │
//   │     ├─→ AutoSaveManager.onContentChanged()
//   │     │     读取 CommandManager.getDocument() 获取最新 DocumentTree 快照
//   │     │     → debounce 3s → PUT /api/v1/documents/{id}
//   │     │     SaveStatus 状态机: debounce→saving→saved|error|conflict
//   │     │
//   │     ├─→ QCEngine.scheduleCheck(pool, dirtyTracker.queryDirtySmartTextNodes())
//   │     │     → debounce 1s → check() → QCResult → emit 'qc:completed'
//   │     │
//   │     └─→ LayoutEngine (via 'document:changed' listener)
//   │           → 读取 DirtyTracker → incrementalLayout → SLIFPage[]
//   │
//   └─→ eventBus.emit('state:changed', patch)
//         │
//         └─→ EditorProvider (React 桥, §20.2)
//               → Zustand store.runtime = { ...store.runtime, ...patch }
//               → React re-render (Toolbar/StatusBar)
//
// AutoSaveManager 通过 CommandManager.getDocument() 获取 document,
// 不再依赖 event 载荷传输完整 DocumentTree (修复 P1-1 链断裂).
// ================================================================
    ▼             ▼
  Handler 构造命令   EventBus 通知 Draw 重绘
  (不触碰栈)        (不触碰栈)

// 旧快照栈: @deprecated, 仅迁移期兜底

// ================================================================
// v19.7: Ctrl+Z 双阶段策略
// ================================================================
// Phase 1 (MVP — 单用户):
//   Ctrl+Z → CommandManager.undo() → CommandUndoRedoStack.undo() (旧栈)
//
// Phase 2 (协作上线):
//   Y.Doc 激活 → Y.UndoManager 接管 Ctrl+Z
//   CommandUndoRedoStack 设为 readonly (不再入栈，只读历史)
//   ICommand.invert() 标记 @deprecated 并从接口中移除
//   详见 §13.3
// ================================================================
```

### 6.6 核心段落编辑命令 (v20.18)

**问题**: 回车拆段、退格并段、跨段删除是最高频编辑操作，但 §6 只有单段落内 Insert/Delete/Format。日常编辑核心命令完全缺失。

```typescript
/** 拆分段落 (Enter 键) — 在光标处将当前段落一分为二 */
class SplitParagraphCommand extends PositionalCommand {
  readonly type = 'split-paragraph'
  private newParaId?: string  // v20.28: forward 填充, invert 使用

  forward(ctx: CommandContext): StatePatch {
    if (ctx.mode !== 'local') return null
    const { doc, pool } = ctx
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph
    if (!para) return null

    // 1. 按字符偏移定位 TextNode + localOffset
    const resolved = pool.resolveCharOffset(para.id, this.offset)
    if (!resolved) return null
    const { textNodeId, localOffset } = resolved
    const textNode = pool.nodes.get(textNodeId) as TextNode
    const beforeText = textNode.text.slice(0, localOffset)
    const afterText = textNode.text.slice(localOffset)

    // 2. 分裂 children: [0..splitIdx] 留在旧段落, [splitIdx..] 移到新段落
    const splitIdx = para.children.indexOf(textNodeId)
    const leftChildren = para.children.slice(0, splitIdx)
    const rightChildren = para.children.slice(splitIdx + 1)
    if (beforeText) leftChildren.push(textNodeId)
    pool.updateNode(textNodeId, { text: beforeText || '' })

    // 3. 构造新段落 (继承段落样式/列表属性/outlineLevel)
    const newPara = createParagraph(afterText ? [createTextNode(afterText, extractStyle(textNode))] : [])
    newPara.alignment = para.alignment
    newPara.indent = para.indent
    newPara.lineHeight = para.lineHeight
    newPara.list = para.list ? { ...para.list, continueNumbering: true } : undefined
    newPara.outlineLevel = para.outlineLevel
    pool.nodes.set(newPara.id, newPara)

    // 4. 在新段落中插入右半 children
    for (const childId of rightChildren) {
      pool.insertChild(newPara.id, childId, newPara.children.length)
    }

    // 5. 在 FlowBody 中插入新段落
    const parentId = this.path[this.path.length - 2] ?? doc.body.id
    const paraIndex = (pool.nodes.get(parentId) as any).children.indexOf(para.id)
    pool.insertChild(parentId, newPara.id, paraIndex + 1)

    return {
      cursor: { paragraphPath: [...this.path.slice(0, -1), newPara.id], offset: 0 },
      invalidation: 'flowbody'
    }
  }

  invert?(ctx: CommandContext): ICommand | null {
    // 逆操作: 合并回原段落, 恢复光标到拆分点
    return new MergeParagraphCommand(generateId(), Date.now(), this.author,
      [...this.path.slice(0, -1), newPara.id]  // 合并目标: 新段落
    )
  }
  serialize(): SerializedCommand { return { type: 'split-paragraph', id: this.id, timestamp: this.timestamp, author: this.author, path: this.path, offset: this.offset } }
}

/** 合并段落 (段首 Backspace) — 将当前段文字拼接到上一段尾部 */
class MergeParagraphCommand extends PositionalCommand {
  readonly type = 'merge-paragraph'
  private deletedParaId?: string        // v20.28: forward 填充被删段落 ID
  private deletedParaSnapshot?: string  // JSON 快照 (完整子树, 用于 invert 恢复)
  private mergeOffset?: number          // 合并点字符偏移

  forward(ctx: CommandContext): StatePatch {
    if (ctx.mode !== 'local') return null
    const { doc, pool } = ctx
    const currentPara = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph
    if (!currentPara) return null

    // 1. 在当前 FlowBody 中找上一段
    const parentId = this.path[this.path.length - 2] ?? doc.body.id
    const siblings = (pool.nodes.get(parentId) as any).children as string[]
    const currentIdx = siblings.indexOf(currentPara.id)
    if (currentIdx <= 0) return null // 已是第一段
    const prevPara = pool.nodes.get(siblings[currentIdx - 1]) as Paragraph

    // 2. 当前段全部 children 追加到上一段尾部
    for (const childId of currentPara.children) {
      pool.insertChild(prevPara.id, childId, prevPara.children.length)
    }

    // 3. 快照被删段落子树 (v20.28: 子树快照式 invert)
    this.deletedParaId = currentPara.id
    this.deletedParaSnapshot = JSON.stringify(takeSubtreeSnapshot(pool, currentPara.id))
    this.mergeOffset = prevCharCount

    // 4. 删除当前段 (级联回收 descendants)
    pool.removeChild(parentId, currentIdx)

    // 4. 合并上一段
    normalizeParagraph(prevPara, pool)

    // 5. 光标定位到合并点 (= 上一段原文长度)
    const prevCharCount = pool.getCharOffset(prevPara.id, prevPara.children[prevPara.children.length - 1], 0)
    return {
      cursor: { paragraphPath: [...this.path.slice(0, -1), prevPara.id], offset: prevCharCount },
      invalidation: 'flowbody'
    }
  }

  invert?(ctx: CommandContext): ICommand | null { return null }
  serialize(): SerializedCommand { return { type: 'merge-paragraph', id: this.id, timestamp: this.timestamp, author: this.author, path: this.path } }
}

/** 跨段落删除 — 选区跨越多个段落时的删除 */
class CrossParagraphDeleteCommand extends PositionalCommand {
  readonly type = 'cross-paragraph-delete'
  /** 选区的字符偏移范围 (段落内), 用于锚点/焦点分别在两个段落时 */
  readonly anchorPath: string[]; readonly anchorOffset: number
  readonly focusPath: string[]; readonly focusOffset: number

  forward(ctx: CommandContext): StatePatch {
    if (ctx.mode !== 'local') return null
    const { doc, pool } = ctx

    // 1. 找到锚点和焦点段落在 body 中的位置
    const anchorParaId = this.anchorPath[this.anchorPath.length - 1]
    const focusParaId = this.focusPath[this.focusPath.length - 1]
    const bodyChildren = doc.body.children
    const anchorIdx = bodyChildren.indexOf(anchorParaId)
    const focusIdx = bodyChildren.indexOf(focusParaId)
    if (anchorIdx < 0 || focusIdx < 0) return null

    // 2. 截断首段 (保留 anchorOffset 之前的文本) + 删除 anchorOffset 之后
    const anchorPara = pool.nodes.get(anchorParaId) as Paragraph
    this.truncateAfter(anchorPara, pool, this.anchorOffset)

    // 3. 截断尾段 (保留 focusOffset 之后的文本) + 删除 focusOffset 之前
    const focusPara = pool.nodes.get(focusParaId) as Paragraph
    this.truncateBefore(focusPara, pool, this.focusOffset)

    // 4. 删除中间整段 (anchorIdx+1..focusIdx-1)
    for (let i = focusIdx - 1; i > anchorIdx; i--) {
      pool.removeChild(doc.body.id, i)
    }

    // 5. 合并首尾段
    for (const childId of focusPara.children) {
      pool.insertChild(anchorPara.id, childId, anchorPara.children.length)
    }
    pool.removeChild(doc.body.id, bodyChildren.indexOf(focusParaId))
    normalizeParagraph(anchorPara, pool)

    return {
      cursor: { paragraphPath: [...this.anchorPath.slice(0, -1), anchorPara.id], offset: this.anchorOffset },
      invalidation: 'flowbody'
    }
  }

  invert?(ctx: CommandContext): ICommand | null { return null }
  serialize(): SerializedCommand { return { type: 'cross-paragraph-delete', id: this.id, timestamp: this.timestamp, author: this.author, anchorPath: this.anchorPath, anchorOffset: this.anchorOffset, focusPath: this.focusPath, focusOffset: this.focusOffset } }
}
```

### 6.7 StateCommand — 光标/选区变更的唯一路径 (v20.18)

**问题**: §8.1 依赖图规定 Handler → CommandManager → EditorRuntimeState，但 MouseHandler 又允许直接 emit cursor:moved。两路径竞争修改同一字段，覆写顺序与合并语义未定义。StatePatch 中的 cursor 是整体替换还是字段级 merge 也未明确。

**规则**: 凡修改 EditorRuntimeState 必须走 `CommandManager`，封装为 `StateCommand`（无文档副作用、仅更新状态），Handler 只发原始意图事件。

```typescript
/** StateCommand — 无文档副作用, 仅更新 EditorRuntimeState */
class SetCursorCommand implements ICommand {
  readonly type = 'set-cursor'; readonly id: string
  readonly timestamp: number; readonly author: string
  constructor(readonly cursor: Partial<CursorState>) {}

  forward(ctx: CommandContext): StatePatch | null {
    // 不修改 DocumentTree, 只返回 cursor 更新
    return { cursor: this.cursor }
  }
  invert?(ctx: CommandContext): ICommand | null { return null }
  serialize(): SerializedCommand { return { type: 'set-cursor', id: this.id, timestamp: this.timestamp, author: this.author, cursor: this.cursor } }
  static deserialize(data: SerializedCommand): ICommand { return new SetCursorCommand(data.cursor) }
}

class SetSelectionCommand implements ICommand {
  readonly type = 'set-selection'; readonly id: string
  readonly timestamp: number; readonly author: string
  constructor(readonly selection: Partial<SelectionState>) {}

  forward(ctx: CommandContext): StatePatch | null {
    return { selection: this.selection }
  }
  invert?(ctx: CommandContext): ICommand | null { return null }
  serialize(): SerializedCommand { return { type: 'set-selection', id: this.id, timestamp: this.timestamp, author: this.author, selection: this.selection } }
  static deserialize(data: SerializedCommand): ICommand { return new SetSelectionCommand(data.selection) }
}

/** StatePatch 合并语义: 每个顶层 key 为字段级 merge (Object.assign), 非整体替换 */
//   EditorRuntimeState = { ...prev, ...patch }
//   cursor 子字段: 按 CursorState 的 key 逐字段 merge (position, visible 独立更新)
//   IMEState 不在 StatePatch 中 —— IME 中间态不经过 CommandManager,
//   仅通过 EventBus.emit('render:request') 直接触发 render 层预览
```

**Handler 职责修正 (§8.1 同步)**:
```
MouseHandler: click/mousemove → 计算新光标/选区 → new SetCursorCommand(cursor) → CommandManager.execute()
  不再直接 emit cursor:moved —— 走 StateCommand 路径。
  EventBus 'cursor:moved' 保留为"变更通知"（供外部订阅），由 CommandManager 在 execute(StateCommand) 后 emit。

KeyboardHandler: keydown Enter → new SplitParagraphCommand → CommandManager.execute()
  keydown Backspace(段首) → new MergeParagraphCommand → CommandManager.execute()
  跨段选区 Delete → new CrossParagraphDeleteCommand → CommandManager.execute()
```

## 7. 渲染管道

### 7.1 Particle 统一渲染接口

```typescript
/**
 * 粒子渲染器统一接口
 *
 * 当前状态: 仅有 TextParticle，无通用接口，后续扩展困难
 * 目标: 所有文档元素实现 IParticle，渲染器通过统一接口调度
 */

/** 每个粒子的渲染输入 — 布局计算结果 */
interface ParticleLayout {
  /** 逻辑坐标 (文档坐标系) */
  x: number; y: number
  width: number; height: number
  ascent: number; descent: number
  /** 所属页面索引 */
  pageIndex: number
  /** 节点 ID */
  nodeId: string
}

/** 渲染上下文 — 由 Draw 注入 */
interface RenderContext {
  ctx: CanvasRenderingContext2D
  /** 逻辑坐标 → 画布坐标的变换矩阵 */
  transform: CoordinateTransform
  /** 当前视图状态 (用于条件渲染) */
  view: ViewState
  /** 选区信息 (用于高亮渲染) */
  selection: SelectionState | null
}

/** 粒子接口 — 每种可渲染的文档元素都实现此接口 */
interface IParticle {
  /** 粒子类型标识 */
  readonly particleType: string

  /**
   * 渲染当前粒子到 Canvas
   * @returns 实际渲染区域 (用于增量渲染脏区计算)
   */
  render(layout: ParticleLayout, context: RenderContext): RenderRect

  /**
   * 计算粒子在给定布局约束下的自然尺寸
   * (用于布局引擎的测量阶段)
   */
  measure(context: MeasureContext): { width: number; height: number }
}

/** 渲染矩形 — 增量渲染的脏区标记 */
interface RenderRect {
  x: number; y: number; width: number; height: number
}

/** 测量上下文 */
interface MeasureContext {
  measurer: TextMeasurer
  maxWidth: number
  defaultFont: string
  defaultSize: number
}

// ---- 具体实现 ----

class TextParticle implements IParticle {
  readonly particleType = 'text'
  render(layout: ParticleLayout, ctx: RenderContext): RenderRect { /* 当前实现 */ }
  measure(ctx: MeasureContext): { width: number; height: number } { /* 调用 TextMeasurer */ }
}

class ImageParticle implements IParticle {
  readonly particleType = 'image'
  render(layout: ParticleLayout, ctx: RenderContext): RenderRect { /* 待实现 */ }
  measure(ctx: MeasureContext): { width: number; height: number } { /* 读取 imageData */ }
}

class TableParticle implements IParticle {
  readonly particleType = 'table'
  render(layout: ParticleLayout, ctx: RenderContext): RenderRect { /* 待实现 */ }
  measure(ctx: MeasureContext): { width: number; height: number } { /* 递归测量单元格 */ }
}

// ---- 粒子注册表 (插件式扩展) ----
class ParticleRegistry {
  private particles = new Map<string, IParticle>()

  register(particle: IParticle): void {
    this.particles.set(particle.particleType, particle)
  }

  get(type: string): IParticle | undefined {
    return this.particles.get(type)
  }
}
```

### 7.2 全局坐标系统

**问题**: 逻辑文档坐标、Canvas 画布坐标、屏幕像素坐标、滚动偏移在 Draw.ts 中多处重复换算，极易出现不一致。

**方案**: 集中管理三层坐标转换，所有代码通过 `CoordinateSystem` 进行变换。

```typescript
/**
 * 三层坐标系统
 *
 * Layer 1 — 文档坐标 (Document Coordinate)
 *   原点: A4 页面左上角 (0, 0)
 *   单位: 逻辑像素 (1 unit = 1/96 inch)
 *   用途: 布局计算、PageItem 存储
 *   特征: 不受 DPR/滚动/缩放影响
 *
 * Layer 2 — 画布坐标 (Canvas Coordinate)
 *   原点: Canvas 缓冲区左上角
 *   单位: 物理像素 (× DPR)
 *   用途: 绘制到 Canvas
 *   特征: 受 DPR 影响，ctx.setTransform() 负责转换
 *
 * Layer 3 — 屏幕坐标 (Screen Coordinate)
 *   原点: 浏览器视口左上角
 *   单位: CSS 像素
 *   用途: 鼠标事件、光标位置
 *   特征: 受滚动/缩放/Canvas CSS 尺寸影响
 */

interface CoordinateTransform {
  /** 缩放比例 */
  scale: number

  /** 设备像素比 */
  dpr: number

  /** 滚动偏移 (文档坐标系) */
  scrollX: number
  scrollY: number

  /** Canvas 元素在屏幕上的偏移 */
  canvasOffsetX: number
  canvasOffsetY: number
}

class CoordinateSystem {
  private transform: CoordinateTransform

  constructor(dpr: number) {
    this.transform = { scale: 1, dpr, scrollX: 0, scrollY: 0, canvasOffsetX: 0, canvasOffsetY: 0 }
  }

  /** 更新变换参数 (缩放/滚动/Canvas 位置变化时调用) */
  update(partial: Partial<CoordinateTransform>): void {
    Object.assign(this.transform, partial)
  }

  /** 文档坐标 → 画布坐标 (物理像素) */
  docToCanvas(docX: number, docY: number): { x: number; y: number } {
    const { scale, dpr, scrollX, scrollY } = this.transform
    return {
      x: (docX - scrollX) * scale * dpr,
      y: (docY - scrollY) * scale * dpr,
    }
  }

  /** 屏幕坐标 → 文档坐标 */
  screenToDoc(screenX: number, screenY: number): { x: number; y: number } {
    const { scale, scrollX, scrollY, canvasOffsetX, canvasOffsetY } = this.transform
    return {
      x: (screenX - canvasOffsetX) / scale + scrollX,
      y: (screenY - canvasOffsetY) / scale + scrollY,
    }
  }

  /** 文档坐标 → 屏幕坐标 */
  docToScreen(docX: number, docY: number): { x: number; y: number } {
    const { scale, scrollX, scrollY, canvasOffsetX, canvasOffsetY } = this.transform
    return {
      x: (docX - scrollX) * scale + canvasOffsetX,
      y: (docY - scrollY) * scale + canvasOffsetY,
    }
  }

  /** 获取当前 ctx.setTransform() 所需的变换矩阵参数 */
  getCanvasTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const { scale, dpr, scrollX, scrollY } = this.transform
    return {
      a: scale * dpr, b: 0, c: 0, d: scale * dpr,
      e: -scrollX * scale * dpr,
      f: -scrollY * scale * dpr,
    }
  }
}

// CoordinateSystem 由 Editor 构造注入 (实例私有)
```

### 7.3 增量布局与增量渲染管道

#### 当前实现 (全量重算)

```
DocumentTree
    │
    ▼
[1. recomputeLayout()] — 全量重算
    遍历全部 pages → 展开全部 BlockNode → 重算所有 PageItem 坐标
    │
    ▼
[2. render()] — 全画布重绘
    清空 Canvas → 重绘全部页面背景/边距线/页码 → 重绘全部 PageItem
    → drawCursor() → drawComposingText()
```

**问题**: 每次编辑都触发全量重布局 + 全画布重绘。100 页文档编辑 1 个字符 = 重新计算 100 页布局、重绘 100 页。

#### 目标架构 (增量布局 + 增量渲染) — v20.1 布局引擎独立

```
编辑操作 (Command.execute)
    │
    ▼
[1. 脏区标记]
    │
    ▼
[2. LayoutEngine (layout/ 层 — 独立于 render/)]  ← v20.1 上移
    │ 脏 Paragraph → paragraphToLineElements() → LineBreaker.breakLines()
    │ 脏 FlowBody → PageBreaker.incrementalRepaginate() (含 PageStartTable 早停)
    │ 输出: SLIFPage[] (布局产物, 与 Canvas 解耦)
    │
    ├─→ [2a. SLIF 导出] SLIFPage[] → JSON → 后端 PDF/HTML 渲染 (§18)
    │
    ▼
[3. Draw (render/ 层 — 纯渲染消费者)]              ← v20.1 职责收窄
    │ 输入: SLIFPage[] (由 LayoutEngine 产出)
    │ 输出: Canvas 像素
    │ ctx.clip(clipRect) → 仅重绘脏区
    │ cursor/selection/IME preview 始终全量绘制
    │
    ▼
[4. requestAnimationFrame 合并]
```
**LayoutEngine 与 Draw 的边界**:
- LayoutEngine: 接收脏区标记 → 调用 LineBreaker/PageBreaker → 产出 SLIFPage[]。无 Canvas 依赖。
- Draw: 接收 SLIFPage[] → 驱动 LayeredRenderer 三层 Canvas。无布局计算。
- 导出: PDF/HTML 导出直接消费 SLIFPage[] → 后端 iText 渲染，与前端 Draw 零耦合。

#### 脏区追踪器

#### 脏区追踪器

```typescript
/**
 * 增量渲染的脏区追踪
 */
class DirtyTracker {
  /** 需要重新布局的 Paragraph ID 集合 */
  private dirtyParagraphs = new Set<string>()

  /** 需要重新渲染的渲染矩形集合 */
  private dirtyRects: RenderRect[] = []

  /** 是否需要全量重布局 */
  private needsFullLayout = false

  /** 标记段落需要重新布局 */
  markParagraphDirty(paragraphId: string): void {
    this.dirtyParagraphs.add(paragraphId)
  }

  /** 标记渲染区域为脏 */
  markRectDirty(rect: RenderRect): void {
    this.dirtyRects.push(rect)
  }

  /** 标记需要全量重布局 */
  markFullLayout(): void {
    this.needsFullLayout = true
  }

  /**
   * 计算合并后的脏区 (用于 Canvas clip)
   * 返回 null 表示无需渲染
   */
  getClipRegion(): RenderRect | null {
    if (this.needsFullLayout) return null // null = 全画布
    if (this.dirtyRects.length === 0 && this.dirtyParagraphs.size === 0) return null
    // 合并所有脏区为最小包围矩形
    return mergeRects(this.dirtyRects)
  }

  /** 清空所有脏标记 (渲染完成后调用) */
  clear(): void {
    this.dirtyParagraphs.clear()
    this.dirtyRects = []
    this.needsFullLayout = false
  }

  /** 查询脏 SmartTextNode ID 集合 (供 QCEngine §11.2 增量更新索引, v20.22) */
  queryDirtySmartTextNodes(): Set<string> {
    // 由 CommandManager 在 execute 后填写, DirtyTracker 仅存储
    return this._dirtySmartTextNodes
  }
  private _dirtySmartTextNodes = new Set<string>()
  markSmartTextDirty(nodeId: string): void { this._dirtySmartTextNodes.add(nodeId) }

  /** 全量重新分页标记 */
  get needsRepaginate(): boolean { return this.needsFullLayout }

  /** 查询脏段落集合 (供 LayoutEngine 增量布局) */
  getDirtyParagraphs(): ReadonlySet<string> { return this.dirtyParagraphs }
}

// ================================================================
// InvalidationScope → 具体动作映射表 (v20.22)
// ================================================================
// 四套失效机制的触发关系:
//   Command.forward() 返回 StatePatch.invalidation
//     → CommandManager 据此调用 DirtyTracker 对应方法
//     → LayoutEngine 查询 DirtyTracker → 调用 LayoutCache.invalidate + PageStartTable
//     → EventBus 发出 {invalidation, dirtyNodeIds} (非全量 DocumentTree)

/**
 * InvalidationScope → DirtyTracker 标记 + LayoutCache 失效 + 是否重分页
 *
 * ┌────────────────────┬──────────────────────────────┬────────────────────┬──────────┐
 * │ InvalidationScope  │ DirtyTracker 方法            │ LayoutCache 操作   │ 重分页   │
 * ├────────────────────┼──────────────────────────────┼────────────────────┼──────────┤
 * │ 'none'             │ 无                           │ 无                 │ 否       │
 * │ 'node'             │ markSmartTextDirty(nodeId)   │ invalidate(nodeId) │ 否       │
 * │ 'paragraph'        │ markParagraphDirty(paraId)   │ invalidate(paraId) │ 否       │
 * │ 'paragraph_and_    │ markParagraphDirty +         │ invalidate(paraId) │ 是(增量) │
 * │  downstream'       │ markRectDirty(后续)          │ +下游页面失效      │          │
 * │ 'block'            │ markParagraphDirty(父)       │ invalidate(blockId)│ 否       │
 * │ 'flowbody'         │ markFullLayout()             │ clearAll()         │ 是(全量) │
 * │ 'table'            │ markFullLayout()             │ clearAll()         │ 是(全量) │
 * │ 'page_setup'       │ markFullLayout()             │ clearAll()         │ 是(全量) │
 * │ 'full'             │ markFullLayout()             │ clearAll()         │ 是(全量) │
 * └────────────────────┴──────────────────────────────┴────────────────────┴──────────┘
 */

// EventBus 载荷修正 (v20.22):
// document:changed → [doc: DocumentTree] 改为 { invalidation: InvalidationScope, dirtyNodeIds: string[] }
//   (每击键不再传输完整 DocumentTree 快照, 遵循"数据增量"铁律)
// EventPayloadMap 更新:
//   'document:changed': [{ invalidation: InvalidationScope; dirtyNodeIds: string[] }]
```

#### 布局失效传播规则

**规则**: 采用「最小失效范围」原则，按变更类型分级传播：

```
编辑操作 → 确定失效范围 → 标记对应缓存失效 → 增量重算

┌─────────────────────────────────────────────────────────────┐
│ 变更类型                    │ 失效范围                       │
├─────────────────────────────┼───────────────────────────────┤
│ 文本样式变更                │ 该节点重测量                    │
│ (font/size/bold/color)     │ 行宽不变 → 不触发段落重排       │
│                             │ 行高变化 → 该行重排             │
├─────────────────────────────┼───────────────────────────────┤
│ 文本内容变更                │ 所属 Paragraph 重排             │
│ (增/删/改字符)             │ + 该段落所在页的后续段落偏移重算 │
│                             │ + 后续页面的分页结果全部失效    │
├─────────────────────────────┼───────────────────────────────┤
│ 块级插入/删除               │ 所在 FlowBody 全量重分页       │
│ (Paragraph/Table)          │ 后续所有页面的 PageItem 失效    │
│                             │ 静态层(页眉/页脚/页码)不失效   │
├─────────────────────────────┼───────────────────────────────┤
│ 表格结构变更                │ 该 Table 重排 + 后续全量重分页 │
│ (插入/删除/移动行/列)      │ 合并矩阵重建                   │
├─────────────────────────────┼───────────────────────────────┤
│ 页面设置变更                │ 全文档重分页                   │
│ (纸张大小/边距/方向)       │ 所有缓存失效                   │
├─────────────────────────────┼───────────────────────────────┤
│ 页眉/页脚变更               │ 仅静态层重绘 (不影响正文分页)  │
│ 缩放变更                    │ 仅渲染层 (不影响布局)          │
└─────────────────────────────────────────────────────────────┘

特殊场景:
  跨页断表: 表格重排 → 重算分页断点 → 后续所有页面失效
  页眉页脚联动: 页眉页脚高度变化 → 正文区可用高度变化 → 全量重分页
```

### 7.4 布局缓存体系

/** 布局缓存条目 — 以 SLIFItem 为存储单元 (v20.19: 原 LayoutBox 已废弃, 统一 SLIFItem) */

**方案**: 建立三级布局缓存，缓存键 = 节点 ID，通过 NodePool.version 判断失效。

```typescript
interface LayoutBox {
  nodeId: string; x: number; y: number; width: number; height: number
  ascent: number; descent: number; pageIndex: number; cachedVersion: number
}

class LayoutCache {
  private inlineCache = new Map<string, { width: number; height: number; ascent: number; descent: number; version: number }>()
  private blockCache = new Map<string, { lineCount: number; totalHeight: number; lines: LayoutBox[]; version: number }>()
  private pageCache  = new Map<number, { pageItems: LayoutBox[]; totalHeight: number; version: number }>()

  isValid(nodeId: string, poolVersion: number, level: 'inline' | 'block' | 'page'): boolean {
    const cache = level === 'inline' ? this.inlineCache : level === 'block' ? this.blockCache : this.pageCache
    const entry = cache.get(level === 'page' ? Number(nodeId) : nodeId)
    return entry !== undefined && entry.version === poolVersion
  }
  invalidate(nodeId: string): void { this.inlineCache.delete(nodeId); this.blockCache.delete(nodeId) }
  invalidatePage(pageIndex: number): void { this.pageCache.delete(pageIndex) }
  clearAll(): void { this.inlineCache.clear(); this.blockCache.clear(); this.pageCache.clear() }
}
```

### 7.5 Canvas 分层渲染

**修正**:

1. Canvas 尺寸 = 视口 + overscan 1 页（非全文档），滚动时平移绘制偏移，内存 O(视口) ≈ 60MB
2. 水印离屏 pattern 预渲染，滚动零重算
3. 光标闪烁统一 setInterval（rAF 在后台标签页暂停会导致状态错乱）
4. CoordinateSystem 实例私有，Editor 构造注入

```typescript
class LayeredRenderer {
  private layers = {
    static:   null as HTMLCanvasElement | null,
    content:  null as HTMLCanvasElement | null,
    interact: null as HTMLCanvasElement | null,
  }
  private ctxs = {
    static:   null as CanvasRenderingContext2D | null,
    content:  null as CanvasRenderingContext2D | null,
    interact: null as CanvasRenderingContext2D | null,
  }
  private blinkTimer: number | null = null
  private coordSystem: CoordinateSystem          // 实例私有
  private watermarkPattern: CanvasPattern | null = null  // 离屏预渲染

  /** 视口尺寸 (CSS px) */
  private viewportW = 0
  private viewportH = 0
  /** overscan 页数 (视口外预渲染) */
  private readonly OVERSCAN_PAGES = 1

  constructor(coordSystem: CoordinateSystem) { this.coordSystem = coordSystem }

  // ---- 尺寸管理 (虚拟化渲染窗口) ----
  syncSizes(viewportW: number, viewportH: number, dpr: number, pageHeight: number, totalPages: number): void {
    this.viewportW = viewportW; this.viewportH = viewportH
    // Canvas 物理尺寸 = 视口 + overscan 1 页 (而非全文档)
    const pagesInView = Math.ceil(viewportH / pageHeight) + this.OVERSCAN_PAGES * 2
    const canvasH = Math.min(pagesInView * pageHeight, totalPages * pageHeight)

    // ================================================================
    // Canvas 内存预算 (v19.10 修正 — 去掉了与 PRD 矛盾的 "~60MB" 估算)
    // ================================================================
    // 公式: 3 层 × W × H × 4 bytes/pixel × DPR²
    //
    // 场景                        内存 (DPR=1)     内存 (DPR=2)
    // ─────────────────────────────────────────────────────────
    // 1080p / 100% / 2页视口      ~8MB             ~32MB
    // 1080p / 150% / 2页视口      ~15MB            ~60MB
    // 4K     / 100% / 2页视口     ~16MB            ~64MB
    // 4K     / 150% / 3页视口     ~42MB            ~168MB
    // 4K     / 200% / 3页视口     ~56MB            ~224MB
    //
    // 优化策略 (当 4K + DPR2 + scale>1.5 时启用):
    //   1. content 层分片: 按页拆分为多个独立 canvas (每页 ~7MB@DPR2)
    //      仅当前可见页 + overscan 页在 DOM 中，其余 remove
    //   2. static 层降 DPR: 静态层(背景/边距线)可用 DPR=1 渲染 (视觉无差异)
    //   3. renderPrecision='low': 缩放>150% 时暂时降 DPR 到 1, 缩放停止后恢复
    //   4. 动态预算: 检测 performance.memory.usedJSHeapSize > 200MB → 强制释放缓存
    //
    // 目标: 4K + DPR2 + scale=2 时总 Canvas 内存 < 200MB (MVP) / < 120MB (最终)
    // ================================================================

    for (const key of ['static', 'content', 'interact'] as const) {
      this.layers[key]!.width  = Math.ceil(viewportW * dpr)
      this.layers[key]!.height = Math.ceil(canvasH * dpr)
      this.layers[key]!.style.width  = `${viewportW}px`
      this.layers[key]!.style.height = `${canvasH}px`
    }
  }

  /** 滚动时平移绘制偏移 (不扩大画布，只改 ctx 偏移) */
  setScrollOffset(scrollY: number, firstVisiblePage: number, pageHeight: number): void {
    const offsetY = -(scrollY - firstVisiblePage * pageHeight)
    for (const ctx of [this.ctxs.static, this.ctxs.content]) {
      if (ctx) {
        const dpr = this.coordSystem.transform.dpr
        ctx.setTransform(dpr, 0, 0, dpr, 0, offsetY * dpr)
      }
    }
  }

  // ---- 静态层渲染 ----
  renderStatic(pages: SLIFPage[], visibleRange: { start: number; end: number }): void {
    const ctx = this.ctxs.static!
    ctx.clearRect(0, 0, this.layers.static!.width, this.layers.static!.height)
    ctx.save()
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      const page = pages[i]
      const pageY = (i - visibleRange.start) * page.height
      // 页面背景 / 阴影 / 边距线 / 页码
      this.drawPageFrame(ctx, page, pageY)
      // 水印 (离屏 pattern, 滚动零重算)
      if (this.watermarkPattern) {
        ctx.fillStyle = this.watermarkPattern
        ctx.fillRect(0, pageY, page.width, page.height)
      }
    }
    ctx.restore()
  }

  // ---- 水印离屏预渲染 ----
  prepareWatermark(wm: WatermarkConfig): void {
    if (wm.type !== 'tile') { this.watermarkPattern = null; return }
    const offscreen = document.createElement('canvas')
    offscreen.width = wm.spacing; offscreen.height = wm.spacing
    const octx = offscreen.getContext('2d')!
    octx.globalAlpha = wm.opacity
    octx.font = `${wm.fontSize || 48}px "SimSun"`
    octx.fillStyle = wm.color || '#000000'
    octx.textAlign = 'center'; octx.textBaseline = 'middle'
    octx.translate(wm.spacing / 2, wm.spacing / 2)
    octx.rotate((wm.rotation * Math.PI) / 180)
    octx.fillText(wm.text || '', 0, 0)
    this.watermarkPattern = this.ctxs.static!.createPattern(offscreen, 'repeat')!
  }

  // ---- 交互层光标 (统一 setInterval) ----
  startCursorBlink(): void {
    let visible = true
    this.blinkTimer = window.setInterval(() => {
      visible = !visible
      const ctx = this.ctxs.interact!
      ctx.clearRect(0, 0, this.layers.interact!.width, this.layers.interact!.height)  // v20.1: 仅重绘光标线宽区域(cursorX-2)而非整层
      if (visible) this.drawCursor(ctx)
      this.drawSelection(ctx)
      this.drawComposingText(ctx)
    }, 530)
  }

  // ---- 增量渲染帧调度 ----
  private renderPending = false
  requestRender(): void {
    if (this.renderPending) return
    this.renderPending = true
    requestAnimationFrame(() => {
      // 先重绘 content 层 (脏区)
      this.renderContent(/* dirtyItems */)
      // 交互层由 setInterval 独立驱动 (无需在 rAF 中重复绘制)
      this.renderPending = false
    })
  }

  destroy(): void {
    if (this.blinkTimer) { clearInterval(this.blinkTimer); this.blinkTimer = null }
    for (const key of ['static', 'content', 'interact'] as const) {
      this.layers[key]?.remove(); this.layers[key] = null; this.ctxs[key] = null
    }
    this.watermarkPattern = null
  }
}
```

#### 层模型统一

架构文档与 UI 文档统一为 3 层:

| 架构层   | UI 组件树映射                                  | 职责                                     |
| -------- | ---------------------------------------------- | ---------------------------------------- |
| static   | PageFrame                                      | 页面背景/阴影/边距线/页眉/页脚/页码/水印 |
| content  | ContentLayer                                   | 文本/表格/SmartTextNode/ImageNode        |
| interact | CursorLayer + SelectionLayer + AnnotationLayer | 光标/选区高亮/IME 预览/批注指示          |

#### 滚动架构 (v20.24)

**方案**: spacer div + 原生 overflow:auto。Canvas 固定于视口，ctx 平移模拟滚动。

```
┌────────────────────────────────────────┐
│ EditorArea (overflow: auto, 300vh)     │
│ ┌────────────────────────────────────┐ │
│ │ Spacer (height = 全文档像素高度)    │ │  ← 撑出原生滚动条
│ │                                    │ │
│ │  ┌──────────────────────────────┐  │ │
│ │  │ Canvas (3层, position:sticky)│  │ │  ← 固定视口内, 不随 spacer 滚动
│ │  │  static / content / interact │  │ │
│ │  └──────────────────────────────┘  │ │
│ └────────────────────────────────────┘ │
│ <scrollbar>                            │  ← 浏览器原生渲染
└────────────────────────────────────────┘
```

**滚动数据流**:

```
DOM scroll event (EditorArea.onscroll)
  → ViewState.scroll = { x: scrollLeft, y: scrollTop }
  → CoordinateSystem.update({ scrollX, scrollY })
  → LayeredRenderer.setScrollOffset(scrollY)
    → static/content 层: ctx.setTransform(dpr,0,0,dpr, 0, offsetY*dpr)
    → interact 层: ctx.setTransform(dpr,0,0,dpr, 0, offsetY*dpr)
  → VirtualViewport.update(scrollY)  ← 确定可见页范围
  → EventBus.emit('scale:changed' 相关? 否, 缩放独立)
```

**Spacer 高度计算**: `totalDocumentHeight = SLIFPage[].reduce((h,p)=>h+p.height, 0) * ViewState.scale`

**滚动与渲染的协调**: 滚动事件触发后仅需重新计算 `visiblePages` + 平移 Canvas ctx——不触发 reLayout。`setScrollOffset` 只改 ctx 变换矩阵，不重绘。当 `visiblePages` 变化(进入新页)时先调用 `syncSizes` 调整 Canvas 物理高度、再渲染新进入视口的页面、再销毁离开视口的页面 Canvas 分片。

**全文档高度 vs Canvas 尺寸**: Spacer 高度 = 全文档(可能百页)，Canvas 物理尺寸 = 视口 + overscan 1页(§7.5)。内存由 Canvas 控制，滚动条范围由 spacer 提供——两者解耦。

### 7.6 命中检测体系

**问题**: 「坐标 → 节点」反向查找无标准方案，交互逻辑散落在各 Handler 中。

**方案**: 统一 `hitTest()` + 布局包围盒 + 空间索引。

```typescript
interface HitTestable {
  hitTest(docX: number, docY: number): string | null  // 返回命中节点 ID 或 null
}
// IParticle 继承 HitTestable
interface IParticle extends HitTestable { /* ... */ }

class HitTestIndex {
  /** 按页分桶: pageIndex → 该页所有 items (按 y 升序) */
  private buckets = new Map<number, { rect: RenderRect; nodeId: string; particle: IParticle }[]>()

  rebuild(pageItems: PageItem[], registry: ParticleRegistry): void {
    this.buckets.clear()
    for (const item of pageItems) {
      const particle = registry.get(item.nodeType)
      if (!particle) continue
      const entry = { rect: item as RenderRect, nodeId: item.nodeId, particle }
      const bucket = this.buckets.get(item.pageIndex) ?? []
      bucket.push(entry)
      this.buckets.set(item.pageIndex, bucket)
    }
    // 每页桶内按 y 排序，用于二分查找
    for (const bucket of this.buckets.values()) {
      bucket.sort((a, b) => a.rect.y - b.rect.y)
    }
  }

  hitTest(docX: number, docY: number, pageIndex: number): string | null {
    // Step 1: 按页分桶定位 — O(1)
    const bucket = this.buckets.get(pageIndex)
    if (!bucket) return null

    // Step 2: 页内二分 y 定位 (第一个 rect.y + rect.height >= docY 的 item)
    let lo = 0, hi = bucket.length - 1, firstBeyond = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (bucket[mid].rect.y + bucket[mid].rect.height >= docY) {
        firstBeyond = mid
        hi = mid - 1
      } else {
        lo = mid + 1
      }
    }
    if (firstBeyond < 0) return null

    // Step 3: 从二分定位点向后扫描, 直到 rect.y > docY (y 范围外的 item 不可能命中)
    for (let i = firstBeyond; i < bucket.length && bucket[i].rect.y <= docY; i++) {
      const { rect, particle } = bucket[i]
      if (docX >= rect.x && docX <= rect.x + rect.width) {
        const hit = particle.hitTest(docX, docY)
        if (hit) return hit
      }
    }
    return null
  }
}
// 复杂度:
//   全量 rebuild: O(n log n) (每页桶内排序, n = 页内 item 数)
//   hitTest: O(log m + k) (m = 页内 item 数, k = y 范围内候选数, 通常 < 5)
//   百页文档 mousemove: 先 MouseHandler 由 docY 计算 pageIndex → hitTest(pageIndex) → 单页查找
```
```

### 7.7 布局中间格式定义 (SLIF)

```typescript
/**
 * 标准布局中间格式 (Standard Layout Intermediate Format, SLIF)
 *
 * 目的: 前端排版引擎和后端导出引擎共享同一个布局计算结果，
 *       保证「所见即所得」—— Canvas 上看到的和 PDF 打印出的完全一致。
 *
 * 流程: DocumentTree → LayoutEngine → SLIF JSON → Canvas 渲染 / iText PDF 渲染
 */

interface SLIF {
  version: string                  // 布局引擎版本 (与 modelVersion 解耦)
  documentId: string
  pageSetup: PageSetup
  pages: SLIFPage[]
}

interface SLIFPage {
  pageIndex: number
  width: number; height: number
  items: SLIFItem[]
}

interface SLIFItem {
  /** 源节点 ID (用于命中检测、增量分页早停比对) */
  nodeId: string
  /** 源节点类型 (用于 ParticleRegistry 获取对应 Particle) */
  nodeType: string                     // 'text' | 'table' | 'image' | 'separator' | 'footnote' | ...
  /** 在源节点内的行偏移 (用于 PageStartTable 早停比对, §3.2) */
  lineOffset?: number

  type: string                         // 渲染类型 (同 nodeType)
  text?: string                        // 文本内容 (type='text')
  x: number; y: number                // 逻辑坐标 (文档坐标系)
  width: number; height: number
  ascent: number; descent: number
  font: string; size: number
  bold?: boolean; italic?: boolean
  underline?: boolean; strikeout?: boolean
  color?: string; highlight?: string
  superscript?: boolean; subscript?: boolean
  // table 扩展: rows: SLIFRow[], image 扩展: imageUrl, 等等
}

/** PageItem — @deprecated v20.19: ModelA 残留, 统一使用 SLIFItem */
type PageItem = SLIFItem
/** LayoutBox — @deprecated v20.19: 与 SLIFItem 字段重复, 统一使用 SLIFItem */
type LayoutBox = SLIFItem
/** ExportItem — @deprecated v20.19: 与 SLIFItem 字段重复, 统一使用 SLIFItem */
type ExportItem = SLIFItem
```
### 7.8 文档比较 diff 引擎

**问题**: 质控审核需要对比两个版本文档的差异——并排展示、高亮新增/删除/修改内容。需要文档级的结构化 diff 算法。

**方案**: 基于 DocumentTree + NodePool 的树形 diff，而非纯文本逐行比较。

```typescript
type DiffGranularity = 'node' | 'character'

interface DiffResult {
  type: 'unchanged' | 'added' | 'deleted' | 'modified'
  oldNodeId?: string
  newNodeId?: string
  details: DiffDetail[]
}

interface DiffDetail {
  type: 'text_changed' | 'style_changed' | 'node_moved' | 'node_replaced'
  oldValue?: unknown
  newValue?: unknown
}

class DocumentDiffer {
  /**
   * 比较两个 DocumentTree:
   *   1. 对 body.children 做 LCS (最长公共子序列)
   *      匹配键 = node.id 或 node 内容特征
   *   2. 匹配节点递归 compareChildren()
   *   3. 未匹配旧节点 → deleted, 未匹配新节点 → added
   *   4. 内容不同的 InlineNode → modified
   */
  compare(old: DocumentTree, new_: DocumentTree): DiffResult[]

  /**
   * 渲染: 两个 Editor 并排, 共享 ScrollSync
   *   左: 旧文档, deleted=红色删除线
   *   右: 新文档, added=绿色下划线, modified=绿色高亮
   */
  renderDiff(result: DiffResult[], oldDoc: DocumentTree, newDoc: DocumentTree): void

  acceptDiff(index: number, target: DocumentTree): void
  rejectDiff(index: number, target: DocumentTree): void
}
```

```
diff 管线:
  版本(v5) → loadDocument() → oldTree
  版本(v6) → loadDocument() → newTree
  DocumentDiffer.compare() → DiffResult[]
  DiffRenderer 并排渲染
  用户逐处 accept/reject → 更新目标文档
```


## 8. 交互系统

### 8.1 Draw.ts 拆分边界方案

**问题**: 之前只提出"拆分为 EventHandler/IMEHandler/ClipboardHandler"，但模块职责、通信方式、依赖方向没有定义。

**方案 (v20.2 — 与 §7.3 对齐)**: EventBus 解耦，各 Handler 独立模块。LayoutEngine 独立负责布局计算，Draw 退化为纯渲染消费者。

```
┌──────────────────────────────────────────────────────────────────┐
│                    LayoutEngine (layout/)                         │
│  recomputeLayout(document, dirtyTracker) → SLIFPage[]            │
│                                                                   │
│  依赖: DocumentTree, NodePool, LineBreaker, PageBreaker          │
│  不依赖: Canvas, Draw, LayeredRenderer                           │
└──────────┬───────────────────────────────────────────────────────┘
           │ SLIFPage[]
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Draw (渲染消费者)                             │
│  render(slifPages, state, dirtyTracker) → 调度 LayeredRenderer   │
│                                                                   │
│  依赖: SLIFPage[], EditorRuntimeState, LayeredRenderer           │
│  不依赖: DocumentTree, NodePool, LineBreaker, PageBreaker        │
│  不依赖: 任何 Handler (通过 EventBus 接收事件)                    │
└──────────────────────────────────────────────────────────────────┘
         ▲                            ▲
         │ EventBus                   │ EventBus
         │ 'render:request'           │ 'layout:changed'
         │                            │
┌────────┴────────────┐    ┌──────────┴──────────┐
│   InputPipeline      │    │   CommandManager    │
│   (事件 → Command)   │    │   (Command 执行)    │
│                      │    │                     │
│ MouseHandler ────────┤    │ execute(command)    │
│ KeyboardHandler ─────┤    │   → forward(doc)    │
│ IMEHandler ──────────┤    │   → StatePatch      │
│ ClipboardHandler ────┤    │   → DirtyTracker    │
│                      │    │   → EventBus.emit   │
└──────────────────────┘    └─────────────────────┘
```

**Draw 与 LayoutEngine/LayeredRenderer 的职责**: 
- LayoutEngine: `layout/` 层，无 Canvas 依赖，产出 SLIFPage[] (§7.3)
- Draw: `render/` 层编排器，接收 SLIFPage[] → 调用 LayeredRenderer 三层 Canvas
- LayeredRenderer: 静态/内容/交互三层 Canvas 的具体操作，被 Draw 驱动

#### EventBus 接口

```typescript
type EngineEvent =
  | 'render:request'        // 请求重绘
  | 'layout:changed'        // 布局已变更
  | 'state:changed'         // EditorRuntimeState 已变更
  | 'document:changed'      // DocumentTree 已变更
  | 'cursor:moved'          // 光标位置移动
  | 'selection:changed'     // 选区变更
  | 'mode:changed'          // 编辑器模式切换
  | 'scale:changed'         // 缩放比例变更
  | 'yjs:synced'            // Y.Doc 增量已同步到 NodePool

/** 事件载荷映射 — 每种事件的类型化载荷 (v20.13) */
interface EventPayloadMap {
  'render:request':     []                                          // 无载荷, 仅触发重绘
  'layout:changed':     [slifPages: SLIFPage[]]                      // 布局引擎产出
  'state:changed':      [patch: StatePatch]                          // 状态变更详情
  'document:changed':   [{ invalidation: InvalidationScope; dirtyNodeIds: string[] }]  // v20.22: 增量载荷, 非全量快照
  'cursor:moved':       [cursor: CursorState]                        // 新光标位置
  'selection:changed':  [selection: SelectionState]                  // 新选区
  'mode:changed':       [mode: EditorMode]                           // 新模式
  'scale:changed':      [scale: number]                              // 新缩放比例
  'yjs:synced':         []                                          // Y.Doc 同步完成
}

interface EventBus {
  on<E extends keyof EventPayloadMap>(event: E, handler: (...args: EventPayloadMap[E]) => void): void
  off<E extends keyof EventPayloadMap>(event: E, handler: (...args: EventPayloadMap[E]) => void): void
  emit<E extends keyof EventPayloadMap>(event: E, ...args: EventPayloadMap[E]): void
}
```

#### 各 Handler 职责与通信

| 模块                       | 职责                                                                       | 监听                            | 发出                                                                            |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| **MouseHandler**     | mousedown/mousemove/mouseup → 计算新光标/选区 → new SetCursorCommand/SetSelectionCommand → CommandManager.execute() | DOM mouse events                | CommandManager → emit `cursor:moved` / `selection:changed` (v20.18: MouseHandler 不再直接 emit) |
| **KeyboardHandler**  | keydown → 可见字符/导航/删除/快捷键 → 构建 Command                       | DOM keydown                     | 委托 `CommandManager.execute()`                                               |
| **IMEHandler**       | 管理隐藏 textarea → compositionstart/update/end → 构造 InsertTextCommand | textarea composition events     | `render:request` (预览), `CommandManager.execute()` (确认)                  |
| **ClipboardHandler** | copy/cut/paste → 文本提取/Command 构建                                    | textarea paste, window copy/cut | `CommandManager.execute()` (paste 时)                                         |
| **CommandManager**   | 接收 Command → forward(doc) → StatePatch → DirtyTracker → emit 事件    | 所有 Handler 调用               | `document:changed`, `state:changed`, `layout:changed`, `render:request` |

#### 依赖方向 (单向，避免循环)

```
Handler → CommandManager → DocumentTree + EditorRuntimeState
Handler → EventBus (emit)
LayoutEngine ← EventBus (listen: 'layout:changed')
LayoutEngine → DocumentTree + NodePool (readonly) —— 布局计算, 不碰 Canvas
Draw ← EventBus (listen: 'render:request')
Draw → SLIFPage[] (由 LayoutEngine 产出, readonly)
Draw → LayeredRenderer (驱动三层 Canvas)
Draw → CoordinateSystem (readonly)
Draw → EditorRuntimeState (readonly) — 光标/选区/IME 绘制必需

#### 模块依赖矩阵 (v20.29: 替代旧版混乱文本)

| 模块 | → DocumentTree | → NodePool | → EditorRuntimeState | → SLIFPage[] | → LayeredRenderer | → EventBus |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| LayoutEngine | R | R | — | W | — | L |
| Draw | — | — | **R** | R | W | L |
| LayeredRenderer | — | — | **R** | — | — | — |
| CommandManager | W | W | W | — | — | E |
| Handler (Mouse/Keyboard/IME/Clipboard) | — | — | —* | — | — | E |

R=只读 W=可写 E=emit L=listen —=禁止访问
*Handler 不直接读写 EditorRuntimeState, 通过 SetCursorCommand/SetSelectionCommand 走 CommandManager (§6.7)

禁止:
  Draw/LayeredRenderer → DocumentTree          (布局已在 LayoutEngine 完成)
  Draw/LayeredRenderer → NodePool              (布局已在 LayoutEngine 完成)
  Handler → DocumentTree/NodePool/EditorRuntimeState (必须走 CommandManager)
  Handler → Handler                            (不直接通信, 通过 CommandManager 中转)
  Draw → Handler                               (反向依赖)
```

### 8.2 选区模型增强

**问题**: 当前仅定义了 `anchor/focus` 的基础结构，缺失选区标准化规则、跨块选区语义、表格选区模型。

**方案**:

```typescript
// 选区粒度 — 分层表达
type SelectionGranularity = 'character' | 'node' | 'block' | 'table'

interface SelectionState {
  anchor: CursorState; focus: CursorState; active: boolean
  /** 选区粒度 */
  granularity: SelectionGranularity
}

/** 标准化方向: 始终 start ≤ end (前闭后开) */
function normalizeSelection(sel: SelectionState): { start: CursorState; end: CursorState } {
  return comparePaths(sel.anchor.paragraphPath, sel.focus.paragraphPath) <= 0
    ? { start: sel.anchor, end: sel.focus }
    : { start: sel.focus, end: sel.anchor }
}

/** 表格选区独立模型 */
interface TableSelection {
  startCell: { row: number; col: number }
  endCell:   { row: number; col: number }
  type: 'cell' | 'row' | 'col' | 'table'
}
```

### 8.3 命令事务与合并

**问题**: 单操作单命令，连续输入字符时 Undo 栈逐条入栈，撤销要几十次才能回退一步。

**方案**:

```typescript
class CommandUndoRedoStack {
  private undoStack: ICommand[] = []
  private redoStack: ICommand[] = []
  readonly maxDepth: number
  /** 当前正在构建的事务 (null = 不在事务中) */
  private currentTransaction: ICommand[] | null = null
  private readonly MERGE_WINDOW_MS = 500  // 同类操作合并窗口

  /** 开始事务 — 事务内所有命令作为一个历史单元 */
  beginTransaction(): void { this.currentTransaction = [] }

  /** 提交事务 — 合并为一条 MacroCommand 入栈 */
  commitTransaction(): void {
    if (!this.currentTransaction || this.currentTransaction.length === 0) return
    if (this.currentTransaction.length === 1) {
      this.pushSingle(this.currentTransaction[0])
    } else {
      this.pushSingle(new MacroCommand(this.currentTransaction))
    }
    this.currentTransaction = null
  }

  /** 自动合并: 同类连续操作 (如连续打字) 合并为一条历史 */
  /** @deprecated v20.17: 合并逻辑统一在 §6.4 CommandUndoRedoStack.execute() 中, §8.3 不再重复定义 */
}

/** 可合并的命令接口 (v19.15: 统一为不可变语义, 与 §6.4 mergeWith 一致) */
interface MergeableCommand extends ICommand {
  canMergeWith(other: ICommand): boolean
  /** 返回新命令（不可变），不修改 this */
  mergeWith(other: ICommand): ICommand
}

/** 宏命令 — 将多个命令打包为一个事务 */
class MacroCommand implements ICommand {
  constructor(private commands: ICommand[]) {}
  readonly type = 'macro'
  forward(doc: DocumentTree): StatePatch | null {
    let lastPatch: StatePatch | null = null
    for (const cmd of this.commands) lastPatch = cmd.forward(doc)
    return lastPatch
  }
  invert(): ICommand { return new MacroCommand(this.commands.map(c => c.invert()).reverse()) }
}
```

### 8.4 InputComposer — IME 抽象层

**问题**: IME 实现依赖隐藏 textarea 且耦合在 Draw 中。不同浏览器/输入法的 composition 事件行为差异极大。

**方案**:

```typescript
/**
 * InputComposer — 输入法抽象层
 * 向上暴露统一事件，向下封装浏览器差异
 */
interface IInputComposer {
  /** 组合开始 (compositionstart) */
  onCompositionStart(callback: () => void): void
  /** 组合更新 (compositionupdate) — 仅用于预览渲染 */
  onCompositionUpdate(callback: (text: string, cursorRect: DOMRect) => void): void
  /** 组合确认 (compositionend) — 提交最终文本 */
  onCompositionEnd(callback: (text: string) => void): void

  /** 获取当前组合文本 */
  getComposingText(): string
  /** 更新光标位置 (用于候选框定位) */
  updateCursorRect(rect: DOMRect): void
  /** 聚焦/失焦输入区域 */
  focus(): void; blur(): void
  destroy(): void
}

/**
 * 浏览器兼容适配:
 * - Chrome/Edge: compositionstart → update(×N) → end, 标准流程
 * - Firefox: compositionend 后额外触发一次 input 事件, 需要 debounce 去重
 * - Safari: composition 期间 keydown 仍触发, 需要通过 composing 标志屏蔽
 *
 * 封装策略:
 * - 统一使用 hidden textarea 作为 composition 宿主
 * - compositionstart 设置 composing=true 屏蔽 keydown
 * - compositionend 提交文本后延迟 50ms 恢复 composing=false (兼容 Firefox)
 * - 通过 updateCursorRect 传递候选框位置给浏览器
 */
class InputComposer implements IInputComposer {
  private textarea: HTMLTextAreaElement
  private composing = false
  private compositionJustEnded = false
  private callbacks = { start: [] as (() => void)[], update: [] as ((t: string, r: DOMRect) => void)[], end: [] as ((t: string) => void)[] }

  constructor(container: HTMLElement) {
    this.textarea = document.createElement('textarea')
    Object.assign(this.textarea.style, {
      position: 'fixed', opacity: '0', width: '1px', height: '20px',
      left: '0', top: '0', border: 'none', outline: 'none',
      resize: 'none', overflow: 'hidden',
    })
    container.appendChild(this.textarea)
    this.textarea.addEventListener('compositionstart', () => {
      this.composing = true; this.compositionJustEnded = false
      this.callbacks.start.forEach(cb => cb())
    })
    this.textarea.addEventListener('compositionupdate', (e: CompositionEvent) => {
      this.callbacks.update.forEach(cb => cb(e.data || '', this.textarea.getBoundingClientRect()))
    })
    this.textarea.addEventListener('compositionend', (e: CompositionEvent) => {
      this.composing = false; this.compositionJustEnded = true
      this.textarea.value = ''
      const text = e.data || ''
      if (text) this.callbacks.end.forEach(cb => cb(text))
      setTimeout(() => { this.compositionJustEnded = false }, 50)
    })
    this.textarea.addEventListener('input', () => {
      if (this.compositionJustEnded || this.composing) return  // Firefox 去重
      const val = this.textarea.value
      if (val) { this.callbacks.end.forEach(cb => cb(val)); this.textarea.value = '' }
    })
  }
  // ... onCompositionStart/Update/End 等接口实现
  destroy(): void { this.textarea.remove() }
}
```

### 8.5 插件生命周期

**问题**: 仅有 Particle 注册表，没有完整的插件生命周期、扩展点、权限边界。

**方案**:

```typescript
interface IPlugin {
  readonly name: string; readonly version: string

  /** 生命周期 */
  install(ctx: PluginContext): void    // 注册扩展点
  enable(): void                        // 激活
  disable(): void                       // 停用 (不卸载)
  destroy(): void                       // 清理资源
}

interface PluginContext {
  /** 注册自定义节点类型 */
  registerNodeType(type: string, factory: NodeFactory): void
  /** 注册渲染粒子 */
  registerParticle(particle: IParticle): void
  /** 注册命令 (用于插件自定义操作) */
  registerCommand(type: string, commandCtor: new (...args: any[]) => ICommand): void
  /** 监听引擎事件 */
  on<E extends keyof EventPayloadMap>(event: E, handler: (...args: EventPayloadMap[E]) => void): void
  /** 注入工具栏/菜单项 */
  registerToolbarItem(group: string, item: ToolbarItem): void
  registerContextMenuItem(item: ContextMenuItem): void
  /** 获取公开 API (插件只能通过这些 API 操作文档) */
  getAPI(): PluginAPI
}

interface PluginAPI {
  getDocument(): DocumentTree
  getRuntimeState(): EditorRuntimeState
  executeCommand(command: ICommand): void
  // 禁止: 直接修改内部状态 / 访问 Draw 实例 / 修改 NodePool
}

class PluginManager {
  private plugins = new Map<string, IPlugin>()

  install(plugin: IPlugin): void { /* install → enable */ }
  uninstall(name: string): void { /* disable → destroy */ }
  get(name: string): IPlugin | undefined
}
```

## 9. 表格模型

### 9.1 列宽计算规则

```
优先级 (高 → 低):
  1. 固定宽度 (mode='fixed')     — 直接使用 ColumnDefinition.width, 不参与自适应
  2. 百分比 (mode='percentage')  — 按可用宽度 × (width/100) 计算, 总和超 100% 时等比缩放
  3. 自适应 (mode='auto')        — 扫描该列所有单元格内容宽度, 取最大值, 剩余空间均分给所有 auto 列

计算流程:
  availableWidth = pageWidth - marginLeft - marginRight - sum(fixed columns) - sum(percentage columns 换算)
  each auto column width = max(column.minWidth, availableWidth / autoColumnCount)
```

### 9.2 合并单元格网格矩阵

```typescript
/**
 * MergeMatrix 维护规则:
 *
 * 1. matrix.grid[r][c] 存储该位置的单元格 ID
 * 2. 被 rowspan/colspan 覆盖的格子填充相同的 ID (非 null)
 * 3. 空位 (被合并而产生的不可达位置) = null
 * 4. 重建时机: 表格结构变更 (插入/删除行/列, 合并/拆分单元格)
 * 5. 选区逻辑: 基于 grid 矩阵做矩形选区, 自动跳过 null 格
 * 6. 命中检测: docX 落在单元格的合并矩形区域内 → 返回主格 ID
 */

function buildMergeMatrix(table: Table, pool: NodePool): MergeMatrix {  // v20.31: 补 pool 参数, children 全 ID 化修正
  const rowIds = table.children
  const rows = rowIds.length
  const cols = Math.max(...rowIds.map(rowId => {
    const row = pool.nodes.get(rowId) as TableRow
    return pool.getChildren(row.id).reduce((sum, cellId) => {
      const cell = pool.nodes.get(cellId) as TableCell
      return sum + (cell.colspan || 1)
    }, 0)
  }))
  const grid: (string | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null))

  for (let r = 0; r < rows; r++) {
    let c = 0
    const row = pool.nodes.get(rowIds[r]) as TableRow
    for (const cellId of pool.getChildren(row.id)) {
      const cell = pool.nodes.get(cellId) as TableCell
      while (c < cols && grid[r][c] !== null) c++
      const rs = cell.rowspan || 1; const cs = cell.colspan || 1
      for (let dr = 0; dr < rs; dr++)
        for (let dc = 0; dc < cs; dc++)
          if (r + dr < rows && c + dc < cols) grid[r + dr][c + dc] = cell.id
      c += cs
    }
  }
  return { rows, cols, grid, spans: new Map() }
}
```

### 9.3 跨页断表规则

```
1. 表头重复: Table.pageBreak.repeatHeader=true 时，每页顶部重复第一行 (或前 N 行)
2. 断行最小高度: Table.pageBreak.minRowsBeforeBreak 指定每页最少保留的行数
   (避免页面底部只剩 1 行表体，孤行控制)
3. 单元格内容拆分: 优先在行边界分页，禁止在单元格内部断页
   (单元格内容超过单页高度时 → 该行独占一页，从下一页开始)
4. 续接标记: Table.pageBreak.continuationLabel (如 "续表") 渲染在后续页表头上方
```

## 10. 前端技术栈与模块结构

### 10.1 当前模块结构

```
src/engine/
├── index.ts                      # 引擎统一导出
├── Editor.ts                     # 编辑器入口 (Facade, 49行)
├── document/
│   ├── DocumentModel.ts          # 树形文档模型 (TypeScript 类型 + ID生成)
│   └── ElementFormatter.ts       # 节点工厂 + 树操作 + 快照 + UndoRedoStack
├── layout/
│   ├── TextMeasurer.ts           # Canvas measureText + LRU 缓存 (2000条)
│   ├── LineBreaker.ts            # CJK+英文混排换行引擎 (待集成)
│   └── PageBreaker.ts            # 分页引擎 (孤行/寡行控制, 待集成)
├── render/
│   ├── Draw.ts                   # 核心渲染器 (709行, 含布局/渲染/事件/IME/编辑/选区/撤销)
│   └── particles/
│       └── TextParticle.ts       # 文本粒子渲染器 (static render 方法)
├── state/
│   └── Position.ts               # 坐标计算器 (当前未集成到 Draw.ts)
└── __tests__/
    ├── ModelD.test.ts            # 文档模型 + 树操作单元测试
    └── Draw.test.ts              # 渲染器集成测试 (DOM 依赖)
```

### 10.2 前端技术栈

| 层       | 技术         | 版本   | 说明                              |
| -------- | ------------ | ------ | --------------------------------- |
| 框架     | React        | 18.3+  | 函数组件 + Hooks                  |
| 语言     | TypeScript   | 5.5+   | strict mode                       |
| 构建     | Vite         | 5.4+   | HMR + ESBuild                     |
| CSS      | Tailwind CSS | 3.4+   | 原子化样式                        |
| UI 组件  | Radix UI     | latest | dialog/dropdown-menu/tooltip/tabs |
| 图标     | Lucide React | 0.400+ | 禁止 emoji                        |
| 状态管理 | Zustand      | 5.x    | 轻量、不可变                      |
| HTTP     | Axios        | 1.7+   | 拦截器 + JWT 注入                 |
| 测试     | Vitest       | 2.x    | 单元测试 + jsdom                  |

## 11. 医学质控引擎

**修正**:

1. 规则 JSONLogic DSL 化：可入库、可热更新、TS/Java 双端执行
2. 索引驱动：单次 traverse 建 Map<HDSD, SmartTextNode[]>，所有规则共享
3. 评分 cap：单规则扣分 ≤ weight% × 1.5，通过率归一化
4. 异步 check() + 字典预取缓存
5. 统一状态机：t_document.status 唯一状态字段

### 11.1 质控规则 DSL

```sql
CREATE TABLE t_qc_rule (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    type        VARCHAR(20)  NOT NULL,  -- completeness / consistency / standardization
    severity    VARCHAR(10)  NOT NULL DEFAULT 'error',  -- error / warning / info
    weight      INT          NOT NULL DEFAULT 10,
    description TEXT,
    /** JSONLogic 规则表达式 (TS/Java 双端可执行) */
    expression  JSON         NOT NULL,
    enabled     TINYINT      DEFAULT 1,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 预置种子数据:
INSERT INTO t_qc_rule VALUES ('qc_discharge_date', '出院日期 >= 入院日期', 'consistency', 'error', 15, '...',
  '{"and":[{"var":"HDSD00.01.020"},{"var":"HDSD00.01.010"},{">=":[{"var":"HDSD00.01.020"},{"var":"HDSD00.01.010"}]}]}');
INSERT INTO t_qc_rule VALUES ('qc_bp_sys_dia', '收缩压 > 舒张压', 'consistency', 'error', 10, '...',
  '{">":[{"var":"HDSD00.02.001"},{"var":"HDSD00.02.002"}]}');
```

### 11.2 索引驱动质控引擎

```typescript
class QCEngine {
  private rules: QCRule[] = []
  private dictCache = new Map<string, Set<string>>()  // dictionary ID → 合法值集合
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly DEBOUNCE_MS = 1000
  private worker: Worker | null = null  // Web Worker

  // ================================================================
  // 增量索引 (v20.3: 真正增量, 非全量 traverse)
  // ================================================================
  /** HDSD编码 → SmartTextNode 列表 (持久化, 跨 check 调用共享) */
  private hdsdIndex = new Map<string, SmartTextNode[]>()
  /** 上次构建时的 nodeVersion 快照 (nodeId → version) */
  private indexVersions = new Map<string, number>()
  /** 索引是否已初始化 (首次全量) */
  private indexReady = false

  /** 增量更新索引 (由 NodePool.nodeVersions 驱动, 仅处理脏节点) */
  private updateIndex(pool: NodePool, dirtyNodeIds: Set<string>): void {
    if (!this.indexReady) {
      // 首次调用: 全量构建 baseline
      this.hdsdIndex.clear()
      this.indexVersions.clear()
      // traversePool 从 body/header/footer/footnotes/endnotes 五个根遍历
      const roots = [pool.rootIds.body, ...(pool.rootIds.header ?? []),
                     ...(pool.rootIds.footer ?? []), ...(pool.rootIds.footnotes ?? []),
                     ...(pool.rootIds.endnotes ?? [])]
      for (const rootId of roots) {
        traversePool(pool, rootId, (node) => {
          if (node.type === 'smarttext') {
            const st = node as SmartTextNode
            const key = st.element.code.internal
            if (!this.hdsdIndex.has(key)) this.hdsdIndex.set(key, [])
            this.hdsdIndex.get(key)!.push(st)
            this.indexVersions.set(st.id, pool.getNodeVersion(st.id))
          }
        })
      }
      this.indexReady = true
      return
    }

    // 增量: 仅重建版本号发生变化的 SmartTextNode 索引条目
    for (const nodeId of dirtyNodeIds) {
      const node = pool.nodes.get(nodeId)
      if (node?.type !== 'smarttext') continue
      const currentVersion = pool.getNodeVersion(nodeId)
      if (this.indexVersions.get(nodeId) === currentVersion) continue  // 未变, 跳过

      const st = node as SmartTextNode
      const oldKey = [...this.hdsdIndex.entries()]
        .find(([, list]) => list.some(n => n.id === nodeId))?.[0]
      const newKey = st.element.code.internal

      // 从旧编码条目中移除
      if (oldKey && oldKey !== newKey) {
        const oldList = this.hdsdIndex.get(oldKey)
        if (oldList) {
          const filtered = oldList.filter(n => n.id !== nodeId)
          if (filtered.length) this.hdsdIndex.set(oldKey, filtered)
          else this.hdsdIndex.delete(oldKey)
        }
      }

      // 更新或添加到新编码条目
      if (newKey) {
        const newList = this.hdsdIndex.get(newKey) ?? []
        const existing = newList.findIndex(n => n.id === nodeId)
        if (existing >= 0) newList[existing] = st
        else newList.push(st)
        this.hdsdIndex.set(newKey, newList)
      }

      this.indexVersions.set(nodeId, currentVersion)
    }
  }

  /** 规则集变更时强制全量重建 */
  invalidateIndex(): void { this.indexReady = false }

  // ================================================================
  /** 编辑后延迟执行 (由 CommandManager.execute 后触发) */
  scheduleCheck(pool: NodePool, dirtyNodeIds: Set<string>): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.check(pool, dirtyNodeIds), this.DEBOUNCE_MS)
  }

  async check(pool: NodePool, dirtyNodeIds: Set<string>): Promise<QCResult> {
    // 增量更新索引 (仅脏节点)
    this.updateIndex(pool, dirtyNodeIds)
    // JSONLogic 规则在 Web Worker 中执行 (纯函数, 可序列化)
    const findings = (await Promise.all(
      this.rules.map(rule => rule.check(pool, this.hdsdIndex, this.dictCache))
    )).flat()
    return { findings, score: new QCScorer().score(findings, this.rules), timestamp: Date.now() }
  }
}

/** 触发方与生命周期:
 *  CommandManager.execute() → StatePatch.invalidation === 'node'(SmartTextNode变更)
 *    → DirtyTracker.queryDirtySmartTextNodes() → Set<string>
 *    → QCEngine.scheduleCheck(pool, dirtyNodeIds)
 *  indexReady === false 时, updateIndex 先执行全量 baseline
 * 规则集(QRule[])变更时调用 invalidateIndex() 强制全量重建
 */

// 评分修正:
class QCScorer {
  score(findings: QCFinding[], rules: QCRule[]): QCScore {
    const totalWeight = rules.reduce((s, r) => s + r.weight, 0) || 1
    const maxDeductionPerRule = (weight: number) => (weight / totalWeight * 100) * 1.5  // cap
    const byType = { completeness: 0, consistency: 0, standardization: 0 }

    for (const f of findings) {
      const rule = rules.find(r => r.id === f.ruleId)
      if (!rule) continue
      const deduction = Math.min(
        maxDeductionPerRule(rule.weight),
        f.severity === 'error' ? rule.weight / totalWeight * 100 : (rule.weight / totalWeight * 100) / 3
      )
      byType[f.type] += deduction
    }

    const completeness     = Math.max(0, 40 - byType.completeness)
    const consistency      = Math.max(0, 30 - byType.consistency)
    const standardization  = Math.max(0, 30 - byType.standardization)
    const total = completeness + consistency + standardization
    return { total, completeness, consistency, standardization,
             grade: total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : 'D',
             findingCount: { error: findings.filter(f=>f.severity==='error').length,
                             warning: findings.filter(f=>f.severity==='warning').length,
                             info: findings.filter(f=>f.severity==='info').length }}
  }
}
```

### 11.3 统一文档状态机

```
                      doctor                    qc_reviewer
  draft ──提交──→ submitted ──审核──→ reviewed ──→ 归档
    ↑                │                    │
    └── 驳回 ←────── rejected ←──────────┘
         (doctor)     (qc_reviewer)

t_document.status: 唯一状态字段 (替代 t_qc_review.status 双轨)
  draft → submitted → reviewed / rejected → (rejected→draft)

权限矩阵:
  submit:    role=doctor
  review:    role=qc_reviewer + t_document_permission(editor)
  archive:   role=admin
```


## 12. 后端架构设计

### 12.1 后端修正总览

**修正**:

1. **RBAC 用户体系**: 补 t_user + t_role + t_user_role 最小模型，JWT role/level claims
2. **WebSocket**: MVP 单实例 + sticky session，Nginx ip_hash
3. **并发锁**: Redis SET NX EX 30s 心跳续期，409 三选一 UI
4. **加密**: 字段级 AES-GCM（仅 privacy=true 的 SmartTextNode.text），content 整体不加密
5. **localStorage**: 最近一次 + 超 2MB 跳过告警
6. **PDF 许可证**: 选型改为 OpenPDF (LGPL/MPL) / Apache PDFBox (Apache 2.0)
7. **可用性**: MVP 99.5% 单点，生产 99.9% (MySQL 主从 + Redis Sentinel)

### 12.1.1 RBAC 用户模型

```sql
CREATE TABLE t_user (
    id       VARCHAR(64) PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,    -- BCrypt
    real_name VARCHAR(100),
    enabled  TINYINT DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE t_role (
    id   VARCHAR(64) PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE   -- admin / designer / doctor / qc_reviewer / viewer
);

CREATE TABLE t_user_role (
    user_id VARCHAR(64) NOT NULL,
    role_id VARCHAR(64) NOT NULL,
    PRIMARY KEY (user_id, role_id)
);

-- JWT claims: { sub: userId, username, roles: ['doctor'], level: 3, iat, exp }
-- PermissionService.checkDocumentAccess(userId, documentId, requiredPermission)
--   1. 查 t_document_permission 表 (owner/editor/commenter/viewer)
--   2. JWT role='admin' 旁路全部权限
```

### 12.1.2 并发编辑锁 (v20.11 — Phase 1 独占, Phase 2 废弃)

**与 F13.1 多人协作的分工**: Redis 编辑锁解决的是**冲突保存**问题（"谁在编辑这份文档、防止同时保存覆盖"），Yjs CRDT 解决的是**并发编辑**问题（"多人在同一文档内各写各的"）——两者处于不同层级。Phase 1 无 Yjs，编辑锁是必需的（防止两份 PUT 互相覆盖）；Phase 2 Yjs 接管后编辑锁**废弃**（CRDT 自动合并编辑，乐观锁 version 字段在 SnapshotBridge PUT 时仍校验）。

```sql
-- Phase 1 (单用户): 使用编辑锁防止并发打开同一文档
-- Redis: SET doc_lock:{documentId} {userId} NX EX 30
-- 心跳: 前端每 15s PUT /api/v1/documents/{id}/lock/heartbeat 续期 30s
-- 释放: 正常关闭/401/页面卸载时 DELETE lock key

-- Phase 2 (协作): 编辑锁废弃——多人同时编辑由 Yjs CRDT 保证一致性
-- 仅保留 t_document_lock 表用于"谁正在编辑"的状态展示 (非互斥)

CREATE TABLE t_document_lock (
    document_id VARCHAR(64) PRIMARY KEY,
    user_id     VARCHAR(64) NOT NULL,
    locked_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL
);
-- Phase 1: 互斥锁 (SET NX)
-- Phase 2: 状态记录 (仅记录在线编辑者, 不互斥)
```

**409 冲突前端三选一**:

```
获取锁失败 → 返回 { status: 'locked', lockedBy: '张三', serverVersion: 6, lockedSince: '...' }
前端展示:
  [查看差异] — 展示 baseVersion..serverVersion 的 diff
  [强制覆盖] — 用户确认后 PUT，替换锁持有者
  [取消]     — 保留我的编辑，暂不保存
```

### 12.1.3 字段级加密

```
AES-256-GCM 字段级加密:
  仅加密 SmartTextNode 中 element.privacy.enabled===true 的 text 值
  content 整体不加密 → JSON_SCHEMA_VALID + JSON 路径查询正常工作

密钥管理:
  数据密钥 (DEK) 每文档随机生成，AES-256-GCM
  密钥加密密钥 (KEK) 由环境变量注入，用于加密 DEK
  加密后 DEK 存储在 t_document.encryption_key 字段

  存入: DEK=randomBytes(32) → ciphertext=AES_GCM(DEK, plaintext) → 替换 text
        encryptedDEK=AES_WRAP(KEK, DEK) → 存 encryption_key
  读取: DEK=AES_UNWRAP(KEK, encryptedDEK) → plaintext=AES_GCM_DECRYPT(DEK, ciphertext)
  轮换: KEK 版本化, t_document 记录 kek_version, 批量异步轮换
```

#### 加密与校验/QC 的管线顺序 (v20.6)

**问题**: 加密后 `text` 是 Base64 密文，dataType='N'/'D' 的格式校验和 QC 规则(数值范围/日期逻辑)在密文上无法执行。

**管线顺序**:

```
写入 (前端 → 后端):
  SmartTextNode.text (明文)
    → 前端 validateDocumentTree() [明文可校验 dataType/maxLength 等]
    → 前端 QCEngine.check() [明文, 完整 QC 规则]
    → 加密层: AES_GCM(DEK, text) → ciphertext
    → PUT /api/v1/documents/{id} [密文入 JSON]
    → 后端 JSON_SCHEMA_VALID [跳过 privacy=true 字段, 只校验结构]
    → 后端 QC [跳过加密字段, 标注 skippedInQC]

读取 (后端 → 前端):
  GET → 后端 JSON_SCHEMA_VALID 可通过(结构不变)
    → 前端接收密文
    → 解密层: AES_GCM_DECRYPT(DEK, ciphertext) → text (明文)
    → 前端 QCEngine.check() [解密后明文, QC 规则正常执行]
```

**密钥访问权限**:

| 角色 | KEK 访问 | 解密能力 | QC/校验能力 |
|------|----------|----------|------------|
| 前端(编辑者) | 通过 API 获取 DEK | 可解密 | 加密前后均可 |
| 后端 API 层 | 持有 KEK | 可解密 DEK | 仅结构校验 |
| QC 服务 | **不持有 KEK** | 不可解密 | 仅非加密字段 |
| AI MCP Server | 继承当前用户权限 | 按用户级别 | 同用户 |

**设计决策**: 后端不解密。加密字段在服务端是 opaque blob，QC 和校验对其跳过。医疗合规要求敏感数据的纯文本只在持有 KEK 的客户端内存中存在。后端 QC 服务若需校验加密字段(如"出院日期≥入院日期")，通过标注 `skippedInQC` 提示前端在解密后重新执行受影响的规则。

```

### 12.1.4 PDF 许可证与选型

| 库            | 许可证     | 选择                          |
| ------------- | ---------- | ----------------------------- |
| Apache PDFBox | Apache 2.0 | **推荐** (PDF 生成首选) |
| OpenPDF       | LGPL/MPL   | 备选 (iText 4 fork)           |
| suwell/ofdrw  | Apache 2.0 | OFD 生成专用                  |

### 12.1.5 可用性分级

| 等级    | 拓扑                                                            | 目标  | 阶段   |
| ------- | --------------------------------------------------------------- | ----- | ------ |
| MVP     | 单 MySQL + 单 Redis + 单 App                                    | 99.5% | 当前   |
| 生产    | MySQL 主从 + Redis Sentinel + App ×2 + Nginx                   | 99.9% | 联调后 |
| RPO/RTO | MVP: RPO=备份间隔(默认1小时), RTO=4h; 生产: RPO<1min, RTO<5min |       |        |

### 12.1.6 localStorage 配额

```typescript
class AutoSaveManager {
  private backupToLocalStorage(document: DocumentTree): void {
    const json = JSON.stringify(document)
    if (json.length > 2 * 1024 * 1024) {
      console.warn('[AutoSave] Document too large for localStorage backup, skipped')
      return
    }
    try {
      localStorage.setItem(`doc_backup_${document.id}`, json)
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        this.clearOldBackups()
        try { localStorage.setItem(`doc_backup_${document.id}`, json) } catch {}
      }
    }
  }
}
```

### 12.1.7 审计 diff 策略

```
审计日志 detail 字段: 不存完整新旧值 diff
  存储: { action, changedFields: ['title','body'], versionFrom: 5, versionTo: 6, sizeBytes: 12345 }
  完整快照: t_document_version 表已有版本内容存储
  成本: 审计日志单条 < 1KB, 100 万条 < 1GB
```

### 12.1.8 WebSocket 多实例协作架构 (v19.8)

**问题**: Yjs 房间状态是内存态（`Y.Doc` 实例仅存在于单个进程内）。生产拓扑 App×2 时，同文档的两个协作者被路由到不同实例后互不可见、CRDT update 互不广播。sticky session 只保证"同用户始终到同实例"，解决不了"同文档的不同用户被路由到不同实例"（除非按 `documentId` 做一致性哈希路由，但 Nginx ip_hash 按客户端 IP 分配）。

**方案**: 引入 **y-redis**（Redis pub/sub 广播 + 持久化 update 流），每个 App 实例本地持有 `Y.Doc` 副本，通过 Redis 做跨实例状态同步。

```
                     WebSocket
  用户A ──────────────────────────────┐
                                      ▼
                              ┌──────────────┐
  用户B ─────────────────────→│  Nginx (:80)  │
                              │  /ws → App1   │  ← sticky session (会话级)
                              │  /ws → App2   │
                              └──────────────┘
                                │         │
                    ┌───────────┘         └───────────┐
                    ▼                                 ▼
            ┌──────────────┐                 ┌──────────────┐
            │   App 1 (:8080)                │   App 2 (:8080)│
            |  Y.Doc (local)                |  Y.Doc (local) |  ← 移至 Collab-Service (Node.js)
            |   App 1 (:8080)                |   App 2 (:8080)|
            |   (Java, REST)                |   (Java, REST) |
            └──────┬───────┘                 └──────┬───────┘
                   │                                │
                   │  pub/sub + persistence         │
                   └────────────┬───────────────────┘
                                ▼
                        ┌──────────────┐
                        │  Redis (:6379)│
                        │  y-redis:     │
                        │  - pub/sub    │
                        │  - update log │
                        │  - awareness  │
                        └──────────────┘
```

**y-redis 工作原理**:

```typescript
// 每个 App 实例启动时:
import { RedisPersistence } from 'y-redis'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const roomName = `document:${documentId}`  // 按文档隔离房间

// y-redis provider 自动处理:
//   1. 本地 Y.Doc 变更 → 编码为 update → publish 到 Redis channel `document:{id}`
//   2. 订阅 Redis channel → 收到远端 update → applyUpdate() 到本地 Y.Doc
//   3. 新用户加入房间 → 从 Redis 读取完整 update 流 → 重建 Y.Doc 状态
//   4. Awareness 状态 → 通过 Redis key-value 共享（TTL 30s 心跳续期）

const provider = new RedisPersistence({
  redisUrl,
  docName: roomName,
  gc: true,  // 定期清理 Redis 中已合并的旧 update
})

const ydoc = new Y.Doc()
provider.bindState(roomName, ydoc)
```

**两个阶段拓扑**:

```
Phase 1 (MVP — 单用户):
  单 App + 单 Redis (会话管理)
  WebSocket 仅用于连接保活，无协作广播

Phase 2 (P2 — 协作上线):
  App ×2 + y-redis provider
  Nginx: /ws → 按 documentId 哈希路由 (保证同文档用户在同一实例)
         /api → 轮询

  # Nginx 配置 (协作阶段):
  upstream collab_backend {
    hash $arg_documentId consistent;  # 按文档 ID 一致性哈希
    server app1:8080;
    server app2:8080;
  }
  location /ws/ {
    proxy_pass http://collab_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }


// v20.27: Phase 3 = Phase 2 的独立扩缩容 (Collab-Service ×N 通过 y-redis 互联)




**路由策略切换表**:

| 阶段 | WebSocket 路由 | CRDT 广播 | Redis 依赖 |
|------|---------------|-----------|-----------|
| MVP | N/A (单实例) | N/A | 会话共享 |
| 协作 | Nginx `/ws` → Collab-Service (:4000) | y-redis Redis pub/sub (Node.js) | Node.js ×1+ |
| 独立协作服务 | Collab-Service 注册中心 | y-redis pub/sub | 会话 + CRDT |

### 12.2 分层架构

```
src/main/java/com/emr/
├── controller/
│   ├── DocumentController.java      # 文档 CRUD (含乐观锁版本检查)
│   ├── TemplateController.java      # 模板管理
│   ├── ExportController.java        # PDF/HTML/TXT 导出
│   ├── AuthController.java          # 登录/登出/Token 刷新
│   └── CollaborationController.java # WebSocket 协作管理
├── service/
│   ├── DocumentService.java         # 文档业务逻辑 (JSON 校验/版本升级/权限检查)
│   ├── TemplateService.java
│   ├── ExportService.java           # 导出编排 (iText/Thymeleaf)
│   ├── CollaborationService.java    # 协作会话管理
│   ├── PermissionService.java       # 文档级权限 CRUD
│   └── AuditService.java            # 审计日志写入
├── repository/
│   ├── DocumentRepository.java      # Mybatis-Plus BaseMapper
│   ├── TemplateRepository.java
│   ├── DocumentPermissionRepository.java
│   └── AuditLogRepository.java
├── entity/
│   ├── Document.java                # @TableName("t_document")
│   ├── Template.java
│   ├── DocumentPermission.java
│   └── AuditLog.java
├── dto/
│   ├── DocumentDTO.java             # API 响应 (含 modelVersion)
│   ├── DocumentListDTO.java         # 列表摘要
│   ├── CreateDocumentRequest.java   # @Valid 校验注解
│   ├── UpdateDocumentRequest.java   # 含 expectedVersion 字段
│   └── ApiResponse.java             # 统一响应包装 { code, data, message }
├── config/
│   ├── SecurityConfig.java          # Spring Security + JWT Filter
│   ├── WebSocketConfig.java         # Stomp 端点配置
│   ├── AuditLogInterceptor.java     # API 层审计日志拦截器
│   └── ModelVersionInterceptor.java # 响应头注入 X-Model-Version
├── websocket/
│   └── DocumentWebSocketHandler.java
└── util/
    ├── JwtUtil.java
    └── JsonSchemaValidator.java      # JSON_SCHEMA_VALID 封装
```

### 12.3 数据库设计

```sql
CREATE TABLE t_document (
    id          VARCHAR(64)  PRIMARY KEY,
    title       VARCHAR(255) NOT NULL,
    template_id VARCHAR(64),
    content     JSON         NOT NULL COMMENT 'DocumentTree JSON (ModelD 树形结构)',
    model_version VARCHAR(10) DEFAULT '4.0.0' COMMENT '文档模型版本号 (用于兼容)',
    status      VARCHAR(20)  DEFAULT 'draft',
    version     INT          DEFAULT 1 COMMENT '乐观锁版本号: 每次更新 +1，冲突时拒绝',
    created_by  VARCHAR(64)  NOT NULL,
    updated_by  VARCHAR(64),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_template_id (template_id),
    INDEX idx_created_by (created_by),
    INDEX idx_status (status)
);

CREATE TABLE t_document_permission (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    user_id     VARCHAR(64)  NOT NULL,
    permission  VARCHAR(20)  NOT NULL COMMENT 'owner/editor/commenter/viewer',
    granted_by  VARCHAR(64),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_doc_user (document_id, user_id),
    INDEX idx_document_id (document_id),
    INDEX idx_user_id (user_id)
);

CREATE TABLE t_template (
    id           VARCHAR(64)  PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    category     VARCHAR(100),
    description  TEXT,
    content      JSON         NOT NULL COMMENT '模板 DocumentTree JSON',
    model_version VARCHAR(10) DEFAULT '3.0',
    thumbnail    VARCHAR(500),
    is_public    TINYINT      DEFAULT 0,
    version      INT          DEFAULT 1,
    created_by   VARCHAR(64)  NOT NULL,
    updated_by   VARCHAR(64),
    created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_created_by (created_by)
);

CREATE TABLE t_audit_log (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    user_id     VARCHAR(64)  NOT NULL,
    action      VARCHAR(50)  NOT NULL COMMENT 'create/edit/delete/print/export/view/share/permission_change',
    detail      JSON         COMMENT '操作详情 (变更字段、新旧值 diff)',
    model_version VARCHAR(10) COMMENT '操作时的文档模型版本',
    ip_address  VARCHAR(50),
    user_agent  VARCHAR(500),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_document_id (document_id),
    INDEX idx_user_id (user_id),
    INDEX idx_action (action),
    INDEX idx_created_at (created_at)
);
```

#### 三版本概念关系 (v20.7)

系统中存在三个独立的"版本号"，容易混淆：

```
t_document.version (INT, 乐观锁)
  │ 每次 PUT 成功 +1. 用于并发冲突检测.
  │ CommentThread.baseVersion 指向这个版本.
  │ OfflineReconnect.stateVector 对标这个版本.
  │
  ▼
model_version (VARCHAR, 语义化模型版本)
  │ 仅 ModelD schema 破坏性变更时更新.
  │ 用于 ensureLatestModel() 升级器链选择. 不随编辑递增.
  │ DDL DEFAULT '4.0.0'.
  │
  ▼
NodePool._structureVersion (内部计数)
  │ 仅内存. 节点增删时 ++. 用于 LayoutCache 失效. 不持久化.
```

| 版本 | 存储 | 递增时机 | 用途 |
|------|------|----------|------|
| `t_document.version` | DB INT | 每次 PUT 成功 | 乐观锁、CommentThread 锚定、离线 sv |
| `model_version` | DB VARCHAR(10) | Schema 破坏性变更 | 升级器链选择 |
| `_structureVersion` | 内存 number | 节点增删 | LayoutCache 失效 |

**CommentThread.baseVersion = t_document.version**。重锚定: baseVersion → currentVersion 区间 diff → 计算锚点位移。离线重连 sv = 断线时的 t_document.version。

### 12.4 REST API 设计

#### 文档管理
GET    /api/v1/documents              # 文档列表（分页、筛选）
POST   /api/v1/documents              # 创建文档
GET    /api/v1/documents/{id}         # 获取文档详情
PUT    /api/v1/documents/{id}         # 更新文档 (Header: X-Expected-Version: N)
DELETE /api/v1/documents/{id}         # 删除文档

#### 文档权限
GET    /api/v1/documents/{id}/permissions        # 获取文档权限列表
POST   /api/v1/documents/{id}/permissions        # 授予权限
DELETE /api/v1/documents/{id}/permissions/{uid}  # 撤销权限

#### 审计日志
GET    /api/v1/documents/{id}/audit-logs          # 操作日志 (分页)

#### 协作 (WebSocket)
WS     /ws/documents/{id}                         # 文档协作通道
```

#### PUT 乐观锁流程:

```
Client                                Server
  │  PUT /api/v1/documents/{id}         │
  │  Header: X-Expected-Version: 5      │
  │────────────────────────────────────→│ SELECT version FROM t_document WHERE id=?
  │                                     │ if (db.version !== 5) → 409 Conflict
  │                                     │ UPDATE ... SET version=6 WHERE id=? AND version=5
  │  200 OK  { version: 6 }             │ INSERT INTO t_audit_log
  │←────────────────────────────────────│
  │  (冲突) 409 Conflict                 │
  │  { error: 'version_conflict',        │
  │    currentVersion: 7 }               │
  │←────────────────────────────────────│
```

### 12.5 后端技术栈

| 类别     | 技术                       | 版本   |
| -------- | -------------------------- | ------ |
| JDK      | Java                       | 17 LTS |
| 框架     | SpringBoot                 | 3.3+   |
| ORM      | Mybatis-Plus               | 3.5+   |
| 数据库   | MySQL                      | 8.0+   |
| 缓存     | Redis                      | 7.x    |
| 实时通信 | Spring WebSocket + Stomp   | -      |
| 安全     | Spring Security + JWT      | -      |
| 文档转换 | Apache PDFBox (PDF) + Apache POI | latest |
| 模板引擎 | Thymeleaf (HTML 导出)      | -      |
| 对象存储 | MinIO                      | latest |
| API 文档 | SpringDoc OpenAPI          | 2.5+   |
| 构建     | Maven                      | 3.9+   |

### 12.6 模型校验与版本兼容

#### 12.6.1 双层校验 (v20.26 — 修复 "单一来源" 超技术能力的承诺)

**问题 (v19.13 反思)**: JSON Schema (ajv/MySQL) **无法表达引用完整性**——重复 ID、孤儿引用、环检测都是代码级不变量。声称"Schema 为单一真相源"许诺了 JSON Schema 做不到的事。且 MySQL JSON_SCHEMA_VALID 仅支持 JSON Schema 子集（无 `$ref`、格式关键字有限），同一份 schema 两端编译需限定在交集内。

**修正**: 双层校验 = 结构校验 (Schema 单一来源，限定交集) + 不变量校验 (代码层，TS/Java 双实现，CI 对拍)。

```
Layer 1 — 结构校验 (Schema 层，JSON Schema 交集子集):
  schemas/document-tree.schema.json  ← 仅定义字段存在性/类型/必填
  前端: ajv.compile(schema)
  后端: MySQL JSON_SCHEMA_VALID(schema)
  对拍: 同一文档两端 valid 结果一致
  Schema 编写约束 (v20.26):
    ❌ 禁 $ref (MySQL 不支持)
    ❌ 禁 format 关键字 (MySQL 支持有限)
    ❌ 禁 if/then/else 条件校验 (MySQL 不支持)
    ✅ 仅用: type/properties/required/enum/minLength/maxLength/items

Layer 2 — 不变量校验 (代码层，JSON Schema 做不到的):
  validateNodePoolInvariants(pool):
    ✅ 重复 ID 检测 (nodes.Map 的 size === 注册节点数)
    ✅ 孤儿引用检测 (children 中的 ID 在 nodes 中存在)
    ✅ 环检测 (traversePool 的 visited Set)
    ✅ 类型约束 (children 中 ID 指向的节点类型匹配期望——如 Paragraph.children 只能 InlineNode)
    ✅ 根节点可达性 (body/header/footer/footnotes/endnotes 五个根均在 nodes 中)
  TS/Java 双实现，纳入 CI 对拍 (同一份 corrupt document → 两端 invariant errors 完全一致)
```

**CI 对拍测试**:

```
Layer 1: fixtures/valid-doc.json + fixtures/invalid-*.json
  → ajv.validate(doc) 结果 === MySQL JSON_SCHEMA_VALID(doc) 结果

Layer 2: fixtures/corrupt-dup-id.json / corrupt-orphan-ref.json / corrupt-cycle.json
  → validateNodePoolInvariants(TS).errors[N].code
    === validateNodePoolInvariants(Java).errors[N].code
```
```

### 12.6.3 modelVersion 版本兼容策略

```typescript
// 唯一升级入口 — loadDocument (与附录 E 语义化版本规则一致)
function loadDocument(json: string): DocumentTree {
  const parsed = JSON.parse(json)
  const version = parsed.metadata?.modelVersion || '4.0.0'  // 无 version 字段视为当前版本
  let doc = parsed as DocumentTree
  for (const upgrader of upgraders) {
    if (compareVersions(version, upgrader.from) >= 0 && compareVersions(version, upgrader.to) < 0) {
      doc = upgrader.upgrade(doc)
      doc.metadata!.modelVersion = upgrader.to
    }
  }
  const result = validateDocumentTree(doc)
  if (!result.valid) throw new DocumentValidationError(result.errors)
  return doc
}
// 黄金测试: v2.0→v3.0→v4.0 链式升级后 modelVersion === '4.0.0'
```

## 13. 数据流设计

### 13.1 编辑数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                        Input Pipeline                            │
│                                                                   │
│  键盘输入 ─→ KeyboardHandler ─→ InsertTextCommand ─┐             │
│  粘贴     ─→ ClipboardHandler ─→ PasteCommand ─────┤             │
│  拖拽     ─→ MouseHandler ─→ MoveBlockCommand ─────┤             │
│  批量样式 ─→ Toolbar UI ─→ FormatTextCommand ──────┤             │
│  模板插入 ─→ TemplateService ─→ InsertBlockCommand ┤             │
│  表格操作 ─→ ContextMenu ─→ InsertTable/ModifyTable┐             │
│                                                      ▼            │
│                                              CommandManager      │
│                                              .execute(command)    │
│                                                      │            │
│  ┌───────────────────────────────────────────────────┤            │
│  │                                                   ▼            │
│  │  command.forward(document)                        │            │
│  │    → 修改 DocumentTree                            │            │
│  │    → 返回 StatePatch                              │            │
│  │    → 推入 UndoRedoStack                           │            │
│  │    → 标记 DirtyTracker                            │            │
│  │                                                   │            │
│  │  StatePatch 合并到 EditorRuntimeState              │            │
│  │    → cursor 更新 / selection 更新                 │            │
│  │    → EventBus.emit('state:changed')               │            │
│  │    → EventBus.emit('layout:changed')              │            │
│  │    → EventBus.emit('render:request')              │            │
│  │                                                   │            │
│  │  Draw.render(document, state, dirtyTracker)       │            │
│  │    → 增量布局 (仅脏 Paragraph)                    │            │
│  │    → 增量渲染 (仅脏区)                            │            │
│  │    → DirtyTracker.clear()                         │            │
│  └───────────────────────────────────────────────────┘            │
│                                                                   │
│  IME 特殊路径:                                                    │
│   compositionupdate → 仅渲染预览 (不修改 DocumentTree)            │
│   compositionend   → InsertTextCommand → 正常编辑流               │
└─────────────────────────────────────────────────────────────────┘
```

### 13.2 保存数据流 (AutoSaveManager)

```
┌──────────────────────────────────────────────────────────────────┐
│                       Auto-Save Pipeline                          │
│                                                                    │
│  触发条件:                                                         │
│  ├─ 用户 Ctrl+S 手动保存                                          │
│  ├─ 文档内容变更后 3 秒无操作 (防抖)                               │
│  ├─ 编辑器失焦 (blur 事件)                                        │
│  └─ 页面卸载 (beforeunload 事件)                                  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────┐         │
│  │ 1. 防抖层 (3000ms)                                    │         │
│  │    - 每次 CommandManager.execute() 后重置计时器       │         │
│  ├──────────────────────────────────────────────────────┤         │
│  │ 2. 本地缓存层 (IndexedDB)                             │         │
│  │    - 数据结构: { id, documentJSON, timestamp, dirty } │         │
│  ├──────────────────────────────────────────────────────┤         │
│  │ 3. 本地备份层 (localStorage, v20.20: 仅 1 份元数据兜底)   │         │
│  ├──────────────────────────────────────────────────────┤         │
│  │ 4. 远程保存层 (API)                                   │         │
│  │    PUT /api/v1/documents/{id}                         │         │
│  │    Header: X-Expected-Version: N                      │         │
│  │    - 成功 → 清除 IndexedDB dirty 标记                  │         │
│  │    - 409 Conflict → 提示用户刷新                       │         │
│  │    - 网络错误 → 保留 IndexedDB 脏数据，等待重试       │         │
│  └──────────────────────────────────────────────────────┘         │
│                                                                    │
│  故障恢复: 页面加载时检查 IndexedDB → 有未保存数据? → 提示恢复     │
│  恢复优先级: IndexedDB (最新) → localStorage (备选)                │
└──────────────────────────────────────────────────────────────────┘
```

```typescript
class AutoSaveManager {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly DEBOUNCE_MS = 3000
  private readonly BACKUP_INTERVAL_MS = 30000
  private lastBackupTime = 0
  private db: IDBDatabase | null = null
  private currentVersion = 1

  async init(documentId: string): Promise<void> {
    this.db = await this.openIndexedDB()
    this.currentVersion = await this.fetchCurrentVersion(documentId)
  }

  updateVersion(newVersion: number): void { this.currentVersion = newVersion }

  onContentChanged(document: DocumentTree): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.save(document), this.DEBOUNCE_MS)
  }

  async saveNow(document: DocumentTree): Promise<void> {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
    await this.save(document)
  }

  private async save(document: DocumentTree): Promise<void> {
    const tx = this.db!.transaction(['documents'], 'readwrite')
    tx.objectStore('documents').put({ id: document.id, documentJSON: JSON.stringify(document), timestamp: Date.now(), dirty: true })
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() })

    const now = Date.now()
    if (now - this.lastBackupTime > this.BACKUP_INTERVAL_MS) {
      this.backupToLocalStorage(document)
      this.lastBackupTime = now
    }

    try {
      const response = await fetch(`/api/v1/documents/${document.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Expected-Version': String(this.currentVersion) },
        body: JSON.stringify(document),
      })
      if (response.status === 409) { this.onVersionConflict() }
      else if (response.ok) {
        const data = await response.json(); this.currentVersion = data.version
        const tx2 = this.db!.transaction(['documents'], 'readwrite')
        tx2.objectStore('documents').put({ id: document.id, dirty: false })
      }
    } catch (err) { console.warn('[AutoSave] Network error, data preserved in IndexedDB') }
  }

  private backupToLocalStorage(document: DocumentTree): void {
    // v20.20: localStorage 降为兜底 —— 仅存 1 份元数据 (非完整文档), 完整文档走 IndexedDB
    // 原因: 3版 × 2MB = 6MB > 浏览器 5MB 配额, 必然超限
    // 权威实现见 §12.1.6 (含 2MB 守卫 + try/catch), 此处不重复
    const meta = { id: document.id, title: document.title, timestamp: Date.now(), dirty: true }
    try {
      const json = JSON.stringify(meta)
      if (json.length > 256 * 1024) return  // 元数据 > 256KB 异常, 跳过
      localStorage.setItem(`doc_backup_${document.id}`, json)
    } catch (e) {
      // QuotaExceededError → 静默跳过, IndexedDB 已有完整备份
    }
  }

  private async openIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('EMRDocumentEngine', 1)
      req.onupgradeneeded = () => { req.result.createObjectStore('documents', { keyPath: 'id' }) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  private async fetchCurrentVersion(documentId: string): Promise<number> {
    const res = await fetch(`/api/v1/documents/${documentId}`)
    const data = await res.json(); return data.version ?? 1
  }

  private onVersionConflict(): void { window.dispatchEvent(new CustomEvent('save:versionConflict')) }

  async checkForUnsavedData(documentId: string): Promise<DocumentTree | null> {
    if (!this.db) return null
    const tx = this.db.transaction(['documents'], 'readonly')
    const req = tx.objectStore('documents').get(documentId)
    return new Promise(resolve => {
      req.onsuccess = () => { const cached = req.result; resolve(cached?.dirty ? JSON.parse(cached.documentJSON) as DocumentTree : null) }
      req.onerror = () => resolve(null)
    })
  }
}
```

### 13.3 协作数据流 (CRDT 决策)
### 13.3 协作数据流 — Yjs CRDT 融合方案 (v19.7)

**决策**: 采用 **Yjs (CRDT)** 作为单一真相源，**方案 A**——Y.UndoManager 接管撤销，ICommand 降级为编辑语义封装，NodePool 基于 Y.Doc 事件做增量投影。

#### 13.3.1 为什么必须选择方案 A

CRDT 并发场景下"撤销"有专门语义：撤销**自己的**操作、不撤销**他人**的。自建 CommandUndoRedoStack 在两个关键点上必然失败：

1. **invert() 语义错误**: 你 invert 的是本地执行的命令参数，但文档现场已被远端并发修改——得到的逆操作作用于错误的状态。
2. **并发去重困难**: 本地 undo 后，远端同步过来的操作与本地逆操作的先后顺序无法预测。

Y.UndoManager 通过 `trackedOrigins` 追踪操作来源，天然支持"只撤销自己的" / "只撤销 AI 的"。方案 A 不存在方案 B（回退 OT）的可行性问题——文档已明确删除 OT 决策。

#### 13.3.2 架构: Y.Doc 为运行时，NodePool 为增量投影

```
                    Y.Doc (唯一真相源)
                   /        |        \
    Y.UndoManager    editors[]    awareness[]
    (撤销/重做)     (协同编辑者)   (光标/选区)
          │                              │
          ▼                              ▼
    Y.transact(origin)              CollaboratorCursors
          │
          ▼
    Y.Array/Y.Map delta 事件 ──→ NodePool 增量更新 ──→ LayoutCache 局部失效
    (仅变更部分重建)              (仅受影响节点失效)
```

**Y.Doc ↔ DocumentTree 的双向约定**:

```
保存: DocumentTree ← Y.Doc.toJSON()  // 保存时取快照，O(n) 一次性操作
加载: Y.Doc.applyUpdate() ← DocumentTree JSON  // 加载时导入，O(n) 一次性操作
运行时: 引擎不直接读 DocumentTree，而是通过 NodePool 读 (NodePool 由 Y.Doc delta 驱动)
```

**NodePool 增量投影** (v19.7 新增):

```typescript
class NodePoolProjection {
  private pool: NodePool
  private ydoc: Y.Doc
  private dirtyNodes = new Set<string>()   // 受影响的节点 ID

  constructor(ydoc: Y.Doc) {
    this.ydoc = ydoc
    this.pool = new NodePool()

    // 监听 Y.Doc 五区域变更 (v20.25: 从仅 body 扩展为 body + header + footer + footnotes + endnotes)
    const regions = ydoc.getMap('regions')
    const yBody = regions.get('body') as Y.Array<any>
    const yHeader = regions.get('header') as Y.Array<any>
    const yFooter = regions.get('footer') as Y.Array<any>
    const yFootnotes = regions.get('footnotes') as Y.Array<any>
    const yEndnotes = regions.get('endnotes') as Y.Array<any>
    ;[yBody, yHeader, yFooter, yFootnotes, yEndnotes].forEach(yArr => {
      if (yArr) yArr.observeDeep((events) => {
      for (const event of events) {
        // Y.Array 插入/删除 → 同步到 NodePool 的 children 数组
        // Y.Map 变更 → 同步到 NodePool 的节点属性
        for (const delta of event.changes.delta) {
          if (delta.insert) this.applyInsert(delta)
          if (delta.delete) this.applyDelete(delta)
          if (delta.retain && event.path.length > 0) this.applyUpdate(delta)
        }
      }
      // 标记受影响节点为脏 → LayoutCache 失效 → DirtyTracker 标记
      for (const nodeId of this.dirtyNodes) {
        this.pool.bumpNodeVersion(nodeId)
      }
      this.dirtyNodes.clear()
      EventBus.emit('yjs:synced')  // 触发增量渲染
    })
  }

  private applyInsert(delta: Y.Delta): void {
    // delta.insert → 新节点 → pool.nodes.set() + 父节点 children 同步
  }
  private applyDelete(delta: Y.Delta): void {
    // delta.delete → pool.nodes.delete() + 父节点 children 同步 + 级联回收
  }
  private applyUpdate(delta: Y.Delta): void {
    // delta.retain + 属性变更 → pool.updateNode()
  }

  getPool(): NodePool { return this.pool }
}

// 投影频率与开销:
// - Y.Doc delta 事件是细粒度的（单个字符/单个属性变更），每次只重建受影响的 1~3 个节点
// - 百页文档远端插入 1 字符 → delta 事件仅影响 1 个 TextNode → O(1) 增量投影
// - 不触发 DocumentTree 全量序列化/反序列化
```

#### 13.3.3 撤销系统: Y.UndoManager 接管 Ctrl+Z

```typescript
// 初始化
const undoManager = new Y.UndoManager(regions, {  // v20.25: 五区域统一追踪
  trackedOrigins: new Set([localUserId, 'ai']),  // 只追踪本地用户和 AI 的操作
  captureTimeout: 500,  // 500ms 内连续操作合并为一个撤销单元
})

// Ctrl+Z → undoManager.undo()
// Ctrl+Y → undoManager.redo()

// AI 操作 (author='ai') 走 origin='ai' 的事务:
ydoc.transact(() => {
  // ... AI 编辑操作 ...
}, 'ai')

// "只撤销 AI 操作"——切换 trackedOrigins 或使用独立的 UndoManager 实例
const aiUndoManager = new Y.UndoManager([ydoc.getArray('body')], {
  trackedOrigins: new Set(['ai']),
})
```

**ICommand 跨阶段兼容** (v20.8):

ICommand 接口使用 `CommandContext` 联合类型（详见 §6.1）。Phase 1 注入 `{mode:'local', doc, pool}`，Phase 2 注入 `{mode:'collab', ydoc, origin}`。接口签名稳定，切换时 CommandManager 一处变更。此处不再重复定义。

**两个阶段的并行策略**:

```
Phase 1 (MVP — 单用户无协作):
  CommandUndoRedoStack 继续工作（invert 语义在无并发场景下正确）
  Ctrl+Z 走旧栈

Phase 2 (P2 — 协作上线):
  Y.Doc 激活 → Y.UndoManager 接管 Ctrl+Z
  CommandUndoRedoStack 设为 readonly (不再入栈, 只读历史)
  ICommand.invert() 标记 @deprecated 并从接口中移除
```

#### 13.3.4 协作同步协议

```
同步模型: CRDT (Yjs)
传输通道: WebSocket (Stomp)

WebSocket 报文:
  { type: 'sync_update' | 'awareness',
    documentId, userId, timestamp,
    payload: { update: Uint8Array,  // Yjs 二进制增量
               awareness: { cursor, selection, userName, color } } }

冲突处理:
  - Yjs CRDT 自动合并
  - 并发编辑同一位置: Yjs 自动分配相对位置
  - 并发删除: 第一次生效
  - 属性并发修改: Last-Writer-Wins

离线重连:
  ⬜ DocumentTree 快照断线第0秒自动保存 → sv 持久化
  重连流程: 对比本地 sv 与远端 state vector → 计算增量 → Y.encodeStateAsUpdate(sv)
  → 远端返回 peerUpdate → Y.applyUpdate → diff 合并 → NodePool 增量投影

感知信息 (Awareness):
  - 每个用户: cursor (CursorState) + userName + color
  - WebSocket 定期广播 (500ms throttle)
  - 其他用户光标在 InteractLayer 上渲染为彩色竖线 + 用户名标签
```

### 13.4 保存与协作的衔接 — 快照桥 (v20.10)

**问题**: §13.2 AutoSaveManager 防抖 3s PUT 全量 DocumentTree vs §13.3 Yjs 增量同步 + y-redis update log。两条流水线各自完整，拼起来是断的——Phase 2 协作模式下 `t_document.content` 何时、由谁、以什么频率更新？

**衔接设计**:

```
Phase 2 数据流:
  Y.Doc (内存) ← y-redis pub/sub → 远端实例
      │
      ├─→ [实时] Yjs update → y-redis 持久化 update log (真正的协作持久层)
      │
      └─→ [周期性] 快照桥: 每 30s 或 用户 Ctrl+S / 失焦
            Y.Doc.toJSON() → DocumentTree → encryptFields() → PUT /api/v1/documents/{id}
            (t_document.content 为周期性快照, 非实时真相)
```

**频率与触发**:

| 触发条件 | Phase 1 (单用户) | Phase 2 (协作) |
|----------|-----------------|----------------|
| 编辑后防抖 | 3s → IndexedDB + PUT | **30s** → PUT (降频, y-redis 已是持久层) |
| Ctrl+S | 立即 PUT | 立即 PUT (快照落盘) |
| 失焦/blur | 立即 PUT | PUT |
| beforeunload | 立即 PUT | PUT + y-redis flush |
| 定时后台 | — | 每 5min 自动快照 (防止 y-redis log 无限增长) |

**Y.Doc ↔ DocumentTree 转换** (快照桥实现):

```typescript
class SnapshotBridge {
  /** Y.Doc → DocumentTree (用于 PUT 保存) */
  static ydocToTree(ydoc: Y.Doc): DocumentTree {
    // Y.Doc.toJSON() 返回的是 Yjs 内部 JSON 结构，需要映射为 DocumentTree
    const raw = ydoc.toJSON()
    const flatNodes = YjsFlattener.flatten(raw) // Yjs 嵌套 → 扁平 Map
    // 注意: Y.Doc 中的节点已包含 header/footer/footnotes/endnotes
    return buildTreeFromFlat(flatNodes)
  }

  /** DocumentTree → Y.Doc (用于文档加载时初始化 Y.Doc) */
  static treeToYdoc(tree: DocumentTree): Y.Doc {
    const ydoc = new Y.Doc()
    const flatNodes = DocumentFlattener.flatten(tree) // 树 → 扁平
    // applyUpdate 导入完整文档
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(ydoc))
    return ydoc
  }
}
```

**t_document.content 的角色转变**:

| 阶段 | content 角色 | 更新频率 |
|------|-------------|----------|
| Phase 1 | **真相源** | 3s 防抖 PUT |
| Phase 2 | **周期性快照** (真相在 y-redis update log) | 30s / Ctrl+S / 5min |

**为什么不能关掉 AutoSave PUT**: 
- 模板/导出/质控/版本历史等非协作消费者直接读 `t_document.content`
- y-redis update log 只存 N 天 (可配置, 默认 7 天), 需要定期快照持久化到 MySQL
- 文档列表 API 需要展示文档元数据 (标题/状态/最后编辑时间), 不需要完整 Y.Doc 重建

```

### Phase 1 — MVP 单实例

```
┌──────────────────────────────────────────────┐
│                  Nginx (:80/:443)             │
│  /          → Frontend Static (Vite build)   │
│  /api/*     → Backend (SpringBoot :8080)     │
│  /ws/*      → Backend (WebSocket)            │
│  /minio/*   → MinIO (:9000)                  │
└──────────────────────────────────────────────┘
         │
    ┌────┴────────────┐
    │                 │
    ▼                 ▼
┌────────┐    ┌──────────────────────┐
│ MinIO  │    │  SpringBoot Backend  │
│ :9000  │    │  :8080 (单实例)      │
│ :9001  │    │  + Redis Session 共享 │
│(Console)│   └───────┬──────────────┘
└────────┘            │
           ┌──────────┼──────────┐
           ▼          ▼          ▼
       ┌───────┐ ┌───────┐ ┌──────────┐
       │ MySQL │ │ Redis │ │(RabbitMQ)│
       │ :3306 │ │ :6379 │ │ (远期)   │
       └───────┘ └───────┘ └──────────┘
```

### Phase 2 — 生产协作 (App×2 + y-redis)

```
┌──────────────────────────────────────────────────────────────┐
│                      Nginx (:80/:443)                         │
│  /            → Frontend Static                              │
│  /api/*       → Backend (轮询)                               │
│  /ws/*        → Backend (hash $arg_documentId consistent)    │
│  /minio/*     → MinIO (:9000)                                │
└──────────────────────────────────────────────────────────────┘
         │
    ┌────┴────────────────────┐
    │                         │
    ▼                         ▼
┌────────┐          ┌──────────────────────────┐
│ MinIO  │          │  SpringBoot Backend ×2   │
│ :9000  │          │  App1 :8080              │
│ :9001  │          │  App2 :8081              │
│(Console)│         │  + y-redis provider      │
└────────┘          └───────┬──────────────────┘
                            │
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
       ┌───────┐    ┌──────────────┐   ┌──────────┐
       │ MySQL │    │ Redis (:6379) │   │(RabbitMQ)│
       │ :3306 │    │ - Session 共享│   │ (远期)   │
       └───────┘    │ - y-redis    │   └──────────┘
                    │   pub/sub    │
                    │ - CRDT 持久化│
                    └──────────────┘
```

### Phase 3 — 独立协作服务 (远期)

```
                      Nginx
                   /    |    \
                  /     |     \
           Frontend  REST API  WebSocket
                │       │          │
                ▼       ▼          ▼
           Vite Build  App×2   Collab-Service (独立部署)
                      (MVC)    Y.Doc + y-redis + WebSocket
                                独立扩缩容
```

**容器化**: 上述所有服务通过 `docker-compose.yml` 编排。Phase 2 时增加 `collab-backend` 服务的 `deploy.replicas: 2`，Nginx 增加 `hash` 路由配置。详见 §12.1.8。

## 15. 从当前代码到目标架构的迁移路径


当前代码 (`Draw.ts` 709行单体) 到 目标架构的渐进迁移策略：

### 15.1 Step 1-5 渐进迁移策略

**Step 1: 引入 EditorRuntimeState (双写过渡)**

```
当前 Draw.ts 私有字段:
  cursorPage, cursorBlock, cursorInline  → 映射到 CursorState.path + offset
  selInlineStart, selInlineEnd          → 映射到 SelectionState
  scrollTop, pageCount                  → 映射到 ViewState
  composing, composingText              → 映射到 IMEState

做法:
  1. 新建 EditorRuntimeState (纯数据, 无逻辑)
  2. Draw.ts 保留私有字段, 同时每次 render() 前从 EditorRuntimeState 读取
  3. 双写过渡: 编辑操作同时更新 Draw 私有字段 + EditorRuntimeState
  4. 验证渲染结果一致后, 删除 Draw 私有字段
```

**Step 2: 引入 EventBus**

```
  1. 新建 EventBus 单例 (on/off/emit)
  2. Draw.ts 的 render() 注册为 'render:request' 监听者
  3. 各事件处理函数末尾加 EventBus.emit('render:request')
```

**Step 3: 提取 Handler (逐个迁移)**

```
迁移顺序 (按依赖从少到多):
  1. IMEHandler — 独立 textarea, 依赖最少, 先提取
  2. ClipboardHandler — 依赖 paste 事件
  3. MouseHandler — 依赖坐标转换, 先迁移 CoordinateSystem
  4. KeyboardHandler — 依赖 CommandManager, 需 Step 4 前置
```

**Step 4: 引入 Command 体系 (新旧栈并行)**

```
  1. 实现 ICommand 接口 + InsertText/DeleteText/FormatText
  2. 实现 CommandUndoRedoStack
  3. KeyboardHandler 走新栈: keydown → Command → CommandManager.execute()
  4. 旧栈保留兜底, 逐步迁移, 完全切换后删除旧栈代码
```

**Step 5: 增量布局 + 增量渲染**

```
  1. Command.forward() 执行后调用 DirtyTracker 标记脏区
  2. Draw.recomputeLayout() 接收 DirtyTracker, 仅重算脏 Paragraph
  3. 为脏 Paragraph 构建 LineElement[] → LineBreaker.breakLines() → 更新 PageItem[]
  4. Draw.render() 计算 clipRect → ctx.clip() → 仅重绘脏区
  5. cursor/selection/IME preview 始终全量绘制 (开销小)
```

### 15.2 迁移检查清单

| 步骤    | 内容                    | 风险 | 验证方法                      |
| ------- | ----------------------- | ---- | ----------------------------- |
| Step 1  | EditorRuntimeState 双写 | 低   | 渲染结果与迁移前一致          |
| Step 2  | EventBus 引入           | 低   | 事件正确派发                  |
| Step 3a | IMEHandler 提取         | 低   | CJK 输入正常                  |
| Step 3b | ClipboardHandler 提取   | 低   | 复制粘贴正常                  |
| Step 3c | CoordinateSystem 提取   | 中   | 坐标换算一致                  |
| Step 3d | MouseHandler 提取       | 中   | 光标定位准确                  |
| Step 4  | Command 体系            | 高   | Ctrl+Z 行为一致               |
| Step 5  | 增量布局+渲染           | 高   | 编辑后渲染结果一致 + 帧率提升 |

## 16. 安全设计

### 16.1 认证流程

1. 用户登录 → 后端验证 → 返回 JWT (Access Token + Refresh Token)
2. 前端存储 Access Token 于内存，Refresh Token 于 httpOnly Cookie
3. 每次请求携带 Authorization: Bearer {token}
4. Token 过期 → 自动用 Refresh Token 刷新

### 16.2 权限模型

**用户级权限** (由 JWT role + t_document_permission 表共同决定):

```
权限等级:
  owner    — 文档所有者    (编辑/删除/权限管理/批注/打印/导出)
  editor   — 编辑者        (编辑/批注/打印/导出)
  commenter— 批注者        (批注/查看/打印/导出)
  viewer   — 只读者        (查看/打印/导出)
```

**节点级权限** (见 §5 权限优先级规则):

```
叠加规则: 用户级权限 (粗粒度) ∩ 节点级权限 (细粒度)
  例: editor 角色 + SmartTextNode.readonly=true → 该字段不可编辑
  例: viewer 角色 + SmartTextNode.readonly=false → 全局只读，不可编辑
```

### 16.3 数据安全

  - 字段级 AES-256-GCM 加密（仅 privacy=true 的 SmartTextNode.text, 详见 §12.1.3）
- API 请求频率限制（Rate Limiting）
- SQL 注入防护（Mybatis 参数化查询）
- XSS 防护（输入过滤 + 输出编码）
- WebSocket 认证 (JWT 通过 Sec-WebSocket-Protocol 子协议或首帧 AUTH 报文，禁止 URL query)
- 乐观锁版本冲突检测 (防止并发覆盖)
- 全链路审计日志 (API 层拦截器自动记录)

## 17. 非功能需求

### 17.1 性能指标 (v19.10 — 权威单一来源)

> **指标单一来源原则**: 所有性能数字以此表为权威定义。PRD/Spec/UIUX 中的性能引用一律指向本节，禁止在其他文档中重复定义或改写数字。

| 指标 | 测量口径 | MVP | 最终 | 前置依赖 |
|------|----------|-----|------|----------|
| 首次内容绘制 (FCP) | Lighthouse | < 1.5s | < 1s | 懒布局 + 字体预加载 |
| 10 页文档加载 | fetch→字体就绪→首帧 | < 1s | < 500ms | 懒布局 |
| 100 页全量分页 | PageBreaker 热启动 (时间片化/Worker) | < 3s | < 1s | 增量分页 + Worker (§3.2) |
| 单次编辑响应 (P50) | keydown→光标更新 | < 50ms | < 16ms (60fps) | Run模型 + 增量渲染 (§6 + §7) |
| 连续打字帧率 (P95) | 100 次采样 rAF | > 30fps | > 55fps | 增量分页 + DirtyTracker |
| 10 页文档内存 | DevTools heap | < 80MB | < 50MB | 虚拟化渲染 + LayoutCache |
| 4K 屏 Canvas 内存 | 3层 × 视口 × DPR² (详见 §7.5) | < 200MB | < 120MB | content 层按页分片 |
| IndexedDB 落盘 | 同步写入 Performance API | < 50ms | < 20ms | — |
| API 异步保存 | fire-and-forget | 不阻塞 UI | < 500ms | — |
| 打印 50 页 | PageBreaker + PDF 生成 | < 5s | < 3s | Apache PDFBox |

### 17.2 浏览器兼容性

| 浏览器       | 最低版本       | 备注                                      |
| ------------ | -------------- | ----------------------------------------- |
| Chrome       | 90+            | 主要开发和测试环境                        |
| Edge         | 90+            | Chromium 内核，兼容 Chrome                |
| Firefox      | 90+            | 需额外测试 IME 兼容性                     |
| Safari       | 15+            | macOS 需额外测 Canvas 和 IME              |
| 移动端浏览器 | 不保证编辑功能 | 只读查看可用, 编辑不支持                   |

### 17.3 异常降级策略

| 异常场景                 | 降级方案                                             |
| ------------------------ | ---------------------------------------------------- |
| Canvas 2D context 不可用 | 显示错误提示 "您的浏览器不支持 Canvas，请升级浏览器" |
| WebSocket 连接失败       | 降级为纯本地编辑，保存走 HTTP API，协作功能置灰      |
| IndexedDB 不可用         | 降级为 localStorage 备份，或纯远程保存               |
| API 网络超时 (3 次重试)  | 保存到 IndexedDB，显示 "网络异常，数据已本地保存"    |
| 文档 JSON 解析失败       | 显示 "文档数据损坏" + 尝试从 localStorage 恢复       |
| 单次渲染超过 100ms       | 跳过非可见区域的渲染 (虚拟滚动)                      |
| 内存超过 200MB           | 清空 TextMeasurer 缓存 + 释放非可见页的 PageItem     |

### 17.4 前端监控与可观测性

```typescript
interface PerformanceMetrics {
  // 渲染性能
  renderFrameTime: number
  layoutRecomputeTime: number
  textMeasureCacheHitRate: number
  // 编辑性能
  commandExecuteTime: number
  keystrokeLatency: number
  // 保存性能
  saveToIDBDuration: number
  saveToAPIDuration: number
  // 异常
  renderErrorCount: number
  apiErrorCount: number
  versionConflictCount: number
}
// 采样率: 生产环境 1%，开发环境 100%
// 上报: navigator.sendBeacon() 在页面卸载时批量发送
```

#### 异常上报

```typescript
type ErrorCategory =
  | 'js_error' | 'render_error' | 'layout_error' | 'validation_error'
  | 'save_error' | 'load_error' | 'font_error'

interface ErrorReport {
  category: ErrorCategory; message: string; stack?: string
  documentId?: string; modelVersion?: string; timestamp: number
}
```

#### 业务指标

```typescript
interface BusinessMetrics {
  pageCount: number; nodeCount: number; smartTextCount: number
  sessionDuration: number; commandCount: number; operationsPerMinute: number
}
```

### 17.5 性能指标测量规则

| 指标             | 计时起点                          | 计时终点                                               | 测量方法                                                                                   |
| ---------------- | --------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 10 页文档加载    | `fetch()` 调用                  | `Editor` 构造完成 + 首帧渲染完成                     | `performance.measure('doc-load', 'fetch-start', 'first-render-end')`                     |
| 单次编辑响应延迟 | `keydown` 事件触发              | `requestAnimationFrame` 回调中交互层 Canvas 绘制完成 | `const t0=performance.now(); rAF(()=>{ metrics.keystrokeLatency=performance.now()-t0 })` |
| 连续打字帧率     | 同上，采样 100 次                 | 计算 100 次 keystrokeLatency 的 P95                    | 丢弃前 10 次预热，统计后 90 次                                                             |
| 100 页分页计算   | `PageBreaker.breakPages()` 调用 | `IPage[]` 返回                                       | `performance.measure('page-break', ...)`                                                 |
| 自动保存响应     | `AutoSaveManager.save()` 调用   | API 响应解析完成 (或 IndexedDB 写入完成)               | 分别计时 IndexedDB 和 API 两段                                                             |

### 17.6 关键架构风险 (v20.14)

| # | 风险 | 等级 | 应对 | 验证节点 |
|---|------|------|------|----------|
| R1 | **Yjs 投影路径未验证**: NodePoolProjection (§13.3.2) 的 observeDeep → applyInsert/Delete/Update → NodePool children 同步 + 级联回收的映射复杂度极高。Y.Array delta 与树形 children 的语义对齐（Table 嵌套、move 操作）容易出边界 bug。一旦失败，§2 整套模型设计需回炉 | **高** | MVP 完成后立即做 spike (2-3天): 最小原型验证"百页文档远端插入 1 字符 → O(1) 投影"是否成立。spike 通过后再启动 Phase 2 协作功能开发 | MVP 完成后 |
| R2 | 字体度量跨端一致性 | 高 | FontMetricsParser §3.1b + golden test (TS/Java bit 级一致) | CI 门禁 |
| R3 | **排版结果未跨端验证**: 字体度量一致 ≠ 排版结果一致。LineBreaker/PageBreaker 的 JS 实现与 Java 实现的换行策略可能有细微差异，即使 FontMetrics bit 级一致，累积误差也可能导致跨页断点漂移 | 高 | SLIF 对拍黄金测试 (TASK-448): Canvas x 坐标 vs PDF x 坐标逐 item 比对, ≤1px | CI 门禁, MVP 完成前 |

## 18. 打印 / 导出链路

### 18.1 统一导出链路 — SLIF 单一渲染源 (v20.12)

**已废弃的方案** (文档中删除):
- ~~前端 Canvas.toDataURL('image/png') → 后端组装 PDF~~ (像素位图, 不可缩放, 字体模糊)
- ~~后端接收 DocumentTree JSON → 独立排版~~ (§18.3 已明确"后端不做独立排版")

**唯一正确解**: 前端 LayoutEngine 产出 SLIF JSON (§7.3-§7.7) → 后端 iText/PDFBox 按 SLIF 坐标精确定位。布局计算结果只产生一次（前端 LayoutEngine），后端仅做格式转换。前后端共享同一份字体度量（FontMetricsParser §3.1b）和同一份页面设置（PageSetup §2.1）。

```
LayoutEngine (前端)
    │
    ├─→ SLIF JSON ─→ 后端 PDF 导出 (Apache PDFBox 按坐标精确放置)
    │               ─→ 后端 HTML 导出 (Thymeleaf 按坐标生成绝对定位 div)
    │               ─→ 后端 OFD 导出 (suwell/ofdrw)
    │
    ├─→ DocumentTree JSON ─→ JSON 导出 (Blob 下载)
    │                      ─→ TXT 导出 (遍历 TextNode.text 拼接)
    │
    └─→ Canvas.toDataURL('image/png') ─→ PNG 导出 (当前页截图, 仅用于快速预览)
```

### 18.2 各格式导出定位

| 格式 | 数据源 | 实现位置 | 说明 |
|------|--------|----------|------|
| JSON | DocumentTree | 前端 | `JSON.stringify` → Blob 下载 |
| PDF | **SLIF** | 后端 | Apache PDFBox 按 SLIF 坐标精确放置 + 嵌入字体文件 |
| HTML | **SLIF** | 后端 | Thymeleaf 按 SLIF 坐标生成绝对定位 |
| PNG | Canvas 快照 | 前端 | 仅当前页预览, 非正式导出 |
| TXT | DocumentTree | 前端/后端 | 遍历提取 TextNode.text |

### 18.3 排版一致性保障 (v19.9 修正)

| 风险 | 应对 |
|------|------|
| 前端 Canvas 渲染 ≠ 后端 PDF 渲染 | 后端 PDF 使用相同的布局参数 (PageSetup) 和 **SLIF 布局中间格式**——前端排版引擎输出 SLIF JSON，后端 iText/PDFBox 按 SLIF 坐标精确放置内容 |
| **字体度量不一致** (根因) | **FontMetricsParser** (TS opentype.js / Java Apache FontBox) 对同一 .ttf 文件解析 hhea + OS/2 表，golden test 保证 bit 级一致。前后端使用相同字体文件的相同度量值，而非分别从 Canvas/FontBox TextMeasurer 测量 |
| 图片分辨率不足 | PDF 导出时使用 2x DPR Canvas → 更高分辨率输出 |

**与 §18.3 旧方案的区别**: 旧方案提出"Java 移植 TextMeasurer"——即用 Java 重新实现前端 Canvas measureText() 的逻辑。这从根本上不可靠：Canvas measureText() 依赖操作系统的字体渲染引擎（DirectWrite/CoreText/FreeType），不同 OS 的 hinting/subpixel 策略不同。FontMetricsParser 直接解析字体文件二进制表，绕过所有 OS 层渲染差异——字体文件中 hhea.ascent 是 1000，在任何 OS 上解析出来都是 1000。

## 19. 多格式文档加载

**问题**: 当前仅支持 DocumentTree JSON 反序列化。医疗文档需要加载 XML (HL7 CDA)、HTML (旧系统导出)、Markdown (轻量录入)、OFD (国标版式) 等外部格式。

**方案**: `IDocumentLoader` 接口抽象 + 格式适配器注册表。

```typescript
interface IDocumentLoader {
  readonly extensions: string[]
  readonly name: string
  load(source: string | ArrayBuffer, options?: LoadOptions): Promise<DocumentTree>
  detect(source: string | ArrayBuffer): boolean
}

interface LoadOptions {
  sourceVersion?: string
  upgradeToLatest?: boolean
  validate?: boolean
}

class LoaderError extends Error {
  constructor(message: string, readonly format: string, readonly cause?: Error) {
    super(`[${format}] ${message}`)
  }
}

/** JSON 加载器 (原生格式, 主要路径) */
class JSONDocumentLoader implements IDocumentLoader {
  readonly extensions = ['.json']; readonly name = 'JSON'
  async load(source: string, options?: LoadOptions): Promise<DocumentTree> {
    const parsed = JSON.parse(source)
    let doc = parsed as DocumentTree
    if (options?.upgradeToLatest) doc = ensureLatestModel(doc)
    if (options?.validate !== false) {
      const result = validateDocumentTree(doc)
      if (!result.valid) throw new LoaderError(result.errors.map(e => e.message).join('; '), 'JSON')
    }
    return doc
  }
  detect(source: string): boolean {
    try { const p = JSON.parse(source); return p?.type === 'document' && p?.body?.mode === 'flow' }  // 检查 body 而非 pages (§2.1 去分页化)
    catch { return false }
  }
}

/** XML 加载器 (HL7 CDA / 通用 XML 医疗文档) */
class XMLDocumentLoader implements IDocumentLoader {
  readonly extensions = ['.xml', '.cda']; readonly name = 'XML/HL7 CDA'
  async load(source: string, options?: LoadOptions): Promise<DocumentTree> {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(source, 'text/xml')
    return this.parseXMLToTree(xmlDoc.documentElement)
  }
  private parseXMLToTree(root: Element): DocumentTree { /* XML→Tree 映射逻辑 */ return {} as any }
  detect(source: string): boolean {
    return source.trimStart().startsWith('<?xml') || source.trimStart().startsWith('<ClinicalDocument')
  }
}

/** HTML 加载器 (富文本 → DocumentTree, 有损转换) */
class HTMLDocumentLoader implements IDocumentLoader {
  readonly extensions = ['.html', '.htm']; readonly name = 'HTML'
  async load(source: string): Promise<DocumentTree> {
    const parser = new DOMParser()
    const htmlDoc = parser.parseFromString(source, 'text/html')
    return this.parseHTMLToTree(htmlDoc.body)
  }
  private parseHTMLToTree(body: HTMLElement): DocumentTree { return {} as any }
  detect(): boolean { return true }
}

/** Markdown 加载器 (轻量文本录入) */
class MarkdownDocumentLoader implements IDocumentLoader {
  readonly extensions = ['.md']; readonly name = 'Markdown'
  async load(source: string): Promise<DocumentTree> { return this.parseMarkdown(source) }
  private parseMarkdown(source: string): DocumentTree { return {} as any }
  detect(source: string): boolean {
    const trimmed = source.trimStart()
    return !trimmed.startsWith('<') && !trimmed.startsWith('{') && /[#*>|\-]/.test(trimmed.slice(0, 100))
  }
}

// 加载器注册表 — 自动路由
class DocumentLoaderRegistry {
  private loaders: IDocumentLoader[] = []
  constructor() {
    this.register(new JSONDocumentLoader())
    this.register(new XMLDocumentLoader())
    this.register(new HTMLDocumentLoader())
    this.register(new MarkdownDocumentLoader())
  }
  register(loader: IDocumentLoader): void { this.loaders.push(loader) }
  getByExtension(ext: string): IDocumentLoader | undefined { return this.loaders.find(l => l.extensions.includes(ext.toLowerCase())) }
  detectLoader(source: string | ArrayBuffer): IDocumentLoader | undefined {
    const str = typeof source === 'string' ? source : new TextDecoder().decode(source)
    return this.loaders.find(l => l.detect(str))
  }
  async load(source: string | ArrayBuffer, filename?: string): Promise<DocumentTree> {
    let loader: IDocumentLoader | undefined
    if (filename) { const ext = '.' + (filename.split('.').pop() || '').toLowerCase(); loader = this.getByExtension(ext) }
    if (!loader) loader = this.detectLoader(source)
    if (!loader) throw new Error('Unsupported document format')
    return loader.load(source, { upgradeToLatest: true, validate: true })
  }
}
const documentLoader = new DocumentLoaderRegistry()
```

## 20. SDK 集成与公共 API

### 20.1 公共 API 三层模型 (IEditor)

```typescript
/**
 * Editor 公共 API — 外部集成方的唯一入口
 *
 * 铁律:
 * - 外部只能通过 Editor 实例调用以下方法
 * - 禁止 import 任何 src/engine/ 内部模块 (Draw, NodePool, TextMeasurer, ...)
 * - 禁止直接修改 EditorRuntimeState 内部字段
 * - 内部重构渲染/布局/缓存完全不影响外部代码
 */
interface IEditor {
  // 数据接口
  getDocument(): Readonly<DocumentTree>
  setDocument(doc: DocumentTree): void
  onDocumentChange(callback: (doc: DocumentTree) => void): () => void

  // 操作接口
  execCommand(command: ICommand): void
  undo(): void; redo(): void
  canUndo(): boolean; canRedo(): boolean

  // 事件接口
  onReady(callback: () => void): () => void
  onSelectionChange(callback: (sel: SelectionState) => void): () => void
  onModeChange(callback: (mode: EditorMode) => void): () => void
  onSaveStatusChange(callback: (status: SaveStatus) => void): () => void
  onError(callback: (error: EditorError) => void): () => void
  onScaleChange(callback: (scale: number) => void): () => void

  // 视图控制
  setScale(scale: number): void; setMode(mode: EditorMode): void
  scrollToPage(pageIndex: number): void; focus(): void

  // 插件与生命周期
  use(plugin: IPlugin): void
  pause(): void; resume(): void; destroy(): void
}

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict'

interface EditorError {
  category: 'render' | 'load' | 'save' | 'layout' | 'validation' | 'font'
  message: string; cause?: Error; timestamp: number
  recoverable: boolean
}
```

### 20.2 宿主环境隔离

```
src/engine/          ← 内核 (零 UI 框架依赖)
  ├── 允许依赖: 原生 DOM API, Canvas API, FontFace API, IndexedDB
  ├── 禁止依赖: React, Vue, Zustand, 任何 UI 框架
  ├── 禁止直接读: window (用传入的 container 做 DOM 挂载)
  │               document (用 container.ownerDocument)
  └── 所有 DOM 操作统一由 Interaction 层封装

src/editor-react/    ← React 组件封装包 (依赖 engine)
  ├── EditorProvider.tsx     — React Context 桥接
  ├── Toolbar.tsx / Sidebar.tsx / ...
└── 编辑器状态桥 (v20.34, 修复 P1-2)
    EditorProvider 订阅 EventBus:
      'state:changed' → Zustand store.runtime = { ...prev, ...patch }
      'document:changed' → Zustand store.isDirty = true
      'qc:completed' → Zustand store.qcResult = result
      AutoSaveManager.onSaveStatusChange → Zustand store.saveStatus
    这是 engine → UI 的唯一数据通道, 每个 React 组件通过 useStore() 读取

外部集成方:
  纯 JS / Vue / Electron → import { Editor } from '@emr/engine'
  React 项目              → import { EditorProvider } from '@emr/editor-react'
```

### 20.3 构建产物

```
@emr/engine (内核包)
  ├── dist/engine.esm.js    — ES Module (tree-shakable)
  ├── dist/engine.umd.js    — UMD (script 标签引入)
  └── dist/engine.d.ts      — TypeScript 类型声明

@emr/editor-react (React 封装包)
  ├── dist/editor-react.esm.js
  ├── dist/editor-react.d.ts
  └── peerDependencies: react, react-dom, @emr/engine
```

### 20.4 多实例共存

```typescript
/**
 * 单例 vs 实例私有的划分:
 *
 * 全局共享 (只读, 多实例复用):
 *   - FontManager.fontMetrics 缓存
 *   - HarfBuzzShaper WASM 实例
 *   - TextMeasurer cache
 *
 * 实例私有 (每个 Editor 独立):
 *   - DocumentTree + NodePool | EditorRuntimeState | EventBus
 *   - CommandUndoRedoStack | LayoutCache | LayeredRenderer
 *   - CoordinateSystem | AutoSaveManager
 */

interface EditorConfig {
  container: HTMLElement
  resourceBaseUrl?: string
  document?: DocumentTree
  mode?: EditorMode
  scale?: number
}
```

### 20.5 标准扩展点清单

| 扩展点                | 接口                                              | 用途                                  |
| --------------------- | ------------------------------------------------- | ------------------------------------- |
| 自定义节点类型        | `ctx.registerNodeType(type, factory)`           | 注册新的 BlockNode/InlineNode 子类型  |
| 自定义渲染粒子        | `ctx.registerParticle(particle)`                | 注册节点类型对应的 IParticle 渲染器   |
| 自定义命令            | `ctx.registerCommand(type, ctor)`               | 注册新的 ICommand (含快捷键绑定)      |
| 自定义校验规则        | `ctx.registerQCRule(rule)`                      | 注册 QCRule (完整性/一致性/规范性)    |
| 自定义工具栏          | `ctx.registerToolbarItem(group, item)`          | 添加/替换/禁用工具栏按钮              |
| 自定义右键菜单        | `ctx.registerContextMenuItem(item)`             | 添加/替换/禁用右键菜单项              |
| 自定义 SmartText 渲染 | `ctx.registerSmartTextRenderer(type, renderer)` | 覆盖特定 SmartText 控件的渲染与交互   |
| 自定义加载器          | `ctx.registerLoader(loader)`                    | 注册新的 IDocumentLoader (支持新格式) |

```typescript
const myPlugin: IPlugin = {
  name: 'my-custom-controls', version: '1.0.0',
  install(ctx: PluginContext) {
    ctx.registerNodeType('signature', createSignatureNode)
    ctx.registerParticle(new SignatureParticle())
    ctx.registerQCRule(new SignatureRequiredRule())
    ctx.registerToolbarItem('insert', { label: '签章', icon: 'PenTool', onClick: () => editor.execCommand(new InsertSignatureCommand()) })
  },
  enable() {}, disable() {}, destroy() {},
}
editor.use(myPlugin)
```

### 20.6 生命周期与资源销毁契约

```typescript
interface Disposable {
  dispose(): void
}
// 所有内部模块实现 Disposable:
//   FontManager.dispose() | TextMeasurer.dispose() | LayeredRenderer.dispose()
//   EventBus.dispose() | InputComposer.dispose() | AutoSaveManager.dispose()
//   CommandUndoRedoStack.dispose() | LayoutCache.dispose()

interface IEditor {
  onMount(callback: () => void): () => void
  onReady(callback: () => void): () => void
  onPause(callback: () => void): () => void
  onResume(callback: () => void): () => void
  onUnmount(callback: () => void): () => void
  onDestroy(callback: () => void): () => void
  pause(): void   // 释放 Canvas, 停止光标闪烁, 保留文档数据
  resume(): void  // 重建 Canvas, 恢复光标
  destroy(): void // 最终清理, 不可恢复
}
```

### 20.7 标准化错误体系

```typescript
type ErrorSeverity = 'fatal' | 'error' | 'warn'

interface EditorError {
  code: EditorErrorCode; severity: ErrorSeverity
  message: string; cause?: Error; timestamp: number
  recoverable: boolean
}

type EditorErrorCode =
  | 'E_RENDER_CONTEXT_LOST' | 'E_DOCUMENT_CORRUPTED'
  | 'E_WASM_LOAD_FAILED' | 'E_FONT_LOAD_FAILED' | 'E_SAVE_FAILED'
  | 'E_LOAD_FAILED' | 'E_LAYOUT_FAILED' | 'E_RENDER_FAILED'
  | 'W_PASTE_FILTERED' | 'W_NODE_INCOMPATIBLE' | 'W_VALIDATION_FAILED'

/** 节点级错误边界 — 单个节点渲染失败不导致整份文档崩溃 */
function safeRenderParticle(particle: IParticle, layout: ParticleLayout, ctx: RenderContext): RenderRect {
  try { return particle.render(layout, ctx) }
  catch (err) {
    emitError({ code: 'E_RENDER_FAILED', severity: 'error',
                message: `Particle ${particle.particleType} render failed`, cause: err,
                timestamp: Date.now(), recoverable: true })
    return renderPlaceholder(layout, ctx)
  }
}
```

### 20.8 数据格式兼容性对外承诺

```
1. 向后兼容 (Forward Compatible):
   新版本编辑器 100% 能打开所有历史版本文档。
   旧数据通过 ensureLatestModel() 自动静默升级到当前版本。
   升级过程不丢失任何数据, 仅添加新字段/migrate 旧结构。

2. 向前兼容 (Backward Compatible):
   旧版本编辑器打开新版本文档:
   - JSON 序列化保留未知字段 (不掉字段)
   - 不支持的功能降级展示: SmartTextNode 渲染为只读文本, 新节点类型显示占位符
   - 降级展示的文档可编辑保存, 保存后保留未知字段

3. 兼容周期:
   - MAJOR 版本间兼容保证 ≥ 5 年
   - 医疗数据保存周期: 门诊 15 年, 住院 30 年
   - 每个 MAJOR 版本提供独立的数据迁移工具, 支持离线批量转换
```

### 20.9 主题与样式定制

```typescript
interface EditorTheme {
  pageBackground: string; pageShadow: string; marginLineColor: string
  defaultFontFamily: string; defaultFontSize: number; defaultTextColor: string
  cursorColor: string; cursorWidth: number; selectionColor: string
  gridLineColor: string; tableBorderColor: string; tableHeaderBackground: string
  errorBorderColor: string; warningBorderColor: string
  watermarkColor: string; watermarkOpacity: number
}

const THEMES = {
  standard: { /* 标准病历模式 */ },
  eyeCare:  { pageBackground: '#F5F0E8', defaultFontSize: 18 /* 护眼模式 */ },
  print:    { pageBackground: '#FFFFFF', pageShadow: 'none', cursorColor: 'transparent' },
  dark:     { pageBackground: '#1F2937', defaultTextColor: '#E5E7EB' },
}

interface IEditor {
  setTheme(theme: Partial<EditorTheme>): void
  getTheme(): EditorTheme
  resetTheme(): void
}
```

### 20.10 性能分级与可配置阈值

```typescript
interface EditorPerformanceConfig {
  maxUndoDepth: number; maxNodeCount: number; fontCacheSize: number
  incrementalRenderThreshold: number; virtualScrollThreshold: number
  renderPrecision: 'high' | 'normal' | 'low'
}

const PERFORMANCE_MODES = {
  quality:     { maxUndoDepth: 200, renderPrecision: 'high', virtualScrollThreshold: 20 },
  balanced:    { maxUndoDepth: 100, renderPrecision: 'normal', virtualScrollThreshold: 10 },
  performance: { maxUndoDepth: 30, renderPrecision: 'low', virtualScrollThreshold: 3, fontCacheSize: 500 },
  readonly:    { maxUndoDepth: 0, renderPrecision: 'normal', virtualScrollThreshold: 5 },
}

interface IEditor {
  setPerformanceConfig(config: Partial<EditorPerformanceConfig>): void
  setPerformanceMode(mode: 'quality' | 'balanced' | 'performance' | 'readonly'): void
}
```

### 20.11 安全沙箱与权限管控

```typescript
interface EditorSecurityConfig {
  network: { allowFontDownload: boolean; allowImageLoad: boolean; allowWasmRemote: boolean }
  file:    { allowPasteImage: boolean; allowExportDownload: boolean; allowLocalCache: boolean; allowPrint: boolean }
  data:    { allowCopy: boolean; allowCut: boolean; allowExport: boolean; allowPrint: boolean }
  script:  { allowPlugins: boolean; allowCustomNodes: boolean; xssFilter: boolean }
}

const DEFAULT_SECURITY: EditorSecurityConfig = {
  network: { allowFontDownload: false, allowImageLoad: false, allowWasmRemote: false },
  file:    { allowPasteImage: false, allowExportDownload: false, allowLocalCache: true, allowPrint: false },
  data:    { allowCopy: false, allowCut: false, allowExport: false, allowPrint: false },
  script:  { allowPlugins: false, allowCustomNodes: false, xssFilter: true },
}

interface IEditor {
  setSecurityConfig(config: Partial<EditorSecurityConfig>): void
}
```

### 20.12 诊断与排障

```typescript
interface EditorDiagnostics {
  version: { engine: string; modelVersion: string; buildDate: string }
  config: { theme: EditorTheme; performance: EditorPerformanceConfig; security: EditorSecurityConfig }
  document: { pageCount: number; nodeCount: number; smartTextCount: number; fileSize: number }
  performance: { avgKeystrokeLatency: number; avgRenderFrameTime: number; avgLayoutTime: number; cacheHitRate: number }
  errors: EditorError[]
  environment: { userAgent: string; platform: string; screenResolution: string; devicePixelRatio: number }
  memory?: { usedJSHeapSize: number }
}

interface IEditor {
  setLogLevel(level: 'off' | 'error' | 'warn' | 'debug'): void
  dumpDiagnostics(): EditorDiagnostics
  showPerfPanel(visible: boolean): void
}
```

### 20.13 国际化 i18n

```typescript
type LocaleKey =
  | 'toolbar.undo' | 'toolbar.redo' | 'toolbar.bold' | 'toolbar.italic' | 'toolbar.underline'
  | 'toolbar.fontSize' | 'toolbar.fontFamily' | 'toolbar.textColor'
  | 'toolbar.insertTable' | 'toolbar.insertImage' | 'toolbar.save' | 'toolbar.print' | 'toolbar.export'
  | 'contextmenu.cut' | 'contextmenu.copy' | 'contextmenu.paste' | 'contextmenu.delete'
  | 'status.pageInfo' | 'status.wordCount' | 'status.saved' | 'status.saving' | 'status.unsaved'
  | 'error.documentCorrupted' | 'error.renderFailed' | 'error.saveFailed'
  | 'qc.completeness' | 'qc.consistency' | 'qc.standardization' | 'qc.score' | 'qc.pass' | 'qc.fail'

type LocaleMessages = Partial<Record<LocaleKey, string>>

interface IEditor {
  setLocale(messages: LocaleMessages): void
  getLocale(): LocaleMessages
}
// 内置: zh-CN (默认), en-US
```

## 21. AI 原生能力架构

**核心思路**: 引擎对外包装为 MCP (Model Context Protocol) Server，大模型通过结构化接口操作 DocumentTree。AI 操作和人工编辑共用同一套 ICommand 命令体系——AI 发出的 InsertTextCommand 与医生键盘输入的走完全相同的 forward/invert/undo 管线。零特权、零后门。

### 21.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MCP Client (Claude / GPT / ...)                    │
│  通过 stdio/HTTP 与 MCP Server 通信，获取 tools/resources/prompts    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ MCP Protocol (JSON-RPC)
┌────────────────────────────▼────────────────────────────────────────┐
│                      MCP Server (包装层)                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Tools: document.load/create/save, editor.insert_text/delete  │   │
│  │         /format/insert_table/insert_smarttext, qc.check/...   │   │
│  │  Resources: document://{id}/tree /smarttexts /structure /hdsd│   │
│  │  Prompts: 入院记录生成 / 病程记录续写 / 质控检查 / 诊断编码建议 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│              ┌───────────────┴───────────────┐                       │
│              ▼                               ▼                       │
│     ┌────────────────┐              ┌────────────────┐              │
│     │  IEditor API   │              │  ICommand 体系   │              │
│     └────────────────┘              └────────────────┘              │
│                              │                                       │
│              引擎内核 (DocumentTree + NodePool + LayoutEngine + ...) │
└─────────────────────────────────────────────────────────────────────┘
```

### 21.2 MCP Tools 接口定义

```typescript
const MCP_TOOLS = {
  'document.load': {
    description: '加载文档。支持 JSON/XML(HL7 CDA)/HTML/Markdown 自动检测。',
    input: { documentId: 'string', format?: 'json'|'xml'|'html'|'markdown' },
    handler: async (args) => { const doc = await documentLoader.load(args.source); return doc }
  },
  'document.create': {
    description: '创建空白文档，可选指定模板。',
    input: { title: 'string', templateId?: 'string' },
    handler: (args) => createDocument(args.title)
  },
  'editor.insert_text': {
    description: '在指定段落插入文本。paragraphPath 最后一项为 Paragraph ID，offset 为字符偏移。',
    input: { paragraphPath: 'string[]', offset: 'number', text: 'string', style?: 'TextStyle' },
    handler: (args) => editor.execCommand(new InsertTextCommand(generateId(), Date.now(), 'ai', args.paragraphPath, args.offset, args.text, args.style))
  },
  'editor.delete_range': {
    description: '删除指定范围的文本。',
    input: { path: 'string[]', startOffset: 'number', endOffset: 'number' },
    handler: (args) => editor.execCommand(new DeleteRangeCommand(generateId(), Date.now(), 'ai', args.path, args.startOffset, args.endOffset))
  },
  'editor.format': {
    description: '对指定节点应用/取消样式。',
    input: { nodeIds: 'string[]', changes: 'TextStyle' },
    handler: (args) => editor.execCommand(new FormatTextCommand(generateId(), Date.now(), 'ai', args.nodeIds, args.changes))
  },
  'editor.insert_table': {
    description: '在文档末尾插入表格。',
    input: { rows: 'number', cols: 'number', headers?: 'string[]' },
    handler: (args) => editor.execCommand(new InsertBlockCommand(generateId(), Date.now(), 'ai', [doc.body.id], doc.body.children.length, createSimpleTable(args.rows, args.cols)))
  },
  'editor.insert_smarttext': {
    description: '插入结构化字段 (SmartTextNode)。',
    input: { path: 'string[]', offset: 'number', hdsdCode: 'string', value: 'string' },
    handler: (args) => { /* findByInternal → 获取 ElementMeta → createSmartTextNode */ }
  },
  'qc.check': {
    description: '对文档执行质控检查，返回 findings[] + score。',
    input: { documentId: 'string' },
    handler: async (args) => { const doc = await loadDocument(args.documentId); return qcEngine.check(doc, pool) }
  },
  'template.apply': {
    description: '将模板应用到当前文档 (替换 body)。',
    input: { documentId: 'string', templateId: 'string' },
    handler: async (args) => { const tpl = await apiClient.getTemplate(args.templateId); editor.setDocument(tpl.content) }
  },
}
// 所有 editor.* Tool 的 author 字段标记为 'ai'
// AI 的撤销和人类的撤销在同一个历史栈中，Ctrl+Z 可回退 AI 操作。
```

### 21.3 MCP Resources 数据视图

```typescript
// document://{id}/structure — 文档大纲
{
  "title": "入院记录",
  "sections": [
    { "heading": "主诉", "paragraphIds": ["para_001"], "smartTexts": [] },
    { "heading": "现病史", "paragraphIds": ["para_002","para_003"],
      "smartTexts": [{ "hdsdCode": "HDSD00.01.001", "name": "患者姓名", "value": "" }] },
    { "heading": "体格检查",
      "tables": [{ "id": "tbl_001", "rows": 5, "cols": 3, "caption": "生命体征" }] }
  ],
  "pageCount": 3, "nodeCount": 1245, "smartTextCount": 47
}

// document://{id}/smarttexts — 结构化字段清单
[
  { "id": "st_001", "hdsdCode": "HDSD00.01.001", "name": "患者姓名", "value": "", "required": true, "dataType": "S1" },
  { "id": "st_002", "hdsdCode": "HDSD00.01.002", "name": "性别", "value": "", "required": true, "dataType": "S2", "dictionary": "gender" },
]

// document://{id}/hdsd/{hdsdCode} — 按 HDSD 编码查询字段值
// GET document://doc_123/hdsd/HDSD00.01.001 → { "value": "张三", "nodeId": "st_001" }
```

### 21.4 临床直接落地场景

| 场景                     | MCP 调用链                                                                                                                  | 引擎能力依赖                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **AI 辅助填表**    | `document.load` → `document://{id}/smarttexts` 读空字段 → `editor.insert_smarttext` 逐字段填充                      | SmartTextNode / findByInternal O(1) / ICommand |
| **病史续写**       | `document://{id}/structure` 读现病史章节 → LLM 生成续写段落 → `editor.insert_text` 追加                               | NodePool / InsertTextCommand + Run 模型合并    |
| **智能质控**       | `qc.check` → 返回 findings[] → LLM 解释 findings + 生成修正建议 → `editor.format` / `editor.delete_range` 自动修正 | QCEngine / JSONLogic DSL / ICommand            |
| **模板推荐**       | `template.list` → LLM 根据患者信息推荐模板 → `template.apply`                                                         | 模板系统 / DocumentTree                        |
| **诊断编码建议**   | `document://{id}/hdsd/{code}` 查诊断字段 → LLM 匹配 ICD-10 编码 → `editor.insert_smarttext` 填入                      | findByDE / SmartTextNode                       |
| **结构化摘要生成** | `document://{id}/tree` 全文档 → LLM 生成出院摘要 → `document.create` 新文档                                           | DocumentLoader / createDocument                |

### 21.5 延伸拓展场景

| 场景                   | 描述                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| **多文档对比**   | 同时加载患者多次就诊病历，LLM 对比病情变化趋势，生成对比报告          |
| **知识库 RAG**   | MCP Server 连接医院知识库/诊疗指南，LLM 在生成内容时实时引用文献编号  |
| **语音录入**     | 语音转文本 → MCP `editor.insert_text` 直接写入病历，人工审核后保存 |
| **批量数据分析** | LLM 遍历全院病历的 SmartTextNode 字段，生成疾病统计/用药趋势/质控报告 |
| **自动化文书**   | 根据检查结果自动生成检查报告、知情同意书等结构化文书                  |

### 21.6 产品化核心竞争优势

| 优势                 | 说明                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| **零特权 AI**  | AI 走 ICommand 管线，所有操作可撤销、可审计、权限受 EditorSecurityConfig 控制          |
| **结构化原生** | SmartTextNode + HDSD/DE 编码让 LLM 理解字段语义，而非盲写纯文本                        |
| **引擎复用**   | MCP Server 只是包装层，引擎内核零改动 |
| **离线可用**   | MCP Server 基于 stdio 本地运行，不需要云端 API |
| **合规友善**   | 所有 AI 操作留痕 (author='ai')，质控可追溯，符合医疗合规要求 |

### 21.7 落地实施顺序

```
Phase 1 (2 周) — MCP 最小可用
  ├── MCP Server 框架搭建 (stdio transport)
  ├── 实现 5 个核心 Tool: document.load/create, editor.insert_text/delete_range, qc.check
  ├── 实现 2 个 Resource: document://{id}/smarttexts, document://{id}/structure
  └── 引擎 zero-change (纯包装层)

Phase 2 (2 周) — 完整 Tool 矩阵
  ├── editor.insert_table, editor.format, editor.insert_smarttext
  ├── template.apply/list, qc.rules.list
  ├── 全部 Resources + Prompts 模板
  └── author='ai' 审计链路

Phase 3 (远期) — 知识库 RAG + 语音 + 数据分析
```

## 22. 技术债务全貌

### 22.1 技术债务清单

| #     | 问题                                          | 严重度  | v4.0 状态 |
| ----- | --------------------------------------------- | ------- | --------- |
| 1     | 纯嵌套结构无节点池 →**已设计 §2.1**     | 高      | 待实现    |
| 2     | 表格模型过薄 →**已设计 §9**            | 高      | 待实现    |
| 3     | 无布局缓存 →**已设计 §7.4**            | 高      | 待实现    |
| 4     | 单 Canvas 无分层 →**已设计 §7.5**      | 高      | 待实现    |
| 5     | 无命中检测体系 →**已设计 §7.6**        | 高      | 待实现    |
| 6     | Draw.ts 上帝类                                | 高      | §8.1     |
| 7     | 全量重布局/重绘                               | 高      | §7.3     |
| 8     | 快照式撤销                                    | 高      | §6       |
| 9     | 下标路径定位                                  | 中      | §2.1     |
| 10    | 选区模型不完备 →**已设计 §8.2**       | 中      | 待实现    |
| 11    | 命令无事务合并 →**已设计 §6.4**       | 中      | 待实现    |
| 12    | IME 无抽象层 →**已设计 §8.4**         | 中      | 待实现    |
| 13    | LineBreaker/PageBreaker 未集成                | 中      | -         |
| 14    | 插件无生命周期 →**已设计 §8.5**       | 中      | 待实现    |
| 15    | 版本兼容机制过弱 →**已设计 附录 E**    | 中      | 待实现    |
| 16    | 大文档无虚拟化 →**已设计 附录 A**     | 中      | 待实现    |
| 17    | 内存无管理策略 →**已设计 附录 A**     | 中      | 待实现    |
| 18    | 测试体系无设计 →**已设计 附录 B**     | 中      | 待实现    |
| 19    | 打印一致性无保障 →**已设计 附录 C**   | 中      | 待实现    |
| 20    | 错误边界缺失 →**已设计 附录 D**       | 中      | 待实现    |
| 21    | runtime 状态散落                              | 低      | §4       |
| 22    | FlowBody 双模模糊                             | 低      | §2.6     |
| 23-28 | 其他低优先级项                                | 低/远期 | 见 v3.0   |

### 22.2 治理优先级

```
P0 (立即 — 工程化基础):
  1. 节点池 + ID 引用 (§2.1)          — 为协作、缓存、增量更新建立 O(1) 查找基础
  2. 布局缓存体系 (§7.4)              — 增量布局的前提
  3. Canvas 分层渲染 (§7.5)          — 光标/选区高频刷新不触发内容重绘

P1 (短期 — 核心体验):
  4. 命中检测体系 (§7.6)             — 统一交互基础
  5. 命令事务与合并 (§6.4)           — 撤销体验
  6. 选区模型增强 (§8.2)             — 跨段落/表格选区
  7. EditorRuntimeState + Command 体系 — 架构基础

P2 (中期 — 场景支撑):
  8. 表格模型增强 (§9)               — 医疗表格场景
  9. InputComposer (§8.4)            — IME 兼容
  10. 插件生命周期 (§8.5)            — 扩展性
  11. 语义化版本 (附录 E)            — 线上兼容

P3 (远期):
  12. 大文档虚拟化 + 内存管理 (附录 A)
  13. 测试体系 (附录 B)
  14. 打印一致性 + 错误降级 (附录 C-D)
```

---

## 附录

### 附录 A: 大文档虚拟化与内存管理

**问题**: 仅提了 `visiblePages`，没有懒布局、视口渲染、节点回收策略；图片/字体/布局/Undo 缓存均无释放策略。

**方案**:

```typescript
// ---- 视口虚拟化 ----
interface VirtualViewport {
  visiblePages: { start: number; end: number }
  overscan: number
  update(scrollY: number, pageHeight: number, viewportHeight: number): void
}

// ---- 懒布局 ----
class LazyLayoutEngine {
  layoutVisible(document: DocumentTree, viewport: VirtualViewport, cache: LayoutCache): PageItem[]
  evictOutOfView(viewport: VirtualViewport): void
}

// ---- 内存管理 ----
class MemoryManager {
  private maxUndoDepth = 100
  private maxImageCacheMB = 50
  private maxLayoutCacheEntries = 5000

  enforceLimits(layoutCache: LayoutCache, undoStack: ICommand[]): void {
    // LayoutCache: LRU 淘汰超量条目
    // UndoStack: 超出 maxDepth 时合并早期历史
    // TextMeasurer: 定期清理低频缓存条目
  }
}
```

### 附录 B: 测试体系设计

**问题**: Canvas 渲染结果无法自动化验证，布局、交互逻辑没有单元测试边界。

**方案**:

```typescript
// 分层测试策略:
// L1: 纯函数单元测试 (无 DOM 依赖) — 覆盖率 ≥80%
// L2: node-canvas 集成测试 — 覆盖率 ≥60% 或 happy-dom + canvas mock
// L3: Playwright E2E (文本编辑/格式化/IME/表格/保存) — 截图断言

// 关键测试边界:
describe('InsertTextCommand', () => {
  it('forward() 应在正确位置插入 TextNode')
  it('invert() 应返回等效的 DeleteRangeCommand')
  it('forward + invert 应恢复文档到原始状态')  // 黄金测试
  it('serialize/deserialize 应保持等价')
})

describe('LayoutCache', () => {
  it('version 不匹配时 isValid() 应返回 false')
  it('invalidate() 应使对应节点的缓存失效')
  it('同一节点同一版本不应重复计算')
})

describe('CommandUndoRedoStack', () => {
  it('事务内多个命令应作为单次撤销单元')
  it('超出 maxDepth 时应合并早期历史')
})
```

### 附录 C: 打印导出一致性保障

**问题**: 前后端两套渲染逻辑，不一致会导致医疗场景业务事故。

**方案**:

```typescript
/**
 * 一致性保障策略: 单一渲染源 (Single Source of Rendering)
 *
 * 核心原则: 所有格式的导出都复用前端的 LayoutEngine + TextMeasurer 计算结果
 * 后端不做独立排版，只做格式转换 (布局中间结果 → PDF/HTML)
 *
 * 实现路径:
 *   Step 1: 前端布局引擎输出「布局中间结果」JSON (SLIF, 见 §7.7)
 *   Step 2: 布局中间结果 + DocumentTree 原数据 → 发送到后端
 *   Step 3: 后端 iText/Thymeleaf 按布局中间结果精确放置内容
 *   Step 4 (可选): 后端嵌入相同字体文件，TextMeasurer 逻辑移植到 Java 做二次验证
 */

interface ExportLayoutResult {
  modelVersion: string
  documentId: string
  pages: ExportPage[]
}
interface ExportPage {
  pageIndex: number; width: number; height: number
  items: ExportItem[]
}
interface ExportItem {
  text: string; x: number; y: number; width: number; height: number
  font: string; size: number; bold?: boolean; italic?: boolean
  color?: string; underline?: boolean
}
```

### 附录 D: 错误边界与降级策略

**问题**: 布局异常、渲染崩溃、模型损坏时没有兜底降级方案，单节点错误可能导致整份文档打不开。

**方案**:

```typescript
/**
 * 错误边界 — 层层兜底
 */

// L1: 节点级错误隔离
function safeRenderParticle(particle: IParticle, layout: ParticleLayout, ctx: RenderContext): RenderRect | null {
  try { return particle.render(layout, ctx) }
  catch (err) {
    console.error(`[Render] Particle ${particle.particleType} render failed:`, err)
    // 降级: 渲染红色占位框替代崩溃节点
    ctx.ctx.fillStyle = '#FEE2E2'; ctx.ctx.fillRect(layout.x, layout.y, layout.width || 50, layout.height || 20)
    ctx.ctx.strokeStyle = '#EF4444'; ctx.ctx.strokeRect(layout.x, layout.y, layout.width || 50, layout.height || 20)
    return null
  }
}

// L2: 页面级错误隔离
function safeRenderPage(page: Page, renderer: LayeredRenderer): void {
  try { renderer.renderContent(computePageItems(page)) }
  catch (err) { console.error(`[Render] Page ${page.id} render failed:`, err); renderer.renderErrorPage(page.id, err.message) }
}

// L3: 文档级错误恢复
async function safeLoadDocument(json: string): Promise<DocumentTree> {
  try { return loadDocument(json) }
  catch (err) {
    if (err instanceof DocumentValidationError) {
      const backup = getLatestBackup()
      if (backup) return backup
    }
    throw new DocumentLoadError('文档数据损坏，且无可恢复的备份')
  }
}
```

### 附录 E: 语义化模型版本与向下兼容规则

```typescript
/**
 * 语义化模型版本: MAJOR.MINOR.PATCH
 * - MAJOR: 破坏性变更 (不向后兼容的模型结构调整)
 * - MINOR: 新增字段/类型 (向后兼容，旧版本可忽略新字段)
 * - PATCH: 校验规则修正、默认值变更 (完全兼容)
 */
const MODEL_VERSION = '4.0.0'  // 当前模型版本 (v19.10: 全文档统一)

interface ModelUpgrader {
  from: string; to: string
  breaking: boolean
  upgrade(doc: DocumentTree): DocumentTree
}

const upgraders: ModelUpgrader[] = [
  { from: '2.0.0', to: '3.0.0', breaking: false,
    upgrade(doc: DocumentTree): DocumentTree { /* 添加 metadata + FlowBody 包装 */ }
  },
  { from: '3.0.0', to: '4.0.0', breaking: true,
    upgrade(doc: DocumentTree): DocumentTree { /* children: BaseNode[] → children: string[] */ }
  },
]

/**
 * 模型版本兼容矩阵:
 *
 *                   保存端 (写入)
 *                   v3.0   v4.0   v5.0
 * 打开端 (读取)   ┌─────────────────────
 *            v3.0 │  ✅     ❌1    ❌1
 *            v4.0 │  ✅2    ✅     ❌1
 *            v5.0 │  ✅2    ✅2    ✅
 *
 * ✅  = 正常打开  ❌1 = 拒绝打开，提示 "请升级编辑器"  ✅2 = 静默升级
 *
 * 规则:
 * 1. 向前兼容 (必须): 高版本客户端必须能打开低版本文档 (✅2)
 * 2. 保存时强制升级: 编辑后保存时写入当前 MODEL_VERSION
 * 3. 低版本拒绝高版本文档: if (doc.modelVersion > CLIENT_MODEL_VERSION) throw new VersionError()
 * 4. 破坏性升级: 必须提供「向前兼容读取 + 静默升级保存」路径
 * 5. 非破坏性升级: 旧版本客户端可忽略新字段 (JSON 序列化保留未知字段)
 */

function loadDocument(json: string): DocumentTree {
  const parsed = JSON.parse(json)
  const version = parsed.metadata?.modelVersion || '1.0.0'
  let doc = parsed as DocumentTree
  for (const upgrader of upgraders) {
    if (compareVersions(version, upgrader.from) >= 0 && compareVersions(version, upgrader.to) < 0) {
      doc = upgrader.upgrade(doc)
    }
  }
  const result = validateDocumentTree(doc)
  if (!result.valid) throw new DocumentValidationError(result.errors)
  return doc
}

function saveDocument(doc: DocumentTree): string {
  if (!doc.metadata) doc.metadata = {}
  doc.metadata.modelVersion = MODEL_VERSION
  return JSON.stringify(doc)
}
```

### 附录 F: 核心接口契约骨架 (v20.17 — 与 §6.1 逐字一致)

```typescript
// 编译时强制约束 — 实现者必须遵守，调用方依赖这些契约
// 权威定义见 §6.1, 此处为速查副本

/** ICommand — CommandContext 联合上下文, forward 后快照 frozen */
interface ICommand {
  readonly type: string; readonly id: string; readonly timestamp: number; readonly author: string
  forward(ctx: CommandContext): StatePatch | null
  invert?(ctx: CommandContext): ICommand | null  // collab 模式返回 null
  serialize(): SerializedCommand
  static deserialize(data: SerializedCommand): ICommand
}

/** IParticle — 所有可渲染元素的统一接口 */
interface IParticle extends HitTestable {
  readonly particleType: string
  render(layout: ParticleLayout, context: RenderContext): RenderRect
  measure(context: MeasureContext): { width: number; height: number }
  hitTest(docX: number, docY: number): string | null
}

/** ITextShaper — 文本塑形引擎 */
interface ITextShaper {
  shape(text: string, font: FontVariant, size: number): Promise<ShapedGlyph[]>
}
interface ShapedGlyph { char: string; xAdvance: number; xOffset: number; yOffset: number; glyphId: number }

/** IDocumentLoader — 文档格式加载器 */
interface IDocumentLoader {
  readonly extensions: string[]; readonly name: string
  load(source: string | ArrayBuffer, options?: LoadOptions): Promise<DocumentTree>
  detect(source: string | ArrayBuffer): boolean
}

/** IPlugin — 插件生命周期 */
interface IPlugin {
  readonly name: string; readonly version: string
  install(ctx: PluginContext): void
  enable(): void; disable(): void; destroy(): void
}

/** IInputComposer — 输入法抽象 */
interface IInputComposer {
  onCompositionStart(cb: () => void): void
  onCompositionUpdate(cb: (text: string, cursorRect: DOMRect) => void): void
  onCompositionEnd(cb: (text: string) => void): void
  getComposingText(): string; updateCursorRect(rect: DOMRect): void
  focus(): void; blur(): void; destroy(): void
}
```

### 附录 G: 协作预留的位置锚定约束

**问题**: 当前 CursorState 用 ID 路径 `string[]` + `offset`，但 Command 中仍有基于下标索引的位置表达。下标在并发编辑下不稳定。

**规则**:

```typescript
/**
 * 协作安全的位置锚定铁律:
 *
 * 所有位置表达统一采用「节点 ID + 相对偏移」，禁止使用数组下标作为持久化位置。
 *
 * 适用范围:
 *   ✅ CursorState.path + offset      — 已遵循
 *   ✅ Command 构造函数的位置参数      — 已遵循
 *   ✅ SelectionState 锚点            — 已遵循
 *   ❌ deleteRange(para.children, 3, 7) — 违反: 依赖数组下标
 *   ❌ cursorBlock=2, cursorInline=5   — 违反: 纯下标定位
 *
 * 修正:
 *   1. 废弃 Draw.ts 中的 cursorPage/cursorBlock/cursorInline 三元组
 *   2. 所有 Handler 发出的位置事件携带 CursorState (path + offset)
 *   3. 协作同步的 SerializedCommand 中所有位置字段均为 path + offset
 *
 * 为什么: CRDT/OT 的核心是并发操作下的位置稳定性。
 *   - 用户 A 在 paragraph[3] 插入一个字符 → paragraph 变为 [4]
 *   - 用户 B 的 "delete paragraph[3]" 若用下标, 会误删 A 刚插入的段落
 *   - 若用节点 ID, B 的 delete 目标是特定 Paragraph ID, 不受 A 的插入影响
 */
```
