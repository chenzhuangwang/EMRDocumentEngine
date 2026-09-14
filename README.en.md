# EMR Document Editor Engine

> 🚀 Live Demo: <http://139.196.151.15/>

<div align="center">

<img src="frontend/public/preview.png" alt="EMR Document Editor Engine — admission record editing view" width="100%" />

**Editing an admission record template**: true A4 pagination · header & footer · structured form controls (dropdown / radio / date / numeric)

</div>

## 📋 Project Introduction

The EMR Document Editor Engine is an electronic medical record (EMR) document editing system built for clinical scenarios, covering the full loop from document creation, structured editing and template management through to quality control. The project uses a separated front-end / back-end architecture:

- **Front end**: a self-developed HTML5 Canvas rendering engine delivering high-performance document editing and true A4 typesetting.
- **Back end**: Spring Boot + MyBatis-Plus, providing RESTful APIs, JWT authentication and WebSocket real-time communication infrastructure.
- **Framework- and platform-agnostic runtime**: the editor engine decouples the host environment through the `EditorHost` capability interface (a six-tuple of text / font / surface / viewport / input / platform), so it can be embedded in any host — React, Vue, Electron, Web Workers — with zero browser globals in the engine source.

## 🎮 Online Demo

No local setup required — just open it and try:

> **Demo: <http://139.196.151.15/>**

## ✨ Core Features

### 📝 Professional Document Editing

- **Rich text formatting**: bold / italic / underline (single, double, wavy) / strikethrough / superscript / subscript / font family / font size / text color / highlight
- **Paragraph layout**: left / center / right / justify, ordered and unordered lists (multi-level indent), heading levels, paragraph indent
- **Tables**: insert tables, merge / split cells, add and remove rows and columns, repeat header rows across pages
- **Professional elements**: images, dividers (4 styles), section breaks, headers and footers, footnotes, bookmarks and cross-references

### 🏥 Structured Medical Record Capabilities

- **Form controls**: 8 structured control types — single-line text, multi-line text, number, select, date, datetime, checkbox, radio
- **Field codes**: 8 dynamic fields — page number, total pages, date, time, title, author, save date, print date
- **Data validation**: value validation and required-field checks for form elements
- **Quality control (QC)**: 6 built-in QC rules (title not empty / body not empty / no consecutive empty paragraphs / required SmartText / minimum character count / paragraph-count range), with scoring and graded results

### 📄 Pagination & Rendering

- **True typesetting**: reproduces A4 paper size, margins, orientation and pagination rules, with print preview
- **Virtual scrolling**: only visible pages are rendered, so long documents scroll smoothly
- **Incremental layout**: dirty-region tracking and layout caching — only the affected region is re-laid out after an edit
- **Formula rendering**: LaTeX support via KaTeX

### ⌨️ Editing Experience

- **Undo / redo**: driven by the command pattern, 33 undoable command types, 500 ms typing coalescing
- **Clipboard**: copy / cut / paste, with three paste modes — keep source formatting / match destination formatting / plain text
- **Find & replace**: regex, whole-word and case-sensitive matching; replacements are undoable
- **Auto save**: IndexedDB local storage, 3-second debounce, keeps the last 3 versions, supports crash recovery
- **Auto correct**: 25 built-in medical abbreviation rules plus Chinese punctuation pairing
- **Chinese IME**: full IME composition input support

### 📚 Document Lifecycle

- **Template system**: public / private template categories, one-click apply
- **Document comparison**: visualize the differences between two versions
- **Version management**: historical version records and rollback
- **Audit trail**: complete operation logs (create / edit / delete / print / export / view)
- **Permission control**: role-based access control, with annotations and modification trails
- **Import & export**: export to JSON / TXT / HTML; import from JSON / HTML / Markdown / XML

> See the [Roadmap](#-roadmap) at the end for PDF / DOCX export, HarfBuzz shaping, collaborative editing and more.

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│             Browser (React 18 + TypeScript)             │
│  ┌────────────────────────────────────────────────────┐ │
│  │ UI layer: components / pages / store (Zustand)     │ │
│  ├────────────────────────────────────────────────────┤ │
│  │ Platform impl: Canvas / clipboard / IndexedDB      │ │
│  ├────────────────────────────────────────────────────┤ │
│  │ Editor engine engine/ — framework-agnostic         │ │
│  │ document · layout · render · interaction · command │ │
│  │ state · plugins · qc · security · loaders · i18n   │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                    │  HTTP / WebSocket
┌─────────────────────────────────────────────────────────┐
│            Spring Boot 3.3 backend (Java 17)            │
│  Controller → Service → Repository → MySQL / Redis      │
│  Security(JWT) · WebSocket · Springdoc(Swagger)         │
└─────────────────────────────────────────────────────────┘
```

The editor engine injects host capabilities through the `EditorHost` six-tuple (`text` / `font` / `surface` / `viewport` / `input` / `platform`); browser capabilities are injected into the engine via `platform/dom`, which keeps the engine framework- and platform-agnostic.

## 🛠 Tech Stack

| Layer | Technology |
|------|------|
| Front-end framework | React 18 + TypeScript (strict mode) |
| Build tool | Vite |
| Styling | Tailwind CSS |
| State management | Zustand |
| UI components | Radix UI + Lucide icons |
| Rendering engine | Self-developed HTML5 Canvas renderer |
| HTTP client | Axios |
| Real-time collaboration | Yjs + y-websocket (capability reserved) |
| Formula rendering | KaTeX |
| Back-end framework | Spring Boot 3.3 (Java 17) |
| Data access | MyBatis-Plus |
| Security | Spring Security + JWT |
| Real-time communication | WebSocket |
| Cache | Redis |
| API docs | Springdoc OpenAPI (Swagger) |
| Database | MySQL 8.0+ (H2 for tests) |
| Testing | Vitest + Testing Library + Playwright |

## 🚀 Quick Start

### Requirements

- Node.js 18+
- Java 17+
- Maven 3.6+
- MySQL 8.0+ (optional — a built-in H2 test environment is also available)
- Redis (optional)

### 1. Prepare the Database

```sql
CREATE DATABASE IF NOT EXISTS emr_editor
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
```

### 2. Start the Backend

Edit `backend/src/main/resources/application.yml` to configure the database connection:

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/emr_editor?useUnicode=true&characterEncoding=utf-8&serverTimezone=Asia/Shanghai&createDatabaseIfNotExist=true
    username: root
    password: ${DB_PASSWORD:root}
```

```bash
cd backend
mvn spring-boot:run
```

The backend starts at `http://localhost:8080`, with the Swagger docs at `http://localhost:8080/swagger-ui.html`.

### 3. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

The front end starts at `http://localhost:3001`; the dev server proxies `/api` and `/ws` to the backend.

### 4. Production Build

```bash
cd frontend
npm run build
```

### 🐳 Docker Deployment

```bash
docker-compose up -d
```

## 📁 Project Structure

```
EMRDocumentEngine/
├── backend/                    # Backend service (Spring Boot)
│   └── src/main/java/com/emr/
│       ├── config/             # Configuration (security, WebSocket, MyBatis-Plus)
│       ├── controller/         # Controller layer
│       ├── service/            # Business logic layer
│       ├── entity/             # Entity classes
│       ├── repository/         # Data access layer
│       ├── dto/                # Data transfer objects
│       ├── util/               # Utility classes
│       └── websocket/          # WebSocket real-time collaboration
├── frontend/                   # Front-end application
│   └── src/
│       ├── components/         # React components (editor/layout/panels/toolbar/...)
│       ├── engine/             # Editor engine core (framework/platform agnostic)
│       │   ├── document/       # Document model (ModelD tree + NodePool)
│       │   ├── layout/         # Layout engine (line breaking/pagination/incremental/virtual viewport)
│       │   ├── render/         # Rendering (three-layer Canvas + particle system)
│       │   ├── interaction/    # Interaction (keyboard/mouse/IME/event bus)
│       │   ├── command/        # Command system (undo/redo)
│       │   ├── host/           # EditorHost capability interface
│       │   ├── state/          # State management
│       │   ├── plugins/        # Plugin system
│       │   ├── qc/             # Quality control
│       │   ├── security/       # Security (XSS protection)
│       │   ├── loaders/        # Document loaders
│       │   ├── i18n/           # Internationalization
│       │   └── __tests__/      # Engine unit tests
│       ├── platform/           # Host platform implementation (injects DOM capabilities into engine)
│       ├── pages/              # Page components
│       ├── services/           # API services
│       ├── store/              # Global state (Zustand)
│       └── lib/                # Utility functions
├── output/                     # Project documents (research/PRD/architecture/UIUX/spec)
├── knowledge/                  # Knowledge base
├── docker-compose.yml          # Docker Compose configuration
└── LICENSE                     # MIT License
```

## 🧩 Core Modules

### Front-end Editor Engine

- **DocumentModel**: document data model, manages the document element tree and the NodePool
- **Draw**: Canvas renderer, responsible for element visualization
- **TextMeasurer**: text measurer, calculates text width and height
- **HistoryManager / CommandUndoRedoStack**: history management, supporting undo / redo
- **EventBus**: event bus handling inter-component communication
- **KeyboardHandler / MouseHandler / IMEHandler**: input event handling
- **LayoutEngine**: layout engine (line breaking / pagination / incremental / virtual viewport)
- **EditorHost**: platform capability boundary (six-tuple), making the engine framework- and platform-agnostic

### Back-end Service Layer

- **DocumentService**: document business logic
- **TemplateService**: template business logic
- **AuthService**: authentication and authorization service
- **AuditLogRepository**: audit log data access

## 📡 API Interfaces

### Authentication

| Method | Path | Description |
|------|------|------|
| POST | `/api/v1/auth/login` | User login |
| POST | `/api/v1/auth/logout` | User logout |
| GET | `/api/v1/auth/me` | Get current user info |

### Documents

| Method | Path | Description |
|------|------|------|
| GET | `/api/v1/documents` | List documents (paginated) |
| POST | `/api/v1/documents` | Create a document |
| GET | `/api/v1/documents/{id}` | Get document details |
| PUT | `/api/v1/documents/{id}` | Update a document |
| DELETE | `/api/v1/documents/{id}` | Delete a document |

### Templates

| Method | Path | Description |
|------|------|------|
| GET | `/api/v1/templates` | List templates |
| GET | `/api/v1/templates/{id}` | Get template details |
| POST | `/api/v1/templates` | Create a template |
| PUT | `/api/v1/templates/{id}` | Update a template |
| DELETE | `/api/v1/templates/{id}` | Delete a template |

## 📊 Database Schema

| Table | Description |
|------|------|
| `t_user` | Users |
| `t_document` | Documents |
| `t_template` | Templates |
| `t_annotation` | Annotations |
| `t_audit_log` | Audit log |
| `t_document_version` | Document versions |

## 📚 Project Documentation

- [Research report](output/1-research.md) — technology choices and competitive analysis
- [Product requirements](output/2-prd.md) — functional requirements and user stories
- [Architecture design](output/3-architecture.md) — system architecture and technical approach
- [UI/UX design](output/4-uiux.md) — interface design and interaction specification
- [Technical specification](output/5-spec.md) — detailed specification and task breakdown

## 📝 Development Guide

### AI-Assisted Development Contract

This project uses AI-assisted development. To constrain the AI's code behavior and keep the architectural boundaries intact, the repository maintains an "AI editing contract":

- `.claude/CLAUDE.md`: the AI entry prompt, instructing the AI to read the contract before modifying `frontend/src/engine`.
- `.claude/AI_EDITOR_CONTRACT.md`: the architectural invariant contract, defining the engine's mandatory boundaries — for example: the engine must not depend on React or browser globals, all document mutations must go through the command system, every mutable fact must have a single owner, and the document model must not depend on layout / rendering.

When implementing, refactoring or reviewing code, the AI must treat the contract as a hard constraint; if an invariant has to be broken, the AI must first explain why, assess the impact and obtain explicit authorization.

### Code Standards

- The front end uses TypeScript strict mode. Run `npm run test` (Vitest) and `npm run build` (which includes `tsc --noEmit` type checking) before committing.
- The backend follows the Alibaba Java Development Manual.

## 🗺 Roadmap

| Capability | Description | Status |
|------|------|------|
| PDF / DOCX export | Complete the export matrix | Planned |
| HarfBuzz text shaping | High-precision text measurement via WASM | Planned |
| Collaborative editing | Yjs / WebSocket infrastructure is in place; editing stream not yet wired | Capability reserved |
| E2E test suite | Playwright end-to-end regression tests | Planned |

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
