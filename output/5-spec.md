# 技术规格说明书 (Spec) - 文档编辑器引擎

> 版本: v4.0 | 日期: 2026-07-29 | 阶段: spec (全面重构 — 对齐 PRD v3.2 + 架构 v19.3 + UIUX v3.0)
>
> **v4.0 变更**: TASK 编号全面重排消除重复；新增 P0 编辑器核心功能任务组（查找替换/列表/标题/脚注/分节/书签/域/批注/文档比较等 30+ 任务）；对齐架构 v19.3 所有新增节点类型和引擎；任务按优先级 P0→P3 分层组织。

---

## 1. 项目初始化任务

### TASK-001: 前端项目脚手架 ✅ 已完成

**目标**: 搭建 React + TypeScript + Vite 项目。

```
frontend/
├── src/
│   ├── engine/           # 核心渲染引擎（独立于 React）
│   │   ├── document/     # DocumentModel + ElementFormatter + NodePool
│   │   ├── layout/       # TextMeasurer + LineBreaker + PageBreaker + FontManager
│   │   ├── render/       # Draw + particles/ + LayeredRenderer
│   │   ├── command/      # ICommand + CommandManager + Commands
│   │   ├── interaction/  # EventBus + Mouse/Keyboard/IME/ClipboardHandler
│   │   ├── state/        # EditorRuntimeState + CoordinateSystem + UndoRedoStack
│   │   └── __tests__/
│   ├── components/       # React UI 组件
│   └── pages/            # 页面
├── package.json / vite.config.ts / tsconfig.json / tailwind.config.ts
```

依赖: React 18.3+ / TypeScript 5.5+ / Vite 5.4+ / Zustand 5.x / Lucide React 0.400+ / Radix UI / Axios 1.7+ / Vitest 2.x

### TASK-002: 后端项目脚手架

SpringBoot 3.3+ / Mybatis-Plus 3.5+ / MySQL 8.0 / Redis 7.x / Maven 3.9+

---

## 2. 已完成任务 (保留 v3.0 记录)

### 2.1 渲染引擎核心 ✅

| 任务 | 文件 | 状态 |
|------|------|:--:|
| TASK-101 | `document/DocumentModel.ts` — ModelD v10.0 类型定义 (DocumentTree/FlowBody/NodePool) | ✅ |
| TASK-101b | `document/ElementFormatter.ts` — 节点工厂 + 树操作 (traversePool/findById/insertAt) | ✅ |
| TASK-102 | `render/Draw.ts` — Canvas 渲染器 (709行, 待拆分) | ✅ |
| TASK-103 | `layout/TextMeasurer.ts` — Canvas measureText + LRU 缓存 | ✅ |
| TASK-104 | `layout/LineBreaker.ts` — CJK+英文混排换行引擎 (待集成) | ✅ |
| TASK-105 | `layout/PageBreaker.ts` — 分页引擎 (孤行/寡行控制, 待集成) | ✅ |
| TASK-106 | `state/Position.ts` — 位置计算器 (存根, @deprecated v20.33: 由 TASK-491 CoordinateSystem 替代后删除) | ⚠️ |
| TASK-107 | `render/particles/TextParticle.ts` — 文本粒子渲染器 | ✅ |

### 2.2 编辑器入口 + React UI ✅

| 任务 | 文件 | 状态 |
|------|------|:--:|
| TASK-201 | `engine/Editor.ts` — Editor Facade (49行) | ✅ |
| TASK-301 | `components/editor/EditorProvider.tsx` — React Context 桥接 | ✅ |
| TASK-302 | `components/layout/` — EditorLayout/HeaderBar/Sidebar/Toolbar/StatusBar | ✅ |
| TASK-303 | `pages/EditorPage.tsx` — 编辑器页面 | ✅ |
| TASK-304 | `components/dialogs/ExportDialog.tsx` — 导出对话框 | ✅ |

---

## 3. P0 待办 — 架构基础 (EditorRuntimeState + Command + Draw 拆分)

### 3.1 字体管理层

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-401** | `layout/FontManager.ts` | FontManager 单例: registerFont/registerAll/getVariant/querySystemFonts/ensureReady；extractMetrics() upem=1000 |
| **TASK-402** | `layout/FontFallback.ts` | detectMissingGlyphs (document.fonts.check) + resolveFallbackFonts → FontRun[] |
| **TASK-403** | `layout/TextMeasurer.ts` | 重构: 注入 FontManager + measureWidthPrecise() L2 预留 + measureChars() kerning + 缓存扩容 10000 |
| **TASK-404** | `layout/ScriptResolver.ts` | detectScript (Unicode Property Escapes) + resolveScriptRuns() 中/英/日/韩自动字体 |
| **TASK-405** | `layout/LineBreaker.ts` | 契约重定义: 输入 InlineNode[] + ParagraphStyle；删除 LineElement/page_break/separator/control/latex；增避头尾规则 |

### 3.2 运行时状态 + 命令体系

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-411** | `state/EditorRuntimeState.ts` | CursorState (path+offset)/SelectionState/ViewState/IMEState/HistoryState；ID 链路替代下标 |
| **TASK-412** | `command/ICommand.ts` | ICommand 接口: forward/invert(doc,pool)/serialize |
| **TASK-413** | `command/commands/InsertTextCommand.ts` | Run 模型: 字符串插入 + 相邻同样式合并 + normalizeParagraph() |
| **TASK-414** | `command/commands/DeleteRangeCommand.ts` | serialize 内嵌 deletedText；invert 返回 InsertTextCommand |
| **TASK-415** | `command/CommandUndoRedoStack.ts` | 命令驱动撤销栈 (maxDepth=100)；500ms 自动合并；MacroCommand 事务 |
| **TASK-416** | `command/CommandManager.ts` | execute() → forward → StatePatch → DirtyTracker → EventBus.emit |

### 3.3 Draw.ts 职责拆分

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-421** | `interaction/EventBus.ts` | on/off/emit + EngineEvent 类型 (8 种事件) |
| **TASK-422** | `interaction/IMEHandler.ts` | 从 Draw.ts 提取 hidden textarea + composition 事件 → IInputComposer 抽象 |
| **TASK-423** | `interaction/ClipboardHandler.ts` | 从 Draw.ts 提取 copy/cut/paste + 选择性粘贴 |
| **TASK-424** | `interaction/MouseHandler.ts` | 提取 mousedown/move/up → cursor/selection → emit EventBus |
| **TASK-425** | `interaction/KeyboardHandler.ts` | 提取 keydown → 快捷键注册表 → CommandManager.execute() |
| **TASK-426** | `render/Draw.ts` | 重构 (v20.2): 移除 recomputeLayout; Draw 退化为纯渲染消费者 (输入 SLIFPage[], 驱动 LayeredRenderer); EventBus 监听 |

### 3.4 渐进迁移路径

| 任务 | 说明 |
|------|------|
| **TASK-431** | Step 1: EditorRuntimeState 双写 — Draw 保留旧字段 + 新增 state，渲染从 state 读取 |
| **TASK-432** | Step 2: EventBus 引入 — 各事件处理 emit，Draw.render() 注册监听 |
| **TASK-433** | Step 3a-b: IMEHandler + ClipboardHandler 提取 |
| **TASK-434** | Step 3c-d: CoordinateSystem 提取 → MouseHandler → KeyboardHandler |
| **TASK-435** | Step 4: Command 双栈并行 → 完全切换后删旧栈 |
| **TASK-436** | Step 5: 增量布局 + 增量渲染 |

### 3.5 工程基础

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-441** | `document/NodePool.ts` | nodes Map + structureVersion + nodeVersions + O(1) 查找 + insertChild/removeChild 统一入口 |
| **TASK-442** | `document/DocumentModel.ts` | children 迁移 string[] + ImageNode；具体节点类型扩充见 TASK-501~508 |
| **TASK-443** | `layout/LayoutCache.ts` | inlineCache/blockCache/pageCache 三级缓存 + isValid/invalidate/clearAll |
| **TASK-444** | `render/LayeredRenderer.ts` | static/content/interact 三层 Canvas；视口+overscan 1页；水印离屏 pattern；光标 setInterval |

### 3.6 P0 — 核心排版链路集成 (MVP 前提, 不可推迟)

> **v20.15 修正**: 当前 Draw.ts 使用内联简化换行和固定高度分页——这**不是真正的分页系统**。LineBreaker/PageBreaker 集成是 MVP 的前提条件，不是 P2 "增强"。

| 任务 | 说明 |
|------|------|
| **TASK-445** | LineBreaker 集成: paragraphToLineElements() → breakLines() → 替换 Draw.ts 内联换行逻辑 |
| **TASK-446** | PageBreaker 集成: breakPages() + incrementalRepaginate() 替换固定高度分页；孤行/寡行控制生效 |
| **TASK-447** | 集成验证: 100 页分页 < 3s (§17.1)；分页 Word 对比: 同页面设置下随机抽检 10 页, 每页首行文本 + 关键断点(表格/图片)处逐行比对, 文本一致性 100% |
| **TASK-448** | **SLIF 前后端对拍黄金测试**: 同一 DocumentTree → LayoutEngine 产出 SLIF → 前端 Canvas 渲染坐标 vs 后端 PDFBox 渲染坐标逐 item 比对 (x/y/width/height)。允许误差 ≤ 1px @ 96dpi。覆盖: 纯中文 / 中英混排 / 表格 / 图片 / 列表 / 分节符。**字体度量一致 ≠ 排版结果一致, 这是"0 像素偏移"承诺的唯一验证手段**。CI 门禁, 失败禁止合并 |

---

## 4. P0 待办 — 编辑器核心功能 (PRD v3.2 新增)

### 4.1 查找与替换

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-451** | `engine/FindReplaceEngine.ts` | findAll/findNext/findPrevious/replace/replaceAll/highlightAll；正则/大小写/全词匹配 |
| **TASK-452** | `components/dialogs/FindReplaceDialog.tsx` | Ctrl+F/H 双入口；实时高亮；结果列表；替换预览闪烁；UIUX §5.1 |

### 4.2 列表

| 任务 | 说明 |
|------|------|
| **TASK-453** | `document/DocumentModel.ts` — ParagraphStyle 增加 list 属性: type(bullet/ordered)/level/numberStyle/bulletChar/startAt/continueNumbering |
| **TASK-454** | `render/particles/ListParticle.ts` | 列表渲染: 项目符号绘制(•/◦/▪ 按层级) + 编号计算 + 缩进对齐; 以 IParticle 实现，非 Draw.ts 内联 |

### 4.3 标题与大纲

| 任务 | 说明 |
|------|------|
| **TASK-455** | `document/DocumentModel.ts` — Paragraph 增加 outlineLevel (0=正文, 1-6=Heading) |
| **TASK-456** | `components/sidebar/OutlineNav.tsx` — 大纲导航面板: 按 outlineLevel 提取树、点击跳转页、当前标题高亮；UIUX §4.3 |
| **TASK-457** | `components/Toolbar.tsx` — 标题样式下拉 (正文/Heading 1-6) + 字体/字号下拉 |
| **TASK-458** | `render/TOCGenerator.ts` | 目录生成: 遍历 outlineLevel > 0 的段落 → 缩进 + 页码 → 渲染为独立 TOC 页面; 作为 SLIF 输出的一部分由 LayeredRenderer 消费 |

### 4.4 脚注

| 任务 | 说明 |
|------|------|
| **TASK-459** | `document/DocumentModel.ts` — FootnoteRef/FootnoteContent 类型；DocumentTree.footnotes[]/endnotes[] |
| **TASK-460** | `layout/FootnoteLayout.ts` + `render/particles/FootnoteParticle.ts` | 脚注布局与渲染: 收集当前页 FootnoteRef → 页面底部分配脚注区 → 编号并渲染; 布局计算与渲染分离 |
| **TASK-461** | 脚注编辑交互: Ctrl+Alt+F 插入 → 光标跳转底部编辑区；删除标记自动重新编号；UIUX §6.2 |

### 4.5 分隔线

| 任务 | 说明 |
|------|------|
| **TASK-462** | `document/DocumentModel.ts` — SeparatorNode 类型: lineStyle/width/color/widthMode/alignment |
| **TASK-463** | `render/particles/SeparatorParticle.ts` — 水平线渲染 (solid/dashed/dotted/double) |

### 4.6 分节符

| 任务 | 说明 |
|------|------|
| **TASK-464** | `document/DocumentModel.ts` — SectionBreak 类型: breakType/nextPageSetup/nextHeader/nextFooter/nextPageNumberStart |
| **TASK-465** | `layout/PageBreaker.ts` — 按节分组分页: 遍历 body.children 遇 SectionBreak 切换 pageSetup |
| **TASK-466** | `render/LayeredRenderer.ts` | 分节符标记线渲染 (static 层装饰) + 双击打开节设置; UIUX §6.3 |

### 4.7 页面设置

| 任务 | 说明 |
|------|------|
| **TASK-467** | `components/dialogs/PageSetupDialog.tsx` — 页边距/纸张/版式 三 Tab + 预览 + 节应用范围；UIUX §5.2 |

### 4.8 打印与续打

| 任务 | 说明 |
|------|------|
| **TASK-468** | `components/dialogs/PrintDialog.tsx` — 打印机/页码范围/份数/单双面 + 续打断点；UIUX §5.3 |
| **TASK-469** | `services/PrintHistoryService.ts` — 打印历史记录 (时间/页码范围/份数/完成状态)；断点恢复 |

### 4.9 页眉页脚编辑

| 任务 | 说明 |
|------|------|
| **TASK-470** | `render/LayeredRenderer.ts` + `components/toolbar/HeaderFooterToolbar.tsx` | 页眉页脚编辑模式: 双击 → content 层激活页眉区域渲染 + interact 层接管点击命中 (v20.23: 不动 static 层语义); 正文 content 层半透明; 上下文工具栏; UIUX §6.1 |
| **TASK-471** | `components/toolbar/HeaderFooterToolbar.tsx` — 首页不同/奇偶页不同/页码/日期/关闭 |

### 4.10 格式刷与格式清除

| 任务 | 说明 |
|------|------|
| **TASK-472** | `command/commands/FormatPainterCommand.ts` — 复制源 TextStyle → 涂抹目标应用；双击连续使用 |
| **TASK-473** | `command/commands/ClearFormatCommand.ts` — 移除所有格式恢复默认 TextStyle |

### 4.11 缩放

| 任务 | 说明 |
|------|------|
| **TASK-474** | `state/EditorRuntimeState.ts` — ViewState.scale 已有；statusBar 增加 ZoomSlider 组件 (25%-400%)；Ctrl+滚轮/Ctrl+加减号 |

### 4.12 不可见字符显示

| 任务 | 说明 |
|------|------|
| **TASK-475** | `render/particles/TextParticle.ts` | 不可见字符渲染模式切换: 空格→中点、换行→↵、分页符→--Page Break--、制表符→→; TextParticle.render() 的 renderMode 参数控制 |

---

## 5. P0 待办 — 字体与渲染体系

### 5.1 增量布局 + 增量渲染

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-481** | `layout/DirtyTracker.ts` | markParagraphDirty/markRectDirty/markFullLayout/getClipRegion/clear |
| **TASK-482** | `layout/IncrementalLayout.ts` | 仅重算脏 Paragraph；paragraphToLineElements() 类型转换桥 |
| **TASK-483** | `render/Draw.ts` | ctx.clip(clipRect) 仅重绘脏区；cursor/selection/IME 始终全量绘制 |
| **TASK-484** | rAF 合并 | 同一帧多次脏区标记合并为一次渲染 |
| **TASK-485** | `layout/PageStartTable.ts` | incrementalRepaginate() + 逐页早停 break + blockIndex 整数二分；百页单字符编辑收敛 1~2 页。**黄金测试**: 100 页文档在第 50 页插入 1 字符，重排页数 ≤ 2 且第 52 页起复用旧布局 |

### 5.2 布局引擎集成

| 任务 | 说明 |
|------|------|
| **TASK-486** | 行高统一: LineHeightResolver = FontMetrics × size/upem × lineHeight；删 TextMeasurer 启发式 |
| **TASK-489** | 测量缓存修正: (char,fontKey) 粒度 + 容量 10000 + kerning 仅 Latin |

### 5.3 坐标 + 命中检测

| 任务 | 目标文件 | 说明 |
|------|----------|------|
| **TASK-491** | `state/CoordinateSystem.ts` | 三层坐标转换: docToCanvas/screenToDoc/docToScreen/getCanvasTransform；Editor 构造注入 |
| **TASK-492** | `render/HitTestIndex.ts` | AABB 粗筛 + IParticle.hitTest() 精确检测 + 二分查找 |

### 5.4 粒子接口

| 任务 | 说明 |
|------|------|
| **TASK-493** | `render/particles/IParticle.ts` — IParticle 接口 + HitTestable + ParticleLayout + RenderContext + MeasureContext |
| **TASK-494** | `render/particles/ParticleRegistry.ts` — register/get |
| **TASK-495** | `render/particles/ImageParticle.ts` — 图片粒子渲染 |
| **TASK-496** | `render/particles/TableParticle.ts` — 表格粒子 (迁移 drawTable 逻辑) |

---

## 6. P0 待办 — 文档模型增强

### 6.1 节点类型补全 (架构 v19.3)

| 任务 | 说明 |
|------|------|
| **TASK-501** | `document/DocumentModel.ts` — 新增 SectionBreak (§2.7): breakType/nextPageSetup/nextHeader/nextFooter |
| **TASK-502** | `document/DocumentModel.ts` — 新增 BookmarkNode + CrossReferenceNode (§2.8): name/targetRef/refType/displayText |
| **TASK-503** | `document/DocumentModel.ts` — 新增 FieldNode (§2.9): fieldType(7种)/format/cachedValue |
| **TASK-504** | `document/DocumentModel.ts` — 新增 FootnoteRef + FootnoteContent (§2.12): footnoteId/number |
| **TASK-505** | `document/DocumentModel.ts` — 新增 CommentMarker + CommentThread + CommentEntry (§2.15): threadId/status |
| **TASK-506** | `document/DocumentModel.ts` — 新增 SeparatorNode (§2.14): lineStyle/width/color/widthMode |
| **TASK-507** | `document/DocumentModel.ts` — 更新 InlineNode union: 纳入 BookmarkNode/CrossReferenceNode/FieldNode/FootnoteRef |
| **TASK-508** | `document/DocumentModel.ts` — 更新 BlockNode union: 纳入 SeparatorNode |

### 6.2 Field 域解析

| 任务 | 说明 |
|------|------|
| **TASK-509** | `render/FieldResolver.ts` — resolve(): 按 fieldType 计算当前值；缓存策略 (60s/page change/print固化) |

---

## 7. P1 待办 — 增强编辑器功能

### 7.1 书签与交叉引用

| 任务 | 说明 |
|------|------|
| **TASK-511** | `render/BookmarkRenderer.ts` — 遍历解析 CrossReferenceNode: 查找目标 → 计算页码 → 替换 {page} 占位符 |
| **TASK-512** | `components/dialogs/BookmarkDialog.tsx` — 插入书签 (命名 + 目标位置) / 插入交叉引用 (选择书签/标题/脚注) |

### 7.2 批注面板

| 任务 | 说明 |
|------|------|
| **TASK-513** | `components/panels/CommentPanel.tsx` — 右侧浮层: 批注列表 + 筛选(全部/未解决/我的) + 回复线程 + resolve；UIUX §5.5 |
| **TASK-514** | `render/particles/CommentParticle.ts` | CommentMarker 渲染: 黄色高亮背景 + 批注图标; 以 IParticle 实现; 点击委托 CommentPanel |

### 7.3 文档比较

| 任务 | 说明 |
|------|------|
| **TASK-515** | `engine/DocumentDiffer.ts` — compare() 树形 LCS diff + DiffResult[] + acceptDiff/rejectDiff |
| **TASK-516** | `components/views/DocumentCompareView.tsx` — 双 Editor 并排 + ScrollSync + 差异控制栏；UIUX §5.6 |

### 7.4 选择性粘贴

| 任务 | 说明 |
|------|------|
| **TASK-517** | `interaction/ClipboardHandler.ts` — paste 默认"匹配目标格式"；Ctrl+Shift+V 弹出 PasteSpecialDialog；UIUX §5.4 |

### 7.5 字数统计

| 任务 | 说明 |
|------|------|
| **TASK-518** | `components/StatusBar.tsx` — 实时字数/字符数/段落数 + 选中文本统计 + 低于最低字数阈值变色提示 |

### 7.6 动态字段 (Field) 插入

| 任务 | 说明 |
|------|------|
| **TASK-519** | `components/toolbar/FieldDropdown.tsx` — "插入" → "域" → 选择 current_date/time/page_number/total_pages/author_name 等 |

### 7.7 自动更正

| 任务 | 说明 |
|------|------|
| **TASK-520** | `engine/AutoCorrectEngine.ts` — 可配置词库；输入后触发匹配 → 自动替换；如 "i.v.g.t.t." → "静脉滴注" |

### 7.8 最近文档 + 阅读模式 + 修订者颜色 + 文档属性

| 任务 | 说明 |
|------|------|
| **TASK-521** | `components/RecentDocuments.tsx` — 最近 10 份文档快速打开 |
| **TASK-522** | `components/ReadingMode.tsx` — 全屏阅读: 隐藏工具栏/侧边栏/属性面板 |
| **TASK-523** | `render/particles/TextParticle.ts` | 修订者颜色: 多人不同色渲染 + hover 姓名时间 tooltip; TextParticle.render() 读取 revision.author 映射颜色 |
| **TASK-524** | `components/dialogs/DocumentPropertiesDialog.tsx` — 标题/作者/关键词/科室/日期 元数据编辑；写入 DocumentTree.metadata |

---

## 8. P1 待办 — 后端对接

| 任务 | 说明 |
|------|------|
| **TASK-531** | 后端文档 CRUD API (GET/POST/PUT/DELETE, 乐观锁 version, X-Expected-Version) |
| **TASK-532** | 后端 JSON Schema 校验 (MySQL JSON_SCHEMA_VALID) |
| **TASK-533** | 后端 X-Model-Version Header 中间件 (ModelVersionInterceptor) |
| **TASK-534** | t_document_permission 表 + 权限 CRUD API |
| **TASK-535** | t_audit_log 表 + AuditLogInterceptor API 层拦截器自动记录 |
| **TASK-536** | t_user/t_role/t_user_role RBAC 用户体系 + JWT 认证 |
| **TASK-537** | 并发编辑锁: Redis SET NX EX 30s + 心跳续期 + 409 冲突三选一 UI |
| **TASK-538** | ModelA → ModelD 懒迁移 (读取时自动 ensureLatestModel) |
| **TASK-539** | 字段级 AES-256-GCM 加密 (仅 privacy=true 的 SmartTextNode.text) |

---

## 9. P1 待办 — 保存恢复 + 打印导出 + 文档加载

### 9.1 保存与恢复

| 任务 | 说明 |
|------|------|
| **TASK-541** | `engine/AutoSaveManager.ts` — 防抖 3000ms + IndexedDB + localStorage 环形保留 3 版 |
| **TASK-542** | 故障恢复: 页面加载 IndexedDB 检测 → 提示恢复 |
| **TASK-543** | 保存状态 UI: saved/saving/unsaved/error/conflict 五态 |

### 9.2 打印与导出

| 任务 | 说明 |
|------|------|
| **TASK-551** | 后端 PDF 导出: SLIF JSON → Apache PDFBox/iText 服务端渲染 |
| **TASK-552** | 后端 HTML 导出: Thymeleaf 模板 + DocumentTree JSON |
| **TASK-553** | 前端 PNG 导出: Canvas.toDataURL 当前页 |
| **TASK-554** | 前端 JSON 导出: DocumentTree JSON Blob 下载 |
| **TASK-555** | 数字水印: WatermarkConfig + LayeredRenderer 离屏 pattern 预渲染 |
| **TASK-556** | `components/dialogs/ExportDialog.tsx` — 多格式导出对话框 (重构) |
| **TASK-557** | `components/dialogs/PrintPreviewDialog.tsx` — 打印预览工具栏 |

### 9.3 多格式文档加载

| 任务 | 说明 |
|------|------|
| **TASK-561** | `engine/loaders/IDocumentLoader.ts` — 接口: extensions/name/load/detect |
| **TASK-562** | `engine/loaders/DocumentLoaderRegistry.ts` — 自动格式检测 + 扩展名路由 |
| **TASK-563** | `engine/loaders/JSONDocumentLoader.ts` — 原生格式 |
| **TASK-564** | `engine/loaders/XMLDocumentLoader.ts` — HL7 CDA / 通用 XML → DocumentTree |
| **TASK-565** | `engine/loaders/HTMLDocumentLoader.ts` — DOM → BlockNode 树 (有损转换) |
| **TASK-566** | `engine/loaders/MarkdownDocumentLoader.ts` — 简单 parser + 启发式 detect |

---

## 10. P1 待办 — 医学质控引擎

| 任务 | 说明 |
|------|------|
| **TASK-601** | QCRule 模型 + JSONLogic DSL 表达式 (TS/Java 双端可执行) |
| **TASK-602** | QCScorer: 加权评分 (完整度 40% + 一致性 30% + 规范性 30%) + cap + grade A/B/C/D |
| **TASK-603** | `engine/qc/QCEngine.ts` — HDSD 索引驱动 + 防抖 1s 异步 check() → QCResult |
| **TASK-604** | `components/panels/QCResultPanel.tsx` — 错误/警告/信息 三级 + 点击定位 SmartTextNode |
| **TASK-605** | t_qc_rule 表 + 审核流程: draft→submitted→reviewed/rejected→archived (统一状态机) |
| **TASK-606** | `components/dialogs/ModelValidatorPanel.tsx` — validateDocumentTree() 前端校验 + 后端 JSON_SCHEMA_VALID |

---

## 11. P1 待办 — SDK 集成

### 11.1 公共 API + 环境隔离

| 任务 | 说明 |
|------|------|
| **TASK-611** | IEditor 公共 API: 数据(getDocument/setDocument)/操作(execCommand/undo/redo)/事件(onReady/onError/...) |
| **TASK-612** | 宿主隔离: engine/ 零 UI 框架依赖；EditorConfig 容器注入；禁止直接读 window/document |
| **TASK-613** | 构建产物: @emr/engine (ESM/UMD) + @emr/editor-react (peerDependencies engine) |
| **TASK-614** | 多实例: 全局共享(FontManager/TextMeasurer) vs 实例私有(EventBus/LayoutCache/Canvas/CoordinateSystem) |

### 11.2 扩展 + 主题 + 安全 + 诊断 + i18n

| 任务 | 说明 |
|------|------|
| **TASK-621** | Disposable 接口 + Editor pause/resume/destroy 生命周期 + 所有模块 dispose() |
| **TASK-622** | EditorErrorCode 标准化: E_RENDER_CONTEXT_LOST/E_DOCUMENT_CORRUPTED/... + safeRenderParticle 容错 |
| **TASK-623** | 数据兼容: 向后自动升级 + 向前未知字段保留 + 降级展示；兼容周期门诊15年/住院30年 |
| **TASK-624** | EditorTheme + 4 预设 (standard/eyeCare/print/dark) + setTheme/getTheme/resetTheme |
| **TASK-625** | EditorPerformanceConfig + 4 模式 (quality/balanced/performance/readonly) |
| **TASK-626** | EditorSecurityConfig: network/file/data/script 四维权限 + 默认 all-false + XSS 过滤 |
| **TASK-627** | EditorDiagnostics: dumpDiagnostics + setLogLevel + showPerfPanel |
| **TASK-628** | LocaleMessages + setLocale/getLocale；内置 zh-CN/en-US；第三方部分覆盖 |

### 11.3 插件系统

| 任务 | 说明 |
|------|------|
| **TASK-631** | `engine/plugins/IPlugin.ts` — IPlugin 接口: install/enable/disable/destroy |
| **TASK-632** | `engine/plugins/PluginManager.ts` — register/unregister + PluginContext 8 类扩展点 |
| **TASK-633** | `engine/plugins/PluginAPI.ts` — 公开 API (禁止直接改 NodePool/Draw/内部状态) |

---

## 12. P2 待办 — 高级特性

### 12.1 表格增强

| 任务 | 说明 |
|------|------|
| **TASK-701** | 表格样式: 边框线型/底纹/对齐 + 列宽拖拽 UI |
| **TASK-702** | MergeMatrix.buildMergeMatrix() + 跨页断表 (表头重复 + minRowsBeforeBreak + 续表标记) |

### 12.2 Phase 2 门禁 — Yjs Spike (前置条件)

| **TASK-710** | **Yjs 投影路径 Spike** (P0, MVP 完成后立即执行): 最小原型验证 NodePoolProjection.observeDeep → applyInsert/Delete/Update → NodePool 映射。百页文档远端插入 1 字符必须 O(1) 投影。覆盖 Table 嵌套 / move / 级联回收边界 case。**Spike 通过后才启动 §12.3 协作任务**。架构 R1 (§17.6) |

### 12.3 协作
| **TASK-711** | Yjs CRDT 集成: Y.Doc 运行时模型 + DocumentTree 快照序列化 (依赖 TASK-710 通过) |
| **TASK-712** | WebSocket 协作通道 (Stomp + JWT 认证) + Awareness 光标同步 (500ms) |
| **TASK-713** | 离线重连: 本地 Command 积累 + sync_request 增量同步 |

### 12.3 版本管理

| 任务 | 说明 |
|------|------|
| **TASK-721** | t_document_version 版本历史表 + 版本列表 UI |
| **TASK-722** | ModelUpgrader 语义化版本链: MAJOR/MINOR/PATCH + breaking flag + loadDocument/saveDocument |
| **TASK-723** | 版本兼容矩阵: 向前/向后兼容规则 + 低版本拒绝高版本文档 |

### 12.4 AI MCP Server

| 任务 | 说明 |
|------|------|
| **TASK-731** | MCP Server 框架: stdio transport + JSON-RPC |
| **TASK-732** | MCP Tools: document.load/create/save + editor.insert_text/delete_range/format/insert_table/insert_smarttext + qc.check + template.apply/list |
| **TASK-733** | MCP Resources: document://{id}/tree /smarttexts /structure /hdsd/{code} |
| **TASK-734** | AI 审计: author='ai' + 操作走完整 Command 管线 (可撤销可审计) |

### 12.5 高级元素

| 任务 | 说明 |
|------|------|
| **TASK-741** | 条形码/二维码 (barcode/qrcode 库) |
| **TASK-742** | LaTeX 数学公式 (KaTeX/MathJax 渲染) |
| **TASK-743** | 图表: 柱状图/折线图/饼图 (Recharts/ECharts) |

---

## 13. P2 待办 — 系统保障

| 任务 | 说明 |
|------|------|
| **TASK-751** | VirtualViewport + LazyLayoutEngine: 视口虚拟化 + 懒布局 + 节点回收 |
| **TASK-752** | MemoryManager: 缓存容量限制 + LRU 淘汰 + UndoStack 深度控制 |
| **TASK-753** | SLIF 布局中间格式: SLIFPage/SLIFItem + 前端 Canvas/后端 iText 共享解析 |
| **TASK-754** | safeRenderParticle/safeRenderPage/safeLoadDocument 三级错误降级 |
| **TASK-755** | PerformanceMetrics 埋点: renderFrameTime/layoutTime/keystrokeLatency/cacheHitRate |
| **TASK-756** | ErrorReport 上报: navigator.sendBeacon 批量发送 |
| **TASK-757** | 字体加载防抖: SimSun/SimHei 预加载 → 骨架屏 → 就绪后进入编辑态 |
| **TASK-758** | 分层测试: L1 纯函数单元 (≥80%) + L2 node-canvas 集成 (≥60%) + L3 Playwright E2E |

---

## 14. 质量门禁

每个任务完成前必须通过：

1. **构建**: `npm run build` 零错误 / `mvn package` 成功
2. **类型**: `tsc --noEmit` 零错误
3. **Lint**: `npm run lint` 零 error
4. **测试**: 核心模块单元测试覆盖率 > 80%
5. **UI**: 与 output/4-uiux.md 视觉一致性检查
6. **图标**: 源码中无 emoji 字符 (Unicode U+2600-U+27BF, U+1F300-U+1FAFF)
7. **API**: 前后端 API 路径与 output/3-architecture.md 一致
8. **模型校验**: `validateDocumentTree()` 在保存前通过
9. **版本兼容**: modelVersion 升级器黄金测试 (v2.0→v3.0→v4.0 链式)
10. **权限**: `isEditable()` 全模式 × 节点级组合测试通过
11. **架构对齐**: 新增类型/接口与架构文档定义一致
12. **PRD 对齐**: 任务覆盖所有 MVP + P0 功能需求
13. **位置分层**: Command 接口签名与 serialize() 载荷中不得出现数组下标 (架构 v19.4 §6 规则 6)；所有位置字段为 `(paragraphPath, charOffset)`；forward() 内部强制经 resolveCharOffset() 转换后再操作节点。**invert 返回 null 的命令禁止合入** (v20.28)——每个命令必须有可构造的逆操作
