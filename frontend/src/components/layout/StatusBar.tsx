// ============================================================
// 状态栏
// ============================================================

import { FileText, Type, Wifi, WifiOff } from 'lucide-react'
import { useEditorStore } from '@/store'
import { formatWordCount } from '@/lib/utils'

interface StatusBarProps {
  pageIndex?: number
  pageCount?: number
  wordCount?: number
  onlineCount?: number
}

export function StatusBar({
  pageIndex = 1,
  pageCount = 1,
  wordCount = 0,
  onlineCount = 0,
}: StatusBarProps) {
  const saveStatus = useEditorStore((s) => s.saveStatus)

  return (
    <footer className="h-statusbar bg-gray-50 border-t border-gray-200 flex items-center justify-between px-4 text-xs text-gray-500 flex-shrink-0 select-none">
      {/* 左侧：页面信息 */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <FileText size={12} />
          <span>第 {pageIndex} 页 / 共 {pageCount} 页</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Type size={12} />
          <span>{formatWordCount(wordCount)} 字</span>
        </div>
      </div>

      {/* 右侧：状态指示器 */}
      <div className="flex items-center gap-4">
        {/* 保存状态 */}
        <SaveStatusIcon status={saveStatus} />

        {/* 在线状态 */}
        <div className="flex items-center gap-1.5">
          {onlineCount > 0 ? (
            <>
              <Wifi size={12} className="text-green-500" />
              <span>{onlineCount} 人在线</span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-gray-400" />
              <span className="text-gray-400">离线</span>
            </>
          )}
        </div>
      </div>
    </footer>
  )
}

function SaveStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'saved':
      return (
        <span className="flex items-center gap-1 text-green-600">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          已保存
        </span>
      )
    case 'saving':
      return (
        <span className="flex items-center gap-1 text-primary-500">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
          保存中...
        </span>
      )
    case 'unsaved':
      return (
        <span className="flex items-center gap-1 text-warning-500">
          <span className="w-1.5 h-1.5 rounded-full bg-warning-500" />
          未保存
        </span>
      )
    case 'error':
      return (
        <span className="flex items-center gap-1 text-error-500">
          <span className="w-1.5 h-1.5 rounded-full bg-error-500" />
          保存失败
        </span>
      )
    default:
      return null
  }
}
