// ============================================================
// PerfPanel — 性能诊断面板 (R51, v6.0)
//
// 实时 FPS + 布局耗时 + 缓存命中率监控
// 开发/调试用途, 默认隐藏
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, Zap, Database, Gauge } from 'lucide-react'

interface PerfMetrics {
  fps: number
  frameTime: number
  layoutTime: number
  cacheHitRate: number
}

interface PerfPanelProps {
  /** 布局耗时 (ms), 外部注入 */
  layoutTime?: number
  /** 缓存统计 */
  cacheHits?: number
  cacheMisses?: number
}

export function PerfPanel({ layoutTime = 0, cacheHits = 0, cacheMisses = 0 }: PerfPanelProps) {
  const [visible, setVisible] = useState(false)
  const [metrics, setMetrics] = useState<PerfMetrics>({
    fps: 60, frameTime: 0, layoutTime: 0, cacheHitRate: 100,
  })

  // FPS 测量
  const frameCountRef = useRef(0)
  const lastTimeRef = useRef(performance.now())
  const rafRef = useRef<number>(0)

  const measureFps = useCallback(() => {
    frameCountRef.current++
    const now = performance.now()
    if (now - lastTimeRef.current >= 1000) {
      const fps = Math.round(frameCountRef.current / ((now - lastTimeRef.current) / 1000))
      setMetrics(prev => ({
        ...prev,
        fps,
        frameTime: fps > 0 ? Math.round(1000 / fps * 100) / 100 : 0,
      }))
      frameCountRef.current = 0
      lastTimeRef.current = now
    }
    rafRef.current = requestAnimationFrame(measureFps)
  }, [])

  useEffect(() => {
    if (visible) {
      rafRef.current = requestAnimationFrame(measureFps)
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [visible, measureFps])

  // 更新外部注入的指标
  useEffect(() => {
    setMetrics(prev => ({
      ...prev,
      layoutTime,
      cacheHitRate: cacheHits + cacheMisses > 0
        ? Math.round((cacheHits / (cacheHits + cacheMisses)) * 100)
        : 100,
    }))
  }, [layoutTime, cacheHits, cacheMisses])

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        title="性能面板"
        className="fixed bottom-2 right-2 z-50 p-1.5 bg-white/80 border border-gray-200
                   rounded-md shadow-sm text-gray-400 hover:text-gray-600 text-[10px]"
      >
        <Activity size={14} />
      </button>
    )
  }

  const getFpsColor = (fps: number) => fps >= 55 ? 'text-green-600' : fps >= 30 ? 'text-amber-600' : 'text-red-600'
  const getLayoutColor = (t: number) => t < 16 ? 'text-green-600' : t < 50 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="fixed bottom-2 right-2 z-50 bg-white/95 border border-gray-200 rounded-lg shadow-lg p-3 min-w-[160px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-gray-500 flex items-center gap-1">
          <Gauge size={12} />
          性能诊断
        </span>
        <button
          onClick={() => setVisible(false)}
          className="text-gray-300 hover:text-gray-500"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>

      <div className="space-y-1.5">
        <MetricRow
          icon={<Activity size={10} />}
          label="FPS"
          value={String(metrics.fps)}
          colorClass={getFpsColor(metrics.fps)}
        />
        <MetricRow
          icon={<Zap size={10} />}
          label="帧耗时"
          value={`${metrics.frameTime}ms`}
          colorClass={metrics.frameTime < 17 ? 'text-green-600' : 'text-amber-600'}
        />
        <MetricRow
          icon={<Zap size={10} />}
          label="布局"
          value={metrics.layoutTime > 0 ? `${metrics.layoutTime}ms` : '--'}
          colorClass={getLayoutColor(metrics.layoutTime)}
        />
        <MetricRow
          icon={<Database size={10} />}
          label="缓存命中"
          value={`${metrics.cacheHitRate}%`}
          colorClass={metrics.cacheHitRate >= 80 ? 'text-green-600' : 'text-amber-600'}
        />
      </div>
    </div>
  )
}

function MetricRow({ icon, label, value, colorClass }: {
  icon: React.ReactNode; label: string; value: string; colorClass: string
}) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="flex items-center gap-1 text-gray-400">
        {icon}
        {label}
      </span>
      <span className={`font-mono font-medium ${colorClass}`}>
        {value}
      </span>
    </div>
  )
}
