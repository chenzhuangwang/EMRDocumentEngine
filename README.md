

# EMR 文档编辑器引擎

> 🚀 在线预览：<http://139.196.151.15/>

## 项目简介

EMR 文档编辑器引擎是一个专业的电子病历文档编辑系统，提供完整的文档创建、编辑、模板管理和协作功能。系统采用前后端分离架构，前端基于 Canvas 渲染技术实现高性能文档编辑，后端采用 Spring Boot + MyBatis-Plus 构建，提供 RESTful API 和 WebSocket 实时协作支持。

## 核心特性

- **专业文档编辑**：支持富文本编辑、结构化元素、公式录入、表格处理等专业功能
- **模板系统**：提供灵活的模板分类管理，支持公共模板和私有模板
- **分页预览**：真实还原 A4 纸张排版效果，支持打印预览
- **权限管控**：基于角色的访问控制，支持文档批注和修改留痕
- **实时协作**：WebSocket 支持多人实时协作编辑
- **版本管理**：完整的历史版本记录，支持版本回溯
- **数据校验**：支持表单元素的数据校验和必填项检查
- **审计追踪**：详细记录文档操作日志，满足合规要求
- **框架/平台无关运行时**：编辑器引擎经 `EditorHost` 能力接口（文本/字体/渲染表面/视口/输入/平台）解耦宿主环境，可嵌入 React、Vue、Electron、Web Worker 等任意宿主，引擎源码零浏览器全局

## 技术栈

### 前端技术
- **框架**：React 18 + TypeScript
- **构建工具**：Vite
- **样式方案**：Tailwind CSS
- **状态管理**：Zustand
- **UI 组件**：Radix UI + Lucide 图标
- **HTTP 客户端**：Axios
- **渲染引擎**：HTML5 Canvas 自研渲染器
- **实时协作**：Yjs + y-websocket
- **公式渲染**：KaTeX
- **事件系统**：自定义事件总线

### 后端技术
- **运行环境**：Java 17+
- **框架**：Spring Boot 3.x
- **数据访问**：MyBatis-Plus
- **安全框架**：Spring Security + JWT
- **实时通信**：WebSocket (Spring Boot)
- **缓存**：Redis (spring-boot-starter-data-redis)
- **接口文档**：Springdoc OpenAPI (Swagger)
- **数据库**：MySQL 8.0+（测试环境 H2）
- **辅助工具**：Lombok + Bean Validation

## 项目结构

```
EMRDocumentEngine/
├── backend/                    # 后端服务
│   ├── src/main/java/com/emr/
│   │   ├── config/            # 配置类（安全、WebSocket、MyBatis-Plus 等）
│   │   ├── controller/        # 控制器层
│   │   ├── service/           # 业务逻辑层（含 impl/）
│   │   ├── entity/            # 实体类
│   │   ├── repository/        # 数据访问层
│   │   ├── dto/               # 数据传输对象
│   │   ├── util/              # 工具类
│   │   └── websocket/         # WebSocket 实时协作
│   └── resources/
│       └── application.yml    # 应用配置
│
├── frontend/                   # 前端应用
│   ├── src/
│   │   ├── components/        # React 组件
│   │   │   ├── editor/        # 编辑器核心组件
│   │   │   ├── layout/        # 布局组件
│   │   │   ├── panels/        # 属性面板
│   │   │   ├── sidebar/       # 侧边栏
│   │   │   ├── toolbar/       # 工具栏
│   │   │   ├── dialogs/       # 对话框
│   │   │   ├── views/         # 视图组件
│   │   │   └── ui/            # 基础 UI 组件
│   │   ├── engine/            # 编辑器引擎核心
│   │   │   ├── Editor.ts              # 编辑器主类
│   │   │   ├── EventBus.ts            # 事件总线
│   │   │   ├── AutoSaveManager.ts     # 自动保存
│   │   │   ├── DocumentDiffer.ts      # 文档差异对比
│   │   │   ├── FindReplaceEngine.ts   # 查找替换
│   │   │   ├── command/               # 命令系统（撤销/重做）
│   │   │   ├── document/              # 文档模型
│   │   │   ├── host/                  # Host 能力接口（EditorHost 六元组）
│   │   │   ├── render/                # 渲染模块
│   │   │   ├── layout/                # 布局引擎
│   │   │   ├── interaction/           # 交互处理
│   │   │   ├── state/                 # 状态管理
│   │   │   ├── plugins/               # 插件系统
│   │   │   ├── qc/                    # 质量控制
│   │   │   ├── security/              # 安全模块
│   │   │   ├── loaders/               # 加载器
│   │   │   ├── i18n/                  # 国际化
│   │   │   └── __tests__/             # 引擎单元测试
│   │   ├── platform/          # 宿主平台实现（浏览器能力注入到 engine）
│   │   │   └── dom/           #   DOM 宿主（Canvas/剪贴板/IndexedDB 等）
│   │   ├── pages/             # 页面组件
│   │   ├── services/          # API 服务
│   │   ├── store/             # 全局状态（Zustand）
│   │   ├── lib/               # 工具函数
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── Dockerfile            # 前端容器化配置
│   └── nginx.conf            # Nginx 配置
│
├── output/                     # 项目文档输出目录
│   ├── 1-research.md          # 调研报告
│   ├── 2-prd.md               # 产品需求文档
│   ├── 3-architecture.md      # 架构设计文档
│   ├── 4-uiux.md              # UI/UX 设计文档
│   └── 5-spec.md              # 技术规格说明书
│
├── knowledge/                  # 知识库
├── docker-compose.yml         # Docker 编排配置
├── nginx.conf                 # Nginx 配置
├── LICENSE                    # MIT 许可证
└── README.md                  # 项目说明文档
```

## 快速开始

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

前端应用将在 `http://localhost:3000` 启动。

3. **生产构建**

```bash
npm run build
```

### Docker 部署

```bash
docker-compose up -d
```

## API 接口

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

## 核心模块

### 前端编辑器引擎

编辑器引擎采用模块化设计，核心组件包括：

- **DocumentModel**：文档数据模型，管理文档元素树
- **Draw**：Canvas 渲染器，负责元素可视化
- **TextMeasurer**：文本测量器，计算文字宽高
- **HistoryManager**：历史管理器，支持撤销/重做
- **EventBus**：事件总线，处理组件间通信
- **KeyboardHandler**：键盘事件处理器
- **RangeManager**：选区管理器
- **EditorHost**：平台能力边界（六元组 `text/font/surface/viewport/input/platform`），浏览器能力经此注入引擎，实现框架/平台无关

### 后端服务层

- **DocumentService**：文档业务逻辑处理
- **TemplateService**：模板业务逻辑处理
- **AuthService**：认证授权服务
- **AuditLogRepository**：审计日志数据访问

## 数据库表结构

| 表名 | 说明 |
|------|------|
| `t_user` | 用户信息表 |
| `t_document` | 文档主表 |
| `t_template` | 模板表 |
| `t_annotation` | 批注表 |
| `t_audit_log` | 审计日志表 |
| `t_document_version` | 文档版本表 |

## 开发说明

### AI 辅助开发（Claude）

本项目使用 Claude 进行 AI 辅助开发。为约束 AI 的代码行为、确保架构边界不被破坏，仓库维护了一套「AI 编辑契约」：

- `.claude/CLAUDE.md`：AI 入口提示，指示 AI 在修改 `frontend/src/engine` 前必须先阅读契约。
- `.claude/AI_EDITOR_CONTRACT.md`：架构不变量契约，定义引擎的强制边界，例如：引擎不得依赖 React 与浏览器全局、所有文档变更必须经过 Command 系统、每个可变事实必须有唯一 owner、文档模型不得依赖布局/渲染等。

AI 在实现、重构、审查代码时，须将契约视为硬约束；如需打破某条不变量，必须先说明原因、评估影响并取得明确授权，不得静默违反。

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

### 代码规范

- 前端使用 TypeScript 严格模式（`strict`），提交前请运行 `npm run test`（Vitest）与 `npm run build`（含 `tsc --noEmit` 类型检查）
- 后端遵循阿里巴巴 Java 开发手册规范

## 项目文档

项目包含以下详细文档：

- [调研报告](/output/1-research.md) - 技术选型与竞品分析
- [产品需求文档](/output/2-prd.md) - 功能需求与用户故事
- [架构设计文档](/output/3-architecture.md) - 系统架构与技术方案
- [UI/UX 设计文档](/output/4-uiux.md) - 界面设计与交互规范
- [技术规格说明书](/output/5-spec.md) - 详细技术规格与任务分解

## 许可证

本项目基于 [MIT License](LICENSE) 开源协议。

## 参与贡献

首先，由衷地感谢你愿意为这个项目停下脚步、贡献一份力量 ❤️。无论你是经验丰富的开发者，还是第一次接触开源的新朋友，你的每一条建议、每一行代码、每一次文档修订，对 EMR 文档编辑器引擎来说都弥足珍贵。

一个真正好用的电子病历编辑工具，离不开社区里每一位伙伴的共同努力。这里没有「新人」与「老人」之分，只有对产品的热爱和对技术的好奇。所以请放心大胆地参与进来——哪怕只是纠正一个错别字、提出一个「也许很傻」的问题，我们都会认真对待、心怀感激。

### 你可以如何参与

| 参与方式 | 适合人群 | 说明 |
|---------|---------|------|
| 🐛 报告 Bug | 所有使用者 | 描述问题现象、复现步骤与运行环境，帮助我们发现并修复问题 |
| 💡 提出建议 | 所有使用者 | 对功能、体验、文档的任何想法，都可以通过 Issue 告诉我们 |
| 🛠️ 提交代码 | 开发者 | 修复 Bug、实现新功能、优化性能，或补充单元测试 |
| 📖 完善文档 | 所有人 | 改进 README、代码注释、设计文档，让项目更容易被理解和上手 |
| 👀 代码评审 | 开发者 | 帮忙 review PR、参与技术讨论，你的意见能显著提升代码质量 |

### 贡献流程

如果你准备动手写代码，可以参考下面的流程。别担心步骤繁琐，一步一步来，遇到任何卡住的地方，随时在 Issue 里提问，我们会第一时间回应。

1. **先沟通，再动手**：开始之前，建议先到 [Issues](https://gitee.com/wangwang_1_1665527118/emrdocument-engine/issues) 页面看看是否已有相关讨论。如果是全新的功能或较大的改动，请先开一个 Issue 说明你的想法，和社区达成共识后再动手，避免白费力气。

2. **Fork 本仓库**：点击页面右上角的 Fork 按钮，将项目复制到你的账号下。

3. **克隆到本地**：

   ```bash
   git clone https://gitee.com/你的用户名/emrdocument-engine.git
   cd emrdocument-engine
   ```

4. **创建功能分支**：

   ```bash
   git checkout -b feature/你的功能名
   ```

5. **开发并提交**：完成代码后，遵循下方的提交规范进行提交：

   ```bash
   git add .
   git commit -m "feat: 新增 xxx 功能"
   ```

6. **运行测试与类型检查**：确保你的改动没有破坏现有功能：

   ```bash
   cd frontend
   npm run test    # 单元测试（Vitest）
   npm run build   # 类型检查与构建（tsc --noEmit）
   ```

7. **推送到你的分支**：

   ```bash
   git push origin feature/你的功能名
   ```

8. **发起 Pull Request**：回到 Gitee 页面发起 Pull Request，清晰描述改动的目的与内容。我们会尽快 review 并给出反馈，也欢迎主动参与讨论。

### 提交信息规范

为了让项目历史清晰可读，请尽量遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<类型>: <简短描述>

<可选的详细说明>
```

常用类型：

| 类型 | 用途 |
|------|------|
| `feat` | 新增功能 |
| `fix` | 修复 Bug |
| `docs` | 文档变更 |
| `refactor` | 代码重构（不改变功能） |
| `style` | 代码格式调整 |
| `test` | 补充测试 |
| `chore` | 构建、配置等杂项 |

例如：

```
feat: 表格编辑完整实现 — 单元格输入、块感知导航
fix: 修复多行文本光标寻址问题
```

### 代码规范

- 前端使用 TypeScript 严格模式，提交前请运行 `npm run test` 与 `npm run build`
- 后端遵循阿里巴巴 Java 开发手册规范
- 新增或修复功能时，请尽量补充对应的单元测试
- 保持代码风格与周边代码一致，方便他人阅读

### 社区守则

我们希望这里是一个友善、包容、互相成就的社区。参与讨论和贡献时，请：

- **尊重他人**：观点不同很正常，就事论事、理性沟通
- **保持耐心**：维护者大多是利用业余时间投入，回复可能需要一点时间
- **建设性地反馈**：指出问题时，尽量附带改进建议或具体场景

感谢你读完这一段。每一个愿意为开源项目贡献一份力量的人，都值得被认真对待。期待你的 PR！🎉

## 联系方式

如有问题或建议，欢迎通过 [Issues](https://gitee.com/wangwang_1_1665527118/emrdocument-engine/issues) 页面反馈，我们很乐意和你交流。

---

**感谢使用 EMR 文档编辑器引擎！**