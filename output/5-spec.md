# 技术规格说明书 (Spec) - 文档编辑器引擎

> 版本: v1.0 | 日期: 2026-07-17 | 阶段: spec

---

## 1. 项目初始化任务

### TASK-001: 前端项目脚手架

**目标**: 搭建 React + TypeScript + Vite 项目，配置好所有基础依赖。

```
frontend/
├── public/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── engine/           # 核心渲染引擎（独立于 React）
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

**pom.xml 关键依赖**:
```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.2</version>
</parent>
<dependencies>
    <!-- Web -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <!-- WebSocket -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-websocket</artifactId>
    </dependency>
    <!-- Security -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-security</artifactId>
    </dependency>
    <!-- Validation -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
    <!-- Mybatis-Plus -->
    <dependency>
        <groupId>com.baomidou</groupId>
        <artifactId>mybatis-plus-spring-boot3-starter</artifactId>
        <version>3.5.7</version>
    </dependency>
    <!-- MySQL -->
    <dependency>
        <groupId>com.mysql</groupId>
        <artifactId>mysql-connector-j</artifactId>
    </dependency>
    <!-- Redis -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-redis</artifactId>
    </dependency>
    <!-- JWT -->
    <dependency>
        <groupId>io.jsonwebtoken</groupId>
        <artifactId>jjwt</artifactId>
        <version>0.12.6</version>
    </dependency>
    <!-- Lombok -->
    <dependency>
        <groupId>org.projectlombok</groupId>
        <artifactId>lombok</artifactId>
        <optional>true</optional>
    </dependency>
    <!-- SpringDoc OpenAPI -->
    <dependency>
        <groupId>org.springdoc</groupId>
        <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
        <version>2.6.0</version>
    </dependency>
</dependencies>
```

---

## 2. 前端引擎规格

### 2.1 阶段一：渲染引擎核心 (Phase 1 Core Engine)

#### TASK-101: 文档数据模型定义

**文件**: `frontend/src/engine/document/DocumentModel.ts`

定义所有核心 TypeScript 类型和接口：

```typescript
// 元素类型枚举
export enum ElementType {
  TEXT = 'text',
  IMAGE = 'image',
  TABLE = 'table',
  CONTROL = 'control',
  PAGE_BREAK = 'page_break',
  SEPARATOR = 'separator',
  HYPERLINK = 'hyperlink',
}

// 控件类型枚举
export enum ControlType {
  INPUT = 'input',
  SELECT = 'select',
  DATE = 'date',
  CHECKBOX = 'checkbox',
  RADIO = 'radio',
  NUMBER = 'number',
  TEXTAREA = 'textarea',
}

// 编辑器模式
export enum EditorMode {
  EDIT = 'edit',
  READONLY = 'readonly',
  FORM = 'form',
  DESIGN = 'design',
  CLEAN = 'clean',
  PRINT = 'print',
}

// 页面模式
export enum PageMode {
  PAGING = 'paging',
  LINKAGE = 'linkage',
}

// 水平对齐
export enum RowFlex {
  LEFT = 'LEFT',
  CENTER = 'CENTER',
  RIGHT = 'RIGHT',
  JUSTIFY = 'JUSTIFY',
}

// 文档元素接口
export interface IElement {
  id: string;
  type: ElementType;
  value: string;
  // 样式
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  underlineStyle?: 'single' | 'double' | 'wave';
  strikeout?: boolean;
  color?: string;
  highlight?: string;
  superscript?: boolean;
  subscript?: boolean;
  // 段落
  rowFlex?: RowFlex;
  rowMargin?: number;
  lineHeight?: number;
  indent?: number;
  // 特有属性
  trList?: ITr[];
  control?: IControl;
  imageData?: IImageData;
  // 留痕与权限
  revision?: IRevision;
  permission?: IPermission;
  validation?: IValidation;
  extension?: Record<string, unknown>;
}

// 表格行
export interface ITr {
  height: number;
  tdList: ITd[];
}

// 表格单元格
export interface ITd {
  width: number;
  colspan?: number;
  rowspan?: number;
  value: IElement[];
  isHeader?: boolean;
}

// 表单控件
export interface IControl {
  controlType: ControlType;
  placeholder?: string;
  options?: { label: string; value: string }[];
  multiple?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  readonly?: boolean;
  required?: boolean;
  dataBinding?: IDataBinding;
}

// 图片数据
export interface IImageData {
  src: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  wrapType?: 'inline' | 'square' | 'top-bottom';
}

// 数据绑定
export interface IDataBinding {
  source: string;
  property: string;
  expression?: string;
}

// 校验规则
export interface IValidation {
  required?: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  message?: string;
}

// 修订留痕
export interface IRevision {
  type: 'insert' | 'delete' | 'modify';
  author: string;
  timestamp: number;
  style?: {
    color?: string;
    underlineStyle?: string;
  };
}

// 权限
export interface IPermission {
  level: number;
  creatorId: string;
  editable: boolean;
  deletable: boolean;
}

// 文档页面设置
export interface IPageSetup {
  width: number;        // 默认 794 (A4)
  height: number;       // 默认 1123 (A4)
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  orientation: 'portrait' | 'landscape';
}

// 文档数据
export interface IDocument {
  id: string;
  title: string;
  templateId?: string;
  header: IElement[];
  main: IElement[];
  footer: IElement[];
  pageSetup: IPageSetup;
  metadata: IDocumentMetadata;
}

// 文档元数据
export interface IDocumentMetadata {
  author: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  tags?: string[];
}
```

#### TASK-102: Canvas 渲染器基础

**文件**: `frontend/src/engine/render/Draw.ts`

核心渲染编排器，负责：

```
class Draw {
  // 核心属性
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private options: IEditorOption;
  private position: Position;
  private rangeManager: RangeManager;
  private cursor: Cursor;

  // 核心方法
  constructor(container: HTMLElement, options: IEditorOption);
  render(payload: IDrawPayload): void;         // 主渲染入口
  computeLayout(): void;                        // 计算布局
  getPageCount(): number;                       // 获取页数
  getPageOffset(pageIndex: number): IPageOffset;// 获取页面偏移
  destroy(): void;                              // 销毁清理
}
```

渲染流程：
```
render()
  → clearCanvas()
  → forEach page:
      → drawPageBackground()
      → drawMarginLines()
      → drawContentRows()
      → drawFloatingElements()
      → drawHeader()
      → drawFooter()
      → drawPageNumber()
  → drawSearchHighlights()
  → drawSelectionRanges()
  → drawCursor()
```

#### TASK-103: 文本测量器

**文件**: `frontend/src/engine/layout/TextMeasurer.ts`

使用 Canvas `measureText()` API 进行精确文字测量：

```typescript
class TextMeasurer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  measureText(text: string, font: FontConfig): TextMetrics;
  measureWidth(text: string, font: FontConfig): number;
  splitTextToWidth(text: string, maxWidth: number, font: FontConfig): string[];
}
```

#### TASK-104: 换行引擎

**文件**: `frontend/src/engine/layout/LineBreaker.ts`

```typescript
class LineBreaker {
  breakLines(
    elements: IElement[],
    maxWidth: number,
    measurer: TextMeasurer
  ): ILine[];

  // 支持：
  // - 英文 (word-break / overflow-wrap)
  // - 中文 (CJK 断行规则)
  // - 标点符号处理 (避头尾)
}
```

#### TASK-105: 分页引擎

**文件**: `frontend/src/engine/layout/PageBreaker.ts`

```typescript
class PageBreaker {
  breakPages(lines: ILine[], pageSetup: IPageSetup): IPage[];

  // 支持：
  // - 页眉/页脚区域的独立空间计算
  // - PageBreak 元素的强制分页
  // - 表格跨页时的表头重复
}
```

#### TASK-106: 位置计算器

**文件**: `frontend/src/engine/render/Position.ts`

```typescript
class Position {
  getPositionList(): IPosition[];    // 获取所有元素的像素位置
  getPositionByIndex(index: number): IPosition;
  getIndexByCoord(x: number, y: number): number;
  getPageByCoord(y: number): number;
}
```

#### TASK-107: 文本粒子渲染器

**文件**: `frontend/src/engine/render/particles/TextParticle.ts`

```typescript
class TextParticle implements IParticle {
  render(ctx: CanvasRenderingContext2D, element: IElement, position: IPosition): void;
  // 支持：粗体/斜体/下划线/删除线/上下标/高亮/字体颜色
}
```

### 2.2 阶段二：编辑交互 (Phase 2 Interaction)

#### TASK-201: 编辑器 Facade

**文件**: `frontend/src/engine/Editor.ts`

```typescript
class Editor {
  // 属性
  command: Command;           // 命令系统
  eventBus: EventBus;         // 事件总线
  listener: EditorListener;   // 生命周期回调

  // 构造
  constructor(container: HTMLElement, data: IElement[], options: IEditorOption);

  // 数据读写
  getValue(): IDocument;
  setValue(data: IDocument): void;
  getHTML(): Promise<string>;

  // 模式控制
  setMode(mode: EditorMode): void;
  setPageMode(mode: PageMode): void;

  // 生命周期
  destroy(): void;
}
```

#### TASK-202: 命令系统

**文件**: `frontend/src/engine/command/CommandManager.ts`

```typescript
interface ICommand {
  execute(): void;
  undo(): void;
  redo(): void;
}

class CommandManager {
  execute(command: ICommand): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

// 具体命令
class InsertTextCommand implements ICommand { ... }
class DeleteTextCommand implements ICommand { ... }
class FormatTextCommand implements ICommand { ... }
class InsertElementCommand implements ICommand { ... }
class DeleteElementCommand implements ICommand { ... }
class ModifyElementCommand implements ICommand { ... }
```

#### TASK-203: 选区管理器

**文件**: `frontend/src/engine/state/RangeManager.ts`

```typescript
class RangeManager {
  getRange(): { startIndex: number; endIndex: number } | null;
  setRange(startIndex: number, endIndex: number): void;
  clearRange(): void;
  getSelectedText(): string;
  getSelectedElements(): IElement[];
  isInRange(index: number): boolean;
}
```

#### TASK-204: 键盘事件处理

**文件**: `frontend/src/engine/interaction/KeyboardHandler.ts`

处理：
- 字符输入（中英文、数字、符号）
- 方向键（上下左右、Home、End、PageUp、PageDown）
- 删除键（Backspace、Delete）
- 回车键（换行）
- Tab 键
- 快捷键组合（Ctrl+B/I/U/S/Z/Y/C/V/X/A）

#### TASK-205: 鼠标事件处理

**文件**: `frontend/src/engine/interaction/MouseHandler.ts`

处理：
- 单击定位光标
- 双击选中词
- 三击选中段落
- 拖动选中文档
- 滚动（与页面同步）

#### TASK-206: 输入法 (IME) 处理

**文件**: `frontend/src/engine/interaction/IMEHandler.ts`

处理中文输入法的 compositionstart/compositionupdate/compositionend 事件。

### 2.3 阶段三：React UI 封装 (Phase 3 React Integration)

#### TASK-301: EditorProvider 组件

**文件**: `frontend/src/components/editor/EditorProvider.tsx`

React Context 封装编辑器实例：

```tsx
const EditorContext = createContext<Editor | null>(null);

function EditorProvider({ children, container, data, options }) {
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    editorRef.current = new Editor(container, data, options);
    return () => editorRef.current?.destroy();
  }, []);

  return (
    <EditorContext.Provider value={editorRef.current}>
      {children}
    </EditorContext.Provider>
  );
}

function useEditor(): Editor;
```

#### TASK-302: 布局组件

**文件**:
- `frontend/src/components/layout/HeaderBar.tsx`
- `frontend/src/components/layout/Sidebar.tsx`
- `frontend/src/components/layout/Toolbar.tsx`
- `frontend/src/components/layout/StatusBar.tsx`
- `frontend/src/components/layout/PropertiesPanel.tsx`
- `frontend/src/components/layout/EditorLayout.tsx`

#### TASK-303: 编辑器页面

**文件**: `frontend/src/pages/EditorPage.tsx`

组装完整编辑器页面，管理全局状态。

#### TASK-304: 对话框组件

**文件**:
- `frontend/src/components/dialogs/TemplateSelectDialog.tsx`
- `frontend/src/components/dialogs/PrintPreviewDialog.tsx`
- `frontend/src/components/dialogs/ExportDialog.tsx`

---

## 3. 后端 API 规格

### 3.1 阶段四：后端 API (Phase 4 Backend API)

#### TASK-401: 基础配置

**文件**: `backend/src/main/resources/application.yml`

```yaml
server:
  port: 8080

spring:
  datasource:
    url: jdbc:mysql://localhost:3306/emr_editor?useUnicode=true&characterEncoding=utf-8&serverTimezone=Asia/Shanghai
    username: root
    password: ${DB_PASSWORD}
    driver-class-name: com.mysql.cj.jdbc.Driver
  redis:
    host: localhost
    port: 6379
  jackson:
    date-format: yyyy-MM-dd HH:mm:ss
    time-zone: Asia/Shanghai

mybatis-plus:
  mapper-locations: classpath:mapper/*.xml
  global-config:
    db-config:
      id-type: assign_id

jwt:
  secret: ${JWT_SECRET}
  expiration: 86400000  # 24h

springdoc:
  api-docs:
    path: /api-docs
  swagger-ui:
    path: /swagger-ui.html
```

#### TASK-402: 安全配置

**文件**: `backend/src/main/java/com/emr/config/SecurityConfig.java`

- JWT 过滤器
- CORS 配置
- 路径权限配置
- 密码加密 (BCrypt)

#### TASK-403: 实体类

**文件**:
- `backend/src/main/java/com/emr/entity/Document.java`
- `backend/src/main/java/com/emr/entity/Template.java`
- `backend/src/main/java/com/emr/entity/User.java`
- `backend/src/main/java/com/emr/entity/AuditLog.java`
- `backend/src/main/java/com/emr/entity/DocumentVersion.java`
- `backend/src/main/java/com/emr/entity/Annotation.java`

#### TASK-404: 文档 API (CRUD)

**文件**: `backend/src/main/java/com/emr/controller/DocumentController.java`

```java
@RestController
@RequestMapping("/api/v1/documents")
public class DocumentController {

    @GetMapping
    public ApiResponse<PageResult<DocumentListDTO>> list(
        @RequestParam(defaultValue = "1") int page,
        @RequestParam(defaultValue = "20") int size,
        @RequestParam(required = false) String keyword,
        @RequestParam(required = false) String status
    );

    @PostMapping
    public ApiResponse<DocumentDTO> create(@RequestBody @Valid CreateDocumentRequest req);

    @GetMapping("/{id}")
    public ApiResponse<DocumentDTO> getById(@PathVariable String id);

    @PutMapping("/{id}")
    public ApiResponse<DocumentDTO> update(
        @PathVariable String id,
        @RequestBody @Valid UpdateDocumentRequest req
    );

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable String id);
}
```

#### TASK-405: 模板 API

**文件**: `backend/src/main/java/com/emr/controller/TemplateController.java`

```java
@RestController
@RequestMapping("/api/v1/templates")
public class TemplateController {
    // GET / → 模板列表
    // POST / → 创建模板
    // GET /{id} → 获取模板
    // PUT /{id} → 更新模板
    // DELETE /{id} → 删除模板
}
```

#### TASK-406: 认证 API

**文件**: `backend/src/main/java/com/emr/controller/AuthController.java`

```java
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    @PostMapping("/login")
    public ApiResponse<LoginResponse> login(@RequestBody @Valid LoginRequest req);

    @PostMapping("/logout")
    public ApiResponse<Void> logout();

    @PostMapping("/refresh")
    public ApiResponse<LoginResponse> refresh();

    @GetMapping("/me")
    public ApiResponse<UserDTO> getCurrentUser();
}
```

#### TASK-407: 导出 API

**文件**: `backend/src/main/java/com/emr/controller/ExportController.java`

```java
@RestController
@RequestMapping("/api/v1/documents/{id}/export")
public class ExportController {

    @PostMapping("/pdf")
    public ResponseEntity<byte[]> exportPdf(@PathVariable String id);

    @PostMapping("/html")
    public ResponseEntity<byte[]> exportHtml(@PathVariable String id);

    @PostMapping("/txt")
    public ResponseEntity<byte[]> exportTxt(@PathVariable String id);
}
```

#### TASK-408: WebSocket 配置

**文件**:
- `backend/src/main/java/com/emr/config/WebSocketConfig.java`
- `backend/src/main/java/com/emr/websocket/DocumentWebSocketHandler.java`

---

## 4. 任务执行计划

### Sprint 1: 项目初始化 (Day 1-2)
```
TASK-001: 前端脚手架      [4h]
TASK-002: 后端脚手架      [4h]
TASK-401: 后端基础配置    [2h]
TASK-402: 安全配置         [4h]
TASK-403: 实体类           [2h]
```

### Sprint 2: 渲染引擎核心 (Day 3-6)
```
TASK-101: 文档数据模型    [4h]
TASK-102: Canvas 渲染器   [8h]
TASK-103: 文本测量器      [4h]
TASK-104: 换行引擎        [6h]
TASK-105: 分页引擎        [8h]
TASK-106: 位置计算器      [4h]
TASK-107: 文本粒子渲染    [4h]
```

### Sprint 3: 编辑交互 (Day 7-10)
```
TASK-201: Editor Facade   [4h]
TASK-202: 命令系统        [8h]
TASK-203: 选区管理器      [4h]
TASK-204: 键盘事件        [6h]
TASK-205: 鼠标事件        [4h]
TASK-206: IME 处理        [4h]
```

### Sprint 4: React UI (Day 11-14)
```
TASK-301: EditorProvider   [4h]
TASK-302: 布局组件        [12h]
TASK-303: 编辑器页面      [4h]
TASK-304: 对话框组件      [8h]
```

### Sprint 5: 后端 API 完善 (Day 15-18)
```
TASK-404: 文档 CRUD API   [8h]
TASK-405: 模板 API         [4h]
TASK-406: 认证 API         [4h]
TASK-407: 导出 API         [8h]
TASK-408: WebSocket        [6h]
```

### Sprint 6: 集成测试与交付 (Day 19-20)
```
联调测试                  [8h]
Bug 修复                  [8h]
文档整理                   [4h]
```

---

## 5. 质量门禁

每个 Sprint 结束前必须通过：

1. **构建门禁**: `npm run build` 零错误 / `mvn package` 成功
2. **类型门禁**: `tsc --noEmit` 零错误
3. **Lint 门禁**: `npm run lint` 零 error
4. **测试门禁**: 核心模块单元测试覆盖率 > 80%
5. **UI 门禁**: 与 output/4-uiux.md 视觉一致性检查
6. **图标门禁**: 源码中无 emoji 字符
