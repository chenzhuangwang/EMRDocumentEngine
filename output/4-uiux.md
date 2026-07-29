# UI/UX 设计文档 - 文档编辑器引擎

> 版本: v2.0 | 日期: 2026-07-28 | 阶段: docs (重构更新)
>
> **v2.0 变更**: 图标系统统一为 Lucide React，清除所有 emoji，对齐 ModelD 树形文档模型

## 1. 设计理念

### 1.1 设计原则

1. **内容优先**：编辑器是生产力工具，UI 不能喧宾夺主
2. **效率至上**：高频操作零步可达，所有功能支持快捷键
3. **视觉克制**：专业的医疗/政务场景，避免花哨装饰
4. **状态可见**：保存、同步、校验、留痕等状态始终可见

### 1.2 参考风格

专业工具型产品风格，参考：Notion（简洁）、Office Word（功能完整）、VS Code（效率）、Figma（Canvas 交互）

## 2. 设计令牌 (Design Tokens)

### 2.1 色彩系统

```css
:root {
  /* 品牌色 - 专业蓝 */
  --color-primary-50:  #EFF6FF;
  --color-primary-100: #DBEAFE;
  --color-primary-200: #BFDBFE;
  --color-primary-300: #93C5FD;
  --color-primary-400: #60A5FA;
  --color-primary-500: #3B82F6;
  --color-primary-600: #2563EB;
  --color-primary-700: #1D4ED8;
  --color-primary-800: #1E40AF;
  --color-primary-900: #1E3A8A;

  /* 中性色 */
  --color-gray-50:  #F9FAFB;
  --color-gray-100: #F3F4F6;
  --color-gray-200: #E5E7EB;
  --color-gray-300: #D1D5DB;
  --color-gray-400: #9CA3AF;
  --color-gray-500: #6B7280;
  --color-gray-600: #4B5563;
  --color-gray-700: #374151;
  --color-gray-800: #1F2937;
  --color-gray-900: #111827;

  /* 功能色 */
  --color-success-500: #22C55E;
  --color-success-100: #DCFCE7;
  --color-warning-500: #F59E0B;
  --color-warning-100: #FEF3C7;
  --color-error-500:   #EF4444;
  --color-error-100:   #FEE2E2;
  --color-info-500:    #3B82F6;
  --color-info-100:    #DBEAFE;

  /* 语义色 */
  --color-bg-primary:    #FFFFFF;
  --color-bg-secondary:  #F9FAFB;
  --color-bg-tertiary:   #F3F4F6;
  --color-bg-canvas:     #E5E7EB;       /* 编辑器画布背景 */
  --color-border:        #E5E7EB;
  --color-border-light:  #F3F4F6;
  --color-text-primary:   #111827;
  --color-text-secondary: #6B7280;
  --color-text-tertiary:  #9CA3AF;
  --color-text-inverse:   #FFFFFF;

  /* 留痕颜色 */
  --color-revision-insert:    #16A34A;
  --color-revision-delete:    #DC2626;
  --color-revision-modify:    #2563EB;
  --color-revision-insert-bg: #DCFCE7;
  --color-revision-delete-bg: #FEE2E2;
  --color-revision-modify-bg: #DBEAFE;

  /* 校验状态 */
  --color-validation-error:   #EF4444;
  --color-validation-warning: #F59E0B;
  --color-validation-success: #22C55E;
}
```

### 2.2 字体系统

```css
--font-family-ui:       'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-family-editor:   'JetBrains Mono', 'Consolas', 'Courier New', monospace; /* 等宽区域 */
--font-family-content:  'Songti SC', 'Noto Serif CJK SC', 'SimSun', serif;      /* 正文 */

/* 字号阶梯 */
--text-xs:   0.75rem;    /* 12px */
--text-sm:   0.875rem;   /* 14px */
--text-base: 1rem;       /* 16px */
--text-lg:   1.125rem;   /* 18px */
--text-xl:   1.25rem;    /* 20px */
--text-2xl:  1.5rem;     /* 24px */
--text-3xl:  1.875rem;   /* 30px */
```

### 2.3 间距系统

```css
--space-1:  0.25rem;   /* 4px */
--space-2:  0.5rem;    /* 8px */
--space-3:  0.75rem;   /* 12px */
--space-4:  1rem;      /* 16px */
--space-5:  1.25rem;   /* 20px */
--space-6:  1.5rem;    /* 24px */
--space-8:  2rem;      /* 32px */
--space-10: 2.5rem;    /* 40px */
--space-12: 3rem;      /* 48px */
```

### 2.4 圆角

```css
--radius-sm: 0.25rem;   /* 4px */
--radius-md: 0.375rem;  /* 6px */
--radius-lg: 0.5rem;    /* 8px */
--radius-xl: 0.75rem;   /* 12px */
```

### 2.5 阴影

```css
--shadow-sm:  0 1px 2px rgba(0,0,0,0.05);
--shadow-md:  0 4px 6px -1px rgba(0,0,0,0.1);
--shadow-lg:  0 10px 15px -3px rgba(0,0,0,0.1);
--shadow-xl:  0 20px 25px -5px rgba(0,0,0,0.1);
```

## 3. 布局架构

### 3.1 整体布局

```
┌─────────────────────────────────────────────────────────┐
│  Header Bar (48px)                                      │
│  [Logo] 文档标题  [保存状态]  [协作头像]  [分享]  [头像]  │
├──────────┬────────────────────────────────┬─────────────┤
│          │  Toolbar (40px)                │             │
│  Sidebar │  ┌───────────────────────────┐ │  Properties │
│  (240px) │  │                           │ │  Panel      │
│          │  │   编辑画布区域              │ │  (280px)    │
│  模板列表 │  │   (Canvas Editor)         │ │             │
│  元素面板 │  │                           │ │  元素属性    │
│  页面缩略图│  │                           │ │  数据绑定    │
│          │  │                           │ │  校验规则    │
│          │  │                           │ │             │
│          │  └───────────────────────────┘ │             │
│          │  Status Bar (28px)             │             │
├──────────┴────────────────────────────────┴─────────────┤
│  Context Menu / Dialogs                                 │
└─────────────────────────────────────────────────────────┘
```

### 3.2 视图模式切换 (v16.1: 对齐 EditorMode 六值)

| 模式            | 阶段 | 侧边栏 | 工具栏         | 属性面板 | 画布                               |
| --------------- | ---- | ------ | -------------- | -------- | ---------------------------------- |
| 编辑 (EDIT)     | MVP  | 可见   | 可见           | 隐藏     | 分页                               |
| 阅读 (READONLY) | MVP  | 隐藏   | 隐藏           | 隐藏     | 分页/连续                          |
| 表单 (FORM)     | P1   | 隐藏   | **隐藏** | 隐藏     | 分页 (仅 SmartTextNode 高亮可编辑) |
| 清洁 (CLEAN)    | P1   | 隐藏   | 隐藏           | 隐藏     | 分页 (**隐藏留痕标记**)      |
| 设计 (DESIGN)   | P2   | 可见   | 可见           | 可见     | 分页                               |
| 打印 (PRINT)    | MVP  | 隐藏   | 隐藏           | 隐藏     | 分页预览                           |

协作组件标注: 状态栏"在线:N人"、HeaderBar"协作头像" → **P3 远期**，MVP 基线不包含。

## 4. 页面交互设计

### 4.1 工具栏设计

```
┌────────────────────────────────────────────────────────────┐
│ [Undo] [Redo] │ [字体] [字号] │ B I U S X² X₂ │ Aa ▾ │ ⋮ │
│               │              │               │ 颜色  │    │
├────────────────────────────────────────────────────────────┤
│ [插入▾] [表格] [图片] [控件▾] │ [对齐▾] [列表▾] [缩进▾]  │
│                                │                          │
├────────────────────────────────────────────────────────────┤
│ [保存] [打印▾] [导出▾] │ [留痕:开/关] │ [模式▾] [视图▾]  │
└────────────────────────────────────────────────────────────┘
```

工具栏分组逻辑：

- **组1**：历史操作（Undo/Redo）
- **组2**：文本格式化（字体/字号/样式）
- **组3**：元素插入（表格/图片/控件）
- **组4**：段落格式（对齐/列表/缩进）
- **组5**：文件操作（保存/打印/导出）
- **组6**：视图控制（留痕开关/模式/视图）

### 4.2 侧边栏

```
┌──────────────────────┐
│ 搜索模板...          │
├──────────────────────┤
│ ┌──────────────────┐ │
│ │ [模板库] [元素] [页面] │  ← Tab 切换 (FileText / Puzzle / Layout 图标)
│ └──────────────────┘ │
├──────────────────────┤
│ 门急诊病历            │
│  ├ 初诊记录          │
│  ├ 复诊记录          │
│  └ 急诊记录          │
│ 住院病历              │
│  ├ 入院记录          │
│  ├ 病程记录          │
│  ├ 手术记录          │
│  └ 出院小结          │
│ 检查报告              │
│ ...                   │
└──────────────────────┘
```

### 4.3 属性面板（选中元素时右侧滑出）

```
┌──────────────────────────┐
│ 输入域属性               │
│                          │
│ 控件类型: [下拉选择 ▾]   │
│ 占位文本: [请输入...]    │
│ 是否必填: [✓]           │
│ 最大长度: [100]          │
│ ──────────────────────   │
│ 数据绑定                 │
│ 数据源: [patient.name]   │
│ ──────────────────────   │
│ 校验规则                 │
│ 正则表达式: [.......]    │
│ 错误提示: [格式不正确]   │
│ ──────────────────────   │
│ 权限                     │
│ 用户级: [owner ▾]        │  ← 下拉: owner/editor/commenter/viewer
│ 节点级:                  │
│  ☑ 锁定内容 (locked)     │
│  ☐ 禁止删除 (undeletable) │
│  ☑ 必填 (required)       │  ← 三开关与 §2.12 L2-L4 对齐
└──────────────────────────┘
```

### 4.4 状态栏

```
┌────────────────────────────────────────────────────────────┐
│ 第 1 页 / 共 3 页  │ 字数: 1,234 │ 保存状态  │ 在线: 3 人 │
└────────────────────────────────────────────────────────────┘
```

### 4.5 右键菜单

```
┌────────────────────┐
│ Scissors  剪切 Ctrl+X │  ← 图标: Scissors
│ Copy      复制 Ctrl+C │  ← 图标: Copy
│ Paste     粘贴 Ctrl+V │  ← 图标: ClipboardPaste
├────────────────────┤
│ Bold      加粗 Ctrl+B │  ← 图标: Bold
│ Italic    斜体 Ctrl+I │  ← 图标: Italic
│ Underline 下划线 Ctrl+U│ ← 图标: Underline
├────────────────────┤
│ MessageSquare 添加批注 │  ← 图标: MessageSquare
│ Link       插入链接   │  ← 图标: Link
├────────────────────┤
│ Trash2     删除       │  ← 图标: Trash2
└────────────────────┘
```

## 5. 核心交互流程

### 5.1 新建文档流程

```
首页（文档列表）
    │
    ▼ 点击「新建文档」
选择模板对话框
    │
    ├─ 从模板新建 ──── 浏览模板 → 选择 → 创建
    │
    └─ 空白文档 ────── 直接创建
    │
    ▼
编辑器加载（EDIT 模式）
    │
    ▼ 编辑内容 → Ctrl+S 保存
    │
    ▼
文档自动出现在文档列表中
```

### 5.2 模板设计流程

```
模板管理页
    │
    ▼ 点击「新建模板」
编辑器（DESIGN 模式）
    │
    ├─ 拖拽控件到画布
    ├─ 右键配置属性
    ├─ 设置数据绑定
    ├─ 配置校验规则
    │
    ▼ 点击「保存模板」
填写模板名称/分类 → 保存
```

### 5.3 质控审核流程

```
打开文档（READONLY 模式）
    │
    ▼ 阅读文档内容
    │
    ├─ 发现问题 → 选中文本 → 添加批注
    ├─ 修改内容 → 自动留痕
    │
    ▼ 审核完成
    │
    ├─ 通过 → 更新状态为「已审核」
    └─ 驳回 → 更新状态为「需修改」+ 批注说明
```

### 5.4 拖拽交互 (v16.1 新增 — 设计模式核心)

拖拽状态: EditorRuntimeState.drag (DragState, 架构 §27.4)

- drag.type='move': 移动已放置元素 → 预览半透明原位置 + 光标处跟随缩略图
- drag.type='resize': 表格列宽拖拽 → 垂直虚线指示线 + 相邻列实时宽度预览
- drag.type='none': 闲置

合法落点指示:

- 块级元素拖拽: 目标行间显示蓝色水平线 (insert indicator)
- 表格列宽: 仅水平移动, 吸附到 colWidths 网格 (±3px 吸附)
- 非法落点: 拖拽至 undeletable 节点上 → 光标变 not-allowed + 红色虚线框

ElementPalette 拖拽到画布:

- 从侧边栏拖出控件 → 光标变为 grab 图标
- 进入画布区 → 光标变为 copy 图标 (表示将创建新节点)
- 释放 → 触发 InsertBlockCommand
- 对齐线: 与相邻段落左边界 ±5px 内自动吸附

## 6. 组件树

```
App
├── Layout
│   ├── HeaderBar
│   │   ├── Logo
│   │   ├── DocumentTitle
│   │   ├── SaveIndicator          // 已保存/保存中/未保存
│   │   ├── CollaboratorAvatars     // 在线协作者头像
│   │   └── UserMenu
│   ├── Sidebar
│   │   ├── SidebarTabs             // 模板 | 元素 | 页面
│   │   ├── TemplateList            // 模板分类 + 列表
│   │   ├── ElementPalette          // 可拖拽元素
│   │   └── PageThumbnails          // 页面缩略图
│   ├── EditorArea
│   │   ├── Toolbar
│   │   │   ├── ToolbarGroup (History)
│   │   │   ├── ToolbarGroup (Format)
│   │   │   ├── ToolbarGroup (Insert)
│   │   │   ├── ToolbarGroup (Paragraph)
│   │   │   ├── ToolbarGroup (File)
│   │   │   └── ToolbarGroup (View)
│   │   ├── Canvas                  // Canvas 渲染区 (3 层)  │
│   │   │   ├── StaticLayer         // 静态层: 页面背景/阴影/边距线/页眉页脚/页码/水印
│   │   │   ├── ContentLayer        // 内容层: 文本/表格/SmartText/Image
│   │   │   └── InteractLayer       // 交互层: 光标/选区高亮/IME 预览/批注指示
│   │   └── StatusBar
│   │       ├── PageIndicator
│   │       ├── WordCount
│   │       ├── SaveStatus
│   │       └── OnlineCount
│   ├── PropertiesPanel             // 右侧滑出
│   │   ├── ElementProperties
│   │   ├── DataBindingConfig
│   │   ├── ValidationConfig
│   │   └── PermissionConfig
│   └── ContextMenu
├── Dialogs
│   ├── TemplateSelectDialog
│   ├── PrintPreviewDialog
│   ├── ExportDialog
│   └── VersionHistoryDialog
└── Notifications
    ├── Toast                      // 操作反馈
    └── ValidationIndicator        // 校验状态标记
```

## 7. UI 状态设计

### 7.1 保存状态

| 状态   | 标识      | 视觉效果                   |
| ------ | --------- | -------------------------- |
| 已保存 | Saved     | 灰色 "已保存" 文字         |
| 保存中 | Saving... | 蓝色旋转图标 + "保存中..." |
| 未保存 | Unsaved   | 橙色圆点 + "未保存"        |

### 7.2 协作状态

| 状态   | 标识    | 视觉效果          |
| ------ | ------- | ----------------- |
| 在线   | Online  | 绿色圆点          |
| 离线   | Offline | 灰色圆点          |
| 编辑中 | Editing | 用户名 + 彩色光标 |

### 7.3 校验状态

| 状态     | 视觉效果                           |
| -------- | ---------------------------------- |
| 未校验   | 无标记                             |
| 校验通过 | 绿色小勾 ✓                        |
| 校验失败 | 红色边框 + 错误图标 + tooltip 提示 |
| 必填未填 | 橙色边框 + "此项必填" tooltip      |

## 8. 响应式策略

| 断点    | 宽度        | 布局调整                                              |
| ------- | ----------- | ----------------------------------------------------- |
| Desktop | >= 1280px   | 完整三栏                                              |
| Laptop  | 1024-1279px | 属性面板折叠为抽屉                                    |
| Tablet  | 768-1023px  | 侧边栏+属性面板均折叠                                 |
| Mobile  | < 768px     | **只读查看模式** (编辑不支持, v16.0 与架构统一) |

## 9. 图标清单

以下所有图标来自 Lucide React 图标库：

```
工具栏:
  Undo          - Undo2
  Redo          - Redo2
  Bold          - Bold
  Italic        - Italic
  Underline     - Underline
  Strikethrough - Strikethrough
  Superscript   - Superscript
  Subscript     - Subscript
  TextColor     - Palette
  Table         - Table
  Image         - Image
  Save          - Save
  Print         - Printer
  Export        - Download
  Search        - Search

侧边栏:
  Templates     - FileText
  Elements      - Puzzle
  Pages         - Layout

状态栏:
  PageInfo      - FileText
  WordCount     - Type
  Online        - Users
  Saved         - Check
  Unsaved       - Circle
  Saving        - Loader2

右键菜单:
  Cut           - Scissors
  Copy          - Copy
  Paste         - ClipboardPaste
  Delete        - Trash2
  Annotation    - MessageSquare
  Link          - Link

导航:
  Home          - Home
  Settings      - Settings
  User          - User
  Logout        - LogOut
  Expand        - ChevronRight
  Collapse      - ChevronLeft

控件类型:
  Input         - Type
  Select        - ChevronDown
  Date          - Calendar
  Checkbox      - CheckSquare
  Radio         - Circle
  Number        - Hash

文档操作:
  New           - FilePlus
  Open          - FolderOpen
  Copy          - Copy
  Move          - ArrowRightLeft
  Share         - Share2
  Version       - GitBranch
  Compare       - GitCompare

状态:
  Online        - Wifi
  Offline       - WifiOff
  Success       - CheckCircle2
  Warning       - AlertTriangle
  Error         - AlertCircle
  Info          - Info
```
