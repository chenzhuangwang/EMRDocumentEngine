// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ofdModel — SLIF → OFD 对象图 (导出特性层, 纯函数)
//
// 本模块把已排好版的页面 (SLIFPage[]) 翻译成 OFD 的对象模型 (毫米坐标的
// TextObject / PathObject / ImageObject)。**不重新排版、不重新测宽之外的东西**
// —— 每个坐标都来自 SLIF, 与屏幕上看到的那一帧同源 (契约 §4/§12)。
//
// ===== 坐标与单位 =====
// SLIF 是 96dpi 的 CSS 像素 (794×1123 = A4), OFD 用毫米。转换系数 25.4/96。
// 794px → 210.058mm, 1123px → 297.104mm —— 比标称 A4 多 0.06mm, 这是 96dpi
// 模型的固有取整, 不是错误。
//
// **页面盒取 SLIFPage.width/height, 不取 doc.pageSetup**: LayoutEngine 的
// config 在构造函数里硬编码 794×1123, updateConfig 全仓唯一调用者是测试,
// Editor.applyPageSetup 只写 doc.pageSetup、从不推给布局引擎 —— 两者今天会
// 分叉 (页面设置改了不生效)。取 pageSetup 会让页面盒与所有对象坐标打架。
//
// ===== 与打印投影的关系 =====
// 页眉/页脚带的定位**逐字照抄** Draw.paintPage: 页眉项 y 相对页顶; 页脚带顶
// 在 page.height - (footerHeight ?? 42), 页脚项相对带顶。那个 `?? 42` 必须与
// 渲染层用同一个默认值, 否则整条页脚会平移。
//
// ===== 为什么不用 getFlatPageItems =====
// 它按行只遍历 table.rows, headerRows (跨页重复的表头, 纯视觉行) 只贡献高度
// 偏移、其 items 不入列。用它做表格会**静默漏掉续页的表头文字**。故本模块自己
// walking table item: [...headerRows, ...rows], 与 TableParticle 一致。
// ============================================================

import { CELL_PAD, tableRowUnitHeight } from '@/engine'
import type { SLIFItem, SLIFPage, SLIFRow, SLIFCell } from '@/engine'
import type { FieldProjection } from '../fields'

/** 每英寸 25.4mm / 96dpi —— SLIF 像素 → OFD 毫米 */
export const MM_PER_PX = 25.4 / 96

/** 表格边框的**绘制期常量** (SLIF 不携带这些表现层属性) —— 与 TableParticle 同源 */
export const TABLE_BORDER_COLOR = '#9CA3AF'
export const TABLE_HEADER_BG = '#F3F4F6'
export const TABLE_BORDER_WIDTH_PX = 0.5

/** 页眉/页脚分隔线 (与 Draw.drawHfSeparator 同源: 0.5px 实线, 横贯整页) */
export const HF_SEPARATOR_WIDTH_PX = 0.5

/** 页眉/页脚带的默认高度 —— **必须与 Draw.paintPage 的 `?? 42` 一致** */
export const DEFAULT_HF_BAND_HEIGHT = 42

export interface OfdBox { x: number; y: number; width: number; height: number }

export interface OfdTextObject {
  kind: 'text'
  id: number
  boundary: OfdBox
  /** PublicRes 里 Font 的 ID */
  fontId: number
  /** 字号 (毫米) */
  size: number
  weight?: number
  italic?: boolean
  fillColor?: string
  /** TextCode 文本 (一个 run 一段) */
  text: string
  /** 逐字形推进量 (毫米), 长度 === [...text].length */
  deltaX: number[]
  /** TextCode 的首字形原点 (相对 boundary 左上角, 毫米) */
  codeX: number
  codeY: number
}

export interface OfdPathObject {
  kind: 'path'
  id: number
  boundary: OfdBox
  /** 简写路径数据 (M/L/Z 等) */
  abbreviatedData: string
  stroke?: boolean
  fill?: boolean
  lineWidth?: number
  strokeColor?: string
  fillColor?: string
  dashPattern?: readonly number[]
}

export interface OfdImageObject {
  kind: 'image'
  id: number
  boundary: OfdBox
  /** DocumentRes 里 MultiMedia 的 ID。资源缺失时**不产出本对象** (见 emitItem) */
  resourceId: number
  format?: string
  dataUrl?: string
}

export type OfdObject = OfdTextObject | OfdPathObject | OfdImageObject

export interface OfdPage {
  index: number
  /** 页对象 ID —— 从**同一个** ID 分配器取, 保证全文档唯一 */
  id: number
  /** 内容层 ID —— 同上; 不能与页 ID 撞 (那是两个不同的单元) */
  layerId: number
  widthMm: number
  heightMm: number
  objects: OfdObject[]
}

export interface OfdFont { id: number; name: string }

export interface OfdImageResource {
  id: number
  /** Res/ 下的文件名 */
  fileName: string
  format: string
  dataUrl: string
}

export interface OfdWarning {
  code: 'missing-image' | 'unknown-item-type' | 'zero-size-text' | 'missing-ascent'
  /** 相关节点/对象, 便于定位 (无则为空串) */
  ref: string
}

export interface OfdModel {
  pages: OfdPage[]
  fonts: OfdFont[]
  images: OfdImageResource[]
  /** 文档内所有 ID 的最大值 (Document.xml 的 MaxUnitID) */
  maxUnitId: number
  warnings: OfdWarning[]
}

/** 逐字形推进量提供者 —— 由调用方注入 TextMeasurer, 使本模块可在测试里确定复现 */
export type CharAdvancePort = (
  text: string,
  config: { font: string; size: number; bold?: boolean; italic?: boolean },
) => number[]

/** 字段值解析 (供域代码在 OFD 里产出真实文本, 而不是占位符) */
export type FieldTextPort = (item: { fieldType?: string; text?: string }, pageIndex: number) => string

export interface OfdModelInput {
  pages: readonly SLIFPage[]
  /** nodeId → 图片 data URL (运行期 ImageNode.src) */
  images?: ReadonlyMap<string, string>
  /** 逐字形推进量 (毫米换算前, 单位 px) */
  charAdvance: CharAdvancePort
  /** 域代码 → 显示文本 (逐页解析); 缺省则用 item.text 原文 */
  resolveFieldText?: FieldTextPort
  /** 结构化字段 (仅用于数据区, 不参与几何) */
  projection?: FieldProjection
}

// ------------------------------------------------------------
// 基础换算
// ------------------------------------------------------------

/** px → 毫米字符串 (3 位小数, 归一化 -0) */
export function mm(px: number): string {
  const v = px * MM_PER_PX
  return (Object.is(v, -0) ? 0 : v).toFixed(3)
}

/** 边界框 → OFD `Boundary` 属性串 (毫米) */
export function boxStr(b: OfdBox): string {
  return `${mm(b.x)} ${mm(b.y)} ${mm(b.width)} ${mm(b.height)}`
}

/** CSS 颜色 → OFD `Value="r g b"` (0-255)。解析不了就回退并记警告。 */
export function toOfdColor(color: string | undefined, fallback = '#000000'): string {
  const rgb = parseColor(color) ?? parseColor(fallback) ?? { r: 0, g: 0, b: 0 }
  return `${rgb.r} ${rgb.g} ${rgb.b}`
}

function parseColor(color: string | undefined): { r: number; g: number; b: number } | null {
  if (!color) return null
  const s = color.trim().toLowerCase()
  const hex = s.startsWith('#') ? s.slice(1) : null
  if (hex) {
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      return Number.isNaN(r + g + b) ? null : { r, g, b }
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      return Number.isNaN(r + g + b) ? null : { r, g, b }
    }
    return null
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s)
  if (m) {
    return {
      r: Math.round(Number(m[1])), g: Math.round(Number(m[2])), b: Math.round(Number(m[3])),
    }
  }
  return null
}

// ------------------------------------------------------------
// 排版几何常量 (与渲染层同源, 见文件头)
// ------------------------------------------------------------

/** 表格行高 (px) —— 用引擎导出的同一函数, 保证与 TableParticle / SLIF.expandTableItem 不漂移 */
function rowUnitHeight(row: SLIFRow): number {
  return tableRowUnitHeight(row)
}

// ------------------------------------------------------------
// 对象构建
// ------------------------------------------------------------

class Builder {
  private nextId = 1
  private readonly warnings: OfdWarning[] = []
  private readonly fontIds = new Map<string, number>()
  private readonly fonts: OfdFont[] = []
  private readonly imageIds = new Map<string, number>()
  private readonly images: OfdImageResource[] = []

  constructor(private readonly input: OfdModelInput) {}

  /** 域代码解析器 (缺省则不解析, 用 item.text 原文) */
  get fieldResolver(): FieldTextPort | undefined {
    return this.input.resolveFieldText
  }

  /** 该节点是否有可用的图片资源 (运行期 ImageNode.src) */
  imageOf(nodeId: string): string | undefined {
    return this.input.images?.get(nodeId)
  }

  /** 逐字形推进量 (px); 实测失败则退化为等宽估计, 并记警告 (不静默) */
  advanceOf(text: string, font: string, size: number, bold?: boolean, italic?: boolean): number[] {
    const chars = [...text]
    const measured = this.input.charAdvance(text, { font, size, bold, italic })
    if (measured.length === chars.length && measured.every((v) => v > 0)) return measured
    this.warn('missing-ascent', `advance:${text.slice(0, 12)}`)
    return chars.map(() => size * 0.5)
  }

  allocId(): number {
    return this.nextId++
  }

  warn(code: OfdWarning['code'], ref = ''): void {
    this.warnings.push({ code, ref })
  }

  fontId(family: string): number {
    const name = family || 'SimSun'
    const existing = this.fontIds.get(name)
    if (existing !== undefined) return existing
    const id = this.allocId()
    this.fontIds.set(name, id)
    // 无 FontFile: 按名引用系统字体。GB/T 33190 允许引用而未内嵌;
    // 强约束是每个字形都带 DeltaX, 故字体被替换也不会重排 (只换字形轮廓)。
    this.fonts.push({ id, name })
    return id
  }

  /** 图片资源去重: 同一 data URL 只落一份 Res/ 文件 */
  imageResource(dataUrl: string, format: string): number {
    const existing = this.imageIds.get(dataUrl)
    if (existing !== undefined) return existing
    const id = this.allocId()
    const fileName = `Image_${this.images.length}.${format.toLowerCase()}`
    this.imageIds.set(dataUrl, id)
    this.images.push({ id, fileName, format, dataUrl })
    return id
  }

  result(pages: OfdPage[]): OfdModel {
    return {
      pages,
      fonts: this.fonts,
      images: this.images,
      maxUnitId: this.nextId - 1,
      warnings: this.warnings,
    }
  }
}

/** 从 data URL 取 MIME 与负载 */
function splitDataUrl(dataUrl: string): { mime: string; format: string } | null {
  const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl)
  if (!m) return null
  const sub = m[1].toLowerCase()
  const format = sub === 'jpg' || sub === 'jpeg' ? 'JPEG' : sub === 'png' ? 'PNG' : sub.toUpperCase()
  return { mime: sub, format }
}

/** 一个文本 run → TextObject */
function emitText(
  b: Builder,
  item: SLIFItem,
  text: string,
  x: number,
  y: number,
  opts: { baselineY?: number; sizeScale?: number } = {},
): OfdTextObject | null {
  const rawSize = item.size
  // 缺字号时布局不会走到这里, 但导入的脏数据可能带着 size 缺失 —— 回退到 16px
  // 并**记警告**: Size 为 0/缺失的 TextObject 会被阅读器静默跳过, 表现为空白页
  // 而不是报错 (§31.5: 不许静默)。
  if (!(rawSize > 0)) b.warn('zero-size-text', item.nodeId)
  const size = (rawSize > 0 ? rawSize : 16) * (opts.sizeScale ?? 1)
  const fontId = b.fontId(item.font || 'SimSun')
  const ascent = item.ascent > 0 ? item.ascent : size * 0.8
  if (!(item.ascent > 0)) b.warn('missing-ascent', item.nodeId)

  // 逐字形推进: 测宽 → 归一化到布局记录的 item.width。
  // 归一化的意义: 即便字体被替换导致逐字测宽与整段测宽不一致, 本行的**右边界**
  // 仍钉在布局算出的位置, 后续内容不会跟着漂。
  const advances = b.advanceOf(text, item.font || 'SimSun', size, item.bold, item.italic)
  const total = advances.reduce((s, v) => s + v, 0)
  const scale = total > 0 && item.width > 0 ? item.width / total : 1
  const deltaX = advances.map((v) => v * scale)

  return {
    kind: 'text',
    id: b.allocId(),
    boundary: { x, y, width: item.width, height: item.height },
    fontId,
    size,
    weight: item.bold ? 700 : undefined,
    italic: item.italic || undefined,
    fillColor: item.color,
    text,
    deltaX,
    codeX: 0,
    codeY: opts.baselineY ?? ascent,
  }
}

/** 一条线段 → PathObject (M/L) */
function emitLine(
  b: Builder,
  x1: number, y1: number, x2: number, y2: number,
  opts: { lineWidth: number; color: string; dash?: readonly number[] },
): OfdPathObject {
  const minX = Math.min(x1, x2)
  const minY = Math.min(y1, y2)
  return {
    kind: 'path',
    id: b.allocId(),
    boundary: {
      x: minX, y: minY,
      width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
    },
    abbreviatedData: `M ${mm(x1)} ${mm(y1)} L ${mm(x2)} ${mm(y2)}`,
    stroke: true,
    lineWidth: opts.lineWidth,
    strokeColor: opts.color,
    dashPattern: opts.dash,
  }
}

/** 矩形 (描边 / 填充) → PathObject */
function emitRect(
  b: Builder,
  box: OfdBox,
  opts: { stroke?: boolean; fill?: boolean; lineWidth?: number; strokeColor?: string; fillColor?: string },
): OfdPathObject {
  const { x, y, width, height } = box
  return {
    kind: 'path',
    id: b.allocId(),
    boundary: box,
    abbreviatedData:
      `M ${mm(x)} ${mm(y)} L ${mm(x + width)} ${mm(y)} ` +
      `L ${mm(x + width)} ${mm(y + height)} L ${mm(x)} ${mm(y + height)} Z`,
    stroke: opts.stroke || undefined,
    fill: opts.fill || undefined,
    lineWidth: opts.lineWidth,
    strokeColor: opts.strokeColor,
    fillColor: opts.fillColor,
  }
}

/** 单元格文本 → TextObject (与渲染层同一条定位规则: cellX + CELL_PAD + item.x) */
function emitCellItem(
  b: Builder,
  ci: SLIFItem,
  cellX: number,
  cellY: number,
  pageIndex: number,
  out: OfdObject[],
): void {
  if (ci.type === 'table') {
    // 嵌套表 (契约 §31.13 合法) —— 递归, 与 TableParticle 一致
    emitTable(b, ci, cellX + CELL_PAD + (ci.x || 0), cellY + (ci.y || 0), pageIndex, out)
    return
  }
  if (!ci.text) return
  const text = resolveItemText(b, ci, pageIndex)
  if (!text) return
  const obj = emitText(b, ci, text, cellX + CELL_PAD + (ci.x || 0), cellY + (ci.y || 0))
  if (obj) out.push(obj)
}

/** 表格 item → 单元格描边/填充 + 单元格内文本 */
function emitTable(
  b: Builder,
  table: SLIFItem,
  originX: number,
  originY: number,
  pageIndex: number,
  out: OfdObject[],
): void {
  // **自己**遍历 headerRows + rows: getFlatPageItems 只走 rows,
  // 会静默漏掉续页重复的表头 (见文件头)
  const allRows: SLIFRow[] = [...(table.headerRows ?? []), ...(table.rows ?? [])]
  if (allRows.length === 0) return

  let rowY = originY
  for (const row of allRows) {
    const rowHeight = Math.max(row.height || 24, 24)
    for (const cell of row.cells as SLIFCell[]) {
      const cw = cell.width || 40
      const ch = cell.height || rowHeight
      const cellX = originX + (cell.x || 0)

      const bg = cell.isHeader ? TABLE_HEADER_BG : cell.backgroundColor
      if (bg) {
        out.push(emitRect(b, { x: cellX, y: rowY, width: cw, height: ch }, {
          fill: true, fillColor: bg,
        }))
      }
      // 边框: 与 TableParticle 同一几何 (内缩 0.25px, 宽高各减 0.5px)
      const strokeBox: OfdBox = { x: cellX + 0.25, y: rowY + 0.25, width: cw - 0.5, height: ch - 0.5 }
      out.push(emitRect(b, strokeBox, {
        stroke: true, lineWidth: TABLE_BORDER_WIDTH_PX, strokeColor: TABLE_BORDER_COLOR,
      }))

      for (const ci of cell.items ?? []) {
        emitCellItem(b, ci, cellX, rowY, pageIndex, out)
      }
    }
    rowY += rowUnitHeight(row)
  }
}

/** 域代码取真实值; 其余取 item.text */
function resolveItemText(b: Builder, item: SLIFItem, pageIndex: number): string {
  if (item.type === 'field' && b.fieldResolver) {
    // 与 Draw 同一个解析器与同一个上下文 —— 否则每页页码都会导出成 '[页码]'
    return b.fieldResolver(item, pageIndex)
  }
  return item.text ?? ''
}

/** 单个正文/页眉/页脚 item → 0..n 个对象 */
function emitItem(
  b: Builder,
  item: SLIFItem,
  originY: number,
  pageIndex: number,
  contentWidth: number,
  out: OfdObject[],
): void {
  const y = originY + item.y
  switch (item.type) {
    case 'table':
      emitTable(b, item, item.x, y, pageIndex, out)
      return

    case 'image': {
      const dataUrl = b.imageOf(item.nodeId)
      const parsed = dataUrl ? splitDataUrl(dataUrl) : null
      if (dataUrl && parsed) {
        const resourceId = b.imageResource(dataUrl, parsed.format)
        out.push({
          kind: 'image',
          id: b.allocId(),
          boundary: { x: item.x, y, width: item.width, height: item.height },
          resourceId,
          format: parsed.format,
        })
      } else {
        // 资源缺失: 渲染层画的是虚线占位框 —— 镜像它, 而不是把这块悄悄丢掉。
        // 刻意**不**产出 ImageObject: 指向不存在资源的 ImageObject 会让阅读器
        // 直接报错, 而占位框已经忠实表达了「这里本来有张图」。
        b.warn('missing-image', item.nodeId)
        out.push(emitRect(b, { x: item.x, y, width: item.width, height: item.height }, {
          stroke: true, lineWidth: 1, strokeColor: '#9CA3AF',
        }))
      }
      return
    }

    case 'separator':
      // 渲染层把 lineStyle 固定成实线、宽度固定成整页可用宽 (ParticleAdapters),
      // 这里照做 —— 读池里的 lineStyle 会让 OFD 与屏幕/打印不一致
      out.push(emitLine(b, item.x, y + 4, item.x + contentWidth, y + 4, {
        lineWidth: 1, color: item.color || '#6B7280',
      }))
      return

    case 'footnote': {
      const obj = emitText(b, item, item.text ?? '', item.x, y, { sizeScale: 0.75 })
      if (obj) out.push(obj)
      return
    }

    default: {
      // text / field / smarttext / 未来类型: 一律按文本 run 处理。
      // 未知类型不静默丢 —— 记一条警告 (契约 §31.5)。
      if (item.type !== 'text' && item.type !== 'field' && item.type !== 'smarttext') {
        b.warn('unknown-item-type', `${item.type}:${item.nodeId}`)
      }
      const text = resolveItemText(b, item, pageIndex)
      if (!text) return

      // 高亮 / 下划线 / 删除线: OFD 的 TextObject 没有这些属性 → 出为 PathObject,
      // 几何取自 TextParticle 的实现 (高亮在文字之下, 故先入列)
      const ascent = item.ascent > 0 ? item.ascent : (item.size || 16) * 0.8
      const descent = item.descent > 0 ? item.descent : (item.size || 16) * 0.2
      if (item.highlight) {
        out.push(emitRect(b, {
          x: item.x, y: y - ascent, width: item.width, height: ascent + descent,
        }, { fill: true, fillColor: item.highlight }))
      }

      const obj = emitText(b, item, text, item.x, y)
      if (obj) out.push(obj)

      if (item.underline) {
        out.push(emitLine(b, item.x, y + ascent + descent * 0.3, item.x + item.width, y + ascent + descent * 0.3, {
          lineWidth: item.underlineStyle === 'double' ? 1 : 0.5,
          color: item.color || '#000000',
        }))
      }
      if (item.strikeout) {
        out.push(emitLine(b, item.x, y + ascent - ascent * 0.5, item.x + item.width, y + ascent - ascent * 0.5, {
          lineWidth: 0.5, color: item.color || '#000000',
        }))
      }

      // 列表标记: 渲染层由 ListParticle 单独绘制在 listMarkerX 处
      if (item.listMarker) {
        // 标记宽度用 markerWidth (渲染层扣减用的就是它), 使 DeltaX 归一化到标记自身宽度
        const markerItem: SLIFItem = {
          ...item,
          x: item.listMarkerX ?? item.x,
          width: item.markerWidth || item.width,
        }
        const marker = emitText(b, markerItem, item.listMarker, markerItem.x, y)
        if (marker) out.push(marker)
      }
    }
  }
}

export function buildOfdModel(input: OfdModelInput): OfdModel {
  const b = new Builder(input)
  const pages: OfdPage[] = []

  input.pages.forEach((page, pageIndex) => {
    // 页 ID 与层 ID 都从全局分配器取 —— 曾经它们各自 = index 派生, 于是
    // 「第 1 页的 Page ID」与「第 0 页的 Layer ID」会撞成同一个号;
    // OFD 的对象 ID 要求**全文档唯一**, 撞号是阅读器会判非法的错误。
    const pageId = b.allocId()
    const layerId = b.allocId()
    const objects: OfdObject[] = []
    const headerHeight = page.headerHeight ?? DEFAULT_HF_BAND_HEIGHT
    const footerHeight = page.footerHeight ?? DEFAULT_HF_BAND_HEIGHT
    const footerTop = page.height - footerHeight

    // 页眉: 项 y 相对页顶
    for (const item of page.headerItems ?? []) {
      emitItem(b, item, 0, pageIndex, page.width - item.x - 90, objects)
    }
    // 页眉分隔线: 渲染层**无条件**画 (Draw.paintPage)
    objects.push(emitLine(b, 0, headerHeight, page.width, headerHeight, {
      lineWidth: HF_SEPARATOR_WIDTH_PX, color: '#9CA3AF',
    }))

    // 正文: separator 的可用宽照抄 Draw.paintPage 的字面量 (pageWidth - item.x - 90)
    for (const item of page.items) {
      emitItem(b, item, 0, pageIndex, page.width - item.x - 90, objects)
    }

    // 页脚分隔线 + 页脚 (项 y 相对页脚带顶)
    objects.push(emitLine(b, 0, footerTop, page.width, footerTop, {
      lineWidth: HF_SEPARATOR_WIDTH_PX, color: '#9CA3AF',
    }))
    for (const item of page.footerItems ?? []) {
      emitItem(b, item, footerTop, pageIndex, page.width - item.x - 90, objects)
    }

    pages.push({
      // 页序号取**数组位置**而非 SLIF 的 pageIndex: OFD 的页序由 Document.xml
      // 里 <ofd:Pages> 的顺序决定, 目录名只是定位符; 用数组位置能保证
      // Pages/Page_0..N 连续无洞 (SLIF 的 pageIndex 是布局产物, 不保证连续)。
      index: pageIndex,
      id: pageId,
      layerId,
      widthMm: page.width * MM_PER_PX,
      heightMm: page.height * MM_PER_PX,
      objects,
    })
  })

  return b.result(pages)
}
