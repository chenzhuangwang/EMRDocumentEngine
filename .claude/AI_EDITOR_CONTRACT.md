AI EDITOR ARCHITECTURE CONTRACT
Project: EMR Document Engine
Scope: packages/emr-document-engine (引擎源码; 2026-10 物理剥离前是 frontend/src/engine)
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

Header/footer CONTENT is stored as page-variant id arrays on
DocumentTree (default/odd pages, first page, even pages). See §7.9
for the variant→page selection semantics and the single canonical
resolver. Layout, render, command, interaction and feature code
MUST resolve "which variant applies to page N" and "which array owns
this paragraph id" through that resolver — never by re-implementing
the field mapping or the page rule.

A Section is document STRUCTURE: a container node that groups
body-level content (a whole chapter / clinical block) and owns its
own children array. It is NOT a heading (§31.10) and it is NOT a page
boundary (§31.10 SectionBreak). Content inside a Section is reached
through the logical document flow, never by re-walking body children
— see §31, which fixes the boundary between the STRUCTURE TREE and
the LOGICAL FLOW and is binding for every consumer.

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

    The canonical value TYPE and its empty state (undefined, not '')
    are formalized in §12.6 (Runtime Control Value Contract).

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

Revision marks (§12.13) MUST reuse the existing particle pipeline.
The revision colour and the delete strikeout are drawn by
TextParticle's existing revision branch, reached through
SLIFItem.revision and ParticleAdapters. Screen and print therefore
share one implementation (§4's projection rule). A separate
revision renderer, or a direct ctx.fillText path that bypasses the
particle registry, is forbidden.

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
6.3 CHARACTER OFFSETS AND INLINE NON-TEXT NODES
============================================================

Character offsets are measured in paragraph-visible units, where an
inline non-text node (image / smarttext / footnote_ref / field) counts
as ONE unit. `NodePool.resolveCharOffset` therefore returns such a node
with localOffset 0 (before it) or 1 (after it) — it is NOT a text node.

Any command that splits text at a caret (insert text, split paragraph,
paste) MUST branch on the resolved node's type:

    - text node -> slice node.text at localOffset;
    - non-text  -> split at the node boundary; NEVER read or slice
                   node.text (images have none — doing so throws).

This is a crash class, not a style preference: pasting right after an
inline image used to throw TypeError.

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
- header/footer edit target page (§7.9 — which page's band is being
  edited; transient, never serialized)
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

Header/footer content includes the page variants (§7.9) — first-page
and even-page arrays are document state of the same kind, owned by
DocumentTree, not layout or render state.

Revision marks (§12.13) are document state of the same kind and have
exactly ONE home: the optional `revision` field on TextNode. They are
NOT a TextStyle field. TextStyle is what the format painter copies
(§12.5); copying a change record onto unrelated text is semantically
wrong, and putting revision there would make that happen the moment
anyone uses the painter. They are also NOT range-based (the comment
model): a revision is a property of the text itself and must follow
it through copy, split and merge.

------------------------------------------------------------
7.4 Layout Derived State
------------------------------------------------------------

Owner:

    LayoutEngine

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

------------------------------------------------------------
7.7 DocumentMetadata boundary
------------------------------------------------------------

Document-level metadata has exactly ONE canonical home:
DocumentTree.metadata, typed as DocumentMetadata (NOT
Record<string, unknown>). It describes who a document is, what it
belongs to, and when it was created/modified — it does NOT
describe document content or control semantics.

    DocumentMetadata {
        author?:     string   — 文档作者
        creator?:    string   — 创建人
        reviewer?:   string   — 审核人
        department?: string   — 科室
        category?:   string   — 分类
        keywords?:   string[] — 关键词 (数组规范形)
        externalId?: string   — 外部模板 id (importer)
        categoryId?: string   — 外部模板分类 id (importer)
        createdAt?:  string   — 系统创建时间 (ISO 8601)
        updatedAt?:  string   — 最近修改时间 (ISO 8601)
    }

title is NOT metadata: it remains the top-level required
DocumentTree.title field.

createdAt / updatedAt are SYSTEM lifecycle fields, not free-form
edit fields: they are system-maintained and conventionally
read-only in the UI. They are ISO 8601 strings; the UTC / offset
convention is fixed here and MUST NOT be mixed with other date
formats (e.g. '2026/09/04', timestamps-as-number).

keywords is a string[] in the MODEL. The comma-joined string
("a, b, c") is a UI INPUT representation only; UI splits/joins.
The canonical normalization (trim, drop empty, dedupe) lives in
normalizeDocumentMetadata (document domain) and is applied by
every writer (importer / UI / loader) BEFORE the value reaches a
command — never by the command itself.

BaseNode.metadata is a SEPARATE concept (per-node business
identifier, e.g. table.metadata.code). It stays
Record<string, unknown> and MUST NOT be constrained by
DocumentMetadata. Do not unify the two types for convenience.

DocumentMetadata MUST NOT contain TemplateDefinition fields.
TemplateDefinition MUST NOT contain document-level metadata.
Both are distinct from Control Runtime Value (SmartTextNode.value,
§2.1). These three layers (§7.3 / §7.6 / §2.1) never merge.

The canonical field set is the whitelist. An external template
field with no canonical home MUST be dropped, never smuggled into
metadata as Record<string, unknown> (see §12.2).

------------------------------------------------------------
7.8 Property editing boundary
------------------------------------------------------------

Property UI MUST NOT mutate DocumentModel directly.

Document properties MUST be changed through Commands.

Control Definition MUST be changed through the existing
control-definition command path (§12.5).

Control Runtime Value MUST be changed through content commands
(§2.1).

Property UI MUST NOT become the owner of canonical document state.

DocumentMetadata MUST NOT contain TemplateDefinition data.
TemplateDefinition MUST NOT contain document-level metadata.
Control Definition MUST be distinguished from Control Runtime Value.

Document metadata is edited via UpdateDocumentPropertiesCommand
(§7.7): forward snapshots old = doc.metadata and whole-value
replaces it (next undefined or empty → delete; otherwise
doc.metadata = next). The command does NOT normalize or validate —
its input must already be a legal DocumentMetadata. Normalization
happens at the boundary (UI / importer / loader) via
normalizeDocumentMetadata.

Forbidden:

    dialog
        ↓
    doc.metadata.author = '...'       (bypasses command)

Forbidden:

    selectedNode.metadata.required = true   (metadata ≠ definition)

Forbidden:

    selectedNode.properties = formValues   (invented generic bag)

------------------------------------------------------------
7.9 Page-variant header/footer semantics
------------------------------------------------------------

Header and footer content is document state (§7.3) held as up to six
paragraph-id arrays on DocumentTree:

    header / footer                      default variant (odd pages)
    firstPageHeader / firstPageFooter     first-page variant
    evenPageHeader / evenPageFooter       even-page variant

`header` / `footer` keep their historical meaning: the DEFAULT (odd
page) variant. The four variant arrays are ADDITIVE OPTIONAL fields —
absent ≡ "this variant has no content" (an empty band), never a
default to be backfilled. See §14 for the format-version bump.

Canonical resolver — exactly ONE module owns both mappings:

    engine/document/core/HeaderFooterRegions.ts

It answers two questions and nothing else:

    variant → array            (hfArrayOf / ensureHfArray)
    paragraph id → variant     (resolveHfParagraphLocation)

Selection rule (Word/WPS; n = pageIndex + 1):

    1. differentFirstPage && n === 1   → first variant. NO fallback to
                                         the default variant: enabling
                                         the option blanks page 1 until
                                         it is filled.
    2. else differentOddEven           → odd  → default
                                         even → even variant. No
                                         fallback either.
    3. else                            → default variant.
    4. both flags on                   → page 1 first; pages ≥ 2 by parity.
    5. Empty/absent variant array      → that page's band renders empty
                                         (minimum band height), with no
                                         content fallback.
    6. Content of a disabled variant is RETAINED and reappears when the
       flag is re-enabled (undo/redo and round-trip honesty).

`isVariantEnabled` is driven PURELY by the config flags, never by
whether an array exists — that is what makes enabling 首页不同 blank
page 1 immediately, and makes paragraph creation target the variant
that page actually shows.

MUST:

- layout/render/command/interaction/feature code MUST NOT re-derive the
  variant→array mapping or the page→variant rule. A second mapping is
  the drift this section forbids (§11).
- Membership tests ("is this paragraph in a header/footer?") MUST use
  the resolver, not `doc.header?.includes(...)` — with variants, the
  former is wrong for first/even paragraphs.
- Two paragraphs in DIFFERENT variants of the same band (`header` vs
  `header:first`) are DIFFERENT regions: cross-variant selections MUST
  be rejected, exactly like body↔header.
- The variant array is the controlled mutation surface for this field
  domain (§6.2): commands write through `ensureHfArray`. Direct
  assignment remains legal only on the load / migration paths.
- `headerFooterConfig` changes affect band content AND band height, so
  the config command's invalidation MUST be full (§16) — not 'none'.

Transient UI state (§7.2): the header/footer EDIT TARGET PAGE (which
page's band the user is editing) is transient editor runtime state
inside `headerFooterEdit`, canonical-owned by the Editor, never
serialized. It exists because a header/footer paragraph is present on
EVERY page, so geometry resolution ("which page's copy?") is otherwise
ambiguous and would collapse to page 0. Scroll position remains owned
by CoordinateSystem; the target page is pinned on activation and on a
click inside a band, never re-derived from scrolling.

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

UNDO EXACTNESS. The inverse of a command MUST restore the document as it
was BEFORE that command — node identity and run boundaries included, not
merely the same visible text. A plain "insert the deleted text back"
inverse is lossy whenever the forward changed node structure:

    - an insert that splits a run mints new nodes, and normalizeParagraph
      may merge same-style neighbours — deleting the inserted characters
      can then no longer restore the original run ids;
    - a delete that crosses runs, or covers a run entirely, loses each
      run's style and the removed node ids (text re-insertion takes the
      target run's style only).

Such commands MUST capture the paragraph before mutating
(`captureParagraphSnapshot`) and invert with `RestoreParagraphsCommand`.
Style commands MUST invert by REPLACING each node's style with its own
old value — deleting the fields the command added — because one merged
`changes` object can not represent per-node old styles (and spreading a
`nodeId → style` map into a node writes a bogus field named after the id).

Two further lossy cases are normalized side effects, and take the same
cure:

    - an IN-PLACE insert (no split) whose paragraph ALREADY contains
      adjacent same-style runs — clear-format and style restoration can
      leave such runs behind, because they never normalize. Typing then
      runs normalizeParagraph and silently merges those pre-existing
      runs. The command MUST snapshot the paragraph in that case
      (`hasMergeableRuns`) so its lightweight "delete the typed text"
      inverse is not taken;
    - an IN-PLACE insert into an EMPTY run: the inverse delete empties
      the run, the node is removed, and the empty-paragraph guard mints
      a new node id with default style. Snapshot in that case too.

Conversely, a paragraph MERGE MUST normalize ONLY the seam pair
(`mergeSeamRuns`), never the whole merged paragraph: a split's inverse
IS a merge, so a whole-paragraph normalize rewrites run boundaries that
existed before the split.

A PASTE (`InsertNodesCommand`) follows the same rule: it MUST NOT
normalize the destination paragraph wholesale. Only the seam between the
destination's last original run and the first pasted run may merge; the
right-hand original nodes belong to the pre-paste state and MUST keep
their run identity, because undo restores them by id.

A SPLIT's inverse MUST NOT be implemented as a merge at all. Restore the
paragraph from a pre-split paragraph snapshot instead: a merge has to
decide whether to fuse the seam run, and no single choice is right for
both cases — when the split cut a run, the two halves must fuse; when the
split point sat on a run boundary, two separate runs must stay separate.
`RestoreSplitCommand` removes the minted paragraph subtree and restores
the original children (ids and boundaries) from the snapshot.

Gate: `UndoRedoEquivalence.test.ts` runs random mixed command sequences
through the real Editor and requires, step by step, that undo returns to
each historical snapshot and redo returns to each forward snapshot.
Cell paragraphs participate in the random selection alongside body
paragraphs. Compared data is the canonicalized serialization: values,
node ids and array order; object key insertion order is serialization
noise, not identity.

8.2.1 Command merging

The undo stack MAY merge consecutive commands, but only when the
merged command is an exact substitute for the sequence:

- merging MUST NOT change the state produced by redo;
- one undo of the merged unit MUST restore the state before the first
  command, one redo MUST restore the state after the last one —
  including the §8.3 byte-identical node identity;
- a command that mints node ids, captures a paragraph snapshot, or
  applies revision marks MAY merge only if the merged command carries
  the same minted ids / snapshot / resolved mark;
- when in doubt, do NOT merge. Extra undo steps are acceptable;
  a lost character or a non-identical redo is not.

Implemented: `ParagraphStyleCommand`; `InsertTextCommand` (in-place
append only, contiguous offset, same style and revision kind — when the
first command had to snapshot (§8.2: pre-existing mergeable runs or an
empty target run), the merged unit carries that FIRST snapshot);
`DeleteRangeCommand` (untracked, left-adjacent only — rightward deletes
reuse the same range and MUST NOT merge). A delete that crosses runs,
consumes a whole run or meets pre-existing mergeable runs now carries a
paragraph snapshot (§8.2 undo exactness); only same-run partial deletions
without such runs merge.

------------------------------------------------------------
8.3 Command replay identity — forward is called more than once
------------------------------------------------------------

A command's forward() MAY run MORE THAN ONCE: once on execute, and
again on EVERY redo. CommandUndoRedoStack.redo() re-runs the
ORIGINAL command object's forward(); it does not replay a recorded
mutation.

Therefore:

    A node MINTED inside forward() MUST keep the SAME identity
    (the same id) on every forward() of that command. Redo MUST
    NOT mint a node with a fresh id.

WHY this is load-bearing, not stylistic:

    Commands capture their target as an ID at CONSTRUCTION time —
    a container id ("insert a child Section into THIS Section"), a
    paragraph path ("type into the paragraph the previous command
    created"), or a node id. That id was minted by an EARLIER
    command's forward(). If the earlier command's redo mints a
    different id, the later command's target no longer resolves:
    its forward() returns null and CommandUndoRedoStack SILENTLY
    DROPS it. Undo×3 then redo×3 restores one node instead of
    three. That is silent data loss, not a cosmetic defect — and
    it is exactly the failure §31.5 forbids.

ACCEPTANCE CRITERION:

    execute → undo×N → redo×N MUST leave the document
    byte-identical to its state right after execute — the
    SERIALIZED FORM INCLUDING NODE IDS. Equal shape is not
    enough: shape equality cannot see a dangling reference.

HOW to satisfy it (the engine already does this for inverses):

    forward MUST mint ONCE and re-register thereafter. Snapshot
    the minted subtree on the first forward; on every later
    forward re-register that snapshot (pool.addNode per node,
    then insert the root back into its container) and skip the
    mint entirely. This is the same idiom RestoreNodesCommand /
    RestoreTableCommand / RestoreControlCommand already use in
    the inverse direction, and the shared primitive for it is
    MintedOnce (command/commands/MintedNodes.ts) — do not
    hand-roll a second copy (§11).

    A command that calls a factory (createParagraph, createSection,
    createTextNode, createSmartTextNode, ... — each mints a fresh
    id) unconditionally inside forward() is WRONG by this rule,
    however correct it looks on a single execute.

COROLLARY — the minting/building split:

    Whatever a command does BETWEEN minting and returning must be
    classified: "mint + internal build" (e.g. inserting a new
    Section's initial paragraph into it) belongs INSIDE the
    once-only region; "place the root into its container" belongs
    OUTSIDE it, because the root must be re-placed on every
    forward. Getting this backwards either duplicates children or
    leaves the root unplaced.

COROLLARY — placement of a node held in a non-children container:

    When the minted node lives in a container that is NOT a pool
    children array — doc.footnotes, doc.comments, a header/footer
    region's id array — that container is restored by the inverse
    command, so the push/append MUST also stay OUTSIDE the
    once-only region and be re-done on every forward. Putting it
    inside makes redo silently drop the reference (the node is
    back in the pool but unreferenced).

COROLLARY — the snapshot must be taken at the MINT MOMENT, not at
the end of forward:

    If forward mints several nodes in ONE pass and then further
    MUTATES an earlier one (FormatTextRangeCommand: "alpha" → split
    at 1 → "a"|"lpha", then split at 3 → "a"|"lp"|"ha" — the second
    split truncates the node the first one minted), an end-of-forward
    snapshot records the END state. Replaying it that way re-runs
    the later mutation on an already-mutated node. Snapshot EACH
    minted node at the instant it is created; the later mutations
    are then replayed as mutations, exactly as on the first pass.

COROLLARY — a re-registered snapshot must not be aliased:

    Re-registration MUST hand the pool a COPY of each snapshot
    node, never the snapshot object itself. forward continues to
    mutate what it re-registered; if pool and snapshot share one
    object, the first redo rewrites the snapshot into its end state
    and the SECOND undo→redo cycle no longer starts from the minted
    state. (reregisterMintedSubtree deep-copies per node for this
    reason.)

NO EXCEPTION for in-paragraph text nodes (this supersedes an earlier
draft of this section):

    It was tempting to exempt text nodes inside an existing
    paragraph on the grounds that they are addressed by character
    OFFSET, not by id, so no later command dangles. That reasoning
    is about DANGLING REFERENCES, and it is true as far as it goes —
    but it is NOT the acceptance criterion. The criterion is
    byte-equality of the SERIALIZED form, and that form carries
    every node id. A re-minted text node therefore still fails it,
    whatever addresses it later. Commands that mint such nodes
    (DeleteRangeCommand's empty-paragraph placeholder,
    FormatTextRangeCommand's boundary splits) must hold identity
    like any other.

    What the offset-addressing fact IS good for is a REDUCED
    obligation, not an exemption: such a node needs its id held
    stable only to satisfy the serialized-form criterion. Nothing
    may DEPEND on the id, and nothing needs an extra re-placement
    step for it beyond the snapshot re-registration.

RELATED — optional document-level arrays must survive undo EXACTLY
(both halves fixed; recorded because the second is easy to miss):

    Optional document-level arrays (footnotes, endnotes, comments,
    firstPageHeader/Footer, evenPageHeader/Footer — §7.9) mean
    "absent ≡ no content". Two ways a command can violate that:

    1. WRITE ON A READ. Resolving such an array for a pure query
       ("is this id in the header band?") must NOT create it. A
       removal that matches nothing would otherwise leave a key the
       document never had. Read and write accessors are therefore
       SEPARATE (docArrayOfReadonly / docArrayOfWritable over
       hfArrayOf / ensureHfArray); only a splice that will actually
       happen may touch the write side.

    2. EMPTIED, NOT DELETED. Undoing the insert that created the
       array leaves `[]` where the document had no key at all —
       semantically equal, byte-inequal, so undo is not an exact
       inverse. A removal that empties an OPTIONAL array must delete
       the field (trimDocArrayIfEmpty / trimHfArrayIfEmpty).

    header / footer are NOT in this class: createDocument seeds them,
    so `[]` IS their canonical empty form and must be left alone.

    Note 1 is defence-in-depth for the same outcome note 2 produces:
    keep both. Note 1 stops the key being created at the source;
    note 2 covers the array an insert legitimately created and an
    undo emptied.

ACCEPTANCE GATE:

    engine/__tests__/CommandReplayIdentity.test.ts. Table-driven,
    one row per command family; each row asserts execute → undo×N →
    redo×N byte-identical on the serialized form WITH ids, and then
    runs a SECOND undo→redo cycle (which is what catches the
    aliasing corollary). Each row also asserts the command actually
    changed the document — a row that passes because the command
    no-opped is worthless.

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
    control binding projection    → document/control/ControlProjection.ts
                                    (the bulk data-binding reading order and
                                    bound-item shape; §12.10)
    value → display text, and the  → document/control/ControlDisplay.ts
    candidate set a control offers    (the ONE implementation; the export
                                    layer and the binding projection both
                                    read it — §12.10.4. It lives in engine/
                                    because lib/export/fields.ts already
                                    imports the engine barrel, so the
                                    reverse edge would be a cycle.)
    formula evaluation            → evaluation/ExpressionEngine.ts
                                    (lexer + parser + evaluator for
                                    §12.12; a pure function of
                                    (expression, injected context).
                                    It MUST NOT become a set of methods
                                    on Editor, and it MUST NOT grow a
                                    dependency on layout or render —
                                    they call it, it calls nobody.)

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

------------------------------------------------------------
11.2 God Object drift reversal — the three named homes
------------------------------------------------------------

The three drifts named in §11 have canonical homes. Editor.ts MUST
delegate to them and MUST NOT re-absorb the logic:

    selection-collection  →  document/selection/SelectionCollector.ts
        A single shared helper owns "collect selected text-node ids /
        paragraph ranges from a SelectionState". The FormatRange type
        { path, start, end } is a DOCUMENT-domain concept (a projected
        selection range over DocumentModel) and lives here too — the
        command layer imports it, never the reverse (§19). Editor.ts
        and FormatTextCommand.ts both reuse the same helper instead of
        each carrying an offset-accumulation loop.

    format painter        →  engine/format/FormatPainter.ts
        A feature module owns the copy/apply logic and the transient
        copied-style state. The activation BOOLEAN remains canonical in
        EditorStore (§7.2); only the copied TextStyle and the hit-test/
        apply orchestration move here. Editor.ts keeps a thin facade
        (copyFormatPainterStyle / setFormatPainterActive / ... ) that
        delegates, preserving the public API surface.

    table merge/split     →  document/table/TableOps.ts
        The colspan/rowspan merge and split algorithms are pure pool
        mutations (like insertRow / deleteRow already there) and move
        into TableOps as mergeAdjacentCells / mergeRange / splitCell.
        Editor.ts keeps only the interaction orchestration: read the
        selected cell / range, wrap the TableOps call in a
        TableStructureCommand, then clear the selection state.

The pattern to reverse (§11) is copy-pasted offset-accumulation loops
and inline cell-span algorithms; these homes are the reversal, not a
new place to keep extending Editor.ts.

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

Print and export are such features, and they are DOCUMENT PROJECTIONS:
both MUST include header and footer content (§7.9). Print MUST reuse
the render particle pipeline rather than introducing a second renderer
or a second field-code resolver (§4): a page rendered to an offscreen
context and a page rendered to the screen MUST resolve field codes
(page number, total pages, date, title) identically, and field
resolution MUST have exactly one implementation in the document domain.

------------------------------------------------------------
12.1 Template / Form Definition boundary
------------------------------------------------------------

Template authoring metadata MUST NOT become document content.

Template-design attributes of a smarttext control —
    deletable, editable, tips, label, prefix, suffix, single, controlType,
    formula
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
        controlType string  — the control's widget type
                              ('input' | 'textarea' | 'number' |
                               'select' | 'date' | 'checkbox' | 'radio').
                              This is the UI WIDGET kind, ORTHOGONAL to
                              ElementFormat.dataType (value data type),
                              ElementFormat.showType (display format) and
                              ElementFormat.enums (candidate values) —
                              four independent axes, never inferred from
                              one another. It is a design-time property
                              (fixed at insertion from the library), not
                              document semantics.
        formula    string  — the COMPUTED-VALUE expression this control
                              derives its display from (§12.12). Written
                              by the template author, so it belongs here
                              and NOT in ElementFormat: layer D is
                              presentation/lookup (§12.6.2), while a
                              formula carries VALUE semantics. Its result
                              is NOT persisted (never written to
                              SmartTextNode.value) — see §12.12.

    These nine fields live in a TemplateDefinition feature layer
    (engine/template/, §12) as a SEPARATE object associated to a
    node by id. SmartTextNode and ElementMeta MUST NOT grow any of
    these nine fields — the boundary is type-enforced.

    controlType versioning: controlType is OPTIONAL and typed (never a
    catch-all bag). Documents serialized before controlType existed
    simply lack the field; the loader/upgrader MUST NOT guess or backfill
    it — an absent controlType stays undefined. The document format
    version advances from 4.3.x to 4.4.0 with this field's introduction;
    the migration is a no-op (no data rewrite), leaving pre-4.4 entries
    without controlType.

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
    .editable === false does not accept user input: find-replace of
    its value routes through SetControlValueCommand, which rejects the
    write under VR-8 (a read-only control stays read-only through find
    & replace). editable === false thus locks ALL runtime value writes
    — direct control writes AND find & replace — via the single
    SetControlValueCommand path (§12.6 VR-8).

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
    external document metadata     → DocumentTree.metadata (§7.7),
                                     whitelist-mapped only; unknown
                                     fields dropped

The importer MUST NOT invent new persistent fields on
SmartTextNode / ElementMeta / Paragraph to carry what belongs to
the TemplateDefinition or PresentationStyle layers. An external
field with no canonical home MUST be dropped or deferred, never
smuggled into DocumentModel. The metadata routing (§7.7) is
whitelist-only: parseMetadata maps external fields onto the
DocumentMetadata canonical keys via normalizeDocumentMetadata and
DROPS every other key (e.g. an external properties.version or
properties.createTime with no canonical ISO-8601 home).

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
        scripts / valid → not part of the four-layer model

    Revision marks (§12.13) are no longer deferred. The carrier
    observed in REAL exports is `rtype` ON the host inline node
    (`{ type: 'insert' | 'delete', author, authorId, date, … }`),
    not a standalone marker node. The importer MUST read `rtype` and
    attach RevisionMark to the TextNode it produces (`checkfield`
    maps to a TextNode, so its mark survives too). Standalone inline
    `insert` / `delete` marker nodes are a fixture-only shape with no
    content of their own; they apply to the following inline siblings
    until the next marker or the end of the paragraph. Block-level
    standalone markers have no verified range semantics and remain
    skipped — a registered boundary, not silent loss.

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
                    label / tips / deletable / editable / single /
                    controlType.
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

    Seven of the nine §12.1 fields are editable (deletable / editable
    / tips / label / prefix / suffix / single). controlType is written
    at insertion (§12.4) from the library entry OR by the Control
    Config Dialog (application wizard / Editor.applyControlConfig,
    §12.7); formula (§12.12) is authored through that same Control
    Config Dialog only — it has no library default. The lightweight
    properties panel keeps the previous
    behavior — it reads/writes the COMPLETE definition and MUST
    preserve controlType unchanged through its own
    read-getControlDefinition / write-setControlDefinition round trip.
    controlType is NEVER inferred from dataType/enums (VR-15); the
    Control Config Dialog MAY offer a default dataType suggestion when
    controlType changes, but MUST persist controlType explicitly and
    MUST NOT silently overwrite an explicitly configured dataType.

    Semantic identity — the WRITABILITY OF element.code IS SCOPE-
    SPLIT, and this contract used to be silent about it, which left
    "the semantic identity is read-only" resting on a UI comment and
    one panel test. It is now written down:

        Control Config Dialog   → element.code.internal and
                                  element.code.dataElement ARE
                                  editable. The dialog already
                                  writes a whole-replacement
                                  ElementMeta through
                                  Editor.applyControlConfig, and
                                  elementEquals compares ALL fields
                                  (stable stringify) — so code is
                                  already a writable part of that
                                  payload; no new command is needed.
        lightweight properties  → KEEPS the read-only semantic-
        panel                     identity display. It MUST NOT grow
                                  a code editor.

        "Control Config Dialog" is BOTH of them, and this is not a
        detail: the input-family dialog (ControlInputDialog) and the
        choice-family dialog (ControlChoiceDialog) are reached from the
        same right-click "properties" and route by family
        (controlFamilyOf). Implementing one and not the other leaves
        radio/checkbox controls unaddressable by the binding API (§12.10)
        while text controls are addressable — the same clause honoured
        for half the controls. Both dialogs read the SAME two rules
        (trim both keys; the effective binding key is dataElement, falling
        back to internal) from controlConfigShared, so the pair cannot
        drift apart.

    Uniqueness is NOT enforced on either key, and this section does
    NOT add one. The only identity guard in the engine remains
    TemplateDefinition.single (§12.1), applied at insert/paste time.
    A duplicate identity is a legitimate document state — which is
    exactly why the binding API reports ambiguity instead of picking
    a winner (§12.10.2).

    NOTE for readers who expect the implicit read-only rule: it was
    never a contract rule, and it is not becoming one. The reason it
    LOOKS like one is that hand-inserted generic controls carry the
    library's synthetic placeholder codes on BOTH keys, so editing
    them was never useful before a binding API existed that keys on
    them.

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

    Editor.getElement(nodeId: string): ElementMeta | undefined

Home: the command lives in engine/command/commands/. The UI
(design-mode control properties panel) reads getControlDefinition,
edits the full definition, and writes setControlDefinition; it never
mutates the store directly.

getElement is the READ accessor for the SEMANTIC layer (ElementMeta,
§2.1), completing the by-nodeId read family alongside
getControlValue / getControlDefinition. It exists so the UI never has
to reach through Editor.getPool() and cast a raw node to read
.element — a public API may be public and still be a boundary
violation to read through. It is read-only and returns undefined for
a non-smarttext or unknown nodeId. render/Draw keeps its own private
elementOf callback: Draw holds an independent pool reference, and
routing it through Editor would create an Editor↔Draw coupling that
§19 exists to prevent.

------------------------------------------------------------
12.6 Runtime Control Value Contract
------------------------------------------------------------

This section is the P3 contract baseline for RUNTIME CONTROL VALUE:
what a SmartTextNode.value may be, how a candidate value is validated,
and the single mutation path that may write it. It extends §2.1
(definition vs value) and §12.1 (TemplateDefinition.editable /
controlType / enums). Rules marked TARGET bind the P3 implementation
and do not require a refactor before that phase lands (see STATUS,
top of file).

------------------------------------------------------------
12.6.1 Canonical value type
------------------------------------------------------------

    type ControlValue = string | number | string[]

    SmartTextNode.value?: ControlValue

The canonical empty / unfilled state is the ABSENCE of the field
(value === undefined), NOT '' and NOT []. Empty string and empty
array are transient INPUT representations normalized to undefined at
the value boundary (§12.6.3); they MUST NOT be persisted as the empty
state. (Widening SmartTextNode.value from `string` to `ControlValue` is
LANDED with the P3 command. The importer preserves string / finite
number / string[] runtime values and normalizes empty to undefined,
§12.2.)

Value-type mapping (canonical, MUST):

    S1 / S2 / S3            →  string            single / multi / long text
    N                       →  number            numeric
    D                       →  string "YYYY-MM-DD"
                              Canonical DATE STRING, not a Date object
                              and not ISO datetime. This is a canonical
                              rule adopted THIS phase — it is an
                              architecture judgment, not a pre-existing
                              business spec.
    DT                      →  string "YYYY-MM-DD HH:mm:ss"
                              Canonical DATETIME STRING (space-separated,
                              second precision). NOT a Date object and NOT
                              ISO ("T"/"Z" forbidden). DT is a SEPARATE
                              dataType from D — a datetime need is a new
                              dataType, never folded into D (the importer's
                              old DT→D merge is reversed: DT imports as DT,
                              values normalized to this shape).
    enums.multiple === true →  string[]          checkbox / multi-select
    enums.multiple !== true →  string            select / radio

------------------------------------------------------------
12.6.2 The fifteen rules
------------------------------------------------------------

These are the frozen P3 baseline (VR-1 … VR-15). VR-8 and VR-10 …
VR-13 are the write-boundary behaviors the P3 command and validator
must enforce.

VR-1.  SmartTextNode.value is the canonical runtime value. (MUST)
VR-2.  undefined is the canonical empty/unfilled state. (MUST)
VR-3.  Runtime value mutations MUST go through
       SetControlValueCommand. (LANDED — direct control writes AND
       find-replace both route through SetControlValueCommand, §12.6.3)
VR-4.  controlType defines widget interaction form only. (MUST)
VR-5.  dataType defines value semantics. (MUST)
VR-6.  enums defines candidate values and multi-value semantics. (MUST)
VR-7.  dictionary is an external dictionary reference and MUST NOT be
       implicitly expanded without a canonical DictionaryProvider.
       (LANDED — a synchronous DictionaryProvider/DictionaryStore resolves
       dictionary → candidates at the command boundary; a control whose
       candidates resolve is enum-backed (VR-9), unresolved stays free
       text. §12.6.4)
VR-8.  TemplateDefinition.editable === false OR ElementMeta.readonly
       === true MUST reject runtime value writes. (MUST — generalizes
       the §12.1 editable guard)
VR-9.  ElementEnums.editable controls whether enum controls may accept
       values outside the declared candidate set. (MUST)
VR-10. Number scale is a validation constraint; values exceeding the
       allowed precision MUST NOT be silently rounded. (MUST)
VR-11. String minLength/maxLength are validation constraints; values
       MUST NOT be silently truncated. (MUST)
VR-12. Checkbox values are string[] and MUST be normalized into the
       declaration order of enums.data. (MUST)
VR-13. Empty checkbox selection is represented by undefined. (MUST)
VR-14. SmartText remains an atomic document node; runtime interaction
       MUST NOT turn it into a TextNode or place a text caret inside
       it. (MUST)
VR-15. controlType MUST NOT be inferred from dataType or enums. (MUST)

Field participation (five layers — each field belongs to exactly one):

    A. P3 Value Type Validation  (inside validateControlValue, §12.6.3):
         dataType, enums, enums.multiple, enums.editable,
         scale, minLength, maxLength
       These decide "is this value SHAPE legal". (required is NOT here.)

    B. P3 Write Permission       (inside SetControlValueCommand):
         TemplateDefinition.editable, ElementMeta.readonly
       These decide "may this control be written at all" (VR-8). They
       are NOT value-legality and are NOT the same as layer A.

    C. Later Completeness / Business Validation  (NOT in
       SetControlValueCommand, NOT in validateControlValue):
         ElementMeta.required
       required does NOT decide value-type legality; it decides "is an
       EMPTY value acceptable at completion time". It belongs to a
       SEPARATE completeness validator (isControlValueComplete —
       LANDED in document/control, consumed by QCEngine
       smarttext_required_not_empty), run at save / submit / QC /
       pre-print — not at input time. Do NOT fold required into the
       per-write validator.

    D. Presentation / Lookup / Advanced Semantics (no value semantics):
         showType     — display format (render-only): 'N' → numeric
                        value right-aligned in the control box;
                        'AN'/absent → left-aligned (LANDED).
         minRows      — textarea height (layout): the control box and
                        its line reserve minRows rows of vertical space;
                        absent → single line (LANDED).
         dictionary   — external candidate-source REFERENCE (VR-7);
                        preserved verbatim in ElementFormat; resolved
                        candidates are injected at the command boundary
                        via DictionaryProvider (§12.6.4), runtime-only
                        (not serialized). searchable / exclusive
                        remain deferred.
         searchable   — dropdown lookup UX; deferred (needs async
                        dictionary fetch).
         exclusive    — imported / preserved / displayed; runtime
                        semantics unknown, do not guess.

    E. Read-only Derived Semantics (no value semantics, no writes):
         ElementEnumOption.numericValue — the numeric weight an enum
                        option carries (score / severity / weight),
                        e.g. a clinical rating scale. It is
                        DERIVED-DATA ONLY: a read-only evaluator
                        (ControlScorer, engine/evaluation/) sums the
                        numericValue of the currently selected options
                        into a document-level scale score. An option
                        without numericValue contributes nothing — no
                        implicit zero, no error.
                        numericValue MUST NOT enter layer A or layer B:
                        validateControlValue never sees it, and
                        SetControlValueCommand MUST NOT grow scoring
                        logic. It is also NOT a value — it never appears
                        in SmartTextNode.value (VR-1) and is never a
                        candidate in the sense of VR-6/VR-9.
                        A scale score is NOT QCResult.score: the latter
                        is a COMPLIANCE score (100 minus penalties,
                        qc/QCEngine). The two are different facts with
                        different owners and MUST NOT be merged or
                        stored in one field (§7.5).
                        The numericValue FIELD persists in
                        ElementFormat.enums.data like any other enum
                        option field (layer D keeps enums itself); only
                        the derived SCORE is runtime-only.

    SetControlValueCommand owns ONLY layers A and B. It answers "is
    this a legal runtime value, and may it be written?" — nothing else.
    It MUST NOT grow required / dictionary-resolution / business / QC
    checks (layer C), presentation concerns (layer D), or scoring /
    numericValue aggregation (layer E).

    Layer D is presentation / lookup / advanced-display, and
    TemplateDefinition.formula (§12.12) is NOT one of its members: a
    formula decides WHAT the value IS, not how it is shown. It
    therefore belongs to TemplateDefinition (§12.1) alongside
    controlType, never to ElementFormat. Do not let "it is only used
    for display" pull it into layer D — the computed value is a VALUE
    fact that happens not to be persisted, which is the same posture as
    a field code (§4), not the posture of showType/enums.

------------------------------------------------------------
12.6.3 validateControlValue (design — LANDED)
------------------------------------------------------------

The single value boundary. It validates AND normalizes a candidate
value against an ElementMeta and an injected definition flag. It is
PURE (no pool access, no host, no React), side-effect free, host
independent (§27–§29), and lives in the document domain
(engine/document/control/).

    type ControlValueValidationResult =
      | { ok: true;  value: ControlValue | undefined }  // undefined = clear
      | { ok: false; reason: ControlValueRejectReason }

    type ControlValueRejectReason =
      | 'write_locked'                // VR-8
      | 'type_mismatch'               // value shape ≠ dataType/enums
      | 'enum_value_not_allowed'      // VR-9 (not a declared candidate)
      | 'number_scale_exceeded'       // VR-10
      | 'string_length_out_of_range'  // VR-11
      | 'date_format_invalid'         // D not matching YYYY-MM-DD
      | 'datetime_format_invalid'     // DT not matching YYYY-MM-DD HH:mm:ss

    interface ControlValuePermissions {
      editable?: boolean   // TemplateDefinition.editable, injected by
                           // the command layer — write permission only
    }

    validateControlValue(
      nextValue: unknown,                    // arbitrary input; validated
                                             // and coerced to ControlValue
                                             // (undefined = clear)
      element: ElementMeta,                  // semantic definition
      permissions?: ControlValuePermissions, // layer B (write permission)
      dictionaryCandidates?: readonly ElementEnumOption[] | undefined,
                                             // layer D resolved candidates
                                             // (VR-7), injected by the
                                             // command layer; undefined =
                                             // dictionary not resolved
    ): ControlValueValidationResult

    permissions is NARROWED to the single field value validation
    consumes (editable) so the document domain never imports the
    template feature layer (§12 / §19). The command layer resolves
    ctx.templateDefinitions.get(nodeId)?.editable and passes it in.
    The parameter is named ControlValuePermissions — not
    TemplateDefinition — to signal that it carries WRITE PERMISSION,
    not the full design-time definition.

    Pipeline (in order):
    1. write lock (VR-8): permissions.editable === false OR
       element.readonly === true → reject 'write_locked'.
    2. normalize empty (VR-2/VR-13): undefined / '' / [] →
       { ok: true, value: undefined }. undefined is ALWAYS a legal
       write (clear / unfilled): it is accepted even when enums.data
       is empty and enums.editable !== true — an empty control must
       remain clearable. Enum membership (step 5) applies to NON-empty
       values only.
    3. derive expected type: enum control iff element.format.enums is
       PRESENT (empty or absent data[] is still an enum control with
       no candidates — empty-options/unavailable, not a fallback
       free-form field). enums.multiple === true → string[], else
       string. Otherwise dataType: N → number; S1/S2/S3/D → string.
    4. type check: mismatched shape → reject 'type_mismatch'. A
       non-finite number (NaN / ±Infinity) is a type mismatch.
    5. enum membership (VR-9): if enum control and enums.editable !==
       true, value(s) MUST ∈ enums.data[].value → else reject
       'enum_value_not_allowed'. Empty data + non-editable therefore
       rejects every non-empty value. data absent ≡ data: [].
    6. constraints: N + scale (VR-10); string minLength/maxLength
       (VR-11); D YYYY-MM-DD format; DT YYYY-MM-DD HH:mm:ss format
       (regex — calendar/clock validity is a separate later concern).
    7. normalize checkbox order (VR-12); return { ok, normalized }.

    SetControlValueCommand is LANDED and routes through
    validateControlValue. The legacy ad-hoc value writer inside
    ReplaceTextCommand is LANDED too: find-replace of a control's
    value routes through SetControlValueCommand (both forward and undo
    restore), so VR-3 holds — every SmartTextNode.value mutation goes
    through the single validated path.

------------------------------------------------------------
12.6.4 DictionaryProvider (design — LANDED)
------------------------------------------------------------

    dictionary is an EXTERNAL candidate-source reference (VR-7). The
    engine does NOT fetch it; candidates are pre-resolved by the
    platform/UI boundary (async, like FontHost.loadFont) and injected
    as a synchronous provider. The command layer resolves
    element.format.dictionary → candidates and passes them to
    validateControlValue as the 4th arg (dictionaryCandidates).

        interface DictionaryProvider {
          resolve(dictionaryId: string): readonly ElementEnumOption[] | undefined
        }
        class DictionaryStore implements DictionaryProvider { /* Map */ }

    resolve → undefined means "not loaded" → the control falls back to
    free text (no VR-9). Resolved candidates make it enum-backed:
    single-select string with strict membership. Inline enums take
    precedence over dictionary when both are present. Candidates are
    runtime-only and NOT serialized; the reference persists verbatim.

    "PRESENT" MEANS THE KEY EXISTS, NOT THAT IT HAS CONTENT. Both the
    validator (document/control/ControlValue.ts) and the snapshot
    projection (Editor.getControlSnapshot) select the candidate source
    with `format.enums !== undefined ? format.enums.data :
    dictionaryCandidates`. A present-but-empty enums object (e.g.
    `{ data: [] }` or `{ data: undefined }`) therefore SUPPRESSES the
    dictionary — the binding silently never resolves.

    Consequence for producers: a writer that intends "candidates come
    from the dictionary" MUST NOT emit the enums key at all. The
    control-configuration dialogs (§12.7) follow this: a select with no
    inline options but a bound dictionary omits enums entirely. Emitting
    an empty enums object alongside a dictionary reference is a defect,
    not a no-op.

    Consequence for scope: dictionary binding is only meaningful where a
    control can have NO inline enums — i.e. the select (下拉) form.
    radio/checkbox are defined by their inline candidate set, so a
    dictionary bound to them is permanently inert. The design-time UI
    MUST NOT offer the binding there.

    INJECTION SEAM. The provider enters the Editor through ONE
    explicit setter, called by the platform/UI boundary after the
    Editor is constructed — the same shape as the async-pre-resolve →
    synchronous-inject model above:

        Editor.setDictionaries(provider: DictionaryProvider | null): void

    Candidates are runtime-only state with an owner OUTSIDE the
    document (§7.5): loading a different document MUST NOT clear them.
    Therefore Editor.setDocument's stores argument replaces the
    provider ONLY when the caller passes one explicitly:

        stores?.dictionaries !== undefined → replace
        stores?.dictionaries === undefined → KEEP the current provider

    (The previous unconditional `?? null` was the drift reversed here:
    it silently discarded an injected provider on every document load,
    because the React boundary calls setDocument(doc) without stores.)

    A platform implementation MUST live in platform/ (§27 dependency
    direction: platform → engine). The engine never ships dictionary
    DATA; a static sample catalog in platform/data is a legitimate
    boundary implementation, exactly like platform/data/controlLibrary.

    UI consumption note: template designers must be able to SET
    ElementFormat.dictionary, not just have the engine resolve it. The
    reference is an ElementFormat field (§12.6.2 layer D), so it is
    written through the control-configuration path (§12.7,
    UpdateControlElementCommand) — NOT through TemplateDefinition
    (§12.1's nine design-time fields do not include it).

------------------------------------------------------------
12.4 Watermark ownership boundary
------------------------------------------------------------

Watermark is DOCUMENT CONTENT: it persists on DocumentTree.pageSetup
.watermark and must survive round-trip (serialize + load). Its type
has exactly ONE canonical home, and that home is the document domain.

    WatermarkConfig is defined ONCE, in
    document/core/DocumentModel.ts, next to PageSetup (which owns the
    persisted watermark? field). The image-watermark fields — imageUrl
    and imageScale — are document content too (an image watermark must
    persist its image reference), so they live on THIS single type, not
    on a render-local copy.

    The render layer (render/LayeredRenderer, render/Draw) and the
    public API (engine/index.ts) MUST import WatermarkConfig from the
    document domain. render depends on document (§19); the reverse
    (document importing a render type) is forbidden.

    The render layer MUST NOT define its own WatermarkConfig. A second,
    structurally-divergent WatermarkConfig in render/LayeredRenderer.ts
    is the drift being reversed here (it was missing imageUrl/imageScale,
    so an image watermark could render but not persist).

    Editor.ts reads and writes doc.pageSetup.watermark with the document
    WatermarkConfig type directly — no cast to a render-domain type.
    engine/index.ts re-exports WatermarkConfig from
    ./document/core/DocumentModel, never from ./render/LayeredRenderer.

    Consumption: Editor.setWatermark(config) persists via
    SetPageSetupCommand (undoable; canonical owner = DocumentTree
    .pageSetup, §7.3) — it writes doc.pageSetup.watermark through the
    command system (Command mutation rule), THEN applies the config to
    the renderer (Draw.setWatermark → LayeredRenderer.prepareWatermark)
    so the same synchronous document:changed render shows the new
    watermark. serializeDocument spreads ...doc, so pageSetup.watermark
    (text AND image fields) is written to JSON; DocumentLoader's
    buildModel preserves pageSetup and Editor auto-applies it on load
    (R70). An image watermark therefore round-trips: imageUrl/imageScale
    survive serialize → load.

    setWatermark takes `WatermarkConfig | null`, and null REMOVES the
    watermark (writes `watermark: undefined`; SetPageSetupCommand merges
    with Object.assign, so the key is cleared and JSON round-trip drops
    it). Removal is not optional: the watermark is DOCUMENT CONTENT, so a
    write-only affordance would leave the user able to set but never
    clear it — a half-connected feature. Editor.getWatermark() is the
    matching reader, existing so the settings dialog can seed itself from
    the CURRENT value instead of always re-offering the defaults (without
    it, editing an existing watermark silently resets every field the
    user did not touch).

------------------------------------------------------------
12.7 Control Config Editing Boundary
------------------------------------------------------------

Control property editing is a UI interaction initiated by an
explicit property action (interactive modes — design / edit / form —
right-click a control → context menu → "properties"). Property
presentation and the context menu entry belong to the UI layer; the
Engine contributes ONLY the RULE 10 read-only context snapshot (a
smartText hit carries controlId in design/edit/form; readonly/print
right-click on a control resolves to ordinary text) — it does not
know the menu, the "properties" item, or the config dialog.

    Control configuration is represented by the EXISTING ElementMeta
    + TemplateDefinition model. UI config dialogs MUST NOT introduce
    a second persistent source of truth for control semantics; a
    dialog draft is transient UI editing state that is converted back
    to ElementMeta / TemplateDefinition on Apply.

    Opening or editing a config dialog MUST NOT mutate the document.
    Applying MUST go through the Editor facade; document mutations
    MUST be Commands, one layer per command:
        UpdateControlElementCommand    → SmartTextNode.element
        UpdateControlDefinitionCommand → TemplateDefinition
        SetControlValueCommand         → SmartTextNode.value
    No single command mixes two layers ("one mutable fact = one
    owner" applies to control configuration too).

    A single property Apply that changes element + definition +
    (optional) value MUST collapse to ONE undo unit via
    beginMacro/endMacro (RULE 11).

    Value semantics: when an Apply changes value semantics, any
    existing runtime value that fails re-validation under the NEW
    element MUST be cleared to undefined — unless the re-validation
    fails for write_locked (readonly / editable:false), in which case
    the value is preserved. Clearing MUST go through
    SetControlValueCommand (VR-3).

------------------------------------------------------------
12.8 Inline control box width — no horizontal overflow
------------------------------------------------------------

A runtime control value is USER DATA and may be arbitrarily long
(a hundred-digit number, a pasted ID string, an unbroken token with
no space). Layout MUST NOT let such a value push the control box
past the text area.

Rule: the control's BOX WIDTH — the value the line breaker advances
by (LineElement.control.width), which already includes the
label/prefix/suffix affix reservation (§12.1) — MUST NOT exceed the
available width of the text area the control sits in:

    body paragraph           → content width LESS the paragraph's
                               block indent and first-line indent (the
                               line start is shifted right by exactly
                               that much, so the usable width shrinks
                               by it)
    table cell paragraph     → the cell's text width
    header / footer band     → content width LESS first-line indent

When the natural (single-line) box width would exceed it, the
control WRAPS instead of overflowing, using the SAME mechanism the
multi-line textarea (controlType 'textarea', recipe frame 'box')
already uses:

    - the displayed text is broken into physical lines that fit the
      available width (wrapControlText);
    - the box width is LOCKED to the available width;
    - the row count is carried as `control.minRows`, so the line's
      descent extends (rows × size) and the wrapped rows cannot
      collide with the following line;
    - the physical lines are carried as `control.lines` → SLIFItem
      .controlLines, and the renderer draws one row per line;
    - the width the content may occupy is carried as `control.wrapWidth`
      → SLIFItem.wrapWidth, so the overlay edit surface and the caret
      geometry can reach the layout's decision without re-deriving it.

A locked control is a BLOCK-like item: it carries
`control.ownLine === true` and the line breaker MUST start it on a
fresh line. The locked width is the width available AT A LINE START,
so letting it share a line with preceding content would push its
right edge past the text area by exactly the preceding width — the
overflow this section exists to forbid.

This follows the engine's existing text model: an over-long TEXT run
is force-broken per character (wordBreak 'break-all'), so wrapping a
control's value is consistent, not a new behaviour class.

MUST:

- The natural→box-width decision and the wrapping MUST have exactly
  ONE implementation per recipe, shared by ALL layout paths (body,
  table cell, header/footer). Duplicated per-path copies of the
  control-sizing branch are what produced the drift this section
  fixes: the table-cell and band paths had no textarea branch at all.
  Canonical location: engine/layout/control/ControlLayoutHint.ts
  (`smarttextLayoutHint`), consumed by LayoutEngine.
- Render MUST NOT re-derive the wrap; it consumes SLIFItem
  .controlLines (a layout product, §7.4) and draws the rows. Its
  bracket frame bounds the wrapped block ('[' on the first row, ']'
  after the last row), keeping the single-line case byte-identical.
- The render-side box geometry (computeControlBox, §12.3) already
  scales vertically with ascent/descent and therefore needs no
  change: a multi-row control is a taller box, not a wider one.
- The paragraph CARET adjacent to a wrapped control MUST be a single
  line high and land on the row that holds the value's end, not span
  the whole box: caret height = one physical row, y = that row's top,
  x = past the closing bracket of the last drawn row (for "after the
  control") or the box's left edge (for "before"), reusing
  computeFieldRegion's text-area geometry. Height taken from the
  whole box (ascent+descent) makes the caret as tall as the entire
  control and parks it on the box's right edge.
- HIT geometry MUST follow what is drawn, not the reserved box. For a
  wrapped brackets control the reserved box is as wide as the text
  area, but each row only draws its own text (+ brackets) — and the
  last row is normally SHORT. The blank area past a row's drawn
  content belongs to the text cursor ("after the control"), not to the
  control: hit-testing the whole rectangle makes it impossible to
  click past the closing ']'. Rows are hit individually, with the row
  height = the renderer's row pitch (font size). Bottom/right/top
  solid shapes (textarea four-sided boxes, the affordance pinned to
  the box's right edge, right-aligned blocks) keep whole-box hit
  geometry.
- The overlay edit surface (§12.6 seamless inline editing) MUST grow
  with the draft instead of hiding it:
    - WIDTH hugs the draft and is capped at the width the LAYOUT
      grants the control's content (SLIFItem.wrapWidth, a layout
      product, §7.4); past that the content wraps, using the SAME
      wrap rule as layout (per-character 'break-all' — reuse
      wrapControlText; an unbroken run of digits does not wrap under
      the browser's default rules);
    - HEIGHT is the wrapped row count × font size, so what is typed
      stays visible and no scrollbar appears;
    - the element type MUST NOT change as the draft grows (an
      input↔textarea swap remounts the node and drops focus).
  The cap MUST be the layout's granted width, NOT the committed box's
  own width: an empty or short value has a box only as wide as its
  placeholder, so capping there folds a long draft into a few-
  character column. Conversely, letting the field grow to the draft's
  measured width with no cap is what pushed the native input past the
  page in the first place.
- A control whose content FITS is untouched: same width, same line
  placement, no `ownLine`. The clamp is a fallback, not a new
  default.

Known limitations (recorded, NOT silently ignored):

  - The inline options group (radio/checkbox candidates) sizes to the
    TEMPLATE's candidate list rather than to runtime data, and still
    lays its candidates out in a single row. A candidate list wider
    than the text area therefore still overflows; fixing it requires a
    multi-row candidate layout shared by render + hit-test.
  - A `field` node (page number / total pages / date / document title)
    is atomic in the same way and is sized from its representative
    display value (§12, representativeFieldText); it is NOT wrapped
    here. Those representative values are bounded by construction
    (≤ 4-digit page numbers, fixed date samples), so only a very long
    document title can make one over-wide.
  - Separately, the line WIDTH BUDGET for plain text does not subtract
    the paragraph indent (breakLines is given the full content width
    while the line is drawn from marginLeft + indent), so a text line
    in an indented paragraph can extend into the right margin by the
    indent. That is a pre-existing line-model concern, not a
    control-box concern, and it is NOT addressed here.

============================================================
12.9 Table dynamic rows boundary
============================================================

A table may be declared GROWABLE at fill time: the template designer
marks it, and the person filling the form appends rows on demand
(PRD F8.2 表格动态行扩展).

    Table.dynamicRows?: boolean     // document/core/DocumentModel.ts

    - OPTIONAL, and absent means a fixed table. Every pre-4.6 document
      therefore keeps exactly its old behavior.
    - It is TABLE STATE, so its ONLY canonical home is the Table node in
      DocumentModel (§7.3). It MUST NOT live in TemplateDefinitionStore
      (§12.1 — that store is keyed by nodeId and serves SmartTextNode
      CONTROLS; a table is not a control, so putting it there creates a
      second source of truth, §12.7), and it MUST NOT live in
      PresentationStyleStore (§2.2 — that is presentation, this is
      behavior).

The gate is consumed by the COMMAND LAYER, exactly like `deletable`
(§12.1): the append-row command REJECTS a table whose dynamicRows is
not true and returns without producing an undo entry. Hiding the UI
affordance is a convenience, not the enforcement.

UI SURFACES. The declaration is made at design time (the table-cell
context menu toggles it) and is surfaced in three deliberately
different ways:

    edit / form           → an INTERACTIVE "+ 添加行" entry at the
                            table's foot.
    design                → a READ-ONLY "可增长" marker at the same
                            place (pointer-events: none). NOT an
                            affordance, and it MUST NOT be made
                            clickable — design mode must not silently
                            mutate the document.
    readonly / clean / print → nothing.

The design-time marker exists because otherwise the toggle has NO
feedback in the very mode that sets it: the interactive entry is
suppressed outside edit/form, so a designer checking the box would see
nothing change and would have to switch modes to confirm it took. The
marker reports the FACT ("this table is declared growable"); switching
it stays on the context menu.

APPEND SEMANTICS. Appending clones the LAST row's structure, because
the F8.2 use case (a medication list, an examination list) is "the same
fields, one more instance":

  - each source cell yields one new cell; COLSPAN is preserved so the
    grid stays aligned, ROWSPAN resets to 1 (a new last row cannot span
    rows below it).
  - text / field nodes are cloned with their style.
  - a smarttext CONTROL is cloned as a NEW node carrying the same
    ElementMeta and TemplateDefinition, but with `value` UNSET — a
    fresh row is empty by construction (§12.6.1: undefined is the
    canonical empty state). Copying the source value would silently
    duplicate clinical data.
  - a control whose definition has `single: true` is NOT cloned: that
    flag means "at most one per document" (§12.1), so a second instance
    is precisely what it forbids. The new row simply omits it.

UNDO MUST COVER BOTH LAYERS. The append writes to the node pool AND to
TemplateDefinitionStore (§12.1), and the latter is OUTSIDE the pool.
A snapshot-based table command therefore CANNOT be reused here:
TableStructureCommand clones the table SUBTREE, so its restore would
rebuild the nodes and leave the cloned definitions behind as orphans.
The append is a dedicated command with explicit forward/invert — the
same shape as InsertControlCommand (§12.4), whose invert removes the
node AND its store entry.

FORMAT VERSION. A new persisted optional field is a format change:
4.5.0 → 4.6.0, an explicit NO-OP migration (no rewrite, no backfill),
the same convention as 4.3.0 → 4.4.0 and 4.4.0 → 4.5.0 (§14).
CURRENT_SLIF_VERSION is NOT bumped (§26.13/§26.14).

Known limitations (recorded, NOT silently ignored):

  - a nested TABLE inside a cell is LEGAL (§31.13) but is NOT cloned into
    the new row, and neither are inline nodes other than
    text/smarttext/field (e.g. images). The wording matters: the nested
    table is "legal, not cloned", not "unsupported" — it round-trips,
    lays out and renders.
  - the appended row is always the LAST row. Inserting a plain empty row
    in the middle remains the toolbar's existing insertRow, which does
    not clone controls.

------------------------------------------------------------
12.10 Bulk data binding
------------------------------------------------------------

An external system (HIS / EMR platform) holds a PATIENT DATA SET and
must put it into a document, then read back what the document holds.
Today the engine answers this only per-node
(Editor.setControlValue / getControlValue), and a node id is a RUNTIME
identity the caller cannot know. This section defines the
document-level pair.

    Editor.getBoundValues(opts?): BoundValues
    Editor.setBoundValues(obj, opts?): BoundValuesWriteResult

12.10.1 The binding key — meaning, not node id
------------------------------------------------------------

    opts.keyOf?: (element: ElementMeta | undefined) => string | undefined

DEFAULT (when keyOf is absent): element.code.dataElement, falling back
to element.code.internal — the SAME order and fallback as the existing
elementIdentity helper (§12.1 / §12.4). The engine MUST NOT invent a
third identity rule.

    WHY dataElement IS THE DEFAULT, despite it being neither unique
    nor authorable today:

    - It is the SEMANTIC identity ("what this field IS"); internal is
      closer to a local alias.
    - The importer carries it in from real templates
      (TemplateImporter maps el.code.dataElement verbatim), so a
      document that came from a hospital template HAS real values.
      A hand-inserted generic control has only the library's synthetic
      placeholder on BOTH keys (controlLibrary documents DE99.99.00X
      as synthetic), i.e. it has no meaningful identity to bind to.
    - The engine already resolves by it (findByDE, exported) and
      already emits it as the primary coded value in CDA
      (code.dataElement → code/codeSystem, internal → codeSystemName),
      so a second rule would be a second truth.

    CONSEQUENCE THAT MUST NOT BE DISCOVERED LATE: two hand-inserted
    instances of the same generic control share one synthetic code.
    Duplicate keys are therefore the COMMON case for scaffold
    documents, not a rare edge. §12.10.2 is built for that.

12.10.2 Duplicates are reported, never resolved silently
------------------------------------------------------------

    THE ENGINE MUST NOT PICK A WINNER.

Silently filling one of two same-key controls produces a document that
looks filled and is half empty — a clinical-safety failure, not a
convenience question. Therefore:

    GET  → every item is returned; items sharing a key are all present,
           and BoundValues.duplicates names the key with its nodeIds.
           The read direction does not hide the ambiguity either: a
           caller that sees no duplicate signal would assume a write
           is safe.
    SET  → a key matching MORE THAN ONE node is written to NONE of them
           and is reported in `ambiguous` with its candidateNodeIds.
           This holds even when the values would validate.

           THE EMPTY KEY IS NOT ADDRESSABLE. A control whose
           dataElement AND internal are both empty has NO canonical
           identity, and the empty string means exactly that — it is not
           an address shared by "all anonymous controls". A write keyed on
           '' is therefore reported in `unmatched` and writes nothing.
           The reason is behavioral stability: allowing it would make the
           same call silently hit the single anonymous control today and
           flip to `ambiguous` the moment a second one appears. The READ
           direction still returns those items (key: '') — "this control
           has no identity" is a fact the caller needs.

12.10.3 Write semantics
------------------------------------------------------------

    - EVERY write goes through validateControlValue, from the same
      source of permissions and dictionary candidates as §12.6.3.
      The batch API is a new CALLER of the single value boundary, never
      a second boundary.
    - NO value coercion. VR-9 (enum membership), VR-10 (scale, no
      silent rounding) and VR-11 (length, no silent truncation) apply
      unchanged. An external code that does not match the candidate set
      is REJECTED with its reason, not translated — the engine MUST NOT
      hardcode any medical mapping (§12).
    - PARTIAL SUCCESS IS A LEGAL RESULT and MUST be legible:
        { applied, rejected: [{key, reason}], ambiguous: [{key,
        candidateNodeIds}], unmatched: [key] }
      Reported, not silently dropped — the same posture as
      Editor.replaceAll's {replaced, rejected} (ReplaceTextCommand,
      §12.6.3).
    - ONE UNDO UNIT for the whole batch. Precedent: ReplaceTextCommand
      applies N edits inside one undo entry by invoking
      SetControlValueCommand.forward per node instead of stacking each
      command. The batch follows that shape.
    - AN EMPTY BATCH PUSHES NOTHING. If no key matches, no undo entry
      is created (same guard shape as §12.9's append).
    - VR-3 IS UNCHANGED: SetControlValueCommand.forward remains the
      ONLY place SmartTextNode.value is written.

12.10.4 Where the projection lives — and why it is NOT shared
------------------------------------------------------------

The reading order comes from the §31 walkers, always:

    body   → bodyParagraphSpine(doc, pool)
    header → hfParagraphsForExport(doc, 'header')
    footer → hfParagraphsForExport(doc, 'footer')

    The projection's home is document/control/ControlProjection.ts.

It MUST NOT import lib/export/fields.ts's collectFields, and MUST NOT
be refactored into a module both share. Reasons, in order:

    1. engine/ → lib/ is forbidden (§19). lib/export/fields.ts imports
       the engine barrel, so the reverse edge is a genuine cycle, and
       §32 packages "." and "./export" as separate build entries.
    2. collectFields has exactly ONE consumer today, the application's
       three export call sites. There is no engine-side consumer, so
       there is nothing to share: extracting a common core would move a
       mature 400+ line module used by three export formats (OFD / CDA
       / elements) to serve two new APIs that need a fraction of it.

    The duplication this accepts is the ~16-line glue loop
    (paragraph ids → smarttext child ids → a record), NOT the traversal
    rules, which both sides already take from the same engine
    primitives. That is a recorded, bounded duplication — it MUST NOT
    be "fixed" by importing upward.

    VALUE → DISPLAY TEXT IS THE OPPOSITE CASE, and it went the other
    way: that resolution (resolveDisplay) and the candidate set a
    control offers (enumOptionsFor) were MOVED DOWN into
    document/control/ControlDisplay.ts, and lib/export/fields.ts now
    re-exports them instead of owning them. The §11 test ("the same
    non-trivial logic implemented a second time") is met by a different
    count than the glue loop: the binding projection needs the exact
    same display and the exact same candidate set as the export
    projection, and a caller comparing the two would be comparing two
    implementations. §19's second option ("move the shared core DOWN
    into engine/ first") is what applies here — the direction is
    lib/ → engine/, which is allowed.

    The line between the two cases is TRAVERSAL vs RESOLUTION. The
    traversal is duplicated because each side's walk is small and each
    is already standing on a shared engine primitive; the resolution is
    moved down because it is a rule with real semantics (inline enums
    win over dictionary candidates; a present-but-empty enums object
    suppresses the dictionary) and a second copy would drift. Neither
    is a licence to move collectFields down.

    KNOWN DISPLAY DIVERGENCE, already true before this section and
    deliberately preserved: the export projection resolves a dictionary
    candidate's display NAME, while the render path reads only inline
    format.enums. Bound items carry `displaySource` so a caller can tell
    which one it got. Reconciling the two is a separate change and MUST
    NOT be smuggled into this feature.

------------------------------------------------------------
12.11 Completeness gate (required fields at completion time)
------------------------------------------------------------

    Editor.validateRequired(): { ok: boolean; missing: MissingField[] }

isControlValueComplete (§12.6.2 layer C) already decides "is an EMPTY
value acceptable at completion time". This section gives it a
document-level entry point. It is a READ-ONLY query.

    - It MUST NOT reuse QCResult, and MUST NOT be expressed as a score.
      QCResult.score/grade is a COMPLIANCE score (§7.5 / §12.6.2 layer
      E); completeness is a different fact with a different owner. They
      MUST NOT be merged or share a field.
    - The ENGINE DECIDES; THE APPLICATION GATES. The engine owns no
      save. It answers "which fields are missing" and stops there; the
      policy of blocking, warning, or ignoring belongs to the host.
    - MissingField carries nodeId + paragraphPath so the host can
      NAVIGATE to the offending control — the same locator shape as
      QCIssueLocation, which the QC panel's click-to-locate depends on.
    - It MUST be runnable without running QC: a host that wants only the
      completeness answer MUST NOT be forced to compute compliance.
    - COVERAGE MUST BE THE §12.10 PROJECTION'S, not a second walk. The
      gate's answer and the binding API's answer must range over the
      same controls, or a host gets "readable but not checkable" (or the
      reverse). It lives in document/control/CompletenessGate.ts and is a
      CONSUMER of the projection — the reading order is not re-derived.
      The judgment itself stays isControlValueComplete's (§12.6.2 layer
      C); this section adds no second definition of "empty".

    The host policy that this batch installs (a product decision, not a
    contract rule): on !ok, LIST the missing fields with click-to-jump
    and STILL ALLOW the save. Hard-blocking a save would lose a
    clinician's in-progress work, which is a worse failure than storing
    an incomplete document that the dialog has just made visible.

------------------------------------------------------------
12.12 Computed values (formulas)
------------------------------------------------------------

A template author must be able to say "this field is the sum of those
two", "this field's value is the patient's age from the birth date",
and "when sex is male, hide the obstetric history". None of that
exists today.

    THE ANTI-PATTERN THIS SECTION EXISTS TO FORBID: the reference
    implementation lets authors write raw JavaScript and evaluates it.
    That is `eval` with a template file as the attack surface. This
    engine MUST evaluate a WHITELISTED expression grammar instead. The
    prohibition is absolute:

        evaluation/ MUST NOT contain `eval`, `new Function`,
        `globalThis`, `window`, `document`, or any host global
        reachable from a formula.

    This is enforced by a static source gate (the same shape as
    I18nGate / DocumentWalkGate), not by review.

12.12.1 Where a formula lives — and where its RESULT does not
------------------------------------------------------------

    TemplateDefinition.formula?: string      (§12.1, the ninth field)

NOT ElementFormat (§12.6.2 layer D), for the reason written there: a
formula carries value semantics. NOT a new node type: that would drag
in NodeType, ContainerChildTypes, three layout paths, the OFD switch
and the hit-test atom table.

    THE RESULT IS NEVER PERSISTED. It MUST NOT be written to
    SmartTextNode.value, and it MUST NOT be materialised into the
    document on any path.

Three reasons, and they are not stylistic:

    1. VR-1 makes SmartTextNode.value the canonical runtime value. If
       the engine wrote a computed result there, one field would have
       two sources of truth and no way to tell them apart afterwards.
    2. Every recomputation would be a document change, so the undo
       stack would fill with steps the user cannot see the effect of —
       Ctrl+Z would appear to do nothing.
    3. CLINICAL SAFETY: a computed value must never satisfy the §12.11
       completeness gate. A required field whose value the doctor never
       looked at, passing the gate because the engine computed
       something, is the same class of harm as a field silently left
       half-filled (§12.10.2).

The existing precedent is the field code (§4): a field's text is
resolved on every read and never stored. Computed values are the same
shape, and §4's "exactly one implementation" rule applies to them too —
layout measurement, rendering and export MUST resolve through the SAME
pure function.

12.12.2 The evaluator
------------------------------------------------------------

The evaluator lives in engine/evaluation/ (NOT in Editor.ts — §11), is
a PURE function of (expression, context), and touches no host global.

    - Lexer + Pratt parser + tree-walk evaluation over a whitelisted
      subset: references, number/string literals, `+ - * / %`,
      `== != < <= > >=`, `&& || !`, parentheses, ternary, a builtin
      function table, and SHOW/HIDE for visibility.
    - TIME AND DATE FACTS ARE INJECTED, never read. The evaluator's
      context is the same shape already proven by
      FieldFormatter.FieldTextContext (§4): a pure document-domain
      function plus a caller-filled context object. `new Date()` MUST
      NOT appear anywhere under evaluation/.
    - Builtins are a CLOSED table (GETAGE, DIFF_DATE_DAYS,
      DIFF_DATE_HOURS, SUM, ROUND, …). Adding one is a contract-visible
      act, not a drive-by.
    - Integrators may register their own pure functions
      (Editor.registerCalcFunction(name, fn)). Their trust level is
      the PLUGIN's, i.e. the integrator's own code — never end-user
      data. The documentation MUST state plainly that the evaluator
      reaches no host global and can call only registered pure
      functions.

12.12.3 References resolve by BINDING KEY, and ambiguity is reported
------------------------------------------------------------

A reference `[key]` names a control by its §12.10.1 binding key
(dataElement, falling back to internal) — the same key the bulk
binding API uses, resolved through the SAME projection.

    A reference matching MORE THAN ONE control is AMBIGUOUS, and the
    evaluator MUST NOT PICK A WINNER. The whole formula fails to
    evaluate and reports the candidate nodeIds.

This is §12.10.2's rule, applied to a second consumer, and it must say
so rather than being re-derived: duplicate keys are the COMMON case for
scaffold documents (hand-inserted generic controls carry one synthetic
code), not a rare edge. "Take the first in reading order" is exactly
the silent-winner behaviour §12.10.2 forbids.

A reference matching NO control is a separate, also non-fatal error
(unresolved reference), reported with the key.

12.12.4 Types and coercion — READ path only
------------------------------------------------------------

ControlValue is `string | number | string[]`, and arithmetic needs
numbers. The rule:

    - An operand that is a string which parses COMPLETELY as a finite
      number (`Number(s)` finite) participates as that number.
    - Any other string in an arithmetic/comparison position is an
      ERROR. It MUST NOT silently become NaN, and NaN MUST NOT be
      treated as falsy so the expression "carries on".
    - `string[]` in an arithmetic position is an ERROR, except for
      builtins that explicitly accept multiple values (SUM and
      friends).

    THIS IS NOT A REPEAL OF §12.10.3, and the two MUST NOT be cited as
    precedent for each other. §12.10.3 forbids coercion when writing an
    EXTERNAL value INTO the document; this section allows it when
    reading a DOCUMENT value OUT to compute with it. Same direction of
    caution, opposite direction of data flow: never a second copy of
    one another's reasoning.

12.12.5 Visibility (SHOW / HIDE)
------------------------------------------------------------

    SHOW(#id) / HIDE(#id) affect whether a control is laid out at all.

The seam already exists and MUST be reused rather than replaced:
LayoutEngine.setControlInfoOf, whose injected callback Draw already
fills from templateDefinitions. It gains a `visible?: boolean`.

    LayoutEngine MUST NOT know what a formula IS. It asks "is this
    control visible"; it never asks "what does this control compute".

That is the smallest coupling available and it leaves §12.8 unchanged.

    KNOWN EDGE, recorded rather than discovered: a hidden control
    produces no SLIFItem, so it cannot be hit and the caret cannot
    enter it. Character-offset arithmetic that CROSSES a hidden
    control therefore needs care — paragraphTextLength counts a text
    node by its text length and any other inline atom as 1. This is
    the likeliest silent misalignment in the feature; it MUST have a
    test.

12.12.6 Dependencies, cycles, and the computed-value SET
------------------------------------------------------------

    The engine maintains ONE computed-value set per document state:
    control → its resolved display and its visibility (or a reported
    error, §12.12.3).

    - A DEPENDENCY INDEX records which binding keys each formula
      references. It is built when a definition is set, and consulted
      when a value write completes.
    - THE SET IS MEMOISED, and recomputed when — and only when — a
      dependency (or a definition, or the document) changes.
      Recomputing the whole document per keystroke is not acceptable.
    - CYCLES MUST BE DETECTED WHEN THE GRAPH IS BUILT and reported as
      an error. Detection MUST NOT be a runtime depth limit or a
      stack-overflow catch: `= [A] + ([A] * 2)` must be rejected as a
      cycle, not survive until it happens to terminate.
    - The clock is read when the set is (re)computed — §12.12.7.

12.12.7 The time basis is read once per recomputation
------------------------------------------------------------

    `now` is captured when the computed-value set is (re)computed, and
    every evaluation in that recomputation shares it.

    WHY NOT ONCE PER PASS — the obvious answer, and wrong here: layout
    and rendering are SEPARATE passes that can be far apart in time.
    render() does NOT re-lay-out; it draws from the SLIF a previous
    layout produced, and it runs on every scroll and resize. So a
    per-pass snapshot would let a control box be MEASURED with age 40
    during layout and DRAWN with age 41 during a render — precisely the
    silent geometry divergence §12.8 exists to prevent — and it would
    let the screen and the printout disagree. Memoising the set is what
    makes layout, rendering and export read the SAME value by
    construction, and it is also what makes §4's round-trip requirement
    (screen and print agree) achievable at all.

    CONSEQUENCE, STATED PLAINLY: a time-dependent value does NOT tick
    while the document sits idle. An age derived from a birth date
    stays put until something invalidates it — a dependency change, or
    a document load. That is the INTENDED behaviour for a medical
    record: a value the doctor has read must not silently change
    between reading it and signing it. Refreshing on a timer, or on
    open, is a HOST concern and is NOT part of this section.

    `new Date()` MUST NOT appear anywhere under evaluation/. The clock
    is read by whatever owns the computed-value set, outside it.

    The EXISTING field-code implementation does the opposite —
    Draw.resolveFieldText fabricates `now: new Date()` inside the
    per-item render loop. That divergence is REGISTERED, NOT FIXED
    here; this section constrains formulas only.

12.12.8 Where a computed value enters the pipeline
------------------------------------------------------------

    The value MUST be resolved BEFORE layout, and passed in as the
    `display` argument of smarttextLayoutHint — the same argument
    LayoutEngine already fills today. Layout must never re-derive a
    wrap (§12.8) and must never re-evaluate a formula.

On the render side it follows the field-code pattern exactly: spread-
clone the SLIF item and substitute the resolved text at dispatch. The
computed value MUST NOT be written into SLIF as a value; SLIF carries
layout products (§7.4).

Page-dependent formulas reuse the existing two-pass fullLayout; they
need no new mechanism.

12.12.9 The authoring surface is part of this feature
------------------------------------------------------------

    The consumer of a formula is the TEMPLATE AUTHOR, who is this
    application's user — not an external integrator. Shipping the
    evaluator without an authoring surface would ship a dead seam.

    - BOTH Control Config Dialogs MUST expose formula authoring (the
      input-family dialog and the choice-family dialog). Exposing it in
      one only would repeat the §12.5 mistake, where one contract
      clause was honoured for half the controls. They MUST share one
      implementation.
    - The surface MUST offer the set of referenceable keys, derived
      from Editor.getBoundValues() — the SAME projection, never a
      second key listing. Two listings drift, and they drift into the
      worst shape available: the UI says a key is referenceable while
      the evaluator reports it ambiguous.
    - Syntax and evaluation errors are REPORTED TO THE AUTHOR AND DO
      NOT BLOCK apply, the same posture as the duplicate-key hint of
      §12.10.2. An author can be mid-edit; blocking would make "save a
      draft" impossible. Errors MUST be CLASSIFIED (unresolved
      reference / ambiguous reference / syntax / unknown function /
      cycle), not collapsed into "the formula is invalid".
    - The engine exposes a read entry point for that surface (validate
      / preview a candidate formula against the current document) —
      the authoring UI MUST NOT reach into evaluation/ internals.

12.12.10 Format version
------------------------------------------------------------

    4.7.0 → 4.8.0, an explicit NO-OP step (breaking: false, upgrade
    returns the document unchanged). A pre-4.8 document has no
    formula, so every control reads exactly as before.

Why a bump is required even though templateDefinitions already exists
as a top-level serialized field is argued in §14: the rule is "a new
optional field advances the format", and controlType settled it by
living inside the very same container and still advancing 4.3.x →
4.4.0. The existing container buys the absence of any data rewrite —
which is why the step is a NO-OP, not why it can be skipped.

12.13 REVISION TRACKING BOUNDARY
------------------------------------------------------------

Revision marks record who changed which text, and why text that is
no longer wanted is still present. They are CONTENT state — not
presentation, not a view, not a diff.

Model
    interface RevisionMark {
      type: 'insert' | 'delete' | 'modify'
      author?: string
      authorId?: string
      /** epoch ms; absent when the source carried no parseable date */
      at?: number
      /** reserved for 'delete' when the deleted text must be recoverable
       *  independently of the node's own text */
      original?: string
    }
    TextNode.revision?: RevisionMark

    TextNode is the ONLY home (§7.3). Revision MUST NOT be a TextStyle
    field: the format painter copies TextStyle (§12.5), and carrying a
    change record onto unrelated text is wrong. It is also NOT
    range-based: comments are side notes (the range model is right
    there), whereas a revision is a property of the text and must
    follow it through copy / split / merge. Range re-anchoring exists
    nowhere in this engine — CommentThread.anchorStatus is never
    updated by any code — and MUST NOT be reintroduced for revisions.

    'modify' is RESERVED: it has no producer in this batch. Only
    'insert' and 'delete' are stamped. The renderer already has a
    token for 'modify' (revisionModify).

Production — ONE choke point
    CommandManager.buildContext() injects the revision context —
    tracking flag, current user, and ONE timestamp read per command
    execution. Commands MUST NOT reach into Editor state directly.

    Only commands that change text CONTENT stamp:
        InsertTextCommand, DeleteRangeCommand, ReplaceTextCommand.
    SplitParagraphCommand / MergeParagraphCommand MUST preserve
    existing marks and MUST NOT create them: this model has no
    paragraph-mark node, so a paragraph break cannot carry a mark.

    Deleting a pending insertion CANCELS it (remove the text; never
    stack a delete mark on an insert mark).
    Non-text inline nodes (image / smarttext) cannot carry a mark,
    because RevisionMark lives on TextNode. Deleting one is structural
    and is NOT tracked. This boundary is explicit, not accidental.

    Stamps MUST be deterministic across redo: a command caches its
    mark on first forward. Re-running forward with a fresh clock would
    produce a different `at`, breaking the §8.3 byte-identical redo
    criterion.

Deletion semantics
    With tracking ON, DeleteRangeCommand KEEPS the deleted text and
    marks it 'delete'. With tracking OFF, the old removal semantics
    are unchanged. normalizeParagraph MUST NOT merge text nodes whose
    revision marks differ — a merge would destroy one mark.

Rendering
    Revision reaches the renderer through the EXISTING particle
    pipeline: TextNode.revision → LineElement.revision →
    SLIFItem.revision → ParticleAdapters → TextParticle's existing
    revision branch (§4). There MUST NOT be a second drawing path;
    screen and print share this one.

    showRevisionMarks is a VIEW switch (default true) mirroring
    showInvisible. It is NOT EditorMode.clean: clean is readonly and
    i18n-labelled as plain text, and redefining it would be a
    contract-level semantic migration. Turning the switch off changes
    only the drawing of marks (colour and revision-induced strikeout);
    it MUST NOT change the document, the layout, or the serialized
    bytes. Unlike showInvisible, print does NOT force it off: revision
    marks are content annotations, not editing aids.

Accept / reject
    Accept and reject MUST be commands (undoable), never raw pool
    mutations. The four combinations are all implemented:
        accept insert → drop the mark, keep the text
        reject insert → remove the text node
        accept delete → remove the text node
        reject delete → drop the mark, keep the text
        modify        → both accept and reject drop the mark
                        (nothing to restore; reserved type)
    Whole-document accept/reject walks paragraphs through the
    sanctioned spines (bodyParagraphSpine / hfContainers), never
    doc.body.children directly (§31).

    The header/footer half MUST use hfContainers, NOT
    hfParagraphsForExport. The latter is an EXPORT projection: it
    returns one variant per band, so revisions living in the
    first-page / even-page variants (§7.9) would never be decided.
    Revision decisions operate on the whole document, not on what
    an export would render.

    Per-node accept/reject acts on exactly ONE TextNode. The UI
    learns which node is under the pointer from the RULE 10 context
    snapshot: TextContext / CellContext carry an ADDITIONAL FACT
    `revisionFact` (nodeId + type + author + at), collected at the
    boundary exactly like sectionFact / tableGrowable. The engine
    MUST NOT return menu items or accept pixel coordinates for
    revision queries; the UI MUST NOT walk the model to find
    revisions. Revisions are NOT range-selectable for decisions:
    there is no "revision range" concept, and this batch does not
    introduce one.

Import
    The carrier in real exports is `rtype` ON the host node. The
    importer reads it and attaches RevisionMark to the TextNode it
    produces (text and checkfield both map to TextNode). `date` is
    parsed to epoch ms; an unparseable date leaves `at` absent while
    the author is kept. Standalone inline marker nodes apply to the
    following inline siblings until the next marker or paragraph end
    (§12.2).

NOT THE REVISION MODEL
    DocumentDiffer's 'insert' | 'delete' | 'modify' | 'equal' is a
    computed diff between two document versions. It is persisted
    nowhere and MUST NOT be reused as the revision model.

Format version
    4.8.0 → 4.9.0, explicit NO-OP (§14). A pre-4.9 document has no
    revision field, so every node reads exactly as before.

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

There MUST be exactly one native (.json / .emr) load path:
document/io/DocumentLoader. Any native loader MUST route through
it and MUST NOT bypass ModelUpgrader for a supported old document
version (§26.7).

Multi-format import loaders (HTML / Markdown / XML) construct NEW
documents and MUST emit modelVersion = CURRENT_DOCUMENT_VERSION
(§26.4).

Header/footer page variants (§7.9) advanced the format from 4.4.0 to
4.5.0. Because the four fields are additive and optional, the migration
is an explicit NO-OP step (4.4.0 → 4.5.0, breaking: false, upgrade
returns the document unchanged) — the same convention as the 4.3.0 →
4.4.0 controlType bump. No data rewrite, no backfill: a pre-4.5
document simply has no first/even variant content. CURRENT_SLIF_VERSION
is NOT bumped by a document-format change (§26.13/§26.14).

Table dynamic rows (§12.9) advanced the format from 4.5.0 to 4.6.0,
again an explicit NO-OP step (4.5.0 → 4.6.0, breaking: false, upgrade
returns the document unchanged). A pre-4.6 document has no
Table.dynamicRows, so every table is fixed — exactly the old behavior.

Section (§31) advances the format from 4.6.0 to 4.7.0, again an
explicit NO-OP step (4.6.0 → 4.7.0, breaking: false, upgrade returns
the document unchanged). A pre-4.7 document has no Section nodes, so
every document reads exactly as before.

Computed values (§12.12) advance the format from 4.7.0 to 4.8.0, again
an explicit NO-OP step (4.7.0 → 4.8.0, breaking: false, upgrade returns
the document unchanged). TemplateDefinition.formula is additive and
optional; a pre-4.8 document has no formulas, so every control reads
exactly as before.

    WHY A BUMP IS REQUIRED even though the container already exists:
    the rule this contract applies is "a new optional field advances
    the format", not "a new top-level field advances the format".
    controlType (§12.1) is the precedent and it decided the question:
    it is a TemplateDefinition field living INSIDE the very same
    templateDefinitions top-level field, and it still advanced the
    format from 4.3.x to 4.4.0. The version history in ModelUpgrader
    is one consistent rule (ElementFormat / SmartTextNode /
    TemplateDefinition each gained optional fields and each advanced
    the version). What the existing container DOES buy is that no data
    rewrite or backfill is needed — that is why the step is a NO-OP,
    not why it can be skipped.

    Revision marks (§12.13) advance the format from 4.8.0 to 4.9.0,
    again an explicit NO-OP step (4.8.0 → 4.9.0, breaking: false,
    upgrade returns the document unchanged). TextNode.revision is
    additive and optional; a pre-4.9 document has no marks, so every
    node reads exactly as before. Unlike §12.12 this field lives on
    TextNode itself rather than inside TemplateDefinition — the bump
    rule is the same, the container argument simply does not apply.

Two caveats about the version mechanism itself (see §31.12):

  - The version gate is a REAL safety mechanism, and it works: a
    client that is too old rejects a newer document at load, BEFORE
    any node is parsed — so a document containing a node type the
    old client does not know is never silently half-read.
  - It is NOT sufficient on its own. A document that misreports its
    version, or omits `modelVersion` entirely (falling back to
    LEGACY), bypasses the gate. Hence the SECOND line of defence:
    load-time validation of modelVersion ↔ node-type consistency
    (§7.3 / §31), not the gate alone.


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

- the paragraph line cache and resume-pagination state
- IncrementalLayout
- VirtualViewport
- PageStartTable

Prefer invalidating only affected regions.

However:

Correctness MUST take priority over premature optimization.

Do not introduce complex caching without understanding
its invalidation rules.

A `headerFooterConfig` change (§7.9) selects a different page variant
and therefore changes band CONTENT and band HEIGHT, which moves the
body area. Its invalidation is FULL, never 'none'.

Per-page header/footer variants are laid out lazily: the default
variant is always computed; the first/even variants are computed ONLY
when their config flag is enabled. With both flags off, layout work
MUST be unchanged from the single-variant behaviour. The body area is
derived from the worst case over the ENABLED variants so pagination
stays uniform and deterministic (per-page body height is a later
concern, not a licence to re-run the paginator per page).

PAGE GEOMETRY (2026-10-21). `DocumentTree.pageSetup` is the canonical owner
of page width, page height and the four margins (§7.3). Layout MUST consume
it: `Draw` MUST push the current document's page setup into `LayoutEngine`
before every layout pass, including right after a document load/swap, and a
page-setup change MUST invalidate pagination state (paragraph line keys
already include the available width; the page-start table and reused pages
do not). The 794×1123 / margins 72/90 values exist ONLY as the defaults for
documents that omit `pageSetup`; they are not the editor's page geometry.
`SLIFPage.width` / `SLIFPage.height` are the actual page geometry and remain
the single source for every other consumer (overlays, hit testing, export).
A change of page setup is a full-layout invalidation, not a resume.

16.1 VISIBLE-PAGE RANGE

The set of pages painted by `Draw.render` is DERIVED data computed from
the ACTUAL SLIF page heights (pages can differ within one document:
page setup, orientation, section breaks) and the page vertical gap.

Rules:

- The computation MUST be a pure function of
  `(pages, scrollTop, viewportHeight, pageVerticalGap, overscanPages)`.
- It MUST NOT assume a uniform page height. Any implementation that
  multiplies `pageIndex * pageHeight` is wrong for this engine.
- `VirtualViewport` owns that function; `LayoutEngine.getVisiblePages`
  delegates to it. There is exactly one implementation.
- Inputs are in DOCUMENT coordinates. The caller converts screen pixels
  by dividing by scale (§17: no reading of viewport globals here).
- Canvas overscan (`LayeredRenderer.OVERSCAN_PAGES`) and range overscan
  are different concerns: the former sizes the backing canvas, the
  latter widens the painted page set. Do not conflate them.

INCREMENTAL LAYOUT STATUS (2026-10-19)

M2a IS wired: `LayoutEngine` caches paragraph LINE layout for a provably
safe subset — paragraphs whose children are plain `text`, `image`,
`smarttext`, `field` or `footnote_ref` — keyed by
`IncrementalLayout.paragraphKey`
(structure version + paragraph version + per-child versions) plus the
available width, the revision-marks flag, the resolved list marker and
image dimensions. A paragraph that contains a `smarttext` ALSO keys the
computed-values generation and the `TemplateDefinitionStore` version:
control geometry (display text, visibility, control type, labels,
options) comes from those two stores without touching node versions.
A paragraph that contains a `field` ALSO keys the field-reserve sampling
inputs — total-page DIGIT count, locale and document title — because the
layout width of a field comes from `representativeFieldText`'s sample
string, not from the node; the digit rule is shared with that function via
`fieldReserveDigits` and MUST NOT be re-implemented. Paragraphs with
neither child kind MUST NOT include those extra segments — otherwise every
formula change or title edit would churn the entire line cache. The cache
holds at most one entry per paragraph id and MUST be cleared when the
document is swapped.

M2b IS wired for a provably safe subset: plain-text/image/smarttext/field
paragraphs (list markers included) and tables whose cell leaves are
`text`, `smarttext`, `image`, `field` or `footnote_ref`. Section breaks
and cross-references remain excluded (a cross-reference ANYWHERE in a
table subtree, cell paragraph included, keeps the whole document
ineligible); header/footer content is governed by the M3b signature
below.
Inline footnote references ARE allowed (see the
Step 4 rule below). Page breaking resumes from the page
BEFORE the first recomputed paragraph (widow control can pull a line back
from the next page). If that page begins in the middle of a table, it MUST
walk back to the table's first page: the paginator receives the original
input-line slice and a table has exactly ONE input line, so starting from
the middle would re-emit fragments already carried by reused pages. If no
paragraph line changed and no table key changed, the whole page array is
reused.

List numbering is allowed because the marker is part of the paragraph key:
a renumbering change invalidates the affected paragraphs automatically.

A table is allowed only when `IncrementalLayout.tableKey` proves its
subtree unchanged: structure version + every node version under the table
(rows, cells, cell paragraphs, text, images, fields, footnote refs),
combined with the computed-values generation, the
`TemplateDefinitionStore` version and the revision-marks flag. The
generation is required because a formula/definition change alters
displayed values without touching node versions; the definition version
is required for the same reason (control type/labels live in that store).
When the subtree contains a `field`, the table key ALSO carries the same
field-reserve sampling inputs as a paragraph key (total-page digit count,
locale, document title) — a page-count digit or locale change alters
field reserve width inside cells without touching any node version. A
cell holding a nested table or a cross-reference makes the whole document
ineligible for M2b; nested tables change cell geometry from outside the
flat table key, and a cross-reference's display text depends on the
previous pass's page map. Image dimensions live on the node (already in
the table key), and a footnote reference only affects the page-bottom
footnote area, which Step 4 handles per new page (see below).

The page-start line table maps each page to an INPUT-line index. A table
occupies one input line but can span several pages: the page carrying its
first fragment advances the index by one, and every continuation page maps
to the line AFTER the table, so `pageOfLine(tableIndex)` resolves to the
FIRST fragment page. This mapping is what makes resume and the
`PageStartTable` lookups correct with tables present.

SAME-SHAPE PAGE PATCH (M2e). When EXACTLY ONE block was recomputed and it is
a paragraph whose new lines have the same COUNT and the same PER-LINE HEIGHTS
as its cached previous lines, page boundaries cannot move: PageBreaker's
decision sequence reads only each line's height, its pageable flag and its
paragraph-end flag, all unchanged. Layout may then rebuild ONLY the pages
that carry that paragraph's lines and reuse every other page object verbatim,
INCLUDING pages after the rebuilt range — it must not resume re-breaking from
the first dirty page. Required preconditions (any failure falls back to the
M2b resume path, then to a full pass):
  - the document has no tables and no footnotes (footnote reserve = 0): a
    table fragment or a footnote area would make a page's line slice
    ambiguous;
  - the paragraph's last line still ends the paragraph (same '\n' flag), so
    widow/orphan control sees identical boundaries;
  - the previous lines are still in the paragraph line cache (otherwise the
    shape comparison has no baseline).
Rebuilt pages and reused pages MUST be byte-identical to a fresh full layout;
the randomized equivalence gate is the acceptance proof. The hit-test index
rebuild starts at the first patched page (re-indexing the reused tail is
harmless). `getPaginationStats()` reports the prefix reuse count in
`reusedPages` and the count reused after the patched range in
`reusedTailPages`; both being zero means nothing was reused. Header/footer
content does NOT disqualify the patch on its own: the M3b signature below
already proves the per-page header/footer items are unchanged.

HEADER/FOOTER (M3b). A document with header/footer content is eligible for
incremental pagination when a header/footer signature is UNCHANGED. The
signature MUST cover: structure version; for each of the six variant arrays
(header, footer, firstPageHeader, firstPageFooter, evenPageHeader,
evenPageFooter) every block id together with the block's node version AND
each child's node version; the per-page variant switches
(`differentFirstPage`, `differentOddEven`); the revision-marks flag (strike-
through is a layout-time product); and the field-reserve sampling inputs
(total-page digit count, locale, document title) — a header/footer field's
reserve width depends on them. When (and ONLY when) a header/footer paragraph
contains a `smarttext`, the signature also keys the computed-values
generation and the `TemplateDefinitionStore` version, for the same reason as
M2a; including them unconditionally would send every header-bearing document
back to a full pass on each formula change. PAGE/NUMPAGES text inside a
header/footer is resolved at render time (`Draw.resolveFieldText`), so a page
COUNT change alone does not invalidate reused pages; a DIGIT-count change
does, and the existing second layout pass (new hint) handles it. On any
signature mismatch the pass MUST fall back to a full layout.

Step 4 (footnote collection) is incremental-safe under two rules:
1. It processes ONLY the newly paginated pages. Reused pages already carry
   their footnote items; re-collecting them would append duplicates on every
   layout.
2. Footnote numbering is global and page-ordered ("跨页连续"), so the
   collector's counter MUST be seeded with the references already carried by
   the reused pages (counted with the same eligibility rule as collection),
   otherwise new pages restart at 1.

The footnote gutter reserve is derived from whether the document contains
footnotes at all. Adding or removing a reference is a structural edit
(structureVersion), which already invalidates every paragraph key and forces
a resume from page 0 — so the reserve cannot change underneath reused pages.

`HitTestIndex` follows pagination: on a resume it rebuilds only from the
first non-reused page, and when nothing changed it is not rebuilt at all.

REMOVED (2026-10-20): `LayoutCache` and `LayoutEngine.incrementalLayout()`
are gone, not merely unwired. Both were exported but had no consumer; the
old `incrementalLayout()` only reused page objects after a full pass, so
it could never save work. Do NOT reintroduce either name as a placeholder:
the live path is `fullLayout` + the paragraph line cache + the resume
pagination described above.

REMOVED (2026-10-21): `DirtyTracker` / `DirtyScope` are gone as well
(dead-API removal approved by the owner). Their marks were never consulted
when deciding what to recompute. `document:changed` keeps the
`dirtyNodeIds` field but always emits an EMPTY array, for subscriber
compatibility only; it carries no information. Cache misses and keys
remain the ONLY source of truth for what is recomputed — never cite dirty
marks, and never reintroduce a placeholder tracker.

Unknown or unprovable cases MUST fall back to a full pass (cross-references,
section breaks, tables whose cells hold nested tables / footnote references
/ fields, and any input not covered by the keys listed above are
deliberately excluded). The
cache and resume path are correct only if the key/eligibility test covers
every input that can change line layout or pagination; when adding a new
input, extend the key/eligibility test or fall back to full.

The page-level design and remaining milestones are in
`knowledge/增量排版-设计方案.md`.


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

Page-variant header/footer behaviour is core engine behaviour and MUST
stay coverable without React:

    HeaderFooterRegions.test.ts   variant→page truth table, membership,
                                  lazy array creation
    HeaderFooterEdit.test.ts      variant-aware structure editing +
                                  per-page variant layout emission
    PrintRender.test.ts           print projection includes header/footer
                                  and resolves field codes per page
    FindReplaceHeaderFooter.test.ts
                                  find scope + reading order over the
                                  whole document spine

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
    engine/ → lib/
    Collaboration → arbitrary internal node mutation

engine/ → lib/ is the newest entry and the least obvious one, because
the two are SIBLINGS under src/ and skin-deep it looks harmless. The
direction is enforced by the packaging too (§32): "." and "./export"
are separate build entries, so a lib symbol reachable from engine would
either pull the export bundle into the core bundle or become a genuine
cycle — lib/export/fields.ts:27 already imports the engine barrel.

Consequence for feature design: when a feature needs something that
lives in lib/, the answer is NOT to import it upward. Either the fact
is duplicated deliberately (and that duplication is recorded), or the
shared core is moved DOWN into engine/ first. §12.10.4 is a worked
example of BOTH, chosen per case: the reading-order glue loop is
duplicated (and recorded as such), while the value → display-text
resolution was moved down, because a second copy of a semantic rule
would drift and a second copy of a 16-line loop would not.


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

RULE 10:

    CONTEXT RESOLUTION BOUNDARY — Engine MAY expose read-only
    editor context snapshots for UI consumers. The context
    snapshot MUST describe editor/document facts ONLY. It MUST
    NOT contain: menu items, UI components, menu actions, React
    state, or UI-specific commands. UI MAY derive menu
    presentation and available actions from the context snapshot.
    Context resolution MUST be side-effect free. Context menu
    PRESENTATION belongs to the UI layer; the Engine MUST NOT know
    context menu components, labels, hierarchy, or UI menu state.

RULE 11:

    ATOMIC COMPOSITE OPERATIONS — A single user-level edit that
    mutates the document through multiple sub-mutations (e.g.
    cut = clipboard capture + range delete) MUST collapse to a
    SINGLE undoable command on the undo stack. It MUST NOT leave
    multiple independent commands that would each require a
    separate undo. Composite (macro) commands group sub-commands
    into one undo unit; CommandManager exposes a transaction
    (beginMacro/endMacro) to build one. Non-mutating side effects
    of the operation (e.g. clipboard capture) stay OUTSIDE the
    command and are NOT undone/redone.

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

14. SLIFVersion MUST be a NOMINAL separate type — never
    `type SLIFVersion = DocumentFormatVersion`.
    CURRENT_SLIF_VERSION MUST be its own distinct constant —
    never the same object as CURRENT_DOCUMENT_VERSION.
    (This supersedes knowledge/document-version-system-design.md
    decision #1, which endorsed the alias.)

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
    PlatformHost  — applyTheme(), clipboard, sendBeacon(), onBeforeUnload(), storage

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

    interface PlatformHost {
      applyTheme(colors): void                 // :root CSS vars / native chrome
      clipboard: ClipboardHost
      sendBeacon(url, data): void              // data = engine-serialized JSON string
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

BOUNDED EXCEPTION — `locale` subscription apparatus.

`locale` additionally carries mutable subscription state: a
listener set plus a monotonic version, so UI can re-render when
the language changes (same shape as EditorStore: subscribe() /
getVersion() / version++ in notify()).

The exception is the SUBSCRIPTION APPARATUS ONLY. The single
module-level `locale` stays the one app-wide instance:

    - it MUST NOT be moved into EditorStore or a UI store —
      that creates duplicate state (§7.5) and makes the language
      a per-Editor / per-page fact, which it is not;
    - it MUST NOT be re-created per Editor;
    - the listener set is runtime-only, so module evaluation is
      still side-effect-free (§29).

Adding comparable mutable state to any OTHER singleton on the
list above is still prohibited: none of them has a "the UI must
re-render when this changes" requirement.

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

============================================================
31. STRUCTURE TREE vs LOGICAL DOCUMENT FLOW
============================================================

The document is read in TWO DIFFERENT WAYS, and conflating them is
the single largest source of silent failure in this engine:

    STRUCTURE TREE      "who is whose child"      — the real node
                        graph, real sibling arrays, real indices.

    LOGICAL FLOW        "what comes next in reading order" — a
                        DERIVED, READ-ONLY projection.

Neither may be used in place of the other.

The one-line boundary:

    "WHAT IT IS" goes through the structure tree.
    "IN WHAT ORDER YOU READ IT" goes through the logical flow.
    They are never swapped.

------------------------------------------------------------
31.1 The two entry points
------------------------------------------------------------

    Structure tree — the ONLY entry point:

        pool.getChildren(id)        // type-agnostic; works for
                                    // body / section / cell / row /
                                    // table / paragraph alike

    Logical flow — the ONLY implementation:

        engine/document/selection/SelectionCollector.ts
        (walker functions W1–W4 / R1–R2 below)

MUST:

- Code outside the walker module MUST NOT iterate
  `doc.body.children` (or re-implement the walk by hand).
  This is enforced by a static gate —
  `frontend/src/__tests__/DocumentWalkGate.test.ts` — which fails CI
  on any traversal outside the walker and outside an explicit,
  justified whitelist. Adding a whitelist entry means declaring
  "this site is STRUCTURE semantics", not "this is debt".

- The gate lives in the APPLICATION tree ON PURPOSE and scans BOTH
  source roots (`frontend/src` as `app:`, `packages/emr-document-engine/
  src` as `pkg:`). The rule it enforces is repository-wide: app code
  can grab a DocumentTree and walk it just as engine code can. Moving
  the gate into the package (§32) would restrict it to the package
  half and let the application half drift UNENFORCED — silently.
  Same dual-root shape as I18nGate. Traversal is via `node:fs`, not
  `import.meta.glob`, so it is not anchored to the Vite root. (Decided
  deliberately at split time; this is an architectural choice, not a
  workaround.)

- The whitelist is exactly the Q9 set below plus the walker
  itself, the serializer/loader, the version migration, the
  structural commands and R2. Anything else is a violation.

------------------------------------------------------------
31.2 The walkers
------------------------------------------------------------

    W1  collectDocumentNodes(doc, pool)
        Reachable node set, DFS, INCLUDING every container node
        (Section included). Use: serialization.

    W2  bodyBlockSpine(doc, pool)
        Block-level reading order. Section is expanded IN PLACE and
        the Section node itself is NOT emitted. Use: layout line
        emission, keyboard/mouse block navigation, bookmark
        resolution, TOC extraction, TXT/HTML export, QC block rules,
        document diff, word count.

    W3  bodyParagraphSpine(doc, pool)
        Paragraph-level reading order = W2 ∘ table expansion
        (each table expanded in place into its cell paragraphs, in
        row-major then cell order). Section is NOT emitted. Use:
        selection spine, find & replace scope, Ctrl+A, render
        selection highlight.

    W4  sectionsOf(doc, pool)
        Pre-order enumeration of Section nodes, INCLUDING Section
        itself.

    R1  sectionOf(nodeId, doc, pool)
        Nearest enclosing Section (NOT the outermost one); null when
        the node has no Section content.

    R2  resolveParagraphRegion(paraId, doc, pool)
        (engine/state/CaretScope.ts) The paragraph's region plus its
        REAL sibling array and REAL index. This is STRUCTURE, not
        flow: structural commands need the true container.

MUST NOT:

    W2/W3 are READ-ONLY. They MUST NOT be used for structural
    mutation, serialization, container identity, or ownership
    resolution.

    The following five sites MUST use the structure tree and MUST
    NOT be rewritten onto W2/W3:

      1. serialization (collectDocumentNodes) — otherwise Section
         nodes are lost from the flat node table.
      2. resolveParagraphRegion — structural commands need the real
         sibling array and the real index.
      3. RemoveNodesCommand's `Container` — snapshot/restore needs
         the true container identity.
      4. section-level commands — deleting a whole section needs the
         Section's real index inside body.
      5. sectionsOf / sectionOf — ownership is a structural fact,
         not a reading order.

Cross-parent move — `MoveBlockCommand` + `NodePool.moveChildTo`:

    The engine has exactly one cross-parent move primitive. It exists
    because "move a whole chapter" cannot be expressed with
    `moveChild` (which only reorders WITHIN one parent). It is a
    controlled NodePool method (the §6.1 choke point), and it FAILS
    LOUDLY rather than silently: moving a node into its own subtree,
    or creating a second parent reference, throws and the command
    produces NO undo entry.

    A block move is a DETACH + INSERT, not a rebuild: subtree node identity
    is preserved (undo therefore needs only the source container and
    index, never a subtree snapshot).

------------------------------------------------------------
31.3 Walker output contract (exact)
------------------------------------------------------------

W2:

    - Section is expanded in place; the Section node is NOT emitted.
    - SectionBreak IS emitted (Layout needs it to produce a marker
      line; PageBreaker consumes it).
    - Every other body-level block (paragraph / table / image /
      separator) is emitted as itself.
    - `visited` semantics: an id is emitted AT MOST ONCE. Documents
      with cross-parent duplicate ownership MUST NOT produce
      duplicated output (duplicate rendering, duplicate counting,
      corrupted selection).

W3:

    - W3 = W2 ∘ table expansion. Section expansion happens in the W2
      stage only; a table is expanded in place into its cell
      paragraphs.
    - The expansion is RECURSIVE (§31.13): a table nested inside a cell
      is expanded in place too, so W3 yields that table's inner cell
      paragraphs — never the nested table's own id. A cell child that
      is neither a paragraph nor a table is a §31.13 violation and the
      boundary that admitted it MUST have thrown already.
    - Section is NOT emitted. SectionBreak is NOT emitted.
    - For a document with NO Section, W3's output MUST be
      element-by-element IDENTICAL to the old
      `flattenTextContainers(pool, doc.body.children)`. This
      equality is the P0 acceptance signal and is locked by test. It
      survives §31.13 because on a document with no nested table the
      recursive expansion degenerates to the flat one.

W3-SELECTION:

    - The paragraph order of a selection is W3 for body, or the variant
      array for header/footer.
    - The per-paragraph clip ranges MUST come from
      `collectSelectionSegments` (SelectionCollector). Copy, selection
      painting and range commands all consume that one function; a
      consumer that re-derives `lo/hi` offsets locally is a drift bug —
      the copies had already diverged once (keyboard delete skipped the
      macro wrapping, so one cross-paragraph delete needed N undo steps).
    - Region mixing is refused by region identity
      (`regionIdOf`): body↔header and header↔header:first are invalid
      selections.
    - Copy, painting AND deletion walk the same flattened W3 spine. A
      body↔cell or cross-cell selection is one linear text range: the
      text it covers — cell text included — is deleted. Block structure
      (a table, a block-level image) is never removed by text deletion;
      it stays where it is.
    - After a cross-paragraph deletion, each paragraph merges into its
      preceding sibling only when that sibling is a paragraph in the
      same container. MergeParagraphCommand decides this itself and
      returns null otherwise (no undo entry), so a table boundary is
      never crossed and no index bookkeeping is needed.

------------------------------------------------------------
31.4 `paragraphPath` — 2 elements, and container resolution
     does not go through it
------------------------------------------------------------

`CursorState.paragraphPath` is ALWAYS `[documentRootId, paragraphId]`
— exactly two elements.

There is no 3+ element form, and no `body_root` / `header_root`
intermediate node exists. Ancestor information is NOT carried in the
path.

MUST:

- Container resolution (which body / cell / header / footer / section
  a paragraph lives in) MUST be resolved AT THE USE SITE, via
  `resolveParagraphRegion` / `resolveCellPosition` /
  `resolveHfParagraphLocation` — all of which answer "paragraph id →
  scan the pool for its parent" and are therefore independent of path
  depth.

- Code MUST NOT insert container ids into the path. The
  `path[length - 2]` fallback in SplitParagraphCommand /
  InsertNodesCommand would silently change meaning.

The consequence: the introduction of Section does NOT require any
change to this field.

------------------------------------------------------------
31.5 Failure semantics — never silently drop content
------------------------------------------------------------

A walker that meets a body-level node type it does not know MUST
THROW (`BodySpineError`). Silently skipping it produces a document
that renders, exports, counts and searches as if content had been
deleted — a far worse failure than an error.

Consequently, the P0 acceptance criterion is phrased precisely:

    P0 is ZERO BEHAVIOR CHANGE **for legal documents**.
    Illegal documents (unknown body-level type) now throw instead of
    being silently ignored. This is intentional and is not a
    regression.

Related:

- Initial caret placement MUST be "first paragraph of W3 → else first
  block of W2 → else `[]`". Placing the caret on
  `body.children[0]` without a type check puts it on a non-text
  container when the first block is a table or an image — a silent
  failure.

------------------------------------------------------------
31.6 Real index vs flow index — do not mix them
------------------------------------------------------------

`doc.body.children` indices and W2 indices are DIFFERENT NUMBERS once
a Section exists, and they already differ from W3 indices for
documents containing tables.

MUST:

- Structural commands (insert / remove / restore / move), the delete
  guard, and `cursorAfterBlockRemoval` MUST use the REAL structural
  index.
- Reading-order navigation (arrow keys, Home/End, PageUp/PageDown,
  nearest-paragraph search) MUST use the FLOW index, and the index
  and the sequence it indexes MUST come from the same call — an index
  computed on one sequence and consumed against another silently
  lands on the wrong node.

------------------------------------------------------------
31.7 Delete guard semantics
------------------------------------------------------------

The "body must keep at least one paragraph" guard is defined over the
paragraph count of the block spine (W2 + paragraph filter), NOT over
`body.children.length`. Counting raw body children makes the guard
wrong in both directions once non-paragraph blocks (tables,
separators, section breaks) or Sections are present.

------------------------------------------------------------
31.8 R2 MUST cover `section`, and structural ops MUST NOT be
     silent no-ops
------------------------------------------------------------

`resolveParagraphRegion` returning `null` is the structural command
layer's "silently refuse" signal: split / merge / paste / block
insert all degrade to a no-op. A paragraph that lives inside a
Section would hit that path and the user's action would vanish
without feedback.

MUST:

- R2 MUST cover `section` (a `{ type: 'section'; sectionId }` region
  alongside body / cell / header / footer).
- Structural commands MUST NOT silently no-op on a paragraph the
  walker can see. A command that cannot resolve its container MUST
  fail visibly (or be fixed to resolve it), never silently.

------------------------------------------------------------
31.9 Counting口径 — over the paragraph flow (W3)
------------------------------------------------------------

`min_chars`, `paragraph_count` and `Editor.getWordCount()` count over the
**paragraph flow (W3)**, so they include Section-inner paragraphs AND
table cell paragraphs. Counting only body-level blocks (the historical
口径) silently dropped every table's content — a PRE-EXISTING gap that
this section closes rather than a Section regression.

Header/footer content is still NOT counted: it is band content that
repeats on every page, so counting it would inflate the number with page
count.

All three口径 are the SAME source, so the status bar's word count and
QC's paragraph count can no longer contradict each other.

------------------------------------------------------------
31.10 `Section` vs `SectionBreak` vs `outlineLevel` — three
      different things
------------------------------------------------------------

    Section        a STRUCTURAL CONTAINER of content. It has
                   children and no visible content of its own. It is
                   a NODE TYPE (this supersedes the blanket
                   "headings do not create a node type" statement in
                   the historical architecture doc §2.11 — that
                   statement is about HEADINGS, and it remains true
                   for headings).

    SectionBreak   a PAGE-SETUP BOUNDARY marker. It produces a marker
                   line and never carries clinical meaning.

    outlineLevel   a Word heading LEVEL on a Paragraph. It is an
                   ATTRIBUTE, not an identity.

MUST:

- `Section` and `outlineLevel` stay ORTHOGONAL. Neither is derived
  from the other. A Section is not a heading, and a heading does not
  create a Section.

- `SectionBreak` MUST NOT appear inside `Section.children`. It is a
  body-level page-setup boundary only, and MUST NEVER be used to
  express clinical structure (that is what `Section` is for).

- Heading-level features (TOC, outline navigation, bookmark targets)
  MUST see headings THROUGH a Section boundary — i.e. by walking W2,
  not by treating the Section itself as a heading. Two independent
  implementations producing two different "list of headings" for the
  same document is exactly the drift this forbids.

- `Section` MUST NOT be inferred from `outlineLevel`, and Section
  semantics MUST NOT enter `ElementMeta` or the template-design
  stores (§12.1).

------------------------------------------------------------
31.11 Naming
------------------------------------------------------------

The engine's `Section` is a document-structure container (§31.10).
Any OTHER use of the word for an unrelated concept MUST be renamed to
avoid collision — e.g. Draw's page-band resolver is `resolveBandOf`
(header band / footer band / body), not `resolveParagraphSection`.

------------------------------------------------------------
31.12 Known limitations (recorded, NOT silently ignored)
------------------------------------------------------------

- Flattened export formats (TXT/HTML) cannot represent an EMPTY
  Section: it contributes zero characters and is therefore
  indistinguishable from "no such section" in the output text. This
  is an inherent limitation of flat formats, not a Section
  regression. Structured export (CDA) can emit it.

- `ModelUpgrader.upgrade` catches a per-step failure, logs it and
  CONTINUES, then unconditionally writes the target version onto the
  document — "migration failed but the version number advanced".
  Harmless for the no-op steps registered so far, but it weakens the
  "the version number is a safety mechanism" claim of §14. It is
  recorded here as a known limitation.

- A format version bump does NOT mean `wasUpgraded === false`. The
  flag means "source version ≠ final version"; a document upgraded
  through a pure NO-OP step still reports `wasUpgraded === true`.
  "No data rewrite" ≠ "wasUpgraded false".

- Section-level QC lives in QCEngine as `section_unnamed` /
  `section_empty`. Both are WARNINGS, not errors: an anonymous or
  still-empty SECTION is a legal document state (serialization,
  validation and the walkers all accept it) — the rules only remark
  that the section cannot be referenced by section code, or has not
  been filled in yet. A section-level issue MUST be locatable: it
  carries the Section's nodeId, plus the paragraph path of the
  section's FIRST paragraph when one exists. An empty section has no
  paragraph to jump to, so it carries the nodeId only — a deliberate
  degradation, not a missing field.

- The OUTLINE projection shows sections that have no heading of their
  own, so that "this section exists but is empty" is visible. Such an
  entry is marked as a section (distinct icon/style) and MUST NOT
  masquerade as a heading: Section and outlineLevel are orthogonal
  (§31.10). A section WITH headings is represented by those headings.

- The template IMPORTER routes an external `section` node to a Section
  container and MUST THROW on a block type it does not know. The
  historical `default: return null` silently discarded the whole
  subtree, so an imported template could quietly lose entire chapters
  (the §31.5 principle applies to the import boundary too). The
  revision markers `insert` / `delete` remain an explicit skip
  whitelist — they are content-free wrappers, not unknown types.

------------------------------------------------------------
31.13 Container child-type contract — what may live where
------------------------------------------------------------

The rule "which container may hold which child type" was, until this
section, NOWHERE DECLARED. Every consumer guessed for itself, and the
guesses disagreed. That is not a theoretical concern — it produced a
concrete defect:

    A Section placed inside a table cell gave three walkers three
    mutually contradictory answers for the SAME node:

        W3 (bodyParagraphSpine)  ["sec-1", "p-2"]   the Section is
                                                    emitted as if it
                                                    were a paragraph
        W4 (sectionsOf)          []                 the Section does
                                                    not exist
        R1 (sectionOf)           "sec-1"            the Section exists
                                                    and owns p-1

    The cell path of the template importer let the Section in
    (`parseCell` → `parseBlock`, which has a `section` case), the
    loader had no per-container child-type check at all, and
    `flattenTextContainers` pushed every cell child unconditionally.

The contract is therefore declared ONCE, in one table, and enforced at
three boundaries (below). This table is the ONLY authority; no consumer
may keep a private copy of it.

    container                     legal child types
    ---------------------------------------------------------------
    body  (doc.body.children)     paragraph · table · image ·
                                  separator · section_break · section

    section.children              paragraph · table · image ·
                                  separator · section

    table.children                row

    row.children                  cell

    cell.children                 paragraph · table

    header / footer arrays        paragraph
    (all variants — default,
     first, even)

    paragraph.children            inline nodes (see the deferred note
                                  at the end of this section)

Consequences worth stating explicitly, because each closes a real gap:

  - **Section may appear ONLY as a child of body or of another
    Section.** It is a document-structure container (§31.10) — a
    grouping of block content, not content itself. Putting one inside
    a cell is ILLEGAL, not merely unsupported.

  - **A nested table inside a cell is LEGAL.** This is not a
    concession: real production templates contain them (a DCWriter
    §12.2-era admission record carries a 3×1 table nested in a 14×2
    table's cell). `documentExport` already implemented this correctly
    and is the reference implementation; the other consumers were the
    ones out of step.

  - **header/footer content is paragraphs only.** The bands are
    laid out as a paragraph line list (`collectHFParagraphLines`,
    `hfParagraphsForPage`), and that is their whole contract.

------------------------------------------------------------
31.13.1 Cell paragraph inline parity
------------------------------------------------------------

A paragraph inside a table cell consumes EXACTLY the same inline node set
as a body paragraph: `text`, `smarttext`, `image`, `field`, `bookmark`,
`cross_reference`, `footnote_ref`, `comment_marker` (the census lives in
`DEFERRED_INLINE_CHILD_TYPES`; bookmark and comment_marker occupy no
layout width and may legitimately produce no item). The cell layout path
MUST NOT silently skip any of these. An inline type outside the set is a
§31.13 violation and must throw — never a phantom empty line (§31.5).

Consequences that are part of the contract, not implementation detail:

  - **Fields in cells** measure with `representativeFieldText` and the
    same reserve inputs as body fields (page-count digit count, locale,
    document title), and their display text is resolved at draw time
    through the SAME page-aware resolver. A second field formatter in
    the cell path is forbidden (§4).
  - **Footnote references in cells** participate in the page's footnote
    numbering exactly like body references. The per-page collector walks
    INTO table cells (row-major rows, cells left-to-right, matching
    `getFlatPageItems` order), and the Step-4 number back-fill writes
    back into the cell items. Repeated table header rows are visual-only
    and are NOT numbered per page — the same choice hit-test flattening
    already makes.
  - **Cross-references in cells** resolve against the same page map as
    body cross-references. A table subtree containing one therefore
    keeps the whole document outside the incremental safe subset
    (§16.1).
  - **Images in cells** are clamped to the cell's text width, exactly as
    body images are clamped to the content width.

FAILURE SEMANTICS (§31.5 applies unchanged):

    An illegal container/child pair MUST THROW at every boundary that
    can produce or admit one. It MUST NOT be silently skipped,
    silently dropped, or silently rendered as something else. A
    document that renders, exports and counts as if content had been
    deleted is a worse failure than an error.

ENFORCEMENT — three boundaries, each with a distinct job:

    1. NodePool's controlled API (`insertChildren` / `moveChildTo`)
       = ENFORCEMENT (§6.2). The command layer therefore cannot
       construct an illegal structure in the first place.

    2. DocumentLoader.validateStructure
       = the LOAD boundary. Illegal persisted documents are rejected
       before any node is usable.

    3. TemplateImporter
       = the IMPORT boundary. An external template is rejected at parse
       time, with a message naming the offending container and type —
       not after it has been half-built into the node pool.

The header/footer arrays are NOT reachable through NodePool (they are
DocumentTree string[] fields, §6.2 domain split), so boundaries 2 and 3
are what constrain them.

MIGRATION AND FORMAT VERSION. This section does NOT bump the document
format version. No field, no node type and no serialized shape is added
or changed: the same documents denote the same models. What changed is
that an already-invalid structure is now REJECTED instead of being
half-processed, and that an already-legal structure (the nested table)
is now processed correctly. The three boundaries were verified against
every persisted document available at the time (16 sample documents plus
the built-in demo): no cell child other than `paragraph`, no
header/footer element other than `paragraph`, and no nested table. No
existing valid document is rejected by this section.

DEFERRED, RECORDED (not silently omitted):

  - `footnote_content` is declared in the table (paragraph children only)
    but is NOT yet enforced by any of the three boundaries: the loader's
    validation roots do not include `doc.footnotes` (pre-existing
    behaviour), and the footnote command sets `.children` directly rather
    than through NodePool. It is listed because it is a real contract,
    NOT because it is already guarded — do not read the table as "the set
    of things already enforced" until this line is removed.

  - `paragraph.children` inline ENFORCEMENT is NOT yet wired at the three
    boundaries. The legal inline set is now the one declared in
    §31.13.1 (`DEFERRED_INLINE_CHILD_TYPES`) and layout consumes it in
    full, but no boundary rejects an unknown inline type yet. Enforcement
    needs its own round; keeping the comment honest avoids the failure
    mode where "declared" is read as "already guarded".

  - The nested-table support landed with this section is DELIBERATELY
    PARTIAL, and each partial point is recorded rather than implied:

      - caret / Tab reading order does NOT descend into a nested
        table's cells. A click into one lands the caret and editing
        works; `listTableCells` / `getAdjacentCell` / `enterTable`
        still walk the OUTER table's grid.
      - pagination row boundaries (`TablePaginator`) are computed from
        item y positions at one level, so an over-tall nested table can
        be split through its middle rather than at one of its rows.
      - `AppendTableRowCommand` still does not clone a nested table
        (§12.9). The limitation is now worded "legal, but not cloned",
        not "unsupported".

============================================================
31.14 SECTION AUTHORING — creating, locating, selecting,
      operating on Section
============================================================

Section is a first-class EDITOR capability, not merely a node type
the model can store. The engine's Section is DOMAIN-NEUTRAL: nothing
in §31 knows what a "chapter" or a section code MEANS. Downstream
products attach meaning through `sectionCode`; the engine MUST NOT
grow medical (or any other domain's) vocabulary.

------------------------------------------------------------
31.14.1 The authoring surface
------------------------------------------------------------

    Editor.insertSection(opts)        → new section id | null
        opts: afterBlockId | containerId+index,
              withInitialParagraph?, sectionCode?

    Editor.insertChildSection(sectionId, opts)   → id | null
    Editor.selectSection(sectionId | null)
    Editor.getSelectedSectionId()                → string | null
    Editor.moveSectionUp(sectionId)   → boolean
    Editor.moveSectionDown(sectionId) → boolean
    Editor.moveSectionTo(sectionId, toParentId, toIndex) → boolean
    Editor.setSectionCode(sectionId, code?)      → boolean
    Editor.getSectionCode(sectionId)             → string | undefined
    Editor.listSections()             → SectionTreeEntry[]
    Editor.getSectionClientRects(sectionId)      → SectionPageRect[]
    Editor.setShowSectionStructure(boolean)

EVERY mutation above goes through the command system (§5). The facade
resolves WHERE (the real container + real index, §31.6) and delegates
the WHAT to a command; commands stay dumb.

------------------------------------------------------------
31.14.2 Placement resolution, and the §31.13 rejection
------------------------------------------------------------

`sectionsOf` / `sectionOf` answer "which sections exist / whose is
this"; `resolveBlockParent` (§31.6) answers "where does this block
live". Placement is derived from those — never from a re-walk.

MUST: an insert whose target container is not `body` or a Section is
REJECTED (returns null, mutates nothing, pushes no undo entry). A
Section inside a cell / header / footer is an illegal structure
(§31.13), not an unimplemented feature. The rejection happens BEFORE
any mutation, and MUST NOT rely on NodePool throwing — an uncaught
throw would escape CommandManager into a UI event handler.

------------------------------------------------------------
31.14.3 "Model allows empty" vs "editor creates a paragraph"
------------------------------------------------------------

These are DIFFERENT facts and MUST NOT be conflated:

    Section.children = []    always LEGAL (§31.13). A section with no
                             content is a valid state.

    withInitialParagraph     an EDITOR UX default (true). It only
                             answers "should creating a section also
                             give the caret somewhere to land".
                             `false` yields the legal empty section.

Neither the model nor NodePool may grow a rule that a Section must
have children. The UI default exists because an empty section has no
content span, therefore no geometry, therefore nothing to draw — see
§31.14.6.

------------------------------------------------------------
31.14.4 Delete — subtree removal, and the body-editability repair
------------------------------------------------------------

Deleting a Section deletes the container AND its whole subtree, the
same as deleting a table. Undo restores it from a subtree snapshot.

A Section, once deletable, makes an EMPTY BODY reachable (today the
paragraph path refuses to delete the last paragraph). "The body stays
editable" is an EDITOR-layer invariant, NOT a Section model rule, and
it is satisfied by the SAME primitive the engine already used:
`EnsureBodyParagraphCommand`'s repair, folded into the delete command
via `RemoveNodesCommand`'s `ensureBodyParagraph` option.

MUST: that repair live in the SAME command, not in a
`MacroCommand{Remove, EnsureBodyParagraph}`. The macro form is NOT an
exact inverse: on undo the inverses run in reverse, and
`EnsureBodyParagraphCommand` always inserts at index 0 while
`RestoreNodesCommand` restores at the snapshot index — the restored
document gains one stray empty paragraph. The opt-in flag removes the
paragraph it created before restoring, so undo is exact. This is
asserted by test; do not "simplify" it back into a macro.

The option defaults to false, so every pre-existing caller is
byte-identical.

------------------------------------------------------------
31.14.5 Section selection is NOT text selection
------------------------------------------------------------

`selectedSectionId` lives in `EditorStore` (§7.2), shaped exactly like
`designSelectedControlId` (§12.3): transient, keyed by node id, never
serialized. It MUST NOT be put into `SelectionState` /
`SelectionGranularity`: those are a pure TEXT range whose
`paragraphPath` must end in a text container, and ~30 consumers read
them. Writing a section id into the paragraph slot is precisely the
outline defect §31.14.8 records.

Structural selection and text selection are MUTUALLY EXCLUSIVE, the
semantics the engine already uses for table-cell selection (clicking
outside a table, or starting a text selection inside one, clears it).
Two rules make divergence impossible:

    selectSection(id)      sets the caret into the section (first
                           descendant paragraph; `[]` for an empty
                           section), collapses the text selection, and
                           writes the id LAST.

    EditorStore.setCursor  is the SINGLE clearing point: any caret
                           move, from any source (mouse, keyboard,
                           command), clears `selectedSectionId`.

Because the write happens after the caret move, `selectSection`
cannot clear itself; and because every other caret move clears it,
"the UI highlights section A while the caret sits in section B" is
not constructible.

------------------------------------------------------------
31.14.6 Geometry — a section has no item of its own
------------------------------------------------------------

W2 expands Sections in place, so a Section emits NO line, NO SLIF item
and NO pixels. It has no geometry of its own; it has DESCENDANTS, and
their items' union is its span. `Draw.getAllSectionClientRects`
derives it. Three properties are load-bearing:

  - The descendant id set MUST include INLINE node ids. A paragraph's
    text item carries the inline node's id; only an EMPTY paragraph's
    placeholder item carries the paragraph id.
  - Both `page.items` (where a table CONTAINER item lives) and
    `getFlatPageItems(page)` (which flattens cell-inner items and
    deliberately EXCLUDES the container) MUST be scanned.
  - Attribution MUST accumulate up the ANCESTOR CHAIN (R1 `sectionOf`
    returns the parent section). Attributing to the nearest section
    only would leave a hole in every outer section's span wherever
    content sits in a nested section.

RECTS ARE PER PAGE, NEVER A CROSS-PAGE UNION. A section can break
across pages; one union rect would swallow the page gap and everything
between. Each rect also carries `contentLeft` / `contentRight` from
`pageSetup` margins — a paragraph item's `x` includes its indent and
can be moved by alignment, so it must NOT be used as the column edge.

AN EMPTY SECTION HAS NO RECTS. That is an honest result (no content,
no span), not a defect. It is why §31.14.3's editor default exists,
and why the outline row for an empty section carries no
`paragraphPath` (§31.14.8).

------------------------------------------------------------
31.14.7 The overlay is a PURE UI LAYER
------------------------------------------------------------

`components/editor/SectionStructureOverlay` draws the per-section left
rule (indented by nesting depth) with its `sectionCode` label, plus a
highlight box for the selected section. The dependency is ONE-WAY: the
overlay consumes the Editor facade; no engine module imports it, and
the engine does not know it exists.

MUST: turning the structure display off — or never mounting the
overlay at all — leaves Section STRUCTURE, COMMANDS, SELECTION,
SERIALIZATION and HISTORY completely unaffected. Visualization and
capability are orthogonal, and a test asserts it.

MUST NOT: add a Section model field, or any engine-side state, in
order to draw. Geometry is derived (§31.14.6); the only new state is a
boolean view flag plus the selected id, both in `EditorStore`.

------------------------------------------------------------
31.14.8 Outline projection
------------------------------------------------------------

The outline is built by a pure function (`components/sidebar/
outlineModel`) walking the STRUCTURE TREE in pre-order, so a Section
row lands BEFORE its content — the tree entry point is
`pool.getChildren(doc.id)` (§31.1), not a logical-flow walk: the
outline needs section boundaries, and W2/W3 exist precisely to erase
them. Heading text / level / page number are reused from
`TOCGenerator`; the section row's `level` is its nesting depth.

MUST NOT: fabricate a `paragraphPath` for a section row. An EMPTY
section has no paragraph, and putting the section id into the
paragraph slot produces a `CursorState` the engine cannot resolve —
no caret is drawn and no scroll happens. A section row carries
`sectionId` and an EMPTY `paragraphPath` when it has no paragraph.

------------------------------------------------------------
31.14.9 Context menu — a FACT, not a new kind
------------------------------------------------------------

The menu gains section entries from `ContextFacts.sectionFact`, an
ADDITIONAL FACT collected at the boundary, exactly like
`tableGrowable` / `headerFooterSection` — NOT from a new
`kind: 'section'`. A Section has no hittable item, so such a kind
would be UNREACHABLE; worse, a new kind would REPLACE `kind: 'text'`
and delete the cut/copy/format menu the user needs at that moment.

The field is named `sectionFact`, not `section`: the latter is already
taken by `HeaderFooterContext.section`, which means the header/footer
BAND and is unrelated to the structural container (§31.11).

Every section entry's enabled state is derived from the fact, so the
menu never lies: "insert section" is greyed where §31.14.2 forbids it,
and the move entries are greyed at the first/last slot — matching the
facade's own pre-check, which likewise refuses without pushing an undo
entry.

------------------------------------------------------------
31.14.10 Known limitations (recorded, NOT silently ignored)
------------------------------------------------------------

  - A Section does NOT round-trip through the in-memory clipboard. The
    clipboard DTO is a FLAT paragraph form (`SerializedPara` with leaf
    children), copy walks the paragraph spine (which expands Sections
    away), and paste re-ids only the top node and known leaf types
    without remapping nested `children` — a container admitted there
    would dangle. Making this work needs three things, none of them
    present today: a container-capable serialization form, a RECURSIVE
    id-remapping clone, and a container-level paste command. The one
    existing precedent for "clone a container subtree with fresh ids"
    is `AppendTableRowCommand`'s type-dispatched factory rebuild.
    Until then, copying a range that spans a Section copies its
    paragraphs as flat text and the boundaries are lost.

  - `sectionCode` uniqueness is NOT enforced. Structured export (CDA)
    and section-level targeting locate a section BY code, so two
    sections sharing one code are ambiguous. Adding a uniqueness rule
    is a new user-visible semantic and belongs to a later phase; the
    engine records the ambiguity rather than inventing an error now.

  - A section whose only child is a BLOCK-LEVEL image has no geometry:
    the body layout loop has branches for section_break / separator /
    table / paragraph and no fallback, so a block image emits no item
    at all. That is a PRE-EXISTING engine gap (a body-level image is
    already invisible), not a Section regression; this section forbids
    growing a Section model field to paper over it, and layout is not
    in scope here.

  - The outline is a FLAT list indented by level, not a collapsible
    tree. Nesting renders correctly; folding does not exist yet.

============================================================
32. DISTRIBUTION PACKAGE BOUNDARY
============================================================

The engine is DISTRIBUTED as a package, not only consumed in-tree.

The package is PHYSICALLY SEPARATED from the application. Its root is
`packages/emr-document-engine/`, and it holds SOURCE, manifest and
build config together:

    packages/emr-document-engine/
        package.json      manifest (name @emrde/document-engine)
        vite.config.ts    lib build (four entries)
        tsconfig.json     declaration build
        src/engine/       engine core
        src/platform/dom/ browser host
        src/platform/react/ React adapter
        src/lib/          export / print / provenance feature layer
        dist/             build output (gitignored)

The four source subtrees keep the same relative positions they had
before the split (`frontend/src/{engine,platform,lib}`), which is why
every pre-existing relative import inside the package still resolves
verbatim.

The APPLICATION imports the package BY NAME. Its manifest declares
subpath entries:

    "."        engine core        (src/engine/index.ts)
    "./dom"    browser host       (src/platform/dom/index.ts)
    "./react"  React adapter      (src/platform/react/index.ts)
    "./export" export / print     (src/lib/export/index.ts)

Consequences that are BINDING, not stylistic:

32.1 A file that enters the distributed package MUST NOT import
     through a build-time alias (the @/ prefix). Aliases are a
     bundler convenience and are NOT rewritten into the emitted
     .d.ts; an alias in shipped source produces declarations no
     external project can resolve. Packaged files import
     RELATIVELY.

32.2 The engine directory MUST NOT grow re-export shims that point
     at platform/ or the UI, purely to expose them from the
     package. The §27 dependency direction is unchanged by
     packaging — a shim IS a dependency. dom / react / export
     enter the package as BUILD ENTRIES, never as files under
     engine/.

32.3 The engine core entry is safe to import with no DOM (§29).
     The "./dom", "./react" and "./export" entries are NOT: they
     are browser-side by construction. A consumer that needs
     Node / Worker / SSR MUST import the core entry alone.

32.4 React is a PEER of the "./react" entry only. The core, dom
     and export entries MUST NOT acquire a React dependency
     through packaging (§10).

32.5 Distributed output MUST remain readable Source Code Form
     (IP-POLICY §5): the library build MUST NOT minify, mangle or
     obfuscate.

32.6 The package manifest and its build output MUST NOT live inside
     a directory the application resolves through an alias.

     The physical split makes this structurally impossible — the
     package root and the application source tree are separate
     directories under the repository root, and the application's
     `@/` alias is anchored to its OWN src/ (regex `^@\//`, not a
     bare `@`). The rule is retained as a REGRESSION GUARD: moving
     the package back under the application tree is one `mv`, and
     the failure it causes is silent.

     WHY it is load-bearing, not tidiness: if a manifest lands in a
     directory an application alias resolves to, Vite reads its
     `exports` and resolves the bare specifier to `dist/index.js` —
     the BUILT bundle — while deep specifiers still resolve to
     SOURCE. The app then holds TWO module instances of the engine:
     module-level state (ErrorRecovery's reporter, the locale
     singleton, the id counters) splits in half. It does not fail
     loudly — it fails as a silently dead wire. Measured, not
     theorised: with dist/index.js present under the aliased
     directory, ErrorReporting.test.ts fails because the store
     reporter was installed into one copy and the loader reported
     into the other.

     Enforcement: `frontend/src/__tests__/EnginePackageBoundary.test.ts`.

32.7 The application's alias to the package MUST point at the
     package SOURCE, never at its build output. Development is
     ZERO-BUILD: editing an engine file must take effect without
     running `engine:pack` first. Distribution is a separate
     consumer path and goes through the manifest's `exports` →
     `dist`, so the two never have to agree on where the bytes
     come from.

     Corollary — the application's own alias MUST NOT be a bare `@`
     prefix, or it will hijack the scoped package name
     (`@emrde/document-engine` starts with `@`). It is anchored:
     `^@\//`.

     Corollary — the package has NO node_modules of its own. The
     repository ships a single dependency tree
     (`frontend/node_modules`) and deliberately does not use npm
     workspaces: no root lockfile, no install step. The package's
     runtime dependencies (react as a peer, fflate) are resolved by
     explicit alias / `paths` entries in the application config,
     and by the consumer's own package manager after distribution.

