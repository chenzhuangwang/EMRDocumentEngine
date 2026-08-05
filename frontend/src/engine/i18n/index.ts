// ============================================================
// i18n — 国际化基础 (R53, v6.0)
//
// LocaleMessages + setLocale/getLocale + 内置 zh-CN/en-US
// 支持第三方部分覆盖
// ============================================================

export type Locale = 'zh-CN' | 'en-US'

export interface LocaleMessages {
  // 通用
  'common.save': string
  'common.cancel': string
  'common.confirm': string
  'common.delete': string
  'common.close': string
  'common.search': string
  'common.loading': string
  'common.noData': string
  // 编辑器
  'editor.undo': string
  'editor.redo': string
  'editor.copy': string
  'editor.cut': string
  'editor.paste': string
  'editor.selectAll': string
  'editor.bold': string
  'editor.italic': string
  'editor.underline': string
  'editor.strikethrough': string
  'editor.fontSize': string
  'editor.fontFamily': string
  'editor.alignLeft': string
  'editor.alignCenter': string
  'editor.alignRight': string
  'editor.bulletList': string
  'editor.orderedList': string
  // 文件
  'file.new': string
  'file.open': string
  'file.save': string
  'file.export': string
  'file.print': string
  'file.properties': string
  // 状态
  'status.saved': string
  'status.saving': string
  'status.unsaved': string
  'status.error': string
}

// ---- 内置语言包 ----

const zhCN: LocaleMessages = {
  'common.save': '保存',
  'common.cancel': '取消',
  'common.confirm': '确认',
  'common.delete': '删除',
  'common.close': '关闭',
  'common.search': '搜索',
  'common.loading': '加载中...',
  'common.noData': '暂无数据',
  'editor.undo': '撤销',
  'editor.redo': '重做',
  'editor.copy': '复制',
  'editor.cut': '剪切',
  'editor.paste': '粘贴',
  'editor.selectAll': '全选',
  'editor.bold': '加粗',
  'editor.italic': '斜体',
  'editor.underline': '下划线',
  'editor.strikethrough': '删除线',
  'editor.fontSize': '字号',
  'editor.fontFamily': '字体',
  'editor.alignLeft': '左对齐',
  'editor.alignCenter': '居中',
  'editor.alignRight': '右对齐',
  'editor.bulletList': '无序列表',
  'editor.orderedList': '有序列表',
  'file.new': '新建',
  'file.open': '打开',
  'file.save': '保存',
  'file.export': '导出',
  'file.print': '打印',
  'file.properties': '文档属性',
  'status.saved': '已保存',
  'status.saving': '保存中...',
  'status.unsaved': '未保存',
  'status.error': '保存失败',
}

const enUS: LocaleMessages = {
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.search': 'Search',
  'common.loading': 'Loading...',
  'common.noData': 'No Data',
  'editor.undo': 'Undo',
  'editor.redo': 'Redo',
  'editor.copy': 'Copy',
  'editor.cut': 'Cut',
  'editor.paste': 'Paste',
  'editor.selectAll': 'Select All',
  'editor.bold': 'Bold',
  'editor.italic': 'Italic',
  'editor.underline': 'Underline',
  'editor.strikethrough': 'Strikethrough',
  'editor.fontSize': 'Font Size',
  'editor.fontFamily': 'Font',
  'editor.alignLeft': 'Align Left',
  'editor.alignCenter': 'Center',
  'editor.alignRight': 'Align Right',
  'editor.bulletList': 'Bullet List',
  'editor.orderedList': 'Numbered List',
  'file.new': 'New',
  'file.open': 'Open',
  'file.save': 'Save',
  'file.export': 'Export',
  'file.print': 'Print',
  'file.properties': 'Properties',
  'status.saved': 'Saved',
  'status.saving': 'Saving...',
  'status.unsaved': 'Unsaved',
  'status.error': 'Save Error',
}

// ---- 引擎 ----

const PACKS: Record<Locale, LocaleMessages> = { 'zh-CN': zhCN, 'en-US': enUS }

class LocaleManager {
  private current: Locale = 'zh-CN'
  private messages: LocaleMessages
  private overrides: Partial<LocaleMessages> = {}

  constructor() {
    this.messages = { ...PACKS['zh-CN'] }
  }

  setLocale(locale: Locale): void {
    this.current = locale
    this.messages = { ...PACKS[locale], ...this.overrides }
  }

  getLocale(): Locale { return this.current }

  /** 第三方部分覆盖 (合并到当前语言包) */
  extend(patch: Partial<LocaleMessages>): void {
    this.overrides = { ...this.overrides, ...patch }
    this.messages = { ...this.messages, ...patch }
  }

  /** 获取单个翻译 */
  t(key: keyof LocaleMessages): string {
    return this.messages[key] || key
  }
}

/** 全局单例 */
export const locale = new LocaleManager()

/** 便捷翻译函数 */
export function t(key: keyof LocaleMessages): string {
  return locale.t(key)
}
