// ============================================================
// Mock 文档 — 后端不可用时的本地兜底 (demo)
//
// 单一事实源: HomePage 的列表条目与 EditorPage 打开的正文同出一份数据, 以 id 为键。
//
// content 刻意保持「JSON 字符串」形态 (与 DocumentDetail.content 同构):
// 消费方 JSON.parse 得到的是全新对象图, 引擎 (setDocument 后就地持有并改写)
// 与 stripWidgetDefaultLabelsFromObject (就地 delete) 的修改都不会污染本模块,
// 因此反复打开始终是原始文档。若改成直接暴露对象引用, 首次打开就会永久
// 剥掉控件默认标签、并把后续每一次编辑写回模块单例。
// ============================================================

import type { DocumentDetail, DocumentListItem } from '@/services/api'
import admissionRecord from './admissionRecord.json'

interface MockDocumentEntry {
  /** 列表行数据 (HomePage) */
  listItem: DocumentListItem
  /** 正文 JSON 字符串; 缺省表示该 mock 无正文 (打开后仍是空文档) */
  content?: string
}

/** 入院记录 — 真实引擎导出件 (格式 4.5.0, A4 纵向, 22 个正文子节点 + 页眉页脚) */
export const MOCK_DOCUMENTS: MockDocumentEntry[] = [
  {
    listItem: {
      id: 'doc_1',
      // 与正文标题同源, 避免列表标题与文档标题漂移
      title: admissionRecord.title,
      status: 'draft',
      version: 3,
      createdBy: '李医生',
      updatedBy: '李医生',
      createdAt: '2026-07-17 10:30:00',
      updatedAt: '2026-07-17 14:20:00',
    },
    // 序列化一次; 字符串不可变, 可安全共享给任意多次打开
    content: JSON.stringify(admissionRecord),
  },
]

/** HomePage 文档列表 mock (消费方只读: 仅 filter/map, 不原地修改) */
export const MOCK_DOCUMENT_LIST: DocumentListItem[] = MOCK_DOCUMENTS.map((d) => d.listItem)

/**
 * EditorPage 在 documentApi 失败时的兜底: 按 id 返回 DocumentDetail 形态的详情。
 * 无匹配条目、或该条目无正文 → undefined (调用方保持原有「空文档」行为)。
 */
export function getMockDocumentDetail(id: string): DocumentDetail | undefined {
  const entry = MOCK_DOCUMENTS.find((d) => d.listItem.id === id)
  if (!entry?.content) return undefined
  return {
    id: entry.listItem.id,
    title: entry.listItem.title,
    content: entry.content,
    modelVersion: admissionRecord.modelVersion,
    // pageSetup 走浅拷贝, 不把模块内对象引用交出去
    pageSetup: { ...admissionRecord.pageSetup },
  }
}
