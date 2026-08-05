// ============================================================
// QCResultPanel — 质控结果面板 (R52, v6.0)
//
// 显示 QC 检查结果: 评分+等级+问题列表
// 错误/警告/信息 三级 + 点击定位
// ============================================================

import { AlertTriangle, AlertCircle, Info, Shield, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QCResult, QCIssue, QCGrade } from '@/engine/qc/QCEngine'

// ---- 组件 ----

interface QCResultPanelProps {
  result: QCResult | null
  onIssueClick?: (issue: QCIssue) => void
  onRecheck?: () => void
}

export function QCResultPanel({ result, onIssueClick, onRecheck }: QCResultPanelProps) {
  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Shield size={36} className="mb-2 opacity-30" />
        <span className="text-sm">尚未进行质控检查</span>
        {onRecheck && (
          <button
            onClick={onRecheck}
            className="mt-3 px-3 py-1.5 text-xs bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100"
          >
            开始检查
          </button>
        )}
      </div>
    )
  }

  const { score, grade, issues, stats } = result

  return (
    <div className="flex flex-col h-full">
      {/* 评分卡片 */}
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-600">文书质控评分</span>
          <span className="text-[10px] text-gray-400">
            {new Date(result.checkedAt).toLocaleTimeString('zh-CN')}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold',
            GRADE_STYLE[grade].bg,
            GRADE_STYLE[grade].text,
          )}>
            {grade}
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-800">{score}</div>
            <div className="text-[10px] text-gray-400">满分 100</div>
          </div>
        </div>
      </div>

      {/* 统计条 */}
      <div className="flex gap-3 px-4 py-2 border-b border-gray-50 text-[10px]">
        <span className="flex items-center gap-1 text-red-600">
          <AlertCircle size={10} />
          {stats.errors} 错误
        </span>
        <span className="flex items-center gap-1 text-amber-600">
          <AlertTriangle size={10} />
          {stats.warnings} 警告
        </span>
        <span className="flex items-center gap-1 text-blue-600">
          <Info size={10} />
          {stats.infos} 提示
        </span>
      </div>

      {/* 问题列表 */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <Shield size={28} className="mb-1 opacity-40" />
            <span className="text-xs">文书质控通过，无问题</span>
          </div>
        ) : (
          issues.map((issue, idx) => (
            <button
              key={`${issue.ruleId}-${idx}`}
              onClick={() => onIssueClick?.(issue)}
              className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-start gap-2"
            >
              <span className={cn('mt-0.5 flex-shrink-0', SEVERITY_ICON[issue.severity].color)}>
                {SEVERITY_ICON[issue.severity].icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-700 truncate">{issue.ruleName}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{issue.message}</div>
              </div>
              <ChevronRight size={12} className="text-gray-300 flex-shrink-0 mt-0.5" />
            </button>
          ))
        )}
      </div>

      {/* 重新检查 */}
      {onRecheck && (
        <div className="px-4 py-2 border-t border-gray-100">
          <button
            onClick={onRecheck}
            className="w-full text-xs py-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
          >
            重新检查
          </button>
        </div>
      )}
    </div>
  )
}

// ---- 样式常量 ----

const GRADE_STYLE: Record<QCGrade, { bg: string; text: string }> = {
  A: { bg: 'bg-green-100', text: 'text-green-700' },
  B: { bg: 'bg-blue-100', text: 'text-blue-700' },
  C: { bg: 'bg-amber-100', text: 'text-amber-700' },
  D: { bg: 'bg-red-100', text: 'text-red-700' },
}

const SEVERITY_ICON = {
  error: { icon: <AlertCircle size={14} />, color: 'text-red-500' },
  warning: { icon: <AlertTriangle size={14} />, color: 'text-amber-500' },
  info: { icon: <Info size={14} />, color: 'text-blue-500' },
}
