# 引擎分包集成指南

本目录是 `@emrde/document-engine`（EMR 电子病历文档引擎）的**外部项目集成教程**，
面向把引擎嵌进自己项目的开发者 —— 不限本仓库。

引擎源码已从应用里**物理剥离**到 `packages/emr-document-engine/`，以独立包
`@emrde/document-engine` 分发。它可以被 React / Vue / 原生 JS / Electron /
Web Worker / 纯 Node 直接导入使用：引擎核心零浏览器全局依赖、零框架依赖，
平台能力全部经注入的 `EditorHost` 六元组进入。

## 语言

| 语言 | 文档 |
|---|---|
| 简体中文 | [zh-CN/README.md](zh-CN/README.md) |
| English | [en-US/README.md](en-US/README.md) |

## 一句话版本

> 引擎是**框架无关**的文档编辑内核。React 有官方适配器（`./react`）；
> Vue 与其它框架用 `./dom` 提供的浏览器宿主**手工接线**即可，引擎本身无需改动；
> 无 UI 的纯数据场景（服务端落库 / 批处理）用核心入口的纯函数，连 DOM 都不需要。
