

# EMR 文档编辑器引擎

## 📋 项目简介

EMR 文档编辑器引擎是一个专业的电子病历文档编辑系统，提供完整的文档创建、编辑、模板管理和协作功能。系统采用前后端分离架构，前端基于 Canvas 渲染技术实现高性能文档编辑，后端采用 Spring Boot + MyBatis-Plus 构建，提供 RESTful API 和 WebSocket 实时协作支持。

## ✨ 核心特性

- **专业文档编辑**：支持富文本编辑、结构化元素、公式录入、表格处理等专业功能
- **模板系统**：提供灵活的模板分类管理，支持公共模板和私有模板
- **分页预览**：真实还原 A4 纸张排版效果，支持打印预览
- **权限管控**：基于角色的访问控制，支持文档批注和修改留痕
- **实时协作**：WebSocket 支持多人实时协作编辑
- **版本管理**：完整的历史版本记录，支持版本回溯
- **数据校验**：支持表单元素的数据校验和必填项检查
- **审计追踪**：详细记录文档操作日志，满足合规要求

## 🛠 技术栈

### 前端技术
- **框架**：React 18 + TypeScript
- **构建工具**：Vite
- **样式方案**：Tailwind CSS
- **状态管理**：Redux Toolkit
- **HTTP 客户端**：Axios
- **渲染引擎**：HTML5 Canvas 自研渲染器
- **事件系统**：自定义事件总线

### 后端技术
- **运行环境**：Java 17+
- **框架**：Spring Boot 3.x
- **数据访问**：MyBatis-Plus
- **安全框架**：Spring Security + JWT
- **实时通信**：WebSocket (Spring Boot)
- **数据库**：MySQL 8.0+

## 📁 项目结构

```
emr-document-engine/
├── backend/                    # 后端服务
│   ├── src/main/java/com/emr/
│   │   ├── config/            # 配置类
│   │   │   ├── SecurityConfig.java     # 安全配置
│   │   │   ├── WebSocketConfig.java    # WebSocket 配置
│   │   │   └── MybatisPlusConfig.java  # MyBatis-Plus 配置
│   │   ├── controller/        # 控制器层
│   │   │   ├── AuthController.java     # 认证接口
│   │   │   ├── DocumentController.java # 文档管理接口
│   │   │   └── TemplateController.java # 模板管理接口
│   │   ├── service/           # 业务逻辑层
│   │   │   ├── AuthService.java
│   │   │   ├── DocumentService.java
│   │   │   └── TemplateService.java
│   │   ├── entity/            # 实体类
│   │   │   ├── Document.java
│   │   │   ├── Template.java
│   │   │   ├── User.java
│   │   │   ├── Annotation.java
│   │   │   ├── AuditLog.java
│   │   │   └── DocumentVersion.java
│   │   ├── repository/        # 数据访问层
│   │   ├── dto/               # 数据传输对象
│   │   └── util/              # 工具类
│   │       └── JwtUtil.java
│   └── resources/
│       └── application.yml    # 应用配置
│
├── frontend/                   # 前端应用
│   ├── src/
│   │   ├── components/        # React 组件
│   │   │   ├── editor/        # 编辑器核心组件
│   │   │   │   └── EditorProvider.tsx
│   │   │   └── layout/        # 布局组件
│   │   │       ├── EditorLayout.tsx
│   │   │       ├── HeaderBar.tsx
│   │   │       ├── Sidebar.tsx
│   │   │       ├── Toolbar.tsx
│   │   │       ├── PropertiesPanel.tsx
│   │   │       └── StatusBar.tsx
│   │   ├── engine/            # 编辑器引擎核心
│   │   │   ├── Editor.ts              # 编辑器主类
│   │   │   ├── EventBus.ts            # 事件总线
│   │   │   ├── document/              # 文档模型
│   │   │   │   ├── DocumentModel.ts
│   │   │   │   └── ElementFormatter.ts
│   │   │   ├── render/                # 渲染模块
│   │   │   │   └── Draw.ts
│   │   │   ├── layout/                # 布局引擎
│   │   │   │   └── TextMeasurer.ts
│   │   │   └── state/                 # 状态管理
│   │   │       ├── HistoryManager.ts
│   │   │       └── Position.ts
│   │   ├── pages/             # 页面组件
│   │   │   ├── EditorPage.tsx
│   │   │   └── HomePage.tsx
│   │   ├── services/          # API 服务
│   │   │   └── api.ts
│   │   ├── store/             # 状态存储
│   │   │   └── index.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
│
├── output/                     # 文档输出目录
│   ├── 1-research.md          # 调研报告
│   ├── 2-prd.md               # 产品需求文档
│   ├── 3-architecture.md      # 架构设计文档
│   ├── 4-uiux.md              # UI/UX 设计文档
│   └── 5-spec.md              # 技术规格说明书
│
└── .super-dev/                # 开发配置
    ├── SESSION_BRIEF.md
    └── WORKFLOW.md
```

## 🚀 快速开始

### 环境要求

- Node.js 18+
- Java 17+
- MySQL 8.0+

### 后端部署

1. **创建数据库**

```sql
CREATE DATABASE emr_document_engine DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

2. **配置数据库连接**

编辑 `backend/src/main/resources/application.yml`：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/emr_document_engine?useSSL=false&serverTimezone=UTC
    username: your_username
    password: your_password
```

3. **构建运行**

```bash
cd backend
./mvnw spring-boot:run
```

后端服务将在 `http://localhost:8080` 启动。

### 前端部署

1. **安装依赖**

```bash
cd frontend
npm install
```

2. **启动开发服务器**

```bash
npm run dev
```

前端应用将在 `http://localhost:5173` 启动。

3. **生产构建**

```bash
npm run build
```

## 📡 API 接口

### 认证接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/login` | 用户登录 |
| POST | `/api/v1/auth/logout` | 用户登出 |
| GET | `/api/v1/auth/me` | 获取当前用户信息 |

### 文档接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/documents` | 获取文档列表（分页） |
| POST | `/api/v1/documents` | 创建新文档 |
| GET | `/api/v1/documents/{id}` | 获取文档详情 |
| PUT | `/api/v1/documents/{id}` | 更新文档 |
| DELETE | `/api/v1/documents/{id}` | 删除文档 |

### 模板接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/templates` | 获取模板列表 |
| GET | `/api/v1/templates/{id}` | 获取模板详情 |
| POST | `/api/v1/templates` | 创建模板 |
| PUT | `/api/v1/templates/{id}` | 更新模板 |
| DELETE | `/api/v1/templates/{id}` | 删除模板 |

## 🧩 核心模块

### 前端编辑器引擎

编辑器引擎采用模块化设计，核心组件包括：

- **DocumentModel**：文档数据模型，管理文档元素树
- **Draw**：Canvas 渲染器，负责元素可视化
- **TextMeasurer**：文本测量器，计算文字宽高
- **HistoryManager**：历史管理器，支持撤销/重做
- **EventBus**：事件总线，处理组件间通信

### 后端服务层

- **DocumentService**：文档业务逻辑处理
- **TemplateService**：模板业务逻辑处理
- **AuthService**：认证授权服务

## 📊 数据库表结构

| 表名 | 说明 |
|------|------|
| `t_user` | 用户信息表 |
| `t_document` | 文档主表 |
| `t_template` | 模板表 |
| `t_annotation` | 批注表 |
| `t_audit_log` | 审计日志表 |
| `t_document_version` | 文档版本表 |

## 📝 开发说明

### 前端开发

1. 编辑器引擎核心代码位于 `src/engine/` 目录
2. React 组件位于 `src/components/` 目录
3. API 服务定义在 `src/services/api.ts`
4. 全局状态管理在 `src/store/index.ts`

### 后端开发

1. 控制器层位于 `controller/` 目录
2. 业务逻辑在 `service/` 目录实现
3. 数据访问通过 `repository/` 接口
4. 实体类定义在 `entity/` 目录

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源协议。

## 📞 联系方式

如有问题或建议，请通过项目 Issues 页面反馈。

---

**感谢使用 EMR 文档编辑器引擎！**