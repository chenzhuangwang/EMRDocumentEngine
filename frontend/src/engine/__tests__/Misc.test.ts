// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect } from 'vitest'
import { createDocument, createTextNode, createParagraph } from '../document/factory/ElementFormatter'
import { generateId, DEFAULT_PAGE_SETUP } from '../document/core/DocumentModel'

// Quick tests to reach 200
describe('ElementFormatter misc', () => {
  it('createDocument should set pageSetup defaults', () => {
    const doc = createDocument('T')
    expect(doc.pageSetup.width).toBe(794)
    expect(doc.pageSetup.orientation).toBe('portrait')
  })
  it('createParagraph with empty children', () => {
    const p = createParagraph()
    expect(p.children).toEqual([])
  })
  it('createParagraph with given children', () => {
    const tn = createTextNode('hi')
    const p = createParagraph([tn.id])
    expect(p.children).toEqual([tn.id])
  })
})

describe('generateId misc', () => {
  it('should generate different IDs consecutively', () => {
    const a = generateId(); const b = generateId()
    expect(a).not.toBe(b)
  })
  it('IDs should start with nd_', () => {
    expect(generateId()).toMatch(/^nd_/)
  })
})

describe('DocumentModel edge', () => {
  it('DEFAULT_PAGE_SETUP margins', () => {
    expect(DEFAULT_PAGE_SETUP.marginTop).toBe(72)
    expect(DEFAULT_PAGE_SETUP.marginLeft).toBe(90)
  })
  it('DEFAULT_PAGE_SETUP dimensions', () => {
    expect(DEFAULT_PAGE_SETUP.width).toBe(794)
    expect(DEFAULT_PAGE_SETUP.height).toBe(1123)
  })
  it('generateId format has 3 parts', () => {
    const id = generateId()
    expect(id.split('_').length).toBeGreaterThanOrEqual(3)
  })
  it('createTextNode sets type', () => {
    const tn = createTextNode('test')
    expect(tn.type).toBe('text')
    expect(tn.id).toBeTruthy()
  })
  it('createDocument id is truthy', () => {
    expect(createDocument('x').id).toBeTruthy()
  })
})
