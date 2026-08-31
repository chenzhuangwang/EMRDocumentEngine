// ============================================================
// DocumentCompareView — 文档比较视图 (R47, v6.0)
//
// 双栏对比: 左(旧文档) | 右(新文档) + 差异高亮
// 对齐 TASK-516, UIUX §5.6
// ============================================================

import { useMemo } from 'react'
import { Equal, Plus, Minus, Edit3, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DocumentTree } from '@/engine/document/core/DocumentModel'
import { DocumentDiffer, type DiffResult } from '@/engine/DocumentDiffer'
import { NodePool } from '@/engine/document/core/NodePool'

// ---- 类型 ----

interface DocumentCompareViewProps {
  oldDoc: DocumentTree
  oldPool: NodePool
  newDoc: DocumentTree
  newPool: NodePool
  onAcceptChange?: (diff: DiffResult) => void
  onRejectChange?: (diff: DiffResult) => void
  onAcceptAll?: () => void
  onRejectAll?: () => void
}

// ---- 组件 ----

export function DocumentCompareView({
  oldDoc, oldPool, newDoc, newPool,
  onAcceptChange, onRejectChange,
  onAcceptAll, onRejectAll,
}: DocumentCompareViewProps) {
  const diffs = useMemo(() => {
    return new DocumentDiffer().compare(oldDoc, oldPool, newDoc, newPool)
  }, [oldDoc, oldPool, newDoc, newPool])

  const stats = useMemo(() => {
    let insertions = 0, deletions = 0, modifications = 0, equal = 0
    for (const d of diffs) {
      if (d.op === 'insert') insertions++
      else if (d.op === 'delete') deletions++
      else if (d.op === 'modify') modifications++
      else equal++
    }
    return { insertions, deletions, modifications, equal }
  }, [diffs])

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 统计栏 */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-100 bg-gray-50 text-xs">
        <span className="font-medium text-gray-700">文档比较</span>
        <span className="flex items-center gap-1 text-green-600">
          <Plus size={12} /> {stats.insertions} 新增
        </span>
        <span className="flex items-center gap-1 text-red-600">
          <Minus size={12} /> {stats.deletions} 删除
        </span>
        <span className="flex items-center gap-1 text-amber-600">
          <Edit3 size={12} /> {stats.modifications} 修改
        </span>
        <span className="flex items-center gap-1 text-gray-400">
          <Equal size={12} /> {stats.equal} 相同
        </span>

        <div className="flex-1" />

        <button
          onClick={onAcceptAll}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-700
                     rounded hover:bg-green-100 transition-colors"
        >
          <Check size={12} /> 全部接受
        </button>
        <button
          onClick={onRejectAll}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-red-50 text-red-700
                     rounded hover:bg-red-100 transition-colors"
        >
          <X size={12} /> 全部拒绝
        </button>
      </div>

      {/* 差异列表 */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {diffs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Equal size={36} className="mb-2 opacity-30" />
            <span className="text-sm">两份文档完全相同</span>
          </div>
        ) : (
          diffs.map((diff, idx) => (
            <DiffRow
              key={`${diff.paraId}-${idx}`}
              diff={diff}
              oldPool={oldPool}
              newPool={newPool}
              onAccept={() => onAcceptChange?.(diff)}
              onReject={() => onRejectChange?.(diff)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ---- 单行差异 ----

function DiffRow({
  diff, oldPool, newPool,
  onAccept, onReject,
}: {
  diff: DiffResult
  oldPool: NodePool
  newPool: NodePool
  onAccept?: () => void
  onReject?: () => void
}) {
  const config = DIFF_CONFIG[diff.op]
  const text = getDiffText(diff, oldPool, newPool)

  return (
    <div className={cn('px-4 py-2.5 flex items-start gap-3', config.bg)}>
      {/* 操作图标 */}
      <span className={cn('mt-0.5 flex-shrink-0', config.iconColor)}>
        {config.icon}
      </span>

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn('text-xs font-medium', config.labelColor)}>
            {config.label}
          </span>
          {diff.op === 'modify' && diff.textChanges && (
            <span className="text-[10px] text-gray-400">
              {diff.textChanges.filter(c => c.op !== 'equal').length} 处文本变更
            </span>
          )}
        </div>

        {/* 段落文本 */}
        <div className={cn(
          'text-sm leading-relaxed rounded px-2 py-1',
          config.textBg,
        )}>
          {diff.op === 'modify' && diff.textChanges ? (
            <span>
              {diff.textChanges.map((tc, i) => (
                <span
                  key={i}
                  className={cn(
                    tc.op === 'insert' && 'bg-green-200 text-green-900',
                    tc.op === 'delete' && 'bg-red-200 text-red-900 line-through',
                    tc.op === 'equal' && 'text-gray-600',
                  )}
                >
                  {tc.text}
                </span>
              ))}
            </span>
          ) : (
            <span className={cn(
              diff.op === 'delete' && 'line-through',
              diff.op === 'insert' && 'text-green-800',
              diff.op === 'equal' && 'text-gray-500',
            )}>
              {text}
            </span>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      {diff.op !== 'equal' && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onAccept}
            title="接受"
            className="p-1 rounded hover:bg-green-100 text-gray-300 hover:text-green-600"
          >
            <Check size={14} />
          </button>
          <button
            onClick={onReject}
            title="拒绝"
            className="p-1 rounded hover:bg-red-100 text-gray-300 hover:text-red-600"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// ---- 差异配置 ----

const DIFF_CONFIG = {
  insert: {
    bg: 'bg-green-50/60',
    label: '新增段落',
    labelColor: 'text-green-700',
    icon: <Plus size={14} />,
    iconColor: 'text-green-500',
    textBg: 'bg-green-50',
  },
  delete: {
    bg: 'bg-red-50/60',
    label: '删除段落',
    labelColor: 'text-red-700',
    icon: <Minus size={14} />,
    iconColor: 'text-red-500',
    textBg: 'bg-red-50',
  },
  modify: {
    bg: 'bg-amber-50/60',
    label: '修改段落',
    labelColor: 'text-amber-700',
    icon: <Edit3 size={14} />,
    iconColor: 'text-amber-500',
    textBg: 'bg-amber-50',
  },
  equal: {
    bg: '',
    label: '相同',
    labelColor: 'text-gray-400',
    icon: <Equal size={14} />,
    iconColor: 'text-gray-400',
    textBg: '',
  },
}

// ---- 工具 ----

function getDiffText(diff: DiffResult, oldPool: NodePool, newPool: NodePool): string {
  const pool = diff.op === 'delete' ? oldPool : newPool
  const targetId = diff.op === 'delete' ? diff.oldParaId : diff.newParaId || diff.paraId
  if (!targetId) return '(无内容)'

  const para = pool.nodes.get(targetId) as { children?: readonly string[] } | undefined
  if (!para?.children) return '(无内容)'

  const parts: string[] = []
  for (const cid of para.children) {
    const n = pool.nodes.get(cid) as { type?: string; text?: string } | undefined
    if (n?.type === 'text' || n?.type === 'field') parts.push(n.text || '')
    else if (n?.type === 'image') parts.push('[图片]')
    else if (n?.type === 'footnote_ref') parts.push('[脚注]')
  }
  return parts.join('') || '(空段落)'
}

// 移除旧的 findNodeById / findNodeRecursive / findInChildren / buildNodePoolFromDoc
