// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// LanguageMenu — 界面语言切换 (顶栏右侧)
//
// ⚠ 本批只落基建: 全仓 564 处文案仍硬编码, 切到 English 后界面文字不会变,
// 只有 `<html lang>` 变。所以每一项都带「未全量接入」标注 —— 不标注就是让
// 用户以为点了没反应是坏了 (契约 §24: 正确性优先于便利)。
// 文案替换是下一批; 那批落地后把 NOT_WIRED_NOTICE 拿掉即可。
// ============================================================

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Languages } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'
import { LOCALES, NOT_WIRED_NOTICE } from '@/i18n/bootstrap'

export function LanguageMenu() {
  const { locale: current, setLocale } = useTranslation()
  const active = LOCALES.find((l) => l.locale === current) ?? LOCALES[0]

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1 h-8 px-2 rounded-full border border-line
                     text-sm text-chrome-ink-secondary transition-colors flex-shrink-0
                     hover:bg-chrome-muted hover:text-chrome-ink data-[state=open]:bg-chrome-muted"
          title={`界面语言（${NOT_WIRED_NOTICE}：切换只改 <html lang>，界面文案仍为中文）`}
          aria-label="界面语言"
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
                <span className="text-chrome-ink-muted">{NOT_WIRED_NOTICE}</span>
                {selected && <Check size={12} className="ml-auto text-chrome-accent-ink" />}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
