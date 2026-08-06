// ============================================================
// EditorSecurityConfig — 编辑器安全配置 (R68, v6.0)
//
// 四维权限: network/file/data/script
// XSS 过滤 + 默认 all-false 策略
// ============================================================

export interface EditorSecurityConfig {
  /** 网络访问: fetch/XHR 请求 */
  network: boolean
  /** 文件访问: 文件系统读取/写入 */
  file: boolean
  /** 数据访问: localStorage/IndexedDB/Cookie */
  data: boolean
  /** 脚本执行: eval/Function/new Function */
  script: boolean
}

export const DEFAULT_SECURITY_CONFIG: EditorSecurityConfig = {
  network: false,
  file: false,
  data: true,
  script: false,
}

// ---- XSS 过滤器 ----

const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /on\w+\s*=\s*["'][^"']*["']/gi,
  /on\w+\s*=\s*[^\s>]+/gi,
  /javascript\s*:/gi,
  /<iframe\b[^>]*>/gi,
  /<\/iframe>/gi,
  /<embed\b[^>]*>/gi,
  /<object\b[^>]*>/gi,
]

export function sanitizeHtml(html: string): string {
  let result = html
  for (const pattern of XSS_PATTERNS) {
    result = result.replace(pattern, '')
  }
  return result
}

export function sanitizeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

export function isSafeHtml(html: string): boolean {
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(html)) return false
  }
  return true
}

// ---- 安全检查器 ----

export class SecurityChecker {
  private config: EditorSecurityConfig

  constructor(config: Partial<EditorSecurityConfig> = {}) {
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config }
  }

  getConfig(): EditorSecurityConfig { return { ...this.config } }

  canAccessNetwork(): boolean { return this.config.network }
  canAccessFile(): boolean { return this.config.file }
  canAccessData(): boolean { return this.config.data }
  canExecuteScript(): boolean { return this.config.script }

  /** 检查并过滤内容 */
  sanitizeContent(text: string, isHtml = false): string {
    return isHtml ? sanitizeHtml(text) : sanitizeText(text)
  }
}
