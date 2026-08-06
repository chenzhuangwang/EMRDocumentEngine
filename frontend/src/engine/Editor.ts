import type { DocumentTree, BaseNode, Paragraph } from './document/DocumentModel'
import { createDocument, createParagraph, createTextNode, extractStyle, createFieldNode, createSeparatorNode, createFootnoteRef, createFootnoteContent } from './document/ElementFormatter'
import { NodePool, buildNodePool } from './document/NodePool'
import type { FieldType } from './document/DocumentModel'
import { Draw } from './render/Draw'
import { AutoSaveManager } from './AutoSaveManager'
import { AutoCorrectEngine } from './AutoCorrectEngine'
import { EventBus } from './interaction/EventBus'
import { CommandManager } from './command/CommandManager'
import { InputComposer } from './interaction/IMEHandler'
import { KeyboardHandler } from './interaction/KeyboardHandler'
import { MouseHandler } from './interaction/MouseHandler'
import type { ICommand } from './command/ICommand'
import { generateCommandId } from './command/ICommand'
import { InsertTextCommand } from './command/commands/InsertTextCommand'
import { InsertNodesCommand } from './command/commands/InsertNodesCommand'
import { DeleteRangeCommand } from './command/commands/DeleteRangeCommand'
import { FormatTextCommand } from './command/commands/FormatTextCommand'
import { ClearFormatCommand } from './command/commands/FormatTextCommand'
import { FormatPainterCommand } from './command/commands/FormatTextCommand'
import { ParagraphStyleCommand } from './command/commands/ParagraphStyleCommand'
import { ClipboardManager } from './command/ClipboardManager'
import { EditorStore } from './state/EditorStore'
import type { EditorRuntimeState } from './state/EditorRuntimeState'
import { FindReplaceEngine } from './FindReplaceEngine'
import type { FindOptions, MatchResult } from './FindReplaceEngine'

/** 辅助: 绕开 Readonly 直接写 store._state.runtime.cursor */
type StoreInternal = { _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean } } } }

function setCursor(store: EditorStore, path: string[], offset: number): void {
  const si = store as unknown as StoreInternal
  si._state.runtime.cursor = { paragraphPath: path, offset, visible: true }
}

export class Editor {
  private container: HTMLElement
  private doc: DocumentTree
  private pool: NodePool
  private draw: Draw
  private eventBus: EventBus
  private commandManager: CommandManager
  private store: EditorStore
  private inputComposer: InputComposer
  private keyboardHandler: KeyboardHandler
  private mouseHandler: MouseHandler
  private clipboard: ClipboardManager
  private findReplace: FindReplaceEngine
  private autoSave: AutoSaveManager
  private autoCorrect: AutoCorrectEngine
  private _formatPainterStyle: Record<string, unknown> | null = null
  private listeners: EditorListener[] = []
  private _clickToFocus: (e: MouseEvent) => void

  constructor(container: HTMLElement, doc?: DocumentTree) {
    this.container = container
    // 创建默认空文档
    if (!doc) {
      const d = createDocument('未命名文档')
      const para = createParagraph()
      d.body.children = [para.id]
      doc = d
      const allNodes = new Map<string, BaseNode>()
      allNodes.set(d.id, d)
      allNodes.set(para.id, para)
      this.doc = doc
      this.pool = buildNodePool(allNodes, { body: d.id })
    } else {
      this.doc = doc
      const fn = new Map<string, BaseNode>()
      fn.set(this.doc.id, this.doc)
      this.pool = buildNodePool(fn, { body: this.doc.id })
    }

    this.eventBus = new EventBus()
    this.draw = new Draw(container, this.eventBus, this.doc)
    this.store = new EditorStore(this.doc)
    this.inputComposer = new InputComposer(container)
    this.keyboardHandler = new KeyboardHandler(this, container)
    this.mouseHandler = new MouseHandler(this, container)
    this.clipboard = new ClipboardManager()
    this.findReplace = new FindReplaceEngine()
    this.autoSave = new AutoSaveManager(doc.id, doc.title || '未命名文档', () => this.doc)
    this.autoCorrect = new AutoCorrectEngine()
    // 自动保存: 保存状态同步到 EditorStore
    this.autoSave.onSave((type) => {
      if (type === 'saving') this.store.setSaveStatus('saving')
      else if (type === 'saved') this.store.setSaveStatus('saved')
      else if (type === 'error') this.store.setSaveStatus('error')
    })
    // 初始化 IndexedDB (异步, 不阻塞构造函数)
    this.autoSave.init().catch(err => console.warn('[AutoSave] IndexedDB init failed:', err))
    this.commandManager = new CommandManager(
      this.eventBus,
      () => this.doc,
      () => this.pool,
    )

    // 状态变更 → 仅更新 Store, 不渲染
    // 渲染统一由 document:changed 在 recomputeLayout 后触发
    // 确保 render() 始终使用最新的 SLIF 布局 + 最新的光标状态
    this.eventBus.on('state:changed', (patch) => {
      if (patch.cursor) this.store.updateRuntime({ cursor: { ...this.store.state.runtime.cursor, ...patch.cursor, visible: true } })
      if (patch.selection) this.store.updateRuntime({ selection: { ...this.store.state.runtime.selection, ...patch.selection } })
      this.store.setDirty(true)
    })

    // document:changed → 重布局 + 重绘 + 自动保存标记 (唯一渲染入口)
    this.eventBus.on('document:changed', (payload: { invalidation: import('./command/ICommand').InvalidationScope }) => {
      const t0 = performance.now()
      this.draw.recomputeLayout(this.pool, payload.invalidation)
      const t1 = performance.now()
      const cursor = this.store.state.runtime.cursor
      console.debug(
        `[Editor] document:changed(${payload.invalidation}) → recomputeLayout ${(t1 - t0).toFixed(1)}ms, ` +
        `cursor=(${cursor.paragraphPath.join('/')}, offset=${cursor.offset}), ` +
        `bodyChildren=[${this.doc.body.children.join(',')}]`
      )
      this.draw.render(this.pool, this.store.state.runtime)
      this.autoSave.markDirty()
    })

    // render:request (undo/redo 等) → 使用当前的 pool 和 state
    this.eventBus.on('render:request', () => {
      this.draw.recomputeLayout(this.pool)
      this.draw.render(this.pool, this.store.state.runtime)
    })

    // IME 输入法: compositionstart → 更新候选窗位置
    this.inputComposer.onCompositionStart(() => {
      const rect = this.draw.getCaretClientRect(this.pool, this.store.state.runtime)
      if (rect) this.inputComposer.updateCursorRect(rect)
    })

    // IME 输入法: compositionupdate → 跟随光标移动
    this.inputComposer.onCompositionUpdate((_text) => {
      const rect = this.draw.getCaretClientRect(this.pool, this.store.state.runtime)
      if (rect) this.inputComposer.updateCursorRect(rect)
    })
    this.inputComposer.onCompositionEnd((text) => {
      let cursor = this.store.state.runtime.cursor
      // 空文档 → 自动创建段落 (与 KeyboardHandler 保持一致)
      if (cursor.paragraphPath.length === 0) {
        const para = createParagraph()
        this.pool.nodes.set(para.id, para)
        this.doc.body.children = [para.id]
        const path: string[] = [this.doc.id, para.id]
        setCursor(this.store, path, 0)
        cursor = this.store.state.runtime.cursor
      }
      // 获取光标处文本样式 (段尾回退到末尾节点)
      let activeStyle: import('./document/DocumentModel').TextStyle | undefined
      const resolved = this.pool.resolveCharOffset(cursor.paragraphPath[cursor.paragraphPath.length - 1], cursor.offset)
      if (resolved) {
        const tn = this.pool.nodes.get(resolved.textNodeId) as unknown as Record<string, unknown> | undefined
        if (tn) activeStyle = extractStyle(tn as unknown as import('./document/DocumentModel').TextNode)
      } else {
        const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
        const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
        if (para?.children) {
          for (let i = para.children.length - 1; i >= 0; i--) {
            const n = this.pool.nodes.get(para.children[i]) as { type?: string } | undefined
            if (n?.type === 'text') { activeStyle = extractStyle(n as unknown as import('./document/DocumentModel').TextNode); break }
          }
        }
      }

      const cmd = new InsertTextCommand(
        generateCommandId(), Date.now(), 'user',
        cursor.paragraphPath, cursor.offset, text, activeStyle,
      )
      this.commandManager.execute(cmd)

      // 自动更正检查 (R43): IME 输入后检测光标前文本是否需要替换
      this.applyAutoCorrect(cursor.paragraphPath)
    })

    // 初始布局 + 首帧渲染
    this.draw.recomputeLayout(this.pool)

    // 初始化光标 — 必须在 render() 之前, 确保首帧即绘制光标
    const cursorPath = this.doc.body.children.length > 0
      ? [this.doc.id, this.doc.body.children[0]]
      : []
    setCursor(this.store, cursorPath, 0)

    this.draw.render(this.pool, this.store.state.runtime)

    // 点击容器 → 命中检测 + 更新光标 + 聚焦
    // 若刚结束拖拽则跳过, 避免覆盖选区
    this._clickToFocus = (e: MouseEvent) => {
      this.inputComposer.focus()
      if (this.mouseHandler.wasDragging()) return
      this.handleClick(e)
    }
    container.addEventListener('click', this._clickToFocus)

    this.notifyListeners('ready')
  }

  /** 获取文档总高度 (CSS pixels, 供滚动 spacer 使用) */
  getTotalDocHeight(): number {
    const pages = this.draw.getPages()
    if (pages.length === 0) return 0
    return pages.length * pages[0].height
  }

  /** 外部滚动同步 → 反偏移画布 + 更新 scrollY + 重渲染 */
  syncScrollPosition(scrollTop: number): void {
    const coord = this.draw.getCoordinateSystem()
    if (scrollTop !== coord.transform.scrollY) {
      coord.update({ scrollY: scrollTop })
      this.draw.renderer.fixCanvasScrollOffset(scrollTop)
      this.draw.render(this.pool, this.store.state.runtime)
    }
  }

  /** 点击命中检测 → 更新光标到点击位置 */
  private handleClick(e: MouseEvent): void {
    // 页眉页脚编辑模式下, 光标定位已在 MouseHandler.onMouseDown 中完成,
    // 此处不再重复处理 (避免 hitTestIndex 在 body items 中误命中)
    if (this.draw.isHeaderFooterEditActive()) return

    // 格式刷激活时: 点击 = 应用格式到目标段落 (TASK-472)
    if (this._formatPainterStyle) {
      this.handleFormatPainterApply(e)
      return
    }

    const rect = this.container.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top + this.draw.getCoordinateSystem().transform.scrollY

    const pages = this.draw.getPages()
    if (pages.length === 0) return

    let pageIndex = 0
    let localY = screenY
    for (let i = 0; i < pages.length; i++) {
      if (localY < pages[i].height) { pageIndex = i; break }
      localY -= pages[i].height
      pageIndex = i
    }
    const page = pages[pageIndex]
    if (!page) return

    const viewportW = this.container.clientWidth
    const offsetX = Math.max(0, (viewportW - page.width) / 2)
    const docX = screenX - offsetX
    const docY = localY

    // 命中检测 — 可能返回 null (空段落/点击在内容下方)
    const nodeId = this.draw.getHitTestIndex().hitTest(docX, docY, pageIndex)

    if (nodeId) {
      const para = this.findParagraphContaining(nodeId)
      if (para) {
        const offset = this.computeOffsetAtX(para, docX, page)
        setCursor(this.store, [this.doc.id, para.id], offset)
      }
    } else {
      // 未命中 → 判断点击位置相对于内容的位置
      const lastItemBottom = this.getPageContentBottom(page)
      const firstItemTop = this.getPageContentTop(page)

      if (lastItemBottom >= 0 && docY > lastItemBottom) {
        // 点击在所有内容下方 → 光标移到最后一个段落末尾
        const bodyChildren = this.doc.body.children
        if (bodyChildren.length > 0) {
          const lastParaId = bodyChildren[bodyChildren.length - 1]
          const lastPara = this.pool.nodes.get(lastParaId) as unknown as Paragraph | undefined
          if (lastPara) {
            const endOffset = this.getParagraphTextLength(lastPara)
            setCursor(this.store, [this.doc.id, lastParaId], endOffset)
          }
        }
      } else if (firstItemTop >= 0 && docY < firstItemTop) {
        // 点击在所有内容上方 → 光标移到第一个段落开头
        const bodyChildren = this.doc.body.children
        if (bodyChildren.length > 0) {
          setCursor(this.store, [this.doc.id, bodyChildren[0]], 0)
        }
      }
      // 行间空白 (在内容范围内但未命中任何 item) → 光标保持原位, 不移动
    }

    // 单击清空选区
    const si = this.store as unknown as { _state: { runtime: { selection: { active: boolean } } } }
    si._state.runtime.selection.active = false

    // 无论命中与否都重绘
    this.draw.render(this.pool, this.store.state.runtime)
  }

  /** 在 pool 中查找包含 nodeId 的 Paragraph */
  private findParagraphContaining(nodeId: string): Paragraph | null {
    for (const [, node] of this.pool.nodes) {
      if (node.type === 'paragraph') {
        const para = node as unknown as Paragraph
        if (para.children.includes(nodeId) || nodeId === node.id) return para
      }
    }
    return null
  }

  /** 根据文档坐标 X 计算段落内的字符偏移 */
  private computeOffsetAtX(para: Paragraph, docX: number, page: import('./layout/SLIF').SLIFPage): number {
    let accumulated = 0
    const markerLen = this.getListMarkerLen(para)

    for (const childId of para.children) {
      const item = page.items.find(it => it.nodeId === childId)
      const text = (this.pool.nodes.get(childId) as unknown as { text?: string })?.text || ''
      if (item) {
        // item.text 含标记前缀, 用 item 文本长度计算 charWidth
        const itemTextLen = item.text?.length || 1
        const charWidth = item.width / itemTextLen
        if (docX <= item.x + item.width) {
          const charIdx = Math.round((docX - item.x) / charWidth)
          return Math.max(0, accumulated + Math.max(0, Math.min(charIdx, itemTextLen)) - markerLen)
        }
      }
      accumulated += text.length
    }
    return Math.max(0, accumulated - markerLen)
  }

  /** 列表标记长度 (bullet="• ", ordered="99. ") */
  private getListMarkerLen(para: Paragraph): number {
    const p = para as unknown as { list?: { type: string; level?: number } }
    if (!p.list) return 0
    const lvl = p.list.level || 1
    const indent = '  '.repeat(lvl - 1)
    if (p.list.type === 'bullet') return (indent + '• ').length
    if (p.list.type === 'ordered') return (indent + '99. ').length
    return 0
  }

  /** 计算段落内所有文本节点的总字符数 */
  private getParagraphTextLength(para: Paragraph): number {
    let len = 0
    for (const childId of para.children) {
      const node = this.pool.nodes.get(childId)
      if (node && (node as unknown as { type: string }).type === 'text') {
        len += ((node as unknown as { text: string }).text || '').length
      } else {
        len += 1
      }
    }
    return len
  }

  /** 获取页面中最后一个 SLIF item 的底部 Y 坐标, 无内容返回 -1 */
  private getPageContentBottom(page: import('./layout/SLIF').SLIFPage): number {
    if (page.items.length === 0) return -1
    let maxBottom = 0
    for (const item of page.items) {
      const bottom = item.y + item.ascent + item.descent
      if (bottom > maxBottom) maxBottom = bottom
    }
    return maxBottom
  }

  /** 获取页面中第一个 SLIF item 的顶部 Y 坐标, 无内容返回 -1 */
  private getPageContentTop(page: import('./layout/SLIF').SLIFPage): number {
    if (page.items.length === 0) return -1
    return page.items[0].y
  }

  /**
   * 收集段落中偏移范围内的所有文本节点 ID
   * @param paraId 段落 ID
   * @param startOffset 起始字符偏移 (inclusive)
   * @param endOffset 结束字符偏移 (exclusive), 传 Number.MAX_SAFE_INTEGER 表示到段落末尾
   */
  private collectTextNodeIds(paraId: string, startOffset: number, endOffset: number): string[] {
    const ids: string[] = []
    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return ids
    let offset = 0
    for (const cid of para.children) {
      const n = this.pool.nodes.get(cid) as { type?: string; text?: string } | undefined
      const len = n?.type === 'text' ? ((n.text as string) || '').length : 1
      if (n?.type === 'text' && offset + len > startOffset && offset < endOffset) {
        ids.push(cid)
      }
      offset += len
    }
    return ids
  }

  getDocument(): DocumentTree { return this.doc }
  setDocument(doc: DocumentTree): void {
    // 确保 header/footer 字段存在 (兼容旧版文档数据)
    if (!doc.header) doc.header = []
    if (!doc.footer) doc.footer = []
    this.doc = doc
    const fn = new Map<string, BaseNode>()
    fn.set(doc.id, doc)
    this.pool = buildNodePool(fn, { body: doc.id })
    this.draw.setDocument(doc, this.pool)
    this.draw.recomputeLayout(this.pool)

    // 自动应用文档水印 (R70)
    const ps = doc.pageSetup as { watermark?: import('./render/LayeredRenderer').WatermarkConfig } | undefined
    if (ps?.watermark) {
      this.draw.setWatermark(ps.watermark)
    }

    const cursorPath = doc.body.children.length > 0
      ? [doc.id, doc.body.children[0]]
      : []
    setCursor(this.store, cursorPath, 0)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', doc)
  }

  /**
   * 确保页眉/页脚区域至少有一个段落 (无则创建)
   * 返回第一个段落 ID
   */
  ensureHeaderFooterParagraph(section: 'header' | 'footer'): string {
    const targetIds = section === 'header' ? this.doc.header! : this.doc.footer!
    if (targetIds.length > 0) return targetIds[0]

    // 创建空白段落 + 空文本节点
    const para = createParagraph()
    const textNode = createTextNode('')
    para.children = [textNode.id]

    // 加入文档和池
    targetIds.push(para.id)
    this.pool.nodes.set(para.id, para)
    this.pool.nodes.set(textNode.id, textNode)

    return para.id
  }

  /**
   * 在光标位置插入域代码 (TASK-471)
   * 用于页眉页脚工具栏"插入页码"/"插入日期"等
   */
  insertFieldCode(fieldType: FieldType): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const fn = createFieldNode(fieldType)

    // 注册到 NodePool
    this.pool.nodes.set(fn.id, fn)

    // 插入到段落 children 的光标偏移处
    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return

    // 找到光标所在的文本节点位置，在后面插入 FieldNode
    const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
    if (resolved) {
      const idx = para.children.indexOf(resolved.textNodeId)
      para.children.splice(idx + 1, 0, fn.id)
    } else {
      // 段尾: 追加到最后
      para.children.push(fn.id)
    }

    // 触发重布局+重绘
    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 在光标所在段落后插入分隔线 (TASK-462) */
  insertSeparator(): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const idx = this.doc.body.children.indexOf(paraId)
    if (idx < 0) return

    const sep = createSeparatorNode()
    this.pool.nodes.set(sep.id, sep)
    this.doc.body.children.splice(idx + 1, 0, sep.id)

    // 光标移到分隔线后的下一段 (如果有)
    const newBody = this.doc.body.children
    const nextParaId = newBody[idx + 2] // 跳过刚插入的 separator
    if (nextParaId) {
      const nextPara = this.pool.nodes.get(nextParaId)
      if (nextPara && (nextPara as { type?: string }).type === 'paragraph') {
        setCursor(this.store, [this.doc.id, nextParaId], 0)
      }
    }

    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 在光标位置插入脚注引用 + 脚注内容 (R31, Ctrl+Alt+F) */
  insertFootnote(): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return

    // 创建脚注内容 (空段落, 用户后续编辑)
    const fnContent = createFootnoteContent('')
    const contentPara = createParagraph([createTextNode('').id])
    fnContent.children = [contentPara.id]
    this.pool.nodes.set(fnContent.id, fnContent)
    this.pool.nodes.set(contentPara.id, contentPara)

    // 注册到文档级别
    if (!this.doc.footnotes) this.doc.footnotes = []
    this.doc.footnotes.push(fnContent.id)

    // 创建脚注引用 (标记在正文中)
    const fnRef = createFootnoteRef(fnContent.id)
    fnContent.refId = fnRef.id
    this.pool.nodes.set(fnRef.id, fnRef)

    // 插入引用到光标位置
    const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
    if (resolved) {
      const idx = para.children.indexOf(resolved.textNodeId)
      para.children.splice(idx + 1, 0, fnRef.id)
    } else {
      para.children.push(fnRef.id)
    }

    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  /** 在光标位置插入图片 (TASK-447), dataUrl 为 base64 或 blob URL */
  insertImage(dataUrl: string, naturalW?: number, naturalH?: number): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    // 限制显示宽度不超过内容区域
    const maxW = 794 - 180 // pageWidth - margins
    const displayW = Math.min(naturalW || maxW, maxW)
    const displayH = naturalW && naturalH
      ? (displayW / naturalW) * naturalH
      : 200

    const imgNode = {
      type: 'image' as const,
      id: generateCommandId(),
      src: dataUrl,
      width: displayW,
      height: displayH,
      naturalWidth: naturalW,
      naturalHeight: naturalH,
      wrapMode: 'top-bottom' as const,
    }

    this.pool.nodes.set(imgNode.id, imgNode)

    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (para?.children) {
      const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
      if (resolved) {
        const idx = para.children.indexOf(resolved.textNodeId)
        para.children.splice(idx + 1, 0, imgNode.id)
      } else {
        para.children.push(imgNode.id)
      }
    }

    this.draw.recomputeLayout(this.pool)
    this.draw.render(this.pool, this.store.state.runtime)
    this.notifyListeners('contentChange', this.doc)
  }

  execCommand(command: ICommand): void { this.commandManager.execute(command) }
  undo(): void { this.commandManager.undo() }
  redo(): void { this.commandManager.redo() }
  canUndo(): boolean { return this.commandManager.canUndo() }
  canRedo(): boolean { return this.commandManager.canRedo() }

  /** 复制: 选区范围 → 深度克隆 → 内存剪贴板 + 系统剪贴板 */
  copy(): void {
    console.debug('[Editor] copy() called')
    const runtime = this.store.state.runtime
    const sel = runtime.selection
    const cursor = runtime.cursor

    if (sel.active) {
      this.clipboard.copy(
        sel.anchor.paragraphPath, sel.anchor.offset,
        sel.focus.paragraphPath, sel.focus.offset,
        this.doc, this.pool,
      )
    } else if (cursor.paragraphPath.length > 0) {
      // 无选区: 复制光标所在整段
      const para = this.pool.nodes.get(cursor.paragraphPath[cursor.paragraphPath.length - 1])
      if (para) {
        const len = this.getParagraphTextLength(para as unknown as Paragraph)
        this.clipboard.copy(
          cursor.paragraphPath, 0,
          cursor.paragraphPath, len,
          this.doc, this.pool,
        )
      }
    }
  }

  /** 粘贴: 通过 InsertNodesCommand 执行 (支持 undo/redo) */
  paste(): void {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return

    const data = this.clipboard.paste()
    if (!data || data.nodes.length === 0) {
      // 内存剪贴板为空 → 尝试从系统剪贴板读取纯文本兜底
      this.pasteFromSystem()
      return
    }

    const cmd = new InsertNodesCommand(
      generateCommandId(), Date.now(), 'user',
      cursor.paragraphPath, cursor.offset,
      data.nodes,
    )
    this.commandManager.execute(cmd)
  }

  /** 从系统剪贴板读取纯文本 → 构造 ClipboardData → InsertNodesCommand */
  private async pasteFromSystem(): Promise<void> {
    try {
      const text = await navigator.clipboard?.readText()
      if (text) {
        this.clipboard.setPlainText(text)
        const data = this.clipboard.paste()
        if (data && data.nodes.length > 0 && this.store.state.runtime.cursor.paragraphPath.length > 0) {
          const cursor = this.store.state.runtime.cursor
          const cmd = new InsertNodesCommand(
            generateCommandId(), Date.now(), 'user',
            cursor.paragraphPath, cursor.offset,
            data.nodes,
          )
          this.commandManager.execute(cmd)
        }
      }
    } catch { /* 权限拒绝或非 HTTPS, 忽略 */ }
  }

  /** 切换文本样式 (bold/italic/underline) → FormatTextCommand, 支持选区 */
  toggleFormat(style: Partial<import('./document/DocumentModel').TextStyle>): void {
    const selection = this.store.state.runtime.selection
    const cursor = this.store.state.runtime.cursor

    let nodeIds: string[] = []

    if (selection.active) {
      const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
      const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]

      if (anchorParaId === focusParaId) {
        // 同段落选区: 收集选区范围内所有 text node
        const start = Math.min(selection.anchor.offset, selection.focus.offset)
        const end = Math.max(selection.anchor.offset, selection.focus.offset)
        if (start < end) {
          nodeIds = this.collectTextNodeIds(anchorParaId, start, end)
        }
      } else {
        // 跨段落选区: 遍历 anchor→focus 之间所有段落, 逐段收集 text node
        const bodyChildren = this.doc.body.children
        const aIdx = bodyChildren.indexOf(anchorParaId)
        const fIdx = bodyChildren.indexOf(focusParaId)
        if (aIdx >= 0 && fIdx >= 0) {
          const lo = Math.min(aIdx, fIdx)
          const hi = Math.max(aIdx, fIdx)
          // 与 Draw.renderSelectionUnified 逻辑一致: 首段偏移 = 索引较小端对应的 anchor/focus offset
          const loOff = aIdx === lo ? selection.anchor.offset : selection.focus.offset
          const hiOff = aIdx === hi ? selection.anchor.offset : selection.focus.offset
          const INF = Number.MAX_SAFE_INTEGER

          for (let i = lo; i <= hi; i++) {
            const paraId = bodyChildren[i]
            if (i === lo && i === hi) {
              // 防御性: samePara 已在上方拦截, 此处仅在极端边界触发
              if (loOff < hiOff) nodeIds.push(...this.collectTextNodeIds(paraId, loOff, hiOff))
            } else if (i === lo) {
              // 首段: 从 loOff 到段落末尾的全部文本节点
              nodeIds.push(...this.collectTextNodeIds(paraId, loOff, INF))
            } else if (i === hi) {
              // 末段: 从段落开头到 hiOff 的全部文本节点
              nodeIds.push(...this.collectTextNodeIds(paraId, 0, hiOff))
            } else {
              // 中间段: 全部文本节点
              nodeIds.push(...this.collectTextNodeIds(paraId, 0, INF))
            }
          }
        }
      }
    }

    if (nodeIds.length === 0) {
      // 无选区 → 只格式化光标处节点
      if (cursor.paragraphPath.length === 0) return
      const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
      const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
      if (!resolved) return
      nodeIds = [resolved.textNodeId]
    }

    // Toggle: 读首个节点已有样式决定方向
    const firstNode = this.pool.nodes.get(nodeIds[0]) as unknown as { bold?: boolean; italic?: boolean; underline?: boolean } | undefined
    const changes: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(style)) {
      if (val === true && firstNode?.[key as keyof typeof firstNode]) {
        changes[key] = false
      } else {
        changes[key] = val
      }
    }

    const cmd = new FormatTextCommand(
      generateCommandId(), Date.now(), 'user',
      nodeIds,
      changes as Partial<import('./document/DocumentModel').TextStyle>,
    )
    this.commandManager.execute(cmd)
  }

  /** 清除光标/选区处所有文本格式 (TASK-473) */
  clearFormat(): void {
    const selection = this.store.state.runtime.selection
    const cursor = this.store.state.runtime.cursor
    let nodeIds: string[] = []

    if (selection.active) {
      const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
      const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]

      if (anchorParaId === focusParaId) {
        const start = Math.min(selection.anchor.offset, selection.focus.offset)
        const end = Math.max(selection.anchor.offset, selection.focus.offset)
        if (start < end) nodeIds = this.collectTextNodeIds(anchorParaId, start, end)
      } else {
        const bodyChildren = this.doc.body.children
        const aIdx = bodyChildren.indexOf(anchorParaId)
        const fIdx = bodyChildren.indexOf(focusParaId)
        if (aIdx >= 0 && fIdx >= 0) {
          const lo = Math.min(aIdx, fIdx)
          const hi = Math.max(aIdx, fIdx)
          const loOff = aIdx === lo ? selection.anchor.offset : selection.focus.offset
          const hiOff = aIdx === hi ? selection.anchor.offset : selection.focus.offset
          const INF = Number.MAX_SAFE_INTEGER
          for (let i = lo; i <= hi; i++) {
            const paraId = bodyChildren[i]
            if (i === lo && i === hi) {
              if (loOff < hiOff) nodeIds.push(...this.collectTextNodeIds(paraId, loOff, hiOff))
            } else if (i === lo) {
              nodeIds.push(...this.collectTextNodeIds(paraId, loOff, INF))
            } else if (i === hi) {
              nodeIds.push(...this.collectTextNodeIds(paraId, 0, hiOff))
            } else {
              nodeIds.push(...this.collectTextNodeIds(paraId, 0, INF))
            }
          }
        }
      }
    }

    if (nodeIds.length === 0) {
      if (cursor.paragraphPath.length === 0) return
      const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
      const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
      if (!resolved) return
      nodeIds = [resolved.textNodeId]
    }

    const cmd = new ClearFormatCommand(generateCommandId(), Date.now(), 'user', nodeIds)
    this.commandManager.execute(cmd)
  }

  /** 格式刷: 复制光标处文本样式 (TASK-472), 返回可序列化的样式对象 */
  copyFormatPainterStyle(): Record<string, unknown> | null {
    const ts = this.getTextStyle()
    if (!ts) return null
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(ts)) {
      if (v !== undefined && v !== false) clean[k] = v
    }
    return clean
  }

  /** 格式刷: 激活/取消 */
  setFormatPainterActive(active: boolean): void {
    if (active) {
      this._formatPainterStyle = this.copyFormatPainterStyle()
    } else {
      this._formatPainterStyle = null
    }
  }

  /** 格式刷是否激活 */
  get isFormatPainterActive(): boolean { return this._formatPainterStyle !== null }

  /** 格式刷: 点击目标段落时应用样式 */
  private handleFormatPainterApply(e: MouseEvent): void {
    if (!this._formatPainterStyle) return

    const rect = this.container.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top + this.draw.getCoordinateSystem().transform.scrollY

    const pages = this.draw.getPages()
    if (pages.length === 0) { this._formatPainterStyle = null; return }

    let pageIndex = 0; let localY = screenY
    for (let i = 0; i < pages.length; i++) {
      if (localY < pages[i].height) { pageIndex = i; break }
      localY -= pages[i].height; pageIndex = i
    }
    const page = pages[pageIndex]
    if (!page) { this._formatPainterStyle = null; return }

    const viewportW = this.container.clientWidth
    const offsetX = Math.max(0, (viewportW - page.width) / 2)
    const docX = screenX - offsetX

    const nodeId = this.draw.getHitTestIndex().hitTest(docX, localY, pageIndex)
    if (nodeId) {
      const para = this.findParagraphContaining(nodeId)
      if (para) {
        this.applyFormatPainter(para.id, this._formatPainterStyle)
        // 同时定位光标到点击位置
        const cursorOffset = this.computeOffsetAtX(para, docX, page)
        setCursor(this.store, [this.doc.id, para.id], cursorOffset)
      }
    }

    // 单次使用后退出 (双击模式可扩展)
    this._formatPainterStyle = null
    this.draw.render(this.pool, this.store.state.runtime)

    // 通知 React 层更新状态
    this.notifyFormatPainterChange(false)
  }

  private onFormatPainterChange: ((active: boolean) => void) | null = null

  /** 注册格式刷状态变更回调 (供 React 层同步) */
  setOnFormatPainterChange(cb: (active: boolean) => void): void {
    this.onFormatPainterChange = cb
  }

  private notifyFormatPainterChange(active: boolean): void {
    this.onFormatPainterChange?.(active)
  }

  /** 格式刷: 将样式应用到目标段落的所有文本节点 (TASK-472) */
  applyFormatPainter(paraId: string, style: Record<string, unknown>): void {
    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return
    const nodeIds: string[] = []
    for (const cid of para.children) {
      const n = this.pool.nodes.get(cid) as { type?: string } | undefined
      if (n?.type === 'text') nodeIds.push(cid)
    }
    if (nodeIds.length === 0) return
    const cmd = new FormatPainterCommand(
      generateCommandId(), Date.now(), 'user',
      nodeIds,
      style as Partial<import('./document/DocumentModel').TextStyle>,
    )
    this.commandManager.execute(cmd)
  }

  /** 设置光标/选区段落的格式 (对齐/缩进/列表) — v20.35 支持跨段落选区 */
  setParagraphStyle(style: Partial<import('./document/DocumentModel').ParagraphStyle>): void {
    const paraIds = this.getSelectedParagraphIds()
    if (paraIds.length === 0) return
    const ts = Date.now()
    for (const paraId of paraIds) {
      const cmd = new ParagraphStyleCommand(
        generateCommandId(), ts, 'user',
        [paraId], style,
      )
      this.commandManager.execute(cmd)
    }
  }

  /** 调整选中段落的缩进 (逐段独立计算, 支持跨段落选区) */
  adjustIndent(delta: number): void {
    const paraIds = this.getSelectedParagraphIds()
    if (paraIds.length === 0) return
    const ts = Date.now()
    for (const paraId of paraIds) {
      const para = this.pool.nodes.get(paraId) as { indent?: number } | undefined
      const cur = para?.indent ?? 0
      const newIndent = Math.max(0, cur + delta)
      const cmd = new ParagraphStyleCommand(
        generateCommandId(), ts, 'user',
        [paraId], { indent: newIndent },
      )
      this.commandManager.execute(cmd)
    }
  }

  /** 获取光标处文本样式 (供 Toolbar 状态同步) */
  getTextStyle(): {
    font?: string; size?: number
    bold?: boolean; italic?: boolean; underline?: boolean
    strikeout?: boolean; superscript?: boolean; subscript?: boolean
    color?: string
  } | null {
    const cursor = this.store.state.runtime.cursor
    if (cursor.paragraphPath.length === 0) return null
    const paraId = cursor.paragraphPath[cursor.paragraphPath.length - 1]
    const resolved = this.pool.resolveCharOffset(paraId, cursor.offset)
    let tn: { font?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; strikeout?: boolean; superscript?: boolean; subscript?: boolean; color?: string } | undefined
    if (resolved) {
      tn = this.pool.nodes.get(resolved.textNodeId) as typeof tn
    } else {
      // 光标在段尾 → 取最后一个 text node 的样式
      const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
      if (para?.children) {
        for (let i = para.children.length - 1; i >= 0; i--) {
          const n = this.pool.nodes.get(para.children[i]) as { type?: string } & typeof tn
          if (n?.type === 'text') { tn = n; break }
        }
      }
    }
    if (!tn) return null
    return {
      font: tn.font, size: tn.size,
      bold: tn.bold, italic: tn.italic, underline: tn.underline,
      strikeout: tn.strikeout, superscript: tn.superscript, subscript: tn.subscript,
      color: tn.color,
    }
  }

  /** 获取光标/选区首段落的格式 (供 Toolbar active 状态) */
  getParagraphStyle(): { alignment?: string; listType?: string; indent?: number; outlineLevel?: number } | null {
    const paraIds = this.getSelectedParagraphIds()
    if (paraIds.length === 0) return null
    const paraId = paraIds[0]
    const para = this.pool.nodes.get(paraId) as Record<string, unknown> | undefined
    if (!para) return null
    return {
      alignment: para.alignment as string | undefined,
      listType: para.list ? (para.list as { type: string }).type : undefined,
      indent: para.indent as number | undefined,
      outlineLevel: para.outlineLevel as number | undefined,
    }
  }

  /** 收集当前选区涉及的所有段落 ID */
  private getSelectedParagraphIds(): string[] {
    const selection = this.store.state.runtime.selection
    const cursor = this.store.state.runtime.cursor

    if (selection.active) {
      const anchorParaId = selection.anchor.paragraphPath[selection.anchor.paragraphPath.length - 1]
      const focusParaId = selection.focus.paragraphPath[selection.focus.paragraphPath.length - 1]
      if (anchorParaId && focusParaId && anchorParaId !== focusParaId) {
        const bodyChildren = this.doc.body.children
        const aIdx = bodyChildren.indexOf(anchorParaId)
        const fIdx = bodyChildren.indexOf(focusParaId)
        if (aIdx >= 0 && fIdx >= 0) {
          const lo = Math.min(aIdx, fIdx)
          const hi = Math.max(aIdx, fIdx)
          const ids: string[] = []
          for (let i = lo; i <= hi; i++) ids.push(bodyChildren[i])
          return ids
        }
      }
    }

    // 单段落: 光标所在段落
    if (cursor.paragraphPath.length === 0) return []
    return [cursor.paragraphPath[cursor.paragraphPath.length - 1]]
  }

  /** 全选: 选区覆盖整篇文档所有段落 */
  selectAll(): void {
    const bodyChildren = this.doc.body.children
    if (bodyChildren.length === 0) return
    const firstParaId = bodyChildren[0]
    const lastParaId = bodyChildren[bodyChildren.length - 1]
    const lastPara = this.pool.nodes.get(lastParaId) as unknown as { children?: string[] } | undefined
    const totalLen = lastPara ? this.getParagraphTextLength(lastPara as unknown as Paragraph) : 0
    const si = this.store as unknown as {
      _state: { runtime: { selection: { anchor: { paragraphPath: string[]; offset: number; visible: boolean }; focus: { paragraphPath: string[]; offset: number; visible: boolean }; active: boolean; granularity: string } } }
    }
    si._state.runtime.selection = {
      anchor: { paragraphPath: [this.doc.id, firstParaId], offset: 0, visible: false },
      focus: { paragraphPath: [this.doc.id, lastParaId], offset: totalLen, visible: false },
      active: true,
      granularity: 'character',
    }
    this.draw.render(this.pool, this.store.state.runtime)
  }

  getEventBus(): EventBus { return this.eventBus }
  getDraw(): Draw { return this.draw }
  getPool(): NodePool { return this.pool }
  getInputComposer(): InputComposer { return this.inputComposer }
  getKeyboardHandler(): KeyboardHandler { return this.keyboardHandler }
  getStore(): EditorStore { return this.store }

  setRuntimeState(state: EditorRuntimeState): void { this.draw.setRuntimeState(state) }
  setScale(scale: number): void { this.draw.setScale(scale) }
  /** 获取字数统计 (R36) */
  getWordCount(): { chars: number; words: number; paragraphs: number; selectedChars?: number; selectedWords?: number } {
    let chars = 0
    let words = 0
    const bodyChildren = this.doc.body.children

    for (const childId of bodyChildren) {
      const node = this.pool.nodes.get(childId)
      if (!node) continue
      const n = node as { type?: string; children?: string[] }

      if (n.type === 'paragraph' && n.children) {
        for (const cid of n.children) {
          const cn = this.pool.nodes.get(cid) as { type?: string; text?: string } | undefined
          if (cn?.type === 'text' && cn.text) {
            const t = cn.text
            chars += [...t].length  // 字符数 (含CJK)
            // 英文单词数: 按空白/标点分割
            words += (t.match(/[\w一-鿿]+/g) || []).length
          }
        }
      }
    }

    const paragraphs = bodyChildren.filter(id => {
      const n = this.pool.nodes.get(id)
      return n && (n as { type?: string }).type === 'paragraph'
    }).length

    // 选区统计
    let selectedChars: number | undefined
    let selectedWords: number | undefined
    const sel = this.store.state.runtime.selection
    if (sel.active) {
      const anchorParaId = sel.anchor.paragraphPath[sel.anchor.paragraphPath.length - 1]
      const focusParaId = sel.focus.paragraphPath[sel.focus.paragraphPath.length - 1]
      if (anchorParaId === focusParaId) {
        const start = Math.min(sel.anchor.offset, sel.focus.offset)
        const end = Math.max(sel.anchor.offset, sel.focus.offset)
        const nodeIds = this.collectTextNodeIds(anchorParaId, start, end)
        let selText = ''
        for (const nid of nodeIds) {
          const n = this.pool.nodes.get(nid) as { text?: string } | undefined
          if (n?.text) selText += n.text
        }
        selectedChars = [...selText].length
        selectedWords = (selText.match(/[\w一-鿿]+/g) || []).length
      }
    }

    return { chars, words, paragraphs, selectedChars, selectedWords }
  }

  /** 设置数字水印 (R35) */
  setWatermark(config: import('./render/LayeredRenderer').WatermarkConfig): void {
    this.draw.setWatermark(config)
  }

  /** 自动更正: IME 输入后检测光标前文本是否需要替换 (R43) */
  private applyAutoCorrect(paragraphPath: string[]): void {
    const paraId = paragraphPath[paragraphPath.length - 1]
    if (!paraId) return

    // 获取段落完整文本
    const para = this.pool.nodes.get(paraId) as { children?: string[] } | undefined
    if (!para?.children) return
    let fullText = ''
    for (const cid of para.children) {
      const n = this.pool.nodes.get(cid) as { type?: string; text?: string } | undefined
      if (n?.type === 'text') fullText += n.text || ''
    }

    const cursor = this.store.state.runtime.cursor
    const result = this.autoCorrect.checkAtCursor(fullText, cursor.offset)
    if (!result) return

    // 执行替换: 删除匹配文本 + 插入替换文本
    if (result.end > result.start) {
      this.commandManager.execute(new DeleteRangeCommand(
        generateCommandId(), Date.now(), 'user',
        paragraphPath, result.start, result.end,
      ))
    }
    this.commandManager.execute(new InsertTextCommand(
      generateCommandId(), Date.now(), 'user',
      paragraphPath, result.start, result.replacement,
    ))

    console.debug(`[AutoCorrect] "${fullText.slice(result.start, result.end)}" → "${result.replacement}"`)
  }

  /** 不可见字符显示切换 (TASK-475) */
  setShowInvisible(v: boolean): void { this.draw.showInvisible = v }
  getShowInvisible(): boolean { return this.draw.showInvisible }

  /** 聚焦编辑器 */
  focus(): void { this.inputComposer.focus() }

  // ---- 查找替换 (委托 FindReplaceEngine) ----

  findAll(query: string, options?: FindOptions): MatchResult[] {
    return this.findReplace.findAll(query, this.doc, this.pool, options)
  }

  findNext(query: string, options?: FindOptions): MatchResult | null {
    const cursor = this.store.state.runtime.cursor
    return this.findReplace.findNext(query, cursor.paragraphPath, cursor.offset, this.doc, this.pool, options)
  }

  findPrevious(query: string, options?: FindOptions): MatchResult | null {
    const cursor = this.store.state.runtime.cursor
    return this.findReplace.findPrevious(query, cursor.paragraphPath, cursor.offset, this.doc, this.pool, options)
  }

  replace(query: string, replacement: string, result: MatchResult, options?: FindOptions): void {
    const replaced = this.findReplace.replace(query, replacement, result, this.doc, this.pool, options)
    if (replaced) {
      const si = this.store as unknown as { _state: { runtime: { cursor: { paragraphPath: string[]; offset: number; visible: boolean } } } }
      si._state.runtime.cursor = { paragraphPath: replaced.paragraphPath, offset: replaced.offset, visible: true }
      this.draw.render(this.pool, this.store.state.runtime)
    }
  }

  replaceAll(query: string, replacement: string, options?: FindOptions): number {
    const count = this.findReplace.replaceAll(query, replacement, this.doc, this.pool, options)
    if (count > 0) {
      this.draw.recomputeLayout(this.pool)
      this.draw.render(this.pool, this.store.state.runtime)
    }
    return count
  }

  highlightAll(query: string, options?: FindOptions): MatchResult[] {
    return this.findReplace.highlightAll(query, this.doc, this.pool, options)
  }

  destroy(): void {
    this.listeners = []
    this.container.removeEventListener('click', this._clickToFocus)
    this.keyboardHandler.destroy()
    this.mouseHandler.destroy()
    this.inputComposer.destroy()
    this.draw.destroy()
    this.autoSave.destroy()
  }

  /** 获取 AutoSaveManager (供页面卸载时立即保存) */
  getAutoSave(): AutoSaveManager { return this.autoSave }

  on(event: EditorEventType, cb: (...args: unknown[]) => void): void {
    this.listeners.push({ event, callback: cb })
  }
  off(event: EditorEventType, cb: (...args: unknown[]) => void): void {
    this.listeners = this.listeners.filter(l => !(l.event === event && l.callback === cb))
  }
  private notifyListeners(event: EditorEventType, ...args: unknown[]): void {
    this.listeners.filter(l => l.event === event).forEach(l => {
      try { l.callback(...args) } catch (err) { console.error(`[Editor] "${event}" listener error:`, err) }
    })
  }
}

export type EditorEventType = 'ready' | 'contentChange' | 'modeChange' | 'selectionChange' | 'save'
export interface EditorListener { event: EditorEventType; callback: (...args: unknown[]) => void }

/** IEditor 公共 API (SDK 集成面) */
export interface IEditor {
  getDocument(): DocumentTree
  setDocument(doc: DocumentTree): void
  execCommand(command: ICommand): void
  undo(): void; redo(): void
  canUndo(): boolean; canRedo(): boolean
  copy(): void; paste(): void
  toggleFormat(style: Partial<import('./document/DocumentModel').TextStyle>): void
  setParagraphStyle(style: Partial<import('./document/DocumentModel').ParagraphStyle>): void
  getWordCount(): { chars: number; words: number; paragraphs: number; selectedChars?: number; selectedWords?: number }
  on(event: EditorEventType, cb: (...args: unknown[]) => void): void
  off(event: EditorEventType, cb: (...args: unknown[]) => void): void
  destroy(): void
}
