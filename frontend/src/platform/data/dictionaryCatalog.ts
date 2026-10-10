// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// DictionaryCatalog — 外部码表目录 (契约 §12.6.4)
//
// 「码表条目」是候选源的目录记录 (catalog record), 不是节点, 也不是
// 文档内容。ElementFormat.dictionary 只存一个 id 引用; 候选由平台在
// 边界预加载后经 Editor.setDictionaries 同步注入 (VR-7: 引擎不得隐式
// 展开字典)。
//
// 归属: 前端 (platform/data)。引擎不硬编码任何医疗字典 —— 本文件的
// 类型与样例数据仅供 UI、演示与本地联调; 生产环境由平台注入真实码表,
// 替换 DICTIONARY_CATALOG 或改由后端返回即可。
//
// 候选是运行时数据, **不序列化**进 document artifact; 只有 id 引用随
// ElementFormat 原文持久化。inline enums 恒优先于码表 (§12.6.4)。
//
// id 形状: 32 位 hex 字符串 (与 Dictionary.ts 头注一致)。前 8 位沿用
// 国标编号便于人眼识别 (如 22610001 = GB/T 2261.1 性别), 后 24 位为
// 固定填充 —— 本目录的 id 是**合成值**, 生产环境应替换为真实码表主键。
// ================================================================

import type { ElementEnumOption } from '@emrde/document-engine'

/** 码表目录条目 — 描述一个可绑定到 ElementFormat.dictionary 的候选源 */
export interface DictionaryCatalogEntry {
  /** 码表 id (ElementFormat.dictionary 里存的引用) */
  id: string
  /** 展示名称 (UI 下拉用) */
  name: string
  /** 典型数据元编码 (帮助设计者识别用; 不参与解析) */
  dataElement?: string
  /** 候选选项 — 注入后控件即视为枚举, 走 VR-9 严格成员校验 */
  candidates: readonly ElementEnumOption[]
}

/**
 * 内置码表 id 常量。绑定时请引用这些常量, 不要散落字面量。
 */
export const DICTIONARY_ID = {
  /** GB/T 2261.1 性别 */
  GENDER: '22610001a1b2c3d4e5f60718293a4b5c',
  /** GB/T 2261.2 婚姻状况 */
  MARITAL_STATUS: '22610002a1b2c3d4e5f60718293a4b5c',
  /** GB/T 3304 民族 */
  NATION: '33040000a1b2c3d4e5f60718293a4b5c',
  /** GB/T 4658 文化程度 */
  EDUCATION: '46580000a1b2c3d4e5f60718293a4b5c',
  /** ABO 血型 */
  ABO_BLOOD: 'ab000000a1b2c3d4e5f60718293a4b5c',
  /** Rh 血型 */
  RH_BLOOD: '2b000000a1b2c3d4e5f60718293a4b5c',
  /** 入院病情 */
  ADMISSION_STATE: 'ad000000a1b2c3d4e5f60718293a4b5c',
  /** 离院方式 */
  DISCHARGE_MODE: 'dc000000a1b2c3d4e5f60718293a4b5c',
  /** 疼痛程度分级 (带 numericValue, 供只读评分汇总消费 — 契约 §12.6.2 layer E) */
  PAIN_SCALE: '9a000000a1b2c3d4e5f60718293a4b5c',
} as const

/** 样例码表目录 (供 UI/演示/联调; 生产由平台注入) */
export const DICTIONARY_CATALOG: readonly DictionaryCatalogEntry[] = [
  {
    id: DICTIONARY_ID.GENDER,
    name: '性别 (GB/T 2261.1)',
    dataElement: 'DE02.01.040.00',
    candidates: [
      { name: '男', value: '1' },
      { name: '女', value: '2' },
      { name: '未知的性别', value: '0' },
      { name: '未说明的性别', value: '9' },
    ],
  },
  {
    id: DICTIONARY_ID.MARITAL_STATUS,
    name: '婚姻状况 (GB/T 2261.2)',
    dataElement: 'DE02.01.018.00',
    candidates: [
      { name: '未婚', value: '10' },
      { name: '已婚', value: '20' },
      { name: '丧偶', value: '30' },
      { name: '离婚', value: '40' },
      { name: '未说明的婚姻状况', value: '90' },
    ],
  },
  {
    id: DICTIONARY_ID.NATION,
    name: '民族 (GB/T 3304)',
    dataElement: 'DE02.01.035.00',
    candidates: [
      { name: '汉族', value: '01' },
      { name: '蒙古族', value: '02' },
      { name: '回族', value: '03' },
      { name: '藏族', value: '04' },
      { name: '维吾尔族', value: '05' },
      { name: '苗族', value: '06' },
      { name: '彝族', value: '07' },
      { name: '壮族', value: '08' },
    ],
  },
  {
    id: DICTIONARY_ID.EDUCATION,
    name: '文化程度 (GB/T 4658)',
    dataElement: 'DE02.01.041.00',
    candidates: [
      { name: '研究生', value: '10' },
      { name: '大学本科', value: '20' },
      { name: '大学专科和专科学校', value: '30' },
      { name: '中等专业学校', value: '40' },
      { name: '技工学校', value: '50' },
      { name: '高中', value: '60' },
      { name: '初中', value: '70' },
      { name: '小学', value: '80' },
      { name: '文盲或半文盲', value: '90' },
      { name: '其他', value: '99' },
    ],
  },
  {
    id: DICTIONARY_ID.ABO_BLOOD,
    name: 'ABO 血型',
    dataElement: 'DE04.50.001.00',
    candidates: [
      { name: 'A 型', value: '1' },
      { name: 'B 型', value: '2' },
      { name: 'O 型', value: '3' },
      { name: 'AB 型', value: '4' },
      { name: '不详', value: '9' },
    ],
  },
  {
    id: DICTIONARY_ID.RH_BLOOD,
    name: 'Rh 血型',
    dataElement: 'DE04.50.002.00',
    candidates: [
      { name: '阴性', value: '1' },
      { name: '阳性', value: '2' },
      { name: '不详', value: '9' },
    ],
  },
  {
    id: DICTIONARY_ID.ADMISSION_STATE,
    name: '入院病情',
    dataElement: 'DE05.10.174.00',
    candidates: [
      { name: '有', value: '1' },
      { name: '临床未确定', value: '2' },
      { name: '情况不明', value: '3' },
      { name: '无', value: '4' },
    ],
  },
  {
    id: DICTIONARY_ID.DISCHARGE_MODE,
    name: '离院方式',
    dataElement: 'DE06.00.234.00',
    candidates: [
      { name: '医嘱离院', value: '1' },
      { name: '医嘱转院', value: '2' },
      { name: '医嘱转社区', value: '3' },
      { name: '非医嘱离院', value: '4' },
      { name: '死亡', value: '5' },
      { name: '其他', value: '9' },
    ],
  },
  {
    // numericValue 示例: 选项携带代表分值 —— 只读派生语义 (契约 §12.6.2
    // layer E), 由 ControlScorer 汇总, 绝不进入值边界 (layer A/B)。
    id: DICTIONARY_ID.PAIN_SCALE,
    name: '疼痛程度分级 (NRS)',
    dataElement: 'DE04.01.132.00',
    candidates: [
      { name: '无痛 (0 分)', value: '0', numericValue: 0 },
      { name: '轻度疼痛 (1-3 分)', value: '1', numericValue: 2 },
      { name: '中度疼痛 (4-6 分)', value: '2', numericValue: 5 },
      { name: '重度疼痛 (7-10 分)', value: '3', numericValue: 8 },
    ],
  },
]

/** 按 id 查目录条目 (UI 展示名称用; 解析候选走 DictionaryStore.resolve) */
export function dictionaryEntryById(id: string): DictionaryCatalogEntry | undefined {
  return DICTIONARY_CATALOG.find((e) => e.id === id)
}

/** 目录内全部码表 id */
export function dictionaryIds(): string[] {
  return DICTIONARY_CATALOG.map((e) => e.id)
}
