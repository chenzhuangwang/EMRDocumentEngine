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
│  │  │  Command System                         │  │  │
│  │  │  ICommand → InsertText | DeleteText | FormatText   │  │  │
│  │  │           | InsertElement | ModifyElement | ...    │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Layout Engines                                    │  │  │
│  │  │  TextMeasurer | LineBreaker | PageBreaker          │  │  │
│  │  │  + IncrementalLayout (局部增量布局           │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Render Pipeline                                   │  │  │
│  │  │  Draw → IParticle[] → Canvas (增量渲染      │  │  │
│  │  │  TextParticle | ImageParticle | TableParticle      │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Interaction Layer (拆分重构后               │  │  │
│  │  │  EventBus → MouseHandler | KeyboardHandler         │  │  │
│  │  │           | IMEHandler | ClipboardHandler           │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  State Layer                                       │  │  │
│  │  │  CoordinateSystem | UndoRedoStack | TreePath       │  │  │
│  │  ├────────────────────────────────────────────────────┤  │  │
│  │  │  Document Model (ModelD)                           │  │  │
│  │  │  DocumentTree → Page[] → FlowBody → BlockNode[]    │  │  │
│  │  │  + ElementFormatter (工厂/遍历/快照)               │  │  │
│  │  │  + ModelValidator (校验器                   │  │  │
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

| 维度       | ModelA        | ModelD || ModelD                      |
| ---------- | ------------------- | --------------------- | -------------------------------------- |
| 文档模型   | 扁平 `IElement[]` | 树形 `DocumentTree` | 树形 + metadata 扩展                   |
| 运行时状态 | 散落 Draw.ts        | 散落 Draw.ts          | **独立 EditorRuntimeState**      |
| 编辑驱动   | 内联方法调用        | 内联方法调用          | **Command 命令模式**             |
| 撤销/重做  | HistoryManager      | 内联 JSON 快照        | **UndoRedoStack + Command 增量** |
| 光标定位   | 数组下标            | treePath (pi,bi,ii)   | **ID 链路路径 string[]**         |
| 坐标系统   | 多处重复换算        | 多处重复换算          | **统一 CoordinateSystem**        |
| 粒子渲染   | 无统一接口          | 无统一接口            | **IParticle 统一接口**           |
| 布局渲染   | 全量重算            | 全量重算              | **增量布局 + 增量渲染**          |
| 模型校验   | 无                  | 无                    | **ModelValidator + JSON Schema** |

## 2. 前端架构设计

### 2.1 文档数据模型 

// 

1. **存储去分页化**: `DocumentTree` 不再包含 `pages: Page[]`，改为单一 `body: FlowBody`。分页是布局引擎运行时输出（SLIFPage[]），不进入存储模型。此变更从根本上解决"插入文字后跨 Page 搬运节点"的架构级矛盾。
2. **children 全部 ID 化**: 所有 `children` 字段直接从 `BaseNode[]` 改为 `string[]`，一步到位，不存在引用→ID 的过渡期。
3. **分级版本号**: NodePool 使用 `structureVersion`（增删节点 +1）+ `nodeVersions: Map<string, number>`（节点内容/样式变更时单独 +1），LayoutCache 按节点版本比对。与 §27.1 InvalidationScope 对齐。
4. **路径体系统一**: 废弃 `TreePath = TreePathItem[]`（下标索引），全局统一使用 `string[]`（ID 链路）。insertAt/removeAt 签名全部改为 ID 路径。
5. **补齐 ImageNode**: BlockNode 增加 ImageNode 类型。MinIO 上传链路 + EditorSecurityConfig 权限串联。
6. **dataType 补 S2 + privacy 脱敏链路**: ElementFormat.dataType 增加 `'S2'`（枚举型）；ElementMeta.privacy 增加 `maskChar` 字段，渲染层按用户权限脱敏。

```typescript
// ================================================================
// 节点类型标识
// ================================================================
const NodeType = {
  DOCUMENT: 'document', PARAGRAPH: 'paragraph', TABLE: 'table',
  ROW: 'row', CELL: 'cell', TEXT: 'text', SMART_TEXT: 'smarttext',
  IMAGE: 'image',   
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
  dictionary?: string   // 字典/码表 ID (v10.0: 需要关联 'S2' 枚举值校验)
}
interface ElementMeta {
  code: ElementCode; name: string; labels?: string[]
  format?: ElementFormat; required?: boolean
  readonly?: boolean
  /** 隐私脱敏  */
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
type InlineNode = TextNode | SmartTextNode | ImageNode

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
type BlockNode = Paragraph | Table | ImageNode

interface FlowBody { mode: 'flow'; children: string[] }  // BlockNode ID[]
// 移除 PageBody = BlockNode[] | FlowBody union, 根除双模防御成本

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
  /** 唯一正文 (v10.0: 替代 pages: Page[]) */
  body: FlowBody
  /** 页眉/页脚 — 布局引擎在每页渲染时引用 */
  header?: BlockNode[]; footer?: BlockNode[]
  metadata?: Record<string, unknown>
}
// pages: Page[] 降级为布局引擎输出 (SLIFPage[])
// 存储层不再包含 Page 概念

const DEFAULT_PAGE_SETUP: PageSetup = {
  width: 794, height: 1123,
  marginTop: 72, marginBottom: 72, marginLeft: 90, marginRight: 90,
  orientation: 'portrait',
}

// ================================================================
// NodePool — 一步到位 string[] 子节点 + 分级版本号 
// ================================================================
class NodePool {
  nodes = new Map<string, BaseNode>()
  private _structureVersion = 0           // 增删节点时 ++
  private _nodeVersions = new Map<string, number>()  // 节点内容/样式变更时单独 ++

  get structureVersion(): number { return this._structureVersion }
  getNodeVersion(nodeId: string): number { return this._nodeVersions.get(nodeId) ?? 0 }

  insertChild(parentId: string, childId: string, index: number): void {
    const parent = this.nodes.get(parentId)
    if (!parent) throw new Error(`Parent ${parentId} not found`)
    const children = (parent as any).children as string[]
    children.splice(index, 0, childId)
    this._structureVersion++
  }

  removeChild(parentId: string, index: number): string {
    const parent = this.nodes.get(parentId)
    if (!parent) throw new Error(`Parent ${parentId} not found`)
    const children = (parent as any).children as string[]
    const removedId = children.splice(index, 1)[0]
    // 级联收集后代 ID (修复孤儿泄漏)
    const descendantIds = this.collectDescendants(removedId)
    for (const id of descendantIds) { this.nodes.delete(id); this._nodeVersions.delete(id) }
    this._structureVersion++
    return removedId
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

  updateNode(nodeId: string, changes: Partial<BaseNode>): void {
    const node = this.nodes.get(nodeId)
    if (node) {
      Object.assign(node, changes)
      this._nodeVersions.set(nodeId, (this._nodeVersions.get(nodeId) ?? 0) + 1)
    }
  }

  getChildren(parentId: string): readonly string[] { return (this.nodes.get(parentId) as any)?.children ?? [] }
}

// buildNodePool 直接基于 string[] children 构建，无引用共享问题
function buildNodePool(tree: DocumentTree): NodePool {
  const pool = new NodePool()
  const collect = (node: BaseNode) => {
    pool.nodes.set(node.id, node)
    if ('children' in node) {
      for (const childId of (node as any).children as string[]) {
        const child = pool.nodes.get(childId) // children 已是 ID, 需要外部保证节点已注册
        if (child) collect(child)
      }
    }
  }
  collect(tree)
  return pool
}

// ================================================================
//   树遍历 — 基于 NodePool (废弃递归对象遍历)
// ================================================================
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

// 废弃: TreePath, TreePathItem, traverse() (递归对象版), insertAt/removeAt(下标版)
// 统一: ID 链路 string[] + NodePool 驱动遍历
```

### 2.2 隐私脱敏渲染链路 

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

### 2.3 移除 FlowBody 双模 

```
v10.0 直接删除 PageBody = BlockNode[] | FlowBody union。
所有 header/footer 从 BlockNode[] 改为 Paragraph[] | Table[] | ImageNode[]（类型明确）。
所有代码中 getBodyBlocks() 防御调用移除。
旧数据 upgrader: wrapArrayToFlowBody() (v3.0→v4.0 breaking upgrader 中执行)
```

### 2.2 节点工厂与树操作 

//  移除 createPage/createFlowBody/flowBodyToArray/arrayToFlowBody/getBodyBlocks——存储模型去分页化后不再需要。PageBreaker 输出 SLIFPage[] 为布局产物，非存储结构。

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

### 2.4 字体与文本度量体系 

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

### 2.4.6 增量分页算法

**问题**: §27.1 规定"文本内容变更 → 后续页面分页结果全部失效"，每敲一字触发 O(n) 重分页，与 "连续打字 >55fps" 指标直接矛盾。

**方案**: PageStartTable + 早停机制。

```typescript
/**
 * PageStartTable — 每页的断点快照
 * 编辑后从脏区所在页起向后增量重排，遇到断点一致的页即终止（早停）。
 * 百页文档单字符编辑的重排范围收敛到 1~2 页。
 */
interface PageStartEntry {
  pageIndex: number
  /** 该页第一个 BlockNode 的 ID (flowBody.children 中的索引) */
  startBlockId: string
  /** 该页第一行的行号 (在 startBlockId 段落内的行偏移) */
  startLineOffset: number
  /** 该页的累计内容高度 (用于快速计算后续页面偏移) */
  cumulativeHeight: number
}

class PageStartTable {
  private entries: PageStartEntry[] = []

  /** 全量构建 (初次分页时) */
  build(pages: SLIFPage[]): void {
    this.entries = pages.map(p => ({
      pageIndex: p.pageIndex,
      startBlockId: p.items[0]?.nodeId ?? '',
      startLineOffset: 0,
      cumulativeHeight: pages.slice(0, p.pageIndex).reduce((h, pg) => h + pg.height, 0),
    }))
  }

  /**
   * 增量重分页 — 仅重排脏区所在页起的内容
   *
   * @returns 更新后的 SLIFPage[] + 新的 PageStartTable 快照
   */
  incrementalRepaginate(
    dirtyBlockId: string,           // 脏 BlockNode ID
    currentPages: SLIFPage[],
    oldTable: PageStartTable,
    flowBody: FlowBody,
    pageSetup: PageSetup,
  ): { pages: SLIFPage[]; newTable: PageStartTable } {
    // 1. 找到脏 BlockNode 所在的页
    const dirtyPageIndex = this.findPageOfBlock(dirtyBlockId, oldTable)
    if (dirtyPageIndex < 0) return { pages: currentPages, newTable: oldTable }

    // 2. 从该页的起始断点重新排，向后流动
    const stableFrom = oldTable.entries[dirtyPageIndex]
    const newPages: SLIFPage[] = currentPages.slice(0, dirtyPageIndex)

    // 3. 从 stableFrom.startBlockId 起，按 pageSetup 重新分页
    let currentBlockIdx = flowBody.children.indexOf(stableFrom.startBlockId)
    let remainingHeight = pageSetup.height - pageSetup.marginTop - pageSetup.marginBottom
    let currentPage: SLIFPage = { pageIndex: dirtyPageIndex, width: pageSetup.width, height: pageSetup.height, items: [] }

    for (let i = currentBlockIdx; i < flowBody.children.length; i++) {
      const blockId = flowBody.children[i]
      const block = pool.nodes.get(blockId)!
      const blockHeight = this.measureBlockHeight(block, pageSetup)

      if (blockHeight > remainingHeight && currentPage.items.length > 0) {
        // 分页
        newPages.push(currentPage)
        currentPage = { pageIndex: newPages.length, width: pageSetup.width, height: pageSetup.height, items: [] }
        remainingHeight = pageSetup.height - pageSetup.marginTop - pageSetup.marginBottom
        // 表格跨页: 表头重复 (repeatHeader)
        if (block.type === 'table' && (block as Table).pageBreak?.repeatHeader) {
          // 在新页顶部插入表头行
        }
      }

      currentPage.items.push(...this.layoutBlock(block, pageSetup))
      remainingHeight -= blockHeight
    }
    if (currentPage.items.length > 0) newPages.push(currentPage)

    // 4. 早停检查: 从 dirtyPageIndex 起与旧表逐页比对
    const newTable = new PageStartTable(); newTable.build(newPages)
    const divergedCount = newPages.length - oldTable.entries.length
    // 实际重排页数 = divergedCount (通常 1~2 页)

    return { pages: newPages, newTable }
  }

  private findPageOfBlock(blockId: string, table: PageStartTable): number {
    // 二分查找 blockId 所在页
    for (let i = table.entries.length - 1; i >= 0; i--) {
      if (table.entries[i].startBlockId <= blockId) return i
    }
    return 0
  }
}
```

### 2.4.7 行高统一收口

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
 * 字体未就绪期间: 禁止进入编辑态 (§19 策略)，禁止布局计算。
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

### 2.4.8 LineBreaker 契约重定义

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

### 2.4.9 测量缓存与字体检测修正

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

### 2.5 EditorRuntimeState — 运行时状态模型 

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
// ================================================================
// 光标 — 统一两层位置模型 
// ================================================================
interface CursorState {
  /**
   * 段落定位: ID 链路路径，最后一个 ID 始终指向 Paragraph 节点
   * 示例: ['doc_1', 'para_3'] 表示 DocumentTree → body.children[0] → para_3
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

class NodePool {
  /** 字符偏移 → (textNodeId, localOffset)。全文档唯一合法的 offset 解析入口。 */
  resolveCharOffset(paragraphId: string, charOffset: number): { textNodeId: string; localOffset: number } | null {
    const para = this.nodes.get(paragraphId) as any
    if (!para) return null
    let remaining = charOffset
    for (const childId of para.children) {
      const node = this.nodes.get(childId)
      if (node?.type === 'text') { const len = (node as any).text.length; if (remaining <= len) return { textNodeId: childId, localOffset: remaining }; remaining -= len }
      else { if (remaining <= 1) return { textNodeId: childId, localOffset: Math.min(remaining, 1) }; remaining -= 1 }
    }
    return null
  }
  getCharOffset(paragraphId: string, textNodeId: string, localOffset: number): number {
    const para = this.nodes.get(paragraphId) as any; let offset = 0
    for (const childId of para.children) { if (childId === textNodeId) return offset + localOffset; const node = this.nodes.get(childId); if (node?.type === 'text') offset += (node as any).text.length; else offset += 1 }
    return offset
  }
}

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

### 2.6 Command 命令体系 



1. **Run 模型**: TextNode.text 存连续同样式文本（非单字符），InsertTextCommand 做字符串插入 + 相邻同样式合并
2. **invert 契约**: `invert(document: DocumentTree): ICommand` — 传入当前文档现场，不依赖实例状态
3. **不可变**: MergeableCommand.merge() 返回新命令，不 mutate 入栈命令
4. **合并 vs 事务边界**: 500ms 自动合并仅 InsertTextCommand/DeleteRangeCommand；事务 API 仅 UI 宏操作
5. **旧栈废弃**: UndoRedoStack（快照版）@deprecated，Ctrl+Z 由 CommandManager 仲裁

#### 2.6.1 Run 模型文本存储

```typescript
// TextNode.text 存储连续同样式文本（非单字符）
// 文档 "Hello World"（均为默认样式）→ 1 个 TextNode { text: "Hello World" }
// 文档 "Hello **World**"（World 加粗）→ 2 个 TextNode: { text: "Hello " }, { text: "World", bold: true }
// 节点数从 O(字符) 降到 O(样式段)

class InsertTextCommand extends PositionalCommand {
  readonly type = 'insert-text'

  forward(doc: DocumentTree, pool: NodePool): StatePatch {
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph
    if (!para) return null

    // 1. 检查 offset 位置的左右相邻节点，若同样式则合并
    const left = offset > 0 ? pool.nodes.get(para.children[offset - 1]) as TextNode : null
    const right = offset < para.children.length ? pool.nodes.get(para.children[offset]) as TextNode : null
    const style = this.style ?? { font: 'SimSun', size: 16 }

    if (left && left.type === 'text' && sameStyle(left, style)) {
      // 左边同为 TextNode 且样式一致 → 直接追加到 text
      pool.updateNode(left.id, { text: left.text + this.text })
      return { cursor: { path: this.path, offset: this.offset } }
    }
    if (right && right.type === 'text' && sameStyle(right, style)) {
      // 右边同为 TextNode 且样式一致 → 前插到 text
      pool.updateNode(right.id, { text: this.text + right.text })
      return { cursor: { path: this.path, offset: this.offset + [...this.text].length } }
    }
    // 否则创建新 TextNode
    const newNode = createTextNode(this.text, style)
    pool.nodes.set(newNode.id, newNode)
    pool.insertChild(para.id, newNode.id, offset)
    return { cursor: { path: this.path, offset: this.offset + [...this.text].length } }
  }

  invert(doc: DocumentTree, pool: NodePool): ICommand {
    return new DeleteRangeCommand(generateId(), Date.now(), this.author, this.path, this.offset, this.offset + [...this.text].length)
  }

  serialize(): SerializedCommand {
    return { type: 'insert-text', id: this.id, timestamp: this.timestamp, author: this.author,
             path: this.path, offset: this.offset, text: this.text, style: this.style }
  }
}

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return a.font === b.font && a.size === b.size && a.bold === b.bold && a.italic === b.italic
      && a.color === b.color && a.underline === b.underline && a.strikeout === b.strikeout
}

/** 每次编辑后调用，合并相邻同样式 TextNode */
function normalizeParagraph(para: Paragraph, pool: NodePool): void {
  const merged: string[] = []
  let prev: TextNode | null = null
  for (const childId of para.children) {
    const node = pool.nodes.get(childId)
    if (node?.type === 'text' && prev && sameStyle(prev, node as TextNode)) {
      pool.updateNode(prev.id, { text: prev.text + (node as TextNode).text })
      pool.removeChild(para.id, para.children.indexOf(childId))  // 删除重复节点
    } else {
      merged.push(childId)
      prev = node?.type === 'text' ? node as TextNode : null
    }
  }
}
```

#### 2.6.2 invert 契约修正

```typescript
interface ICommand {
  readonly type: string; readonly id: string
  readonly timestamp: number; readonly author: string
  forward(document: DocumentTree, pool: NodePool): StatePatch | null
  /** v13.0: 传入当前文档现场，逆操作从文档中提取数据，不依赖实例状态 */
  invert(document: DocumentTree, pool: NodePool): ICommand
  serialize(): SerializedCommand
}

class DeleteRangeCommand extends PositionalCommand {
  readonly type = 'delete-range'

  forward(doc: DocumentTree, pool: NodePool): StatePatch {
    const para = pool.nodes.get(this.path[this.path.length - 1]) as Paragraph
    if (!para) return null
    // forward 不保留 deletedNodes 状态
    const count = this.endOffset - this.startOffset
    for (let i = 0; i < count; i++) pool.removeChild(para.id, this.startOffset)
    return { cursor: { path: this.path, offset: this.startOffset } }
  }

  invert(doc: DocumentTree, pool: NodePool): ICommand {
    // 逆操作: 在当前位置插入被删内容 → 构造 InsertTextCommand
    // 由于 forward 已删除，invert 时文档已无源数据 → serialize 内嵌
    // v13.0: 选择 "快照+增量混合"——序列化载荷内嵌被删文本
    return new InsertTextCommand(generateId(), Date.now(), this.author, this.path, this.startOffset, this.deletedText)
  }

  serialize(): SerializedCommand {
    return { type: 'delete-range', id: this.id, timestamp: this.timestamp, author: this.author,
             path: this.path, startOffset: this.startOffset, endOffset: this.endOffset,
             deletedText: this.deletedText }  // 内嵌被删文本，协作端可重放
  }
}
```

#### 2.6.3 合并与事务边界

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

  execute(command: ICommand, doc: DocumentTree, pool: NodePool): StatePatch | null {
    // 尝试合并
    const last = this.undoStack[this.undoStack.length - 1]
    if (last && this.canMerge(last, command)) {
      const merged = (last as MergeableCommand).mergeWith(command)
      this.undoStack[this.undoStack.length - 1] = merged  // 替换栈顶（栈本身可变，命令不可变）
    } else {
      this.undoStack.push(command)
    }
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift()
    this.redoStack = []
    return command.forward(doc, pool)
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

#### 2.6.4 Command 子系统类图

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
│    → cmd.forward(doc, pool)                               │
│    → undoStack.execute(cmd)                               │
│    → dirtyTracker.mark(...)                               │
│    → eventBus.emit('document:changed')                    │
│  undo(): void                                             │
│    → undoStack.undo(doc, pool)  // 走新栈                  │
│    → eventBus.emit('render:request')                      │
│  redo(): void  // 同上                                    │
└──────────────────────────────────────────────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
  Handler 构造命令   EventBus 通知 Draw 重绘
  (不触碰栈)        (不触碰栈)

// 旧快照栈: @deprecated, 仅迁移期兜底
// Ctrl+Z 入口: CommandManager.undo() → 新栈非空走新栈, 新栈空才 fallback 旧栈
```

### 2.7 Particle 统一渲染接口 

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

### 2.8 全局坐标系统 

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

// v12.0: 删除全局单例, CoordinateSystem 由 Editor 构造注入 (实例私有)
```

### 2.9 渲染管道 

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

### 布局失效传播规则

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

// DirtyTracker 根据 InvalidationScope 标记脏区:
//   'paragraph_and_downstream' → markParagraphDirty + markDownstreamOffsetDirty
//   'flowbody' → markFullLayout
```

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

#### 2.9.5 Canvas 分层渲染 

**v12.0 修正**:

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

  // ---- 尺寸管理 (v12.0: 虚拟化渲染窗口) ----
  syncSizes(viewportW: number, viewportH: number, dpr: number, pageHeight: number, totalPages: number): void {
    this.viewportW = viewportW; this.viewportH = viewportH
    // Canvas 物理尺寸 = 视口 + overscan 1 页 (而非全文档)
    const pagesInView = Math.ceil(viewportH / pageHeight) + this.OVERSCAN_PAGES * 2
    const canvasH = Math.min(pagesInView * pageHeight, totalPages * pageHeight)
    // 内存: 3 层 × viewportW × canvasH × 4B × DPR²
    // 例: 3 × 794 × (3×1123) × 4 × 4 ≈ 128MB @ DPR2, 2 页视口 → 实际 ~60MB
    for (const key of ['static', 'content', 'interact'] as const) {
      this.layers[key]!.width  = Math.ceil(viewportW * dpr)
      this.layers[key]!.height = Math.ceil(canvasH * dpr)
      this.layers[key]!.style.width  = `${viewportW}px`
      this.layers[key]!.style.height = `${canvasH}px`
    }
  }

  /** 滚动时平移绘制偏移 (v12.0: 不扩大画布，只改 ctx 偏移) */
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

  // ---- 水印离屏预渲染  ----
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

  // ---- 交互层光标 (v12.0: 统一 setInterval) ----
  startCursorBlink(): void {
    let visible = true
    this.blinkTimer = window.setInterval(() => {
      visible = !visible
      const ctx = this.ctxs.interact!
      ctx.clearRect(0, 0, this.layers.interact!.width, this.layers.interact!.height)
      if (visible) this.drawCursor(ctx)
      this.drawSelection(ctx)
      this.drawComposingText(ctx)
    }, 530)
  }

  // ---- 增量渲染帧调度  ----
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

#### 2.9.6 CoordinateSystem 实例化 

```typescript
// v12.0: 删除全局单例 const coordinateSystem = new CoordinateSystem(...)
// 改为 Editor 构造注入，每个实例独立

class CoordinateSystem {
  // ... (方法不变: docToCanvas/screenToDoc/docToScreen/getCanvasTransform)
}

// Editor 构造:
class Editor {
  private coordSystem: CoordinateSystem  // 实例私有
  constructor(config: EditorConfig) {
    this.coordSystem = new CoordinateSystem(config.container.ownerDocument.defaultView!.devicePixelRatio || 1)
    this.renderer = new LayeredRenderer(this.coordSystem)  // 注入
  }
}
```

#### 2.9.7 层模型统一 

架构文档与 UI 文档统一为 3 层:

| 架构层   | UI 组件树映射                                  | 职责                                     |
| -------- | ---------------------------------------------- | ---------------------------------------- |
| static   | PageFrame                                      | 页面背景/阴影/边距线/页眉/页脚/页码/水印 |
| content  | ContentLayer                                   | 文本/表格/SmartTextNode/ImageNode        |
| interact | CursorLayer + SelectionLayer + AnnotationLayer | 光标/选区高亮/IME 预览/批注指示          |

### 2.10 命中检测体系 

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

#### 2.8.4 布局缓存体系 

**问题**: PageItem 是每次 `recomputeLayout()` 的临时产物，全量重算。增量布局的前提是「每个节点的布局结果可独立缓存、可单独失效」，当前完全没有缓存设计。

**方案**: 建立三级布局缓存，缓存键 = 节点 ID，通过 NodePool.version 判断失效。
--------------------------------------------------------------------------

### 2.11 Draw.ts 拆分边界方案 

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

| 模块                       | 职责                                                                       | 监听                            | 发出                                                                            |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| **MouseHandler**     | mousedown/mousemove/mouseup → 光标定位/选区拖拽/点击 SmartTextNode        | DOM mouse events                | `cursor:moved`, `selection:changed`, `render:request`                     |
| **KeyboardHandler**  | keydown → 可见字符/导航/删除/快捷键 → 构建 Command                       | DOM keydown                     | 委托 `CommandManager.execute()`                                               |
| **IMEHandler**       | 管理隐藏 textarea → compositionstart/update/end → 构造 InsertTextCommand | textarea composition events     | `render:request` (预览), `CommandManager.execute()` (确认)                  |
| **ClipboardHandler** | copy/cut/paste → 文本提取/Command 构建                                    | textarea paste, window copy/cut | `CommandManager.execute()` (paste 时)                                         |
| **CommandManager**   | 接收 Command → forward(doc) → StatePatch → DirtyTracker → emit 事件    | 所有 Handler 调用               | `document:changed`, `state:changed`, `layout:changed`, `render:request` |

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

### 2.12 权限优先级规则 

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

### 3.0 后端修正总览 

**v14.0 修正**:

1. **RBAC 用户体系**: 补 t_user + t_role + t_user_role 最小模型，JWT role/level claims
2. **WebSocket**: MVP 单实例 + sticky session，Nginx ip_hash
3. **并发锁**: Redis SET NX EX 30s 心跳续期，409 三选一 UI
4. **加密**: 字段级 AES-GCM（仅 privacy=true 的 SmartTextNode.text），content 整体不加密
5. **localStorage**: 最近一次 + 超 2MB 跳过告警
6. **PDF 许可证**: 选型改为 OpenPDF (LGPL/MPL) / Apache PDFBox (Apache 2.0)
7. **可用性**: MVP 99.5% 单点，生产 99.9% (MySQL 主从 + Redis Sentinel)

### 3.1 RBAC 用户模型

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

### 3.2 并发编辑锁

```sql
-- Redis: SET doc_lock:{documentId} {userId} NX EX 30
-- 心跳: 前端每 15s PUT /api/v1/documents/{id}/lock/heartbeat 续期 30s
-- 释放: 正常关闭/401/页面卸载时 DELETE lock key

CREATE TABLE t_document_lock (
    document_id VARCHAR(64) PRIMARY KEY,
    user_id     VARCHAR(64) NOT NULL,
    locked_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL
);
-- 持久化备份 (Redis 重启后恢复)
```

**409 冲突前端三选一**:

```
获取锁失败 → 返回 { status: 'locked', lockedBy: '张三', serverVersion: 6, lockedSince: '...' }
前端展示:
  [查看差异] — 展示 baseVersion..serverVersion 的 diff
  [强制覆盖] — 用户确认后 PUT，替换锁持有者
  [取消]     — 保留我的编辑，暂不保存
```

### 3.3 字段级加密

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

### 3.4 PDF 许可证与选型

| 库            | 许可证     | 选择                          |
| ------------- | ---------- | ----------------------------- |
| Apache PDFBox | Apache 2.0 | **推荐** (PDF 生成首选) |
| OpenPDF       | LGPL/MPL   | 备选 (iText 4 fork)           |
| suwell/ofdrw  | Apache 2.0 | OFD 生成专用                  |

### 3.5 可用性分级

| 等级    | 拓扑                                                            | 目标  | 阶段   |
| ------- | --------------------------------------------------------------- | ----- | ------ |
| MVP     | 单 MySQL + 单 Redis + 单 App                                    | 99.5% | 当前   |
| 生产    | MySQL 主从 + Redis Sentinel + App ×2 + Nginx                   | 99.9% | 联调后 |
| RPO/RTO | MVP: RPO=0 (无主从, 依赖备份), RTO=4h; 生产: RPO<1min, RTO<5min |       |        |

### 3.6 localStorage 配额

```typescript
// 只存最近一次备份 + 超 2MB 跳过
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
        // 清理旧备份后重试一次
        this.clearOldBackups()
        try { localStorage.setItem(`doc_backup_${document.id}`, json) } catch {}
      }
    }
  }
}
// 自动保存指标拆分:
//   IndexedDB 落盘: <50ms (同步, 不依赖网络)
//   API 异步完成: 不阻塞 UI (fire-and-forget, 失败静默重试)
```

### 3.7 审计 diff 策略

```
审计日志 detail 字段: 不存完整新旧值 diff
  存储: { action, changedFields: ['title','body'], versionFrom: 5, versionTo: 6, sizeBytes: 12345 }
  完整快照: t_document_version 表已有版本内容存储
  成本: 审计日志单条 < 1KB, 100 万条 < 1GB
```

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

### 3.2 数据库设计 — 乐观锁与审计日志

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
-- 文档权限表 — 文档粒度权限
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
-- 操作审计日志表 
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

### 3.3 REST API 设计 

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

| 类别     | 技术                       | 版本   |
| -------- | -------------------------- | ------ |
| JDK      | Java                       | 17 LTS |
| 框架     | SpringBoot                 | 3.3+   |
| ORM      | Mybatis-Plus               | 3.5+   |
| 数据库   | MySQL                      | 8.0+   |
| 缓存     | Redis                      | 7.x    |
| 实时通信 | Spring WebSocket + Stomp   | -      |
| 安全     | Spring Security + JWT      | -      |
| 文档转换 | iText 8 (PDF) + Apache POI | latest |
| 模板引擎 | Thymeleaf (HTML 导出)      | -      |
| 对象存储 | MinIO                      | latest |
| API 文档 | SpringDoc OpenAPI          | 2.5+   |
| 构建     | Maven                      | 3.9+   |

### 3.5 模型校验与版本兼容 

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

  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'DocumentTree 必须是对象', code: 'invalid_type' }], modelVersion: '4.0' }
  }

  const d = doc as Record<string, unknown>
  if (!d.id || typeof d.id !== 'string') errors.push({ path: 'id', message: '缺少有效的 id', code: 'missing_field' })
  // 校验 body 而非 pages
  if (!d.body || typeof d.body !== 'object') errors.push({ path: 'body', message: 'body 必须是 FlowBody 对象', code: 'invalid_type' })
  else {
    const body = d.body as Record<string, unknown>
    if (body.mode !== 'flow') errors.push({ path: 'body.mode', message: 'body.mode 必须为 "flow"', code: 'invalid_value' })
    if (!Array.isArray(body.children)) errors.push({ path: 'body.children', message: 'body.children 必须是数组', code: 'invalid_type' })
  }

  // 递归校验节点 ID 唯一性 (通过 NodePool)
  const idSet = new Set<string>()
  if (d.body) {
    const collectIds = (node: unknown) => {
      if (node && typeof node === 'object' && 'id' in node) {
        const n = node as Record<string, unknown>
        if (typeof n.id !== 'string') errors.push({ path: '', message: `节点 id 必须为 string`, code: 'invalid_type' })
        else if (idSet.has(n.id)) errors.push({ path: '', message: `重复的节点 ID: ${n.id}`, code: 'invalid_value' })
        else idSet.add(n.id)
      }
      if (Array.isArray((node as any)?.children)) {
        for (const child of (node as any).children) {
          if (typeof child === 'string') {
            // children 是 ID 数组, 跳过
          } else {
            collectIds(child)  // 嵌套对象 (反序列化后的临时状态)
          }
        }
      }
    }
    collectIds(d)
  }

  const result = { valid: errors.length === 0, errors, modelVersion: '4.0' }
  return result
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

#### 3.5.3 modelVersion 版本兼容策略 (删除 ensureLatestModel 错误实现, 仅保留 loadDocument 一套算法)

```typescript
// 唯一升级入口 — loadDocument (与 §20 语义化版本规则一致)
function loadDocument(json: string): DocumentTree {
  const parsed = JSON.parse(json)
  const version = parsed.metadata?.modelVersion || '2.0.0'
  let doc = parsed as DocumentTree
  for (const upgrader of upgraders) {
    if (compareVersions(version, upgrader.from) >= 0 && compareVersions(version, upgrader.to) < 0) {
      doc = upgrader.upgrade(doc)
      doc.metadata!.modelVersion = upgrader.to  // 关键: 每次升级后更新 currentVersion
    }
  }
  const result = validateDocumentTree(doc)
  if (!result.valid) throw new DocumentValidationError(result.errors)
  return doc
}
// 黄金测试: v2.0→v3.0→v4.0 链式升级后 modelVersion === '4.0.0'
```

## 4. 数据流设计

### 4.1 编辑数据流 

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

### 4.2 保存数据流 

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

### 4.3 协作数据流 (v16.0 决策)

**v16.0 决策**: 采用 **Yjs (CRDT)** 作为单一真相源。

- Y.Doc 为运行时模型，DocumentTree 仅为快照序列化格式（保存/加载时转换）
- NodePool 作为 Y.Doc → DocumentTree 的只读投影层，对外暴露不变更 Y.Doc 的视图
- ~~Command.serialize 重放 (OT)~~ — **删除**，CRDT 与 OT 互斥，Yjs 自动合并替代命令重放
- 迁移成本: 需将 NodePool 改为从 Y.Doc 同步数据（单向），不反向写入

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

## 6. 从当前代码到目标架构的迁移路径 

当前代码 (`Draw.ts` 709行单体) 到 目标架构的渐进迁移策略：

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

## 7. 安全设计 

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
- WebSocket 认证 (JWT 通过 Sec-WebSocket-Protocol 子协议或首帧 AUTH 报文，禁止 URL query)
- 乐观锁版本冲突检测 (防止并发覆盖)
- 全链路审计日志 (API 层拦截器自动记录)

## 8. 非功能需求 

### 7.1 性能指标

| 指标                 | MVP 目标 | 最终目标       | 测量方法              |
| -------------------- | -------- | -------------- | --------------------- |
| 首次内容绘制 (FCP)   | < 1.5s   | < 1s           | Lighthouse            |
| 10 页文档加载        | < 1s     | < 500ms        | Performance API       |
| 100 页文档分页计算   | < 3s     | < 1s           | PageBreaker bench     |
| 单次编辑响应延迟     | < 50ms   | < 16ms (60fps) | requestAnimationFrame |
| 连续打字帧率         | > 30fps  | > 55fps        | rAF 计数器            |
| 自动保存响应         | < 200ms  | < 100ms        | API 计时              |
| IndexedDB 写入       | < 50ms   | < 20ms         | Performance API       |
| 内存占用 (10 页文档) | < 50MB   | < 30MB         | Chrome DevTools       |

### 7.2 浏览器兼容性

| 浏览器       | 最低版本       | 备注                                      |
| ------------ | -------------- | ----------------------------------------- |
| Chrome       | 90+            | 主要开发和测试环境                        |
| Edge         | 90+            | Chromium 内核，兼容 Chrome                |
| Firefox      | 90+            | 需额外测试 IME 兼容性                     |
| Safari       | 15+            | macOS 需额外测 Canvas 和 IME              |
| 移动端浏览器 | 不保证编辑功能 | 只读查看可用, 编辑不支持 (v16.0 统一口径) |

### 7.3 异常降级策略

| 异常场景                 | 降级方案                                             |
| ------------------------ | ---------------------------------------------------- |
| Canvas 2D context 不可用 | 显示错误提示 "您的浏览器不支持 Canvas，请升级浏览器" |
| WebSocket 连接失败       | 降级为纯本地编辑，保存走 HTTP API，协作功能置灰      |
| IndexedDB 不可用         | 降级为 localStorage 备份，或纯远程保存               |
| API 网络超时 (3 次重试)  | 保存到 IndexedDB，显示 "网络异常，数据已本地保存"    |
| 文档 JSON 解析失败       | 显示 "文档数据损坏" + 尝试从 localStorage 恢复       |
| 单次渲染超过 100ms       | 跳过非可见区域的渲染 (虚拟滚动)                      |
| 内存超过 200MB           | 清空 TextMeasurer 缓存 + 释放非可见页的 PageItem     |

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

## 9. 打印 / 导出链路 

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

| 格式 | 实现位置       | 方案                                                      |
| ---- | -------------- | --------------------------------------------------------- |
| JSON | 前端           | `JSON.stringify(DocumentTree)` → Blob 下载             |
| PNG  | 前端           | `Canvas.toDataURL()` — 当前页 → Blob 下载             |
| PDF  | **后端** | 接收 DocumentTree JSON → iText 服务端渲染 → 返回 PDF 流 |
| HTML | **后端** | 接收 DocumentTree JSON → Thymeleaf 模板渲染 → 返回 HTML |
| TXT  | 前端或后端     | 遍历 DocumentTree 提取所有 TextNode.text → 拼接          |

### 9.3 排版一致性保障

| 风险                              | 应对                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| 前端 Canvas 渲染 ≠ 后端 PDF 渲染 | 后端 PDF 使用相同的布局参数 (PageSetup + DEFAULT_PAGE_SETUP)，由同一套布局引擎逻辑 (Java 移植) 计算 |
| 字体不一致                        | 后端嵌入 SimSun/SimHei 字体文件，前端通过 @font-face 加载相同字体                                   |
| 图片分辨率不足                    | PDF 导出时使用 2x DPR Canvas → 更高分辨率输出                                                      |

## 10. 多格式文档加载 

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

## 11. 交互与系统深化设计 

### 11.1 选区模型增强

**问题**: 当前仅定义了 `anchor/focus` 的基础结构，缺失选区标准化规则、跨块选区语义、表格选区模型。

**方案**:

```typescript
// 选区粒度 — 分层表达
type SelectionGranularity = 'character' | 'node' | 'block' | 'table'

interface SelectionState {
  anchor: CursorState; focus: CursorState; active: boolean
  /** 选区粒度  */
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
// L1: 纯函数单元测试 (无 DOM 依赖) — 覆盖率 ≥80%
// L2: node-canvas 集成测试 (TextMeasurer 需要真实 Canvas measureText) — 覆盖率 ≥60%
//    或: happy-dom + canvas mock 注入 (fake measurer 测逻辑, Playwright E2E 测真实度量)
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

## 12. 医学质控引擎 

**v15.0 修正**:

1. 规则 JSONLogic DSL 化：可入库、可热更新、TS/Java 双端执行
2. 索引驱动：单次 traverse 建 Map<HDSD, SmartTextNode[]>，所有规则共享
3. 评分 cap：单规则扣分 ≤ weight% × 1.5，通过率归一化
4. 异步 check() + 字典预取缓存
5. 统一状态机：t_document.status 唯一状态字段

### 13.1 质控规则 DSL

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

### 13.2 索引驱动质控引擎

```typescript
class QCEngine {
  private rules: QCRule[] = []
  private dictCache = new Map<string, Set<string>>()  // dictionary ID → 合法值集合
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly DEBOUNCE_MS = 1000
  private worker: Worker | null = null  // Web Worker

  /** 构建 HDSD 索引 (单次 traverse, 所有规则共享) */
  private buildIndex(doc: DocumentTree, pool: NodePool): Map<string, SmartTextNode[]> {
    const index = new Map<string, SmartTextNode[]>()
    traversePool(pool, doc.id, (node) => {
      if (node.type === 'smarttext') {
        const st = node as SmartTextNode
        const key = st.element.code.internal
        if (!index.has(key)) index.set(key, [])
        index.get(key)!.push(st)
      }
    })
    return index
  }

  /** 编辑后延迟执行 */
  scheduleCheck(doc: DocumentTree, pool: NodePool): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.check(doc, pool), this.DEBOUNCE_MS)
  }

  async check(doc: DocumentTree, pool: NodePool): Promise<QCResult> {
    const index = this.buildIndex(doc, pool)
    // JSONLogic 规则在 Web Worker 中执行 (纯函数, 可序列化)
    const findings = (await Promise.all(
      this.rules.map(rule => rule.check(doc, pool, index, this.dictCache))
    )).flat()
    return { findings, score: new QCScorer().score(findings, this.rules), timestamp: Date.now() }
  }
}

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

### 13.3 统一文档状态机

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

## 13. 节点池核心语义规则 

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

## 14. 表格模型核心规则 

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

## 15. 协作预留的位置锚定约束 

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

## 16. 核心接口契约骨架 

```typescript
// ================================================================
// 编译时强制约束 — 实现者必须遵守，调用方依赖这些契约
// ================================================================

/** ICommand — 不可变纯数据, invert 传入文档现场  */
interface ICommand {
  readonly type: string; readonly id: string; readonly timestamp: number; readonly author: string
  forward(document: DocumentTree, pool: NodePool): StatePatch | null
  invert(document: DocumentTree, pool: NodePool): ICommand
  serialize(): SerializedCommand
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

## 17. 字体加载防抖策略 

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

## 18. 模型版本向下兼容规则 

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

## 19. 布局中间格式定义 

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

## 20. SDK 集成与公共 API 边界 

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

### 7.5 可观测性 

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

### 7.6 性能指标测量规则 

| 指标             | 计时起点                          | 计时终点                                               | 测量方法                                                                                   |
| ---------------- | --------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 10 页文档加载    | `fetch()` 调用                  | `Editor` 构造完成 + 首帧渲染完成                     | `performance.measure('doc-load', 'fetch-start', 'first-render-end')`                     |
| 单次编辑响应延迟 | `keydown` 事件触发              | `requestAnimationFrame` 回调中交互层 Canvas 绘制完成 | `const t0=performance.now(); rAF(()=>{ metrics.keystrokeLatency=performance.now()-t0 })` |
| 连续打字帧率     | 同上，采样 100 次                 | 计算 100 次 keystrokeLatency 的 P95                    | 丢弃前 10 次预热，统计后 90 次                                                             |
| 100 页分页计算   | `PageBreaker.breakPages()` 调用 | `IPage[]` 返回                                       | `performance.measure('page-break', ...)`                                                 |
| 自动保存响应     | `AutoSaveManager.save()` 调用   | API 响应解析完成 (或 IndexedDB 写入完成)               | 分别计时 IndexedDB 和 API 两段                                                             |

## 21. SDK 交付基线 

### 24.1 生命周期与资源销毁契约 (P0)

```typescript
/**
 * 编辑器全生命周期 — 6 个阶段
 *
 * init → mount → ready → (pause/resume) → unmount → destroy
 *
 * 强制规则: 所有内部模块必须实现对应的清理方法，由 Editor 统一调度。
 * 禁止模块私自持有全局定时器、DOM 事件监听。
 */

interface Disposable {
  /** 释放资源: 解绑事件、清除定时器、释放 Canvas/缓存/Worker */
  dispose(): void
}

// 所有内部模块实现 Disposable:
//   FontManager.dispose()    — 释放字体缓存, 取消未完成的加载
//   TextMeasurer.dispose()   — 清除 LRU 缓存
//   LayeredRenderer.dispose()— 停止光标闪烁定时器, 移除三层 Canvas
//   EventBus.dispose()       — 清空所有监听器
//   InputComposer.dispose()  — 移除隐藏 textarea, 解绑 composition 事件
//   AutoSaveManager.dispose()— 清除防抖定时器, 关闭 IndexedDB 连接
//   CommandUndoRedoStack.dispose() — 清空历史栈
//   LayoutCache.dispose()    — 清空三级缓存

interface IEditor {
  // 生命周期钩子
  onMount(callback: () => void): () => void
  onReady(callback: () => void): () => void
  onPause(callback: () => void): () => void
  onResume(callback: () => void): () => void
  onUnmount(callback: () => void): () => void
  onDestroy(callback: () => void): () => void

  /** 暂停 — 释放非必要资源 (离开视口时调用), 可恢复 */
  pause(): void
  /** 恢复 — 重新挂载暂停时释放的资源 */
  resume(): void
  /** 销毁 — 最终清理, 不可恢复 */
  destroy(): void
}

// 使用示例 (React Tab 切换):
// tab.onHide   → editor.pause()   // 释放 Canvas, 停止光标闪烁, 保留文档数据
// tab.onShow   → editor.resume()  // 重建 Canvas, 恢复光标
// tab.onClose  → editor.destroy() // 完全销毁
```

### 24.2 标准化错误体系 (P0)

```typescript
type ErrorSeverity = 'fatal' | 'error' | 'warn'

interface EditorError {
  /** 错误码 (机器可读, 用于集成方自动处理) */
  code: EditorErrorCode
  severity: ErrorSeverity
  message: string
  cause?: Error
  timestamp: number
  /** 是否为可恢复错误 (fatal=false) */
  recoverable: boolean
}

type EditorErrorCode =
  // Fatal: 编辑器无法继续工作
  | 'E_RENDER_CONTEXT_LOST'   // Canvas 2D context 丢失
  | 'E_DOCUMENT_CORRUPTED'    // 文档结构损坏, 无法解析
  // Error: 功能降级, 不影响核心编辑
  | 'E_WASM_LOAD_FAILED'      // WASM 加载失败 → 降级 Canvas measureText
  | 'E_FONT_LOAD_FAILED'      // 字体加载失败 → 降级系统默认字体
  | 'E_SAVE_FAILED'           // 保存失败 → IndexedDB 兜底
  | 'E_LOAD_FAILED'           // 加载失败 → 尝试 localStorage 备份
  | 'E_LAYOUT_FAILED'         // 布局异常 → 降级全量重布局
  | 'E_RENDER_FAILED'         // 渲染异常 → 降级占位符
  // Warn: 不影响使用
  | 'W_PASTE_FILTERED'        // 粘贴内容被过滤
  | 'W_NODE_INCOMPATIBLE'     // 节点类型不兼容, 已跳过
  | 'W_VALIDATION_FAILED'     // 模型校验失败 (已自动修复)

/** 对外统一错误入口 */
interface IEditor {
  onError(callback: (error: EditorError) => void): () => void
}

/** 节点级错误边界 — 单个节点渲染失败不导致整份文档崩溃 */
function safeRenderParticle(particle: IParticle, layout: ParticleLayout, ctx: RenderContext): RenderRect {
  try { return particle.render(layout, ctx) }
  catch (err) {
    emitError({ code: 'E_RENDER_FAILED', severity: 'error',
                message: `Particle ${particle.particleType} render failed`, cause: err,
                timestamp: Date.now(), recoverable: true })
    return renderPlaceholder(layout, ctx)  // 红色占位框
  }
}
```

### 24.3 数据格式兼容性对外承诺 (P0)

```
对外交付承诺 — 写入对外文档和协议:

1. 向后兼容 (Forward Compatible):
   新版本编辑器 100% 能打开所有历史版本文档。
   旧数据通过 ensureLatestModel() 自动静默升级到当前版本。
   升级过程不丢失任何数据, 仅添加新字段/migrate 旧结构。

2. 向前兼容 (Backward Compatible):
   旧版本编辑器打开新版本文档:
   - JSON 序列化保留未知字段 (不掉字段)
   - 不支持的功能降级展示: SmartTextNode 渲染为只读文本, 新节点类型显示占位符
   - 降级展示的文档可编辑保存, 保存后保留未知字段 (不会因降级而丢失数据)

3. 兼容周期:
   - MAJOR 版本间兼容保证 ≥ 5 年
   - 医疗数据保存周期: 门诊 15 年, 住院 30 年, 编辑器需保证此周期内数据可读
   - 每个 MAJOR 版本提供独立的数据迁移工具, 支持离线批量转换
```

### 24.4 主题与样式定制 (P1)

```typescript
interface EditorTheme {
  // 纸张
  pageBackground: string       // 默认 #FFFFFF
  pageShadow: string           // 默认 rgba(0,0,0,0.08)
  // 页边距
  marginLineColor: string      // 默认 #E5E7EB
  // 文本
  defaultFontFamily: string    // 默认 'SimSun'
  defaultFontSize: number      // 默认 16
  defaultTextColor: string     // 默认 #000000
  // 光标
  cursorColor: string          // 默认 #3B82F6
  cursorWidth: number          // 默认 2
  // 选区
  selectionColor: string       // 默认 rgba(59,130,246,0.25)
  // 网格
  gridLineColor: string        // 默认 #E5E7EB
  // 表格
  tableBorderColor: string     // 默认 #D1D5DB
  tableHeaderBackground: string// 默认 #F3F4F6
  // 校验
  errorBorderColor: string     // 默认 #EF4444
  warningBorderColor: string   // 默认 #F59E0B
  // 水印
  watermarkColor: string       // 默认 #000000
  watermarkOpacity: number     // 默认 0.08
}

// 内置预设
const THEMES = {
  standard: { /* 标准病历模式 */ },
  eyeCare:  { pageBackground: '#F5F0E8', defaultFontSize: 18 /* 护眼模式 */ },
  print:    { pageBackground: '#FFFFFF', pageShadow: 'none', cursorColor: 'transparent' },
  dark:     { pageBackground: '#1F2937', defaultTextColor: '#E5E7EB', /* ... */ },
}

interface IEditor {
  setTheme(theme: Partial<EditorTheme>): void
  getTheme(): EditorTheme
  resetTheme(): void  // 恢复默认
}
```

### 24.5 性能分级与可配置阈值 (P1)

```typescript
interface EditorPerformanceConfig {
  maxUndoDepth: number          // 默认 100, 范围 10-500
  maxNodeCount: number          // 默认 50000, 超出触发虚拟滚动
  fontCacheSize: number         // 默认 2000
  incrementalRenderThreshold: number // 默认 50 (节点数), 超过此值触发增量渲染
  virtualScrollThreshold: number    // 默认 10 (页), 超过此值触发虚拟滚动
  renderPrecision: 'high' | 'normal' | 'low'  // 渲染精度
}

// 三级模式预设
const PERFORMANCE_MODES = {
  quality: {  // 医生工作站: 全开 WASM, 高精度渲染
    maxUndoDepth: 200, renderPrecision: 'high', virtualScrollThreshold: 20,
  },
  balanced: { // 默认
    maxUndoDepth: 100, renderPrecision: 'normal', virtualScrollThreshold: 10,
  },
  performance: { // 低配办公机: 关闭复杂排版, 降级渲染
    maxUndoDepth: 30, renderPrecision: 'low', virtualScrollThreshold: 3,
    fontCacheSize: 500, incrementalRenderThreshold: 10,
  },
  readonly: {  // 只读模式: 关闭所有编辑, 极致渲染
    maxUndoDepth: 0, renderPrecision: 'normal', virtualScrollThreshold: 5,
  },
}

interface IEditor {
  setPerformanceConfig(config: Partial<EditorPerformanceConfig>): void
  setPerformanceMode(mode: 'quality' | 'balanced' | 'performance' | 'readonly'): void
}
```

### 24.6 安全沙箱与权限管控 (P1)

```typescript
interface EditorSecurityConfig {
  /** 网络权限 — 默认全部关闭 */
  network: {
    allowFontDownload: boolean    // 默认 false, 字体由外部传入
    allowImageLoad: boolean       // 默认 false, 图片由外部传入
    allowWasmRemote: boolean      // 默认 false, WASM 由外部传入
  }
  /** 文件权限 — 默认关闭敏感操作 */
  file: {
    allowPasteImage: boolean      // 默认 true
    allowExportDownload: boolean  // 默认 true
    allowLocalCache: boolean      // 默认 true (IndexedDB/localStorage)
    allowPrint: boolean           // 默认 true
  }
  /** 数据权限 — 涉密病历 */
  data: {
    allowCopy: boolean            // 默认 true
    allowCut: boolean             // 默认 true
    allowExport: boolean          // 默认 true
    allowPrint: boolean           // 默认 true
  }
  /** 脚本权限 */
  script: {
    allowPlugins: boolean         // 默认 true
    allowCustomNodes: boolean     // 默认 true
    xssFilter: boolean            // 默认 true, 粘贴内容强制过滤
  }
}

// 默认: EditorSecurityConfig 所有敏感能力关闭, 由集成方显式开启
const DEFAULT_SECURITY: EditorSecurityConfig = {
  // 默认全 false, 集成方按场景白名单开启
  network: { allowFontDownload: false, allowImageLoad: false, allowWasmRemote: false },
  file:    { allowPasteImage: false, allowExportDownload: false, allowLocalCache: true, allowPrint: false },
  data:    { allowCopy: false, allowCut: false, allowExport: false, allowPrint: false },
  script:  { allowPlugins: false, allowCustomNodes: false, xssFilter: true },
}
// 场景预设:
// 医院内网(涉密): data 全 false, network 全 false
// 通用编辑:     data.allowCopy=true, file.allowExportDownload=true
// 开发者模式:   script 全 true

interface IEditor {
  setSecurityConfig(config: Partial<EditorSecurityConfig>): void
}
```

### 24.7 诊断与排障 (P2)

```typescript
interface EditorDiagnostics {
  version: { engine: string; modelVersion: string; buildDate: string }
  config: { theme: EditorTheme; performance: EditorPerformanceConfig; security: EditorSecurityConfig }
  document: { pageCount: number; nodeCount: number; smartTextCount: number; fileSize: number }
  performance: { avgKeystrokeLatency: number; avgRenderFrameTime: number; avgLayoutTime: number; cacheHitRate: number }
  errors: EditorError[]                  // 错误历史 (最近 100 条)
  environment: { userAgent: string; platform: string; screenResolution: string; devicePixelRatio: number }
  memory?: { usedJSHeapSize: number }     // performance.memory (Chrome)
}

interface IEditor {
  /** 开启 debug 日志 (输出渲染/布局/命令耗时与参数) */
  setLogLevel(level: 'off' | 'error' | 'warn' | 'debug'): void
  /** 一键导出诊断报告 */
  dumpDiagnostics(): EditorDiagnostics
  /** 显示性能面板 (FPS/布局耗时/渲染耗时/内存) */
  showPerfPanel(visible: boolean): void
}
```

### 24.8 国际化 i18n (P2)

```typescript
type LocaleKey =
  // 工具栏
  | 'toolbar.undo' | 'toolbar.redo' | 'toolbar.bold' | 'toolbar.italic' | 'toolbar.underline'
  | 'toolbar.fontSize' | 'toolbar.fontFamily' | 'toolbar.textColor'
  | 'toolbar.insertTable' | 'toolbar.insertImage'
  | 'toolbar.save' | 'toolbar.print' | 'toolbar.export'
  // 右键菜单
  | 'contextmenu.cut' | 'contextmenu.copy' | 'contextmenu.paste' | 'contextmenu.delete'
  | 'contextmenu.selectAll'
  // 状态栏
  | 'status.pageInfo' | 'status.wordCount' | 'status.saved' | 'status.saving' | 'status.unsaved'
  | 'status.online' | 'status.offline'
  // 错误
  | 'error.documentCorrupted' | 'error.renderFailed' | 'error.saveFailed'
  | 'error.fontLoadFailed' | 'error.wasmLoadFailed'
  // 质控
  | 'qc.completeness' | 'qc.consistency' | 'qc.standardization'
  | 'qc.score' | 'qc.pass' | 'qc.fail'
  // ...

type LocaleMessages = Partial<Record<LocaleKey, string>>

interface IEditor {
  /** 设置语言包 (可只覆盖部分 key) */
  setLocale(messages: LocaleMessages): void
  /** 获取当前语言包 */
  getLocale(): LocaleMessages
}

// 内置: zh-CN (默认), en-US
// 第三方: editor.setLocale({ 'toolbar.bold': '**B**', ... })
```

## 22. AI 原生能力架构 

**核心思路**: 引擎对外包装为 MCP (Model Context Protocol) Server，大模型通过结构化接口操作 DocumentTree。AI 操作和人工编辑共用同一套 ICommand 命令体系——AI 发出的 InsertTextCommand 与医生键盘输入的走完全相同的 forward/invert/undo 管线。零特权、零后门。

### 29.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MCP Client (Claude / GPT / ...)                    │
│  通过 stdio/HTTP 与 MCP Server 通信，获取 tools/resources/prompts    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ MCP Protocol (JSON-RPC)
┌────────────────────────────▼────────────────────────────────────────┐
│                      MCP Server (包装层)                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Tools: 操作类 (AI 可调用的命令)                              │   │
│  │  - document.load / document.create / document.save            │   │
│  │  - editor.insert_text / editor.delete_range / editor.format   │   │
│  │  - editor.insert_table / editor.insert_smarttext              │   │
│  │  - qc.check / qc.score / qc.rules.list                       │   │
│  │  - template.apply / template.list                             │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │  Resources: 数据类 (文档树的只读视图)                         │   │
│  │  - document://{id}/tree         → DocumentTree JSON           │   │
│  │  - document://{id}/smarttexts   → SmartTextNode[] (结构化字段) │   │
│  │  - document://{id}/structure    → 章节/段落/表格 大纲          │   │
│  │  - document://{id}/hdsd/{code} → 按 HDSD 编码查字段值         │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │  Prompts: 模板类 (预置 Agent 提示词)                          │   │
│  │  - 入院记录生成 / 病程记录续写 / 质控检查 / 诊断编码建议       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│              ┌───────────────┴───────────────┐                       │
│              ▼                               ▼                       │
│     ┌────────────────┐              ┌────────────────┐              │
│     │  IEditor API   │              │  ICommand 体系   │              │
│     │  getDocument() │              │  execCommand()  │              │
│     │  undo/redo     │              │  forward/invert │              │
│     └────────────────┘              └────────────────┘              │
│              │                               │                       │
│              └───────────────┬───────────────┘                       │
│                              ▼                                       │
│              引擎内核 (DocumentTree + NodePool + LayoutEngine + ...) │
└─────────────────────────────────────────────────────────────────────┘
```

### 29.2 MCP Tools 接口定义

```typescript
// MCP Server 暴露的 Tool 列表 — 每个 Tool 对应一个 ICommand 或引擎 API 调用

const MCP_TOOLS = {
  // ---- 文档操作 ----
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
  'document.save': {
    description: '保存文档到后端。',
    input: { documentId: 'string' },
    handler: async (args) => { await apiClient.save(args.documentId, editor.getDocument()) }
  },

  // ---- 编辑操作 (与人工编辑共用 ICommand) ----
  'editor.insert_text': {
    description: '在指定段落插入文本。paragraphPath 最后一项为 Paragraph ID，offset 为字符偏移 (UTF-16 码元)。',
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
    handler: (args) => { /* findByInternal → 获取 ElementMeta → createSmartTextNode → InsertTextCommand */ }
  },

  // ---- 质控 ----
  'qc.check': {
    description: '对文档执行质控检查，返回 findings[] + score。',
    input: { documentId: 'string' },
    handler: async (args) => { const doc = await loadDocument(args.documentId); return qcEngine.check(doc, pool) }
  },
  'qc.rules.list': {
    description: '列出所有已注册的质控规则。',
    handler: () => qcEngine.getRules()
  },

  // ---- 模板 ----
  'template.apply': {
    description: '将模板应用到当前文档 (替换 body)。',
    input: { documentId: 'string', templateId: 'string' },
    handler: async (args) => { const tpl = await apiClient.getTemplate(args.templateId); editor.setDocument(tpl.content) }
  },
  'template.list': {
    description: '列出可用模板。',
    handler: async () => apiClient.listTemplates()
  },
}

// 所有 editor.* Tool 的 author 字段标记为 'ai'——
// 与人工编辑走完全相同的 execCommand → CommandUndoRedoStack → DirtyTracker → EventBus → Draw 管线。
// AI 的撤销和人类的撤销在同一个历史栈中，Ctrl+Z 可回退 AI 操作。
```

### 29.3 MCP Resources 数据视图

```typescript
// Resources: 大模型作为上下文读取的只读数据视图

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

// document://{id}/smarttexts — 结构化字段清单 (大模型填表用)
[
  { "id": "st_001", "hdsdCode": "HDSD00.01.001", "deCode": "DE01.00.001.00", "name": "患者姓名", "value": "", "required": true, "dataType": "S1" },
  { "id": "st_002", "hdsdCode": "HDSD00.01.002", "deCode": "DE01.00.002.00", "name": "性别",     "value": "", "required": true, "dataType": "S2", "dictionary": "gender" },
  { "id": "st_003", "hdsdCode": "HDSD00.01.010", "deCode": "DE01.00.010.00", "name": "入院日期", "value": "", "required": true, "dataType": "D" },
]

// document://{id}/hdsd/{hdsdCode} — 按 HDSD 编码查询字段值 (大模型精准定位)
// GET document://doc_123/hdsd/HDSD00.01.001 → { "value": "张三", "nodeId": "st_001" }
```

### 29.4 临床直接落地场景

| 场景                     | MCP 调用链                                                                                                                  | 引擎能力依赖                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **AI 辅助填表**    | `document.load` → `document://{id}/smarttexts` 读空字段 → `editor.insert_smarttext` 逐字段填充                      | SmartTextNode / findByInternal O(1) / ICommand |
| **病史续写**       | `document://{id}/structure` 读现病史章节 → LLM 生成续写段落 → `editor.insert_text` 追加                               | NodePool / InsertTextCommand + Run 模型合并    |
| **智能质控**       | `qc.check` → 返回 findings[] → LLM 解释 findings + 生成修正建议 → `editor.format` / `editor.delete_range` 自动修正 | QCEngine / JSONLogic DSL / ICommand            |
| **模板推荐**       | `template.list` → LLM 根据患者信息推荐模板 → `template.apply`                                                         | 模板系统 / DocumentTree                        |
| **诊断编码建议**   | `document://{id}/hdsd/{code}` 查诊断字段 → LLM 匹配 ICD-10 编码 → `editor.insert_smarttext` 填入                      | findByDE / SmartTextNode                       |
| **结构化摘要生成** | `document://{id}/tree` 全文档 → LLM 生成出院摘要 → `document.create` 新文档                                           | DocumentLoader / createDocument                |

### 29.5 延伸拓展场景

| 场景                   | 描述                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| **多文档对比**   | 同时加载患者多次就诊病历，LLM 对比病情变化趋势，生成对比报告          |
| **知识库 RAG**   | MCP Server 连接医院知识库/诊疗指南，LLM 在生成内容时实时引用文献编号  |
| **语音录入**     | 语音转文本 → MCP `editor.insert_text` 直接写入病历，人工审核后保存 |
| **批量数据分析** | LLM 遍历全院病历的 SmartTextNode 字段，生成疾病统计/用药趋势/质控报告 |
| **自动化文书**   | 根据检查结果自动生成检查报告、知情同意书等结构化文书                  |

### 29.6 产品化核心竞争优势

| 优势                 | 说明                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| **零特权 AI**  | AI 走 ICommand 管线，所有操作可撤销、可审计、权限受 EditorSecurityConfig 控制          |
| **结构化原生** | SmartTextNode + HDSD/DE 编码让 LLM 理解字段语义，而非盲写纯文本                        |
| **引擎复用**   | MCP Server 只是包装层，引擎内核零改动——TextMeasurer/LineBreaker/PageBreaker 全部复用 |
| **离线可用**   | MCP Server 基于 stdio 本地运行，不需要云端 API (大模型推理可本地部署)                  |
| **合规友善**   | 所有 AI 操作留痕 (author='ai')，质控可追溯，符合医疗合规要求                           |

### 29.7 落地实施顺序

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

## 23. 更新后的技术债务全貌

### 13.1 技术债务清单 

| #     | 问题                                          | 严重度  | v4.0 状态 |
| ----- | --------------------------------------------- | ------- | --------- |
| 1     | 纯嵌套结构无节点池 →**已设计 §2.1.1** | 高      | 待实现    |
| 2     | 表格模型过薄 →**已设计 §2.1.2**       | 高      | 待实现    |
| 3     | 无布局缓存 →**已设计 §2.8.4**         | 高      | 待实现    |
| 4     | 单 Canvas 无分层 →**已设计 §2.8.5**   | 高      | 待实现    |
| 5     | 无命中检测体系 →**已设计 §2.9**       | 高      | 待实现    |
| 6     | Draw.ts 上帝类                                | 高      | §2.10    |
| 7     | 全量重布局/重绘                               | 高      | §2.8     |
| 8     | 快照式撤销                                    | 高      | §2.5     |
| 9     | 下标路径定位                                  | 中      | §2.4     |
| 10    | 选区模型不完备 →**已设计 §11.1**      | 中      | 待实现    |
| 11    | 命令无事务合并 →**已设计 §11.2**      | 中      | 待实现    |
| 12    | IME 无抽象层 →**已设计 §11.3**        | 中      | 待实现    |
| 13    | LineBreaker/PageBreaker 未集成                | 中      | -         |
| 14    | 插件无生命周期 →**已设计 §11.4**      | 中      | 待实现    |
| 15    | 版本兼容机制过弱 →**已设计 §11.5**    | 中      | 待实现    |
| 16    | 大文档无虚拟化 →**已设计 §11.6**      | 中      | 待实现    |
| 17    | 内存无管理策略 →**已设计 §11.6**      | 中      | 待实现    |
| 18    | 测试体系无设计 →**已设计 §11.7**      | 中      | 待实现    |
| 19    | 打印一致性无保障 →**已设计 §11.8**    | 中      | 待实现    |
| 20    | 错误边界缺失 →**已设计 §11.9**        | 中      | 待实现    |
| 21    | runtime 状态散落                              | 低      | §2.4     |
| 22    | FlowBody 双模模糊                             | 低      | §2.2     |
| 23-28 | 其他低优先级项                                | 低/远期 | 见 v3.0   |

### 12.2 治理优先级 

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

