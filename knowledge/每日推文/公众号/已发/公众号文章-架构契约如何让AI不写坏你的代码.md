# 架构契约：如何让 AI 不写坏你的代码

> AI 写代码很快，但很容易"为了让它跑起来"绕开架构。一年独立开发踩过的最大教训，是把架构边界写进一份 AI 看得懂的硬性约定。

上一篇聊表格跨页的 P0 / P1 / P2 三档降级。写完发出去之后，后台有读者问：这些分页策略是迭代过程中**自然长出来**的，还是一开始就这么设计？

实话讲：是先被自己绊倒，再回来补的。

最初没有"架构契约"这回事——编辑器内核先跑通，再把规则补到仓库根目录的 [AI_EDITOR_CONTRACT.md](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) 里。这份契约的开头第一行就写着 **Status: MANDATORY**，没有任何商量余地。它解决的就是一个具体问题：**怎么让 AI 写代码时，不把你已经搭好的架构偷偷拆掉**。

## 一、问题的形状：AI 写代码的"舒适区"恰好是架构的雷区

这一年里踩过的坑，集中在三件事上：

1. **"为了方便，import 一下 React 吧"**——某次让 AI 写一个工具函数，它顺手 `import React from 'react'`，文件是引擎内部的，从此引擎依赖了 UI；
2. **"节点数组直接 push 一个新节点更快"**——绕过 `NodePool.addNode`、绕过 `CommandManager`，某天发现撤销栈里少了一个状态；
3. **"这里再存一份 selection 渲染层用"**——`EditorStore` 存一份、`Zustand` 存一份，光标移动时两边不同步。

这些改动的共同特征：**每一行都是"合理的局部最优"，但叠在一起，架构就散了**。等到排版算法、撤销栈、协同编辑器想沿着既有边界长出来时，**前面偷的懒全都要还**。

更扎心的是：人写代码会带"架构警觉性"——看到 `document.nodes.push` 会多想一秒"这能 undo 吗"；AI 不会。AI 的优化目标是"让这段代码正确工作并通过眼前的测试"，**不会主动维护一份你脑子里有、但代码里没写出来的不变量清单**。

所以真正有效的做法，是**把不变量从口头约定变成机器可读的硬性文件**，再把 AI 的执行边界圈进这份文件。

## 二、解法：把架构不变量写进 MANDATORY 文件

仓库根目录的 [AI_EDITOR_CONTRACT.md](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) 有 3,200 多行、12 个主章节、25 条 FINAL ARCHITECTURAL INVARIANTS。它的存在不是为了好看，是因为**没有它，AI 会在你不知道的时候悄悄拆墙**。

这份契约的第一行就区分了四种状态——这是它真正有用的起点：

```
1. MUST NOT  — 禁止的架构 (现在禁用)
2. MUST      — 必守的不变量 (现在生效)
3. SHOULD    — 推荐设计 (引导)
4. TARGET    — 未来的位置/状态 (以后再说)
```

没有这层区分，AI 就会把"我打算这么写"和"这里已经写完"混在一起。**它在两者之间会默认走阻力最小的那条路**——也就是把"以后再做的"提前到"现在就改"，结果是你既没拿到未来结构、也丢掉了现有结构。

往下读，契约的核心是 §0 的"层间禁止穿越"：

```text
User Input
    ↓
Interaction
    ↓
Editor
    ↓
Command
    ↓
DocumentModel
    ↓
Layout
    ↓
Render
    ↓
Canvas / Screen
```

并明确写：**The architecture MUST NOT be bypassed for convenience. Prefer architectural correctness over the shortest implementation.**

这两句话是后面所有 25 条 RULE 的根。下面挑**对 AI 写作影响最大的六条**讲，每条都配一个真实踩过的坑。

## 三、六条最容易被 AI 拆掉的边界

### 边界 1 · RULE 1：引擎零 React、零浏览器全局

契约原文：[§1 Engine/UI Boundary](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) + RULE 1。

```text
engine/ MUST NOT depend on:
- React
- React components
- pages/ · components/
- application-level Zustand stores
- UI-specific implementation details
- browser globals (full list in §28)
```

依赖方向只能从 UI 流向引擎，**反向一律禁止**：

```text
pages/        → engine/
components/   → engine/
platform/dom  → engine/

(不允许)
engine/       → components/
engine/       → pages/
engine/       → React
```

**为什么这条最容易被拆？** 因为 UI 工具函数太多了——`useState` 拿一个值、`fetch` 调一个接口、读 `localStorage` 取个缓存。AI 看到需求"在引擎里用一下 X"，最省事的写法就是**直接 import 进来**。一次两次没关系，等引擎里 20 个文件都 import 了 React 的某个小工具，**迁移成本就比从头写还高了**。

具体执行：所有浏览器能力必须经过 [EditorHost](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/host/EditorHost.ts) 这套接口进入引擎。`TextHost` / `FontHost` / `SurfaceHost` / `ViewportHost` / `ClipboardHost` / `PlatformHost` / `StorageHost`——每个能力一个接口，**谁能创建 canvas、谁能拿到 DPR、谁能调度帧，全在 platform/ 那层**。

**对应的硬约束**：[§28 Browser Global Prohibition](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) 把禁止项列成白名单——`document` / `window` / `navigator` / `localStorage` / `requestAnimationFrame` / `IntersectionObserver` 都不许直接出现。唯一例外是 `CanvasRenderingContext2D` 及其同类，**仅作为"被 SurfaceHost 注入的绘制上下文"使用**——引擎不许自己 `getContext()`，不许自己 `new OffscreenCanvas()`。

落地后能直接验收的检查是：把 [frontend/src/engine/](file:///d:/czw/EMRDocumentEngine/frontend/src/engine) 任何一个模块 import 进 Node.js REPL / Web Worker，**不能触发任何浏览器副作用**（契约 §29 Safe Import Invariant）。这是 [ContractCompliance.test.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/__tests__/ContractCompliance.test.ts) 在守的不变量之一。

### 边界 2 · RULE 2：DocumentModel 不知道"怎么画"

契约原文：[§2 Document Model Boundary](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md)。

```text
DocumentModel MUST NOT depend on:
- layout/
- render/
- CanvasRenderingContext2D
- DOM rendering
- React
- UI components
- viewport implementation
```

DocumentModel 只能回答"**文档是什么**"——paragraphs / text runs / tables / sections / styles / headers / footers / bookmarks / footnotes / metadata。**不能回答"怎么画"**、**不能回答"显示在哪"**。

这一条反直觉，但一旦被拆，后果最难收。`DocumentModel` 里如果开始出现 `color` / `border` / `boxShadow` 之类"绘制属性"，你会得到这样的代码：

```ts
// 灾难: DocumentModel 知道"画"了
class TableNode {
  border: string                  // ← 演示属性
  background: string              // ← 演示属性
  shadowColor: string             // ← 演示属性
  // ...
}
```

从此任何"只想要 JSON 不想渲染"的下游（导出 PDF、写对比算法、做版本回溯）都被迫拖着 `border` / `shadowColor` 走；演示文稿和病历模板的 JSON 长得不一样，但都从 DocumentModel 长出来，**结构层和表现层就再也分不开了**。

契约里把这层关系也写死：[§2.2 Semantic style vs presentation style](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md)——`DocumentModel` 只拥有"语义样式"（`TextStyle`: font / size / bold / italic / color / highlight），**演示/盒模型属性（borderStyle / contentStyle / minWidth / textAlign）属于渲染层的 PresentationStyleStore**，按 nodeId 关联，禁止回写到 DocumentModel。

**判断小窍门**：看一个字段写在 DocumentModel 上，**如果它的存在完全不影响"文档是什么"，只影响"它看起来怎样"——它就不该在 DocumentModel**。

### 边界 3 · RULE 3：每个可变事实只有一个 owner

契约原文：[§7 State Ownership](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md)。

```text
Every mutable fact MUST have exactly ONE owner.
```

整套引擎里只有一个**事实清单**：

| 状态分类 | 唯一 owner | 例 |
|---|---|---|
| 应用状态 | Zustand | current document id / current user / sidebar / dialog state |
| 编辑器运行时 | `engine/state/EditorStore` | caret / selection / IME / viewport / zoom / edit mode |
| 文档状态 | `DocumentModel` | nodes / text / paragraphs / tables / sections / styles / headers / footers / metadata |
| 布局派生状态 | `LayoutEngine / LayoutCache` | lines / pages / SLIF / page starts / text metrics / cache |
| 模板/演示状态 | `TemplateDefinitionStore` / `PresentationStyleStore` | 模板设计属性、演示属性（**按 nodeId 关联**） |

**对应的红线是 §7.5 Duplicate State Rule**：

```text
FORBIDDEN:  Zustand.selection  +  EditorStore.selection
Both cannot independently own the current selection.
```

**这是协同编辑最常踩的坑**。协同一旦上线，"在线人员"和"光标位置"在协作语义里是**两件不同的事**——`onlineUsers` 是 awareness（"谁在这里"），不是 document content（"文档里有什么"）。契约里 §9.1 把这层关系也写死：

```text
Presence / Awareness MUST NOT become document state.
onlineUsers is AWARENESS ("who is here"), not DOCUMENT CONTENT.
Its home is application state, never DocumentModel,
never the persisted document JSON.
```

AI 在写协同相关代码时，最容易顺手在 `DocumentModel` 里加一个 `onlineUsers: string[]`。**这一加，文档版本号就乱了**——纯本地编辑的人，永远会在他们的版本里看到一份"我从来没邀请过的协同者列表"。

**更隐蔽的 owner 陷阱**：[§7.2](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) 明确 `EditorStore.document` **不是第二个文档 owner**——它持有的是 `DocumentTree` 的**引用**（reference），不是副本。它的唯一写入方是 `EditorStore.setDocument()`，用来"换一份完整文档"；就地编辑通过 NodePool 修改 `DocumentTree`，**永远不会写回 EditorStore**。

> "持有引用"和"独立存储"在类型签名上都是 `document: DocumentTree`，但前者你能安全 `===` 比较引用，后者会产生看似同步实则漂移的双副本。**类型不会替你判断，但契约会。**

### 边界 4 · RULE 4：所有变更必经 Command

契约原文：[§5 Command Mutation Gate](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md)。

```text
ALL document mutations MUST go through the command system.

Canonical mutation flow:
    Input
      ↓
    CommandManager
      ↓
    ICommand
      ↓
    DocumentModel mutation
```

被点名的禁止动作是：

```text
FORBIDDEN:
  component → document.nodes.push(...)
  toolbar   → node.text = ...
  dialog    → DocumentModel mutation
  plugin    → direct DocumentModel mutation
```

这一条最容易被"小聪明"拆掉。AI 在写工具栏时，常会写出这种代码：

```ts
// 灾难: 工具栏直接改节点
const node = pool.getNode(activeId)
node.text = newValue           // ← 绕开 Command
render()                       // ← 手动触发渲染
```

短期看这段代码"工作得很好"。但它的代价是：

1. **撤销栈里少一步**——按 Ctrl+Z 跳过了这次修改；
2. **`autoSave.markDirty()` 没被调用**——本地存盘错过这次；
3. **`document:changed` 没发**——监听这个事件的下游（字数统计、toolbar 灰化、缩略图）集体失明；
4. **协同时无法被传播**——等到 Yjs 编辑流接入，这次改动就是"幽灵修改"。

**判断小窍门**：写完一段改动代码，先看它**有没有走 `CommandManager.execute(new XxxCommand(...))`**。如果没有，立刻打回。

### 边界 5 · RULE 5：单一变更入口必须由类型系统强制

契约原文：[§6 Single Mutation Choke Point](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md)。

```text
Document mutation MUST have a controlled entry point.
The choke point MUST be enforced by the type system,
not by a comment or a naming convention.
```

`readonly nodes = new Map(...)` **不是变更入口**——`readonly` 只锁引用，不锁 Map。外部照样可以 `pool.nodes.get(x).children.push(...)` 或 `pool.nodes.set(...)`，编译器一声不吭。

NodePool 的对外接口必须是显式白名单：

```text
Read:     getNode(id) / hasNode(id) / traversePool(cb)
Mutate:   addNode(node)          // 注册, 重复 id 抛错
          removeNode(id)
          updateNode(node)       // 改 id / type 抛错
          insertChild / removeChild / moveChild / detachChild
          removeOrphanLeaf
```

**关两个不同的泄漏口**：

```text
PROBLEM A — pool 本身:
    pool.nodes.set(...) / pool.nodes.delete(...)

PROBLEM B — node 的 children 数组:
    const row = pool.getNode(...); row.children.push(...)
```

把 `nodes` 私有化只解决 A，不解决 B。**拿到节点引用的人依然能 in-place 改 `node.children`**。所以受控 API 是**唯一**改结构的途径，调用方**不许**直接 mutate `node.children`。

> 契约里专门写了："A Command that needs a structural operation NodePool does not yet provide MUST first extend NodePool with a controlled method, then call it — never mutate the tree directly."

**判断小窍门**：看 `frontend/src/engine/command/commands/` 下任何 `*Command.ts`，有没有 `pool.nodes.xxx(...)` 或 `row.children.splice(...)` 之类的"野调用"。**有，就是绕过 choke point**。

> 这一条和 §6.2 联合起来更稳：Command 是"谁可以发起变更"的入口，NodePool / DocumentModel 受控 API 是"一旦发起，怎么合法变更"的执行。**入口（gate）和执行（enforcement）是两层，不要混**。

### 边界 6 · RULE 6 & 7：所有浏览器能力必须经 Host，且不引入 import 副作用

契约原文：[§27 Host Abstraction Boundary](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) + [§28 Browser Global Prohibition](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) + [§29 Safe Import Invariant](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md)。

```text
The engine is a pure document-editing runtime.
It is portable across hosts:
    React / Vue / Electron renderer
                ↓
    platform/dom (browser adapter)
                ↓
    EditorHost (capability boundary)
                ↓
    engine/ (pure runtime)
```

**Host 注入机制是 §27.3**：

```text
const editor = new Editor(host, doc)
```

不是全局注册表。`new Editor(host, doc)` 是 composition root——它拿到 host，构造 host-dependent 服务（`FontManager` / `TextMeasurer`），再把这些能力**透传**到所有子系统（Draw → LayeredRenderer / LayoutEngine → LineBreaker、particles、interaction、clipboard、performance、theme）。

**因此**：

```text
FORBIDDEN:  setEditorHost() / getEditorHost() / hasEditorHost() 这种全局可变槽
REQUIRED:   new Editor(host, doc) 构造时一次性注入
```

**对应的安全 import 不变量**（§29）：

```text
ENGINE MODULES MUST BE SAFE TO IMPORT IN NON-DOM RUNTIMES.
Importing any engine/ module MUST NOT:
  - access document / window / navigator
  - create canvas or DOM elements
  - attach event listeners
  - start browser-only timers
  - trigger any browser-side effect
```

包含模块级单例和它们的构造函数。这条对应着契约里明确点名的反例：

```ts
// FORBIDDEN: import 时就实例化, 触发副作用
export const textMeasurer = new TextMeasurer()
```

Module-level singleton **只能是"纯配置 / 注册表"**——`scriptResolver` / `particleRegistry` / `documentLoaderRegistry` / `modelUpgrader` / `locale`。**这些在 import 时无副作用**（§27.3），自然可以全应用共享；host-dependent 服务（TextMeasurer / FontManager / FontFallback）必须是 per-Editor 实例，**禁止 module-level 单例**。

**这一条是 AI 写 engine 代码时最容易忽视的**——它"读起来"非常像纯函数/纯配置，但 import 时如果偷偷 new 了一个引用 `document` 的对象，整个引擎就被"污染"在 DOM 环境里。**没污染之前，引擎能在 Web Worker 里跑；污染之后，它只能跑在浏览器主线程**。

## 四、剩下的 RULE 8–11：撤销/上下文的细节护栏

前六条是结构性边界，下面四条是行为性护栏，单独点一下：

- **RULE 8（撤销/重做是文档变更）**：撤销/重做不能把"document changed"事件降级为"render:request"。如果撤销后 autoSave 没标 dirty、字数统计没刷新、toolbar 状态没更新——这是正确性 bug，不是风格问题。契约 §8.2 明确写了：`autoSave.markDirty()` 与 `notifyListeners('contentChange')` **不能被跳过**。
- **RULE 9（撤销栈单一 owner）**：`engine/command/CommandUndoRedoStack` 是 undoStack / redoStack 唯一所有者。`HistoryState` 是 `{ canUndo, canRedo, undoDepth, redoDepth }` 的**纯投影**——**不许存命令**。否则就会出现"两个 undo 栈在打架"。
- **RULE 10（context snapshot 边界）**：引擎可以暴露**只读**编辑器上下文快照给 UI 消费。快照只能描述 editor/document **事实**——**不许包含**：menu items / UI components / menu actions / React state / UI-specific commands。**右键菜单长什么样、菜单项叫什么名字——这是 UI 的事，引擎不许知道**。
- **RULE 11（原子复合操作）**：用户一次操作涉及多个 sub-mutation（剪切 = 抓剪贴板 + 删 range），**必须折叠成一个 undo 单位**。`CommandManager` 提供 `beginMacro / endMacro` 事务接口，组合命令走 `MacroCommand`。**非变异的副作用**（如剪贴板抓取）**不进入 undo 栈**。

这四条都不是"今天没遵守就崩溃"的边界，但每一条都对应一类**真实生产 bug**。RULE 8 的"撤销不可见"会丢数据，RULE 9 的"双 undo 栈"会让 Ctrl+Z 行为漂移，RULE 10 的"引擎塞菜单项"会让一份引擎被绑死在某个 UI 框架，RULE 11 的"多步撤销"会让"撤销一次"变成"撤销两次"。

## 五、契约不是文档，是工程的"反熵增"机制

写到这里，核心其实只有一句：**架构边界要靠"机器可读的硬性约定 + 类型系统强制 + 显式接口边界"维护，不靠人记得住**。

这一年里，契约修正过两轮：

- **第一轮补 RULE**：早期只有 4 条 RULE，AI 在 4 条之外"打补丁"——补丁打多了，反而绕过了 RULE；
- **第二轮补 §6.1 NodePool 的 type-level 强制**：最早只有注释"`readonly nodes` 锁住引用"，AI 看了一眼注释就在 `pool.nodes` 上 `set(...)`。改成"NodePool 的对外接口白名单 + Map 私有化"才堵上。

**判断一份契约有没有用，就看一个动作**：让 AI 在不读这份契约的情况下写代码，看它会主动避开几个雷区。

如果答案是 0——**不是 AI 厉害，是契约没写到雷区上**。

## 六、坦诚地说，现状

按惯例，把现状说清楚：

**已经落地的部分**：

- §1–§9 的结构性边界（Engine/UI、DocumentModel、Layout、Render、Command、NodePool、State Ownership、Yjs、Dependency Direction）已在仓库内**通过 import 方向 + 类型 + 受控 API 强制**，并在 [ContractCompliance.test.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/__tests__/ContractCompliance.test.ts) 里有专门测试；
- §11.2 三个 named drift（`selection-collection` / `format painter` / `table merge/split`）已**抽出到 `SelectionCollector.ts` / `FormatPainter.ts` / `TableOps.ts`**，Editor.ts 只保留 facade 调用，**重复实现的"复制-粘贴痕迹"被显式反向**；
- §15 EventBus 已合并到 `engine/interaction/EventBus.ts`（**一个** canonical bus），`engine/EventBus.ts` 的死代码已**标记待删除**；
- §12.1 / §12.2 模板与演示样式已**按 nodeId 拆成 TemplateDefinitionStore / PresentationStyleStore 两个 per-Editor 实例**，DocumentModel **不持有**这 8 个设计时字段。

**仍未完全落地的部分**：

- **shared style-reference 字典**（`style: {id}` + 模板的 `styles` / `globalStyles`）——§2.2 标 TARGET，等模板里出现**真正的大规模样式重复**时再做；
- **`computeEffectiveColumnWidths`** 仍是简单拷贝（[MergeMatrix.ts#L146-L153](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/document/table/MergeMatrix.ts#L146-L153)），按合并关系折算列宽的逻辑**仍由 `buildTableRows` 直接累加**——等真出现"按合并列折算"的精确需求再做；
- **RULE 3 模板/演示状态**的"per-Editor 单例"注入已经写完，但 `Editor.setDictionaries` 的注入接缝**目前仍有一个已知 trap**——[§12.6.4](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) 明确点出"原 `?? null` 在每次 setDocument 时会**静默丢弃已注入的 provider**"，已反向为"只在显式传 `stores?.dictionaries !== undefined` 时才替换"，但**仍需全量回归**。

> 契约不是"已经做完了"的文件。它是"已经知道哪些不能动"的文件——知道边界本身，就是工程的一部分。

## 写在最后

回到开头：AI 写代码很快，但**架构的代价是事后付的**。当一份"看起来 work"的代码悄悄 import 了 React、悄悄 push 了一个节点、悄悄在两处各存了一份 selection，**真正的债务是排版算法、撤销栈、协同编辑器想长出来时，前面埋的雷一起爆**。

这一年最值钱的经验，是把"不变量"从"团队口头约定"升级成"**机器可读的硬性文件 + 类型系统强制 + 受控 API 白名单**"。这份 [AI_EDITOR_CONTRACT.md](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) 现在是 3,200 多行、25 条 RULE，每一条背后都对应一个曾经被 AI 拆过的真实坑。

如果你的项目也遇到"AI 把能跑的代码塞得到处都是，但每次提 PR 都像在拆炸弹"——**先别优化 prompt，先把架构不变量写进 MANDATORY 文件**。一份写得足够细的契约，比十遍"请注意架构"管用。

这也是「EMR 文档编辑器」这套引擎在做的事：从零手写、不依赖任何第三方富文本框架，把内核一块一块做扎实——而**做扎实的方式之一，就是给 AI 立规矩**。如果你也在做编辑器、做医疗信息化，欢迎了解这个正在成长的开源项目，也欢迎直接在线体验：

- **在线体验**：<http://139.196.151.15/?utm_source=wechat&utm_medium=article&utm_campaign=W08-architecture-contract>
- **开源仓库**：<https://gitee.com/wangwang_1_1665527118/emrdocument-engine?utm_source=wechat&utm_medium=article&utm_campaign=W08-architecture-contract>

---

这是「EMR 文档编辑器」系列的第 8 篇。前七篇分别聊了：编辑器为什么值得单独做、质量该在哪一步管住、病历数据的"活"与"死"、信息科的时间去哪了、科室经验怎么变成配置、撤销栈与 Command 模式、表格跨页与合并矩阵。这一篇聊**怎么用一份硬性约定，把 AI 拆架构的手拴住**。

下一篇，我们把镜头拉回选型台——《病历编辑器选型地图：商业套件 / 开源内核 / 自研，各适合谁》，聊聊这三条路各自的适用边界与隐性成本，以及不同团队该拿哪些指标来做这道选择题。

──────────────
📌 往期精选
· 表格跨页与合并矩阵算法：一张表格怎么"活"着穿过分页线
· 撤销栈与 Command 模式：编辑器的"后悔药"为什么不能靠快照
· 病历编辑器，为什么成了 HIS 的"咽喉"

如果这篇对你有用，欢迎关注「旺de碎碎念」
这里持续记录电子病历、医疗信息化与开源工程化的真实实践。
点个「在看」，让更多同行看到 ↓
──────────────

> 一份病历不该是医生的负担。让好的工具，成就更好的医疗。

---
---

# 以下为发布附件（不随稿件发布到平台）

## 附件 A · 事实自检表（契约 D1）

> 口径基线：AI 推广契约 §1.1–1.5（项目资产）与 §1.6（账号数据）。本篇所有架构事实均以 [AI_EDITOR_CONTRACT.md](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) 仓库实测为准。

| 稿件中的表述 | 事实出处 | 核验结果 |
|---|---|---|
| 契约首行 **Status: MANDATORY** | [AI_EDITOR_CONTRACT.md#L1-L5](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L1-L5) | ✅ |
| 契约区分 MUST NOT / MUST / SHOULD / TARGET 四种状态 | [AI_EDITOR_CONTRACT.md#L20-L31](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L20-L31)（CONTRACT STATUS 段） | ✅ |
| §0 核心流：User Input → Interaction → Editor → Command → DocumentModel → Layout → Render → Canvas/Screen | [AI_EDITOR_CONTRACT.md#L34-L62](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L34-L62) | ✅ |
| 架构 MUST NOT be bypassed for convenience | [AI_EDITOR_CONTRACT.md#L57-L61](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L57-L61) | ✅ |
| **RULE 1**：Engine MUST NOT depend on React/UI/browser globals；浏览器能力经 Host | [AI_EDITOR_CONTRACT.md#L2692-L2697](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2692-L2697)（RULE 1） + [§1](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L64-L113) + [§27](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2845-L3036) | ✅ |
| 依赖方向只能 UI → engine、platform → engine，反向禁止 | [AI_EDITOR_CONTRACT.md#L79-L113](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L79-L113) | ✅ |
| EditorHost 七组接口：TextHost / FontHost / SurfaceHost / ViewportHost / ClipboardHost / PlatformHost / StorageHost | [AI_EDITOR_CONTRACT.md#L2878-L2952](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2878-L2952)（§27.1） | ✅ |
| **RULE 2**：DocumentModel MUST NOT depend on Layout/Render/CanvasRenderingContext2D/DOM/React/UI/viewport | [AI_EDITOR_CONTRACT.md#L2699-L2702](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2699-L2702)（RULE 2） + [§2](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L115-L264) | ✅ |
| DocumentModel 拥有"语义样式"（TextStyle），演示属性归 PresentationStyleStore | [AI_EDITOR_CONTRACT.md#L202-L264](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L202-L264)（§2.2） | ✅ |
| **RULE 3**：每个可变事实一个 owner | [AI_EDITOR_CONTRACT.md#L2703-L2706](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2703-L2706)（RULE 3） + [§7.1–§7.5](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L558-L681) | ✅ |
| 状态 owner 分类：Zustand 应用态 / EditorStore 运行时 / DocumentModel 文档态 / LayoutEngine 派生态 / TemplateDefinitionStore 模板态 | [AI_EDITOR_CONTRACT.md#L558-L681](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L558-L681)（§7.1–§7.4） | ✅ |
| Duplicate State Rule：`Zustand.selection` + `EditorStore.selection` 同时存在禁止 | [AI_EDITOR_CONTRACT.md#L659-L681](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L659-L681)（§7.5） | ✅ |
| `EditorStore.document` 持有 DocumentTree 引用（reference）非副本 | [AI_EDITOR_CONTRACT.md#L599-L608](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L599-L608)（§7.2 末段） | ✅ |
| `onlineUsers` 是 awareness 不是 document content | [AI_EDITOR_CONTRACT.md#L1014-L1032](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L1014-L1032)（§9.1） | ✅ |
| **RULE 4**：ALL document mutations MUST go through the command system | [AI_EDITOR_CONTRACT.md#L2707-L2710](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2707-L2710)（RULE 4） + [§5](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L355-L418) | ✅ |
| 禁止动作：component → `document.nodes.push` / toolbar → `node.text =` / dialog → DocumentModel mutation / plugin → 直接 DocumentModel mutation | [AI_EDITOR_CONTRACT.md#L385-L418](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L385-L418) | ✅ |
| **RULE 5**：choke point 由类型系统强制，`readonly nodes = new Map(...)` 不是 choke point | [AI_EDITOR_CONTRACT.md#L2711-L2720](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2711-L2720)（RULE 5） + [§6.1](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L457-L507) | ✅ |
| NodePool 对外接口白名单：getNode / hasNode / traversePool / addNode / removeNode / updateNode / insertChild / removeChild / moveChild / detachChild / removeOrphanLeaf | [AI_EDITOR_CONTRACT.md#L473-L481](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L473-L481) | ✅ |
| 两个泄漏口：A — `pool.nodes.set/delete`；B — `row.children.push/splice` | [AI_EDITOR_CONTRACT.md#L483-L499](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L483-L499) | ✅ |
| §6.2 入口（gate = Command）≠ 执行（enforcement = NodePool/DocumentModel 受控 API） | [AI_EDITOR_CONTRACT.md#L509-L548](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L509-L548) | ✅ |
| **RULE 6**：Engine MUST NOT access browser globals directly，平台访问只能经 Host | [AI_EDITOR_CONTRACT.md#L2722-L2726](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2722-L2726)（RULE 6） | ✅ |
| **RULE 7**：Engine modules must be safe to import in non-DOM runtimes；import 不触发浏览器副作用 | [AI_EDITOR_CONTRACT.md#L2728-L2731](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2728-L2731)（RULE 7） + [§29](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L3081-L3100+) | ✅ |
| §28 浏览器全局白名单：document / window / navigator / localStorage / ResizeObserver / IntersectionObserver / requestAnimationFrame 等禁止；`CanvasRenderingContext2D` 仅以注入类型出现 | [AI_EDITOR_CONTRACT.md#L3038-L3079](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L3038-L3079) | ✅ |
| `new Editor(host, doc)` 构造注入；禁止 setEditorHost / getEditorHost / hasEditorHost 全局可变槽 | [AI_EDITOR_CONTRACT.md#L2984-L2997](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2984-L2997)（§27.3） | ✅ |
| Module-level 单例白名单：scriptResolver / particleRegistry / documentLoaderRegistry / modelUpgrader / locale | [AI_EDITOR_CONTRACT.md#L3004-L3011](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L3004-L3011) | ✅ |
| 反例：`export const textMeasurer = new TextMeasurer()` 在 import 时触发副作用禁止 | [AI_EDITOR_CONTRACT.md#L3096-L3100](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L3096-L3100) | ✅ |
| **RULE 8**：undo/redo 是文档变更，必须同样发 `document:changed` + `autoSave.markDirty()` + `notifyListeners('contentChange')` | [AI_EDITOR_CONTRACT.md#L2733-L2744](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2733-L2744)（RULE 8） + [§8.2](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L923-L947) | ✅ |
| **RULE 9**：撤销栈单一 owner = `CommandUndoRedoStack`；`HistoryState` 是纯投影，不许存命令 | [AI_EDITOR_CONTRACT.md#L2746-L2750](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2746-L2750)（RULE 9） + [§8.1](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L903-L921) | ✅ |
| **RULE 10**：context snapshot 是只读、editor/document fact only；不许含 menu / UI components / React state / UI-specific commands | [AI_EDITOR_CONTRACT.md#L2752-L2762](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2752-L2762)（RULE 10） | ✅ |
| **RULE 11**：原子复合操作 = 一次用户操作折叠成一次 undo（`MacroCommand` / `beginMacro` / `endMacro`） | [AI_EDITOR_CONTRACT.md#L2764-L2775](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2764-L2775)（RULE 11） | ✅ |
| §11.2 三个 named drift 已抽出到 SelectionCollector / FormatPainter / TableOps | [AI_EDITOR_CONTRACT.md#L1165-L1198](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L1165-L1198) + [frontend/src/engine/document/selection/SelectionCollector.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/document/selection/SelectionCollector.ts) + [frontend/src/engine/format/FormatPainter.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/format/FormatPainter.ts) + [frontend/src/engine/document/table/TableOps.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/document/table/TableOps.ts) | ✅ |
| §15 EventBus 已合并到 `engine/interaction/EventBus.ts` 一个 canonical bus；`engine/EventBus.ts` 死代码标记待删 | [AI_EDITOR_CONTRACT.md#L2356-L2443](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L2356-L2443) | ✅ |
| §12.1 / §12.2 模板/演示按 nodeId 拆成 TemplateDefinitionStore / PresentationStyleStore（per-Editor 实例） | [AI_EDITOR_CONTRACT.md#L1248-L1435](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L1248-L1435) + [frontend/src/engine/template/TemplateDefinition.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/template/TemplateDefinition.ts) + [frontend/src/engine/render/presentation/PresentationStyle.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/presentation/PresentationStyle.ts) | ✅ |
| 缺口 ①：`computeEffectiveColumnWidths` 仍是简单拷贝 | [MergeMatrix.ts#L146-L153](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/document/table/MergeMatrix.ts#L146-L153) | ✅ 诚实披露 |
| 缺口 ②：`Editor.setDictionaries` 注入接缝的 `?? null` trap 已被反向（按 §12.6.4），但全量回归未跑 | [AI_EDITOR_CONTRACT.md#L1943-L1960](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L1943-L1960) | ✅ 诚实披露 |
| 缺口 ③：shared style-reference 字典（`style: {id}` + 模板 `styles` / `globalStyles`）标 TARGET，未做 | [AI_EDITOR_CONTRACT.md#L213-L218](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L213-L218) + [#L240-L244](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md#L240-L244) | ✅ 诚实披露 |
| 契约文件总行数 ~3,200、25 条 RULE（核对时取实际行数） | [AI_EDITOR_CONTRACT.md](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) | ✅ 文件实际存在；总行数与 RULE 数引用前以当次 `wc -l` 为准 |
| 引擎目录结构含 command/commands/、document/{control,core,factory,io,selection,table,version}、layout/{control,core,footnote,incremental,line,page,table,text,viewport}、render/{particles,presentation}、state、host、interaction、qc、template、loaders、evaluation、format、plugins、security 等 | [frontend/src/engine/](file:///d:/czw/EMRDocumentEngine/frontend/src/engine) | ✅ |

**禁用清单自检（契约 §1.5）**：

- [x] 未声称已支持 PDF / Word 导出
- [x] 未声称已支持多人实时协同
- [x] 未声称生产环境落地 / 已有 N 家医院使用
- [x] 未贬损任何商业产品或同行方案
- [x] 未使用"国内首个 / 唯一 / 最强"等绝对化表述
- [x] 未编造无据社会认同
- [x] 未使用"关注才能看""集赞领取"等诱导关注话术
- [x] 标题含主关键词（架构契约 / AI 写代码 / 架构不变量），无标题党反差
- [x] 未声称"shared style-reference 字典已实现"（如实标 TARGET）
- [x] 未声称"`computeEffectiveColumnWidths` 已实现"（如实标缺口）
- [x] 未声称"全量回归已跑完"（如实标"全量回归未跑"）

## 附件 B · 配图清单（按契约 §5.4 占位，发布前补齐）

| 编号 | 位置 | 类型 | 素材 | 占位内容 | 状态 |
|---|---|---|---|---|---|
| ① | 文首 | 示意装饰 | 公众号封面图 | **可文生图**：`clean flat illustration of a magnifying glass examining a layered software architecture diagram with a hard red boundary line around the engine layer, soft red and white palette, minimal modern tech style, no text, landscape_16_9` | 🟡 提示词已就位，待出图 |
| ② | 第一节"问题的形状"后 | 架构图 | 三类 AI 拆墙示意图 | **建议自绘**：三张并排小图 —— ①"引擎 import React"红色禁止符号 ②"工具栏直接 push 节点"绕过 choke point 警告 ③"selection 在两处各存一份"双 owner 漂移示意 | 🟡 建议自绘，待产出 |
| ③ | 第二节"解法"后 | 架构图 | 契约的四态对照 | **建议自绘**：四列对照表 —— MUST NOT / MUST / SHOULD / TARGET，每列一个色块代表"AI 在该状态下的行为"；右侧标注"未做区分前，AI 默认走阻力最小路径" | 🟡 建议自绘，待产出 |
| ④ | 第三节"边界 1"后 | 架构图 | Engine / UI / Platform 三层依赖方向 | **建议自绘**：三层矩形（platform/dom 顶 → EditorHost 边界 → engine 底），向上箭头标注 UI → engine、向下标注"反向禁止"+ 红色禁止符号 | 🟡 建议自绘，待产出 |
| ⑤ | 第三节"边界 3"后 | 架构图 | 五类 state owner 总图 | **建议自绘**：五列矩形（Zustand / EditorStore / DocumentModel / LayoutEngine / TemplateDefinitionStore），每列下挂该 owner 负责的字段；用 §7.5 Duplicate State Rule 在中央画一个红色禁止符号 | 🟡 建议自绘，待产出 |
| ⑥ | 第三节"边界 4"后 | 示意装饰 | 红色"必走 Command"路标 | **可文生图**：`a single red wooden signpost at a forked road, one path marked UI directly, the other marked via Command, with a red prohibition sign over the direct path, soft red and white palette, minimal modern tech style, no text, square_hd` | 🟡 提示词已就位，待出图 |
| ⑦ | 第三节"边界 5"后 | 架构图 | NodePool 两个泄漏口 | **建议自绘**：左侧矩形 = "PROBLEM A: pool.nodes.set/delete"（标注 Map 私有化能堵），右侧矩形 = "PROBLEM B: row.children.push"（标注私有化堵不住，需受控 API 白名单） | 🟡 建议自绘，待产出 |

> **红线**（契约 §5.4 / 附录 A.3）：AI 生成图**只能用于示意 / 装饰**，不得冒充产品真实界面；本篇无实况配图需求。

## 附件 C · 发布清单

| 项 | 内容 |
|---|---|
| 发布渠道 | 微信公众号（账号：旺de碎碎念） |
| 计划发布时间 | **12:00 前后（窗口 11:30–12:30）**——契约 §5.2.1 硬性固定时段，不得漂移 |
| 发布后动作 | 2 小时内守留言；发布后核对引导模块渲染 |
| UTM | `utm_source=wechat&utm_medium=article&utm_campaign=W08-architecture-contract` |
| 主关键词 | 架构契约；长尾：AI 写代码架构不变量 / 引擎零 React 依赖 / NodePool 变更入口 / 单一状态 owner / 浏览器全局禁止 |
| 建议摘要（≤120 字） | AI 写代码很快，但容易"为了让它跑起来"绕开架构。这一篇聊怎么用一份 3,200 行 MANDATORY 契约 + 25 条 RULE，把"引擎零 React 依赖、变更必经 Command、单一状态 owner、浏览器能力经 Host"这些不变量钉死在仓库里——附六条最常被拆的边界与对应代码事实。 |
| 关键词落位 | 主关键词→标题、首段、第二/三节小标题；长尾→首段、每个边界小节首句、摘要 |
| 二次分发（契约 §7.4） | **本版仅公众号单一渠道**，不做跨平台改写；本篇归入 P4 开发实录系列 |
| 数据回收节点 | 24h / 72h / 7d 记入指标看板（契约 §8.1） |
| 选题归档 | 支柱 P4 · 开发实录（契约 §7.2 D13）；承接《表格跨页与合并矩阵算法》文末预告 |
| 系列位置 | 公众号系列第 8 篇（承接上一篇文末预告） |
| 文末必挂组件 | 附录 B.2「往期精选 + 关注引导」模块（R3）——**已挂** |
| 下一篇预告 | 《病历编辑器选型地图：商业套件 / 开源内核 / 自研，各适合谁》（契约 §7.2 D1 方向） |

## 附件 D · 待甲方确认

1. **契约总行数 / RULE 总条数引用**（稿件第四节"契约不是文档"段、附件 A 表底注）：本篇称"3,200 多行、25 条 RULE"——核验时建议甲方在 [AI_EDITOR_CONTRACT.md](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) 上跑一次 `wc -l` 与 `grep -c '^RULE' AI_EDITOR_CONTRACT.md`，以**当次结果**替换文中的"3,200 多行 / 25 条 RULE"（同 [README 测试数 1170+ 口径](file:///d:/czw/EMRDocumentEngine/README.md) 的处理方式，契约 §1.4 已规定"需精确值时以当次代码统计结果为准"）；
2. **配图 ②③④⑤⑦ 需甲方或设计协作**（契约 §4.4 第 6 项素材授权）：本篇 7 张配图里 5 张是自绘架构图，建议由熟悉代码架构的甲方/设计师出图，避免 AI 兜底生图误导读者对真实依赖方向的认知；如授权乙方 AI 出图，将以"风格底图 + 关键节点标注"形式呈现，**不会冒充真实模块图**；
3. **"§15 EventBus 已合并到 interaction/EventBus.ts，`engine/EventBus.ts` 死代码已标记待删除"**（第六节"坦诚地说，现状"段）：本篇按契约 §15 现状描述为"已合并 / 已标记待删除"，但删除动作本身**未提交**（避免破坏 import 链）。请甲方确认是否在本文发布前完成 `engine/EventBus.ts` 的删除 PR，或保持"标记待删除"状态；
4. **诚实披露段对 `computeEffectiveColumnWidths` / shared style-reference 字典 / `setDictionaries` 全量回归**的描述（第六节"仍未完全落地的部分"）：保留"如实披露三个缺口"的写法，请确认是否同意延续"主动设限"风格；
5. **文末已按契约 §7.2 选题落位预告下一篇**——《病历编辑器选型地图：商业套件 / 开源内核 / 自研，各适合谁》（支柱 P2，契约 §7.2 D1，即表格中从上到下第一个尚未发布的坑位）；原"D14 的 M1 阶段复盘"挂钩位已撤回（该选题已从契约 §7.2 D14 移除）。请甲方确认该预告口径，如需改为其他坑位，请提前指明支柱（P1–P5）与具体话题。
