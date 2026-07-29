# 技术规格说明书 (Spec) - 文档编辑器引擎

> 版本: v3.0 | 日期: 2026-07-28 | 阶段: spec (深度补齐)
>
> **v3.0 变更**: 新增 EditorRuntimeState、Command 体系、增量布局/渲染、Draw.ts 拆分边界、Particle 统一接口、坐标系统、自动保存、模型校验、非功能需求等规格任务

---

## 1. 项目初始化任务

### TASK-001: 前端项目脚手架 ✅ 已完成

**目标**: 搭建 React + TypeScript + Vite 项目，配置好所有基础依赖。

```
frontend/
├── public/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── engine/           # 核心渲染引擎（独立于 React）
│   │   ├── document/     # DocumentModel + ElementFormatter
│   │   ├── layout/       # TextMeasurer + LineBreaker + PageBreaker
│   │   ├── render/       # Draw + particles/
│   │   ├── state/        # Position
│   │   └── __tests__/    # 单元测试
│   ├── components/       # React UI 组件
│   ├── hooks/            # React Hooks
│   ├── services/         # API 客户端
│   ├── store/            # Zustand store
│   ├── pages/            # 页面
│   └── lib/              # 工具函数
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
└── postcss.config.js
```

**依赖清单**:

```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "zustand": "^5.0.0",
    "axios": "^1.7.0",
    "lucide-react": "^0.400.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-dropdown-menu": "^2.1.0",
    "@radix-ui/react-tooltip": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.4.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "playwright": "^1.45.0"
  }
}
```

### TASK-002: 后端项目脚手架

**目标**: 搭建 SpringBoot 3.x + Mybatis-Plus 项目。

```
backend/
├── pom.xml
├── src/main/java/com/emr/
│   ├── EmrApplication.java
│   ├── controller/
│   ├── service/
│   │   └── impl/
│   ├── repository/
│   ├── entity/
│   ├── dto/
│   ├── config/
│   ├── websocket/
│   └── util/
├── src/main/resources/
│   ├── application.yml
│   ├── application-dev.yml
│   └── mapper/
└── src/test/java/
```

---

## 2. 前端引擎规格 (ModelD 重构版)

### 2.1 阶段一：渲染引擎核心 ✅ 基本完成

#### TASK-101: 文档数据模型定义 (ModelD v10.0 修正) ✅

**文件**: `frontend/src/engine/document/DocumentModel.ts`

**v10.0 重大修正**:
- `DocumentTree` 改为 `{ id, title, pageSetup, body: FlowBody, header?, footer? }`，移除 `pages: Page[]`
- 所有 `children` 字段统一为 `string[]`（NodePool ID 引用），一步到位
- 新增 `ImageNode`（src/objectKey/width/height/naturalWidth/naturalHeight/wrapMode）
- `ElementFormat.dataType` 补 `'S2'`（枚举型）
- `ElementMeta.privacy` 增强为 `{ enabled, maskChar, maskRule }` 脱敏配置
- 废弃 `Page`/`PageBody`/`TreePath`/`TreePathItem` 类型
- 废弃 `traverse()`（递归对象版），改为 `traversePool()`（NodePool 驱动）

```typescript
export const NodeType = {
  DOCUMENT: 'document', PARAGRAPH: 'paragraph', TABLE: 'table',
  ROW: 'row', CELL: 'cell', TEXT: 'text', SMART_TEXT: 'smarttext',
  IMAGE: 'image',
} as const

export interface TextStyle {
  font?: string; size?: number; bold?: boolean; italic?: boolean
  underline?: boolean; underlineStyle?: 'single' | 'double' | 'wave'
  strikeout?: boolean; color?: string; highlight?: string
  superscript?: boolean; subscript?: boolean; letterSpacing?: number
}
export interface ParagraphStyle {
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indent?: number; lineHeight?: number; spaceBefore?: number; spaceAfter?: number
}

export interface BaseNode { id: string; type: NodeType; metadata?: Record<string, unknown> }

export interface ElementCode { internal: string; dataElement: string }
export interface ElementFormat {
  dataType: 'S1' | 'S2' | 'S3' | 'N' | 'D'; showType?: 'AN' | 'N'
  minLength?: number; maxLength?: number; dictionary?: string
}
export interface ElementMeta {
  code: ElementCode; name: string; labels?: string[]
  format?: ElementFormat; required?: boolean; readonly?: boolean
  privacy?: { enabled: boolean; maskChar: string; maskRule: 'full' | 'partial' }
}

// 所有 children 统一为 string[] (NodePool ID 引用)
export interface TextNode extends BaseNode, TextStyle { type: 'text'; text: string }
export interface SmartTextNode extends BaseNode, TextStyle { type: 'smarttext'; text: string; element: ElementMeta }
export interface ImageNode extends BaseNode {
  type: 'image'; src?: string; objectKey?: string
  width: number; height: number; naturalWidth?: number; naturalHeight?: number
  wrapMode: 'inline' | 'square' | 'top-bottom'
}
export type InlineNode = TextNode | SmartTextNode | ImageNode

export interface Paragraph extends BaseNode, ParagraphStyle { type: 'paragraph'; children: string[] }
export interface Table extends BaseNode { type: 'table'; columns: ColumnDefinition[]; children: string[]; pageBreak?: TablePageBreakRule }
export interface TableRow extends BaseNode { type: 'row'; height?: number; children: string[] }
export interface TableCell extends BaseNode { type: 'cell'; colspan?: number; rowspan?: number; children: string[]; backgroundColor?: string; verticalAlign?: 'top' | 'middle' | 'bottom'; isHeader?: boolean }
export type BlockNode = Paragraph | Table | ImageNode

export interface FlowBody { mode: 'flow'; children: string[] }

// v10.0: 存储去分页化 — DocumentTree 不含 pages
export interface PageSetup {
  width: number; height: number; marginTop: number; marginBottom: number
  marginLeft: number; marginRight: number; orientation: 'portrait' | 'landscape'
  watermark?: WatermarkConfig
}
export interface DocumentTree {
  type: 'document'; id: string; title: string; pageSetup: PageSetup
  body: FlowBody; header?: BlockNode[]; footer?: BlockNode[]
  metadata?: Record<string, unknown>
}

// 废弃: Page, PageBody, TreePath, TreePathItem, traverse()
export const DEFAULT_PAGE_SETUP: PageSetup = {
  width: 794, height: 1123,
  marginTop: 72, marginBottom: 72,
  marginLeft: 90, marginRight: 90,
  orientation: 'portrait',
}
```

#### TASK-101b: 节点工厂与树操作 (ElementFormatter v10.0 简化) ✅

**文件**: `frontend/src/engine/document/ElementFormatter.ts`

**v10.0 变更**: 移除 `createPage`/`createFlowBody`/`flowBodyToArray`/`arrayToFlowBody`/`getBodyBlocks`。<br>
新增 `createImageNode`/`createSimpleTable`。`insertAt`/`removeAt` 签名改为 `(pool, parentId, childId, index)`。<br>
`traversePool` 替代 `traverse`。

```typescript
// 工厂函数 (v10.0)
createDocument(title, body?, pageSetup?)         → DocumentTree   // body: FlowBody
createParagraph(children?, style?)                → Paragraph       // children: string[]
createTextNode(text, style?)                      → TextNode
createSmartTextNode(text, element, style?)        → SmartTextNode
createImageNode(objectKey, width, height, wrap?)  → ImageNode
createTable(columns?, rows?)                      → Table
createTableRow(cells?, height?)                   → TableRow
createTableCell(blockIds?, opts?)                 → TableCell
createSimpleTable(rows, cols)                     → Table

// 树操作 (基于 NodePool)
traversePool(pool, rootId, visitor)               → 深度优先遍历
findById(pool, rootId, id)                        → BaseNode | undefined (O(1))
findByDE(pool, rootId, deCode)                    → SmartTextNode[]
findByInternal(pool, rootId, internalCode)        → SmartTextNode[]
insertAt(pool, parentId, childId, index)          → boolean
removeAt(pool, parentId, index)                   → boolean

deepClone / cloneWithNewIds / takeSnapshot / restoreSnapshot
```

#### TASK-102: Canvas 渲染器 ✅ (需重构)

**文件**: `frontend/src/engine/render/Draw.ts` (709行)

当前实现——核心渲染编排器，包含以下职责（**待拆分**）：

```
class Draw {
  // 核心属性
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr: number
  private measurer: TextMeasurer
  private document: DocumentTree
  private items: PageItem[]          // 布局后的扁平 DisplayItem[]
  private scrollTop: number

  // 光标 & 选区 (treePath 定位: pi, bi, ii)
  private cursorPage/Block/Inline: number
  private selInlineStart/End: number
  private selecting: boolean

  // IME
  private imeTextarea: HTMLTextAreaElement
  private composing: boolean
  private composingText: string

  // 核心方法
  constructor(container: HTMLElement, doc: DocumentTree)
  private recomputeLayout(): void           // DocumentTree → DisplayItem[]
  render(): void                             // 主渲染入口
  private drawDisplayItem(di, idx): void     // TextParticle.render() 调用
  private drawTable(table, x, y): void       // 表格渲染
  private drawCursor(): void                 // 光标渲染
  private drawComposingText(ditems): void    // IME 中间态渲染

  // 事件处理 (全部内联)
  private onWheel/MouseDown/Click/MouseMove/MouseUp/KeyDown
  private clientToDoc(clientX, clientY)      // 坐标转换
  private findCursorDisplayItem(ditems)      // treePath → 光标位置
  private treeFromDisplayIdx(idx, ditems)    // DisplayItem → treePath

  // 编辑操作
  private insertChar/insertText/insertNewline
  private deleteBefore/deleteAfter/deleteSelected
  private beforeEdit()                       // 快照记录
  private copyText/cutText/getSelText

  // 撤销/重做 (内联)
  private undoStack: string[]; redoStack: string[]
  undo(); redo()

  // 格式化 API
  toggleBold/Italic/Underline
  setFont/FontSize/Color/Alignment
  insertTable(rows, cols)

  // 公共 API
  getDocument/setDocument/getScale/focus/destroy
}
```

当前渲染流程：
```
DocumentTree → recomputeLayout() → PageItem[] (DisplayItem | TableBlock)
  → render()
    → 背景 + 页面框 (阴影/边距线/页码)
    → drawDisplayItem() → TextParticle.render()
    → drawTable()
    → drawCursor()
    → drawComposingText() (IME 中间态)
```

**已知问题与待重构项：**
1. `recomputeLayout()` 内联实现换行逻辑，未使用 `LineBreaker` 模块
2. 分页未使用 `PageBreaker`，无孤行/寡行控制
3. 事件处理与渲染逻辑耦合在同一类中
4. 内联撤销栈无深度限制（应迁移到 `UndoRedoStack`）

#### TASK-103: 文本测量器 ✅

**文件**: `frontend/src/engine/layout/TextMeasurer.ts`

```typescript
class TextMeasurer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cache: Map<string, TextMetrics>   // LRU 缓存 (MAX_CACHE_SIZE=2000)
  private cacheKeys: string[]               // LRU 队列

  measure(text, config): TextMetrics        // 带缓存
  measureWidth(text, config): number        // 仅宽度
  splitTextToWidth(text, maxWidth, config): string[]  // CJK+英文断行
  measureElementWidth(element): number      // 完整元素宽度 (含 letterSpacing)
  getLineHeight(config): number             // 行高
  getAscent/Descent(config): number         // 基线偏移
  clearCache(): void
  destroy(): void
}
```

#### TASK-104: 换行引擎 ✅ (待集成)

**文件**: `frontend/src/engine/layout/LineBreaker.ts`

```typescript
class LineBreaker {
  constructor(measurer: TextMeasurer)

  breakLines(elements: LineElement[], options: LineBreakOptions): ILine[]
  // 支持:
  // - CJK 字符 (Unicode 正确迭代 [...text])
  // - 英文按单词断行 (wordBreak: 'break-all' | 'break-word' | 'keep-all')
  // - 零宽字符占位 (​)
  // - 强制换行符 (\n)
  // - 分页符 (page_break) 作为独立行
  // - 分隔线 (separator) 占据整行
  // - 图片 (image) 块级独占一行 / 行内模式
  // - 控件 (control) 固定宽度 120px
  // - 表格 (table) 占满宽度
  // - LaTeX 公式 默认宽度 200px
}
```

**集成状态**: LineBreaker 已完整实现，但 `Draw.recomputeLayout()` 目前使用内联的简化换行逻辑。待迁移。

#### TASK-105: 分页引擎 ✅ (待集成)

**文件**: `frontend/src/engine/layout/PageBreaker.ts`

```typescript
class PageBreaker {
  breakPages(lines, headerLines, footerLines, pageSetup): IPage[]
  // 支持:
  // - 页眉/页脚区域占用独立空间
  // - 强制分页符 (page_break)
  // - 孤行控制 (orphan): 段落仅 1 行留在上页 → 整段移到下页
  // - 寡行控制 (widow):  段落仅 1 行出现在下页 → 从上页再移一行
  // - 最小段落行数: MIN_PARAGRAPH_LINES = 2
}
```

**集成状态**: PageBreaker 已完整实现，当前 `Draw` 渲染使用简单分页（每页固定高度），未调用 PageBreaker。

#### TASK-106: 位置计算器 ⚠️ 存根

**文件**: `frontend/src/engine/state/Position.ts`

```typescript
class Position {
  private positionList: IPosition[]
  public headerHeight: number; footerHeight: number

  getIndexByCoord(x, y): number       // 像素坐标 → 元素索引
  setPositions(list): void
  getPositionList(): IPosition[]
  clear(): void
}
```

**集成状态**: Position 类已定义但未被 Draw.ts 使用。Draw.ts 通过 `DisplayItem` 上的 `(pi, bi, ii)` treePath 三元组做坐标定位，使用 `findCursorDisplayItem()` 和 `treeFromDisplayIdx()` 方法。

#### TASK-107: 文本粒子渲染器 ✅

**文件**: `frontend/src/engine/render/particles/TextParticle.ts`

```typescript
class TextParticle {
  static render(ctx, el, x, y, options): void
  // 渲染顺序:
  // 1. 字体构建 (bold/italic/size/fontFamily)
  // 2. 颜色（修订色优先 > 自定义颜色 > 默认黑色）
  // 3. 高亮背景（在文字前绘制，确保在文字下方）
  // 4. 上下标垂直偏移
  // 5. fillText（跳过零宽字符 ​ 和换行符 \n）
  // 6. 下划线（支持 single/double/wave）
  // 7. 删除线
}
```

### 2.2 阶段二：编辑器入口 ✅

#### TASK-201: Editor Facade ✅

**文件**: `frontend/src/engine/Editor.ts` (49行)

```typescript
class Editor {
  private draw: Draw
  private listeners: EditorListener[]

  constructor(container: HTMLElement, doc?: DocumentTree)

  // 数据
  getDocument(): DocumentTree
  setDocument(doc: DocumentTree): void
  getValue(): DocumentTree

  // 撤销/重做
  undo(): void; redo(): void

  // 格式化 (委托给 Draw)
  toggleBold/Italic/Underline()
  setFont(f: string); setFontSize(s: number)
  setColor(c: string); setAlignment(a: string)
  insertTable(r: number, c: number)

  // 生命周期
  focus(): void; getScale(): number
  destroy(): void

  // 事件监听
  on(event, cb): void; off(event, cb): void
}
```

### 2.3 阶段三：React UI 封装 ✅

#### TASK-301: EditorProvider 组件 ✅

**文件**: `frontend/src/components/editor/EditorProvider.tsx`

React Context + Ref 模式桥接 React ↔ Canvas 引擎：

```tsx
const EditorContext = createContext<EditorContextValue | null>(null)

function EditorProvider({ children, containerRef, document })  // 创建 Editor 实例
function useEditor(): Editor | null                             // 获取 Editor 实例
function useEditorRef(): React.MutableRefObject<Editor | null>  // 获取 Ref
```

#### TASK-302: 布局组件 ✅

**文件**:
- `frontend/src/components/layout/EditorLayout.tsx` ✅
- `frontend/src/components/layout/HeaderBar.tsx` ✅
- `frontend/src/components/layout/Sidebar.tsx` ✅
- `frontend/src/components/layout/Toolbar.tsx` ✅
- `frontend/src/components/layout/StatusBar.tsx` ✅

#### TASK-303: 编辑器页面 ✅

**文件**: `frontend/src/pages/EditorPage.tsx`

组装完整编辑器页面，管理全局状态（Zustand store 连接）。

#### TASK-304: 对话框组件 ✅

**文件**:
- `frontend/src/components/dialogs/ExportDialog.tsx` ✅

---

## 3. 待办任务 (重构 & 增强 — v3.0 全面规划)

### 3.1 P0 — 字体管理层 (v5.0 新增 — 最高优先级)

**依赖链**: FontManager → TextMeasurer → LineBreaker → PageBreaker → Draw。字体层是所有布局/渲染计算的前提。

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-301** | `layout/FontManager.ts` | 实现 FontManager 单例: registerFont/registerAll/getVariant/querySystemFonts/ensureReady；支持 @font-face 嵌入式字体加载 + 系统字体查询 |
| **TASK-302** | `layout/FontDescriptor.ts` | 定义 FontDescriptor/FontVariant/FontMetrics 类型；实现 extractMetrics() 从 Canvas 提取 upem=1000 的字体度量数据 |
| **TASK-303** | `layout/FontFallback.ts` | 实现 FontFallback: detectMissingGlyphs() 缺字检测 + resolveFallbackFonts() 字体降级链 → FontRun[] |
| **TASK-304** | `layout/TextMeasurer.ts` | 重构 TextMeasurer 注入 FontManager 依赖；新增 measureWidthPrecise() L2 精确测量 (HarfBuzz WASM 预留) + measureChars() 逐字符 kerning 测量 |
| **TASK-305** | `layout/ScriptResolver.ts` | 实现 detectScript() + resolveScriptRuns()，按 Unicode 脚本自动分配中/英/日/韩字体 |

### 3.2 P0 — 运行时状态 + 命令体系 (基础架构)

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-401** | `state/EditorRuntimeState.ts` | 实现 EditorRuntimeState 类型 + CursorState/SelectionState/ViewState/IMEState/HistoryState；用 ID 链路路径 `string[]` 替代下标路径 (pi,bi,ii) |
| **TASK-402** | `command/ICommand.ts` | ICommand 接口 v13.0: forward/invert(document, pool) 传文档现场 + serialize 内嵌 deletedText |
| **TASK-403** | `command/commands/` | Run 模型: InsertTextCommand 字符串插入 + 相邻同样式合并; DeleteRangeCommand serialize 内嵌被删文本; normalizeParagraph() 合并相邻同样式 TextNode |
| **TASK-404** | `state/CommandUndoRedoStack.ts` | 实现命令驱动的撤销重做栈 (maxDepth=100)；渐进迁移: 与旧快照式栈并行运行 |
| **TASK-405** | `command/CommandManager.ts` | 实现 CommandManager：接收 Command → forward(doc) → StatePatch → DirtyTracker → EventBus.emit |

### 3.3 P0 — Draw.ts 职责拆分

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-411** | `engine/EventBus.ts` | 实现 EventBus 单例 (on/off/emit + EngineEvent 类型) |
| **TASK-412** | `interaction/MouseHandler.ts` | 从 Draw.ts 提取 mousedown/mousemove/mouseup → cursor/selection 管理 → emit EventBus |
| **TASK-413** | `interaction/KeyboardHandler.ts` | 从 Draw.ts 提取 keydown → 可见字符/导航/删除/快捷键 → 调用 CommandManager.execute() |
| **TASK-414** | `interaction/IMEHandler.ts` | 从 Draw.ts 提取 hidden textarea + composition 事件 → InsertTextCommand |
| **TASK-415** | `interaction/ClipboardHandler.ts` | 从 Draw.ts 提取 copy/cut/paste → PasteCommand / 系统剪贴板 |
| **TASK-416** | `render/Draw.ts` | 重构: 移除事件/IME/剪贴板/撤销逻辑，保留 render + recomputeLayout；依赖改为 EventBus 监听 |

### 3.4 P0 — 布局引擎集成 + 坐标系统

| 任务 | 说明 |
|------|------|
| **TASK-421** | LineBreaker 契约重定义: 输入直接为 InlineNode[] + ParagraphStyle, 删除 LineElement/page_break/separator/control/latex 残留类型 |
| **TASK-422** | 增量分页算法: PageStartTable + incrementalRepaginate() + 早停机制 + 百页单字符编辑收敛到 1~2 页 |
| **TASK-423** | 行高统一收口: LineHeightResolver = FontMetrics(ascent+descent+lineGap) × size/upem × lineHeight, 删除 TextMeasurer 启发式 |
| **TASK-424** | 测量缓存修正: (char, fontKey) 粒度 + 容量 10000 + kerning 仅 Latin + document.fonts.check() 缺字检测 |
| **TASK-425** | detectScript 修复: \p{Script=Han/Latin/Hiragana/Katakana/Hangul} Unicode Property, 删手写码点表 |

### 3.5 P0 — 渐进迁移路径

| 任务 | 说明 |
|------|------|
| **TASK-441** | Step 1: EditorRuntimeState 双写 — 新建 runtime state 对象，Draw.ts 同时维护旧字段和新 state，渲染从新 state 读取 |
| **TASK-442** | Step 2: EventBus 引入 — 新建 EventBus 单例，Draw.render() 注册为监听者，事件处理函数末尾 emit |
| **TASK-443** | Step 3a: IMEHandler 提取 — 先迁移依赖最少的 IME (独立 textarea + composition 事件) |
| **TASK-444** | Step 3b: ClipboardHandler 提取 — 迁移 copy/cut/paste 逻辑 |
| **TASK-445** | Step 3c: MouseHandler 提取 — 先迁 CoordinateSystem 再迁 mouse 事件 |
| **TASK-446** | Step 4: Command 体系双栈 — KeyboardHandler 走新 Command 栈，旧 beforeEdit/undoStack 保留作兜底，逐步切换 |

### 3.6 P1 — 增量布局 + 增量渲染

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-431** | `layout/DirtyTracker.ts` | 实现脏区追踪器: markParagraphDirty/markRectDirty/markFullLayout/getClipRegion/clear |
| **TASK-432** | `layout/IncrementalLayout.ts` | 实现增量布局: 仅重算脏 Paragraph → 增量调用 PageBreaker.repaginate() |
| **TASK-433** | `render/Draw.ts` | 增量渲染: ctx.clip(clipRect) + 仅重绘脏区 + crsor/selection/IME 始终重绘 |
| **TASK-434** | `requestAnimationFrame` 合并 | 同一帧内多次脏区标记合并为一次 render() 调用 |

### 3.7 P1 — DocumentTree 增强

| 任务 | 说明 |
|------|------|
| **TASK-441** | BaseNode 增加 `metadata?: Record<string, unknown>` 扩展字段 (含 locked / undeletable / annotations / tags) |
| **TASK-442** | modelVersion 4.0 breaking upgrader: DocumentTree 去分页化 (pages→body) + children 全部 ID 化 + 移除 Page/PageBody 类型 |
| **TASK-443** | ImageNode 完整模型 + MinIO 上传链路 + EditorSecurityConfig.file 权限串联 |
| **TASK-444** | dataType 补 S2 + ElementMeta.privacy 脱敏链路 (maskChar/maskRule + 渲染层按用户权限打码) |
| **TASK-445** | 实现 `isDeletable()` 函数 (EditorMode ∩ metadata.undeletable) + Delete/Backspace 集成 |
| **TASK-446** | 实现 `isEditable()` 增强: 加入 L4 undeletable 不影响编辑性, L5 locked+undeletable 完全冻结 |

### 3.8 P1 — Particle 统一接口

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-451** | `render/particles/IParticle.ts` | 定义 IParticle 接口 (particleType + render(layout, context) + measure(context)) |
| **TASK-452** | `render/particles/TextParticle.ts` | 重构为 implements IParticle |
| **TASK-453** | `render/particles/ParticleRegistry.ts` | 实现粒子注册表 (register/get) |
| **TASK-454** | `render/particles/ImageParticle.ts` | 实现图片粒子 (待 P2 图片功能) |
| **TASK-455** | `render/particles/TableParticle.ts` | 实现表格粒子 (将 drawTable 逻辑迁移) |

### 3.9 P2 — 后端对接

| 任务 | 说明 |
|------|------|
| **TASK-501** | 后端文档 CRUD API (含乐观锁 version 字段) |
| **TASK-502** | 后端 JSON Schema 校验 (MySQL JSON_SCHEMA_VALID) |
| **TASK-503** | 后端 X-Model-Version Header 中间件 |
| **TASK-504** | t_document_permission 表 + 权限 CRUD API |
| **TASK-505** | t_audit_log 表 + API 层拦截器自动记录 |
| **TASK-506** | ModelA → ModelD 懒迁移 (读取时自动转换) |

### 3.10 P2 — 保存与恢复

| 任务 | 说明 |
|------|------|
| **TASK-511** | AutoSaveManager: 防抖 (3000ms) + IndexedDB 缓存 + localStorage 二级备份 |
| **TASK-512** | 故障恢复: 页面加载时检测 IndexedDB 未保存数据 → 提示用户恢复 |
| **TASK-513** | 保存状态 UI: saved/saving/unsaved/error/conflict 五态指示 |

### 3.11 P2 — 打印与导出

| 任务 | 说明 |
|------|------|
| **TASK-521** | 后端 PDF 导出 (iText + DocumentTree JSON → PDF) |
| **TASK-522** | 后端 HTML 导出 (Thymeleaf + DocumentTree JSON → HTML) |
| **TASK-523** | 前端 PNG 导出 (Canvas.toDataURL 当前页) |
| **TASK-524** | 前端 JSON 导出 (DocumentTree JSON Blob 下载) |
| **TASK-525** | 数字水印: WatermarkConfig 模型 + LayeredRenderer.drawWatermark() + text tile/center + image 模式 |
| **TASK-526** | IDocumentLoader 接口 + DocumentLoaderRegistry + JSONDocumentLoader (原生格式) |
| **TASK-527** | XMLDocumentLoader: HL7 CDA / 通用 XML → DocumentTree 映射 (ClinicalDocument → FlowBody) |
| **TASK-528** | HTMLDocumentLoader: DOM → BlockNode 树 (有损转换: <p>/<b>/<table> → Paragraph/TextStyle/Table) |
| **TASK-529** | MarkdownDocumentLoader: 简单 parser (# → size, ** → bold, | → table) + 启发式 detect() |

### 3.12 P0 — 工程化基础 (v4.0 新增)

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-551** | `document/NodePool.ts` | 实现节点池: `nodes: Map<string, BaseNode>` + `buildNodePool()` + `poolToTree()` + `getNodeById()` O(1) 查找 |
| **TASK-552** | `document/DocumentModel.ts` | 父节点 children 从 `BaseNode[]` 迁移到 `string[]` (ID 数组)，通过 NodePool 查找 |
| **TASK-553** | `layout/LayoutCache.ts` | 实现三级布局缓存: inlineCache / blockCache / pageCache + isValid/invalidate/clearAll |
| **TASK-554** | `render/LayeredRenderer.ts` | 实现三 Canvas 分层: static/content/interact + 光标独立闪烁定时器 |
| **TASK-555** | `render/HitTestIndex.ts` | 实现命中检测索引: AABB 粗筛 + particle.hitTest() 精确检测 + 二分查找 |

### 3.13 P1 — 表格增强 + 交互深化 (v4.0 新增)

| 任务 | 说明 |
|------|------|
| **TASK-561** | 表格 ColumnDefinition + TableLayoutAlgorithm (fixed/auto) + MergeMatrix.buildMergeMatrix() |
| **TASK-562** | SelectionState 增强: granularity + normalizeSelection + TableSelection |
| **TASK-563** | CommandUndoRedoStack 事务: beginTransaction/commitTransaction/MacroCommand + 自动合并 tryMerge |
| **TASK-564** | InputComposer 抽象层: Firefox/Safari 兼容封装 + updateCursorRect 候选框定位 |
| **TASK-565** | PluginManager: install/uninstall + PluginContext 扩展点注册 |

### 3.14 P2 — 系统保障 (v4.0 新增)

| 任务 | 说明 |
|------|------|
| **TASK-571** | ModelUpgrader 语义化版本: MAJOR/MINOR/PATCH + breaking flag + loadDocument/saveDocument |
| **TASK-572** | VirtualViewport + LazyLayoutEngine: 视口虚拟化 + 懒布局 + 节点回收 |
| **TASK-573** | MemoryManager: 缓存容量限制 + LRU 淘汰 + TextMeasurer 低频清理 |
| **TASK-574** | ExportLayoutResult: 布局中间结果 JSON → 后端 iText 精确放置 (打印一致性) |
| **TASK-575** | ErrorBoundary: safeRenderParticle/safeRenderPage/safeLoadDocument 三级降级 |

### 3.15 P2 — 医学质控引擎 (v5.0 新增)

| 任务 | 说明 |
|------|------|
| **TASK-581** | QCRule 模型: CompletenessRule (必填检查) / ConsistencyRule (逻辑表达式) / StandardizationRule (码表校验) |
| **TASK-582** | QCScorer: 加权评分模型 (完整度 40% + 一致性 30% + 规范性 30%) + grade A/B/C/D |
| **TASK-583** | QCEngine: registerRule/check → QCResult { findings[], score, timestamp } |
| **TASK-584** | 质控结果 UI: 错误/警告/通过 三级面板 + 点击定位到对应 SmartTextNode |
| **TASK-585** | t_qc_review 表 + 审核流程 API (pending_review/reviewed/rejected 状态流转) |

### 3.16 P1 — 核心规则补齐 (v6.0 新增)

| 任务 | 说明 |
|------|------|
| **TASK-591** | NodePool 5 条铁律实现: insertChild/removeChild/getChildren 统一入口 + ID 不可变 + 遍历范式 |
| **TASK-592** | 表格列宽计算: fixed/percentage/auto 优先级 + 合并矩阵 buildMergeMatrix() + 跨页断表规则 |
| **TASK-593** | 协作位置锚定: 废弃所有数组下标定位, 统一 nodeId+offset, Command/Handler 全部适配 |
| **TASK-594** | 核心接口契约: ICommand/IParticle/ITextShaper/IDocumentLoader/IPlugin/IInputComposer 签名标准化 |
| **TASK-595** | 可观测性: PerformanceMetrics 埋点 + ErrorReport 上报 + BusinessMetrics 统计 |
| **TASK-596** | 性能指标测量: keystrokeLatency/renderFrameTime/pageBreak 计时起点终点 + 采样方法 |
| **TASK-597** | 字体加载防抖: SimSun/SimHei 预加载 → 占位 UI → 就绪后进入编辑态 |
| **TASK-598** | 模型版本兼容矩阵: 向前/向后兼容规则 + 保存强制升级 + 低版本拒绝高版本文档 |
| **TASK-599** | SLIF 布局中间格式: SLIFPage/SLIFItem 类型 + 前端 Canvas/后端 iText 共享解析 |

### 3.17 P0 — SDK 集成边界 (v7.0 新增)

| 任务 | 说明 |
|------|------|
| **TASK-611** | IEditor 公共 API 界定: 三类接口(数据/操作/事件) + 禁止 import 内部模块 + EditorError 类型 |
| **TASK-612** | 宿主环境隔离: engine/ 零框架依赖 + EditorConfig 容器注入 + 禁止直接读 window/document |
| **TASK-613** | 构建产物: @emr/engine (ESM/UMD) + @emr/editor-react (peerDependencies engine) + 资源路径可配置 |
| **TASK-614** | 多实例支持: 全局共享(FontManager/HarfBuzz) vs 实例私有(EventBus/LayoutCache/Renderer/CoordinateSystem) |
| **TASK-615** | 标准扩展点清单: registerNodeType/Particle/Command/QCRule/ToolbarItem/ContextMenuItem/SmartTextRenderer/Loader + editor.use() |

### 3.19 P0 — SDK 交付基线 (v8.0 新增)

| 任务 | 说明 |
|------|------|
| **TASK-621** | 生命周期契约: Disposable 接口 + 所有模块 dispose() + Editor.pause/resume/destroy + 生命周期钩子 |
| **TASK-622** | 错误体系: EditorErrorCode + safeRenderParticle 节点级容错 + editor.onError 统一入口 |
| **TASK-623** | 数据兼容承诺: 向后兼容(静默升级) + 向前兼容(未知字段保留+降级展示) + 兼容周期(门诊15年/住院30年) |
| **TASK-624** | 主题定制: EditorTheme + 4 种内置预设(标准/护眼/打印/深色) + editor.setTheme() |
| **TASK-625** | 性能分级: EditorPerformanceConfig + 4 种模式(quality/balanced/performance/readonly) |
| **TASK-626** | 安全沙箱: EditorSecurityConfig(network/file/data/script) + 默认最小权限 + XSS 过滤 |
| **TASK-627** | 诊断体系: setLogLevel + dumpDiagnostics + showPerfPanel |
| **TASK-628** | 国际化: LocaleMessages + editor.setLocale/getLocale + 运行时切换 + 第三方部分覆盖 |

### 3.20 P3 — 协作与远期

| 任务 | 说明 |
|------|------|
| **TASK-601** | 协作同步协议 (WebSocket + CRDT, 预留设计) |
| **TASK-602** | 非功能需求监控埋点 (renderFrameTime/layoutRecomputeTime/keystrokeLatency) |
| **TASK-603** | 端到端测试 (Playwright: 文本编辑/格式化/IME 输入/表格/保存) |

---

## 4. 质量门禁

每个任务完成前必须通过：

1. **构建门禁**: `npm run build` 零错误 / `mvn package` 成功
2. **类型门禁**: `tsc --noEmit` 零错误
3. **Lint 门禁**: `npm run lint` 零 error
4. **测试门禁**: 核心模块单元测试覆盖率 > 80%
5. **UI 门禁**: 与 output/4-uiux.md 视觉一致性检查
6. **图标门禁**: 源码中无 emoji 字符 (Unicode U+2600-U+27BF, U+1F300-U+1FAFF)
7. **API 门禁**: 前后端 API 路径与 output/3-architecture.md 一致
8. **模型校验门禁** (v3.0): `validateDocumentTree()` 在保存前通过
9. **版本兼容门禁** (v3.0): modelVersion 升级器测试通过
10. **权限门禁** (v3.0): `isEditable()` 全模式 × 节点级组合测试通过
