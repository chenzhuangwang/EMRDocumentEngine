# Super Dev Workflow - 文档编辑器引擎

> 项目: EMRDocumentEngine
> 创建: 2026-07-17
> 最后更新: 2026-08-04 (R14 方向键导航)
> 当前阶段: delivery (质量整合 — 页眉页脚全链路交付)

---

## 流水线阶段

- [x] 1. research    — 调研完成
- [x] 2. docs        — v5.0 字体/度量补齐完成
- [x] 3. docs_confirm — v19.0 架构确认通过 (2026-08-03)
- [x] 4. spec        — v5.0 任务规划完成 (66 项任务)
- [x] 5. frontend    — Canvas 引擎 + React UI + ModelD 重构完成
- [x] 6. backend     — SpringBoot API 脚手架
- [x] 7. quality     — 构建验证通过
- [x] 8. delivery    — 已推送到 Gitee

## 版本演进

| 版本 | 轮次 | 核心变更 |
|------|------|----------|
| v2.0 | Round 1 | ModelA→ModelD 同步 |
| v3.0 | Round 2 | 17 项架构缺陷补齐 |
| v3.1 | Round 3 | 空白章节补全 + 迁移路径 + Command 真实逻辑 |
| v4.0 | Round 4-5 | 15 项工程化深化 + 精简 |
| **v5.0** | **Round 6** | **字体管理层 + 文本度量体系 + fallback + UAX#14 + 多语言** |
| **v19.1** | **Round 7.1** | **架构同步 PRD v3.2 (分节/书签/域/文档比较)** |
| **v19.10** | **Round 7.10** | **工程治理: 指标单一来源 + modelVersion 统一 + Canvas 4K 内存预算** |

## v5.0 变更 (2026-07-28 Round 6)

### 新增 §3 字体与文本度量体系 (原 §2.5, v19.0 重新编号)

| # | 新增内容 | 优先级 | 后期重构代价 |
|---|----------|--------|-------------|
| 1 | **FontManager** — 字体加载/缓存/度量提取/系统字体查询/ensureReady | P0 | 极高: 重写测量+渲染全链路 |
| 2 | **增强 TextMeasurer** — L1 快速/L2 HarfBuzz 精确/L3 离线预计算 三级测量 + measureChars kerning | P0 | 极高: 换行+分页+渲染全部推翻 |
| 3 | **FontFallback** — detectMissingGlyphs 缺字检测 + resolveFallbackFonts 降级链 → FontRun[] | P1 | 中: 文本拆分+测量+渲染三处修改 |
| 4 | **UAX #14 换行规则引擎** — LineBreakClass 42 分类 + 中文避头尾规则 | P1 | 中高: 换行逻辑重写, 布局缓存失效 |
| 5 | **多语言元数据** — MultiLangFontConfig + detectScript + resolveScriptRuns 按脚本自动选字体 | P2 | 中低: 字段扩展+数据迁移 |

### 依赖链

```
FontManager (P0) → TextMeasurer (P0) → LineBreaker (P1) → PageBreaker → Draw
                  ↓
            FontFallback (P1) → 生僻字/特殊符号不显示方框
            ScriptResolver (P2) → 中英文混排各自使用正确字体
```

## 关键决策记录

1-23: (保持 v4.0 记录)
24. **字体管理 v5.0**: FontManager 单例 — registerFont(FontFace API) + extractMetrics(upem=1000) + querySystemFonts
25. **文本度量 v5.0**: 三级精度 (Canvas L1 / HarfBuzz WASM L2 / 离线预计算 L3)
26. **字体降级 v5.0**: detectMissingGlyphs (6px 零宽技巧) → resolveFallbackFonts → FontRun[]
27. **换行引擎 v5.0**: UAX #14 LineBreakClass + 中文避头尾 (lineStartForbidden/lineEndForbidden)
28. **多语言 v5.0**: Unicode 脚本检测 → MultiLangFontConfig → resolveScriptRuns 自动字体选择
| **v20.0** | **Round 8** | **里程碑: 3个P0修复 + 6对矛盾 + 合并残留清理 (架构可执行)** |
| **v21.0** | **Round 11** | **页眉页脚双击激活交互增强: Draw/MouseHandler/Editor 三文件 226 行变更** |
