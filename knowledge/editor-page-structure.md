# /editor/:id 页面结构分析

> 路由: `/editor/:id` (如 `/editor/doc_1`)
> 分析日期: 2026-07-31
> 入口组件: [frontend/src/pages/EditorPage.tsx](../frontend/src/pages/EditorPage.tsx)

---

## 路由配置

```tsx
// App.tsx
<Route path="/editor" element={<EditorPage />} />
<Route path="/editor/:id" element={<EditorPage />} />
<Route path="/editor/new" element={<EditorPage />} />
```

`/editor/doc_1` 匹配 `/editor/:id`，`id` 参数 = `"doc_1"`。

---

## 整体布局

```
+----------------------------------------------------------+
| HeaderBar  (h-header = 48px, 白色, border-bottom)         |
| [侧栏开关] [EMR Editor] | [标题输入框] [保存状态指示器]     |
|              [撤销] [重做] [保存]          [分享] [用户头像] |
+----------------------------------------------------------+
| Toolbar  (h-toolbar = 40px, 白色)                         |
| [撤销/重做] | [字体v] [字号v] | [B][I][U][S][上标][下标]    |
| | [颜色] | [表格][图片][控件v]                             |
| | [左对齐][居中][右对齐][两端对齐]                          |
| | [列表][有序列表][减少缩进][增加缩进]                      |
|                                    [打印] [导出v]         |
+---------------+----------------------+--------------------+
| Sidebar       |  Canvas 编辑区        | PropertiesPanel    |
| (w-sidebar    |  (flex-1)            | (w-properties      |
|  = 240px)     |  bg-[#E5E7EB]        |  = 280px)          |
|               |                      | 默认关闭            |
| [模板][元素]   |  Canvas 三层渲染      |                    |
| [页面] (Tab)  |  - static (z:1)      | 选中元素后滑出:      |
|               |  - content (z:2)     |  - 元素类型         |
| [搜索...]     |  - interact (z:3)    |  - 控件属性         |
|               |                      |  - 校验规则         |
| 医疗文书:      |  隐藏 textarea       |  - 数据绑定         |
|  - 入院记录    |  (聚焦接收键盘/IME)   |                    |
|  - 病程记录    |                      |                    |
|  - 出院小结    |                      |                    |
|  - 会诊记录    |                      |                    |
+---------------+----------------------+--------------------+
| StatusBar  (h-statusbar = 28px, bg-gray-50)               |
| 第 1 页 / 共 1 页  |  0 字       已保存  |  离线           |
+----------------------------------------------------------+
```

---

## 组件树

```
EditorPage
├── EditorProvider (提供 editorRef context)
│   └── EditorPageInner
│       └── EditorLayout
│           ├── HeaderBar
│           │   ├── 侧栏开关按钮 (PanelLeftClose / PanelLeft)
│           │   ├── Logo + "EMR Editor" 文字
│           │   ├── 文档标题 input
│           │   ├── SaveIndicator (保存状态)
│           │   ├── 撤销/重做/保存 按钮
│           │   └── 分享 + 用户信息
│           ├── Toolbar
│           │   ├── 历史操作组 (撤销/重做)
│           │   ├── 字体下拉 (FontDropdown)
│           │   ├── 字号下拉 (FontSizeDropdown)
│           │   ├── 文本样式组 (B/I/U/删除线/上标/下标)
│           │   ├── 颜色选择器 (ColorPicker)
│           │   ├── 元素插入组 (表格/图片/控件)
│           │   ├── 段落格式组 (左/中/右/两端对齐)
│           │   ├── 列表+缩进组
│           │   └── 文件操作 (打印/导出)
│           ├── Sidebar (可折叠)
│           │   ├── Tab: 模板 / 元素 / 页面
│           │   ├── 搜索框
│           │   └── 模板列表 (Mock 数据)
│           ├── Canvas 编辑区 (containerRef)
│           │   ├── Canvas static 层
│           │   ├── Canvas content 层
│           │   ├── Canvas interact 层
│           │   └── hidden <textarea> (IME)
│           ├── PropertiesPanel (右侧滑出)
│           └── StatusBar
└── ExportDialog (模态框)
```

---

## 各组件职责与状态

| 组件 | 文件 | 职责 | 当前状态 |
|------|------|------|----------|
| **HeaderBar** | `components/layout/HeaderBar.tsx` | Logo + 文档标题编辑 + 撤销/重做/保存 + 用户头像 | 功能完整，已接线 |
| **Toolbar** | `components/layout/Toolbar.tsx` | 字体/字号/加粗/斜体/颜色/对齐/列表/表格/图片/打印/导出 下拉菜单 | UI 完整，格式化 action 仅 undo/redo 接线，其余标记 TODO |
| **Sidebar** | `components/layout/Sidebar.tsx` | 模板列表 + 元素面板 + 页面缩略图 三个 Tab | UI 完整，模板为 Mock 硬编码数据 |
| **Canvas** | `engine/render/Draw.ts` | Canvas 2D 渲染引擎 + LayoutEngine 排版 + LayeredRenderer 三层渲染 | 核心引擎已接线，支持 A4 页面渲染 |
| **PropertiesPanel** | `components/layout/PropertiesPanel.tsx` | 元素属性编辑 (类型/校验规则/数据绑定) | 默认关闭，选中元素后右侧滑出 |
| **StatusBar** | `components/layout/StatusBar.tsx` | 页码/字数/保存状态/在线状态 | 数据均为静态占位 (页码 1/1，字数 0) |
| **ExportDialog** | `components/dialogs/ExportDialog.tsx` | JSON 导出对话框 | 功能完整 |

---

## 编辑器初始化流程

```
1. EditorPage 挂载
2. useParams → { id: "doc_1" }
3. useState → documentTitle = "未命名文档"
4. createDocument("未命名文档") → doc
5. EditorProvider 挂载
6. useEffect → new Editor(container, doc)
7. Editor 构造函数:
   a. createDocument("测试文档") → 含默认段落
   b. buildNodePool → 注册 doc/para/textNode
   c. new EventBus
   d. new Draw(container, eventBus, doc) → Canvas 三层创建
   e. new EditorStore(doc)
   f. new InputComposer(container) → 隐藏 textarea
   g. new KeyboardHandler(editor, container) → keydown 监听
   h. new CommandManager
   i. 注册 state:changed / document:changed 事件
   j. 注册 IME compositionend → InsertTextCommand
   k. recomputeLayout + render → 首帧
   l. 初始化光标 → 第一段 offset=0
   m. 注册 click→focus → 用户点击 Canvas 自动聚焦
   n. editor.focus() → 激活键盘输入
   o. notifyListeners('ready')
```

---

## Canvas 渲染管线

```
DocumentTree + NodePool
    ↓
LayoutEngine.fullLayout(doc, pool)
    ↓
SLIFPage[] (排版中间格式)
    ↓
Draw.render()
    ├→ LayeredRenderer.syncSizes()   → 调整三层 Canvas 尺寸
    ├→ LayeredRenderer.renderStatic() → 页面背景 + 水印
    └→ TextParticle.render()         → 文本粒子渲染
```

**三层 Canvas**:
| 层 | z-index | 职责 | pointerEvents |
|----|---------|------|---------------|
| static | 1 | 页面背景/阴影/水印 | auto |
| content | 2 | 文本/表格/图片 | auto |
| interact | 3 | 光标/选区/IME 预览 | auto |

---

## 键盘输入链路

```
用户点击 Canvas → click 冒泡至 container
    → this._clickToFocus → inputComposer.focus()
    → 隐藏 <textarea> 获得焦点

用户按键 → keydown 在 textarea 上触发
    → 冒泡至 container → KeyboardHandler.onKeyDown
    → 检查 cursor.paragraphPath (非空才处理)
    → execCommand(InsertTextCommand / SplitParagraphCommand / ...)

IME 中文输入:
    compositionstart → InputComposer.composing = true
    compositionend   → callback → InsertTextCommand
```

---

## 已知问题

| # | 问题 | 严重度 | 说明 |
|----|------|--------|------|
| 1 | **id 参数未使用** | 中 | `doc_1` 传入后未从后端加载文档，始终创建本地空白文档 |
| 2 | **格式化按钮空壳** | 中 | bold/italic/underline/font/fontSize/color 等 action 标记 `TODO: v20.34` |
| 3 | **保存未接后端** | 高 | `handleSave` 注释 `TODO: connect to backend API` |
| 4 | **状态栏数据静态** | 低 | 页码 1/1、字数 0 均为硬编码，未从引擎获取真实值 |
| 5 | **模板 Mock** | 低 | Sidebar 模板列表为硬编码，未从后端加载 |
| 6 | **无 Selection/MouseHandler** | 中 | 只有光标输入，无法用鼠标拖选文本 |
| 7 | **Cursor 不渲染** | 中 | 打字后光标位置在 Store 中更新，但 interact 层未绘制光标 |

---

## 设计 Token (tailwind.config.ts)

| Token | 值 | 用途 |
|-------|-----|------|
| `h-header` | 48px | HeaderBar 高度 |
| `h-toolbar` | 40px | Toolbar 高度 |
| `h-statusbar` | 28px | StatusBar 高度 |
| `w-sidebar` | 240px | 侧边栏宽度 |
| `w-properties` | 280px | 属性面板宽度 |
| `primary-500` | #3B82F6 | 主题蓝色 |
| `bg-[#E5E7EB]` | #E5E7EB | Canvas 背景灰 |
| `font-ui` | Inter, sans-serif | UI 字体 |
| `font-content` | Noto Serif CJK SC, SimSun | 文档内容字体 |

---

## 文件索引

| 层 | 关键文件 |
|----|----------|
| 入口 | [frontend/src/App.tsx](../frontend/src/App.tsx) |
| 页面 | [frontend/src/pages/EditorPage.tsx](../frontend/src/pages/EditorPage.tsx) |
| 布局 | [EditorLayout.tsx](../frontend/src/components/layout/EditorLayout.tsx), [HeaderBar.tsx](../frontend/src/components/layout/HeaderBar.tsx), [Toolbar.tsx](../frontend/src/components/layout/Toolbar.tsx), [Sidebar.tsx](../frontend/src/components/layout/Sidebar.tsx), [StatusBar.tsx](../frontend/src/components/layout/StatusBar.tsx), [PropertiesPanel.tsx](../frontend/src/components/layout/PropertiesPanel.tsx) |
| 编辑器桥接 | [EditorProvider.tsx](../frontend/src/components/editor/EditorProvider.tsx) |
| 引擎 | [Editor.ts](../frontend/src/engine/Editor.ts), [Draw.ts](../frontend/src/engine/render/Draw.ts), [LayeredRenderer.ts](../frontend/src/engine/render/LayeredRenderer.ts) |
| 输入 | [KeyboardHandler.ts](../frontend/src/engine/interaction/KeyboardHandler.ts), [IMEHandler.ts](../frontend/src/engine/interaction/IMEHandler.ts) |
| 数据 | [DocumentModel.ts](../frontend/src/engine/document/DocumentModel.ts), [NodePool.ts](../frontend/src/engine/document/NodePool.ts) |
| 命令 | [InsertTextCommand.ts](../frontend/src/engine/command/commands/InsertTextCommand.ts), [SplitParagraphCommand.ts](../frontend/src/engine/command/commands/SplitParagraphCommand.ts) |
| 状态 | [EditorStore.ts](../frontend/src/engine/state/EditorStore.ts), [EditorRuntimeState.ts](../frontend/src/engine/state/EditorRuntimeState.ts) |
