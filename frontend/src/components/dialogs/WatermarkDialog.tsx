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
// ============================================================

import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Type, Palette, RotateCw } from 'lucide-react'
import type { WatermarkConfig } from '@/engine'

interface WatermarkDialogProps {
  open: boolean
  onClose: () => void
  initialConfig?: Partial<WatermarkConfig>
  onApply?: (config: WatermarkConfig) => void
}

const DEFAULTS: WatermarkConfig = {
  type: 'tile',
  text: '内部资料',
  fontSize: 48,
  color: '#000000',
  opacity: 0.08,
  rotation: 45,
  spacing: 200,
  imageUrl: '',
  imageScale: 0.4,
}

export function WatermarkDialog({ open, onClose, initialConfig, onApply }: WatermarkDialogProps) {
  const [config, setConfig] = useState<WatermarkConfig>({ ...DEFAULTS, ...initialConfig })

  useEffect(() => { if (open) setConfig({ ...DEFAULTS, ...initialConfig }) }, [open, initialConfig])

  const update = (patch: Partial<WatermarkConfig>) => setConfig(v => ({ ...v, ...patch }))

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50
                     flex max-h-[85vh] w-[380px] flex-col overflow-hidden
                     bg-white rounded-lg shadow-xl border border-gray-200"
        >
          <div className="flex flex-shrink-0 items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Type size={16} className="text-gray-500" />
              <Dialog.Title className="text-sm font-medium text-gray-800">水印设置</Dialog.Title>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
            {/* 水印文字 */}
            <Field label="水印文字" icon={<Type size={12} />}>
              <input
                type="text"
                value={config.text || ''}
                onChange={(e) => update({ text: e.target.value })}
                placeholder="例如: 内部资料"
                className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:border-blue-400"
              />
            </Field>

            {/* 字号 + 旋转 */}
            <div className="flex gap-3">
              <Field label="字号" className="flex-1">
                <input
                  type="number"
                  value={config.fontSize || 48}
                  onChange={(e) => update({ fontSize: Number(e.target.value) || 48 })}
                  min={12} max={120}
                  className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                />
              </Field>
              <Field label="旋转" icon={<RotateCw size={12} />} className="flex-1">
                <input
                  type="number"
                  value={config.rotation || 45}
                  onChange={(e) => update({ rotation: Number(e.target.value) || 45 })}
                  min={0} max={90}
                  className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                />
              </Field>
            </div>

            {/* 颜色 + 透明度 */}
            <div className="flex gap-3">
              <Field label="颜色" icon={<Palette size={12} />} className="flex-1">
                <input
                  type="color"
                  value={config.color || '#000000'}
                  onChange={(e) => update({ color: e.target.value })}
                  className="w-full h-8 border border-gray-200 rounded cursor-pointer"
                />
              </Field>
              <Field label="透明度" className="flex-1">
                <input
                  type="range"
                  value={(config.opacity ?? 0.08) * 100}
                  onChange={(e) => update({ opacity: Number(e.target.value) / 100 })}
                  min={1} max={30}
                  className="w-full"
                />
                <span className="text-[10px] text-gray-400">{Math.round((config.opacity ?? 0.08) * 100)}%</span>
              </Field>
            </div>

            {/* 间距 */}
            <Field label="图案间距">
              <input
                type="number"
                value={config.spacing || 200}
                onChange={(e) => update({ spacing: Number(e.target.value) || 200 })}
                min={100} max={500} step={20}
                className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:border-blue-400"
              />
            </Field>
          </div>

          <div className="flex flex-shrink-0 justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">取消</button>
            <button
              onClick={() => { onApply?.(config); onClose() }}
              className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              应用水印
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
      <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500 mb-1">
        {icon}
        {label}
      </label>
      {children}
    </div>
  )
}
