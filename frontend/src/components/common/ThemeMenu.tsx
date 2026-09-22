// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ThemeMenu — 界面外壳 (chrome) 主题切换 (顶栏右侧)
//
// chrome 主题切的是外壳 19 token + 画布 28 token 双触发 (EditorProvider 接
// useUIStore.themePreset → Editor.setTheme, 见 EditorProvider.tsx 与
// canvasTokens.ts)。
//
// 文案一律走 LocaleMessages —— preset → 键的映射留在本文件, 字面量不留。
// ============================================================

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Leaf, Moon, Palette, Printer, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUIStore } from '@/store'
import { CHROME_PRESETS } from '@/platform/dom/chromeTheme'
import { useTranslation } from '@/i18n/useTranslation'
import type { LocaleMessages, ThemePreset } from '@/engine'

const PRESET_ICONS: Record<ThemePreset, LucideIcon> = {
  standard: Sun,
  eyeCare: Leaf,
  print: Printer,
  dark: Moon,
}

/** preset → 菜单 label/hint 的 i18n 键 */
const PRESET_KEYS: Record<ThemePreset, { label: keyof LocaleMessages; hint: keyof LocaleMessages }> = {
  standard: { label: 'theme.standard', hint: 'theme.standardHint' },
  eyeCare:  { label: 'theme.eyeCare',  hint: 'theme.eyeCareHint' },
  print:    { label: 'theme.print',    hint: 'theme.printHint' },
  dark:     { label: 'theme.dark',     hint: 'theme.darkHint' },
}

export function ThemeMenu() {
  const themePreset = useUIStore((s) => s.themePreset)
  const setThemePreset = useUIStore((s) => s.setThemePreset)
  const { t } = useTranslation()
  const titleStr = t('headerBar.themeMenu')
  const currentKeys = PRESET_KEYS[themePreset] ?? PRESET_KEYS.standard

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 h-8 px-2 rounded-full border border-line
                     text-sm text-chrome-ink-secondary transition-colors flex-shrink-0
                     hover:bg-chrome-muted hover:text-chrome-ink data-[state=open]:bg-chrome-muted"
          title={titleStr}
          aria-label={titleStr}
        >
          <Palette size={16} />
          <span className="hidden sm:inline">{t(currentKeys.label)}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[160px] bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4}
          align="end"
        >
          {CHROME_PRESETS.map((item) => {
            const Icon = PRESET_ICONS[item.preset]
            const active = item.preset === themePreset
            const keys = PRESET_KEYS[item.preset] ?? PRESET_KEYS.standard
            return (
              <DropdownMenu.Item
                key={item.preset}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-chrome-ink-body outline-none
                           cursor-default data-[highlighted]:bg-chrome-muted data-[highlighted]:text-chrome-ink"
                onSelect={() => setThemePreset(item.preset)}
              >
                <Icon size={14} />
                <span>{t(keys.label)}</span>
                <span className="text-chrome-ink-muted">{t(keys.hint)}</span>
                {active && <Check size={12} className="ml-auto text-chrome-accent-ink" />}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}