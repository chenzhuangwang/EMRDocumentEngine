// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// ComputedValues — 计算值的**一份**集合 (契约 §12.12.6 / §12.12.7)
//
// 为什么要有"一份"这个东西, 而不是每次读的时候现算:
//
//   布局和渲染是**两趟, 而且隔得很远** —— `Draw.render()` 不重排, 它画的是
//   上一次布局产出的 SLIF, 而滚动/缩放每次都跑 render。若两趟各自求值, 布局
//   可能按"40 岁"算控件盒宽、渲染按"41 岁"画字 —— 正是 §12.8 存在的意义所要
//   防的那种静默几何分歧, 而且跨分钟/跨日界**天天会发生**。
//   把结果 memo 成一份, 布局/渲染/导出读的是同一个值, **构造上**一致。
//
//   顺带得到第二件契约要求的东西: §12.12.6 的"只在依赖变化时重算"。
//
// 时钟 (§12.12.7): 本模块**不读钟** —— `evaluation/` 下有静态闸门禁止
// `new Date()`。构造方 (引擎根) 注入 `now()`, 本模块在**真正需要重算的那一刻**
// 调它一次, 同一次重算里所有求值共用这一个时刻。
//
// 代价, 写在明处: 时间相关值**在文档闲置时不会自己走** —— `GETAGE` 算出的年龄
// 要等依赖变化或换文档才更新。这对病历是**想要的**: 医生读到的值不该在他签字前
// 悄悄变。定时刷新是宿主的事, 不是本模块的。
//
// 依赖与环 (§12.12.6):
//   valueRefs  = 被**读**的键 → 真依赖, 决定重算范围与拓扑序
//   targetRefs = SHOW/HIDE **指向**的键 → 只决定谁被隐藏, **不是依赖**
//   (混在一起会把可见性边当成依赖边, 于是 A 隐藏 B、B 隐藏 A 被误判成环)
//   环在**建图时**报出, 不靠深度上限或栈溢出兜住。
//
// 链式引用: `[A]` 读的是 A 的**有效值** —— A 若有公式且算得出, 读它算出来的值;
// 否则读 A 的原始 value。这正是"环"真实存在的原因 (A 引用 B、B 引用 A),
// 也是拓扑排序存在的理由。
// ================================================================

import type { ControlValue } from '../document/core/DocumentModel'
import { isControlValueEmpty } from '../document/control/ControlValue'
import {
  collectReferences, evaluateAst, evaluateFormula, parseFormula,
  type Ast, type CalcContext, type CalcError, type CalcFunction, type CalcResult,
  type VisibilityDirective,
} from './ExpressionEngine'

/** 一条控件的计算结果 */
export interface ComputedEntry {
  /**
   * 派生显示值。**只在该控件自己的公式是"值公式"且算成功时才有** ——
   * 没有时调用方回退到控件自身的值/占位符 (可见性公式不产生显示值)。
   */
  display?: string
  /**
   * 是否参与布局。无公式的控件恒为 true。
   * **算错了也保持 true** —— 出错时把控件藏起来会连带藏掉必填项, 是比"显示一个
   * 算不出来的值"更危险的失败模式 (fail-open, 与 §12.11 的不硬拦同一取向)。
   */
  visible: boolean
  /** 出错时的**分类**错误 (§12.12.9: 不许塌成"公式有误") */
  error?: CalcError
}

/**
 * 本模块对外的全部输入 —— 都是**注入**的, 于是它不认识文档、不认识 Editor,
 * 可脱文档单测。真实接线在 Editor 里 (投影 → 键解析)。
 */
export interface ComputedValuesDeps {
  /** 节点 id 列表 (投影顺序) —— 决定遍历与错误报告的稳定顺序 */
  nodeIds(): readonly string[]
  /** 某节点的公式; 无则 undefined/空串 */
  formulaOf(nodeId: string): string | undefined
  /** 某节点的绑定键 (§12.12.3: 引用按绑定键解析) */
  keyOf(nodeId: string): string
  /** 键 → 命中该键的节点 id (0 个 = 未找到, ≥2 = 撞键) */
  nodesFor(key: string): readonly string[]
  /** 某节点的**原始**运行值 */
  valueOf(nodeId: string): ControlValue | undefined
  /**
   * 某节点的**值版本号** (`NodePool.getNodeVersion`)。
   *
   * 这是重算正确性的兜底: 显式 `invalidateForValues` 要求每个写入方都记得调它,
   * 而写值的路径不止一条 (单点写入 / 批量绑定 / 查找替换 / 导入器) —— 漏一个就
   * 会静默沿用旧的计算值, 而且**看起来完全正常**。版本号由池在 `updateNode` 时
   * 自增, 不需要任何写入方配合。
   *
   * 可选: 不提供时退化为"只认显式失效"(单测与将来的无池场景)。
   */
  versionOf?(nodeId: string): number
  /**
   * 时钟。**由构造方提供, 在本模块要求重算时调用一次** (§12.12.7)。
   * 本模块内不得出现 `new Date()` (静态闸门守)。
   */
  now(): Date
  /** 集成方注册的纯函数 (§12.12.2) */
  functions?: ReadonlyMap<string, CalcFunction>
}

interface FormulaPlan {
  nodeId: string
  /** 解析成功的 AST; 语法错时缺失 */
  ast?: Ast
  /** 语法错 → 直接记在该节点上, 不参与依赖图 */
  syntaxError?: CalcError
  valueRefs: string[]
  targetRefs: string[]
  /**
   * 含 SHOW/HIDE → 可见性指令式 (§12.12.5)。
   *
   * **它在值图上是汇点**: 指令不产出值, 没有别的东西能依赖它的结果, 所以环
   * 不可能穿过它。这条区分不是洁癖 —— 触发式公式的写法天然引用**它自己所在
   * 控件**的键 (`SEX` 上的 `[SEX] == 'M' ? HIDE(...)`), 不区分就会把这种最常见
   * 的写法判成自环。
   *
   * 边界(诚实记): 若 SHOW/HIDE 写在**取不到的分支**里 (`false ? HIDE([X]) : 1`),
   * 求值结果其实是值, 但它按指令式排序 —— 于是可能读不到上游的派生值。
   * 这种写法没有实际用途, 不值得为它把排序搞成两阶段递归。
   */
  isDirective: boolean
}

export class ComputedValues {
  private readonly deps: ComputedValuesDeps
  private readonly entries = new Map<string, ComputedEntry>()

  /** nodeId → 该公式读了哪些键 (重算范围的反查依据) */
  private plans = new Map<string, FormulaPlan>()
  /** key → 读了该键的公式节点 */
  private dependentsOfKey = new Map<string, Set<string>>()
  /** 依赖图的邻接表 (只含值公式之间的边), 建图时检环 */
  private adjacency = new Map<string, string[]>()
  /** 参与了环的节点 —— 这些节点的求值顺序无定义, 一律报 cycle */
  private cyclic = new Set<string>()
  /** 值进了某条公式的节点 —— 它们的版本号变了就必须重算 */
  private watched = new Set<string>()
  /** watched 的版本快照 (兜底判据, 见 ComputedValuesDeps.versionOf) */
  private watchedVersions = new Map<string, number>()

  private computedAtValue: Date | null = null
  private dirty = true

  constructor(deps: ComputedValuesDeps) {
    this.deps = deps
  }

  /** 重算时刻 (§12.12.7)。null = 还没算过 (全是无公式的文档时可能一直为 null) */
  get computedAt(): Date | null { return this.computedAtValue }

  // ---- 生命周期 ----

  /**
   * 文档或定义变了 → 重建依赖图并标脏。
   * 不在这里重算: 建图是 O(公式数) 的纯静态工作, 重算要读钟, 留给 `ensure()`。
   */
  reset(): void {
    this.plans = new Map()
    this.dependentsOfKey = new Map()
    this.adjacency = new Map()
    this.cyclic = new Set()
    this.entries.clear()
    this.dirty = true

    for (const nodeId of this.deps.nodeIds()) {
      const src = this.deps.formulaOf(nodeId)
      if (src === undefined || src.trim() === '') continue

      const ast = parseFormula(src)
      if ((ast as CalcError).code !== undefined) {
        this.plans.set(nodeId, {
          nodeId, syntaxError: ast as CalcError, valueRefs: [], targetRefs: [], isDirective: false,
        })
        continue
      }
      const parsed = ast as Ast
      const { valueRefs, targetRefs } = collectReferences(parsed)
      this.plans.set(nodeId, {
        nodeId, ast: parsed, valueRefs, targetRefs, isDirective: targetRefs.length > 0,
      })
      for (const key of valueRefs) {
        const set = this.dependentsOfKey.get(key) ?? new Set<string>()
        set.add(nodeId)
        this.dependentsOfKey.set(key, set)
      }
    }

    this.buildGraphAndDetectCycles()

    // 收集"值进了某条公式"的节点 —— 它们的版本号是重算的兜底判据
    this.watched = new Set()
    for (const plan of this.plans.values()) {
      for (const key of plan.valueRefs) {
        for (const owner of this.deps.nodesFor(key)) this.watched.add(owner)
      }
    }
    this.snapshotVersions()
  }

  private snapshotVersions(): void {
    this.watchedVersions.clear()
    const versionOf = this.deps.versionOf
    if (!versionOf) return
    for (const id of this.watched) this.watchedVersions.set(id, versionOf(id))
  }

  /** 被依赖的值有没有动过 (兜底; 无 versionOf 时恒 false) */
  private versionsChanged(): boolean {
    const versionOf = this.deps.versionOf
    if (!versionOf) return false
    for (const id of this.watched) {
      if (this.watchedVersions.get(id) !== versionOf(id)) return true
    }
    return false
  }

  /**
   * 建依赖图并**在建图时**检环 (§12.12.6)。
   *
   * 边只走**值公式**之间: 引用一个没有公式的控件不成边 (它的值不会因计算而变);
   * 引用一个可见性指令式控件也不成边 (指令在值图上是汇点, 它不产出可依赖的值)。
   *
   * **自环必须留下**: `[A] + ([A] * 2)` 写在 A 自己的值公式里是一条真实的环。
   * 第一版把"自己指向自己"的边排除了, 于是它会静默读到 A 的**原始值**并算出一个
   * 看着正常的结果 —— 那比报错危险得多 (它看起来像能用)。契约 §12.12.6 举的
   * 例子恰恰就是这一条。
   */
  private buildGraphAndDetectCycles(): void {
    const valueNodes = new Set(
      [...this.plans.values()].filter((p) => !p.isDirective).map((p) => p.nodeId),
    )
    for (const plan of this.plans.values()) {
      if (plan.isDirective) { this.adjacency.set(plan.nodeId, []); continue }
      const deps = new Set<string>()
      for (const key of plan.valueRefs) {
        for (const owner of this.deps.nodesFor(key)) {
          if (valueNodes.has(owner)) deps.add(owner)
        }
      }
      this.adjacency.set(plan.nodeId, [...deps])
    }

    // DFS 三色; 命中回边时把栈上从该点起的一段全部标成环成员
    const state = new Map<string, 0 | 1 | 2>()
    const stack: string[] = []
    const cycleNodes = this.cyclic
    const visit = (id: string): void => {
      const s = state.get(id) ?? 0
      if (s === 2) return
      if (s === 1) {
        const at = stack.indexOf(id)
        for (const x of stack.slice(at < 0 ? 0 : at)) cycleNodes.add(x)
        return
      }
      state.set(id, 1)
      stack.push(id)
      for (const next of this.adjacency.get(id) ?? []) visit(next)
      stack.pop()
      state.set(id, 2)
    }
    for (const id of this.plans.keys()) visit(id)
  }

  /**
   * 值写入后按依赖失效 (§12.12.6)。
   *
   * **这是提示而不是正确性机制**: 它要求每个写入方都记得调, 而写值的路径不止
   * 一条。正确性由 `versionOf` 的版本比对兜底 (见 `ensure()`), 所以漏调它只会
   * 让重算晚一点发生, 不会算错。
   *
   * 只标脏, 不立刻重算 —— 一次批量写入可能连着改好几个字段, 重算留到读之前
   * 一次做完 (布局/渲染/导出各调一次 `ensure()`, 第一次真算, 之后是 no-op)。
   */
  invalidateForValues(nodeIds: readonly string[]): void {
    if (this.plans.size === 0) return
    for (const nodeId of nodeIds) {
      const key = this.deps.keyOf(nodeId)
      if (key === '') continue
      if (this.dependentsOfKey.get(key)?.size) { this.dirty = true; return }
    }
  }

  /**
   * 读之前调一次: 脏、或**被依赖的值版本变了**, 则重算。
   *
   * 版本这一路是兜底: 任何写值的路径 (`updateNode`) 都会自增节点版本, 不需要
   * 写入方配合。缺了它, 一个漏调 `invalidateForValues` 的写入方就会让整份文档
   * 沿用旧的计算值 —— 而且看起来完全正常。
   */
  ensure(): void {
    if (!this.dirty && !this.versionsChanged()) return
    this.recompute()
    this.dirty = false
    this.snapshotVersions()
  }

  // ---- 读 ----

  /** 一条控件的结果; 无公式的控件返回 undefined */
  get(nodeId: string): ComputedEntry | undefined {
    return this.entries.get(nodeId)
  }

  /** 是否参与布局 (无公式/无结果 → true) */
  visibleOf(nodeId: string): boolean {
    return this.entries.get(nodeId)?.visible ?? true
  }

  /** 派生显示值 (无 → undefined, 调用方回退到控件自身的值/占位符) */
  displayOf(nodeId: string): string | undefined {
    return this.entries.get(nodeId)?.display
  }

  /** 有错的节点 (供作者化面与诊断) */
  errors(): Array<{ nodeId: string; error: CalcError }> {
    const out: Array<{ nodeId: string; error: CalcError }> = []
    for (const [nodeId, entry] of this.entries) {
      if (entry.error) out.push({ nodeId, error: entry.error })
    }
    return out
  }

  /**
   * 作者化面的试算入口 (§12.12.9) —— **不写进集合**, 纯查询。
   *
   * `forNodeId` 是正在编辑的那个控件: 试算它的新公式时, 引用解析必须**跳过它
   * 自己**当前的计算结果, 否则作者会看到"A 的结果引用了 A 的旧结果"这种鬼值。
   */
  preview(formula: string, forNodeId?: string): CalcResult {
    this.ensure()
    return evaluateFormula(formula, this.contextFor(forNodeId))
  }

  // ---- 重算 ----

  private recompute(): void {
    this.entries.clear()
    const formulaNodes = [...this.plans.keys()]
    if (formulaNodes.length === 0) { this.computedAtValue = null; return }

    // 时钟在**这里**读一次 (§12.12.7), 同一次重算内所有求值共用
    const now = this.deps.now()
    this.computedAtValue = now

    // 拓扑序 (后序 DFS): 依赖先算, 于是 `[A]` 能读到 A 已算好的结果。
    //
    // 分两段是必须的, 不是省事: 可见性指令式在值图上没有出边, 若跟着一起跑 DFS
    // 就可能排在它所读的值公式**之前**, 于是它读到的会是原始值而不是派生值 ——
    // 触发条件因此按旧值判断, 看着像"改了别的字段没反应"。
    const order: string[] = []
    const done = new Set<string>()
    const pushOrder = (id: string): void => {
      if (done.has(id)) return
      done.add(id)
      for (const next of this.adjacency.get(id) ?? []) pushOrder(next)
      order.push(id)
    }
    const nonCyclic = formulaNodes.filter((id) => !this.cyclic.has(id))
    for (const id of nonCyclic) if (!this.plans.get(id)?.isDirective) pushOrder(id)
    // 指令式排在全部值公式之后 —— 它只读值, 读到时值都已就绪
    for (const id of nonCyclic) if (this.plans.get(id)?.isDirective) order.push(id)

    // 环成员: 顺序无定义 → 直接报 cycle, 不求值
    for (const id of this.cyclic) {
      this.entries.set(id, {
        visible: true,
        error: {
          code: 'cycle',
          message: 'formula takes part in a reference cycle — break the cycle to evaluate it',
        },
      })
    }

    // 每条公式**只求值一次**: 结果既用来定 entry, 也用来收集可见性指令。
    // (求两次不只是浪费 —— 会把指令收集两遍, 于是"一条公式一条指令"的守卫
    //  在自己的重算路径上误报。)
    // 来源**在收集时一并带上**: 之后靠"哪个 plan 的 targetRefs 含这个键"反查
    // 会指到第一条匹配的公式, 未必是真源, 于是错误会挂到无辜的控件上。
    const directives: Array<{ from: string; directive: VisibilityDirective }> = []
    for (const id of order) {
      const plan = this.plans.get(id)
      if (!plan) continue
      if (plan.syntaxError) {
        this.entries.set(id, { visible: true, error: plan.syntaxError })
        continue
      }
      if (!plan.ast) continue

      const result = evaluateAst(plan.ast, this.contextFor(id))
      if (!result.ok) {
        this.entries.set(id, { visible: true, error: result.error })
        continue
      }
      if (result.role === 'value') {
        this.entries.set(id, { visible: true, display: String(result.value) })
        continue
      }
      // 可见性公式: 该控件仍显示自己的值/占位符, 不产生 display
      this.entries.set(id, { visible: true })
      directives.push({ from: id, directive: result.directive })
    }

    this.applyDirectives(directives)
  }

  /**
   * 汇总可见性指令 (§12.12.5)。
   *
   * 三条不回退的立场:
   *   - 目标键解析不出来 → 错误记在**写公式的那个节点**上 (是它引用了坏键);
   *   - 目标键撞键 → 同上, 带候选 —— 绝不挑一个来隐藏;
   *   - 两条公式对同一目标给出**矛盾**的可见性 → 该目标报 conflicting_visibility
   *     且保持可见 (fail-open: 悄悄藏掉一个必填项比显示它危险得多)。
   */
  private applyDirectives(
    directives: readonly { from: string; directive: VisibilityDirective }[],
  ): void {
    const byTarget = new Map<string, { visible: boolean; from: string }[]>()
    for (const { from, directive } of directives) {
      const owners = this.deps.nodesFor(directive.key)
      if (owners.length === 0) {
        this.entries.set(from, {
          visible: true,
          error: { code: 'unresolved_reference', message: `SHOW/HIDE target "${directive.key}" matches no control` },
        })
        continue
      }
      if (owners.length > 1) {
        this.entries.set(from, {
          visible: true,
          error: {
            code: 'ambiguous_reference',
            message: `SHOW/HIDE target "${directive.key}" matches ${owners.length} controls`,
            candidateNodeIds: [...owners],
          },
        })
        continue
      }
      const list = byTarget.get(owners[0]) ?? []
      list.push({ visible: directive.visible, from })
      byTarget.set(owners[0], list)
    }

    for (const [target, list] of byTarget) {
      if (new Set(list.map((d) => d.visible)).size > 1) {
        this.entries.set(target, {
          visible: true,
          error: {
            code: 'conflicting_visibility',
            message: `two formulas disagree about this control's visibility: ${list.map((d) => d.from).join(', ')}`,
          },
        })
        continue
      }
      const existing = this.entries.get(target) ?? { visible: true }
      this.entries.set(target, { ...existing, visible: list[0].visible })
    }
  }

  /**
   * 造一个求值上下文。`skipNodeId` 用于试算: 跳过某节点自己已算出的结果,
   * 免得它引用自己的旧结果。
   */
  private contextFor(skipNodeId?: string): CalcContext {
    /**
     * 归一契约 §12.6.1 的**规范空态**: `undefined` / `''` / `[]` 三者都是"没填"。
     * 不归一的话, 一个值为 `''` 的出生日期会以字符串身份进入求值器, 于是
     * `GETAGE('')` 报的是"不是日期"(bad_arguments) 而不是"没填"
     * (empty_reference) —— 作者看到前者会去查格式, 而真正该做的是去补那个字段。
     */
    const normalizedValueOf = (nodeId: string): ControlValue | undefined => {
      const raw = this.deps.valueOf(nodeId)
      return isControlValueEmpty(raw) ? undefined : raw
    }

    return {
      now: this.computedAtValue ?? this.deps.now(),
      functions: this.deps.functions,
      resolveRef: (key: string) => {
        const owners = this.deps.nodesFor(key)
        if (owners.length === 0) {
          return { ok: false, error: { code: 'unresolved_reference', message: `no control has key "${key}"` } }
        }
        if (owners.length > 1) {
          return {
            ok: false,
            error: {
              code: 'ambiguous_reference',
              message: `key "${key}" matches ${owners.length} controls`,
              candidateNodeIds: [...owners],
            },
          }
        }
        const target = owners[0]
        if (target === skipNodeId) {
          // 试算自己: 读原始值(而不是自己算出来的结果), 否则像在照镜子
          return { ok: true, value: normalizedValueOf(target) }
        }
        const computed = this.entries.get(target)
        // 上游算错了 → **原样上抛**, 别把它压成"空" —— 根因会被掩盖成"没填"
        if (computed?.error) return { ok: false, error: computed.error }
        // 链式引用: 上游若有派生值, 读派生值
        if (computed?.display !== undefined) return { ok: true, value: computed.display }
        return { ok: true, value: normalizedValueOf(target) }
      },
    }
  }
}
