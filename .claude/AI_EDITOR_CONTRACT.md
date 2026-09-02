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
CONTRACT STATUS
============================================================

This document defines architectural invariants and forbidden
states. It is NOT a migration plan, task list, or refactoring
roadmap. A rule describing a target architecture does not imply
that the corresponding refactor must be performed immediately.

AI MUST distinguish between:

1. MUST NOT  — prohibited architecture (now forbidden)
2. MUST      — required invariant (now binding)
3. SHOULD    — preferred design (guidance)
4. TARGET    — intended future location/state (later)

Unless explicitly requested by the user, AI MUST NOT perform
large refactors merely to satisfy TARGET placement.

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

The engine is UI-framework independent AND platform independent.

engine/ MUST NOT depend on:

- React
- React components
- pages/
- components/
- application-level Zustand stores
- UI-specific implementation details
- browser globals (full list in §28)

Allowed dependency direction:

    pages/
        ↓
    components/
        ↓
    engine/

    platform/dom
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

------------------------------------------------------------
2.1 SmartText / EMR Field boundary
------------------------------------------------------------

A SmartTextNode represents a structured EMR field. Its
"definition" (what the field IS) and its runtime "value"
(what a patient's record says) are DIFFERENT concerns and
MUST be stored separately.

    Field definition (document semantic):
        data element code, name, labels, data type, min/max
        length, dictionary, enum options, required, readonly,
        privacy/masking, numeric scale, textarea rows.

    Field value (runtime patient data):
        the actual entered value.

A SmartTextNode MUST NOT carry the definition and the value
in one field. The definition is template-time metadata; the
value is record-time data.

Concretely:

    SmartTextNode.element / .format  → definition (semantic)
    SmartTextNode.text               → placeholder (the empty /
                                        unfilled display form)
    SmartTextNode.value              → runtime value (patient
                                        data, optional)

    SmartTextNode.text MUST NOT be overloaded as both
    placeholder AND value. The runtime value lives ONLY in
    .value. A missing/empty .value means "not filled"; readers
    render .value when present, otherwise .text.

------------------------------------------------------------
2.2 Semantic style vs presentation style
------------------------------------------------------------

DocumentModel owns SEMANTIC style — typography and character
style that is part of content meaning (TextStyle: font, size,
bold, italic, underline, color, highlight, ...).

DocumentModel MUST NOT own PRESENTATION / box-model / CSS
layout — borderStyle, borderColor, outline, contentStyle,
contentWrap, minWidth, textAlign — these answer "how it is
rendered", which §2 already forbids.

A style-reference dictionary (style: {id} → shared definition)
is a LATER optimization; do not introduce it until templates
show genuine large-scale style duplication.

Concretely:

    Presentation / box-model attributes of a rendered element
    (all optional, keyed by NODE id — per element instance):

        borderStyle   string          — border line style
                                        (e.g. "none", "solid")
        contentWrap   boolean         — wrap content in a box
        contentStyle  string          — raw CSS box-style string
        minWidth      number | string — minimum box width
        textAlign     string          — horizontal alignment
                                        (e.g. "left", "center")

    (borderColor / outline are the same presentation category,
    per the list above.)

    These live in a presentation-style layer in the RENDER domain
    (engine/render/presentation/, §4), as a SEPARATE object
    associated to a node by id. DocumentModel — including
    SmartTextNode, ElementMeta, and Paragraph — MUST NOT grow any
    of these fields; the boundary is type-enforced.

    The shared style-reference system (a node's `style: {id}` plus
    the template's `styles` / `globalStyles` dictionaries) is a
    SEPARATE, deferred concern (the "LATER optimization" above) —
    not the same as these per-instance inline presentation fields.

    Runtime consumption: at draw time the renderer reads the
    per-node presentation style by nodeId (SLIFItem.nodeId) and
    applies it as rendering configuration —
        borderStyle   → whether/how the control box border is drawn
        minWidth      → minimum box width
        textAlign     → in-box horizontal alignment of the drawn
                        text ("left" / "center" / "right"), applied
                        at draw time; it shifts only the text glyph
                        inside an already-laid-out box and takes
                        effect when the box is wider than the text
                        (i.e. when minWidth pads the box)
    contentWrap / contentStyle are DEFERRED — they change layout
    (wrapping, box height, raw CSS box parsing), a LAYOUT-domain
    concern, not draw-time-only.
    The renderer MUST NOT write presentation fields back into
    DocumentModel, and MUST NOT fold them into SLIF as canonical
    state (SLIF remains a derived projection; presentation fields
    are looked up by nodeId at draw time).

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

Inline nodes nested inside table cells (smarttext controls,
field codes, …) MUST be dispatched through the same particle
registry (particleRegistry) as body text — a table particle MUST
NOT render cell items via a direct ctx.fillText bypass. This
keeps per-node presentation / template-design fields (§2.2 /
§12.1) applied uniformly: a smarttext inside a table cell renders
the same control box + presentation styles as one in the body.

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

------------------------------------------------------------
6.1 NodePool choke point (enforced at the type level)
------------------------------------------------------------

The choke point MUST be enforced by the type system, not by a
comment or a naming convention.

    `readonly nodes = new Map(...)` is NOT a choke point:
    `readonly` locks the reference, not the Map. External code can
    still call pool.nodes.get(x).children.push(...) or
    pool.nodes.set(...) without any compiler error.

NodePool MUST NOT expose a mutable Map of nodes. External code
MUST NOT obtain a mutable reference to the internal node
collection.

The allowed surface is explicit:

    Read:     getNode(id) / hasNode(id) / traversePool(cb)
    Mutate:   addNode(node)         // registration, throws on dup id
              removeNode(id)
              updateNode(node)      // throws on id/type change
              insertChild / removeChild / moveChild / detachChild
              removeOrphanLeaf

The choke point must close TWO distinct leak paths, not one:

    PROBLEM A — the pool itself:
        pool.nodes.set(...) / pool.nodes.delete(...)

    PROBLEM B — a node's children array:
        const row = pool.getNode(...); row.children.push(...)

Making `nodes` private fixes A but NOT B. A caller holding a node
reference can still mutate `node.children` in place. The controlled
APIs above are the ONLY way to change structure; callers MUST NOT
mutate node.children directly.

Commands MUST NOT reach past NodePool into raw Map/array mutation:

    FORBIDDEN:  pool.nodes.set(...) / pool.nodes.delete(...)
    FORBIDDEN:  row.children.splice(...)
    FORBIDDEN:  para.children.push(...)

A Command that needs a structural operation NodePool does not yet
provide MUST first extend NodePool with a controlled method, then
call it — never mutate the tree directly.

Any new API that exposes mutable internal document structures
MUST be justified before implementation.

------------------------------------------------------------
6.2 Two mutation layers: Command = gate, NodePool/DocumentModel = enforcement
------------------------------------------------------------

"Mutation gate" and "mutation enforcement" are DIFFERENT layers
and MUST NOT be conflated:

    Command system        = the GATE — who may INITIATE a document
                            change, and which changes are recorded as
                            undoable/redoable commands.
                            (All document mutations MUST pass through
                            CommandManager — §5, RULE 4.)

    NodePool / DocumentModel controlled API
                          = the ENFORCEMENT — how a document MAY
                            legally change once a command runs.

NodePool enforces NODE STRUCTURE only (children / nodes, via the
§6.1 controlled methods insertChild / removeChild / moveChild / …).

DocumentTree / DocumentModel own the NON-STRUCTURAL document fields:

    pageSetup / headerFooterConfig / metadata / modelVersion

    These are NOT NodePool's responsibility. Their runtime mutations
    MUST still be Command-gated (e.g. HeaderFooterConfigCommand,
    SetPageSetupCommand). The only other legitimate writers are the
    load path (DocumentLoader, §14) and the migration path
    (ModelUpgrader, §14). External code MUST NOT assign these fields
    directly.

Do NOT phrase the invariant as "NodePool is the ONLY document
mutation entry". The correct statement is:

    All external document mutations MUST enter through the Command
    system.

    DocumentModel and NodePool MUST expose controlled mutation APIs
    for their RESPECTIVE domains.

    No mutable internal representation may be directly exposed.

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

Note — EditorStore.document is NOT a second document owner:

    EditorStoreState.document holds a REFERENCE to the canonical
    DocumentTree, not an independent copy. Its single writer is
    EditorStore.setDocument(), which replaces the reference when a
    whole document is loaded/replaced. In-place edits mutate the
    canonical DocumentTree through NodePool and are NOT copied into
    EditorStore.

    EditorStore.document is a reference/view to DocumentModel
    (§7.3). It MUST NOT become an independent document state store.

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

------------------------------------------------------------
7.6 Template / Presentation stores
------------------------------------------------------------

The template-design layer (TemplateDefinitionStore, §12.1) and
presentation layer (PresentationStyleStore, §2.2) are instance
state owned by the Editor — per-editor, per-loaded-template, NOT
module-level singletons (§27.3). They are associated to nodes by
nodeId and hold configuration, NOT document content; they MUST NOT
be folded into DocumentModel nodes or into DocumentSerializer's
node payload.

They enter the editor only through the LOAD path (§12.2): the
importer produces them, and the load boundary MUST carry them into
the Editor instance so render/command consumers can reach them.
They are not part of EditorStore.runtime (a UI projection); they
are held alongside DocumentModel as editor-level state.

Document content ownership remains §7.3 (DocumentModel). A single
TemplateDefinition or PresentationStyle value has a single owner:
the corresponding store, keyed by nodeId. Renderers and commands
READ them and MUST NOT maintain an independent copy.

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

------------------------------------------------------------
8.1 History single owner
------------------------------------------------------------

The undo/redo command stacks MUST have exactly ONE owner:

    engine/command/CommandUndoRedoStack

It owns undoStack / redoStack and their merge window. No other
module MAY hold a reference to the command stacks or maintain a
parallel undo history.

HistoryState (engine/state/HistoryState) is a PURE PROJECTION of
{ canUndo, canRedo, undoDepth, redoDepth }. It MUST NOT store
commands. Editor.syncHistoryState() reads from
CommandUndoRedoStack and writes the projection into
EditorStore.runtime.history — a canonical → projection flow,
never a second source of truth.

------------------------------------------------------------
8.2 Undo/redo are document changes
------------------------------------------------------------

Undo and redo MUTATE the document. The "document changed" fact
MUST NOT disappear on the undo/redo path.

CommandManager.execute() emits document:changed. undo()/redo()
MUST NOT downgrade to a bare render:request that skips the
document-change subscribers.

Undo/redo MUST still trigger:

    - autoSave.markDirty()               (persistence)
    - notifyListeners('contentChange')   (UI: toolbar, word count,
                                          header/footer labels)

An undo that is invisible to autosave and the UI is a correctness
bug, not a style preference. History semantics (merge window, stack
contents) MAY differ from normal edits, but the fact that the
document changed MUST be signalled identically.

"Document changed" is a fact; "why it changed" (user / undo / redo /
remote / system) is a separate concern and MAY be distinguished via
change origin when collaboration or auditing needs it. Do NOT solve
that distinction by introducing a second event transport.

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

    Core engine modules MUST NOT import Yjs types directly —
    including `import type { Doc } from 'yjs'`: a type-only import
    still makes the engine aware of the CRDT implementation.

    Collaboration-specific types MUST be hidden behind an
    engine-defined abstraction. The presence of a "collab" execution
    mode MUST NOT cause Yjs types to leak into core commands.
    Concretely, CommandContext's collab branch MUST reference an
    engine-defined interface (or `unknown`), never a Yjs type:

        type CommandContext =
          | LocalDocumentContext
          | CollaborationContext   // engine-defined, not Yjs

    The Yjs binding (YjsAdapter / DocumentBinding) belongs in the
    collaboration adapter / platform layer, NOT in core commands.

------------------------------------------------------------
9.1 Collaboration boundary (fixed now, implemented later)
------------------------------------------------------------

Collaboration is a DEFERRED capability. Its boundary is fixed now so
that core document modules are not pre-emptively coupled to it.

Collaboration MUST remain isolated from core document modules.

    Presence / Awareness (onlineUsers, remote cursor/selection
    presence, user metadata) MUST NOT become document state. They
    MUST NOT be stored in DocumentModel and MUST NOT be serialized
    into the persisted document.

    onlineUsers is AWARENESS ("who is here"), not DOCUMENT CONTENT.
    Its home is application state / a collaboration Awareness manager
    (currently Zustand useEditorStore), never DocumentModel, never the
    document JSON.

    Document Sync ("what is being edited" — InsertText / DeleteRange /
    FormatText as Operations) and Awareness ("where users are / who
    they are") are DIFFERENT concerns and MUST NOT be conflated.

Yjs is a transport / synchronization mechanism, NOT a DocumentModel.
Yjs types MUST NOT leak into core document / layout / render modules
(no TextParticle → Y.Text, no TableOps → Y.Map, no DocumentModel →
Y.Array). The Yjs binding (YjsAdapter / DocumentBinding) belongs in
the collaboration adapter / platform transport layer.

Future design note (NOT binding until collaboration is implemented):

    Commands SHOULD NOT each branch on local/collab internally
    (an `if (ctx.mode === 'local') … else …` spread across 13
    commands). Prefer a Mutation/Transaction abstraction with
    separate local and collaboration executors, so InsertTextCommand
    expresses "insert this text" rather than "if Yjs do this, if
    local do that".

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

Concrete ownership anchors (God Object drift to reverse):

    table merge/split algorithms  → document/table/TableOps.ts
    format painter (copy/apply)   → its own feature module
    selection-collection loop     → ONE shared helper, not 3 copies

These are the specific drifts found in Editor.ts at the
architecture freeze. They are the pattern to reverse, NOT to extend.

A God Object symptom is copy-pasted logic across Editor methods —
e.g. the same "collect selected text-node ids" loop repeated in
toggleFormat / clearFormat / applyFormatPainterToSelection. When the
same non-trivial logic is implemented for the second time, extract a
shared helper/service unless there is a documented reason not to.

------------------------------------------------------------
11.1 Editor Facade Growth Rule
------------------------------------------------------------

File size alone is NOT a violation. Editor.ts MAY remain large
while it acts as a facade/orchestrator (initialization, dependency
wiring, lifecycle, module coordination, a thin facade API).

The real indicator is whether Editor.ts absorbs logic that has an
independent domain owner.

    AI MUST NOT add substantial domain-specific logic to Editor.ts
    merely for convenience when an existing subsystem (CommandManager,
    DocumentModel, LayoutEngine, Draw, EditorStore, AutoSaveManager,
    FindReplaceEngine, AutoCorrectEngine, PluginManager,
    PerformanceMetrics) or a new feature module is the natural owner.

    Editor.ts MUST remain primarily an orchestrator/facade.

    When Editor.ts repeatedly accumulates logic from the same domain,
    that domain SHOULD be extracted into its own module.

    Repeated non-trivial logic MUST be extracted rather than
    duplicated.

Practical test — if a change to Editor.ts adds:

    - a new algorithm
    - a new data structure
    - feature-specific state
    - feature-specific business rules
    - a second implementation of existing logic

prefer a dedicated module over adding the logic to Editor.ts.

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

------------------------------------------------------------
12.1 Template / Form Definition boundary
------------------------------------------------------------

Template authoring metadata MUST NOT become document content.

Template-design attributes of a smarttext control —
    deletable, editable, tips, label, prefix, suffix, single
— describe how a template AUTHOR configures the control at
design time, not what the document content IS.

These belong to a TemplateDefinition layer (a feature, per
§12), NOT to DocumentModel / SmartTextNode.

DocumentModel MUST NOT store template-design attributes as
document semantics.

Concretely:

    Template-design attributes of a smarttext control (all
    optional, keyed by NODE id — per control instance):

        deletable  boolean  — control may be removed by the
                              template author at design time
        editable   boolean  — control accepts user input
                              (distinct from ElementEnums.editable,
                              which means "enum allows free input")
        tips       string   — design-time hint / tooltip text
        label      string   — label text shown beside the control
        prefix     string   — literal text before the control
        suffix     string   — literal text after the control
        single     boolean  — the data element may appear only once

    These seven fields live in a TemplateDefinition feature layer
    (engine/template/, §12) as a SEPARATE object associated to a
    node by id. SmartTextNode and ElementMeta MUST NOT grow any of
    these seven fields — the boundary is type-enforced.

    Runtime consumption: at draw time the renderer reads the
    per-node TemplateDefinition by nodeId (SLIFItem.nodeId) and
    draws the literal-affix fields as text beside the control —
        label    → label text drawn immediately before the control
        prefix   → literal drawn before the control (after label)
        suffix   → literal drawn after the control
    These are draw-time overlays; they do NOT participate in
    layout reflow (box position/width come from layout; the affix
    literals are measured and drawn around the box). Their layout
    interaction (wrapping, width contribution) is DEFERRED.
    deletable is consumed by the COMMAND layer at control-removal
    time (not the renderer). A smarttext whose TemplateDefinition
    .deletable === false is a locked control: RemoveControlCommand
    MUST refuse to remove it — forward returns null, mutating
    nothing and pushing nothing onto the undo stack. deletable ===
    true or absent (no store entry) means the control is removable.

    tips is a read-only design-time hint, consumed by the UI at
    hover time via Editor.getTip(nodeId) — a read API returning
    the control's TemplateDefinition.tips (or undefined when the
    node has no definition). The renderer never reads tips.

    editable is consumed by the COMMAND layer at find & replace
    time (not the renderer). A smarttext whose TemplateDefinition
    .editable === false does not accept user input: ReplaceTextCommand
    MUST skip it, never overwriting its value (a read-only control
    stays read-only through find & replace).

    single is consumed by the COMMAND layer at paste/insert time
    (not the renderer). A single-valued data element — identified
    by element.code.dataElement, falling back to
    element.code.internal — MUST NOT be duplicated by a paste:
    when InsertNodesCommand would introduce a smarttext whose
    element identity already exists in the target document AND that
    existing element is marked single === true, the duplicate
    instance is dropped (the existing first instance is kept).
    Import (§12.2) does NOT dedupe: a template may legitimately
    reference the same data element in multiple sections (e.g. a
    summary header plus the body form), and single guards
    user-introduced duplication only. Design-time fields live in
    the per-editor store keyed by node id, so they do NOT survive
    copy/paste; the guard therefore keys off the EXISTING element's
    single flag, not the pasted node's.

    Design-time library insertion (§12.4) is the second single
    consumption point: a library entry marked single === true is
    refused a second insertion into the same document (the INSERT
    half; paste is the other half).

    The template artifact (a document + its TemplateDefinitions +
    its PresentationStyles) is distinct from a filled record (a
    document with SmartTextNode.value set).

    Serialization: when a template artifact is persisted, the two
    stores are emitted as TOP-LEVEL fields of the artifact —
        templateDefinitions  — { [nodeId]: TemplateDefinition }
        presentationStyles   — { [nodeId]: PresentationStyle }
    — SIBLING to the `nodes` flat table, keyed by node id, never
    merged into a node payload that DocumentSerializer emits.
    DocumentLoader reads them back into per-editor store instances
    on load, so a template round-trips (import → edit → save →
    load) without losing design-time or presentation fields. A
    filled record MAY omit them; the loader treats absence as
    empty stores.

------------------------------------------------------------
12.2 Template importer boundary
------------------------------------------------------------

The external template importer maps a third-party template
document (which has its own node/field schema) into the engine's
layered model. It is a FEATURE (§12), not core; it is a LOAD
path (§6.2), not an editor mutation, so it constructs a FRESH
DocumentTree rather than mutating an existing one.

The importer's job is ROUTING. It reads one external node and
dispatches each of its fields to the single layer that owns it:

    external semantic fields       → ElementMeta (DocumentModel)
    external runtime value         → SmartTextNode.value
    external template-design flds  → TemplateDefinitionStore (§12.1)
    external presentation flds     → PresentationStyleStore (§2.2)

The importer MUST NOT invent new persistent fields on
SmartTextNode / ElementMeta / Paragraph to carry what belongs to
the TemplateDefinition or PresentationStyle layers. An external
field with no canonical home MUST be dropped or deferred, never
smuggled into DocumentModel.

Concretely:

    TemplateImportResult {
      doc                  — DocumentTree (semantic content)
      nodes                — Map<string, BaseNode> (NodePool source)
      templateDefinitions  — TemplateDefinitionStore (§12.1)
      presentationStyles   — PresentationStyleStore (§2.2)
    }

    Home: engine/import/ (§12 feature home). The importer reuses
    external node ids verbatim as engine node ids (identity is
    preserved for the per-id stores); it generates ids only for
    nodes the external format does not name.

    The load boundary MUST carry TemplateImportResult.templateDefinitions
    and presentationStyles into the Editor instance (per-editor state,
    §7.6) rather than dropping them at the load boundary. They MUST NOT
    be written into DocumentSerializer's node payload (§12.1).
    presentationStyles is consumed by the renderer (§2.2);
    templateDefinitions is carried for later design-time consumers (§12.1).

    The shared style-reference dictionary (external styles /
    globalStyles) is DEFERRED per §2.2. P0 resolves only text-level
    style (styles.text → TextStyle font/size/bold) into the semantic
    TextStyle; paragraph/table style dictionaries are not imported.

    Deferred external constructs (documented, not yet mapped):
        checkfield      → P0 text label only (checkbox semantics later)
        insert / delete → P0 markers dropped, sibling content kept
                          (revision tracking is a separate concern)
        scripts / valid → not part of the four-layer model

------------------------------------------------------------
12.3 Design-mode interaction boundary
------------------------------------------------------------

Design mode (EditorRuntimeState.view.mode === 'design') is an
INTERACTION mode: entering it changes how the editor routes
pointer/keyboard input, NOT what document content IS. A control's
semantic definition, runtime value, template-design attributes,
and presentation style stay in their existing layers (§2.1 / §2.2
/ §12.1); design mode only reveals and edits them through the
command layer.

Design-mode selection and hover are TRANSIENT runtime state —
the currently-selected control id and the currently-hovered
control id. They are canonical-owned by the Editor (like
formatPainterActive / headerFooterEdit, §7.2), keyed by node id,
never document content, and never serialized. DocumentSerializer
MUST NOT emit them; DocumentLoader MUST NOT read them.

Concretely:

    selecting — a click on a smarttext control in design mode
        selects it (sets the selected-control id); clicking empty
        space clears it. Selection is node-granular (one control
        at a time), distinct from the character selection used in
        edit mode.

    hovering  — moving the pointer over a smarttext control in
        design mode exposes that control's node id to the UI as
        transient hover state. The UI reads the control's
        design-time hint through Editor.getTip(nodeId) (§12.1) to
        render a tooltip. The RENDERER never reads tips.

    deleting  — removing the selected control MUST go through
        RemoveControlCommand (not a raw pool mutation). The
        deletable gate (§12.1) applies unchanged: a control whose
        TemplateDefinition.deletable === false refuses deletion,
        even when selected.

    highlight — the renderer draws a design-time overlay around the
        selected control (dashed border). This is a draw-time
        overlay like label/prefix/suffix (§12.1): it does NOT
        participate in layout reflow.

Design mode does not yet support the shared style-reference
system (§2.2); that remains a later phase. Creating controls
from a library is §12.4; editing a control's TemplateDefinition
attributes in place is §12.5.

------------------------------------------------------------
12.4 Design-time control insertion (from library)
------------------------------------------------------------

Design mode (§12.3) reveals and selects controls; it does not yet
create them in place. This section defines how a control is
CREATED in design mode: insertion from a control library.

A "control library entry" is a catalog record describing a medical
data element — its semantic identity (dataElement code), display
name, data type, and design-time defaults. It is NOT a node. The
library is DATA injected by the platform/UI; the engine MUST NOT
hardcode any medical dictionary. The engine's surface is a single
insertion API.

Concretely, inserting a library entry produces a SmartTextNode in
the current paragraph at the cursor, across TWO layers at once
(a third is deferred):

    semantic      → SmartTextNode.element (ElementMeta: real
                    code.dataElement, name, format.dataType);
                    placeholder text [name] (契约 §2.1), no value.
    design-time   → TemplateDefinitionStore[nodeId] (§12.1):
                    label / tips / deletable / editable / single.
    presentation  → DEFERRED (§2.2 shared style-reference). P2
                    inserts only the semantic + design-time layers;
                    a PresentationStyle argument is not yet part of
                    the API.

The insertion MUST be a single Command (InsertControlCommand):

    forward: (a) single-guard; (b) create + register the
        SmartTextNode and insert it into the paragraph at the
        cursor; (c) write the TemplateDefinition into the
        per-editor store (ctx.templateDefinitions — the same store
        instance carried in the CommandContext).
    invert:  (a) remove the inserted node; (b) delete the
        TemplateDefinition entry — so undo leaves no orphan
        definition and the per-node stores stay consistent with the
        node set.

This preserves the §12.1 rule that design-time fields never enter
DocumentModel, while keeping the per-node store synchronized with
the node set through undo/redo.

single guard at insertion (§12.1): a library entry whose
TemplateDefinition.single === true may appear at most once in the
document. InsertControlCommand MUST refuse (forward returns null,
nothing pushed onto the undo stack) when the document already
contains a smarttext with the same element identity (code.dataElement,
falling back to code.internal). Import (§12.2) is exempt, as before.

The engine API:

    Editor.insertControl(
      element: ElementMeta,                 // semantic identity
      definition?: TemplateDefinition,      // design-time defaults
    ): void

Home: the command lives in engine/command/commands/. The library
catalog TYPE and sample data live in the frontend (platform/data),
NOT in engine/. The UI (design-mode control palette) reads the
catalog and calls Editor.insertControl; it never mutates the pool
or the stores directly.

------------------------------------------------------------
12.5 Design-time control attribute editing (in place)
------------------------------------------------------------

Design mode (§12.3) reveals and selects controls; §12.4 creates
them from a library. This section defines how a template author
EDITS an already-selected control's design-time attributes in
place.

Editing a control's attributes is a TemplateDefinition-layer
change ONLY (§12.1). It rewrites the selected node's entry in the
per-editor store; it does NOT touch SmartTextNode.element / .value,
does NOT create or remove nodes, and does NOT enter DocumentModel.
The semantic / runtime-value / presentation layers (§2.1 / §2.2)
are unchanged by this feature.

It remains design-mode interaction (§12.3): the engine exposes the
API without a mode check (consistent with selectControl /
deleteSelectedControl), and the UI exposes the edit surface only in
design mode.

Editing goes through the command system (RULE 4):

    UpdateControlDefinitionCommand(nodeId, next: TemplateDefinition | undefined)

    forward: snapshot old = store.get(nodeId); then whole-value
        replace — if next is undefined or has no own enumerable
        fields, store.delete(nodeId); otherwise store.set(nodeId, next).
    invert:  if old was undefined, delete the entry; otherwise
        set(old) — restoring the prior definition exactly.

    Whole-value replace (NOT field-level merge): the command
    receives the EDITED COMPLETE definition. The UI reads the full
    definition via Editor.getControlDefinition(nodeId), edits fields
    locally, and writes the complete definition back — so no field
    is silently dropped, and "clear a field" is expressed by omitting
    that key from the written definition. The command itself carries
    no merge/deletion semantics.

    All seven §12.1 fields are editable (deletable / editable / tips
    / label / prefix / suffix / single). The edit panel MUST display
    and write back the COMPLETE definition, never a partial one.

    Guard interaction — an edited flag takes effect immediately at
    its existing command consumption point:
        deletable → RemoveControlCommand (§12.1) refuses/permits
                    removal of the control.
        editable  → ReplaceTextCommand (§12.1) skips/overwrites the
                    control's value at find & replace.
        single    → InsertNodesCommand / InsertControlCommand
                    (§12.1/§12.4) refuse/allow a second insertion of
                    the same identity.

    single does NOT retroactively dedupe: flipping a control's
    single to true affects only FUTURE insertions/pastes, never
    deletes already-present duplicate instances; flipping it to
    false likewise only relaxes future guards.

    The nodeId MUST reference an existing smarttext node. forward
    returns null (no-op, nothing pushed onto the undo stack) when
    the node is absent or is not a smarttext — so a definition can
    never be orphaned onto a non-existent/non-control node. A null
    store (not injected) is likewise a no-op.

    Invalidation: a definition change does not alter document
    structure or layout reflow (label/prefix/suffix are draw-time
    overlays per §12.1; the flags are command-layer guards), so the
    command returns invalidation 'none'. It still flows through the
    command system so it marks the template dirty and persists via
    the artifact's templateDefinitions top-level field (§12.1).

The engine API:

    Editor.getControlDefinition(nodeId: string):
        TemplateDefinition | undefined

    Editor.setControlDefinition(
        nodeId: string,
        definition?: TemplateDefinition,
    ): void

Home: the command lives in engine/command/commands/. The UI
(design-mode control properties panel) reads getControlDefinition,
edits the full definition, and writes setControlDefinition; it never
mutates the store directly.

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

Current event-bus state (audited at architecture freeze):

ONE live EventBus — engine/interaction/EventBus.ts (typed, with
EventPayloadMap). It is the ENGINE LIFECYCLE bus and carries:

    document:changed, state:changed, cursor:moved, selection:changed,
    scale:changed, layout:changed, render:request, yjs:synced,
    qc:completed, save:versionConflict

    engine/EventBus.ts (root, string-keyed) is DEAD CODE — zero
    importers — and MUST be deleted, not revived.

    The live bus is PHYSICALLY MISLOCATED: it sits under
    interaction/ yet owns engine lifecycle events, not interaction
    events. Its eventual home is engine/events/. Until then, treat
    engine/interaction/EventBus.ts as the single canonical engine
    bus — do NOT add engine lifecycle events to a second bus, and
    do NOT add interaction events to this one.

    Interaction input (keyDown, mouseDown, compositionStart, …) is
    currently delivered as direct callbacks on InputHost, NOT via
    EventBus. Do not build a second EventBus for it unless a
    genuine subscriber fan-out requirement appears.

Canonical-bus rule:

    There MUST be one canonical engine event bus.

    Do NOT create another EventBus for the same semantic event
    domain (e.g. a second transport for document:changed).

    A future bus is justified only for a genuinely different domain
    (worker communication, plugin messaging, …). Temporary
    compatibility wrappers are allowed only when they do NOT
    introduce a second source of truth or a second event transport.

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

The following rules are NON-NEGOTIABLE:

RULE 1:

    Engine MUST NOT depend on React/UI,
    and MUST NOT depend on browser globals.
    Browser capability access MUST flow through Host interfaces
    (see §27, §28, §29).

RULE 2:

    DocumentModel MUST NOT depend on Layout/Render.

RULE 3:

    Every mutable fact MUST have exactly one canonical owner.

RULE 4:

    All document mutations MUST pass through the Command system.

RULE 5:

    Document mutation MUST have a controlled mutation choke point,
    enforced at the TYPE level through NodePool controlled methods
    (see §6.1) — not by convention or comment.

    More generally: architectural invariants SHOULD be enforced
    through module visibility, TypeScript types, and API design
    wherever technically possible. Do not rely solely on comments,
    naming conventions, or developer discipline.

RULE 6:

    Engine MUST NOT access browser globals directly,
    nor through utility functions or module-level helpers.
    Platform access enters the engine ONLY through Host interfaces.

RULE 7:

    Engine modules MUST be safe to import in non-DOM runtimes.
    Importing an engine module MUST NOT trigger browser side effects.

RULE 8:

    Undo/redo MUTATE the document and MUST signal "document changed"
    identically to execute(): autoSave.markDirty() and the UI
    contentChange notification MUST NOT be skipped on the undo/redo
    path (see §8.2).

    Undo/redo MUST preserve the semantic meaning of "document
    changed" while remaining distinguishable as a history operation
    when needed (change origin: user / undo / redo / remote /
    system) — never by inventing a second event transport for
    history operations.

RULE 9:

    The undo/redo command stacks MUST have exactly ONE owner,
    CommandUndoRedoStack. HistoryState is a PURE projection and
    MUST NOT store commands (see §8.1).

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

============================================================
26. DOCUMENT VERSIONING INVARIANTS
============================================================

1. EditorVersion MUST NOT be used as DocumentFormatVersion.

2. DocumentFormatVersion MUST NOT be inferred from
   EditorVersion.

3. SLIFVersion MUST be treated as a separate version domain.

4. DocumentFormatVersion MUST be explicitly stored
   in serialized documents.

5. Document loading MUST detect document version
   before constructing the current runtime model.

6. Old document formats MUST be migrated through ModelUpgrader.

7. ModelUpgrader MUST NOT be bypassed for supported old versions.

8. New migrations MUST be incremental:
      vN → vN+1

9. DocumentSerializer MUST write CURRENT_DOCUMENT_VERSION.

10. There MUST be exactly one canonical current
    DocumentFormatVersion.

11. NodePool construction MUST NOT own document migration logic.

12. DocumentModel MUST explicitly declare its document
    format/version metadata where applicable.

13. SLIF_VERSION MUST NOT be treated as the document
    format version merely because their values currently match.

============================================================
27. HOST ABSTRACTION BOUNDARY
============================================================

The engine is a pure document-editing runtime.

It is portable across hosts:

    React / Vue / Electron renderer
                ↓
    platform/dom (browser adapter)
                ↓
    EditorHost (capability boundary)
                ↓
    engine/ (pure runtime)

Future hosts: platform/worker, platform/electron.

Platform capability access MUST originate from platform/
implementations and enter the engine ONLY through Host interfaces.

Dependency direction:

    platform/
        ↓
    engine/

NOT allowed:

    engine/
        ↓
    platform/

------------------------------------------------------------
27.1 EditorHost capability interfaces
------------------------------------------------------------

    interface EditorHost {
      text:     TextHost
      font:     FontHost
      surface:  SurfaceHost
      viewport: ViewportHost
      input:    InputHost
      platform: PlatformHost
    }

    TextHost      — measure(), getFontMetrics()
    FontHost      — isGlyphAvailable(), onReady(), loadFont()
    SurfaceHost   — createLayer(), createOffscreen(), devicePixelRatio(), requestFrame()
    ViewportHost  — size(), bounds()
    InputHost     — attach/detach global listeners, IME surface
    PlatformHost  — applyTheme(), clipboard, sendBeacon(), measureHtml(), onBeforeUnload(), storage

Concrete shapes (surface / viewport — now stable):

    type LayerKind = 'static' | 'content' | 'interact'

    interface CanvasSurface {
      ctx: CanvasRenderingContext2D            // injected 2D context
      readonly imageSource: CanvasImageSource  // for createPattern/drawImage
      readonly width: number                   // physical px
      readonly height: number                  // physical px
      resize(physicalW, physicalH, cssW, cssH): void
      setTop(cssTopPx): void                   // scroll counter-offset
      getBoundingClientRect(): { left; top }
      toDataURL(type?): string
      remove(): void
    }

    interface SurfaceHost {
      createLayer(kind: LayerKind): CanvasSurface
      createOffscreen(width, height): CanvasSurface
      createSpacer(): { setHeight(cssH); remove() }
      loadImage(url): Promise<{ width; height; source: CanvasImageSource }>
      devicePixelRatio(): number
      requestFrame(cb): number
      cancelFrame(id): void
    }

    interface ViewportHost {
      size(): { width; height }                // container.clientWidth/Height
      bounds(): { left; top }                  // container.getBoundingClientRect
    }

    interface ClipboardHost {
      writeText(text: string): Promise<void>   // best-effort, never rejects
      readText(): Promise<string>              // rejects when unavailable
      canRead(): boolean                       // navigator.clipboard?.readText presence
    }

    interface HtmlMeasureResult {
      width: number
      height: number
      text: string                             // element textContent
    }

    interface PlatformHost {
      applyTheme(colors): void                 // :root CSS vars / native chrome
      clipboard: ClipboardHost
      sendBeacon(url, data): void              // data = engine-serialized JSON string
      measureHtml(html, fontSize): HtmlMeasureResult   // off-screen KaTeX measurement
      onBeforeUnload(cb): () => void           // detach closure
      storage: StorageHost                     // autosave snapshot persistence (see below)
    }

    interface StorageHost {
      init(): Promise<void>                    // open/create backing store, resolve when ready
      put(snapshot: SaveSnapshot): Promise<void>   // upsert one snapshot by id
      list(documentId: string): Promise<SaveSnapshot[]>   // all snapshots for a doc (order unspecified)
      remove(ids: string[]): Promise<void>     // batch-delete snapshots by id
      close(): void                            // close backing store
    }

    SurfaceHost owns: canvas creation, getContext, DPR, frame scheduling.
    ViewportHost owns: viewport dimensions.
    PlatformHost owns: DOM chrome (theme), clipboard, telemetry, off-screen HTML measurement, autosave persistence (StorageHost).
    The engine draws ONLY on the injected ctx (see §27.2).

TextHost vs FontHost:

    Text measurement and font lifecycle / availability are
    different abstraction responsibilities. They MAY be merged
    in an early phase and split once the call boundary is stable.

    Do NOT let TextHost grow into a "font service" God interface.

------------------------------------------------------------
27.2 Rendering surface exception
------------------------------------------------------------

The render layer MAY draw on a 2D drawing context INJECTED by
SurfaceHost.

The engine MUST NOT create, acquire, or query a Canvas itself.

The abstraction needed is:

    WHO creates the surface
    WHO provides the context
    WHO owns DPR
    WHO owns frame scheduling

NOT a re-invention of the Canvas 2D API.

------------------------------------------------------------
27.3 Host injection mechanism (P5)
------------------------------------------------------------

EditorHost MUST enter the engine through constructor
injection, NOT through a global registry:

    const editor = new Editor(host, doc)

The Editor is the composition root: it receives host,
constructs the host-dependent services (FontManager,
TextMeasurer), and threads host + measurer down to every
subsystem — Draw → LayeredRenderer / LayoutEngine → LineBreaker,
particles, interaction handlers, clipboard, performance, theme.

There MUST NOT be a global mutable host slot. The former
setEditorHost() / getEditorHost() / hasEditorHost() registry
is retired.

Host-dependent services (TextMeasurer, FontManager,
FontFallback) are per-Editor instances owned by the Editor —
no module-level `export const textMeasurer = ...` or
`fontManager = ...` singletons.

Module-level singletons that REMAIN are limited to
host-independent pure config / registries:

    scriptResolver         (Unicode script resolution)
    particleRegistry       (particle factory table)
    documentLoaderRegistry (format loader table)
    modelUpgrader          (version migration chain)
    locale                 (i18n message pack)

These are side-effect-free at import (§29) and naturally
app-wide shared; they do not block multi-Editor coexistence.

============================================================
28. BROWSER GLOBAL PROHIBITION
============================================================

Engine code MUST NOT directly reference:

    document
    window
    navigator
    location
    localStorage
    sessionStorage
    indexedDB
    ResizeObserver
    MutationObserver
    IntersectionObserver
    requestAnimationFrame
    requestIdleCallback
    HTMLElement
    HTMLCanvasElement
    document.fonts / FontFaceSet

IndexedDB types (IDBDatabase / IDBRequest / IDBTransaction /
IDBObjectStore / IDBIndex) are likewise prohibited in engine code;
persistence enters through StorageHost (PlatformHost.storage).

Explicit exception:

    CanvasRenderingContext2D (and OffscreenCanvasRenderingContext2D),
    CanvasImageSource, and CanvasPattern may appear in engine code
    ONLY as injected drawing-related types.

    CanvasRenderingContext2D is the type of a drawing context
    injected by SurfaceHost. CanvasImageSource / CanvasPattern are
    produced by the injected context (createPattern) or the platform
    (loadImage) and consumed by drawImage / fillStyle.

    The engine MUST NOT create the canvas, call getContext(), or
    construct these objects itself.

    setTimeout / setInterval are platform-neutral timers
    available in workers and are NOT prohibited here.

============================================================
29. SAFE IMPORT INVARIANT
============================================================

ENGINE MODULES MUST BE SAFE TO IMPORT IN NON-DOM RUNTIMES.

Importing any engine/ module MUST NOT:

    - access document / window / navigator
    - create canvas or DOM elements
    - attach event listeners
    - start browser-only timers
    - trigger any browser-side effect

This includes module-level singletons and their constructors.

Counter-example (FORBIDDEN):

    export const textMeasurer = new TextMeasurer()
    // TextMeasurer constructor creates a canvas at import time

    // NOTE (P5): this singleton was removed — TextMeasurer is now
    // a per-Editor instance constructed with an injected host/fontManager
    // (see §27.3). The counter-example remains as a general illustration.

A module-level side effect of this kind makes the engine
impossible to import in a Web Worker / Node test runtime.

Do NOT smuggle platform access through utility functions or
module-level helpers:

    // FORBIDDEN — looks compliant, actually a violation
    class Foo {
      private host?: EditorHost
      doSomething() {
        const width = window.innerWidth   // ← hidden platform access
      }
    }

============================================================
30. WORK PRIORITY (non-normative guidance)
============================================================

This section is guidance, not architectural invariant.

P0 — architecture boundaries (do BEFORE directory refactors):
    - Engine browser-global audit → Host abstraction
    - Engine / UI dependency rule
    - State ownership rule
    - Command mutation rule
    - Host abstraction contract

P1 — correctness & boundaries:
    - Host P0/P1 implementation (TextHost first)
    - EventBus audit (engine/EventBus vs interaction/EventBus)
    - Editor.ts God Object audit
    - Collaboration / Yjs boundary
    - Document version loading / migration (ModelUpgrader)

P2 — internal organization (after boundaries are stable):
    - Feature isolation
    - Layout internal organization
    - document/ internal organization
    - state/geometry organization

P3 — cosmetic cleanup:
    - directory cosmetics
    - i18n
    - security
    - test directory normalization

Principle:

    "Host boundary" ranks above "directory cosmetics".

    "Feature actually works" ranks above "directory looks clean".