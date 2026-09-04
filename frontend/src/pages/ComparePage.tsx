// ============================================================
// ComparePage — 文档版本比较页面 (R2)
// 路由: /compare/:oldId/:newId
// ============================================================

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DocumentCompareView } from '@/components/views/DocumentCompareView'
import { documentApi } from '@/services/api'
import type { DocumentTree } from '@/engine/document/core/DocumentModel'
import { NodePool, buildNodePool } from '@/engine/document/core/NodePool'
import { ArrowLeft } from 'lucide-react'

export default function ComparePage() {
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
          const oldTree = JSON.parse(oldData.content) as DocumentTree
          const newTree = JSON.parse(newData.content) as DocumentTree
          setOldDoc(oldTree)
          setNewDoc(newTree)
          const oldMap = new Map<string, import('@/engine/document/core/DocumentModel').BaseNode>()
          oldMap.set(oldTree.id, oldTree as unknown as import('@/engine/document/core/DocumentModel').BaseNode)
          setOldPool(buildNodePool(oldMap, { body: oldTree.id }))
          const newMap = new Map<string, import('@/engine/document/core/DocumentModel').BaseNode>()
          newMap.set(newTree.id, newTree as unknown as import('@/engine/document/core/DocumentModel').BaseNode)
          setNewPool(buildNodePool(newMap, { body: newTree.id }))
        } catch { setError('文档解析失败') }
      } else {
        setError('文档内容为空')
      }
    }).catch(() => setError('加载文档失败'))
      .finally(() => setLoading(false))
  }, [oldId, newId])

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">加载中...</div>
  if (error) return <div className="flex items-center justify-center h-full text-red-500">{error}</div>
  if (!oldDoc || !newDoc || !oldPool || !newPool) return null

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-200">
        <button
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <h1 className="text-base font-semibold text-gray-800">文档比较</h1>
        <span className="text-xs text-gray-400">旧版本 ID: {oldId} → 新版本 ID: {newId}</span>
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
