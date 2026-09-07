// ============================================================
// ControlValue — 运行时控件值的规范类型 + 校验 (契约 §12.6)
//
// 纯函数, 无 pool / host / React 依赖 (§27–§29)。位于 document 域:
// document/control/ 不依赖 template/ 特征层 —— 写权限 (editable) 由命令层
// 从 TemplateDefinitionStore 解出后作为 ControlValuePermissions 注入,
// 避免 core → feature 依赖倒挂 (§12 / §19)。
//
// 分层 (契约 §12.6.2):
//   A 值类型/值域校验 (本文件)  dataType / enums / multiple / editable /
//                              scale / minLength / maxLength
//   B 写权限 (命令层)          TemplateDefinition.editable / ElementMeta.readonly
//   C 完整性校验 (后续)        required (不在本文件)
//   D 表现/查找/高级 (后续)    showType / minRows / dictionary / searchable / exclusive
// ============================================================

import type { ControlValue, ElementEnumOption, ElementMeta } from '../core/DocumentModel'

/** 写权限 (契约 §12.6.3 layer B) — 仅校验所需的 TemplateDefinition.editable */
export interface ControlValuePermissions {
  editable?: boolean
}

/** 校验拒绝原因 (契约 §12.6.3) */
export type ControlValueRejectReason =
  | 'write_locked'                // VR-8: editable===false || readonly===true
  | 'type_mismatch'               // 值形态 ≠ dataType/enums 期望
  | 'enum_value_not_allowed'      // VR-9: 非声明候选
  | 'number_scale_exceeded'       // VR-10: 精度 > scale (拒绝, 不四舍五入)
  | 'string_length_out_of_range'  // VR-11: minLength/maxLength 越界 (拒绝, 不截断)
  | 'date_format_invalid'         // D 非 YYYY-MM-DD

/** 校验结果: ok → 归一化后的规范值 (undefined = 清空); 否则拒绝 */
export type ControlValueValidationResult =
  | { ok: true; value: ControlValue | undefined }
  | { ok: false; reason: ControlValueRejectReason }

/** D 规范形 YYYY-MM-DD (格式校验; 日历有效性是后续完整性校验的独立关注点) */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 是否为空/未填 (契约 §12.6.1 规范空态): undefined / '' / []。
 * 接受 unknown —— number 0 / 非空 string[] 等非空值返回 false。
 * 供 validateControlValue、QCEngine、粘贴重建、importer 共用同一空态判据。
 */
export function isControlValueEmpty(value: unknown): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

/**
 * 校验并归一化一个候选运行时值 (契约 §12.6.3)。
 *
 * nextValue 为 unknown: 命令边界不可信调用方静态类型, 由本函数做运行时校验。
 * undefined = 清空 (对非写锁控件永远合法)。permissions 由命令层注入。
 */
export function validateControlValue(
  nextValue: unknown,
  element: ElementMeta,
  permissions?: ControlValuePermissions,
): ControlValueValidationResult {
  // 1. 写锁 (VR-8): 只读控件拒绝任何写入, 含清空
  if (permissions?.editable === false || element.readonly === true) {
    return { ok: false, reason: 'write_locked' }
  }

  // 2. 空值归一 (VR-2/VR-13): undefined / '' / [] 归为未填
  if (isControlValueEmpty(nextValue)) return { ok: true, value: undefined }

  const format = element.format
  const dataType = format?.dataType
  const enums = format?.enums

  // 3. 派生期望类型 (VR-5/VR-6): 枚举控件 iff enums 存在 (data 空/缺失仍是枚举控件)
  let expected: 'number' | 'string' | 'string[]'
  if (enums !== undefined) {
    expected = enums.multiple === true ? 'string[]' : 'string'
  } else {
    expected = dataType === 'N' ? 'number' : 'string'
  }

  // 4. 类型检查 + 5. 枚举成员 + 6. 约束 + 7. checkbox 顺序
  if (expected === 'number') {
    if (typeof nextValue !== 'number' || !Number.isFinite(nextValue)) {
      return { ok: false, reason: 'type_mismatch' }
    }
    // 6. 数值精度 (VR-10): 超过 scale 拒绝, 不四舍五入
    if (format?.scale !== undefined && countDecimalPlaces(nextValue) > format.scale) {
      return { ok: false, reason: 'number_scale_exceeded' }
    }
    return { ok: true, value: nextValue }
  }

  if (expected === 'string[]') {
    if (!Array.isArray(nextValue) || nextValue.some(v => typeof v !== 'string')) {
      return { ok: false, reason: 'type_mismatch' }
    }
    const arr = nextValue as string[]
    // 5. 枚举成员 (VR-9)
    if (enums !== undefined && enums.editable !== true && !allInCandidates(arr, enums.data)) {
      return { ok: false, reason: 'enum_value_not_allowed' }
    }
    // 7. checkbox 顺序归一 (VR-12): 按 enums.data 声明顺序
    return { ok: true, value: enums?.data && enums.data.length > 0 ? sortByDeclaration(arr, enums.data) : arr }
  }

  // expected === 'string'
  if (typeof nextValue !== 'string') {
    return { ok: false, reason: 'type_mismatch' }
  }
  // 5. 枚举成员 (VR-9)
  if (enums !== undefined && enums.editable !== true && !inCandidates(nextValue, enums.data)) {
    return { ok: false, reason: 'enum_value_not_allowed' }
  }
  // 6a. 日期格式 (D)
  if (dataType === 'D' && !DATE_RE.test(nextValue)) {
    return { ok: false, reason: 'date_format_invalid' }
  }
  // 6b. 字符串长度 (VR-11): 越界拒绝, 不截断
  if (format?.minLength !== undefined && nextValue.length < format.minLength) {
    return { ok: false, reason: 'string_length_out_of_range' }
  }
  if (format?.maxLength !== undefined && nextValue.length > format.maxLength) {
    return { ok: false, reason: 'string_length_out_of_range' }
  }
  return { ok: true, value: nextValue }
}

// ---- 内部辅助 (纯函数, 不导出) ----

function inCandidates(value: string, data: readonly ElementEnumOption[] | undefined): boolean {
  return (data ?? []).some(o => o.value === value)
}

function allInCandidates(values: string[], data: readonly ElementEnumOption[] | undefined): boolean {
  const set = new Set((data ?? []).map(o => o.value))
  return values.every(v => set.has(v))
}

/** 按 enums.data 声明顺序归一 (VR-12)。非候选项 (editable 自定义值) 排到末尾, 保持输入相对顺序 (稳定排序) */
function sortByDeclaration(values: string[], data: readonly ElementEnumOption[]): string[] {
  const order = new Map<string, number>()
  data.forEach((o, i) => order.set(o.value, i))
  return values.slice().sort((a, b) => {
    const ai = order.has(a) ? order.get(a)! : Number.MAX_SAFE_INTEGER
    const bi = order.has(b) ? order.get(b)! : Number.MAX_SAFE_INTEGER
    return ai - bi
  })
}

/** 有限数的十进制小数位数 (处理指数记法: 1.5e-3 → 4, 1.5e3 → 0) */
function countDecimalPlaces(n: number): number {
  const s = Math.abs(n).toString()
  const eIdx = s.indexOf('e')
  if (eIdx !== -1) {
    const mant = s.slice(0, eIdx)
    const exp = Number(s.slice(eIdx + 1))
    const mantDecimals = mant.includes('.') ? mant.length - mant.indexOf('.') - 1 : 0
    return Math.max(0, mantDecimals - exp)
  }
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}
