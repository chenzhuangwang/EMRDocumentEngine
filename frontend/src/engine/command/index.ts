// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

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
export { FormatTextCommand, ClearFormatCommand, FormatPainterCommand, FormatTextRangeCommand } from './commands/FormatTextCommand'
export type { FormatRange } from '../document/selection/SelectionCollector'
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
