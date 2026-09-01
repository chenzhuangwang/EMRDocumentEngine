// ================================================================
// PresentationStyle — 表现层 / 盒模型样式 (契约 §2.2)
//
// 背景:
//   DocumentModel 拥有「语义样式」 (TextStyle: font/size/bold/…) ——
//   那是内容意义的一部分。但外部模板 JSON 还带一层「表现层样式」——
//   borderStyle / contentWrap / contentStyle / minWidth / textAlign ——
//   它们回答「怎么渲染」 (盒模型 / CSS 布局), 契约 §2.2 明令不得进
//   DocumentModel。
//
//   本模块是这层样式的「家」: 一个按节点 id 关联的独立对象, 与节点
//   语义字段彻底解耦。渲染器 (§4) 将其作为 rendering configuration
//   消费。
//
// 与共享样式字典的区别:
//   节点上的 style:{id} 引用 + 模板顶层 styles/globalStyles 字典是
//   「共享样式引用系统」 (§2.2 的 LATER optimization), 与本模块的
//   「内联表现层字段」是两码事, 留待导入器处理。
//
// 注: 本模块只负责「家」。外部模板导入器与渲染消费是独立任务 (P2),
//   导入器产出本层数据, 渲染器按需读取。
// ================================================================

/** 单个渲染元素的表现层 / 盒模型样式 (全可选, 按节点 id 关联) */
export interface PresentationStyle {
  /** 边框线型 (如 'none' / 'solid') */
  borderStyle?: string
  /** 内容是否包裹在盒内 */
  contentWrap?: boolean
  /** 原始 CSS 盒样式串 (如 'display:inline-block;min-width:16px') */
  contentStyle?: string
  /** 最小盒宽 (外部 JSON 中字符串/数值混合) */
  minWidth?: number | string
  /** 水平对齐 (如 'left' / 'center') */
  textAlign?: string
}

/** 节点 id → 表现层样式的只读映射 (外部只读, 变更走 store) */
export type PresentationStyleMap = ReadonlyMap<string, PresentationStyle>

/**
 * PresentationStyleStore — 表现层样式的类型化容器。
 *
 * 实例级状态 (per-editor), 非模块级单例 (§27.3)。按节点 id 关联,
 * 与 NodePool / DocumentModel 解耦 —— 它不持有节点引用, 只持有
 * 渲染配置。
 */
export class PresentationStyleStore {
  private readonly map = new Map<string, PresentationStyle>()

  /** 读取某节点的表现层样式 (无则 undefined) */
  get(nodeId: string): PresentationStyle | undefined {
    return this.map.get(nodeId)
  }

  /** 是否存在某节点的表现层样式 */
  has(nodeId: string): boolean {
    return this.map.has(nodeId)
  }

  /** 写入 (覆盖) 某节点的表现层样式 */
  set(nodeId: string, style: PresentationStyle): void {
    this.map.set(nodeId, style)
  }

  /** 删除某节点的表现层样式, 返回是否确实删除 */
  delete(nodeId: string): boolean {
    return this.map.delete(nodeId)
  }

  /** 清空全部表现层样式 */
  clear(): void {
    this.map.clear()
  }

  /** 已关联的节点数 */
  get size(): number {
    return this.map.size
  }

  /** 遍历 [nodeId, style] 对 */
  entries(): IterableIterator<[string, PresentationStyle]> {
    return this.map.entries()
  }

  /** 遍历全部节点 id */
  keys(): IterableIterator<string> {
    return this.map.keys()
  }

  /** 遍历全部表现层样式 */
  values(): IterableIterator<PresentationStyle> {
    return this.map.values()
  }
}
