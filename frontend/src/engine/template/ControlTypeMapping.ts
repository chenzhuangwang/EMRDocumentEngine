// ================================================================
// ControlTypeMapping — 输入域家族 dataType ↔ controlType 映射 (契约 §12.1/§12.7)
//
// 输入域配置弹框「格式」tab 选数据类型时, 据此给出 controlType 的
// 默认种子 (controlTypeForDataType)。仅用于「作者在向导/配置弹框里建控件时
// 的默认建议」, 不是模型反推 —— 落盘时 controlType 仍显式写入
// TemplateDefinition (VR-15: controlType MUST NOT be inferred from
// dataType; 展示即迁移反模式)。单选/复选侧由 UI 以
// enums.multiple 表达 (multiple===true → checkbox, 否则 radio)。
//
// 归属 engine/template (ControlType 的 canonical home); UI 一律经
// engine/index.ts barrel 从 '@/engine' 导入。不引 platform (§19)。
// ================================================================

import type { ElementFormat } from '../document/core/DocumentModel'
import type { ControlType } from './TemplateDefinition'

/** 输入域家族: dataType → 默认 widget 形态 (S1→input; S2/S3→textarea; N→number; D→date) */
export function controlTypeForDataType(dataType: ElementFormat['dataType']): ControlType {
  switch (dataType) {
    case 'S1': return 'input'
    case 'S2':
    case 'S3': return 'textarea'
    case 'N': return 'number'
    case 'D': return 'date'
  }
}

/** 枚举家族: multiple 是否多选 → controlType (checkbox/radio) */
export function controlTypeForMultiple(multiple: boolean): ControlType {
  return multiple ? 'checkbox' : 'radio'
}
