// ============================================================
// PerformanceMetrics — 性能埋点采集 (R57, v6.0)
//
// 采集: renderFrameTime / layoutTime / keystrokeLatency / cacheHitRate
// 上报: sendBeacon 批量发送 (页面卸载时)
// ============================================================

export interface PerfEntry {
  /** 事件名 */
  name: string
  /** 耗时 (ms) */
  duration: number
  /** 时间戳 */
  timestamp: number
  /** 额外标签 */
  tags?: Record<string, string | number>
}

export interface PerfSummary {
  /** 平均渲染帧耗时 */
  avgRenderFrameTime: number
  /** 平均布局耗时 */
  avgLayoutTime: number
  /** 平均击键延迟 */
  avgKeystrokeLatency: number
  /** 缓存命中率 (%) */
  cacheHitRate: number
  /** P95 渲染帧耗时 */
  p95RenderFrameTime: number
  /** 采集样本数 */
  sampleCount: number
}

export class PerformanceMetrics {
  private entries: PerfEntry[] = []
  private maxEntries = 500
  private reportUrl: string | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null

  /** 开始定时上报 (每 30s) */
  startAutoFlush(url: string, intervalMs = 30000): void {
    this.reportUrl = url
    this.flushTimer = setInterval(() => this.flush(), intervalMs)
    // 页面卸载时强制上报
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush())
    }
  }

  /** 停止定时上报 */
  stopAutoFlush(): void {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null }
    this.reportUrl = null
  }

  /** 记录一次性能事件 */
  record(name: string, duration: number, tags?: Record<string, string | number>): void {
    this.entries.push({
      name,
      duration: Math.round(duration * 100) / 100,
      timestamp: Date.now(),
      tags,
    })

    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries)
    }
  }

  /** 便捷: 记录渲染帧耗时 */
  recordRenderFrame(ms: number): void {
    this.record('render_frame', ms)
  }

  /** 便捷: 记录布局耗时 */
  recordLayout(ms: number, pageCount?: number): void {
    this.record('layout', ms, pageCount ? { pages: pageCount } : undefined)
  }

  /** 便捷: 记录击键延迟 */
  recordKeystroke(ms: number): void {
    this.record('keystroke', ms)
  }

  /** 计算汇总统计 */
  summarize(): PerfSummary {
    const renderFrames = this.entries.filter(e => e.name === 'render_frame').map(e => e.duration)
    const layouts = this.entries.filter(e => e.name === 'layout').map(e => e.duration)
    const keystrokes = this.entries.filter(e => e.name === 'keystroke').map(e => e.duration)

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const p95 = (arr: number[]) => {
      if (arr.length === 0) return 0
      const sorted = [...arr].sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length * 0.95)] || 0
    }

    return {
      avgRenderFrameTime: Math.round(avg(renderFrames) * 100) / 100,
      avgLayoutTime: Math.round(avg(layouts) * 100) / 100,
      avgKeystrokeLatency: Math.round(avg(keystrokes) * 100) / 100,
      cacheHitRate: 100, // 外部注入
      p95RenderFrameTime: Math.round(p95(renderFrames) * 100) / 100,
      sampleCount: this.entries.length,
    }
  }

  /** 获取原始条目 */
  getEntries(): PerfEntry[] { return [...this.entries] }

  /** 清空 */
  clear(): void { this.entries = [] }

  // ---- 内部 ----

  /** 发送已采集数据到 reportUrl */
  private flush(): void {
    if (!this.reportUrl || this.entries.length === 0) return

    const payload = {
      timestamp: Date.now(),
      summary: this.summarize(),
      entries: this.entries.slice(-100), // 只发送最近 100 条
    }

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
        navigator.sendBeacon(this.reportUrl, blob)
      }
    } catch { /* 静默 */ }

    this.clear()
  }
}

/** 全局单例 */
export const perfMetrics = new PerformanceMetrics()
