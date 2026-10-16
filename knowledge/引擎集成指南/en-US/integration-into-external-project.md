# @emrde/document-engine — Integration Guide

Embed the EMR document engine in your project. This guide covers four host types —
**React**, **Vue**, **vanilla JS**, and **pure Node / Worker** — plus import/export,
theming, i18n, and licensing.

> Audience: developers integrating the engine for the first time.
> If you only want the shortest path that works, read §1 and the section for your
> framework; the rest is reference.

---

## 0. What the engine is

A **framework-agnostic, platform-agnostic** electronic-medical-record document
editing kernel.

```
@emrde/document-engine
├─ "."       Engine core    document model / commands / layout / render / events / i18n / serialization
├─ "./dom"   Browser host   canvas surfaces / IME / clipboard / IndexedDB autosave
├─ "./react" React adapter  EditorProvider + 4 hooks
└─ "./export" Export layer  TXT / HTML / structured elements / HL7 CDA / OFD / print records
```

Two facts determine whether and how you can use it:

1. **The core entry touches no browser global** (no `document` / `window` /
   `navigator` / `indexedDB`). All platform capability enters through one injected
   interface object, `EditorHost`. So the core entry can be `import`ed in Node,
   Web Workers, and SSR without throwing.
2. **The engine assumes nothing about your framework.** The React adapter is a
   convenience layer we ship; Vue / Svelte / vanilla JS use the `./dom` browser host
   and the three wiring steps in §4 — the engine itself needs no change.

---

## 1. Installation

The engine is **not published to the npm registry**; install it from a tarball built
out of the repository.

### 1.1 Get the package (pick one)

**A. Build it inside the engine repo:**

```bash
git clone <engine-repo>
cd <engine-repo>
npm --prefix frontend install      # install the frontend dependency tree first
                                   # (this repo deliberately ships no npm workspaces — one tree only)
npm run engine:pack                # artifact: dist-packages/emrde-document-engine-<version>.tgz
```

**B. Use an existing tarball:** `dist-packages/*.tgz` (if one has already been built).

To first prove "the package can be imported by a project OUTSIDE this repo", run:

```bash
npm run engine:verify
```

It extracts the tarball into a temporary directory **outside the repo**, lays it out
as a real `node_modules`, and runs a consumer script — verifying the package's own
`exports` map, not the repo's path aliases.

### 1.2 Install into your project

```bash
npm install /abs/path/to/emrde-document-engine-21.0.0.tgz
# or pnpm add / yarn add
```

`react` / `react-dom` are **optional** peer dependencies: you do not need them if you
only use the core or the export layer.

---

## 2. Subpaths and runtime environments

| Subpath | Purpose | Importable without DOM? |
|---|---|---|
| `@emrde/document-engine` | Engine core: model, commands, layout, serialization, i18n | ✅ Yes |
| `@emrde/document-engine/dom` | Browser host implementation | ❌ Needs a browser |
| `@emrde/document-engine/react` | React adapter | ❌ Needs React + DOM |
| `@emrde/document-engine/export` | Export / print pure functions | ✅ Yes (OFD zipping needs `fflate`) |

> **`fflate` is the only runtime dependency.** It comes from the package's
> `dependencies`; you do not install it yourself.

---

## 3. React

### 3.1 Shortest path that works

```tsx
import { useRef } from 'react'
import { EditorProvider, useEditorRef, useEditorStoreSnapshot } from '@emrde/document-engine/react'

export function App() {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    // Container must be position:relative with a definite height; the engine's canvas layers mount inside it
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <EditorProvider containerRef={containerRef} document={doc}>
        <MyToolbar />
      </EditorProvider>
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflowY: 'auto' }} />
    </div>
  )
}

function MyToolbar() {
  const editorRef = useEditorRef()
  const isDirty = useEditorStoreSnapshot((s) => s.isDirty)
  const canUndo = useEditorStoreSnapshot((s) => s.runtime.history.canUndo)

  return (
    <>
      <button disabled={!canUndo} onClick={() => editorRef.current?.undo()}>Undo</button>
      <button disabled={!editorRef.current?.canRedo()} onClick={() => editorRef.current?.redo()}>Redo</button>
      <span>{isDirty ? 'Unsaved' : 'Saved'}</span>
    </>
  )
}
```

`document` is optional: omit it and you get an editable blank document.

### 3.2 The four hooks

| hook | Returns | Use |
|---|---|---|
| `useEditorRef()` | `RefObject<Editor \| null>` | Call Editor APIs (stable reference) |
| `useEditor()` | `Editor \| null` | Same, but non-null **only once the Editor is ready** |
| `useEditorReady()` | `boolean` | When you need a "ready" boolean to sync across effects |
| `useEditorStoreSnapshot(sel)` | selected projection | Subscribe to runtime state and re-render React |

**Two traps you must know:**

- ❗ **A child's mount effect runs BEFORE the parent's effect.** The Provider creates
  the Editor in its own `useEffect`, so inside a child's mount, `editorRef.current`
  is **always `null`**. To attach listeners from a child, depend on `useEditorReady()`
  (or `useEditor()`), not on `editorRef.current` — otherwise listeners are silently
  never bound.
- ❗ **`useEditorStoreSnapshot` re-renders on a `version` change**, not on object
  identity. A selector returning a fresh object (e.g. `(s) => ({ a: s.a })`) is safe,
  but do **not** do heavy computation inside the selector — it runs every render.

### 3.3 Controlled props

`EditorProvider` deliberately **depends on no application store**; theme and
dictionaries are passed in from your own state:

```tsx
<EditorProvider
  containerRef={containerRef}
  document={doc}
  themePreset={themePreset}          // 'standard' | 'eyeCare' | 'print' | 'dark'
  dictionaries={dictionaryProvider}  // external dictionary candidate source (optional)
  autoFocus={true}                   // with several editors on a page, usually only one takes focus
>
```

- `themePreset` change → the adapter calls `editor.setTheme()` and repaints the canvas.
- `dictionaries` is an injection source **read once at creation** (changing documents
  does not reset it). Pass your own `DictionaryStore`; without it, controls fall back
  to free-text input.
- Locale is a **process-level singleton**, not a prop — see §7.

---

## 4. Vue / Svelte / Vanilla JS (manual wiring)

What the engine gives you is a **framework-agnostic host** plus a **subscribable state
object**. The React adapter does three things; reproduce them equivalently in Vue:
**① build the host and mount it; ② build the Editor; ③ bridge the store / locale
subscriptions into your reactive system.**

### 4.1 Install the host

```bash
npm install @emrde/document-engine
```

### 4.2 Three wiring steps

```ts
import { Editor, locale } from '@emrde/document-engine'
import { createDomEditorHost } from '@emrde/document-engine/dom'

// ① Build the browser host and mount the rendering surface / input surface to the container
const host = createDomEditorHost()
host.surface.mount(containerEl)   // container needs position:relative + definite height
host.input.mount(containerEl)

// ② Build the Editor (constructor does first layout + render + starts cursor blink)
const editor = new Editor(host, doc)

// ③ Container scroll → engine viewport sync
containerEl.addEventListener('scroll', () => {
  editor.syncScrollPosition(containerEl.scrollTop)
}, { passive: true })
```

> ⚠️ **Scroll sync has no default implementation.** The engine listens for keyboard,
> mouse, focus, and visibility, but **does not listen to the container's `scroll`
> event** — skip this and the canvas misaligns/blank while scrolling. The React
> adapter does not do it for you either (the demo app wires it itself). Every
> framework must do it.

### 4.3 Vue 3: bridge engine state into reactivity

Both `EditorStore` and `locale` implement `subscribe(listener) => unsubscribe` +
`getVersion()` (the same shape, easy to copy). The simplest bridge is a `shallowRef`
plus a version counter:

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, computed } from 'vue'
import { Editor, locale } from '@emrde/document-engine'
import { createDomEditorHost } from '@emrde/document-engine/dom'

const containerEl = ref<HTMLDivElement | null>(null)
const editor = shallowRef<Editor | null>(null)
const version = ref(0)          // bumping this re-runs any computed / template that reads it

let unsubStore = () => {}
let unsubLocale = () => {}

onMounted(() => {
  const host = createDomEditorHost()
  host.surface.mount(containerEl.value!)
  host.input.mount(containerEl.value!)

  const ed = new Editor(host)
  editor.value = ed

  unsubStore = ed.getStore().subscribe(() => { version.value++ })
  unsubLocale = locale.subscribe(() => { ed.refreshForLocale(); version.value++ })

  const onScroll = () => ed.syncScrollPosition(containerEl.value!.scrollTop)
  containerEl.value!.addEventListener('scroll', onScroll, { passive: true })
  onBeforeUnmount(() => containerEl.value?.removeEventListener('scroll', onScroll))
})

onBeforeUnmount(() => {
  unsubStore(); unsubLocale()
  editor.value?.destroy()      // MUST call: unbinds globals, tears down autosave, removes canvases
})

// Read the snapshot through the version (accessor reads latest; version is only the dependency trigger)
const isDirty = computed(() => { version.value; return editor.value?.getStore().state.isDirty ?? false })
const canUndo = computed(() => { version.value; return editor.value?.canUndo() ?? false })
</script>

<template>
  <div>
    <button :disabled="!canUndo" @click="editor?.undo()">Undo</button>
    <span>{{ isDirty ? 'Unsaved' : 'Saved' }}</span>
    <div ref="containerEl" style="position: relative; height: 600px; overflow-y: auto" />
  </div>
</template>
```

> 💡 The lone `version.value;` inside `computed` is a **deliberate dependency
> declaration**: engine state mutates **in place**, so the snapshot object identity
> does not change — only `version` increments monotonically. Reading `version.value`
> is how you tell Vue "this needs recomputing".

### 4.4 Vanilla JS

```js
const host = createDomEditorHost()
host.surface.mount(el); host.input.mount(el)
const editor = new Editor(host)

editor.getStore().subscribe(() => {
  document.querySelector('#dirty').textContent = editor.getStore().state.isDirty ? 'Unsaved' : 'Saved'
})
editor.on('contentChange', () => console.log('document changed'))
el.addEventListener('scroll', () => editor.syncScrollPosition(el.scrollTop), { passive: true })

window.addEventListener('beforeunload', () => editor.destroy())
```

### 4.5 Manual-wiring checklist (don't skip these)

| # | Item | If omitted |
|---|---|---|
| 1 | `host.surface.mount(el)` / `host.input.mount(el)` | Layer creation throws `mount(container) must be called before creating layers` |
| 2 | Container `position:relative` + definite height | Canvas mispositioned / no scroll area |
| 3 | `scroll` → `editor.syncScrollPosition(t)` | Scroll misalignment (**no default implementation**, see §4.2) |
| 4 | Subscribe to `locale` → `editor.refreshForLocale()` | Canvas does not refresh after a language switch (field date formats unchanged) |
| 5 | `editor.destroy()` on unmount | Global listeners, IndexedDB, and the cursor timer leak |
| 6 | Repaint when the container resizes (see §4.6) | Canvas size does not follow a window/container resize |

### 4.6 Container resizing

The engine ships **no `ResizeObserver`** — viewport size is read from the host's
`viewport.size()`, and it needs an external trigger to repaint. On container resize,
fire one:

```js
const ro = new ResizeObserver(() => {
  editor.getEventBus().emit('render:request')   // engine re-measures the viewport and repaints
})
ro.observe(containerEl)
// ro.disconnect() on unmount
```

### 4.7 Other frameworks

Svelte / Solid / Angular are the same — the engine's only contract is
**`subscribe(...) => unsubscribe` + `getVersion()`**. Bridge those two into your
framework's reactive primitive; the engine needs no adapter layer.

---

## 5. Pure Node / Worker (no UI)

Reading and writing documents **needs no host at all**: `loadDocument` /
`serializeDocument` are pure data functions that do not even need an `EditorHost`.
Good for server-side persistence, batch processing, and export pipelines.

```ts
import { loadDocument, serializeDocument, buildNodePool } from '@emrde/document-engine'

// Load from a JSON string (internally: detect version → compatibility → upgrade → validate → build model → build pool)
const { doc, pool, wasUpgraded, sourceVersion } = loadDocument(jsonString)

// Mutate the data… (with no Editor, operate on the model directly)

// Serialize back to JSON (the dual of loadDocument; byte-for-byte round-trippable)
const saved = serializeDocument(doc, pool)
```

> The JSON produced by serialization **must carry the flat node table** (the `nodes`
> field). A `body.children` id list without the node table loses the entire payload on
> reload. Use `serializeDocument` to produce it; do not hand-assemble.

The export layer is also pure and runs without DOM:

```ts
import { buildExportText, buildExportHtml, collectFields, buildCdaXml } from '@emrde/document-engine/export'

const txt = buildExportText(doc, pool)
const html = buildExportHtml(doc, pool)

// Structured exports (CDA / OFD / structured elements) share one field projection
const projection = collectFields({
  doc, pool,
  templateDefinitions: /* your TemplateDefinitionStore */,
  sectionTree: sectionTreeOf(doc, pool),
})
const cda = buildCdaXml({ projection, document: { id: doc.id, title: doc.title } })
```

---

## 6. Document model at a glance

```ts
import { createDocument, createParagraph, createTextNode, buildNodePool } from '@emrde/document-engine'

// A blank document
const doc = createDocument('My Record')

// Hand-build "one paragraph of text" and build the pool
// (all write paths go through the structure tree + the flat node table)
const para = createParagraph()
const text = createTextNode('Chief complaint: ')
para.children = [text.id]
doc.body.children = [para.id]

const flat = new Map([[para.id, para], [text.id, text], [doc.id, doc]])
const pool = buildNodePool(flat, { body: doc.id })
```

**Two ironclad rules** (these decide whether data is silently corrupted):

- 📌 **A document is a "flat node table + id references".** A node's `children` holds
  ids, not objects. Serialization must include the `nodes` table.
- 📌 **Don't mix the two traversal entry points:**
  - **Structure tree** (real indices / siblings / container identity / serialization)
    → use `pool.getChildren(id)`;
  - **Logical reading order** → use the engine's walkers `bodyBlockSpine` /
    `bodyParagraphSpine` (in `SelectionCollector`).

  The engine enforces this with a static CI gate that forbids iterating
  `doc.body.children` outside the walker — because it gives wrong results for
  documents containing sections or nested tables. Follow the same rule in your
  extension code.

---

## 7. Internationalization

`locale` is an **engine-level singleton** (not per-Editor instance state):

```ts
import { locale } from '@emrde/document-engine'

locale.setLocale('en-US')     // 'zh-CN' | 'en-US'
locale.getLocale()            // current locale
const unsub = locale.subscribe(() => { /* re-render your UI */ })
```

- The canvas does **not** refresh itself after a language switch: call
  `editor.refreshForLocale()` (the React adapter does it for you; manual wiring must
  call it — see §4.5 item 4). It re-lays out and repaints (field date formats change
  width with the language) but does **not** mark dirty and does **not** enter the undo
  stack — language is not document content.
- Engine-side messages (errors, QC) come from the engine's built-in message packs.
  **Your own UI copy is yours to internationalize.**

---

## 8. Theming

The engine **ships no CSS**. There are two token sets — don't confuse them:

| Token set | Owner | Affects |
|---|---|---|
| `canvasTokens` (28) | Held in engine memory | **Canvas content** (paper, ink, caret color…) |
| CSS variables (you define) | Your app | **Your chrome** (toolbar, buttons, background…) |

Switch the canvas theme:

```ts
editor.setTheme('dark')       // 'standard' | 'eyeCare' | 'print' | 'dark'
editor.getTheme()
```

In React, pass the `themePreset` prop (see §3.3).

To theme your **chrome** too, subscribe to theme changes yourself and map colors to
CSS variables — the engine does not mandate a form (the demo app maps to `--emr-*`
variables, which you may take as a reference, but that is an application-side choice).

---

## 9. Modes

```ts
type EditorMode = 'edit' | 'readonly' | 'form' | 'clean' | 'design' | 'print'
editor.setMode('form')
```

| Mode | Semantics |
|---|---|
| `edit` | Full editing (designer + filler) |
| `readonly` | Read-only browse |
| `form` | Fill control values only; structure edits blocked |
| `clean` | Clean presentation (editing affordances hidden) |
| `design` | Design time: edit control definitions |
| `print` | Print state |

---

## 10. Editor API at a glance

`Editor` is the single facade. Commonly used methods (full list in the package's
`dist/types/engine/Editor.d.ts`):

**Document**: `setDocument` / `getDocument` / `getSerializedDocument` /
`getDocumentTitle` / `setDocumentTitle` / `getDocumentMetadata` / `applyDocumentProperties`

**Editing**: `undo` / `redo` / `canUndo` / `canRedo` / `copy` / `cut` / `paste` /
`selectAll` / `deleteSelection` / `deleteNode` / `moveBlock` / `insertTable(rows, cols)` /
`insertImage(dataUrl)` / `insertFieldCode(type)` / `insertFootnote` / `insertBookmark` /
`insertSection(opts?)` / `insertControl(element, def?)` / `pasteSpecial(fmt)`

**Controls**: `setControlValue(nodeId, value)` / `getControlValue(nodeId)` /
`getControlSnapshot(nodeId)` / `getElement(nodeId)` / `applyControlConfig(...)` /
`computeControlScore()`

**Computed values** (see §10.1): `registerCalcFunction(name, fn)` /
`getComputedDisplay(nodeId)` / `isControlVisible(nodeId)` / `getFormulaErrors()` /
`evaluateFormula(formula, nodeId?)`

**Projection / queries**: `getWordCount()` / `runQC()` / `findAll(query, opts)` /
`findNext` / `replaceAll` / `getSelectedControlId()` / `selectSection(id)` /
`listSections()` / `getComments()`

**Infrastructure**: `getStore()` / `getPool()` / `getDraw()` / `getEventBus()` /
`getPluginManager()` / `setTheme(preset)` / `refreshForLocale()` / `setMode(mode)` /
`setScale(scale)` / `focus()` / `destroy()`

**Events**: `on(type, cb)` / `off(type, cb)`, where `type ∈ 'ready' | 'contentChange' |
'modeChange' | 'selectionChange' | 'save'`.

### 10.1 Computed values (formulas)

A template author gives a control a **formula** (`TemplateDefinition.formula`) and the
engine evaluates it on the read path. You do not have to wire anything for it: the
formula lives in the template definition, and the value it produces is shared by layout
and rendering through **one memoised set**.

```ts
import type { CalcValue, CalcError } from '@emrde/document-engine'

// Register your own pure function (optional). Names are case-insensitive.
editor.registerCalcFunction('BMI', (args: readonly CalcValue[]): CalcValue | CalcError => {
  const [w, h] = args
  if (typeof w !== 'number' || typeof h !== 'number') {
    return { code: 'bad_arguments', message: 'BMI(weightKg, heightCm)' }  // errors are classified, not one generic message
  }
  return Math.round((w / ((h / 100) ** 2)) * 10) / 10
})

// Read side (for an authoring UI; most hosts never need it)
editor.getComputedDisplay(nodeId)   // derived display text; undefined when there is no formula / it fails
editor.isControlVisible(nodeId)     // result of SHOW/HIDE; true when there is no formula
editor.getFormulaErrors()           // classified errors (unresolved / ambiguous / syntax / unknown function / cycle ...)
editor.evaluateFormula('[SBP] - [DBP]', nodeId)  // try out a candidate formula (no leading =)
```

A reference is written as `[key]`, and that key is the control **binding key** (data
element code first, identifier as fallback) — the same key the bulk binding API
(`getBoundValues` / `setBoundValues`) uses. When one key matches several controls, a
reference to it **reports an ambiguity and the whole formula fails to evaluate**: the
engine never picks a winner, because a silently picked value reads as computed while
being wrong.

Four things you must know:

- **The evaluator touches no host global and never runs arbitrary JavaScript.** It is a
  lexer plus syntax-tree evaluator over a whitelisted grammar (references, literals,
  arithmetic, comparison, logic, ternary, a closed builtin table). A formula can call
  builtins and the pure functions **you** registered through `registerCalcFunction` —
  **a registered function has the plugin trust level** (it is your own code), never
  end-user data. Do not register user input as a function name.
- **The result is derived and is never persisted.** It is not written into the field
  value, so the "required" gate **cannot see it** (`validateRequired` still reports the
  field as missing when the doctor did not fill it), it never lands on the undo stack,
  and re-opening a saved document yields the same computed value (unless a dependency
  changed — see the next point).
- **The time basis is read once, when the set is recomputed, and does not tick while the
  document sits idle.** A value like `GETAGE()` does not drift over time on its own.
  For a medical record that is **intended**: a value the doctor has read must not change
  behind their back before signing. If you need "refresh to now", trigger a document
  change or re-`setDocument` from the host.
- **Change formulas through `applyControlConfig`** (the same path as any other control
  property), which re-lays out the page. Mutating the private `templateDefinitions` map
  directly will not.

---

## 11. License and forensic provenance

The engine is distributed under **MPL-2.0**, in **readable Source Code Form** (no
minification, no obfuscation — see `IP-POLICY.md` §5 in the repo). `LICENSE` and
`NOTICE` ship inside the package.

Export artifacts (HTML / TXT / JSON / XML) carry an **invisible provenance marker** (a
zero-width-character `EMRDE1` frame) linking back to the repo and commit. This is a
deliberate forensic feature, not a bug; a `verify:provenance` tool in the repo decodes
and verifies it.

---

## 12. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `mount(container) must be called before creating layers` | Forgot `host.surface.mount(el)` (§4.5-1) |
| Canvas misaligns/blanks while scrolling | Did not wire `editor.syncScrollPosition(t)` (§4.2) |
| `editorRef.current` is always `null` in a child | Child effect runs before parent effect; use `useEditorReady()` (§3.2) |
| Canvas does not refresh after a language switch | Did not call `editor.refreshForLocale()` (§4.5-4) |
| Canvas size wrong after a window resize | Did not wire `ResizeObserver` → `render:request` (§4.6) |
| Document is empty after reloading | Serialization missing the flat node table `nodes` (§6) |
| Consumer sees types as `any` | Package `exports` `types` path does not match the declaration tree (a packaging issue — report to the engine maintainers) |
| Two engine instances at runtime | The package resolved to both "source" and "build output" — check whether your aliases / `exports` contradict each other |
