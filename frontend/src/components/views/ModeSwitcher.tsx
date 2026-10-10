// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ModeSwitcher — 编辑器模式切换下拉 (StatusBar 内嵌)
// ============================================================

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Edit3, Eye, FormInput, Type, PenTool, Printer, ChevronDown } from 'lucide-react'
import type { EditorMode } from '@emrde/document-engine'
import { useTranslation } from '@/i18n/useTranslation'

interface ModeSwitcherProps {
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
}

const MODES: { mode: EditorMode; labelKey: 'mode.edit' | 'mode.readonly' | 'mode.form' | 'mode.clean' | 'mode.design' | 'mode.print'; icon: typeof Edit3 }[] = [
  { mode: 'edit',     labelKey: 'mode.edit',     icon: Edit3 },
  { mode: 'readonly', labelKey: 'mode.readonly', icon: Eye },
  { mode: 'form',     labelKey: 'mode.form',     icon: FormInput },
  { mode: 'clean',    labelKey: 'mode.clean',    icon: Type },
  { mode: 'design',   labelKey: 'mode.design',   icon: PenTool },
  { mode: 'print',    labelKey: 'mode.print',    icon: Printer },
]

export function ModeSwitcher({ mode, onModeChange }: ModeSwitcherProps) {
  const { t } = useTranslation()
  const current = MODES.find(m => m.mode === mode) || MODES[0]
  const Icon = current.icon

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-0.5 text-xs text-chrome-ink-muted hover:text-chrome-ink-secondary
                     p-0.5 rounded transition-colors hover:bg-chrome-muted data-[state=open]:bg-chrome-muted"
          title={t('mode.switchTitle')}
        >
          <Icon size={12} />
          <span className="hidden sm:inline">{t(current.labelKey)}</span>
          <ChevronDown size={10} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[100px] bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4} align="end"
        >
          {MODES.map(item => (
            <DropdownMenu.Item
              key={item.mode}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-chrome-ink-body outline-none
                         cursor-default data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700"
              onClick={() => onModeChange(item.mode)}
            >
              <item.icon size={14} />
              <span>{t(item.labelKey)}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
