// ============================================================
// RangeManager 单元测试
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest'
import { RangeManager } from '../state/RangeManager'

describe('RangeManager', () => {
  let rm: RangeManager

  beforeEach(() => {
    rm = new RangeManager()
  })

  describe('initial state', () => {
    it('should have no range initially', () => {
      expect(rm.hasRange).toBe(false)
      expect(rm.isSelecting).toBe(false)
      expect(rm.start).toBe(-1)  // Math.min(-1, -1)
      expect(rm.end).toBe(-1)    // Math.max(-1, -1)
    })
  })

  describe('setSelectionPoint', () => {
    it('should set cursor position without creating a range', () => {
      rm.setSelectionPoint(5)
      expect(rm.hasRange).toBe(false)
      expect(rm.rawStart).toBe(5)
      expect(rm.rawEnd).toBe(5)
    })

    it('should ignore negative indices', () => {
      rm.setSelectionPoint(-1)
      expect(rm.rawStart).toBe(-1)
    })

    it('should ignore non-finite indices', () => {
      rm.setSelectionPoint(Infinity)
      expect(rm.rawStart).toBe(-1)
    })
  })

  describe('startDrag / extendTo / endDrag', () => {
    it('should create a range from drag', () => {
      rm.startDrag(2)
      expect(rm.isSelecting).toBe(true)
      rm.extendTo(8)
      rm.endDrag()
      expect(rm.hasRange).toBe(true)
      expect(rm.start).toBe(2)
      expect(rm.end).toBe(8)
    })

    it('should clear range when drag ends at same position (click, not drag)', () => {
      rm.startDrag(3)
      rm.extendTo(3)
      rm.endDrag()
      expect(rm.hasRange).toBe(false)
      expect(rm.rawStart).toBe(-1)
      expect(rm.rawEnd).toBe(-1)
    })

    it('should handle reverse drag (right-to-left selection)', () => {
      rm.startDrag(10)
      rm.extendTo(2)
      rm.endDrag()
      expect(rm.hasRange).toBe(true)
      expect(rm.start).toBe(2)
      expect(rm.end).toBe(10)
    })

    it('should ignore extendTo when not selecting', () => {
      rm.setSelectionPoint(5)
      rm.extendTo(10)
      expect(rm.hasRange).toBe(false)
    })
  })

  describe('contains', () => {
    it('should return true for indices within the range', () => {
      rm.startDrag(3)
      rm.extendTo(7)
      rm.endDrag()
      expect(rm.contains(3)).toBe(true)
      expect(rm.contains(5)).toBe(true)
      expect(rm.contains(6)).toBe(true)
    })

    it('should return false for indices outside the range', () => {
      rm.startDrag(3)
      rm.extendTo(7)
      rm.endDrag()
      expect(rm.contains(2)).toBe(false)
      expect(rm.contains(7)).toBe(false)  // end is exclusive
      expect(rm.contains(8)).toBe(false)
    })

    it('should return false when no range', () => {
      expect(rm.contains(5)).toBe(false)
    })
  })

  describe('clear', () => {
    it('should clear an active range', () => {
      rm.startDrag(3)
      rm.extendTo(7)
      rm.endDrag()
      expect(rm.hasRange).toBe(true)
      rm.clear()
      expect(rm.hasRange).toBe(false)
      expect(rm.isSelecting).toBe(false)
    })
  })
})
