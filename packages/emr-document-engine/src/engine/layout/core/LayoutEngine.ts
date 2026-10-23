// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ================================================================
// LayoutEngine — 布局编排器 (架构 §7.3, v20.34)
//
// 独立于 Draw, 无 Canvas 依赖
// 输入: DocumentTree + NodePool + invalidation 作用域
// 输出: SLIFPage[] (布局产物)
//
// 职责: LineBreaker/PageBreaker 调度 + PageStartTable 增量分页
// 导出链路可直接消费 SLIFPage[]
// ================================================================

import type { DocumentTree, Paragraph, TextNode, SmartTextNode, ElementEnumOption, ElementMeta } from '../../document/core/DocumentModel'
import type { NodePool } from '../../document/core/NodePool'
import {
  isVariantEnabled, resolveVariantForPage, type HeaderFooterVariant,
} from '../../document/core/HeaderFooterRegions'
import { bodyBlockSpine } from '../../document/selection/SelectionCollector'
import type { ControlType } from '../../template/TemplateDefinition'
import type { SLIFPage, SLIFItem, SLIFRow, SLIFCell } from './SLIF'
import type { EventBus } from '../../interaction/EventBus'
import type { LayoutConfig } from './LayoutContext'
import type { LayoutResult } from './LayoutResult'
import type { TextMeasurer } from '../text/TextMeasurer'
import { LineBreaker } from '../line/LineBreaker'
import type { LineElement } from '../line/LineLayout'
import { PageBreaker } from '../page/PageBreaker'
import type { ILine, IPage } from '../page/PageLayout'
import { DEFAULT_PAGE_SETUP } from '../../document/core/DocumentModel'
import type { PageSetup } from '../../document/core/DocumentModel'
import { controlValueDisplay } from '../../document/factory/ElementFormatter'
import { CONTROL_BOX_PADDING } from '../../document/control/ControlBox'
import { smarttextLayoutHint } from '../control/ControlLayoutHint'
import { representativeFieldText, fieldReserveDigits, type FieldReserveContext } from '../../document/factory/FieldFormatter'
import { locale } from '../../i18n/index'
import { MergeMatrix } from '../../document/table/MergeMatrix'
import { FootnoteLayout } from '../footnote/FootnoteLayout'
import { ListParticle } from '../../render/particles/ListParticle'
import { BookmarkRenderer } from '../../render/BookmarkRenderer'
import { getFlatPageItems, forEachPageItem, tableRowUnitHeight } from './SLIF'
import { createTablePaginator } from '../table/TablePaginator'
import type { TableFragment } from '../table/TablePaginator'
import { PageStartTable } from '../page/PageStartTable'
import { VirtualViewport } from '../viewport/VirtualViewport'
import { IncrementalLayout } from '../incremental/IncrementalLayout'

export type { LayoutConfig } from './LayoutContext'
export type { LayoutResult } from './LayoutResult'

/**
 * 修订标记的布局投影 (契约 §12.13)。
 *
 * SLIF 只承载**布局产物**, 但修订的 type 决定渲染颜色 —— 它必须像
 * underlineStyle/highlight 一样透传, 否则 TextParticle 里那条现成的 revision
 * 分支永远是死代码 (本批开工前的实测结论)。作者/时间不进 SLIF: 那是旁注。
 */
/**
 * 布局期的**渲染视图**标签 (契约 §12.13)。
 *
 * 视图开关不是"渲染期才读"的设置: 关掉标记必须把**删除线**也一起关掉, 而删除线
 * 在布局期就由变体反推了出来 (`delete` → 变体 strikeout || underline)。若不在
 * 这里按开关剥掉变体, 用户关掉标记后删除线仍在 —— 那正是"视图开关改不动它"的
 * 老毛病 (本仓已有先例: fields.ts 的显示值与渲染口径漂移)。
 *
 * 代价是关开关要**重排一次**。这与 §12.12.5 的 HIDE 同一量级: 视图开关改变的是
 * 布局产物, 不是文档。
 */
function revisionVariantOf(
  node: { revision?: { type: string }; strikeout?: boolean },
  showMarks: boolean,
): { revision?: { type: string }; strikeout?: boolean } {
  if (!showMarks || !node.revision) return { revision: undefined, strikeout: node.strikeout }
  return {
    revision: { type: node.revision.type },
    strikeout: node.revision.type === 'delete' ? true : node.strikeout,
  }
}

/**
 * 行的段末标记 — 与 PageBreaker 的 paragraphEnds 判据**同源**:
 * pageable/表格 fragment 行视为块边界, 否则看最后一个元素 value === '\n'。
 * M2e 的同形状判定必须用同一判据, 否则孤行/寡行输入可能悄悄变化。
 */
function lineEndsParagraph(line: ILine): boolean {
  if (line.pageable || line.tableFragment) return true
  const last = line.elements[line.elements.length - 1]
  return last?.value === '\n'
}

/**
 * 运行时控件内联渲染预留宽所需的最小信息 (契约 §12.6 表单模式内联渲染)。
 * 正交读取: controlType 直接来自 TemplateDefinition, options 直接来自 element.format.enums,
 * 布局只消费、不推导 (绝不从 dataType/enums 反向推断 controlType)。
 */
export interface InlineControlInfo {
  controlType?: ControlType
  options?: ElementEnumOption[]
  /** 附属字面量 (契约 §12.1 不变量 10) — 布局为其预留宽, 避免相邻控件重叠 */
  label?: string
  prefix?: string
  suffix?: string
  /**
   * 计算式算出的显示值 (契约 §12.12.8) —— 有则**取代**控件自身的值/占位符。
   *
   * 布局只管用它量宽与折行; **LayoutEngine 不需要知道"公式"是什么**
   * (它连 formula 这个字段都读不到, 这里只有算好的结果)。
   */
  computedDisplay?: string
  /**
   * 是否参与布局 (契约 §12.12.5 SHOW/HIDE)。`false` 时该控件不产出任何
   * SLIFItem —— 于是自然不可命中、光标进不去。
   * 缺省/`undefined` = 可见 (与"没有公式"一致)。
   */
  visible?: boolean
}

/** 单个页眉/页脚带的布局产物 (items 的 y 相对带顶) */
interface HfRegion { items: SLIFItem[]; regionHeight: number }

/** 已算出的页眉/页脚变体布局 — default 恒有; first/even 视开关惰性计算 */
type HfVariantRegions = Partial<Record<HeaderFooterVariant, { header: HfRegion; footer: HfRegion }>>

/** 单轮布局结果 (layoutOnce 与 M2e 同形状补丁共用; 状态由 fullLayout 提交) */
interface LayoutPassResult {
  pages: SLIFPage[]
  state: {
    pageStartLineIndex: number[]
    paraFirstLine: Map<string, number>
    tableKeys: Map<string, string>
  }
  mode: 'full' | 'reuse-all' | 'resume'
  /** 从第 0 页起原样复用的页数 */
  reusedPages: number
  /** 补丁范围**之后**原样复用的页数 (M2e; 普通路径恒为 0) */
  reusedTailPages: number
}

/** 标题级别 → 字体缩放倍率 (基于正文默认 16px: H1=32, H2=24, H3=20, H4=18, H5=16, H6=14) */
const HEADING_SCALE: Record<number, number> = { 1: 2.0, 2: 1.5, 3: 1.25, 4: 1.125, 5: 1.0, 6: 0.875 }
const BASE_FONT_SIZE = 16

// 页眉/页脚区域 (WPS 式朝版心扩展, 契约 §7 页眉页脚布局)
const HF_MIN_REGION = 42       // 最小可交互/可见带高
const HF_HEAD_TOP_PAD = 8      // 页眉距页面顶部
const HF_HEAD_BOTTOM_PAD = 2
const HF_FOOT_TOP_PAD = 2
const HF_FOOT_BOTTOM_PAD = 8   // 页脚距页面底部
/** 文档含脚注时正文分页预留的脚注 gutter (与 FootnoteLayout 固定 60 一致) */
const FOOTNOTE_GUTTER = 60

export class LayoutEngine {
  private eventBus: EventBus
  private measurer: TextMeasurer
  private pages: SLIFPage[] = []
  private config: LayoutConfig
  // 运行时控件内联渲染预留宽信息源 (契约 §12.6) — 由 Draw 注入 (读取
  // templateDefinitions.controlType + element.format.enums)。布局不直接持有
  // templateDefinitions, 只消费回调, 保持布局与设计期层的解耦。
  private controlInfoOf: ((nodeId: string) => InlineControlInfo | undefined) | null = null

  /**
   * 修订留痕显示开关 (契约 §12.13) — 由 Draw 在每次重排前同步。
   *
   * 布局**不持有**这个开关的拥有权 (它是 Editor 的视图状态): 这里只消费。
   * 读它的理由见 revisionVariantOf: 删除线是布局期产物, 关标记必须连它一起关。
   */
  private showRevisionMarks = true

  /** 同步修订留痕显示开关 (契约 §12.13) — 由 Draw 调用, 改变后需重排 */
  setShowRevisionMarks(v: boolean): void {
    if (this.showRevisionMarks === v) return
    this.showRevisionMarks = v
    // 修订样式是布局期产物, 旧缓存里存的是切换前的行: 直接清空 (数量=段落数)
    this.clearParagraphLineCache()
  }

  // ================================================================
  // 段落行缓存 (M2a)
  //
  // 缓存"子节点为纯文本 / 图片 / 脚注引用 / 控件"的段落 (列表也在内: 编号标记进键)。
  // 图片行元素只取节点自身尺寸; 脚注引用的编号在分页后的 Step 4 回填, 不参与断行。
  // 控件 (smarttext) 的显示值/可见性来自计算值、外观定义来自 TemplateDefinitionStore
  // —— 两者都用代次进键 (仅含控件的段落), 见 paragraphLineCacheKey (契约 §16.1)。
  // 域与带 {page}/{number} 的交叉引用: 显示值/预留宽依赖本趟页数 → 不缓存;
  // 常量交叉引用 (无占位符) 的显示文本与页映射无关, 可缓存。
  // 缓存条目按段落 ID 存**最新一份** (key 不匹配即重算并覆盖), 因此不会
  // 随每次按键无限增长; 换文档时由 Draw 调用 clearParagraphLineCache()。
  // ================================================================
  private paragraphLineCache = new Map<string, { key: string; lines: ILine[] }>()
  private paragraphCacheEnabled = true
  private paragraphCacheHits = 0
  private paragraphCacheMisses = 0

  /**
   * M2e 同形状页补丁开关 (契约 §16.1)。
   *
   * 关闭后回落到 M2b 续排 —— 等价性测试用它做"无补丁"反证 (让补丁路径
   * 必须由用例自己证明是它省掉了重排, 而不是恰好看不出差别)。
   */
  private sameShapePatchEnabled = true

  /** 关闭段落行缓存 (等价性测试用: 关闭侧必须是"纯全量") */
  setParagraphCacheEnabled(v: boolean): void {
    this.paragraphCacheEnabled = v
    if (!v) this.clearParagraphLineCache()
  }

  /** 关闭 M2e 同形状页补丁 (测试用: 关闭侧必须走 M2b 续排) */
  setSameShapePatchEnabled(v: boolean): void {
    this.sameShapePatchEnabled = v
  }

  /** 清空段落行缓存 (换文档 / 全量失效时调用) */
  clearParagraphLineCache(): void {
    this.paragraphLineCache.clear()
  }

  /** 缓存命中统计 (诊断与测试用; 不参与布局决策) */
  getParagraphCacheStats(): { hits: number; misses: number; size: number } {
    return { hits: this.paragraphCacheHits, misses: this.paragraphCacheMisses, size: this.paragraphLineCache.size }
  }

  /**
   * 段落行缓存键; null = 该段落不可缓存。
   *
   * 键 = 段落布局键 (结构版本 + 段落版本 + 逐子节点版本) + 段落之外但影响
   * 行断的输入: 可用宽 (页面设置/分节)、修订标记显隐 (布局期样式)、
   * 列表标记 (编号依赖前序段落，但标记本身已由调用方算好并参与断行)。
   * 含控件段落追加计算值代次/模板定义版本；含域段落追加域预留宽取样输入
   * (页数位数/locale/标题)。带 {page}/{number} 的交叉引用仍不缓存 (显示文本
   * 依赖本趟分页结果); 常量交叉引用可缓存 (节点版本覆盖其改动)。
   */
  private paragraphLineCacheKey(
    pool: NodePool, para: Paragraph, contentWidth: number, listMarker: string,
  ): string | null {
    const children = (para as unknown as { children?: readonly string[] }).children
    if (!children) return null
    const digests: string[] = []
    let hasSmart = false
    let hasField = false
    for (const childId of children) {
      const child = pool.nodes.get(childId) as
        { type?: string; width?: number; height?: number; wrapMode?: string } | undefined
      if (child?.type === 'text' || child?.type === 'footnote_ref') continue
      if (child?.type === 'image') {
        // 图片行元素只取节点自身的尺寸/环绕方式 (节点版本已进 paragraphKey)
        digests.push(`img:${childId}:${child.width ?? ''}x${child.height ?? ''}:${child.wrapMode ?? ''}`)
        continue
      }
      if (child?.type === 'smarttext') {
        // 控件几何的段落外输入: 计算值 (显示值/可见性) 与模板定义 (controlType/
        // label/prefix) —— 两者都不冒泡到节点版本, 各自用代次进键。
        hasSmart = true
        continue
      }
      if (child?.type === 'field') {
        // 域的显示值 (cachedValue) 在节点版本上; 但量宽用的是 representativeFieldText
        // 的样本串 —— 页数位数/locale/标题改了, 预留宽就变, 必须进键 (契约 §16.1)。
        hasField = true
        continue
      }
      if (child?.type === 'cross_reference') {
        // 带 {page}/{number} 时显示文本取自上一轮页映射 → 不缓存;
        // 常量显示文本与页映射无关, 节点版本已覆盖其改动 → 可缓存 (契约 §16.1)。
        if (crossRefNeedsPageMap(child as { displayText?: string })) return null
        continue
      }
      // 未知行内类型: 保守起见不进缓存
      return null
    }
    const base = IncrementalLayout.paragraphKey(pool, para.id)
    if (!base) return null
    // 代次只加在**含控件**的段落上: 否则每次公式重算都会让纯文本段落的键全部失效
    const ctl = hasSmart ? `#cv${this.computedGeneration}#tv${this.templateDefinitionVersion}` : ''
    const fld = hasField
      ? `#f${fieldReserveDigits(this.fieldReserveCtx.totalPagesHint)}`
        + `#l${this.fieldReserveCtx.locale ?? ''}`
        + `#t${JSON.stringify(this.fieldReserveCtx.documentTitle ?? '')}`
      : ''
    return `${base}#w${contentWidth}#r${this.showRevisionMarks ? 1 : 0}#m${listMarker}#d${digests.join(',')}${ctl}${fld}`
  }

  /**
   * 表格子树的布局键 (契约 §16.1 / §31.13.1)。
   *
   * = 子树结构/节点版本 + 计算值代次 + 模板定义版本 + 修订留痕开关;
   * 子树含域时再追加与段落键**同一组**域预留宽取样输入 (页数位数/locale/标题)。
   * cell 内的域量宽来自 representativeFieldText 的样本串, 这些输入不在节点版本上;
   * 缺了它们, 页数从 9 页涨到 10 页后 cell 里的页码域会静默保留 1 位预留宽。
   * 不含域的表格 MUST NOT 带这三段, 否则每次改标题都会让所有表格重排。
   */
  private tableLayoutKey(pool: NodePool, tableId: string): string {
    const fldSeg = IncrementalLayout.subtreeHasType(pool, tableId, 'field')
      ? `#f${fieldReserveDigits(this.fieldReserveCtx.totalPagesHint)}`
        + `#l${this.fieldReserveCtx.locale ?? ''}`
        + `#t${JSON.stringify(this.fieldReserveCtx.documentTitle ?? '')}`
      : ''
    return `${IncrementalLayout.tableKey(pool, tableId) ?? ''}`
      + `#cv${this.computedGeneration}#tv${this.templateDefinitionVersion}`
      + `#rev${this.showRevisionMarks ? 1 : 0}`
      + fldSeg
  }

  // ================================================================
  // 增量分页 (M2b)
  //
  // 只对**可证明安全**的正文启用: 段落 (文本/图片/脚注引用/控件/域/列表/常量
  // 交叉引用) 与表格; 页眉页脚按几何签名放行 (M2g)。仍排除: 分节 (断页/奇偶补
  // 空白页会改变页序列) 与带 {page}/{number} 的交叉引用 (显示文本依赖本趟页映射)。
  // 域可以: 量宽只依赖 representativeFieldText 的
  // 样本串 (页数位数/locale/标题已进段落键), 显示值在节点版本上。脚注引用可以:
  // 页底预留只取决于"文档有没有脚注" (增删引用是结构编辑, 会让全部段落键失效),
  // 而 Step 4 只处理新页 + 按复用页播种编号。表格 cell 与正文同一张白名单
  // (text/smarttext/image/field/footnote_ref); 子树含域时域预留宽取样输入进
  // 表格键。嵌套表与带占位符的交叉引用仍不安全 —— cell 里的嵌套表改变几何而
  // 扁平键看不全, 占位符交叉引用的显示文本依赖本趟页映射。这些场景一律全量分页
  // (契约 §16.1)。
  //
  // 续排从「首个脏段落所在页的**前一页**」开始: 寡行控制会从下一页拉一行回来,
  // 所以脏段落所在页的上一页也可能变。若该页从表格中间开始, 还要再回退到
  // 该表格的起始页 —— 传给 PageBreaker 的是从 startLine 起的**原始行**, 从
  // 表格中间切会丢掉前序页已承载的续排片段。
  // ================================================================
  private pageStartLineIndex: number[] = []
  private paraPageTable = new PageStartTable()
  private lastPaginationMode: 'full' | 'reuse-all' | 'resume' = 'full'
  private lastReusedPages = 0
  /** 补丁范围**之后**原样复用的页数 (M2e; 普通续排恒为 0) */
  private lastReusedTailPages = 0
  /** 上一轮各表格的子树键 — 只有键变了才把表格标记为"需重排" */
  private tableKeys = new Map<string, string>()
  /** 计算值代次 (Draw 在布局前同步) — 代次变化会让所有表格键与含控件段落的键失效 */
  private computedGeneration = 0
  /** 模板定义版本 (Draw 在布局前同步) — 控件外观定义变化, 不进节点版本也不进计算值代次 */
  private templateDefinitionVersion = 0

  /** 上一趟的页眉/页脚几何签名 (M3b) — 未变才允许续排复用页 */
  private lastHfSignature: string | null = null

  /** 同步计算值代次 (契约 §12.12.7 / §16.1) — 由 Draw 在每趟布局前调用 */
  setComputedGeneration(generation: number): void {
    this.computedGeneration = generation
  }

  /**
   * 同步模板定义版本 (契约 §16.1) — 由 Draw 在每趟布局前调用。
   *
   * 控件的 controlType/label/prefix 住在 TemplateDefinitionStore, 改它们既不
   * 动节点版本也不动计算值代次; 缺了这条, "改控件外观不重排"会静默保留旧几何。
   */
  setTemplateDefinitionVersion(version: number): void {
    this.templateDefinitionVersion = version
  }

  /**
   * 分页模式统计 (诊断与测试用; 不参与布局决策)。
   *
   * reusedPages = 从第 0 页起原样复用的页数; reusedTailPages = 补丁范围之后
   * 原样复用的页数 (M2e 同形状补丁才有, 普通续排恒为 0)。
   */
  getPaginationStats(): {
    mode: 'full' | 'reuse-all' | 'resume'
    reusedPages: number
    reusedTailPages: number
    totalPages: number
  } {
    return {
      mode: this.lastPaginationMode,
      reusedPages: this.lastReusedPages,
      reusedTailPages: this.lastReusedTailPages,
      totalPages: this.pages.length,
    }
  }

  /** 换文档时必须调用: 旧页与新文档无关 (Draw.setDocument) */
  clearPaginationState(): void {
    this.pageStartLineIndex = []
    this.paraPageTable = new PageStartTable()
    this.lastPaginationMode = 'full'
    this.lastReusedPages = 0
    this.lastReusedTailPages = 0
    this.tableKeys.clear()
    this.lastHfSignature = null
    this.pages = []
  }

  /** 是否允许增量分页 — 只放行可证明安全的文档子集 */
  private canIncrementalPagination(
    doc: DocumentTree,
    pool: NodePool,
    hfSignature: string,
    invalidation?: string,
  ): boolean {
    if (this.pageStartLineIndex.length === 0 || this.pages.length === 0) return false
    // 只有段落级失效才可能保留前序页; 其余一律全量
    if (invalidation !== undefined && invalidation !== 'node'
      && invalidation !== 'paragraph' && invalidation !== 'paragraph_and_downstream') return false

    // 页眉/页脚 (M3b): 它们决定正文可用区 (带高) 与每页携带的 items。
    // 签名相等 ⇒ 任一页重建出的 HF 与上一趟逐字节相同, 复用页无需重算;
    // 不等 (含首趟) 仍按全量保守处理。
    if (this.lastHfSignature === null || hfSignature !== this.lastHfSignature) return false

    for (const blockId of bodyBlockSpine(doc, pool)) {
      const block = pool.nodes.get(blockId) as unknown as
        { type?: string; children?: readonly string[] } | undefined
      // 表格允许: 子树键未变时复用其前序页, 变了则从表格起始页重排。
      // cell 里放行 text/smarttext/image/field/footnote_ref —— 与正文同一张白名单;
      // 域预留宽输入已进表格键。嵌套表与带占位符的交叉引用仍属危险类 (契约 §16.1)。
      if (block?.type === 'table') {
        if (!this.tableSubtreeIncrementalSafe(pool, blockId)) return false
        continue
      }
      if (block?.type !== 'paragraph') return false
      for (const childId of block.children ?? []) {
        const child = pool.nodes.get(childId) as { type?: string } | undefined
        // 图片是自包含的行内元素 (尺寸在节点上); 脚注引用只影响页底脚注区,
        // Step 4 已按「只处理新页 + 播种编号」处理 (契约 §16.1)。
        // 控件 (smarttext) 放行: 显示值/可见性由计算值代次与模板定义版本进键,
        // 两代次变化时段落键失效 → 该段落重排 (契约 §16.1)。
        // 域 (field) 放行: 量宽输入 (页数位数/locale/标题) 已进段落键。
        // 交叉引用: 带 {page}/{number} 时显示文本依赖本趟页映射 → 排除;
        // 常量显示文本 (无占位符) 与页映射无关 → 与正文其它内联节点同权。
        if (child?.type === 'cross_reference') {
          if (crossRefNeedsPageMap(child as { displayText?: string })) return false
          continue
        }
        if (child?.type !== 'text' && child?.type !== 'image'
          && child?.type !== 'footnote_ref' && child?.type !== 'smarttext'
          && child?.type !== 'field') return false
      }
    }
    return true
  }

  /**
   * 页眉/页脚几何签名 (M3b, 契约 §16.1)。
   *
   * 只覆盖「改变 HF 带高或 HF 行内容」的输入 —— 签名相等即可复用已排好的页:
   *   - 六个变体数组的段落 id 与其子节点版本 (段落样式/run 样式/控件值/域缓存值
   *     都落在节点版本上); 另加 structureVersion (增删段落/子节点会整表变);
   *   - 变体开关 (differentFirstPage / differentOddEven) 决定逐页变体解析;
   *   - 修订留痕开关: 删除线是布局期产物, 与正文同理必须进签名;
   *   - HF 内控件的计算值代次与模板定义版本 —— 仅当 HF 真的含 smarttext 才带,
   *     否则每次公式重算都会让带页眉的文档退回全量;
   *   - 域预留宽的取样输入: 页数位数 (totalPagesHint 只取位数)、locale、文档标题。
   *
   * 页眉里的页码/总页数文本在**渲染期**解析 (Draw.resolveFieldText), 不烤进
   * SLIF item, 因此页数变化本身不需要重建复用页 —— 只有位数变化会改写域预留宽。
   */
  private headerFooterSignature(
    doc: DocumentTree, pool: NodePool, contentWidth: number, pageNumberHint: number,
  ): string {
    const parts: string[] = [
      String(pool.structureVersion),
      String(contentWidth),
      this.showRevisionMarks ? 'rev1' : 'rev0',
      String(fieldReserveDigits(pageNumberHint)),
      locale.getLocale(),
      doc.title || '',
      doc.headerFooterConfig?.differentFirstPage ? 'first1' : 'first0',
      doc.headerFooterConfig?.differentOddEven ? 'even1' : 'even0',
    ]
    const hf = doc as unknown as Record<string, readonly string[] | undefined>
    let hasSmart = false
    for (const key of ['header', 'footer', 'firstPageHeader', 'firstPageFooter', 'evenPageHeader', 'evenPageFooter']) {
      parts.push(`#${key}`)
      for (const id of hf[key] ?? []) {
        const block = pool.nodes.get(id) as { children?: readonly string[] } | undefined
        parts.push(`${id}@${pool.getNodeVersion(id)}`)
        for (const childId of block?.children ?? []) {
          const child = pool.nodes.get(childId) as { type?: string } | undefined
          if (child?.type === 'smarttext') hasSmart = true
          parts.push(`${childId}@${pool.getNodeVersion(childId)}`)
        }
      }
    }
    if (hasSmart) parts.push(`cv${this.computedGeneration}`, `tv${this.templateDefinitionVersion}`)
    return parts.join('|')
  }

  /**
   * 表格子树是否落在增量安全子集内: table → row → cell → paragraph →
   * **text / smarttext**。
   *
   * 拒绝的具体理由:
   *   - 嵌套表: cell 内的嵌套布局有自己的行高增长, 且同样可能藏危险叶节点;
   *   - 脚注引用: Step 4 会往**复用页**重复追加脚注 item;
   *   - 域/交叉引用: 预留宽依赖本趟页数。
   * 控件 (smarttext) 安全: 其显示值只经由计算值代次与模板定义版本影响几何,
   * 两者都已进表格键 (layoutOnce 的 `#cv`/`#tv` 段), 变了则整表重排。
   * 其余都让"表格键未变 ⇒ 分页未变"不再成立 (契约 §16.1)。
   */
  private tableSubtreeIncrementalSafe(pool: NodePool, tableId: string): boolean {
    const root = pool.nodes.get(tableId) as { children?: readonly string[] } | undefined
    const stack = [...(root?.children ?? [])]
    while (stack.length > 0) {
      const id = stack.pop()!
      const node = pool.nodes.get(id) as { type?: string; children?: readonly string[] } | undefined
      if (!node) continue
      if (node.type === 'text' || node.type === 'smarttext'
        || node.type === 'image' || node.type === 'field'
        || node.type === 'footnote_ref') continue
      if (node.type === 'cross_reference') {
        // 常量显示文本可复用; 带占位符的显示文本取自上一轮页映射 (契约 §16.1)
        if (crossRefNeedsPageMap(node as { displayText?: string })) return false
        continue
      }
      if (node.type === 'row' || node.type === 'cell' || node.type === 'paragraph') {
        for (const childId of node.children ?? []) stack.push(childId)
        continue
      }
      return false
    }
    return true
  }

  /** 元素的修订渲染视图 (标记 + 由 delete 派生的删除线) */
  private revisionViewOf(node: { revision?: { type: string }; strikeout?: boolean }): {
    revision?: { type: string }
    strikeout?: boolean
  } {
    return revisionVariantOf(node, this.showRevisionMarks)
  }

  /**
   * 域代码预留宽上下文 — 每次 fullLayout 开头刷新。
   * totalPagesHint 取上一轮布局的页数 (首轮 1): 决定页码域预留几位数字,
   * 位数与实际不符时 fullLayout 会带新页数重排一次 (见 fullLayout 注释)。
   */
  private fieldReserveCtx: FieldReserveContext = { totalPagesHint: 1 }

  /**
   * 段落 id → 页下标 (0-based), 由**上一轮**布局结果构建 —— 供交叉引用解析
   * 「目标在第几页」。与 fieldReserveCtx.totalPagesHint 同理: 页码依赖分页,
   * 分页又依赖文本长度, 一轮之内取不到最终值。无交叉引用占位符时本字段不更新,
   * 行为与历史实现逐字节相同。
   */
  private lastParaPageMap: Map<string, number> = new Map()

  /** 交叉引用解析器 (书签/标题 → 页码, 脚注 → 编号) */
  private readonly bookmarks = new BookmarkRenderer()

  constructor(eventBus: EventBus, measurer: TextMeasurer) {
    this.eventBus = eventBus
    this.measurer = measurer
    this.config = {
      pageWidth: 794, pageHeight: 1123,
      marginTop: 72, marginBottom: 72,
      marginLeft: 90, marginRight: 90,
    }
  }

  /**
   * 全量重布局 — LineBreaker + PageBreaker 集成 (TASK-445)。
   *
   * 域代码 (页码/总页数) 的预留宽按**页数位数**取样, 而页数是本函数的结果 —
   * 因此先用上一轮页数做估计排一次, 若位数与实际不符 (跨越 10/100 页) 再用
   * 新页数重排一次。至多两轮, 使 '第[1]页' 的预留宽与绘制宽一致且不重叠。
   */
  fullLayout(doc: DocumentTree, pool: NodePool, invalidation?: string): LayoutResult {
    const hint = Math.max(1, this.pages.length)
    const contentWidth = this.config.pageWidth - this.config.marginLeft - this.config.marginRight
    // 页眉/页脚几何签名 (M3b): 与本趟实际使用的 pageNumberHint 同参计算,
    // 与上一趟不同则不允许复用页 (带高/逐页 items 可能已变)
    const hfSignature = this.headerFooterSignature(doc, pool, contentWidth, hint)
    const allowIncremental = this.canIncrementalPagination(doc, pool, hfSignature, invalidation)
    let result = this.layoutOnce(doc, pool, hint, allowIncremental)
    let pages = result.pages
    const pageDigitsChanged = String(hint).length !== String(Math.max(1, pages.length)).length
    // 交叉引用的 {page} 取自**上一轮**布局 (与 totalPagesHint 同思路: 页码依赖
    // 分页, 分页又依赖文本长度)。含占位符时必须再排一轮, 否则首轮只能填 '?'。
    const needsXrefPass = hasCrossRefPlaceholder(pool)
    if (pageDigitsChanged || needsXrefPass) {
      if (needsXrefPass) this.lastParaPageMap = buildParaPageMap(pages, pool)
      result = this.layoutOnce(doc, pool, Math.max(1, pages.length), false)
      pages = result.pages
    }
    this.pages = pages
    // 只提交最终一趟使用的签名: 页数位数若在本趟变化, 签名按新位数记 ——
    // 下一趟的 hint 取本轮页数, 与这里同口径 (契约 §16.1)
    this.lastHfSignature = this.headerFooterSignature(doc, pool, contentWidth, Math.max(1, pages.length))
    this.commitPaginationState(result.state, result.mode, result.reusedPages, result.reusedTailPages)
    // 段落→页映射总是刷新: O(N) 只读派生, 不参与布局输出 (无行为变化), 但书签
    // 对话框与交叉引用都按它显示"第几页"。上面 needsXrefPass 时已建过一次, 这里
    // 用最终 pages 再建一次 —— 多一次 O(N) 换取"永不过期"的简单性。
    this.lastParaPageMap = buildParaPageMap(pages, pool)
    this.eventBus.emit('layout:changed', pages)
    return pages
  }

  /** 提交本轮分页状态 (只有最后一轮布局的状态才算数) */
  private commitPaginationState(
    state: {
      pageStartLineIndex: number[]
      paraFirstLine: Map<string, number>
      tableKeys: Map<string, string>
    },
    mode: 'full' | 'reuse-all' | 'resume',
    reusedPages: number,
    reusedTailPages: number,
  ): void {
    this.pageStartLineIndex = state.pageStartLineIndex
    this.tableKeys = state.tableKeys
    this.lastPaginationMode = mode
    this.lastReusedPages = reusedPages
    this.lastReusedTailPages = reusedTailPages

    const paras = [...state.paraFirstLine.entries()].sort((a, b) => a[1] - b[1])
    const entries: { id: string; pageIndex: number }[] = []
    for (const [paraId, lineIndex] of paras) {
      entries.push({ id: paraId, pageIndex: this.pageOfLine(lineIndex) })
    }
    this.paraPageTable.rebuild(entries)
  }

  /** 行下标 → 页下标 (页起始行表上二分; 空表返回 0) */
  private pageOfLine(lineIndex: number): number {
    let lo = 0
    let hi = this.pageStartLineIndex.length - 1
    let result = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.pageStartLineIndex[mid] <= lineIndex) { result = mid; lo = mid + 1 }
      else hi = mid - 1
    }
    return result
  }

  /**
   * 该页是否从某表格的**续排片段**开始 (上一页以同一表格的片段结尾)。
   *
   * 这样的页没有对应的"输入行下标" —— 页首落在表格输入行的中间。续排不能从
   * 它开始: 传进去的是 allLines 的切片, 而表格只有**一个**输入行, 从中间切会
   * 让 PageBreaker 用一个全新游标重排表格, 于是前序页承载的续排片段被重复。
   */
  private pageStartsInsideTable(pageIndex: number): boolean {
    if (pageIndex <= 0 || pageIndex >= this.pages.length) return false
    const first = this.pages[pageIndex].items[0]
    const prevItems = this.pages[pageIndex - 1].items
    const last = prevItems[prevItems.length - 1]
    return !!first && first.type === 'table'
      && !!last && last.type === 'table' && last.nodeId === first.nodeId
  }

  /**
   * 段落 id → 页下标 (0-based) 的只读快照 —— 供 UI 显示"目标在第几页"
   * (书签/交叉引用目标列表)。派生数据: 每次布局刷新, 不是文档内容。
   */
  getParaPageMap(): ReadonlyMap<string, number> {
    return this.lastParaPageMap
  }

  /** 单轮布局 (不改 this.pages / 不发事件; 分页状态由调用方提交) */
  private layoutOnce(
    doc: DocumentTree,
    pool: NodePool,
    pageNumberHint: number,
    allowIncremental: boolean,
  ): LayoutPassResult {
    // locale 必须与渲染期 (Draw.resolveFieldText) 同源 —— 否则域的量宽与
    // 绘制宽会漂移 (en-US 的 '9/22/2026' 比 zh-CN 的 '2026/9/22' 窄)。
    this.fieldReserveCtx = { totalPagesHint: pageNumberHint, documentTitle: doc.title, locale: locale.getLocale() }
    const measurer = this.measurer
    const lineBreaker = new LineBreaker(measurer)
    const pageBreaker = new PageBreaker()
    const contentWidth = this.config.pageWidth - this.config.marginLeft - this.config.marginRight

    // Step 1: 遍历 FlowBody, 为每个 Paragraph 调用 LineBreaker
    const allLines: ILine[] = []
    const pageSetup = {
      ...DEFAULT_PAGE_SETUP,
      width: this.config.pageWidth,
      height: this.config.pageHeight,
      marginTop: this.config.marginTop,
      marginBottom: this.config.marginBottom,
      marginLeft: this.config.marginLeft,
      marginRight: this.config.marginRight,
    }

    // 页眉/页脚内容布局 (y 相对各自带顶, WPS 式锚定朝版心扩展)。
    // 逐页变体 (契约 §7.9): 默认变体恒算; first/even 仅在开关开启时才算 (惰性 —
    // 两个开关都关时工作量与历史行为逐字节相同)。
    const hfVariants = this.buildHfVariants(doc, pool, lineBreaker, measurer, contentWidth)

    // 脚注 gutter: 含脚注时正文为脚注区预留
    const footnoteReserve = this.docContainsFootnotes(pool) ? FOOTNOTE_GUTTER : 0

    // 正文实际可用区 (WPS): 页眉超高 → 正文起点下移; 页脚超高 → 正文终点上移。
    // 取「已启用变体的最坏带高」, 使全文分页统一、确定 (逐页正文高度需改
    // PageBreaker, 属本轮范围外); 代价是带较矮的页面正文起止略显富余。
    let maxHeaderH = 0
    let maxFooterH = 0
    for (const set of Object.values(hfVariants)) {
      if (!set) continue
      maxHeaderH = Math.max(maxHeaderH, set.header.regionHeight)
      maxFooterH = Math.max(maxFooterH, set.footer.regionHeight)
    }
    const bodyTop = Math.max(this.config.marginTop, maxHeaderH)
    const bodyBottom = this.config.pageHeight - Math.max(this.config.marginBottom, maxFooterH)
    const bodyArea = Math.max(0, bodyBottom - bodyTop - footnoteReserve)

    const paraFirstLine = new Map<string, number>()
    // 本趟重算了哪些块。kind/shapeSame 供 M2e 判定 (同形状补丁只接受"唯一的
    // 重算段落, 且其新行与缓存旧行形状相同")。
    const recomputed: {
      paraId: string
      lineIndex: number
      lineCount: number
      kind: 'paragraph' | 'table'
      shapeSame: boolean
    }[] = []
    const nextTableKeys = new Map<string, string>()

    for (const blockId of bodyBlockSpine(doc, pool)) {
      const block = pool.nodes.get(blockId)
      if (!block) continue
      const blockType = (block as unknown as Record<string, unknown>).type as string

      if (blockType === 'section_break') {
        // 分节符: 特殊标记行, 由 PageBreaker 按 breakType 决定是否断页
        // (契约 §31.10 PHASE 1)。缺省 next_page — 与历史行为一致。
        allLines.push({
          elements: [{ id: block.id, type: 'section_break' }],
          width: contentWidth, height: 0, maxAscent: 0, maxDescent: 0,
          sectionBreakType: (block as { breakType?: ILine['sectionBreakType'] }).breakType,
        })
        continue
      }

      if (blockType === 'separator') {
        allLines.push({
          elements: [{ id: block.id, type: 'separator' }],
          width: contentWidth, height: 12, maxAscent: 6, maxDescent: 6,
        })
        continue
      }

      if (blockType === 'table') {
        // 表格: 预构建逻辑行 + 列宽, 注入可分页 hook (TablePaginator 自持游标)
        // PageBreaker 遇到 pageable 行时按当前可用高分页; SLIF 映射时按 fragment 产出。
        const tbl = block as unknown as {
          id: string; columns?: { width: number }[]; children: readonly string[]
          pageBreak?: { repeatHeader?: boolean; minRowsBeforeBreak?: number; continuationLabel?: string }
        }
        paraFirstLine.set(block.id, allLines.length)
        // 表格子树键: 只有内容/结构/计算值代次变化时才要求"从表格起始页重排"。
        // 未变化时允许分页从表格之后的页续排 (契约 §16.1)。键的构成见
        // tableLayoutKey (含域时追加域预留宽取样输入, 契约 §31.13.1)。
        const tableKey = this.tableLayoutKey(pool, block.id)
        nextTableKeys.set(block.id, tableKey)
        if (this.tableKeys.get(block.id) !== tableKey) {
          recomputed.push({ paraId: block.id, lineIndex: allLines.length, lineCount: 0, kind: 'table', shapeSame: false })
        }
        const { rows, columnWidths } = this.buildTableRows(tbl, pool, contentWidth, lineBreaker, doc)
        const pageBreak = tbl.pageBreak
        const repeatHeader = !!pageBreak?.repeatHeader
        const paginator = createTablePaginator(rows, columnWidths, {
          repeatHeader,
          headerCount: repeatHeader ? 1 : 0,
          minRowsBeforeBreak: pageBreak?.minRowsBeforeBreak,
          pageContentHeight: bodyArea,
        })
        allLines.push({
          elements: [{ id: block.id, type: 'table', value: '', tableBlock: block } as LineElement],
          width: contentWidth, height: 0, maxAscent: 0, maxDescent: 0,
          indent: 0,
          pageable: paginator,
          columnWidths,
        })
        continue
      }

      if (blockType === 'paragraph') {
        const para = block as unknown as Paragraph
        paraFirstLine.set(para.id, allLines.length)
        const elements: LineElement[] = []

        // 列表标记: 拼到第一个文本节点前面, 避免与内容重叠
        let listMarker = ''
        let savedListMarker = ''
        if (para.list) {
          const listType = para.list.type
          const level = para.list.level || 1
          const indent = '  '.repeat(level - 1)
          if (listType === 'bullet') {
            const bulletChar = para.list.bulletChar || ListParticle.resolveBulletChar(level)
            listMarker = indent + bulletChar + ' '
          } else if (listType === 'ordered') {
            const orderNum = this.computeListNumber(para.id, pool, doc, level)
            const numberStyle = para.list.numberStyle || 'decimal'
            listMarker = indent + ListParticle.formatOrderedNumberRaw(orderNum, numberStyle) + ' '
          }
          savedListMarker = listMarker
        }

        // 段落行缓存 (M2a): 命中则整段跳过元素构建与断行。
        // 列表段也可缓存 —— 编号标记已算出并进键; 前序段落变化导致编号变化时键必变。
        const cacheKey = this.paragraphCacheEnabled
          ? this.paragraphLineCacheKey(pool, para, contentWidth, savedListMarker)
          : null
        let previousLines: ILine[] | undefined
        if (cacheKey) {
          const cached = this.paragraphLineCache.get(para.id)
          if (cached && cached.key === cacheKey) {
            this.paragraphCacheHits++
            allLines.push(...cached.lines)
            continue
          }
          this.paragraphCacheMisses++
          // 旧行留作 M2e 同形状判定的基线 (键变才走到这里, 所以旧行必然过期)
          previousLines = cached?.lines
        }
        // 未命中 (或不可缓存) → 本段行要重算; 它所在页及其后页需要重排
        const recomputedEntry = {
          paraId: para.id, lineIndex: allLines.length, lineCount: 0,
          kind: 'paragraph' as const, shapeSame: false,
        }
        recomputed.push(recomputedEntry)

        // 标题样式: outlineLevel > 0 时缩放字体 + 加粗
        const outlineLevel = para.outlineLevel ?? 0
        const headingScale = outlineLevel > 0 ? (HEADING_SCALE[outlineLevel] ?? 1) : 1
        const isHeading = outlineLevel > 0

        for (const childId of para.children) {
          const child = pool.nodes.get(childId)
          if (!child) continue
          const childType = (child as unknown as Record<string, unknown>).type as string
          if (childType === 'text' || childType === 'smarttext' || childType === 'cross_reference') {
            const tn = child as unknown as TextNode
            // 控件的有效显示与可见性 (契约 §12.12.8): 计算值优先, 没有就用控件自身
            // 的值/占位符。不可见的控件**整个跳过** —— 不产出 SLIFItem, 于是自然
            // 不可命中、光标也进不去 (§12.12.5 的既定结果, 不需要额外机制)。
            const view = childType === 'smarttext'
              ? this.controlViewOf(childId, (child as SmartTextNode).element, (child as SmartTextNode).value, tn.text)
              : undefined
            if (view && !view.visible) continue
            // 交叉引用节点使用 displayText (展开 {page}/{number}, 见 resolveCrossRefDisplay)
            const textVal = childType === 'cross_reference'
              ? this.resolveCrossRefDisplay(
                  child as unknown as { id: string; refType: string; targetRef: string; displayText?: string; text?: string },
                  doc, pool,
                )
              : view
                ? view.display
                : tn.text
            const value = listMarker ? listMarker + textVal : textVal
            if (listMarker) listMarker = '' // 仅首节点添加
            // 标题: 缩放字号 + 加粗
            const baseSize = tn.size || BASE_FONT_SIZE
            const headingSize = isHeading ? Math.round(baseSize * headingScale) : undefined
            // 控件布局提示 (契约 §12.6/§12.8):
            //   - 多行文本域 minRows (layer D): 影响行高, 不决定值语义
            //   - checkbox/radio 表单模式内联渲染: 预留候选项宽 (control.width),
            //     使内联候选项不与后续文本重叠 (信息源同 controlInfoOf, 无反向推导)
            //   - 值宽于版心: 折行 + 锁盒宽 (由 smarttextLayoutHint 统一裁决)
            let control: LineElement['control']
            // 控件未显式设字体/字号时, 继承同段落文字 run (避免控件比周围文字偏大/偏小)
            const runDefault = this.paraRunDefault(pool, para.children, BASE_FONT_SIZE)
            let smartFont: string | undefined
            let smartSize: number | undefined
            if (childType === 'smarttext') {
              const info = view?.info
              const font = tn.font || runDefault.font
              const size = tn.size || runDefault.size
              smartFont = font
              smartSize = size
              const measure = (t: string) =>
                this.measurer.measureWidth(t, { font, size, bold: tn.bold, italic: tn.italic })
              // 控件盒量宽 + 超宽折行 — 单一事实源 (契约 §11/§12.8):
              // 与表格 cell / 页眉页脚同一条路径, 内容宽于可用宽即折行 + 锁盒宽,
              // 不再整块横向溢出正文区。
              // 可用宽扣除段落的块缩进/首行缩进: 行起点右移是多少, 可用宽就少多少
              // (缩进段落里的控件若按版心宽锁宽, 仍会越过版心右缘)。
              control = smarttextLayoutHint({
                value: (tn as unknown as { value?: unknown }).value,
                display: textVal,
                definition: info,
                options: info?.options,
                minRows: (child as unknown as { element?: { format?: { minRows?: number } } })
                  .element?.format?.minRows,
              }, measure, contentWidth - (para.indent ?? 0) - (para.firstLineIndent ?? 0))
            } else {
              control = undefined
            }
            elements.push({
              id: tn.id, type: childType, value,
              font: childType === 'smarttext' ? smartFont : tn.font,
              size: headingSize ?? (childType === 'smarttext' ? smartSize : tn.size),
              bold: isHeading ? true : tn.bold, italic: tn.italic,
              color: tn.color, underline: tn.underline,
              underlineStyle: (tn as { underlineStyle?: string }).underlineStyle,
              strikeout: tn.strikeout, superscript: tn.superscript, subscript: tn.subscript,
              highlight: tn.highlight,
              ...this.revisionViewOf(tn),
              control,
            })
          } else if (childType === 'image') {
            const img = child as unknown as Record<string, unknown>
            elements.push({
              id: child.id, type: 'image',
              value: '', imageData: {
                width: img.width as number,
                height: img.height as number,
                wrapType: (img.wrapMode as string) || 'inline',
              },
            })
          } else if (childType === 'footnote_ref') {
            elements.push({ id: child.id, type: 'footnote_ref', value: '' })
          } else if (childType === 'field') {
            const fn = child as unknown as Record<string, unknown>
            const fBaseSize = (fn.size as number) || BASE_FONT_SIZE
            elements.push({
              id: child.id, type: 'field', value: (fn.cachedValue as string) || '',
              font: fn.font as string, size: isHeading ? Math.round(fBaseSize * headingScale) : fn.size as number,
              bold: isHeading ? true : (fn.bold as boolean), italic: fn.italic as boolean,
              fieldType: fn.fieldType as string,
              // 量宽用代表值 (非占位符): 否则域后拖出空白, 见 FieldFormatter 注释
              fieldReserveText: representativeFieldText(
                fn.fieldType as string, fn.cachedValue as string, this.fieldReserveCtx,
              ),
            })
          }
        }

        let paraLines: ILine[]
        if (elements.length === 0) {
          // 空段落占位行 — 确保每个段落都有布局位置, 光标可定位
          const emptySize = isHeading ? Math.round(BASE_FONT_SIZE * headingScale) : BASE_FONT_SIZE
          paraLines = [{
            elements: [{ id: para.id, type: 'text', value: '' }],
            width: 0,
            height: emptySize,
            maxAscent: emptySize * 0.8,
            maxDescent: emptySize * 0.2,
            alignment: para.alignment,
            indent: para.indent,
            firstLineIndent: para.firstLineIndent,
            listMarker: savedListMarker || undefined,
          }]
        } else {
          const lines = lineBreaker.breakLines(elements, {
            maxWidth: contentWidth, wordBreak: 'break-all',
            defaultFont: 'SimSun', defaultSize: 16,
            lineHeight: para.lineHeight,
          })
          // 标记每行的段落对齐/缩进; 首行缩进仅首行
          let isFirstLine = true
          for (const line of lines) {
            line.alignment = para.alignment
            line.indent = para.indent
            if (isFirstLine) {
              line.firstLineIndent = para.firstLineIndent
              if (savedListMarker) line.listMarker = savedListMarker
              isFirstLine = false
            }
          }
          paraLines = lines
        }
        allLines.push(...paraLines)
        if (cacheKey) this.paragraphLineCache.set(para.id, { key: cacheKey, lines: paraLines })
        recomputedEntry.lineCount = paraLines.length
        if (previousLines) recomputedEntry.shapeSame = this.sameLineShape(previousLines, paraLines)
      }
    }

    // ---- 增量分页 (M2b): 只在可证明安全的文档子集上启用 ----
    let mode: 'full' | 'reuse-all' | 'resume' = 'full'
    let resumePage = 0
    let breakStartLine = 0
    let presetPages: SLIFPage[] = []
    let linesToBreak: ILine[] = allLines

    if (allowIncremental && this.pageStartLineIndex.length === this.pages.length && this.pages.length > 0) {
      if (recomputed.length === 0) {
        // 没有任何段落行变化 → 分页结果必然不变, 整份重用
        mode = 'reuse-all'
      } else {
        // M2e 同形状补丁: 脏段落行数/行高不变时页边界不可能移动, 只重建它
        // 所在的页, 前后页原样复用 (契约 §16.1)。不满足前提则回落 M2b 续排。
        const patched = this.sameShapePagePatch(
          recomputed, allLines, contentWidth, bodyTop, hfVariants, doc,
          paraFirstLine, nextTableKeys, footnoteReserve,
        )
        if (patched) return patched

        const first = recomputed[0]
        const page = this.paraPageTable.getPage(first.paraId)
        // 寡行控制会从下一页拉行回来, 所以从脏段落所在页的**前一页**续排
        let candidate = Math.max(0, page - 1)
        // 候选页若从表格中间开始, 回退到该表格的起始页: 传给 PageBreaker 的是
        // 原始行切片, 从表格中间切会丢掉前序页已承载的续排片段 (契约 §16.1)
        while (candidate > 0 && this.pageStartsInsideTable(candidate)) candidate--
        const startLine = this.pageStartLineIndex[candidate]
        if (page > 0 && startLine >= 0 && startLine <= first.lineIndex) {
          mode = 'resume'
          resumePage = candidate
          breakStartLine = startLine
          presetPages = this.pages.slice(0, candidate)
          linesToBreak = allLines.slice(startLine)
        }
      }
    }

    if (mode === 'reuse-all') {
      return {
        pages: this.pages,
        state: {
          pageStartLineIndex: this.pageStartLineIndex.slice(),
          paraFirstLine,
          tableKeys: nextTableKeys,
        },
        mode,
        reusedPages: this.pages.length,
        reusedTailPages: 0,
      }
    }

    // Step 2: PageBreaker 分页 (正文可用高 = bodyArea)
    const iPages = pageBreaker.breakPages(
      linesToBreak, [], [], pageSetup, footnoteReserve, bodyArea,
      mode === 'resume' ? resumePage : 0,
    )

    // Step 3: IPage[] → SLIFPage[] (唯一实现见 convertLinesToPage)
    const convertedPages: SLIFPage[] = iPages.map((ip: IPage) =>
      this.convertLinesToPage(ip.pageIndex, ip.lines, contentWidth, bodyTop, hfVariants, doc),
    )

    // 复用前序页 + 新排的页 (续排时 PageBreaker 已从 resumePage 开始编号)
    const slifPages: SLIFPage[] = mode === 'resume'
      ? [...presetPages, ...convertedPages]
      : convertedPages

    // Step 4: 脚注收集与布局 — **只处理本轮新排的页** (契约 §16.1)。
    // 复用页的脚注区在上轮已生成, 再收集一次会把脚注 item 重复追加到同一页对象;
    // 但编号是跨页连续的, 所以要先用复用页里的引用数播种计数器。
    const footnoteEngine = new FootnoteLayout()
    if (mode === 'resume') footnoteEngine.seedFrom(presetPages, pool)
    for (const page of convertedPages) {
      const footnotes = footnoteEngine.collectFootnotes(page, pool)
      if (footnotes.length > 0) {
        // 回填正文 (含表格 cell) 中 footnote SLIF items 的编号 — 必须展平:
        // cell 内引用同样参与编号, 只看顶层会留下 '?' 占位 (契约 §31.13.1)
        forEachPageItem(page, item => {
          if (item.type !== 'footnote') return
          const fn = footnotes.find(f => f.refId === item.nodeId)
          if (fn) item.text = String(fn.number)
        })
        const footnoteY = page.height - this.config.marginBottom - 60
        const fnItems = footnoteEngine.generateFootnoteItems(
          footnotes, footnoteY, contentWidth, this.config.marginLeft,
        )
        // 脚注区 items 追加到页面
        for (const fi of fnItems) {
          page.items.push(fi)
        }
      }
    }

    // 页起始行索引 (相对 allLines 的**输入行**下标): 前序页沿用旧表, 新页从
    // 续排起点重新累积。
    //
    // 表格只占**一个**输入行, 却可跨多页 —— 所以不能数每页承载的行数:
    //   - 表格的首个 fragment 让累积前进一行;
    //   - 同一表格的后续 fragment 不再前进, 该页的起始下标就等于"表格之后那一行"
    //     (页面从表格中间开始, 没有精确的输入行下标; 取它右侧的下标, 使
    //     pageOfLine(表格下标) 落到**首个** fragment 所在页, 而不是最后一页)。
    const pageStartLineIndex: number[] = mode === 'resume'
      ? this.pageStartLineIndex.slice(0, resumePage)
      : []
    const seenTables = new Set<string>()
    let nextInputLine = mode === 'resume' ? breakStartLine : 0
    for (const ip of iPages) {
      pageStartLineIndex.push(nextInputLine)
      for (const line of ip.lines) {
        const isTableLine = !!line.pageable || !!line.tableFragment
        if (!isTableLine) { nextInputLine++; continue }
        const tableId = (line.elements[0] as { id?: string } | undefined)?.id
        if (tableId !== undefined && !seenTables.has(tableId)) {
          seenTables.add(tableId)
          nextInputLine++
        }
      }
    }

    return {
      pages: slifPages,
      state: { pageStartLineIndex, paraFirstLine, tableKeys: nextTableKeys },
      mode,
      reusedPages: presetPages.length,
      reusedTailPages: 0,
    }
  }

  /**
   * M2e 同形状页补丁 (契约 §16.1)。
   *
   * 前提全部成立时才生效, 否则返回 null 让调用方回落 M2b 续排:
   *   - 本趟**只有一个**重算块, 且是段落, 且其新行与缓存旧行"同形状"
   *     (行数、逐行行高、段末标记都不变);
   *   - 文档无表格 (表格 fragment 让"页 ↔ 输入行切片"不再一一对应) 且无脚注
   *     (脚注区不属于正文行切片);
   *   - 页起始行表与页数组一致 (增量状态完好)。
   *
   * 为什么形状相同 ⇒ 页边界不动: PageBreaker 的决策序列只读每一行的 height、
   * pageable 与段末标记 (最后一个元素 value === '\n'), 三者都不变则整趟循环
   * 走出一模一样的分页。于是只需重建承载该段落行的页 —— 它们必须重转 (文本
   * 变了), 其余页连对象都不必换。
   */
  private sameShapePagePatch(
    recomputed: readonly {
      paraId: string
      lineIndex: number
      lineCount: number
      kind: 'paragraph' | 'table'
      shapeSame: boolean
    }[],
    allLines: ILine[],
    contentWidth: number,
    bodyTop: number,
    hfVariants: HfVariantRegions,
    doc: DocumentTree,
    paraFirstLine: Map<string, number>,
    tableKeys: Map<string, string>,
    footnoteReserve: number,
  ): LayoutPassResult | null {
    if (!this.sameShapePatchEnabled) return null
    if (recomputed.length !== 1) return null
    const only = recomputed[0]
    if (only.kind !== 'paragraph' || !only.shapeSame || only.lineCount <= 0) return null
    // 表格/脚注都让"页承载哪些输入行"不再等于页起始行表里的切片
    if (tableKeys.size > 0 || footnoteReserve > 0) return null

    const firstLine = only.lineIndex
    const lastLine = firstLine + only.lineCount - 1
    if (firstLine < 0 || lastLine >= allLines.length) return null

    const firstPage = this.pageOfLine(firstLine)
    const lastPage = this.pageOfLine(lastLine)
    if (firstPage < 0 || lastPage < firstPage || lastPage >= this.pages.length) return null

    const rebuilt: SLIFPage[] = []
    for (let p = firstPage; p <= lastPage; p++) {
      const start = this.pageStartLineIndex[p]
      const end = p + 1 < this.pageStartLineIndex.length
        ? this.pageStartLineIndex[p + 1]
        : allLines.length
      if (start < 0 || end < start || end > allLines.length) return null
      rebuilt.push(this.convertLinesToPage(p, allLines.slice(start, end), contentWidth, bodyTop, hfVariants, doc))
    }

    return {
      pages: [
        ...this.pages.slice(0, firstPage),
        ...rebuilt,
        ...this.pages.slice(lastPage + 1),
      ],
      // 页边界与输入行映射都没动 —— 直接沿用旧表
      state: { pageStartLineIndex: this.pageStartLineIndex.slice(), paraFirstLine, tableKeys },
      mode: 'resume',
      reusedPages: firstPage,
      reusedTailPages: this.pages.length - lastPage - 1,
    }
  }

  /**
   * 同形状判定 (M2e): 行数、逐行行高、逐行段末标记都相同。
   *
   * 段末标记按 PageBreaker 的判据取"最后一个元素 value === '\n'"。它不是逐段
   * 只落在段尾: 行内元素如果恰好是单独的换行也会命中, 所以逐行比较而不是只比
   * 最后一行。
   */
  private sameLineShape(a: ILine[], b: ILine[]): boolean {
    if (a.length === 0 || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i].height !== b[i].height) return false
      if (!!a[i].pageable !== !!b[i].pageable) return false
      if (lineEndsParagraph(a[i]) !== lineEndsParagraph(b[i])) return false
    }
    return true
  }

  /**
   * IPage 的行 → SLIFPage (Step 3 的唯一实现)。
   *
   * 续排后的新页与 M2e 的同形状补丁页共用这一条转换路径 —— 补丁页必须与
   * 全量排版逐字节相同, 所以不允许第二份实现。
   *
   * 逐行产出 SLIF items: 表格 fragment / 分隔符 / 脚注引用占位 / 图片 / 文本。
   * 页眉页脚按**本页页码**取生效变体 (契约 §7.9); 同一变体各页共享 items。
   */
  private convertLinesToPage(
    pageIndex: number,
    pageLines: ILine[],
    contentWidth: number,
    bodyTop: number,
    hfVariants: HfVariantRegions,
    doc: DocumentTree,
  ): SLIFPage {
    const measurer = this.measurer
    let y = bodyTop
    const items: SLIFItem[] = []
    for (const line of pageLines) {
      const firstEl = line.elements[0]

      // 表格: 直接消费 PageBreaker 已产出的 fragment (headerRows + bodyRows)
      if (line.tableFragment) {
        const frag = line.tableFragment
        const tbl = (firstEl as LineElement).tableBlock as { id: string } | undefined
        items.push(this.createTableItemFromFragment(
          tbl?.id ?? firstEl.id, frag, contentWidth, y, line.columnWidths || [],
        ))
        y += line.height
        continue
      }

      if (line.height === 0) continue // 跳过 section_break 标记行
      if (firstEl?.type === 'separator') {
        items.push({
          nodeId: firstEl.id, nodeType: 'separator', type: 'separator',
          x: this.config.marginLeft, y, width: contentWidth, height: line.height,
          ascent: line.maxAscent, descent: line.maxDescent,
          font: 'SimSun', size: 12,
        })
        y += line.height
        continue
      }
      // 行起始 X (对齐/缩进后) — 元素级 X 累积基准 (修复拆分节点后多 item 重叠/选区偏移)
      // 块缩进 indent 每行生效; 首行缩进 firstLineIndent 仅首行 (LineBreaker 已只给首行赋值)。
      let lineStartX = this.config.marginLeft + (line.indent ?? 0) + (line.firstLineIndent ?? 0)
      if (line.alignment === 'center') {
        lineStartX = this.config.marginLeft + (contentWidth - line.width) / 2 + (line.indent ?? 0) + (line.firstLineIndent ?? 0)
      } else if (line.alignment === 'right') {
        lineStartX = this.config.marginLeft + contentWidth - line.width
      }
      let cursorX = lineStartX
      for (const el of line.elements) {
        if (el.type === 'section_break') continue
        if (el.type === 'footnote_ref') {
          // 脚注引用: 生成占位 SLIF item, 编号在 Step 4 回填
          const fnCharHeight = measurer.getLineHeight({ font: el.font || 'SimSun', size: el.size || 12 })
          items.push({
            nodeId: el.id, nodeType: 'footnote_ref', type: 'footnote',
            x: this.config.marginLeft + (line.indent ?? 0), y,
            width: 12, height: fnCharHeight,
            ascent: fnCharHeight * 0.8, descent: fnCharHeight * 0.2,
            font: el.font || 'SimSun', size: el.size || 12,
            text: '?',  // 占位, Step 4 回填为正确编号
            superscript: true,
          })
          continue
        }
        if (el.type === 'image') {
          const imgEl = el as { imageData?: { width?: number; height?: number } }
          const iw = imgEl.imageData?.width || contentWidth
          const ih = imgEl.imageData?.height || 200
          items.push({
            nodeId: el.id, nodeType: 'image', type: 'image',
            x: this.config.marginLeft, y,
            width: Math.min(iw, contentWidth), height: ih,
            ascent: ih, descent: 0,
            font: 'SimSun', size: 12,
          })
          continue
        }
        const charHeight = measurer.getLineHeight({ font: el.font || 'SimSun', size: el.size || 16 })

        // 元素级 X: 从行内累积游标取值 (而非整行同一起点), 修复拆分节点后多 item 重叠/选区偏移
        let itemX = cursorX

        // 列表标记: 从首元素 text 中剥离, 通过 listMarker 字段传给 Draw
        let itemText: string | undefined = el.value
        let itemListMarker: string | undefined = line.listMarker
        let itemMarkerWidth: number | undefined
        const markerX = itemX  // 保存标记原始位置 (shift 前)
        if (itemListMarker && itemText && itemText.startsWith(itemListMarker)) {
          itemText = itemText.slice(itemListMarker.length)
          // 测量标记宽度, 偏移正文 x
          const markerW = measurer.measure(itemListMarker, {
            font: el.font || 'SimSun', size: el.size || 16,
            bold: el.bold, italic: el.italic,
          })
          itemMarkerWidth = markerW.width
          itemX += markerW.width
        } else {
          itemListMarker = undefined // 非首元素不带标记
        }

        // 元素实际渲染宽度 (与 LineBreaker 同源度量), 供 x 累积 + hit-test 精确命中。
        // smarttext 是原子控件: 布局 advance 取「盒宽」= 文本宽 + 2*内边距 (与
        // LineBreaker.getElementWidth 同源), 否则相邻控件盒重叠、且换行不生效。
        const isSmart = el.type === 'smarttext'
        // 离散控件内联渲染: 预留候选项宽 (control.width), 与 LineBreaker 同源。
        // PageLayout.ILine.elements 是窄化类型 (无 control), 运行时仍保留该字段, 故回 cast。
        const elControl = (el as LineElement).control
        const controlWidth = isSmart && typeof elControl?.width === 'number' && elControl.width > 0
          ? elControl.width
          : undefined
        // 域代码: 按代表值量宽 (非模型占位符 '[总页数]'), 与 LineBreaker 同源。
        // 否则预留宽远大于渲染期解析出的 '3' → 域后拖出一大片空白。
        const reserveText = el.type === 'field'
          ? ((el as LineElement).fieldReserveText ?? itemText)
          : itemText
        const itemWidth = controlWidth !== undefined
          ? controlWidth
          : measurer.measureWidth(reserveText || '', {
              font: el.font || 'SimSun', size: el.size || 16,
              bold: el.bold, italic: el.italic,
            })
        const advanceWidth = itemWidth + (isSmart ? CONTROL_BOX_PADDING * 2 : 0)

        items.push({
          nodeId: el.id, nodeType: el.type, type: el.type,
          text: itemText,
          x: itemX, y, width: (itemMarkerWidth || 0) + itemWidth,
          height: charHeight,
          ascent: line.maxAscent, descent: line.maxDescent,
          font: el.font || 'SimSun', size: el.size || 16,
          bold: el.bold, italic: el.italic,
          color: el.color, underline: el.underline,
          underlineStyle: (el as { underlineStyle?: string }).underlineStyle,
          strikeout: el.strikeout, superscript: el.superscript, subscript: el.subscript,
          highlight: (el as { highlight?: string }).highlight,
          revision: (el as LineElement).revision,
          listMarker: itemListMarker,            listMarkerX: itemListMarker ? markerX : undefined,
          markerWidth: itemMarkerWidth,
          controlLines: isSmart ? elControl?.lines : undefined,
          wrapWidth: isSmart ? elControl?.wrapWidth : undefined,
          fieldType: (el as { fieldType?: string }).fieldType,
        })

        // 推进元素级 X 游标 (标记宽度 + 正文宽度 [+ 控件盒内边距])
        cursorX += (itemMarkerWidth || 0) + advanceWidth
      }
      y += line.height
    }

    // 页眉/页脚 — 按本页页码取生效变体 (契约 §7.9)。
    // 同一变体各页共享同一 items 数组 (不做逐页复制)。
    const hfSet = hfVariants[resolveVariantForPage(doc, pageIndex + 1)] ?? hfVariants.default!
    return {
      pageIndex, width: this.config.pageWidth, height: this.config.pageHeight, items,
      headerItems: hfSet.header.items, footerItems: hfSet.footer.items,
      headerHeight: hfSet.header.regionHeight, footerHeight: hfSet.footer.regionHeight,
    }
  }

  getPages(): SLIFPage[] { return this.pages }

  /**
   * 将 Table 节点展开为 SLIFRow[] + columnWidths (Phase 1, v21.0)
   *
   * 列宽优先级 (对齐 Word): fixed > percentage > auto
   *   - fixed: ColumnDefinition.width 为像素宽
   *   - percentage: ColumnDefinition.width 为百分比 (0-100), 基于 contentWidth 换算
   *   - auto / 无 mode: 剩余宽度均匀分配
   *
   * cell x 位置按累积列宽计算 (支持非均匀列宽)。
   */
  private buildTableRows(
    table: {
      id: string
      columns?: { width: number; minWidth?: number; mode?: 'fixed' | 'percentage' | 'auto' }[]
      children: readonly string[]
      pageBreak?: { repeatHeader?: boolean; minRowsBeforeBreak?: number; continuationLabel?: string }
    },
    pool: NodePool,
    contentWidth: number,
    lineBreaker: LineBreaker,
    doc: DocumentTree,
  ): { rows: SLIFRow[]; columnWidths: number[] } {
    const CELL_PAD = 6
    const MIN_ROW_HEIGHT = 24

    const colDefs = table.columns
    const numCols = colDefs?.length || 2
    const columnWidths = this.computeColumnWidths(colDefs || [], numCols, contentWidth)

    // 计算列累积 X (用于 cell x 定位)
    const cumulativeX: number[] = [0]
    for (let i = 0; i < columnWidths.length - 1; i++) {
      cumulativeX.push(cumulativeX[i] + columnWidths[i])
    }

    // 预收集行节点 + 声明行高 (rowspan 合并高度基准)
    const rowNodes = table.children
      .map(id => pool.nodes.get(id) as { type?: string; height?: number; children: readonly string[] } | undefined)
      .filter((n): n is { type?: string; height?: number; children: readonly string[] } => !!n && n.type === 'row')
    const numRows = rowNodes.length
    const rowHeights = rowNodes.map(r => Math.max(r.height || MIN_ROW_HEIGHT, MIN_ROW_HEIGHT))

    // 占用矩阵: 追踪 colspan/rowspan 已占用的格子
    const matrix = new MergeMatrix(numRows, columnWidths.length)

    // ---- 第一遍: 布局每个 cell 的内容 (换行 + 多段落), 记录 (row,col) 定位 + contentHeight ----
    interface CellLayout {
      id: string
      row: number
      col: number
      colspan: number
      rowspan: number
      x: number
      width: number
      isHeader?: boolean
      backgroundColor?: string
      verticalAlign?: 'top' | 'middle' | 'bottom'
      items: SLIFItem[]
      contentHeight: number
    }
    const cellLayouts: CellLayout[] = []

    for (let ri = 0; ri < numRows; ri++) {
      const row = rowNodes[ri]
      // colCursor: 当前单元格的起始列索引 (跳过 rowspan/colspan 已占用的列)
      let colCursor = 0
      for (const cellId of row.children) {
        while (colCursor < columnWidths.length && matrix.isOccupied(ri, colCursor)) colCursor++
        if (colCursor >= columnWidths.length) break

        const cell = pool.nodes.get(cellId) as {
          type?: string; colspan?: number; rowspan?: number
          isHeader?: boolean; backgroundColor?: string
          verticalAlign?: 'top' | 'middle' | 'bottom'; children: readonly string[]
        } | undefined
        if (!cell) continue

        const cellSpan = cell.colspan || 1
        const rowSpan = cell.rowspan || 1
        let cellWidth = 0
        for (let s = 0; s < cellSpan && colCursor + s < columnWidths.length; s++) {
          cellWidth += columnWidths[colCursor + s] || 40
        }
        if (cellWidth === 0) cellWidth = 40

        // 布局 cell 内文本: 换行 + 多段落堆叠 (y 从 0 顶部对齐)
        const { items, contentHeight } = this.layoutCellItems(cell.children, cellWidth, pool, lineBreaker, CELL_PAD, doc)

        cellLayouts.push({
          id: cellId, row: ri, col: colCursor,
          colspan: cellSpan, rowspan: rowSpan,
          x: cumulativeX[colCursor] || 0, width: cellWidth,
          isHeader: cell.isHeader, backgroundColor: cell.backgroundColor,
          verticalAlign: cell.verticalAlign,
          items, contentHeight,
        })

        matrix.placeCell(cellId, ri, colCursor, cellSpan, rowSpan)
        colCursor += cellSpan
      }
    }

    // ---- 第二遍: 根据内容高度增长行高 (避免换行文本溢出/与下一行重叠) ----
    for (const cl of cellLayouts) {
      // cell 渲染高度 = sum(行高) + (rowSpan-1) 个 1px 行间隙
      // 内容需满足: sum(行高) >= contentHeight + 2*CELL_PAD - (rowSpan-1)
      const need = cl.contentHeight + CELL_PAD * 2 - (cl.rowspan - 1)
      if (cl.rowspan <= 1) {
        if (rowHeights[cl.row] < need) rowHeights[cl.row] = need
      } else {
        let spanH = 0
        for (let s = 0; s < cl.rowspan && cl.row + s < numRows; s++) {
          spanH += rowHeights[cl.row + s]
        }
        if (spanH < need) {
          const lastRow = Math.min(cl.row + cl.rowspan - 1, numRows - 1)
          rowHeights[lastRow] += need - spanH
        }
      }
    }

    // ---- 第三遍: 构建 SLIFRow[] (应用行高增长 + 垂直对齐) ----
    const rows: SLIFRow[] = []
    for (let ri = 0; ri < numRows; ri++) {
      const cells: SLIFCell[] = []
      for (const cl of cellLayouts) {
        if (cl.row !== ri) continue

        // 合并单元格高度 = 从 ri 起的 rowspan 行高之和 + (rowSpan-1) 个 1px 间隙
        let cellHeight = 0
        for (let s = 0; s < cl.rowspan && ri + s < numRows; s++) {
          cellHeight += rowHeights[ri + s]
        }
        cellHeight += cl.rowspan - 1
        if (cellHeight < MIN_ROW_HEIGHT) cellHeight = MIN_ROW_HEIGHT

        // 垂直对齐: 内容顶部偏移 (默认 top)
        let contentTop = CELL_PAD
        if (cl.verticalAlign === 'middle') {
          contentTop = Math.max(CELL_PAD, Math.floor((cellHeight - cl.contentHeight) / 2))
        } else if (cl.verticalAlign === 'bottom') {
          contentTop = Math.max(CELL_PAD, cellHeight - cl.contentHeight - CELL_PAD)
        }

        const items = cl.items.map(it => ({ ...it, y: it.y + contentTop }))

        cells.push({
          id: cl.id,
          x: cl.x, y: 0,
          width: cl.width, height: cellHeight,
          colspan: cl.colspan > 1 ? cl.colspan : undefined,
          rowspan: cl.rowspan > 1 ? cl.rowspan : undefined,
          isHeader: cl.isHeader,
          backgroundColor: cl.backgroundColor,
          items,
        })
      }
      rows.push({ height: rowHeights[ri], cells })
    }

    return { rows, columnWidths }
  }

  /**
   * 布局单元格内文本 — 换行 + 多段落堆叠 (Phase 3, v21.0)
   *
   * @param blockIds   cell 内的子块 ID 列表 (段落 / 嵌套表, 契约 §31.13)
   * @param cellWidth  单元格内容区宽度 (px)
   * @returns 已布局的文本 items (y 为 cell 局部坐标, 顶部对齐从 0 开始) + 内容总高度
   */
  /**
   * 布局 cell 内的子块: 段落 + **嵌套表** (契约 §31.13)。
   *
   * cell 的合法**块级**子节点是 paragraph | table; 块内段落消费与正文完全相同的
   * 行内集合 (text/smarttext/image/field/cross_reference/footnote_ref,
   * bookmark/comment_marker 零宽) —— 契约 §31.13.1。此前这里只认 text/smarttext,
   * 域/图片/脚注/交叉引用被静默跳过; 遇到嵌套表时又因 `elements.length === 0`
   * 落到"空段落"分支 —— 整个 cell 被当成一个空行。两者都是 §31.5 禁止的失败模式:
   * 内容既没排版也不占高, 文档看起来像被删除了。
   *
   * 非法类型 (Section / separator 等) 在此**抛错**: 三层边界 (NodePool /
   * Loader / Importer) 已保证它们进不来, 走到这里即数据损坏, 不该被当成空段落。
   */
  private layoutCellItems(
    blockIds: readonly string[],
    cellWidth: number,
    pool: NodePool,
    lineBreaker: LineBreaker,
    CELL_PAD: number,
    doc: DocumentTree,
  ): { items: SLIFItem[]; contentHeight: number } {
    const items: SLIFItem[] = []
    const maxTextWidth = Math.max(cellWidth - CELL_PAD * 2, 1)
    const DEFAULT_SIZE = BASE_FONT_SIZE
    let lineY = 0

    for (const blockId of blockIds) {
      const block = pool.nodes.get(blockId) as
        { type?: string; children?: readonly string[] } | undefined
      if (!block) continue

      // 嵌套表: 递归布局, 作为一个块级 item 占位 (cell 局部坐标)
      if (block.type === 'table') {
        const nested = block as unknown as {
          id: string; columns?: { width: number }[]; children: readonly string[]
          pageBreak?: { repeatHeader?: boolean }
        }
        const { rows, columnWidths } = this.buildTableRows(nested, pool, maxTextWidth, lineBreaker, doc)
        const height = nestedTableHeight(rows)
        items.push({
          nodeId: blockId, nodeType: 'table', type: 'table',
          x: 0, y: lineY,
          width: maxTextWidth, height,
          ascent: height, descent: 0,
          font: 'SimSun', size: DEFAULT_SIZE,
          rows,
          columnWidths,
        })
        lineY += height
        continue
      }

      if (block.type !== 'paragraph') {
        throw new Error(
          `LayoutEngine.layoutCellItems: illegal cell child type ${String(block.type)} ` +
          `(node ${blockId}) — contract §31.13`,
        )
      }

      const para = block
      const elements: LineElement[] = []

      if (para?.children) {
        for (const textId of para.children) {
          const child = pool.nodes.get(textId) as {
            type?: string; text?: string; font?: string; size?: number
            bold?: boolean; italic?: boolean; color?: string
            underline?: boolean; strikeout?: boolean
            superscript?: boolean; subscript?: boolean
            value?: unknown; element?: { format?: { enums?: { multiple?: boolean; data?: ElementEnumOption[] }; minRows?: number } }
            width?: number; height?: number; wrapMode?: string
            cachedValue?: string; fieldType?: string
            refType?: string; targetRef?: string; displayText?: string
          } | undefined
          if (!child) continue
          const childType = child.type
          if (childType === 'text' || childType === 'smarttext' || childType === 'cross_reference') {
            // 控件有效显示与可见性 — 与正文同一入口 (契约 §12.12.8 / §12.12.5)
            const view = childType === 'smarttext'
              ? this.controlViewOf(
                  textId, (child as SmartTextNode).element, (child as SmartTextNode).value,
                  (child as { text: string }).text,
                )
              : undefined
            if (view && !view.visible) continue
            // 交叉引用: 与正文同一解析器 (契约 §31.13.1) —— 同一份页映射,
            // 不在 cell 路径里重写一份展开逻辑。
            const textVal = childType === 'cross_reference'
              ? this.resolveCrossRefDisplay(
                  child as unknown as { id: string; refType: string; targetRef: string; displayText?: string; text?: string },
                  doc, pool,
                )
              : view
                ? view.display
                : (child.text || '')
            let control: LineElement['control']
            // 控件未显式设字体/字号时继承同段落文字 run (与正文同源)
            const runDefault = this.paraRunDefault(pool, para.children, DEFAULT_SIZE)
            let font = child.font
            let size = child.size
            if (childType === 'smarttext') {
              const cFont: string = child.font || runDefault.font
              const cSize: number = child.size || runDefault.size
              font = cFont
              size = cSize
              const measure = (t: string) =>
                this.measurer.measureWidth(t, { font: cFont, size: cSize, bold: child.bold, italic: child.italic })
              const info = view?.info
              control = smarttextLayoutHint({
                value: child.value,
                display: textVal,
                definition: info,
                options: info?.options,
                minRows: child.element?.format?.minRows,
              }, measure, maxTextWidth)
            }
            elements.push({
              id: textId, type: childType, value: textVal,
              font, size, bold: child.bold, italic: child.italic,
              color: child.color, underline: child.underline, strikeout: child.strikeout,
              superscript: child.superscript, subscript: child.subscript,
              ...this.revisionViewOf(child as { revision?: { type: string }; strikeout?: boolean }),
              control,
            })
          } else if (childType === 'image') {
            // 图片: 自包含行内原子, 尺寸在节点上; 超宽按 cell 文本宽钳制
            elements.push({
              id: textId, type: 'image', value: '',
              imageData: {
                width: Math.min(child.width || maxTextWidth, maxTextWidth),
                height: child.height || 100,
                wrapType: child.wrapMode || 'inline',
              },
            })
          } else if (childType === 'footnote_ref') {
            elements.push({ id: textId, type: 'footnote_ref', value: '' })
          } else if (childType === 'field') {
            // 域: 量宽用代表值 (与正文/页眉页脚同一函数), 显示值在渲染期解析
            elements.push({
              id: textId, type: 'field', value: child.cachedValue || '',
              font: child.font, size: child.size, bold: child.bold, italic: child.italic,
              fieldType: child.fieldType,
              fieldReserveText: representativeFieldText(
                child.fieldType || '', child.cachedValue || '', this.fieldReserveCtx,
              ),
            })
          } else if (childType === 'bookmark' || childType === 'comment_marker') {
            // 零宽定位标记 (契约 §31.13.1): 合法但不占排版宽度, 无 item。
            continue
          } else {
            // 声明集合之外的段落子节点 = §31.13 违规。静默跳过会让内容凭空
            // 消失 (§31.5), 所以这里必须抛。
            throw new Error(
              `LayoutEngine.layoutCellItems: illegal inline child type ${String(childType)} ` +
              `(node ${textId}) — contract §31.13.1`,
            )
          }
        }
      }

      if (elements.length === 0) {
        // 空段落: 占一行 (默认行高), 附带空占位 item 供光标定位
        const blankH = DEFAULT_SIZE
        items.push({
          nodeId: blockId, nodeType: 'text', type: 'text',
          x: 0, y: lineY, width: 0, height: blankH,
          ascent: blankH * 0.8, descent: blankH * 0.2,
          font: 'SimSun', size: DEFAULT_SIZE, text: '',
        })
        lineY += blankH
        continue
      }

      const lines = lineBreaker.breakLines(elements, {
        maxWidth: maxTextWidth, wordBreak: 'break-all',
        defaultFont: 'SimSun', defaultSize: DEFAULT_SIZE,
        lineHeight: (para as { lineHeight?: number } | undefined)?.lineHeight,
      })

      for (const line of lines) {
        // 逐元素计算行内 x 偏移 (多样式 run 正确拼接)
        let elX = 0
        for (const el of line.elements) {
          if (el.type === 'smarttext') {
            const elControl = (el as LineElement).control
            const layoutW = (typeof elControl?.width === 'number' && elControl.width > 0)
              ? elControl.width
              : this.measurer.measureWidth(el.value || '', {
                  font: el.font || 'SimSun', size: el.size || DEFAULT_SIZE,
                  bold: el.bold, italic: el.italic,
                })
            items.push({
              nodeId: el.id, nodeType: 'smarttext', type: 'smarttext',
              x: elX, y: lineY,
              width: layoutW, height: line.height,
              ascent: line.maxAscent, descent: line.maxDescent,
              font: el.font || 'SimSun', size: el.size || DEFAULT_SIZE,
              bold: el.bold, italic: el.italic,
              color: el.color, underline: el.underline, strikeout: el.strikeout,
              superscript: el.superscript, subscript: el.subscript,
              text: el.value || '',
              // 超宽折行的物理行 (契约 §12.8) — 与正文同源, 否则 cell 内控件
              // 折行后仍按单行绘制 (值被截在盒外)
              controlLines: elControl?.lines,
              wrapWidth: elControl?.wrapWidth,
            })
            elX += layoutW + CONTROL_BOX_PADDING * 2
            continue
          }
          if (el.type === 'image') {
            // cell 内图片: 与正文同为原子 item (契约 §31.13.1), 宽度已在元素上
            // 按 cell 文本宽钳制; x 跟随行内游标, 不再固定贴 cell 左缘。
            const img = el as { imageData?: { width?: number; height?: number } }
            const iw = Math.min(img.imageData?.width || maxTextWidth, maxTextWidth)
            const ih = img.imageData?.height || 100
            items.push({
              nodeId: el.id, nodeType: 'image', type: 'image',
              x: elX, y: lineY,
              width: iw, height: ih,
              ascent: ih, descent: 0,
              font: 'SimSun', size: DEFAULT_SIZE,
            })
            elX += iw
            continue
          }
          if (el.type === 'footnote_ref') {
            // 占位 item, 编号由页级 Step 4 回填 (含 cell 内引用, 契约 §31.13.1)
            const fnHeight = this.measurer.getLineHeight({ font: el.font || 'SimSun', size: el.size || 12 })
            items.push({
              nodeId: el.id, nodeType: 'footnote_ref', type: 'footnote',
              x: elX, y: lineY,
              width: 12, height: fnHeight,
              ascent: fnHeight * 0.8, descent: fnHeight * 0.2,
              font: el.font || 'SimSun', size: el.size || 12,
              text: '?', superscript: true,
            })
            elX += 12
            continue
          }
          if (el.type !== 'text' && el.type !== 'field' && el.type !== 'cross_reference') continue
          // 域按代表值量宽 (与正文/页眉页脚同源); 交叉引用按解析后的显示文本量宽
          const reserve = el.type === 'field'
            ? ((el as LineElement).fieldReserveText ?? el.value)
            : el.value
          const elWidth = this.measurer.measureWidth(reserve || '', {
            font: el.font || 'SimSun', size: el.size || DEFAULT_SIZE,
            bold: el.bold, italic: el.italic,
          })
          items.push({
            nodeId: el.id, nodeType: el.type, type: el.type,
            x: elX, y: lineY,
            width: elWidth, height: line.height,
            ascent: line.maxAscent, descent: line.maxDescent,
            font: el.font || 'SimSun', size: el.size || DEFAULT_SIZE,
            bold: el.bold, italic: el.italic,
            color: el.color, underline: el.underline, strikeout: el.strikeout,
            superscript: el.superscript, subscript: el.subscript,
            revision: el.revision,
            fieldType: el.type === 'field' ? (el as LineElement).fieldType : undefined,
            text: el.value || '',
          })
          elX += elWidth
        }
        lineY += line.height
      }
    }

    return { items, contentHeight: lineY }
  }

  /**
   * 计算表格列宽 — 实现 fixed > percentage > auto 优先级 (Phase 1, v21.0)
   *
   * @param colDefs      ColumnDefinition[]
   * @param numCols      实际列数
   * @param contentWidth 表格可用内容宽度 (contentWidth)
   * @returns 每列像素宽度数组
   */
  private computeColumnWidths(
    colDefs: { width: number; minWidth?: number; mode?: 'fixed' | 'percentage' | 'auto' }[],
    numCols: number,
    contentWidth: number,
  ): number[] {
    const MIN_WIDTH = 40
    const widths: number[] = new Array(numCols).fill(0)
    const accounted = new Array(numCols).fill(false)

    // Phase 1: fixed 列 — 直接使用 width
    let usedWidth = 0
    for (let i = 0; i < colDefs.length && i < numCols; i++) {
      const def = colDefs[i]
      if (def.mode === 'fixed') {
        widths[i] = Math.max(def.width || MIN_WIDTH, def.minWidth || MIN_WIDTH)
        accounted[i] = true
        usedWidth += widths[i]
      }
    }

    // Phase 2: percentage 列 — 按 contentWidth 百分比计算
    for (let i = 0; i < colDefs.length && i < numCols; i++) {
      const def = colDefs[i]
      if (def.mode === 'percentage' && !accounted[i]) {
        const pct = Math.min(100, Math.max(0, def.width || 0))
        widths[i] = Math.max(Math.floor(contentWidth * pct / 100), def.minWidth || MIN_WIDTH)
        accounted[i] = true
        usedWidth += widths[i]
      }
    }

    // Phase 3: auto / 未指定 mode — 剩余宽度均匀分配
    const autoCols = accounted.filter(a => !a).length
    if (autoCols > 0) {
      const remaining = Math.max(0, contentWidth - usedWidth)
      const autoWidth = Math.max(MIN_WIDTH, Math.floor(remaining / autoCols))
      for (let i = 0; i < numCols; i++) {
        if (!accounted[i]) {
          widths[i] = autoWidth
        }
      }
    }

    // 兜底: 无 colDefs 的列 (numCols > colDefs.length)
    for (let i = 0; i < numCols; i++) {
      if (widths[i] === 0) {
        widths[i] = Math.max(MIN_WIDTH, Math.floor(contentWidth / numCols))
      }
    }

    return widths
  }

  /** 从 TableFragment 创建表格 SLIFItem — rows = 本页 bodyRows, headerRows 单独存 (硬约束 1) */
  private createTableItemFromFragment(
    tableId: string, frag: TableFragment, contentWidth: number,
    y: number, columnWidths: number[],
  ): import('./SLIF').SLIFItem {
    return {
      nodeId: tableId, nodeType: 'table', type: 'table',
      x: this.config.marginLeft, y,
      width: contentWidth, height: frag.height,
      ascent: frag.height, descent: 0,
      font: 'SimSun', size: 12,
      rows: frag.bodyRows,
      headerRows: frag.headerRows.length > 0 ? frag.headerRows : undefined,
      columnWidths,
    }
  }

  private computeListNumber(paraId: string, pool: import('../../document/core/NodePool').NodePool, doc: DocumentTree, level: number): number {
    let count = 0
    let lastOrderedCount = 0  // 记住上一个有序列表序列的计数，供 continueNumbering 使用

    // 编号序列必须走块级逻辑流 (契约 §31.3 W2): 否则 Section 内的有序列表
    // 在 Section 边界处重新从 1 开始 (Section 自身不是块, 不计入序列)。
    for (const bid of bodyBlockSpine(doc, pool)) {
      const b = pool.nodes.get(bid) as Record<string, unknown> | undefined
      const bl = b?.list as { type?: string; level?: number; startAt?: number; continueNumbering?: boolean } | undefined

      if (bid === paraId) {
        // continueNumbering: 当前段跟在非列表段落后仍延续编号
        if (bl?.continueNumbering && count === 0 && lastOrderedCount > 0) {
          count = lastOrderedCount
        }
        // startAt: 显式指定起始编号 (优先级最高)
        if (bl?.startAt && bl.startAt > 0) {
          return bl.startAt
        }
        return count + 1
      }

      if (bl?.type === 'ordered' && (bl?.level || 1) === level) {
        count++
        lastOrderedCount = count
      } else {
        count = 0
      }
    }
    return 1
  }

  /**
   * 布局页眉/页脚段落内容 → SLIFItem[]
   * 每个 page 独立布局, y 坐标相对于页眉/页脚区顶部
   */
  /**
   * 收集页眉/页脚段落 → 折行 ILine[] (WPS 式多行)。
   * 空段/无可布局子节点 → 推占位行, 使 Enter 拆出的新空段有行、光标可落。
   */
  private collectHFParagraphLines(
    blockIds: readonly string[] | undefined,
    pool: NodePool,
    lineBreaker: LineBreaker,
    measurer: TextMeasurer,
    contentWidth: number,
  ): ILine[] {
    if (!blockIds || blockIds.length === 0) return []
    const allLines: ILine[] = []

    for (const blockId of blockIds) {
      const block = pool.nodes.get(blockId)
      if (!block) continue
      if ((block as unknown as Record<string, unknown>).type !== 'paragraph') continue
      const para = block as unknown as Paragraph
      const elements: LineElement[] = []

      for (const childId of para.children) {
        const child = pool.nodes.get(childId)
        if (!child) continue
        const childType = (child as unknown as Record<string, unknown>).type as string
        if (childType === 'text' || childType === 'smarttext') {
          const tn = child as unknown as TextNode
          // smarttext: 计算值优先, 无则值/占位符 (与正文一致); text: 原文。
          // 不可见的控件**整个跳过** —— 与正文/表格 cell 同一处置 (§12.12.5)。
          const view = childType === 'smarttext'
            ? this.controlViewOf(tn.id, (child as SmartTextNode).element, (child as SmartTextNode).value, tn.text)
            : undefined
          if (view && !view.visible) continue
          const display = view ? view.display : tn.text
          // 控件预留宽 (与正文一致): checkbox/radio 候选组 / 方括号+affordance,
          // 否则纯文本宽。使页眉内控件不与后续文字/选项重叠。
          let control: LineElement['control']
          let smartFont: string | undefined
          let smartSize: number | undefined
          if (childType === 'smarttext') {
            const info = view?.info
            const rd = this.paraRunDefault(pool, para.children, BASE_FONT_SIZE)
            const font = tn.font || rd.font
            const size = tn.size || rd.size
            smartFont = font
            smartSize = size
            const measure = (t: string) => measurer.measureWidth(t, { font, size, bold: tn.bold, italic: tn.italic })
            // 与正文/表格 cell 共用量宽 + 折行 (契约 §12.8): 页眉页脚内控件同样
            // 不得横向溢出带区 (可用宽扣除段落首行缩进)。
            control = smarttextLayoutHint({
              value: (child as { value?: unknown }).value,
              display,
              definition: info,
              options: info?.options,
              minRows: (child as unknown as { element?: { format?: { minRows?: number } } })
                .element?.format?.minRows,
            }, measure, contentWidth - (para.firstLineIndent ?? 0))
          }
          elements.push({
            id: tn.id, type: childType, value: display, control,
            font: childType === 'smarttext' ? smartFont : tn.font,
            size: childType === 'smarttext' ? smartSize : tn.size, bold: tn.bold, italic: tn.italic,
            color: tn.color, underline: tn.underline,
            strikeout: tn.strikeout, superscript: tn.superscript, subscript: tn.subscript,
            ...(childType === 'text' ? this.revisionViewOf(tn) : {}),
          })
        } else if (childType === 'field') {
          const fn = child as unknown as Record<string, unknown>
          elements.push({
            id: child.id, type: 'field', value: (fn.cachedValue as string) || '',
            font: fn.font as string, size: fn.size as number,
            bold: fn.bold as boolean, italic: fn.italic as boolean,
            fieldType: fn.fieldType as string,
            // 量宽用代表值 (非占位符): 页脚 '第[域]页 共[域]页' 不再拖出空白
            fieldReserveText: representativeFieldText(
              fn.fieldType as string, fn.cachedValue as string, this.fieldReserveCtx,
            ),
          })
        }
      }

      if (elements.length === 0) {
        // 空段占位行 (对照正文空段) — Enter 拆出的新空段在此有行可画、光标可落
        const hEmpty = measurer.getLineHeight({ font: 'SimSun', size: BASE_FONT_SIZE })
        allLines.push({
          elements: [{ id: para.id, type: 'text', value: '' }],
          width: 0,
          height: hEmpty,
          maxAscent: hEmpty * 0.8,
          maxDescent: hEmpty * 0.2,
          alignment: para.alignment || 'left',
        })
        continue
      }

      const lines = lineBreaker.breakLines(elements, {
        maxWidth: contentWidth, wordBreak: 'break-all',
        defaultFont: 'SimSun', defaultSize: BASE_FONT_SIZE,
        lineHeight: (para as Paragraph).lineHeight,
      })
      let isFirst = true
      for (const line of lines) {
        line.alignment = para.alignment || 'left' // 页眉页脚默认左对齐 (WPS)
        if (isFirst) { line.firstLineIndent = (para as Paragraph).firstLineIndent; isFirst = false }
      }
      allLines.push(...lines)
    }
    return allLines
  }

  /** 单个带 (header|footer) 的区域布局 — 折行 + 带内定位 */
  private layoutHfBand(
    kind: 'header' | 'footer',
    ids: readonly string[] | undefined,
    pool: NodePool,
    lineBreaker: LineBreaker,
    measurer: TextMeasurer,
    contentWidth: number,
  ): HfRegion {
    const lines = this.collectHFParagraphLines(ids, pool, lineBreaker, measurer, contentWidth)
    return this.layoutHFRegion(kind, lines, measurer, contentWidth)
  }

  /**
   * 逐页页眉/页脚变体布局 (契约 §7.9)。
   * default 恒算 (等价历史行为); first / even 仅在对应开关开启时才算 — 惰性。
   */
  private buildHfVariants(
    doc: DocumentTree,
    pool: NodePool,
    lineBreaker: LineBreaker,
    measurer: TextMeasurer,
    contentWidth: number,
  ): HfVariantRegions {
    const build = (
      headerIds: readonly string[] | undefined,
      footerIds: readonly string[] | undefined,
    ): { header: HfRegion; footer: HfRegion } => ({
      header: this.layoutHfBand('header', headerIds, pool, lineBreaker, measurer, contentWidth),
      footer: this.layoutHfBand('footer', footerIds, pool, lineBreaker, measurer, contentWidth),
    })

    const out: HfVariantRegions = { default: build(doc.header, doc.footer) }
    if (isVariantEnabled(doc, 'first')) {
      out.first = build(doc.firstPageHeader, doc.firstPageFooter)
    }
    if (isVariantEnabled(doc, 'even')) {
      out.even = build(doc.evenPageHeader, doc.evenPageFooter)
    }
    return out
  }

  /**
   * 把页眉/页脚折行布局进上下 margin 带, 返回 items + 使用的带高。
   * y 相对带顶 (header 带顶=页顶; footer 带顶 = 页高 - footerHeight)。
   * WPS 式锚定: 页眉内容贴顶部向下扩展; 页脚内容贴带底向上扩展。
   * 超高 (> margin 带) → 裁掉靠页边一侧的行, 保留靠版心一侧。
   */
  private layoutHFRegion(
    kind: 'header' | 'footer',
    lines: ILine[],
    measurer: TextMeasurer,
    contentWidth: number,
  ): { items: SLIFItem[]; regionHeight: number } {
    if (lines.length === 0) return { items: [], regionHeight: HF_MIN_REGION }

    const padTop = kind === 'header' ? HF_HEAD_TOP_PAD : HF_FOOT_TOP_PAD
    const padBottom = kind === 'header' ? HF_HEAD_BOTTOM_PAD : HF_FOOT_BOTTOM_PAD
    const totalH = lines.reduce((s, l) => s + l.height, 0)

    // 不封顶 (WPS): 页眉/页脚随行数长高, 正文起点/分页容量按实际带高让位。
    const regionHeight = Math.max(HF_MIN_REGION, totalH + padTop + padBottom)
    // 页眉顶部锚定; 页脚底部锚定 (相对带顶; 配合 footerTop 在绝对坐标上靠页底)
    let y = kind === 'header'
      ? padTop
      : Math.max(0, regionHeight - padBottom - totalH)

    const items: SLIFItem[] = []
    for (const line of lines) {
      let lineStartX = this.config.marginLeft + (line.indent ?? 0) + (line.firstLineIndent ?? 0)
      if (line.alignment === 'center') {
        lineStartX = this.config.marginLeft + (contentWidth - line.width) / 2
      } else if (line.alignment === 'right') {
        lineStartX = this.config.marginLeft + contentWidth - line.width
      }
      let cursorX = lineStartX
      for (const el of line.elements) {
        const charHeight = measurer.getLineHeight({ font: el.font || 'SimSun', size: el.size || BASE_FONT_SIZE })
        // smarttext 控件: 用预留宽 (control.width, 与正文一致); 域代码用代表值;
        // 其余纯文本宽
        const elControl = (el as LineElement).control
        const measureText = el.type === 'field'
          ? ((el as LineElement).fieldReserveText ?? el.value)
          : el.value
        const layoutW = (el.type === 'smarttext' && typeof elControl?.width === 'number' && elControl.width > 0)
          ? elControl.width
          : measurer.measureWidth(measureText || '', {
              font: el.font || 'SimSun', size: el.size || BASE_FONT_SIZE,
              bold: el.bold, italic: el.italic,
            })
        const elWidth = layoutW
        const advanceWidth = el.type === 'smarttext' ? elWidth + CONTROL_BOX_PADDING * 2 : elWidth
        items.push({
          nodeId: el.id, nodeType: el.type, type: el.type,
          text: el.value,
          x: cursorX, y, width: elWidth,
          height: charHeight,
          ascent: line.maxAscent, descent: line.maxDescent,
          font: el.font || 'SimSun', size: el.size || BASE_FONT_SIZE,
          bold: el.bold, italic: el.italic,
          color: el.color, underline: el.underline,
          strikeout: el.strikeout, superscript: el.superscript, subscript: el.subscript,
          revision: el.revision,
          fieldType: (el as { fieldType?: string }).fieldType,
          // 超宽折行的物理行 (契约 §12.8) — 与正文同源
          controlLines: el.type === 'smarttext' ? elControl?.lines : undefined,
          wrapWidth: el.type === 'smarttext' ? elControl?.wrapWidth : undefined,
        })
        cursorX += advanceWidth
      }
      y += line.height
    }
    return { items, regionHeight }
  }

  /** 段落内首个文本 run 的字体/字号 — 供控件未显式设置时继承 (与周围文字协调) */
  private paraRunDefault(pool: NodePool, children: readonly string[], fallbackSize: number): { font: string; size: number } {
    for (const cid of children) {
      const n = pool.nodes.get(cid) as { type?: string; font?: string; size?: number } | undefined
      if (n?.type === 'text') return { font: n.font || 'SimSun', size: n.size || fallbackSize }
    }
    return { font: 'SimSun', size: fallbackSize }
  }

  /** 文档 (pool) 是否含脚注引用 — 用于正文分页预留脚注 gutter */
  private docContainsFootnotes(pool: NodePool): boolean {
    for (const [, node] of pool.nodes) {
      if ((node as { type?: string }).type === 'footnote_ref') return true
    }
    return false
  }

  /** 可见页范围 (契约 §16.1) — 唯一实现委托给 VirtualViewport */
  private readonly visibleViewport = new VirtualViewport(0)

  getVisiblePages(scrollY: number, viewportHeight: number): { start: number; end: number } {
    // 分页间隙 — 与 Draw.renderer.getPageVerticalGap() 同源
    // (LayoutEngine 不持有 renderer 引用, 调用方负责传参一致性)
    return this.visibleViewport.computeVisiblePages(
      this.pages, scrollY, viewportHeight, this.pageVerticalGap,
    )
  }

  /**
   * 当前布局使用的分页渲染间隙。
   * 默认 0 — 与历史行为完全一致。
   * 通过 setPageVerticalGap() 在外部调整 (调整后需 Draw.render 重绘)。
   */
  private pageVerticalGap = 0

  /** 设置分页渲染间隙 — 影响 getVisiblePages 的可见页计算 */
  setPageVerticalGap(gap: number): void {
    this.pageVerticalGap = Math.max(0, gap)
  }

  /** 获取当前分页渲染间隙 */
  getPageVerticalGap(): number { return this.pageVerticalGap }

  updateConfig(config: Partial<LayoutConfig>): void {
    Object.assign(this.config, config)
  }

  /**
   * 应用文档页面设置 (契约 §16 PAGE GEOMETRY) — Draw 在换文档与每趟布局前同步。
   *
   * `DocumentTree.pageSetup` 是纸张/页边距的唯一所有者；792/1123 那组只是
   * 「文档没有 pageSetup」时的默认值。几何真的变了就清分页状态与段落行缓存:
   * 页起始行表、复用页和行内容宽度全部失效，本趟必须是全量而不是续排。
   */
  setPageSetup(setup: PageSetup | undefined): void {
    const ps = setup ?? DEFAULT_PAGE_SETUP
    const changed = this.config.pageWidth !== ps.width
      || this.config.pageHeight !== ps.height
      || this.config.marginTop !== ps.marginTop
      || this.config.marginBottom !== ps.marginBottom
      || this.config.marginLeft !== ps.marginLeft
      || this.config.marginRight !== ps.marginRight
    if (!changed) return
    this.config.pageWidth = ps.width
    this.config.pageHeight = ps.height
    this.config.marginTop = ps.marginTop
    this.config.marginBottom = ps.marginBottom
    this.config.marginLeft = ps.marginLeft
    this.config.marginRight = ps.marginRight
    // 不引用旧页/旧行: 版心宽高变了, 两者的证明前提都没了 (契约 §16.1)
    this.clearParagraphLineCache()
    this.clearPaginationState()
  }

  /**
   * 交叉引用的显示文本 —— 展开 {page}/{number} 占位符 (契约 §12.2 特征隔离)。
   *
   * 页码取自**上一轮**布局 (this.lastParaPageMap): 首轮为空 → 填 '?', 由
   * fullLayout 的第二轮修正 (文档含占位符时 fullLayout 必再排一轮)。无占位符
   * 时原样返回, 既有文档行为零变化。
   *
   * 此前 BookmarkRenderer.resolveReferences 从不被调用, 于是「见第 {page} 页」
   * 这类引用一律显示字面占位符 —— 这是接线审计 P1 的第一条。
   */
  private resolveCrossRefDisplay(
    node: { id: string; refType: string; targetRef: string; displayText?: string; text?: string },
    doc: DocumentTree,
    pool: NodePool,
  ): string {
    const raw = node.displayText || node.text || '?'
    if (!raw.includes('{page}') && !raw.includes('{number}')) return raw
    const resolved = this.bookmarks.resolveOne(
      node.id, node.refType, node.targetRef, raw, doc, pool, '', this.lastParaPageMap,
    )
    return resolved?.displayText ?? raw
  }

  /** 注入内联渲染预留宽信息源 (契约 §12.6), null 清除 (缺省行为不变)。 */
  setControlInfoOf(fn: ((nodeId: string) => InlineControlInfo | undefined) | null): void {
    this.controlInfoOf = fn
  }

  /**
   * 控件的**有效**显示文本与可见性 (契约 §12.12.8 / §12.12.5)。
   *
   * 计算值优先; 没有就退回控件自身的值/占位符 —— 退回那一路与今天**逐字一致**,
   * 所以没有公式的文档行为不变。
   *
   * 三处布局路径 (正文 / 表格 cell / 页眉页脚) 共用它。这三处此前各写一遍
   * `controlValueDisplay(...)`, 正是 §12.8 记录过的那种"每路径一份"; 若再让计算值
   * 各写一遍, 就不是三份而是六份了。
   *
   * 注意它**只问"显示什么、可不可见"**, 不问为什么 —— LayoutEngine 至今不知道
   * "公式"这件事的存在。
   */
  private controlViewOf(
    nodeId: string,
    element: ElementMeta | undefined,
    value: unknown,
    placeholder: string,
  ): { display: string; visible: boolean; info: InlineControlInfo | undefined } {
    const info = this.controlInfoOf?.(nodeId)
    return {
      display: info?.computedDisplay ?? controlValueDisplay(element, value as never, placeholder),
      // 缺省可见 —— 与"这个控件没有公式"一致 (没公式就没有理由藏它)
      visible: info?.visible !== false,
      info,
    }
  }
}

// ---- 交叉引用解析的模块级助手 ----

/**
 * 段落 id → 页下标 (0-based), 由一轮布局结果构建。
 *
 * 先建 `子节点 id → 所属段落` 索引 (O(N)), 再按页扫描 item —— 整体线性。
 * 不要写成「每个 item 遍历全池找所属段落」(那是 O(P×I×N), EditorPage 的大纲
 * 映射就是这么写的, 大文档下很慢)。嵌套容器 (table→row→cell→paragraph) 由
 * getFlatPageItems 展平后自然覆盖。
 */
function buildParaPageMap(pages: SLIFPage[], pool: NodePool): Map<string, number> {
  const paraOf = new Map<string, string>()
  for (const [, node] of pool.nodes) {
    if (node.type !== 'paragraph') continue
    const p = node as unknown as { id: string; children?: readonly string[] }
    paraOf.set(p.id, p.id)
    for (const cid of p.children ?? []) {
      if (!paraOf.has(cid)) paraOf.set(cid, p.id)
    }
  }
  const map = new Map<string, number>()
  for (let i = 0; i < pages.length; i++) {
    for (const item of getFlatPageItems(pages[i])) {
      const paraId = paraOf.get(item.nodeId)
      // 取首次出现: 跨页段落以起始页为准
      if (paraId && !map.has(paraId)) map.set(paraId, i)
    }
  }
  return map
}

/**
 * 文档是否含**需要解析**的交叉引用 (displayText 里带 {page}/{number} 占位符)。
 *
 * 仅这一种情况才需要额外一轮布局: 没有占位符时(历史文档的纯书签名引用)
 * 解析结果是恒等的, 多排一轮纯属浪费 —— 也保证既有文档行为逐字节不变。
 */
function hasCrossRefPlaceholder(pool: NodePool): boolean {
  for (const [, node] of pool.nodes) {
    if (node.type !== 'cross_reference') continue
    if (crossRefNeedsPageMap(node as { displayText?: string })) return true
  }
  return false
}

/**
 * 交叉引用是否依赖**本趟分页结果**。
 *
 * 判据只有一个: displayText 里带 `{page}` / `{number}` 占位符。带占位符时
 * 显示文本取自上一轮页映射 (自指输入), 不能进行缓存、不能增量复用;
 * **不带占位符时解析器原样返回, 显示文本是常量**, 与页映射无关 ——
 * 节点版本已经覆盖 displayText/targetRef 的改动, 因此可以安全纳入 M2b
 * (契约 §16.1)。
 */
function crossRefNeedsPageMap(node: { displayText?: string }): boolean {
  const t = node.displayText
  return typeof t === 'string' && (t.includes('{page}') || t.includes('{number}'))
}

/**
 * 表格 (含嵌套表) 的布局高度 —— 行占高之和 + 重复表头占高 (契约 §31.13)。
 *
 * 单行占高的口径与分页/命中/渲染三方共用 `tableRowUnitHeight` (§26.x 的
 * "同一口径只有一份"), 不在布局侧重算一次 `height + 1`。
 */
function nestedTableHeight(rows: readonly SLIFRow[]): number {
  return rows.reduce((s, r) => s + tableRowUnitHeight(r), 0)
}

