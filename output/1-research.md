# 文档编辑器引擎 - 调研报告

> 版本: v3.0 | 日期: 2026-07-29 | 阶段: research (同步 Round 7 文档体系)
>
> **v3.0 变更**: 更新项目结构、技术决策记录、功能优先级；补充字体引擎/WASM/AI MCP/插件生态等调研结论；对齐 PRD v3.2 + 架构 v19.3 + Spec v4.0 当前状态。

---

## 1. 调研目标

构建一个参考「都昌电子病历（DCWriter）」的文档编辑器引擎，前后端分离架构，后端 Java。目标是打造通用的结构化文档编辑能力，可应用于电子病历、合同文书、政府公文等场景。

**当前状态**: 三份核心文档（PRD/架构/UIUX）+ Spec 已全部完成文档设计与同步，进入编码阶段。

---

## 2. 参考产品深度分析：都昌 DCWriter

### 2.1 产品概况

南京都昌信息科技有限公司（2012年成立），专注电子病历编辑器近 20 年。市场覆盖 **800+ 三甲医院、5000+ 区县级医院、6万+ 医疗机构**。

### 2.2 版本演进

| 版本 | 时间 | 技术路线 | 关键特征 |
|------|------|----------|----------|
| 1.0~4.0 | 2012-2019 | WinForm/ActiveX/ASP.NET | 历代演进 |
| **5.0 Canvas版** | 2022至今 | **WASM + Canvas** | 纯前端，跨浏览器一致排版 |

### 2.3 核心功能矩阵（对标参考）

DCWriter 的 20+ 种结构化元素是本项目的功能对标基线：

| 元素类型 | 对照本项目 |
|----------|------------|
| XTextInputFieldElement | SmartTextNode (含 HDSD/DE 编码) |
| XTextTableElement | Table + TableRow + TableCell + MergeMatrix |
| XTextImageElement | ImageNode + ImageParticle + MinIO |
| XTextCheckBox/RadioElement | F7 表单控件 (P1) |
| XTextChartElement | F15 高级元素 (P2) |
| XTextBarcodeElement | F15 条形码/二维码 (P2) |
| XTextSectionElement | SectionBreak (架构 §2.7) |
| XTextDirectoryFieldElement | 目录生成 (PRD F3.5) |
| XTextPageInfoElement | FieldNode.page_number/total_pages (架构 §2.9) |
| XTextParagraphFlagElement | ParagraphStyle.list (架构 §2.10) |

---

## 3. 开源参考方案分析

### 3.1 canvas-editor（核心技术参考）

- 仓库: `@hufe921/canvas-editor` | MIT | TypeScript | Canvas + SVG
- 架构: Editor → Draw 编排器 → Position/History 状态 → CanvasEvent/Cursor 交互 → Particle 粒子渲染
- 文档模型: `IElement[]` 扁平数组（本项目升级为 DocumentTree 树形 ModelD）
- 编辑器模式: EDIT/READONLY/FORM/PRINT/DESIGN/CLEAN/GRAFFITI（本项目对齐 6 种）

### 3.2 惠每 HmEditor + clinical-template-editor

HmEditor: LGPLv2.1 / CKEditor4 + AI / 专科结构化。clinical-template-editor: React + 医疗模板变量系统。

---

## 4. 后端架构参考

基于 SpringBoot 3.3+ + Mybatis-Plus + MySQL 8.0 JSON + Redis + MinIO + WebSocket Stomp（详见架构 §12）。

---

## 5. 关键设计决策

### 5.1 渲染方案：Canvas ✅ 已决策

Canvas + TypeScript 自研排版引擎。理由：跨浏览器像素级一致、长文档高性能、分页精确。

### 5.2 存储格式：JSON ✅ 已决策

内部 JSON（DocumentTree），支持多格式导入（HL7 CDA XML/HTML/Markdown）。MySQL 8.0 JSON 类型 + JSON_SCHEMA_VALID 校验。

### 5.3 文档模型：ModelD ✅ 已决策

树形 DocumentTree + NodePool ID 引用。去分页化存储（分页为布局引擎运行时输出）。SmartTextNode 原生携带 HDSD/DE 国标编码。

### 5.4 字体与文本度量 ✅ 已决策

FontManager 单例（FontFace API 加载 + extractMetrics upem=1000）。三级精度：Canvas L1 / HarfBuzz WASM L2 / 离线预计算 L3。字体降级链（FontFallback → FontRun[]）。核心字体预加载就绪后进入编辑态。

### 5.5 增量布局 + 增量渲染 ✅ 已决策

DirtyTracker 脏区追踪 + 三级布局缓存 + 3 层 Canvas（static/content/interact）。PageStartTable 增量分页早停机制。rAF 合并同帧渲染。

### 5.6 命令模式 + Undo/Redo ✅ 已决策

ICommand 体系（forward/invert/serialize）。CommandUndoRedoStack + 500ms 自动合并 + MacroCommand 事务。Run 模型文本存储（O(样式段) 非 O(字符)）。

### 5.7 协作方案：Yjs CRDT ✅ 已决策

CRDT 替代 OT。Y.Doc 运行时模型 + DocumentTree 快照序列化。WebSocket Stomp 通道 + Awareness 光标同步。

### 5.8 AI 集成：MCP Server ✅ 已决策

MCP (Model Context Protocol) Server 包装层。AI 走 ICommand 管线（author='ai'），零特权、可撤销、可审计。

### 5.9 插件生态 ✅ 已决策

IPlugin 生命周期（install/enable/disable/destroy）。8 类扩展点（NodeType/Particle/Command/QCRule/ToolbarItem/ContextMenuItem/SmartTextRenderer/Loader）。

### 5.10 安全沙箱 ✅ 已决策

EditorSecurityConfig 四维权限（network/file/data/script）默认 all-false。字段级 AES-256-GCM 加密（仅 privacy=true 的 SmartTextNode.text）。

---

## 6. 技术栈最终推荐

### 前端
| 类别 | 选型 | 说明 |
|------|------|------|
| 语言 | TypeScript 5.5+ | strict mode |
| 框架 | React 18.3+ | 函数组件 + Hooks |
| 构建 | Vite 5.4+ | HMR + ESBuild |
| 渲染引擎 | Canvas + 自研布局引擎 | 跨浏览器一致排版 |
| 文档模型 | JSON (DocumentTree + NodePool) | ModelD 树形 + ID 引用 |
| UI 组件 | Radix UI | headless 组件 |
| 图标 | Lucide React 0.400+ | 禁止 emoji |
| 状态管理 | Zustand 5.x | 轻量不可变 |
| 样式 | Tailwind CSS 3.4+ | 原子化 CSS |
| HTTP | Axios 1.7+ | JWT 注入 |
| 测试 | Vitest 2.x + Playwright | 单元 + E2E |
| 协作 | Yjs (CRDT) | 去中心化冲突解决 |
| 字体 | FontFace API + HarfBuzz WASM | 精确塑形 |

### 后端
| 类别 | 选型 | 说明 |
|------|------|------|
| JDK | Java 17 LTS | 企业级 |
| 框架 | SpringBoot 3.3+ | 主流微服务 |
| ORM | Mybatis-Plus 3.5+ | 灵活 SQL |
| 数据库 | MySQL 8.0 | JSON 类型 |
| 缓存 | Redis 7.x | 高性能 |
| 实时通信 | Spring WebSocket + Stomp | 双向通信 |
| 安全 | Spring Security + JWT | 标准方案 |
| PDF 导出 | Apache PDFBox / OpenPDF | 开源许可证兼容 |
| 对象存储 | MinIO | S3 兼容 |
| API 文档 | SpringDoc OpenAPI 2.5+ | Swagger |

---

## 7. 核心功能优先级 (更新至 PRD v3.2)

### P0 — 核心引擎 + 编辑器标配（80+ Spec 任务）

1. Canvas 渲染引擎 + 3 层 Canvas（static/content/interact）
2. 文档分页系统 + 页眉页脚 + 页码
3. 基础编辑：文本录入、格式化、CJK IME、Run 模型
4. Undo/Redo（CommandUndoRedoStack + 500ms 自动合并）
5. 表格（创建/编辑/合并/跨页断表/列宽拖拽）
6. 图片插入 + ImageParticle
7. 查找与替换（正则/大小写/全词匹配）
8. 列表（无序/有序/多级缩进）
9. 标题层级（Heading 1-6）+ 大纲导航
10. 格式刷 + 格式清除
11. 打印 + PDF 导出（SLIF + 后端渲染）
12. 续打（断点续打/补打指定页/打印历史）
13. 页面设置对话框（纸张/边距/版式）
14. 页眉页脚编辑（首页不同/奇偶页不同）
15. 缩放（25%-400%）+ 不可见字符显示
16. 快捷键体系 + 选择性粘贴
17. 字数统计 + 文档模型（Tree + NodePool）

### P1 — 增强编辑器 + 结构化 + 后端（60+ Spec 任务）

18. 脚注/尾注 + 分节符（Section Break）
19. 书签/交叉引用 + 动态字段/域
20. 文档比较（并排 diff）+ 文档批注面板
21. 结构化表单控件（SmartTextNode S1/S2/S3/N/D）
22. 数据校验（前端 validateDocumentTree + 后端 JSON_SCHEMA_VALID）
23. 权限内容管控（L0-L6 六级保护 + 字段级脱敏 + 留痕/清洁模式）
24. 医学质控引擎（JSONLogic DSL + 评分 + 审核流程）
25. 多格式导出（PDF/HTML/TXT/PNG）+ 多格式导入（XML/HTML/Markdown）
26. 自动保存（IndexedDB + localStorage + API 三级）+ 故障恢复
27. 后端 CRUD API（乐观锁 + 审计日志 + RBAC）
28. 模板系统 + 最近文档 + 阅读模式
29. 自动更正 + 修订者颜色 + 文档属性
30. SDK 集成（IEditor API + @emr/engine + @emr/editor-react + 主题/安全/诊断/i18n）
31. 插件生态（IPlugin + 8 类扩展点 + PluginManager）

### P2 — 高级特性（30+ Spec 任务）

32. 多人实时协作（Yjs CRDT + WebSocket + Awareness）
33. 版本历史 + 语义化版本链（MAJOR/MINOR/PATCH）
34. AI MCP Server（Tools + Resources + Prompts）
35. 条形码/二维码 + LaTeX 公式 + 图表
36. 大文档虚拟化 + 内存管理 + 错误降级
37. 分层测试体系（L1 单元 + L2 集成 + L3 E2E）

---

## 8. 文档体系当前状态

| 文档 | 版本 | 行数 | 最后更新 |
|------|------|:---:|----------|
| 调研报告 | v3.0 | — | 2026-07-29 |
| PRD | v3.2 | ~450 | 2026-07-29 |
| 架构设计 | v19.3 | ~4300 | 2026-07-29 |
| UI/UX 设计 | v3.0 | ~580 | 2026-07-29 |
| 技术规格 | v4.0 | 471 | 2026-07-29 |

四份核心设计文档全部对齐，174 项 Spec 任务覆盖 P0-P3 全部功能。

---

## 9. 项目结构 (当前 + 目标)

```
EMRDocumentEngine/
├── frontend/
│   ├── src/
│   │   ├── engine/              # 核心渲染引擎
│   │   │   ├── Editor.ts        # 编辑器 Facade
│   │   │   ├── document/        # ModelD + NodePool + ElementFormatter
│   │   │   ├── layout/          # TextMeasurer + LineBreaker + PageBreaker
│   │   │   │                   # + FontManager + DirtyTracker + LayoutCache
│   │   │   ├── render/          # Draw + LayeredRenderer + particles/
│   │   │   ├── command/         # ICommand + CommandManager + commands/  [目标]
│   │   │   ├── interaction/     # EventBus + Mouse/Keyboard/IME/ClipboardHandler  [目标]
│   │   │   ├── state/           # EditorRuntimeState + CoordinateSystem + UndoRedoStack
│   │   │   ├── loaders/         # IDocumentLoader + JSON/XML/HTML/Markdown  [目标]
│   │   │   ├── qc/              # QCEngine + QCScorer + QCRule  [目标]
│   │   │   ├── plugins/         # IPlugin + PluginManager + PluginAPI  [目标]
│   │   │   └── __tests__/
│   │   ├── components/          # React UI (EditorProvider/Toolbar/Sidebar/StatusBar)
│   │   │   ├── dialogs/         # FindReplace/PageSetup/Print/Export/PasteSpecial
│   │   │   ├── panels/          # CommentPanel/QCResultPanel/PropertiesPanel
│   │   │   └── views/           # DocumentCompareView
│   │   ├── services/            # API + AutoSave + PrintHistory
│   │   ├── store/               # Zustand
│   │   └── pages/               # EditorPage
│   └── package.json
├── backend/                     # SpringBoot 3.3+ / Mybatis-Plus / MySQL / Redis / MinIO
└── output/                      # Super Dev 产物
    ├── 1-research.md            # v3.0
    ├── 2-prd.md                 # v3.2
    ├── 3-architecture.md        # v19.3
    ├── 4-uiux.md                # v3.0
    └── 5-spec.md                # v4.0
```

---

## 10. 关键风险与应对

| 风险 | 级别 | 应对策略 |
|------|------|----------|
| Canvas 渲染引擎开发周期长 | 高 | 参考 canvas-editor，分阶段交付，渐进迁移（架构 §15） |
| 中文输入法兼容性 | 中 | IInputComposer 抽象层封装 Firefox/Safari 差异（架构 §8.4） |
| 字体度量跨端一致性 | 高 | FontManager + HarfBuzz WASM + SLIF 布局中间格式前后端同源（架构 §3） |
| 多人协作冲突解决 | 中 | Yjs CRDT 去中心化冲突解决（架构 §13.3） |
| 长文档性能（100+ 页） | 中 | 增量分页 PageStartTable 早停 + 虚拟化渲染 + 三级布局缓存（架构 §7） |
| 医疗合规要求 | 高 | 字段级加密 + 全链路审计 + L0-L6 权限 + 脱敏渲染（架构 §5/§16/§20.11） |
| 迭代中架构腐化 | 低 | Super Dev 四份文档 + 12 项质量门禁持续治理 |

---

## 11. 参考资料

- [DCWriter 都昌电子病历编辑器](https://blog.csdn.net/cmdos/article/details/152805722)
- [canvas-editor GitHub](https://github.com/Hufe921/canvas-editor)
- [惠每 HmEditor 开源电子病历编辑器](https://www.huimei.com/news/1766717815313.html)
- [clinical-template-editor npm](https://www.npmjs.com/package/@hzg0304/clinical-template-editor)
- [Apache PDFBox](https://pdfbox.apache.org/) — PDF 生成 (Apache 2.0)
- [Yjs CRDT](https://docs.yjs.dev/) — 协作冲突解决
- [MCP Protocol](https://modelcontextprotocol.io/) — AI 集成
- [JSONLogic](https://jsonlogic.com/) — 质控规则 DSL
