// ================================================================
// ControlLibrary — 设计态控件库目录 (契约 §12.4)
//
// 「控件库条目」是描述医疗数据元的目录记录 (catalog record), 不是节点:
//   element     → 语义身份 (真实 dataElement 编码 + 名称 + 数据类型)
//   definition  → 设计期默认属性 (label/tips/deletable/editable/single)
//
// 归属: 前端 (platform/data), 引擎不得硬编码医疗字典。引擎只暴露
//   Editor.insertControl(element, definition?) 单一插入 API (§12.4)。
// 本文件的类型 + 样例数据仅供 UI 设计态控件库面板消费; 生产环境由
// 平台注入真实目录, 替换 CONTROL_LIBRARY 即可。
// ================================================================

import type { ElementMeta } from '@/engine/document/core/DocumentModel'
import type { TemplateDefinition } from '@/engine/template/TemplateDefinition'

/** 控件库目录条目 — 描述一个可插入的医疗数据元 */
export interface ControlLibraryEntry {
  /** 目录内唯一 id (非节点 id) */
  id: string
  /** 展示名称 */
  name: string
  /** 分类 (UI 分组用) */
  category: string
  /** 语义身份 (真实 dataElement 编码, 插入时落 SmartTextNode.element) */
  element: ElementMeta
  /** 设计期默认属性 (插入时落 TemplateDefinitionStore, 契约 §12.1) */
  definition?: TemplateDefinition
}

/** 样例控件库 (供设计态面板使用; 生产由平台注入) */
export const CONTROL_LIBRARY: ControlLibraryEntry[] = [
  // ---- 基本信息 (single 唯一性字段) ----
  {
    id: 'patient_name',
    name: '患者姓名',
    category: '基本信息',
    element: { code: { internal: 'CTL_PATIENT_NAME', dataElement: 'DE02.01.039.00' }, name: '患者姓名', format: { dataType: 'S1' } },
    definition: { label: '姓名：', tips: '患者姓名', deletable: true, editable: true, single: true },
  },
  {
    id: 'patient_gender',
    name: '性别',
    category: '基本信息',
    element: { code: { internal: 'CTL_GENDER', dataElement: 'DE02.01.040.00' }, name: '性别', format: { dataType: 'S1' } },
    definition: { label: '性别：', tips: '患者性别', deletable: true, editable: true, single: true },
  },
  {
    id: 'patient_birth_date',
    name: '出生日期',
    category: '基本信息',
    element: { code: { internal: 'CTL_BIRTH_DATE', dataElement: 'DE02.01.005.00' }, name: '出生日期', format: { dataType: 'D' } },
    definition: { label: '出生日期：', tips: '患者出生日期', deletable: true, editable: true, single: true },
  },
  {
    id: 'patient_age',
    name: '年龄',
    category: '基本信息',
    element: { code: { internal: 'CTL_AGE', dataElement: 'DE02.01.006.00' }, name: '年龄', format: { dataType: 'N' } },
    definition: { label: '年龄：', tips: '患者年龄', deletable: true, editable: true, single: true },
  },
  {
    id: 'patient_id_card',
    name: '身份证号',
    category: '基本信息',
    element: { code: { internal: 'CTL_ID_CARD', dataElement: 'DE02.01.030.00' }, name: '身份证号', format: { dataType: 'S1' } },
    definition: { label: '身份证号：', tips: '患者身份证号', deletable: true, editable: true, single: true },
  },
  {
    id: 'patient_phone',
    name: '联系电话',
    category: '基本信息',
    element: { code: { internal: 'CTL_PHONE', dataElement: 'DE02.01.010.00' }, name: '联系电话', format: { dataType: 'S1' } },
    definition: { label: '联系电话：', tips: '患者联系电话', deletable: true, editable: true },
  },

  // ---- 病史信息 (S2 多行文本) ----
  {
    id: 'chief_complaint',
    name: '主诉',
    category: '病史信息',
    element: { code: { internal: 'CTL_CHIEF_COMPLAINT', dataElement: 'DE04.01.119.00' }, name: '主诉', format: { dataType: 'S2' } },
    definition: { label: '主诉：', tips: '患者主诉', deletable: true, editable: true, single: true },
  },
  {
    id: 'present_illness',
    name: '现病史',
    category: '病史信息',
    element: { code: { internal: 'CTL_PRESENT_ILLNESS', dataElement: 'DE05.10.148.00' }, name: '现病史', format: { dataType: 'S2' } },
    definition: { label: '现病史：', tips: '患者现病史', deletable: true, editable: true },
  },
  {
    id: 'past_history',
    name: '既往史',
    category: '病史信息',
    element: { code: { internal: 'CTL_PAST_HISTORY', dataElement: 'DE02.10.026.00' }, name: '既往史', format: { dataType: 'S2' } },
    definition: { label: '既往史：', tips: '患者既往史', deletable: true, editable: true },
  },
]

// ================================================================
// 通用控件 widget 目录 (契约 §12.4 补充)
//
// 与 CONTROL_LIBRARY (医疗数据元) 不同: 这是「通用控件形态」目录 —— 不
// 绑定真实医疗编码 (synthetic dataElement DE99.99.00X), 只描述控件的
// widget 形态 (controlType) + 取值类型 (dataType) + 枚举多选语义 (enums)。
//
// 关键区分 (契约 §12.1):
//   - select 与 radio 同为 S1 + 单选枚举, 仅 controlType 不同。
//   - checkbox 是 S1 + 多选枚举 (enums.multiple === true)。
//   - number 是 N + showType 'N' (纯数字形态)。
// dataType/showType/controlType 三者正交, 互不推导。
// ================================================================

/** 通用控件 widget 目录 — id 即 Toolbar 的 type (catalog key, 非节点 id) */
export const CONTROL_WIDGETS: ControlLibraryEntry[] = [
  {
    id: 'input',
    name: '单行文本',
    category: '通用控件',
    element: { code: { internal: 'CTL_INPUT', dataElement: 'DE99.99.001' }, name: '文本输入', format: { dataType: 'S1' } },
    definition: { controlType: 'input', label: '文本输入：', tips: '单行文本输入', deletable: true, editable: true },
  },
  {
    id: 'textarea',
    name: '多行文本',
    category: '通用控件',
    element: { code: { internal: 'CTL_TEXTAREA', dataElement: 'DE99.99.002' }, name: '文本域', format: { dataType: 'S2' } },
    definition: { controlType: 'textarea', label: '文本域：', tips: '多行文本输入', deletable: true, editable: true },
  },
  {
    id: 'number',
    name: '数字输入',
    category: '通用控件',
    element: { code: { internal: 'CTL_NUMBER', dataElement: 'DE99.99.003' }, name: '数字输入', format: { dataType: 'N', showType: 'N' } },
    definition: { controlType: 'number', label: '数字输入：', tips: '数字输入', deletable: true, editable: true },
  },
  {
    id: 'select',
    name: '下拉选择',
    category: '通用控件',
    element: { code: { internal: 'CTL_SELECT', dataElement: 'DE99.99.004' }, name: '下拉选择', format: { dataType: 'S1', enums: { data: [] } } },
    definition: { controlType: 'select', label: '下拉选择：', tips: '下拉单选', deletable: true, editable: true },
  },
  {
    id: 'date',
    name: '日期选择',
    category: '通用控件',
    element: { code: { internal: 'CTL_DATE', dataElement: 'DE99.99.005' }, name: '日期选择', format: { dataType: 'D' } },
    definition: { controlType: 'date', label: '日期选择：', tips: '日期选择', deletable: true, editable: true },
  },
  {
    id: 'checkbox',
    name: '复选框',
    category: '通用控件',
    element: { code: { internal: 'CTL_CHECKBOX', dataElement: 'DE99.99.006' }, name: '复选框', format: { dataType: 'S1', enums: { multiple: true, data: [] } } },
    definition: { controlType: 'checkbox', label: '复选框：', tips: '复选框 (多选)', deletable: true, editable: true },
  },
  {
    id: 'radio',
    name: '单选框',
    category: '通用控件',
    element: { code: { internal: 'CTL_RADIO', dataElement: 'DE99.99.007' }, name: '单选框', format: { dataType: 'S1', enums: { data: [] } } },
    definition: { controlType: 'radio', label: '单选框：', tips: '单选框 (单选)', deletable: true, editable: true },
  },
]

/** 按 id 查找通用控件 widget 条目 (Toolbar 的 type → 定义来源) */
export function controlWidgetById(id: string): ControlLibraryEntry | undefined {
  return CONTROL_WIDGETS.find(w => w.id === id)
}
