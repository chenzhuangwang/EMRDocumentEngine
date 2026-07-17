# 架构设计文档 - 文档编辑器引擎

> 版本: v1.0 | 日期: 2026-07-17 | 阶段: docs

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
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────────────┐  │  │
│  │  │ Document │ │ Layout   │ │ Render                   │  │  │
│  │  │ Model    │ │ Engine   │ │ Engine (Canvas + SVG)    │  │  │
│  │  ├──────────┤ ├──────────┤ ├──────────────────────────┤  │  │
│  │  │ Element  │ │ Line     │ │ TextParticle             │  │  │
│  │  │ Tree     │ │ Breaking │ │ ImageParticle            │  │  │
│  │  │ Style    │ │ Page     │ │ TableParticle            │  │  │
│  │  │ Props    │ │ Breaking │ │ ControlParticle          │  │  │
│  │  └──────────┘ └──────────┘ └──────────────────────────┘  │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │                   交互层 (Interaction)                     │  │
│  │  Keyboard | Mouse | Touch | IME | Clipboard | DnD       │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │                   状态管理层 (State)                        │  │
│  │  Command System | Undo/Redo | Selection | Cursor        │  │
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
│  │                    API 网关层                              │  │
│  │  REST Controllers | WebSocket Handlers                    │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │                    业务服务层                              │  │
│  │  DocumentService | TemplateService | UserService         │  │
│  │  PrintService | ExportService | CollaborationService     │  │
│  │  PermissionService | AuditService                        │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │                    数据访问层                              │  │
│  │  Mybatis-Plus Repositories | Redis Cache                 │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │                    基础设施层                              │  │
│  │  MySQL | Redis | MinIO | RabbitMQ                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计原则

1. **数据与视图分离**：文档数据模型（JSON）与渲染视图（Canvas）完全解耦
2. **命令模式**：所有编辑操作封装为命令，天然支持 Undo/Redo
3. **增量渲染**：只重绘变更区域，保证长文档编辑流畅
4. **插件化元素**：每种文档元素以独立 Particle 类实现，支持扩展
5. **前后端契约优先**：API 契约先于实现，Swagger/OpenAPI 文档驱动开发

---

## 2. 前端架构设计

### 2.1 文档数据模型

```typescript
// 核心元素接口（扩展自 canvas-editor 模型）
interface IElement {
  // 基础属性
  id: string;                    // 唯一标识 (UUID)
  type: ElementType;             // 元素类型
  value: string;                 // 内容值

  // 文本样式
  font?: string;                 // 字体
  size?: number;                 // 字号
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  underlineStyle?: 'single' | 'double' | 'wave';
  strikeout?: boolean;
  color?: string;                // 文字颜色
  highlight?: string;            // 高亮颜色
  superscript?: boolean;
  subscript?: boolean;

  // 段落样式
  rowFlex?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFY';
  rowMargin?: number;            // 段间距
  lineHeight?: number;           // 行间距
  indent?: number;               // 首行缩进

  // 元素特有属性（按类型不同）
  trList?: ITr[];                // 表格行
  control?: IControl;            // 表单控件
  imageData?: IImageData;        // 图片数据

  // 留痕与权限
  revision?: IRevision;          // 修订信息
  permission?: IPermission;      // 权限信息
  validation?: IValidation;      // 校验规则

  // 业务扩展（开放给上层）
  extension?: Record<string, unknown>;
}

// 元素类型枚举
enum ElementType {
  TEXT = 'text',
  IMAGE = 'image',
  TABLE = 'table',
  CONTROL = 'control',
  PAGE_BREAK = 'page_break',
  SEPARATOR = 'separator',
  HYPERLINK = 'hyperlink',
  LATEX = 'latex',
  BARCODE = 'barcode',
  QRCODE = 'qrcode',
}

// 表单控件配置
interface IControl {
  controlType: 'input' | 'select' | 'date' | 'checkbox' | 'radio' | 'number';
  placeholder?: string;
  options?: IControlOption[];    // 下拉选项
  multiple?: boolean;            // 多选
  min?: number;                  // 数值范围
  max?: number;
  maxLength?: number;            // 字符限制
  dataBinding?: IDataBinding;    // 数据源绑定
  readonly?: boolean;
  required?: boolean;
}

// 数据绑定
interface IDataBinding {
  source: string;                // 数据源路径（JSONPath）
  property: string;              // 绑定属性
  expression?: string;           // 变换表达式
}

// 校验规则
interface IValidation {
  required?: boolean;
  pattern?: string;              // 正则表达式
  min?: number;
  max?: number;
  maxLength?: number;
  message?: string;              // 错误提示
}

// 修订信息
interface IRevision {
  type: 'insert' | 'delete' | 'modify';
  author: string;
  timestamp: number;
  style?: {                      // 留痕样式
    color?: string;
    underlineStyle?: string;
  };
}

// 权限信息
interface IPermission {
  level: number;                 // 权限等级 (1-5)
  creatorId: string;
  editable: boolean;
  deletable: boolean;
}

// 文档数据
interface IDocument {
  id: string;
  title: string;
  templateId?: string;
  header: IElement[];            // 页眉
  main: IElement[];              // 正文
  footer: IElement[];            // 页脚
  pageSetup: IPageSetup;
  metadata: IDocumentMetadata;
}
```

### 2.2 渲染管道

```
IElement[] 原始数组
    │
    ▼
[格式化] formatElementList()
    │  展开虚拟元素、注入零宽字符、生成ID
    ▼
[拆分] unzipElementList()
    │  多字符元素拆分为单字符元素
    ▼
[布局] LayoutEngine.compute()
    │  计算换行、分页、每个元素的坐标 (x, y, width, height)
    ▼
[定位] Position.assign()
    │  分配像素坐标，生成 positionList
    ▼
[渲染] Particle.render()
    │  按页、按行调用各粒子类绘制到 Canvas
    ▼
[压缩] zipElementList()
    │  合并相邻相同样式元素，恢复为紧凑数组
```

### 2.3 核心模块

```
src/engine/
├── document/
│   ├── DocumentModel.ts         # 文档数据模型
│   ├── ElementFactory.ts        # 元素工厂
│   └── ElementValidator.ts      # 元素校验
├── layout/
│   ├── LayoutEngine.ts          # 布局引擎入口
│   ├── LineBreaker.ts           # 换行计算
│   ├── PageBreaker.ts           # 分页计算
│   └── TextMeasurer.ts          # 文字测量（Canvas measureText）
├── render/
│   ├── Draw.ts                  # 中心渲染编排器
│   ├── particles/
│   │   ├── TextParticle.ts      # 文本粒子
│   │   ├── ImageParticle.ts     # 图片粒子
│   │   ├── TableParticle.ts     # 表格粒子
│   │   ├── ControlParticle.ts   # 控件粒子
│   │   └── BaseParticle.ts      # 粒子基类
│   ├── frames/
│   │   ├── HeaderFrame.ts       # 页眉
│   │   ├── FooterFrame.ts       # 页脚
│   │   ├── PageNumberFrame.ts   # 页码
│   │   ├── WatermarkFrame.ts    # 水印
│   │   └── MarginFrame.ts       # 页边距指示
│   └── Cursor.ts                # 光标渲染
├── interaction/
│   ├── CanvasEvent.ts           # 事件分发
│   ├── KeyboardHandler.ts       # 键盘处理
│   ├── MouseHandler.ts          # 鼠标处理
│   ├── IMEHandler.ts            # 输入法处理
│   ├── ClipboardHandler.ts      # 剪贴板处理
│   └── DragHandler.ts           # 拖拽处理
├── command/
│   ├── CommandManager.ts        # 命令管理器
│   ├── commands/
│   │   ├── InsertText.ts
│   │   ├── DeleteText.ts
│   │   ├── FormatText.ts
│   │   ├── InsertElement.ts
│   │   └── ModifyElement.ts
│   └── HistoryManager.ts        # 撤销/重做栈
├── state/
│   ├── EditorState.ts           # 编辑器状态
│   ├── RangeManager.ts          # 选区管理
│   └── ZoneManager.ts           # 编辑区域管理
└── Editor.ts                    # 编辑器入口 (Facade)
```

### 2.4 编辑器模式

```typescript
enum EditorMode {
  EDIT = 'edit',                 // 标准编辑
  READONLY = 'readonly',         // 只读
  FORM = 'form',                 // 仅表单可编辑
  DESIGN = 'design',             // 模板设计（忽略只读限制）
  CLEAN = 'clean',               // 清洁模式（隐藏留痕标记）
  PRINT = 'print',               // 打印预览
}

enum PageMode {
  PAGING = 'paging',             // 分页视图
  LINKAGE = 'linkage',           // 连续滚动
}
```

### 2.5 前端技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 框架 | React | 18.3+ |
| 语言 | TypeScript | 5.5+ |
| 构建 | Vite | 5.4+ |
| UI 组件库 | shadcn/ui (Radix) | latest |
| 图标 | Lucide React | 0.400+ |
| 状态管理 | Zustand | 5.x |
| HTTP 客户端 | Axios | 1.7+ |
| WebSocket | SockJS + Stomp | latest |
| 协作 CRDT | Yjs | 13.x |
| 测试 | Vitest + Playwright | latest |

---

## 3. 后端架构设计

### 3.1 分层架构

```
src/main/java/com/emr/
├── controller/
│   ├── DocumentController.java      # 文档 CRUD API
│   ├── TemplateController.java      # 模板管理 API
│   ├── UserController.java          # 用户管理 API
│   ├── ExportController.java        # 导出 API
│   ├── PrintController.java         # 打印 API
│   └── CollaborationController.java # 协作 API
├── service/
│   ├── DocumentService.java
│   ├── TemplateService.java
│   ├── UserService.java
│   ├── ExportService.java
│   ├── PdfService.java
│   ├── PrintService.java
│   ├── CollaborationService.java
│   ├── PermissionService.java
│   └── AuditService.java
├── repository/
│   ├── DocumentRepository.java
│   ├── TemplateRepository.java
│   ├── UserRepository.java
│   └── AuditLogRepository.java
├── entity/
│   ├── Document.java
│   ├── Template.java
│   ├── User.java
│   └── AuditLog.java
├── dto/
│   ├── DocumentDTO.java
│   ├── TemplateDTO.java
│   ├── DocumentListDTO.java
│   └── ApiResponse.java
├── config/
│   ├── SecurityConfig.java
│   ├── WebSocketConfig.java
│   ├── RedisConfig.java
│   └── CorsConfig.java
├── websocket/
│   ├── DocumentWebSocketHandler.java
│   └── CollaborationSessionManager.java
└── util/
    ├── JwtUtil.java
    └── JsonUtil.java
```

### 3.2 数据库设计

#### 核心表结构

```sql
-- 文档表
CREATE TABLE t_document (
    id          VARCHAR(64)  PRIMARY KEY,
    title       VARCHAR(255) NOT NULL,
    template_id VARCHAR(64),
    content     JSON         NOT NULL COMMENT '文档JSON内容（IElement[]）',
    status      VARCHAR(20)  DEFAULT 'draft' COMMENT 'draft/published/archived',
    version     INT          DEFAULT 1,
    created_by  VARCHAR(64)  NOT NULL,
    updated_by  VARCHAR(64),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_template_id (template_id),
    INDEX idx_created_by (created_by),
    INDEX idx_status (status)
);

-- 模板表
CREATE TABLE t_template (
    id          VARCHAR(64)  PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    category    VARCHAR(100),
    description TEXT,
    content     JSON         NOT NULL COMMENT '模板JSON内容',
    thumbnail   VARCHAR(500) COMMENT '缩略图URL',
    is_public   TINYINT      DEFAULT 0 COMMENT '是否公开模板',
    version     INT          DEFAULT 1,
    created_by  VARCHAR(64)  NOT NULL,
    updated_by  VARCHAR(64),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_created_by (created_by)
);

-- 用户表
CREATE TABLE t_user (
    id          VARCHAR(64)  PRIMARY KEY,
    username    VARCHAR(100) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    real_name   VARCHAR(100),
    role        VARCHAR(50)  DEFAULT 'user' COMMENT 'admin/designer/user/viewer',
    enabled     TINYINT      DEFAULT 1,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
);

-- 操作审计日志表
CREATE TABLE t_audit_log (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    user_id     VARCHAR(64)  NOT NULL,
    action      VARCHAR(50)  NOT NULL COMMENT 'create/edit/delete/print/export/view',
    detail      JSON         COMMENT '操作详情',
    ip_address  VARCHAR(50),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_document_id (document_id),
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
);

-- 文档版本表
CREATE TABLE t_document_version (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    version     INT          NOT NULL,
    content     JSON         NOT NULL,
    created_by  VARCHAR(64)  NOT NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_document_id_version (document_id, version)
);

-- 批注表
CREATE TABLE t_annotation (
    id          VARCHAR(64)  PRIMARY KEY,
    document_id VARCHAR(64)  NOT NULL,
    element_id  VARCHAR(64)  COMMENT '关联的元素ID',
    content     TEXT         NOT NULL,
    status      VARCHAR(20)  DEFAULT 'open' COMMENT 'open/resolved',
    created_by  VARCHAR(64)  NOT NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_document_id (document_id)
);

-- 批注回复表
CREATE TABLE t_annotation_reply (
    id            VARCHAR(64)  PRIMARY KEY,
    annotation_id VARCHAR(64)  NOT NULL,
    content       TEXT         NOT NULL,
    created_by    VARCHAR(64)  NOT NULL,
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_annotation_id (annotation_id)
);
```

### 3.3 REST API 设计

```
# 文档管理
GET    /api/v1/documents              # 文档列表（分页、筛选）
POST   /api/v1/documents              # 创建文档
GET    /api/v1/documents/{id}         # 获取文档详情
PUT    /api/v1/documents/{id}         # 更新文档
DELETE /api/v1/documents/{id}         # 删除文档

# 模板管理
GET    /api/v1/templates              # 模板列表
POST   /api/v1/templates              # 创建模板
GET    /api/v1/templates/{id}         # 获取模板详情
PUT    /api/v1/templates/{id}         # 更新模板
DELETE /api/v1/templates/{id}         # 删除模板

# 导出
POST   /api/v1/documents/{id}/export/pdf    # 导出PDF
POST   /api/v1/documents/{id}/export/html   # 导出HTML
POST   /api/v1/documents/{id}/export/txt    # 导出TXT

# 打印
POST   /api/v1/documents/{id}/print         # 触发打印任务

# 批注
GET    /api/v1/documents/{id}/annotations           # 获取批注列表
POST   /api/v1/documents/{id}/annotations           # 创建批注
PUT    /api/v1/documents/{id}/annotations/{aid}     # 更新批注
DELETE /api/v1/documents/{id}/annotations/{aid}     # 删除批注
POST   /api/v1/documents/{id}/annotations/{aid}/replies  # 回复批注

# 版本
GET    /api/v1/documents/{id}/versions          # 版本列表
GET    /api/v1/documents/{id}/versions/{vid}    # 获取特定版本
POST   /api/v1/documents/{id}/versions/{vid}/restore  # 回滚到版本

# 审计
GET    /api/v1/documents/{id}/audit-logs        # 操作日志

# 用户认证
POST   /api/v1/auth/login       # 登录
POST   /api/v1/auth/logout      # 登出
POST   /api/v1/auth/refresh     # 刷新 token
GET    /api/v1/auth/me          # 当前用户信息

# 协作（WebSocket）
WS     /ws/documents/{id}       # 文档协作通道
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
| 文档转换 | Apache POI + iText | latest |
| 对象存储 | MinIO | latest |
| API 文档 | SpringDoc OpenAPI | 2.5+ |
| 构建 | Maven | 3.9+ |

---

## 4. 数据流设计

### 4.1 编辑数据流

```
用户键盘输入
    │
    ▼
CanvasEvent (keydown/input)
    │
    ▼
KeyboardHandler / IMEHandler
    │
    ▼
CommandAdapt.executeCommand(InsertText)
    │
    ▼
DocumentModel 更新 IElement[]
    │
    ▼
HistoryManager 记录快照
    │
    ▼
LayoutEngine 增量重算布局
    │
    ▼
Draw.render() 增量重绘 Canvas
    │
    ▼
用户看到更新后的文档
```

### 4.2 保存数据流

```
用户触发保存 (Ctrl+S / 自动保存)
    │
    ▼
Editor.getValue() → IDocument JSON
    │
    ▼
API Client → PUT /api/v1/documents/{id}
    │
    ▼
DocumentController → DocumentService
    │
    ▼
保存到 MySQL → 返回成功
    │
    ▼
AuditService 记录操作日志
    │
    ▼
前端更新保存状态指示器
```

### 4.3 协作数据流

```
用户 A 编辑
    │
    ▼
Yjs 生成 CRDT 操作 (delta)
    │
    ▼
WebSocket 发送 delta → 后端 CollaborationService
    │
    ▼
后端广播 delta → 所有连接用户
    │
    ▼
用户 B/C Yjs 应用 delta → 文档更新
    │
    ▼
各自本地重渲染
```

---

## 5. 部署架构

```
┌──────────────────────────────────────────────┐
│                  Nginx (反向代理)              │
│  /          → Frontend (Static)              │
│  /api/*     → Backend (SpringBoot:8080)      │
│  /ws/*      → Backend (WebSocket)            │
└──────────────────────────────────────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌────────────────────────┐
│ MinIO  │ │  SpringBoot Backend    │
│ (文件)  │ │  (可水平扩展)            │
└────────┘ └───────┬────────────────┘
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
     ┌───────┐ ┌───────┐ ┌──────────┐
     │ MySQL │ │ Redis │ │ RabbitMQ │
     └───────┘ └───────┘ └──────────┘
```

---

## 6. 安全设计

### 6.1 认证流程
1. 用户登录 → 后端验证 → 返回 JWT (Access Token + Refresh Token)
2. 前端存储 Access Token 于内存，Refresh Token 于 httpOnly Cookie
3. 每次请求携带 Authorization: Bearer {token}
4. Token 过期 → 自动用 Refresh Token 刷新

### 6.2 权限模型

```
权限等级 (1-5):
  L5: 系统管理员  - 全部权限
  L4: 文档所有者  - 编辑/删除/批注/打印/导出
  L3: 编辑者      - 编辑/批注/打印/导出
  L2: 批注者      - 批注/查看/打印/导出
  L1: 只读者      - 查看/打印/导出
```

### 6.3 数据安全
- 文档内容加密存储（AES-256）
- API 请求频率限制（Rate Limiting）
- SQL 注入防护（Mybatis 参数化查询）
- XSS 防护（输入过滤 + 输出编码）
