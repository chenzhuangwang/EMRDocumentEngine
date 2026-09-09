// ================================================================
// UpdateControlElementCommand — 控件语义层编辑命令 (契约 §12.7)
//
// 编辑已放置控件的 SmartTextNode.element (ElementMeta, 语义层) —— 语义层
// 唯一的命令改写口。与 UpdateControlDefinitionCommand (设计期层) /
// SetControlValueCommand (运行时值) 各司一层, 不做「一个命令改三层」
// (§12.7: one mutable fact = one owner)。
//
// forward: 守卫 节点存在且为 smarttext; 快照 _oldElement/_oldText →
//          pool.updateNode 整体替换 element, 可选替换 text (占位符同步)。
// invert:  复用自身, 把 element/text 精确还原为快照。
//
// 无变化判定工具 (elementEquals / definitionEquals / controlConfigChanged)
// 一并放本模块, 供 Editor.applyControlConfig 判「无变化即不产命令」
// (§7.8 / §12.7)。比较前先递归剔除值为 undefined 的键 —— element 由
// 弹框重建时可能携带 undefined 可选字段, 与原对象语义等价。
// ================================================================

import type { ElementMeta, SmartTextNode } from '../../document/core/DocumentModel'
import { NodeType } from '../../document/core/DocumentModel'
import type { TemplateDefinition } from '../../template/TemplateDefinition'
import type { CommandContext, ICommand, SerializedCommand, StatePatch } from '../ICommand'
import { generateCommandId } from '../ICommand'

export class UpdateControlElementCommand implements ICommand {
  readonly type = 'update-control-element'
  readonly id: string
  readonly timestamp: number
  readonly author: string
  private nodeId: string
  private nextElement: ElementMeta
  /** 可选: 占位符 text 同步 (仅在空值且 text === `[oldName]` 时由编排层算出) */
  private nextText?: string

  /** forward 时快照的旧 element (深拷贝) */
  private _oldElement: ElementMeta | null = null
  /** forward 时快照的旧 text */
  private _oldText: string | null = null

  constructor(
    id: string, timestamp: number, author: string,
    nodeId: string, nextElement: ElementMeta, nextText?: string,
  ) {
    this.id = id
    this.timestamp = timestamp
    this.author = author
    this.nodeId = nodeId
    this.nextElement = nextElement
    this.nextText = nextText
  }

  forward(ctx: CommandContext): StatePatch | null {
    if (ctx.mode !== 'local') return null
    const { pool } = ctx

    // 守卫: 节点必须存在且是 smarttext (契约 §12.7), 否则拒绝
    const node = pool.nodes.get(this.nodeId) as { type?: unknown; text?: string; element?: ElementMeta } | undefined
    if (!node || node.type !== NodeType.SMART_TEXT) return null

    this._oldElement = cloneElement(node.element)
    this._oldText = (node.text as string) ?? ''

    const changes: Partial<SmartTextNode> = { element: this.nextElement }
    if (this.nextText !== undefined) changes.text = this.nextText
    pool.updateNode(this.nodeId, changes)

    // 语义层变更 (dataType/enums/name) 影响布局与渲染 → flowbody (当前全量重排)。
    return { invalidation: 'flowbody' }
  }

  invert(_ctx: CommandContext): ICommand | null {
    if (!this._oldElement) return null
    return new UpdateControlElementCommand(
      generateCommandId(), Date.now(), this.author,
      this.nodeId, this._oldElement, this._oldText ?? undefined,
    )
  }

  serialize(): SerializedCommand {
    return {
      type: 'update-control-element', id: this.id, timestamp: this.timestamp,
      author: this.author, changes: { nodeId: this.nodeId, element: this.nextElement, text: this.nextText },
    }
  }
}

// ---- 深拷贝 (ElementMeta 是纯数据, 无函数; JSON 克隆即可, 引擎非 DOM 可导入) ----

function cloneElement(element: ElementMeta | undefined): ElementMeta | null {
  if (element === undefined) return null
  return JSON.parse(JSON.stringify(element)) as ElementMeta
}

// ---- 相等判定 (先剔除 undefined 键再比较) ----

type Comparable = unknown

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 递归剔除值为 undefined 的键; 数组逐元素处理, 顺序保留 */
function stripUndefined(v: Comparable): Comparable {
  if (Array.isArray(v)) return v.map(stripUndefined)
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v)) {
      const val = v[k]
      if (val === undefined) continue
      out[k] = stripUndefined(val)
    }
    return out
  }
  return v
}

/** 语义相等: 剔除 undefined 键后递归比较 (对象键序无关, 数组有序) */
export function semanticEquals(a: Comparable, b: Comparable): boolean {
  const aa = stripUndefined(a)
  const bb = stripUndefined(b)
  return stableStringify(aa) === stableStringify(bb)
}

/** 稳定序列化 (对象键按字典序), 供语义相等比较 */
function stableStringify(v: Comparable): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (isPlainObject(v)) {
    const keys = Object.keys(v).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

/** 控件语义 element 是否相等 (§12.7 无变化判定) */
export function elementEquals(a: ElementMeta | undefined, b: ElementMeta | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return semanticEquals(a, b)
}

/** 设计期 def 是否相等; undefined / 空对象 (全 undefined) 视为「无条目」等价 */
export function definitionEquals(
  a: TemplateDefinition | undefined,
  b: TemplateDefinition | undefined,
): boolean {
  if (a === b) return true
  const aa = a === undefined ? {} : a
  const bb = b === undefined ? {} : b
  const aEmpty = isPlainObject(aa) && Object.keys(stripUndefined(aa) as Record<string, unknown>).length === 0
  const bEmpty = isPlainObject(bb) && Object.keys(stripUndefined(bb) as Record<string, unknown>).length === 0
  if (aEmpty && bEmpty) return true
  return semanticEquals(aa, bb)
}

/** element 或 def 任一有实质变化 */
export function controlConfigChanged(
  oldElement: ElementMeta | undefined,
  nextElement: ElementMeta,
  oldDef: TemplateDefinition | undefined,
  nextDef: TemplateDefinition | undefined,
): boolean {
  return !elementEquals(oldElement, nextElement) || !definitionEquals(oldDef, nextDef)
}
