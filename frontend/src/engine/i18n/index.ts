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
  'toolbar.insertField': string               // 插入域代码 title
  'toolbar.lineHeight': string
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
  // ============================================================
  // DocumentCompareView
  // ============================================================
  'compare.title': string
  'compare.added': string
  'compare.removed': string
  'compare.modified': string
  'compare.unchanged': string
  'compare.summary': string
  'compare.accept': string
  'compare.reject': string
  'compare.acceptAll': string
  'compare.rejectAll': string
  'compare.versionIds': string           // '旧版本 ID: {oldId} → 新版本 ID: {newId}'
  'compare.parseError': string           // '文档解析失败'
  'compare.emptyError': string           // '文档内容为空'
  'compare.loadError': string            // '加载文档失败'
  // ============================================================
  // ModeSwitcher (6 个编辑模式)
  // ============================================================
  'mode.edit': string
  'mode.design': string
  'mode.form': string
  'mode.readonly': string
  'mode.print': string
  'mode.preview': string
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
  // ============================================================
  // controlDisplay.ts
  // ============================================================
  'controlDisplay.notSpecified': string
  'controlDisplay.yes': string
  'controlDisplay.no': string
  'controlDisplay.itemCount': string          // '{n} 项'
  'controlDisplay.textInput': string          // '单行文本' / 'Single Line'
  'controlDisplay.textarea': string           // '多行文本' / 'Multi Line'
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
  'controlConfig.optionValue': string
  'controlConfig.optionName': string
  'controlConfig.codePreview': string
  'controlConfig.create': string
  'controlConfig.editMode': string
  'controlConfig.allowFreeInput': string
  // ============================================================
  // BookmarkDialog
  // ============================================================
  'bookmark.insertBookmark': string
  'bookmark.insertCrossRef': string
  'bookmark.crossRefTab': string
  'bookmark.footnotePrefix': string           // '脚注 {n}'
  'bookmark.pagePrefix': string               // '第 {n} 页'
  'bookmark.target': string
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
  // ============================================================
  // TableGrowOverlay
  // ============================================================
  'tableGrow.addRow': string                  // '在表尾添加一行（克隆末行字段，数据为空）'
  'tableGrow.dynamicNotice': string          // '此表声明了「填写时可增长」...'
  // ============================================================
  // Engine error chip
  // ============================================================
  'error.unknownEngine': string
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
  'dialog.controlType.select': '下拉选择',
  'dialog.controlType.date': '日期',
  'dialog.controlType.datetime': '日期时间',
  'dialog.controlType.checkbox': '复选框',
  'dialog.controlType.radio': '单选框',
  // ===== 数据类型 =====
  'dialog.dataType.S1': 'S1',
  'dialog.dataType.S2': 'S2',
  'dialog.dataType.S3': 'S3',
  'dialog.dataType.N': 'N',
  'dialog.dataType.D': 'D',
  'dialog.dataType.DT': 'DT',
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
  'toolbar.insertField': '插入域代码',
  'toolbar.lineHeight': '行距',
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
  'outline.empty': '暂无大纲',
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
  'comment.anchor': '锚定：{text}',
  'comment.timeJustNow': '刚刚',
  'comment.timeMinutesAgo': '{n} 分钟前',
  'comment.timeHoursAgo': '{n} 小时前',
  'comment.timeDaysAgo': '{n} 天前',
  'comment.resolve': '解决',
  'comment.unresolve': '撤销解决',
  'comment.noSelection': '请先在文档中选择文字',
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
  // ===== DocumentCompareView =====
  'compare.title': '文档比较',
  'compare.added': '新增',
  'compare.removed': '删除',
  'compare.modified': '修改',
  'compare.unchanged': '相同',
  'compare.summary': '共 {total} 处差异',
  'compare.accept': '接受',
  'compare.reject': '拒绝',
  'compare.acceptAll': '全部接受',
  'compare.rejectAll': '全部拒绝',
  'compare.versionIds': '旧版本 ID: {oldId} → 新版本 ID: {newId}',
  'compare.parseError': '文档解析失败',
  'compare.emptyError': '文档内容为空',
  'compare.loadError': '加载文档失败',
  // ===== ModeSwitcher =====
  'mode.edit': '编辑',
  'mode.design': '设计',
  'mode.form': '表单',
  'mode.readonly': '只读',
  'mode.print': '打印',
  'mode.preview': '预览',
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
  // ===== controlDisplay =====
  'controlDisplay.notSpecified': '未指定',
  'controlDisplay.yes': '是',
  'controlDisplay.no': '否',
  'controlDisplay.itemCount': '{n} 项',
  'controlDisplay.textInput': '单行文本',
  'controlDisplay.textarea': '多行文本',
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
  'print.range.fromTo': '从 {from} 页到 {to} 页',
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
  'controlConfig.tab.basic': '基本',
  'controlConfig.tab.format': '格式',
  'controlConfig.tab.options': '候选项',
  'controlConfig.tab.advanced': '高级',
  'controlConfig.internal': '内部',
  'controlConfig.dataElement': '数据元',
  'controlConfig.optionsEmpty': '暂无候选项',
  'controlConfig.optionsEmptyHint': '点击新增选项',
  'controlConfig.addOption': '新增选项',
  'controlConfig.removeOption': '删除选项',
  'controlConfig.optionValue': '值',
  'controlConfig.optionName': '显示名',
  'controlConfig.codePreview': '当前定义',
  'controlConfig.create': '新建',
  'controlConfig.editMode': '编辑',
  'controlConfig.allowFreeInput': '允许手输自定义值',
  // ===== BookmarkDialog =====
  'bookmark.insertBookmark': '插入书签',
  'bookmark.insertCrossRef': '插入交叉引用',
  'bookmark.crossRefTab': '交叉引用',
  'bookmark.footnotePrefix': '脚注 {n}',
  'bookmark.pagePrefix': '第 {n} 页',
  'bookmark.target': '目标',
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
  // ===== TableGrowOverlay =====
  'tableGrow.addRow': '在表尾添加一行（克隆末行字段，数据为空）',
  'tableGrow.dynamicNotice': '此表声明了「填写时可增长」，按下方按钮或在该行末尾按 Enter 即可继续添加。',
  // ===== Engine error chip =====
  'error.unknownEngine': '引擎错误',
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
  'dialog.dataType.S1': 'S1',
  'dialog.dataType.S2': 'S2',
  'dialog.dataType.S3': 'S3',
  'dialog.dataType.N': 'N',
  'dialog.dataType.D': 'D',
  'dialog.dataType.DT': 'DT',
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
  'toolbar.insertField': 'Insert Field Code',
  'toolbar.lineHeight': 'Line Spacing',
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
  'outline.empty': 'No outline',
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
  // ===== DocumentCompareView =====
  'compare.title': 'Compare Documents',
  'compare.added': 'Added',
  'compare.removed': 'Removed',
  'compare.modified': 'Modified',
  'compare.unchanged': 'Unchanged',
  'compare.summary': '{total} differences',
  'compare.accept': 'Accept',
  'compare.reject': 'Reject',
  'compare.acceptAll': 'Accept All',
  'compare.rejectAll': 'Reject All',
  'compare.versionIds': 'Old ID: {oldId} → New ID: {newId}',
  'compare.parseError': 'Failed to parse document',
  'compare.emptyError': 'Document content is empty',
  'compare.loadError': 'Failed to load document',
  // ===== ModeSwitcher =====
  'mode.edit': 'Edit',
  'mode.design': 'Design',
  'mode.form': 'Form',
  'mode.readonly': 'Read-only',
  'mode.print': 'Print',
  'mode.preview': 'Preview',
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
  // ===== controlDisplay =====
  'controlDisplay.notSpecified': 'Not Specified',
  'controlDisplay.yes': 'Yes',
  'controlDisplay.no': 'No',
  'controlDisplay.itemCount': '{n} items',
  'controlDisplay.textInput': 'Single Line',
  'controlDisplay.textarea': 'Multi Line',
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
  'controlConfig.optionValue': 'Value',
  'controlConfig.optionName': 'Display Name',
  'controlConfig.codePreview': 'Current Definition',
  'controlConfig.create': 'Create',
  'controlConfig.editMode': 'Edit',
  'controlConfig.allowFreeInput': 'Allow free input',
  // ===== BookmarkDialog =====
  'bookmark.insertBookmark': 'Insert Bookmark',
  'bookmark.insertCrossRef': 'Insert Cross-Reference',
  'bookmark.crossRefTab': 'Cross-Reference',
  'bookmark.footnotePrefix': 'Footnote {n}',
  'bookmark.pagePrefix': 'Page {n}',
  'bookmark.target': 'Target',
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
  // ===== TableGrowOverlay =====
  'tableGrow.addRow': 'Append a row at table end (clones last row fields, data empty)',
  'tableGrow.dynamicNotice': 'This table is marked growable — click the button below or press Enter at end of row to extend.',
  // ===== Engine error chip =====
  'error.unknownEngine': 'Engine Error',
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
