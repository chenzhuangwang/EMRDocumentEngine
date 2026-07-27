// ============================================================
// 引擎统一导出
// ============================================================

export { Editor } from './Editor'
export { EventBus } from './EventBus'
export { Draw } from './render/Draw'
export { TextMeasurer, textMeasurer } from './layout/TextMeasurer'
export { LineBreaker } from './layout/LineBreaker'
export { PageBreaker } from './layout/PageBreaker'
export { TextParticle } from './render/particles/TextParticle'
export { Position } from './state/Position'
export { HistoryManager } from './state/HistoryManager'
export { RangeManager } from './state/RangeManager'
export { KeyboardHandler } from './interaction/KeyboardHandler'
export { IMEHandler } from './interaction/IMEHandler'
export { MouseHandler } from './interaction/MouseHandler'
export type { KeyboardContext } from './interaction/KeyboardHandler'
export type { IMEContext } from './interaction/IMEHandler'
export type { MouseContext } from './interaction/MouseHandler'
// Command system (Spec TASK-202)
export { CommandManager } from './command/CommandManager'
export { ZoneEditCommand, ControlEditCommand, TableCellEditCommand } from './command/commands'
export type { ICommand, ICommandContext, ZoneSnapshot } from './command/CommandManager'
export {
  ElementType,
  ControlType,
  EditorMode,
  PageMode,
  RowFlex,
  ZoneType,
  DEFAULT_PAGE_SETUP,
  DEFAULT_EDITOR_OPTIONS,
  DEFAULT_FONT_CONFIG,
  generateElementId,
  createTextElement,
  createPageBreakElement,
  createControlElement,
  createBlankDocument,
  createDocumentFromTemplate,
} from './document/DocumentModel'
export {
  formatElementList,
  unzipElementList,
  zipElementList,
} from './document/ElementFormatter'
export type {
  IElement,
  ITr,
  ITd,
  IControl,
  IControlOption,
  IImageData,
  IDataBinding,
  IValidation,
  IRevision,
  IPermission,
  IPageSetup,
  IDocument,
  IDocumentMetadata,
  IPosition,
  IPageOffset,
  ILine,
  IPage,
  IDrawPayload,
  IEditorOption,
  IFontConfig,
  EditorEventMap,
} from './document/DocumentModel'
