# 为什么不用 ProseMirror：自研 Canvas 内核的取舍

> ProseMirror、Slate、Tiptap 我都试过。最后决定自己写——不是技术洁癖，是三个约束逼出来的。

选型时，ProseMirror 几乎是很多人的默认答案：文档模型清晰、插件生态庞大、协同方案成熟。我最初也是这么想的——直到把它塞进病历场景，接连撞上三堵墙。

先把话说在前面：**ProseMirror / Slate / Tiptap 都是优秀的通用富文本方案**。如果你做的是博客、笔记、IM、评论，直接上它们，别自己写。我要做的不是"富文本"，是**纸张级、可打印、结构化的医疗文书**——而通用富文本框架的核心假设（文档是流式的、渲染交给 DOM、编辑基于 contenteditable），恰好和医疗场景正面冲突。

这篇不吹自研，只讲清楚三件事：**哪三个约束逼我放弃通用框架、自研付出了什么代价、以及什么情况下你千万别学我。**

## 一、先给结论：不是它们不好，是场景不匹配

我要满足的约束有三条：

1. **屏幕上看到的分页，必须等于打印出来的分页**——严格 A4、页边距、页眉页脚、页码、跨页表格表头重复；
2. 病历里的"体温 36.8℃""用药剂量""检验值"不是字符串，是**带元数据的结构化字段**；
3. 引擎要能被不同宿主嵌入（React / Vue / Electron / Web Worker），不能被 DOM 绑死。

前两条是**文档模型**问题，第三条是**运行时边界**问题。而通用富文本框架的假设，恰好和这三条一一冲突。下面逐条拆开讲。

## 二、约束一：纸张级分页 vs 流式文档

通用富文本内核的文档模型是"流"（continuous flow）：内容从上往下排，换行和分页交给浏览器。这没错——网页本来就该这样。但病历不是网页：

| 需求 | 流式模型下的做法 | 问题 |
|---|---|---|
| 严格 A4 分页 | 用 CSS 分页媒体 / 打印样式模拟 | 屏幕所见 ≠ 打印所得，页边界不可控 |
| 跨页表格表头重复 | 基本做不到 | 病历里的检验单表格必现 |
| 孤行寡行控制 | 依赖浏览器的 `orphans` / `widows` | 各端行为不一致，无法精确控制 |
| 页眉页脚 / 页码域 | 打印时才生成 | 编辑态不可见 |

所以我把"排版"从"渲染"里彻底拆了出来，形成一条**单向管道**：

```
DocumentModel（纯数据，排版无关）
      ↓
LayoutEngine：LineBreaker → PageBreaker → PageStartTable
      ↓
Draw / LayeredRenderer（三层 Canvas）
```

对应一条架构硬约束：**文档模型不知道分页的存在**。

> RULE 2：DocumentModel MUST NOT depend on Layout/Render.
> —— 仓库内架构契约 `.claude/AI_EDITOR_CONTRACT.md`

这条拆分的直接好处是：**分页变成纯函数**——同样的文档 + 同样的页面设置，永远得到同样的分页结果。这在医疗场景里不是性能问题，是**正确性**问题："预览的第 3 页和打印出来的第 3 页不一样"，是会出事的。

## 三、约束二：结构化字段不是"一段文本"

病历里最不起眼、也最难做对的，是这类东西：

> 体温 `[ 36.8 ]` ℃　血压 `[128]`/`[82]` mmHg　用药 `[ 阿莫西林胶囊 ▾ ]`

在通用富文本里，这只是"一段带样式的文本"。但对我们，它必须是一个**原子节点**：

- 有自己的元数据：字段名、单位、数据类型、必填性、校验规则；
- **不能被逐字拆开**——你不能把"体温"和输入框拆到两行里去；
- 要参与质控（必填字段是否为空）和数据提取（把结构化字段读出来做统计）。

于是文档模型里有了 `smarttext` 节点：带 `ElementMeta` 的结构化节点，当前支持 **8 类控件**（文本 / 多行文本 / 数字 / 下拉 / 日期 / 日期时间 / 复选框 / 单选框），并且**在行断算法里被当成不可分割的原子元素**处理。整棵文档树共 **16 类节点类型**（段落、表格、单元格、图片、书签、交叉引用、域、脚注、批注等）。

这件事反过来又逼着行断算法重写——见第六节。

## 四、约束三：引擎不能被浏览器绑死

ProseMirror / Slate 的渲染最终落在 DOM 上（Slate 甚至以 DOM 为数据源）。在浏览器里，这是最优解。但我要的引擎，宿主是可替换的：今天跑在 React 网页里，明天可能是 Electron 桌面端，甚至要在 Web Worker 里做无头排版（批量生成、服务端预览）。

所以引擎代码里**不允许出现任何浏览器全局**——没有 `window`、没有 `document`、没有 `navigator`。所有平台能力必须由宿主注入，这就是 `EditorHost` **六元组**：

```ts
// frontend/src/engine/host/EditorHost.ts
export interface EditorHost {
  text: TextHost          // 文本度量（measureText 抽象）
  font: FontHost          // 字体可用性 / 缺字降级链
  surface: SurfaceHost    // 渲染表面（Canvas 上下文）
  viewport: ViewportHost  // 视口尺寸 / 滚动位置
  input: InputHost        // 键盘 / IME / 指针事件
  platform: PlatformHost  // 剪贴板 / 定时器 / 本地存储
}
```

这条约束在架构契约里是硬规则，不是"建议"：

> RULE 1：引擎 MUST NOT 依赖 React/UI，MUST NOT 依赖浏览器全局；浏览器能力访问 MUST 经由 Host 接口。
>
> RULE 7：引擎模块 MUST 能在非 DOM 运行时被安全 import——导入不得触发任何浏览器副作用。

**"不得依赖浏览器全局"如果不能被检查，就只是一句口号。** 所以它被类型与模块可见性强制：引擎里直接引用 `window` / `document` 的代码根本过不了类型检查；单测里用 `DomEditorHost` 注入替身，引擎本身对 DOM 零感知。

## 五、自研的代价：先把丑话说在前面

必须把成本讲清楚，否则这篇就是误导：

1. **时间**：从文档模型、排版引擎、渲染管线到 React 外壳，投入以年计；
2. **边界情况**：行断、分页、光标寻址、IME、剪贴板——每一个都是无底洞。中文输入法的组合态与 Canvas 光标寻址的交互，单独就耗掉很久；
3. **生态为零**：ProseMirror 有庞大的插件生态，我们这里是 0，任何新能力都得自己写；
4. **人才**：招人时"会 ProseMirror"的简历一大把，"写过 Canvas 富文本内核"的几乎没有。

所以下面不是"自研有多爽"，而是"自研之后，我们得到了哪几个**别人给不了**的东西"。

## 六、自研换来了什么

### 6.1 排版与渲染的分离

分页可预测、可缓存、可增量——`IncrementalLayout` 用脏区追踪只重排受影响的段落，长文档编辑不必全量重排。

### 6.2 三层 Canvas + 粒子化渲染

```
static   (z = 1)  页面背景 / 阴影 / 水印
content  (z = 2)  文本 / 表格 / 图片 / 公式
interact (z = 3)  光标 / 选区 / IME 预览
```

三层各自独立重绘，配合 `rAF` 帧合并与脏区裁剪：几十页病历滚动时不会整体重绘。每种元素被抽象成一个"粒子"（`IParticle`），注册到 `ParticleRegistry`，由渲染器统一调度——要加一种新元素，实现一个 particle 注册进去，不用碰渲染主流程。

### 6.3 所有变更必须走 Command，且只有一个 owner

这条如果不做，撤销栈迟早会坏。而病历场景里"撤不回去"是致命的。架构契约对应四条硬规则：

- **RULE 4**：ALL document mutations MUST pass through the Command system；
- **RULE 5**：文档变更必须有受控的"变更咽喉"，且用**类型**强制（NodePool 受控方法），不靠约定或注释；
- **RULE 9**：撤销/重做栈只能有**一个** owner，`HistoryState` 是纯投影，不得存命令；
- **RULE 11**：一次用户级编辑若产生多步子变更（如"剪切" = 剪贴板捕获 + 区间删除），必须收敛为**单个**可撤销单元。

落地方式是把 `NodePool` 的内部 `nodes` 私有化，只暴露受控 API——外部拿不到那个 Map，就**没法绕过 Command 偷偷改文档**。约束由编译器执行，而不是靠 reviewer 的眼睛。目前引擎里有 **30+ 种可撤销命令**；连续输入 / 删除按 **500ms 窗口自动合并**成一个不可分割的操作。

### 6.4 中文行断：避头尾是刚需

自研排版里最容易被低估的一块。中英混排 + 中文标点，如果按"到宽度就断"，会断成这样：

```
……患者主诉头晕、恶心，
 呕吐 3 天。        ← 逗号跑到行首（排版错误）
```

中文排版有明确的"避头尾"（禁则）规则：某些字符不能出现在行首（`。，、；：？！）》」』】`），某些不能出现在行尾（`（《〈「『【`）。行断算法遇到禁则要向前 / 后调整 1–2 个字符。再叠加第三节的原子性约束——`smarttext`、图片、公式不能逐字拆开——行断器要同时处理**宽度、禁则、原子性**三个约束。`LineBreaker` 的换行策略参考了 UAX #14 的思路，但落地是围绕中文避头尾和原子元素自己实现的。

## 七、什么情况下你**不该**自研

把丑话说在前面，免得误导人：

- 如果你的场景是**流式内容**（博客 / 笔记 / IM / 评论）——直接用 ProseMirror / Slate / Tiptap，自己写只会死在没必要的复杂度上；
- 如果你需要**成熟的协同编辑生态**——先评估现有框架的协作方案。自研内核 + 自研协同是双重风险；
- 如果你的团队**没有长期投入的打算**——编辑器内核是需要几年打磨的东西，做一半比不做更糟；
- 如果你只是想**在 contenteditable 上贴一个工具栏**——那本来就不需要"内核"。

我们之所以该自研，只有一个理由：**"纸张级分页 + 结构化字段 + 宿主无关"这三个约束同时成立，且都无法在通用富文本模型里优雅落地。**

## 八、坦诚：还没做完的事

不想让这篇文章看起来像一份自夸清单，所以把现状列清楚：

| 能力 | 真实状态 |
|---|---|
| PDF / DOCX 导出 | **规划中**。当前可用导出格式：JSON / TXT / HTML |
| 多人实时协同 | `yjs` / `y-websocket` 依赖已就位，编辑流**尚未接入** |
| HarfBuzz 文本塑形 | 规划中，用于高精度多语言排版 |
| Playwright E2E | 规划中，目前以 Vitest 单元测试为主 |

**PDF / Word 导出与多人协同仍在推进中，当前可用导出格式为 JSON / TXT / HTML。**

## 写在最后

这套内核完整开源（**MPL-2.0**），前后端一体：前端 React 18 + TypeScript 严格模式 + 自研 Canvas 渲染，后端 Spring Boot 3.3 + Java 17，带 Docker 部署与完整设计文档。**从零手写、不依赖任何第三方富文本框架**（没有 Quill / ProseMirror / Slate / Tiptap）。

如果你也在做**排版引擎 / 富文本内核 / Canvas 渲染**，或者正在被医疗文书编辑器折磨，欢迎来看看，或者直接开 Issue 聊：

- **开源仓库**：<https://gitee.com/wangwang_1_1665527118/emrdocument-engine?utm_source=wechat&utm_medium=article&utm_campaign=W10-no-prosemirror>
- **在线体验**：<http://139.196.151.15/?utm_source=wechat&utm_medium=article&utm_campaign=W10-no-prosemirror>

---

这是「EMR 文档编辑器」系列的第 10 篇。上一篇是一张**选型决策地图**，聊了"买 / 用开源 / 自研"三条路各适合谁；这一篇往下钻了一层，回答一个更具体的问题：**既然选了自研，为什么偏偏是 Canvas，而不是站在 ProseMirror 肩上。**

下一篇，我们把镜头再推近——《三层 Canvas 渲染架构：static / content / interact》，聊聊这层"static / content / interact"的分层到底怎么切、每层各管什么、为什么这样切能让几十页病历滚动时不掉帧。

──────────────
📌 往期精选
· 病历编辑器选型地图：商业套件 / 开源内核 / 自研，各适合谁
· 架构契约：如何让 AI 不写坏你的代码
· 电子病历编辑器怎么选？按成熟度分三梯队，帮你少走弯路

如果这篇对你有用，欢迎关注「旺de碎碎念」
这里持续记录电子病历、医疗信息化与开源工程化的真实实践。
点个「在看」，让更多同行看到 ↓
──────────────

> 一份病历不该是医生的负担。让好的工具，成就更好的医疗。

---
---

# 以下为发布附件（不随稿件发布到平台）

## 附件 A · 事实自检表（契约 D3）

> 口径基线：AI 推广契约 §1.1–1.5（项目资产）与 §1.6（账号数据）。本篇所有项目事实以仓库实测为准；对 ProseMirror / Slate / Tiptap 仅作"取舍"陈述，不作能力排名或贬损。

| 稿件中的表述 | 事实出处 | 核验结果 |
|---|---|---|
| 不依赖任何第三方富文本框架（无 Quill / ProseMirror / Slate / Tiptap） | [frontend/package.json](file:///d:/czw/EMRDocumentEngine/frontend/package.json#L16-L33)（dependencies 无 prosemirror / slate / tiptap / quill / lexical）；契约 §1.1 | ✅ |
| 开源协议 **MPL-2.0** | [frontend/package.json](file:///d:/czw/EMRDocumentEngine/frontend/package.json#L5)（`"license": "MPL-2.0"`）；[README.md](file:///d:/czw/EMRDocumentEngine/README.md#L227)（`LICENSE  # MPL-2.0 许可证`） | ✅ **注意**：早期掘金稿误写为 MIT，本篇已按仓库实测更正为 MPL-2.0 |
| 前端 React 18 + TypeScript 严格模式；后端 Spring Boot 3.3 + Java 17 | [README.md](file:///d:/czw/EMRDocumentEngine/README.md#L109-L118)；契约 §1.1 | ✅ |
| 自研 HTML5 Canvas 渲染引擎 | [README.md](file:///d:/czw/EMRDocumentEngine/README.md#L114)；契约 §1.1 / §1.2 | ✅ |
| 16 类节点类型 | [DocumentModel.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/document/core/DocumentModel.ts#L74-L92)（`NodeType` 常量 16 项）；契约 §1.2 | ✅ |
| 8 类结构化控件（`smarttext` 原子节点） | [README.md](file:///d:/czw/EMRDocumentEngine/README.md#L49-L50)；契约 §1.2 | ✅ |
| EditorHost 六元组（text/font/surface/viewport/input/platform） | [EditorHost.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/host/EditorHost.ts)；[README.md](file:///d:/czw/EMRDocumentEngine/README.md#L103)；契约 §1.1 | ✅ |
| 三层 Canvas（static/content/interact）+ 粒子化渲染 | [README.md](file:///d:/czw/EMRDocumentEngine/README.md#L54-L60)（渲染 = 三层 Canvas + 粒子系统）；契约 §1.2 | ✅ |
| 30+ 种可撤销命令 | 代码 `export class *Command` 实测 **35** 个实现类；契约 §1.2 / §1.4（对外统一"30+ 种"） | ✅（口径已统一） |
| 500ms 自动合并 | [README.md](file:///d:/czw/EMRDocumentEngine/README.md#L63)；契约 §1.2 | ✅ |
| 避头尾字符表 | [LineBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/line/LineBreaker.ts)（`LINE_START_FORBIDDEN` / `LINE_END_FORBIDDEN`） | ✅ |
| UAX #14 | 表述为"参考思路"，**未称完全实现**（契约 §1.4 口径） | ✅ |
| RULE 1 / 2 / 4 / 5 / 7 / 9 / 11 | [.claude/AI_EDITOR_CONTRACT.md](file:///d:/czw/EMRDocumentEngine/.claude/AI_EDITOR_CONTRACT.md) | ✅ 引用一致 |
| NodePool 受控 API / beginMacro / endMacro | [NodePool.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/document/core/NodePool.ts)、[CommandManager.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/command/CommandManager.ts) | ✅ |
| 未完成能力：PDF/DOCX 导出、多人协同（Yjs 就位未接入）、HarfBuzz、Playwright E2E | 契约 §1.2「未完成能力」；[README.md](file:///d:/czw/EMRDocumentEngine/README.md#L276-L283) Roadmap | ✅ 诚实披露 |
| "投入以年计" | 未给精确数字（避免口径未复核）；与契约 §1.2"长期投入"表述一致 | ✅ 稳妥表述 |

**禁用清单自检（契约 §1.5）**：

- [x] 未声称已支持 PDF / Word 导出（明确"规划中，当前可用 JSON / TXT / HTML"）
- [x] 未声称已支持多人实时协同（明确"依赖已就位，编辑流尚未接入"）
- [x] 未声称生产环境落地 / 已有 N 家医院使用
- [x] 未贬损 ProseMirror / Slate / Tiptap，全文以"取舍"表述，并单列第七节建议他人**不要**自研
- [x] 未使用"国内首个 / 唯一 / 最强"等绝对化表述
- [x] 未包含任何诱导 Star / 诱导关注话术（"点在看"为常规互动，非"关注才能看"式诱导）
- [x] 未编造无据社会认同

## 附件 B · 配图清单（按契约 §5.4 占位，发布前补齐）

| 编号 | 位置 | 类型 | 素材 | 占位内容 | 状态 |
|---|---|---|---|---|---|
| ① | 文首 | 示意装饰 | 公众号封面图 | **可文生图**：`a clean flat illustration comparing a flowing web document and a paginated A4 medical document, soft red and white palette, minimal modern tech style, no text, landscape_16_9` | 🟡 提示词已就位，待出图 |
| ② | 第三节末 | 实况 | A4 入院记录编辑实况 + 8 类控件渲染 | **截图需求**：同一屏需同时出现正文段落与 ≥2 个结构化控件（如体温、血压），并含页眉 / 页码；用红框高亮控件区域。基础可基于 `frontend/public/preview.png` 重截 | 🟡 需求已就位，待真实截图 |
| ③ | 第六节 6.2 | 架构图 | 三层 Canvas + ParticleRegistry 调度关系 | **建议自绘**；风格底图可文生图：`a layered 3-tier canvas rendering architecture diagram, static / content / interact layers stacked, particle registry dispatch arrows, flat technical blueprint style, deep blue and cyan, clean, no text, 16:9` | 🟡 提示词已就位，待出图 |
| ④ | 第六节 6.4 | 示意 | 避头尾前后对比示意图 | **建议自绘**以保证字符位置准确；文生图兜底：`side-by-side comparison of Chinese line breaking, left panel wrong break with closing punctuation pushed to line start, right panel correct break, minimal flat style, light background, high contrast, 16:9` | 🟡 提示词已就位，待出图 |

> **红线**（契约 §5.4 / 附录 A.3）：AI 生成图**只能用于示意 / 装饰**，不得冒充产品真实界面；② 必须为真实截图。

## 附件 C · 发布清单

| 项 | 内容 |
|---|---|
| 发布渠道 | 微信公众号（账号：旺de碎碎念） |
| 计划发布时间 | **12:00 前后（窗口 11:30–12:30）**——契约 §5.2.1 硬性固定时段，不得漂移 |
| 发布后动作 | 2 小时内守留言；发布后核对引导模块渲染 |
| UTM | `utm_source=wechat&utm_medium=article&utm_campaign=W10-no-prosemirror` |
| 主关键词 | 为什么不用 ProseMirror；长尾：ProseMirror 替代方案 / Canvas 富文本内核 / 病历编辑器自研 |
| 建议摘要（≤120 字） | ProseMirror、Slate、Tiptap 都试过，最后决定自己写。不是技术洁癖——纸张级分页、结构化字段、宿主无关这三个约束，恰好和通用富文本框架的核心假设正面冲突。这篇讲清自研的代价，以及什么情况下你千万别学我。 |
| 关键词落位 | 主关键词→标题、首段、第一节；长尾→各约束小节首句、摘要 |
| 二次分发（契约 §7.4） | **本版仅公众号单一渠道**，不做跨平台改写；掘金已有同主题版本《不依赖 ProseMirror，我用一年手写了一个文档内核》，本篇为公众号适配版 |
| 数据回收节点 | 24h / 72h / 7d 记入指标看板（契约 §8.1） |
| 选题归档 | 支柱 P1 · 内核深潜（契约 §7.2 D3）；承接《病历编辑器选型地图》文末预告 |
| 系列位置 | 公众号系列第 10 篇（承接上一篇文末预告） |
| 文末必挂组件 | 附录 B.2「往期精选 + 关注引导」模块（R3）——**已挂** |
| 下一篇预告 | 《三层 Canvas 渲染架构：static / content / interact》（契约 §7.2 D5 方向，表格中从上到下下一个尚未发布的坑位） |

## 附件 D · 待甲方确认

1. **协议口径更正**（第八节 / 写在最后）：早期掘金稿《不依赖 ProseMirror》将开源协议写作"MIT"，但仓库实测为 **MPL-2.0**（`package.json` 与 `README` 一致）。本篇已按仓库更正。**建议同步修订掘金稿的协议表述**，避免同一项目对外口径不一；
2. **"投入以年计"表述**（第五节）：未给出精确时长（早期掘金稿写"一年"）。请甲方确认是否可公开项目实际开发周期，若可，本篇可替换为更具体表述；
3. **配图 ② 为真实截图需求**（第三节末）：需甲方提供或授权使用仓库实况截图（契约 §4.4 第 6 项）；
4. **UTM campaign 命名**（附件 C）：沿用《选型地图》的 `W09-selection-map` 风格，本篇暂定 `W10-no-prosemirror`（W10 = 系列第 10 篇）。请确认命名规则；
5. **下一篇预告坑位**（附件 C）：按契约 §7.2"前 14 天开篇选题示例"**从上到下取第一个尚未发布的坑位**，本篇（D3）之后的下一坑位为 **D5《三层 Canvas 渲染架构：static / content / interact》（P1）**——表中 D4 已于 09-16 发布。请甲方确认该预告口径。
