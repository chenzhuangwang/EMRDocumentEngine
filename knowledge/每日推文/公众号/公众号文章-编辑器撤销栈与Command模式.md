# 撤销栈与 Command 模式：编辑器的"后悔药"为什么不能靠快照

> 电子病历里最不能出错的，是"改动"本身。一次 Ctrl+Z 如果只回退了文字、却没回退它的格式、控件配置和文档结构，文档就会卡在"一半新、一半旧"的中间态——**这比不撤销更危险**。

写电子病历的人，做得最多的一件事其实是"改"。而"改"最难的地方，不是你改得对不对，而是**改错了能不能干净地退回去**。

这篇文章聊编辑器内核里的**撤销栈**：一个手写的电子病历编辑器，怎么让每一步改动都能被安全、完整地撤回。它牵着三件事——Command 模式、撤销栈本身，以及把"一串操作"收成"一次撤销"的事务机制。

## 一、一个几乎每个编辑器都遇到过的坑

先看两个真实场景。

医生把整段字体从宋体刷成仿宋，刷完发现刷多了，想撤回——结果只回退了光标位置，字体没变回去。

又或者，选中两段做了一次跨段剪切，发现剪错地方了。撤销一次只让其中一段复原，另一段还停在错误的位置上——文档进入了**"半新半旧"的中间态**。

用户的信任是一次性的：**只要有一次撤销没撤干净，他就不敢再用了**。所以撤销看着是小功能，实际是编辑器的信任底线。要做好它，绕不开两个问题：**每一步"改动"用什么表示？一连串改动怎么被原子地收回去？**

## 二、最直觉的两种做法，为什么都不行

**做法一：每次编辑前存一份完整快照。** 改之前先 copy 一份整棵树，撤销就换回去。问题是电子病历动辄几十页、十几个表格、上百个控件，**每次敲字都复制一份全量文档，内存和延迟都受不了**；而且快照只能回答"回到某一时刻"，回答不了"撤销刚刚这一步"——用户心里的撤销粒度，恰恰由他的操作决定。

**做法二：记录文档的 diff / patch。** 在纯文本里很成立，一旦碰到结构操作就崩了：**"把第 3 段第 5~9 个字符删掉，同时把相邻的两个文本节点合并回去、再让段落重排"**——通用 diff 表达不了，更难保证反向应用后结构完全一致。

结论很清楚：**撤销的单位不该是"文档的某一版"，而是"一次改动"**。

## 三、Command 模式：把"改动"变成一等公民

这套引擎的答案是：**任何一处改动，都必须走 Command**。

```ts
export interface ICommand {
  readonly type: string
  readonly id: string
  readonly timestamp: number
  readonly author: string
  forward(ctx: CommandContext): StatePatch | null   // 正向执行
  invert?(ctx: CommandContext): ICommand | null      // 构造逆操作
  serialize(): SerializedCommand                     // 序列化传输
}
```

三件事对应三种能力：`forward` 正向执行并返回 `StatePatch`（失效范围 + 光标）；`invert` 从"执行之后的快照"构造逆操作；`serialize` 序列化用于跨端传输。

这不是纸面约定——项目里有一份《AI 编辑契约》在硬性约束架构不变量：**引擎零 React 依赖、变更必经 Command、单一状态 owner**。只要改动了文档，就必须落成一个命令，没有旁路。

于是"撤销"就从"把文档倒回去"，变成了一个干净的循环：**执行正向命令 → 需要撤销时执行它的逆命令**。

## 四、撤销栈：两根栈，一条铁律

承载这个循环的，是 `CommandUndoRedoStack`。结构很朴素：一根 undo 栈，一根 redo 栈。

```ts
execute(command: ICommand, ctx: CommandContext): StatePatch | null {
  const patch = command.forward(ctx)
  if (!patch) return null          // ① 先执行成功，才谈入栈
  // ……合并判定 / 入栈
  this.redoStack = []              // ② 新执行清空 redo
  return patch
}
```

两条规则值得单独说。

**先执行成功、再入栈。** 注意 `forward` 之后的 `if (!patch) return null`：**命令若执行抛错、或根本没产生变更，就不该在撤销栈里留下一个"空的撤销点"**。否则用户按 Ctrl+Z，会看到"什么都没发生"的一次撤销——比 bug 更让人困惑。

**任何一次新执行都清空 redo 栈。** 一旦你在撤销后又做了新改动，"未来"那条支线就作废了。

撤销和重做的动作同样直白：撤销 = 弹出栈顶 → 生成逆命令 → 执行逆命令 → 原命令压进重做栈；重做则相反。栈还有上限 `maxDepth`（默认 100），**超出后按 FIFO 丢掉最旧的一条**——它是内存的兜底，也符合直觉：很久以前的编辑，本来就不指望还撤得回去。

## 五、500ms 合并窗口：让"一段连续操作"只占一个节点

如果每一次微操作都占一个栈项，用户得按住 Ctrl+Z 按十几次。所以撤销栈内置了一个合并窗口：

```ts
private readonly MERGE_WINDOW_MS = 500

private canMerge(last: ICommand, next: ICommand): boolean {
  if (last.type !== next.type) return false                    // 同类型
  if (last.author !== next.author) return false                // 同作者
  if (next.timestamp - last.timestamp > this.MERGE_WINDOW_MS) return false // 窗口内
  if (!('canMergeWith' in last)) return false                  // 栈顶声明可合并
  return (last as MergeableCommand).canMergeWith(next)
}
```

四个条件挡住四类"不该合并"的情况：**类型不同**（插入和删除不该混成一步）、**作者不同**（协同场景不能把别人的操作并进来）、**超过 500ms**（停顿半秒以上，用户就是换了一件事做）、以及**栈顶命令没声明可合并**。

合并的动作不是"再入一次栈"，而是**用合并结果替换栈顶**——**栈深不变**，于是"一段连续操作"最终只占一个撤销单元，一次 Ctrl+Z 整段退回。

至于哪些命令允许合并，由命令自己声明。引擎定义了 `MergeableCommand`：

```ts
export interface MergeableCommand extends ICommand {
  canMergeWith(other: ICommand): boolean
  /** 返回新命令（不可变），不修改 this */
  mergeWith(other: ICommand): ICommand
}
```

注意 `mergeWith` 的约定是**返回新命令、不修改原对象**——合并只生成新对象，不污染已进过栈的历史命令。**栈负责窗口和判据，命令负责回答"我和上一步能不能并"**，职责切得很干净。

## 六、一次撤销，回退一整件事：MacroCommand

时间窗口解决"同一类连续操作"。但还有一类操作天生是多步的，跟时间无关：应用一个结构化控件的值，要同时改值、控件定义、控件元素；"应用文档属性"要原子地改标题和元数据；跨段落剪切背后是"删这段 + 删那段 + 合并段落"。若各占一个栈项，撤销时会看到**"一半改完、一半没改"的中间态——这是最危险的状态**。

引擎用**事务**解决：

```ts
beginMacro(): void { this.macroStack.push([]) }

endMacro(): void {
  const children = this.macroStack.pop()
  if (!children || children.length === 0) return   // 空事务不产生撤销单元
  const macro = new MacroCommand(generateCommandId(), Date.now(), 'user', children)
  this.undoStack.push(macro)                        // 单单元入栈
}
```

事务期间，命令**不进撤销栈**，而是被收集；`endMacro()` 时这一批子命令被打包成一个 `MacroCommand`，作为**单个撤销单元**入栈。

`MacroCommand` 的语义是一对镜像：`forward` **顺序**应用子命令，并返回保守的 `invalidation: 'full'`（跨多节点，干脆全量失效别漏刷）；`invert` **逆序**反转每个子命令再打包。逆序是正确性关键：正向是 A→B→C，逆向就必须 C⁻¹→B⁻¹→A⁻¹，否则回退到中间态时上下文已被破坏，逆操作会落空。

事务在生产里实际用在三处：**应用控件值（值+定义+元素）**、**原子应用文档属性**、**跨段落选区删除**。测试里最有说服力的一条断言是：用事务包住三条命令后，`getUndoDepth()` 的值是 **1**——三条操作，只留一个撤销点。

## 七、撤销之后，界面怎么"知道"

用户看的是工具栏那个按钮灰不灰，所以栈的状态必须投影到 UI。`execute` / `undo` / `redo` 三路走完都经过同一个 `emitDocumentChange`，广播 `state:changed` 与 `document:changed`（带失效范围和脏节点），并把栈深度同步进 store：

```ts
this.store.updateRuntime({
  history: {
    canUndo: this.commandManager.canUndo(),
    canRedo: this.commandManager.canRedo(),
    undoDepth: this.commandManager.undoStack.getUndoDepth(),
    redoDepth: this.commandManager.undoStack.getRedoDepth(),
  },
})
```

工具栏按钮的禁用态就读这个 `runtime.history`；快捷键是 `Ctrl/Cmd + Z` 撤销、`Ctrl/Cmd + Y` 重做。值得一提的是，**编辑器内核零 React 依赖**，它只把状态投进 store、界面自己订阅——同一套撤销逻辑，换别的 UI 层也能用。

## 八、坦诚地说，现状

按惯例，把现状说清楚：

**PDF / Word 导出与多人实时协同仍在推进中，当前可用的导出格式为 JSON / TXT / HTML；导入侧支持 JSON / HTML / Markdown / XML。**

撤销这块也要如实讲两点：

- 撤销栈与 500ms 合并窗口的判据，目前**有代码、缺直接单元测试**（事务原子性与编辑器层的撤销/重做有测试覆盖，栈本身和合并逻辑还没有对应用例）；
- 重做快捷键目前只覆盖 `Ctrl/Cmd + Y`，还没处理 `Ctrl + Shift + Z` 这种更通用的习惯。

这不是"差不多就行"的领域，而是"少一条测试、多一个中间态"的领域。把缺口摆出来，比装作没有更靠谱。

## 写在最后

回到开头那句话：电子病历里最不能出错的，是"改动"本身。

撤销看起来只是"把文档倒回去"，真正的功夫却在前面——**把每一步改动变成可逆的一等公民**：用 Command 保证每一步都可表达、可逆；用双栈保证历史与未来清清楚楚；用事务保证"多步操作"是原子单元；再用一个 500ms 窗口，把"一段连续操作"收成一个撤销点。

四件事合起来，才是一个"按错了也敢按 Ctrl+Z"的编辑器。

这也是「EMR 文档编辑器」这套引擎在做的事：从零手写、不依赖任何第三方富文本框架，把内核一块一块做扎实。如果你也在做编辑器、做医疗信息化，欢迎了解这个正在成长的开源项目，也欢迎直接在线体验：

- **在线体验**：<http://139.196.151.15/?utm_source=wechat&utm_medium=article&utm_campaign=W06-undo-stack>
- **开源仓库**：<https://gitee.com/wangwang_1_1665527118/emrdocument-engine?utm_source=wechat&utm_medium=article&utm_campaign=W06-undo-stack>

---

这是「EMR 文档编辑器」系列的第 6 篇。前五篇分别聊了：病历编辑器为什么值得单独做、质量该在哪一步管住、病历数据的"活"与"死"、信息科的时间去哪了，以及科室经验怎么变成配置。这一篇钻进内核，聊撤销栈与 Command 模式。

下一篇把镜头对准表格——《表格跨页与合并矩阵算法》，聊聊分页时怎么处理表头重复、整行拆分与合并单元格的矩阵映射。

──────────────
📌 往期精选
· 病历编辑器，为什么成了 HIS 的"咽喉"
· 病历数据的"活"与"死"
· 病历模板化书写：科室经验怎么沉淀

如果这篇对你有用，欢迎关注「旺de碎碎念」
这里持续记录电子病历、医疗信息化与开源工程化的真实实践。
点个「在看」，让更多同行看到 ↓
──────────────

> 一份病历不该是医生的负担。让好的工具，成就更好的医疗。

---
---

# 以下为发布附件（不随稿件发布到平台）

## 附件 A · 事实自检表（契约 D1）

> 口径基线：AI 推广契约 §1.1–1.5（项目资产）与 §1.6（账号数据）。本篇所有代码事实均以仓库实测为准。

| 稿件中的表述 | 事实出处 | 核验结果 |
|---|---|---|
| 引擎"不依赖任何第三方富文本框架" | [package.json](file:///d:/czw/EMRDocumentEngine/frontend/package.json) 依赖中无 prosemirror / slate / tiptap / quill / lexical | ✅ 沿用前作口径 |
| `ICommand` 三件事：`forward` / `invert?` / `serialize` | [ICommand.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/ICommand.ts#L70-L95) | ✅ 逐字段核对 |
| `StatePatch` 含失效范围与光标 | [ICommand.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/ICommand.ts)（`StatePatch` 定义） | ✅ 文中表述为"失效范围 + 光标" |
| 引擎架构不变量：零 React 依赖 / 变更必经 Command / 单一状态 owner | [AI_EDITOR_CONTRACT.md](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) | ✅ 沿用前作口径 |
| 撤销栈 `CommandUndoRedoStack`：undo / redo 双栈 | [CommandUndoRedoStack.ts#L17-L25](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandUndoRedoStack.ts#L17-L25) | ✅ |
| "先 forward 成功后入栈" | [CommandUndoRedoStack.ts#L27-L42](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandUndoRedoStack.ts#L27-L42)（`if (!patch) return null`） | ✅ |
| 任何一次新执行清空 redo 栈 | [CommandUndoRedoStack.ts#L40](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandUndoRedoStack.ts#L40) | ✅ |
| `maxDepth` 默认 100，超出 FIFO 丢弃最旧 | [CommandUndoRedoStack.ts#L23-L24](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandUndoRedoStack.ts#L23-L24)、[#L39](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandUndoRedoStack.ts#L39)；CommandManager 显式传 100 [CommandManager.ts#L65](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandManager.ts#L65) | ✅ |
| `undo` = pop → invert → 执行逆命令 → 压 redo | [CommandUndoRedoStack.ts#L44-L54](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandUndoRedoStack.ts#L44-L54) | ✅ |
| 合并窗口常量 `MERGE_WINDOW_MS = 500` | [CommandUndoRedoStack.ts#L21](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandUndoRedoStack.ts#L21) | ✅ |
| 合并判据四条件（同 type / 同 author / ≤500ms / 栈顶实现 `canMergeWith`） | [CommandUndoRedoStack.ts#L81-L87](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandUndoRedoStack.ts#L81-L87) | ✅ 逐条核对 |
| 合并以"替换栈顶"实现，栈深不增 | [CommandUndoRedoStack.ts#L32-L38](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandUndoRedoStack.ts#L32-L38) | ✅ |
| `MergeableCommand` 接口：`canMergeWith` + `mergeWith`（返回新命令、不改 this） | [ICommand.ts#L97-L103](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/ICommand.ts#L97-L103) | ✅ |
| 事务 `beginMacro` / `endMacro`，空事务不产生撤销单元 | [CommandManager.ts#L112-L127](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandManager.ts#L112-L127) | ✅ |
| 事务内子命令不进栈，`endMacro` 打包为 `MacroCommand` 单单元入栈 | [CommandManager.ts#L95-L110](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandManager.ts#L95-L110)、[#L118-L125](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandManager.ts#L118-L125) | ✅ |
| `MacroCommand`：forward 顺序 + `invalidation:'full'`；invert **逆序** | [MacroCommand.ts#L37-L52](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/commands/MacroCommand.ts#L37-L52)、[#L54-L63](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/commands/MacroCommand.ts#L54-L63) | ✅ |
| 事务三处生产用例：控件值 / 文档属性 / 跨段选区删除 | [Editor.ts#L1097-L1113](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/Editor.ts#L1097-L1113)、[#L1272-L1280](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/Editor.ts#L1272-L1280)、[#L2032-L2037](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/Editor.ts#L2032-L2037) | ✅ |
| 测试断言：三条命令经事务后 `getUndoDepth() === 1` | [MacroCommand.test.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/__tests__/MacroCommand.test.ts)（`beginMacro/endMacro` 用例） | ✅ |
| execute/undo/redo 三路共用 `emitDocumentChange`（`state:changed`/`document:changed`/`cursor:moved`） | [CommandManager.ts#L144-L165](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandManager.ts#L144-L165) | ✅ |
| 栈深度投影进 store（`runtime.history`），驱动按钮禁用态 | [Editor.ts#L436-L449](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/Editor.ts#L436-L449)、[Toolbar.tsx#L80-L101](file:///d:/czw/EMRDocumentEngine/frontend/src/components/layout/Toolbar.tsx#L80-L101) | ✅ |
| 快捷键 Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Y 重做 | [KeyboardHandler.ts#L62-L64](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/interaction/KeyboardHandler.ts#L62-L64) | ✅ |
| 缺口①：撤销栈与 500ms 合并判据缺直接单测 | 测试目录 grep `CommandUndoRedoStack` 无命中；grep `canMergeWith|mergeWith` 于 `__tests__` 无命中 | ✅ 诚实披露 |
| 缺口②：未处理 Ctrl+Shift+Z 重做 | [KeyboardHandler.ts#L62-L64](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/interaction/KeyboardHandler.ts#L62-L64) 仅匹配 `z`/`y` | ✅ 诚实披露 |
| 30+ 种可撤销命令 | 契约 §1.4 统一口径；当次实测 `export class *Command` 共 **37** 个（22 个文件） | ✅ 按契约统一为"30+ 种"，不沿用旧数字 |
| 8 类控件 / 6 条质控 / 25 条缩写 等 | 契约 §1.2 | ✅ 本篇未新引，沿用基线 |
| 第 6 篇 / 下一篇《表格跨页与合并矩阵算法》 | 系列承接；表格跨页能力见 [README.md#L44](file:///d:/czw/EMRDocumentEngine/README.md#L44) | ✅ 仅作预告，未展开 |

**禁用清单自检（契约 §1.5）**：

- [x] 未声称已支持 PDF / Word 导出（明确写为"仍在推进中"）
- [x] 未声称已支持多人实时协同
- [x] 未声称生产环境落地 / 已有 N 家医院使用
- [x] 未贬损任何商业产品或同行方案
- [x] 未使用"国内首个 / 唯一 / 最强"等绝对化表述
- [x] 未编造无据社会认同
- [x] 未使用"关注才能看""集赞领取"等诱导关注话术
- [x] 标题含主关键词（撤销栈），无标题党反差
- [x] **未声称"连续输入/连续删除已合并为一步"**（本篇按甲方选择只描述合并机制与事务，不对具体命令是否接入合并做宣称）
- [x] 未声称"Ctrl+Shift+Z 可重做"（如实写为未处理）

## 附件 B · 配图清单（按契约 §5.4 占位，发布前补齐）

| 编号 | 位置 | 类型 | 素材 | 占位内容 | 状态 |
|---|---|---|---|---|---|
| ① | 文首 | 示意装饰 | 公众号封面图 | **可文生图**：`clean flat illustration of an editor undo/redo concept, a stack of layered document cards with a curved back-arrow looping back one step, graphite gray and soft white palette, minimal modern tech style, no text, landscape_16_9` | 🟡 提示词已就位，待出图 |
| ② | 第四节"撤销栈"后 | 架构图 | undo/redo 双栈结构示意 | **建议自绘**：左"undo 栈（历史）"，右"redo 栈（未来）"，箭头标注 pop→invert→forward→push 的四步循环；底部一句"新执行 → 清空 redo"。AI 兜底提示词：`clean flat diagram of two parallel stacks labeled undo and redo with a circular arrow between them, minimal gray palette, thin lines, no text, landscape_4_3` | 🟡 建议自绘，待产出 |
| ③ | 第六节"MacroCommand"后 | 架构图 | 事务折叠示意 | **建议自绘**：左侧三个子命令（A→B→C）经 `beginMacro/endMacro` 折叠为右侧单个 MacroCommand 栈项；标注 forward 顺序、invert 逆序 | 🟡 建议自绘，待产出 |
| ④ | 第七节"界面怎么知道"后 | 实况 | 工具栏撤销/重做按钮状态截图 | **截图需求**：编辑态下工具栏"撤销/重做"按钮高亮可点；撤销到底（或新建文档）后按钮变灰。需体现按钮禁用态由 `runtime.history` 驱动 | 🟡 需求已就位，待真实截图 |

> **红线**（契约 §5.4 / 附录 A.3）：AI 生成图**只能用于示意 / 装饰**，不得冒充产品真实界面；④ 若采用，必须为真实截图。

## 附件 C · 发布清单

| 项 | 内容 |
|---|---|
| 发布渠道 | 微信公众号（账号：旺de碎碎念） |
| 计划发布时间 | **12:00 前后（窗口 11:30–12:30）**——契约 §5.2.1 硬性固定时段，不得漂移 |
| 发布后动作 | 2 小时内守留言；发布后核对引导模块渲染 |
| UTM | `utm_source=wechat&utm_medium=article&utm_campaign=W06-undo-stack` |
| 主关键词 | 撤销栈；长尾：Command 模式撤销重做 / 编辑器撤销与重做实现 / 撤销 事务原子性 |
| 建议摘要（≤120 字） | 一次 Ctrl+Z 背后，编辑器做了什么？这篇拆解手写内核的撤销栈：Command 模式怎么让每一步改动可逆、undo/redo 双栈怎么配合、事务怎么把多步操作收成一个撤销单元，以及 500ms 合并窗口的判据。 |
| 关键词落位 | 主关键词→标题、首段、第四/五节小标题；长尾→首段、正文段落、摘要 |
| 二次分发（契约 §7.4） | **本版仅公众号单一渠道**，不做跨平台改写；本篇归入 P1 内核深潜系列 |
| 数据回收节点 | 24h / 72h / 7d 记入指标看板（契约 §8.1） |
| 选题归档 | 支柱 P1 · 内核深潜（契约 §7.2 D9）；承接《模板化书写》文末预告 |
| 系列位置 | 公众号系列第 6 篇（承接上一篇文末预告） |
| 文末必挂组件 | 附录 B.2「往期精选 + 关注引导」模块（R3）——**已挂** |
| 下一篇预告 | 《表格跨页与合并矩阵算法》（契约 §7.2 D11 方向） |

## 附件 D · 待甲方确认

1. 配图 ④ 需由甲方补拍真实截图（编辑态工具栏撤销/重做按钮的可用/禁用两态），或授权乙方基于现有素材截图（契约 §4.4 第 6 项素材授权）；
2. 第八节"坦诚地说，现状"延续"主动设限"写法（如实披露测试缺口与快捷键缺口），请确认是否保留；
3. **口径提示（内部）**：本次代码调研发现——[编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L183) 第 81 行与 [README.md](file:///d:/czw/EMRDocumentEngine/README.md#L63) 关于"insertText 连续输入 / deleteRange 连续删除自动合并"的表述，与代码实现存在落差：全仓仅 `ParagraphStyleCommand` 实现 `MergeableCommand`，`InsertTextCommand` / `DeleteRangeCommand` 未实现，故该合并当前**不会**发生在文本输入/删除上。按甲方本次选择，本篇**未宣称、也未纠正**该口径；如需统一口径，请确认后我再更新功能清单/README 与契约 §1.2「未完成能力」表。
