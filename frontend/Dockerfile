# ============================================================
# EMR Document Editor - Frontend Dockerfile
# ============================================================

# ---- Stage 1: 构建 ----
FROM node:20-alpine AS builder
WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存（依赖未变时无需重新安装）
COPY package.json package-lock.json ./
RUN npm ci

# 复制源码并构建（产物输出到 /app/dist）
COPY . .
RUN npm run build

# ---- Stage 2: 运行（Nginx 静态服务 + 反向代理）----
FROM nginx:alpine

# 清空默认站点文件
RUN rm -rf /usr/share/nginx/html/*

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 复制 nginx 站点模板（启动时经 envsubst 替换 ${BACKEND_HOST}/${BACKEND_PORT}）
COPY nginx.conf /etc/nginx/templates/default.conf.template

# 上游后端地址默认值，运行时可用 -e BACKEND_HOST=... / -e BACKEND_PORT=... 覆盖
ENV BACKEND_HOST=backend
ENV BACKEND_PORT=8080

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
