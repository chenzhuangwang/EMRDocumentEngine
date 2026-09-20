// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// LanguageMenu — 界面语言切换 (顶栏右侧)
//
// v6.1 文案全量替换: 全仓界面文字已接 LocaleMessages, 切到 en-US 后界面文案
// 真的会跟随刷新。本菜单不再需要"未全量接入"标注。
// ============================================================

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Languages } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'
import { LOCALES } from '@/i18n/bootstrap'

const TITLE_ZH = '界面语言'
const TITLE_EN = 'Interface Language'

export function LanguageMenu() {
  const { locale: current, setLocale } = useTranslation()
  const isEN = current === 'en-US'
  const titleStr = isEN ? TITLE_EN : TITLE_ZH
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