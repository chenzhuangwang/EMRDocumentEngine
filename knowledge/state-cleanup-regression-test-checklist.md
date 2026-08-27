# state/ 清理 — 回归测试清单

> 重构目标: 清理 `frontend/src/engine/state/` 中的遗留问题
> 1. 删除死代码 `RangeManager` (API 与当前选区模型不兼容, 已被 MouseHandler 绕过)
> 2. 抽出 `HistoryState` 接口到独立文件 `state/HistoryState.ts`
>
> 重构日期: 2026-08-27
>
> 验证结果: ✅ TypeScript 零错误 / ✅ 40 files / 427 tests / 0 failures
>
> 净变更: 5 files, +17 / -201 行 (净减 184 行死代码)

## 具体改动

### 删除
- `frontend/src/engine/state/RangeManager.ts` (-77 行)
- `frontend/src/engine/__tests__/RangeManager.test.ts` (-111 行, 12 个 test)

### 新增
- `frontend/src/engine/state/HistoryState.ts` (+16 行)
  - 抽出 `HistoryState` 接口
  - 含 `canUndo` / `canRedo` / `undoDepth` / `redoDepth` 四个字段

### 修改
- `frontend/src/engine/state/EditorRuntimeState.ts`
  - 删除内联 `HistoryState` 接口定义
  - 新增 `import type { HistoryState } from './HistoryState'`
  - `EditorRuntimeState.history` 字段类型改为引用外部 `HistoryState`
- `frontend/src/engine/index.ts`
  - barrel 同步: `HistoryState` 从 `EditorRuntimeState` 重导出移除
  - 新增独立 export: `export type { HistoryState } from './state/HistoryState'`

---

## 必测功能清单

### 1. 选区拖拽 (原 RangeManager 覆盖范围)
**RangeManager 被删除, 但实际选区逻辑从未走它 — 由 MouseHandler 直接维护**

测试动作:
- 鼠标按下 → 拖拽 → 释放, 验证选区是否正确建立
- 单击 + 拖拽跨段落选区 (anchor 在 p1, focus 在 p3)
- 双击选词、三击选段

验收点:
- 拖拽后选区高亮范围准确
- 跨段落选区: anchor / focus 段落正确区分
- 单击落点 = 双击拖拽起点 = 选区起点, 一切如常

### 2. 撤销 / 重做 (HistoryState 关注的核心)
**HistoryState 接口位置变化, 但语义不变**

测试动作:
- 输入字符 A → B → C
- 连续撤销 3 次 → 重做 3 次
- 撤销 + 插入新字符 → 重做栈应被清空

验收点:
- `EditorStore.state.runtime.history.canUndo` 在可撤销时为 true
- `EditorStore.state.runtime.history.canRedo` 在可重做时为 true
- `undoDepth` / `redoDepth` 数值随操作正确增减
- 工具栏撤销/重做按钮启用状态与 `history.canUndo/canRedo` 一致

### 3. 类型导入 (HistoryState 多了一条导入路径)
**验证外部 consumer 没断**

测试动作 (开发验证, 不需要手动跑):
- 搜索 `import.*HistoryState.*from.*EditorRuntimeState`
- 应全部改为 `from './state/HistoryState'` 或 `from 'engine/state/HistoryState'`

验收点:
- 没有任何文件因 import 路径变更而出现类型错误
- `EditorRuntimeState.history` 字段类型解析正确

### 4. 旧 RangeManager API 调用方
**RangeManager 完全删除, 但确认无人意外使用过它**

测试动作 (开发验证):
- grep `RangeManager` 应只在 git history 中出现, 不在当前代码

验收点:
- 当前代码 `grep -rn 'RangeManager' frontend/src` 返回空
- 任何运行时行为不会引用到 RangeManager

### 5. 整体状态读写 (EditorStore)
**EditorStore 通过 `createDefaultRuntimeState()` 构造默认状态**

测试动作:
- 新建 Editor 实例, 检查 `store.state.runtime` 各字段

验收点:
- `runtime.history` 默认值正确 (全部 false / 0)
- 不会因为 HistoryState 抽到独立文件而出现 undefined / null

---

## 优先级 (时间有限时)

按风险排序:

1. **撤销/重做功能** — HistoryState 接口位置变更, 任何依赖 `canUndo/canRedo` 字段的 UI 都可能受影响
2. **跨段落选区拖拽** — 原 RangeManager 覆盖的功能, 即使是死代码也要确认真的无人需要
3. **工具栏撤销/重做按钮启用状态** — 视觉反馈依赖 `history.canUndo/canRedo` 字段

---

## 快速冒烟测 (2 分钟)

1. 打开文档 → 输入几个字符
2. 撤销 → 输入新字符 → 重做按钮应禁用
3. 拖拽鼠标选中一段 → 释放 → 选区高亮正确
4. 工具栏撤销/重做按钮在适当时机启用/禁用

如果上面 4 步都无异常, 基本可以确认 state/ 清理重构无回归。

---

## 与 layout/ 重构的交叉点

state/ 是上层 (Editor + 各种 handler 使用), layout/ 是底层。本次清理只动 state/, **未触及 layout/ 已重构的代码**。两者完全正交 — 上一轮的回归测试清单仍然有效。

---

## 已知环境问题 (非本次重构引入)

`vitest` 配置了 `environment: 'jsdom'`, 但 `setup.ts` 只 mock 了 Canvas API, 未 mock `localStorage` / `document.documentElement` / `window.innerHeight`。相关 test (PrintHistoryService / EditorTheme / VirtualViewport) 在 jsdom 下会报 `not defined`, 这是**预先存在**的环境配置问题, 与本次重构无关。

修复方法: 在 `frontend/src/engine/__tests__/setup.ts` 中添加对应 mock 即可。