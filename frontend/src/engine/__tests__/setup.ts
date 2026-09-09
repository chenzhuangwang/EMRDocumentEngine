// ============================================================
// Vitest Setup — Canvas mock for jsdom (which lacks Canvas API)
// ============================================================
//
// jsdom 的 HTMLCanvasElement.getContext('2d') 会 throw "Not implemented"。
// 我们直接劫持原型方法，在 jsdom 的 getContext 被调用前拦截。

function isCJK(ch: string): boolean {
  const cp = ch.codePointAt(0) || 0
  return (
    (cp >= 0x4E00 && cp <= 0x9FFF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0x3000 && cp <= 0x303F) ||
    (cp >= 0xFF00 && cp <= 0xFFEF)
  )
}

function parseFontSize(font: string): number {
  const match = font.match(/(\d+)px/)
  return match ? parseInt(match[1], 10) : 16
}

function createMockCtx(): CanvasRenderingContext2D {
  const state = { font: '' }

  return {
    get font() { return state.font },
    set font(v: string) { state.font = v },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',

    measureText(text: string): TextMetrics {
      const fontSize = parseFontSize(state.font) || 16
      let width = 0
      for (const ch of text) {
        width += isCJK(ch) ? fontSize : fontSize * 0.55
      }
      return {
        width,
        actualBoundingBoxAscent: fontSize * 0.8,
        actualBoundingBoxDescent: fontSize * 0.2,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
        fontBoundingBoxAscent: fontSize * 0.8,
        fontBoundingBoxDescent: fontSize * 0.2,
      } as TextMetrics
    },

    fillText() {},
    strokeText() {},
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    fill() {},
    save() {},
    restore() {},
    setTransform() {},
    setLineDash() {},
    getLineDash() { return [] },
    drawImage() {},
    arc() {},
    arcTo() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    rect() {},
    clip() {},
    createLinearGradient() { return {} as CanvasGradient },
    createRadialGradient() { return {} as CanvasGradient },
    createPattern() { return {} as CanvasPattern },
    translate() {},
    scale() {},
    rotate() {},
    transform() {},
    isPointInPath() { return false },
    isPointInStroke() { return false },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    resetTransform() {},
    drawFocusIfNeeded() {},
    scrollPathIntoView() {},
    putImageData() {},
    getImageData() { return { width: 0, height: 0, data: new Uint8ClampedArray(), colorSpace: 'srgb' } },
    createImageData() { return { width: 0, height: 0, data: new Uint8ClampedArray(), colorSpace: 'srgb' } },
    getContextAttributes() { return { alpha: true, desynchronized: false } },
    roundRect() {},
  } as unknown as CanvasRenderingContext2D
}

// Monkey-patch HTMLCanvasElement.prototype.getContext BEFORE any test code creates a canvas.
// jsdom always throws "Not implemented" for getContext, so we intercept and return a mock for '2d'.
// Other context types return null (jsdom doesn't support them anyway).
HTMLCanvasElement.prototype.getContext = function (
  contextId: string,
  _options?: unknown
): RenderingContext | null {
  if (contextId === '2d') {
    return createMockCtx() as unknown as CanvasRenderingContext2D
  }
  return null
} as typeof HTMLCanvasElement.prototype.getContext

// ---- Radix UI 组件测试所需的浏览器 API (jsdom 缺失) ----
// Dialog/Dropdown 等 Radix 组件在 jsdom 下渲染需要这些 no-op polyfill,
// 否则 Presence / DismissableLayer / react-remove-scroll 会因缺 API 抛错。

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList
}

if (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.scrollIntoView !== 'function') {
  HTMLElement.prototype.scrollIntoView = () => {}
}
