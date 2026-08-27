AI EDITOR ARCHITECTURE CONTRACT
Project: EMR Document Engine
Scope: frontend/src/engine
Status: MANDATORY

This document defines architectural invariants for AI-assisted development.

AI MUST treat these rules as hard constraints.

When implementing, modifying, refactoring, or reviewing code,
AI MUST preserve these architectural boundaries unless the user
explicitly authorizes an architectural change.

============================================================
0. CORE PRINCIPLE
============================================================

The editor is a layered document-editing engine.

The canonical flow is:

    User Input
        ↓
    Interaction
        ↓
    Editor
        ↓
    Command
        ↓
    DocumentModel
        ↓
    Layout
        ↓
    Render
        ↓
    Canvas / Screen

The architecture MUST NOT be bypassed for convenience.

Prefer architectural correctness over the shortest implementation.

Do not introduce shortcuts that create hidden coupling.

============================================================
1. ENGINE / UI BOUNDARY
============================================================

The engine is UI-framework independent.

engine/ MUST NOT depend on:

- React
- React components
- pages/
- components/
- application-level Zustand stores
- UI-specific implementation details

Allowed dependency direction:

    pages/
        ↓
    components/
        ↓
    engine/

NOT allowed:

    engine/
        ↓
    components/

    engine/
        ↓
    pages/

    engine/
        ↓
    React

The UI may consume the engine.

The engine MUST NOT consume the UI.

If an engine feature needs to notify the UI,
use an engine event, callback, interface, or public API.

Do not import a React component into the engine.

============================================================
2. DOCUMENT MODEL BOUNDARY
============================================================

DocumentModel represents document semantics and structure.

DocumentModel is the source of truth for document content.

DocumentModel MUST NOT depend on:

- layout/
- render/
- CanvasRenderingContext2D
- DOM rendering
- React
- UI components
- viewport implementation

DocumentModel answers:

    "What is the document?"

It MUST NOT answer:

    "How is the document rendered?"

    "Where is the document currently displayed?"

Examples of document state:

- paragraphs
- text runs
- tables
- sections
- styles
- headers
- footers
- bookmarks
- footnotes
- document metadata

These belong to the document model.

============================================================
3. LAYOUT BOUNDARY
============================================================

LayoutEngine determines how a document is arranged.

Layout answers:

    "How should the document be laid out?"

Layout MAY read DocumentModel.

Layout MUST NOT mutate document content as a side effect of layout.

Layout MUST NOT depend on React components.

Layout MUST NOT perform UI rendering.

The conceptual dependency is:

    DocumentModel
        ↓
    LayoutEngine
        ↓
    LayoutResult

Layout-specific data includes:

- lines
- pages
- frames
- SLIF
- page breaks
- line breaks
- text metrics
- layout cache
- page start information
- viewport-related derived layout data

Layout results are DERIVED data.

They are not the canonical document state.

============================================================
4. RENDER BOUNDARY
============================================================

Render converts layout/document information into visual output.

Renderer answers:

    "How do we draw this?"

Renderer MAY depend on:

- LayoutResult
- read-only document information
- rendering configuration
- editor theme

Renderer MUST NOT become the owner of document state.

Renderer MUST NOT directly modify DocumentModel.

Renderer MUST NOT contain document editing logic.

The conceptual dependency is:

    DocumentModel
          ↓
      LayoutEngine
          ↓
      LayoutResult
          ↓
      Renderer
          ↓
       Canvas

Rendering MUST be treated as a projection of state,
not the source of truth.

============================================================
5. COMMAND MUTATION GATE
============================================================

ALL document mutations MUST go through the command system.

Canonical mutation flow:

    Input
      ↓
    CommandManager
      ↓
    ICommand
      ↓
    DocumentModel mutation

Examples include:

- insert text
- delete text
- insert paragraph
- delete paragraph
- formatting changes
- table insertion
- table deletion
- row/column operations
- merge/split cells
- section changes
- bookmark changes
- document property changes

Direct document mutation from UI code is FORBIDDEN.

Forbidden:

    component
        ↓
    document.nodes.push(...)

Forbidden:

    toolbar
        ↓
    node.text = ...

Forbidden:

    dialog
        ↓
    DocumentModel mutation

Forbidden:

    plugin
        ↓
    direct DocumentModel mutation

Instead:

    UI
      ↓
    Command
      ↓
    DocumentModel

============================================================
6. SINGLE MUTATION CHOKE POINT
============================================================

Document mutation MUST have a controlled entry point.

Do not expose mutable internal structures unnecessarily.

Avoid APIs that allow arbitrary external code to modify
internal document structures directly.

Prefer:

    Command
        ↓
    controlled DocumentModel operation
        ↓
    document change
        ↓
    change/event notification

Avoid:

    external code
        ↓
    internal node tree mutation

The purpose is to preserve:

- undo
- redo
- history
- collaboration
- auditing
- permissions
- change tracking
- consistency

Any new API that exposes mutable internal document structures
MUST be justified before implementation.

============================================================
7. STATE OWNERSHIP
============================================================

Every mutable fact MUST have exactly ONE owner.

The project contains multiple state systems.
They MUST NOT become duplicate sources of truth.

------------------------------------------------------------
7.1 Application State
------------------------------------------------------------

Owner:

    Zustand

Examples:

- current document ID
- current user/session information
- recent documents
- application-level UI state
- sidebar visibility
- dialog state
- application settings
- global preferences

------------------------------------------------------------
7.2 Editor Runtime State
------------------------------------------------------------

Owner:

    engine/state/EditorStore

Examples:

- caret
- selection
- IME state
- viewport
- zoom
- active page
- editing mode
- editor runtime state

------------------------------------------------------------
7.3 Document State
------------------------------------------------------------

Owner:

    DocumentModel

Examples:

- document nodes
- text
- paragraphs
- tables
- styles
- sections
- headers
- footers
- bookmarks
- footnotes
- document metadata

------------------------------------------------------------
7.4 Layout Derived State
------------------------------------------------------------

Owner:

    LayoutEngine / LayoutCache

Examples:

- line layout
- page layout
- SLIF
- page start table
- text measurement results
- layout cache
- derived frame positions

These are derived values.

They MUST NOT become a second source of truth for document content.

------------------------------------------------------------
7.5 Duplicate State Rule
------------------------------------------------------------

The same mutable fact MUST NOT be independently stored in:

- Zustand
- EditorStore
- DocumentModel
- LayoutEngine

Example FORBIDDEN:

    Zustand.selection
    EditorStore.selection

Both cannot independently own the current selection.

There MUST be one canonical owner.

Other modules may derive or read the value,
but MUST NOT maintain an independent mutable copy.

============================================================
8. COMMANDS AND HISTORY
============================================================

Commands are the semantic representation of document operations.

A command SHOULD represent a meaningful user/editor operation.

Examples:

    InsertTextCommand
    DeleteRangeCommand
    InsertTableCommand
    DeleteTableCommand
    SetFormattingCommand

Commands SHOULD be designed so that the operation can participate in:

- undo
- redo
- history
- transactions
- collaboration
- auditing

Do not implement a new document mutation path merely because
the existing command system appears inconvenient.

If the command system is insufficient,
improve the command system instead.

============================================================
9. COLLABORATION / YJS
============================================================

Yjs is a collaboration infrastructure.

Yjs MUST NOT become an uncontrolled second DocumentModel.

Preferred conceptual flow:

    Remote / Local Collaboration
            ↓
       Collaboration Layer
            ↓
       Document Operation
            ↓
       DocumentModel

The collaboration implementation SHOULD be isolated behind
a collaboration abstraction.

Avoid spreading Yjs-specific types throughout unrelated engine modules.

For example, avoid making every module directly depend on:

- Y.Doc
- Y.Map
- Y.Array
- Y.Text

Prefer:

    CollaborationManager
    YjsAdapter
    DocumentBinding

The goal is to prevent the document engine from becoming
tightly coupled to a specific CRDT implementation.

============================================================
10. REACT INTEGRATION
============================================================

React integration belongs at the boundary.

Preferred:

    React
      ↓
    EditorProvider
      ↓
    Editor
      ↓
    Engine

EditorProvider is an adapter between React lifecycle/state
and the editor engine.

Engine code SHOULD NOT know that React exists.

React components SHOULD NOT implement core document algorithms.

Do not move document logic into React components merely
because it is easier to access component state.

============================================================
11. EDITOR CLASS RESPONSIBILITY
============================================================

engine/Editor.ts is a facade/orchestrator.

Editor SHOULD coordinate engine subsystems.

Editor SHOULD NOT become a God Object.

Editor SHOULD NOT contain the complete implementation of:

- document model
- layout
- rendering
- interaction
- collaboration
- persistence
- QC
- search
- autosave
- recovery
- plugin management

Preferred:

    Editor
      ├── DocumentModel
      ├── CommandManager
      ├── LayoutEngine
      ├── Renderer
      ├── Interaction
      ├── RuntimeState
      └── Collaboration

Editor coordinates these modules.

The modules own their own implementation.

When adding a new feature,
first determine which subsystem owns it.

Do not automatically add more code to Editor.ts.

============================================================
12. FEATURES MUST NOT POLLUTE CORE
============================================================

Core engine responsibilities:

    command
    document
    layout
    render
    interaction
    runtime state

Feature-level capabilities SHOULD remain isolated.

Examples:

- find/replace
- autocorrect
- autosave
- compare
- QC
- recovery
- TOC
- watermark
- export
- printing

Do not add unrelated feature-specific logic to:

- DocumentModel
- LayoutEngine
- Renderer
- Editor

unless the functionality is genuinely part of that subsystem.

Prefer feature modules/adapters.

============================================================
13. DOCUMENT SERIALIZATION
============================================================

Serialization is not the same thing as DocumentModel.

DocumentModel represents the current in-memory document.

DocumentSerializer represents persistence/serialization.

Do not make DocumentModel responsible for:

- JSON transport format
- API request format
- database persistence
- network communication

Preferred:

    DocumentModel
        ↓
    DocumentSerializer
        ↓
    persistence/API

============================================================
14. DOCUMENT VERSIONING
============================================================

Document format evolution MUST be explicit.

If the serialized document format changes,
consider whether ModelUpgrader is required.

Preferred:

    Old Document
        ↓
    ModelUpgrader
        ↓
    Current DocumentModel

Do not silently reinterpret old document structures
inside unrelated document/layout code.

============================================================
15. EVENT BUS ARCHITECTURE
============================================================

EventBus MUST represent a clearly defined event domain.

Multiple EventBus implementations are allowed only when
their responsibilities are explicitly different.

The existence of multiple EventBus instances MUST NOT be
used as a substitute for clear module APIs.

Current intended event domains:

1. Engine-level events
   Examples:
   - documentChanged
   - commandExecuted
   - selectionChanged
   - layoutInvalidated
   - layoutCompleted
   - documentLoaded
   - documentSaved

2. Interaction-level events
   Examples:
   - keyDown
   - keyUp
   - mouseDown
   - mouseMove
   - mouseUp
   - compositionStart
   - compositionUpdate
   - compositionEnd

Interaction events MUST remain separate from engine lifecycle
and document events.

Preferred flow:

    User Input
        ↓
    Interaction Event
        ↓
    Interaction Handler
        ↓
    Command
        ↓
    DocumentModel
        ↓
    Engine Event
        ↓
    Layout / UI / other subscribers

Do NOT use EventBus when a direct method call or explicit
interface is clearer.

Avoid:

    A
     ↓
    EventBus
     ↓
    B

when the relationship is simply:

    A → B

Avoid event chains where one EventBus forwards events into
another EventBus without a clearly defined boundary.

An event MUST have exactly one canonical domain.

Do not define the same semantic event independently in
multiple EventBus implementations.

Before creating a new EventBus, AI MUST verify:

1. Does an existing EventBus already own this event domain?
2. Is a new event domain genuinely required?
3. Can a direct interface or method call express the relationship?
4. Will the new EventBus introduce cross-bus forwarding?
5. Will developers know which EventBus owns each event?

If the answers are unclear, STOP and inspect the existing
event architecture before adding another EventBus.

============================================================
16. LAYOUT MUST BE INCREMENTAL
============================================================

The editor is designed for large documents.

Do not introduce unnecessary full-document recomputation.

When changing layout behavior,
consider:

- DirtyTracker
- IncrementalLayout
- LayoutCache
- VirtualViewport
- PageStartTable

Prefer invalidating only affected regions.

However:

Correctness MUST take priority over premature optimization.

Do not introduce complex caching without understanding
its invalidation rules.

============================================================
17. PERFORMANCE RULE
============================================================

Do not put high-frequency editor operations into React state
unless there is a clear reason.

High-frequency operations include:

- caret movement
- mouse movement
- selection updates
- IME composition
- text measurement
- layout updates
- pointer interaction

These belong primarily to the engine runtime.

React should not be forced to re-render the entire editor
for every caret or layout operation.

============================================================
18. TESTING
============================================================

Core engine behavior SHOULD be testable without React.

Prefer unit tests for:

- commands
- undo/redo
- document model
- serialization
- migration
- layout
- line breaking
- page breaking
- table operations
- coordinate conversion
- selection/range logic

UI-specific behavior belongs in component/E2E tests.

Do not make core engine tests depend on React rendering
unless the behavior is genuinely UI-specific.

============================================================
19. DEPENDENCY DIRECTION
============================================================

The preferred conceptual dependency graph is:

    UI
     ↓
    Editor
     ↓
    Interaction
     ↓
    Command
     ↓
    Document
     ↓
    Layout
     ↓
    Render

Supporting systems:

    Collaboration
    Persistence
    Features
    Plugins
    QC
    Metrics

MUST integrate through defined boundaries.

Avoid circular dependencies.

Especially avoid:

    Document → Layout
    Layout → Document mutation
    Render → Document mutation
    Engine → React
    Engine → UI
    Zustand → DocumentModel mutation
    Collaboration → arbitrary internal node mutation

============================================================
20. BEFORE MODIFYING ARCHITECTURE
============================================================

Before performing a structural refactor,
AI MUST first determine:

1. Which module owns the responsibility?
2. Which module currently owns the state?
3. What is the dependency direction?
4. Does the change introduce a new source of truth?
5. Does the change bypass CommandManager?
6. Does the change introduce React dependency into engine?
7. Does the change create Document ↔ Layout/Render coupling?
8. Does the change increase Editor.ts responsibility?
9. Does the change introduce direct Yjs coupling?
10. Does the change create a circular dependency?

If any answer indicates an architectural violation,
STOP and redesign the approach.

============================================================
21. DIRECTORY REFACTORING RULE
============================================================

Do NOT reorganize directories merely for aesthetic reasons.

Before moving files,
verify that the responsibility boundary actually changed.

Prefer:

    establish dependency rule
        ↓
    verify actual dependency graph
        ↓
    refactor implementation
        ↓
    move directories if useful

Do not perform large-scale file moves
without a functional or architectural reason.

============================================================
22. CHANGE MINIMIZATION
============================================================

When implementing a feature:

- modify the smallest appropriate subsystem
- avoid unrelated refactoring
- do not rename unrelated APIs
- do not reorganize unrelated directories
- do not rewrite working code without reason
- preserve existing behavior unless the task requires change

Architecture improvements MUST NOT be mixed into unrelated
feature work unless necessary.

============================================================
23. WHEN A RULE MUST BE BROKEN
============================================================

These rules are strong defaults and architectural invariants.

If a task genuinely requires violating a rule:

AI MUST:

1. Identify the violated rule.
2. Explain why the violation is necessary.
3. Explain the architectural impact.
4. Prefer introducing an abstraction instead of direct coupling.
5. Ask for explicit authorization before making a permanent
   architectural violation, unless the user has already
   explicitly authorized it.

Never silently violate an architectural invariant.

============================================================
24. PRIORITY ORDER
============================================================

When constraints conflict, use this priority:

1. Data correctness
2. DocumentModel integrity
3. Command / mutation integrity
4. State ownership
5. Dependency boundaries
6. Undo/redo correctness
7. Collaboration correctness
8. Layout correctness
9. Rendering correctness
10. Performance
11. Code convenience
12. Directory aesthetics

Correctness is more important than convenience.

============================================================
25. FINAL ARCHITECTURAL INVARIANTS
============================================================

The following five rules are NON-NEGOTIABLE:

RULE 1:

    Engine MUST NOT depend on React/UI.

RULE 2:

    DocumentModel MUST NOT depend on Layout/Render.

RULE 3:

    Every mutable fact MUST have exactly one canonical owner.

RULE 4:

    All document mutations MUST pass through the Command system.

RULE 5:

    Document mutation MUST have a controlled mutation choke point.

In short:

    UI
      ↓
    Interaction
      ↓
    Command
      ↓
    DocumentModel
      ↓
    Layout
      ↓
    Render

And:

    React ≠ Engine
    Zustand ≠ EditorStore
    DocumentModel ≠ LayoutState
    DocumentModel ≠ RenderState

These distinctions MUST remain explicit throughout development.