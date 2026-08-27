// ============================================================
// BarcodeParticle — 条形码/二维码渲染器 (R45, v6.0)
//
// Canvas 2D 原生条形码渲染 (简化 Code128B)
// 预留 QR 码扩展点
// 实现 IParticle 接口
// ============================================================

import type { IParticle, RenderOptions } from './IParticle'
import type { SLIFItem } from '../../layout/core/SLIF'

// ---- Code128B 编码表 (简化: 只含可打印 ASCII) ----

const CODE128B_START = 104  // Start B
const CODE128B_STOP = 106   // Stop

/** 计算 Code128B 校验位 */
function code128Checksum(data: number[]): number {
  let sum = CODE128B_START
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * (i + 1)
  }
  return sum % 103
}

/** 字符→Code128B 码值 */
function charToCode128(c: string): number {
  const code = c.charCodeAt(0)
  if (code >= 32 && code <= 126) return code - 32
  return 0  // 空格兜底
}

/** Code128 码值→条空图案 (11 模块: 3 bar + 3 space, 每模块 1-4 宽) */
const BARS: Record<number, number[]> = {
  0: [2,1,2,2,2,2], 1: [2,2,2,1,2,2], 2: [2,2,2,2,2,1], 3: [1,2,1,2,2,3],
  4: [1,2,1,3,2,2], 5: [1,3,1,2,2,2], 6: [1,2,2,2,1,3], 7: [1,2,2,3,1,2],
  8: [1,3,2,2,1,2], 9: [2,2,1,2,1,3], 10: [2,2,1,3,1,2], 11: [2,3,1,2,1,2],
  12: [1,1,2,2,3,2], 13: [1,2,2,1,3,2], 14: [1,2,2,2,3,1], 15: [1,1,3,2,2,2],
  16: [1,2,3,1,2,2], 17: [1,2,3,2,2,1], 18: [2,2,3,2,1,1], 19: [2,2,1,1,3,2],
  20: [2,2,1,2,3,1], 21: [2,1,3,2,1,2], 22: [2,2,3,1,1,2], 23: [3,1,2,1,3,1],
  24: [3,1,1,2,2,2], 25: [3,2,1,1,2,2], 26: [3,2,1,2,2,1], 27: [3,1,2,2,1,2],
  28: [3,2,2,1,1,2], 29: [3,2,2,2,1,1], 30: [2,1,2,1,2,3], 31: [2,1,2,3,2,1],
  32: [2,3,2,1,2,1], 33: [1,1,1,3,2,3], 34: [1,3,1,1,2,3], 35: [1,3,1,3,2,1],
  36: [1,1,2,3,1,3], 37: [1,3,2,1,1,3], 38: [1,3,2,3,1,1], 39: [2,1,1,3,1,3],
  40: [2,3,1,1,1,3], 41: [2,3,1,3,1,1], 42: [1,1,2,1,3,3], 43: [1,1,2,3,3,1],
  44: [1,3,2,1,3,1], 45: [1,1,3,1,2,3], 46: [1,1,3,3,2,1], 47: [1,3,3,1,2,1],
  48: [3,1,3,1,2,1], 49: [2,1,1,3,3,1], 50: [2,3,1,1,3,1], 51: [2,1,3,1,1,3],
  52: [2,1,3,3,1,1], 53: [2,1,3,1,3,1], 54: [3,1,1,1,2,3], 55: [3,1,1,3,2,1],
  56: [3,3,1,1,2,1], 57: [3,1,2,1,1,3], 58: [3,1,2,3,1,1], 59: [3,3,2,1,1,1],
  60: [3,1,4,1,1,1], 61: [2,2,1,4,1,1], 62: [4,3,1,1,1,1], 63: [1,1,1,2,2,4],
  64: [1,1,1,4,2,2], 65: [1,2,1,1,2,4], 66: [1,2,1,4,2,1], 67: [1,4,1,1,2,2],
  68: [1,4,1,2,2,1], 69: [1,1,2,2,1,4], 70: [1,1,2,4,1,2], 71: [1,2,2,1,1,4],
  72: [1,2,2,4,1,1], 73: [1,4,2,1,1,2], 74: [1,4,2,2,1,1], 75: [2,4,1,2,1,1],
  76: [2,2,1,1,1,4], 77: [4,1,3,1,1,1], 78: [2,4,1,1,1,2], 79: [1,3,4,1,1,1],
  80: [1,1,1,2,4,2], 81: [1,2,1,1,4,2], 82: [1,2,1,2,4,1], 83: [1,1,4,2,1,2],
  84: [1,2,4,1,1,2], 85: [1,2,4,2,1,1], 86: [4,1,1,2,1,2], 87: [4,2,1,1,1,2],
  88: [4,2,1,2,1,1], 89: [2,1,2,1,4,1], 90: [2,1,4,1,2,1], 91: [4,1,2,1,2,1],
  92: [1,1,1,1,4,3], 93: [1,1,1,3,4,1], 94: [1,3,1,1,4,1], 95: [1,1,4,1,1,3],
  96: [1,1,4,3,1,1], 97: [4,1,1,1,1,3], 98: [4,1,1,3,1,1], 99: [1,1,3,1,4,1],
  100: [1,1,4,1,3,1], 101: [3,1,1,1,4,1], 102: [4,1,1,1,3,1],
  103: [2,1,1,4,1,2], 104: [2,1,1,2,1,4], 105: [2,1,1,2,3,2],
  106: [2,3,3,1,1,1], // STOP (106)
}

export function createBarcodeParticle(): IParticle {
  return {
    type: 'barcode',

    render(ctx: CanvasRenderingContext2D, item: SLIFItem, x: number, y: number, _options?: RenderOptions): void {
      const data = item.text || ''
      if (!data) return

      const barcodeHeight = item.height || 60
      const moduleWidth = 2  // 每模块像素宽度

      // 编码数据
      const codes: number[] = []
      for (const ch of data) {
        codes.push(charToCode128(ch))
      }
      const checksum = code128Checksum(codes)

      // 生成条空序列: START + DATA + CHECKSUM + STOP
      const modules: number[] = [...BARS[CODE128B_START]]
      for (const c of codes) modules.push(...BARS[c])
      modules.push(...BARS[checksum])
      modules.push(...BARS[CODE128B_STOP])
      // 终止条 (2 模块黑条)
      modules.push(2, 0)

      // 绘制
      let barX = x
      let isDark = true
      for (const width of modules) {
        if (width > 0) {
          ctx.fillStyle = isDark ? '#000000' : '#FFFFFF'
          ctx.fillRect(barX, y, width * moduleWidth, barcodeHeight)
        }
        barX += width * moduleWidth
        isDark = !isDark
      }

      // 底部文字
      ctx.save()
      ctx.font = '11px monospace'
      ctx.fillStyle = '#000000'
      ctx.textAlign = 'center'
      ctx.fillText(data, x + barX / 2 - x / 2, y + barcodeHeight + 14)
      ctx.restore()
    },
  }
}
