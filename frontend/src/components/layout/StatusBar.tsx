// ============================================================
// 状态栏
// ============================================================

import { FileText, Type, Wifi, WifiOff, Minus, Plus } from 'lucide-react'
import { useEditorStore } from '@/store'
import { formatWordCount } from '@/lib/utils'

interface StatusBarProps {
  pageIndex?: number
  pageCount?: number
  wordCount?: number
  onlineCount?: number
  /** 缩放比例 (0.25-4.0) */
  scale?: number
  /** 缩放变更回调 */
  onScaleChange?: (scale: number) => void
}

export function StatusBar({
  pageIndex = 1,
  pageCount = 1,
  wordCount = 0,
  onlineCount = 0,
  scale = 1,
  onScaleChange,
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

      {/* 中间: 缩放控制 */}
      <div className="flex items-center gap-1">
        <button
          className="p-0.5 text-gray-400 hover:text-gray-600 rounded transition-colors disabled:opacity-30"
          disabled={scale <= 0.25}
          onClick={() => onScaleChange?.(Math.max(0.25, scale - 0.1))}
          title="缩小"
        >
          <Minus size={12} />
        </button>

        <input
          type="range"
          className="w-20 h-1 accent-primary-500 cursor-pointer"
          min={25} max={400} step={5}
          value={Math.round(scale * 100)}
          onChange={(e) => onScaleChange?.(Number(e.target.value) / 100)}
          title={`缩放: ${Math.round(scale * 100)}%`}
        />

        <button
          className="p-0.5 text-gray-400 hover:text-gray-600 rounded transition-colors disabled:opacity-30"
          disabled={scale >= 4}
          onClick={() => onScaleChange?.(Math.min(4, scale + 0.1))}
          title="放大"
        >
          <Plus size={12} />
        </button>

        <span
          className="text-xs text-gray-500 w-10 text-center tabular-nums cursor-pointer hover:text-primary-600"
          onClick={() => onScaleChange?.(1)}
          title="重置缩放"
        >
          {Math.round(scale * 100)}%
        </span>
      </div>
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
