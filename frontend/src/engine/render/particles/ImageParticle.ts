// ============================================================
// ImageParticle — 图片粒子渲染器 (R33, v6.0)
//
// 从 Draw.ts 提取独立的图片渲染逻辑
// 实现 IParticle 接口, 通过 ParticleRegistry 调度
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/core/SLIF'
import type { EditorHost } from '../../host/EditorHost'

export function createImageParticle(
  resolveUrl: (nodeId: string) => string | null,
  onImageLoaded: (() => void) | undefined,
  host: EditorHost,
): IParticle {
  const imageCache = new Map<string, CanvasImageSource>()

  return {
    type: 'image',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, _options?: RenderOptions): void {
      const url = resolveUrl(item.nodeId)
      if (!url) {
        // 无 URL: 绘制占位
        drawPlaceholder(ctx, x, y, item.width, item.height)
        return
      }

      const cached = imageCache.get(url)
      if (cached) {
        ctx.drawImage(cached, x, y, item.width, item.height)
        return
      }

      // 异步加载, 首帧占位
      host.surface.loadImage(url).then((img) => {
        imageCache.set(url, img.source)
        onImageLoaded?.()
      })

      drawPlaceholder(ctx, x, y, item.width, item.height)
    },
  }
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  width: number, height: number,
): void {
  ctx.save()
  ctx.fillStyle = '#E5E7EB'
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = '#9CA3AF'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 2])
  ctx.strokeRect(x, y, width, height)
  ctx.setLineDash([])
  ctx.restore()
}
