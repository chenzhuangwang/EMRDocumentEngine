# Super Dev Workflow - 文档编辑器引擎

> 项目: EMRDocumentEngine
> 创建: 2026-07-17
> 当前阶段: docs (等待确认)

---

## 流水线阶段

- [x] 1. research   — 调研完成 ✅
- [x] 2. docs       — 三份核心文档完成 ✅
- [ ] 3. docs_confirm — ⏳ 等待用户确认
- [ ] 4. spec       — 待确认后进入
- [ ] 5. frontend   — 前端开发
- [ ] 6. preview_confirm — 前端预览确认
- [ ] 7. backend    — 后端开发
- [ ] 8. quality    — 质量门禁
- [ ] 9. delivery   — 交付

## 文档清单

| 文档 | 路径 | 状态 |
|------|------|------|
| 调研报告 | output/1-research.md | ✅ |
| 产品需求文档 (PRD) | output/2-prd.md | ✅ |
| 架构设计文档 | output/3-architecture.md | ✅ |
| UI/UX 设计文档 | output/4-uiux.md | ✅ |

## 关键决策记录

1. **渲染方案**: Canvas + TypeScript 自研引擎（参考 canvas-editor 架构）
2. **文档模型**: JSON (IElement[]) 格式，扩展权限/留痕/校验元数据
3. **前端技术栈**: React 18 + TypeScript + Vite + Zustand + Lucide React
4. **后端技术栈**: Java 17 + SpringBoot 3.x + Mybatis-Plus + MySQL 8.0
5. **协作方案**: Yjs (CRDT) + WebSocket (Stomp)
6. **图标库**: Lucide React（Super Dev 规范强制要求）
