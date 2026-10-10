// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// platform/react — React ↔ 引擎适配器 (契约 §10 / §32)
//
// React integration belongs at the BOUNDARY. React 生命周期 / context /
// useSyncExternalStore 全部只在这一层; engine 不知道 React 存在 (§10)。
//
// 与 components/editor/EditorProvider 的关系: 本模块是**通用适配器**, 属
// 分发分包 (`./react` 子路径); 应用侧的 components/editor/EditorProvider
// 是它的薄包装, 负责绑定应用自己的主题 store 与码表目录。
//
// 本层刻意**不依赖**应用级 Zustand store:
//   themePreset  受控 prop —— 应用订阅自己的 UI store 后传入
//   dictionaries 注入 prop —— 应用从 platform/data 构造后传入
// 这样任何 React 项目 (不限本 App) 都能直接用, 不必先有 useUIStore。
// ============================================================

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  Editor,
  createDefaultRuntimeState,
  locale,
  type DictionaryProvider,
  type DocumentTree,
  type EditorHost,
  type EditorStore,
  type EditorStoreState,
  type ThemePreset,
} from '../../engine'
import { createDomEditorHost } from '../dom'

/** 未显式提供 host 时的默认浏览器宿主 (模块加载零副作用, 契约 §29) */
const defaultHost = createDomEditorHost()

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
  headerFooterEdit: { active: false, section: 'header', pageIndex: 0 },
  paragraphStyle: null,
  textStyle: null,
  headerFooterConfig: { differentFirstPage: false, differentOddEven: false },
  designSelectedControlId: null,
  designHoveredControlId: null,
  selectedSectionId: null,
  activeControlId: null,
}

export interface EditorProviderProps {
  children: ReactNode
  /** 渲染容器 —— 引擎的 canvas 层与 IME surface 挂到这里 */
  containerRef: React.RefObject<HTMLDivElement>
  /** 初始文档; 变更时会重新 setDocument */
  document?: DocumentTree
  /**
   * 平台宿主。缺省用默认的浏览器 DOM 宿主。
   * 非浏览器宿主 (worker / SSR / 自定义渲染) 从这里注入, 见契约 §27.3。
   */
  host?: EditorHost
  /**
   * 画布主题预设 (受控)。变更时同步到 editor.setTheme。
   *
   * 受控而非内部订阅: 主题的 canonical owner 是应用状态 (§7.1), 分包不该
   * 假定应用用的是哪个 store。不传则不接管主题 (由调用方自行 setTheme)。
   */
  themePreset?: ThemePreset
  /**
   * 外部码表候选源 (契约 §12.6.4 注入缝)。候选是 runtime-only 且 owner 在
   * 文档之外 —— 构造后、setDocument 前注入; 换文档不重置它。
   */
  dictionaries?: DictionaryProvider | null
  /**
   * 挂载完成后是否自动 focus。缺省 true (编辑器常见行为)。
   * 同一页面上有多个编辑器时, 调用方通常只让其中一个取焦点。
   */
  autoFocus?: boolean
}

export function EditorProvider({
  children, containerRef, document, host, themePreset, dictionaries, autoFocus = true,
}: EditorProviderProps) {
  const editorRef = useRef<Editor | null>(null)
  const [ready, setReady] = useState(false)
  const [store, setStore] = useState<EditorStore | null>(null)

  // 宿主在 Provider 生命周期内保持同一实例: 每次渲染重建宿主会让
  // canvas 层与事件监听整体重来。host 变了才换 (极少见, 且需重建 Editor)。
  const hostRef = useRef<EditorHost>(host ?? defaultHost)
  if (host && hostRef.current !== host) hostRef.current = host

  // 创建 Editor (仅一次)
  useEffect(() => {
    if (!containerRef.current) return
    const h = hostRef.current
    // 绑定渲染表面 + 交互宿主到容器 (Editor 构造前)。
    // mount 是 DOM 宿主特有的显式步骤; 非 DOM 宿主可省 —— 以能力探测而非
    // 类型断言区分, 免得把「宿主没实现 mount」当成错误。
    const mountable = h.surface as { mount?: (c: HTMLElement) => void }
    mountable.mount?.(containerRef.current)
    ;(h.input as { mount?: (c: HTMLElement) => void }).mount?.(containerRef.current)

    const editor = new Editor(h, document)
    // 候选是 runtime-only 且 owner 在文档之外 —— 必须在构造后、setDocument
    // 前注入; setDocument 换文档不会重置它 (Editor.setDocument 仅在显式传入
    // 时才替换 provider)。
    if (dictionaries !== undefined) editor.setDictionaries(dictionaries)
    editorRef.current = editor
    setStore(editor.getStore())
    setReady(true)
    if (autoFocus) editor.focus()
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

  // ---- 画布主题同步 ----
  // themePreset 是受控 prop: 应用订阅自己的 UI store 后传入。这里只负责把它
  // 落到 Editor.setTheme → document:changed('none') → Draw 重绘 (§7.1 owner 在应用)。
  useEffect(() => {
    if (themePreset === undefined) return
    editorRef.current?.setTheme(themePreset)
  }, [themePreset])

  // ---- 画布语言同步 ----
  // 订阅 locale 变化 → Editor.refreshForLocale → 重排 + 重绘 + contentChange。
  //
  // 为什么必须重排: 域代码的日期/时间文本随语言变格式, 文字宽度随之变
  // (只重绘会让域后文字重叠或拖出空白)。为什么不走 document:changed:
  // 'none' 不重排; 'full' 会 markDirty (语言不是文档内容, 不该把文档标脏)。
  //
  // 注意 locale.subscribe 是**无参回调**签名 (不是 zustand 的 (state, prev)),
  // 与 themePreset 那段不同, 不能照搬参数。
  useEffect(() => {
    const unsub = locale.subscribe(() => {
      editorRef.current?.refreshForLocale()
    })
    return unsub
  }, [])

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
