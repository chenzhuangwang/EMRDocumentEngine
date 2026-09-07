// ============================================================
// DictionaryStore — 外部字典候选容器单测 (契约 §12.6 VR-7, §12.6.4)
//
// 覆盖: 基本增删查 / resolve 返回 undefined 语义 (未展开) /
//       entries/keys/values 遍历 / clear。
// ============================================================

import { describe, it, expect } from 'vitest'
import { DictionaryStore } from '../document/control/Dictionary'

describe('DictionaryStore — 基本操作', () => {
  it('set / get / resolve / has / size', () => {
    const store = new DictionaryStore()
    const opts = [{ name: 'a', value: 'a' }, { name: 'b', value: 'b' }]
    store.set('d1', opts)
    expect(store.get('d1')).toEqual(opts)
    expect(store.resolve('d1')).toEqual(opts)
    expect(store.has('d1')).toBe(true)
    expect(store.size).toBe(1)
  })

  it('未知 id → undefined (视为不展开)', () => {
    const store = new DictionaryStore()
    expect(store.get('missing')).toBeUndefined()
    expect(store.resolve('missing')).toBeUndefined()
    expect(store.has('missing')).toBe(false)
  })

  it('delete 返回是否确实删除', () => {
    const store = new DictionaryStore()
    store.set('d1', [{ name: 'a', value: 'a' }])
    expect(store.delete('d1')).toBe(true)
    expect(store.delete('d1')).toBe(false)
    expect(store.size).toBe(0)
  })

  it('clear 清空全部', () => {
    const store = new DictionaryStore()
    store.set('d1', [{ name: 'a', value: 'a' }])
    store.set('d2', [{ name: 'b', value: 'b' }])
    expect(store.size).toBe(2)
    store.clear()
    expect(store.size).toBe(0)
    expect(store.resolve('d1')).toBeUndefined()
  })

  it('entries / keys / values 遍历', () => {
    const store = new DictionaryStore()
    const opts = [{ name: 'a', value: 'a' }]
    store.set('d1', opts)
    expect([...store.keys()]).toEqual(['d1'])
    expect([...store.values()]).toEqual([opts])
    expect([...store.entries()]).toEqual([['d1', opts]])
  })
})
