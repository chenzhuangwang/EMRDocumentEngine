// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// ================================================================
// ContainerChildTypes — 「哪个容器允许哪些子节点」的唯一事实源
// (契约 §31.13)
//
// 为什么需要单列一个模块: 在这条规则被声明之前, 每个消费者各猜一套, 而且
// 猜得互不相同 ——
//
//   layoutCellItems        cell 里只有段落 (非段落静默跳过, 连 else 都没有)
//   flattenTextContainers  cell 子节点**无条件** push 进段落流
//   documentExport         cell 里有嵌套表 (专门写了 isTableNode 分支)
//   sectionsOf             Section 只可能在 body / Section 下 (不下潜表格)
//
// 结果是同一个格内 Section 让三个遍历器给出三种互相矛盾的答案 (契约 §31.13
// 开头记录了这个实测缺陷)。把规则收在这里, 三处边界 (NodePool / Loader /
// Importer) 与各遍历器都从这里读, 而不是各留一份私有副本 (§11)。
//
// 契约 §31.13 的表格即本文件的 CHILD_TYPES_OF; 改表格 = 改契约, 二者必须同步。
// ================================================================
import { NodeType } from './DocumentModel'
import { locale } from '../../i18n/index'

/** 非法容器-子节点对 —— 由 NodePool / Loader / Importer 三处边界抛出 */
export class ContainerChildTypeError extends Error {
  constructor(
    readonly parentType: string,
    readonly childType: string,
    readonly parentId: string,
    readonly childId: string,
  ) {
    // 开发者可见的不变量诊断 (与 BodySpineError / NodePool 的 addNode 报错同构),
    // 不是用户可见文案 —— 故不走 i18n。落盘文档触发的拒绝在 Loader 侧另有
    // 用户可读的 LoadError 文案 (loader.illegalChildType)。
    super(
      `illegal child type: ${childType} (node ${childId}) ` +
      `may not live in ${parentType} (node ${parentId})`,
    )
    this.name = 'ContainerChildTypeError'
  }
}

/** 块级内容 —— body / Section 的共同子集 */
const BLOCK_CONTENT: readonly string[] = [
  NodeType.PARAGRAPH, NodeType.TABLE, NodeType.IMAGE, NodeType.SEPARATOR,
]

/**
 * 契约 §31.13 的容器子类型表 —— **逐条对应契约里的那张表**, 改这里等于改契约。
 *
 * 关键字义:
 *   - `document` / `section` 的表**含 section 自身** —— Section 可嵌 Section
 *     (SectionChild = BlockNode | Section)。其余容器一律不行, 这正是修掉
 *     「格内 Section」的那一条。
 *   - `document` 比 `section` 多一个 SECTION_BREAK: 分节符是 body 级分页边界,
 *     禁止进入 Section.children (契约 §31.10)。
 *   - `cell` 含 table: 嵌套表**合法** (真实生产模板里就有; documentExport 早已是
 *     正确的参考实现)。
 *   - `footnote_content` 在此声明但**当前无边界强制执行它** —— 脚注/尾注不在
 *     加载器的校验根列表里 (DocumentLoader.validatedRootIds 沿用既有行为),
 *     NodePool 侧也无人经受控 API 改它的 children (InsertFootnoteCommand 是直接
 *     赋值)。留在这里是因为它是真契约, 而不是因为已被守住; 未来说的"这张表 = 已
 *     强制的集合"在它身上尚不成立。
 */
export const CHILD_TYPES_OF: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [NodeType.DOCUMENT, new Set<string>([...BLOCK_CONTENT, NodeType.SECTION_BREAK, NodeType.SECTION])],
  [NodeType.SECTION, new Set<string>([...BLOCK_CONTENT, NodeType.SECTION])],
  [NodeType.TABLE, new Set<string>([NodeType.ROW])],
  [NodeType.ROW, new Set<string>([NodeType.CELL])],
  [NodeType.CELL, new Set<string>([NodeType.PARAGRAPH, NodeType.TABLE])],
  [NodeType.FOOTNOTE_CONTENT, new Set<string>([NodeType.PARAGRAPH])],
])

/**
 * 段落的合法内联子类型 —— **本轮只记录, 不强制** (契约 §31.13 的 deferred 项)。
 *
 * 刻意不放进 CHILD_TYPES_OF: 那张表是「已被三处边界强制」的集合, 混进一条
 * 不强制的东西会让下一个读者以为它已被守住。内联集合需要先做一次独立清点
 * (光仓库里就能看到 text / smarttext / image / field / bookmark /
 * cross_reference / footnote_ref / comment_marker), 且爆炸半径比 cell 规则大
 * 得多 —— 单独一轮做。
 */
export const DEFERRED_INLINE_CHILD_TYPES: ReadonlySet<string> = new Set<string>([
  NodeType.TEXT, NodeType.SMART_TEXT, NodeType.IMAGE, NodeType.FIELD,
  NodeType.BOOKMARK, NodeType.CROSS_REFERENCE, NodeType.FOOTNOTE_REF,
  NodeType.COMMENT_MARKER,
])

/**
 * 文档级数组 (页眉/页脚全部变体) 的子类型 —— 只允许段落。
 *
 * 它们不在 CHILD_TYPES_OF 里, 因为它们**不经 NodePool** (是 DocumentTree 上的
 * string[] 字段, 契约 §6.2 的域划分); 由 Loader 与 Importer 两处直接校验。
 * 用 DOCUMENT 之外的独立键表达, 使 "hf 规则" 与 "body 规则" 无法被混用 ——
 * 二者此前正是被拼在同一个数组里一起校验的 (validateDocument 的
 * validatedRootIds), 那正是不一致猜法的来源之一。
 */
export const HEADER_FOOTER_CHILD_TYPES: ReadonlySet<string> = new Set<string>([NodeType.PARAGRAPH])

/** 该父类型是否有已知的子类型契约 (未知父类型 = 不在此处判, 由别处拦) */
export function hasChildTypeContract(parentType: string): boolean {
  return CHILD_TYPES_OF.has(parentType)
}

/**
 * 取容器契约, **缺失即抛** —— 与 `isLegalChild` 的"无契约即放行"是刻意的两种
 * 语义, 不要互相替换:
 *
 *   isLegalChild  用于**判定某个子节点**。契约未声明这一层 (如 paragraph 的内联
 *                 类型, 本轮 deferred) 时不越权判定, 故返回 true。
 *   childTypesOf  用于**消费整张表**的地方 (遍历器要一份"这个容器的合法子集")。
 *                 此时缺契约是调用方问错了容器 —— 是编程错误, 不是数据问题。
 */
export function childTypesOf(parentType: string): ReadonlySet<string> {
  const allowed = CHILD_TYPES_OF.get(parentType)
  if (!allowed) {
    // 开发者可见的不变量诊断 (与 BodySpineError / NodePool 报错同构), 不是用户
    // 可见文案 —— 故走英文常量, 与那两个保持一致的形态 (I18nGate 的 EXEMPT 判据
    // 即"中文在这里是不是内容")。
    throw new Error(
      `ContainerChildTypes.childTypesOf: no child-type contract declared for ${parentType}`,
    )
  }
  return allowed
}

/** 容器-子节点对是否合法。父类型无契约时返回 true (不越权判定) */
export function isLegalChild(parentType: string, childType: string): boolean {
  const allowed = CHILD_TYPES_OF.get(parentType)
  if (!allowed) return true
  return allowed.has(childType)
}

/** 合法则静默返回, 非法抛 ContainerChildTypeError */
export function assertLegalChild(
  parentType: string,
  childType: string,
  parentId: string,
  childId: string,
): void {
  if (!isLegalChild(parentType, childType)) {
    throw new ContainerChildTypeError(parentType, childType, parentId, childId)
  }
}

/** 用户可读的非法子类型消息 (Loader 的 LoadError 文案用) */
export function illegalChildTypeMessage(parentType: string, childType: string): string {
  return locale.t('loader.illegalChildType', { parent: parentType, child: childType })
}
