// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ComparePage — 文档版本比较页面 (R2)
// 路由: /compare/:oldId/:newId
// ============================================================

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DocumentCompareView } from '@/components/views/DocumentCompareView'
import { documentApi } from '@/services/api'
import type { DocumentTree } from '@/engine/document/core/DocumentModel'
import type { NodePool } from '@/engine/document/core/NodePool'
import { loadComparePair } from '@/lib/compareDocuments'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from '@/i18n/useTranslation'

export default function ComparePage() {
  const { t } = useTranslation()
  const { oldId, newId } = useParams<{ oldId: string; newId: string }>()
  const navigate = useNavigate()
  const [oldDoc, setOldDoc] = useState<DocumentTree | null>(null)
  const [newDoc, setNewDoc] = useState<DocumentTree | null>(null)
  const [oldPool, setOldPool] = useState<NodePool | null>(null)
  const [newPool, setNewPool] = useState<NodePool | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!oldId || !newId) return
    setLoading(true)
    Promise.all([
      documentApi.getById(oldId),
      documentApi.getById(newId),
    ]).then(([oldRes, newRes]) => {
      const oldData = oldRes.data.data
      const newData = newRes.data.data
      if (oldData?.content && newData?.content) {
        try {
          // 装载走 DocumentLoader 单一加载路径 (见 lib/compareDocuments) —— 池必须是
          // **完整**的, 自行 buildNodePool 只塞根节点会让比较视图读不到任何正文。
          const pair = loadComparePair(oldData.content, newData.content)
          setOldDoc(pair.old.doc)
          setNewDoc(pair.new.doc)
          setOldPool(pair.old.pool)
          setNewPool(pair.new.pool)
        } catch { setError(t('compare.parseError')) }
      } else {
        setError(t('compare.emptyError'))
      }
    }).catch(() => setError(t('compare.loadError')))
      .finally(() => setLoading(false))
  }, [oldId, newId, t])

  if (loading) return <div className="flex items-center justify-center h-full text-chrome-ink-muted">{t('editorPage.loading')}</div>
  if (error) return <div className="flex items-center justify-center h-full text-red-500">{error}</div>
  if (!oldDoc || !newDoc || !oldPool || !newPool) return null

  return (
    <div className="h-full flex flex-col bg-chrome">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-line">
        <button
          className="flex items-center gap-1 text-sm text-chrome-ink-secondary hover:text-chrome-ink"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} />
          {t('common.back')}
        </button>
        <h1 className="text-base font-semibold text-chrome-ink-strong">{t('compare.title')}</h1>
        <span className="text-xs text-chrome-ink-muted">{t('compare.versionIds', { oldId: oldId ?? '', newId: newId ?? '' })}</span>
      </div>
      <div className="flex-1 overflow-auto">
        <DocumentCompareView
          oldDoc={oldDoc} oldPool={oldPool}
          newDoc={newDoc} newPool={newPool}
        />
      </div>
    </div>
  )
}
