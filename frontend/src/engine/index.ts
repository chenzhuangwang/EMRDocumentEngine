// ============================================================
// 引擎统一导出 (ModelD v20.34)
// ============================================================

export { Editor } from './Editor'
export { Draw } from './render/Draw'
export { TextMeasurer, textMeasurer } from './layout/TextMeasurer'
export { LineBreaker } from './layout/LineBreaker'
export { PageBreaker } from './layout/PageBreaker'
export { TextParticle } from './render/particles/TextParticle'
export { Position } from './state/Position'
export { CoordinateSystem } from './state/CoordinateSystem'
export { NodePool, buildNodePool, traversePool } from './document/NodePool'

// EventBus
export { EventBus } from './interaction/EventBus'
export type { EventPayloadMap, EngineEvent } from './interaction/EventBus'

// Layout
export { LayoutEngine } from './layout/LayoutEngine'
export type { LayoutConfig } from './layout/LayoutEngine'
export type { SLIFItem, SLIFPage, SLIF } from './layout/SLIF'
export { resolveLineHeight, DEFAULT_FONT_METRICS } from './layout/FontMetrics'
export type { FontMetrics } from './layout/FontMetrics'
export { LayoutCache } from './layout/LayoutCache'

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
  ViewState, EditorMode, PageMode, IMEState, HistoryState,
  EditorRuntimeState,
} from './state/EditorRuntimeState'

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
export { CommandManager, DirtyTracker } from './command/CommandManager'

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
