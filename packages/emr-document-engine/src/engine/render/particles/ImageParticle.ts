// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// ImageParticle — 图片粒子渲染器 (R33, v6.0)
//
// 从 Draw.ts 提取独立的图片渲染逻辑
// 实现 IParticle 接口, 通过 ParticleRegistry 调度
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/core/SLIF'
import type { EditorHost } from '../../host/EditorHost'
import type { CanvasTokenSet } from '../../state/canvasTokens'
import { asRgb } from '../../state/canvasTokens'

export function createImageParticle(
  resolveUrl: (nodeId: string) => string | null,
  onImageLoaded: (() => void) | undefined,
  host: EditorHost,
): IParticle {
  const imageCache = new Map<string, CanvasImageSource>()

  return {
    type: 'image',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, options?: RenderOptions): void {
      const url = resolveUrl(item.nodeId)
      if (!url) {
        drawPlaceholder(ctx, x, y, item.width, item.height, options?.tokenSet)
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

      drawPlaceholder(ctx, x, y, item.width, item.height, options?.tokenSet)
    },
  }
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  width: number, height: number,
  tokenSet: CanvasTokenSet | undefined,
): void {
  ctx.save()
  ctx.fillStyle = tokenSet?.imagePlaceholder ? asRgb(tokenSet.imagePlaceholder) : '#E5E7EB'
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = tokenSet?.imagePlaceholderBorder ? asRgb(tokenSet.imagePlaceholderBorder) : '#9CA3AF'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 2])
  ctx.strokeRect(x, y, width, height)
  ctx.setLineDash([])
  ctx.restore()
}
