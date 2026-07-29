# 架构设计文档 - 文档编辑器引擎

> 版本: v3.0 | 日期: 2026-07-28 | 阶段: docs (深度补齐)
>
> **v3.0 变更**: 新增 EditorRuntimeState、Command 体系、FlowBody 双模定义、模型校验与版本兼容、协作同步协议、Particle 统一接口、坐标系统契约、Draw 拆分边界方案、权限优先级、非功能需求、数据迁移方案、打印/导出链路、自动保存策略、增量布局/渲染方案、乐观锁与审计日志

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
│  │  │  │ EditorRuntimeState (新增 v3.0)               │  │  │  │
│  │  │  │ cursor | selection | viewMode | scroll | IME │  │  │  │
│  │  │  └──────────────────────────────────────────────┘  │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Command System (新增 v3.0)                         │  │  │
│  │  │  ICommand → InsertText | DeleteText | FormatText   │  │  │
│  │  │           | InsertElement | ModifyElement | ...    │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Layout Engines                                    │  │  │
│  │  │  TextMeasurer | LineBreaker | PageBreaker          │  │  │
│  │  │  + IncrementalLayout (局部增量布局, v3.0)           │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Render Pipeline                                   │  │  │
│  │  │  Draw → IParticle[] → Canvas (增量渲染, v3.0)      │  │  │
│  │  │  TextParticle | ImageParticle | TableParticle      │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Interaction Layer (拆分重构后, v3.0)               │  │  │
│  │  │  EventBus → MouseHandler | KeyboardHandler         │  │  │
│  │  │           | IMEHandler | ClipboardHandler           │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  State Layer                                       │  │  │
│  │  │  CoordinateSystem | UndoRedoStack | TreePath       │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Document Model (ModelD)                           │  │  │
│  │  │  DocumentTree → Page[] → FlowBody → BlockNode[]    │  │  │
│  │  │  + ElementFormatter (工厂/遍历/快照)               │  │  │
│  │  │  + ModelValidator (校验器, v3.0)                   │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Auto-Save Engine (v3.0)                           │  │  │
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
│  │  + modelVersion 版本兼容中间件 (v3.0)                     │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  业务服务层                                              │  │
│  │  DocumentService | TemplateService | ExportService       │  │
│  │  CollaborationService | PermissionService | AuditService │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  数据访问层 (乐观锁 version 字段, v3.0)                   │  │
│  │  Mybatis-Plus | Redis Cache                              │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  基础设施层                                              │  │
│  │  MySQL 8.0 JSON | Redis 7 | MinIO | RabbitMQ            │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计原则

**三大铁律** (v5.0 显式声明):

| 原则 | 含义 | 反模式 |
|------|------|--------|
| **接口抽象** | 所有跨模块边界通过 interface 通信；具体实现可替换，不修改调用方 | 直接 `new` 具体类、硬编码 Canvas API |
| **数据增量** | 编辑后仅重新计算受影响的数据，非全量重建；所有缓存通过 version 判断有效性 | 全量 recomputeLayout()、全画布 clearRect() |
| **计算渲染分离** | 布局计算 (layout/) 不接触 Canvas；渲染 (render/) 只消费布局结果，不重复测量 | Draw.ts 中混用 measureText + fillText |

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

| 维度 | ModelA (v1.0) | ModelD (v2.0) | ModelD (v3.0 目标) |
|------|--------------|---------------|---------------------|
| 文档模型 | 扁平 `IElement[]` | 树形 `DocumentTree` | 树形 + metadata 扩展 |
| 运行时状态 | 散落 Draw.ts | 散落 Draw.ts | **独立 EditorRuntimeState** |
| 编辑驱动 | 内联方法调用 | 内联方法调用 | **Command 命令模式** |
| 撤销/重做 | HistoryManager | 内联 JSON 快照 | **UndoRedoStack + Command 增量** |
| 光标定位 | 数组下标 | treePath (pi,bi,ii) | **ID 链路路径 string[]** |
| 坐标系统 | 多处重复换算 | 多处重复换算 | **统一 CoordinateSystem** |
| 粒子渲染 | 无统一接口 | 无统一接口 | **IParticle 统一接口** |
| 布局渲染 | 全量重算 | 全量重算 | **增量布局 + 增量渲染** |
| 模型校验 | 无 | 无 | **ModelValidator + JSON Schema** |

---

## 2. 前端架构设计

### 2.1 文档数据模型 (ModelD)

树形文档模型，天然映射到电子病历的层级结构：

```
DocumentTree
├── id, title, pageSetup
└── pages: Page[]
    ├── header: BlockNode[]
    ├── body: FlowBody | BlockNode[]
    │   └── (FlowBody) mode: 'flow'
    │       └── children: BlockNode[]
    │           ├── Paragraph
    │           │   └── children: InlineNode[]
    │           │       ├── TextNode        (普通文本)
    │           │       └── SmartTextNode   (带医疗元数据的结构化字段)
    │           └── Table
    │               └── children: TableRow[]
    │                   └── children: TableCell[]
    │                       └── children: BlockNode[]  (支持段落/表格嵌套)
    └── footer: BlockNode[]
```

#### 核心类型定义

```typescript
// ================================================================
// 节点类型标识
// ================================================================
const NodeType = {
  DOCUMENT: 'document', PAGE: 'page',
  PARAGRAPH: 'paragraph', TABLE: 'table', ROW: 'row', CELL: 'cell',
  TEXT: 'text', SMART_TEXT: 'smarttext',
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
  indent?: number; lineHeight?: number
  spaceBefore?: number; spaceAfter?: number
}

// ================================================================
// BaseNode 扩展 (v3.0 新增 metadata)
// ================================================================
interface BaseNode {
  id: string
  type: NodeType
  /** 通用扩展字段，承载批注引用/锁定状态/业务标签等，避免侵入节点定义 */
  metadata?: Record<string, unknown>
}

// 典型 metadata 用途示例:
// { locked: true }                              — 段落锁定 (不可编辑内容)
// { undeletable: true }                         — 节点不可删除 (模板结构保护)
// { annotations: ['anno_001', 'anno_002'] }     — 关联批注 ID 列表
// { tags: ['vital_signs', 'required'] }          — 业务标签

// ================================================================
// 医疗数据元 (SmartTextNode 专属)
// ================================================================
interface ElementCode {
  internal: string     // 医院内部编码 (HDSD), 如 'HDSD00.12.132'
  dataElement: string  // 国家标准数据元编码 (DE), 如 'DE07.00.007.00'
}
interface ElementFormat {
  dataType: 'S1' | 'S3' | 'N' | 'D'
  showType?: 'AN' | 'N'
  minLength?: number; maxLength?: number
  dictionary?: string
}
interface ElementMeta {
  code: ElementCode; name: string; labels?: string[]
  format?: ElementFormat; required?: boolean
  readonly?: boolean; privacy?: boolean
}

// ================================================================
// 节点层次
// ================================================================

// 内联节点
interface TextNode extends BaseNode, TextStyle {
  type: 'text'; text: string
}
interface SmartTextNode extends BaseNode, TextStyle {
  type: 'smarttext'; text: string
  element: ElementMeta    // 医疗数据元绑定
}
type InlineNode = TextNode | SmartTextNode

// 块级节点
interface Paragraph extends BaseNode, ParagraphStyle {
  type: 'paragraph'; children: InlineNode[]
}
interface Table extends BaseNode {
  type: 'table'; colWidths?: number[]; children: TableRow[]
}
interface TableRow extends BaseNode {
  type: 'row'; height?: number; children: TableCell[]
}
interface TableCell extends BaseNode {
  type: 'cell'; colspan?: number; rowspan?: number
  children: BlockNode[]
  backgroundColor?: string; verticalAlign?: 'top' | 'middle' | 'bottom'
  isHeader?: boolean
}
type BlockNode = Paragraph | Table

// 页面 & 文档
interface Page {
  type: 'page'; id: string
  header: BlockNode[]; body: PageBody; footer: BlockNode[]
}
interface PageSetup {
  width: number; height: number
  marginTop: number; marginBottom: number
  marginLeft: number; marginRight: number
  orientation: 'portrait' | 'landscape'
  /** 页面级水印 (v5.0 新增) */
  watermark?: WatermarkConfig
}

// ================================================================
// 数字水印 (v5.0 新增)
// ================================================================
type WatermarkType = 'text' | 'image'

interface WatermarkConfig {
  type: WatermarkType
  /** 文本水印内容 (type='text' 时) */
  text?: string
  /** 图片水印 URL (type='image' 时) */
  imageUrl?: string
  /** 透明度 (0-1, 默认 0.08) */
  opacity: number
  /** 旋转角度 (度, 默认 -30) */
  rotation: number
  /** 水印间距 (px, 默认 200) */
  spacing: number
  /** 字体大小 (type='text', 默认 48) */
  fontSize?: number
  /** 字体颜色 */
  color?: string
  /** 排版模式 */
  mode: 'tile' | 'center'  // 平铺 | 居中单个
}

// 默认水印配置
const DEFAULT_WATERMARK: WatermarkConfig = {
  type: 'text',
  opacity: 0.08, rotation: -30, spacing: 200,
  fontSize: 48, color: '#000000', mode: 'tile',
}
interface DocumentTree {
  type: 'document'; id: string; title: string
  pageSetup: PageSetup; pages: Page[]
  /** 文档级扩展 (模板 ID、版本号、schema 版本等) */
  metadata?: Record<string, unknown>
}

const DEFAULT_PAGE_SETUP: PageSetup = {
  width: 794, height: 1123,
  marginTop: 72, marginBottom: 72,
  marginLeft: 90, marginRight: 90,
  orientation: 'portrait',
}
```

#### 2.1.1 节点池 — 扁平化 ID 索引 (v4.0 新增)

**问题**: 当前 DocumentTree 是纯嵌套结构，节点通过 `children: BaseNode[]` 直接挂载对象引用。`findById()` 需要递归遍历整棵树，O(n) 复杂度。节点数超 5000 后性能指数级下降，协作编辑的 O(1) 节点查找无法实现。

**方案**: 引入「节点池 + ID 引用」模式。

```typescript
/**
 * 扁平化节点池 — 物理存储层
 *
 * 核心设计:
 * - nodes: Map<string, BaseNode>  所有节点按 ID 扁平索引，O(1) 查找
 * - 父节点只存 children: string[]  子节点 ID 数组，不存对象引用
 * - 树形结构通过 ID 链逻辑表达，物理存储是扁平 Map
 *
 * 与现有 DocumentTree 的关系:
 * - DocumentTree 是逻辑视图 (树形遍历、序列化)
 * - NodePool 是物理存储 (查找、更新、缓存)
 * - 序列化时: NodePool → DocumentTree (通过 ID 引用还原嵌套结构)
 * - 反序列化时: DocumentTree → NodePool (展平嵌套，建立 ID 索引)
 */
interface NodePool {
  /** 节点扁平池 — 所有节点按 ID 唯一索引 */
  nodes: Map<string, BaseNode>

  /** 根节点 ID (DocumentTree 的 ID) */
  rootId: string

  /** 节点版本号 — 用于缓存失效判断 (每次修改 +1) */
  version: number
}

/** 所有父节点统一使用 string[] 存储子节点引用 */
interface Paragraph {
  id: string; type: 'paragraph'
  children: string[]       // InlineNode ID 数组 (不再是 InlineNode[])
  alignment?: 'left' | 'center' | 'right' | 'justify'
  // ...
}
interface TableRow {
  id: string; type: 'row'
  children: string[]       // TableCell ID 数组
  height?: number
}
// 同理: FlowBody.children → string[], Page.pages → string[]

/**
 * 从 DocumentTree 构建 NodePool (反序列化时调用)
 * O(n) 单次遍历，后续查找 O(1)
 */
function buildNodePool(tree: DocumentTree): NodePool {
  const nodes = new Map<string, BaseNode>()
  traverse(tree, (node) => {
    if (node && typeof node === 'object' && 'id' in node) {
      nodes.set((node as BaseNode).id, node as BaseNode)
    }
  })
  return { nodes, rootId: tree.id, version: 0 }
}

/**
 * NodePool → DocumentTree (序列化时调用)
 * 通过 children ID 数组还原嵌套对象引用
 */
function poolToTree(pool: NodePool): DocumentTree {
  // 从 rootId 出发，递归将 children: string[] 替换为 children: BaseNode[]
  // 通过 pool.nodes.get(id) 做 O(1) 查找
}

/**
 * O(1) 节点查找 (替代递归 findById)
 */
function getNodeById(pool: NodePool, id: string): BaseNode | undefined {
  return pool.nodes.get(id)
}

/**
 * O(1) 节点更新 + 自动 version 递增 (用于缓存失效)
 */
function updateNode(pool: NodePool, id: string, changes: Partial<BaseNode>): void {
  const node = pool.nodes.get(id)
  if (node) { Object.assign(node, changes); pool.version++ }
}
```

**迁移路径**: 渐进引入 NodePool，不破坏现有 DocumentTree API。
- Phase 1: 新增 `NodePool` 类型 + `buildNodePool()` / `poolToTree()` 转换函数，现有代码继续用 DocumentTree
- Phase 2: `Draw.recomputeLayout()` 内部使用 NodePool 做 O(1) 节点查找
- Phase 3: `Command.forward()` 通过 NodePool 定位节点，替代 `findById()` 递归
- Phase 4: 序列化/反序列化层统一使用 NodePool 作为内部表示

#### 2.1.2 表格模型增强 (v4.0 新增)

**问题**: 当前 Table 模型仅定义了 `行 → 单元格 → BlockNode[]` 的基础层次，缺失列级定义、合并单元格矩阵、跨页断表规则。电子病历是表格重度场景，现有模型无法支撑。

**方案**: 补齐表格核心工程化要素。

```typescript
// ================================================================
// 列级定义
// ================================================================
interface ColumnDefinition {
  /** 列宽计算规则 */
  width: number
  /** 最小宽度 (px) */
  minWidth?: number
  /** 列宽模式 */
  mode: 'fixed'       // 固定宽度
       | 'auto'       // 自动 (根据内容)
       | 'percentage' // 百分比 (width 为 0-100)
}

// ================================================================
// 表格布局算法接口
// ================================================================
interface TableLayoutAlgorithm {
  /** 计算最终列宽数组 (输入: 可用宽度 + 列定义, 输出: 实际列宽 px[]) */
  compute(availableWidth: number, columns: ColumnDefinition[]): number[]
}

/** 固定布局: 按定义宽度分配，多余空间均分给 auto 列 */
class FixedTableLayout implements TableLayoutAlgorithm { /* ... */ }

/** 自适应布局: 扫描所有单元格内容，按内容最大宽度分配 */
class AutoTableLayout implements TableLayoutAlgorithm { /* ... */ }

// ================================================================
// 合并单元格矩阵 (预计算，避免每次渲染重复算)
// ================================================================
interface MergeMatrix {
  /** 行数 */
  rows: number
  /** 列数 */
  cols: number
  /**
   * grid[r][c] = 该位置的单元格 ID
   * 被 rowspan/colspan 占据的格子填充相同 ID
   * 空位 (被合并覆盖) = null
   */
  grid: (string | null)[][]

  /** 单元格 ID → 合并信息映射 */
  spans: Map<string, { rowspan: number; colspan: number }>
}

/**
 * 从 Table 节点构建合并矩阵
 * O(rows × cols) 单次预计算
 */
function buildMergeMatrix(table: Table): MergeMatrix {
  // 遍历 table.children (TableRow[])，根据每个 TableCell 的 colspan/rowspan
  // 填充 grid 二维数组，标记被覆盖的格子
}

// ================================================================
// 增强的 Table 节点
// ================================================================
interface Table extends BaseNode {
  type: 'table'
  columns: ColumnDefinition[]     // 列定义 (v4.0 新增)
  children: TableRow[]
  /** 跨页断表规则 */
  pageBreak?: TablePageBreakRule
}

interface TablePageBreakRule {
  /** 是否每页重复表头 */
  repeatHeader: boolean
  /** 最小断行位置 (避免孤行) */
  minRowsBeforeBreak: number
  /** 续接标记文本 (如 "续表") */
  continuationLabel?: string
}
```

### 2.2 FlowBody 双模正文定义 (v3.0 新增)

`PageBody` 有两种表示形式，各有明确的业务使用场景：

#### 2.2.1 两种模式

```typescript
// 模式 1: FlowBody — 流式正文（默认、推荐）
interface FlowBody {
  mode: 'flow'
  children: BlockNode[]   // Paragraph[] | Table[]
}

// 模式 2: BlockNode[] — 裸块数组（仅用于简单兼容场景）
type PageBody = BlockNode[] | FlowBody
```

| 维度 | FlowBody (`mode: 'flow'`) | BlockNode[] (裸数组) |
|------|---------------------------|---------------------|
| **使用场景** | 标准文档正文，需分页/流式排版 | 旧数据兼容 / 极简场景 / header/footer |
| **推荐程度** | **强烈推荐** (默认) | 仅兼容 |
| **分页支持** | 需要分页计算 | 不需要分页 |
| **元数据** | 可扩展 mode 属性 | 无 |
| **语义明确度** | 明确：这是可分页的正文流 | 模糊：只是一个块数组 |
| **未来扩展** | `mode: 'fixed'` (固定布局) | 无扩展空间 |

#### 2.2.2 使用规则

1. **文档正文 (`page.body`)**: 必须使用 `FlowBody`，因为正文需要分页计算
2. **页眉/页脚 (`page.header` / `page.footer`)**: 使用 `BlockNode[]`，页眉页脚不分页、无流式排版需求
3. **TableCell 子内容**: 使用 `BlockNode[]`，单元格内不需要独立分页

#### 2.2.3 转换 API

```typescript
/**
 * FlowBody → BlockNode[] (展平)
 * 用于兼容需要裸数组的下游处理（如旧版导出器）
 */
function flowBodyToArray(body: PageBody): BlockNode[] {
  if (Array.isArray(body)) return body
  return body.children
}

/**
 * BlockNode[] → FlowBody (包装)
 * 用于数据迁移：旧格式裸数组升级为新格式
 */
function arrayToFlowBody(blocks: BlockNode[]): FlowBody {
  return { mode: 'flow', children: blocks }
}

/**
 * 检测 body 是否为 FlowBody 模式
 */
function isFlowBody(body: PageBody): body is FlowBody {
  return !Array.isArray(body) && (body as FlowBody).mode !== undefined
}
```

#### 2.2.4 边界规则

- **新建文档**：所有 `page.body` 强制使用 `FlowBody` 模式
- **读取旧数据**：解析 JSON 时自动检测 `PageBody` 类型，`BlockNode[]` 包装为 `FlowBody` (静默升级)
- **API 输出**：统一输出 `FlowBody` 格式（序列化时 `JSON.stringify` 保留 `mode: 'flow'`）
- **getBodyBlocks() 防御**：所有访问 `page.body` 的代码必须通过 `getBodyBlocks(page.body)` 提取 `BlockNode[]`，不直接假设类型

```typescript
// 所有代码统一使用的访问器
function getBodyBlocks(body: PageBody): BlockNode[] {
  return Array.isArray(body) ? body : (body as FlowBody).children
}
```

### 2.3 节点工厂与树操作

`ElementFormatter.ts` 提供完整的工厂函数和树操作工具：

```typescript
// 工厂函数
createDocument(title, pages?, pageSetup?)     → DocumentTree
createPage(header?, body?, footer?)           → Page
createFlowBody(blocks?)                       → FlowBody
createParagraph(children?, style?)            → Paragraph
createTextNode(text, style?)                  → TextNode
createSmartTextNode(text, element, style?)    → SmartTextNode
createTable(rows?, colWidths?)                → Table
createTableRow(cells?, height?)               → TableRow
createTableCell(children?, opts?)             → TableCell
createSimpleTable(rows, cols)                 → Table (快捷创建)

// 树遍历与查找
traverse(tree, visitor)                       → 深度优先遍历
findById(tree, id)                            → { node, path }
findByDE(tree, deCode)                        → SmartTextNode[] (按国标编码查找)
findByInternal(tree, internalCode)            → SmartTextNode[] (按内部编码查找)

// 增删操作 (推荐用 ID 链路路径)
insertAt(tree, idPath: string[], node)        → boolean
removeAt(tree, idPath: string[])              → boolean

// 克隆与快照
deepClone(node)                               → 深度克隆
cloneWithNewIds(node)                         → 克隆 + 重新生成 ID
takeSnapshot(tree)                            → JSON 字符串
restoreSnapshot(json)                         → DocumentTree
UndoRedoStack (class)                         → 带 maxDepth 的快照栈
```

---


---

### 2.4 字体与文本度量体系 (v5.0 新增)

**背景**: 当前 `TextMeasurer` 直接使用 Canvas `measureText()` + LRU 缓存。这套方案在以下场景有根本性缺陷：布局抖动（字体未加载完成时测量结果为 fallback 字体尺寸）、跨端排版不一致（不同 OS 的系统字体度量不同）、前后端导出不一致（后端 Java 字体度量 ≠ 浏览器 Canvas 度量）、无字体降级链（生僻字显示方框）。

字体管理层是比 TextMeasurer/LineBreaker/PageBreaker 更底层的 P0 基础设施。缺少这一层，所有上层布局计算都不可靠。

#### 2.4.1 字体加载与管理

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

  /** 从已加载字体中提取度量数据 */
  private async extractMetrics(family: string, weight: number, style: string): Promise<FontMetrics> {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.font = `${style} ${weight} 1000px "${family}"`  // upem=1000 便于计算
    const m = ctx.measureText('M')
    const full = ctx.measureText('中')
    const half = ctx.measureText('a')
    const baseline = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent
    const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent
    return {
      ascent: baseline,
      descent: descent,
      lineGap: 0,  // Canvas API 不直接提供, 用 heuristics 估算
      capHeight: ctx.measureText('H').actualBoundingBoxAscent,
      xHeight: ctx.measureText('x').actualBoundingBoxAscent,
      fullWidthAdvance: full.width,
      halfWidthAdvance: half.width,
    }
  }
}

function fontKey(d: FontDescriptor): string { return `${d.family}:${d.weight}:${d.style}` }
function candidateWeights(target: number): number[] {
  // 按接近程度排列候选字重
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900]
  return weights.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))
}

// 全局单例
const fontManager = new FontManager()
```

#### 2.4.2 增强文本度量

当前 `TextMeasurer` 依赖 Canvas `measureText()`，渲染结果取决于系统字体，无法保证跨端一致性。

**方案**: 引入三级测量精度：

```
L1 — 快速测量 (Canvas measureText, 当前方案)
     适用: 编辑态实时渲染
     缺点: 依赖系统字体，跨端不一致

L2 — 精确测量 (HarfBuzz WASM)
     适用: 导出、打印、布局缓存回填
     优点: 与操作系统无关的精确字体度量
     实现: 编译 HarfBuzz 到 WebAssembly，通过自定义字体数据测量

L3 — 离线预计算 (构建时)
     适用: 已知内容的批量预排版
     优点: 零运行时开销
```

```typescript
// ================================================================
// 增强 TextMeasurer
// ================================================================
class TextMeasurer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cache = new Map<string, TextMetrics>()  // LRU, MAX=2000
  private cacheKeys: string[] = []
  private fontManager: FontManager

  // v5.0 新增: HarfBuzz WASM 实例 (懒加载)
  private harfBuzz: Promise<HarfBuzzInstance> | null = null

  constructor(fontMgr: FontManager) {
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
    this.fontManager = fontMgr
  }

  /** L1 快速测量 (保持向后兼容) */
  measureWidth(text: string, config: FontConfig): number {
    return this.measure(text, config).width
  }

  /**
   * L2 精确测量 (用于导出/打印)
   *
   * 与 L1 的关键区别:
   * - 使用 HarfBuzz 引擎计算，不依赖系统字体渲染器
   * - 支持 kerning/ligature/GPOS 等高级排版特性
   * - 前后端输出完全一致 (Java HarfBuzz 绑定 → 相同结果)
   */
  async measureWidthPrecise(text: string, config: FontConfig): Promise<number> {
    if (!this.harfBuzz) {
      this.harfBuzz = this.initHarfBuzz()
    }
    const hb = await this.harfBuzz
    // 从 fontManager 获取字体二进制数据 → 创建 HarfBuzz blob
    // hb.shape(text, font) → 逐字形累加 advance
    return 0 // placeholder
  }

  /**
   * CJK+英文混排，支持 kerning 的逐字符宽度测量
   */
  measureChars(text: string, config: FontConfig): CharMetrics[] {
    const chars = [...text]
    return chars.map((char, i) => ({
      char,
      width: this.measureWidth(char, config),
      // 检查前后字符的 kerning pair (CJK 通常无 kerning, 仅英文)
      kerning: i > 0 ? this.getKerning(chars[i - 1], char, config) : 0,
    }))
  }

  private getKerning(prev: string, curr: string, config: FontConfig): number {
    const pairWidth = this.measureWidth(prev + curr, config)
    const soloWidth = this.measureWidth(prev, config) + this.measureWidth(curr, config)
    return pairWidth - soloWidth  // 负值 = kerning 紧缩
  }

  getLineHeight(config: FontConfig): number { return config.size * 1.5 }
  getAscent(config: FontConfig): number { return config.size * 0.8 }
  getDescent(config: FontConfig): number { return config.size * 0.2 }
  clearCache(): void { this.cache.clear(); this.cacheKeys = [] }
  destroy(): void { this.clearCache() }

  private async initHarfBuzz(): Promise<HarfBuzzInstance> { /* 懒加载 WASM */ return {} as any }
}

/**
 * ITextShaper — 文本塑形接口 (v5.0 新增)
 *
 * 设计意图: 通过接口抽象隔离 Canvas measureText 和 HarfBuzz WASM 两种实现。
 * TextMeasurer 依赖 ITextShaper，不感知底层引擎。
 * WASM 模块可平滑接入，零调用方改动。
 */
interface ITextShaper {
  /** 对文本进行字形塑形，返回逐字形度量 */
  shape(text: string, font: FontVariant, size: number): Promise<ShapedGlyph[]>
}

interface ShapedGlyph {
  char: string
  /** 字形 advance (水平推进量) */
  xAdvance: number
  /** 字形偏移 (用于标记/连字等) */
  xOffset: number; yOffset: number
  /** 字形 ID (用于精确渲染) */
  glyphId: number
}

/** L1 实现: 基于 Canvas measureText (快速，当前方案) */
class CanvasTextShaper implements ITextShaper {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d')!

  async shape(text: string, font: FontVariant, size: number): Promise<ShapedGlyph[]> {
    const style = `${font.descriptor.style} ${font.descriptor.weight} ${size}px "${font.descriptor.family}"`
    this.ctx.font = style
    return [...text].map(char => ({
      char,
      xAdvance: this.ctx.measureText(char).width,
      xOffset: 0, yOffset: 0, glyphId: 0,
    }))
  }
}

/** L2 实现: 基于 HarfBuzz WASM (精确，前后端一致) */
class HarfBuzzShaper implements ITextShaper {
  private hb: HarfBuzzInstance | null = null

  private async ensureLoaded(): Promise<HarfBuzzInstance> {
    if (this.hb) return this.hb
    // 懒加载 WASM: import('harfbuzzjs') → 初始化 → 返回实例
    this.hb = {} as HarfBuzzInstance  // placeholder
    return this.hb
  }

  async shape(text: string, font: FontVariant, size: number): Promise<ShapedGlyph[]> {
    const hb = await this.ensureLoaded()
    // hb.createFont(font.blob) → hb.shape(text, font) → 逐字形 advance
    return []  // placeholder
  }
}

/**
 * 切换实现: 仅需替换注入的 ITextShaper 实例
 *   const measurer = new TextMeasurer(fontMgr, new CanvasTextShaper())   // L1 快速
 *   const measurer = new TextMeasurer(fontMgr, new HarfBuzzShaper())    // L2 精确
 *
 * TextMeasurer 内部代码完全不变。这就是「接口抽象」的意义:
 * WASM 模块零侵入接入，不导致大规模重构。
 */
}

/** 界面大小写字母/特殊符号/全半角——正匹配 */
```

#### 2.4.3 字体 Fallback 链

处理生僻字与特殊符号：当指定字体缺少某个字符的字形时，自动降级到后备字体。

```typescript
/**
 * 字体降级链配置
 *
 * 查找顺序: 首选字体 → 同族 fallback → 通用 fallback → 最后手段
 */
const DEFAULT_FALLBACK_CHAINS: Record<string, string[]> = {
  // 简体中文
  'SimSun':            ['Microsoft YaHei', 'Noto Sans CJK SC', 'PingFang SC', 'sans-serif'],
  'SimHei':            ['Microsoft YaHei', 'Noto Sans CJK SC', 'PingFang SC', 'sans-serif'],
  'Microsoft YaHei':   ['Noto Sans CJK SC', 'PingFang SC', 'SimHei', 'sans-serif'],
  // 英文
  'Arial':             ['Helvetica', 'sans-serif'],
  'Times New Roman':   ['Georgia', 'serif'],
  // 等宽
  'Courier New':       ['Consolas', 'monospace'],
}

class FontFallback {
  constructor(private fontManager: FontManager) {}

  /**
   * 检测文本中每个字符在当前字体中是否有字形
   *
   * 使用 Canvas measureText + 6px 零宽字符技巧:
   * 测量 "缺字字符" 和 "缺字字符 + U+200B"，
   * 如果宽度相同 → 当前字体无法渲染该字符 → fallback
   */
  detectMissingGlyphs(text: string, family: string): Map<string, string> {
    const missing = new Map<string, string>()  // char → recommended fallback font
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!

    for (const char of new Set([...text])) {
      ctx.font = `6px "${family}"`
      const w1 = ctx.measureText(char).width       // 当前字体
      ctx.font = `6px "${family}", "Noto Sans CJK SC"`  // + 通用 fallback
      const w2 = ctx.measureText(char).width
      if (w1 === 0 && w2 > 0) {
        missing.set(char, 'Noto Sans CJK SC')  // 检测到缺字
      }
    }
    return missing
  }

  /**
   * 为给定文本选择合适的字体组合
   *
   * 规则:
   * 1. 全部字符在首选字体中 → 直接使用首选字体
   * 2. 部分字符缺失 → 对缺失字符标记 fallback 字体 (渲染时按字符粒度切换)
   * 3. 全部缺失 → 完全降级到后备字体
   */
  resolveFallbackFonts(text: string, preferredFamily: string): FontRun[] {
    const missing = this.detectMissingGlyphs(text, preferredFamily)
    if (missing.size === 0) return [{ text, family: preferredFamily }]

    // 按字符粒度拆分文本为 FontRun[]
    const runs: FontRun[] = []
    let currentFamily = preferredFamily
    let currentText = ''
    for (const char of [...text]) {
      const needed = missing.get(char) ? missing.get(char)! : preferredFamily
      if (needed !== currentFamily) {
        if (currentText) runs.push({ text: currentText, family: currentFamily })
        currentText = char; currentFamily = needed
      } else {
        currentText += char
      }
    }
    if (currentText) runs.push({ text: currentText, family: currentFamily })
    return runs
  }
}

interface FontRun { text: string; family: string }
```

#### 2.4.4 换行规则引擎增强

当前 `LineBreaker` 仅基于宽度做断行，缺少 Unicode 标准换行规则。

```typescript
/**
 * Unicode 换行算法 (UAX #14) 核心规则子集
 *
 * 实现关键规则:
 * - LB1-LB8:  强制断行 (LF, CR, NL, 分页符)
 * - LB9-LB10: 空格/制表符处理
 * - LB11-LB12: 直接断行字符
 * - LB13-LB18: CJK 规则 (任意位置断行)
 * - LB19-LB30: 英文规则 (单词边界断行)
 * - LB31:      不可断行字符序列
 */
enum LineBreakClass {
  AL,   // 字母
  CJ,   // CJK 统一表意文字 (任意位置断行)
  CL,   // 闭合标点 (不可在之前断行)
  OP,   // 开标点 (不可在之后断行)
  GL,   // 不可断行字符 (non-breaking)
  SP,   // 空格
  NU,   // 数字
  // ... 共 42 个分类
}

/**
 * 增强换行选项
 */
interface LineBreakOptions {
  maxWidth: number
  /** 换行策略 */
  strategy: 'break-all' | 'break-word' | 'keep-all' | 'uax14'
  /** 避头尾字符 (中文排版规范) */
  lineStartForbidden?: string   // 不可出现于行首的字符 (如 」）】
  lineEndForbidden?: string     // 不可出现于行尾的字符 (如 「（【
  defaultFont: string; defaultSize: number
}

class LineBreaker {
  private measurer: TextMeasurer

  /**
   * 增强断行 — 支持 UAX #14 + 中文避头尾
   */
  breakLines(elements: LineElement[], options: LineBreakOptions): ILine[] {
    if (options.strategy === 'uax14') {
      return this.breakLinesUAX14(elements, options)
    }
    return this.breakLinesLegacy(elements, options)
  }

  private breakLinesUAX14(elements: LineElement[], options: LineBreakOptions): ILine[] {
    // 1. 按 UAX #14 规则确定每个字符的 LineBreakClass
    // 2. 在允许断行的位置标记 break opportunities
    // 3. 在 break opportunities 中, 选取不超过 maxWidth 的最右位置
    // 4. 应用中文避头尾规则 (lineStartForbidden/lineEndForbidden)
    // 5. 回退到上一个合法断点
    return [] // placeholder
  }
}
```

#### 2.4.5 多语言元数据

```typescript
/**
 * 多语言支持 — 用于双语病历场景
 *
 * 当前设计: TextStyle.font 仅存字体名称 (如 'SimSun')
 * 问题: 无法表达"中文用 SimSun, 英文用 Arial, 数字用 Times New Roman"
 *
 * 方案: 按 Unicode 脚本自动选择字体
 */
interface MultiLangFontConfig {
  /** 默认字体 (未匹配到任何脚本时使用) */
  default: string
  /** 按 Unicode 脚本分配的字体映射 */
  scripts: Partial<Record<UnicodeScript, string>>
}

type UnicodeScript = 'Hans' | 'Hant' | 'Latin' | 'Arabic' | 'Cyrillic' | 'Kana' | 'Hangul'

const MEDICAL_FONT_CONFIG: MultiLangFontConfig = {
  default: 'SimSun',
  scripts: {
    Hans:  'SimSun',        // 简体中文
    Latin: 'Arial',          // 英文/拉丁字母
    Hant:  'Microsoft YaHei', // 繁体中文
    Kana:  'MS Gothic',      // 日文假名 (如有需要)
  },
}

/**
 * 按 MultiLangFontConfig 将文本拆分为 FontRun[]
 * 渲染时每个 FontRun 使用对应字体，确保中英文混排各自使用正确字体
 */
function resolveScriptRuns(text: string, config: MultiLangFontConfig): FontRun[] {
  const runs: FontRun[] = []
  let currentScript = ''; let currentText = ''
  for (const char of [...text]) {
    const script = detectScript(char)
    const font = config.scripts[script] || config.default
    if (font !== currentScript) {
      if (currentText) runs.push({ text: currentText, family: currentScript })
      currentText = char; currentScript = font
    } else {
      currentText += char
    }
  }
  if (currentText) runs.push({ text: currentText, family: currentScript })
  return runs
}

/** 检测单个字符的 Unicode 脚本 */
function detectScript(char: string): UnicodeScript {
  const cp = char.codePointAt(0)!
  if (cp >= 0x4E00 && cp <= 0x9FFF) return 'Hans'      // CJK 统一表意文字
  if (cp >= 0x3400 && cp <= 0x4DBF) return 'Hans'      // CJK 扩展 A
  if (cp >= 0x0041 && cp <= 0x007A) return 'Latin'
  if (cp >= 0x3040 && cp <= 0x309F) return 'Kana'      // 平假名
  if (cp >= 0x30A0 && cp <= 0x30FF) return 'Kana'      // 片假名
  if (cp >= 0xAC00 && cp <= 0xD7AF) return 'Hangul'
  return 'Hans'  // 默认归入中文
}
```
### 2.5 EditorRuntimeState — 运行时状态模型 (v3.0 新增)

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
// 光标 — 用 ID 链路路径替代下标路径
// ================================================================
interface CursorState {
  /**
   * 节点定位: ID 链路路径
   * 示例: ['doc_1', 'page_1', 'flow_1', 'para_3', 'text_7']
   * 表示: DocumentTree → pages[0] → body.children[0] → children[3] → children[7]
   *
   * 为什么不用下标路径?
   * - 下标路径在节点插入/删除后失稳，需要全部重算
   * - ID 链路路径通过 findById 始终能定位到正确节点，仅 offset 需微调
   */
  path: string[]

  /**
   * 在目标节点内的偏移量
   * - 对于 TextNode: 字符偏移 (0..text.length)
   * - 对于 Paragraph: inlineNode 索引
   * - 对于 TableCell: blockNode 索引
   */
  offset: number

  /** 是否可见 (光标闪烁) */
  visible: boolean
}

	/**
	 * 插入位置规则 (v5.0 显式声明):
	 *
	 * CursorState { path: string[], offset: number } 确定文本插入位置:
	 *
	 *   1. path 最后一个 ID 指向 Paragraph 节点 (插入目标段落)
	 *   2. offset 指向 paragraph.children 中的插入索引
	 *      - offset=0 → 插入到段落开头
	 *      - offset=N → 插入到第 N 个 InlineNode 之后
	 *      - offset=children.length → 追加到段落末尾
	 *
	 *   3. 特殊位置处理:
	 *      - 光标在 SmartTextNode 内的文本中间 → 先 split SmartTextNode, 在间隙处插入新 TextNode
	 *      - 光标在 TableCell 内 → path 指向 TableCell, offset 指向 cell.children 中的 BlockNode 索引
	 *      - 光标在空段落 → offset=0, 在 children[0] 前插入
	 *
	 *   4. 不可删除节点保护:
	 *      - Delete/Backspace 前先检查 isDeletable(node, mode)
	 *      - 若目标节点 { undeletable: true } → 跳过, 光标移至下一个可删除节点
	 *      - 若选区包含不可删除节点 → 过滤后仅删除可删除部分
	 */
// ================================================================
// 选区 — 起点 + 终点 + 方向
// ================================================================
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
  return sel.anchor.path.join('.') === sel.focus.path.join('.')
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

---

### 2.6 Command 命令体系 (v3.0 新增)

**问题**: 当前仅用整树 JSON 快照实现撤销重做，每次编辑后序列化整个 DocumentTree。性能差（长文档 JSON 可达 MB 级），无法支撑增量操作、剪贴板、多人协作操作重放。

**方案**: 用 Command 模式封装每个编辑操作，提供 forward/invert 双方法，UndoRedoStack 管理命令历史。

#### 2.5.1 ICommand 接口

```typescript
/**
 * 命令接口 — 所有文档编辑操作的标准封装
 *
 * 设计原则:
 * - forward():  执行操作，返回 StatePatch 描述运行时状态变化
 * - invert():   返回逆操作 (不是执行撤销，而是生成反向命令)
 * - 命令实例是不可变的纯数据，可序列化/传输 (协作重放)
 */
interface ICommand {
  /** 命令类型标识 (用于序列化/反序列化) */
  readonly type: string

  /** 命令唯一 ID (用于协作去重) */
  readonly id: string

  /** 时间戳 (用于协作排序) */
  readonly timestamp: number

  /** 发起者 ID (用于协作显示) */
  readonly author: string

  /**
   * 执行命令，返回运行时状态变更
   * @returns StatePatch — cursor/selection 的增量变化，null 表示无状态变化
   */
  forward(document: DocumentTree): StatePatch | null

  /**
   * 生成逆操作命令 (不修改 document)
   * @returns ICommand — 执行 forward 前的逆操作
   */
  invert(): ICommand

  /**
   * 序列化为可传输格式 (用于协作同步)
   */
  serialize(): SerializedCommand
}

/**
 * 运行时状态补丁 — 命令执行后对 EditorRuntimeState 的变更
 */
interface StatePatch {
  /** 更新光标位置 (null = 不变) */
  cursor?: Partial<CursorState>
  /** 更新选区 (null = 不变) */
  selection?: Partial<SelectionState>
}
```

#### 2.5.2 具体命令

```typescript
// ---- 文本操作 ----

class InsertTextCommand implements ICommand {
  constructor(
    readonly id: string,
    readonly timestamp: number,
    readonly author: string,
    private path: string[],       // 插入位置的 ID 链路路径 (Paragraph 节点 ID)
    private offset: number,       // 偏移量 (在 paragraph.children 中的位置)
    private text: string,         // 插入的文本
    private style?: TextStyle     // 文本样式
  ) {}
  readonly type = 'insert-text'

  forward(doc: DocumentTree): StatePatch {
    // 1. 定位目标 Paragraph
    const result = findById(doc, this.path[this.path.length - 1])
    if (!result) return null
    const para = result.node as Paragraph

    // 2. 在 offset 处逐个插入 TextNode
    const insertedCount = [...this.text].length  // Unicode 安全拆分
    for (let i = 0; i < insertedCount; i++) {
      const char = [...this.text][i]
      const node = createTextNode(char, this.style ?? { font: 'SimSun', size: 16 })
      para.children.splice(this.offset + i, 0, node)
    }

    // 3. 返回光标位移: 光标移动到插入文本之后
    return {
      cursor: { path: this.path, offset: this.offset + insertedCount }
    }
  }

  invert(): ICommand {
    return new DeleteRangeCommand(
      generateId(), Date.now(), this.author,
      this.path, this.offset, this.offset + [...this.text].length
    )
  }

  serialize(): SerializedCommand {
    return { type: 'insert-text', id: this.id, timestamp: this.timestamp,
             author: this.author, path: this.path, offset: this.offset,
             text: this.text, style: this.style }
  }
}

class DeleteRangeCommand implements ICommand {
  /** 被删除的节点快照 (用于 invert 恢复) */
  private deletedNodes: InlineNode[] = []

  constructor(
    readonly id: string,
    readonly timestamp: number,
    readonly author: string,
    private path: string[],       // 目标 Paragraph ID 路径
    private startOffset: number,  // 起始偏移
    private endOffset: number     // 结束偏移 (不包含)
  ) {}
  readonly type = 'delete-range'

  forward(doc: DocumentTree): StatePatch {
    const result = findById(doc, this.path[this.path.length - 1])
    if (!result) return null
    const para = result.node as Paragraph

    // 保存被删除节点 (深克隆, 用于 invert)
    this.deletedNodes = para.children.slice(this.startOffset, this.endOffset).map(deepClone)
    para.children.splice(this.startOffset, this.endOffset - this.startOffset)

    return {
      cursor: { path: this.path, offset: this.startOffset }
    }
  }

  invert(): ICommand {
    // 恢复被删除的节点 (使用 InsertBlockCommand 的变体)
    return new InsertNodesCommand(
      generateId(), Date.now(), this.author,
      this.path, this.startOffset, this.deletedNodes
    )
  }

  serialize(): SerializedCommand {
    return { type: 'delete-range', id: this.id, timestamp: this.timestamp,
             author: this.author, path: this.path,
             startOffset: this.startOffset, endOffset: this.endOffset }
  }
}

// ---- 格式化 ----

class FormatTextCommand implements ICommand {
  constructor(
    readonly id: string,
    readonly timestamp: number,
    readonly author: string,
    private paths: string[],      // 被格式化的节点 ID 列表
    private changes: Partial<TextStyle>
  ) {}

  forward(doc: DocumentTree): StatePatch { /* 批量应用样式变更 */ }
  invert(): ICommand { /* 恢复原样式 */ }
}

// ---- 结构操作 ----

class InsertBlockCommand implements ICommand {
  constructor(
    readonly id: string,
    readonly timestamp: number,
    readonly author: string,
    private parentPath: string[], // 插入位置的父节点 ID 路径
    private index: number,        // 插入索引
    private block: BlockNode      // 要插入的块
  ) {}

  forward(doc: DocumentTree): StatePatch { /* 插入块级节点 */ }
  invert(): ICommand { /* 删除已插入的块 */ }
}

class DeleteBlockCommand implements ICommand {
  /* 删除块级节点 + 保存被删除节点用于 invert */
}

class MoveBlockCommand implements ICommand {
  /* 移动块级节点 (拖拽) */
}

// ---- 剪贴板 ----

class PasteCommand implements ICommand {
  constructor(
    readonly id: string,
    readonly timestamp: number,
    readonly author: string,
    private targetPath: string[],
    private targetOffset: number,
    private content: BlockNode[] | InlineNode[]  // 剪贴板内容 (已 cloneWithNewIds)
  ) {}

  forward(doc: DocumentTree): StatePatch { /* 插入粘贴内容 */ }
  invert(): ICommand { /* 删除粘贴的内容 */ }
}
```

#### 2.5.3 UndoRedoStack (改进版)

```typescript
/**
 * 命令驱动的撤销重做栈
 *
 * 与旧版快照式 UndoRedoStack 的区别:
 * - 旧版: push(snapshot_json) → undo 恢复整树 JSON 快照 (O(n) 内存)
 * - 新版: execute(command) → undo 执行 command.invert()  (O(1) 内存 per command)
 *
 * 渐进迁移策略:
 * Phase 1: 保留快照式栈，但限制 maxDepth=50，同时引入 Command 栈并行运行
 * Phase 2: 新编辑操作全部走 Command 栈，快照式仅做兜底
 * Phase 3: 移除快照式栈
 */
class CommandUndoRedoStack {
  private undoStack: ICommand[] = []
  private redoStack: ICommand[] = []
  readonly maxDepth: number

  constructor(maxDepth = 100) { this.maxDepth = maxDepth }

  /** 执行命令并推入历史 */
  execute(command: ICommand, document: DocumentTree): StatePatch | null {
    const patch = command.forward(document)
    this.undoStack.push(command)
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift()
    this.redoStack = [] // 新操作清空 redo
    return patch
  }

  /** 撤销: 执行最近命令的 invert() 生成反向命令 */
  undo(document: DocumentTree): StatePatch | null {
    const command = this.undoStack.pop()
    if (!command) return null
    const inverse = command.invert()
    const patch = inverse.forward(document)
    this.redoStack.push(command)
    return patch
  }

  /** 重做: 重新执行最近撤销的命令 */
  redo(document: DocumentTree): StatePatch | null {
    const command = this.redoStack.pop()
    if (!command) return null
    const patch = command.forward(document)
    this.undoStack.push(command)
    return patch
  }

  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  clear(): void { this.undoStack = []; this.redoStack = [] }
}
```

#### 2.5.4 技术债务治理路线

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 0 | Draw.ts 内联 undoStack/redoStack (JSON 快照) | 当前 |
| Phase 1 | 引入 CommandUndoRedoStack，Implement ICommand 接口 | 待实现 |
| Phase 2 | InsertText/DeleteText/FormatText 走 Command 栈 | 待实现 |
| Phase 3 | InsertBlock/Paste 走 Command 栈 | 待实现 |
| Phase 4 | 移除 Draw.ts 内联栈，完全迁移到 CommandUndoRedoStack | 待实现 |
| Phase 5 | Command.serialize() 用于协作操作传输 | 远期 |

### 2.7 Particle 统一渲染接口 (v3.0 新增)

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

---

### 2.8 全局坐标系统 (v3.0 新增)

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

// 全局单例
const coordinateSystem = new CoordinateSystem(window.devicePixelRatio || 1)
```

---

### 2.9 渲染管道 (v3.0 — 增加增量布局/增量渲染)

#### 2.8.1 当前实现 (全量重算)

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

#### 2.8.2 目标架构 (增量布局 + 增量渲染)

```
编辑操作 (Command.execute)
    │
    ▼
[1. 脏区标记]
    根据 Command 类型标记影响范围:
    - InsertText/DeleteText → 标记当前 Paragraph 为脏 (布局脏)
    - FormatText → 标记受影响节点为脏 (仅渲染脏)
    - InsertBlock/DeleteBlock → 标记当前 FlowBody 为脏 (布局脏)
    │
    ▼
[2. 增量布局] (仅重算脏区)

    关键: LineBreaker 的输入是 LineElement[], 不是 DocumentTree 节点。
    因此 Paragraph → LineElement[] 需要转换桥:

    function paragraphToLineElements(para: Paragraph): LineElement[] {
      return para.children.map(child => ({
        id: child.id,
        type: child.type,
        value: 'text' in child ? child.text : '',
        font: (child as TextNode).font,
        size: (child as TextNode).size,
        bold: (child as TextNode).bold,
        italic: (child as TextNode).italic,
      }))
    }

    执行:
    脏 Paragraph → paragraphToLineElements() → LineBreaker.breakLines()
    → 得到 ILine[] → 更新该 Paragraph 对应的 PageItem[] 坐标
    脏 FlowBody → 对后续内容调用 PageBreaker.breakPages() (增量分页)
    │
    ▼
[3. 增量渲染] (仅重绘脏区)
    计算脏区 RenderRect 的并集
    ctx.save() → ctx.rect(clipRect) → ctx.clip()
    重绘脏区内的 PageItem
    ctx.restore()
    始终重绘: cursor / selection highlight / IME preview
    │
    ▼
[4. requestAnimationFrame 合并]
    同一帧内的多次脏区标记合并为一次渲染
```

#### 2.8.3 脏区追踪器

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
}
```


**问题**: PageItem 是每次 `recomputeLayout()` 的临时产物，全量重算。增量布局的前提是「每个节点的布局结果可独立缓存、可单独失效」，当前完全没有缓存设计。

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

#### 2.8.5 Canvas 分层渲染 (v4.0 新增)

**问题**: 单 Canvas 绘制所有内容。光标闪烁(30-60fps)触发全区域重绘，性能瓶颈。

**方案**: 三 Canvas 层叠，CSS `position: absolute` 堆叠。

```
Layer 3 — 交互层 (z-index:3): 光标闪烁(rAF) + 选区高亮 + IME预览 + 拖拽预览
Layer 2 — 内容层 (z-index:2): 文本/表格/SmartTextNode, 仅 DocumentTree 变更时重绘
Layer 1 — 静态层 (z-index:1): 页面背景/阴影/边距线/页眉页脚/页码/水印, 仅滚动缩放时重绘
```

```typescript
class LayeredRenderer {
  private layers = { static: null as HTMLCanvasElement | null, content: null, interact: null }
  private ctxs   = { static: null as CanvasRenderingContext2D | null, content: null, interact: null }
  private blinkTimer: number | null = null

  renderContent(items: PageItem[]): void { /* 仅重绘内容层 */ }
  renderStatic(state: EditorRuntimeState, watermark?: WatermarkConfig): void {
    // 页面背景 / 阴影 / 边距线 / 页码
    // + 水印渲染 (归属静态层, 仅滚动缩放时重绘)
    if (watermark) this.drawWatermark(watermark)
  }
  startCursorBlink(): void { /* setInterval 530ms, 仅重绘交互层 */ }
  syncSizes(w: number, h: number, dpr: number): void { /* 三层同步尺寸 */ }

  private drawWatermark(wm: WatermarkConfig): void {
    const ctx = this.ctxs.static!
    ctx.save()
    ctx.globalAlpha = wm.opacity
    if (wm.type === 'text' && wm.text) {
      ctx.font = `${wm.fontSize || 48}px "SimSun"`
      ctx.fillStyle = wm.color || '#000000'
      ctx.textAlign = 'center'
      if (wm.mode === 'tile') {
        // 平铺: 按 spacing 间距在页面范围内重复绘制旋转后的文本
        const pageW = this.staticCanvas!.width / (window.devicePixelRatio || 1)
        const pageH = this.staticCanvas!.height / (window.devicePixelRatio || 1)
        for (let y = 0; y < pageH + wm.spacing; y += wm.spacing) {
          for (let x = 0; x < pageW + wm.spacing; x += wm.spacing) {
            ctx.save()
            ctx.translate(x, y)
            ctx.rotate((wm.rotation * Math.PI) / 180)
            ctx.fillText(wm.text!, 0, 0)
            ctx.restore()
          }
        }
      } else {
        // 居中: 单个水印置于页面中央
        ctx.save()
        ctx.translate(pageW / 2, pageH / 2)
        ctx.rotate((wm.rotation * Math.PI) / 180)
        ctx.fillText(wm.text!, 0, 0)
        ctx.restore()
      }
    } else if (wm.type === 'image' && wm.imageUrl) {
      // 图片水印: 加载图片后按 tile/center 模式绘制
      const img = new Image(); img.src = wm.imageUrl
      // ... tile 模式: ctx.drawImage(img, x, y, w, h) 循环
    }
    ctx.restore()
  }
  destroy(): void { if (this.blinkTimer) clearInterval(this.blinkTimer) }
}
```

---

### 2.10 命中检测体系 (v4.0 新增)

**问题**: 「坐标 → 节点」反向查找无标准方案，交互逻辑散落在各 Handler 中。

**方案**: 统一 `hitTest()` + 布局包围盒 + 空间索引。

```typescript
interface HitTestable {
  hitTest(docX: number, docY: number): string | null  // 返回命中节点 ID 或 null
}
// IParticle 继承 HitTestable
interface IParticle extends HitTestable { /* ... */ }

class HitTestIndex {
  private items: { nodeId: string; rect: RenderRect; particle: IParticle }[] = []

  rebuild(pageItems: PageItem[], registry: ParticleRegistry): void {
    this.items = pageItems.map(item => ({ nodeId: item.nodeId, rect: item, particle: registry.get(item.nodeType)! }))
    this.items.sort((a, b) => a.rect.y - b.rect.y)
  }

  hitTest(docX: number, docY: number): string | null {
    const candidates = this.items.filter(p =>
      docX >= p.rect.x && docX <= p.rect.x + p.rect.width &&
      docY >= p.rect.y && docY <= p.rect.y + p.rect.height)
    for (const c of candidates.reverse()) {  // z-order 从上到下
      const hit = c.particle.hitTest(docX, docY); if (hit) return hit
    }
    return null
  }
}
```

---

#### 2.8.4 布局缓存体系 (v4.0 新增)

**问题**: PageItem 是每次 `recomputeLayout()` 的临时产物，全量重算。增量布局的前提是「每个节点的布局结果可独立缓存、可单独失效」，当前完全没有缓存设计。

**方案**: 建立三级布局缓存，缓存键 = 节点 ID，通过 NodePool.version 判断失效。
---

### 2.11 Draw.ts 拆分边界方案 (v3.0 新增)

**问题**: 之前只提出"拆分为 EventHandler/IMEHandler/ClipboardHandler"，但模块职责、通信方式、依赖方向没有定义。

**方案**: 通过 EventBus 解耦，各 Handler 独立模块，Draw 仅保留渲染编排。

```
┌──────────────────────────────────────────────────────────────────┐
│                        Draw (渲染编排器)                          │
│  render(document, state, dirtyTracker) → Canvas                  │
│  recomputeLayout(document, dirtyTracker) → PageItem[]            │
│                                                                   │
│  依赖: DocumentTree, EditorRuntimeState, ParticleRegistry        │
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

#### 2.9.1 EventBus 接口

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

interface EventBus {
  on(event: EngineEvent, handler: (...args: any[]) => void): void
  off(event: EngineEvent, handler: (...args: any[]) => void): void
  emit(event: EngineEvent, ...args: any[]): void
}
```

#### 2.9.2 各 Handler 职责与通信

| 模块 | 职责 | 监听 | 发出 |
|------|------|------|------|
| **MouseHandler** | mousedown/mousemove/mouseup → 光标定位/选区拖拽/点击 SmartTextNode | DOM mouse events | `cursor:moved`, `selection:changed`, `render:request` |
| **KeyboardHandler** | keydown → 可见字符/导航/删除/快捷键 → 构建 Command | DOM keydown | 委托 `CommandManager.execute()` |
| **IMEHandler** | 管理隐藏 textarea → compositionstart/update/end → 构造 InsertTextCommand | textarea composition events | `render:request` (预览), `CommandManager.execute()` (确认) |
| **ClipboardHandler** | copy/cut/paste → 文本提取/Command 构建 | textarea paste, window copy/cut | `CommandManager.execute()` (paste 时) |
| **CommandManager** | 接收 Command → forward(doc) → StatePatch → DirtyTracker → emit 事件 | 所有 Handler 调用 | `document:changed`, `state:changed`, `layout:changed`, `render:request` |

#### 2.9.3 依赖方向 (单向，避免循环)

```
Handler → CommandManager → DocumentTree + EditorRuntimeState
Handler → EventBus (emit)
Draw ← EventBus (listen)
Draw → DocumentTree + EditorRuntimeState (readonly)
Draw → ParticleRegistry (readonly)
Draw → CoordinateSystem (readonly)

禁止: Draw → Handler (反向依赖)
禁止: HandlerA → HandlerB (Handler 间不直接通信，通过 CommandManager 中转)
```

---

### 2.12 权限优先级规则 (v3.0 新增)

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
 * 判断给定节点是否可编辑 (v5.0 增强: 加入 L4 undeletable 不影响可编辑性)
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
  // L1: 全局模式覆盖
  if (mode === 'readonly') return false
  if (mode === 'design') return true  // 设计模式忽略所有限制

  // L2: 节点锁定
  if (node.metadata?.locked === true) return false

  // L3: SmartTextNode 字段只读
  if (isSmartTextNode(node) && node.element.readonly === true && mode !== 'design') {
    return false
  }

  // FORM 模式: 仅 SmartTextNode 可编辑
  if (mode === 'form') {
    return isSmartTextNode(node)
  }

  // L4: 修订权限 (预留)
  // ...

  return mode === 'edit'
}
```

---

### 2.13 当前模块结构

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

### 2.14 编辑器模式

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

### 2.15 前端技术栈

| 层 | 技术 | 版本 | 说明 |
|----|------|------|------|
| 框架 | React | 18.3+ | 函数组件 + Hooks |
| 语言 | TypeScript | 5.5+ | strict mode |
| 构建 | Vite | 5.4+ | HMR + ESBuild |
| CSS | Tailwind CSS | 3.4+ | 原子化样式 |
| UI 组件 | Radix UI | latest | dialog/dropdown-menu/tooltip/tabs |
| 图标 | Lucide React | 0.400+ | 禁止 emoji |
| 状态管理 | Zustand | 5.x | 轻量、不可变 |
| HTTP | Axios | 1.7+ | 拦截器 + JWT 注入 |
| 测试 | Vitest | 2.x | 单元测试 + jsdom |

---

## 3. 后端架构设计

### 3.1 分层架构

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

### 3.2 数据库设计 (v3.0 增强 — 乐观锁与审计日志)

```sql
-- ================================================================
-- 文档表 (v3.0 增强: version 字段作为乐观锁)
-- ================================================================
CREATE TABLE t_document (
    id          VARCHAR(64)  PRIMARY KEY,
    title       VARCHAR(255) NOT NULL,
    template_id VARCHAR(64),
    content     JSON         NOT NULL COMMENT 'DocumentTree JSON (ModelD 树形结构)',
    model_version VARCHAR(10) DEFAULT '3.0' COMMENT '文档模型版本号 (用于兼容)',
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

-- 乐观锁更新语句示例:
-- UPDATE t_document SET content = ?, version = version + 1, updated_by = ?
-- WHERE id = ? AND version = ?;
-- 如果 affected_rows = 0 → 版本冲突 → 返回 409 Conflict

-- ================================================================
-- 文档权限表 (v3.0 新增 — 文档粒度权限)
-- ================================================================
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

-- 模板表 (同上，增加 model_version)
CREATE TABLE t_template (
    id           VARCHAR(64)  PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    category     VARCHAR(100),
    description  TEXT,
    content      JSON         NOT NULL COMMENT '模板 DocumentTree JSON',
    model_version VARCHAR(10) DEFAULT '3.0' COMMENT '文档模型版本号',
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

-- ================================================================
-- 操作审计日志表 (v3.0 增强)
-- ================================================================
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

-- 审计日志覆盖范围:
-- ✅ 文档 CRUD 操作
-- ✅ 权限变更 (grant/revoke)
-- ✅ 导出/打印操作
-- ✅ 模板应用/创建
-- ✅ 协作加入/离开
-- ❌ (暂不覆盖) 每次键盘输入的字符级变更 (性能开销过大)
```

### 3.3 REST API 设计 (v3.0 增强)

```
# 文档管理
GET    /api/v1/documents              # 文档列表（分页、筛选）
POST   /api/v1/documents              # 创建文档 (body: DocumentTree, Header: X-Model-Version: 3.0)
GET    /api/v1/documents/{id}         # 获取文档详情 (返回 DocumentTree JSON + modelVersion)
PUT    /api/v1/documents/{id}         # 更新文档 (body: DocumentTree, Header: X-Expected-Version: N)
DELETE /api/v1/documents/{id}         # 删除文档

# 文档权限
GET    /api/v1/documents/{id}/permissions        # 获取文档权限列表
POST   /api/v1/documents/{id}/permissions        # 授予权限
DELETE /api/v1/documents/{id}/permissions/{uid}  # 撤销权限

# 审计日志
GET    /api/v1/documents/{id}/audit-logs          # 操作日志 (分页)

# 协作 (WebSocket)
WS     /ws/documents/{id}                         # 文档协作通道
```

#### PUT 更新文档的乐观锁流程:

```
Client                                Server
  │                                     │
  │  PUT /api/v1/documents/{id}         │
  │  Header: X-Expected-Version: 5      │
  │  Body: DocumentTree JSON            │
  │────────────────────────────────────→│
  │                                     │  SELECT version FROM t_document WHERE id=?
  │                                     │  if (db.version !== 5) → 409 Conflict
  │                                     │  UPDATE ... SET version=6 WHERE id=? AND version=5
  │                                     │  INSERT INTO t_audit_log
  │  200 OK                             │
  │  Body: { version: 6 }               │
  │←────────────────────────────────────│
  │                                     │
  │  (冲突情况)                          │
  │  409 Conflict                        │
  │  Body: { error: 'version_conflict',  │
  │          currentVersion: 7 }         │
  │←────────────────────────────────────│
```

### 3.4 后端技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| JDK | Java | 17 LTS |
| 框架 | SpringBoot | 3.3+ |
| ORM | Mybatis-Plus | 3.5+ |
| 数据库 | MySQL | 8.0+ |
| 缓存 | Redis | 7.x |
| 实时通信 | Spring WebSocket + Stomp | - |
| 安全 | Spring Security + JWT | - |
| 文档转换 | iText 8 (PDF) + Apache POI | latest |
| 模板引擎 | Thymeleaf (HTML 导出) | - |
| 对象存储 | MinIO | latest |
| API 文档 | SpringDoc OpenAPI | 2.5+ |
| 构建 | Maven | 3.9+ |

### 3.5 模型校验与版本兼容 (v3.0 新增)

#### 3.5.1 前端 TypeScript 运行时校验

```typescript
/**
 * DocumentTree 运行时类型校验器
 *
 * 问题: DocumentTree JSON 直接入库，无校验，非法结构可存入数据库
 * 方案: 提供 validateDocumentTree() 校验函数，在保存前和加载后执行
 */

interface ValidationError {
  path: string        // 出错节点的 ID 链路路径, 如 "pages[0].body.children[2].children[0]"
  message: string
  code: 'missing_field' | 'invalid_type' | 'invalid_value' | 'orphan_reference'
}

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  modelVersion: string
}

function validateDocumentTree(doc: unknown): ValidationResult {
  const errors: ValidationError[] = []

  // 1. 顶层结构检查
  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'DocumentTree 必须是对象', code: 'invalid_type' }], modelVersion: '3.0' }
  }

  // 2. 必需字段检查
  const d = doc as Record<string, unknown>
  if (!d.id || typeof d.id !== 'string') errors.push({ path: 'id', message: '缺少有效的 id', code: 'missing_field' })
  if (!d.pages || !Array.isArray(d.pages)) errors.push({ path: 'pages', message: 'pages 必须是数组', code: 'invalid_type' })
  if (d.pages && Array.isArray(d.pages) && d.pages.length === 0) {
    errors.push({ path: 'pages', message: '文档至少包含一页', code: 'invalid_value' })
  }

  // 3. 递归校验每个节点的 id 唯一性
  const idSet = new Set<string>()
  function checkIds(node: unknown, path: string) {
    if (node && typeof node === 'object' && 'id' in node) {
      const n = node as Record<string, unknown>
      if (typeof n.id !== 'string') {
        errors.push({ path, message: '节点 id 必须为 string', code: 'invalid_type' })
      } else if (idSet.has(n.id)) {
        errors.push({ path, message: `重复的节点 ID: ${n.id}`, code: 'invalid_value' })
      } else {
        idSet.add(n.id)
      }
    }
  }
  traverse(doc as DocumentTree, (node, _path) => { checkIds(node, '') })

  // 4. SmartTextNode 校验
  function checkSmartTextNode(node: unknown, path: string) {
    if (node && typeof node === 'object' && (node as any).type === 'smarttext') {
      const st = node as Record<string, unknown>
      const elem = st.element as Record<string, unknown> | undefined
      if (!elem) errors.push({ path, message: 'SmartTextNode 缺少 element', code: 'missing_field' })
      else {
        if (!elem.code || typeof (elem.code as any)?.internal !== 'string')
          errors.push({ path, message: 'SmartTextNode.element.code.internal 无效', code: 'missing_field' })
        if (!elem.name || typeof elem.name !== 'string')
          errors.push({ path, message: 'SmartTextNode.element.name 无效', code: 'missing_field' })
      }
    }
  }
  traverse(doc as DocumentTree, (node, path) => {
    if (node && typeof node === 'object' && (node as any).type === 'smarttext') {
      checkSmartTextNode(node, JSON.stringify(path))
    }
  })

  return {
    valid: errors.length === 0,
    errors,
    modelVersion: '3.0',
  }
}
```

#### 3.5.2 后端 JSON Schema 校验

```yaml
# MySQL 8.0 支持 JSON_SCHEMA_VALID() 函数
# 在写入前用 CHECK 约束或触发器校验 DocumentTree 结构

# 示例: 在 Service 层校验
# boolean valid = jdbcTemplate.queryForObject(
#   "SELECT JSON_SCHEMA_VALID(?, content) FROM t_document WHERE id = ?",
#   Boolean.class, schemaJson, docId
# );
```

#### 3.5.3 modelVersion 版本兼容策略

```typescript
/**
 * 模型版本兼容策略
 *
 * 规则:
 * 1. 所有 DocumentTree 携带 modelVersion 字段 (DocumentTree.metadata.modelVersion)
 * 2. 前端: 读取后检测 modelVersion，必要时静默升级
 * 3. 后端: API 响应 Header 返回 X-Model-Version
 * 4. 旧版本数据不直接修改，保留原 modelVersion 直到被显式保存
 *
 * 升级路径:
 *   v2.0 (ModelD) → v3.0 (ModelD + metadata + FlowBody 标准化)
 *     升级器: addMetadataToBaseNodes + wrapArrayBodiesInFlowBody
 */
const MODEL_VERSION = '3.0'

interface ModelUpgrader {
  /** 源版本 */
  from: string
  /** 目标版本 */
  to: string
  /** 升级函数 */
  upgrade(doc: DocumentTree): DocumentTree
}

const upgraders: ModelUpgrader[] = [
  {
    from: '2.0', to: '3.0',
    upgrade(doc: DocumentTree): DocumentTree {
      // 1. 为所有 BaseNode 添加 metadata: {}
      traverse(doc, (node) => {
        if (node && typeof node === 'object' && 'id' in node && !('metadata' in node)) {
          (node as any).metadata = {}
        }
      })
      // 2. 将 BlockNode[] body 包装为 FlowBody
      for (const page of doc.pages) {
        if (Array.isArray(page.body)) {
          page.body = { mode: 'flow', children: page.body }
        }
      }
      // 3. 设置新的 modelVersion
      if (!doc.metadata) doc.metadata = {}
      doc.metadata.modelVersion = '3.0'
      return doc
    },
  },
]

function ensureLatestModel(doc: DocumentTree): DocumentTree {
  const currentVersion = (doc.metadata?.modelVersion as string) || '2.0'
  let upgraded = doc
  for (const upgrader of upgraders) {
    if (upgrader.from === currentVersion || currentVersion < upgrader.to) {
      upgraded = upgrader.upgrade(upgraded)
    }
  }
  return upgraded
}
```

---

## 4. 数据流设计

### 4.1 编辑数据流 (v3.0 扩展 — 覆盖所有编辑入口)

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

### 4.2 保存数据流 (v3.0 — 完整自动保存策略)

```
┌──────────────────────────────────────────────────────────────────┐
│                       Auto-Save Pipeline                          │
│                                                                    │
│  触发条件:                                                         │
│  ├─ 用户 Ctrl+S 手动保存                                          │
│  ├─ 文档内容变更后 5 秒无操作 (防抖)                               │
│  ├─ 编辑器失焦 (blur 事件)                                        │
│  └─ 页面卸载 (beforeunload 事件)                                  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────┐         │
│  │ 1. 防抖层 (3000ms)                                    │         │
│  │    - 每次 CommandManager.execute() 后重置计时器       │         │
│  │    - 计时器到期 → 触发保存                            │         │
│  │    - 连续快速编辑时不会频繁调用 API                    │         │
│  ├──────────────────────────────────────────────────────┤         │
│  │ 2. 本地缓存层 (IndexedDB)                             │         │
│  │    - 每次保存前先写入 IndexedDB (同步、快速)           │         │
│  │    - 数据结构: { id, documentJSON, timestamp, dirty } │         │
│  │    - 网络故障时保证数据不丢失                          │         │
│  ├──────────────────────────────────────────────────────┤         │
│  │ 3. 本地备份层 (localStorage, 独立 key)                │         │
│  │    - 每隔 30s 写入 localStorage 作为二级备份          │         │
│  │    - 保留最近 3 个版本 (环形覆盖)                     │         │
│  │    - 用于极端情况 (IndexedDB 被清理) 的数据恢复        │         │
│  ├──────────────────────────────────────────────────────┤         │
│  │ 4. 远程保存层 (API)                                   │         │
│  │    PUT /api/v1/documents/{id}                         │         │
│  │    Header: X-Expected-Version: N                      │         │
│  │    Body: JSON.stringify(DocumentTree)                 │         │
│  │    - 成功 → 清除 IndexedDB dirty 标记                  │         │
│  │    - 409 Conflict → 提示用户刷新 (版本冲突)           │         │
│  │    - 网络错误 → 保留 IndexedDB 脏数据，等待重试       │         │
│  └──────────────────────────────────────────────────────┘         │
│                                                                    │
│  ┌──────────────────────────────────────────────────────┐         │
│  │ 5. 故障恢复策略                                       │         │
│  │                                                       │         │
│  │ 页面加载时:                                            │         │
│  │   Editor.mount() → 检查 IndexedDB → 有未保存数据?     │         │
│  │   → 提示用户: "检测到未保存的更改，是否恢复?"          │         │
│  │   → 用户确认 → 加载 IndexedDB 数据                    │         │
│  │   → 用户拒绝 → 清除 IndexedDB                         │         │
│  │                                                       │         │
│  │ 恢复优先级: IndexedDB (最新) → localStorage (备选)    │         │
│  └──────────────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────┘
```

```typescript
// 自动保存管理器
class AutoSaveManager {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly DEBOUNCE_MS = 3000
  private readonly BACKUP_INTERVAL_MS = 30000
  private lastBackupTime = 0
  private db: IDBDatabase | null = null
  private currentVersion = 1        // 当前文档乐观锁版本号

  /** 初始化 IndexedDB (Editor 构造时调用) */
  async init(documentId: string): Promise<void> {
    this.db = await this.openIndexedDB()
    // 从服务器加载时更新 currentVersion
    this.currentVersion = await this.fetchCurrentVersion(documentId)
  }

  /** 更新版本号 (PUT 成功后由调用方更新) */
  updateVersion(newVersion: number): void { this.currentVersion = newVersion }

  /** 内容变更后调用 (由 CommandManager.execute 触发) */
  onContentChanged(document: DocumentTree): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.save(document), this.DEBOUNCE_MS)
  }

  /** 立即保存 (Ctrl+S / blur / beforeunload) */
  async saveNow(document: DocumentTree): Promise<void> {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
    await this.save(document)
  }

  private async save(document: DocumentTree): Promise<void> {
    // Step 1: 写入 IndexedDB (同步，不依赖网络)
    const tx = this.db!.transaction(['documents'], 'readwrite')
    const store = tx.objectStore('documents')
    store.put({ id: document.id, documentJSON: JSON.stringify(document),
                timestamp: Date.now(), dirty: true })
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve() })

    // Step 2: localStorage 备份 (每 30s 一次, 保留最近 3 版)
    const now = Date.now()
    if (now - this.lastBackupTime > this.BACKUP_INTERVAL_MS) {
      this.backupToLocalStorage(document)
      this.lastBackupTime = now
    }

    // Step 3: 远程 API 保存
    try {
      const response = await fetch(`/api/v1/documents/${document.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Expected-Version': String(this.currentVersion),
        },
        body: JSON.stringify(document),
      })
      if (response.status === 409) {
        this.onVersionConflict()
      } else if (response.ok) {
        // 成功 → 更新版本号, 清除 IndexedDB dirty 标记
        const data = await response.json()
        this.currentVersion = data.version
        const tx2 = this.db!.transaction(['documents'], 'readwrite')
        tx2.objectStore('documents').put({ id: document.id, dirty: false })
      }
    } catch (err) {
      console.warn('[AutoSave] Network error, data preserved in IndexedDB')
    }
  }

  private backupToLocalStorage(document: DocumentTree): void {
    const key = `doc_backup_${document.id}`
    // 环形覆盖: 保留最近 3 个版本
    const existing = JSON.parse(localStorage.getItem(key) || '[]')
    existing.push({ json: JSON.stringify(document), timestamp: Date.now() })
    if (existing.length > 3) existing.shift()
    localStorage.setItem(key, JSON.stringify(existing))
  }

  private async openIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('EMRDocumentEngine', 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('documents', { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  private async fetchCurrentVersion(documentId: string): Promise<number> {
    const res = await fetch(`/api/v1/documents/${documentId}`)
    const data = await res.json()
    return data.version ?? 1
  }

  private onVersionConflict(): void {
    // 通知 UI 层展示冲突提示
    window.dispatchEvent(new CustomEvent('save:versionConflict'))
  }

  /** 页面加载时检查未保存数据 */
  async checkForUnsavedData(documentId: string): Promise<DocumentTree | null> {
    if (!this.db) return null
    const tx = this.db.transaction(['documents'], 'readonly')
    const store = tx.objectStore('documents')
    const req = store.get(documentId)
    return new Promise(resolve => {
      req.onsuccess = () => {
        const cached = req.result
        if (cached && cached.dirty) {
          resolve(JSON.parse(cached.documentJSON) as DocumentTree)
        } else {
          resolve(null)
        }
      }
      req.onerror = () => resolve(null)
    })
  }
}
```

### 4.3 协作数据流 (v3.0 新增 — 远期特性，预留扩展接口)

> **[远期特性] 当前阶段暂不实现完整协作。以下为预留设计，确保后续扩展时不需要大规模重构。**

```
┌──────────────────────────────────────────────────────────────────┐
│                    协作同步协议 (预留设计)                         │
│                                                                    │
│  同步模型: CRDT (Conflict-free Replicated Data Type)              │
│  底层算法: Yjs / Yrs (Rust WASM)                                  │
│  传输通道: WebSocket (Stomp)                                       │
│  报文格式: JSON                                                    │
│                                                                    │
│  ┌──────────────────────────────────────────────────────┐         │
│  │ WebSocket 报文格式                                    │         │
│  │                                                       │         │
│  │ {                                                     │         │
│  │   type: 'operation' | 'awareness' | 'sync_request',  │         │
│  │   documentId: 'doc_xxx',                              │         │
│  │   userId: 'user_xxx',                                 │         │
│  │   timestamp: 1722153600000,                           │         │
│  │   payload: {                                          │         │
│  │     // operation: Command.serialize()                  │         │
│  │     // awareness: { cursor, selection, userName }     │         │
│  │     // sync_request: { lastKnownVersion }             │         │
│  │   }                                                   │         │
│  │ }                                                     │         │
│  └──────────────────────────────────────────────────────┘         │
│                                                                    │
│  冲突处理:                                                         │
│  - CRDT 自动合并 (无需手动冲突解决)                                │
│  - 并发编辑同一段文本: Yjs 自动分配位置                            │
│  - 并发删除同一节点: 第一次删除生效，后续视为 no-op                │
│  - 属性并发修改: Last-Writer-Wins (LWW)                            │
│                                                                    │
│  离线重连:                                                         │
│  - 断线时: 本地编辑继续积累 (Command 栈)                           │
│  - 重连时: 发送 sync_request(lastKnownVersion)                    │
│  - 服务端: 返回增量更新 (diff from lastKnownVersion)              │
│  - 客户端: 应用增量 + 重放本地未同步的 Command                     │
│                                                                    │
│  感知信息 (Awareness):                                            │
│  - 每个用户的: 光标位置 (CursorState) + 用户名 + 颜色             │
│  - 通过 WebSocket 定期广播 (500ms throttle)                       │
│  - 其他用户: 渲染远端光标 + 用户名标签                             │
│                                                                    │
│  扩展接口 (当前预留):                                             │
│  Command.serialize(): SerializedCommand   → 支持操作序列化传输    │
│  Command.deserialize(data): ICommand      → 支持接收端重建操作    │
│  UndoRedoStack.getUnsyncedCommands(): ICommand[] → 离线操作队列   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. 部署架构

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
│ :9000  │    │  :8080 (×N 实例)     │
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

**容器化**: 上述所有服务通过 `docker-compose.yml` 编排，详见项目根目录。

---

## 6. 从当前代码到目标架构的迁移路径 (v3.0 新增)

当前代码 (`Draw.ts` 709行单体) 到 v3.0 目标架构的渐进迁移策略：

### Step 1: 引入 EditorRuntimeState (不改 Draw.ts 内部)

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
  4. 验证渲染结果一致后, 删除 Draw 私有字段, 仅保留 EditorRuntimeState
```

### Step 2: 引入 EventBus (不改 Handler 逻辑)

```
做法:
  1. 新建 EventBus 单例 (on/off/emit)
  2. Draw.ts 的 render() 注册为 'render:request' 监听者
  3. 各事件处理函数末尾加 EventBus.emit('render:request')
  4. 验证: MouseDown 后仍然正确渲染光标
```

### Step 3: 提取 Handler (逐个迁移)

```
迁移顺序 (按依赖从少到多):
  1. IMEHandler — 独立 textarea, 依赖最少, 先提取
     - 新建 interaction/IMEHandler.ts
     - 复制 Draw.ts 中 IME 相关代码 (imeTextarea 创建 + composition 事件)
     - IMEHandler 通过 EventBus 通知 Draw 重绘
     - 删除 Draw.ts 中 IME 代码

  2. ClipboardHandler — 依赖 paste 事件
     - 同上模式

  3. MouseHandler — 依赖坐标转换
     - 先迁移 CoordinateSystem (从 Draw.clientToDoc 提取)
     - 再迁移 mouse 事件处理

  4. KeyboardHandler — 依赖 CommandManager
     - 需要先引入 Command 体系 (Step 4)
```

### Step 4: 引入 Command 体系 (新旧栈并行)

```
做法:
  1. 实现 ICommand 接口 + 前 3 个命令类 (InsertText/DeleteText/FormatText)
  2. 实现 CommandUndoRedoStack
  3. KeyboardHandler 走新栈: keydown → Command → CommandManager.execute()
  4. 旧栈保留: beforeEdit() + undoStack[] 仍然工作
  5. 验证: Ctrl+Z 在新栈撤销, 旧栈作为兜底
  6. 逐步迁移: 新编辑走新栈, 旧栈仅读不写
  7. 完全切换后删除旧栈代码
```

### Step 5: 增量布局 + 增量渲染

```
做法:
  1. Command.forward() 执行后调用 DirtyTracker 标记脏区
  2. Draw.recomputeLayout() 接收 DirtyTracker, 仅重算脏 Paragraph
  3. 为脏 Paragraph 构建 LineElement[] → LineBreaker.breakLines() → 更新 PageItem[]
  4. Draw.render() 计算 clipRect → ctx.clip() → 仅重绘脏区
  5. cursor/selection/IME preview 始终全量绘制 (开销小)
```

### 迁移检查清单

| 步骤 | 内容 | 风险 | 验证方法 |
|------|------|------|----------|
| Step 1 | EditorRuntimeState 双写 | 低 | 渲染结果与迁移前一致 |
| Step 2 | EventBus 引入 | 低 | 事件正确派发 |
| Step 3a | IMEHandler 提取 | 低 | CJK 输入正常 |
| Step 3b | ClipboardHandler 提取 | 低 | 复制粘贴正常 |
| Step 3c | CoordinateSystem 提取 | 中 | 坐标换算一致 |
| Step 3d | MouseHandler 提取 | 中 | 光标定位准确 |
| Step 4 | Command 体系 | 高 | Ctrl+Z 行为一致 |
| Step 5 | 增量布局+渲染 | 高 | 编辑后渲染结果一致 + 帧率提升 |

---

## 7. 安全设计 (v3.0 增强)

### 6.1 认证流程
1. 用户登录 → 后端验证 → 返回 JWT (Access Token + Refresh Token)
2. 前端存储 Access Token 于内存，Refresh Token 于 httpOnly Cookie
3. 每次请求携带 Authorization: Bearer {token}
4. Token 过期 → 自动用 Refresh Token 刷新

### 6.2 权限模型

**用户级权限** (由 JWT role + t_document_permission 表共同决定):

```
权限等级:
  owner    — 文档所有者    (编辑/删除/权限管理/批注/打印/导出)
  editor   — 编辑者        (编辑/批注/打印/导出)
  commenter— 批注者        (批注/查看/打印/导出)
  viewer   — 只读者        (查看/打印/导出)
```

**节点级权限** (见 2.10 权限优先级规则):

```
叠加规则: 用户级权限 (粗粒度) ∩ 节点级权限 (细粒度)
  例: editor 角色 + SmartTextNode.readonly=true → 该字段不可编辑
  例: viewer 角色 + SmartTextNode.readonly=false → 全局只读，不可编辑
```

### 6.3 数据安全
- 文档内容加密存储（AES-256）
- API 请求频率限制（Rate Limiting）
- SQL 注入防护（Mybatis 参数化查询）
- XSS 防护（输入过滤 + 输出编码）
- WebSocket 认证 (JWT token 作为连接参数)
- 乐观锁版本冲突检测 (防止并发覆盖)
- 全链路审计日志 (API 层拦截器自动记录)

---

## 8. 非功能需求 (v3.0 新增)

### 7.1 性能指标

| 指标 | MVP 目标 | 最终目标 | 测量方法 |
|------|----------|----------|----------|
| 首次内容绘制 (FCP) | < 1.5s | < 1s | Lighthouse |
| 10 页文档加载 | < 1s | < 500ms | Performance API |
| 100 页文档分页计算 | < 3s | < 1s | PageBreaker bench |
| 单次编辑响应延迟 | < 50ms | < 16ms (60fps) | requestAnimationFrame |
| 连续打字帧率 | > 30fps | > 55fps | rAF 计数器 |
| 自动保存响应 | < 200ms | < 100ms | API 计时 |
| IndexedDB 写入 | < 50ms | < 20ms | Performance API |
| 内存占用 (10 页文档) | < 50MB | < 30MB | Chrome DevTools |

### 7.2 浏览器兼容性

| 浏览器 | 最低版本 | 备注 |
|--------|----------|------|
| Chrome | 90+ | 主要开发和测试环境 |
| Edge | 90+ | Chromium 内核，兼容 Chrome |
| Firefox | 90+ | 需额外测试 IME 兼容性 |
| Safari | 15+ | macOS 需额外测 Canvas 和 IME |
| 移动端浏览器 | 不保证 | 当前阶段不优先支持移动端 |

### 7.3 异常降级策略

| 异常场景 | 降级方案 |
|----------|----------|
| Canvas 2D context 不可用 | 显示错误提示 "您的浏览器不支持 Canvas，请升级浏览器" |
| WebSocket 连接失败 | 降级为纯本地编辑，保存走 HTTP API，协作功能置灰 |
| IndexedDB 不可用 | 降级为 localStorage 备份，或纯远程保存 |
| API 网络超时 (3 次重试) | 保存到 IndexedDB，显示 "网络异常，数据已本地保存" |
| 文档 JSON 解析失败 | 显示 "文档数据损坏" + 尝试从 localStorage 恢复 |
| 单次渲染超过 100ms | 跳过非可见区域的渲染 (虚拟滚动) |
| 内存超过 200MB | 清空 TextMeasurer 缓存 + 释放非可见页的 PageItem |

### 7.4 前端监控

```typescript
// 关键指标埋点
interface PerformanceMetrics {
  // 渲染性能
  renderFrameTime: number         // 每帧渲染耗时 (ms)
  layoutRecomputeTime: number     // 布局重算耗时 (ms)
  textMeasureCacheHitRate: number // 文本测量缓存命中率

  // 编辑性能
  commandExecuteTime: number      // 命令执行耗时 (ms)
  keystrokeLatency: number        // 按键到渲染延迟 (ms)

  // 保存性能
  saveToIDBDuration: number       // IndexedDB 写入耗时
  saveToAPIDuration: number       // API 保存耗时

  // 异常
  renderErrorCount: number        // 渲染异常计数
  apiErrorCount: number           // API 异常计数
  versionConflictCount: number    // 乐观锁冲突计数
}

// 采样率: 生产环境 1%，开发环境 100%
// 上报: navigator.sendBeacon() 在页面卸载时批量发送
```

---

## 9. 打印 / 导出链路 (v3.0 新增)

### 9.1 实现方案

```
导出实现: 前端 Canvas 渲染 → 后端格式转换

  前端:
    Canvas.toDataURL('image/png')  → 页面级 PNG 图像
    DocumentTree → JSON 文本导出

  后端:
    PNG 图像 + JSON 文本 → 组装为 PDF (通过 iText / Apache PDFBox)
    DocumentTree JSON → HTML 模板 (通过 FreeMarker / Thymeleaf)
    DocumentTree JSON → TXT 纯文本提取
```

### 9.2 各格式导出链路

| 格式 | 实现位置 | 方案 |
|------|----------|------|
| JSON | 前端 | `JSON.stringify(DocumentTree)` → Blob 下载 |
| PNG | 前端 | `Canvas.toDataURL()` — 当前页 → Blob 下载 |
| PDF | **后端** | 接收 DocumentTree JSON → iText 服务端渲染 → 返回 PDF 流 |
| HTML | **后端** | 接收 DocumentTree JSON → Thymeleaf 模板渲染 → 返回 HTML |
| TXT | 前端或后端 | 遍历 DocumentTree 提取所有 TextNode.text → 拼接 |

### 9.3 排版一致性保障

| 风险 | 应对 |
|------|------|
| 前端 Canvas 渲染 ≠ 后端 PDF 渲染 | 后端 PDF 使用相同的布局参数 (PageSetup + DEFAULT_PAGE_SETUP)，由同一套布局引擎逻辑 (Java 移植) 计算 |
| 字体不一致 | 后端嵌入 SimSun/SimHei 字体文件，前端通过 @font-face 加载相同字体 |
| 图片分辨率不足 | PDF 导出时使用 2x DPR Canvas → 更高分辨率输出 |

---


---

## 10. 多格式文档加载 (v5.0 新增)

**问题**: 当前仅支持 DocumentTree JSON 反序列化。医疗文档需要加载 XML (HL7 CDA)、HTML (旧系统导出)、Markdown (轻量录入)、OFD (国标版式) 等外部格式。缺少统一导入抽象层，后期每加一种格式都要改核心代码。

**方案**: `IDocumentLoader` 接口抽象 + 格式适配器注册表。遵循「接口抽象」原则，新格式只需实现一个 loader，零侵入核心引擎。

```typescript
// ================================================================
// 导入接口 — 所有格式加载器的统一入口
// ================================================================
interface IDocumentLoader {
  /** 加载器支持的文件扩展名 (用于自动路由) */
  readonly extensions: string[]
  /** 加载器显示名 */
  readonly name: string

  /**
   * 从原始数据加载为 DocumentTree
   * @param source 原始文件内容 (文本或 ArrayBuffer)
   * @param options 加载选项
   * @returns DocumentTree — 统一内部模型
   * @throws LoaderError 格式解析失败时抛出
   */
  load(source: string | ArrayBuffer, options?: LoadOptions): Promise<DocumentTree>

  /**
   * 检测给定数据是否为此加载器支持的格式
   * (用于自动识别: 不依赖扩展名，检查文件头/内容特征)
   */
  detect(source: string | ArrayBuffer): boolean
}

interface LoadOptions {
  /** 原始格式的 modelVersion (用于 XML/HTML 等需要版本升级的场景) */
  sourceVersion?: string
  /** 是否在加载时执行 modelVersion 升级到最新 */
  upgradeToLatest?: boolean
  /** 是否执行 validateDocumentTree() 校验 */
  validate?: boolean
}

class LoaderError extends Error {
  constructor(message: string, readonly format: string, readonly cause?: Error) {
    super(`[${format}] ${message}`)
  }
}

// ================================================================
// 具体加载器实现
// ================================================================

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
    try { const p = JSON.parse(source); return p?.type === 'document' && Array.isArray(p?.pages) }
    catch { return false }
  }
}

/** XML 加载器 (HL7 CDA / 通用 XML 医疗文档) */
class XMLDocumentLoader implements IDocumentLoader {
  readonly extensions = ['.xml', '.cda']; readonly name = 'XML/HL7 CDA'

  async load(source: string, options?: LoadOptions): Promise<DocumentTree> {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(source, 'text/xml')
    // 将 XML DOM 映射为 DocumentTree
    // HL7 CDA: ClinicalDocument → DocumentTree
    //    structuredBody → FlowBody
    //    section → Paragraph[]
    //    entry/observation → SmartTextNode (DE 编码)
    // 通用 XML: 递归节点 → BlockNode 树
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
    // body → FlowBody
    //   <p> → Paragraph { children: [TextNode] }
    //   <b>/<i>/<u> → TextStyle
    //   <table> → Table
    //   <h1>-<h6> → Paragraph { size: 24-14, bold: true }
    //   <img> → (待实现 ImageParticle) → placeholder TextNode
    return this.parseHTMLToTree(htmlDoc.body)
  }

  private parseHTMLToTree(body: HTMLElement): DocumentTree { return {} as any }

  detect(): boolean { return true }  // HTML 检测优先级较低，放最后
}

/** Markdown 加载器 (轻量文本录入) */
class MarkdownDocumentLoader implements IDocumentLoader {
  readonly extensions = ['.md']; readonly name = 'Markdown'

  async load(source: string): Promise<DocumentTree> {
    // 简单 Markdown parser:
    //   # Title → DocumentTree.title
    //   ## Section → Paragraph { size: 20, bold: true }
    //   **text** → TextNode { bold: true }
    //   *text* → TextNode { italic: true }
    //   - list item → Paragraph { indent }
    //   | table | → Table
    return this.parseMarkdown(source)
  }

  private parseMarkdown(source: string): DocumentTree { return {} as any }

  detect(source: string): boolean {
    // 启发式检测: 不以 < 或 { 开头, 包含 #/*/- 标记
    const trimmed = source.trimStart()
    return !trimmed.startsWith('<') && !trimmed.startsWith('{') &&
           /[#*>|\-]/.test(trimmed.slice(0, 100))
  }
}

// ================================================================
// 加载器注册表 — 自动路由
// ================================================================
class DocumentLoaderRegistry {
  private loaders: IDocumentLoader[] = []

  constructor() {
    // 按优先级注册: 精确格式 → 通用格式 → 兜底
    this.register(new JSONDocumentLoader())
    this.register(new XMLDocumentLoader())
    this.register(new HTMLDocumentLoader())
    this.register(new MarkdownDocumentLoader())
  }

  register(loader: IDocumentLoader): void { this.loaders.push(loader) }

  /** 根据文件扩展名路由 */
  getByExtension(ext: string): IDocumentLoader | undefined {
    return this.loaders.find(l => l.extensions.includes(ext.toLowerCase()))
  }

  /** 自动检测格式 (按注册顺序, 第一个 detect() 返回 true 的加载器) */
  detectLoader(source: string | ArrayBuffer): IDocumentLoader | undefined {
    const str = typeof source === 'string' ? source : new TextDecoder().decode(source)
    return this.loaders.find(l => l.detect(str))
  }

  /** 加载文档 (自动检测格式) */
  async load(source: string | ArrayBuffer, filename?: string): Promise<DocumentTree> {
    // 1. 优先按扩展名匹配
    let loader: IDocumentLoader | undefined
    if (filename) {
      const ext = '.' + (filename.split('.').pop() || '').toLowerCase()
      loader = this.getByExtension(ext)
    }
    // 2. 扩展名未匹配 → 自动检测
    if (!loader) loader = this.detectLoader(source)
    if (!loader) throw new Error('Unsupported document format')

    return loader.load(source, { upgradeToLatest: true, validate: true })
  }
}

// 全局单例
const documentLoader = new DocumentLoaderRegistry()

// 使用示例:
// const doc = await documentLoader.load(jsonString, '病历.json')
// const doc = await documentLoader.load(xmlBytes, 'hl7-cda.xml')
// const doc = await documentLoader.load(markdownString)        // 自动检测
// const doc = await documentLoader.load(fileContent, file.name) // 扩展名路由
```

**前端文件选择集成**:

```typescript
// 文件选择器 → 自动路由到对应加载器
async function handleFileOpen(file: File): Promise<void> {
  const buffer = await file.arrayBuffer()
  const doc = await documentLoader.load(buffer, file.name)
  editor.setDocument(doc)
}

// 支持的格式 (拖拽/粘贴/文件对话框):
// .json  — 原生格式
// .xml   — HL7 CDA / 通用 XML
// .html  — 富文本 (有损转换)
// .md    — Markdown 轻量录入
// 未来: .ofd — 国标版式 (需要 OFD parser 库)
```

**设计要点**:
- 所有加载器输出统一为 `DocumentTree`，上游代码无需关心源格式
- `detect()` 支持无扩展名场景 (剪贴板/拖拽/API 直传)
- 加载后自动执行 `ensureLatestModel()` (升级到最新 modelVersion) + `validateDocumentTree()` (拒绝非法结构)
- HTML/Markdown 加载是有损转换 (富文本样式映射到 TextStyle，无法还原复杂排版)
- XML 加载器是医疗文档互操作的关键 (HL7 CDA → SmartTextNode DE 编码映射)

---

## 12. 交互与系统深化设计 (v4.0 新增)

### 11.1 选区模型增强

**问题**: 当前仅定义了 `anchor/focus` 的基础结构，缺失选区标准化规则、跨块选区语义、表格选区模型。

**方案**:

```typescript
// 选区粒度 — 分层表达
type SelectionGranularity = 'character' | 'node' | 'block' | 'table'

interface SelectionState {
  anchor: CursorState; focus: CursorState; active: boolean
  /** 选区粒度 (v4.0) */
  granularity: SelectionGranularity
}

/** 标准化方向: 始终 start ≤ end (前闭后开) */
function normalizeSelection(sel: SelectionState): { start: CursorState; end: CursorState } {
  return comparePaths(sel.anchor.path, sel.focus.path) <= 0
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

### 11.2 命令事务与合并

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
  private tryMerge(command: ICommand): boolean {
    const last = this.undoStack[this.undoStack.length - 1]
    if (!last) return false
    // 同类型 + 同时戳窗口内 + 同作者 → 合并
    if (last.type === command.type &&
        command.timestamp - last.timestamp < this.MERGE_WINDOW_MS &&
        last.author === command.author) {
      (last as MergeableCommand).merge(command)
      return true
    }
    return false
  }
}

/** 可合并的命令接口 */
interface MergeableCommand extends ICommand {
  merge(other: ICommand): void
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

### 11.3 InputComposer — IME 抽象层

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

### 11.4 插件生命周期

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
  on(event: EngineEvent, handler: (...args: any[]) => void): void
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

### 11.5 语义化模型版本

**问题**: 当前只有简单的升级器数组，没有版本号规则、破坏性变更策略、降级兼容方案。

**方案**:

```typescript
/**
 * 语义化模型版本: MAJOR.MINOR.PATCH
 * - MAJOR: 破坏性变更 (不向后兼容的模型结构调整)
 * - MINOR: 新增字段/类型 (向后兼容，旧版本可忽略新字段)
 * - PATCH: 校验规则修正、默认值变更 (完全兼容)
 */
const MODEL_VERSION = '3.0.0'

interface ModelUpgrader {
  from: string; to: string
  /** 是否破坏性升级 (MAJOR 版本变更) */
  breaking: boolean
  upgrade(doc: DocumentTree): DocumentTree
}

const upgraders: ModelUpgrader[] = [
  // 非破坏性升级: 2.0 → 3.0 (新增 metadata 字段，旧版本忽略)
  { from: '2.0.0', to: '3.0.0', breaking: false,
    upgrade(doc: DocumentTree): DocumentTree { /* 添加 metadata + FlowBody 包装 */ }
  },
  // 破坏性升级: 3.0 → 4.0 (children 从对象引用改为 ID 数组)
  { from: '3.0.0', to: '4.0.0', breaking: true,
    upgrade(doc: DocumentTree): DocumentTree { /* children: BaseNode[] → children: string[] */ }
  },
]

/** 加载文档时的版本处理流程 */
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
  if (!result.valid) {
    throw new DocumentValidationError(result.errors)
  }
  return doc
}

/** 保存文档时强制写入最新 modelVersion */
function saveDocument(doc: DocumentTree): string {
  if (!doc.metadata) doc.metadata = {}
  doc.metadata.modelVersion = MODEL_VERSION
  return JSON.stringify(doc)
}
```

### 11.6 大文档虚拟化与内存管理

**问题**: 仅提了 `visiblePages`，没有懒布局、视口渲染、节点回收策略；图片/字体/布局/Undo 缓存均无释放策略。

**方案**:

```typescript
// ---- 视口虚拟化 ----
interface VirtualViewport {
  /** 当前可见的页面索引范围 */
  visiblePages: { start: number; end: number }
  /** 视口外预渲染页数 (上下各 1 页，用于平滑滚动) */
  overscan: number

  /** 计算当前视口下的可见页面 */
  update(scrollY: number, pageHeight: number, viewportHeight: number): void
}

// ---- 懒布局 ----
class LazyLayoutEngine {
  /** 仅对可见页面进行布局计算，非可见页延迟到进入视口时计算 */
  layoutVisible(document: DocumentTree, viewport: VirtualViewport, cache: LayoutCache): PageItem[]
  /** 回收离开视口的页面布局结果 (释放内存) */
  evictOutOfView(viewport: VirtualViewport): void
}

// ---- 内存管理 ----
class MemoryManager {
  private maxUndoDepth = 100
  private maxImageCacheMB = 50
  private maxLayoutCacheEntries = 5000

  /** 超出限制时自动清理最早条目 */
  enforceLimits(layoutCache: LayoutCache, undoStack: ICommand[]): void {
    // LayoutCache: LRU 淘汰超量条目
    // UndoStack: 超出 maxDepth 时合并早期历史
    // TextMeasurer: 定期清理低频缓存条目
  }
}
```

### 11.7 测试体系设计

**问题**: Canvas 渲染结果无法自动化验证，布局、交互逻辑没有单元测试边界。

**方案**:

```typescript
// ---- 分层测试策略 ----
// L1: 纯函数单元测试 (无 DOM 依赖)
//   模型校验、命令执行、布局算法、坐标转换、ID 生成、版本升级
//
// L2: jsdom 集成测试 (模拟 DOM)
//   TextMeasurer (需要 Canvas measureText)、EditorRuntimeState 状态转换
//
// L3: 浏览器 E2E 测试 (Playwright)
//   文本编辑、格式化、IME 输入、表格操作、保存加载

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

### 11.8 打印导出一致性保障

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
 *   Step 1: 前端布局引擎输出「布局中间结果」JSON
 *     { pages: [{ width, height, items: [{ text, x, y, font, size, ... }] }] }
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

### 11.9 错误边界与降级策略

**问题**: 布局异常、渲染崩溃、模型损坏时没有兜底降级方案，单节点错误可能导致整份文档打不开。

**方案**:

```typescript
/**
 * 错误边界 — 层层兜底
 */

// L1: 节点级错误隔离
function safeRenderParticle(particle: IParticle, layout: ParticleLayout, ctx: RenderContext): RenderRect | null {
  try {
    return particle.render(layout, ctx)
  } catch (err) {
    console.error(`[Render] Particle ${particle.particleType} render failed:`, err)
    // 降级: 渲染红色占位框替代崩溃节点
    ctx.ctx.fillStyle = '#FEE2E2'
    ctx.ctx.fillRect(layout.x, layout.y, layout.width || 50, layout.height || 20)
    ctx.ctx.strokeStyle = '#EF4444'
    ctx.ctx.strokeRect(layout.x, layout.y, layout.width || 50, layout.height || 20)
    return null
  }
}

// L2: 页面级错误隔离
function safeRenderPage(page: Page, renderer: LayeredRenderer): void {
  try {
    renderer.renderContent(computePageItems(page))
  } catch (err) {
    console.error(`[Render] Page ${page.id} render failed:`, err)
    // 降级: 显示错误提示页面
    renderer.renderErrorPage(page.id, err.message)
  }
}

// L3: 文档级错误恢复
async function safeLoadDocument(json: string): Promise<DocumentTree> {
  try {
    return loadDocument(json)  // 含 modelVersion 升级 + 校验
  } catch (err) {
    if (err instanceof DocumentValidationError) {
      // 尝试从 localStorage 恢复最近一次成功保存的版本
      const backup = getLatestBackup()
      if (backup) return backup
    }
    throw new DocumentLoadError('文档数据损坏，且无可恢复的备份')
  }
}
```

---


---

## 13. 医学质控引擎 (v5.0 新增)

电子病历的核心差异化能力。质控引擎基于 ModelD 的 `SmartTextNode.element` (HDSD/DE 编码 + ElementFormat) 和 `ElementMeta` 内建的校验元数据，实现完整性、一致性、规范性三重检查。

### 12.1 质控规则模型

```typescript
// ================================================================
// 质控规则类型
// ================================================================
type QCRuleType = 'completeness' | 'consistency' | 'standardization'

interface QCRule {
  id: string; name: string; type: QCRuleType
  /** 规则权重 (用于质控评分) */
  weight: number
  /** 严重级别 */
  severity: 'error' | 'warning' | 'info'
  /** 规则描述 (给质控员看) */
  description: string
  /** 执行校验 */
  check(document: DocumentTree, pool: NodePool): QCFinding[]
}

// ================================================================
// 三种规则类型
// ================================================================

/** 完整性校验 — 必填字段是否已填写 */
class CompletenessRule implements QCRule {
  type: QCRuleType = 'completeness'
  check(doc: DocumentTree, pool: NodePool): QCFinding[] {
    const findings: QCFinding[] = []
    traverse(doc, (node) => {
      if ((node as any).type === 'smarttext') {
        const st = node as SmartTextNode
        if (st.element.required && (!st.text || st.text.trim() === '')) {
          findings.push({
            ruleId: this.id, severity: 'error', type: 'completeness',
            nodeId: st.id,
            message: `【${st.element.name}】为必填项，当前未填写`,
            elementCode: st.element.code.internal,
          })
        }
      }
    })
    return findings
  }
}

/** 逻辑一致性校验 — 跨字段逻辑关系 */
class ConsistencyRule implements QCRule {
  type: QCRuleType = 'consistency'
  /** 自定义逻辑表达式 */
  private expression: (doc: DocumentTree, pool: NodePool) => boolean

  constructor(
    readonly id: string, readonly name: string,
    readonly weight: number, readonly severity: 'error' | 'warning' | 'info',
    readonly description: string, expression: (doc: DocumentTree, pool: NodePool) => boolean
  ) { this.expression = expression }

  check(doc: DocumentTree, pool: NodePool): QCFinding[] {
    if (this.expression(doc, pool)) return []
    return [{ ruleId: this.id, severity: this.severity, type: 'consistency',
              nodeId: '', message: this.description, elementCode: '' }]
  }
}

// 预置一致性规则示例:
const DISCHARGE_AFTER_ADMIT = new ConsistencyRule(
  'QC_DISCHARGE_AFTER_ADMIT', '出院日期 >= 入院日期', 15, 'error',
  '出院日期必须晚于或等于入院日期',
  (doc, pool) => {
    const admitNodes  = findByInternal(doc, 'HDSD00.01.010')  // 入院日期
    const dischNodes  = findByInternal(doc, 'HDSD00.01.020')  // 出院日期
    if (admitNodes.length === 0 || dischNodes.length === 0) return true  // 字段不存在 → 跳过
    return new Date(dischNodes[0].text) >= new Date(admitNodes[0].text)
  }
)

const SYSTOLIC_GT_DIASTOLIC = new ConsistencyRule(
  'QC_BP_SYS_GT_DIA', '收缩压 > 舒张压', 10, 'error',
  '收缩压必须大于舒张压',
  (doc, pool) => {
    const sys = findByInternal(doc, 'HDSD00.02.001')
    const dia = findByInternal(doc, 'HDSD00.02.002')
    if (sys.length === 0 || dia.length === 0) return true
    return parseInt(sys[0].text) > parseInt(dia[0].text)
  }
)

/** 规范性校验 — 编码/术语是否在字典范围内 */
class StandardizationRule implements QCRule {
  type: QCRuleType = 'standardization'
  check(doc: DocumentTree, pool: NodePool): QCFinding[] {
    const findings: QCFinding[] = []
    traverse(doc, (node) => {
      if ((node as any).type === 'smarttext') {
        const st = node as SmartTextNode
        if (st.element.format?.dictionary && st.text) {
          // 检查 st.text 的值是否在 dictionary 指定的编码表中
          // dictionary 可以是远程码表 ID 或本地枚举值
          if (!isInDictionary(st.text, st.element.format.dictionary)) {
            findings.push({
              ruleId: this.id, severity: 'warning', type: 'standardization',
              nodeId: st.id,
              message: `【${st.element.name}】的值"${st.text}"不在规范码表中`,
              elementCode: st.element.code.internal,
            })
          }
        }
      }
    })
    return findings
  }
}
```

### 12.2 质控评分模型

```typescript
interface QCScore {
  total: number           // 总分 (0-100)
  completeness: number    // 完整度得分
  consistency: number     // 一致性得分
  standardization: number // 规范性得分
  grade: 'A' | 'B' | 'C' | 'D'
  findingCount: { error: number; warning: number; info: number }
}

class QCScorer {
  /** 评分权重配置 */
  private weights = { completeness: 40, consistency: 30, standardization: 30 }

  score(findings: QCFinding[], rules: QCRule[]): QCScore {
    // 1. 分组: 按规则类型分类
    const byType = { completeness: findings.filter(f => f.type === 'completeness'),
                     consistency: findings.filter(f => f.type === 'consistency'),
                     standardization: findings.filter(f => f.type === 'standardization') }

    // 2. 加权扣分: 每个 error 按规则 weight 扣分，warning 扣一半
    const calcScore = (fs: QCFinding[], rules: QCRule[], maxScore: number): number => {
      const totalWeight = rules.reduce((s, r) => s + r.weight, 0) || 1
      let deducted = 0
      for (const f of fs) {
        const rule = rules.find(r => r.id === f.ruleId)
        const penalty = rule ? rule.weight / totalWeight * maxScore : 0
        deducted += f.severity === 'error' ? penalty : penalty * 0.5
      }
      return Math.max(0, maxScore - deducted)
    }

    const completeness = calcScore(byType.completeness, rules.filter(r => r.type === 'completeness'), this.weights.completeness)
    const consistency = calcScore(byType.consistency, rules.filter(r => r.type === 'consistency'), this.weights.consistency)
    const standardization = calcScore(byType.standardization, rules.filter(r => r.type === 'standardization'), this.weights.standardization)
    const total = completeness + consistency + standardization

    return {
      total, completeness, consistency, standardization,
      grade: total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : 'D',
      findingCount: { error: findings.filter(f => f.severity === 'error').length,
                      warning: findings.filter(f => f.severity === 'warning').length,
                      info: findings.filter(f => f.severity === 'info').length },
    }
  }
}
```

### 12.3 质控引擎

```typescript
class QCEngine {
  private rules: QCRule[] = []
  private scorer = new QCScorer()

  registerRule(rule: QCRule): void { this.rules.push(rule) }
  registerRules(rules: QCRule[]): void { this.rules.push(...rules) }

  /**
   * 执行全面质控检查
   *
   * 触发时机:
   * - 文档内容变更 (CommandManager.execute 后延迟执行)
   * - 用户手动触发 (工具栏 "质控检查" 按钮)
   * - 保存前 (beforeSave 拦截器)
   */
  check(document: DocumentTree, pool: NodePool): QCResult {
    const findings = this.rules.flatMap(rule => rule.check(document, pool))
    return {
      findings,
      score: this.scorer.score(findings, this.rules),
      timestamp: Date.now(),
    }
  }
}

interface QCResult {
  findings: QCFinding[]
  score: QCScore
  timestamp: number
}

interface QCFinding {
  ruleId: string; severity: 'error' | 'warning' | 'info'
  type: QCRuleType
  nodeId: string         // 关联的 SmartTextNode ID (用于渲染时定位)
  message: string
  elementCode: string    // HDSD 内部编码 (用于规则注册)
}
```

### 12.4 质控审核流程

```
文档编写者完成病历
       │
       ▼
  [1. 自动质控] — QCEngine.check()
       生成 QCFinding[] + QCScore
       │
       ▼
  [2. 编写者修正] — 根据 findings 修改文档
       质控结果实时更新 (编辑后重新执行 check)
       │
       ▼
  [3. 提交审核] — 状态: draft → pending_review
       │
       ▼
  [4. 质控员审核]
       ├─ 通过 → 状态: reviewed → 归档
       └─ 驳回 → 状态: rejected → 返回编写者修正 (回到步骤 2)
```

```sql
-- 质控审核记录表
CREATE TABLE t_qc_review (
    id            VARCHAR(64) PRIMARY KEY,
    document_id   VARCHAR(64) NOT NULL,
    reviewer_id   VARCHAR(64) NOT NULL,
    status        VARCHAR(20) NOT NULL COMMENT 'pending_review/reviewed/rejected',
    score         INT         COMMENT '审核时的质控评分 (0-100)',
    findings_json JSON        COMMENT '审核时的 QCFinding[] 快照',
    comment       TEXT        COMMENT '审核意见',
    created_at    DATETIME    DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_document_id (document_id),
    INDEX idx_status (status)
);
```

---

## 23. SDK 集成与公共 API 边界 (v7.0 新增)

**问题**: Editor 门面没有明确划分「公开稳定 API」和「内部实现」。第三方集成时可能直接调用 Draw、NodePool 内部方法，内核重构会导致外部崩溃。

### 23.1 公共 API 三层模型

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
  // ================================================================
  // 第一类: 数据接口 — 唯一的数据读写入口
  // ================================================================
  /** 获取当前文档 (只读快照) */
  getDocument(): Readonly<DocumentTree>
  /** 替换整个文档 (模板加载、文件打开) */
  setDocument(doc: DocumentTree): void
  /** 文档内容变更事件 (每次 execCommand 后触发) */
  onDocumentChange(callback: (doc: DocumentTree) => void): () => void

  // ================================================================
  // 第二类: 操作接口 — 所有文档修改必须走命令
  // ================================================================
  /** 执行命令 (统一操作入口, 禁止直接改 NodePool/DocumentTree) */
  execCommand(command: ICommand): void
  /** 撤销 */
  undo(): void
  /** 重做 */
  redo(): void
  /** 是否可撤销 */
  canUndo(): boolean
  /** 是否可重做 */
  canRedo(): boolean

  // ================================================================
  // 第三类: 事件接口 — 所有状态变更通过事件通知
  // ================================================================
  /** 编辑器就绪 (字体加载完成, 首帧渲染完成) */
  onReady(callback: () => void): () => void
  /** 选区变更 */
  onSelectionChange(callback: (sel: SelectionState) => void): () => void
  /** 编辑器模式变更 */
  onModeChange(callback: (mode: EditorMode) => void): () => void
  /** 保存状态变更 */
  onSaveStatusChange(callback: (status: SaveStatus) => void): () => void
  /** 异常事件 (渲染/加载/保存 异常) */
  onError(callback: (error: EditorError) => void): () => void
  /** 缩放变更 */
  onScaleChange(callback: (scale: number) => void): () => void

  // ================================================================
  // 视图控制
  // ================================================================
  setScale(scale: number): void
  setMode(mode: EditorMode): void
  scrollToPage(pageIndex: number): void
  focus(): void

  // ================================================================
  // 插件
  // ================================================================
  use(plugin: IPlugin): void

  // ================================================================
  // 生命周期
  // ================================================================
  /** 销毁编辑器, 释放所有资源 */
  destroy(): void
}

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict'

interface EditorError {
  category: 'render' | 'load' | 'save' | 'layout' | 'validation' | 'font'
  message: string; cause?: Error; timestamp: number
  /** 是否可恢复 (false 表示文档已损坏) */
  recoverable: boolean
}
```

### 23.2 宿主环境隔离

```
src/engine/          ← 内核 (零 UI 框架依赖)
  ├── 允许依赖: 原生 DOM API, Canvas API, FontFace API, IndexedDB
  ├── 禁止依赖: React, Vue, Zustand, 任何 UI 框架
  ├── 禁止直接读: window (用传入的 container 做 DOM 挂载)
  │               document (用 container.ownerDocument)
  └── 所有 DOM 操作统一由 Interaction 层封装

src/editor-react/    ← React 组件封装包 (依赖 engine)
  ├── EditorProvider.tsx     — React Context 桥接
  ├── Toolbar.tsx            — React 工具栏
  ├── Sidebar.tsx            — React 侧边栏
  └── ...                    — 完整 UI 组件

外部集成方:
  纯 JS / Vue / Electron → import { Editor } from '@emr/engine'
  React 项目              → import { EditorProvider } from '@emr/editor-react'
```

### 23.3 构建产物

```
@emr/engine (内核包)
  ├── dist/engine.esm.js    — ES Module (tree-shakable)
  ├── dist/engine.umd.js    — UMD (script 标签引入)
  └── dist/engine.d.ts      — TypeScript 类型声明

@emr/editor-react (React 封装包)
  ├── dist/editor-react.esm.js
  ├── dist/editor-react.d.ts
  └── peerDependencies: react, react-dom, @emr/engine

资源加载:
  FontManager.registerFont() 接受 URL/ArrayBuffer, 不写死路径
  HarfBuzzShaper 接受 WASM URL 参数, 调用方控制加载路径
```

### 23.4 多实例共存

```typescript
/**
 * 单例 vs 实例私有的划分:
 *
 * 全局共享 (只读, 多实例复用):
 *   - FontManager.fontMetrics 缓存        (字体度量数据只读)
 *   - HarfBuzzShaper WASM 实例            (纯计算, 无状态)
 *   - TextMeasurer cache                  (LRU, 可通过 key 区分实例)
 *
 * 实例私有 (每个 Editor 独立):
 *   - DocumentTree + NodePool             (文档数据)
 *   - EditorRuntimeState                  (光标/选区/滚动/IME)
 *   - EventBus                            (每个实例独立事件通道)
 *   - CommandUndoRedoStack                (编辑历史)
 *   - LayoutCache                         (布局缓存)
 *   - LayeredRenderer                     (Canvas 实例)
 *   - CoordinateSystem                    (缩放/滚动状态)
 *   - AutoSaveManager                     (保存状态)
 *
 * 初始化:
 *   const editor1 = new Editor({ container: el1, resourceBaseUrl: '/app1/' })
 *   const editor2 = new Editor({ container: el2, resourceBaseUrl: '/app2/' })
 *   两个实例完全隔离, 互不影响
 */

interface EditorConfig {
  /** 挂载容器 (必填) */
  container: HTMLElement
  /** 资源根路径 (字体/WASM 等, 可选, 默认 '/') */
  resourceBaseUrl?: string
  /** 初始文档 (可选) */
  document?: DocumentTree
  /** 编辑器模式 */
  mode?: EditorMode
  /** 缩放比例 */
  scale?: number
}
```

### 23.5 标准扩展点清单

所有定制需求走插件化入口, 禁止改内核:

| 扩展点 | 接口 | 用途 |
|--------|------|------|
| 自定义节点类型 | `ctx.registerNodeType(type, factory)` | 注册新的 BlockNode/InlineNode 子类型 |
| 自定义渲染粒子 | `ctx.registerParticle(particle)` | 注册节点类型对应的 IParticle 渲染器 |
| 自定义命令 | `ctx.registerCommand(type, ctor)` | 注册新的 ICommand (含快捷键绑定) |
| 自定义校验规则 | `ctx.registerQCRule(rule)` | 注册 QCRule (完整性/一致性/规范性) |
| 自定义工具栏 | `ctx.registerToolbarItem(group, item)` | 添加/替换/禁用工具栏按钮 |
| 自定义右键菜单 | `ctx.registerContextMenuItem(item)` | 添加/替换/禁用右键菜单项 |
| 自定义 SmartText 渲染 | `ctx.registerSmartTextRenderer(type, renderer)` | 覆盖特定 SmartText 控件的渲染与交互 |
| 自定义加载器 | `ctx.registerLoader(loader)` | 注册新的 IDocumentLoader (支持新格式) |

```typescript
// 插件接入方式 — 与内核完全解耦
const myPlugin: IPlugin = {
  name: 'my-custom-controls', version: '1.0.0',
  install(ctx: PluginContext) {
    ctx.registerNodeType('signature', createSignatureNode)
    ctx.registerParticle(new SignatureParticle())
    ctx.registerQCRule(new SignatureRequiredRule())
    ctx.registerToolbarItem('insert', {
      label: '签章', icon: 'PenTool', onClick: () => editor.execCommand(new InsertSignatureCommand())
    })
  },
  enable() {}, disable() {}, destroy() {},
}
editor.use(myPlugin)
```


### 7.5 可观测性 (v6.0 新增)

#### 7.5.1 性能埋点

```typescript
interface PerformanceMetrics {
  // ---- 布局性能 ----
  /** 全量 reLayout 耗时 (ms)，起点=调用入口, 终点=PageItem[] 生成完成 */
  layoutFullTime: number
  /** 增量 reLayout 耗时 (ms)，起点=脏区标记完成, 终点=受影响 PageItem 更新完成 */
  layoutIncrementalTime: number
  /** 布局缓存命中率 (0-1)，1=全部命中无需重算 */
  layoutCacheHitRate: number

  // ---- 渲染性能 ----
  /** 单帧渲染耗时 (ms)，起点=requestAnimationFrame 回调开始, 终点=ctx 绘制完成 */
  renderFrameTime: number
  /** 分层渲染耗时: static/composite/interact 三层分别计时 */
  renderLayerTimes: { static: number; content: number; interact: number }

  // ---- 编辑性能 ----
  /** 按键到渲染延迟 (ms)，起点=keydown 事件触发, 终点=交互层 Canvas 绘制完成 */
  keystrokeLatency: number
  /** 命令执行耗时 (ms)，起点=CommandManager.execute(), 终点=StatePatch 返回 */
  commandExecuteTime: number

  // ---- 保存性能 ----
  /** IndexedDB 写入耗时 (ms) */
  saveToIDBDuration: number
  /** 远程 API 保存耗时 (ms)，起点=fetch 调用, 终点=响应解析完成 */
  saveToAPIDuration: number
}

// 测量方式: Performance.now() 打点, 开发环境 100% 采样, 生产 1%
// 上报: navigator.sendBeacon('/api/v1/metrics', JSON.stringify(metrics))
```

#### 7.5.2 异常上报

```typescript
type ErrorCategory =
  | 'js_error'           // window.onerror 捕获的未处理 JS 异常
  | 'render_error'       // safeRenderParticle 降级渲染触发
  | 'layout_error'       // recomputeLayout 异常
  | 'validation_error'   // validateDocumentTree 校验失败
  | 'save_error'         // API 保存失败 (网络/版本冲突)
  | 'load_error'         // 文档加载失败 (JSON 解析/modelVersion 升级/校验)
  | 'font_error'         // 字体加载失败

interface ErrorReport {
  category: ErrorCategory
  message: string
  stack?: string
  documentId?: string
  modelVersion?: string
  timestamp: number
}
```

#### 7.5.3 业务指标

```typescript
interface BusinessMetrics {
  /** 文档总页数 */
  pageCount: number
  /** 总节点数 (NodePool.nodes.size) */
  nodeCount: number
  /** SmartTextNode 数量 (结构化字段数) */
  smartTextCount: number
  /** 编辑会话时长 (编辑器 mount → destroy, 秒) */
  sessionDuration: number
  /** 命令执行总数 */
  commandCount: number
  /** 每分钟操作频次 = commandCount / sessionDuration * 60 */
  operationsPerMinute: number
}
```

---

### 7.6 性能指标测量规则 (v6.0 新增)

| 指标 | 计时起点 | 计时终点 | 测量方法 |
|------|----------|----------|----------|
| 10 页文档加载 | `fetch()` 调用 | `Editor` 构造完成 + 首帧渲染完成 | `performance.measure('doc-load', 'fetch-start', 'first-render-end')` |
| 单次编辑响应延迟 | `keydown` 事件触发 | `requestAnimationFrame` 回调中交互层 Canvas 绘制完成 | `const t0=performance.now(); rAF(()=>{ metrics.keystrokeLatency=performance.now()-t0 })` |
| 连续打字帧率 | 同上，采样 100 次 | 计算 100 次 keystrokeLatency 的 P95 | 丢弃前 10 次预热，统计后 90 次 |
| 100 页分页计算 | `PageBreaker.breakPages()` 调用 | `IPage[]` 返回 | `performance.measure('page-break', ...)` |
| 自动保存响应 | `AutoSaveManager.save()` 调用 | API 响应解析完成 (或 IndexedDB 写入完成) | 分别计时 IndexedDB 和 API 两段 |

---

## 15. 节点池核心语义规则 (v6.0 新增)

**问题**: 文档提出「物理扁平、逻辑树形」，但缺少父子关系、兄弟顺序、遍历范式的硬性约束。

**规则**:

```typescript
/**
 * 节点池不可违反的 5 条铁律:
 *
 * 1. 【单向引用】父子关系仅通过父节点的 children: string[] 维护。
 *    节点本身不存储 parentId，禁止双向引用。
 *    违反后果: 循环依赖、序列化膨胀、移动节点时两处都要更新。
 *
 * 2. 【顺序保证】children 数组的顺序 = 文档中的逻辑顺序。
 *    渲染、遍历、选区计算全部依赖此顺序，禁止任何代码对 children 做非确定性排序。
 *
 * 3. 【统一入口】所有 children 数组的增删改必须通过 NodePool 的工具函数:
 *    pool.insertChild(parentId, childId, index)
 *    pool.removeChild(parentId, index)
 *    pool.moveChild(parentId, fromIndex, toIndex)
 *    禁止直接操作 parent.children.push/splice。违反后果: ID 唯一性检查被绕过，脏数据入库。
 *
 * 4. 【ID 不可变】节点 ID 一旦分配，永不修改。cloneWithNewIds() 生成全新 ID。
 *    禁止手动设置或修改 node.id。违反后果: 缓存失效、引用断裂、协作去重失败。
 *
 * 5. 【遍历范式】所有树遍历必须通过 traverse() 函数，按 children 顺序深度优先。
 *    禁止直接递归访问 children 数组做业务逻辑。违反后果: 遍历逻辑散落，FlowBody/BlockNode[]
 *    双模分支漏处理。
 */

class NodePool {
  private nodes = new Map<string, BaseNode>()
  private _version = 0

  get version(): number { return this._version }

  /** 插入子节点 (唯一合法入口) */
  insertChild(parentId: string, childId: string, index: number): void {
    const parent = this.nodes.get(parentId)
    if (!parent || !('children' in parent)) throw new Error(`Parent ${parentId} not found or has no children`)
    const children = (parent as any).children as string[]
    if (this.nodes.has(childId)) throw new Error(`Duplicate ID: ${childId}`)
    children.splice(index, 0, childId)
    this._version++
  }

  /** 删除子节点 (唯一合法入口) */
  removeChild(parentId: string, index: number): string {
    const parent = this.nodes.get(parentId)
    if (!parent || !('children' in parent)) throw new Error(`Parent ${parentId} not found`)
    const children = (parent as any).children as string[]
    const removed = children.splice(index, 1)[0]
    this.nodes.delete(removed)  // 从节点池移除
    this._version++
    return removed
  }

  /** 获取子节点 ID 列表 (只读) */
  getChildren(parentId: string): readonly string[] {
    const parent = this.nodes.get(parentId)
    return (parent as any)?.children ?? []
  }

  /** 获取子节点对象列表 (只读, 用于遍历) */
  getChildNodes(parentId: string): readonly BaseNode[] {
    return this.getChildren(parentId).map(id => this.nodes.get(id)!).filter(Boolean)
  }
}
```

---

## 16. 表格模型核心规则 (v6.0 新增)

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

function buildMergeMatrix(table: Table): MergeMatrix {
  const rows = table.children.length
  const cols = Math.max(...table.children.map(row =>
    row.children.reduce((sum, cell) => sum + (cell.colspan || 1), 0)
  ))
  const grid: (string | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null))

  for (let r = 0; r < rows; r++) {
    let c = 0
    for (const cell of table.children[r].children) {
      while (c < cols && grid[r][c] !== null) c++  // 跳过被上方 rowspan 占据的格子
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

---

## 17. 协作预留的位置锚定约束 (v6.0 新增)

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
 *   ✅ Command 构造函数的位置参数      — 已遵循 (InsertTextCommand 用 path + offset)
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

---

## 18. 核心接口契约骨架 (v6.0 新增)

```typescript
// ================================================================
// 编译时强制约束 — 实现者必须遵守，调用方依赖这些契约
// ================================================================

/** ICommand — 所有编辑操作的标准封装 */
interface ICommand {
  readonly type: string
  readonly id: string
  readonly timestamp: number
  readonly author: string
  forward(document: DocumentTree, pool: NodePool): StatePatch | null
  invert(): ICommand
  serialize(): SerializedCommand  // { type, id, timestamp, author, payload: {...} }
}
type SerializedCommand = Record<string, unknown>

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
interface ShapedGlyph {
  char: string; xAdvance: number; xOffset: number; yOffset: number; glyphId: number
}

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

---

## 19. 字体加载防抖策略 (v6.0 新增)

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

---

## 20. 模型版本向下兼容规则 (v6.0 新增)

**问题**: 仅定义向前兼容 (旧数据可打开)，未定义版本共存场景的规则。

**规则**:

```typescript
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
 * ✅  = 正常打开
 * ❌1 = 拒绝打开，提示 "请升级编辑器"
 * ✅2 = 静默升级到当前版本，编辑保存后写入当前版本格式
 *
 * 规则:
 * 1. 向前兼容 (必须): 高版本客户端必须能打开低版本文档 (✅2)
 *    实现: ensureLatestModel() 升级器链
 *
 * 2. 保存时强制升级: 编辑后保存时，无论原版本，均写入当前 MODEL_VERSION
 *    实现: saveDocument() 强制设置 doc.metadata.modelVersion = MODEL_VERSION
 *
 * 3. 低版本拒绝高版本文档 (必须): 低版本客户端遇到更高版本 → 拒绝
 *    实现: if (doc.modelVersion > CLIENT_MODEL_VERSION) throw new VersionError()
 *    原因: 低版本不知道新字段的语义，静默丢弃会导致数据丢失
 *
 * 4. 破坏性升级 (MAJOR 变更): 必须提供「向前兼容读取 + 静默升级保存」路径
 *    如 v3→v4 (children 从对象引用改为 ID 数组): upgrader 同时支持两种格式读取
 *
 * 5. 非破坏性升级 (MINOR/PATCH): 旧版本客户端可忽略新字段 (JSON 序列化保留未知字段)
 *    实现: JSON.parse/stringify 天然保留未知字段，低版本不会丢失新字段数据
 */
```

---

## 21. 布局中间格式定义 (v6.0 新增 — 前后端一致性保障)

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
  type: string                     // 'text' | 'table' | 'image' | 'control'
  text?: string                    // 文本内容 (type='text')
  x: number; y: number            // 逻辑坐标 (文档坐标系)
  width: number; height: number
  ascent: number; descent: number
  font: string; size: number
  bold?: boolean; italic?: boolean
  underline?: boolean; strikeout?: boolean
  color?: string; highlight?: string
  superscript?: boolean; subscript?: boolean
  // table 扩展: rows: SLIFRow[], image 扩展: imageUrl, 等等
}
```
## 24. 更新后的技术债务全貌

### 13.1 技术债务清单 (v4.0)

| # | 问题 | 严重度 | v4.0 状态 |
|---|------|--------|-----------|
| 1 | 纯嵌套结构无节点池 → **已设计 §2.1.1** | 高 | 待实现 |
| 2 | 表格模型过薄 → **已设计 §2.1.2** | 高 | 待实现 |
| 3 | 无布局缓存 → **已设计 §2.8.4** | 高 | 待实现 |
| 4 | 单 Canvas 无分层 → **已设计 §2.8.5** | 高 | 待实现 |
| 5 | 无命中检测体系 → **已设计 §2.9** | 高 | 待实现 |
| 6 | Draw.ts 上帝类 | 高 | §2.10 |
| 7 | 全量重布局/重绘 | 高 | §2.8 |
| 8 | 快照式撤销 | 高 | §2.5 |
| 9 | 下标路径定位 | 中 | §2.4 |
| 10 | 选区模型不完备 → **已设计 §11.1** | 中 | 待实现 |
| 11 | 命令无事务合并 → **已设计 §11.2** | 中 | 待实现 |
| 12 | IME 无抽象层 → **已设计 §11.3** | 中 | 待实现 |
| 13 | LineBreaker/PageBreaker 未集成 | 中 | - |
| 14 | 插件无生命周期 → **已设计 §11.4** | 中 | 待实现 |
| 15 | 版本兼容机制过弱 → **已设计 §11.5** | 中 | 待实现 |
| 16 | 大文档无虚拟化 → **已设计 §11.6** | 中 | 待实现 |
| 17 | 内存无管理策略 → **已设计 §11.6** | 中 | 待实现 |
| 18 | 测试体系无设计 → **已设计 §11.7** | 中 | 待实现 |
| 19 | 打印一致性无保障 → **已设计 §11.8** | 中 | 待实现 |
| 20 | 错误边界缺失 → **已设计 §11.9** | 中 | 待实现 |
| 21 | runtime 状态散落 | 低 | §2.4 |
| 22 | FlowBody 双模模糊 | 低 | §2.2 |
| 23-28 | 其他低优先级项 | 低/远期 | 见 v3.0 |

### 12.2 治理优先级 (v4.0 更新)

```
P0 (立即 — 工程化基础):
  1. 节点池 + ID 引用 (§2.1.1)          — 为协作、缓存、增量更新建立 O(1) 查找基础
  2. 布局缓存体系 (§2.8.4)              — 增量布局的前提
  3. Canvas 分层渲染 (§2.8.5)          — 光标/选区高频刷新不触发内容重绘

P1 (短期 — 核心体验):
  4. 命中检测体系 (§2.9)               — 统一交互基础
  5. 命令事务与合并 (§11.2)            — 撤销体验
  6. 选区模型增强 (§11.1)              — 跨段落/表格选区
  7. EditorRuntimeState + Command 体系  — 架构基础

P2 (中期 — 场景支撑):
  8. 表格模型增强 (§2.1.2)             — 医疗表格场景
  9. InputComposer (§11.3)             — IME 兼容
  10. 插件生命周期 (§11.4)             — 扩展性
  11. 语义化版本 (§11.5)              — 线上兼容

P3 (远期):
  12. 大文档虚拟化 + 内存管理 (§11.6)
  13. 测试体系 (§11.7)
  14. 打印一致性 + 错误降级 (§11.8-11.9)
```
