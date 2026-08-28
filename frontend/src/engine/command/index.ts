// ================================================================
// Command 模块导出
// ================================================================

export type {
  ICommand, CommandContext, StatePatch, SerializedCommand,
  MergeableCommand, InvalidationScope,
} from './ICommand'
export { PositionalCommand, generateCommandId } from './ICommand'

export { InsertTextCommand } from './commands/InsertTextCommand'
export { DeleteRangeCommand } from './commands/DeleteRangeCommand'
export { FormatTextCommand, ClearFormatCommand, FormatPainterCommand } from './commands/FormatTextCommand'
export { SetCursorCommand, SetSelectionCommand } from './commands/StateCommand'
export { SetHeaderFooterConfigCommand } from './commands/HeaderFooterConfigCommand'
export { SplitParagraphCommand } from './commands/SplitParagraphCommand'
export { MergeParagraphCommand } from './commands/MergeParagraphCommand'
export { InsertImageCommand } from './commands/InsertImageCommand'
export { ReplaceTextCommand } from './commands/ReplaceTextCommand'
export type { ReplaceEdit } from './commands/ReplaceTextCommand'
export {
  RemoveNodesCommand,
  InsertInlineNodeCommand,
  InsertBlockCommand,
  InsertFootnoteCommand,
  CreateCommentCommand,
  AddCommentReplyCommand,
  ResolveCommentCommand,
  SetPageSetupCommand,
  EnsureHeaderFooterParagraphCommand,
  EnsureBodyParagraphCommand,
  EnsureCellParagraphCommand,
  TableStructureCommand,
} from './commands/StructuralCommands'
export { normalizeParagraph } from './commands/ParagraphUtils'
export { CommandUndoRedoStack } from './CommandUndoRedoStack'
export { CommandManager } from './CommandManager'
export { DirtyTracker } from '../layout/incremental/DirtyTracker'
