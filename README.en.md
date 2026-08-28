# EMR Document Editor Engine

> 🚀 Live Demo: <http://139.196.151.15/>

## 📋 Project Introduction

The EMR Document Editor Engine is a professional Electronic Medical Record (EMR) document editing system, providing complete document creation, editing, template management, and collaboration features. The system adopts a separation of front-end and back-end architecture. The front-end is based on Canvas rendering technology for high-performance document editing, while the back-end is built with Spring Boot + MyBatis-Plus, providing RESTful APIs and WebSocket real-time collaboration support.

## ✨ Core Features

- **Professional Document Editing**: Supports rich text editing, structured elements, formula entry, table processing, and other professional functions.
- **Template System**: Provides flexible template categorization management, supporting both public and private templates.
- **Pagination Preview**: Accurately reproduces A4 paper typesetting effects, supporting print preview.
- **Permission Control**: Role-based access control (RBAC), supporting document annotations and modification trails.
- **Real-time Collaboration**: WebSocket support for multi-user real-time collaborative editing.
- **Version Management**: Complete historical version records, supporting version rollback.
- **Data Validation**: Supports data validation for form elements and required field checks.
- **Audit Trail**: Detailed recording of document operation logs to meet compliance requirements.
- **Framework/Platform-Agnostic Runtime**: The editor engine decouples the host environment via the `EditorHost` capability interface (text/font/surface/viewport/input/platform), allowing it to be embedded in any host such as React, Vue, Electron, or Web Workers — with zero browser globals in the engine source.

## 🛠 Tech Stack

### Frontend Technologies
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling Solution**: Tailwind CSS
- **State Management**: Zustand
- **UI Components**: Radix UI + Lucide icons
- **HTTP Client**: Axios
- **Rendering Engine**: Self-developed HTML5 Canvas renderer
- **Real-time Collaboration**: Yjs + y-websocket
- **Formula Rendering**: KaTeX
- **Event System**: Custom event bus

### Backend Technologies
- **Runtime Environment**: Java 17+
- **Framework**: Spring Boot 3.x
- **Data Access**: MyBatis-Plus
- **Security Framework**: Spring Security + JWT
- **Real-time Communication**: WebSocket (Spring Boot)
- **Cache**: Redis (spring-boot-starter-data-redis)
- **API Docs**: Springdoc OpenAPI (Swagger)
- **Database**: MySQL 8.0+ (H2 for tests)
- **Utilities**: Lombok + Bean Validation

## 📁 Project Structure

```
EMRDocumentEngine/
├── backend/                    # Backend Service
│   ├── src/main/java/com/emr/
│   │   ├── config/            # Configuration Classes (Security, WebSocket, MyBatis-Plus, etc.)
│   │   ├── controller/        # Controller Layer
│   │   ├── service/           # Business Logic Layer (incl. impl/)
│   │   ├── entity/            # Entity Classes
│   │   ├── repository/        # Data Access Layer
│   │   ├── dto/               # Data Transfer Objects
│   │   ├── util/              # Utility Classes
│   │   └── websocket/         # WebSocket Real-time Collaboration
│   └── resources/
│       └── application.yml    # Application Configuration
│
├── frontend/                   # Frontend Application
│   ├── src/
│   │   ├── components/        # React Components
│   │   │   ├── editor/        # Editor Core Components
│   │   │   ├── layout/        # Layout Components
│   │   │   ├── panels/        # Property Panels
│   │   │   ├── sidebar/       # Sidebar
│   │   │   ├── toolbar/       # Toolbar
│   │   │   ├── dialogs/       # Dialogs
│   │   │   ├── views/         # View Components
│   │   │   └── ui/            # Base UI Components
│   │   ├── engine/            # Editor Engine Core
│   │   │   ├── Editor.ts              # Main Editor Class
│   │   │   ├── EventBus.ts            # Event Bus
│   │   │   ├── AutoSaveManager.ts     # Auto Save
│   │   │   ├── DocumentDiffer.ts      # Document Diff
│   │   │   ├── FindReplaceEngine.ts   # Find & Replace
│   │   │   ├── command/               # Command System (undo/redo)
│   │   │   ├── document/              # Document Model
│   │   │   ├── host/                  # Host Capability Interface (EditorHost six-tuple)
│   │   │   ├── render/                # Rendering Module
│   │   │   ├── layout/                # Layout Engine
│   │   │   ├── interaction/           # Interaction Handling
│   │   │   ├── state/                 # State Management
│   │   │   ├── plugins/               # Plugin System
│   │   │   ├── qc/                    # Quality Control
│   │   │   ├── security/              # Security Module
│   │   │   ├── loaders/               # Loaders
│   │   │   ├── i18n/                  # Internationalization
│   │   │   └── __tests__/             # Engine Unit Tests
│   │   ├── platform/          # Host Platform Implementation (browser capability injection)
│   │   │   └── dom/           #   DOM Host (Canvas/clipboard/IndexedDB etc.)
│   │   ├── pages/             # Page Components
│   │   ├── services/          # API Services
│   │   ├── store/             # Global State (Zustand)
│   │   ├── lib/               # Utility Functions
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── Dockerfile            # Frontend Containerization
│   └── nginx.conf            # Nginx Configuration
│
├── output/                     # Document Output Directory
│   ├── 1-research.md          # Research Report
│   ├── 2-prd.md               # Product Requirement Document
│   ├── 3-architecture.md      # Architecture Design Document
│   ├── 4-uiux.md              # UI/UX Design Document
│   └── 5-spec.md              # Technical Specification
│
├── knowledge/                  # Knowledge Base
├── docker-compose.yml         # Docker Compose Configuration
├── nginx.conf                 # Nginx Configuration
├── LICENSE                    # MIT License
└── README.md                  # Project Documentation
```

## 🚀 Quick Start

### Environment Requirements

- Node.js 18+
- Java 17+
- MySQL 8.0+

### Backend Deployment

1. **Create Database**

```sql
CREATE DATABASE emr_document_engine DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

2. **Configure Database Connection**

Edit `backend/src/main/resources/application.yml`:

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/emr_document_engine?useSSL=false&serverTimezone=UTC
    username: your_username
    password: your_password
```

3. **Build and Run**

```bash
cd backend
./mvnw spring-boot:run
```

The backend service will start at `http://localhost:8080`.

### Frontend Deployment

1. **Install Dependencies**

```bash
cd frontend
npm install
```

2. **Start Development Server**

```bash
npm run dev
```

The frontend application will start at `http://localhost:3000`.

3. **Production Build**

```bash
npm run build
```

## 📡 API Interfaces

### Authentication Interfaces

| Method | Path | Description |
|------|------|------|
| POST | `/api/v1/auth/login` | User Login |
| POST | `/api/v1/auth/logout` | User Logout |
| GET | `/api/v1/auth/me` | Get Current User Info |

### Document Interfaces

| Method | Path | Description |
|------|------|------|
| GET | `/api/v1/documents` | Get Document List (Paginated) |
| POST | `/api/v1/documents` | Create New Document |
| GET | `/api/v1/documents/{id}` | Get Document Details |
| PUT | `/api/v1/documents/{id}` | Update Document |
| DELETE | `/api/v1/documents/{id}` | Delete Document |

### Template Interfaces

| Method | Path | Description |
|------|------|------|
| GET | `/api/v1/templates` | Get Template List |
| GET | `/api/v1/templates/{id}` | Get Template Details |
| POST | `/api/v1/templates` | Create Template |
| PUT | `/api/v1/templates/{id}` | Update Template |
| DELETE | `/api/v1/templates/{id}` | Delete Template |

## 🧩 Core Modules

### Frontend Editor Engine

The editor engine uses a modular design. Core components include:

- **DocumentModel**: Document data model, manages the document element tree.
- **Draw**: Canvas renderer, responsible for element visualization.
- **TextMeasurer**: Text measurer, calculates text width and height.
- **HistoryManager**: History manager, supports undo/redo.
- **EventBus**: Event bus, handles inter-component communication.
- **EditorHost**: Platform capability boundary (six-tuple: `text/font/surface/viewport/input/platform`); browser capabilities are injected through it, making the engine framework- and platform-agnostic.

### Backend Service Layer

- **DocumentService**: Document business logic processing.
- **TemplateService**: Template business logic processing.
- **AuthService**: Authentication and authorization service.

## 📊 Database Schema

| Table Name | Description |
|------|------|
| `t_user` | User Information Table |
| `t_document` | Document Master Table |
| `t_template` | Template Table |
| `t_annotation` | Annotation Table |
| `t_audit_log` | Audit Log Table |
| `t_document_version` | Document Version Table |

## 📝 Development Instructions

### AI-Assisted Development (Claude)

This project uses Claude for AI-assisted development. To constrain the AI's code behavior and ensure architectural boundaries are not broken, the repository maintains an "AI Editing Contract":

- `.claude/CLAUDE.md`: The AI entry prompt, instructing the AI to read the contract before modifying `frontend/src/engine`.
- `.claude/AI_EDITOR_CONTRACT.md`: The architectural invariant contract, defining the engine's mandatory boundaries — for example: the engine must not depend on React or browser globals, all document mutations must go through the Command system, every mutable fact must have a single owner, and the document model must not depend on layout/rendering.

When implementing, refactoring, or reviewing code, the AI must treat the contract as a hard constraint; if an invariant must be broken, the AI must first explain the reason, assess the impact, and obtain explicit authorization — never violating it silently.

### Frontend Development

1. Editor engine core code is located in the `src/engine/` directory.
2. React components are located in the `src/components/` directory.
3. API services are defined in `src/services/api.ts`.
4. Global state management is in `src/store/index.ts`.

### Backend Development

1. Controller layer is located in the `controller/` directory.
2. Business logic is implemented in the `service/` directory.
3. Data access is through the `repository/` interface.
4. Entity classes are defined in the `entity/` directory.

## 🤝 Contributing

First of all, thank you from the bottom of our hearts for stopping by and contributing to this project ❤️. Whether you are an experienced developer or an open-source newcomer, every suggestion, line of code, and documentation edit is invaluable to the EMR Document Editor Engine.

A truly usable Electronic Medical Record editing tool is never built by one person alone — it relies on the collective effort of every member of the community. There is no "newcomer" or "veteran" here, only a shared passion for the product and a curiosity about technology. So please don't hesitate to join in — even fixing a typo or asking a "silly" question is warmly welcomed and genuinely appreciated.

### How You Can Contribute

| Way to Contribute | Who It's For | Description |
|---------|---------|------|
| 🐛 Report a Bug | Everyone | Describe the problem, reproduction steps, and environment to help us find and fix issues |
| 💡 Suggest an Idea | Everyone | Share any thoughts on features, experience, or documentation through an Issue |
| 🛠️ Submit Code | Developers | Fix bugs, implement new features, optimize performance, or add unit tests |
| 📖 Improve Documentation | Everyone | Polish the README, code comments, and design docs to make the project easier to understand |
| 👀 Review Code | Developers | Help review PRs and join technical discussions — your feedback meaningfully improves quality |

### Contribution Workflow

If you're ready to write code, follow the steps below. Don't worry if it feels like a lot — take it one step at a time, and if you get stuck anywhere, feel free to ask in an Issue. We'll respond as soon as we can.

1. **Talk first, then code**: Before you start, check the [Issues](https://gitee.com/wangwang_1_1665527118/emrdocument-engine/issues) page to see whether there's already a related discussion. For a brand-new feature or a large change, please open an Issue to describe your idea and reach consensus with the community first, to avoid wasted effort.

2. **Fork the repository**: Click the Fork button in the top-right corner to copy the project to your account.

3. **Clone it locally**:

   ```bash
   git clone https://gitee.com/your-username/emrdocument-engine.git
   cd emrdocument-engine
   ```

4. **Create a feature branch**:

   ```bash
   git checkout -b feature/your-feature-name
   ```

5. **Develop and commit**: Once you've made your changes, commit them following the commit message conventions below:

   ```bash
   git add .
   git commit -m "feat: add some amazing feature"
   ```

6. **Run tests and type checks**: Make sure your changes don't break anything:

   ```bash
   cd frontend
   npm run test    # unit tests (Vitest)
   npm run build   # type check & build (tsc --noEmit)
   ```

7. **Push your branch**:

   ```bash
   git push origin feature/your-feature-name
   ```

8. **Open a Pull Request**: Go back to Gitee and open a Pull Request, clearly describing the purpose and content of your changes. We'll review and give feedback as soon as we can, and we welcome your active participation in the discussion.

### Commit Message Conventions

To keep the project history clean and readable, please follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>: <short description>

<optional detailed description>
```

Common types:

| Type | Purpose |
|------|------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes |
| `refactor` | Code refactoring (no behavior change) |
| `style` | Code formatting adjustments |
| `test` | Adding tests |
| `chore` | Build, config, and other housekeeping |

For example:

```
feat: complete table editing — cell input, block-aware navigation
fix: fix multi-line text caret positioning
```

### Code Standards

- The frontend uses TypeScript strict mode; run `npm run test` and `npm run build` before committing.
- The backend follows the Alibaba Java Development Manual.
- When adding or fixing functionality, please include corresponding unit tests where possible.
- Keep your code style consistent with the surrounding code to make it easy for others to read.

### Community Guidelines

We want this to be a friendly, inclusive, and mutually supportive community. When discussing and contributing, please:

- **Respect others**: Disagreements are normal — discuss the issue on its merits and communicate rationally.
- **Be patient**: Maintainers mostly contribute in their spare time, so replies may take a little while.
- **Give constructive feedback**: When pointing out a problem, try to include a suggested improvement or a concrete scenario.

Thank you for reading this far. Everyone who stops to contribute to an open-source project deserves to be taken seriously. We look forward to your PR! 🎉

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 📞 Contact Information

If you have questions or suggestions, feel free to reach out through the [Issues](https://gitee.com/wangwang_1_1665527118/emrdocument-engine/issues) page — we'd be happy to chat.

---

**Thank you for using the EMR Document Editor Engine!**