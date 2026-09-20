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
// v6.1 菜单项 label/hint 按 locale 选 zh-CN / en-US 两套字面量。
// ============================================================

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Leaf, Moon, Palette, Printer, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUIStore } from '@/store'
import { CHROME_PRESETS } from '@/platform/dom/chromeTheme'
import { useTranslation } from '@/i18n/useTranslation'
import type { ThemePreset } from '@/engine'

const PRESET_ICONS: Record<ThemePreset, LucideIcon> = {
  standard: Sun,
  eyeCare: Leaf,
  print: Printer,
  dark: Moon,
}

const THEME_TITLE: Record<'zh-CN' | 'en-US', string> = {
  'zh-CN': '界面主题',
  'en-US': 'Interface Theme',
}

export function ThemeMenu() {
  const themePreset = useUIStore((s) => s.themePreset)
  const setThemePreset = useUIStore((s) => s.setThemePreset)
  const { locale } = useTranslation()
  const isEN = locale === 'en-US'
  const titleStr = THEME_TITLE[locale] ?? THEME_TITLE['zh-CN']
  const current = CHROME_PRESETS.find((p) => p.preset === themePreset) ?? CHROME_PRESETS[0]

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
          <span className="hidden sm:inline">{isEN ? current.labelEn : current.label}</span>
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
            return (
              <DropdownMenu.Item
                key={item.preset}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-chrome-ink-body outline-none
                           cursor-default data-[highlighted]:bg-chrome-muted data-[highlighted]:text-chrome-ink"
                onSelect={() => setThemePreset(item.preset)}
              >
                <Icon size={14} />
                <span>{isEN ? item.labelEn : item.label}</span>
                <span className="text-chrome-ink-muted">{isEN ? item.hintEn : item.hint}</span>
                {active && <Check size={12} className="ml-auto text-chrome-accent-ink" />}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}