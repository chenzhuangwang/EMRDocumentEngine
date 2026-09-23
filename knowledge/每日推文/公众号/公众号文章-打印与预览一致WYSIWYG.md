# 病历编辑器怎么保证"打印出来和预览一模一样"

> 医生签字确认的是那张纸，不是屏幕——所以"预览的第 3 页"和"打印出来的第 3 页"之间，不该有任何解释空间。

打印一份三十页的病历，最容易出事的不是内容，是**页脚**。

这不是假设。仓库里躺着一条带注释的回归记录：打印稿里，**页眉页脚整块消失**，正文的页码域打印成了两个字面量——`[页码]`。屏幕上明明一切正常。原因也不复杂：打印走的是"另一条路"。

这一篇就讲清楚，"打出来和看到的一样"这件事，到底要同时做对哪几件事。

## 一、打印为什么最容易"走样"

打印出问题，八成不是因为排版错了，而是因为**出现了第二个渲染器**。

屏幕渲染和打印输出，天然像是两条路：屏幕画在可见的 canvas 上，打印要交给浏览器的新窗口、要落到纸上。很多实现在这里会"顺手再写一套"——一套给屏幕，一套给打印。于是同一份文档有了两个真相：屏幕上有页眉，打印稿里没有；屏幕上是"第 7 页"，纸上印着"[页码]"。

这套内核给自己立了一条硬约束：

> **打印是渲染管线的投影，不得有第二个渲染器，也不得有第二份域代码解析。**

代码里的原话写得更直白——屏幕画布（`render`）与打印离屏（`renderPageToContext`）**共用同一分派**。（[Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L1188-L1196)）

这条约束不是口号，它落到三个具体的地方。三个都做对，"一样"才成立；缺一个，就会回到上面那条回归记录。

## 二、三件事同时做对，才叫"一样"

| 环节 | 要解决的问题 | 做错会怎样 |
|---|---|---|
| **同一份分页结果** | 一页装多少、在哪里断 | 屏幕第 7 页和纸上第 7 页装的内容不一样 |
| **同一条渲染管线** | 页眉页脚、域代码、批注怎么画 | 打印稿缺页眉、页码变字面量 |
| **同一批页面图** | 预览和打印读的是不是同一个东西 | 预览好好的，一点打印就换了个样 |

下面逐个说。

## 三、第一件事：分页先算准，而且必须是纯函数

打印一致的地基，是**分页结果只有一份**。

分页由 `PageBreaker` 负责，它是个纯函数：**同样的文档 + 同样的页面设置（A4、页边距、页眉页脚），永远得到同样的分页结果**——不多一页、不少一页、断点也一样。它不读浏览器、不读 DOM、不依赖当前视口。

真正难的从来不是"切页"，而是切得**像人排的**。这里有三条硬规矩：

- **孤行寡行控制**：一个段落被拆到两页时，每一侧至少留 2 行。常量就一行：

```ts
/** Minimum lines of a paragraph that must stay together (avoid orphans/widows). */
const MIN_PARAGRAPH_LINES = 2
```

- **跨页表头重复**：长表格被切成多个 fragment 分到不同页时，第二页的表头要重新画一遍——否则读者不知道每列是什么。分页器在切页时把 `headerLines` 一路带着走。
- **表格是块边界**：表格行不参与孤行寡行控制，它的跨页逻辑是另一套（以当前页剩余可用高去问表格分页器，拿回一个 `TableFragment`）。

（[PageBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L19)、[表格分页分支](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L85-L96)、[孤行判定](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L141)）

**分页是纯函数，所以"预览第 7 页装什么"在算完那一刻就定死了**——不会因为你换个屏幕、缩放下、换个窗口就变。这是"打印一致"能被保证的第一层前提。

## 四、第二件事：打印必须复用同一条渲染管线

分页算完，接下来是画。这里是最容易"分裂出第二个渲染器"的地方。

引擎的做法是：打印时**不另写渲染代码**，而是把每一页交给同一个渲染函数去画。`preparePrintPages()` 干的就是这件事：

```ts
preparePrintPages(): string[] {
  const pages = this.draw.getPages()
  for (const page of pages) {
    const offscreen = surface.createOffscreen(page.width * dpr, page.height * dpr)
    // 渲染页面内容 (复用现有渲染管线)
    this.draw.renderPageToContext(pctx, page, page.width)
    result.push(offscreen.toDataURL('image/png'))
  }
  return result
}
```

关键在那句注释：**复用现有渲染管线**。而 `renderPageToContext` 自己的注释也写明了它必须包含什么——"与屏幕渲染（render）同源，必须包含**页眉 + 页脚**，并复用粒子管线（**域代码逐页解析** / 控件 presentation 上下文）"。（[Editor.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/Editor.ts#L2839-L2859)、[Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L1764-L1775)）

同一条约束还管到了别处。比如批注高亮——它没有走粒子管线，而是直接从文档的批注数据解析，理由写在注释里：**屏幕（静态层）与打印（renderPageToContext）共用同一实现，保证两边一致**。（[Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L232-L246)）

还有一个反过来的要求：**编辑标记不许进打印稿**。不可见字符、编辑辅助线在屏幕上可以显示，打印时必须强制关掉——参数注释里写的是"打印必须强制 false（编辑标记不进打印稿）"。（[Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L1188-L1196)）

于是那条回归记录的存在就很好理解了：它正是"有人绕开了同一条管线"的结果。修好之后，仓库里还专门留了一个测试文件守着这条线，文件头的注释就是那次回归的墓志铭。（[PrintRender.test.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/__tests__/PrintRender.test.ts#L7-L13)）

## 五、第三件事：预览和打印，用的是同一批图

到这一步，"打印稿画对了"已经成立。但还差最后一环——**预览和打印，读的是不是同一个东西？**

如果预览是"重新排一遍给你看"，打印是"再排一遍拿去印"，那两边就有两次机会不一致。

引擎把这一环也掐掉了：预览和打印**共用同一条输出路径**。

- 点"预览"：`setPrintPages(ed.preparePrintPages())` —— 生成一批页面图，预览窗口逐页显示其中的第 N 张；
- 点"打印"：`openPrintWindow(selectPrintPages(all, range))` —— `all` 还是 `ed.preparePrintPages()` 生成的那批图。

`EditorPage` 里那句注释说得很清楚：**打印与打印预览共用同一条输出路径——预览后点打印看到的就是这里的结果。**（[EditorPage.tsx](file:///d:/czw/EMRDocumentEngine/frontend/src/pages/EditorPage.tsx#L57-L81)、[预览接线](file:///d:/czw/EMRDocumentEngine/frontend/src/pages/EditorPage.tsx#L1089-L1095)、[打印接线](file:///d:/czw/EMRDocumentEngine/frontend/src/pages/EditorPage.tsx#L1096-L1113)）

打印窗口里的那几行 CSS 才是"最后一米"：

```
@page{size:A4;margin:0}
img{width:210mm;height:auto;page-break-after:always}
```

意思是：**纸张就是 A4，页边距为零；一张图就是一页，宽度锁死在 210mm（A4 的宽），图与图之间强制分页。** 浏览器拿到的是已经排好的整页图，它不再重新断行、不再重新分页——它只负责把图印到纸上。

这也解释了一个细节：预览对话框在深色外壳下，中间那块纸面**仍然是白的**，代码里还专门留了豁免标记——"A4 纸面本体，打印必须 WYSIWYG"。（[PrintPreviewDialog.tsx](file:///d:/czw/EMRDocumentEngine/frontend/src/components/dialogs/PrintPreviewDialog.tsx#L82-L88)）

## 六、打印对话框里，哪些是真的生效

"打出来一样"还有个容易被忽略的前提：**你在对话框里填的，得真的被用上。**

这里要说一句实在话，因为应用侧能管的和不能管的，界限很清楚：

- **页码范围是真的生效的。** 用户填的范围会先被钳到 `[1, 总页数]`，再按范围切片，然后才交给打印窗口。代码注释里留了一句自查："原先这里直接丢掉 settings —— 页码框、续打断点全是摆设。"（[printJob.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/lib/printJob.ts#L43-L53)、[EditorPage.tsx](file:///d:/czw/EMRDocumentEngine/frontend/src/pages/EditorPage.tsx#L1096-L1113)）
- **打印机、份数、单双面，由系统打印窗口生效。** JS 无法操控浏览器原生打印对话框，所以这三个控件的作用是"把用户的选择带进打印历史"。界面上有如实说明，没让人误以为在这里选了份数就生效了。（[PrintDialog.tsx](file:///d:/czw/EMRDocumentEngine/frontend/src/components/dialogs/PrintDialog.tsx#L7-L14)、[界面说明](file:///d:/czw/EMRDocumentEngine/frontend/src/components/dialogs/PrintDialog.tsx#L241-L248)）
- **续打断点的语义是"这一轮有没有打到末页"**，而不是"浏览器有没有弹完打印窗口"（那个信号 JS 拿不到）。没打到末页，才留一枚断点，下次打开提示从下一页继续；打完了还留断点，会让人误以为要续打。（[printJob.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/lib/printJob.ts#L13-L16)、[L55-L58](file:///d:/czw/EMRDocumentEngine/frontend/src/lib/printJob.ts#L55-L58)）

顺带一提，"打印模式"（`print`）在这套引擎里是一种**只读模式**——进到打印模式后，编辑是被锁住的，只能看、只能打。（[EditorRuntimeState.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/state/EditorRuntimeState.ts#L47)、[KeyboardHandler.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/interaction/KeyboardHandler.ts#L49-L55)）

## 七、坦诚与边界

老规矩，把边界说清楚——尤其打印这件事，最后一米并不完全在应用手里：

- **打印输出是"页面图"，不是矢量 PDF。** 每一页是渲染成 PNG 再交给打印窗口的，分辨率取决于页面像素尺寸与设备像素比；它不是矢量格式，不存在"无限放大不失真"。
- **最后一环仍在浏览器和系统手里。** 系统打印窗口里的"缩放""适应纸张"这类设置会二次缩放，应用侧控制不了；要打出一比一的效果，那些选项需要保持默认（100% / 实际大小）。
- **分页靠 `page-break-after` 交给浏览器。** 这是浏览器打印路径，不是 PDF/PostScript 级别的分页控制；页面图高度与 A4 比例一致时是一图一页，但这条链路本身不是"绝对物理分页"。
- **页面图渲染复用主渲染管线，所以主渲染的边界它都有。** 例如文本塑形目前仍用 Canvas `measureText`，更高精度的塑形引擎是规划项。

**PDF / Word 导出与多人协同仍在推进中，当前可用导出格式为 JSON / TXT / HTML。**

仓库与在线体验：

- **开源仓库**：<https://gitee.com/wangwang_1_1665527118/emrdocument-engine?utm_source=wechat&utm_medium=article&utm_campaign=W16-print-wysiwyg>
- **在线体验**：<http://139.196.151.15/?utm_source=wechat&utm_medium=article&utm_campaign=W16-print-wysiwyg>

---

这是「EMR 文档编辑器」系列的第 16 篇。上一篇《性能实录：从 8s 压到 400ms》聊的是"打开慢、编辑卡、滚动掉帧"这三笔账；这一篇换到另一个最朴素的要求上——**打出来的，必须就是看到的**。

内核深潜这条线写到这一篇，其实已经绕了排版一圈：怎么断行、怎么分页、表格怎么跨页、页面怎么画出来。而"打印一致"是把它们全部收口的那一步——前面每一环只要有一个"另一条路"，这里就会露馅。

下一篇换个角度，回到选型台：**《电子病历编辑器怎么选？先问这 5 个问题再谈价格》**——把三条路线的成本结构，压成一份可以直接拿去问供应商的清单。

──────────────
📌 往期精选
· 行断与分页：UAX#14 + 孤行寡行控制
· 表格跨页与合并矩阵算法：一张表格怎么"活"着穿过分页线
· 三层 Canvas 渲染架构：static / content / interact

如果这篇对你有用，欢迎关注「旺de碎碎念」
这里持续记录电子病历、医疗信息化与开源工程化的真实实践。
点个「在看」，让更多同行看到 ↓
──────────────

> 一份病历不该是医生的负担。让好的工具，成就更好的医疗。

---
---

# 以下为发布附件（不随稿件发布到平台）

## 附件 A · 事实自检表（契约 D15）

> 口径基线：AI 推广契约 §1.1–1.5（项目资产）。本篇为 P1「内核深潜」的场景化包装（选题来源：《选题蓄水池》D15），所有机制表述**对照仓库实测**；对**未接线 / 规划项 / 链路边界采用"未实现 / 规划中 / 不由应用控制"的诚实口径**（契约 §1.2、§1.4）。

| 稿件中的表述 | 事实出处 | 核验结果 |
|---|---|---|
| **"打印是渲染管线的投影，不得有第二个渲染器，也不得有第二份域代码解析"** | [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L1188-L1196)（`renderBodyItem` 头注释原话） | ✅ 原话引用 |
| **`preparePrintPages()`**：取分页结果逐页离屏渲染为 PNG dataURL；注释"复用现有渲染管线" | [Editor.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/Editor.ts#L2839-L2859)；[Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L1322) `getPages()` | ✅ 正常 |
| **`renderPageToContext` 与屏幕渲染同源，必须含页眉 + 页脚，复用粒子管线（域代码逐页解析）** | [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L1764-L1775)（头注释原话）；[paintPage](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L1777-L1781)（`headerHeight` / `footerHeight`） | ✅ 正常 |
| **批注高亮：屏幕（静态层）与打印共用同一实现** | [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L232-L246)（注释"屏幕 (静态层) 与打印 (renderPageToContext) 共用同一实现，保证两边一致"） | ✅ 正常 |
| **编辑标记不进打印稿**（`showInvisible` 打印强制 false） | [Draw.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/render/Draw.ts#L1188-L1196)（参数注释"打印必须强制 false (编辑标记不进打印稿)"） | ✅ 正常 |
| **真实回归**：`renderPageToContext` 原先只遍历 `page.items` → **页眉页脚在打印稿里完全消失**；且不调 `resolveFieldText` → **域代码打印成占位字面量 `[页码]`** | [PrintRender.test.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/__tests__/PrintRender.test.ts#L7-L13)（文件头回归说明原话） | ✅ **原话引用（含真实踩坑）** |
| **打印渲染有独立单元测试** | [PrintRender.test.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/__tests__/PrintRender.test.ts) | ✅ |
| **预览与打印共用同一条输出路径**（预览后点打印看到的就是同一批图） | [EditorPage.tsx](file:///d:/czw/EMRDocumentEngine/frontend/src/pages/EditorPage.tsx#L57-L81)（`openPrintWindow` 头注释原话）；预览 `setPrintPages(ed.preparePrintPages())` [L1089-L1095](file:///d:/czw/EMRDocumentEngine/frontend/src/pages/EditorPage.tsx#L1089-L1095)；打印 `openPrintWindow(selectPrintPages(all, range))` [L1096-L1113](file:///d:/czw/EMRDocumentEngine/frontend/src/pages/EditorPage.tsx#L1096-L1113)；预览对话框 `onPrint` 复用 `printPages` [L1116-L1131](file:///d:/czw/EMRDocumentEngine/frontend/src/pages/EditorPage.tsx#L1116-L1131) | ✅ 正常 |
| **打印窗口 CSS**：`@page{size:A4;margin:0}` + `img{width:210mm;height:auto;page-break-after:always}` | [EditorPage.tsx](file:///d:/czw/EMRDocumentEngine/frontend/src/pages/EditorPage.tsx#L71-L74) | ✅ 原样引用 |
| **A4 尺寸口径**（794 × 1123 px @72dpi；A4 = 210 × 297mm） | [PageSetupDialog.tsx](file:///d:/czw/EMRDocumentEngine/frontend/src/components/dialogs/PageSetupDialog.tsx#L28-L40)；[i18n](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/i18n/index.ts#L1459)（`A4 (210×297mm)`） | ✅ 正常 |
| **预览对话框纸面保持白色**（深色外壳下纸仍是白的，"打印必须 WYSIWYG"） | [PrintPreviewDialog.tsx](file:///d:/czw/EMRDocumentEngine/frontend/src/components/dialogs/PrintPreviewDialog.tsx#L82-L88)（`retheme-keep` 豁免标记原话） | ✅ 原话引用 |
| **分页为纯函数**：同文档 + 同页面设置 → 同分页结果；不读 DOM / 视口 | [PageBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L30-L47)；契约 §1.2「排版-渲染分离」 | ✅ |
| **孤行寡行 `MIN_PARAGRAPH_LINES = 2`**；段落边界判定；orphan / widow 调整 | [PageBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L19)、[L50-L52](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L50-L52)、[L141](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L141)、[L170-L178](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L170-L178) | ✅ |
| **跨页表头重复**：`headerLines` 贯穿分页 | [PageBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L32-L233)；[编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L225)（第 99 条"跨页表格表头重复"） | ✅ |
| **表格分页**：以剩余可用高 `paginate(avail)` 拿 `TableFragment`；表格行视为块边界 | [PageBreaker.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L85-L96)、[L49-L56](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/layout/page/PageBreaker.ts#L49-L56) | ✅ |
| **页码范围真生效**：钳制 → 切片 → 才交打印窗口；注释"原先这里直接丢掉 settings —— 页码框、续打断点全是摆设" | [printJob.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/lib/printJob.ts#L43-L53)；[EditorPage.tsx](file:///d:/czw/EMRDocumentEngine/frontend/src/pages/EditorPage.tsx#L1100-L1103) | ✅ 原话引用 |
| **打印机 / 份数 / 单双面由系统打印窗口生效**（JS 无法操控原生打印对话框）；界面有如实说明 | [PrintDialog.tsx](file:///d:/czw/EMRDocumentEngine/frontend/src/components/dialogs/PrintDialog.tsx#L7-L14)、[L241-L248](file:///d:/czw/EMRDocumentEngine/frontend/src/components/dialogs/PrintDialog.tsx#L241-L248) | ✅ **诚实披露"分工"** |
| **续打断点**：`completed` = 是否打到文档末页（非"打印窗口弹完"）；未打完才留断点 | [printJob.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/lib/printJob.ts#L13-L16)、[L55-L58](file:///d:/czw/EMRDocumentEngine/frontend/src/lib/printJob.ts#L55-L58)、[L72-L87](file:///d:/czw/EMRDocumentEngine/frontend/src/lib/printJob.ts#L72-L87)；[PrintHistoryService.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/services/PrintHistoryService.ts) | ✅ 正常 |
| **打印模式 `print` 为只读模式之一**（readonly / clean / print 均限制编辑） | [EditorRuntimeState.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/state/EditorRuntimeState.ts#L47)；[KeyboardHandler.ts](file:///d:/czw/EMRDocumentEngine/frontend/src/engine/interaction/KeyboardHandler.ts#L49-L55) | ✅ |
| **打印预览 / 打印对话框 / 打印执行三项均标记为"正常"** | [编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L281)（第 130 条 打印预览）、[L295](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L295)（第 137 条 打印对话框）、[L296](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L296)（第 138 条 打印执行：Canvas 页面渲染为 PNG → 新窗口 A4 打印） | ✅ |
| **打印输出为 PNG 页面图、非矢量**（分辨率取决于页面像素尺寸 × 设备像素比） | 同 `preparePrintPages()`：`createOffscreen(page.width * dpr, page.height * dpr)` → `toDataURL('image/png')`；功能清单第 138 条口径"Canvas 页面渲染为 PNG" | ✅ **诚实披露"非矢量"** |
| **系统打印窗口的缩放设置会二次缩放，应用侧控制不了** | 应用侧无该设置入口（`PrintDialog` 仅范围/份数/双面，且已注明由系统窗口生效）；属浏览器打印链路固有限制 | ✅ **诚实披露"不由应用控制"** |
| **HarfBuzz 文本塑形未实现（planned）**，主渲染边界即打印边界 | [编辑器功能清单.md](file:///d:/czw/EMRDocumentEngine/knowledge/编辑器功能清单.md#L261)（第 121 条）；契约 §1.2 | ✅ **诚实披露"规划中"** |

**禁用清单自检（契约 §1.5 / N1–N10）**：

- [x] 未声称已支持 PDF / Word 导出——正文明确写"仍在推进中，当前可用 JSON / TXT / HTML"
- [x] 未声称已支持多人实时协同
- [x] 未声称生产环境落地 / 已有 N 家医院使用
- [x] 未贬损任何竞品；对"浏览器打印路径"的限制以"边界"而非"缺陷"表述
- [x] 未使用"首个 / 唯一 / 最强 / 极致 / 像素级完美"等绝对化表述
- [x] 未包含诱导关注 / 诱导 Star 话术（关注引导为常规固定模块）
- [x] 未编造社会认同 / 虚假留言（N4）
- [x] **未编造"打印事故"场景**——正文所述页眉页脚消失 / `[页码]` 字面量，均出自仓库内 `PrintRender.test.ts` 的回归注释，并已显式说明"这不是假设"
- [x] 未将"规划中 / 未接线"表述为"已实现"（§1.4）——HarfBuzz、PNG 非矢量、系统缩放不可控**均作显式披露**

## 附件 B · 配图清单（按契约 §5.4 占位，发布前补齐）

| 编号 | 位置 | 类型 | 素材 | 占位内容 | 状态 |
|---|---|---|---|---|---|
| ① | 文首 | 示意装饰 | 公众号封面图 | **可文生图**：`a minimal flat illustration of a printed medical document page emerging from a printer, aligned exactly with a screen page behind it, muted clinical blue and warm tone, clean soft style, no readable text, landscape_16_9` | 🟡 提示词已就位，待出图 |
| ② | 第二节 | 示意 | "三件事"对照图 | **可直接复用/重绘**：同一份分页结果 / 同一条渲染管线 / 同一批页面图 → 三列或三环示意 | 🟡 待出图 |
| ③ | 第五节 | 示意 | 预览与打印同源链路 | **建议自绘**：分页结果 → `preparePrintPages()` → 同一批页面图 → 分别到"预览窗口 / 打印窗口"；体现"共用一条路径" | 🟡 需求已就位，待自绘 |
| ④ | 第五节 | 实况 | 预览对话框 / 打印稿对照 | **截图需求**：应用内打印预览对话框（A4 纸面 + 页码）与打印出来的同一页实拍对照，用红框标出页脚页码一致 | 🟡 需求已就位，待真实截图 |

> **红线**（契约 §5.4 / 附录 A.3）：AI 生成图**只能用于示意 / 装饰**，不得冒充产品真实界面；④ 必须为**真实截图**（预览对话框 + 打印稿实拍），不得用示意图冒充实况。

## 附件 C · 发布清单

| 项 | 内容 |
|---|---|
| 发布渠道 | 微信公众号（账号：旺de碎碎念） |
| 计划发布时间 | **12:00 前后（窗口 11:30–12:30）**——契约 §5.2.1 硬性固定时段，不得漂移 |
| 发布后动作 | 发布后核对往期精选 / 关注引导模块渲染；守留言 |
| UTM | `utm_source=wechat&utm_medium=article&utm_campaign=W16-print-wysiwyg` |
| 主关键词 | 病历打印 分页一致；长尾：病历编辑器 打印 / 预览和打印不一致 / 电子病历 打印 |
| 建议摘要（≤120 字） | "打出来和看到的一样"，看着是常识，做起来要同时做对三件事：同一份分页结果、同一条渲染管线、同一批页面图。这篇讲这套内核怎么把这三件事收口，也如实说明 PNG 页面图与系统缩放这些边界。 |
| 关键词落位 | 主关键词→标题（前 12 字内）、首段；长尾→第一 / 五 / 七节首句、摘要 |
| 二次分发（契约 §7.4） | **本版仅公众号单一渠道**，不做跨平台改写 |
| 数据回收节点 | 24h / 72h / 7d 记入指标看板（契约 §8.1）；本篇为 P1 场景化包装的**首个验证样本**，重点看完读率是否高于 09-20/09-21 两篇纯内核篇（20% / 5%） |
| 选题归档 | 支柱 **P1 · 内核深潜**（契约 §7.2 之后按《[选题蓄水池](file:///d:/czw/EMRDocumentEngine/knowledge/每日推文/选题蓄水池.md#L74-L79)》**D15**）；承接《性能实录：从 8s 压到 400ms》文末预告 |
| 系列位置 | 公众号系列第 16 篇（承接上一篇文末预告） |
| 文末必挂组件 | 附录 B.2「往期精选 + 关注引导」模块（R3）——**已挂** |
| 下一篇预告 | 《电子病历编辑器怎么选？先问这 5 个问题再谈价格》（《选题蓄水池》**D16**，P2 · 09-25 坑位） |

## 附件 D · 待甲方确认

1. **系列编号 = 第 16 篇**：按发布顺序推算（架构契约 = 第 8 篇已发；性能实录 = 第 15 篇），本篇紧随其后为第 16 篇。请确认。
2. **排期与蓄水池日期需整体顺延（重要）**：目前**已定稿待发 7 篇**——选型地图（第 9）、为什么不用 ProseMirror（第 10）、三层 Canvas（第 11）、行断与分页（第 12）、被问最多 5 个问题（第 13）、合规审计（第 14）、性能实录（第 15）。按日更 1 篇顺推，本篇（D15）实际落在 **09-30 前后**，而《选题蓄水池》D15–D28 现按 09-24 ~ 10-07 标注，**日期列整体需后移约 6 天**，且国庆假期（10-01 ~ 10-07）将落在 D16–D22 区间。请甲方确认：① 是否按顺推修正蓄水池日期；② 假期是否按"值班场景"轻量化或降频。
3. **配图 ④ 为真实截图需求**：需甲方提供应用内打印预览对话框截图 + 打印稿实拍（体现页脚页码一致），不得用 AI 图替代（§5.4）。
4. **"打印输出为 PNG 页面图、非矢量"的披露口径**：这是事实陈述（功能清单第 138 条同口径），但会让读者明确意识到"不是 PDF"。请确认保留该表述（§1.4 诚实披露 vs 暴露程度需甲方拍板）。
5. **打印清晰度表述**：正文只写"分辨率取决于页面像素尺寸与设备像素比"，**未给具体 DPI 承诺**。若甲方希望给出数值，请提供可复现依据，否则维持现口径（§1.4：量化指标须能在 1.2 节找到出处）。
6. **"页眉页脚消失 / `[页码]` 字面量"作为开篇钩子**：素材来自仓库内回归注释（真实），正文已声明"这不是假设"。请确认公开这一历史缺陷的尺度。
7. **UTM campaign 命名**：沿用 `W09-selection-map`…`W15-performance` 风格，本篇暂定 `W16-print-wysiwyg`（W16 = 系列第 16 篇）。请确认命名规则。
