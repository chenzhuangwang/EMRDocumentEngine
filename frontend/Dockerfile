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

# 复制 nginx 站点配置（SPA 回退 + /api、/ws 反向代理）
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
