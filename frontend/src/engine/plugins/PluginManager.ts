// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Plugin System — 插件系统框架 (R61, v6.0)
//
// IPlugin + PluginManager + PluginContext
// 8 类扩展点, 架构 TASK-631-633
// ============================================================

import type { DocumentTree } from '../document/core/DocumentModel'
import type { NodePool } from '../document/core/NodePool'
import type { IParticle } from '../render/particles/IParticle'
import type { CursorState } from '../state/EditorRuntimeState'

// ---- 插件生命周期 ----

export interface IPlugin {
  /** 插件唯一标识 */
  readonly id: string
  /** 插件名称 */
  readonly name: string
  /** 版本 */
  readonly version: string

  /** 安装 (注册扩展点/初始化资源) */
  install(context: PluginContext): void
  /** 启用 */
  enable(): void
  /** 禁用 (保留已注册扩展, 不响应) */
  disable(): void
  /** 销毁 (清理所有资源) */
  destroy(): void

  /** 是否已启用 */
  readonly enabled: boolean
}

// ---- 扩展点类型 ----

export type ExtensionPoint =
  | 'render.particle'       // 注册自定义 IParticle
  | 'command.before'        // 命令执行前
  | 'command.after'         // 命令执行后
  | 'document.beforeSave'   // 文档保存前
  | 'document.afterLoad'    // 文档加载后
  | 'layout.beforeLayout'   // 布局计算前
  | 'layout.afterLayout'    // 布局计算后
  | 'cursor.moved'          // 光标移动 (观察)
  | 'scale.changed'         // 缩放变更 (观察)
  | 'toolbar.action'        // 自定义工具栏按钮

// ---- 插件上下文 ----

export interface PluginContext {
  /** 注册自定义粒子渲染器 */
  registerParticle(particle: IParticle): void
  /** 注册命令钩子 */
  onCommandBefore(fn: (cmd: unknown) => void): void
  onCommandAfter(fn: (cmd: unknown) => void): void
  /** 注册文档钩子 */
  onBeforeSave(fn: (doc: DocumentTree) => DocumentTree): void
  onAfterLoad(fn: (doc: DocumentTree) => DocumentTree): void
  /** 注册布局钩子 */
  onBeforeLayout(fn: (pool: NodePool) => void): void
  onAfterLayout(fn: (pool: NodePool) => void): void
  /**
   * 观察光标移动。
   *
   * 这是插件**唯一**能拿到光标/缩放的途径: PluginContext 不暴露 EventBus,
   * 也拿不到 EditorStore (那是 UI 的读取投影)。此前插件只能挂命令/文档/布局
   * 六种钩子, 对"用户把光标挪到哪了"完全无感。
   */
  onCursorMoved(fn: (cursor: CursorState) => void): void
  /** 观察缩放变更 */
  onScaleChanged(fn: (scale: number) => void): void
  /** 注册工具栏按钮 */
  registerToolbarAction(action: ToolbarAction): void
}

export interface ToolbarAction {
  id: string
  label: string
  icon: string // icon name for lookup
  group?: string
  onClick: () => void
}

// ---- 插件管理器 ----

export class PluginManager {
  private plugins = new Map<string, IPlugin>()
  /**
   * 粒子注册桥 —— 插件经 PluginContext.registerParticle 注册的自定义粒子
   * 要落到渲染层 (ParticleRegistry)。此前该回调是空实现 (注释写"由
   * ParticleRegistry 桥接"但没有任何人桥), 插件注册的粒子全部丢失。
   * 由 Editor 在构造时注入, 免得 plugins/ 反向依赖 render/。
   */
  private readonly bridgeParticle: ((particle: IParticle) => void) | undefined

  constructor(bridgeParticle?: (particle: IParticle) => void) {
    this.bridgeParticle = bridgeParticle
  }

  /**
   * 钩子注册项都带 owner。
   *
   * 带 owner 是为了修两个此前**契约说了没做到**的地方:
   * - `disable()` 注释写「保留已注册扩展, 不响应」—— 但派发时从不看 enabled,
   *   禁用的插件照样收钩子;
   * - `unregister()` 只从 plugins 表里删, 已注册的钩子/工具栏按钮**留着**,
   *   插件 destroy 之后仍在响应。
   * 两者在"只有一个常驻 demo 插件"时都是潜伏的, 加观察钩子就会浮上来
   * (禁用的插件还在收光标事件)。
   */
  private hooks = {
    commandBefore: [] as HookEntry<(cmd: unknown) => void>[],
    commandAfter: [] as HookEntry<(cmd: unknown) => void>[],
    beforeSave: [] as HookEntry<(doc: DocumentTree) => DocumentTree>[],
    afterLoad: [] as HookEntry<(doc: DocumentTree) => DocumentTree>[],
    beforeLayout: [] as HookEntry<(pool: NodePool) => void>[],
    afterLayout: [] as HookEntry<(pool: NodePool) => void>[],
    cursorMoved: [] as HookEntry<(cursor: CursorState) => void>[],
    scaleChanged: [] as HookEntry<(scale: number) => void>[],
  }
  private toolbarActions: HookEntry<ToolbarAction>[] = []

  /** 该 owner 的插件是否处于启用态 (未注册视为不活跃) */
  private isActive(owner: string): boolean {
    return this.plugins.get(owner)?.enabled !== false
  }

  /** 活跃钩子的 fn 列表 */
  private active<T>(entries: HookEntry<T>[]): T[] {
    return entries.filter(e => this.isActive(e.owner)).map(e => e.fn)
  }

  /** 摘掉某插件的全部注册 (unregister / destroy 时调用) */
  private dropOwner(owner: string): void {
    for (const key of Object.keys(this.hooks) as (keyof typeof this.hooks)[]) {
      const arr = this.hooks[key] as HookEntry<unknown>[]
      this.hooks[key] = arr.filter(e => e.owner !== owner) as never
    }
    this.toolbarActions = this.toolbarActions.filter(e => e.owner !== owner)
  }

  /** 注册插件 (install → enable)。注册后即生效 —— 生命周期不再停在第 1 步。 */
  register(plugin: IPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginManager] 插件 "${plugin.id}" 已注册, 跳过`)
      return
    }

    const ctx = this.createContext(plugin.id)
    plugin.install(ctx)
    this.plugins.set(plugin.id, plugin)
    plugin.enable()
  }

  /** 卸载插件 (disable → destroy), 并摘掉它的全部注册 */
  unregister(pluginId: string): void {
    const plugin = this.plugins.get(pluginId)
    if (plugin) {
      plugin.disable()
      plugin.destroy()
      this.plugins.delete(pluginId)
    }
    this.dropOwner(pluginId)
  }

  /** 获取已注册插件列表 */
  getPlugins(): IPlugin[] { return [...this.plugins.values()] }

  /** 触发钩子 */
  getHook(): {
    emitCommandBefore(cmd: unknown): void
    emitCommandAfter(cmd: unknown): void
    emitBeforeSave(doc: DocumentTree): DocumentTree
    emitAfterLoad(doc: DocumentTree): DocumentTree
    emitBeforeLayout(pool: NodePool): void
    emitAfterLayout(pool: NodePool): void
    emitCursorMoved(cursor: CursorState): void
    emitScaleChanged(scale: number): void
  } {
    return {
      emitCommandBefore: (cmd) => this.active(this.hooks.commandBefore).forEach(f => f(cmd)),
      emitCommandAfter: (cmd) => this.active(this.hooks.commandAfter).forEach(f => f(cmd)),
      emitBeforeSave: (doc) => this.active(this.hooks.beforeSave).reduce((d, f) => f(d), doc),
      emitAfterLoad: (doc) => this.active(this.hooks.afterLoad).reduce((d, f) => f(d), doc),
      emitBeforeLayout: (pool) => this.active(this.hooks.beforeLayout).forEach(f => f(pool)),
      emitAfterLayout: (pool) => this.active(this.hooks.afterLayout).forEach(f => f(pool)),
      emitCursorMoved: (cursor) => this.active(this.hooks.cursorMoved).forEach(f => f(cursor)),
      emitScaleChanged: (scale) => this.active(this.hooks.scaleChanged).forEach(f => f(scale)),
    }
  }

  /** 获取工具栏扩展 */
  getToolbarActions(): ToolbarAction[] {
    return this.active(this.toolbarActions)
  }

  // ---- 内部 ----

  private createContext(owner: string): PluginContext {
    return {
      registerParticle: (particle) => { this.bridgeParticle?.(particle) },
      onCommandBefore: (fn) => { this.hooks.commandBefore.push({ fn, owner }) },
      onCommandAfter: (fn) => { this.hooks.commandAfter.push({ fn, owner }) },
      onBeforeSave: (fn) => { this.hooks.beforeSave.push({ fn, owner }) },
      onAfterLoad: (fn) => { this.hooks.afterLoad.push({ fn, owner }) },
      onBeforeLayout: (fn) => { this.hooks.beforeLayout.push({ fn, owner }) },
      onAfterLayout: (fn) => { this.hooks.afterLayout.push({ fn, owner }) },
      onCursorMoved: (fn) => { this.hooks.cursorMoved.push({ fn, owner }) },
      onScaleChanged: (fn) => { this.hooks.scaleChanged.push({ fn, owner }) },
      registerToolbarAction: (action) => { this.toolbarActions.push({ fn: action, owner }) },
    }
  }
}

/** 带 owner 的注册项 —— 用于按插件启停/卸载过滤 */
interface HookEntry<T> {
  fn: T
  owner: string
}
