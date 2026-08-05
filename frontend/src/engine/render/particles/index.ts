// ============================================================
// Particles — 统一导出入口 (R30, v6.0)
// ============================================================

export type { IParticle, RenderOptions } from './IParticle'
export { ParticleRegistry, particleRegistry } from './ParticleRegistry'
export { TextParticle } from './TextParticle'
export { ListParticle } from './ListParticle'
export { SeparatorParticle } from './SeparatorParticle'
export { textParticle, separatorParticle, fieldParticle } from './ParticleAdapters'
export { createFootnoteParticle } from './FootnoteParticle'
export { createImageParticle } from './ImageParticle'
export { createCommentParticle } from './CommentParticle'
