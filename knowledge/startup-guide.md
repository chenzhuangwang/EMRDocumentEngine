# 项目启动指南

> 项目: EMRDocumentEngine
> 最后更新: 2026-07-31

---

## 一键启动

### 前端 (Vite + React)

```bash
cd d:/czw/EMRDocumentEngine/frontend
npx vite --host
```

- 端口: **3000**
- 地址: http://localhost:3000/
- 首次运行前需 `npm install`

### 后端 (Spring Boot + Maven)

```bash
cd d:/czw/EMRDocumentEngine/backend
mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

- 端口: **8080**
- 地址: http://localhost:8080/
- dev profile 使用 H2 内存数据库，无需 MySQL

---

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 前端框架 | React | 18.3 |
| 构建工具 | Vite | 5.4 |
| 语言 | TypeScript | 5.5 |
| CSS | TailwindCSS | 3.4 |
| 状态管理 | Zustand | 5.0 |
| 图标库 | Lucide React | 0.400 |
| UI 组件 | Radix UI | 1.1 |
| 后端框架 | Spring Boot | 3.3.2 |
| Java | OpenJDK | 21 |
| ORM | MyBatis-Plus | 3.5.7 |
| 数据库(dev) | H2 | 内存模式 |

---

## API 代理

Vite 开发服务器已将 `/api` 请求代理到 `http://localhost:8080`，前后端无需额外 CORS 配置。

## 其他命令

```bash
# 前端构建检查
cd frontend && npm run build

# 前端测试
cd frontend && npm test

# 后端测试
cd backend && mvn test
```
