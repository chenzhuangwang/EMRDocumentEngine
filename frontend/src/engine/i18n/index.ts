// Copyright (c) 2026 陈庄旺.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// ============================================================
// i18n — 国际化基础 (R53, v6.0)
//
// LocaleMessages + setLocale/getLocale + 内置 zh-CN/en-US
// 支持第三方部分覆盖
//
// 订阅机制 (v6.1 补): UI 切语言后必须重渲染, 而 setLocale 原先只改字段不通知。
// 这里补 subscribe/getVersion/version, 形状**照抄 EditorStore** (同一个仓库里
// 只该有一种可观察对象范式)。React 侧绑定在 src/i18n/useTranslation.ts。
//
// 契约 §27.3: `locale` 仍是 app-wide 单例, 只是多带了订阅装置 —— 它**不得**
// 挪进 EditorStore/Zustand (那会造成 §7.5 duplicate state, 并把"语言"降级成
// per-Editor 事实)。其余模块级单例仍禁止携带可变状态。
//
// ⚠ 采用度现状: 文案键已扩到 ~250 项, 覆盖 components/ + pages/ 全部用户可见
// 字符串。切换语言后界面文字会跟随 locale 单例刷新; `<html lang>` 与 localStorage
// 由 i18n/bootstrap.ts 落盘。LocaleMessages 接口强类型, 漏键 tsc 即挂。
// ============================================================

export type Locale = 'zh-CN' | 'en-US'

/** 插值/复数参数 —— 值一律先转字符串再插入 */
export type LocaleParams = Record<string, string | number>

export interface LocaleMessages {
  // ============================================================
  // 通用
  // ============================================================
  'common.save': string
  'common.cancel': string
  'common.confirm': string
  'common.delete': string
  'common.close': string
  'common.search': string
  'common.loading': string
  'common.noData': string
  'common.yes': string
  'common.no': string
  'common.apply': string
  'common.insert': string
  'common.remove': string
  'common.add': string
  'common.open': string
  'common.edit': string
  'common.preview': string
  'common.refresh': string
  'common.more': string
  'common.all': string
  'common.unknown': string
  'common.previous': string
  'common.next': string
  'common.wordCount': string           // 词数后缀: 'X 词'
  'common.back': string                 // 通用返回按钮 (ComparePage 等)
  // ============================================================
  // 编辑器 — 动作
  // ============================================================
  'editor.undo': string
  'editor.redo': string
  'editor.copy': string
  'editor.cut': string
  'editor.paste': string
  'editor.selectAll': string
  'editor.clearFormat': string
  'editor.formatPainter': string
  // ============================================================
  // 编辑器 — 文本格式
  // ============================================================
  'editor.format.bold': string
  'editor.format.italic': string
  'editor.format.underline': string
  'editor.format.strikethrough': string
  'editor.format.superscript': string
  'editor.format.subscript': string
  'editor.format.alignLeft': string
  'editor.format.alignCenter': string
  'editor.format.alignRight': string
  'editor.format.alignJustify': string
  'editor.format.lineHeight': string
  // ============================================================
  // 编辑器 — 列表 / 缩进
  // ============================================================
  'editor.list.bullet': string
  'editor.list.ordered': string
  'editor.list.continueNumbering': string
  'editor.list.firstLineIndent': string
  'editor.list.firstLineIndentShort': string  // 按钮内短标签 (完整名在 title)
  'editor.list.indent': string
  'editor.list.outdent': string
  // 编号样式下拉 — 6 项
  'editor.list.numberStyle.decimal': string
  'editor.list.numberStyle.lowerAlpha': string
  'editor.list.numberStyle.upperAlpha': string
  'editor.list.numberStyle.lowerRoman': string
  'editor.list.numberStyle.upperRoman': string
  'editor.list.numberStyle.cjkIdeographic': string
  // ============================================================
  // 编辑器 — 标题样式
  // ============================================================
  'editor.heading.body': string
  'editor.heading.h1': string
  'editor.heading.h2': string
  'editor.heading.h3': string
  'editor.heading.h4': string
  'editor.heading.h5': string
  'editor.heading.h6': string
  // ============================================================
  // 编辑器 — 字体 / 字号 / 颜色
  // ============================================================
  'editor.font.family.simSun': string
  'editor.font.family.simHei': string
  'editor.font.family.kaiTi': string
  'editor.font.family.fangSong': string
  'editor.font.family.microsoftYaHei': string
  'editor.font.family.arial': string
  'editor.font.family.timesNewRoman': string
  'editor.font.family.courierNew': string
  'editor.font.sizePlaceholder': string      // 字号选择器提示
  'editor.font.highlightNone': string        // 文字高亮 "无"
  'editor.color.text': string                // 文字颜色工具名
  'editor.color.highlight': string           // 文字高亮工具名
  // ============================================================
  // 编辑器 — 域代码
  // ============================================================
  'editor.field.pageNumber': string
  'editor.field.totalPages': string
  'editor.field.currentDate': string
  'editor.field.currentTime': string
  'editor.field.authorName': string
  'editor.field.documentTitle': string
  'editor.field.lastSavedDate': string
  'editor.field.printDate': string
  // ============================================================
  // 编辑器 — 插入元素
  // ============================================================
  'editor.insert.separator': string
  'editor.insert.table': string
  'editor.insert.image': string
  'editor.insert.bookmark': string
  'editor.insert.control': string
  // ============================================================
  // 编辑器 — 表格
  // ============================================================
  'editor.table.mergeCell': string
  'editor.table.splitCell': string
  'editor.table.insertRow': string
  'editor.table.deleteRow': string
  'editor.table.insertColumn': string
  'editor.table.deleteColumn': string
  'editor.table.growable': string            // 可增长表开关
  // ============================================================
  // 编辑器 — 页眉页脚
  // ============================================================
  'editor.hf.header': string
  'editor.hf.footer': string
  'editor.hf.close': string
  'editor.hf.differentFirstPage': string
  'editor.hf.differentOddEven': string
  'editor.hf.headerHint': string            // 关闭时 title 提示
  'editor.hf.footerHint': string
  'editor.hf.variantFirst': string          // '首页' (变体前缀)
  'editor.hf.variantEven': string           // '偶数页' (变体前缀)
  'editor.hf.scopePage': string             // ' · 第 {n} 页'
  'editor.hf.insertPageNumber': string      // '插入页码'
  'editor.hf.insertDate': string            // '插入日期'
  'editor.hf.date': string                  // '日期'
  'editor.hf.closeHeaderTitle': string      // '关闭页眉编辑'
  'editor.hf.closeFooterTitle': string      // '关闭页脚编辑'
  'editor.hf.title': string                 // '页眉页脚' (工具栏入口)
  // ============================================================
  // 编辑器 — 右键菜单
  // ============================================================
  'editor.contextMenu.cut': string
  'editor.contextMenu.copy': string
  'editor.contextMenu.paste': string
  'editor.contextMenu.delete': string
  'editor.contextMenu.deleteRow': string
  'editor.contextMenu.deleteColumn': string
  'editor.contextMenu.toggleTableGrowable': string
  'editor.contextMenu.bold': string
  'editor.contextMenu.italic': string
  'editor.contextMenu.underline': string
  'editor.contextMenu.strikeout': string
  'editor.contextMenu.clearFormat': string
  'editor.contextMenu.alignLeft': string
  'editor.contextMenu.alignCenter': string
  'editor.contextMenu.alignRight': string
  'editor.contextMenu.alignJustify': string
  'editor.contextMenu.increaseIndent': string
  'editor.contextMenu.decreaseIndent': string
  'editor.contextMenu.properties': string
  // ============================================================
  // 文档状态徽章
  // ============================================================
  'status.saved': string
  'status.saving': string
  'status.unsaved': string
  'status.error': string
  // ============================================================
  // 文件操作
  // ============================================================
  'file.new': string
  'file.open': string
  'file.save': string
  'file.export': string
  'file.print': string
  'file.properties': string
  // ============================================================
  // 弹窗 — 标题
  // ============================================================
  'dialog.title.controlConfig': string
  'dialog.title.bookmark': string
  'dialog.title.print': string
  'dialog.title.printPreview': string
  'dialog.title.export': string
  'dialog.title.findReplace': string
  'dialog.title.documentProperties': string
  'dialog.title.pageSetup': string
  'dialog.title.watermark': string
  'dialog.title.pasteSpecial': string
  'dialog.title.compare': string
  // ============================================================
  // 弹窗 — 标签
  // ============================================================
  'dialog.label.dataElementName': string
  'dialog.label.dataElementCode': string
  'dialog.label.controlLabel': string
  'dialog.label.internalCode': string
  'dialog.label.controlType': string
  'dialog.label.dataType': string
  'dialog.label.format': string
  'dialog.label.placeholder': string
  'dialog.label.required': string
  'dialog.label.readonly': string
  'dialog.label.defaultValue': string
  'dialog.label.minLength': string
  'dialog.label.maxLength': string
  'dialog.label.minRows': string
  'dialog.label.scale': string
  'dialog.label.dictionary': string
  'dialog.label.options': string
  'dialog.label.searchable': string
  'dialog.label.exclusive': string
  'dialog.label.allowMultiple': string
  'dialog.label.title': string
  'dialog.label.author': string
  'dialog.label.reviewer': string
  'dialog.label.department': string
  'dialog.label.category': string
  'dialog.label.keywords': string
  'dialog.label.createdAt': string
  'dialog.label.updatedAt': string
  'dialog.label.orientation': string
  'dialog.label.size': string
  'dialog.label.margins': string
  'dialog.label.textWatermark': string
  'dialog.label.tileWatermark': string
  'dialog.label.imageWatermark': string
  'dialog.label.opacity': string
  'dialog.label.rotation': string
  'dialog.label.spacing': string
  'dialog.label.color': string
  'dialog.label.scope': string
  'dialog.label.continue': string
  'dialog.label.cancelEdit': string
  'dialog.label.discardChanges': string
  // ============================================================
  // 弹窗 — 控件类型 (controlType value 标签)
  // ============================================================
  'dialog.controlType.input': string
  'dialog.controlType.textarea': string
  'dialog.controlType.number': string
  'dialog.controlType.select': string
  'dialog.controlType.date': string
  'dialog.controlType.datetime': string
  'dialog.controlType.checkbox': string
  'dialog.controlType.radio': string
  // ============================================================
  // 弹窗 — 数据类型 (dataType value 标签)
  // ============================================================
  'dialog.dataType.S1': string
  'dialog.dataType.S2': string
  'dialog.dataType.S3': string
  'dialog.dataType.N': string
  'dialog.dataType.D': string
  'dialog.dataType.DT': string
  // ============================================================
  // 控件校验 — 拒绝原因 (controlRejectMessage)
  // ============================================================
  'control.reject.writeLocked': string
  'control.reject.typeMismatch': string
  'control.reject.enumValueNotAllowed': string
  'control.reject.numberScaleExceeded': string
  'control.reject.stringLengthOutOfRange': string
  'control.reject.dateFormatInvalid': string
  'control.reject.datetimeFormatInvalid': string
  'control.reject.generic': string             // 兜底 "输入不合法"
  // ============================================================
  // mock 数据 — 模板分类 + 模板名
  // ============================================================
  'mock.template.basic': string               // 基本信息
  'mock.template.medical': string             // 医疗文书
  'mock.template.report': string              // 检查报告
  'mock.template.blank': string               // 空白文档
  'mock.template.admission': string            // 入院记录
  'mock.template.progress': string             // 病程记录
  'mock.template.discharge': string           // 出院小结
  'mock.template.consultation': string        // 会诊记录
  'mock.template.lab': string                 // 检验报告
  'mock.template.imaging': string             // 影像报告
  'mock.template.blankDesc': string           // 从头开始创建文档
  'mock.template.admissionDesc': string
  'mock.template.progressDesc': string
  'mock.template.dischargeDesc': string
  'mock.template.consultationDesc': string
  'mock.template.labDesc': string
  'mock.template.imagingDesc': string
  // ============================================================
  // mock 数据 — 文档状态
  // ============================================================
  'mock.document.status.draft': string
  'mock.document.status.published': string
  'mock.document.status.archived': string
  'mock.document.status.unknown': string
  // ============================================================
  // HomePage
  // ============================================================
  'home.brand': string                        // 'EMR Document Editor'
  'home.title': string                        // '我的文档'
  'home.subtitle': string                     // '管理和编辑所有结构化文档'
  'home.new': string                          // '新建文档'
  'home.searchPlaceholder': string            // '搜索文档标题...'
  'home.empty': string                        // '暂无文档'
  'home.emptyHint': string                    // '点击"新建文档"开始创建'
  'home.column.title': string                 // 表格列名: 文档标题 / 状态 / ...
  'home.column.status': string
  'home.column.lastEditor': string
  'home.column.updatedAt': string
  'home.column.action': string
  'home.deleteTitle': string                  // 删除按钮 title
  'home.deleteConfirm': string                // confirm() 文案
  'home.avatarTooltip': string                // 用户头像
  'home.loadError': string                    // 加载失败
  // ============================================================
  // EditorPage 大块
  // ============================================================
  'editorPage.loading': string
  'editorPage.importUnknownFormat': string    // '无法识别该文件格式：{name}'
  'editorPage.importError': string            // '导入失败：{msg}'
  'editorPage.printingTitle': string          // 打印预览的 <title>
  'editorPage.previewAlt': string             // 预览图 alt
  // ============================================================
  // StatusBar
  // ============================================================
  'statusBar.pageOf': string                  // '第 {current} 页 / 共 {total} 页'
  'statusBar.wordCount': string               // '{n} 字'
  'statusBar.zoomIn': string
  'statusBar.zoomOut': string
  'statusBar.zoom': string                    // 滑块 title '缩放: {pct}%'
  'statusBar.zoomReset': string
  'statusBar.showInvisible': string
  'statusBar.hideInvisible': string
  'statusBar.online': string                  // '{n} 人在线'
  'statusBar.offline': string
  'statusBar.errorChipTitle': string          // '{code}: {msg}（点击关闭）'
  'statusBar.errorChipAria': string           // '引擎错误：{msg}（点击关闭）'
  'statusBar.scale.tooltip': string           // 完整句: 量表评分 X 分...
  'statusBar.scale.value': string             // '{total} 分'
  'statusBar.scale.uncountedNote': string      // '\n另有 {n} 个控件已填但候选项未配数值，未计入。'
  // ============================================================
  // HeaderBar
  // ============================================================
  'headerBar.openSidebar': string
  'headerBar.closeSidebar': string
  'headerBar.brand': string                   // 'EMR Editor'
  'headerBar.titlePlaceholder': string        // '未命名文档'
  'headerBar.titleAria': string               // '文档标题'
  'headerBar.undo': string                    // 含快捷键: '撤销 (Ctrl+Z)'
  'headerBar.redo': string                    // '重做 (Ctrl+Y)'
  'headerBar.save': string                    // '保存 (Ctrl+S)'
  'headerBar.import': string                  // '导入文档/模板 (JSON/HTML/Markdown)'
  'headerBar.docProperties': string          // '文档属性'
  'headerBar.notLoggedIn': string             // '未登录'
  // 顶栏右侧两个切换菜单 (title/aria-label 与菜单项)
  'headerBar.languageMenu': string            // '界面语言'
  'headerBar.themeMenu': string               // '界面主题'
  'theme.standard': string
  'theme.standardHint': string
  'theme.eyeCare': string
  'theme.eyeCareHint': string
  'theme.print': string
  'theme.printHint': string
  'theme.dark': string
  'theme.darkHint': string
  // ============================================================
  // SaveIndicator (4 个状态)
  // ============================================================
  'headerBar.saveStatus.saved': string
  'headerBar.saveStatus.saving': string
  'headerBar.saveStatus.unsaved': string
  'headerBar.saveStatus.error': string
  // ============================================================
  // Sidebar
  // ============================================================
  'sidebar.tab.templates': string
  'sidebar.tab.elements': string
  'sidebar.tab.pages': string
  'sidebar.tab.comments': string
  'sidebar.tab.qc': string
  'sidebar.templatesEmpty': string
  'sidebar.elementsEmpty': string
  'sidebar.searchPlaceholder': string
  // ============================================================
  // Toolbar — 公共
  // ============================================================
  'toolbar.export': string
  'toolbar.exportDocument': string
  'toolbar.pageSetup': string
  'toolbar.watermark': string
  'toolbar.print': string
  'toolbar.headingStyle': string              // 标题样式下拉 title
  'toolbar.numberStyle': string               // 编号样式下拉 title
  'toolbar.insertControl': string             // 插入表单控件 title
  'toolbar.controlShort': string               // '控件' (工具栏短标签)
  'toolbar.insertField': string               // 插入域代码 title
  'toolbar.lineHeight': string
  // 控件插入向导的一行描述 (与 dialog.controlType.* 的控件名配对)
  'toolbar.controlDesc.input': string
  'toolbar.controlDesc.radio': string
  'toolbar.controlDesc.checkbox': string
  // 控件配置面板 — 码表绑定 (controlConfigShared.DictionaryField / CodeBadge)
  'controlConfig.codeBadge.internal': string
  'controlConfig.codeBadge.dataElement': string
  'controlConfig.dict.label': string
  'controlConfig.dict.unbound': string
  'controlConfig.dict.idLabel': string
  'controlConfig.dict.idPlaceholder': string
  'controlConfig.dict.clear': string
  'controlConfig.dict.badIdHint': string
  'controlConfig.dict.inlineOverrideHint': string
  'controlConfig.dict.platformHint': string
  // ============================================================
  // RecentDocuments
  // ============================================================
  'recentDoc.title': string                   // 标题占位
  'recentDoc.empty': string
  'recentDoc.separator': string               // ' · {n} 词'
  'recentDoc.justNow': string
  'recentDoc.secondsAgo': string             // '{n} 秒前'
  'recentDoc.minutesAgo': string             // '{n} 分钟前'
  'recentDoc.hoursAgo': string               // '{n} 小时前'
  'recentDoc.daysAgo': string                 // '{n} 天前'
  // ============================================================
  // OutlineNav
  // ============================================================
  'outline.title': string
  'outline.empty': string
  'outline.headingTitle': string             // 'Heading {level}: {text}'
  // ============================================================
  // CommentPanel
  // ============================================================
  'comment.title': string
  'comment.filter.all': string                // '全部 ({n})'
  'comment.filter.unresolved': string
  'comment.filter.resolved': string
  'comment.empty': string
  'comment.newThread': string
  'comment.placeholder': string
  'comment.addReply': string
  'comment.anchor': string                    // '锚定：{text}'
  'comment.timeJustNow': string
  'comment.timeMinutesAgo': string            // '{n} 分钟前'
  'comment.timeHoursAgo': string              // '{n} 小时前'
  'comment.timeDaysAgo': string               // '{n} 天前'
  'comment.resolve': string
  'comment.unresolve': string
  'comment.noSelection': string               // '请先在文档中...'
  'comment.anchorFailed': string               // '请先在文档中选中同一段落内的文字...'
  'comment.newTitle': string                   // '在文档中选中文字后新建批注'
  'comment.replyPlaceholder': string           // '输入回复...'
  'comment.noContent': string                  // '(无内容)'
  'comment.resolveTitle': string               // '标记为已解决'
  'comment.resolvedBadge': string              // '已解决'
  'comment.summary': string                    // '{open} 条未解决 · {total} 条总计'
  // ============================================================
  // QCResultPanel
  // ============================================================
  'qc.empty': string
  'qc.start': string
  'qc.score': string
  'qc.gradeA': string
  'qc.gradeB': string
  'qc.gradeC': string
  'qc.gradeD': string
  'qc.issueCount': string
  'qc.byCategory': string
  'qc.bySeverity': string
  'qc.issues': string
  'qc.error': string
  'qc.warning': string
  'qc.info': string
  'qc.passed': string
  'qc.maxScore': string                        // '满分 100'
  'qc.errorCount': string                      // '{n} 错误'
  'qc.warningCount': string                    // '{n} 警告'
  'qc.infoCount': string                       // '{n} 提示'
  'qc.jumpToIssue': string                     // '跳转到该位置'
  'qc.docLevelIssue': string                   // '文档级问题，无具体位置'
  'qc.recheck': string                         // '重新检查'
  // ============================================================
  // DocumentCompareView
  // ============================================================
  'compare.title': string
  'compare.accept': string
  'compare.reject': string
  'compare.acceptAll': string
  'compare.rejectAll': string
  'compare.versionIds': string           // '旧版本 ID: {oldId} → 新版本 ID: {newId}'
  'compare.parseError': string           // '文档解析失败'
  'compare.emptyError': string           // '文档内容为空'
  'compare.loadError': string            // '加载文档失败'
  'compare.label.insert': string         // '新增段落'
  'compare.label.delete': string         // '删除段落'
  'compare.label.modify': string         // '修改段落'
  'compare.label.equal': string          // '相同'
  'compare.count.insert': string         // '{n} 新增'
  'compare.count.delete': string         // '{n} 删除'
  'compare.count.modify': string         // '{n} 修改'
  'compare.count.equal': string          // '{n} 相同'
  'compare.textChangeCount': string      // '{n} 处文本变更'
  'compare.identical': string            // '两份文档完全相同'
  'compare.noContent': string            // '(无内容)'
  'compare.emptyParagraph': string       // '(空段落)'
  'compare.imagePlaceholder': string     // '[图片]'
  'compare.footnotePlaceholder': string  // '[脚注]'
  // ============================================================
  // ModeSwitcher (6 个编辑模式)
  // ============================================================
  'mode.edit': string
  'mode.design': string
  'mode.form': string
  'mode.readonly': string
  'mode.print': string
  'mode.preview': string
  'mode.clean': string                       // EditorMode 'clean' (纯文本) 显示名
  'mode.switchTitle': string                 // '切换编辑器模式'
  // ============================================================
  // ReadingMode
  // ============================================================
  'reading.exit': string
  'reading.hint': string                     // '阅读模式 · 按 ESC 退出'
  // ============================================================
  // DesignControlProperties / DesignControlPalette
  // ============================================================
  'design.title': string
  'design.openConfig': string
  'design.paletteTitle': string
  'design.paletteDescription': string
  'design.properties.semantic': string       // '语义信息（只读）'
  'design.properties.notSpecified': string   // '未指定'
  'design.controlFallback': string            // '控件' (element 无名时标题兜底)
  'design.clearAllTitle': string              // '清除全部设计期属性'
  'design.field.label': string
  'design.field.tips': string
  'design.field.prefix': string
  'design.field.suffix': string
  'design.field.deletable': string
  'design.field.editable': string
  'design.field.single': string
  'design.identity.dataElement': string
  'design.identity.dataType': string
  'design.identity.showType': string
  'design.identity.enums': string
  'design.identity.required': string
  'design.identity.readonly': string
  'design.expand': string                     // '展开'
  'design.collapse': string                   // '折叠'
  'design.singleBadge': string                // '单值'
  'design.singleTitle': string                // '单值字段 (文档中仅可插入一次)'
  // ============================================================
  // controlDisplay.ts
  // ============================================================
  'controlDisplay.notSpecified': string
  'controlDisplay.yes': string
  'controlDisplay.no': string
  'controlDisplay.itemCount': string          // '{n} 项'
  'controlDisplay.textInput': string          // '单行文本' / 'Single Line'
  'controlDisplay.textarea': string           // '多行文本' / 'Multi Line'
  // controlType 属性面板展示名 (与控件库目录名一致; 区别于 dialog.controlType.*
  // 的配置弹窗短标签)
  'controlDisplay.type.input': string         // '单行文本'
  'controlDisplay.type.textarea': string      // '多行文本'
  'controlDisplay.type.number': string        // '数字输入'
  'controlDisplay.type.select': string        // '下拉选择'
  'controlDisplay.type.date': string          // '日期选择'
  'controlDisplay.type.datetime': string      // '日期时间选择'
  'controlDisplay.type.checkbox': string      // '复选框'
  'controlDisplay.type.radio': string         // '单选框'
  // ============================================================
  // RepoLinks
  // ============================================================
  'repo.gitee': string
  'repo.github': string
  'repo.aria': string                         // '开源仓库 · {label}'
  // ============================================================
  // PerfPanel
  // ============================================================
  'perf.title': string
  'perf.fps': string
  'perf.layout': string
  'perf.render': string
  'perf.cache': string
  'perf.start': string
  'perf.stop': string
  'perf.reset': string
  // ============================================================
  // FindReplaceDialog
  // ============================================================
  'find.find': string
  'find.replace': string
  'find.caseSensitive': string
  'find.wholeWord': string
  'find.useRegex': string
  'find.results': string                      // '{n} 个结果'
  'find.noResults': string
  'find.next': string
  'find.previous': string
  'find.replaceAll': string
  'find.close': string
  'find.placeholder': string                  // '输入查找内容...'
  'find.replacePlaceholder': string           // '替换为...'
  'find.expandReplace': string                // '展开替换'
  'find.collapseReplace': string             // '收起替换'
  // ============================================================
  // PrintDialog
  // ============================================================
  'print.recent': string
  'print.unfinished': string
  'print.resume': string                      // '续打: 从第 X 页开始'
  'print.cancelResume': string
  'print.orientation.portrait': string
  'print.orientation.landscape': string
  'print.range.all': string
  'print.range.current': string
  'print.range.selection': string
  'print.range.range': string                  // '页码范围'
  'print.range.fromTo': string
  'print.range.to': string                     // '至'
  'print.range.totalLabel': string             // '页 (共 {n} 页)'
  'print.range.label': string                  // '页码范围' (label)
  'print.range.custom': string                 // '自定义'
  'print.printer': string                      // '打印机'
  'print.printerDefault': string               // '默认打印机' (未接打印机枚举时的占位值)
  'print.duplex.label': string                 // '打印方式'
  'print.duplex.duplex': string                // '双面打印'
  'print.duplex.simplex': string               // '单面打印'
  'print.duplex.duplexShort': string           // '双面'
  'print.duplex.simplexShort': string          // '单面'
  'print.summary': string                      // '共 {total} 页 · 打印 {printing} 页 · {copies} 份 · {sides}'
  'print.historySubline': string               // '{copies} 份 · {sides}'
  'print.systemNote': string                   // '页码范围由本应用按页渲染...'
  'print.copies': string
  'print.printedAt': string
  'print.relative.secondsAgo': string
  'print.relative.minutesAgo': string
  'print.relative.hoursAgo': string
  'print.relative.daysAgo': string
  'print.relative.justNow': string
  'print.relative.unknown': string
  // ============================================================
  // PageSetupDialog
  // ============================================================
  'pageSetup.preset': string
  'pageSetup.presetA4': string
  'pageSetup.presetLetter': string
  'pageSetup.presetLegal': string
  'pageSetup.presetA3': string                 // 复用 A3 纸
  'pageSetup.marginTop': string
  'pageSetup.marginBottom': string
  'pageSetup.marginLeft': string
  'pageSetup.marginRight': string
  'pageSetup.headerDistance': string
  'pageSetup.footerDistance': string
  'pageSetup.tabMargins': string
  'pageSetup.tabPaper': string
  'pageSetup.tabLayout': string
  'pageSetup.pageVerticalGap': string         // 分页间隙
  'pageSetup.applyTo': string                   // '应用于'
  'pageSetup.applyWholeDocument': string        // 整篇文档
  'pageSetup.applyFromThisPoint': string        // 从本节开始
  'pageSetup.applyThisSection': string          // 本节
  'pageSetup.hfFutureNote': string              // 页眉页脚后续版本提示
  // ============================================================
  // WatermarkDialog (复用 dialog.title.watermark; 此处不复述)
  // ============================================================
  'watermark.text': string
  'watermark.fontSize': string
  'watermark.opacity': string
  'watermark.rotation': string
  'watermark.spacing': string
  'watermark.color': string
  'watermark.imageUrl': string
  'watermark.imageScale': string
  'watermark.apply': string
  'watermark.remove': string
  'watermark.internalMark': string
  'watermark.confidentialMark': string
  'watermark.textPlaceholder': string       // '例如: 内部资料'
  'watermark.removeTitle': string            // '删除本文档的水印'
  // ============================================================
  // PasteSpecialDialog
  // ============================================================
  'paste.keepSource': string
  'paste.matchTarget': string
  'paste.plainText': string
  'paste.title': string
  'paste.keepSourceDesc': string
  'paste.matchTargetDesc': string
  'paste.plainTextDesc': string
  'paste.previewLabel': string
  'paste.shortcut': string
  'paste.confirm': string
  'preview.paperFormat': string
  'preview.pageCount': string
  // ============================================================
  // ExportDialog
  // ============================================================
  'export.title': string
  'export.format': string
  'export.include': string
  'export.confirm': string
  'export.pdf': string
  'export.word': string
  'export.html': string
  'export.txt': string
  'export.json': string
  'export.pdfDesc': string
  'export.wordDesc': string
  'export.htmlDesc': string
  'export.txtDesc': string
  'export.jsonDesc': string
  'export.comingSoon': string
  // ============================================================
  // ControlConfig 对话框专属
  // ============================================================
  'controlConfig.element': string
  'controlConfig.definition': string
  'controlConfig.basic': string
  'controlConfig.tab.basic': string
  'controlConfig.tab.format': string
  'controlConfig.tab.options': string
  'controlConfig.tab.advanced': string
  'controlConfig.internal': string
  'controlConfig.dataElement': string
  'controlConfig.optionsEmpty': string
  'controlConfig.optionsEmptyHint': string
  'controlConfig.addOption': string
  'controlConfig.removeOption': string
  'controlConfig.optionValue': string        // 值 (候选项值)
  'controlConfig.optionName': string         // 显示名
  'controlConfig.codePreview': string
  'controlConfig.create': string
  'controlConfig.editMode': string
  'controlConfig.allowFreeInput': string
  'controlConfig.dictionaryIdLabel': string
  'controlConfig.dictionaryIdPlaceholder': string
  'controlConfig.dictionaryIdInvalid': string
  'controlConfig.dictionaryInlineConflict': string
  'controlConfig.dictionaryCandidateNote': string
  'controlConfig.clear': string
  'controlConfig.fallbackName': string          // '输入域' (标题兜底)
  'controlConfig.labelField': string            // '控件标签 (旁注)'
  'controlConfig.addOptionAction': string       // '+ 添加选项'
  'controlConfig.namePlaceholder': string
  'controlConfig.labelPlaceholder': string
  'controlConfig.styleHint': string
  'controlConfig.kindLabel': string
  'controlConfig.numberDisplay': string
  'controlConfig.defaultOption': string
  'controlConfig.numberDisplayN': string
  'controlConfig.numberDisplayAN': string
  'controlConfig.numericValuePlaceholder': string
  'controlConfig.unlimited': string
  'controlConfig.dateFormatHint': string
  'controlConfig.dateTimeFormatHint': string
  'controlConfig.bindingHint': string
  'controlConfig.prefixLabel': string
  'controlConfig.prefixPlaceholder': string
  'controlConfig.suffixLabel': string
  'controlConfig.suffixPlaceholder': string
  'controlConfig.tipsLabel': string
  'controlConfig.tipsPlaceholder': string
  'controlConfig.deletableLabel': string
  'controlConfig.editableLabel': string
  'controlConfig.singleLabel': string
  // ---- ControlChoiceDialog (单选/复选) ----
  'choice.create': string                       // '新建单选/复选'
  'choice.fallbackName': string                 // '单选复选'
  'choice.tab.type': string                     // '控件类型'
  'choice.tab.base': string                     // '基础属性'
  'choice.tab.options': string                  // '选项设置'
  'choice.tab.numeric': string                  // '数值属性'
  'choice.tab.list': string                     // '项目列表'
  'choice.radioLabel': string                   // '单选框'
  'choice.radioDesc': string                    // '每次仅可选中一项'
  'choice.checkboxLabel': string                // '复选框'
  'choice.checkboxDesc': string                 // '可同时选中多项'
  'choice.typeNote': string                     // 单选/复选取值说明
  'choice.namePlaceholder': string              // '如 症状'
  'choice.labelPlaceholder': string             // '如 症状：'
  'choice.enumEditableLabel': string            // '允许输入自定义值 (不在候选项内)'
  'choice.optionsHeader': string                // '候选项'
  'choice.addOption': string                    // '新增选项'
  'choice.col.name': string                     // '名称'
  'choice.col.value': string                    // '值'
  'choice.col.exclusive': string                // '互斥'
  'choice.col.item': string                     // '项目'
  'choice.col.numeric': string                  // '数值'
  'choice.col.itemValue': string                // '项目 (值)'
  'choice.optionsEmptyHint': string             // '暂无候选项，点右上角新增'
  'choice.optionsEmpty': string                 // '暂无候选项'
  'choice.numericNote': string                  // 数值属性说明
  'choice.listNote': string                     // 项目列表说明
  'choice.emptyName': string                    // '(空名)'
  'choice.emptyValue': string                   // '(空)'
  'choice.moveUp': string                       // '上移'
  'choice.moveDown': string                     // '下移'
  'choice.removeOption': string                 // '删除选项 {n}'
  'choice.removeByValue': string                // '删除 {value}'
  // 数据绑定 tab label — 复用 dialog.label.dictionary (它就是字典绑定的设置面板)
  'controlConfig.dataBindingTab': string
  // ============================================================
  // BookmarkDialog
  // ============================================================
  'bookmark.insertBookmark': string
  'bookmark.insertCrossRef': string
  'bookmark.crossRefTab': string
  'bookmark.footnotePrefix': string           // '脚注 {n}'
  'bookmark.pagePrefix': string               // '第 {n} 页'
  'bookmark.target': string
  'bookmark.nameLabel': string                // '书签名称'
  'bookmark.namePlaceholder': string         // '例如: 实验室检查结果'
  'bookmark.description': string              // 长说明
  'bookmark.refFormatLabel': string           // '引用格式'
  'bookmark.refFormatLabelOnly': string       // '书签名 / 标题（不带页码）'
  'bookmark.refFormatPageOnly': string        // '第 {n} 页'
  'bookmark.refFormatLabelPage': string       // '书签名（第 {n} 页）'
  'bookmark.filterPlaceholder': string         // '搜索书签/标题/脚注...'
  'bookmark.noTargets': string                // '暂无可用目标'
  'bookmark.pageNumber': string               // 'p.{n}'
  // ============================================================
  // DocumentPropertiesDialog
  // ============================================================
  'docProps.discardConfirm': string
  'docProps.unsavedHint': string
  'docProps.continueEditing': string
  'docProps.creator': string                  // '创建人'
  'docProps.externalId': string               // '外部模板 ID'
  'docProps.categoryId': string                // '外部分类 ID'
  'docProps.placeholderAuthor': string         // '作者姓名'
  'docProps.placeholderCreator': string        // '创建人'
  'docProps.placeholderReviewer': string       // '审核人'
  'docProps.placeholderDepartment': string      // '所属科室'
  'docProps.placeholderCategory': string        // '文档分类'
  'docProps.titlePlaceholder': string           // '文档标题'
  'docProps.keywordsPlaceholder': string        // '关键词1, 关键词2'
  // ============================================================
  // RuntimeControlOverlay
  // ============================================================
  'overlay.enterNumber': string               // '请输入数字'
  'overlay.selectPlaceholder': string          // '请选择'
  // ============================================================
  // TableGrowOverlay
  // ============================================================
  'tableGrow.addRow': string                  // '添加行' (按钮文字)
  'tableGrow.addRowTitle': string             // 按钮 title
  'tableGrow.growable': string                // '可增长' (设计态只读标记)
  'tableGrow.growableMarkerTitle': string     // 设计态标记 title
  // ============================================================
  // Engine error chip
  // ============================================================
  'error.unknownEngine': string
  // ============================================================
  // 引擎层文案 (engine/ 内的 chrome —— 领域数据不在此, 见 I18nGate 白名单)
  // ============================================================
  // QC 内置规则 (QCEngine.BUILTIN_RULES) — 面板直接渲染 ruleName / message
  'qc.rule.title.name': string
  'qc.rule.title.desc': string
  'qc.rule.body.name': string
  'qc.rule.body.desc': string
  'qc.rule.emptyParagraph.name': string
  'qc.rule.emptyParagraph.desc': string
  'qc.rule.smartTextRequired.name': string
  'qc.rule.smartTextRequired.desc': string
  'qc.rule.minChars.name': string
  'qc.rule.minChars.desc': string
  'qc.rule.paragraphCount.name': string
  'qc.rule.paragraphCount.desc': string
  // ErrorRecovery — 三级容错上报的消息 (→ StatusBar chip / canvas 占位页)
  'engineError.particleRender': string        // '粒子渲染失败: nodeId={nodeId}'
  'engineError.pageRender': string            // '页面渲染失败: pageIndex={pageIndex}'
  'engineError.pagePlaceholder': string       // '页面 {page} 渲染失败' (画在 canvas 上)
  'engineError.loadFallback': string          // '文档加载失败, 已回退到空白文档'
  'engineError.loadFallbackFailed': string    // '回落文档同样加载失败'
  'engineError.asyncTask': string             // '异步任务失败'
  // 文档加载 (DocumentLoader / DocumentLoaderRegistry)
  'loader.failed': string                     // '"{name}" 加载失败：{msg}'
  'loader.parseFailed': string                // 'JSON.parse 失败: {msg}'
  'loader.notObject': string
  'loader.upgradeFailed': string              // '升级失败: {msg}'
  'loader.badDocId': string
  'loader.badDocTitle': string
  'loader.badBodyChildren': string
  'loader.badMetadata': string
  'loader.badChildRef': string                // 'children 包含非字符串引用: {id}'
  'loader.danglingRef': string                // '引用悬空 (节点未在 nodes/extraNodes 中): {id}'
  'loader.versionTooNew': string              // '文档版本 {ver} 高于引擎支持版本 {current}'
  'loader.versionOutdated': string            // '需升级: {ver} → {current}'
  'loader.versionCurrent': string             // '版本一致'
  'loader.importedHtml': string               // 导入默认标题
  'loader.importedMarkdown': string
  'loader.importedXml': string
  // 文档默认标题 / 模板
  'doc.untitled': string
  'doc.recovered': string
  'doc.importedTemplate': string
  // 书签交叉引用目标 (getBookmarkTargets)
  'nav.headingFallback': string               // '标题{level}'
  'nav.footnoteLabel': string                 // '脚注 {id}'
  // 目录 / 控件占位
  'toc.title': string                         // '目录'
  'toc.emptyHeading': string                  // '(空标题)'
  'control.emptyOptions': string              // '无候选项'
  // 域代码占位符 (createFieldNode 写入 cachedValue)
  'field.placeholder.pageNumber': string
  'field.placeholder.totalPages': string
  'field.placeholder.currentDate': string
  'field.placeholder.currentTime': string
  'field.placeholder.authorName': string
  'field.placeholder.documentTitle': string
  'field.placeholder.lastSavedDate': string
  'field.placeholder.printDate': string
  // ============================================================
  // 既有: 插值/复数示范键
  // ============================================================
  /** 插值: `{current}` / `{total}` */
  'editor.pageOf': string
  /** 复数: ICU 单层 `{n, plural, one {…} other {…}}` */
  'editor.controlCount': string
}

// ---- 内置语言包 ----

const zhCN: LocaleMessages = {
  // ===== 通用 =====
  'common.save': '保存',
  'common.cancel': '取消',
  'common.confirm': '确认',
  'common.delete': '删除',
  'common.close': '关闭',
  'common.search': '搜索',
  'common.loading': '加载中...',
  'common.noData': '暂无数据',
  'common.yes': '是',
  'common.no': '否',
  'common.apply': '应用',
  'common.insert': '插入',
  'common.remove': '移除',
  'common.add': '新增',
  'common.open': '打开',
  'common.edit': '编辑',
  'common.preview': '预览',
  'common.refresh': '刷新',
  'common.more': '更多',
  'common.all': '全部',
  'common.unknown': '未知',
  'common.previous': '上一个',
  'common.next': '下一个',
  'common.wordCount': '{n} 词',
  'common.back': '返回',
  // ===== 编辑动作 =====
  'editor.undo': '撤销',
  'editor.redo': '重做',
  'editor.copy': '复制',
  'editor.cut': '剪切',
  'editor.paste': '粘贴',
  'editor.selectAll': '全选',
  'editor.clearFormat': '清除格式',
  'editor.formatPainter': '格式刷',
  // ===== 文本格式 =====
  'editor.format.bold': '加粗',
  'editor.format.italic': '斜体',
  'editor.format.underline': '下划线',
  'editor.format.strikethrough': '删除线',
  'editor.format.superscript': '上标',
  'editor.format.subscript': '下标',
  'editor.format.alignLeft': '左对齐',
  'editor.format.alignCenter': '居中',
  'editor.format.alignRight': '右对齐',
  'editor.format.alignJustify': '两端对齐',
  'editor.format.lineHeight': '行距',
  // ===== 列表 =====
  'editor.list.bullet': '无序列表',
  'editor.list.ordered': '有序列表',
  'editor.list.continueNumbering': '继续上一列表编号',
  'editor.list.firstLineIndent': '首行缩进',
  'editor.list.firstLineIndentShort': '首行',
  'editor.list.indent': '增加缩进',
  'editor.list.outdent': '清空缩进',
  'editor.list.numberStyle.decimal': '1, 2, 3',
  'editor.list.numberStyle.lowerAlpha': 'a, b, c',
  'editor.list.numberStyle.upperAlpha': 'A, B, C',
  'editor.list.numberStyle.lowerRoman': 'i, ii, iii',
  'editor.list.numberStyle.upperRoman': 'I, II, III',
  'editor.list.numberStyle.cjkIdeographic': '一, 二, 三',
  // ===== 标题 =====
  'editor.heading.body': '正文',
  'editor.heading.h1': '标题 1',
  'editor.heading.h2': '标题 2',
  'editor.heading.h3': '标题 3',
  'editor.heading.h4': '标题 4',
  'editor.heading.h5': '标题 5',
  'editor.heading.h6': '标题 6',
  // ===== 字体 =====
  'editor.font.family.simSun': '宋体',
  'editor.font.family.simHei': '黑体',
  'editor.font.family.kaiTi': '楷体',
  'editor.font.family.fangSong': '仿宋',
  'editor.font.family.microsoftYaHei': '微软雅黑',
  'editor.font.family.arial': 'Arial',
  'editor.font.family.timesNewRoman': 'Times New Roman',
  'editor.font.family.courierNew': 'Courier New',
  'editor.font.sizePlaceholder': '字号',
  'editor.font.highlightNone': '无',
  'editor.color.text': '文字颜色',
  'editor.color.highlight': '文字高亮',
  // ===== 域代码 =====
  'editor.field.pageNumber': '页码',
  'editor.field.totalPages': '总页数',
  'editor.field.currentDate': '当前日期',
  'editor.field.currentTime': '当前时间',
  'editor.field.authorName': '作者名称',
  'editor.field.documentTitle': '文档标题',
  'editor.field.lastSavedDate': '最后保存日期',
  'editor.field.printDate': '打印日期',
  // ===== 插入 =====
  'editor.insert.separator': '插入分隔线',
  'editor.insert.table': '插入表格',
  'editor.insert.image': '插入图片',
  'editor.insert.bookmark': '插入书签',
  'editor.insert.control': '插入表单控件',
  // ===== 表格 =====
  'editor.table.mergeCell': '合并单元格',
  'editor.table.splitCell': '拆分单元格',
  'editor.table.insertRow': '插入行',
  'editor.table.deleteRow': '删除行',
  'editor.table.insertColumn': '插入列',
  'editor.table.deleteColumn': '删除列',
  'editor.table.growable': '填写时可增长',
  // ===== 页眉页脚 =====
  'editor.hf.header': '页眉',
  'editor.hf.footer': '页脚',
  'editor.hf.close': '关闭页眉页脚',
  'editor.hf.differentFirstPage': '首页不同',
  'editor.hf.differentOddEven': '奇偶页不同',
  'editor.hf.headerHint': '编辑页眉',
  'editor.hf.footerHint': '编辑页脚',
  'editor.hf.variantFirst': '首页',
  'editor.hf.variantEven': '偶数页',
  'editor.hf.scopePage': ' · 第 {n} 页',
  'editor.hf.insertPageNumber': '插入页码',
  'editor.hf.insertDate': '插入日期',
  'editor.hf.date': '日期',
  'editor.hf.closeHeaderTitle': '关闭页眉编辑',
  'editor.hf.closeFooterTitle': '关闭页脚编辑',
  'editor.hf.title': '页眉页脚',
  // ===== 右键菜单 =====
  'editor.contextMenu.cut': '剪切',
  'editor.contextMenu.copy': '复制',
  'editor.contextMenu.paste': '粘贴',
  'editor.contextMenu.delete': '删除',
  'editor.contextMenu.deleteRow': '删除行',
  'editor.contextMenu.deleteColumn': '删除列',
  'editor.contextMenu.toggleTableGrowable': '填写时可增长',
  'editor.contextMenu.bold': '加粗',
  'editor.contextMenu.italic': '斜体',
  'editor.contextMenu.underline': '下划线',
  'editor.contextMenu.strikeout': '删除线',
  'editor.contextMenu.clearFormat': '清除格式',
  'editor.contextMenu.alignLeft': '左对齐',
  'editor.contextMenu.alignCenter': '居中',
  'editor.contextMenu.alignRight': '右对齐',
  'editor.contextMenu.alignJustify': '两端对齐',
  'editor.contextMenu.increaseIndent': '增加缩进',
  'editor.contextMenu.decreaseIndent': '减少缩进',
  'editor.contextMenu.properties': '属性…',
  // ===== 文档状态 =====
  'status.saved': '已保存',
  'status.saving': '保存中...',
  'status.unsaved': '未保存',
  'status.error': '保存失败',
  // ===== 文件 =====
  'file.new': '新建',
  'file.open': '打开',
  'file.save': '保存',
  'file.export': '导出',
  'file.print': '打印',
  'file.properties': '文档属性',
  // ===== 弹窗标题 =====
  'dialog.title.controlConfig': '控件配置',
  'dialog.title.bookmark': '书签与引用',
  'dialog.title.print': '打印',
  'dialog.title.printPreview': '打印预览',
  'dialog.title.export': '导出文档',
  'dialog.title.findReplace': '查找与替换',
  'dialog.title.documentProperties': '文档属性',
  'dialog.title.pageSetup': '页面设置',
  'dialog.title.watermark': '水印',
  'dialog.title.pasteSpecial': '选择性粘贴',
  'dialog.title.compare': '文档比较',
  // ===== 弹窗标签 =====
  'dialog.label.dataElementName': '数据元名称',
  'dialog.label.dataElementCode': '数据元编码',
  'dialog.label.controlLabel': '控件标签',
  'dialog.label.internalCode': '内部编码',
  'dialog.label.controlType': '控件类型',
  'dialog.label.dataType': '数据类型',
  'dialog.label.format': '格式',
  'dialog.label.placeholder': '占位符',
  'dialog.label.required': '必填',
  'dialog.label.readonly': '只读',
  'dialog.label.defaultValue': '默认值',
  'dialog.label.minLength': '最小长度',
  'dialog.label.maxLength': '最大长度',
  'dialog.label.minRows': '最小行数',
  'dialog.label.scale': '小数位数',
  'dialog.label.dictionary': '字典绑定',
  'dialog.label.options': '候选项',
  'dialog.label.searchable': '可搜索',
  'dialog.label.exclusive': '排他',
  'dialog.label.allowMultiple': '允许多选',
  'dialog.label.title': '文档标题',
  'dialog.label.author': '作者',
  'dialog.label.reviewer': '审核人',
  'dialog.label.department': '科室',
  'dialog.label.category': '分类',
  'dialog.label.keywords': '关键词',
  'dialog.label.createdAt': '创建时间',
  'dialog.label.updatedAt': '更新时间',
  'dialog.label.orientation': '方向',
  'dialog.label.size': '纸张大小',
  'dialog.label.margins': '页边距',
  'dialog.label.textWatermark': '文字水印',
  'dialog.label.tileWatermark': '平铺水印',
  'dialog.label.imageWatermark': '图片水印',
  'dialog.label.opacity': '透明度',
  'dialog.label.rotation': '旋转',
  'dialog.label.spacing': '间距',
  'dialog.label.color': '颜色',
  'dialog.label.scope': '范围',
  'dialog.label.continue': '继续编辑',
  'dialog.label.cancelEdit': '取消编辑',
  'dialog.label.discardChanges': '放弃更改',
  // ===== 控件类型 =====
  'dialog.controlType.input': '单行文本',
  'dialog.controlType.textarea': '多行文本',
  'dialog.controlType.number': '数字',
  'dialog.controlType.select': '下拉',
  'dialog.controlType.date': '日期',
  'dialog.controlType.datetime': '日期时间',
  'dialog.controlType.checkbox': '复选框',
  'dialog.controlType.radio': '单选框',
  // ===== 数据类型 =====
  'dialog.dataType.S1': 'Single Line',
  'dialog.dataType.S2': 'S2',
  'dialog.dataType.S3': 'S3',
  'dialog.dataType.N': 'Number',
  'dialog.dataType.D': 'Date',
  'dialog.dataType.DT': 'Date & Time',
  // ===== 校验拒绝 =====
  'control.reject.writeLocked': '该字段为只读，不可修改',
  'control.reject.typeMismatch': '值的类型不正确',
  'control.reject.enumValueNotAllowed': '不在候选项中',
  'control.reject.numberScaleExceeded': '数值精度超出限制',
  'control.reject.stringLengthOutOfRange': '字符长度超出限制',
  'control.reject.dateFormatInvalid': '日期格式应为 YYYY-MM-DD',
  'control.reject.datetimeFormatInvalid': '日期时间格式应为 YYYY-MM-DD HH:mm:ss',
  'control.reject.generic': '输入不合法',
  // ===== mock 模板 =====
  'mock.template.basic': '基本信息',
  'mock.template.medical': '医疗文书',
  'mock.template.report': '检查报告',
  'mock.template.blank': '空白文档',
  'mock.template.admission': '入院记录',
  'mock.template.progress': '病程记录',
  'mock.template.discharge': '出院小结',
  'mock.template.consultation': '会诊记录',
  'mock.template.lab': '检验报告',
  'mock.template.imaging': '影像报告',
  'mock.template.blankDesc': '从头开始创建文档',
  'mock.template.admissionDesc': '标准入院记录模板',
  'mock.template.progressDesc': '日常病程记录模板',
  'mock.template.dischargeDesc': '出院小结模板',
  'mock.template.consultationDesc': '会诊记录模板',
  'mock.template.labDesc': '实验室检验报告模板',
  'mock.template.imagingDesc': '影像学检查报告模板',
  // ===== mock 文档状态 =====
  'mock.document.status.draft': '草稿',
  'mock.document.status.published': '已发布',
  'mock.document.status.archived': '已归档',
  'mock.document.status.unknown': '未知',
  // ===== HomePage =====
  'home.brand': 'EMR Document Editor',
  'home.title': '我的文档',
  'home.subtitle': '管理和编辑所有结构化文档',
  'home.new': '新建文档',
  'home.searchPlaceholder': '搜索文档标题...',
  'home.empty': '暂无文档',
  'home.emptyHint': '点击"新建文档"开始创建',
  'home.column.title': '文档标题',
  'home.column.status': '状态',
  'home.column.lastEditor': '最后编辑',
  'home.column.updatedAt': '更新时间',
  'home.column.action': '操作',
  'home.deleteTitle': '删除',
  'home.deleteConfirm': '确定删除该文档？',
  'home.avatarTooltip': '用户',
  'home.loadError': '加载文档列表失败',
  // ===== EditorPage =====
  'editorPage.loading': '加载中...',
  'editorPage.importUnknownFormat': '无法识别该文件格式：{name}',
  'editorPage.importError': '导入失败：{msg}',
  'editorPage.printingTitle': '打印',
  'editorPage.previewAlt': '第 {page} 页',
  // ===== StatusBar =====
  'statusBar.pageOf': '第 {current} 页 / 共 {total} 页',
  'statusBar.wordCount': '{n} 字',
  'statusBar.zoomIn': '缩小',
  'statusBar.zoomOut': '放大',
  'statusBar.zoom': '缩放: {pct}%',
  'statusBar.zoomReset': '重置缩放',
  'statusBar.showInvisible': '显示格式标记 (Ctrl+Shift+8)',
  'statusBar.hideInvisible': '隐藏格式标记',
  'statusBar.online': '{n} 人在线',
  'statusBar.offline': '离线',
  'statusBar.errorChipTitle': '{code}: {msg}（点击关闭）',
  'statusBar.errorChipAria': '引擎错误：{msg}（点击关闭）',
  'statusBar.scale.tooltip': '量表评分 {total} 分（由 {counted} 个控件的选项数值汇总，只读派生）\n与「文书质控合规分」是两套独立口径，不互相换算。{uncounted}',
  'statusBar.scale.value': '{total} 分',
  'statusBar.scale.uncountedNote': '\n另有 {n} 个控件已填但候选项未配数值，未计入。',
  // ===== HeaderBar =====
  'headerBar.openSidebar': '打开侧边栏',
  'headerBar.closeSidebar': '关闭侧边栏',
  'headerBar.brand': 'EMR Editor',
  'headerBar.titlePlaceholder': '未命名文档',
  'headerBar.titleAria': '文档标题',
  'headerBar.undo': '撤销 (Ctrl+Z)',
  'headerBar.redo': '重做 (Ctrl+Y)',
  'headerBar.save': '保存 (Ctrl+S)',
  'headerBar.import': '导入文档/模板 (JSON/HTML/Markdown)',
  'headerBar.docProperties': '文档属性',
  'headerBar.notLoggedIn': '未登录',
  'headerBar.languageMenu': '界面语言',
  'headerBar.themeMenu': '界面主题',
  'theme.standard': '标准',
  'theme.standardHint': '默认灰度',
  'theme.eyeCare': '护眼',
  'theme.eyeCareHint': '暖色低对比',
  'theme.print': '打印',
  'theme.printHint': '高对比黑白',
  'theme.dark': '深色',
  'theme.darkHint': '暗色外壳',
  // ===== HeaderBar saveStatus =====
  'headerBar.saveStatus.saved': '已保存',
  'headerBar.saveStatus.saving': '保存中...',
  'headerBar.saveStatus.unsaved': '未保存',
  'headerBar.saveStatus.error': '保存失败',
  // ===== Sidebar =====
  'sidebar.tab.templates': '模板',
  'sidebar.tab.elements': '元素',
  'sidebar.tab.pages': '页面',
  'sidebar.tab.comments': '批注',
  'sidebar.tab.qc': '质控',
  'sidebar.templatesEmpty': '暂无模板',
  'sidebar.elementsEmpty': '暂无元素',
  'sidebar.searchPlaceholder': '搜索...',
  // ===== Toolbar 公共 =====
  'toolbar.export': '导出',
  'toolbar.exportDocument': '导出文档...',
  'toolbar.pageSetup': '页面设置',
  'toolbar.watermark': '水印',
  'toolbar.print': '打印',
  'toolbar.headingStyle': '标题样式',
  'toolbar.numberStyle': '编号样式',
  'toolbar.insertControl': '插入表单控件',
  'toolbar.controlShort': '控件',
  'toolbar.insertField': '插入域代码',
  'toolbar.lineHeight': '行距',
  'toolbar.controlDesc.input': '单行/多行/数字/日期',
  'toolbar.controlDesc.radio': '单选候选',
  'toolbar.controlDesc.checkbox': '多选候选',
  'controlConfig.codeBadge.internal': '内部码：',
  'controlConfig.codeBadge.dataElement': '数据元编码：',
  'controlConfig.dict.label': '码表 (外部候选源)',
  'controlConfig.dict.unbound': '未绑定',
  'controlConfig.dict.idLabel': '码表 id (可手动粘贴)',
  'controlConfig.dict.idPlaceholder': '32 位 hex',
  'controlConfig.dict.clear': '清空',
  'controlConfig.dict.badIdHint': 'id 不是 32 位 hex。引用会按原样持久化，但平台侧可能解析不出候选 —— 此时控件退回自由文本 (VR-7)。',
  'controlConfig.dict.inlineOverrideHint': '该控件已声明内置候选项。内置候选恒优先于码表 (契约 §12.6.4)，此绑定当前不生效。',
  'controlConfig.dict.platformHint': '候选由平台预加载后注入编辑器；未加载时控件按自由文本处理，不报错。',
  // ===== RecentDocuments =====
  'recentDoc.title': '最近文档',
  'recentDoc.empty': '暂无最近文档',
  'recentDoc.separator': ' · {n} 词',
  'recentDoc.justNow': '刚刚',
  'recentDoc.secondsAgo': '{n} 秒前',
  'recentDoc.minutesAgo': '{n} 分钟前',
  'recentDoc.hoursAgo': '{n} 小时前',
  'recentDoc.daysAgo': '{n} 天前',
  // ===== OutlineNav =====
  'outline.title': '文档大纲',
  'outline.empty': '暂无标题 — 使用 Heading 1-6 样式创建大纲',
  'outline.headingTitle': 'Heading {level}: {text}',
  // ===== CommentPanel =====
  'comment.title': '批注',
  'comment.filter.all': '全部 ({n})',
  'comment.filter.unresolved': '未解决',
  'comment.filter.resolved': '已解决',
  'comment.empty': '暂无批注',
  'comment.newThread': '新建',
  'comment.placeholder': '批注内容...',
  'comment.addReply': '添加批注',
  'comment.anchor': '锚定：「{text}」',
  'comment.timeJustNow': '刚刚',
  'comment.timeMinutesAgo': '{n} 分钟前',
  'comment.timeHoursAgo': '{n} 小时前',
  'comment.timeDaysAgo': '{n} 天前',
  'comment.resolve': '解决',
  'comment.unresolve': '撤销解决',
  'comment.noSelection': '请先在文档中选择文字',
  'comment.anchorFailed': '请先在文档中选中同一段落内的文字（或把光标放到要批注的位置）',
  'comment.newTitle': '在文档中选中文字后新建批注',
  'comment.replyPlaceholder': '输入回复...',
  'comment.noContent': '(无内容)',
  'comment.resolveTitle': '标记为已解决',
  'comment.resolvedBadge': '已解决',
  'comment.summary': '{open} 条未解决 · {total} 条总计',
  // ===== QCResultPanel =====
  'qc.empty': '尚未进行质控检查',
  'qc.start': '开始检查',
  'qc.score': '文书质控评分',
  'qc.gradeA': '优秀',
  'qc.gradeB': '良好',
  'qc.gradeC': '合格',
  'qc.gradeD': '不合格',
  'qc.issueCount': '{n} 个问题',
  'qc.byCategory': '按类别',
  'qc.bySeverity': '按严重度',
  'qc.issues': '问题列表',
  'qc.error': '严重',
  'qc.warning': '警告',
  'qc.info': '提示',
  'qc.passed': '文书质控通过，无问题',
  'qc.maxScore': '满分 100',
  'qc.errorCount': '{n} 错误',
  'qc.warningCount': '{n} 警告',
  'qc.infoCount': '{n} 提示',
  'qc.jumpToIssue': '跳转到该位置',
  'qc.docLevelIssue': '文档级问题，无具体位置',
  'qc.recheck': '重新检查',
  // ===== DocumentCompareView =====
  'compare.title': '文档比较',
  'compare.accept': '接受',
  'compare.reject': '拒绝',
  'compare.acceptAll': '全部接受',
  'compare.rejectAll': '全部拒绝',
  'compare.versionIds': '旧版本 ID: {oldId} → 新版本 ID: {newId}',
  'compare.parseError': '文档解析失败',
  'compare.emptyError': '文档内容为空',
  'compare.loadError': '加载文档失败',
  'compare.label.insert': '新增段落',
  'compare.label.delete': '删除段落',
  'compare.label.modify': '修改段落',
  'compare.label.equal': '相同',
  'compare.count.insert': '{n} 新增',
  'compare.count.delete': '{n} 删除',
  'compare.count.modify': '{n} 修改',
  'compare.count.equal': '{n} 相同',
  'compare.textChangeCount': '{n} 处文本变更',
  'compare.identical': '两份文档完全相同',
  'compare.noContent': '(无内容)',
  'compare.emptyParagraph': '(空段落)',
  'compare.imagePlaceholder': '[图片]',
  'compare.footnotePlaceholder': '[脚注]',
  // ===== ModeSwitcher =====
  'mode.edit': '编辑',
  'mode.design': '设计',
  'mode.form': '表单',
  'mode.readonly': '只读',
  'mode.print': '打印',
  'mode.preview': '预览',
  'mode.clean': '纯文本',
  'mode.switchTitle': '切换编辑器模式',
  // ===== ReadingMode =====
  'reading.exit': '退出阅读',
  'reading.hint': '阅读模式 · 按 ESC 退出',
  // ===== DesignControlProperties =====
  'design.title': '控件属性',
  'design.openConfig': '打开完整配置',
  'design.paletteTitle': '控件库',
  'design.paletteDescription': '点击插入到当前光标位置',
  'design.properties.semantic': '语义信息（只读）',
  'design.properties.notSpecified': '未指定',
  'design.controlFallback': '控件',
  'design.clearAllTitle': '清除全部设计期属性',
  'design.field.label': '标签',
  'design.field.tips': '提示',
  'design.field.prefix': '前缀',
  'design.field.suffix': '后缀',
  'design.field.deletable': '可删除',
  'design.field.editable': '可编辑',
  'design.field.single': '单值',
  'design.identity.dataElement': '数据元',
  'design.identity.dataType': '数据类型',
  'design.identity.showType': '展示类型',
  'design.identity.enums': '枚举',
  'design.identity.required': '必填',
  'design.identity.readonly': '只读',
  'design.expand': '展开',
  'design.collapse': '折叠',
  'design.singleBadge': '单值',
  'design.singleTitle': '单值字段 (文档中仅可插入一次)',
  // ===== controlDisplay =====
  'controlDisplay.notSpecified': '未指定',
  'controlDisplay.yes': '是',
  'controlDisplay.no': '否',
  'controlDisplay.itemCount': '{n} 项',
  'controlDisplay.textInput': '单行文本',
  'controlDisplay.textarea': '多行文本',
  'controlDisplay.type.input': '单行文本',
  'controlDisplay.type.textarea': '多行文本',
  'controlDisplay.type.number': '数字输入',
  'controlDisplay.type.select': '下拉选择',
  'controlDisplay.type.date': '日期选择',
  'controlDisplay.type.datetime': '日期时间选择',
  'controlDisplay.type.checkbox': '复选框',
  'controlDisplay.type.radio': '单选框',
  // ===== RepoLinks =====
  'repo.gitee': 'Gitee',
  'repo.github': 'GitHub',
  'repo.aria': '开源仓库 · {label}',
  // ===== PerfPanel =====
  'perf.title': '性能诊断',
  'perf.fps': '帧率 (FPS)',
  'perf.layout': '布局耗时',
  'perf.render': '渲染耗时',
  'perf.cache': '缓存命中率',
  'perf.start': '开始采样',
  'perf.stop': '停止采样',
  'perf.reset': '重置',
  // ===== FindReplaceDialog =====
  'find.find': '查找',
  'find.replace': '替换',
  'find.caseSensitive': '区分大小写',
  'find.wholeWord': '全字匹配',
  'find.useRegex': '正则表达式',
  'find.results': '共 {n} 个结果',
  'find.noResults': '无结果',
  'find.next': '下一个',
  'find.previous': '上一个',
  'find.replaceAll': '全部替换',
  'find.close': '关闭',
  'find.placeholder': '输入查找内容...',
  'find.replacePlaceholder': '替换为...',
  'find.expandReplace': '展开替换',
  'find.collapseReplace': '收起替换',
  // ===== PrintDialog =====
  'print.recent': '最近打印',
  'print.unfinished': '未打完',
  'print.resume': '续打: 从第 {n} 页开始',
  'print.cancelResume': '取消续打',
  'print.orientation.portrait': '纵向',
  'print.orientation.landscape': '横向',
  'print.range.all': '全部',
  'print.range.current': '当前页',
  'print.range.selection': '所选内容',
  'print.range.range': '页码范围',
  'print.range.fromTo': '第 {from}–{to} 页',
  'print.range.to': '至',
  'print.range.totalLabel': '页 (共 {n} 页)',
  'print.range.label': '页码范围',
  'print.range.custom': '自定义',
  'print.printer': '打印机',
  'print.printerDefault': '默认打印机',
  'print.duplex.label': '打印方式',
  'print.duplex.duplex': '双面打印',
  'print.duplex.simplex': '单面打印',
  'print.duplex.duplexShort': '双面',
  'print.duplex.simplexShort': '单面',
  'print.summary': '共 {total} 页 · 打印 {printing} 页 · {copies} 份 · {sides}',
  'print.historySubline': '{copies} 份 · {sides}',
  'print.systemNote': '页码范围由本应用按页渲染；打印机 / 份数 / 单双面请在随后弹出的系统打印窗口中设置。',
  'print.copies': '份数',
  'print.printedAt': '打印于 {time}',
  'print.relative.secondsAgo': '{n} 秒前',
  'print.relative.minutesAgo': '{n} 分钟前',
  'print.relative.hoursAgo': '{n} 小时前',
  'print.relative.daysAgo': '{n} 天前',
  'print.relative.justNow': '刚刚',
  'print.relative.unknown': '时间未知',
  // ===== PageSetupDialog =====
  'pageSetup.preset': '预设',
  'pageSetup.presetA4': 'A4 (210×297mm)',
  'pageSetup.presetLetter': 'Letter (8.5×11in)',
  'pageSetup.presetLegal': 'Legal',
  'pageSetup.presetA3': 'A3 (297×420mm)',
  'pageSetup.marginTop': '上边距',
  'pageSetup.marginBottom': '下边距',
  'pageSetup.marginLeft': '左边距',
  'pageSetup.marginRight': '右边距',
  'pageSetup.headerDistance': '页眉距上',
  'pageSetup.footerDistance': '页脚距下',
  'pageSetup.tabMargins': '页边距',
  'pageSetup.tabPaper': '纸张',
  'pageSetup.tabLayout': '版式',
  'pageSetup.pageVerticalGap': '分页间隙',
  'pageSetup.applyTo': '应用于',
  'pageSetup.applyWholeDocument': '整篇文档',
  'pageSetup.applyFromThisPoint': '从本节开始',
  'pageSetup.applyThisSection': '本节',
  'pageSetup.hfFutureNote': '页眉和页脚设置将在后续版本中提供。',
  // ===== WatermarkDialog =====
  'watermark.text': '水印文字',
  'watermark.fontSize': '字号',
  'watermark.opacity': '透明度',
  'watermark.rotation': '旋转',
  'watermark.spacing': '间距',
  'watermark.color': '颜色',
  'watermark.imageUrl': '图片地址',
  'watermark.imageScale': '缩放',
  'watermark.apply': '应用水印',
  'watermark.remove': '移除水印',
  'watermark.internalMark': '内部资料',
  'watermark.confidentialMark': '机密密级',
  'watermark.textPlaceholder': '例如: 内部资料',
  'watermark.removeTitle': '删除本文档的水印',
  // ===== PasteSpecialDialog =====
  'paste.keepSource': '保留源格式',
  'paste.matchTarget': '匹配目标格式',
  'paste.plainText': '纯文本',
  'paste.title': '选择性粘贴',
  'paste.keepSourceDesc': '保留原始字体、颜色、样式',
  'paste.matchTargetDesc': '使用当前光标位置的格式',
  'paste.plainTextDesc': '移除所有格式，粘贴纯文本',
  'paste.previewLabel': '剪贴板预览',
  'paste.shortcut': 'Ctrl+Shift+V 快速粘贴',
  'paste.confirm': '粘贴',
  'preview.paperFormat': 'A4 纸张 · 适合打印',
  'preview.pageCount': '{n} 页',
  // ===== ExportDialog =====
  'export.title': '导出文档',
  'export.format': '格式',
  'export.include': '包含',
  'export.confirm': '确认导出',
  'export.pdf': 'PDF 文档',
  'export.word': 'Word 文档',
  'export.html': 'HTML 页面',
  'export.txt': '纯文本',
  'export.json': 'JSON 数据',
  'export.pdfDesc': '适合打印和分享，保留完整排版格式',
  'export.wordDesc': '.docx 格式，可在 Microsoft Word 中编辑',
  'export.htmlDesc': '纯静态网页，可在浏览器中直接查看',
  'export.txtDesc': '仅导出文字内容，不含样式和格式',
  'export.jsonDesc': '结构化数据格式，适合程序处理和数据迁移',
  'export.comingSoon': '即将推出',
  // ===== ControlConfig =====
  'controlConfig.element': '语义层',
  'controlConfig.definition': '设计期',
  'controlConfig.basic': '基本',
  'controlConfig.tab.basic': '常规',
  'controlConfig.tab.format': '格式',
  'controlConfig.tab.options': '候选项',
  'controlConfig.tab.advanced': '高级',
  'controlConfig.internal': '内部',
  'controlConfig.dataElement': '数据元',
  'controlConfig.optionsEmpty': '暂无候选项',
  'controlConfig.optionsEmptyHint': '点击新增选项',
  'controlConfig.addOption': '新增选项',
  'controlConfig.removeOption': '删除选项',
  'controlConfig.optionValue': '值 (候选项值)',
  'controlConfig.optionName': '显示名 (候选项)',
  'controlConfig.codePreview': '当前定义',
  'controlConfig.create': '新建',
  'controlConfig.editMode': '编辑',
  'controlConfig.allowFreeInput': '允许手输自定义值',
  'controlConfig.dictionaryIdLabel': '码表 id (可手动粘贴)',
  'controlConfig.dictionaryIdPlaceholder': '32 位 hex',
  'controlConfig.dictionaryIdInvalid': 'id 不是 32 位 hex。引用会按原样持久化，但平台侧可能解析不出候选 —— 此时控件退回自由文本 (VR-7)。',
  'controlConfig.dictionaryInlineConflict': '该控件已声明内置候选项。内置候选恒优先于码表 (契约 §12.6.4)，此绑定当前不生效。',
  'controlConfig.dictionaryCandidateNote': '候选由平台预加载后注入编辑器；未加载时控件按自由文本处理，不报错。',
  'controlConfig.clear': '清空',
  'controlConfig.fallbackName': '输入域',
  'controlConfig.labelField': '控件标签 (旁注)',
  'controlConfig.addOptionAction': '+ 添加选项',
  'controlConfig.namePlaceholder': '如 主诉',
  'controlConfig.labelPlaceholder': '如 主诉：',
  'controlConfig.styleHint': '控件样式：{kind}',
  'controlConfig.kindLabel': '控件形态 (决定控件类型)',
  'controlConfig.numberDisplay': '数字展示',
  'controlConfig.defaultOption': '默认',
  'controlConfig.numberDisplayN': '数值 (右对齐)',
  'controlConfig.numberDisplayAN': '文本数字',
  'controlConfig.numericValuePlaceholder': '数值(可选)',
  'controlConfig.unlimited': '不限',
  'controlConfig.dateFormatHint': '日期按 YYYY-MM-DD 存储与校验。',
  'controlConfig.dateTimeFormatHint': '日期时间按 YYYY-MM-DD HH:mm:ss 存储与校验。',
  'controlConfig.bindingHint': '仅「下拉」形态可绑定外部码表 —— 它是 format.dictionary 唯一有意义的落点 (单选/复选的候选恒为内置项，会覆盖码表)。当前形态为「{kind}」，请先在「格式」页切换为「下拉」。',
  'controlConfig.prefixLabel': '前缀',
  'controlConfig.prefixPlaceholder': '框前字面量',
  'controlConfig.suffixLabel': '后缀',
  'controlConfig.suffixPlaceholder': '框后字面量',
  'controlConfig.tipsLabel': '提示 (tips)',
  'controlConfig.tipsPlaceholder': '悬浮提示',
  'controlConfig.deletableLabel': '可删除',
  'controlConfig.editableLabel': '可填写',
  'controlConfig.singleLabel': '单值 (数据元唯一)',
  'choice.create': '新建单选/复选',
  'choice.fallbackName': '单选复选',
  'choice.tab.type': '控件类型',
  'choice.tab.base': '基础属性',
  'choice.tab.options': '选项设置',
  'choice.tab.numeric': '数值属性',
  'choice.tab.list': '项目列表',
  'choice.radioLabel': '单选框',
  'choice.radioDesc': '每次仅可选中一项',
  'choice.checkboxLabel': '复选框',
  'choice.checkboxDesc': '可同时选中多项',
  'choice.typeNote': '单选/复选候选项取值均为文本；复选 = 多选枚举，单选 = 单选枚举。',
  'choice.namePlaceholder': '如 症状',
  'choice.labelPlaceholder': '如 症状：',
  'choice.enumEditableLabel': '允许输入自定义值 (不在候选项内)',
  'choice.optionsHeader': '候选项',
  'choice.addOption': '新增选项',
  'choice.col.name': '名称',
  'choice.col.value': '值',
  'choice.col.exclusive': '互斥',
  'choice.col.item': '项目',
  'choice.col.numeric': '数值',
  'choice.col.itemValue': '项目 (值)',
  'choice.optionsEmptyHint': '暂无候选项，点右上角新增',
  'choice.optionsEmpty': '暂无候选项',
  'choice.numericNote': '为每个候选项(项目)附加一个数值(如评分/权重)；不填表示无。',
  'choice.listNote': '项目列表与选项/数值同源；可调序或快速删除。',
  'choice.emptyName': '(空名)',
  'choice.emptyValue': '(空)',
  'choice.moveUp': '上移',
  'choice.moveDown': '下移',
  'choice.removeOption': '删除选项 {n}',
  'choice.removeByValue': '删除 {value}',
  'controlConfig.dataBindingTab': '数据绑定',
  // ===== BookmarkDialog =====
  'bookmark.insertBookmark': '插入书签',
  'bookmark.insertCrossRef': '插入交叉引用',
  'bookmark.crossRefTab': '交叉引用',
  'bookmark.footnotePrefix': '脚注 {n}',
  'bookmark.pagePrefix': '第 {n} 页',
  'bookmark.target': '目标',
  'bookmark.nameLabel': '书签名称',
  'bookmark.namePlaceholder': '例如: 实验室检查结果',
  'bookmark.description': '书签用于标记文档中的重要位置，方便后续定位和交叉引用。',
  'bookmark.refFormatLabel': '引用格式',
  'bookmark.refFormatLabelOnly': '书签名 / 标题（不带页码）',
  'bookmark.refFormatPageOnly': '第 {n} 页',
  'bookmark.refFormatLabelPage': '书签名（第 {n} 页）',
  'bookmark.filterPlaceholder': '搜索书签/标题/脚注...',
  'bookmark.noTargets': '暂无可用目标',
  'bookmark.pageNumber': 'p.{n}',
  // ===== docProps =====
  'docProps.discardConfirm': '当前有未保存的修改，是否放弃并继续？',
  'docProps.unsavedHint': '当前有未保存的修改',
  'docProps.continueEditing': '继续编辑',
  'docProps.creator': '创建人',
  'docProps.externalId': '外部模板 ID',
  'docProps.categoryId': '外部分类 ID',
  'docProps.placeholderAuthor': '作者姓名',
  'docProps.placeholderCreator': '创建人',
  'docProps.placeholderReviewer': '审核人',
  'docProps.placeholderDepartment': '所属科室',
  'docProps.placeholderCategory': '文档分类',
  'docProps.titlePlaceholder': '文档标题',
  'docProps.keywordsPlaceholder': '关键词1, 关键词2',
  // ===== RuntimeControlOverlay =====
  'overlay.enterNumber': '请输入数字',
  'overlay.selectPlaceholder': '请选择',
  // ===== TableGrowOverlay =====
  'tableGrow.addRow': '添加行',
  'tableGrow.addRowTitle': '在表尾添加一行（克隆末行字段，数据为空）',
  'tableGrow.growable': '可增长',
  'tableGrow.growableMarkerTitle': '此表声明了「填写时可增长」—— 填写时表尾会出现「+ 添加行」入口。在表格单元格上右键可切换。',
  // ===== Engine error chip =====
  'error.unknownEngine': '引擎错误',
  // ===== 引擎层文案 =====
  // QC 内置规则 (值必须与 QCEngine.BUILTIN_RULES 原字面量逐字一致)
  'qc.rule.title.name': '文档标题不为空',
  'qc.rule.title.desc': '文档必须包含标题',
  'qc.rule.body.name': '文档包含正文内容',
  'qc.rule.body.desc': '文档 body 至少包含一个段落',
  'qc.rule.emptyParagraph.name': '段落不包含连续空白段',
  'qc.rule.emptyParagraph.desc': '不应有连续两个空段落 (范围: 正文 + 页眉/页脚各变体, 逐容器独立判定)',
  'qc.rule.smartTextRequired.name': 'SmartText 必填字段校验',
  'qc.rule.smartTextRequired.desc': '标记为 required 的 SmartTextNode 不能为空',
  'qc.rule.minChars.name': '文档字数不低于最低阈值',
  'qc.rule.minChars.desc': '文档正文至少包含 10 个字符',
  'qc.rule.paragraphCount.name': '段落数量合理',
  'qc.rule.paragraphCount.desc': '段落数应在 1-500 之间',
  // ErrorRecovery
  'engineError.particleRender': '粒子渲染失败: nodeId={nodeId}',
  'engineError.pageRender': '页面渲染失败: pageIndex={pageIndex}',
  'engineError.pagePlaceholder': '页面 {page} 渲染失败',
  'engineError.loadFallback': '文档加载失败, 已回退到空白文档',
  'engineError.loadFallbackFailed': '回落文档同样加载失败',
  'engineError.asyncTask': '异步任务失败',
  // 文档加载
  'loader.failed': '"{name}" 加载失败：{msg}',
  'loader.parseFailed': 'JSON.parse 失败: {msg}',
  'loader.notObject': '文档必须是对象',
  'loader.upgradeFailed': '升级失败: {msg}',
  'loader.badDocId': 'doc.id 缺失或非字符串',
  'loader.badDocTitle': 'doc.title 缺失或非字符串',
  'loader.badBodyChildren': 'doc.body.children 缺失或非数组',
  'loader.badMetadata': 'doc.metadata 非对象',
  'loader.badChildRef': 'children 包含非字符串引用: {id}',
  'loader.danglingRef': '引用悬空 (节点未在 nodes/extraNodes 中): {id}',
  'loader.versionTooNew': '文档版本 {ver} 高于引擎支持版本 {current}',
  'loader.versionOutdated': '需升级: {ver} → {current}',
  'loader.versionCurrent': '版本一致',
  'loader.importedHtml': '导入的HTML文档',
  'loader.importedMarkdown': '导入的Markdown文档',
  'loader.importedXml': '导入的XML文档',
  // 文档默认标题 / 模板
  'doc.untitled': '未命名文档',
  'doc.recovered': '恢复的文档',
  'doc.importedTemplate': '导入的模板',
  // 书签交叉引用目标
  'nav.headingFallback': '标题{level}',
  'nav.footnoteLabel': '脚注 {id}',
  // 目录 / 控件占位
  'toc.title': '目录',
  'toc.emptyHeading': '(空标题)',
  'control.emptyOptions': '无候选项',
  // 域代码占位符
  'field.placeholder.pageNumber': '[页码]',
  'field.placeholder.totalPages': '[总页数]',
  'field.placeholder.currentDate': '[日期]',
  'field.placeholder.currentTime': '[时间]',
  'field.placeholder.authorName': '[作者]',
  'field.placeholder.documentTitle': '[标题]',
  'field.placeholder.lastSavedDate': '[保存日期]',
  'field.placeholder.printDate': '[打印日期]',
  // ===== 既有 ICU 模板 =====
  'editor.pageOf': '第 {current} 页 / 共 {total} 页',
  'editor.controlCount': '{n, plural, other {# 个控件}}',
}

const enUS: LocaleMessages = {
  // ===== 通用 =====
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.search': 'Search',
  'common.loading': 'Loading...',
  'common.noData': 'No Data',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.apply': 'Apply',
  'common.insert': 'Insert',
  'common.remove': 'Remove',
  'common.add': 'Add',
  'common.open': 'Open',
  'common.edit': 'Edit',
  'common.preview': 'Preview',
  'common.refresh': 'Refresh',
  'common.more': 'More',
  'common.all': 'All',
  'common.unknown': 'Unknown',
  'common.previous': 'Previous',
  'common.next': 'Next',
  'common.wordCount': '{n} words',
  'common.back': 'Back',
  // ===== 编辑动作 =====
  'editor.undo': 'Undo',
  'editor.redo': 'Redo',
  'editor.copy': 'Copy',
  'editor.cut': 'Cut',
  'editor.paste': 'Paste',
  'editor.selectAll': 'Select All',
  'editor.clearFormat': 'Clear Format',
  'editor.formatPainter': 'Format Painter',
  // ===== 文本格式 =====
  'editor.format.bold': 'Bold',
  'editor.format.italic': 'Italic',
  'editor.format.underline': 'Underline',
  'editor.format.strikethrough': 'Strikethrough',
  'editor.format.superscript': 'Superscript',
  'editor.format.subscript': 'Subscript',
  'editor.format.alignLeft': 'Align Left',
  'editor.format.alignCenter': 'Center',
  'editor.format.alignRight': 'Align Right',
  'editor.format.alignJustify': 'Justify',
  'editor.format.lineHeight': 'Line Spacing',
  // ===== 列表 =====
  'editor.list.bullet': 'Bullet List',
  'editor.list.ordered': 'Numbered List',
  'editor.list.continueNumbering': 'Continue from Previous List',
  'editor.list.firstLineIndent': 'First Line Indent',
  'editor.list.firstLineIndentShort': 'First Line',
  'editor.list.indent': 'Indent',
  'editor.list.outdent': 'Outdent',
  'editor.list.numberStyle.decimal': '1, 2, 3',
  'editor.list.numberStyle.lowerAlpha': 'a, b, c',
  'editor.list.numberStyle.upperAlpha': 'A, B, C',
  'editor.list.numberStyle.lowerRoman': 'i, ii, iii',
  'editor.list.numberStyle.upperRoman': 'I, II, III',
  'editor.list.numberStyle.cjkIdeographic': '一, 二, 三',
  // ===== 标题 =====
  'editor.heading.body': 'Body',
  'editor.heading.h1': 'Heading 1',
  'editor.heading.h2': 'Heading 2',
  'editor.heading.h3': 'Heading 3',
  'editor.heading.h4': 'Heading 4',
  'editor.heading.h5': 'Heading 5',
  'editor.heading.h6': 'Heading 6',
  // ===== 字体 =====
  'editor.font.family.simSun': 'SimSun',
  'editor.font.family.simHei': 'SimHei',
  'editor.font.family.kaiTi': 'KaiTi',
  'editor.font.family.fangSong': 'FangSong',
  'editor.font.family.microsoftYaHei': 'Microsoft YaHei',
  'editor.font.family.arial': 'Arial',
  'editor.font.family.timesNewRoman': 'Times New Roman',
  'editor.font.family.courierNew': 'Courier New',
  'editor.font.sizePlaceholder': 'Size',
  'editor.font.highlightNone': 'None',
  'editor.color.text': 'Text Color',
  'editor.color.highlight': 'Highlight',
  // ===== 域代码 =====
  'editor.field.pageNumber': 'Page Number',
  'editor.field.totalPages': 'Total Pages',
  'editor.field.currentDate': 'Current Date',
  'editor.field.currentTime': 'Current Time',
  'editor.field.authorName': 'Author',
  'editor.field.documentTitle': 'Document Title',
  'editor.field.lastSavedDate': 'Last Saved Date',
  'editor.field.printDate': 'Print Date',
  // ===== 插入 =====
  'editor.insert.separator': 'Insert Separator',
  'editor.insert.table': 'Insert Table',
  'editor.insert.image': 'Insert Image',
  'editor.insert.bookmark': 'Insert Bookmark',
  'editor.insert.control': 'Insert Form Control',
  // ===== 表格 =====
  'editor.table.mergeCell': 'Merge Cells',
  'editor.table.splitCell': 'Split Cell',
  'editor.table.insertRow': 'Insert Row',
  'editor.table.deleteRow': 'Delete Row',
  'editor.table.insertColumn': 'Insert Column',
  'editor.table.deleteColumn': 'Delete Column',
  'editor.table.growable': 'Growable',
  // ===== 页眉页脚 =====
  'editor.hf.header': 'Header',
  'editor.hf.footer': 'Footer',
  'editor.hf.close': 'Close Header & Footer',
  'editor.hf.differentFirstPage': 'Different First Page',
  'editor.hf.differentOddEven': 'Different Odd/Even Pages',
  'editor.hf.headerHint': 'Edit Header',
  'editor.hf.footerHint': 'Edit Footer',
  'editor.hf.variantFirst': 'First page',
  'editor.hf.variantEven': 'Even pages',
  'editor.hf.scopePage': ' · Page {n}',
  'editor.hf.insertPageNumber': 'Insert page number',
  'editor.hf.insertDate': 'Insert date',
  'editor.hf.date': 'Date',
  'editor.hf.closeHeaderTitle': 'Close header editing',
  'editor.hf.closeFooterTitle': 'Close footer editing',
  'editor.hf.title': 'Header & Footer',
  // ===== 右键菜单 =====
  'editor.contextMenu.cut': 'Cut',
  'editor.contextMenu.copy': 'Copy',
  'editor.contextMenu.paste': 'Paste',
  'editor.contextMenu.delete': 'Delete',
  'editor.contextMenu.deleteRow': 'Delete Row',
  'editor.contextMenu.deleteColumn': 'Delete Column',
  'editor.contextMenu.toggleTableGrowable': 'Growable on Fill',
  'editor.contextMenu.bold': 'Bold',
  'editor.contextMenu.italic': 'Italic',
  'editor.contextMenu.underline': 'Underline',
  'editor.contextMenu.strikeout': 'Strikethrough',
  'editor.contextMenu.clearFormat': 'Clear Format',
  'editor.contextMenu.alignLeft': 'Align Left',
  'editor.contextMenu.alignCenter': 'Center',
  'editor.contextMenu.alignRight': 'Align Right',
  'editor.contextMenu.alignJustify': 'Justify',
  'editor.contextMenu.increaseIndent': 'Increase Indent',
  'editor.contextMenu.decreaseIndent': 'Decrease Indent',
  'editor.contextMenu.properties': 'Properties...',
  // ===== 文档状态 =====
  'status.saved': 'Saved',
  'status.saving': 'Saving...',
  'status.unsaved': 'Unsaved',
  'status.error': 'Save Failed',
  // ===== 文件 =====
  'file.new': 'New',
  'file.open': 'Open',
  'file.save': 'Save',
  'file.export': 'Export',
  'file.print': 'Print',
  'file.properties': 'Properties',
  // ===== 弹窗标题 =====
  'dialog.title.controlConfig': 'Control Properties',
  'dialog.title.bookmark': 'Bookmarks & References',
  'dialog.title.print': 'Print',
  'dialog.title.printPreview': 'Print Preview',
  'dialog.title.export': 'Export Document',
  'dialog.title.findReplace': 'Find & Replace',
  'dialog.title.documentProperties': 'Document Properties',
  'dialog.title.pageSetup': 'Page Setup',
  'dialog.title.watermark': 'Watermark',
  'dialog.title.pasteSpecial': 'Paste Special',
  'dialog.title.compare': 'Compare Documents',
  // ===== 弹窗标签 =====
  'dialog.label.dataElementName': 'Data Element Name',
  'dialog.label.dataElementCode': 'Data Element Code',
  'dialog.label.controlLabel': 'Control Label',
  'dialog.label.internalCode': 'Internal Code',
  'dialog.label.controlType': 'Control Type',
  'dialog.label.dataType': 'Data Type',
  'dialog.label.format': 'Format',
  'dialog.label.placeholder': 'Placeholder',
  'dialog.label.required': 'Required',
  'dialog.label.readonly': 'Read-only',
  'dialog.label.defaultValue': 'Default Value',
  'dialog.label.minLength': 'Min Length',
  'dialog.label.maxLength': 'Max Length',
  'dialog.label.minRows': 'Min Rows',
  'dialog.label.scale': 'Decimal Places',
  'dialog.label.dictionary': 'Dictionary',
  'dialog.label.options': 'Options',
  'dialog.label.searchable': 'Searchable',
  'dialog.label.exclusive': 'Exclusive',
  'dialog.label.allowMultiple': 'Allow Multiple',
  'dialog.label.title': 'Document Title',
  'dialog.label.author': 'Author',
  'dialog.label.reviewer': 'Reviewer',
  'dialog.label.department': 'Department',
  'dialog.label.category': 'Category',
  'dialog.label.keywords': 'Keywords',
  'dialog.label.createdAt': 'Created',
  'dialog.label.updatedAt': 'Updated',
  'dialog.label.orientation': 'Orientation',
  'dialog.label.size': 'Paper Size',
  'dialog.label.margins': 'Margins',
  'dialog.label.textWatermark': 'Text Watermark',
  'dialog.label.tileWatermark': 'Tile Watermark',
  'dialog.label.imageWatermark': 'Image Watermark',
  'dialog.label.opacity': 'Opacity',
  'dialog.label.rotation': 'Rotation',
  'dialog.label.spacing': 'Spacing',
  'dialog.label.color': 'Color',
  'dialog.label.scope': 'Scope',
  'dialog.label.continue': 'Continue Editing',
  'dialog.label.cancelEdit': 'Cancel Editing',
  'dialog.label.discardChanges': 'Discard Changes',
  // ===== 控件类型 =====
  'dialog.controlType.input': 'Single Line',
  'dialog.controlType.textarea': 'Multi Line',
  'dialog.controlType.number': 'Number',
  'dialog.controlType.select': 'Dropdown',
  'dialog.controlType.date': 'Date',
  'dialog.controlType.datetime': 'Date & Time',
  'dialog.controlType.checkbox': 'Checkbox',
  'dialog.controlType.radio': 'Radio',
  // ===== 数据类型 =====
  'dialog.dataType.S1': 'Single Line',
  'dialog.dataType.S2': 'S2',
  'dialog.dataType.S3': 'S3',
  'dialog.dataType.N': 'Number',
  'dialog.dataType.D': 'Date',
  'dialog.dataType.DT': 'Date & Time',
  // ===== 校验拒绝 =====
  'control.reject.writeLocked': 'This field is read-only',
  'control.reject.typeMismatch': 'Value type is incorrect',
  'control.reject.enumValueNotAllowed': 'Value is not in the allowed options',
  'control.reject.numberScaleExceeded': 'Number scale exceeded',
  'control.reject.stringLengthOutOfRange': 'String length out of range',
  'control.reject.dateFormatInvalid': 'Date format should be YYYY-MM-DD',
  'control.reject.datetimeFormatInvalid': 'Datetime format should be YYYY-MM-DD HH:mm:ss',
  'control.reject.generic': 'Invalid input',
  // ===== mock 模板 =====
  'mock.template.basic': 'Basic',
  'mock.template.medical': 'Medical Records',
  'mock.template.report': 'Reports',
  'mock.template.blank': 'Blank Document',
  'mock.template.admission': 'Admission Note',
  'mock.template.progress': 'Progress Note',
  'mock.template.discharge': 'Discharge Summary',
  'mock.template.consultation': 'Consultation Note',
  'mock.template.lab': 'Lab Report',
  'mock.template.imaging': 'Imaging Report',
  'mock.template.blankDesc': 'Start from scratch',
  'mock.template.admissionDesc': 'Standard admission template',
  'mock.template.progressDesc': 'Daily progress template',
  'mock.template.dischargeDesc': 'Discharge summary template',
  'mock.template.consultationDesc': 'Consultation template',
  'mock.template.labDesc': 'Lab report template',
  'mock.template.imagingDesc': 'Imaging report template',
  // ===== mock 文档状态 =====
  'mock.document.status.draft': 'Draft',
  'mock.document.status.published': 'Published',
  'mock.document.status.archived': 'Archived',
  'mock.document.status.unknown': 'Unknown',
  // ===== HomePage =====
  'home.brand': 'EMR Document Editor',
  'home.title': 'My Documents',
  'home.subtitle': 'Manage and edit all structured documents',
  'home.new': 'New Document',
  'home.searchPlaceholder': 'Search document titles...',
  'home.empty': 'No documents yet',
  'home.emptyHint': 'Click "New Document" to get started',
  'home.column.title': 'Title',
  'home.column.status': 'Status',
  'home.column.lastEditor': 'Last Editor',
  'home.column.updatedAt': 'Updated',
  'home.column.action': 'Actions',
  'home.deleteTitle': 'Delete',
  'home.deleteConfirm': 'Delete this document?',
  'home.avatarTooltip': 'User',
  'home.loadError': 'Failed to load documents',
  // ===== EditorPage =====
  'editorPage.loading': 'Loading...',
  'editorPage.importUnknownFormat': 'Unknown file format: {name}',
  'editorPage.importError': 'Import failed: {msg}',
  'editorPage.printingTitle': 'Print',
  'editorPage.previewAlt': 'Page {page}',
  // ===== StatusBar =====
  'statusBar.pageOf': 'Page {current} of {total}',
  'statusBar.wordCount': '{n} chars',
  'statusBar.zoomIn': 'Zoom Out',
  'statusBar.zoomOut': 'Zoom In',
  'statusBar.zoom': 'Zoom: {pct}%',
  'statusBar.zoomReset': 'Reset Zoom',
  'statusBar.showInvisible': 'Show Whitespace (Ctrl+Shift+8)',
  'statusBar.hideInvisible': 'Hide Whitespace',
  'statusBar.online': '{n} online',
  'statusBar.offline': 'Offline',
  'statusBar.errorChipTitle': '{code}: {msg} (click to dismiss)',
  'statusBar.errorChipAria': 'Engine error: {msg} (click to dismiss)',
  'statusBar.scale.tooltip': 'Scale Score {total} (summed from {counted} controls\' option values, read-only)\nDistinct from QC compliance score; the two are not convertible.{uncounted}',
  'statusBar.scale.value': '{total}',
  'statusBar.scale.uncountedNote': '\n{n} more controls are filled but have no option numeric values (excluded).',
  // ===== HeaderBar =====
  'headerBar.openSidebar': 'Open Sidebar',
  'headerBar.closeSidebar': 'Close Sidebar',
  'headerBar.brand': 'EMR Editor',
  'headerBar.titlePlaceholder': 'Untitled Document',
  'headerBar.titleAria': 'Document Title',
  'headerBar.undo': 'Undo (Ctrl+Z)',
  'headerBar.redo': 'Redo (Ctrl+Y)',
  'headerBar.save': 'Save (Ctrl+S)',
  'headerBar.import': 'Import Document/Template (JSON/HTML/Markdown)',
  'headerBar.docProperties': 'Document Properties',
  'headerBar.notLoggedIn': 'Not logged in',
  'headerBar.languageMenu': 'Interface Language',
  'headerBar.themeMenu': 'Interface Theme',
  'theme.standard': 'Standard',
  'theme.standardHint': 'Default grayscale',
  'theme.eyeCare': 'Eye Care',
  'theme.eyeCareHint': 'Warm low-contrast',
  'theme.print': 'Print',
  'theme.printHint': 'High contrast B&W',
  'theme.dark': 'Dark',
  'theme.darkHint': 'Dark chrome',
  // ===== HeaderBar saveStatus =====
  'headerBar.saveStatus.saved': 'Saved',
  'headerBar.saveStatus.saving': 'Saving...',
  'headerBar.saveStatus.unsaved': 'Unsaved',
  'headerBar.saveStatus.error': 'Save Failed',
  // ===== Sidebar =====
  'sidebar.tab.templates': 'Templates',
  'sidebar.tab.elements': 'Elements',
  'sidebar.tab.pages': 'Pages',
  'sidebar.tab.comments': 'Comments',
  'sidebar.tab.qc': 'QC',
  'sidebar.templatesEmpty': 'No templates',
  'sidebar.elementsEmpty': 'No elements',
  'sidebar.searchPlaceholder': 'Search...',
  // ===== Toolbar 公共 =====
  'toolbar.export': 'Export',
  'toolbar.exportDocument': 'Export Document...',
  'toolbar.pageSetup': 'Page Setup',
  'toolbar.watermark': 'Watermark',
  'toolbar.print': 'Print',
  'toolbar.headingStyle': 'Heading Style',
  'toolbar.numberStyle': 'Number Style',
  'toolbar.insertControl': 'Insert Form Control',
  'toolbar.controlShort': 'Control',
  'toolbar.insertField': 'Insert Field Code',
  'toolbar.lineHeight': 'Line Spacing',
  'toolbar.controlDesc.input': 'Single/Multi/Number/Date',
  'toolbar.controlDesc.radio': 'Single-choice candidates',
  'toolbar.controlDesc.checkbox': 'Multi-choice candidates',
  'controlConfig.codeBadge.internal': 'Internal code: ',
  'controlConfig.codeBadge.dataElement': 'Data element code: ',
  'controlConfig.dict.label': 'Dictionary (external candidate source)',
  'controlConfig.dict.unbound': 'Not bound',
  'controlConfig.dict.idLabel': 'Dictionary id (paste manually)',
  'controlConfig.dict.idPlaceholder': '32-char hex',
  'controlConfig.dict.clear': 'Clear',
  'controlConfig.dict.badIdHint': 'Not a 32-char hex id. The reference is persisted as-is, but the platform may not resolve candidates — the control then falls back to free text (VR-7).',
  'controlConfig.dict.inlineOverrideHint': 'This control already declares inline candidates. Inline candidates always win over the dictionary (contract §12.6.4), so this binding has no effect.',
  'controlConfig.dict.platformHint': 'Candidates are preloaded by the platform and injected into the editor; while unloaded the control is treated as free text without error.',
  // ===== RecentDocuments =====
  'recentDoc.title': 'Recent Documents',
  'recentDoc.empty': 'No recent documents',
  'recentDoc.separator': ' · {n} words',
  'recentDoc.justNow': 'just now',
  'recentDoc.secondsAgo': '{n}s ago',
  'recentDoc.minutesAgo': '{n}m ago',
  'recentDoc.hoursAgo': '{n}h ago',
  'recentDoc.daysAgo': '{n}d ago',
  // ===== OutlineNav =====
  'outline.title': 'Document Outline',
  'outline.empty': 'No headings — use Heading 1-6 styles to build an outline',
  'outline.headingTitle': 'Heading {level}: {text}',
  // ===== CommentPanel =====
  'comment.title': 'Comments',
  'comment.filter.all': 'All ({n})',
  'comment.filter.unresolved': 'Open',
  'comment.filter.resolved': 'Resolved',
  'comment.empty': 'No comments',
  'comment.newThread': 'New',
  'comment.placeholder': 'Comment text...',
  'comment.addReply': 'Add Comment',
  'comment.anchor': 'Anchored to: {text}',
  'comment.timeJustNow': 'just now',
  'comment.timeMinutesAgo': '{n}m ago',
  'comment.timeHoursAgo': '{n}h ago',
  'comment.timeDaysAgo': '{n}d ago',
  'comment.resolve': 'Resolve',
  'comment.unresolve': 'Reopen',
  'comment.noSelection': 'Select text in the document first',
  'comment.anchorFailed': 'Select text within a single paragraph (or place the cursor where you want the comment)',
  'comment.newTitle': 'Select text in the document, then add a comment',
  'comment.replyPlaceholder': 'Write a reply...',
  'comment.noContent': '(no content)',
  'comment.resolveTitle': 'Mark as resolved',
  'comment.resolvedBadge': 'Resolved',
  'comment.summary': '{open} open · {total} total',
  // ===== QCResultPanel =====
  'qc.empty': 'No QC check yet',
  'qc.start': 'Run Check',
  'qc.score': 'QC Compliance Score',
  'qc.gradeA': 'Excellent',
  'qc.gradeB': 'Good',
  'qc.gradeC': 'Pass',
  'qc.gradeD': 'Fail',
  'qc.issueCount': '{n} issues',
  'qc.byCategory': 'By Category',
  'qc.bySeverity': 'By Severity',
  'qc.issues': 'Issues',
  'qc.error': 'Error',
  'qc.warning': 'Warning',
  'qc.info': 'Info',
  'qc.passed': 'QC passed, no issues',
  'qc.maxScore': 'out of 100',
  'qc.errorCount': '{n} errors',
  'qc.warningCount': '{n} warnings',
  'qc.infoCount': '{n} notices',
  'qc.jumpToIssue': 'Jump to this location',
  'qc.docLevelIssue': 'Document-level issue; no specific location',
  'qc.recheck': 'Re-check',
  // ===== DocumentCompareView =====
  'compare.title': 'Compare Documents',
  'compare.accept': 'Accept',
  'compare.reject': 'Reject',
  'compare.acceptAll': 'Accept All',
  'compare.rejectAll': 'Reject All',
  'compare.versionIds': 'Old ID: {oldId} → New ID: {newId}',
  'compare.parseError': 'Failed to parse document',
  'compare.emptyError': 'Document content is empty',
  'compare.loadError': 'Failed to load document',
  'compare.label.insert': 'Paragraph added',
  'compare.label.delete': 'Paragraph deleted',
  'compare.label.modify': 'Paragraph modified',
  'compare.label.equal': 'Unchanged',
  'compare.count.insert': '{n} added',
  'compare.count.delete': '{n} deleted',
  'compare.count.modify': '{n} modified',
  'compare.count.equal': '{n} unchanged',
  'compare.textChangeCount': '{n} text changes',
  'compare.identical': 'The two documents are identical',
  'compare.noContent': '(no content)',
  'compare.emptyParagraph': '(empty paragraph)',
  'compare.imagePlaceholder': '[image]',
  'compare.footnotePlaceholder': '[footnote]',
  // ===== ModeSwitcher =====
  'mode.edit': 'Edit',
  'mode.design': 'Design',
  'mode.form': 'Form',
  'mode.readonly': 'Read-only',
  'mode.print': 'Print',
  'mode.preview': 'Preview',
  'mode.clean': 'Plain Text',
  'mode.switchTitle': 'Switch editor mode',
  // ===== ReadingMode =====
  'reading.exit': 'Exit Reading Mode',
  'reading.hint': 'Reading mode · Press ESC to exit',
  // ===== DesignControlProperties =====
  'design.title': 'Control Properties',
  'design.openConfig': 'Open Full Configuration',
  'design.paletteTitle': 'Control Library',
  'design.paletteDescription': 'Click to insert at cursor',
  'design.properties.semantic': 'Semantic Info (Read-only)',
  'design.properties.notSpecified': 'Not Specified',
  'design.controlFallback': 'Control',
  'design.clearAllTitle': 'Clear all design-time attributes',
  'design.field.label': 'Label',
  'design.field.tips': 'Tips',
  'design.field.prefix': 'Prefix',
  'design.field.suffix': 'Suffix',
  'design.field.deletable': 'Deletable',
  'design.field.editable': 'Editable',
  'design.field.single': 'Single',
  'design.identity.dataElement': 'Data Element',
  'design.identity.dataType': 'Data Type',
  'design.identity.showType': 'Display Type',
  'design.identity.enums': 'Options',
  'design.identity.required': 'Required',
  'design.identity.readonly': 'Read-only',
  'design.expand': 'Expand',
  'design.collapse': 'Collapse',
  'design.singleBadge': 'Single',
  'design.singleTitle': 'Single-value field (can only be inserted once per document)',
  // ===== controlDisplay =====
  'controlDisplay.notSpecified': 'Not Specified',
  'controlDisplay.yes': 'Yes',
  'controlDisplay.no': 'No',
  'controlDisplay.itemCount': '{n} items',
  'controlDisplay.textInput': 'Single Line',
  'controlDisplay.textarea': 'Multi Line',
  'controlDisplay.type.input': 'Single Line',
  'controlDisplay.type.textarea': 'Multi Line',
  'controlDisplay.type.number': 'Number',
  'controlDisplay.type.select': 'Dropdown',
  'controlDisplay.type.date': 'Date',
  'controlDisplay.type.datetime': 'Date & Time',
  'controlDisplay.type.checkbox': 'Checkbox',
  'controlDisplay.type.radio': 'Radio',
  // ===== RepoLinks =====
  'repo.gitee': 'Gitee',
  'repo.github': 'GitHub',
  'repo.aria': 'Source repo · {label}',
  // ===== PerfPanel =====
  'perf.title': 'Performance Diagnostics',
  'perf.fps': 'FPS',
  'perf.layout': 'Layout',
  'perf.render': 'Render',
  'perf.cache': 'Cache Hit Rate',
  'perf.start': 'Start Sampling',
  'perf.stop': 'Stop Sampling',
  'perf.reset': 'Reset',
  // ===== FindReplaceDialog =====
  'find.find': 'Find',
  'find.replace': 'Replace',
  'find.caseSensitive': 'Case Sensitive',
  'find.wholeWord': 'Whole Word',
  'find.useRegex': 'Use Regex',
  'find.results': '{n} matches',
  'find.noResults': 'No matches',
  'find.next': 'Next',
  'find.previous': 'Previous',
  'find.replaceAll': 'Replace All',
  'find.close': 'Close',
  'find.placeholder': 'Enter search term...',
  'find.replacePlaceholder': 'Replace with...',
  'find.expandReplace': 'Show Replace',
  'find.collapseReplace': 'Hide Replace',
  // ===== PrintDialog =====
  'print.recent': 'Recent Prints',
  'print.unfinished': 'Unfinished',
  'print.resume': 'Resume from page {n}',
  'print.cancelResume': 'Cancel Resume',
  'print.orientation.portrait': 'Portrait',
  'print.orientation.landscape': 'Landscape',
  'print.range.all': 'All',
  'print.range.current': 'Current Page',
  'print.range.selection': 'Selection',
  'print.range.range': 'Page Range',
  'print.range.fromTo': 'From {from} to {to}',
  'print.range.to': 'to',
  'print.range.totalLabel': 'pages (total {n})',
  'print.range.label': 'Page Range',
  'print.range.custom': 'Custom',
  'print.printer': 'Printer',
  'print.printerDefault': 'Default Printer',
  'print.duplex.label': 'Print Mode',
  'print.duplex.duplex': 'Double-sided',
  'print.duplex.simplex': 'Single-sided',
  'print.duplex.duplexShort': 'Duplex',
  'print.duplex.simplexShort': 'Simplex',
  'print.summary': '{total} pages total · printing {printing} pages · {copies} copies · {sides}',
  'print.historySubline': '{copies} copies · {sides}',
  'print.systemNote': 'Page range is applied by this app; printer / copies / duplex are set in the system print dialog.',
  'print.copies': 'Copies',
  'print.printedAt': 'Printed at {time}',
  'print.relative.secondsAgo': '{n}s ago',
  'print.relative.minutesAgo': '{n}m ago',
  'print.relative.hoursAgo': '{n}h ago',
  'print.relative.daysAgo': '{n}d ago',
  'print.relative.justNow': 'just now',
  'print.relative.unknown': 'unknown time',
  // ===== PageSetupDialog =====
  'pageSetup.preset': 'Preset',
  'pageSetup.presetA4': 'A4 (210×297mm)',
  'pageSetup.presetLetter': 'Letter (8.5×11in)',
  'pageSetup.presetLegal': 'Legal',
  'pageSetup.presetA3': 'A3 (297×420mm)',
  'pageSetup.marginTop': 'Top',
  'pageSetup.marginBottom': 'Bottom',
  'pageSetup.marginLeft': 'Left',
  'pageSetup.marginRight': 'Right',
  'pageSetup.headerDistance': 'Header Distance',
  'pageSetup.footerDistance': 'Footer Distance',
  'pageSetup.tabMargins': 'Margins',
  'pageSetup.tabPaper': 'Paper',
  'pageSetup.tabLayout': 'Layout',
  'pageSetup.pageVerticalGap': 'Page Gap',
  'pageSetup.applyTo': 'Apply to',
  'pageSetup.applyWholeDocument': 'Whole Document',
  'pageSetup.applyFromThisPoint': 'From This Point Forward',
  'pageSetup.applyThisSection': 'This Section',
  'pageSetup.hfFutureNote': 'Header and footer settings will be available in a future release.',
  // ===== WatermarkDialog =====
  'watermark.text': 'Watermark Text',
  'watermark.fontSize': 'Font Size',
  'watermark.opacity': 'Opacity',
  'watermark.rotation': 'Rotation',
  'watermark.spacing': 'Spacing',
  'watermark.color': 'Color',
  'watermark.imageUrl': 'Image URL',
  'watermark.imageScale': 'Scale',
  'watermark.apply': 'Apply Watermark',
  'watermark.remove': 'Remove Watermark',
  'watermark.internalMark': 'Internal',
  'watermark.confidentialMark': 'Confidential',
  'watermark.textPlaceholder': 'e.g. Internal',
  'watermark.removeTitle': 'Remove watermark from this document',
  // ===== PasteSpecialDialog =====
  'paste.keepSource': 'Keep Source Format',
  'paste.matchTarget': 'Match Target Format',
  'paste.plainText': 'Plain Text',
  'paste.title': 'Paste Special',
  'paste.keepSourceDesc': 'Preserve original font, color, and style',
  'paste.matchTargetDesc': 'Use the format at the current cursor position',
  'paste.plainTextDesc': 'Remove all formatting and paste as plain text',
  'paste.previewLabel': 'Clipboard Preview',
  'paste.shortcut': 'Press Ctrl+Shift+V to quickly paste',
  'paste.confirm': 'Paste',
  'preview.paperFormat': 'A4 paper · Print-ready',
  'preview.pageCount': '{n} pages',
  // ===== ExportDialog =====
  'export.title': 'Export Document',
  'export.format': 'Format',
  'export.include': 'Include',
  'export.confirm': 'Confirm Export',
  'export.pdf': 'PDF Document',
  'export.word': 'Word Document',
  'export.html': 'HTML Page',
  'export.txt': 'Plain Text',
  'export.json': 'JSON Data',
  'export.pdfDesc': 'For printing and sharing; preserves full layout',
  'export.wordDesc': '.docx format; editable in Microsoft Word',
  'export.htmlDesc': 'Static web page; viewable directly in a browser',
  'export.txtDesc': 'Text only, no styles or formatting',
  'export.jsonDesc': 'Structured data; for programmatic processing',
  'export.comingSoon': 'Coming Soon',
  // ===== ControlConfig =====
  'controlConfig.element': 'Semantic',
  'controlConfig.definition': 'Design-Time',
  'controlConfig.basic': 'Basic',
  'controlConfig.tab.basic': 'Basic',
  'controlConfig.tab.format': 'Format',
  'controlConfig.tab.options': 'Options',
  'controlConfig.tab.advanced': 'Advanced',
  'controlConfig.internal': 'Internal',
  'controlConfig.dataElement': 'Data Element',
  'controlConfig.optionsEmpty': 'No options yet',
  'controlConfig.optionsEmptyHint': 'Click Add to insert an option',
  'controlConfig.addOption': 'Add Option',
  'controlConfig.removeOption': 'Remove Option',
  'controlConfig.optionValue': 'Value (option value)',
  'controlConfig.optionName': 'Display name (option)',
  'controlConfig.codePreview': 'Current Definition',
  'controlConfig.create': 'Create',
  'controlConfig.editMode': 'Edit',
  'controlConfig.allowFreeInput': 'Allow free input',
  'controlConfig.dictionaryIdLabel': 'Dictionary ID (paste manually)',
  'controlConfig.dictionaryIdPlaceholder': '32-char hex',
  'controlConfig.dictionaryIdInvalid': 'ID is not 32-char hex. The reference is persisted as-is, but the platform may not resolve candidates — the control falls back to free text (VR-7).',
  'controlConfig.dictionaryInlineConflict': 'This control already declares inline options. Inline options always take priority over the dictionary (§12.6.4); this binding is currently a no-op.',
  'controlConfig.dictionaryCandidateNote': 'Candidates are preloaded by the platform and injected into the editor; if not loaded the control behaves as free text without errors.',
  'controlConfig.clear': 'Clear',
  'controlConfig.fallbackName': 'Input Control',
  'controlConfig.labelField': 'Control Label (side note)',
  'controlConfig.addOptionAction': '+ Add Option',
  'controlConfig.namePlaceholder': 'e.g. Chief Complaint',
  'controlConfig.labelPlaceholder': 'e.g. Chief Complaint:',
  'controlConfig.styleHint': 'Control style: {kind}',
  'controlConfig.kindLabel': 'Control kind (determines control type)',
  'controlConfig.numberDisplay': 'Number Display',
  'controlConfig.defaultOption': 'Default',
  'controlConfig.numberDisplayN': 'Number (right-aligned)',
  'controlConfig.numberDisplayAN': 'Text-number',
  'controlConfig.numericValuePlaceholder': 'Numeric (optional)',
  'controlConfig.unlimited': 'Unlimited',
  'controlConfig.dateFormatHint': 'Dates are stored and validated as YYYY-MM-DD.',
  'controlConfig.dateTimeFormatHint': 'Date-times are stored and validated as YYYY-MM-DD HH:mm:ss.',
  'controlConfig.bindingHint': 'Only the Dropdown kind can bind an external dictionary — it is the only meaningful destination for format.dictionary. Switch to Dropdown on the Format tab first.',
  'controlConfig.prefixLabel': 'Prefix',
  'controlConfig.prefixPlaceholder': 'Literal before the control',
  'controlConfig.suffixLabel': 'Suffix',
  'controlConfig.suffixPlaceholder': 'Literal after the control',
  'controlConfig.tipsLabel': 'Tooltip (tips)',
  'controlConfig.tipsPlaceholder': 'Hover hint',
  'controlConfig.deletableLabel': 'Deletable',
  'controlConfig.editableLabel': 'Editable',
  'controlConfig.singleLabel': 'Single (unique data element)',
  'choice.create': 'New Radio/Checkbox',
  'choice.fallbackName': 'Radio/Checkbox',
  'choice.tab.type': 'Control Type',
  'choice.tab.base': 'Basic Properties',
  'choice.tab.options': 'Options',
  'choice.tab.numeric': 'Numeric Values',
  'choice.tab.list': 'Item List',
  'choice.radioLabel': 'Radio',
  'choice.radioDesc': 'Only one item can be selected',
  'choice.checkboxLabel': 'Checkbox',
  'choice.checkboxDesc': 'Multiple items can be selected',
  'choice.typeNote': 'Radio/checkbox option values are text; checkbox = multi-select enum, radio = single-select enum.',
  'choice.namePlaceholder': 'e.g. Symptom',
  'choice.labelPlaceholder': 'e.g. Symptom:',
  'choice.enumEditableLabel': 'Allow custom input (not in the option list)',
  'choice.optionsHeader': 'Options',
  'choice.addOption': 'Add Option',
  'choice.col.name': 'Name',
  'choice.col.value': 'Value',
  'choice.col.exclusive': 'Exclusive',
  'choice.col.item': 'Item',
  'choice.col.numeric': 'Numeric',
  'choice.col.itemValue': 'Item (value)',
  'choice.optionsEmptyHint': 'No options yet — use Add in the top right',
  'choice.optionsEmpty': 'No options yet',
  'choice.numericNote': 'Attach a numeric value (score / weight) to each option; leave blank for none.',
  'choice.listNote': 'The item list shares the same source as options/numeric values; reorder or delete quickly.',
  'choice.emptyName': '(unnamed)',
  'choice.emptyValue': '(empty)',
  'choice.moveUp': 'Move up',
  'choice.moveDown': 'Move down',
  'choice.removeOption': 'Remove option {n}',
  'choice.removeByValue': 'Remove {value}',
  'controlConfig.dataBindingTab': 'Data Binding',
  // ===== BookmarkDialog =====
  'bookmark.insertBookmark': 'Insert Bookmark',
  'bookmark.insertCrossRef': 'Insert Cross-Reference',
  'bookmark.crossRefTab': 'Cross-Reference',
  'bookmark.footnotePrefix': 'Footnote {n}',
  'bookmark.pagePrefix': 'Page {n}',
  'bookmark.target': 'Target',
  'bookmark.nameLabel': 'Bookmark name',
  'bookmark.namePlaceholder': 'e.g. Lab Results',
  'bookmark.description': 'Bookmarks mark important positions in the document for later reference and cross-referencing.',
  'bookmark.refFormatLabel': 'Reference format',
  'bookmark.refFormatLabelOnly': 'Bookmark / heading (no page number)',
  'bookmark.refFormatPageOnly': 'Page {n}',
  'bookmark.refFormatLabelPage': 'Bookmark (Page {n})',
  'bookmark.filterPlaceholder': 'Search bookmarks/headings/footnotes...',
  'bookmark.noTargets': 'No available targets',
  'bookmark.pageNumber': 'p.{n}',
  // ===== docProps =====
  'docProps.discardConfirm': 'There are unsaved changes. Discard and continue?',
  'docProps.unsavedHint': 'You have unsaved changes',
  'docProps.continueEditing': 'Continue Editing',
  'docProps.creator': 'Creator',
  'docProps.externalId': 'External Template ID',
  'docProps.categoryId': 'External Category ID',
  'docProps.placeholderAuthor': 'Author name',
  'docProps.placeholderCreator': 'Creator',
  'docProps.placeholderReviewer': 'Reviewer',
  'docProps.placeholderDepartment': 'Department',
  'docProps.placeholderCategory': 'Category',
  'docProps.titlePlaceholder': 'Document title',
  'docProps.keywordsPlaceholder': 'keyword1, keyword2',
  // ===== RuntimeControlOverlay =====
  'overlay.enterNumber': 'Please enter a number',
  'overlay.selectPlaceholder': 'Please select',
  // ===== TableGrowOverlay =====
  'tableGrow.addRow': 'Add Row',
  'tableGrow.addRowTitle': 'Append a row at the end of the table (clones the last row’s fields, data left empty)',
  'tableGrow.growable': 'Growable',
  'tableGrow.growableMarkerTitle': 'This table is declared growable while filling — an "+ Add Row" entry appears at the end of the table when filling. Right-click a table cell to toggle.',
  // ===== Engine error chip =====
  'error.unknownEngine': 'Engine Error',
  // ===== 引擎层文案 =====
  'qc.rule.title.name': 'Document title must not be empty',
  'qc.rule.title.desc': 'The document must have a title',
  'qc.rule.body.name': 'Document contains body content',
  'qc.rule.body.desc': 'The document body must contain at least one paragraph',
  'qc.rule.emptyParagraph.name': 'No consecutive empty paragraphs',
  'qc.rule.emptyParagraph.desc': 'There should be no two consecutive empty paragraphs (scope: body + each header/footer variant, judged per container)',
  'qc.rule.smartTextRequired.name': 'Required SmartText field check',
  'qc.rule.smartTextRequired.desc': 'A SmartTextNode marked as required must not be empty',
  'qc.rule.minChars.name': 'Document meets minimum character count',
  'qc.rule.minChars.desc': 'The document body must contain at least 10 characters',
  'qc.rule.paragraphCount.name': 'Paragraph count is reasonable',
  'qc.rule.paragraphCount.desc': 'The paragraph count should be between 1 and 500',
  // ErrorRecovery
  'engineError.particleRender': 'Particle render failed: nodeId={nodeId}',
  'engineError.pageRender': 'Page render failed: pageIndex={pageIndex}',
  'engineError.pagePlaceholder': 'Page {page} failed to render',
  'engineError.loadFallback': 'Document failed to load; fell back to a blank document',
  'engineError.loadFallbackFailed': 'The fallback document also failed to load',
  'engineError.asyncTask': 'Async task failed',
  // 文档加载
  'loader.failed': '"{name}" failed to load: {msg}',
  'loader.parseFailed': 'JSON.parse failed: {msg}',
  'loader.notObject': 'The document must be an object',
  'loader.upgradeFailed': 'Upgrade failed: {msg}',
  'loader.badDocId': 'doc.id is missing or not a string',
  'loader.badDocTitle': 'doc.title is missing or not a string',
  'loader.badBodyChildren': 'doc.body.children is missing or not an array',
  'loader.badMetadata': 'doc.metadata is not an object',
  'loader.badChildRef': 'children contains a non-string reference: {id}',
  'loader.danglingRef': 'Dangling reference (node not found in nodes/extraNodes): {id}',
  'loader.versionTooNew': 'Document version {ver} is newer than the engine supports ({current})',
  'loader.versionOutdated': 'Upgrade needed: {ver} → {current}',
  'loader.versionCurrent': 'Version is current',
  'loader.importedHtml': 'Imported HTML Document',
  'loader.importedMarkdown': 'Imported Markdown Document',
  'loader.importedXml': 'Imported XML Document',
  // 文档默认标题 / 模板
  'doc.untitled': 'Untitled Document',
  'doc.recovered': 'Recovered Document',
  'doc.importedTemplate': 'Imported Template',
  // 书签交叉引用目标
  'nav.headingFallback': 'Heading {level}',
  'nav.footnoteLabel': 'Footnote {id}',
  // 目录 / 控件占位
  'toc.title': 'Contents',
  'toc.emptyHeading': '(empty heading)',
  'control.emptyOptions': 'No options',
  // 域代码占位符
  'field.placeholder.pageNumber': '[Page Number]',
  'field.placeholder.totalPages': '[Total Pages]',
  'field.placeholder.currentDate': '[Date]',
  'field.placeholder.currentTime': '[Time]',
  'field.placeholder.authorName': '[Author]',
  'field.placeholder.documentTitle': '[Title]',
  'field.placeholder.lastSavedDate': '[Last Saved]',
  'field.placeholder.printDate': '[Print Date]',
  // ===== 既有 ICU 模板 =====
  'editor.pageOf': 'Page {current} of {total}',
  'editor.controlCount': '{n, plural, one {# control} other {# controls}}',
}

// ---- 消息格式化 (纯函数, 可单测; 无副作用) ----

/** ICU 单层子集的头部: `n, plural, one {…} other {…}` */
const PLURAL_HEAD = /^(\w+)\s*,\s*plural\s*,\s*([\s\S]+)$/

/** 返回 `text[start]` 处 `{` 的配对 `}` 下标; 不成对返回 -1 */
function matchBrace(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 从 `one {…} other {…}` 里挑出当前复数规则命中的分支 (缺则回落 other) */
function selectPluralBranch(body: string, n: number, locale: Locale): string {
  const branches = new Map<string, string>()
  let i = 0
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++
    const keyStart = i
    while (i < body.length && /[A-Za-z]/.test(body[i])) i++
    const key = body.slice(keyStart, i)
    if (!key) break
    while (i < body.length && /\s/.test(body[i])) i++
    if (body[i] !== '{') break
    const end = matchBrace(body, i)
    if (end < 0) break
    branches.set(key, body.slice(i + 1, end))
    i = end + 1
  }

  const rule = new Intl.PluralRules(locale).select(n)
  return branches.get(rule) ?? branches.get('other') ?? ''
}

function interpolate(text: string, params: LocaleParams, locale: Locale): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== '{') { out += text[i]; i++; continue }

    const end = matchBrace(text, i)
    // 未闭合的 `{` 原样输出 —— 不吞掉后面的内容
    if (end < 0) { out += text[i]; i++; continue }

    const inner = text.slice(i + 1, end)
    const plural = PLURAL_HEAD.exec(inner)

    if (plural) {
      const n = Number(params[plural[1]])
      if (!Number.isFinite(n)) {
        // 参数缺失/非数字 → 保留字面 `{n, plural, …}`, 让问题看得见, 不静默变空串
        out += `{${inner}}`
      } else {
        const branch = selectPluralBranch(plural[2], n, locale)
        // ICU 的 `#` 是"当前数值"占位符 (中文分支塌成一条时也要能写出数字)
        out += interpolate(branch.replace(/#/g, String(n)), params, locale)
      }
    } else {
      const name = inner.trim()
      out += Object.prototype.hasOwnProperty.call(params, name)
        ? String(params[name])
        : `{${name}}`   // 未提供参数 → 保留字面, 可见的失败
    }

    i = end + 1
  }
  return out
}

/**
 * 把模板串展开成最终文案。
 *
 * 支持 (刻意只做这两件, 不引 intl-messageformat —— 见文件头的"不做"):
 * - 插值 `{name}` — 未提供的参数**保留字面** `{name}`
 * - 复数 `{n, plural, one {…} other {…}}` 单层, 分支选择用 `Intl.PluralRules`,
 *   分支内可用 `#` 表示数值, 也可嵌套 `{name}`
 */
export function formatMessage(
  template: string,
  params: LocaleParams | undefined,
  locale: Locale,
): string {
  return interpolate(template, params ?? {}, locale)
}

// ---- 引擎 ----

const PACKS: Record<Locale, LocaleMessages> = { 'zh-CN': zhCN, 'en-US': enUS }

export class LocaleManager {
  private current: Locale = 'zh-CN'
  private messages: LocaleMessages
  private overrides: Partial<LocaleMessages> = {}
  /** 语言变更订阅者 (React 侧 useSyncExternalStore 用) */
  private listeners = new Set<() => void>()
  /** 单调递增版本号 — 供 useSyncExternalStore 检测变更 (与 EditorStore 同范式) */
  private version = 0

  constructor() {
    this.messages = { ...PACKS['zh-CN'] }
  }

  getLocale(): Locale { return this.current }

  /** 当前版本号 (每次 notify 递增) */
  getVersion(): number { return this.version }

  /**
   * 切换语言。
   *
   * 同值早退: 对齐 EditorStore.setDocumentTitle 的守卫 —— 否则 bootstrap 里
   * 一次 setLocale(getLocale()) 就会白刷一遍全部订阅者。
   */
  setLocale(locale: Locale): void {
    if (locale === this.current) return
    this.current = locale
    this.messages = { ...PACKS[locale], ...this.overrides }
    this.notify()
  }

  /** 第三方部分覆盖 (合并到当前语言包) */
  extend(patch: Partial<LocaleMessages>): void {
    this.overrides = { ...this.overrides, ...patch }
    this.messages = { ...this.messages, ...patch }
    this.notify()
  }

  /** 订阅语言变更; 返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 获取单个翻译 (可带插值/复数参数) */
  t(key: keyof LocaleMessages, params?: LocaleParams): string {
    const template = this.messages[key]
    if (template === undefined) {
      // 缺键 → 返回键本身 (可见的失败, 不是空串) + 一条 warn。
      // 不做 dev-only 门控: 引擎不依赖打包器的 env 注入 (那会把 §27/§29 的
      // host 无关性撕开一个口子), 且仓库既有 31 处 console 诊断也都是无条件的。
      console.warn(`[i18n] 缺少文案键: ${String(key)}`)
      return String(key)
    }
    return formatMessage(template, params, this.current)
  }

  private notify(): void {
    this.version++
    // 单个订阅者抛错不阻断其余, 但**不静默吞掉** —— 订阅者多半是 React 渲染,
    // 吞了就等于界面悄悄不更新 (EventBus 的 listener 处理也是这个口径)。
    this.listeners.forEach(l => {
      try { l() } catch (err) { console.error('[i18n] locale listener error:', err) }
    })
  }
}

/** 全局单例 (契约 §27.3: app-wide 共享, 不得挪进 store) */
export const locale = new LocaleManager()

/** 便捷翻译函数 (不带订阅 —— 需要随语言重渲染的组件请用 useTranslation) */
export function t(key: keyof LocaleMessages, params?: LocaleParams): string {
  return locale.t(key, params)
}
