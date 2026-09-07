// ============================================================
// PrintDialog — 打印对话框 (TASK-468, v5.0)
//
// 功能: 打印机选择 / 页码范围 / 份数 / 单双面 / 续打断点
// ============================================================

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Printer, FileText, Copy, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---- 类型 ----

export interface PrintSettings {
  printer: string
  pageRange: { start: number; end: number }
  copies: number
  duplex: boolean
  resumeFromPage: number | null  // 续打断点页码 (null=从头打印)
}

interface PrintDialogProps {
  open: boolean
  onClose: () => void
  totalPages: number
  initialSettings?: Partial<PrintSettings>
  onPrint?: (settings: PrintSettings) => void
}

// ---- 组件 ----

export function PrintDialog({
  open, onClose, totalPages,
  initialSettings, onPrint,
}: PrintDialogProps) {
  const [settings, setSettings] = useState<PrintSettings>({
    printer: '默认打印机',
    pageRange: { start: 1, end: totalPages },
    copies: 1,
    duplex: false,
    resumeFromPage: null,
    ...initialSettings,
  })

  const update = (patch: Partial<PrintSettings>) => setSettings(v => ({ ...v, ...patch }))

  // 页码范围预设
  const pagePresets = [
    { label: '全部', range: { start: 1, end: totalPages } },
    { label: '当前页', range: { start: 1, end: 1 } },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                     flex max-h-[85vh] w-[440px] flex-col overflow-hidden
                     bg-white rounded-lg shadow-xl border border-gray-200"
        >
          {/* 标题栏 */}
          <div className="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-gray-100">
            <Dialog.Title className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Printer size={16} className="text-gray-400" />
              打印
            </Dialog.Title>
            <button className="text-gray-400 hover:text-gray-600" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
            {/* 打印机 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500">打印机</label>
              <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-md bg-gray-50">
                <Printer size={14} className="text-gray-400" />
                <span className="text-sm text-gray-700 flex-1">{settings.printer}</span>
                <ChevronDown size={12} className="text-gray-400" />
              </div>
            </div>

            {/* 页码范围 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500">页码范围</label>
              <div className="flex gap-2">
                {pagePresets.map(p => (
                  <button
                    key={p.label}
                    className={cn(
                      'px-3 py-1.5 text-xs rounded-md border transition-colors',
                      settings.pageRange.start === p.range.start &&
                      settings.pageRange.end === p.range.end
                        ? 'border-primary-400 bg-primary-50 text-primary-700'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-600',
                    )}
                    onClick={() => update({ pageRange: p.range })}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md border transition-colors',
                    !pagePresets.some(p =>
                      p.range.start === settings.pageRange.start &&
                      p.range.end === settings.pageRange.end)
                      ? 'border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:bg-gray-50 text-gray-600',
                  )}
                >
                  自定义
                </button>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="number"
                  className="w-16 px-2 py-1 text-xs border border-gray-200 rounded-md
                             focus:outline-none focus:border-primary-400"
                  min={1} max={totalPages}
                  value={settings.pageRange.start}
                  onChange={(e) => update({
                    pageRange: { ...settings.pageRange, start: Number(e.target.value) || 1 },
                  })}
                />
                <span className="text-xs text-gray-400">至</span>
                <input
                  type="number"
                  className="w-16 px-2 py-1 text-xs border border-gray-200 rounded-md
                             focus:outline-none focus:border-primary-400"
                  min={1} max={totalPages}
                  value={settings.pageRange.end}
                  onChange={(e) => update({
                    pageRange: { ...settings.pageRange, end: Number(e.target.value) || totalPages },
                  })}
                />
                <span className="text-xs text-gray-400">页 (共 {totalPages} 页)</span>
              </div>
            </div>

            {/* 份数 + 双面 */}
            <div className="flex items-center gap-6">
              <div className="space-y-1.5 flex-1">
                <label className="text-xs font-medium text-gray-500">份数</label>
                <div className="flex items-center gap-1">
                  <Copy size={14} className="text-gray-400" />
                  <input
                    type="number"
                    className="w-16 px-2 py-1.5 text-sm border border-gray-200 rounded-md
                               focus:outline-none focus:border-primary-400"
                    min={1} max={99}
                    value={settings.copies}
                    onChange={(e) => update({ copies: Number(e.target.value) || 1 })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500">打印方式</label>
                <button
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md border transition-colors',
                    settings.duplex
                      ? 'border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:bg-gray-50 text-gray-600',
                  )}
                  onClick={() => update({ duplex: !settings.duplex })}
                >
                  {settings.duplex ? '双面打印' : '单面打印'}
                </button>
              </div>
            </div>

            {/* 续打断点 */}
            {settings.resumeFromPage !== null && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
                <FileText size={14} className="text-amber-500" />
                <span className="text-xs text-amber-700">
                  续打: 从第 {settings.resumeFromPage} 页开始
                </span>
                <button
                  className="ml-auto text-xs text-amber-600 hover:text-amber-800"
                  onClick={() => update({ resumeFromPage: null })}
                >
                  取消续打
                </button>
              </div>
            )}

            {/* 页数信息 */}
            <div className="text-xs text-gray-400 text-center">
              共 {totalPages} 页 · 打印 {
                settings.pageRange.end - settings.pageRange.start + 1
              } 页 · {settings.copies} 份 · {
                settings.duplex ? '双面' : '单面'
              }
            </div>
          </div>

          {/* 底部按钮 */}
          <div className="flex flex-shrink-0 items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
            <button
              className="px-4 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-md transition-colors"
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white
                         bg-primary-600 hover:bg-primary-700 rounded-md transition-colors"
              onClick={() => { onPrint?.(settings); onClose() }}
            >
              <Printer size={12} />
              打印
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
