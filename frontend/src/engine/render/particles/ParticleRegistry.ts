// ============================================================
// ParticleRegistry — 粒子渲染器注册表 (R30, v6.0)
//
// 按 SLIFItem.type 注册 IParticle 实例, Draw.ts 通过此注册表
// 实现类型驱动的渲染调度 (替代 if/else 分支)
// ============================================================

import type { IParticle } from './IParticle'

export class ParticleRegistry {
  private particles = new Map<string, IParticle>()

  /** 注册一个粒子渲染器 */
  register(particle: IParticle): void {
    if (this.particles.has(particle.type)) {
      console.warn(`[ParticleRegistry] 重复注册类型 "${particle.type}", 已覆盖`)
    }
    this.particles.set(particle.type, particle)
  }

  /** 批量注册 */
  registerAll(...particles: IParticle[]): void {
    for (const p of particles) this.register(p)
  }

  /** 按类型查找粒子渲染器 */
  get(type: string): IParticle | undefined {
    return this.particles.get(type)
  }

  /** 检查类型是否已注册 */
  has(type: string): boolean {
    return this.particles.has(type)
  }

  /** 已注册的类型数量 */
  get size(): number {
    return this.particles.size
  }
}

/** 全局单例 */
export const particleRegistry = new ParticleRegistry()
