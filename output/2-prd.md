# 产品需求文档 (PRD) - 文档编辑器引擎

> 版本: v3.2 | 日期: 2026-07-29 | 阶段: docs (补分节/选择性粘贴/文档比较等刚需)
>
> **v3.2 变更**: 补分节符(Section Break)、选择性粘贴、文档比较、字数统计；增补书签/域/自动更正/最近文档/阅读模式/修订者颜色/文档属性等

---

## 1. 产品愿景

构建一个**通用的结构化文档编辑器引擎**，提供与 Word 一致的所见即所得排版体验，支持结构化数据录入、复杂表格、精确打印和多人协作。以电子病历为核心场景，可扩展至合同文书、政府公文、金融表单等结构化文档领域。

### 1.1 产品定位

一款**纯前端 Canvas 渲染 + Java 后端的结构化文档编辑引擎**，具备：
- Word 级别的所见即所得排版能力
- 超越 Word 的结构化数据录入与绑定能力
- 工业级的打印精度与多格式导出能力
- 多级权限内容管控与全链路审计能力
- **AI 原生能力 —— MCP Server 包装层，AI 与人工共用同一命令管线**
- **字体与排版引擎 —— 自研 TextMeasurer + FontManager，保障跨端排版一致性**

### 1.2 核心差异化

| 对比维度 | 传统富文本编辑器 | 本引擎 |
|----------|-----------------|--------|
| 渲染方式 | DOM/contenteditable | Canvas + 自研排版引擎 |
| 跨浏览器一致性 | 差（依赖浏览器排版引擎） | 像素级一致（Canvas 自绘） |
| 分页精度 | 不可靠 | 精确分页 + 增量重分页（PageStartTable 早停） |
| 文档模型 | 扁平 HTML/DOM | **树形 DocumentTree (ModelD) + NodePool 节点池** |
| 结构化录入 | 不支持 | **SmartTextNode + HDSD/DE 国标编码 + S1/S2/S3/N/D 数据类型约束** |
| 权限粒度 | 无 | **L0-L6 六级保护层级 + 字段级脱敏渲染** |
| 打印质量 | 一般 | **SLIF 布局中间格式 + 前后端同源排版 → 所见即所得 PDF** |
| 字体体系 | 依赖系统字体 | **FontManager 字体管理 + 字体降级链 + WASM 精确塑形** |
| AI 集成 | 外挂式 | **MCP Server 原生支持，AI 走 ICommand 管线，可撤销可审计** |
| 增量渲染 | 全量刷新 | **三级布局缓存 + DirtyTracker 脏区追踪 + 3 层 Canvas** |

### 1.3 树形文档模型

v2.0 核心升级：从扁平 `IElement[]` 数组重构为树形 `DocumentTree`，天然映射到医疗文档的层级结构：

```
DocumentTree
├── id, title, pageSetup
├── body: FlowBody
│   └── children: string[] (BlockNode ID 引用)
│       ├── Paragraph → children: string[] (InlineNode ID 引用)
│       │   ├── TextNode        (普通文本, 含 TextStyle)
│       │   ├── SmartTextNode   (结构化字段, 含 ElementMeta + privacy 脱敏)
│       │   └── ImageNode       (图片, MinIO 存储)
│       └── Table → TableRow[] → TableCell[] → BlockNode[] (支持嵌套)
├── header?: BlockNode[]
└── footer?: BlockNode[]
```

关键设计决策（详见架构 §2）:
- **存储去分页化**: 分页是布局引擎运行时输出（SLIFPage[]），不进入存储模型，插入文字后自动跨页流动
- **children 全 ID 化**: 所有 `children: string[]`，NodePool 提供 O(1) 节点查找，为协作/缓存/增量更新奠定基础
- **分级版本号**: structureVersion（结构变更）+ nodeVersions（内容变更），LayoutCache 按节点版本比对
- **SmartTextNode 内嵌 ElementMeta**: 携带 HDSD/DE 国标编码 + 数据类型约束 + 隐私脱敏配置

---

## 2. 目标用户

### 2.1 主要用户角色

| 角色 | 核心需求 | 使用频率 |
|------|----------|----------|
| **文档编写者**（医生/文员）| 快速录入、格式化、打印，CJK 输入流畅 | 每天 8+ 小时 |
| **模板设计者**（管理员）| 设计结构化模板、配置校验规则、定义 HDSD 绑定 | 每周 |
| **审核者**（上级/质控）| 查看、批注、修改留痕、质控检查 | 每天 |
| **系统集成者**（开发者）| SDK 嵌入、API 调用、插件开发、数据交换 | 按需 |
| **AI 助手**（MCP Client）| 通过结构化接口填表、续写、质控、编码建议 | 按需 |

### 2.2 核心场景

1. **新建文档**: 选择模板 → 填写结构化字段 → 自由文本补充 → 实时质控检查 → 保存/打印
2. **编辑已有文档**: 打开文档 → 修改内容 → 自动留痕 → 增量保存（IndexedDB → API）
3. **模板设计**: 创建空白模板 → 拖拽控件布局 → 配置 HDSD 绑定规则 → 发布模板
4. **质控审核**: 打开待审文档 → 自动质控评分 → 逐项检查 → 批注/修正 → 通过/驳回
5. **批量处理**: 选择多份文档 → 批量导出 PDF/HTML/TXT → 批量打印
6. **多人协作**: 多人同时编辑 → Yjs CRDT 实时同步 → 冲突自动合并
7. **AI 辅助**: MCP Client 连接 → 读取文档结构 → AI 填表/续写/质控 → 所有操作可撤销可审计
8. **SDK 集成**: 第三方系统嵌入编辑器 → 自定义主题/权限/扩展 → 多实例共存

---

## 3. 功能需求

### 3.1 MVP 功能清单

#### F1: 文档基础编辑
- F1.1 文本录入与编辑（键盘、粘贴、拖拽）
- F1.1b 选择性粘贴（Ctrl+Shift+V: 保留源格式/匹配目标格式/仅保留文本, 从 HIS/LIS 粘贴时消除外部格式污染）
- F1.2 CJK 中文输入法支持（IME Composition 事件 → IInputComposer 抽象层, 架构 §8.4）
- F1.3 文本格式化（粗体、斜体、下划线、删除线、上下标、字间距）
- F1.4 字体设置（字体名称、字号、颜色、背景色、高亮）
- F1.5 段落设置（对齐方式、行间距、段落间距、缩进）
- F1.6 Run 模型连续编辑（同样式连续输入自动合并 TextNode，节点数 O(样式段) 非 O(字符), 架构 §6.2）
- F1.7 无限制 Undo/Redo（CommandUndoRedoStack, 至少 100 步, 连续输入 500ms 自动合并为一个历史单元, 架构 §6.4）
- F1.8 查找与替换（Ctrl+F/H, 支持区分大小写、全词匹配、正则表达式, 替换/全部替换, 高亮匹配项）
- F1.9 选择操作（Ctrl+A 全选、双击选词、三击选段、Shift+点击扩展选区、Shift+方向键键盘选择, 架构 §8.2）
- F1.10 格式刷（选中源文本 → 启用格式刷 → 涂抹目标文本应用格式, 双击格式刷可连续使用）
- F1.11 格式清除（选中文本 → 一键清除所有格式恢复为默认样式）
- F1.12 快捷键体系（KeyboardHandler + 快捷键注册表, 所有标准快捷键可配置, 架构 §8.1）
- F1.13 字数统计（状态栏实时显示字数/字符数/段落数, 选中文本时显示选区统计, 满足医学文书最低字数要求）

#### F2: 文档分页与视图
- F2.1 精确分页（A4 默认，可配置纸张大小/方向）
- F2.2 页眉/页脚（首页可独立设置）
- F2.3 页码（多种数字格式，可显示当前页/总页数）
- F2.4 页边距设置（上下左右）
- F2.5 分页视图 / 连续视图切换（PageMode: PAGING / LINKAGE）
- F2.6 增量分页（百页文档单字符编辑仅重排 1~2 页, PageStartTable + 早停机制, 架构 §3.2）
- F2.7 缩放（25%~400%, Ctrl+滚轮/Ctrl+加减号/状态栏缩放滑块, 架构 §4.1 ViewState.scale）
- F2.8 页面设置（纸张大小 A4/B5/A3/Legal/自定义、纵向/横向、页边距精确值(支持厘米/英寸/毫米), 架构 §2.1 PageSetup）
- F2.9 不可见字符显示（显示/隐藏换行符、空格、分页符、制表符等, 帮助排版调试）

#### F3: 文档元素
- F3.1 表格（创建、编辑行列、合并/拆分单元格、表格样式(边框线型/底纹/对齐)、列宽拖拽调整、跨页断表 + 表头重复, 架构 §9）
- F3.2 图片（插入、拖拽调整大小、文字环绕(inline/square/top-bottom)、图片裁剪、MinIO 对象存储, 架构 §2.2 ImageNode）
- F3.3 分节符（下一页/连续/偶数页/奇数页, 不同节可独立设置纸张方向/页边距/页眉页脚/页码, 如正文A4纵向+表格A3横向）
- F3.4 列表（无序列表、有序列表、多级缩进(Tab/Shift+Tab)、自定义项目符号/编号样式）
- F3.5 标题层级（Heading 1-6, 九级大纲, Word 兼容样式映射）
- F3.6 目录生成（根据标题层级自动生成可点击跳转的目录, 打印时渲染为实际页码）
- F3.7 脚注/尾注（插入脚注标记 → 页面底部编辑脚注文本, 自动编号, 跨页跟随）
- F3.8 换行/分页符
- F3.9 分隔线

#### F4: 文档存储
- F4.1 文档以 JSON 格式存储到后端（DocumentTree 序列化）
- F4.2 文档列表（创建、查看、编辑、删除、分页筛选）
- F4.3 三级自动保存（防抖 3s → IndexedDB → API, localStorage 环形保留 3 版, 架构 §13.2）
- F4.4 乐观锁版本冲突检测（409 Conflict → 三选一 UI: 查看差异/强制覆盖/取消, 架构 §12.4）
- F4.5 故障恢复（页面加载检查 IndexedDB → 提示恢复未保存数据, 架构 §13.2）

#### F5: 模板系统
- F5.1 模板创建与保存
- F5.2 从模板新建文档
- F5.3 模板分类管理

#### F6: 打印与导出
- F6.1 打印预览（PRINT 模式, 架构 §4.2 EditorMode）
- F6.2 PDF 导出（SLIF 布局中间格式 → 后端 iText/Apache PDFBox 服务端渲染, 架构 §18）
- F6.3 HTML 导出（Thymeleaf 模板渲染）
- F6.4 数字水印（文本/图片水印, 平铺/居中, 透明度/旋转角度可配, Canvas 离屏 pattern 预渲染, 架构 §7.5）
- F6.5 多格式导入（JSON 原生 / HL7 CDA XML / HTML 富文本 / Markdown 轻量录入, IDocumentLoader 自动格式检测, 架构 §19）
- F6.6 打印设置对话框（打印机选择、打印份数、单面/双面打印、全部/当前页/指定页码范围(如 "1,3,5-8")、每页版数、缩放至纸张大小）
- F6.7 打印预览工具栏（上一页/下一页、缩放预览、页宽适配/整页适配切换）
- F6.8 续打功能（病历打印中断后恢复: 记录上次打印到的页码、指定"从第 N 页继续打印"、重打指定页面(如纸质病历弄脏/丢失后补打)、打印历史记录）

#### F6b: 页眉页脚编辑 (MVP)
- F6b.1 页眉页脚编辑模式（双击页眉/页脚区域进入独立编辑, 正文变灰）
- F6b.2 首页不同（首页页眉/页脚可独立设置, 满足病历首页无页码要求）
- F6b.3 奇偶页不同（双面打印时左右页使用不同页眉/页脚）
- F6b.4 页码格式（首页不显示页码、页码起始值、数字格式(1,2,3/i,ii,iii/A,B,C)）

#### F6c: 页面设置对话框 (MVP)
- F6c.1 纸张设置（A4/B5/A3/Legal/自定义宽高、纵向/横向）
- F6c.2 页边距精确控制（上下左右独立值, 单位切换 cm/mm/inch, 预设: 普通/窄/适中/宽）
- F6c.3 版式设置（页眉页脚距边界距离、垂直对齐方式: 顶端/居中/两端对齐）
- F6c.4 应用于（本节/整篇文档/从此页之后）

### 3.2 P1 增强功能

#### F7: 结构化表单控件
- F7.1 文本输入框（SmartTextNode, 占位符、字符限制 minLength/maxLength）
- F7.2 下拉选择框（dataType='S2' 枚举型, dictionary 字典/码表绑定）
- F7.3 日期选择器（dataType='D'）
- F7.4 复选框/单选框
- F7.5 数字输入框（dataType='N', 范围限制）

#### F8: 数据绑定
- F8.1 HDSD/DE 编码绑定到 SmartTextNode.element.code
- F8.2 表格动态行扩展
- F8.3 ElementFormat 数据类型约束（S1 字符串/S2 枚举/S3 长文本/N 数值/D 日期）

#### F9: 数据校验
- F9.1 必填项检查（SmartTextNode.element.required）
- F9.2 枚举值校验（dataType='S2' + dictionary 码表校验）
- F9.3 数值范围校验
- F9.4 字符串长度校验（minLength/maxLength）
- F9.5 校验结果可视化提示（红色边框 + tooltip 错误信息）
- F9.6 前端 validateDocumentTree() 运行时校验 + 后端 JSON_SCHEMA_VALID 双保险（架构 §12.6）

#### F10: 医学质控引擎
- F10.1 完整性校验：基于模板定义，检查所有必填字段是否已填写
- F10.2 逻辑一致性校验：跨字段逻辑规则（如 "出院日期 >= 入院日期"、"收缩压 > 舒张压"）
- F10.3 规范性校验：医学编码/术语是否符合 ICD/SNOMED 等标准
- F10.4 质控评分：加权计分模型（完整度 40% + 一致性 30% + 规范性 30%），单规则扣分 ≤ weight% × 1.5 cap（架构 §11.2）
- F10.5 JSONLogic DSL 规则定义：可入库、可热更新、TS/Java 双端可执行（架构 §11.1）
- F10.6 HDSD 索引驱动：单次 traverse 建 Map，所有规则共享，编辑后防抖 1s 异步 check（架构 §11.2）
- F10.7 质控结果面板：错误/警告/信息 三级分类，评分 grade (A/B/C/D)，可点击定位到对应字段
- F10.8 统一文档状态机：draft → submitted → reviewed/rejected → archived（架构 §11.3）

#### F11: 权限与留痕
- F11.1 用户级权限（owner/editor/commenter/viewer, 架构 §16.2）
- F11.2 节点级六级保护（L0 无保护 → L5 完全冻结, 架构 §5.1）
- F11.3 字段级隐私脱敏（SmartTextNode.element.privacy, full/partial mask, 按 userLevel 自动打码, 架构 §2.3）
- F11.4 修改留痕（新增/修改/删除标记不同样式）
- F11.5 留痕模式/清洁模式切换（EditorMode.CLEAN）
- F11.6 操作审计日志（API 层 AuditLogInterceptor 自动记录, 架构 §12.3）

#### F12: 文档批注
- F12.1 创建批注（选中文本 → 添加批注）
- F12.2 批注列表与定位
- F12.3 批注回复
- F12.4 标记批注为已解决

### 3.3 P2 高级功能

#### F13: 多人实时协作
- F13.1 多人同时编辑同一文档
- F13.2 Yjs CRDT 实时同步（自动合并，替代 OT 命令重放, 架构 §13.3）
- F13.3 编辑人光标位置显示（Awareness 500ms 广播）
- F13.4 离线重连（本地编辑积累 → 重连后增量同步）
- F13.5 并发编辑锁（Redis SET NX EX 30s 心跳续期, 架构 §12.1.2）

#### F14: 版本管理
- F14.1 文档版本历史（保存时自动创建版本快照）
- F14.2 文档比较（两版本文档左右并排展示, 差异高亮: 新增/删除/修改三种标记, 逐处接受/拒绝差异, 质控审核核心流程）
- F14.3 版本回滚

#### F15: 高级元素
- F15.1 条形码/二维码
- F15.2 LaTeX 数学公式
- F15.3 图表（柱状图/折线图/饼图）

#### F16: AI 原生能力 (MCP Server)
- F16.1 AI 辅助填表（读取 SmartTextNode 空字段 → LLM 生成 → insert_smarttext 填入, 架构 §21.4）
- F16.2 病史续写（读取现病史章节 → LLM 生成 → insert_text 追加）
- F16.3 智能质控（qc.check → LLM 解释 findings → 自动修正）
- F16.4 诊断编码建议（查诊断字段 → LLM 匹配 ICD-10 → insert_smarttext 填入）
- F16.5 模板推荐（LLM 根据患者信息推荐模板 → template.apply）
- F16.6 零特权 AI 设计：AI 走 ICommand 管线（author='ai'），所有操作可撤销可审计（架构 §21.1）

#### F17: 字体与排版体系
- F17.1 字体管理（FontManager 单例, registerFont + extractMetrics + querySystemFonts, 架构 §3.1）
- F17.2 字体降级链（detectMissingGlyphs → resolveFallbackFonts → FontRun[], 生僻字不显示方框, 架构 §3.5）
- F17.3 核心字体预加载（SimSun/SimHei 必须就绪后才进入编辑态, 架构 §3.6）
- F17.4 精确行高计算（FontMetrics.ascent+descent+lineGap 替代启发式 size×1.5, 架构 §3.3）
- F17.5 CJK 避头尾排版（lineStartForbidden/lineEndForbidden, 架构 §3.4）
- F17.6 多语言脚本检测（Unicode Property Escapes 自动选字体, 架构 §3.5）
- F17.7 WASM 精确塑形（HarfBuzzShaper, 可选 L2 精度, 架构 §1.2）

#### F18: SDK 与集成
- F18.1 公共 API（IEditor 接口: getDocument/setDocument/execCommand/undo/redo/事件订阅, 架构 §20.1）
- F18.2 宿主环境隔离（engine 内核零 UI 框架依赖, @emr/engine + @emr/editor-react 双包, 架构 §20.2）
- F18.3 多实例共存（全局共享 FontManager/TextMeasurer, 实例私有 DocumentTree/EventBus/Canvas, 架构 §20.4）
- F18.4 主题定制（EditorTheme: 页面/光标/选区/表格/校验/水印颜色, 内置 standard/eyeCare/print/dark 预设, 架构 §20.9）
- F18.5 性能分级（quality/balanced/performance/readonly 四档, 架构 §20.10）
- F18.6 安全沙箱（EditorSecurityConfig: network/file/data/script 四维权限, 默认全关, 架构 §20.11）
- F18.7 诊断排障（dumpDiagnostics + setLogLevel + showPerfPanel, 架构 §20.12）
- F18.8 国际化 i18n（LocaleMessages, 内置 zh-CN/en-US, 架构 §20.13）
- F18.9 标准化错误体系（EditorErrorCode: fatal/error/warn 三级, 架构 §20.7）
- F18.10 生命周期管理（init→mount→ready→pause/resume→unmount→destroy, 架构 §20.6）

#### F19: 多格式导出
- F19.1 OFD 导出（国产版式文档）
- F19.2 RTF 导出
- F19.3 TXT 纯文本导出
- F19.4 图片导出（PNG/JPG）

#### F20: 插件生态
- F20.1 插件生命周期（IPlugin: install/enable/disable/destroy, 架构 §8.5）
- F20.2 自定义节点类型（registerNodeType）
- F20.3 自定义渲染粒子（registerParticle）
- F20.4 自定义命令（registerCommand）
- F20.5 扩展点注册（ToolbarItem/ContextMenuItem/QCRule/SmartTextRenderer/DocumentLoader, 架构 §20.5）

#### F21: 文档辅助功能 (P1)
- F21.1 书签/交叉引用（插入书签锚点 → "详见体格检查" 引用自动关联页码, 页码变化时自动更新）
- F21.2 动态字段/域（插入自动更新的内容: 当前日期、总页数、作者名、上次保存时间）
- F21.3 自动更正（常见录入错误自动修正, 可配置词库, 如 i.v.g.t.t.→静脉滴注）
- F21.4 最近文档（快速打开最近编辑的 10 份文档, 显示标题+最后编辑时间）
- F21.5 阅读模式（审核者全屏专注阅读, 隐藏工具栏, 仅保留滚动/缩放/批注, 不可编辑）
- F21.6 修订者颜色（多人修订时不同人修改用不同颜色标识, 姓名+时间在 hover 时显示）
- F21.7 文档属性（标题/作者/关键词/科室/创建日期等元数据编辑面板, 嵌入 DocumentTree.metadata）

---

## 4. 非功能需求

### 4.1 性能 (v3.3)

**性能指标以架构文档 §17.1 为权威单一来源**，此处仅列关键目标供快速参考：

| 指标 | MVP 目标 | 最终目标 | 详见 |
|------|----------|----------|------|
| 10 页文档首屏加载 | < 1.5s | < 1s | 架构 §17.1 |
| 10 页文档内存 | < 80MB | < 50MB | 架构 §17.1 + §7.5 |
| 单次编辑响应 (P50) | < 50ms | < 16ms | 架构 §17.1 |
| 连续打字帧率 (P95) | > 30fps | > 55fps | 架构 §17.1 |
| 100 页全量分页 | < 3s | < 1s | 架构 §17.1 |

完整性能指标表（含测量方法、前置依赖、4K屏预算分析）见架构 §17.1。

### 4.2 兼容性

- 浏览器：Chrome 90+, Firefox 90+, Edge 90+, Safari 15+
- 移动端浏览器：只读查看可用，编辑不支持
- 分辨率：支持 1080p / 2K / 4K 高清屏（DPR 感知）
- 系统：Windows、macOS、Linux

### 4.3 可用性

- 所有编辑操作支持键盘快捷键
- 工具栏与右键菜单双入口
- 编辑操作即时有视觉反馈
- 字体未就绪期间展示骨架屏，禁止进入编辑态
- 编辑态内字体加载完成后仅重绘受影响区域（不触发全文重排）

### 4.4 安全性

- JWT 认证 + 接口鉴权（Spring Security + BCrypt）
- 文档级别权限控制（owner/editor/commenter/viewer）
- 字段级 AES-256-GCM 加密（仅 privacy=true 的 SmartTextNode.text, 架构 §12.1.3）
- 操作审计日志不可篡改（API 层 AuditLogInterceptor）
- XSS/SQL 注入防护
- WebSocket 认证（JWT 通过 Sec-WebSocket-Protocol, 禁止 URL query）
- EditorSecurityConfig 安全沙箱（默认 all-false, 集成方按场景白名单开启, 架构 §20.11）

### 4.5 可扩展性

- 插件式元素注册机制（IPlugin + PluginContext）
- 自定义控件开发接口
- IDocumentLoader 格式加载器注册（新增格式零侵入核心引擎）
- 第三方系统集成 API（RESTful + WebSocket + MCP）
- 数据格式向前兼容 ≥ 5 年（门诊 15 年/住院 30 年保存周期, 架构 §20.8）

### 4.6 异常降级策略

| 异常场景 | 降级方案 |
|----------|----------|
| Canvas 2D context 不可用 | 显示错误提示 |
| WebSocket 连接失败 | 降级纯本地编辑，协作功能置灰 |
| IndexedDB 不可用 | 降级 localStorage 备份 |
| API 网络超时 (3 次重试) | IndexedDB 兜底 + 提示用户 |
| 文档 JSON 解析失败 | 尝试 localStorage 恢复 |
| 单次渲染超过 100ms | 跳过非可见区域渲染 |
| 内存超过 200MB | 清空 TextMeasurer 缓存 + 释放非可见页 PageItem |
| 字体加载失败 | 降级系统默认字体 + 状态栏提示 |
| WASM 加载失败 | 降级 Canvas measureText L1 精度 |
| 单节点渲染崩溃 | 红色占位框 + 错误上报（safeRenderParticle, 架构 §20.7） |

### 4.7 字体与排版质量

- 核心字体（SimSun/SimHei）必须预加载就绪后才进入编辑态
- 行高唯一来源 = FontMetrics（ascent+descent+lineGap），禁止启发式估算
- 排版一致性：前端 Canvas 渲染与后端 PDF 渲染使用同一 SLIF 布局中间格式
- 后端嵌入相同字体文件（SimSun/SimHei），保障 PDF 输出与屏幕预览一致

---

## 5. 用户故事

### US-01: 新建并编辑文档
> 作为文档编写者，我希望能选择一个模板新建文档，在表单区域快速填写结构化数据，在自由文本区域书写内容，实时看到质控检查结果，最后保存或打印文档。

**验收标准：**
- [ ] 能从模板列表中选择模板新建文档
- [ ] 结构化区域（SmartTextNode）只能录入指定格式内容（S1/S2/S3/N/D）
- [ ] 自由文本区域可以富文本编辑
- [ ] 编辑器模式下遵循 L0-L6 节点权限规则
- [ ] 点击保存后文档持久化到后端（乐观锁版本检查）
- [ ] 点击打印后弹出打印预览（PRINT 模式）
- [ ] 连续编辑期间 IndexedDB 自动备份

### US-02: 模板设计
> 作为模板设计者，我希望能在空白文档上拖拽放置各种控件（输入框、下拉框、表格等），配置 HDSD/DE 编码绑定和校验规则，并保存为可复用的模板。

**验收标准：**
- [ ] DESIGN 模式下可以插入任意类型元素（忽略节点只读限制）
- [ ] 控件属性面板可以配置 ElementMeta（code/format/privacy）
- [ ] 可以配置 HDSD/DE 数据源绑定路径
- [ ] 保存后模板出现在模板列表中
- [ ] 模板中的 L4/L5 锁定节点（标题标签/Logo）在编辑模式下不可删除/修改

### US-03: 修改留痕与权限
> 作为审核者，我希望查看文档时能清楚看到做了哪些修改（新增、删除、修改），并能切换留痕模式和清洁模式。敏感字段应根据我的权限级别自动脱敏。

**验收标准：**
- [ ] 新增内容以特定颜色下划线标记
- [ ] 删除内容以删除线标记但不移除
- [ ] CLEAN 模式下隐藏所有修改标记
- [ ] 留痕信息包含修改人和时间
- [ ] userLevel < 要求级别时 SmartTextNode 自动脱敏（full mask / partial mask）

### US-04: 数据校验与质控
> 作为文档编写者，我希望能实时看到哪些必填项还没填、哪些字段值不合法，并获得质控评分，防止提交不合格的文档。

**验收标准：**
- [ ] 未填的必填项以红色边框提示
- [ ] 校验失败的字段显示错误信息
- [ ] 所有必填项完成后状态指示器变绿
- [ ] 质控面板实时显示评分 (A/B/C/D) 和错误/警告/信息分类
- [ ] 点击质控结果可定位到对应字段
- [ ] 支持 JSONLogic DSL 自定义逻辑校验规则

### US-05: 医学质控审核
> 作为质控员，我希望能对病历文档进行完整性、逻辑一致性、规范性检查，获得质控评分，并对不合格文档提出修改意见，完成审核流程。

**验收标准：**
- [ ] 质控面板显示错误/警告/信息三级分类结果
- [ ] 点击质控结果可定位到对应字段
- [ ] 质控评分实时更新（编辑后防抖 1s 重新计算）
- [ ] 支持自定义逻辑校验规则（如 "出院日期 >= 入院日期"）
- [ ] 质控审核流程：提交→审核→通过/驳回/修正，状态可流转（架构 §11.3）

### US-06: AI 辅助填表
> 作为医生，我希望 AI 能根据患者基本信息自动填充病历中的结构化字段，减少重复录入工作。

**验收标准：**
- [ ] MCP Server 连接后 AI 可读取文档 SmartTextNode 空字段列表
- [ ] AI 生成的填充内容通过 editor.insert_smarttext 写入
- [ ] AI 操作在 Undo 栈中可撤销（Ctrl+Z）
- [ ] AI 操作在审计日志中可见（author='ai'）

### US-07: SDK 集成
> 作为系统集成者，我希望将文档编辑器嵌入到现有 HIS/EMR 系统中，自定义主题和权限，并注册自定义控件。

**验收标准：**
- [ ] 可通过 `new Editor({ container })` 创建编辑器实例
- [ ] 同一页面支持多个独立编辑器实例
- [ ] 可通过 setTheme() 自定义品牌色/字体/光标样式
- [ ] 可通过 EditorSecurityConfig 控制网络/文件/数据/脚本权限
- [ ] 可通过 registerPlugin() 注册自定义节点类型和渲染器

---

## 6. 产品路线图

### Phase 1 (MVP) — 核心引擎 + 基础编辑 ✅ 基本完成

```
✅ 项目脚手架搭建（React + Vite + SpringBoot）
✅ Canvas 渲染引擎核心（Draw.ts + TextParticle）
✅ ModelD 树形文档模型（DocumentTree + NodePool + FlowBody）
✅ SmartTextNode 医疗数据元编码（HDSD/DE + ElementMeta + privacy）
✅ TextMeasurer + LineBreaker + PageBreaker 布局引擎
✅ 基础文本编辑 + 格式化（键盘/IME/粘贴）
✅ IME 中文输入法支持（compositionstart/update/end）
✅ Undo/Redo（待迁移到 CommandUndoRedoStack）
✅ 表格基础渲染（合并单元格 + 列宽计算）
✅ React UI 封装（EditorProvider + Toolbar + StatusBar）
✅ ModelD 重构（存储去分页化 + children 全 ID 化 + NodePool）
⬜ 选择性粘贴（保留源格式/匹配目标格式/仅文本）
⬜ 字数统计（状态栏实时 + 选区统计）
⬜ 分节符（不同节独立页面设置）
⬜ 列表（无序/有序/多级缩进）
⬜ 标题层级 + 大纲导航
⬜ 格式刷 + 格式清除
⬜ 页面设置对话框（纸张/边距/版式）
⬜ 页眉页脚编辑模式（双击进入 + 首页/奇偶页不同）
⬜ 缩放（25%-400% + 状态栏滑块）
⬜ 不可见字符显示
⬜ 打印设置对话框 + 打印预览工具栏
⬜ 续打功能（断点续打/补打指定页/打印历史）
⬜ 基础打印/PDF 导出（SLIF → iText 后端渲染）
⬜ 后端文档 CRUD API（乐观锁 + 审计日志）
⬜ 自动保存管道（IndexedDB + localStorage + API 三级）
```

### Phase 2 — 架构重构 & 增强（当前重点）

```
⬜ 架构迁移 Step 1: EditorRuntimeState 双写过渡（架构 §15）
⬜ 架构迁移 Step 2: EventBus 引入（架构 §15）
⬜ 架构迁移 Step 3: Handler 逐个提取（IMEHandler → ClipboardHandler → MouseHandler → KeyboardHandler）
⬜ 架构迁移 Step 4: Command 体系（InsertTextCommand + DeleteRangeCommand + CommandUndoRedoStack）
⬜ 架构迁移 Step 5: 增量布局 + 增量渲染（DirtyTracker + LayoutCache + 3 层 Canvas）
⬜ FontManager 字体管理系统（核心字体预加载 + extractMetrics）
⬜ 集成 LineBreaker → 增量布局管道
⬜ 集成 PageBreaker + PageStartTable 增量分页
⬜ 集成 UndoRedoStack（替换快照式撤销）
⬜ ImageNode + ImageParticle 图片渲染（含裁剪/替换）
⬜ 表格操作增强（样式/边框/底纹/列宽拖拽交互）
⬜ 书签/交叉引用 + 动态字段/域
⬜ 文档比较（并排展示 + 差异高亮 + 接受/拒绝差异）
⬜ 最近文档 + 阅读模式
⬜ 修订者颜色 + 文档属性
⬜ 页眉/页脚渲染
⬜ 后端 CRUD API 对接（乐观锁 409 冲突前端三选一）
⬜ 基础打印/PDF 导出链路
```

### Phase 3 — 产品化 & 高级特性（远期）

```
⬜ 结构化表单控件增强（dataType 约束 + S2 枚举下拉 + 码表绑定）
⬜ 前端 validateDocumentTree() + 后端 JSON_SCHEMA_VALID 双保险
⬜ 医学质控引擎（JSONLogic DSL + HDSD 索引驱动 + 评分 + 审核流程）
⬜ 六级权限管控（L0-L6 + 字段级脱敏渲染 + EditorSecurityConfig）
⬜ 修改留痕 + CLEAN 模式
⬜ 多人实时协作（Yjs CRDT + WebSocket + Awareness 光标同步）
⬜ AI MCP Server（document/smarttexts/structure Resources + editor.* Tools）
⬜ 插件生态（IPlugin 生命周期 + 8 类扩展点 + PluginAPI 安全沙箱）
⬜ SDK 交付（@emr/engine + @emr/editor-react 双包 + TypeScript 类型声明）
⬜ 字体降级链 + WASM HarfBuzzShaper（L2 精确塑形）
⬜ 多格式导入（HL7 CDA XML / HTML / Markdown + IDocumentLoader 注册表）
⬜ 多格式导出（OFD / RTF / TXT / 图片）
⬜ 主题系统（standard/eyeCare/print/dark + 自定义 EditorTheme）
⬜ 国际化 i18n（zh-CN/en-US + 自定义 LocaleMessages）
⬜ 诊断排障（dumpDiagnostics + showPerfPanel）
```

---

## 7. 成功指标

### 7.1 性能指标

| 指标 | MVP 目标 | 最终目标 | 测量方法 |
|------|----------|----------|----------|
| 10 页文档首屏加载 | < 1.5s | < 1s | Lighthouse FCP |
| 百页首屏就绪 | < 1s | < 500ms | Performance API |
| 单次编辑响应 (P50) | < 30ms | < 16ms | keydown→rAF 回调 |
| 连续打字帧率 (P95) | > 30fps | > 55fps | 100 次采样 rAF 计数器 |
| 100 页全量分页 | < 3s | < 1s | PageBreaker bench |
| 打印 50 页耗时 | < 5s | < 3s | PageBreaker + PDF 生成 |
| 系统可用性 | 99.5% | 99.9% | 单点→MySQL 主从 + Redis Sentinel |
| 10 页文档内存 | < 80MB | < 50MB | Chrome DevTools heap |
| 布局缓存命中率 | — | > 90% | LayoutCache 统计 |

### 7.2 质量指标

| 指标 | 目标 |
|------|------|
| 模型校验覆盖率 | 100% 保存前必校验 |
| 质控规则覆盖率 | 覆盖完整性/一致性/规范性三维 |
| 错误降级成功率 | 单节点崩溃不影响整份文档 |
| 字体就绪后排版稳定性 | 0 像素偏移（前后端一致） |
| 数据格式兼容周期 | MAJOR 版本间 ≥ 5 年 |

### 7.3 产品指标

| 指标 | 目标 |
|------|------|
| 模板覆盖科室数 | ≥ 20 个常见科室 |
| 质控评分准确率 | ≥ 95%（与人工审核对比） |
| SDK 集成时间 | < 1 天（阅读文档 → 嵌入系统） |
| 插件开发时间 | < 2 天（实现一个自定义控件） |
