// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// Particles — 统一导出入口 (R30, v6.0)
// ============================================================

export type { IParticle, RenderOptions } from './IParticle'
export { ParticleRegistry, particleRegistry } from './ParticleRegistry'
export { TextParticle } from './TextParticle'
export { ListParticle } from './ListParticle'
export { SeparatorParticle } from './SeparatorParticle'
export { textParticle, separatorParticle, fieldParticle, listParticle } from './ParticleAdapters'
export { createFootnoteParticle } from './FootnoteParticle'
export { createImageParticle } from './ImageParticle'
export { createCommentParticle } from './CommentParticle'
export { createTableParticle } from './TableParticle'
