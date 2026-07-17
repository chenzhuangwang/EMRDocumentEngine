# EMR Document Editor Engine

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

## 🛠 Tech Stack

### Frontend Technologies
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling Solution**: Tailwind CSS
- **State Management**: Redux Toolkit
- **HTTP Client**: Axios
- **Rendering Engine**: Self-developed HTML5 Canvas renderer
- **Event System**: Custom event bus

### Backend Technologies
- **Runtime Environment**: Java 17+
- **Framework**: Spring Boot 3.x
- **Data Access**: MyBatis-Plus
- **Security Framework**: Spring Security + JWT
- **Real-time Communication**: WebSocket (Spring Boot)
- **Database**: MySQL 8.0+

## 📁 Project Structure

```
emr-document-engine/
├── backend/                    # Backend Service
│   ├── src/main/java/com/emr/
│   │   ├── config/            # Configuration Classes
│   │   │   ├── SecurityConfig.java     # Security Configuration
│   │   │   ├── WebSocketConfig.java    # WebSocket Configuration
│   │   │   └── MybatisPlusConfig.java  # MyBatis-Plus Configuration
│   │   ├── controller/        # Controller Layer
│   │   │   ├── AuthController.java     # Authentication Interfaces
│   │   │   ├── DocumentController.java # Document Management Interfaces
│   │   │   └── TemplateController.java # Template Management Interfaces
│   │   ├── service/           # Business Logic Layer
│   │   │   ├── AuthService.java
│   │   │   ├── DocumentService.java
│   │   │   └── TemplateService.java
│   │   ├── entity/            # Entity Classes
│   │   │   ├── Document.java
│   │   │   ├── Template.java
│   │   │   ├── User.java
│   │   │   ├── Annotation.java
│   │   │   ├── AuditLog.java
│   │   │   └── DocumentVersion.java
│   │   ├── repository/        # Data Access Layer
│   │   ├── dto/               # Data Transfer Objects
│   │   └── util/              # Utility Classes
│   │       └── JwtUtil.java
│   └── resources/
│       └── application.yml    # Application Configuration
│
├── frontend/                   # Frontend Application
│   ├── src/
│   │   ├── components/        # React Components
│   │   │   ├── editor/        # Editor Core Components
│   │   │   │   └── EditorProvider.tsx
│   │   │   └── layout/        # Layout Components
│   │   │       ├── EditorLayout.tsx
│   │   │       ├── HeaderBar.tsx
│   │   │       ├── Sidebar.tsx
│   │   │       ├── Toolbar.tsx
│   │   │       ├── PropertiesPanel.tsx
│   │   │       └── StatusBar.tsx
│   │   ├── engine/            # Editor Engine Core
│   │   │   ├── Editor.ts              # Main Editor Class
│   │   │   ├── EventBus.ts            # Event Bus
│   │   │   ├── document/              # Document Model
│   │   │   │   ├── DocumentModel.ts
│   │   │   │   └── ElementFormatter.ts
│   │   │   ├── render/                # Rendering Module
│   │   │   │   └── Draw.ts
│   │   │   ├── layout/                # Layout Engine
│   │   │   │   └── TextMeasurer.ts
│   │   │   └── state/                 # State Management
│   │   │       ├── HistoryManager.ts
│   │   │       └── Position.ts
│   │   ├── pages/             # Page Components
│   │   │   ├── EditorPage.tsx
│   │   │   └── HomePage.tsx
│   │   ├── services/          # API Services
│   │   │   └── api.ts
│   │   ├── store/             # State Store
│   │   │   └── index.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
│
├── output/                     # Document Output Directory
│   ├── 1-research.md          # Research Report
│   ├── 2-prd.md               # Product Requirement Document
│   ├── 3-architecture.md      # Architecture Design Document
│   ├── 4-uiux.md              # UI/UX Design Document
│   └── 5-spec.md              # Technical Specification
│
└── .super-dev/                # Development Configuration
    ├── SESSION_BRIEF.md
    └── WORKFLOW.md
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

The frontend application will start at `http://localhost:5173`.

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

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 📞 Contact Information

If you have questions or suggestions, please provide feedback through the project Issues page.

---

**Thank you for using the EMR Document Editor Engine!**