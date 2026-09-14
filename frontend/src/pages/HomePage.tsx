// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// 首页 - 文档列表
// ============================================================

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FileText,
  FilePlus,
  Search,
  FolderOpen,
  Clock,
  Trash2,
} from 'lucide-react'
import { documentApi, type DocumentListItem } from '@/services/api'
import { formatDate, cn } from '@/lib/utils'
import { GiteeRepoLink } from '@/components/common/GiteeRepoLink'
import { MOCK_DOCUMENT_LIST } from '@/mocks/documents'

export default function HomePage() {
  const navigate = useNavigate()
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchKeyword, setSearchKeyword] = useState('')

  useEffect(() => {
    loadDocuments()
  }, [])

  async function loadDocuments() {
    setLoading(true)
    try {
      const res = await documentApi.list({ page: 1, size: 50 })
      setDocuments(res.data.data.records)
    } catch (err) {
      console.error('加载文档列表失败:', err)
      // 后端不可用: 使用 Mock 数据 (与 EditorPage 兜底同源, 见 src/mocks/documents.ts)
      setDocuments(MOCK_DOCUMENT_LIST)
    } finally {
      setLoading(false)
    }
  }

  const filteredDocs = documents.filter((doc) =>
    doc.title.toLowerCase().includes(searchKeyword.toLowerCase())
  )

  const handleNewDocument = () => {
    navigate('/editor/new')
  }

  const handleOpenDocument = (id: string) => {
    navigate(`/editor/${id}`)
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定删除该文档？')) return
    try {
      await documentApi.delete(id)
      setDocuments(prev => prev.filter(d => d.id !== id))
    } catch (err) {
      console.error('删除失败:', err)
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* 顶部导航 */}
      <header className="h-header bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-primary-600">
            <FileText size={24} />
            <h1 className="text-lg font-semibold">EMR Document Editor</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <GiteeRepoLink />
          <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700
                          flex items-center justify-center text-sm font-medium">
            U
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden p-8">
        <div className="max-w-5xl mx-auto">
          {/* 页面标题和新建按钮 */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">我的文档</h2>
              <p className="text-gray-500 mt-1">管理和编辑所有结构化文档</p>
            </div>
            <button
              className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white
                         rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
              onClick={handleNewDocument}
            >
              <FilePlus size={18} />
              <span className="font-medium">新建文档</span>
            </button>
          </div>

          {/* 搜索栏 */}
          <div className="relative mb-6">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg
                         text-sm outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
                         placeholder:text-gray-400"
              placeholder="搜索文档标题..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
            />
          </div>

          {/* 文档列表 */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-gray-400">加载中...</div>
            </div>
          ) : filteredDocs.length > 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      文档标题
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      状态
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">
                      最后编辑
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">
                      更新时间
                    </th>
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map((doc) => (
                    <tr
                      key={doc.id}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => handleOpenDocument(doc.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <FileText size={18} className="text-primary-500 flex-shrink-0" />
                          <span className="text-sm font-medium text-gray-900">{doc.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={doc.status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell">
                        {doc.updatedBy || doc.createdBy}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} className="text-gray-400" />
                          {formatDate(doc.updatedAt)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                          onClick={(e) => handleDelete(doc.id, e)}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <FolderOpen size={48} className="mb-4 text-gray-300" />
              <p className="text-base font-medium text-gray-500">暂无文档</p>
              <p className="text-sm mt-1">点击"新建文档"开始创建</p>
              <button
                className="mt-4 flex items-center gap-2 px-4 py-2 bg-primary-600 text-white
                           rounded-lg hover:bg-primary-700 transition-colors"
                onClick={handleNewDocument}
              >
                <FilePlus size={16} />
                新建文档
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    draft: {
      label: '草稿',
      className: 'bg-warning-100 text-yellow-700',
    },
    published: {
      label: '已发布',
      className: 'bg-success-100 text-green-700',
    },
    archived: {
      label: '已归档',
      className: 'bg-gray-100 text-gray-600',
    },
  }

  const { label, className } = config[status] || {
    label: status,
    className: 'bg-gray-100 text-gray-600',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        className
      )}
    >
      {label}
    </span>
  )
}
