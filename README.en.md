<div align="center">

# EMR Document Editor Engine

**A professional, high-performance, embeddable electronic medical record (EMR) document editing engine**

[简体中文](README.md) · **English**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Try%20it%20now-2563eb?style=flat-square&logo=vercel)](http://139.196.151.15/)
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL%202.0-22c55e?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-84cc16?style=flat-square)](#contributing)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?style=flat-square&logo=typescript)](frontend/package.json)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)](frontend/package.json)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.3-6db33f?style=flat-square&logo=springboot)](backend/pom.xml)

</div>

<div align="center">

<img src="frontend/public/preview.png" alt="EMR Document Editor Engine — admission record editing view" width="100%" />

**Editing an admission record template**: true A4 pagination · header & footer · structured form controls (dropdown / radio / date / numeric)

</div>

## Project Introduction

The EMR Document Editor Engine is an electronic medical record (EMR) document editing system built for clinical scenarios, covering the full loop from document creation, structured editing and template management through to quality control. The project uses a separated front-end / back-end architecture:

- **Front end**: a self-developed HTML5 Canvas rendering engine delivering high-performance document editing and true A4 typesetting.
- **Back end**: Spring Boot + MyBatis-Plus, providing RESTful APIs, JWT authentication and WebSocket real-time communication infrastructure.
- **Framework- and platform-agnostic runtime**: the editor engine decouples the host environment through the `EditorHost` capability interface (a six-tuple of text / font / surface / viewport / input / platform), so it can be embedded in any host — React, Vue, Electron, Web Workers — with zero browser globals in the engine source.

## Online Demo

No local setup required — just open it and try:

> **Demo: <http://139.196.151.15/>**

## Core Features

### Professional Document Editing

- **Rich text formatting**: bold / italic / underline (single, double, wavy) / strikethrough / superscript / subscript / font family (8) / font size (12 steps) / text color / highlight
- **Paragraph layout**: left / center / right / justify, ordered and unordered lists (multi-level indent, 6 numbering styles), heading levels (1–6), paragraph indent
- **Tables**: insert tables (cells may nest another table), merge / split cells, add and remove rows and columns, repeat header rows across pages, append rows; **whole-table selection** (two-stage Ctrl+A / hover handle at the table's top-left corner / cell context menu) and **block-level deletion of a table or the whole document** (through commands, undoable); **Word-style table-edge caret** — clicking to the right of any row places the caret at that row's end, Enter there inserts a row below (on the last row it creates a paragraph after the table), and Enter at the start of the first cell creates a paragraph above the table
- **Professional elements**: images, dividers (4 styles), section breaks (next page / continuous / even page / odd page) and **sections** (Section), headers and footers (including first-page / odd-even per-page variants), footnotes, bookmarks and cross-references, field codes
- **Find & replace**: regex, whole-word and case-sensitive matching; replacements are undoable
- **Format painter**: copy / apply text styles in one click

### Structured Medical Record Capabilities

- **Form controls**: 8 structured control types — single-line text, multi-line text, number, select, date, datetime, checkbox, radio
- **Control configuration**: right-click "Properties" in design mode to configure label / tips / prefix / suffix / required per control family; changes are committed atomically as a macro
- **Field codes**: 8 dynamic fields — page number, total pages, date, time, title, author, save date, print date
- **Validation & scoring**: value validation and required-field checks for form elements; selected control values aggregate into a scale score via `numericValue`
- **Quality control (QC)**: 8 built-in QC rules (title not empty / body not empty / no consecutive empty paragraphs / required control not empty / minimum character count / paragraph-count range / unnamed section / empty section), with scoring and A–D grading

### Pagination & Rendering

- **True typesetting**: reproduces A4 paper size, margins, orientation and pagination rules; paper / margins / layout chosen in the page-setup dialog **drive the layout directly**, with print preview
- **Virtual scrolling**: only visible pages are rendered, so long documents scroll smoothly
- **Incremental layout**: dirty-region tracking and layout caching — paragraph lines in the body domain and constant cross-references are both part of the incremental-safe set, so only the affected region is re-laid out after an edit
- **Three-layer Canvas + particle system**: static / content / interact layers, with particles for text, tables, images, formulas, footnotes, charts, barcodes and more
- **Formula rendering**: LaTeX support via KaTeX
- **Watermark**: text / image / tile three types

### Editing Experience

- **Undo / redo**: driven by the command pattern, 45 undoable command types, 500 ms typing coalescing, stack depth 100
- **Clipboard**: copy / cut / paste, with three paste modes — keep source formatting / match destination formatting / plain text
- **Auto save**: IndexedDB local storage, 3-second debounce, keeps the last 3 versions, supports crash recovery
- **Auto correct**: 25 built-in medical abbreviation rules plus Chinese punctuation pairing
- **Chinese IME**: full IME composition input support
- **Six editing modes**: edit / readonly / form / clean / design / print, switchable in one click
- **Auxiliary views**: outline navigation, reading mode, comments sidebar and **on-canvas comment balloons**, performance panel

### Internationalization & Theming

- **Bilingual UI**: built-in zh-CN / en-US message tables (~870 keys), one-click switch in the top bar with persistence
- **UI themes**: standard / eye-care / print / dark four chrome presets; canvas theming with 4 presets × 28 tokens

### Document Lifecycle

- **Template system**: public / private template categories, one-click apply
- **Document comparison**: visualize the differences between two versions (insert / delete / modify stats)
- **Version records**: each save automatically archives a history version (persisted on the backend; rollback UI on the [Roadmap](#roadmap))
- **Comments**: inline comment markers, thread cards along the right page edge (avatar / author / time / resolved state / reply input, with a leader line to the anchor), discussion threads, replies and a "resolved" state
- **Import**: JSON / `.emr` (full pipeline), HTML / Markdown (simplified parsing)
- **Export**: JSON / TXT / HTML / structured-elements JSON / HL7 CDA XML / OFD (GB/T 33190-2016)

> See the [Roadmap](#roadmap) at the end for PDF / DOCX export, HarfBuzz shaping, collaborative editing, audit logging and more.

## Recent Updates (2026-10)

- **Word-aligned table interaction**: whole-table selection (two-stage Ctrl+A / hover handle / context menu), undoable block-level deletion of a table or the whole document, a caret at the end of every row, and Word semantics for Enter at the row end (insert a row, or create a paragraph after the last row) and at the start of the first cell (create a paragraph above the table)
- **Comment balloons**: thread cards outside the right page edge (avatar / author / time / resolved state / reply input), leader lines straight from anchor to balloon, compact stacking based on measured heights
- **Section-break pagination**: `breakType` next page / continuous / even page / odd page now paginate
- **Page setup takes effect**: paper size, margins and orientation feed layout and rendering
- **Inline content in table cells**: paragraphs inside cells are peers of the body (images, sections, controls, …), and nested tables are legal and editable
- **Incremental layout expanded**: body-domain paragraph line caching plus constant cross-references in the incremental-safe set
- **Chrome polish**: 3×2 sidebar tab strip, design-mode control library panel positioned relative to the canvas, full canvas-theme and i18n coverage

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│             Browser (React 18 + TypeScript)             │
│  ┌────────────────────────────────────────────────────┐ │
│  │ UI layer: components / pages / store (Zustand)     │ │
│  ├────────────────────────────────────────────────────┤ │
│  │ App chrome layer: platform/chrome / platform/data  │ │
│  │ (theme tokens / medical code tables — app data,    │ │
│  │  never part of the engine distribution)            │ │
│  └────────────────────────────────────────────────────┘ │
│                     │ imported by package name          │
│                     │ (dev reads the package source)    │
│  ┌────────────────────────────────────────────────────┐ │
│  │ @emrde/document-engine — standalone npm package    │ │
│  │  ├ engine/  framework-agnostic editor core         │ │
│  │  │ document · layout · render · interaction · command│ │
│  │  │ state · plugins · qc · security · loaders · i18n │ │
│  │  │ template · format · evaluation · context · host  │ │
│  │  ├ platform/dom   browser host (Canvas / clipboard)│ │
│  │  ├ platform/react React adapter (peer dependency)  │ │
│  │  └ lib/           export / print / provenance      │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                    │  HTTP / WebSocket
┌─────────────────────────────────────────────────────────┐
│            Spring Boot 3.3 backend (Java 17)            │
│  Controller → Service → Repository → MySQL / Redis      │
│  Security(JWT) · WebSocket · Springdoc(Swagger)         │
└─────────────────────────────────────────────────────────┘
```

The engine and the application are separated **in the directory tree**: the engine source lives in `packages/emr-document-engine/` at the repository root, and the application imports it by package name (`@emrde/document-engine`). The application config points that name at the package *source*, so editing an engine file takes effect immediately during development (zero build); distribution goes through the package manifest's `exports` → `dist` (`npm run engine:pack`).

The editor engine injects host capabilities through the `EditorHost` six-tuple (`text` / `font` / `surface` / `viewport` / `input` / `platform`); browser capabilities are injected into the engine via `platform/dom`, which keeps the engine framework- and platform-agnostic.

## Tech Stack

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
| Compression / archiving | fflate (OFD packaging) |
| Back-end framework | Spring Boot 3.3 (Java 17) |
| Data access | MyBatis-Plus |
| Security | Spring Security + JWT |
| Real-time communication | WebSocket |
| Cache | Redis |
| API docs | Springdoc OpenAPI (Swagger) |
| Database | MySQL 8.0+ (built-in H2 mode for development) |
| Testing | Vitest + Testing Library (215 test files, ~2,400 cases; Playwright E2E planned) |

## Quick Start

### Requirements

- Node.js 18+
- Java 17+
- Maven 3.6+
- MySQL 8.0+ (optional — a built-in H2 development mode is also available)
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

### Docker Deployment

```bash
docker-compose up -d
```

`docker-compose.yml` orchestrates four services: `mysql` (3306), `redis` (6379), `backend` (8080) and `nginx` (80, serving the front-end static assets and reverse-proxying the API).

## Project Structure

```
EMRDocumentEngine/
├── backend/                    # Backend service (Spring Boot)
│   └── src/main/java/com/emr/
│       ├── config/             # Configuration (security / WebSocket / MyBatis-Plus)
│       ├── controller/         # Controller layer (Auth / Document / Template)
│       ├── service/            # Business logic layer
│       ├── entity/             # Entity classes (MyBatis-Plus)
│       ├── repository/         # Data access layer (Mapper)
│       ├── dto/                # Data transfer objects
│       └── util/               # Utility classes (JWT, etc.)
├── packages/
│   └── emr-document-engine/    # Engine package @emrde/document-engine (standalone, contract §32)
│       ├── src/engine/         # Editor engine core (framework/platform agnostic)
│       │   ├── document/       # Document model (ModelD tree + NodePool, core/factory/io/table/version)
│       │   ├── layout/         # Layout engine (line breaking / pagination / incremental / viewport / text / table)
│       │   ├── render/         # Rendering (three-layer Canvas + particle system)
│       │   ├── interaction/    # Interaction (keyboard / mouse / IME / event bus)
│       │   ├── command/        # Command system (undo / redo / macro)
│       │   ├── host/           # EditorHost capability interface
│       │   ├── state/          # State management
│       │   ├── plugins/        # Plugin system
│       │   ├── qc/             # Quality control
│       │   ├── security/       # Security (XSS protection / permission dimensions)
│       │   ├── loaders/        # Document loaders
│       │   ├── import/         # External template import
│       │   ├── template/       # Design-time control template definitions
│       │   ├── format/         # Feature modules such as the format painter
│       │   ├── evaluation/     # Control scoring
│       │   ├── context/        # Right-click context snapshot
│       │   ├── i18n/           # Internationalization
│       │   └── __tests__/      # Engine unit tests
│       ├── src/platform/dom/   # Browser host implementation (Canvas / clipboard / IndexedDB)
│       ├── src/platform/react/ # React adapter (EditorProvider)
│       ├── src/lib/            # Export / print / provenance feature layer
│       ├── package.json        # Distribution manifest (four subpath entries)
│       ├── vite.config.ts      # Library build (no minification, IP-POLICY §5)
│       └── tsconfig.json       # Declaration build
├── frontend/                   # Front-end application
│   └── src/
│       ├── components/         # React components (layout/toolbar/dialogs/panels/views/...)
│       ├── platform/chrome/    # App chrome theme tokens (not engine, not distributed)
│       ├── platform/data/      # Medical code tables and control library (app data)
│       ├── lib/                # App-side utilities (utils / compareDocuments)
│       ├── pages/              # Page components
│       ├── services/           # API services
│       ├── store/              # Global state (Zustand)
│       └── mocks/              # Demo data
├── output/                     # Project documents (research / PRD / architecture / UIUX / spec)
├── knowledge/                  # Knowledge base
├── scripts/                    # Engineering scripts (file headers / provenance / archive)
├── docker-compose.yml          # Docker Compose configuration
├── nginx.conf                  # Nginx site and reverse-proxy configuration
├── LICENSE                     # MPL-2.0 License
├── NOTICE                      # Copyright and third-party notices
└── IP-POLICY.md                # Intellectual property protection policy
```

## Core Modules

### Front-end Editor Engine

- **DocumentModel / NodePool**: document data model with 17 node types (including sections), flat node pool with ID references; tables may nest, and inline children allowed in cell paragraphs are the same as in the body
- **ContainerChildTypes**: container child-type contract, declaring and validating the children each container allows (single source of truth)
- **LayoutEngine**: layout engine (line breaking / pagination / section-break pagination semantics / incremental / virtual viewport / kinsoku / orphan-widow control)
- **LayeredRenderer / Draw**: three-layer Canvas renderer and particle system
- **TextMeasurer / FontManager**: text measurement and font metrics (Canvas measurement first)
- **CommandManager / CommandUndoRedoStack**: command execution, undo / redo and macros
- **EventBus**: event bus handling inter-component communication
- **KeyboardHandler / MouseHandler / IMEHandler**: input event handling
- **QCEngine**: quality-control engine (8 built-in rules + custom rules)
- **DocumentLoader / DocumentSerializer**: document serialization and load/upgrade pipeline
- **EditorHost**: platform capability boundary (six-tuple), making the engine framework- and platform-agnostic

### Back-end Service Layer

- **DocumentService**: document business logic (paginated listing, creation, archiving a history version on update)
- **TemplateService**: template business logic
- **AuthService**: authentication and authorization service (JWT login / refresh)
- **AuditLogRepository**: audit log data access (schema ready; write and query not yet wired)

## API Interfaces

### Authentication

| Method | Path | Description |
|------|------|------|
| POST | `/api/v1/auth/login` | User login |
| POST | `/api/v1/auth/logout` | User logout |
| GET | `/api/v1/auth/me` | Get current user info |

### Documents

| Method | Path | Description |
|------|------|------|
| GET | `/api/v1/documents` | List documents (paginated / keyword / status) |
| POST | `/api/v1/documents` | Create a document |
| GET | `/api/v1/documents/{id}` | Get document details |
| PUT | `/api/v1/documents/{id}` | Update a document |
| DELETE | `/api/v1/documents/{id}` | Delete a document |

### Templates

| Method | Path | Description |
|------|------|------|
| GET | `/api/v1/templates` | List templates (category / keyword) |
| GET | `/api/v1/templates/{id}` | Get template details |
| POST | `/api/v1/templates` | Create a template |
| PUT | `/api/v1/templates/{id}` | Update a template |
| DELETE | `/api/v1/templates/{id}` | Delete a template |

## Database Schema

| Table | Description |
|------|------|
| `t_user` | Users |
| `t_document` | Documents |
| `t_template` | Templates |
| `t_document_version` | Document history versions |
| `t_annotation` | Annotations |
| `t_audit_log` | Audit log |

## Project Documentation

- [Research report](output/1-research.md) — technology choices and competitive analysis
- [Product requirements](output/2-prd.md) — functional requirements and user stories
- [Architecture design](output/3-architecture.md) — system architecture and technical approach
- [UI/UX design](output/4-uiux.md) — interface design and interaction specification
- [Technical specification](output/5-spec.md) — detailed specification and task breakdown

## Development Guide

### AI-Assisted Development Contract

This project uses AI-assisted development. To constrain the AI's code behavior and keep the architectural boundaries intact, the repository maintains an "AI editing contract":

- `.claude/CLAUDE.md`: the AI entry prompt, instructing the AI to read the contract before modifying `packages/emr-document-engine` (the engine source).
- `.claude/AI_EDITOR_CONTRACT.md`: the architectural invariant contract (32 numbered sections), defining the engine's mandatory boundaries — for example: the engine must not depend on React or browser globals, all document mutations must go through the command system, every mutable fact must have a single owner, and the document model must not depend on layout / rendering.

When implementing, refactoring or reviewing code, the AI must treat the contract as a hard constraint; if an invariant has to be broken, the AI must first explain why, assess the impact and obtain explicit authorization.

### Code Standards

- The front end uses TypeScript strict mode. Run `npm run test` (Vitest) and `npm run build` (which includes `tsc --noEmit` type checking) before committing.
- The backend follows the Alibaba Java Development Manual.

## Roadmap

| Capability | Description | Status |
|------|------|------|
| PDF / DOCX export | Complete the export matrix (listed in the export dialog, currently marked "coming soon") | Planned |
| XML / HL7 import parsing | Current loader is a stub; only JSON / HTML / Markdown are effective | Planned |
| HarfBuzz text shaping | High-precision text measurement via WASM | Planned |
| Collaborative editing | Yjs / WebSocket infrastructure is in place; editing stream not yet wired | Capability reserved |
| Version rollback UI | History versions are persisted; the rollback UI is not yet wired | Planned |
| Audit logging | `t_audit_log` schema is ready; write and query not yet wired | Planned |
| Backend tests | JUnit / Spring Boot Test dependencies are ready; test cases not yet added | Planned |
| E2E test suite | Playwright end-to-end regression tests | Planned |

## Contributing

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

## License

This project is licensed under the [MPL-2.0 (Mozilla Public License 2.0)](LICENSE).

In plain terms:

- ✅ **Commercial use is allowed** — hospitals, enterprises and commercial products may use it, including integration with closed-source systems
- ✅ **Modification and redistribution are allowed** — keep the copyright and license notices intact
- ⚠️ **Modifications must be shared back** — if you modify **files that already exist in this project**, those files must remain open source under MPL-2.0 (files you add yourself may use any license)
- ❌ No warranty of any kind

Full terms: [LICENSE](LICENSE). Copyright and third-party notices: [NOTICE](NOTICE). Our IP protection policy: [IP-POLICY.md](IP-POLICY.md).

## Contact Information

If you have questions or suggestions, feel free to reach out through the [Issues](https://gitee.com/wangwang_1_1665527118/emrdocument-engine/issues) page — we'd be happy to chat.

---

**Thank you for using the EMR Document Editor Engine!**
