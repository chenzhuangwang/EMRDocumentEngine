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

const PAPER_SIZES = [
  { label: 'A4 (210×297mm)', width: A4.width, height: A4.height },
  { label: 'A3 (297×420mm)', width: A3.width, height: A3.height },
  { label: 'Letter (8.5×11in)', width: LETTER.width, height: LETTER.height },
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

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'margins', label: '页边距', icon: <Ruler size={14} /> },
  { id: 'paper', label: '纸张', icon: <FileText size={14} /> },
  { id: 'layout', label: '版式', icon: <Layout size={14} /> },
]

// ---- 组件 ----

export function PageSetupDialog({
  open, onClose, initialValues, onApply,
}: PageSetupDialogProps) {
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
                     bg-white rounded-lg shadow-xl border border-gray-200"
        >
          {/* 标题栏 */}
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-gray-100">
            <Dialog.Title className="text-sm font-semibold text-gray-800">
              页面设置
            </Dialog.Title>
            <button className="text-gray-400 hover:text-gray-600" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          {/* Tabs */}
          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TabId)} className="flex flex-1 min-h-0 flex-col overflow-hidden">
            <Tabs.List className="flex flex-shrink-0 border-b border-gray-100 px-4">
              {TABS.map(t => (
                <Tabs.Trigger
                  key={t.id}
                  value={t.id}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
                    'border-b-2 -mb-px',
                    tab === t.id
                      ? 'border-primary-500 text-primary-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700',
                  )}
                >
                  {t.icon}
                  {t.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {/* === 页边距 Tab === */}
              <Tabs.Content value="margins" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <MarginField
                    label="上边距"
                    value={values.marginTop}
                    onChange={(v) => update({ marginTop: v })}
                  />
                  <MarginField
                    label="下边距"
                    value={values.marginBottom}
                    onChange={(v) => update({ marginBottom: v })}
                  />
                  <MarginField
                    label="左边距"
                    value={values.marginLeft}
                    onChange={(v) => update({ marginLeft: v })}
                  />
                  <MarginField
                    label="右边距"
                    value={values.marginRight}
                    onChange={(v) => update({ marginRight: v })}
                  />
                  {/* 分页间隙 — 仅作用于渲染视口, 不修改存储坐标 */}
                  <MarginField
                    label="分页间隙"
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
                  <label className="text-xs font-medium text-gray-500">纸张大小</label>
                  <div className="space-y-1">
                    {PAPER_SIZES.map(ps => (
                      <button
                        key={ps.label}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm rounded-md border transition-colors',
                          values.pageWidth === ps.width && values.pageHeight === ps.height
                            ? 'border-primary-400 bg-primary-50 text-primary-700'
                            : 'border-gray-200 hover:bg-gray-50 text-gray-700',
                        )}
                        onClick={() => update({ pageWidth: ps.width, pageHeight: ps.height })}
                      >
                        {ps.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-500">方向</label>
                  <div className="flex gap-2">
                    <button
                      className={cn('flex-1 py-2 text-sm rounded-md border transition-colors',
                        values.orientation === 'portrait'
                          ? 'border-primary-400 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-600')}
                      onClick={() => handleOrientationChange('portrait')}
                    >
                      纵向
                    </button>
                    <button
                      className={cn('flex-1 py-2 text-sm rounded-md border transition-colors',
                        values.orientation === 'landscape'
                          ? 'border-primary-400 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-600')}
                      onClick={() => handleOrientationChange('landscape')}
                    >
                      横向
                    </button>
                  </div>
                </div>
              </Tabs.Content>

              {/* === 版式 Tab === */}
              <Tabs.Content value="layout" className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-500">应用于</label>
                  <div className="space-y-1">
                    {([
                      { value: 'wholeDocument' as const, label: '整篇文档' },
                      { value: 'thisPointForward' as const, label: '从本节开始' },
                      { value: 'section' as const, label: '本节' },
                    ]).map(opt => (
                      <button
                        key={opt.value}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm rounded-md border transition-colors',
                          values.applyTo === opt.value
                            ? 'border-primary-400 bg-primary-50 text-primary-700'
                            : 'border-gray-200 hover:bg-gray-50 text-gray-700',
                        )}
                        onClick={() => update({ applyTo: opt.value })}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-gray-400">
                  页眉和页脚设置将在后续版本中提供。
                </div>
              </Tabs.Content>
            </div>
          </Tabs.Root>

          {/* 底部按钮 */}
          <div className="flex flex-shrink-0 items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
            <button
              className="px-4 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-md transition-colors"
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="px-4 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-md transition-colors"
              onClick={() => { onApply?.(values); onClose() }}
            >
              确定
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
      <label className="text-xs text-gray-500">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          className="w-16 px-2 py-1.5 text-sm border border-gray-200 rounded-md
                     focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-200"
          value={value}
          min={min} max={max}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        <span className="text-xs text-gray-400">px ({mmValue}mm)</span>
      </div>
    </div>
  )
}

/** 页面预览 — 缩略图形式显示边距 */
function PagePreview({ values }: { values: PageSetupValues }) {
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
        <label className="text-xs text-gray-400 mb-1 block">预览</label>
        <svg
          width={previewW + 10} height={previewH + 10}
          className="border border-gray-200 rounded bg-white"
        >
          {/* 页面轮廓 */}
          <rect x={2} y={2} width={previewW + 6} height={previewH + 6}
            fill="#fff" stroke="#d1d5db" strokeWidth={1} />

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
