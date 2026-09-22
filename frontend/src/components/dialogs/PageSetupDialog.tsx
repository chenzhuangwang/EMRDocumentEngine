// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// PageSetupDialog — 页面设置对话框 (TASK-467, v5.0)
//
// 三 Tab: 页边距 / 纸张 / 版式
// 支持节应用范围: 本节 / 从本节开始 / 整篇文档
// ============================================================

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import { X, Ruler, FileText, Layout } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/useTranslation'

// ---- 类型 ----

export interface PageSetupValues {
  marginTop: number     // px (默认 72 = 1 inch @ 72dpi)
  marginBottom: number
  marginLeft: number
  marginRight: number
  pageWidth: number     // px (默认 794 = A4 @ 72dpi)
  pageHeight: number    // px (默认 1123 = A4 @ 72dpi)
  orientation: 'portrait' | 'landscape'
  /**
   * 相邻页面之间的渲染间隙 (CSS px, 默认 20)。
   * 仅影响渲染视口 — 不修改 SLIF 存储坐标 / 文档数据模型。
   * 设为 0 可让页面紧贴 (旧版行为)。
   */
  pageVerticalGap: number
  applyTo: 'section' | 'thisPointForward' | 'wholeDocument'
}

const A4 = { width: 794, height: 1123 }
const A3 = { width: 1123, height: 1587 }
const LETTER = { width: 612, height: 792 }

const PAPER_SIZES: { labelKey: 'pageSetup.presetA4' | 'pageSetup.presetLetter' | 'pageSetup.presetA3'; width: number; height: number }[] = [
  { labelKey: 'pageSetup.presetA4',     width: A4.width,     height: A4.height },
  { labelKey: 'pageSetup.presetA3',     width: A3.width,     height: A3.height },
  { labelKey: 'pageSetup.presetLetter', width: LETTER.width, height: LETTER.height },
]

interface PageSetupDialogProps {
  open: boolean
  onClose: () => void
  initialValues?: Partial<PageSetupValues>
  onApply?: (values: PageSetupValues) => void
}

const DEFAULTS: PageSetupValues = {
  marginTop: 72,
  marginBottom: 72,
  marginLeft: 90,
  marginRight: 90,
  pageWidth: A4.width,
  pageHeight: A4.height,
  orientation: 'portrait',
  pageVerticalGap: 20,
  applyTo: 'wholeDocument',
}

// ---- Tab 定义 ----

type TabId = 'margins' | 'paper' | 'layout'

const TABS: { id: TabId; labelKey: 'pageSetup.tabMargins' | 'pageSetup.tabPaper' | 'pageSetup.tabLayout'; icon: React.ReactNode }[] = [
  { id: 'margins', labelKey: 'pageSetup.tabMargins', icon: <Ruler size={14} /> },
  { id: 'paper',   labelKey: 'pageSetup.tabPaper',   icon: <FileText size={14} /> },
  { id: 'layout',  labelKey: 'pageSetup.tabLayout',  icon: <Layout size={14} /> },
]

// ---- 组件 ----

export function PageSetupDialog({
  open, onClose, initialValues, onApply,
}: PageSetupDialogProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<PageSetupValues>({ ...DEFAULTS, ...initialValues })
  const [tab, setTab] = useState<TabId>('margins')

  const update = (patch: Partial<PageSetupValues>) => setValues(v => ({ ...v, ...patch }))

  const handleOrientationChange = (orientation: 'portrait' | 'landscape') => {
    if (orientation === values.orientation) return
    // Swap width/height
    update({
      orientation,
      pageWidth: values.pageHeight,
      pageHeight: values.pageWidth,
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                     flex max-h-[85vh] w-[480px] flex-col overflow-hidden
                     bg-chrome rounded-lg shadow-xl border border-line"
        >
          {/* 标题栏 */}
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-line-subtle">
            <Dialog.Title className="text-sm font-semibold text-chrome-ink-strong">
              {t('dialog.title.pageSetup')}
            </Dialog.Title>
            <button className="text-chrome-ink-muted hover:text-chrome-ink-secondary" onClick={onClose} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </div>

          {/* Tabs */}
          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex flex-1 min-h-0 flex-col overflow-hidden">
            <Tabs.List className="flex flex-shrink-0 border-b border-line-subtle px-4">
              {TABS.map(tabItem => (
                <Tabs.Trigger
                  key={tabItem.id}
                  value={tabItem.id}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
                    'border-b-2 -mb-px',
                    tab === tabItem.id
                      ? 'border-primary-500 text-chrome-accent-ink'
                      : 'border-transparent text-chrome-ink-tertiary hover:text-chrome-ink-body',
                  )}
                >
                  {tabItem.icon}
                  {t(tabItem.labelKey)}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {/* === 页边距 Tab === */}
              <Tabs.Content value="margins" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <MarginField
                    label={t('pageSetup.marginTop')}
                    value={values.marginTop}
                    onChange={(v) => update({ marginTop: v })}
                  />
                  <MarginField
                    label={t('pageSetup.marginBottom')}
                    value={values.marginBottom}
                    onChange={(v) => update({ marginBottom: v })}
                  />
                  <MarginField
                    label={t('pageSetup.marginLeft')}
                    value={values.marginLeft}
                    onChange={(v) => update({ marginLeft: v })}
                  />
                  <MarginField
                    label={t('pageSetup.marginRight')}
                    value={values.marginRight}
                    onChange={(v) => update({ marginRight: v })}
                  />
                  {/* 分页间隙 — 仅作用于渲染视口, 不修改存储坐标 */}
                  <MarginField
                    label={t('pageSetup.pageVerticalGap')}
                    value={values.pageVerticalGap}
                    min={0}
                    max={200}
                    onChange={(v) => update({ pageVerticalGap: v })}
                  />
                </div>

                {/* 预览 */}
                <PagePreview values={values} />
              </Tabs.Content>

              {/* === 纸张 Tab === */}
              <Tabs.Content value="paper" className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-chrome-ink-tertiary">{t('dialog.label.size')}</label>
                  <div className="space-y-1">
                    {PAPER_SIZES.map(ps => (
                      <button
                        key={ps.labelKey}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm rounded-md border transition-colors',
                          values.pageWidth === ps.width && values.pageHeight === ps.height
                            ? 'border-primary-400 bg-chrome-accent text-chrome-accent-ink'
                            : 'border-line hover:bg-chrome-subtle text-chrome-ink-body',
                        )}
                        onClick={() => update({ pageWidth: ps.width, pageHeight: ps.height })}
                      >
                        {t(ps.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-chrome-ink-tertiary">{t('dialog.label.orientation')}</label>
                  <div className="flex gap-2">
                    <button
                      className={cn('flex-1 py-2 text-sm rounded-md border transition-colors',
                        values.orientation === 'portrait'
                          ? 'border-primary-400 bg-chrome-accent text-chrome-accent-ink'
                          : 'border-line hover:bg-chrome-subtle text-chrome-ink-secondary')}
                      onClick={() => handleOrientationChange('portrait')}
                    >
                      {t('print.orientation.portrait')}
                    </button>
                    <button
                      className={cn('flex-1 py-2 text-sm rounded-md border transition-colors',
                        values.orientation === 'landscape'
                          ? 'border-primary-400 bg-chrome-accent text-chrome-accent-ink'
                          : 'border-line hover:bg-chrome-subtle text-chrome-ink-secondary')}
                      onClick={() => handleOrientationChange('landscape')}
                    >
                      {t('print.orientation.landscape')}
                    </button>
                  </div>
                </div>
              </Tabs.Content>

              {/* === 版式 Tab === */}
              <Tabs.Content value="layout" className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-chrome-ink-tertiary">{t('pageSetup.applyTo')}</label>
                  <div className="space-y-1">
                    {([
                      { value: 'wholeDocument' as const,     labelKey: 'pageSetup.applyWholeDocument' as const },
                      { value: 'thisPointForward' as const, labelKey: 'pageSetup.applyFromThisPoint' as const },
                      { value: 'section' as const,           labelKey: 'pageSetup.applyThisSection' as const },
                    ]).map(opt => (
                      <button
                        key={opt.value}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm rounded-md border transition-colors',
                          values.applyTo === opt.value
                            ? 'border-primary-400 bg-chrome-accent text-chrome-accent-ink'
                            : 'border-line hover:bg-chrome-subtle text-chrome-ink-body',
                        )}
                        onClick={() => update({ applyTo: opt.value })}
                      >
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-chrome-ink-muted">
                  {t('pageSetup.hfFutureNote')}
                </div>
              </Tabs.Content>
            </div>
          </Tabs.Root>

          {/* 底部按钮 */}
          <div className="flex flex-shrink-0 items-center justify-end gap-2 px-4 py-3 border-t border-line-subtle bg-chrome-subtle rounded-b-lg">
            <button
              className="px-4 py-1.5 text-xs text-chrome-ink-secondary hover:bg-chrome-strong rounded-md transition-colors"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              className="px-4 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-md transition-colors"
              onClick={() => { onApply?.(values); onClose() }}
            >
              {t('common.confirm')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---- 子组件 ----

function MarginField({
  label, value, onChange, min = 0, max = 200,
}: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number
}) {
  // Convert px to mm for display (1px @ 72dpi ≈ 0.353mm)
  const mmValue = (value * 0.353).toFixed(1)

  return (
    <div className="space-y-1">
      <label className="text-xs text-chrome-ink-tertiary">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          className="w-16 px-2 py-1.5 text-sm border border-line rounded-md
                     focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-200"
          value={value}
          min={min} max={max}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        <span className="text-xs text-chrome-ink-muted">px ({mmValue}mm)</span>
      </div>
    </div>
  )
}

/** 页面预览 — 缩略图形式显示边距 */
function PagePreview({ values }: { values: PageSetupValues }) {
  const { t } = useTranslation()
  const previewW = 120
  const scale = previewW / values.pageWidth
  const previewH = values.pageHeight * scale

  const ml = values.marginLeft * scale
  const mr = values.marginRight * scale
  const mt = values.marginTop * scale
  const mb = values.marginBottom * scale

  return (
    <div className="flex justify-center pt-2">
      <div className="text-center">
        <label className="text-xs text-chrome-ink-muted mb-1 block">{t('common.preview')}</label>
        <svg
          width={previewW + 10} height={previewH + 10}
          className="border border-line rounded bg-chrome"
        >
          {/* 页面轮廓 = 纸张本体: 版式预览要说真话, 深色外壳下也用白纸示意 */}
          <rect x={2} y={2} width={previewW + 6} height={previewH + 6}
            fill="#fff" stroke="#d1d5db" strokeWidth={1} />{/* retheme-keep: 纸面+纸上描边, 非外壳面色 */}

          {/* 边距区域 (灰色虚线) */}
          <rect x={2 + ml} y={2 + mt}
            width={previewW - ml - mr + 6} height={previewH - mt - mb + 6}
            fill="none" stroke="#93c5fd" strokeWidth={1} strokeDasharray="3,2" />

          {/* 内容区 */}
          <rect x={2 + ml} y={2 + mt}
            width={previewW - ml - mr + 6} height={previewH - mt - mb + 6}
            fill="#eff6ff" opacity={0.5} />
        </svg>
      </div>
    </div>
  )
}
