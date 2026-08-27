// ============================================================
// 引擎统一导出 (ModelD v20.34)
// ============================================================

export { Editor } from './Editor'
export { Draw } from './render/Draw'
export { TextMeasurer, textMeasurer } from './layout/text/TextMeasurer'
export { LineBreaker } from './layout/line/LineBreaker'
export { PageBreaker } from './layout/page/PageBreaker'
export { TextParticle } from './render/particles/TextParticle'
export { SeparatorParticle } from './render/particles/SeparatorParticle'
export { ListParticle } from './render/particles/ListParticle'
export { Position } from './state/Position'
export { CoordinateSystem } from './state/CoordinateSystem'
export { NodePool, buildNodePool, traversePool } from './document/NodePool'

// EventBus
export { EventBus } from './interaction/EventBus'
export type { EventPayloadMap, EngineEvent } from './interaction/EventBus'

// Layout
export { LayoutEngine } from './layout/core/LayoutEngine'
export type { LayoutConfig } from './layout/core/LayoutContext'
export type { LayoutResult } from './layout/core/LayoutResult'
export type { SLIFItem, SLIFPage, SLIF } from './layout/core/SLIF'
export { resolveLineHeight, DEFAULT_FONT_METRICS } from './layout/text/FontMetrics'
export type { FontMetrics } from './layout/text/FontMetrics'
export { LayoutCache } from './layout/incremental/LayoutCache'

// Render
export { LayeredRenderer } from './render/LayeredRenderer'
export type { WatermarkConfig } from './render/LayeredRenderer'
export { HitTestIndex } from './render/HitTestIndex'

// EditorRuntimeState
export {
  createDefaultRuntimeState,
} from './state/EditorRuntimeState'
export type {
  CursorState, SelectionState, SelectionGranularity,
  ViewState, EditorMode, PageMode, IMEState,
  EditorRuntimeState,
} from './state/EditorRuntimeState'
export type { HistoryState } from './state/HistoryState'

// Command
export type {
  ICommand, CommandContext, StatePatch, SerializedCommand,
  MergeableCommand, InvalidationScope,
} from './command/ICommand'
export { PositionalCommand, generateCommandId } from './command/ICommand'
export { InsertTextCommand } from './command/commands/InsertTextCommand'
export { DeleteRangeCommand } from './command/commands/DeleteRangeCommand'
export { normalizeParagraph } from './command/commands/ParagraphUtils'
export { CommandUndoRedoStack } from './command/CommandUndoRedoStack'
export { CommandManager } from './command/CommandManager'
export { DirtyTracker } from './layout/incremental/DirtyTracker'

// FindReplace
export { FindReplaceEngine } from './FindReplaceEngine'
export type { FindOptions, MatchResult } from './FindReplaceEngine'

// TOC
export { TOCGenerator } from './render/TOCGenerator'
export type { TOCEntry, TOCConfig } from './render/TOCGenerator'

// Footnote
export { FootnoteLayout } from './layout/footnote/FootnoteLayout'
export type { FootnoteEntry, FootnoteConfig } from './layout/footnote/FootnoteLayout'

// ModelD — 树形文档模型
export {
  NodeType,
  DEFAULT_PAGE_SETUP,
  generateId,
  resetIdCounter,
} from './document/DocumentModel'
export type {
  TextStyle, ParagraphStyle, ListStyle,
  ElementCode, ElementFormat, PrivacyConfig, ElementMeta,
  BaseNode, TextNode, SmartTextNode, ImageNode,
  BookmarkNode, CrossReferenceNode, FieldNode, FieldType,
  FootnoteRef, FootnoteContent, CommentMarker,
  InlineNode, Paragraph, Table, ColumnDefinition,
  TablePageBreakRule, TableRow, TableCell,
  SeparatorNode, SectionBreak,
  BlockNode, BodyChild, FlowBody,
  CommentEntry, CommentThread,
  PageSetup, DocumentTree,
} from './document/DocumentModel'

// ModelD — 工具
export {
  createDocument, createParagraph, createTextNode, createSmartTextNode,
  createImageNode, createTable, createTableRow, createTableCell,
  createSimpleTable, createSeparatorNode, createSectionBreak,
  insertAt, removeAt, findById, findByDE, findByInternal,
  takeSnapshot, restoreSnapshot, extractStyle, sameStyle,
} from './document/ElementFormatter'

// ---- R30+: Particles ----
export type { IParticle, RenderOptions } from './render/particles/IParticle'
export { ParticleRegistry, particleRegistry } from './render/particles/ParticleRegistry'
export { textParticle, separatorParticle, fieldParticle } from './render/particles/ParticleAdapters'
export { createFootnoteParticle } from './render/particles/FootnoteParticle'
export { createImageParticle } from './render/particles/ImageParticle'
export { createCommentParticle } from './render/particles/CommentParticle'
export { createTableParticle } from './render/particles/TableParticle'
export { createBarcodeParticle } from './render/particles/BarcodeParticle'
export { createLaTeXParticle } from './render/particles/LaTeXParticle'

// ---- R30+: Engine modules ----
export { AutoSaveManager } from './AutoSaveManager'
export type { SaveEventType, SaveEventListener } from './AutoSaveManager'
export { AutoCorrectEngine } from './AutoCorrectEngine'
export type { AutoCorrectRule } from './AutoCorrectEngine'
export { DocumentDiffer } from './DocumentDiffer'
export type { DiffResult, DiffOperation, TextChange } from './DocumentDiffer'

// ---- R30+: QC ----
export { QCEngine } from './qc/QCEngine'
export type { QCRule, QCIssue, QCResult, QCSeverity, QCGrade } from './qc/QCEngine'

// ---- R30+: System ----
export { EditorTheme, editorTheme } from './state/EditorTheme'
export type { ThemePreset, ThemeColors } from './state/EditorTheme'
export { locale, t } from './i18n/index'
export type { Locale, LocaleMessages } from './i18n/index'
export { VirtualViewport } from './layout/viewport/VirtualViewport'
export type { ViewportState, VisibleRange } from './layout/viewport/VirtualViewport'
export { MemoryManager, LRUMap } from './layout/viewport/MemoryManager'
export type { MemoryStats } from './layout/viewport/MemoryManager'
export { PerformanceMetrics, perfMetrics } from './PerformanceMetrics'
export type { PerfEntry, PerfSummary } from './PerformanceMetrics'
export {
  EditorErrorCode,
  safeRenderParticle, safeRenderPage, safeLoadDocument, safeAsync,
  setErrorReporter,
} from './ErrorRecovery'
export type { EditorError, ErrorReporter, EditorErrorCode as EditorErrorCodeType } from './ErrorRecovery'

// ---- R30+: Font management ----
export { FontManager, fontManager } from './layout/text/FontManager'
export type { FontDescriptor, FontVariant } from './layout/text/FontManager'
export { FontFallback } from './layout/text/FontFallback'
export type { FontRun } from './layout/text/FontFallback'
export { ScriptResolver, scriptResolver } from './layout/text/ScriptResolver'
export type { MultiLangFontConfig } from './layout/text/ScriptResolver'

// ---- R60+: Document management ----
export { ModelUpgrader, modelUpgrader } from './document/ModelUpgrader'
export type { VersionUpgrader, CompatibilityStatus, CompatibilityResult, VersionCompatibility } from './document/ModelUpgrader'
export { VERSION_COMPATIBILITY } from './document/ModelUpgrader'
export type { EditorVersion } from './document/EditorVersion'
export { EDITOR_VERSION } from './document/EditorVersion'
export type { DocumentFormatVersion, SLIFVersion } from './document/DocumentFormatVersion'
export { CURRENT_DOCUMENT_VERSION, CURRENT_SLIF_VERSION, parseVersion, compareVersions, versionToString } from './document/DocumentFormatVersion'
export { MergeMatrix, buildMergeMatrix } from './document/MergeMatrix'
export type { CellSpan } from './document/MergeMatrix'

// ---- R60+: Security ----
export { SecurityChecker, sanitizeHtml, sanitizeText, isSafeHtml } from './security/SecurityConfig'
export type { EditorSecurityConfig } from './security/SecurityConfig'

// ---- R60+: Loaders ----
export {
  DocumentLoaderRegistry, documentLoaderRegistry,
} from './loaders/DocumentLoaderRegistry'
export type { IDocumentLoader, LoadResult } from './loaders/DocumentLoaderRegistry'

// ---- R60+: Plugins ----
export { PluginManager } from './plugins/PluginManager'
export type { IPlugin, PluginContext, ExtensionPoint, ToolbarAction } from './plugins/PluginManager'

// ---- IEditor 公共 API 接口 ----
export type {
  IEditor,
  EditorEventType,
} from './Editor'
export type { EditorListener } from './Editor'

// ---- KaTeX ----
export { renderKaTeXToCanvas, validateKaTeX, measureKaTeX } from './render/KaTeXRenderer'
export type { KaTeXRenderResult } from './render/KaTeXRenderer'

// ---- P0: 增量布局 + 增量分页 (TASK-482/485) ----
export { IncrementalLayout } from './layout/incremental/IncrementalLayout'
export type { CachedParagraphLayout } from './layout/incremental/IncrementalLayout'
export { PageStartTable } from './layout/page/PageStartTable'
export type { PageEntry } from './layout/page/PageStartTable'

// ---- TASK-511: BookmarkRenderer ----
export { BookmarkRenderer } from './render/BookmarkRenderer'
export type { ResolvedReference } from './render/BookmarkRenderer'

// ---- TASK-469: PrintHistoryService ----
export { PrintHistoryService, printHistory } from '../services/PrintHistoryService'
export type { PrintRecord } from '../services/PrintHistoryService'
