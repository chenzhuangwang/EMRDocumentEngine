// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// Dictionary — 外部字典候选源 (契约 §12.6 VR-7, §12.6.4)
//
// format.dictionary 是「外部字典引用」(32 位 hex UUID 字符串), 不在
// 引擎内隐式展开。展开走 canonical DictionaryProvider —— 平台/UI 在
// 边界异步拉取候选后, 以同步 store 注入 (引擎值写入路径纯同步, §27)。
//
// 语义:
//   - resolve(id) → readonly ElementEnumOption[] | undefined:
//     undefined = 未加载/未知 = 不展开, 控件退回自由文本 (无 VR-9)。
//   - 解析出候选 → 控件视为枚举 (单选 string, 严格成员校验)。
//   - inline enums 优先于 dictionary (二者同时存在时取 inline)。
//
// 候选是运行时数据, 不序列化进 document artifact; 只有 dictionary
// 引用本身随 ElementFormat 原文持久化。
// ================================================================

import type { ElementEnumOption } from '../core/DocumentModel'

/**
 * 外部字典候选源 (契约 §12.6.4)。同步解析 —— 候选由平台在边界
 * 预加载, 引擎命令路径只做同步查找。
 */
export interface DictionaryProvider {
  /** 解析字典引用 → 候选选项; 未加载/未知返回 undefined (视为不展开) */
  resolve(dictionaryId: string): readonly ElementEnumOption[] | undefined
}

/**
 * DictionaryStore — 外部字典候选的类型化容器 (镜像 TemplateDefinitionStore)。
 * 实例级状态, 按字典 id 关联, 与节点/NodePool 解耦。
 */
export class DictionaryStore implements DictionaryProvider {
  private readonly map = new Map<string, readonly ElementEnumOption[]>()

  /** 读取某字典的候选 (无则 undefined) */
  get(dictionaryId: string): readonly ElementEnumOption[] | undefined {
    return this.map.get(dictionaryId)
  }

  /** 是否存在某字典 */
  has(dictionaryId: string): boolean {
    return this.map.has(dictionaryId)
  }

  /** 写入 (覆盖) 某字典的候选 */
  set(dictionaryId: string, candidates: readonly ElementEnumOption[]): void {
    this.map.set(dictionaryId, candidates)
  }

  /** 删除某字典, 返回是否确实删除 */
  delete(dictionaryId: string): boolean {
    return this.map.delete(dictionaryId)
  }

  /** 清空全部字典 */
  clear(): void {
    this.map.clear()
  }

  /** 已加载的字典数 */
  get size(): number {
    return this.map.size
  }

  /** 遍历 [dictionaryId, candidates] 对 */
  entries(): IterableIterator<[string, readonly ElementEnumOption[]]> {
    return this.map.entries()
  }

  /** 遍历全部字典 id */
  keys(): IterableIterator<string> {
    return this.map.keys()
  }

  /** 遍历全部候选 */
  values(): IterableIterator<readonly ElementEnumOption[]> {
    return this.map.values()
  }

  /** 实现 DictionaryProvider.resolve */
  resolve(dictionaryId: string): readonly ElementEnumOption[] | undefined {
    return this.map.get(dictionaryId)
  }
}
