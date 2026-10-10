// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// vite.config.ts — 引擎分发包的 lib 构建 (契约 §32)
//
// 包根就是本目录 (packages/emr-document-engine), manifest 与构建产物都在这里,
// 与应用 (frontend/) 在目录上彻底分开。
//
// 为什么包根不能落在应用别名指向的目录里 —— §32.6: 只要 manifest 出现在
// 别名解析目标内, Vite 就会读到它的 exports 而改指 dist/index.js, 而深路径
// 仍解析到源码, 应用里于是出现两份引擎实例 (实测: ErrorReporting.test 的
// store 上报落到了另一份上)。物理剥离让这件事从结构上不可能发生。
//
// 四个 entry 对应四个子路径:
//   .        src/engine/index.ts            引擎核心 (无 React / 无 DOM 全局)
//   ./dom    src/platform/dom/index.ts      浏览器宿主实现
//   ./react  src/platform/react/index.ts    React 适配器
//   ./export src/lib/export/index.ts        导出 / 打印特性层
//
// 包内四棵子树 (src/engine, src/platform/dom, src/platform/react, src/lib)
// 保持与剥离前相同的相对位置, 因此包内既有相对 import 全部原样成立。
//
// 刻意不做的事:
//   - 不 minify / 不 mangle (IP-POLICY §5: 分发必须是可读 Source Code Form)
//   - 不出 sourcemap (sources 指向包内源码, 装到别处会悬空)
//   - 不把 react / fflate 打进来 (前者是 peer, 后者是 dependency)
//   - 不设 @ 别名 —— 别名解析成绝对路径会把应用源码吸进产物; 分包源码
//     一律相对路径 (契约 §32.1), 这条同时也是「产物必须零别名」的守门
// ============================================================

import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  // 分发包里不该出现应用 public/ 的静态资源 (preview.png 等) —— 那是应用门面的东西
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: 'es2020',
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/engine/index.ts'),
        dom: path.resolve(__dirname, 'src/platform/dom/index.ts'),
        react: path.resolve(__dirname, 'src/platform/react/index.ts'),
        export: path.resolve(__dirname, 'src/lib/export/index.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      // React 是 ./react 的 peer; fflate 是 ./export 的运行期依赖 —— 都不内联,
      // 否则消费方会拿到第二份 React / 第二份 ZIP 实现。
      external: ['react', 'react-dom', 'react/jsx-runtime', 'fflate'],
    },
  },
})
