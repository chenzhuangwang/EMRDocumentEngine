// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// LanguageMenu — 界面语言切换 (顶栏右侧)
//
// 文案一律走 LocaleMessages (§27.3 locale 单例), 不在组件里维护第二份
// zh/en 字面量 —— 那份副本不会跟着语言包更新, 且要"猜"当前语言。
// ============================================================

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Languages } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'
import { LOCALES } from '@/i18n/bootstrap'

export function LanguageMenu() {
  const { locale: current, setLocale, t } = useTranslation()
  const titleStr = t('headerBar.languageMenu')
  const active = LOCALES.find((l) => l.locale === current) ?? LOCALES[0]

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
          <Languages size={16} />
          <span className="hidden sm:inline">{active.label}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[180px] bg-chrome rounded-md shadow-lg border border-line py-1 z-50"
          sideOffset={4}
          align="end"
        >
          {LOCALES.map((item) => {
            const selected = item.locale === current
            return (
              <DropdownMenu.Item
                key={item.locale}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-chrome-ink-body outline-none
                           cursor-default data-[highlighted]:bg-chrome-muted data-[highlighted]:text-chrome-ink"
                onSelect={() => setLocale(item.locale)}
              >
                <span>{item.label}</span>
                {selected && <Check size={12} className="ml-auto text-chrome-accent-ink" />}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}