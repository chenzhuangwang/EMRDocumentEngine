<div align="center">

# EMR 文档编辑器引擎

**专业、高性能、可嵌入的电子病历（EMR）文档编辑引擎**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-%E7%AB%8B%E5%8D%B3%E4%BD%93%E9%AA%8C-2563eb?style=flat-square&logo=vercel)](http://139.196.151.15/)
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL%202.0-22c55e?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-84cc16?style=flat-square)](#参与贡献)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?style=flat-square&logo=typescript)](frontend/package.json)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)](frontend/package.json)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.3-6db33f?style=flat-square&logo=springboot)](backend/pom.xml)

</div>

<div align="center">

<img src="frontend/public/preview.png" alt="EMR 文档编辑器引擎 — 入院记录编辑界面" width="100%" />

**入院记录模板编辑实况**：A4 真实排版 · 页眉页脚 · 结构化表单控件（下拉 / 单选 / 日期 / 数值）

</div>

## 项目简介

EMR 文档编辑器引擎是一个面向医疗场景的电子病历文档编辑系统，提供从文档创建、结构化编辑、模板管理到质量控制的完整闭环。项目采用前后端分离架构：

- **前端**：基于自研 HTML5 Canvas 渲染引擎，实现高性能文档编辑与 A4 真实排版。
- **后端**：Spring Boot + MyBatis-Plus，提供 RESTful API、JWT 鉴权与 WebSocket 实时通信基础设施。
- **框架 / 平台无关运行时**：编辑器引擎通过 `EditorHost` 能力接口（文本 / 字体 / 渲染表面 / 视口 / 输入 / 平台六元组）解耦宿主环境，可嵌入 React、Vue、Electron、Web Worker 等任意宿主，引擎源码零浏览器全局依赖。

## 在线体验

无需本地部署，打开即可体验：

> **演示地址：[http://139.196.151.15/](http://139.196.151.15/)**

## 核心特性

### 专业文档编辑

- **富文本格式化**：加粗 / 斜体 / 下划线（单线、双线、波浪线）/ 删除线 / 上标 / 下标 / 字体（8 种）/ 字号（12 档）/ 文字颜色 / 高亮
- **段落排版**：左 / 中 / 右 / 两端对齐，有序与无序列表（多级缩进、6 种编号样式），标题层级（1–6）、段落缩进
- **表格处理**：插入表格、单元格合并 / 拆分、行列增删、跨页表格表头重复、追加行
- **专业元素**：图片、分隔线（4 种样式）、分节符与**分节（Section）**、页眉页脚（含首页 / 奇偶页逐页变体）、脚注、书签与交叉引用、域代码
- **查找替换**：支持正则、全词匹配、大小写敏感，替换可撤销
- **格式刷**：一键复制 / 应用文本样式

### 结构化病历能力

- **表单控件**：文本框、多行文本、数字、下拉选择、日期、日期时间、复选框、单选框 8 类结构化控件
- **控件配置**：设计模式下右键「属性」，按控件家族配置标签 / 提示 / 前后缀 / 必填等，配置以原子宏提交
- **域代码**：页码、总页数、日期、时间、标题、作者、保存日期、打印日期 8 种动态域
- **数据校验与计分**：表单元素的数据校验与必填检查，控件数值按 `numericValue` 汇总为量表得分
- **质量检查（QC）**：内置 8 条质控规则（标题非空 / 正文非空 / 无连续空段 / 必填控件非空 / 最低字数 / 段落数区间 / 分节未命名 / 分节为空），支持评分与 A–D 分级

### 分页与渲染

- **真实排版**：还原 A4 纸张、页边距、方向与分页规则；页面设置对话框可调整纸张 / 边距 / 版式，支持打印预览
- **虚拟滚动**：仅渲染可视页面，长文档流畅滚动
- **增量排版**：脏区追踪与布局缓存，编辑后局部重排
- **三层 Canvas + 粒子系统**：静态 / 内容 / 交互三层渲染，粒子涵盖文本、表格、图片、公式、脚注、图表、条码等
- **公式渲染**：基于 KaTeX 的 LaTeX 公式支持
- **水印**：文本 / 图片 / 平铺三种类型

### 编辑体验

- **撤销 / 重做**：Command 模式驱动，40 种可撤销命令，500ms 输入自动合并，栈深 100
- **剪贴板**：复制 / 剪切 / 粘贴，支持「保留源格式 / 匹配目标格式 / 纯文本」三种粘贴模式
- **自动保存**：IndexedDB 本地存储，3 秒防抖，保留最近 3 个版本，支持崩溃恢复
- **自动更正**：内置 25 条医疗缩写规则与中文标点配对
- **中文输入**：完整 IME 组合输入支持
- **六种编辑模式**：编辑 / 只读 / 表单 / 清洁 / 设计 / 打印，一键切换
- **辅助视图**：大纲导航、阅读模式、批注面板、性能面板

### 国际化与主题

- **中英双语界面**：内置 zh-CN / en-US 两套文案（约 800 键），顶栏一键切换并持久化
- **界面主题**：标准 / 护眼 / 打印 / 深色四种外壳预设；画布主题 4 预设 × 28 令牌

### 文档全生命周期

- **模板系统**：公共 / 私有模板分类管理，一键套用
- **文档比对**：两版本文档差异可视化（插入 / 删除 / 修改统计）
- **版本留痕**：文档每次保存自动归档历史版本（后端持久化；回溯 UI 见 [Roadmap](#规划中roadmap)）
- **批注**：行内批注标记、讨论线程、回复与「已解决」状态
- **导入**：JSON / `.emr`（完整流水线）、HTML / Markdown（简化解析）
- **导出**：JSON / TXT / HTML / 结构化元素 JSON / HL7 CDA XML / OFD（GB/T 33190-2016）

> 另见文末的 [规划中（Roadmap）](#规划中roadmap)，了解 PDF / DOCX 导出、HarfBuzz 塑形、协同编辑、审计日志等后续计划。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    浏览器（React 18 + TypeScript）              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  UI 层：components / pages / store（Zustand）             │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │  应用外壳层 platform/chrome / platform/data：主题 token /  │ │
│  │  医疗码表（属应用数据，不入引擎分发物）                       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                             │ 按包名引用（开发期直接读包源码）    │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  引擎包 @emrde/document-engine（独立可分发的 npm 包）        │ │
│  │   ├ engine/  框架 / 平台无关的编辑器内核                    │ │
│  │   │  document · layout · render · interaction · command   │ │
│  │   │  state · plugins · qc · security · loaders · i18n     │ │
│  │   │  template · format · evaluation · context · host      │ │
│  │   ├ platform/dom   浏览器宿主实现（Canvas / 剪贴板 / …）    │ │
│  │   ├ platform/react React 适配器（peer dependency）         │ │
│  │   └ lib/           导出 / 打印 / 溯源特性层                 │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                             │  HTTP / WebSocket
┌─────────────────────────────────────────────────────────────┐
│                    Spring Boot 3.3 后端（Java 17）             │
│  Controller → Service → Repository → MySQL / Redis            │
│  Security(JWT) · WebSocket · Springdoc(Swagger)              │
└─────────────────────────────────────────────────────────────┘
```

引擎与应用在**目录上**分开：引擎源码住在仓库根的 `packages/emr-document-engine/`，应用按包名 `@emrde/document-engine` 引用它。应用配置把包名指向包源码，所以开发期改一行引擎代码立刻生效（零构建）；对外分发走包 manifest 的 `exports` → `dist`（`npm run engine:pack`）。

编辑器引擎通过 `EditorHost` 六元组（`text` / `font` / `surface` / `viewport` / `input` / `platform`）注入宿主能力，浏览器能力经 `platform/dom` 注入引擎，使引擎保持框架与平台无关。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript（严格模式） |
| 构建工具 | Vite |
| 样式方案 | Tailwind CSS |
| 状态管理 | Zustand |
| UI 组件 | Radix UI + Lucide 图标 |
| 渲染引擎 | HTML5 Canvas 自研渲染器 |
| HTTP 客户端 | Axios |
| 实时协作 | Yjs + y-websocket（能力预留） |
| 公式渲染 | KaTeX |
| 压缩 / 归档 | fflate（OFD 打包） |
| 后端框架 | Spring Boot 3.3（Java 17） |
| 数据访问 | MyBatis-Plus |
| 安全框架 | Spring Security + JWT |
| 实时通信 | WebSocket |
| 缓存 | Redis |
| 接口文档 | Springdoc OpenAPI（Swagger） |
| 数据库 | MySQL 8.0+（开发可用内置 H2 模式） |
| 测试 | Vitest + Testing Library（约 170 个测试文件；Playwright E2E 规划中） |

## 快速开始

### 环境要求

- Node.js 18+
- Java 17+
- Maven 3.6+
- MySQL 8.0+（可选，也可使用内置 H2 开发模式）
- Redis（可选）

### 1. 准备数据库

```sql
CREATE DATABASE IF NOT EXISTS emr_editor
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
```

### 2. 启动后端

编辑 `backend/src/main/resources/application.yml` 配置数据库连接：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/emr_editor?useUnicode=true&characterEncoding=utf-8&serverTimezone=Asia/Shanghai&createDatabaseIfNotExist=true
    username: root
    password: ${DB_PASSWORD:root}
```

```bash
cd backend
mvn spring-boot:run
```

后端服务启动于 `http://localhost:8080`，Swagger 文档位于 `http://localhost:8080/swagger-ui.html`。

### 3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端应用启动于 `http://localhost:3001`，开发服务器已配置 `/api` 与 `/ws` 代理到后端。

### 4. 生产构建

```bash
cd frontend
npm run build
```

### Docker 部署

```bash
docker-compose up -d
```

`docker-compose.yml` 编排四个服务：`mysql`（3306）、`redis`（6379）、`backend`（8080）、`nginx`（80，托管前端静态资源并反向代理 API）。

## 项目结构

```
EMRDocumentEngine/
├── backend/                    # 后端服务（Spring Boot）
│   └── src/main/java/com/emr/
│       ├── config/             # 配置（安全 / WebSocket / MyBatis-Plus）
│       ├── controller/         # 控制器层（Auth / Document / Template）
│       ├── service/            # 业务逻辑层
│       ├── entity/             # 实体类（MyBatis-Plus）
│       ├── repository/         # 数据访问层（Mapper）
│       ├── dto/                # 数据传输对象
│       └── util/               # 工具类（JWT 等）
├── packages/
│   └── emr-document-engine/    # 引擎包 @emrde/document-engine（独立可分发，契约 §32）
│       ├── src/engine/         # 编辑器引擎核心（框架 / 平台无关）
│       │   ├── document/       # 文档模型（ModelD 树 + NodePool，core/factory/io/table/version）
│       │   ├── layout/         # 布局引擎（行断 / 分页 / 增量 / 虚拟视口 / 文本 / 表格）
│       │   ├── render/         # 渲染（三层 Canvas + 粒子系统）
│       │   ├── interaction/    # 交互（键盘 / 鼠标 / IME / 事件总线）
│       │   ├── command/        # 命令系统（撤销 / 重做 / 宏）
│       │   ├── host/           # EditorHost 能力接口
│       │   ├── state/          # 状态管理
│       │   ├── plugins/        # 插件系统
│       │   ├── qc/             # 质量控制
│       │   ├── security/       # 安全（XSS 防护 / 权限维度）
│       │   ├── loaders/        # 文档加载器
│       │   ├── import/         # 外部模板导入
│       │   ├── template/       # 设计态控件模板定义
│       │   ├── format/         # 格式刷等特性模块
│       │   ├── evaluation/     # 控件计分
│       │   ├── context/        # 右键上下文快照
│       │   ├── i18n/           # 国际化
│       │   └── __tests__/      # 引擎单元测试
│       ├── src/platform/dom/   # 浏览器宿主实现（Canvas / 剪贴板 / IndexedDB）
│       ├── src/platform/react/ # React 适配器（EditorProvider）
│       ├── src/lib/            # 导出 / 打印 / 溯源特性层
│       ├── package.json        # 分发 manifest（四个子路径入口）
│       ├── vite.config.ts      # lib 构建（不压缩，IP-POLICY §5）
│       └── tsconfig.json       # 声明构建
├── frontend/                   # 前端应用
│   └── src/
│       ├── components/         # React 组件（layout/toolbar/dialogs/panels/views/...）
│       ├── platform/chrome/    # 应用外壳主题 token（非引擎，不入分发物）
│       ├── platform/data/      # 医疗码表与控件库（应用数据）
│       ├── lib/                # 应用侧工具（utils / compareDocuments）
│       ├── pages/              # 页面组件
│       ├── services/           # API 服务
│       ├── store/              # 全局状态（Zustand）
│       └── mocks/              # 演示数据
├── output/                     # 项目文档（调研 / PRD / 架构 / UIUX / 规格）
├── knowledge/                  # 知识库
├── scripts/                    # 工程脚本（文件头 / 溯源 / 归档）
├── docker-compose.yml          # Docker 编排配置
├── nginx.conf                  # Nginx 站点与反代配置
├── LICENSE                     # MPL-2.0 许可证
├── NOTICE                      # 版权与第三方声明
└── IP-POLICY.md                # 知识产权保护策略
```

## 核心模块

### 前端编辑器引擎

- **DocumentModel / NodePool**：文档数据模型，17 种节点类型（含分节 Section），扁平节点池 + ID 引用
- **ContainerChildTypes**：容器子类型契约，声明并校验各容器允许的子节点（唯一事实源）
- **LayoutEngine**：排版引擎（行断 / 分页 / 增量 / 虚拟视口 / 避头尾 / 孤行寡行控制）
- **LayeredRenderer / Draw**：三层 Canvas 渲染器与粒子系统
- **TextMeasurer / FontManager**：文本测量与字体度量（Canvas 度量优先）
- **CommandManager / CommandUndoRedoStack**：命令执行、撤销 / 重做与宏
- **EventBus**：事件总线，处理组件间通信
- **KeyboardHandler / MouseHandler / IMEHandler**：输入事件处理
- **QCEngine**：质量检查引擎（8 条内置规则 + 自定义规则）
- **DocumentLoader / DocumentSerializer**：文档序列化与加载升级流水线
- **EditorHost**：平台能力边界（六元组），实现框架 / 平台无关

### 后端服务层

- **DocumentService**：文档业务逻辑（分页查询、创建、更新时归档历史版本）
- **TemplateService**：模板业务逻辑
- **AuthService**：认证授权服务（JWT 登录 / 刷新）
- **AuditLogRepository**：审计日志数据访问（表结构就绪，写入与查询待接入）

## API 接口

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/login` | 用户登录 |
| POST | `/api/v1/auth/logout` | 用户登出 |
| GET | `/api/v1/auth/me` | 获取当前用户 |

### 文档

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/documents` | 文档列表（分页 / 关键字 / 状态） |
| POST | `/api/v1/documents` | 创建文档 |
| GET | `/api/v1/documents/{id}` | 文档详情 |
| PUT | `/api/v1/documents/{id}` | 更新文档 |
| DELETE | `/api/v1/documents/{id}` | 删除文档 |

### 模板

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/templates` | 模板列表（分类 / 关键字） |
| GET | `/api/v1/templates/{id}` | 模板详情 |
| POST | `/api/v1/templates` | 创建模板 |
| PUT | `/api/v1/templates/{id}` | 更新模板 |
| DELETE | `/api/v1/templates/{id}` | 删除模板 |

## 数据库表

| 表 | 说明 |
|------|------|
| `t_user` | 用户 |
| `t_document` | 文档 |
| `t_template` | 模板 |
| `t_document_version` | 文档历史版本 |
| `t_annotation` | 批注 |
| `t_audit_log` | 审计日志 |

## 项目文档

- [调研报告](output/1-research.md) — 技术选型与竞品分析
- [产品需求文档](output/2-prd.md) — 功能需求与用户故事
- [架构设计文档](output/3-architecture.md) — 系统架构与技术方案
- [UI/UX 设计文档](output/4-uiux.md) — 界面设计与交互规范
- [技术规格说明书](output/5-spec.md) — 详细技术规格与任务分解

## 开发说明

### AI 辅助开发契约

本项目使用 AI 辅助开发。为约束 AI 的代码行为、确保架构边界不被破坏，仓库维护了一套「AI 编辑契约」：

- `.claude/CLAUDE.md`：AI 入口提示，指示 AI 在修改 `packages/emr-document-engine`（引擎源码）前必须先阅读契约。
- `.claude/AI_EDITOR_CONTRACT.md`：架构不变量契约（32 个编号章节），定义引擎的强制边界（引擎不得依赖 React 与浏览器全局、所有文档变更必须经过 Command 系统、每个可变事实必须有唯一 owner、文档模型不得依赖布局 / 渲染等）。

AI 在实现、重构、审查代码时，须将契约视为硬约束；如需打破某条不变量，必须先说明原因、评估影响并取得明确授权。

### 代码规范

- 前端使用 TypeScript 严格模式，提交前请运行 `npm run test`（Vitest）与 `npm run build`（含 `tsc --noEmit` 类型检查）
- 后端遵循阿里巴巴 Java 开发手册规范

## 规划中（Roadmap）

| 能力 | 说明 | 状态 |
|------|------|------|
| PDF / DOCX 导出 | 补齐导出矩阵（导出面板已列出，当前标记「即将推出」） | 规划中 |
| XML / HL7 导入解析 | 当前加载器为占位，仅 JSON / HTML / Markdown 生效 | 规划中 |
| HarfBuzz 文本塑形 | WASM 高精度文本测量 | 规划中 |
| 协同编辑接入 | Yjs / y-websocket 基础设施已就绪，编辑流接入 | 能力预留 |
| 版本回溯 UI | 历史版本已持久化，回溯界面待接入 | 规划中 |
| 审计日志接入 | `t_audit_log` 表结构就绪，写入与查询待接入 | 规划中 |
| 后端测试 | JUnit / Spring Boot Test 依赖已就绪，测试用例待补充 | 规划中 |
| E2E 测试套件 | Playwright 端到端回归测试 | 规划中 |

## 参与贡献

首先，由衷地感谢你愿意为这个项目停下脚步、贡献一份力量。无论你是经验丰富的开发者，还是第一次接触开源的新朋友，你的每一条建议、每一行代码、每一次文档修订，对这个项目都弥足珍贵。

一个真正好用的电子病历编辑工具，离不开社区里每一位伙伴的共同努力。请放心大胆地参与进来——哪怕只是纠正一个错别字、提出一个「也许很傻」的问题，我们都会认真对待、心怀感激。

### 你可以如何参与

| 参与方式 | 适合人群 | 说明 |
|---------|---------|------|
| 报告 Bug | 所有使用者 | 描述问题现象、复现步骤与运行环境 |
| 提出建议 | 所有使用者 | 对功能、体验、文档的任何想法，都可以通过 Issue 告诉我们 |
| 提交代码 | 开发者 | 修复 Bug、实现新功能、优化性能，或补充单元测试 |
| 完善文档 | 所有人 | 改进 README、代码注释、设计文档 |
| 代码评审 | 开发者 | 帮忙 review PR、参与技术讨论 |

### 贡献流程

1. **先沟通，再动手**：先到 [Issues](https://gitee.com/wangwang_1_1665527118/emrdocument-engine/issues) 查看是否已有相关讨论；全新功能或较大改动请先开 Issue 说明想法。

2. **Fork 本仓库**：点击页面右上角 Fork 按钮。

3. **克隆到本地**：

   ```bash
   git clone https://gitee.com/你的用户名/emrdocument-engine.git
   cd emrdocument-engine
   ```

4. **创建功能分支**：

   ```bash
   git checkout -b feature/你的功能名
   ```

5. **开发并提交**：

   ```bash
   git add .
   git commit -m "feat: 新增 xxx 功能"
   ```

6. **运行测试与类型检查**：

   ```bash
   cd frontend
   npm run test    # 单元测试（Vitest）
   npm run build   # 类型检查与构建（tsc --noEmit）
   ```

7. **推送到你的分支**：

   ```bash
   git push origin feature/你的功能名
   ```

8. **发起 Pull Request**：回到 Gitee 页面发起 PR，清晰描述改动的目的与内容。

### 提交信息规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

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

### 社区守则

- **尊重他人**：观点不同很正常，就事论事、理性沟通
- **保持耐心**：维护者大多利用业余时间投入，回复可能需要一点时间
- **建设性地反馈**：指出问题时，尽量附带改进建议或具体场景

## 许可证

本项目基于 [MPL-2.0（Mozilla Public License 2.0）](LICENSE) 开源协议。

用大白话说清楚边界：

- ✅ **可以商用**：医院、企业、商业产品都能用，也可以与闭源系统集成
- ✅ **可以修改、分发**：保留版权与许可声明即可
- ⚠️ **改动要回馈**：如果你修改了**本项目已有的文件**，那些文件必须继续以 MPL-2.0 开源（你自己新增的文件可以另选协议）
- ❌ 不提供任何担保

完整条款见 [LICENSE](LICENSE)，版权与第三方声明见 [NOTICE](NOTICE)，知识产权保护策略见 [IP-POLICY.md](IP-POLICY.md)。

## 联系方式

如有问题或建议，欢迎通过 [Issues](https://gitee.com/wangwang_1_1665527118/emrdocument-engine/issues) 页面反馈。

---

**感谢使用 EMR 文档编辑器引擎！**
