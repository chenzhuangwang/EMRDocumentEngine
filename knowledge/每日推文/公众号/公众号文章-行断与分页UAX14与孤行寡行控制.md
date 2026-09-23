# 行断与分页：UAX#14 + 孤行寡行控制

> 前一篇讲了三层 Canvas 怎么渲染。这一篇再往下钻一层：**在画之前，一行字到底该在哪里断、一段话该不该被拆到两页。**

上一篇文章说，排版引擎会把文档切成"页"，渲染器只负责画。但中间有一块最容易被忽略、也最容易出 bug 的地方——**断行和分页**。

先看一个真实的排版事故：

```
血常规：白细胞 12.5×10⁹/L，中性粒
细胞百分比 85%，CRP 68 mg/L。
```

问题出在第一行结尾——"中性粒细胞"被从中间劈开，"中性粒"和"细胞"分到了两行。医生的第一反应是"这编辑器排版有问题"，而这一行下面可能正好是一个关键指标。

这类问题，在网页富文本里几乎不会有人管：**内容流式排布，断在哪里交给浏览器，看起来差不多就行。** 但在病历里，"断在哪里"和"分到哪一页"是**正确性**问题——因为它决定了打印出来长什么样，而打印出来的那份，是要进病历、要签字、要归档的。

这篇就讲清楚两件事：**断行（一行之内）** 和 **分页（页与页之间）**，以及它们各自踩过的坑。

## 一、先分清：断行和分页是两件事

它们经常被混在一起说，但其实是两个独立阶段，输入输出都不同：

| 阶段 | 模块 | 输入 → 输出 | 解决什么 |
|---|---|---|---|
| 断行 | `LineBreaker` | 段落内的元素序列 → 若干行 | 一行放不下时，在哪里断开 |
| 分页 | `PageBreaker` | 全部行 → 若干页 | 一页放不下时，在哪里翻页 |

整条排版管道的顺序是固定的：

```
DocumentTree + NodePool
      ↓
LineBreaker（断行）→ PageBreaker（分页）→ PageStartTable（增量索引）
      ↓
SLIFPage[]（供渲染）
```

**先断行、再分页**，顺序不能反。因为分页要知道"每一行有多高"，而行高是断行算出来的（一行里最高的字决定这一行的高度）。

## 二、断行：宽度只是及格线

断行最基础的规则是"宽度够了就断"。但如果只做宽度，就会出现开头那种事故。

### 2.1 中文避头尾（kinsoku shori）

中文排版有一套明确的"禁则"：**有些标点不能出现在行首，有些不能出现在行尾。**

```
。，、；：？！）》」』】…     ← 不能出现在行首（后置标点）
（《〈「『【〖(             ← 不能出现在行尾（前置标点）
```

想象一下句号出现在行首——"今天天气不错\n。"——这在中文里是排版错误，任何一份正式文书都不该出现。

所以断行算法里维护了两个字符集：`LINE_START_FORBIDDEN`（行头禁止）和 `LINE_END_FORBIDDEN`（行尾禁止）。**断行点一旦落在禁则上，就向前或向后调整 1–2 个字符**：

```ts
// 行尾禁止字符 → 断行点前移（把标点带到下一行）
if (LINE_END_FORBIDDEN.has(lastChar) && splitIdx > 0) { splitIdx--; continue }
// 行头禁止字符 → 断行点后移（把标点留在本行）
if (LINE_START_FORBIDDEN.has(nextChar) && splitIdx < chars.length - 2) { splitIdx++; continue }
```

调整幅度限制在 **2 个字符**以内——不是不能调更多，而是超过 2 个字符就会出现明显的"这行很短、那行很挤"，视觉上更糟。**避头尾是在"不违规"和"不破坏行宽均匀"之间取平衡。**

### 2.2 中英混排：CJK 任意断，Latin 尽量在空格断

中文可以任意两个字之间断开，英文不行——`measure` 从中间断成 `meas` / `ure` 是错的。

所以 `splitTextElement` 的策略是：**逐字符累加宽度找到断点后，再向右扫描最近的一个空格**，如果空格就在附近（≤5 字符），就把断点挪到空格处，让英文单词完整地留在上一行。CJK 字符之间则允许直接断。

### 2.3 原子元素：不能逐字拆开

这是病历场景特有、也是通用富文本最不擅长的部分。

回想上一篇提过的 `smarttext` 结构化字段——体温 `[36.8]℃`、血压 `[128]/[82]`。这类元素**不能被逐字拆开**：你不能把"体温"和输入框拆到两行里去，那在语义上就散了。

所以断行器在遇到非文本元素（`smarttext`、图片等）时走的是**另一个分支**：不参与逐字拆分，**放不下就整块换行**。

```ts
// smarttext 是原子控件, 不参与逐字拆分 — 放不下时整块换行
if ((el.type === 'text' || el.type === 'hyperlink') && elWidth > remainingW ...) {
  // 只有纯文本/超链接才逐字拆分
}
```

### 2.4 一个很隐蔽的坑：按"整行宽度"还是"剩余宽度"

断行器曾经有个 bug：把"这个节点能不能放下"判定成"节点宽度 vs **整行宽度**"，而不是"节点宽度 vs **当前行剩余宽度**"。

后果是：当一次格式化操作把一个大文本节点拆成了好几个小节点后，中间那个节点往往"窄于整行、但宽于剩余空间"——于是它被误判为"放不下"，整段被强制下沉到下一行，排版就错位了。

修复方式是**一律按剩余宽度判定**，并且文本元素超出剩余空间时**逐字拆分填充当前行**，而不是整块下沉。这类 bug 不会崩，只会让文字"看起来怪怪的"，但恰恰最难查。

## 三、分页：孤行寡行控制

断行解决了"一行之内"，分页要解决"页与页之间"。这里的经典问题是**孤行（orphan）**和**寡行（widow）**。

- **孤行**：一个段落的**最后一行**孤零零留在上一页底部，其余部分在下一页；
- **寡行**：一个段落的**第一行**孤零零出现在下一页顶部，其余部分在上一页。

这两种情况在正式文书里都算排版缺陷。这套实现里有一条硬约束：

```ts
/** Minimum lines of a paragraph that must stay together (avoid orphans/widows). */
const MIN_PARAGRAPH_LINES = 2
```

意思是：**一个段落被拆到两页时，每一侧至少要留 2 行。** 具体怎么落地：

**遇到孤行** → 把上一页底部那 1 行"收回去"，整段一起挪到下一页；
**遇到寡行** → 从上一页再"拉"1 行过来，让新页顶部至少 2 行。

代码里的做法是：分页时先判断"当前页最后一页行是否构成孤行"，再判断"新页第一段是否构成寡行"，命中就调整页边界。判断的依据是**段落边界标记**——一行的最后一个元素如果是 `\n`，它就是段落结尾。

### 表格是块边界，不参与孤行寡行

有个容易忽略的例外：**表格行不参与孤行寡行控制。**

表格是"块"级结构，它的跨页逻辑是另一套（见下一节）。所以代码里把 `pageable` / `tableFragment` 的行直接**视为段落边界**，避免出现"从上一页的表格里拉一行文本过来"这种荒谬结果。

## 四、表格跨页：表头要重复

病历里的检验单、用药单几乎都是长表格，跨页是常态。这里有两个必须做对的事：

1. **表体可以跨页**——一页放不下时，表格被切成多个 fragment，分到不同页；
2. **表头必须重复**——第二页的表头要重新画一遍，否则读者不知道每列是什么。

`PageBreaker` 遇到 `pageable` 行（表格）时，会**以当前页的剩余可用高去问表格分页器**：

```ts
const avail = pageContentHeight - currentPageHeight
const result = line.pageable.paginate(avail)
```

拿回一个 `TableFragment`（这一页能放下的那一片）。如果本页完全放不下，就先结束当前页，换页后再问一次——**游标不推进**，保证同一张表在整页可用高下一定能前进，不会死循环。表格跨页表头重复的能力，在功能清单里也是独立条目。

## 五、分页是纯函数——这才是病历场景要的

回到上一篇反复强调的一条架构约束：**文档模型不知道分页的存在**，分页由排版引擎全权负责。

它带来的最大好处是：**分页是一个纯函数。** 同样的文档 + 同样的页面设置（A4、页边距、页眉页脚），永远得到同样的分页结果——不多一页、不少一页、断点也一样。

这在网页场景里是"锦上添花"，在病历场景里是**刚需**：

> "预览的第 3 页"和"打印出来的第 3 页"必须完全一致。医生签字确认的是打印出来的那份，如果两者对不上，是会出事的。

所以断行和分页这两个模块都**不读浏览器、不读 DOM、不依赖当前视口**——它们只吃数据、吐数据。这也是为什么它们能被单元测试直接覆盖（仓库里 `PageBreaker` 有独立的测试文件）。

## 六、UAX#14：用了多少，就说多少

这里必须诚实交代一句，免得被过度解读。

Unicode 的 **UAX #14**（Unicode Line Breaking Algorithm）是一套完整的换行规则标准，它把字符按换行属性分成几十个类别（LineBreakClass），再定义类与类之间的断行规则。

这套引擎**参考了 UAX #14 的思路**，但落地实现是**围绕中文避头尾和原子元素自己写的**：核心是"逐字符测宽 + 禁则字符集 + 原子性约束"，而**不是**完整实现了 UAX #14 的 LineBreakClass 分类与全部规则。

换句话说：**"参考思路"不等于"完全实现"**，我不会说它是一套完整的 UAX #14 引擎。中文病历里的高频问题（避头尾、中英混排、字段原子性）都覆盖到了，但多语言复杂换行（比如泰语、高棉语的字典断行）不在当前实现范围内。

## 七、增量：改一个字，不该重排整篇

一份上百页的病历，如果每次敲一个字都要重新断行 + 重新分页全篇，编辑体验会直接崩掉。

所以分页结果被一张**增量索引表**（`PageStartTable`）接管：它记录**每个段落的起始页索引**，支持"逐页早停 + 二分查找 + 增量更新"。目标很具体——**上百页文档里改一个字符，重排收敛在 1–2 页，从第 52 页起可以复用旧布局。**

配合脏区追踪（上一篇的 4.4 节），"改一个字"的代价被压到最小：**断行只重算受影响段落，分页只重算受影响的页边界。**

## 八、坦诚与边界

老规矩，把边界说清楚：

- **避头尾调整幅度限 2 字符**：极端窄栏（比如表格里很窄的单元格）下，可能出现"调整后仍不理想"的情况，这是刻意的取舍；
- **UAX #14 非完全实现**：如上节所述，不覆盖多语言复杂换行；
- **增量排版仍有边界**：增量断行 + 脏区追踪 + `PageStartTable` 三层联动，在编辑后局部重排时仍可能出现漂移，这是仓库里明确标注为"中风险"的待打磨项。

## 写在最后

这套内核完整开源（**MPL-2.0**），前后端一体：前端 React 18 + TypeScript 严格模式 + 自研 Canvas 渲染，后端 Spring Boot 3.3 + Java 17，带 Docker 部署与完整设计文档。**从零手写、不依赖任何第三方富文本框架**（没有 Quill / ProseMirror / Slate / Tiptap）。

如果你也在做**排版引擎 / 文本断行 / 分页算法**，或者正在被医疗文书编辑器折磨，欢迎来看看，或者直接开 Issue 聊：

- **开源仓库**：<https://gitee.com/wangwang_1_1665527118/emrdocument-engine?utm_source=wechat&utm_medium=article&utm_campaign=W12-linebreak-pagination>
- **在线体验**：<http://139.196.151.15/?utm_source=wechat&utm_medium=article&utm_campaign=W12-linebreak-pagination>

---

这是「EMR 文档编辑器」系列的第 12 篇。上一篇讲三层 Canvas 怎么把渲染拆开、怎么避免全量重绘；这一篇往下钻到排版的最底层：**一行在哪里断、一段该不该被拆到两页。**

下一篇，我们换一个节奏——把镜头转向读者。《病历编辑器被问最多的 5 个问题》，把这几个月评论区、私信里反复出现的疑问集中回答一次：为什么不用现成框架、导出到底支持哪些格式、协同做了没有、能不能商用、跟 XX 比怎么样。

──────────────
📌 往期精选
· 三层 Canvas 渲染架构：static / content / interact
· 为什么不用 ProseMirror：自研 Canvas 内核的取舍
· 病历编辑器选型地图：商业套件 / 开源内核 / 自研，各适合谁

如果这篇对你有用，欢迎关注「旺de碎碎念」
这里持续记录电子病历、医疗信息化与开源工程化的真实实践。
点个「在看」，让更多同行看到 ↓
──────────────

> 一份病历不该是医生的负担。让好的工具，成就更好的医疗。

---
---

# 以下为发布附件（不随稿件发布到平台）

## 附件 A · 事实自检表（契约 D6）

> 口径基线：AI 推广契约 §1.1–1.5（项目资产）与 §1.6（账号数据）。本篇所有项目事实以仓库实测为准；对 UAX #14 采用"参考思路、非完全实现"的稳妥口径（契约 §1.4）。

| 稿件中的表述 | 事实出处 | 核验结果 |
|---|---|---|
| 断行 `LineBreaker` → 分页 `PageBreaker` → 增量索引 `PageStartTable` 的管道顺序 | [编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L223)（第 97 条 全量排版）；[PageStartTable.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageStartTable.ts#L7-L13) | ✅ |
| 中文避头尾（kinsoku）：`LINE_START_FORBIDDEN`（行头禁止）/ `LINE_END_FORBIDDEN`（行尾禁止）；断行点命中禁则时向前/后调整 1–2 字符 | [LineBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/line/LineBreaker.ts#L23-L75)（字符集）与 [applyKinsokuRules](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/line/LineBreaker.ts#L257-L335) | ✅ |
| 调整幅度限制在 2 个字符以内（`Math.min(count, 2)` / `adjust < 2`） | [LineBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/line/LineBreaker.ts#L355-L363) 与 [L536-L550](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/line/LineBreaker.ts#L535-L550) | ✅ |
| 中英混排：CJK 可任意断、Latin 单词尽量在空格处断 | [splitTextElement](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/line/LineBreaker.ts#L469-L533)（"向右扫描最近空格"分支） | ✅ |
| 原子元素（`smarttext`）不参与逐字拆分，放不下整块换行 | [LineBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/line/LineBreaker.ts#L162-L227)（注释"smarttext 是原子控件…"） | ✅ |
| 按"剩余宽度"而非"整行宽度"判定，避免中段节点整行下沉 | [LineBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/line/LineBreaker.ts#L162-L180)（注释"关键修复…"） | ✅ |
| 孤行/寡行控制，`MIN_PARAGRAPH_LINES = 2` | [PageBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L18-L19)；[编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L225)（第 99 条 分页算法） | ✅ |
| 段落边界判定（行末元素为 `\n`）；表格块边界不参与孤行寡行 | [PageBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L49-L56)（`paragraphEnds`）、[countLastParagraphLines](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L242-L277) | ✅ |
| 表格跨页：以剩余可用高 `paginate(avail)` 拿 `TableFragment`，本页放不下则换页后再问（游标不推进） | [PageBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L85-L132) | ✅ |
| 跨页表格表头重复 | [编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L225)（第 99 条"跨页表格表头重复"） | ✅ |
| 分页为纯函数（同文档 + 同页面设置 → 同分页结果）；模块不读 DOM / 视口 | [PageBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L30-L47)（纯计算，无浏览器全局）；契约 §1.2「排版-渲染分离」 | ✅ |
| `PageBreaker` 有独立单元测试 | [PageBreaker.test.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/__tests__/PageBreaker.test.ts) | ✅ |
| UAX #14：**参考思路，非完全实现**；核心为"逐字符测宽 + 禁则字符集 + 原子性约束" | 功能清单第 98 条写"参考 UAX#14 规则"；代码实测**无** `LineBreakClass` 分类实现（`Grep` 全 `frontend/src` 无匹配）；契约 §1.4 | ✅ **稳妥口径**：明确未称"完整实现 UAX #14" |
| 增量分页：`PageStartTable`（TASK-485）逐页早停 + 二分查找 + 增量更新；"百页单字符编辑收敛 1~2 页，第 52 页起复用旧布局" | [PageStartTable.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageStartTable.ts#L7-L13)（文件头注释） | ✅ |
| 增量排版"局部重排可能漂移"为待打磨项 | [编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L386)（"🟡 中 — 增量排版完整性…可能出现漂移"） | ✅ 诚实披露 |
| 开源协议 **MPL-2.0**；React 18 + TS 严格模式 + 自研 Canvas；后端 Spring Boot 3.3 + Java 17 | [frontend/package.json](file:///d:/czw/EMRDocumentEngine/frontend/package.json#L5)；[README.md](file:///d:/czw/EMRDocumentEngine/README.md#L109-L118)；契约 §1.1 | ✅ |
| 控件多行文本折行 `wrapControlText`（逐字符累计宽软折行） | [TextWrap.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/text/TextWrap.ts#L20-L46) | ✅（正文未展开，作为备查） |

**禁用清单自检（契约 §1.5）**：

- [x] 未声称已支持 PDF / Word 导出
- [x] 未声称已支持多人实时协同
- [x] 未声称生产环境落地 / 已有 N 家医院使用
- [x] 未贬损浏览器 / 通用富文本的断行能力，以"取舍"表述
- [x] 未使用"国内首个 / 唯一 / 最强 / 完整实现 UAX #14"等绝对化或夸大口径
- [x] 未包含任何诱导 Star / 诱导关注话术

## 附件 B · 配图清单（按契约 §5.4 占位，发布前补齐）

| 编号 | 位置 | 类型 | 素材 | 占位内容 | 状态 |
|---|---|---|---|---|---|
| ① | 文首 | 示意装饰 | 公众号封面图 | **可文生图**：`a clean flat illustration of chinese text typesetting, a line of text with punctuation correctly kept off the line start, ruler and grid guides, soft red and white palette, minimal modern tech style, no readable text, landscape_16_9` | 🟡 提示词已就位，待出图 |
| ② | 第二节 2.1 | 示意 | 避头尾前后对比 | **建议自绘**以保证字符位置准确；文生图兜底：`side-by-side comparison of Chinese line breaking, left panel wrong break with a full-width period pushed to line start, right panel correct break, minimal flat style, light background, high contrast, 16:9` | 🟡 提示词已就位，待出图 |
| ③ | 第三节 | 示意 | 孤行 / 寡行示意图 | **建议自绘**：左侧"孤行"（段落末行单独留在上页底部）、右侧"寡行"（段落首行单独出现在下页顶部），对比修正后效果 | 🟡 需求已就位，待出图 |
| ④ | 第四节 | 实况 | 跨页长表格 + 表头重复 | **截图需求**：一张跨页的检验单/用药单表格，第二页顶部可见重复的表头；用红框标出重复表头 | 🟡 需求已就位，待真实截图 |

> **红线**（契约 §5.4 / 附录 A.3）：AI 生成图**只能用于示意 / 装饰**，不得冒充产品真实界面；④ 必须为真实截图。

## 附件 C · 发布清单

| 项 | 内容 |
|---|---|
| 发布渠道 | 微信公众号（账号：旺de碎碎念） |
| 计划发布时间 | **12:00 前后（窗口 11:30–12:30）**——契约 §5.2.1 硬性固定时段，不得漂移 |
| 发布后动作 | 2 小时内守留言；发布后核对引导模块渲染 |
| UTM | `utm_source=wechat&utm_medium=article&utm_campaign=W12-linebreak-pagination` |
| 主关键词 | 行断与分页；长尾：UAX#14 换行规则 / 中文避头尾 kinsoku / 孤行寡行控制 |
| 建议摘要（≤120 字） | 前一篇讲了三层 Canvas 怎么渲染，这篇往下钻到排版最底层：一行字该在哪里断、一段话该不该被拆到两页。避头尾、原子元素、孤行寡行、跨页表头——以及为什么"分页是纯函数"在病历场景里是正确性刚需。 |
| 关键词落位 | 主关键词→标题、首段、第一节；长尾→第二/三节首句、摘要 |
| 二次分发（契约 §7.4） | **本版仅公众号单一渠道**，不做跨平台改写 |
| 数据回收节点 | 24h / 72h / 7d 记入指标看板（契约 §8.1） |
| 选题归档 | 支柱 P1 · 内核深潜（契约 §7.2 D6）；承接《三层 Canvas 渲染架构》文末预告 |
| 系列位置 | 公众号系列第 12 篇（承接上一篇文末预告） |
| 文末必挂组件 | 附录 B.2「往期精选 + 关注引导」模块（R3）——**已挂** |
| 下一篇预告 | 《病历编辑器被问最多的 5 个问题》（契约 §7.2 D7，P5；表格中从上到下下一个尚未发布的坑位） |

## 附件 D · 待甲方确认

1. **UAX #14 口径**（第六节）：本篇明确写"参考思路、非完全实现"。注意 `.super-dev/WORKFLOW.md` 曾规划"UAX #14 LineBreakClass 42 分类"，但**当前代码实测无该实现**（全 `frontend/src` 无 `LineBreakClass`）。请甲方确认对外统一按"参考思路"表述，避免过度承诺；
2. **避头尾调整幅度**（第八节）：当前实现限 2 字符。若甲方有更细的排版规范（如窄栏放宽到 3 字符），可调整后再更新表述；
3. **配图 ③ 建议自绘**（第三节）：孤行/寡行示意图涉及页边界准确性，建议自绘；
4. **配图 ④ 为真实截图需求**（第四节）：需甲方提供或授权使用跨页表格实况截图（契约 §4.4 第 6 项）；
5. **UTM campaign 命名**（附件 C）：沿用 `W09-selection-map` / `W10-no-prosemirror` / `W11-layered-canvas` 风格，本篇暂定 `W12-linebreak-pagination`（W12 = 系列第 12 篇）。请确认命名规则；
6. **下一篇预告坑位**（附件 C）：按契约 §7.2"前 14 天开篇选题示例"**从上到下取第一个尚未发布的坑位**，本篇（D6）之后的下一坑位为 **D7《病历编辑器被问最多的 5 个问题》（P5）**。请甲方确认该预告口径。
