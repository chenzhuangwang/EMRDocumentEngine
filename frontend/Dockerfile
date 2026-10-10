# Copyright (c) 2026 陈庄旺.
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

# ============================================================
# EMR Document Editor - Frontend Dockerfile
#
# 用法 (构建上下文是**仓库根**, 不是 frontend/):
#
#     docker build -f frontend/Dockerfile -t emr-frontend .
#
# 为什么上下文必须是仓库根: 引擎已物理剥离到 packages/emr-document-engine
# (契约 §32), 应用的 vite / tsconfig 别名指向该包源码 —— 上下文只看得到
# frontend/ 的话, 那份源码根本不在构建里。
#
# 注: docker-compose.yml 的 nginx 服务目前直接挂载宿主机构建好的
# frontend/dist, 不走本 Dockerfile。要改成镜像内构建, 就把那个服务的
# volumes 换成:
#     build: { context: ., dockerfile: frontend/Dockerfile }
#
# 目录按**仓库内相对位置**摆: /app/frontend 与 /app/packages 并排, 于是应用配置里
# 的 `../packages/emr-document-engine/...` 在容器里与在宿主机上解析到同一个位置
# (一份表达式两处成立), 不需要为容器再维护一套别名。
# ============================================================

# ---- Stage 1: 构建 ----
FROM node:20-alpine AS builder
WORKDIR /app/frontend

# 先复制依赖清单，利用 Docker 层缓存（依赖未变时无需重新安装）
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# 引擎包源码 —— 应用构建期直接读它 (开发期零构建的同一份别名)
COPY packages/ /app/packages/

# 前端源码
COPY frontend/ ./

# 构建产物输出到 /app/frontend/dist
RUN npm run build

# ---- Stage 2: 运行（Nginx 静态服务 + 反向代理）----
FROM nginx:alpine

# 清空默认站点文件
RUN rm -rf /usr/share/nginx/html/*

# 复制构建产物
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# 复制 nginx 站点模板（启动时经 envsubst 替换 ${BACKEND_HOST}/${BACKEND_PORT}）
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template

# 上游后端地址默认值，运行时可用 -e BACKEND_HOST=... / -e BACKEND_PORT=... 覆盖
ENV BACKEND_HOST=backend
ENV BACKEND_PORT=8080

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
