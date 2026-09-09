// ================================================================
// TemplateDefinition — 模板设计期属性层 (契约 §12.1)
//
// 背景:
//   SmartTextNode 的「语义定义」 (element: code/name/labels/format)
//   与「运行时值」 (value) 已分离 (契约 §2.1)。但外部模板 JSON 还带
//   一层「模板设计期属性」——deletable / editable / tips / label /
//   prefix / suffix / single / controlType —— 它们描述的是模板作者在
//   设计期如何配置控件, 既不是「这个字段是什么」(定义), 也不是「患者的
//   记录写了什么」(值), 而是「控件在模板里长什么样 / 能不能动」。
//
// 契约 §12.1 强制: 这 8 个字段属于 TemplateDefinition 特征层, 不得
//   进入 DocumentModel / SmartTextNode / ElementMeta。本模块即该层的
//   落地 —— 一个按节点 id 关联的独立对象, 与节点语义字段彻底解耦。
//
// 与 filled record 的区别:
//   - template  = document (SmartTextNode.text 占位符) + TemplateDefinition
//   - record    = document (SmartTextNode.value 已填) —— 不含设计期配置
//
// 注: 本模块只负责「家」。外部模板导入器与序列化是独立任务 (P2),
//   导入器产出本层数据, 序列化以模板 artifact 的顶层结构单独存储,
//   不混入 DocumentSerializer 的节点 payload。
// ================================================================

/**
 * 控件视觉/交互形态 (契约 §12.1)。与 dataType ('S1'|'S2'|'S3'|'N'|'D')
 * 和 showType ('AN'|'N') 正交 —— dataType 是数据取值类型, showType 是
 * 展示形态, controlType 是控件 widget 形态。三者各自演化, 互不推导。
 */
export type ControlType =
  | 'input'      // 单行文本输入
  | 'textarea'   // 多行文本输入
  | 'number'     // 数字输入
  | 'select'     // 下拉单选
  | 'date'       // 日期选择
  | 'checkbox'   // 复选框 (多选)
  | 'radio'      // 单选框 (单选)

/** 单个 smarttext 控件的模板设计期属性 (全可选, 按节点 id 关联) */
export interface TemplateDefinition {
  /** 控件是否可在模板设计期删除 */
  deletable?: boolean
  /** 控件是否接受用户输入 (区别于 ElementEnums.editable=「枚举可手输」) */
  editable?: boolean
  /** 设计期提示 / 悬浮说明文本 */
  tips?: string
  /** 控件旁的标签文本 (如 '姓名：') */
  label?: string
  /** 控件前渲染的前缀字面量 */
  prefix?: string
  /** 控件后渲染的后缀字面量 */
  suffix?: string
  /** 该数据元在文档中仅允许出现一次 */
  single?: boolean
  /** 控件 widget 形态 (插入时由库条目或配置弹框写定, 契约 §12.5/§12.7;
   *  轻量属性面板 round-trip 保持; 旧文档缺失保持 undefined, 编辑提交时才显式写入) */
  controlType?: ControlType
}

/** 节点 id → 设计期属性的只读映射 (外部只读, 变更走 store) */
export type TemplateDefinitionMap = ReadonlyMap<string, TemplateDefinition>

/**
 * TemplateDefinitionStore — 模板设计期属性的类型化容器。
 *
 * 实例级状态 (per-template), 非模块级单例 (§27.3)。按节点 id 关联,
 * 与 NodePool 解耦 —— 它不持有节点引用, 只持有设计期配置。
 */
export class TemplateDefinitionStore {
  private readonly map = new Map<string, TemplateDefinition>()

  /** 读取某节点的设计期属性 (无则 undefined) */
  get(nodeId: string): TemplateDefinition | undefined {
    return this.map.get(nodeId)
  }

  /** 是否存在某节点的设计期属性 */
  has(nodeId: string): boolean {
    return this.map.has(nodeId)
  }

  /** 写入 (覆盖) 某节点的设计期属性 */
  set(nodeId: string, def: TemplateDefinition): void {
    this.map.set(nodeId, def)
  }

  /** 删除某节点的设计期属性, 返回是否确实删除 */
  delete(nodeId: string): boolean {
    return this.map.delete(nodeId)
  }

  /** 清空全部设计期属性 */
  clear(): void {
    this.map.clear()
  }

  /** 已关联的节点数 */
  get size(): number {
    return this.map.size
  }

  /** 遍历 [nodeId, def] 对 */
  entries(): IterableIterator<[string, TemplateDefinition]> {
    return this.map.entries()
  }

  /** 遍历全部节点 id */
  keys(): IterableIterator<string> {
    return this.map.keys()
  }

  /** 遍历全部设计期属性 */
  values(): IterableIterator<TemplateDefinition> {
    return this.map.values()
  }
}
