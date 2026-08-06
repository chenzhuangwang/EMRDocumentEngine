// ============================================================
// SecurityConfig 单元测试 (R76)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  SecurityChecker, sanitizeHtml, sanitizeText, isSafeHtml,
} from '../security/SecurityConfig'

describe('SecurityChecker', () => {
  it('should default to restrictive config', () => {
    const sc = new SecurityChecker()
    expect(sc.canAccessNetwork()).toBe(false)
    expect(sc.canAccessFile()).toBe(false)
    expect(sc.canAccessData()).toBe(true)
    expect(sc.canExecuteScript()).toBe(false)
  })

  it('should allow override config', () => {
    const sc = new SecurityChecker({ network: true, file: true })
    expect(sc.canAccessNetwork()).toBe(true)
    expect(sc.canAccessFile()).toBe(true)
  })
})

describe('sanitizeHtml', () => {
  it('should remove script tags', () => {
    const result = sanitizeHtml('<div>Hello<script>alert("xss")</script></div>')
    expect(result).not.toContain('<script>')
    expect(result).toContain('Hello')
  })

  it('should remove on* event handlers', () => {
    const result = sanitizeHtml('<div onclick="alert(1)">text</div>')
    expect(result).not.toContain('onclick')
  })

  it('should remove javascript: URIs', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">link</a>')
    expect(result).not.toContain('javascript:')
  })

  it('should remove iframe tags', () => {
    const result = sanitizeHtml('<iframe src="evil.com"></iframe>')
    expect(result).not.toContain('iframe')
  })
})

describe('sanitizeText', () => {
  it('should escape HTML entities', () => {
    const result = sanitizeText('<script>alert("xss")</script>')
    expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  })
})

describe('isSafeHtml', () => {
  it('should detect unsafe HTML', () => {
    expect(isSafeHtml('<script>alert(1)</script>')).toBe(false)
    expect(isSafeHtml('<div onclick="x">')).toBe(false)
  })

  it('should accept safe HTML', () => {
    expect(isSafeHtml('<div><p>Hello world</p></div>')).toBe(true)
  })
})
