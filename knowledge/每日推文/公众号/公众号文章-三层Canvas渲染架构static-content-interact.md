# 三层 Canvas 渲染架构：static / content / interact

> 上一篇讲了"为什么是 Canvas"。这一篇讲一个更具体的问题：**用 Canvas 之后，怎么保证几十页病历滚动时还不掉帧。**

上一篇文章里我说，这套病历编辑器选了自研 Canvas，而不是站在 ProseMirror 肩上。评论区有人追问了一个更实在的问题：**Canvas 不是"整屏重绘"吗？一个几十页的病历，每次打字都要重画一遍？那不得卡死。**

这个担心是对的。Canvas 和 DOM 最本质的区别就在这里——DOM 有浏览器帮你做增量更新，你改一个字的样式，浏览器只重排那一块；而 Canvas 是一张白纸，你画什么它显示什么，不画的地方就空着。**所以"性能"这件事，从你决定用 Canvas 的那一刻起，就得自己负责。**

这篇就把这层责任讲清楚：三层 Canvas 怎么切、每层管什么、以及为了"不掉帧"到底做了哪些事。

## 一、先想清楚：一张 Canvas 为什么不够

如果只用一张 Canvas 画所有东西，会立刻撞上一个问题：**重绘的粒度太粗。**

光标每 530 毫秒要闪一次。如果光标和正文画在同一张 Canvas 上，那么每次闪烁，都要把整页的正文、表格、页眉页脚**全部重画一遍**——只为了那根 2 像素宽的竖线。这在第 1 页也许看不出来，但一份几十页的病历，滚动到中段时，代价就明显了。

于是第一刀就很自然：**按"重绘频率"和"图层语义"把 Canvas 切开。**

## 二、三层各管什么

```
static   (z = 1)  页面背景 / 阴影 / 边距线 / 页码 / 水印 / 四角标记
content  (z = 2)  正文文本 / 表格 / 结构化控件 / 图片 / 页眉页脚
interact (z = 3)  光标 / 选区高亮 / IME 预览 / 拖拽参考线
```

三层的分工逻辑不是"按内容类型"，而是**按变化的频率**：

| 层 | 什么时候变 | 典型内容 |
|---|---|---|
| static | 几乎不变（换页、换主题、改水印时） | 页面底板、水印、页码 |
| content | 编辑时变（但通常是局部） | 文字、表格、图片 |
| interact | 高频变（每次光标移动 / 闪烁） | 光标、选区、IME 候选预览 |

这样切完，最贵的"高频"和"最重"的"正文"就被物理隔离了：**光标闪烁只需要清掉最上面那层，重画一根线；下面两层的像素原封不动。** 反过来，正文变化时也不会误伤光标层。

实现上，三层是三个独立的 `CanvasSurface`，各自持有自己的 `CanvasRenderingContext2D`，通过 `host.surface.createLayer(key)` 创建（`LayeredRenderer.ts`）。三个 ctx 存在一个 `layers` / `ctxs` 字典里，绘制时按 `static → content → interact` 的固定顺序调用。

## 三、渲染顺序：为什么是"从下往上"

主渲染入口在 `Draw.render()`，代码里第一行注释就把顺序钉死了：

```
顺序: 静态层(背景) → 内容层(文本) → interact层(选区→光标)
```

这个顺序不是随便定的，它对应着一条**绘制语义**：

- **static 在最下**，所以"必须垫在文字下面"的东西都放这一层——页面底色、水印，以及**批注高亮**。注意批注高亮虽然语义上属于"内容"，但它必须画在文字**底下**，于是它被作为 `decoratePage` 回调注入静态层，而不是画在内容层。
- **content 在中间**，正文、表格、页眉页脚。
- **interact 在最上**，光标、选区。这里还有一层细分：**选区高亮画在光标之前**（在文字"下方"），**光标画在最后**（在文字"上方"）——同一次绘制里，`renderSelectionUnified` 先跑，光标 `fillRect` 后跑。

同一张 Canvas 里，绘制顺序就是层级关系。这套顺序在代码里是硬编码的，不是靠样式或配置。

## 四、真正的对手：Canvas 的"全量重绘"

分层解决了"光标闪烁连累正文"，但没解决"滚动时要不要重画所有页"。这里才是 Canvas 性能的主战场。有四道防线。

### 4.1 Canvas 只有一屏多一点，不是整个文档

最容易被忽略、但收益最大的一点：**Canvas 元素的物理尺寸，不等于文档高度。**

很多人以为"一个长文档 = 一张很长的 Canvas"，于是撑出一张几万像素高的画布。这在浏览器里是灾难——GPU 纹理有上限，超了直接不渲染或崩溃。

这套实现里的做法是：**Canvas 尺寸 = 视口高度 + 一页的 overscan。**

```ts
// LayeredRenderer.ts
private readonly OVERSCAN_PAGES = 1
...
const pagesInView = Math.ceil(docViewportH / avgSlot) + this.OVERSCAN_PAGES * 2
```

也就是说，画布只覆盖"当前视口 + 上下各留一点余量"。滚动时不是重画，而是**移动画布**：三层 Canvas 都是 `position: absolute` 固定在视口顶部，内容根据滚动偏移 `setTransform` 平移。

那"长文档的滚动条"从哪来？答案是一个**占位元素（spacer）**：`syncSizes()` 里把 spacer 的高度设成"全文档高度 × 缩放"，用它撑出原生滚动条；真正的画布始终只画视口那一块。

### 4.2 只画看得见的页

画布尺寸限制了"画多大"，`getVisiblePages` 决定了"画哪几页"：

```ts
const visible = this.layoutEngine.getVisiblePages(scrollY, docViewportH)
for (let i = visible.start; i <= visible.end; i++) { ... }
```

`getVisiblePages(scrollY, viewportHeight)` 会遍历页面累加高度，算出当前滚动位置覆盖的页区间 `{ start, end }`。**区间外的页直接跳过**——不测量、不绘制。配合 4.1 的 overscan，滚动手感上"下一页"已经提前画好了，不会出现白屏。

### 4.3 同一帧内的多次重绘，合并成一次

连续打字时，"每个字符触发一次渲染"是浪费。渲染调度走的是 `requestAnimationFrame` 合并：

```ts
scheduleRender(pool?, runtimeState?): void {
  if (this._rafId !== null) return   // 已有待执行的渲染帧
  this._rafId = this.host.surface.requestFrame(() => {
    this._rafId = null
    this.render(pool, runtimeState)
  })
}
```

关键在于那句 `if (this._rafId !== null) return`：**只要已经排了一个帧，后续调用全部丢弃。** 一帧内不管触发多少次重绘请求，最终只执行最后一次 `render()`。这在连续输入、滚动、缩放这类高频场景里，直接把渲染次数压到"显示器刷新率"的上限。

### 4.4 变了哪里，就只清哪里

最后一道是脏区裁剪。内容层重绘前，如果记录了脏矩形 `dirtyRect`，就用 `ctx.clip()` 把重绘限制在这个矩形内：

```ts
if (this.dirtyRect) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(this.dirtyRect.x, this.dirtyRect.y, this.dirtyRect.w, this.dirtyRect.h)
  ctx.clip()
  this.dirtyRect = null
}
```

**改了一个段落，就不必清整屏。** 脏区由排版侧的 `DirtyTracker` 在三层（段落 / 页面 / 节点）上标记，命令执行后自动打点。

> 一句话总结这四道防线：**画布只留一屏（4.1）、只画可见页（4.2）、一帧只画一次（4.3）、只清变化区（4.4）。**

## 五、粒子化：加一种元素，不碰主流程

分层和裁剪解决的是"画多少、画多快"。还有一个**工程可维护性**问题：正文里的元素种类是会涨的——今天是文字、表格、图片，明天要加公式、图表、条码、脚注。

如果每加一种元素就往 `render()` 里塞一个 `if/else`，主渲染函数很快会变成一个谁都不敢动的巨型分支。

这里的做法是**粒子化**：每种可渲染元素抽象成一个"粒子"，实现同一个接口：

```ts
export interface IParticle {
  readonly type: string
  render(ctx, item, x, y, options?): void
}
```

粒子注册到 `ParticleRegistry`，渲染时**按类型查表调度**，而不是 `switch`：

```ts
const textRenderer = particleRegistry.get(item.nodeType || item.type)
                   || particleRegistry.get('text')
```

**要加一种新元素，只需要实现一个 particle 并注册进去，主渲染流程一行都不用改。** 目前注册的粒子包括：文本、表格、分隔线、列表标记、图片、公式（KaTeX）、脚注引用、批注高亮、图表、条码等——它们共用一套调度入口。

## 六、细节里的取舍

前面是主干。真正让"手感"不一样的，往往是这些不起眼的地方。

### 6.1 光标闪烁为什么用 `setInterval`，不用 rAF

光标闪烁如果用 `requestAnimationFrame` 驱动，意味着**每秒 60 次唤醒整个渲染流程**，只为翻转一个布尔值。而光标闪烁是"每 530 毫秒变一次"的低频事件，跟帧率毫无关系。

所以这里的实现很直接——一个独立的定时器：

```ts
this.blinkTimer = setInterval(() => {
  this.cursorVisible = !this.cursorVisible
  state.cursor.visible = this.cursorVisible
  if (this._renderCallback) this._renderCallback()
}, 530)
```

**低频事件就别占用高频通道。** 闪烁只翻转可见性并触发一次重绘，不参与每帧的渲染循环。

### 6.2 水印：离屏预渲染成 pattern

水印是"铺满整页、内容完全一样、只是重复"的典型场景。如果每页都重新画一遍旋转文字，纯属浪费。

这里的做法是**离屏 Canvas 预渲染**：先在离屏表面画一次旋转文字，`createPattern(..., 'repeat')` 生成可平铺的图案，正式渲染时 `fillRect` 一次铺满（`prepareTileWatermark`）。图案只在配置变化时重算一次。文字水印和图片水印各有路径，切换文档时通过显式传入 `null` 来清除，避免上一份文档的水印残留。

### 6.3 渲染器不创建 Canvas

一个容易被忽视、但决定了"能不能被不同宿主嵌入"的细节：**渲染器自己从不创建 Canvas 元素。**

`LayeredRenderer` 的所有画布能力——创建层、创建离屏表面、请求下一帧、加载图片——全部通过 `host.surface` 拿。构造函数里也是 `surface.createLayer(key)` 而不是 `document.createElement('canvas')`。

这条约束的收益是：引擎里**没有浏览器全局**（无 `window` / `document`）。换成 Electron、放进 Web Worker 做无头排版，渲染层不需要改——它只知道"宿主给了我一个 surface"。

### 6.4 一页坏了，不能让整帧白屏

渲染是"每帧重画"的，一旦某页的某个节点抛错，如果异常冒泡到 rAF 回调，**整帧都不会画**——其余页和光标一起消失，用户看到的是全屏空白。

所以渲染路径包了两层容错：`safeRenderPage`（逐页）和 `safeRenderParticle`（逐节点）。**单页失败只损失这一页，单节点失败只丢这个节点**，渲染继续往下走。这在医疗场景里不是"体验优化"，而是"不能因为一个坏数据点就让整份病历不可见"。

## 七、代价与边界（还是得说清楚）

三层 Canvas 不是没有成本的，我把代价也列出来：

- **内存换性能**：三层各持一个 Canvas，物理像素 = 视口 × DPR × 层数。高 DPR 屏上内存占用是单层的数倍——这是"用空间换掉帧"的明确取舍；
- **一切要手写**：命中检测、滚动、光标定位、文本测量，DOM 免费给的东西，这里都得自己实现（这也是上一篇说"自研要长期投入"的原因）；
- **脏区裁剪依赖脏标记的准确性**：`DirtyTracker` 标错区间，就会留下残影或重绘不足。增量排版和脏区追踪是这套架构里最需要测试覆盖的部分。

换句话说：**这套架构解决的是"几十页文档 + 高频交互"的性能问题，如果你的场景是一屏内的短文本，它的复杂度就是净负担。**

## 写在最后

这套内核完整开源（**MPL-2.0**），前后端一体：前端 React 18 + TypeScript 严格模式 + 自研 Canvas 渲染，后端 Spring Boot 3.3 + Java 17，带 Docker 部署与完整设计文档。**从零手写、不依赖任何第三方富文本框架**（没有 Quill / ProseMirror / Slate / Tiptap）。

如果你也在做**渲染引擎 / 富文本内核 / Canvas 性能优化**，或者正在被医疗文书编辑器折磨，欢迎来看看，或者直接开 Issue 聊：

- **开源仓库**：<https://gitee.com/wangwang_1_1665527118/emrdocument-engine?utm_source=wechat&utm_medium=article&utm_campaign=W11-layered-canvas>
- **在线体验**：<http://139.196.151.15/?utm_source=wechat&utm_medium=article&utm_campaign=W11-layered-canvas>

---

这是「EMR 文档编辑器」系列的第 11 篇。上一篇回答"为什么不用 ProseMirror，偏要自研 Canvas 内核"；这一篇往下钻了一层：**既然用了 Canvas，三层怎么切、全量重绘的代价怎么还。**

下一篇，我们把镜头推到排版的底层——《行断与分页：UAX#14 + 孤行寡行控制》，聊聊中文病历里"一行字该在哪里断、一段话该不该被拆到两页"，以及避头尾、原子元素、孤行寡行这三件事为什么必须一起解决。

──────────────
📌 往期精选
· 为什么不用 ProseMirror：自研 Canvas 内核的取舍
· 病历编辑器选型地图：商业套件 / 开源内核 / 自研，各适合谁
· 架构契约：如何让 AI 不写坏你的代码

如果这篇对你有用，欢迎关注「旺de碎碎念」
这里持续记录电子病历、医疗信息化与开源工程化的真实实践。
点个「在看」，让更多同行看到 ↓
──────────────

> 一份病历不该是医生的负担。让好的工具，成就更好的医疗。

---
---

# 以下为发布附件（不随稿件发布到平台）

## 附件 A · 事实自检表（契约 D5）

> 口径基线：AI 推广契约 §1.1–1.5（项目资产）与 §1.6（账号数据）。本篇所有项目事实以仓库实测为准；架构描述以代码注释与实现为准，不夸大性能收益、不给出未经复测的帧率数字。

| 稿件中的表述 | 事实出处 | 核验结果 |
|---|---|---|
| 三层 Canvas：static(z:1) / content(z:2) / interact(z:3)，职责分别为"页面背景·阴影·边距线·页码·水印""文本·表格·SmartTextNode·Image""光标·选区·IME 预览" | [LayeredRenderer.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L8-L20)（文件头注释）；[编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L214)（第 93 条）；契约 §1.2 | ✅ |
| 三层由 `host.surface.createLayer(key)` 创建，各自持有独立 ctx | [LayeredRenderer.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L67-L80)（constructor） | ✅ |
| 渲染顺序：静态层(背景) → 内容层(文本) → interact层(选区→光标) | [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L530-L533)（主渲染入口注释）与 [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L582-L671)（实现顺序） | ✅ |
| 批注高亮经 `decoratePage` 回调注入静态层（垫在文字之下） | [LayeredRenderer.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L165-L172)（renderStatic 注释）；[Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L589-L591) | ✅ |
| 选区先画、光标后画 | [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L641-L666)（renderSelectionUnified → fillRect 光标） | ✅ |
| Canvas 尺寸 = 视口 + overscan 1 页（非全文档）；`OVERSCAN_PAGES = 1` | [LayeredRenderer.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L65) 与 [syncSizes](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L124-L151) | ✅ |
| 视口内可见页数估算 = `ceil(docViewportH / avgSlot) + OVERSCAN_PAGES * 2` | [LayeredRenderer.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L138-L139) | ✅ |
| spacer 撑出原生滚动条；三层 Canvas 固定于视口顶部，按滚动偏移平移 | [LayeredRenderer.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L78-L80)（createSpacer）、[fixCanvasScrollOffset](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L115-L120)、[setScrollOffset](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L153-L161)；[编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L217)（第 96 条 视口同步） | ✅ |
| 仅渲染可见页：`getVisiblePages(scrollY, docViewportH)` | [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L574)（调用）；[LayoutEngine.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/core/LayoutEngine.ts#L1298)（实现）；[编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L236)（第 105 条 可见页渲染） | ✅ |
| rAF 帧合并：`scheduleRender` + `_rafId` 守卫，一帧只执行一次 render | [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L535-L546)（注释标注 TASK-484） | ✅ |
| 脏区裁剪：`dirtyRect` + `ctx.clip()`（TASK-483） | [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L597-L604)；[编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L227)（第 101 条 脏区追踪） | ✅ |
| 粒子接口 `IParticle`（type + render） | [IParticle.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/particles/IParticle.ts) | ✅ |
| 粒子按类型查表调度（`particleRegistry.get(...) || particleRegistry.get('text')`），非 if/else 分支 | [ParticleRegistry.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/particles/ParticleRegistry.ts)；[Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L1233-L1248) | ✅ |
| 粒子清单：文本/表格/分隔线/列表标记/图片/公式(KaTeX)/脚注/批注/图表/条码 | [编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L242-L251)（第 106–115 条） | ✅ |
| 光标闪烁用 `setInterval(..., 530)`（非 rAF） | [LayeredRenderer.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L304-L313) | ✅ |
| 水印离屏 pattern 预渲染（tile 用 `createOffscreen` + `createPattern`） | [LayeredRenderer.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L240-L252)（prepareTileWatermark）；[编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L276)（第 125 条 水印渲染） | ✅ |
| 渲染器不创建 Canvas，全部经 `host.surface` 委托（契约 §27.2） | [LayeredRenderer.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/LayeredRenderer.ts#L18-L19)（文件头注释）与 constructor | ✅ |
| 逐页容错 `safeRenderPage` / 逐节点容错 `safeRenderParticle` | [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L616-L621)、[Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L727)、[Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L1274-L1281)（ErrorRecovery Level 1） | ✅ |
| 开源协议 **MPL-2.0**；React 18 + TS 严格模式 + 自研 Canvas；后端 Spring Boot 3.3 + Java 17 | [frontend/package.json](file:///d:/czw/EMRDocumentEngine/frontend/package.json#L5)；[README.md](file:///d:/czw/EMRDocumentEngine/README.md#L109-L118)；契约 §1.1 | ✅ |
| "几十页病历滚动不掉帧" | 表述为架构目标与设计动机，**未给具体帧率 / 页数压测数字**（避免未复测口径） | ✅ 稳妥表述 |

**禁用清单自检（契约 §1.5）**：

- [x] 未声称已支持 PDF / Word 导出
- [x] 未声称已支持多人实时协同
- [x] 未声称生产环境落地 / 已有 N 家医院使用
- [x] 未贬损 ProseMirror / DOM 渲染，全文以"取舍"表述，并明确指出短文本场景下本架构复杂度为净负担
- [x] 未使用"国内首个 / 唯一 / 最强 / 极致性能"等绝对化表述
- [x] 未给出未经复测的性能数字（未写"8s 压到 400ms"这类具体指标）
- [x] 未包含任何诱导 Star / 诱导关注话术

## 附件 B · 配图清单（按契约 §5.4 占位，发布前补齐）

| 编号 | 位置 | 类型 | 素材 | 占位内容 | 状态 |
|---|---|---|---|---|---|
| ① | 文首 | 示意装饰 | 公众号封面图 | **可文生图**：`a clean flat illustration of three stacked translucent canvas layers labeled by color, background layer, content layer and top interaction layer with a blinking cursor, soft blue and white palette, minimal modern tech style, no text, landscape_16_9` | 🟡 提示词已就位，待出图 |
| ② | 第二节 | 架构图 | 三层 Canvas 职责与 z 序 | **建议自绘**；风格底图可文生图：`a three-layer canvas architecture diagram, static z1 page background and watermark, content z2 text and tables, interact z3 cursor and selection, flat technical blueprint style, deep blue and cyan, clean, no text, 16:9` | 🟡 提示词已就位，待出图 |
| ③ | 第四节末 | 示意 | 四道防线（画布只留一屏 / 只画可见页 / 一帧一次 / 只清变化区） | **建议自绘**（流程/清单式信息图）；文生图兜底：`an infographic of four performance strategies for canvas rendering, viewport-sized canvas, visible-page-only, frame merging, dirty rectangle clipping, minimal flat style, light background, high contrast, 16:9` | 🟡 提示词已就位，待出图 |
| ④ | 第五节 | 实况 | 粒子注册与调度关系 | **截图需求**：代码/文档实况截图，展示 `IParticle` 接口与 `ParticleRegistry` 注册表（或粒子目录文件列表），用红框标出"新增元素只需注册"的部分 | 🟡 需求已就位，待真实截图 |

> **红线**（契约 §5.4 / 附录 A.3）：AI 生成图**只能用于示意 / 装饰**，不得冒充产品真实界面；④ 必须为真实截图。

## 附件 C · 发布清单

| 项 | 内容 |
|---|---|
| 发布渠道 | 微信公众号（账号：旺de碎碎念） |
| 计划发布时间 | **12:00 前后（窗口 11:30–12:30）**——契约 §5.2.1 硬性固定时段，不得漂移 |
| 发布后动作 | 2 小时内守留言；发布后核对引导模块渲染 |
| UTM | `utm_source=wechat&utm_medium=article&utm_campaign=W11-layered-canvas` |
| 主关键词 | 三层 Canvas 渲染架构；长尾：Canvas 渲染性能优化 / 富文本分层渲染 / 病历编辑器滚动掉帧 |
| 建议摘要（≤120 字） | 用 Canvas 之后，性能就得自己负责。这篇讲清三层 Canvas 怎么切（static / content / interact）、以及为了"几十页病历滚动不掉帧"做的四道防线：画布只留一屏、只画可见页、一帧只画一次、只清变化区。 |
| 关键词落位 | 主关键词→标题、首段、第二节；长尾→各防线小节首句、摘要 |
| 二次分发（契约 §7.4） | **本版仅公众号单一渠道**，不做跨平台改写 |
| 数据回收节点 | 24h / 72h / 7d 记入指标看板（契约 §8.1） |
| 选题归档 | 支柱 P1 · 内核深潜（契约 §7.2 D5）；承接《为什么不用 ProseMirror》文末预告 |
| 系列位置 | 公众号系列第 11 篇（承接上一篇文末预告） |
| 文末必挂组件 | 附录 B.2「往期精选 + 关注引导」模块（R3）——**已挂** |
| 下一篇预告 | 《行断与分页：UAX#14 + 孤行寡行控制》（契约 §7.2 D6，表格中从上到下下一个尚未发布的坑位） |

## 附件 D · 待甲方确认

1. **配图 ② / ③ 建议自绘**（第二、四节）：三层架构图与"四道防线"信息图涉及层级与流程准确性，建议自绘或基于仓库文档截图加工，避免 AI 生成图与真实架构不符；
2. **性能数字口径**（全文）：本篇刻意**不给**具体帧率 / 页数压测数字，只描述架构手段（避免未复测口径）。若甲方可提供经复测的性能数据（如"X 页文档滚动稳定在 Y fps"），可补入第四节增强说服力；
3. **"几十页"表述**（摘要 / 文末）：为定性描述，非实测边界。请确认是否可公开典型文档规模；
4. **UTM campaign 命名**（附件 C）：沿用 `W09-selection-map` / `W10-no-prosemirror` 风格，本篇暂定 `W11-layered-canvas`（W11 = 系列第 11 篇）。请确认命名规则；
5. **下一篇预告坑位**（附件 C）：按契约 §7.2"前 14 天开篇选题示例"**从上到下取第一个尚未发布的坑位**，本篇（D5）之后的下一坑位为 **D6《行断与分页：UAX#14 + 孤行寡行控制》（P1）**。请甲方确认该预告口径。
