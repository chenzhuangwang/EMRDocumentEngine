// ============================================================
// 编辑器提供者 (ModelD) - 桥接 React 和 Canvas 引擎
// ============================================================

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Editor, createDefaultRuntimeState, type DocumentTree, type EditorStore, type EditorStoreState } from '@/engine'
import { createDomEditorHost } from '@/platform/dom'

// 创建浏览器宿主 — 平台能力注入点 (契约 §27 / §29)。
// 构造无 DOM 副作用, 模块加载时安全创建; surface 在 Editor 创建前 mount 到容器。
const domHost = createDomEditorHost()

export interface EditorContextValue {
  editorRef: React.MutableRefObject<Editor | null>
  /** Editor 是否已创建 (editorRef.current 非 null)。子组件 mount effect 依赖它,
   *  避免父级 useEffect 晚于子级 effect 执行导致的 editorRef.current 恒为 null。 */
  ready: boolean
  /** 编辑器运行时状态 (canonical owner, §7.2)。ready 前为 null。 */
  store: EditorStore | null
}

export const EditorContext = createContext<EditorContextValue | null>(null)

/** store 尚未就绪时的默认快照 (供 useEditorStoreSnapshot 首帧返回稳定值) */
const DEFAULT_STORE_STATE: EditorStoreState = {
  document: null,
  documentTitle: '',
  runtime: createDefaultRuntimeState(),
  isDirty: false,
  saveStatus: 'saved',
  formatPainterActive: false,
  headerFooterEdit: { active: false, section: 'header' },
  paragraphStyle: null,
  textStyle: null,
  headerFooterConfig: { differentFirstPage: false, differentOddEven: false },
  designSelectedControlId: null,
  designHoveredControlId: null,
  activeControlId: null,
}

interface EditorProviderProps {
  children: ReactNode
  containerRef: React.RefObject<HTMLDivElement>
  document?: DocumentTree
}

export function EditorProvider({ children, containerRef, document }: EditorProviderProps) {
  const editorRef = useRef<Editor | null>(null)
  const [ready, setReady] = useState(false)
  const [store, setStore] = useState<EditorStore | null>(null)

  // 创建 Editor (仅一次)
  useEffect(() => {
    if (!containerRef.current) return
    // 绑定渲染表面 + 交互宿主到容器 (Editor 构造前)
    domHost.surface.mount(containerRef.current)
    domHost.input.mount(containerRef.current)
    const editor = new Editor(domHost, document)
    editorRef.current = editor
    setStore(editor.getStore())
    setReady(true)
    editor.focus()
    // 如果 document 在 Editor 创建前就已就绪, 立即加载
    if (document) editor.setDocument(document)
    return () => { editor.destroy(); editorRef.current = null; setStore(null); setReady(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // document 变更时重新加载
  useEffect(() => {
    if (editorRef.current && document) {
      editorRef.current.setDocument(document)
    }
  }, [document])

  return (
    <EditorContext.Provider value={{ editorRef, ready, store }}>
      {children}
    </EditorContext.Provider>
  )
}

export function useEditor(): Editor | null {
  const context = useContext(EditorContext)
  return context?.editorRef.current ?? null
}

export function useEditorRef(): React.MutableRefObject<Editor | null> {
  const context = useContext(EditorContext)
  if (!context) throw new Error('useEditorRef must be used within EditorProvider')
  return context.editorRef
}

export function useEditorReady(): boolean {
  const context = useContext(EditorContext)
  if (!context) throw new Error('useEditorReady must be used within EditorProvider')
  return context.ready
}

/**
 * 订阅 EditorStore 运行时状态 (canonical owner, 架构 §7.2)。
 *
 * 用 useSyncExternalStore 订阅 EditorStore 的版本号变化, 替代在 React 侧
 * 维护一份 Zustand 副本。selector 从 EditorStore.state 中投影所需字段。
 *
 * 注意: EditorStore 采用 in-place mutation, state 引用不变, 故以单调递增的
 * version 作为快照检测值, 而非 state 对象本身。
 */
export function useEditorStoreSnapshot<T>(selector: (s: EditorStoreState) => T): T {
  const context = useContext(EditorContext)
  if (!context) throw new Error('useEditorStoreSnapshot must be used within EditorProvider')
  const { store } = context

  const subscribe = useCallback(
    (onChange: () => void) => (store ? store.subscribe(onChange) : () => {}),
    [store],
  )
  useSyncExternalStore(
    subscribe,
    () => store?.getVersion() ?? 0,
    () => 0,
  )

  return selector(store ? store.state : DEFAULT_STORE_STATE)
}
