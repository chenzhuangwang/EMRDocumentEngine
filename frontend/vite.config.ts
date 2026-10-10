// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// ============================================================
// 应用构建 / 测试配置
//
// 引擎已物理剥离到 packages/emr-document-engine (契约 §32), 应用按包名
// `@emrde/document-engine` 引用它。别名指向**包源码**而不是包产物:
//
//   - 开发期零构建 —— 改一行引擎代码立刻生效, 不需要先跑 engine:pack;
//     对外分发仍走 package.json 的 exports → dist (tarball 路径不变)。
//   - 包源码与包产物是同一份代码的两种消费方式, 指哪一份由这里决定,
//     应用代码里看到的始终是包名。
//
// 四个子路径的别名必须**排在裸包名之前**: Vite 的 alias 是字符串前缀匹配,
// 顺序反了会把 `@emrde/document-engine/dom` 抢先吃掉, dom 入口就永远解析不到。
//
// `@/` 用的是正则而不是裸字符串: 裸字符串 `'@'` 会前缀匹配到
// `@emrde/document-engine`, 把包名劫持成 `frontend/src/emrde/...`。
// ============================================================

const PKG_SRC = path.resolve(__dirname, '../packages/emr-document-engine/src')

// 引擎包源码在 frontend/ 之外, 它的运行期依赖 (react / fflate) **不会**被 Node
// 的向上查找命中 —— 本仓库刻意不发 npm workspaces, 只有一份依赖树
// (frontend/node_modules), 包目录下没有 node_modules。所以显式把裸说明符指过去,
// 与 tsconfig.json 的 paths 一一对应。分发时这条不需要: tarball 的
// dependencies / peerDependencies 由消费方自己的包管理器解析。
const NM = path.resolve(__dirname, 'node_modules')

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // ---- 应用自身 ----
      { find: /^@\//, replacement: path.resolve(__dirname, 'src') + '/' },
      // ---- 引擎包 (子路径在前, 裸包名在后) ----
      { find: /^@emrde\/document-engine\/dom$/, replacement: path.join(PKG_SRC, 'platform/dom/index.ts') },
      { find: /^@emrde\/document-engine\/react$/, replacement: path.join(PKG_SRC, 'platform/react/index.ts') },
      { find: /^@emrde\/document-engine\/export$/, replacement: path.join(PKG_SRC, 'lib/export/index.ts') },
      { find: /^@emrde\/document-engine$/, replacement: path.join(PKG_SRC, 'engine/index.ts') },
      // ---- 包源码的裸依赖 (单份依赖树, 不新增 node_modules) ----
      { find: /^react$/, replacement: path.join(NM, 'react') },
      { find: /^react\/jsx-runtime$/, replacement: path.join(NM, 'react/jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.join(NM, 'react/jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: path.join(NM, 'react-dom') },
      { find: /^react-dom\/client$/, replacement: path.join(NM, 'react-dom/client.js') },
      { find: /^fflate$/, replacement: path.join(NM, 'fflate') },
    ],
  },
  server: {
    port: 3001,
    // 引擎包源码在 frontend/ 之外, 必须放行文件服务, 否则 dev 下改引擎代码
    // 看不到效果 (fs.allow 默认只覆盖项目根)。
    fs: { allow: [path.resolve(__dirname), path.resolve(__dirname, '../packages')] },
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // 单一 vitest 配置同时跑应用与包 —— 两棵树一起才是完整的回归面。
    // 跨 root 的 include 已验证可用 (vite root 仍是 frontend/)。
    include: [
      'src/**/*.test.{ts,tsx}',
      '../packages/emr-document-engine/src/**/*.test.{ts,tsx}',
    ],
    setupFiles: [path.join(PKG_SRC, 'engine/__tests__/setup.ts')],
  },
})
