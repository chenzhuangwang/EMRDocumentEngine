# 文档编辑器引擎 - 调研报告

> 版本: v1.0 | 日期: 2026-07-17 | 阶段: research

---

## 1. 调研目标

构建一个参考「都昌电子病历（DCWriter）」的文档编辑器引擎，前后端分离架构，后端采用 Java。目标是打造通用的结构化文档编辑能力，可应用于电子病历、合同文书、政府公文等场景。

---

## 2. 参考产品深度分析：都昌 DCWriter

### 2.1 产品概况

南京都昌信息科技有限公司（2012年成立），专注电子病历编辑器开发近 20 年，拥有 3 项相关发明专利。市场覆盖全国 **800+ 三甲医院、5000+ 区县级医院、6万+ 医疗机构**，每天约 100 万医生使用，生成约 1000 万页病历文档。

### 2.2 版本演进路线

| 版本 | 时间 | 技术路线 | 关键特征 |
|------|------|----------|----------|
| 1.0 桌面版 | 2012至今 | WinForm/WPF，COM接口 | 支持 PB/Delphi/VB/C++ |
| 2.0 IE版 | 2015-2017 | ActiveX插件 | 仅支持 IE 内核 |
| 3.0 ASP.NET版 | 2017-2019 | WebForm | 功能简化，不支持复杂工具栏 |
| 4.0 HTML5版 | 2019-2025 | HTML5 + .NET Core | 实时分页问题未解决 |
| **5.0 Canvas版** | 2022至今 | **WASM + Canvas** | 纯前端，跨浏览器一致排版 |

### 2.3 5.0 核心技术架构

```
┌─────────────────────────────────────────────┐
│              浏览器 (Browser)                 │
│  ┌───────────────────────────────────────┐   │
│  │     WASM (.NET → WebAssembly)         │   │
│  │  ┌─────────────────────────────────┐  │   │
│  │  │  自研 DOM 模型                   │  │   │
│  │  │  自研排版算法                     │  │   │
│  │  │  文档操作逻辑                     │  │   │
│  │  └─────────────────────────────────┘  │   │
│  └───────────────────────────────────────┘   │
│  ┌───────────────────────────────────────┐   │
│  │     Canvas 渲染层                      │   │
│  │  ┌─────────────────────────────────┐  │   │
│  │  │  文档界面绘制 (Canvas)            │  │   │
│  │  │  打印输出 (SVG)                   │  │   │
│  │  └─────────────────────────────────┘  │   │
│  └───────────────────────────────────────┘   │
│  ┌───────────────────────────────────────┐   │
│  │     JavaScript 交互层                  │   │
│  └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

核心设计思想：
- **自研 DOM 模型**：突破 HTML DOM 技术限制，不依赖 contenteditable
- **Canvas 渲染**：跨浏览器完全一致的排版效果
- **纯前端组件**：不依赖服务器端，零插件
- **XML/JSON 存储**：结构简单，便于后台批量处理

### 2.4 核心功能矩阵

#### 文档编辑
- 粗体、斜体、多样式下划线（双下划线、波浪线）、删除线、上下标
- 文字套圈、着重符号、高亮显示、字体/颜色/背景色
- 无限制 Undo/Redo
- 复制粘贴：纯文本/HTML/私有格式，可权限控制

#### 文档排版
- 支持 A4/A3/B5/B4 等多种纸张，横向/纵向
- 精确实时分页、所见即所得
- 页眉页脚、页码、装订线、文档网格线、水印
- 六大视图模式：表单/阅读/长文档/多栏/横向滚动/设计

#### 打印系统
- 打印预览、乱序打印、指定页打印
- 续打、偏移续打、选择打印、静默打印
- 50 页文档 2 秒完成打印

#### 结构化元素（自研 DOM 模型，20+ 种元素）

| 元素类型 | 关键能力 |
|----------|----------|
| XTextInputFieldElement | 输入域：直接录入/下拉/多选/日期/时间；必填/正则/长度校验 |
| XTextTableElement | 表格：表头行、合并/拆分单元格、拖拽调整、强制分页 |
| XTextImageElement | 图片：拖拽调整、文字环绕、URL 加载 |
| XTextCheckBoxElement | 复选框：数据源绑定、勾选历史 |
| XTextRadioElement | 单选框：数据源绑定 |
| XTextChartElement | 图表：柱状图/折线图/饼图 |
| XTextNewBarcodeElement | 一维码：Code128/Code39/EAN13 |
| XTextTDBarcodeElement | 二维码：纠错级别 L/M/Q/H |
| XTextMediaElement | 媒体：视频/音频嵌入 |
| XTextControlHostElement | 控件宿主：嵌入自定义 HTML 元素 |
| XTextButtonElement | 按钮：按下/松开不同图片 |
| XTextParagraphFlagElement | 段落标记：缩进/对齐/列表 |
| XTextPageInfoElement | 页码：多种数字格式 |
| XTextSectionElement | 文档节 |
| XTextSubDocumentElement | 子文档嵌套 |
| XTextDirectoryFieldElement | 目录域 |

#### 数据绑定与公式
- 数据源支持 JSON/XML 格式，动态更新
- 表格动态扩展行/列
- 数值运算公式（Excel 语法参考）
- 输入域级联（可见性表达式）

#### 三级权限内容管控（核心特色）
- 超过 3 级权限等级，高权限可修改/删除低权限内容
- 逻辑删除，留痕/清洁模式一键切换
- 差异化留痕样式配置
- 全程操作审计日志

#### 文件格式
- 基础格式：XML、JSON
- 导出格式：PDF、OFD、HTML、RTF、TXT、图片
- 支持 OFD（国家版式文档标准）

#### AI 集成
- 开放 AI 集成策略，完整 API 体系
- 智能文档生成、内容校对、结构化数据提取、自动排版优化

#### 协作与集成
- 多人实时协作编辑
- PACS/LIS/RIS 无缝集成
- 同屏操作（文本、图像、音频、视频）
- 全键盘操作、移动端多点触控
- 离线编辑，联网自动同步

---

## 3. 开源参考方案分析

### 3.1 canvas-editor（⭐ 重点参考）

| 属性 | 详情 |
|------|------|
| 仓库 | `@hufe921/canvas-editor` (GitHub) |
| 协议 | MIT License |
| 语言 | TypeScript |
| 渲染 | Canvas + SVG |
| 构建 | Vite |
| 测试 | Vitest |

**架构分层：**
```
┌────────────────────────────────┐
│  Public API (Editor facade)    │  ← command / eventBus / register
├────────────────────────────────┤
│  Orchestration (Draw)          │  ← 中心渲染编排器
├────────────────────────────────┤
│  State (Position / Range /     │  ← 位置计算 / 选区 / 历史栈
│  History / Zone)               │
├────────────────────────────────┤
│  Interaction (CanvasEvent /    │  ← 鼠标/键盘/输入法/快捷键
│  Cursor / Shortcut)            │
├────────────────────────────────┤
│  Rendering (Particle System)   │  ← Text/Image/Table/Control 粒子
└────────────────────────────────┘
```

**文档模型（JSON）：**
```typescript
// 文档由 IElement[] 数组表示，每个元素可包含样式、类型、值等属性
interface IElement {
  value: string;           // 内容值
  type: ElementType;       // 元素类型
  id?: string;             // 唯一标识
  font?: string;           // 字体
  size?: number;           // 字号
  bold?: boolean;          // 加粗
  italic?: boolean;        // 斜体
  underline?: boolean;     // 下划线
  strikeout?: boolean;     // 删除线
  color?: string;          // 文字颜色
  highlight?: string;      // 高亮颜色
  rowFlex?: RowFlex;       // 对齐方式
  trList?: ITr[];          // 表格行（TABLE 类型）
  control?: IControl;      // 表单控件配置
  extension?: unknown;     // 业务扩展数据
}
```

**元素类型分类：**
- Text-like: TEXT, HYPERLINK, SUBSCRIPT, SUPERSCRIPT, CONTROL, DATE
- Image: IMAGE, LATEX (通过 SVG 渲染)
- Block: BLOCK, PAGE_BREAK, SEPARATOR, TABLE
- Virtual: TITLE, LIST, AREA（展开为扁平元素序列）

**编辑器模式：**
- EDIT：标准编辑
- READONLY：只读
- FORM：仅表单可交互
- PRINT：打印优化
- DESIGN：模板设计（忽略只读限制）
- CLEAN：清洁模式（隐藏标记）
- GRAFFITI：自由绘制

**页面模式：** PAGING（分页） / LINKAGE（连续滚动）

**渲染管道：** formatElementList → unzipElementList → Position 计算 → Particle 渲染 → zipElementList

**性能特性：** Web Workers 异步处理、IntersectionObserver 懒加载、RenderMode（SPEED/COMPATIBILITY）

### 3.2 惠每 HmEditor

| 属性 | 详情 |
|------|------|
| 协议 | LGPLv2.1 |
| 技术栈 | 原生 JS + CKEditor4 + AI |
| 定位 | 专科结构化智能文档编辑器 |

特色：数据元组件体系、结构化与自由文本融合、内置医学术语约束、AI 智能生成。

### 3.3 clinical-template-editor

| 属性 | 详情 |
|------|------|
| 协议 | 开源 (npm) |
| 技术栈 | React |
| 定位 | 临床医疗模板编辑器 |

特色：变量系统（initialVariables/setVariableValues/getVariableValues）、三种编辑模式、月经史/体温单等医疗组件。

---

## 4. 后端架构参考

### 4.1 典型 Java 电子病历后端架构

基于 SpringBoot 的电子病历后端常见架构：

```
┌─────────────────────────────────────────┐
│          Controller Layer (REST API)     │
│  TemplateController / DocumentController │
│  PrintController / SyncController        │
├─────────────────────────────────────────┤
│          Service Layer (业务逻辑)         │
│  TemplateService / DocumentService       │
│  PrintService / QualityControlService    │
├─────────────────────────────────────────┤
│          Repository Layer (数据访问)      │
│  Mybatis-Plus / JPA                      │
├─────────────────────────────────────────┤
│          Infrastructure Layer            │
│  WebSocket (Stomp) / MinIO / Redis       │
└─────────────────────────────────────────┘
```

### 4.2 核心技术选型

| 类别 | 技术 | 说明 |
|------|------|------|
| 核心框架 | SpringBoot 3.x | 后端主框架 |
| ORM | Mybatis-Plus | 数据访问层 |
| 数据库 | MySQL 8.0+ | 主数据库 |
| 缓存 | Redis | 分布式缓存、会话管理 |
| 实时通信 | WebSocket + Stomp | 多人协作实时同步 |
| 文件存储 | MinIO / 本地文件系统 | 模板文件、图片存储 |
| 消息队列 | RabbitMQ / Kafka | 异步任务处理 |
| 权限框架 | Spring Security | 认证授权 |
| 文档转换 | LibreOffice / Aspose | PDF/OFD 导出 |

---

## 5. 关键设计决策建议

### 5.1 渲染方案：Canvas vs DOM

| 维度 | Canvas 方案 | DOM (contenteditable) 方案 |
|------|------------|---------------------------|
| 排版一致性 | 跨浏览器完全一致 | 不同浏览器差异大 |
| 性能（长文档）| 优秀，百页秒开 | 大量 DOM 节点性能差 |
| 分页精度 | 像素级精确 | 浏览器分页不可靠 |
| 开发复杂度 | 高（需自建光标/选区/输入法）| 低（浏览器原生支持）|
| 可访问性 | 需手动实现 | 浏览器原生支持 |
| 自定义元素 | 完全自由 | 受限于 HTML 规范 |

**建议：采用 Canvas + TypeScript 方案**，参考 canvas-editor 的成熟架构。

### 5.2 存储格式：JSON vs XML

| 维度 | JSON | XML |
|------|------|-----|
| 与前端交互 | 原生支持 | 需解析 |
| 数据库存储 | MySQL 8.0 JSON 类型 | CLOB/文件 |
| 批量处理 | 灵活 | XPath/XQuery 强大 |
| 医疗行业标准 | 部分支持 | HL7 CDA 基于 XML |

**建议：内部使用 JSON 格式（与前端 canvas-editor 模型一致），支持导出为 XML 以兼容行业标准。**

### 5.3 文档模型设计：自研 vs 复用

**建议：基于 canvas-editor 的 IElement 模型扩展**，增加：
- 权限元数据（权限等级、创建者、修改者）
- 数据绑定元数据（数据源路径、绑定表达式）
- 校验规则元数据（必填、正则、范围）
- 留痕元数据（修改类型、修改人、时间戳）
- 业务扩展字段（extension 属性）

---

## 6. 技术栈最终推荐

### 前端
| 类别 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript 5.x | 类型安全 |
| 框架 | React 18+ | 生态丰富，与 canvas-editor 兼容 |
| 构建 | Vite 5+ | 快速构建 |
| 渲染引擎 | Canvas + SVG + 自研布局引擎 | 跨浏览器一致排版 |
| 文档模型 | JSON (IElement[]) | 轻量、可扩展 |
| UI 组件库 | Ant Design / shadcn/ui | 中后台首选 |
| 图标库 | Lucide React | 符合 Super Dev 规范 |
| 状态管理 | Zustand | 轻量、TypeScript 友好 |
| 协作 | Yjs (CRDT) | 去中心化冲突解决 |

### 后端
| 类别 | 选型 | 理由 |
|------|------|------|
| 语言 | Java 17+ | 企业级稳定性 |
| 框架 | SpringBoot 3.x | 主流微服务框架 |
| ORM | Mybatis-Plus 3.5+ | 灵活的 SQL 控制 |
| 数据库 | MySQL 8.0 | JSON 类型支持 |
| 缓存 | Redis 7.x | 高性能缓存 |
| 实时通信 | WebSocket + Stomp | 双向实时通信 |
| 权限 | Spring Security + JWT | 标准安全方案 |
| 文档导出 | Apache POI / iText / LibreOffice | 多格式导出 |
| 对象存储 | MinIO | 兼容 S3 协议 |

---

## 7. 核心功能优先级

### P0 - 核心引擎（MVP）
1. Canvas 渲染引擎 + 基础文本编辑
2. 文档分页系统（页眉/页脚/页码）
3. 文档 JSON 数据模型 + 持久化 API
4. 基础格式化（粗体、斜体、下划线、字号、颜色）
5. Undo/Redo
6. 表格（创建、编辑、合并单元格）
7. 图片插入与管理
8. 打印（PDF 导出）
9. 模板系统（创建/保存/加载模板）

### P1 - 结构化能力
10. 表单控件（输入框、下拉、日期、复选框、单选框）
11. 数据源绑定（JSON 数据绑定到控件）
12. 数据校验（必填、正则、范围）
13. 权限内容管控（多级权限、留痕/清洁模式）
14. 文档批注
15. 导出多格式（PDF、HTML、RTF、TXT）

### P2 - 高级特性
16. 多人实时协作编辑
17. 版本历史与对比
18. 条形码/二维码
19. 图表元素（柱状图/折线图/饼图）
20. 数学公式（LaTeX）
21. 离线编辑 + 同步
22. AI 智能生成/质控

---

## 8. 项目结构建议

```
EMRDocumentEngine/
├── frontend/                    # React + TypeScript 前端
│   ├── src/
│   │   ├── engine/              # 核心渲染引擎
│   │   │   ├── document/        # 文档模型
│   │   │   ├── layout/          # 布局引擎
│   │   │   ├── render/          # Canvas 渲染器
│   │   │   ├── interaction/     # 交互处理
│   │   │   └── command/         # 命令系统
│   │   ├── components/          # React UI 组件
│   │   ├── hooks/               # React Hooks
│   │   ├── services/            # API 服务层
│   │   ├── store/               # 状态管理
│   │   └── pages/               # 页面
│   ├── package.json
│   └── vite.config.ts
├── backend/                     # Java SpringBoot 后端
│   ├── src/main/java/
│   │   ├── controller/          # REST 控制器
│   │   ├── service/             # 业务逻辑
│   │   ├── repository/          # 数据访问
│   │   ├── entity/              # 实体类
│   │   ├── dto/                 # 数据传输对象
│   │   ├── config/              # 配置类
│   │   └── websocket/           # WebSocket 处理
│   ├── src/main/resources/
│   │   ├── application.yml
│   │   └── mapper/              # Mybatis XML
│   └── pom.xml
└── output/                      # Super Dev 产物
    └── 1-research.md
```

---

## 9. 关键风险与应对

| 风险 | 级别 | 应对策略 |
|------|------|----------|
| Canvas 渲染引擎开发周期长 | 高 | 参考 canvas-editor 架构，分阶段交付 |
| 中文输入法兼容性 | 中 | 参考 canvas-editor 的输入法处理方案 |
| 多人协作冲突解决 | 中 | 采用 Yjs CRDT 方案，参考成熟实践 |
| 浏览器兼容性 | 低 | Canvas 方案天然跨浏览器一致 |
| 后端性能（长文档处理）| 中 | MySQL JSON 类型 + Redis 缓存 + 异步处理 |

---

## 10. 参考资料

- [DCWriter 都昌电子病历编辑器 CSDN 博客](https://blog.csdn.net/cmdos/article/details/152805722)
- [DCWriter 都昌电子病历编辑器 博客园](https://www.cnblogs.com/xdesigner/p/19131290)
- [canvas-editor GitHub](https://github.com/Hufe921/canvas-editor)
- [canvas-editor DeepWiki 架构概览](https://deepwiki.com/Hufe921/canvas-editor/1.3-architecture-overview)
- [canvas-editor DeepWiki 元素数据模型](https://deepwiki.com/Hufe921/canvas-editor/2.4-element-data-model)
- [惠每 HmEditor 开源电子病历编辑器](https://www.huimei.com/news/1766717815313.html)
- [clinical-template-editor npm](https://www.npmjs.com/package/@hzg0304/clinical-template-editor)
- [袁永福专栏：新一代电子病历编辑器的信创之路](http://mp.weixin.qq.com/s?__biz=MjM5OTA1MjUzMg==&mid=2654291090&idx=1&sn=e71aea28a04df9f5b48e8afcd26bc0cf)
