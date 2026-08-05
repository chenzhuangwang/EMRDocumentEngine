# Session Brief

> 会话日期: 2026-08-05
> 当前阶段: delivery (质量整合)
> 本轮: R30-R54

## 构建基线

- `tsc --noEmit`: **0 errors**
- `vite build`: **1707 modules, 550KB JS**
- `vitest run`: **34/34 passed (4 test files)**

## 本会话交付总览 (R11-R33)

| 轮次 | 功能 | 文件 | +/- |
|:--:|------|------|:--:|
| R11 | 页眉页脚双击交互增强 | Draw + MouseHandler + Editor | +229/-3 |
| R11.1 | 视觉分层 (背景/分隔线/高亮) | Draw | 重构 |
| R12 | Toolbar 页眉页脚编辑入口 | Toolbar + EditorPage | +128 |
| R13 | 页眉页脚内容持久化 | ElementFormatter + Editor + EditorPage + MouseHandler | +37 |
| R14 | 键盘方向键导航 | KeyboardHandler | +117 |
| R15 | 缩放控制接入 + 标题格式修复 | EditorLayout + EditorPage + Editor + Toolbar + Store | 轻量 |
| R16 | 不可见字符显示切换 | Draw + Editor + EditorRuntimeState + StatusBar + EditorLayout + EditorPage | 轻量 |
| R17 | 大纲导航面板接线 | Sidebar + EditorLayout + EditorPage + OutlineNav | 轻量 |
| R18 | 清除格式 + 页面设置入口 | Editor + Toolbar + EditorLayout + EditorPage | 轻量 |
| R19 | Ctrl+B/I/U 快捷键 + 字体/字号下拉状态同步 | Editor + EditorPage + Toolbar + Store | 轻量 |
| R20-R23 | Toolbar 完备化 (B/I/U/删除线/上标/下标/列表/撤销/重做 激活态 + 格式刷 + 缩进 + 颜色) | Toolbar + Editor + EditorPage + Store + Draw | 中量 |
| R24-R26 | 域代码/图片/查找替换 引擎层全链路 | LayoutEngine + SLIF + Draw + Editor + ElementFormatter + FindReplaceEngine + FindReplaceDialog | 重量 |
| R27 | Toolbar 完备 + StatusBar 页码 + 导出 HTML + Ctrl+P | Toolbar + StatusBar + ExportDialog + EditorPage | 轻量 |
| R28-R29 | 域代码动态值 + 图片 Canvas 渲染 + 查找替换 UI 接入 | Draw + Editor + EditorPage | 中量 |
| **R30** | **IParticle 接口 + ParticleRegistry + 适配器** | **IParticle + ParticleRegistry + ParticleAdapters + index** | **+4 files** |
| **R31** | **脚注全链路: FootnoteParticle + LayoutEngine集成 + Editor.insertFootnote + Ctrl+Alt+F** | **FootnoteParticle + LayoutEngine + Draw + Editor + ElementFormatter + KeyboardHandler** | **+1 file, 修改 5 files** |
| **R32** | **批注面板: CommentPanel + CommentParticle + Sidebar 批注 Tab + Store 扩展** | **CommentPanel + CommentParticle + Sidebar + EditorLayout + Store** | **+2 files, 修改 3 files** |
| **R33** | **ImageParticle 提取: 图片渲染逻辑从 Draw.ts 抽离为独立粒子** | **ImageParticle + index** | **+1 file** |
| **R34** | **自动保存: AutoSaveManager (IndexedDB + 防抖3s + 恢复检测)** | **AutoSaveManager + Editor 集成** | **+1, 修改 1** |
| **R35** | **数字水印: Draw.setWatermark + Editor.setWatermark API 接入** | **Draw + Editor** | **修改 2** |
| **R36** | **字数统计: Editor.getWordCount (chars/words/paragraphs/selection)** | **Editor + EditorPage** | **修改 2** |
| **R37** | **表格渲染: TableParticle + LayoutEngine 表格→SLIF 转换** | **TableParticle + LayoutEngine + LineBreaker + Draw** | **+1, 修改 3** |
| **R38** | **书签对话框: BookmarkDialog (书签插入+交叉引用选择)** | **BookmarkDialog** | **+1** |
| **R39** | **域插入下拉: FieldDropdown (8种域代码) + EditorPage 全量接线** | **Toolbar + EditorPage** | **修改 2** |
| **R40** | **阅读模式: 全屏阅读 (隐藏工具栏/侧栏/状态栏) + ESC 退出** | **ReadingMode + EditorPage + EditorLayout** | **+1, 修改 2** |
| **R41** | **最近文档: localStorage 10 份 + 侧栏快速打开** | **RecentDocuments** | **+1** |
| **R42** | **文档属性: DocumentPropertiesDialog (标题/作者/关键词/科室)** | **DocumentPropertiesDialog** | **+1** |
| **R43** | **自动更正引擎: AutoCorrectEngine (24条医学缩写规则) + IME 自动替换** | **AutoCorrectEngine + Editor** | **+1, 修改 1** |
| **R44** | **选择性粘贴: PasteSpecialDialog (保留源格式/匹配目标/纯文本)** | **PasteSpecialDialog** | **+1** |
| **R45** | **条形码: BarcodeParticle (Code128B Canvas 原生渲染)** | **BarcodeParticle** | **+1** |
| **R46** | **文档比较引擎: DocumentDiffer (段落级 LCS + 文本节点级 diff)** | **DocumentDiffer** | **+1** |
| **R47** | **文档比较视图: DocumentCompareView (差异列表+颜色编码+统计栏)** | **DocumentCompareView** | **+1** |
| **R48** | **差异控制栏: 接受/拒绝单个差异 + 全部接受/拒绝 (已内置)** | **DocumentCompareView** | **已合并** |
| **R49** | **主题系统: EditorTheme 4 预设 (标准/护眼/打印/暗色) + CSS 变量注入** | **EditorTheme** | **+1** |
| **R50** | **水印设置 UI: WatermarkDialog (文字/字号/颜色/透明度/旋转/间距)** | **WatermarkDialog** | **+1** |
| **R51** | **性能诊断面板: PerfPanel (FPS/帧耗时/布局耗时/缓存命中率)** | **PerfPanel** | **+1** |
| **R52** | **质控引擎: QCEngine (6条内置规则) + QCResultPanel (评分+等级+三级问题列表)** | **QCEngine + QCResultPanel** | **+2** |
| **R53** | **i18n 国际化: LocaleMessages + setLocale/getLocale (zh-CN/en-US 内置 25 键)** | **i18n/index** | **+1** |
| **R54** | **错误降级: 三级容错 (safeRenderParticle/safeRenderPage/safeLoadDocument + safeAsync)** | **ErrorRecovery** | **+1** |

**总计: 50 files touched (R11-R54)**

## R30-R33 新增文件

```
frontend/src/engine/render/particles/IParticle.ts          (接口定义 + RenderOptions)
frontend/src/engine/render/particles/ParticleRegistry.ts   (注册表 + 全局单例)
frontend/src/engine/render/particles/ParticleAdapters.ts   (Text/Separator/Field IParticle适配器)
frontend/src/engine/render/particles/index.ts              (统一导出)
frontend/src/engine/render/particles/FootnoteParticle.ts   (脚注引用渲染器)
frontend/src/engine/render/particles/CommentParticle.ts    (批注标记渲染器)
frontend/src/engine/render/particles/ImageParticle.ts      (图片粒子渲染器)
frontend/src/components/panels/CommentPanel.tsx            (批注面板UI)
```

## R30-R33 修改文件

```
frontend/src/engine/layout/LayoutEngine.ts      (footnote_ref → SLIF item + 编号回填)
frontend/src/engine/render/Draw.ts               (footnote type 调度 + ImageParticle import)
frontend/src/engine/Editor.ts                    (insertFootnote 方法 + footnote factory import)
frontend/src/engine/interaction/KeyboardHandler.ts (Ctrl+Alt+F 快捷键)
frontend/src/engine/document/ElementFormatter.ts (createFootnoteRef + createFootnoteContent 工厂)
frontend/src/components/layout/Sidebar.tsx        (批注 Tab + CommentPanel 集成)
frontend/src/components/layout/EditorLayout.tsx   (CommentThread props 透传)
frontend/src/store/index.ts                       (sidebarTab +'comments')
```

## 架构决策

1. **IParticle 适配器模式**: 现有静态 Particle (TextParticle/SeparatorParticle) 保持不变, 通过轻量适配器对象实现 IParticle, 零风险零破坏
2. **脚注两阶段**: LayoutEngine Step 3 生成 `type:'footnote'` 占位 SLIF item → Step 4 FootnoteLayout 收集+编号 → 回填正文编号 + 生成脚注区 items
3. **批注面板**: 复用 Sidebar Tab 系统 (新增 'comments' tab), 无需新开右侧面板, 保持一致的交互模式
4. **ImageParticle**: 从 Draw.ts 抽离为独立 IParticle, 工厂函数接收 `resolveUrl` + `onImageLoaded` 回调

## 下一步

- 后端 API 对接 (TASK-531~539)
- 自动保存 AutoSaveManager (TASK-541~543)
- 水印 Watermark (TASK-555)
- 文档比较 DocumentDiffer (TASK-515~516)
- QC 质控引擎 (TASK-601~606)
