# Super Dev Workflow - 文档编辑器引擎

> 项目: EMRDocumentEngine
> 创建: 2026-07-17
> 当前阶段: delivery (持续交付)

---

## 流水线阶段

- [x] 1. research    — 调研完成
- [x] 2. docs        — 三份核心文档完成
- [x] 3. docs_confirm — 已确认
- [x] 4. spec        — 技术规格完成
- [x] 5. frontend    — Canvas引擎 + React UI + 构建通过
- [x] 6. backend     — SpringBoot API + Maven编译通过
- [x] 7. quality     — 构建验证通过
- [x] 8. delivery    — 已推送到 Gitee

## 最新变更 (2026-07-17 Round 2)

- 新增 `LineBreaker` 完整 CJK+英文混排换行引擎
- 新增 `PageBreaker` 精确分页引擎
- 新增 `KeyboardHandler` 键盘交互处理（含IME输入法）
- 新增 `schema.sql` + `seed.sql` 数据库建表与种子数据
- 新增 `docker-compose.yml` + `Dockerfile` + `nginx.conf` 容器化部署

## 关键决策记录

1. **渲染方案**: Canvas + TypeScript 自研引擎
2. **文档模型**: JSON (IElement[]) 格式
3. **前端技术栈**: React 18 + TypeScript + Vite + Zustand + Lucide React
4. **后端技术栈**: Java 17 + SpringBoot 3.x + Mybatis-Plus + MySQL 8.0
5. **协作方案**: Yjs (CRDT) + WebSocket (Stomp)
6. **图标库**: Lucide React
