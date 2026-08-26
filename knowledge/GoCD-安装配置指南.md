# GoCD 安装配置指南

> 项目: EMRDocumentEngine（EMR 电子病历文档引擎）
> 用途: 持续集成 / 持续交付（CI/CD）—— 代码推送后自动构建前端/后端、打包镜像并部署
> 最后更新: 2026-08-26

---

## 1. 概述

GoCD 是 ThoughtWorks 开源的一款持续交付服务器，采用 **Server + Agent** 架构：

- **Server**：负责编排流水线（Pipeline）、调度任务、管理配置，提供 Web 控制台。
- **Agent**：真正干活的工作节点，拉取代码、执行构建/测试/部署命令。

本项目用它完成「Git Push → 自动构建 → Docker 打包 → 部署」的自动化。

### 本项目的 GoCD 现状

代码仓库已内置一个 `pre-push` 钩子，在每次 `git push` 后通知 GoCD 拉取最新代码：

- **GoCD Server 地址**：`139.196.151.15:8153`
- **代码仓库**：`https://gitee.com/wangwang_1_1665527118/emrdocument-engine.git`
- **通知接口**：`POST http://<GOCD_SERVER>/go/api/admin/materials/git/notify`

> 钩子脚本见仓库根目录 [pre-push](../pre-push)。它利用了 GoCD 的 Git 物料变更通知 API，
> 让 push 后立即触发流水线，而不用等 GoCD 的轮询周期。

---

## 2. 架构与端口

```
┌─────────────┐   push + notify    ┌──────────────────────┐
│  开发者 / CI │ ─────────────────▶ │     GoCD Server        │
│  (git push) │                    │   Web UI : 8153        │
└─────────────┘                    │   HTTPS  : 8154        │
                                   │   调度 + 管理配置        │
                                   └──────────┬─────────────┘
                                              │ 派发任务
                                   ┌──────────▼─────────────┐
                                   │       GoCD Agent        │
                                   │  拉代码 / 构建 / 部署     │
                                   │  (需安装 Node/JDK/Docker)│
                                   └─────────────────────────┘
```

| 组件 | 默认端口 | 说明 |
|------|----------|------|
| GoCD Server Web UI | `8153` | HTTP 控制台 |
| GoCD Server HTTPS | `8154` | 可选，Agent 也通过它连接 |
| GoCD Agent | 无固定监听 | 主动连接 Server |

**硬件建议**：Server 至少 2 核 2GB 内存；Agent 因要跑前端/后端/Docker 构建，建议 2 核 4GB 以上。

---

## 3. 安装 GoCD Server

### 方式一：官方安装包（推荐，生产环境）

**CentOS / RHEL：**

```bash
sudo tee /etc/yum.repos.d/gocd.repo <<'EOF'
[gocd]
name=GoCD YUM Repository
baseurl=https://download.gocd.org
enabled=1
gpgcheck=1
gpgkey=https://download.gocd.org/GOCD-GPG-KEY.asc
EOF

sudo yum install -y go-server
sudo systemctl enable --now go-server
```

**Ubuntu / Debian：**

```bash
echo "deb https://download.gocd.org /" | sudo tee /etc/apt/sources.list.d/gocd.list
curl -fsSL https://download.gocd.org/GOCD-GPG-KEY.asc | sudo tee /etc/apt/trusted.gpg.d/gocd.asc >/dev/null
sudo apt-get update
sudo apt-get install -y go-server
sudo systemctl enable --now go-server
```

> 老版本 Ubuntu 用 `apt-key add` 已废弃，改用上面的 `trusted.gpg.d` 方式。

安装完成后：

```bash
# 查看状态
sudo systemctl status go-server

# 查看启动日志（首次启动较慢，需等它初始化数据库）
sudo journalctl -u go-server -f
```

### 方式二：Docker

```bash
docker run -d --name gocd-server \
  -p 8153:8153 -p 8154:8154 \
  -v gocd-server-data:/godata \
  -v /home/go:/home/go \
  gocd/gocd-server:v24.2.0
```

> 镜像 tag 请以官方 [gocd.org](https://www.gocd.org) 或 Docker Hub 上的最新版本为准，`v24.2.0` 仅为示例。

---

## 4. 安装 GoCD Agent

Agent 负责真正执行构建，需要**预先装好本项目构建所需的环境**：

| 依赖 | 版本要求 | 用途 |
|------|----------|------|
| JDK | 17（Temurin） | 后端 Spring Boot 构建 |
| Maven | 3.8+ | 后端打包 |
| Node.js | 20 | 前端 Vite 构建 |
| Docker | 20+ | 打包镜像 / 部署 |

### 方式一：官方包

```bash
# CentOS/RHEL
sudo yum install -y go-agent
# Ubuntu/Debian
sudo apt-get install -y go-agent
```

安装后配置它连接 Server（编辑 `/etc/default/go-agent`）：

```bash
# 指向你的 GoCD Server
GO_SERVER_URL=https://<SERVER_IP>:8154/go
```

然后启动：

```bash
sudo systemctl enable --now go-agent
```

### 方式二：Docker

```bash
docker run -d --name gocd-agent \
  -e GO_SERVER_URL=https://<SERVER_IP>:8154/go \
  -v /var/run/docker.sock:/var/run/docker.sock \
  gocd/gocd-agent-ubuntu-22.04:v24.2.0
```

> 挂载 `/var/run/docker.sock` 让 Agent 容器内也能调用宿主机 Docker（用于打包/部署）。
> 若 Agent 用包安装（裸机），则直接使用宿主机的 Docker 即可。

---

## 5. 首次访问与初始配置

1. 浏览器打开 **`http://<SERVER_IP>:8153`**。
2. 首次访问会提示创建管理员账号（也可以直接使用默认 `admin`/`badger`，**生产环境务必修改**）。
3. 进入 **Admin → Server Configuration**，确认 Server 的 Site URL、Artifacts 目录等基础配置。

> 本项目现有 Server 就是 `http://139.196.151.15:8153`。

---

## 6. 配置 Git 物料（代码仓库）

进入 **Admin → Pipelines → 新建 Pipeline**，在 **Materials** 中添加 Git 物料：

- **Repository URL**：`https://gitee.com/wangwang_1_1665527118/emrdocument-engine.git`
- **Branch**：`master`
- **Username / Password**：Gitee 账号（私有仓库必填；公开仓库可不填）

关键点：

- **轮询（Poll for changes）**：可保留，但本项目已用 `pre-push` 钩子主动通知，轮询只是兜底。
- 勾选/保持 Git 的 **Material Name**，后续「push 通知」的 `repository_url` 必须与此完全一致，GoCD 才能匹配到对应物料。

### push 通知机制（本项目已配置）

`pre-push` 钩子在推送后调用：

```
POST /go/api/admin/materials/git/notify
Accept: application/vnd.go.cd.v2+json
Content-Type: application/json
{"repository_url":"https://gitee.com/wangwang_1_1665527118/emrdocument-engine.git"}
```

GoCD 收到后会立即刷新该物料并触发对应 Pipeline，无需等待轮询间隔。

> 该接口默认无需鉴权（匿名通知）。若你的 Server 开启了「拒绝匿名材料通知」，则需要在钩子中带上认证（见第 10 节）。

---

## 7. 配置 Pipeline（构建/部署流水线）

本项目的构建命令与产物：

- **前端**（目录 `frontend`）：`npm ci && npm run build` → 产物 `frontend/dist`
- **后端**（目录 `backend`）：`mvn -DskipTests package` → 产物 `backend/target/*.jar`
- **部署**：根目录 `docker-compose.yml` 拉起 MySQL + Redis + backend + nginx

### 7.1 单条流水线示例（构建 + 部署）

Pipeline：`emr-deploy`，分为两个 Stage：

**Stage 1 — build**（Job：build）：

| Task | 命令 | 工作目录 |
|------|------|----------|
| 前端装依赖 | `npm ci` | `frontend` |
| 前端构建 | `npm run build` | `frontend` |
| 后端打包 | `mvn -DskipTests package` | `backend` |

**Stage 2 — deploy**（Job：deploy，需 Agent 有 Docker 权限）：

| Task | 命令 | 工作目录 |
|------|------|----------|
| 构建并重启 | `docker compose up -d --build` | （仓库根目录） |

> 上述 Task 在 UI 中逐个添加 `exec` 任务即可，无需手写 XML。
> `workingdir` 即相对于 Git 物料检出目录（`dest`）的路径。

### 7.2 进阶：Config as Code（推荐团队协作）

UI 配置难以版本化，可安装 **GoCD YAML Config Plugin** 后，把流水线写进仓库。示例（`gocd.yml`）：

```yaml
format_version: 10
pipelines:
  emr-deploy:
    group: emr
    materials:
      git:
        git: https://gitee.com/wangwang_1_1665527118/emrdocument-engine.git
        branch: master
    stages:
      - build:
          jobs:
            build:
              tasks:
                - exec: { command: npm, args: ["ci"], working_directory: frontend }
                - exec: { command: npm, args: ["run", "build"], working_directory: frontend }
                - exec: { command: mvn, args: ["-DskipTests", "package"], working_directory: backend }
      - deploy:
          jobs:
            deploy:
              tasks:
                - exec: { command: docker, args: ["compose", "up", "-d", "--build"] }
```

> `format_version` 与插件版本相关，以安装的 YAML 插件文档为准。

---

## 8. 配置 Agent 环境（一次性）

在每台 Agent 上确保以下工具已安装且加入 `PATH`：

```bash
# JDK 17（后端用）
java -version   # 期望 17.x

# Maven
mvn -version

# Node 20（前端用）
node -v
npm -v

# Docker
docker version
```

若某些命令只在特定 Agent 上可用，可在 Job 上打 **Resources 标签**（如 `docker`, `node20`），
并给对应 Agent 配置相同标签，GoCD 只会把任务派发给匹配的 Agent。

---

## 9. 安全与鉴权

1. **修改默认密码**：Admin → Users 中修改 `admin` 密码，或新建独立用户并分配角色。
2. **启用 HTTPS（可选）**：生产环境建议用 Nginx 反代 8153，或直接启用 8154 并配置证书。
3. **Git 私有仓库凭据**：在 Materials 中填写 Gitee 账号密码，或用 GoCD 的 **Secrets / 安全变量** 管理。
4. **环境变量**：数据库密码、JWT 密钥等敏感值用 Pipeline 的 **Secure Environment Variables** 注入，不要写进脚本。

### 若开启「拒绝匿名材料通知」

在 `pre-push` 钩子中为通知请求加 Basic Auth：

```sh
curl -X POST "http://$GOCD_SERVER/go/api/admin/materials/git/notify" \
  -u "USERNAME:PASSWORD" \
  -H "Accept: application/vnd.go.cd.v2+json" \
  -H "Content-Type: application/json" \
  -d "{\"repository_url\":\"$REPO_URL\"}"
```

---

## 10. 常见问题排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| push 后流水线不触发 | `repository_url` 与物料不一致 / 通知被匿名拒绝 | 核对物料 URL 完全一致；检查 Server 是否拒绝匿名通知 |
| Agent 显示离线 | `GO_SERVER_URL` 配置错误 / 网络不通 | 检查 `/etc/default/go-agent`，`curl` 测试 8153/8154 连通性 |
| 前端构建失败 | Agent 上 Node 版本不符（需 20） | `node -v` 确认；用 `nvm` 安装 Node 20 |
| 后端构建失败 | JDK 版本不是 17 / Maven 未装 | `java -version` 确认；安装 Temurin 17 + Maven 3.8 |
| `docker compose` 报权限错误 | Agent 用户不在 docker 组 | `sudo usermod -aG docker go` 后重启 Agent |
| Server 启动慢 / 端口占用 | 首次初始化数据库 / 8153 被占 | 查看 `journalctl -u go-server`；`ss -lntp \| grep 8153` |
| 物料拉不到私有仓库 | 未配置 Gitee 凭据 | Materials 中补 Username/Password |

---

## 11. 参考链接

- GoCD 官方文档：https://docs.gocd.org
- 下载与仓库配置：https://www.gocd.org/download
- Docker 镜像：https://hub.docker.com/u/gocd
- Git 物料变更通知 API：`POST /go/api/admin/materials/git/notify`
