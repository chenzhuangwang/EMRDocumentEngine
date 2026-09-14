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
  private hooks = {
    commandBefore: [] as Array<(cmd: unknown) => void>,
    commandAfter: [] as Array<(cmd: unknown) => void>,
    beforeSave: [] as Array<(doc: DocumentTree) => DocumentTree>,
    afterLoad: [] as Array<(doc: DocumentTree) => DocumentTree>,
    beforeLayout: [] as Array<(pool: NodePool) => void>,
    afterLayout: [] as Array<(pool: NodePool) => void>,
  }
  private toolbarActions: ToolbarAction[] = []

  /** 注册插件 */
  register(plugin: IPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginManager] 插件 "${plugin.id}" 已注册, 跳过`)
      return
    }

    const ctx = this.createContext()
    plugin.install(ctx)
    this.plugins.set(plugin.id, plugin)
  }

  /** 卸载插件 */
  unregister(pluginId: string): void {
    const plugin = this.plugins.get(pluginId)
    if (plugin) {
      plugin.destroy()
      this.plugins.delete(pluginId)
    }
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
  } {
    return {
      emitCommandBefore: (cmd) => this.hooks.commandBefore.forEach(f => f(cmd)),
      emitCommandAfter: (cmd) => this.hooks.commandAfter.forEach(f => f(cmd)),
      emitBeforeSave: (doc) => this.hooks.beforeSave.reduce((d, f) => f(d), doc),
      emitAfterLoad: (doc) => this.hooks.afterLoad.reduce((d, f) => f(d), doc),
      emitBeforeLayout: (pool) => this.hooks.beforeLayout.forEach(f => f(pool)),
      emitAfterLayout: (pool) => this.hooks.afterLayout.forEach(f => f(pool)),
    }
  }

  /** 获取工具栏扩展 */
  getToolbarActions(): ToolbarAction[] { return [...this.toolbarActions] }

  // ---- 内部 ----

  private createContext(): PluginContext {
    return {
      registerParticle: (_particle) => { /* 由 ParticleRegistry 桥接 */ },
      onCommandBefore: (fn) => this.hooks.commandBefore.push(fn),
      onCommandAfter: (fn) => this.hooks.commandAfter.push(fn),
      onBeforeSave: (fn) => this.hooks.beforeSave.push(fn),
      onAfterLoad: (fn) => this.hooks.afterLoad.push(fn),
      onBeforeLayout: (fn) => this.hooks.beforeLayout.push(fn),
      onAfterLayout: (fn) => this.hooks.afterLayout.push(fn),
      registerToolbarAction: (action) => this.toolbarActions.push(action),
    }
  }
}
