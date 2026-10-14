# @emrde/document-engine

EMR 电子病历文档引擎 —— 框架与平台无关的文档编辑内核。

引擎核心源码零浏览器全局依赖、零框架依赖：平台能力全部经注入的 `EditorHost`
六元组进入（文本测量 / 字体 / 渲染表面 / 视口 / 输入 / 平台）。因此同一份引擎
可以嵌进 React、Vue、Electron、Web Worker 或纯 Node 进程。

> 完整的**外部项目集成教程**（React / Vue / 原生 JS / 纯 Node，含手工接线清单与
> 排错表）见仓库 `knowledge/引擎集成指南/`（中英双语）。本文件只给最短上手路径。

## 安装

```bash
npm install <本地路径或 tarball>      # 目前为仓库内分发, 未发布到 registry
```

React 是可选 peer：只用核心与导出层时无需安装 `react`。

## 子路径

| 子路径 | 内容 | 能否在无 DOM 环境导入 |
|---|---|---|
| `@emrde/document-engine` | 引擎核心（文档模型 / 命令 / 布局 / 渲染 / 事件 / i18n / 序列化） | ✅ 可以 |
| `@emrde/document-engine/dom` | 浏览器宿主实现（canvas 表面、IME、剪贴板、IndexedDB 自动保存） | ❌ 需要浏览器 |
| `@emrde/document-engine/react` | React 适配器（`EditorProvider` 与 4 个 hook） | ❌ 需要 React + DOM |
| `@emrde/document-engine/export` | 导出 / 打印特性层（TXT / HTML / 结构化元素 / HL7 CDA / OFD / 打印记录） | ✅ 可以（OFD 需 `fflate`） |

## 用法

### 纯 Node / Worker —— 无 UI 的文档处理

模型的读写完全不需要宿主：`loadDocument` / `serializeDocument` 是纯数据函数。

```ts
import { Editor, loadDocument, serializeDocument } from '@emrde/document-engine'

// 纯数据路径 —— 不需要 EditorHost, 也不碰 DOM
const { doc, pool } = loadDocument(json)
const saved = serializeDocument(doc, pool)

// 需要交互 / 渲染时才构造 Editor, 平台能力由宿主注入
const editor = new Editor(host)
editor.setDocument(doc)
editor.setControlValue(nodeId, '张三')
```

### React

```tsx
import { EditorProvider, useEditorRef, useEditorStoreSnapshot } from '@emrde/document-engine/react'
import { createDomEditorHost } from '@emrde/document-engine/dom'

function App() {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <EditorProvider containerRef={ref} document={doc}>
      <div ref={ref} className="h-full" />
      <MyToolbar />
    </EditorProvider>
  )
}

function MyToolbar() {
  const editor = useEditorRef()
  const dirty = useEditorStoreSnapshot((s) => s.isDirty)
  return <button disabled={!dirty} onClick={() => editor.current?.undo()}>撤销</button>
}
```

`themePreset` 与 `dictionaries` 是受控 prop —— 应用订阅自己的状态后传入，
适配器不假定任何应用级 store。

### Vue —— 引擎本身无需改动

Vue 侧只需做与 React 适配器等价的接线：实现 `EditorHost`，把 `editor.getStore()`
与 `locale` 的订阅桥到 Vue 的响应式系统。

```ts
import { Editor, locale } from '@emrde/document-engine'
import { createDomEditorHost } from '@emrde/document-engine/dom'

const host = createDomEditorHost()
host.surface.mount(el)
host.input.mount(el)
const editor = new Editor(host)
const store = editor.getStore()

const version = ref(0)
store.subscribe(() => { version.value++ })     // 配合 computed 取快照
locale.subscribe(() => editor.refreshForLocale())
```

## 主题

引擎不发 CSS。`canvasTokens`（画布 28 个 token）由引擎内存持有；宿主主题化走
`PlatformHost.applyTheme`，由实现方决定落成 CSS 变量还是别的形式
（宿主侧实现示例: 仓库内应用把它落成 CSS 变量, 见 `frontend/src/platform/chrome/`）。

## 许可

MPL-2.0。分发的是可读 Source Code Form，未做压缩 / 混淆（见仓库 `IP-POLICY.md` §5）。
