# layout/ 分层重构 — 回归测试清单

> 重构目标: 将 `frontend/src/engine/layout/` (19 个 TypeScript 文件) 从平铺重组为 8 个职责清晰的子目录,**零运行时行为变化**
>
> 重构日期: 2026-08-27
>
> 验证结果: ✅ TypeScript 零错误 / ✅ 41 test files / 439 tests / 0 failures (与 baseline 一致)

## 文件结构对照表

| 子目录 | 文件数 | 职责 |
|---|---|---|
| `core/` | 4 | 编排器 (LayoutEngine / SLIF) + 上下文/结果类型 (LayoutContext / LayoutResult) |
| `line/` | 2 | 断行算法 (LineBreaker) + 行布局类型 (LineLayout) |
| `page/` | 3 | 分页算法 (PageBreaker / PageStartTable) + 页布局类型 (PageLayout) |
| `text/` | 6 | 字体/测量子系统 (TextMeasurer / CharWidthHelper / FontManager / FontMetrics / FontFallback / ScriptResolver) |
| `table/` | 1 | 表格坐标工具 (TableCoordUtil) |
| `footnote/` | 1 | 脚注布局 (FootnoteLayout) |
| `incremental/` | 3 | 增量布局 (IncrementalLayout / DirtyTracker / LayoutCache) |
| `viewport/` | 2 | 视口/内存 (VirtualViewport / MemoryManager) |

涉及的具体改动:
- 18 个文件 `git mv` 到新位置
- 4 个新文件: `core/LayoutContext.ts`、`core/LayoutResult.ts`、`line/LineLayout.ts`、`page/PageLayout.ts`
- 22 处 import 路径更新 (内部 + 外部)
- 5 处 inline `import('./layout/...')` 类型引用更新 (3 处在 `Editor.ts`, 2 处在 `HitTestIndex.ts`)

---

## 必测功能清单

### 1. 文本测量层 (text/)
**字体回退 + 字符宽度**

测试动作:
- 在文档中混合输入中文 / 英文 / 数字 / 希腊字母 (α/β/γ) / 数学符号
- 输入整行空格 / 全角字符 / 半角字符

验收点:
- 排版无虚线框
- 字体不突变
- 光标落在字符之间位置准确
- 行宽计算正确

### 2. 换行层 (line/)
**断行 + 避头尾 (kinsoku)**

测试动作:
- 输入 "测试中文,这" 这类含避头尾字符的文本
- 输入英文长单词, 观察软连字符

验收点:
- 中文段落末行自动断到下一行 (行尾避尾字符)
- 中文段落首字避免标点 (段首避头字符)
- 标点不出现行首/行尾违例
- 软连字符正常显示

### 3. 分页层 (page/)
**分页边界 + 孤行寡行**

测试动作:
- 构造跨页段落 (一大段连续文本)
- 插入分节符 (section break)
- 调整表格大小直到接近一页

验收点:
- 段落首末行不单独留在上一页/下一页 (widow/orphan 控制)
- 表格正好在某页放不下时整体下移到下一页, 不留残行
- 分节符强制分页: 后续内容一定在新页顶部
- 跨页段落正确分配到两页 (前半在页末, 后半在页首)

### 4. 中间格式 (core/SLIF + LayoutEngine)
**全量布局 + 增量布局**

测试动作:
- 打开一篇 5+ 页的长文档
- 在第 3 页中间输入一个字符
- 连续执行撤销/重做

验收点:
- 所有页面渲染完整, 页号正确
- 第 3 页中间输入字符后, 只重排第 3 页之后, 前两页不动
- 撤销/重做后, 布局正确回滚到对应状态

### 5. 脚注层 (footnote/)
**脚注布局**

测试动作:
- 在正文中插入脚注引用
- 插入多个脚注引用
- 删除中间某个脚注引用

验收点:
- 页底出现分隔线 + 自动编号的脚注内容
- 多脚注编号连续 (1, 2, 3...)
- 脚注区高度超过可用区域时, 整体移到下一页
- 删除脚注引用后, 编号重新连续 (其他脚注编号同步变化)

### 6. 表格层 (table/)
**表格布局 + 命中检测**

测试动作:
- 插入 2×2 表格
- 在 cell 内输入多行文本
- 修改 cell 内容 (长文本 / 短文本)
- 点击表格内不同位置 (cell 中央 / 边缘 / 表格外侧空白)

验收点:
- 各 cell 内文本换行、列宽按比例分配
- 点击 cell 内任意字符 → 光标准确定位到该字符
- 点击表格右边缘空白 → 落到该 cell 末尾
- 点击表格下方空白 (无尾随段落) → 无命中 (死区)
- 点击表格下方空白 (有尾随段落) → 落到尾随段
- 修改 cell 内文字 → 表格高度自动撑开, 不溢出页底

### 7. 增量缓存层 (incremental/)
**脏区追踪 + 缓存**

测试动作:
- 在文档某段修改后, 观察哪些页重新排版

验收点:
- 只重排该段及之后的页, 之前段落坐标不变
- 第 2 页某段加字后, 第 1 页所有 item 的 y 坐标完全不变
- 反复编辑同一段 → LayoutCache 命中比例高

### 8. 视口层 (viewport/)
**虚拟视口**

测试动作:
- 长文档 (10+ 页) 滚动到第 10 页
- 反复前后滚动
- 跨页拖选

验收点:
- 滚动流畅, 不卡顿
- 光标跟随滚动 — 滚动到任何位置, 光标始终准确定位
- 反向滚动时光标位置正确还原 (不漂移)
- OVERSCAN_PAGES=1 边界 — 滚到第 4 页末 / 第 5 页头时, 前后页保留
- 选区跨页边界完整渲染 (页 1 末 + 页 2 头)

### 9. 内存层 (MemoryManager)
**LRU 淘汰**

测试动作:
- 滚动浏览长文档 50+ 页
- 来回滚动后观察内存 (DevTools Memory 面板)

验收点:
- MemoryManager 持续淘汰旧页缓存
- 文档来回滚动后无内存累积
- cache size 上限稳定 (不单调增长)

### 10. 跨子系统集成 (光标/选区滚动)
**端到端验证**

测试动作:
- 选区跨越页边界
- 拖选从页 1 到页 3
- 滚动过程中观察光标/选区位置

验收点:
- 选区跨越页边界 — 滚动选区两端都跟随
- 跨页拖选选区高亮完整渲染
- 光标/选区滚动后位置无漂移

---

## 优先测项 (时间有限时)

按风险排序 (重构触及最深 → 最容易回归):

1. **跨页光标/选区** — 改动了 `HitTestIndex` + `LayoutEngine` 内部 `import('./layout/SLIF')` 类型引用
2. **表格点击命中** — 改动了 `HitTestIndex` 的 inline type import (`SLIFCell`)
3. **脚注布局** — 改动了 `FootnoteLayout.ts` 的相对路径 (`'../layout/SLIF'` → `'../layout/core/SLIF'`)
4. **增量布局** — 改动了 `LayoutCache` / `DirtyTracker` / `IncrementalLayout` 的相对路径

---

## 快速冒烟测 (3 分钟)

如果只想快速验证重构无回归:

1. 打开文档 → 翻页浏览 → 输入字符 → 删除字符
2. 插入表格 → 在 cell 内输入 → 点击 cell 任意位置
3. 插入脚注 → 翻页浏览 → 撤销
4. 跨页点击 + 拖选 — 选中第 1 页末到第 2 页头

如果上面 4 步都无异常, 基本可以确认重构无回归。

---

## 已知环境问题 (非重构引入)

`vitest` 配置了 `environment: 'jsdom'`, 但 `setup.ts` 只 mock 了 Canvas API, 未 mock:
- `localStorage` (PrintHistoryService 测试报错)
- `document.documentElement` (EditorTheme 测试报错)
- `window.innerHeight` (VirtualViewport 测试报错)

这些是预先存在的测试环境配置不完善问题, 与本次重构无关。如需修复, 在 `src/engine/__tests__/setup.ts` 中添加对应 mock 即可。