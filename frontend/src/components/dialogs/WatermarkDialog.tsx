// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// WatermarkDialog — 水印设置对话框 (R50, v6.0)
//
// 配置: 文字/字号/颜色/透明度/旋转/间距/类型
// 调用 Editor.setWatermark() 应用到 Canvas
//
// onRemove 由调用方**仅在当前文档已有水印时**传入 —— 水印是文档内容
// (契约 §12.4), 只能设不能删等于半接通, 所以移除入口与设置入口必须同在。
// ============================================================

import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Type, Palette, RotateCw, Trash2 } from 'lucide-react'
import type { WatermarkConfig } from '@/engine'
import { useTranslation } from '@/i18n/useTranslation'

interface WatermarkDialogProps {
  open: boolean
  onClose: () => void
  initialConfig?: Partial<WatermarkConfig>
  onApply?: (config: WatermarkConfig) => void
  /** 移除当前水印 (契约 §12.4)。仅当文档已有水印时由调用方传入 */
  onRemove?: () => void
}

/** 默认值 (text 走 i18n, 在组件内按当前语言 seed) */
const DEFAULTS: Omit<WatermarkConfig, 'text'> = {
  type: 'tile',
  fontSize: 48,
  color: '#000000',
  opacity: 0.08,
  rotation: 45,
  spacing: 200,
  imageUrl: '',
  imageScale: 0.4,
}

export function WatermarkDialog({ open, onClose, initialConfig, onApply, onRemove }: WatermarkDialogProps) {
  const { t } = useTranslation()
  // 默认水印文字按当前语言 seed (新建水印时的初值; 已有水印仍用 initialConfig)
  const withDefaults = (base?: Partial<WatermarkConfig>): WatermarkConfig =>
    ({ ...DEFAULTS, text: t('watermark.internalMark'), ...base })
  const [config, setConfig] = useState<WatermarkConfig>(() => withDefaults(initialConfig))

  useEffect(() => { if (open) setConfig(withDefaults(initialConfig)) }, [open, initialConfig])  // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<WatermarkConfig>) => setConfig(v => ({ ...v, ...patch }))

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                     flex max-h-[85vh] w-[380px] flex-col overflow-hidden
                     bg-chrome rounded-lg shadow-xl border border-line"
        >
          <div className="flex flex-shrink-0 items-center justify-between px-5 py-3 border-b border-line-subtle">
            <div className="flex items-center gap-2">
              <Type size={16} className="text-chrome-ink-tertiary" />
              <Dialog.Title className="text-sm font-medium text-chrome-ink-strong">{t('dialog.title.watermark')}</Dialog.Title>
            </div>
            <button onClick={onClose} aria-label={t('common.close')}
                    className="p-1 rounded hover:bg-chrome-muted text-chrome-ink-muted hover:text-chrome-ink-secondary">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
            {/* 水印文字 */}
            <Field label={t('watermark.text')} icon={<Type size={12} />}>
              <input
                type="text"
                value={config.text || ''}
                onChange={(e) => update({ text: e.target.value })}
                placeholder={t('watermark.textPlaceholder')}
                className="w-full text-sm px-2 py-1.5 border border-line rounded focus:outline-none focus:border-blue-400"
              />
            </Field>

            {/* 字号 + 旋转 */}
            <div className="flex gap-3">
              <Field label={t('watermark.fontSize')} className="flex-1">
                <input
                  type="number"
                  value={config.fontSize || 48}
                  onChange={(e) => update({ fontSize: Number(e.target.value) || 48 })}
                  min={12} max={120}
                  className="w-full text-sm px-2 py-1.5 border border-line rounded focus:outline-none focus:border-blue-400"
                />
              </Field>
              <Field label={t('watermark.rotation')} icon={<RotateCw size={12} />} className="flex-1">
                <input
                  type="number"
                  value={config.rotation || 45}
                  onChange={(e) => update({ rotation: Number(e.target.value) || 45 })}
                  min={0} max={90}
                  className="w-full text-sm px-2 py-1.5 border border-line rounded focus:outline-none focus:border-blue-400"
                />
              </Field>
            </div>

            {/* 颜色 + 透明度 */}
            <div className="flex gap-3">
              <Field label={t('watermark.color')} icon={<Palette size={12} />} className="flex-1">
                <input
                  type="color"
                  value={config.color || '#000000'}
                  onChange={(e) => update({ color: e.target.value })}
                  className="w-full h-8 border border-line rounded cursor-pointer"
                />
              </Field>
              <Field label={t('watermark.opacity')} className="flex-1">
                <input
                  type="range"
                  value={(config.opacity ?? 0.08) * 100}
                  onChange={(e) => update({ opacity: Number(e.target.value) / 100 })}
                  min={1} max={30}
                  className="w-full"
                />
                <span className="text-[10px] text-chrome-ink-muted">{Math.round((config.opacity ?? 0.08) * 100)}%</span>
              </Field>
            </div>

            {/* 间距 */}
            <Field label={t('watermark.spacing')}>
              <input
                type="number"
                value={config.spacing || 200}
                onChange={(e) => update({ spacing: Number(e.target.value) || 200 })}
                min={100} max={500} step={20}
                className="w-full text-sm px-2 py-1.5 border border-line rounded focus:outline-none focus:border-blue-400"
              />
            </Field>
          </div>

          <div className="flex flex-shrink-0 items-center justify-end gap-2 px-5 py-3 border-t border-line-subtle bg-chrome-subtle rounded-b-lg">
            {/* 移除只在已有水印时出现 (调用方传入 onRemove) —— 与"应用"同处, 不留单向入口 */}
            {onRemove && (
              <button
                onClick={() => { onRemove(); onClose() }}
                className="mr-auto flex items-center gap-1 px-2 py-1.5 text-xs text-red-600 rounded hover:bg-red-50"
                title={t('watermark.removeTitle')}
              >
                <Trash2 size={12} />
                {t('watermark.remove')}
              </button>
            )}
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-chrome-ink-secondary hover:text-chrome-ink-strong">{t('common.cancel')}</button>
            <button
              onClick={() => { onApply?.(config); onClose() }}
              className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {t('watermark.apply')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---- 工具 ----

function Field({ label, icon, children, className }: {
  label: string; icon?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <div className={className}>
      <label className="flex items-center gap-1 text-[11px] font-medium text-chrome-ink-tertiary mb-1">
        {icon}
        {label}
      </label>
      {children}
    </div>
  )
}