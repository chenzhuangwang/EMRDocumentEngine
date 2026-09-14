// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Gitee 开源仓库入口
// 首页顶栏与编辑器顶栏共用同一入口，避免 URL / 图标各写一份
// ============================================================

/** 开源仓库地址 */
export const GITEE_REPO_URL = 'https://gitee.com/wangwang_1_1665527118/emrdocument-engine'

/** Gitee 品牌图标（lucide 不含品牌图标，此处内联官方 path） */
export function GiteeIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.266.592.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.266.592.593.592h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.593.593 0 0 0-.592-.593h-4.15a.592.592 0 0 1-.592-.592v-1.482a.593.593 0 0 1 .593-.592h6.815c.327 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H5.926a.593.593 0 0 1-.593-.593V9.778a4.444 4.444 0 0 1 4.445-4.444h8.296Z" />
    </svg>
  )
}

/** 顶栏仓库链接 — 胶囊样式，与两侧头像/工具栏同高 */
export function GiteeRepoLink() {
  return (
    <a
      href={GITEE_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="开源仓库 · Gitee"
      aria-label="开源仓库 · Gitee"
      className="flex items-center gap-1.5 h-8 px-3 rounded-full border border-gray-200
                 text-sm text-gray-600 hover:text-[#C71D23] hover:border-[#C71D23]/30
                 hover:bg-[#C71D23]/5 transition-colors flex-shrink-0"
    >
      <GiteeIcon size={16} className="text-[#C71D23]" />
      <span className="font-medium hidden sm:inline">Gitee</span>
    </a>
  )
}
