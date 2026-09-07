// ============================================================
// DocumentPropertiesDialog — 文档属性对话框 (契约 §7.7/§7.8, P2-B)
//
// 覆盖:
//   1. 打开读取标题+元数据 (title 与 metadata 分离, 不合并)。
//   2. 无更改 → 取消直接关闭 (无二次确认)。
//   3. 有更改 → 取消/关闭二次确认; 放弃 → 丢弃草稿关闭; 继续编辑 → 保持打开。
//   4. 应用 → onApply({ title, metadata }) 且 metadata 已 normalize
//      (keywords 逗号串 → string[]; 空 → undefined 表示删除)。
//   5. externalId/categoryId/createdAt/updatedAt 只读。
//   6. 草稿未提交前不触发 onApply (对话框不直改 DocumentModel)。
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocumentPropertiesDialog, type DocumentPropertiesResult } from '../DocumentPropertiesDialog'
import type { DocumentMetadata } from '@/engine/document/core/DocumentModel'

function renderDialog(overrides?: { initialTitle?: string; initialValues?: DocumentMetadata }) {
  const onClose = vi.fn()
  const onApply = vi.fn()
  render(
    <DocumentPropertiesDialog
      open
      onClose={onClose}
      onApply={onApply}
      initialTitle={overrides?.initialTitle}
      initialValues={overrides?.initialValues}
    />,
  )
  return { onClose, onApply }
}

function inputByPlaceholder(ph: string): HTMLInputElement {
  return screen.getByPlaceholderText(ph) as HTMLInputElement
}

describe('DocumentPropertiesDialog (契约 §7.7/§7.8)', () => {
  it('打开读取标题+元数据 (title 与 metadata 分离)', () => {
    renderDialog({
      initialTitle: '入院记录',
      initialValues: { author: '张三', keywords: ['高血压', '心内科'] },
    })

    expect(inputByPlaceholder('文档标题').value).toBe('入院记录')
    expect(inputByPlaceholder('作者姓名').value).toBe('张三')
    expect(inputByPlaceholder('关键词1, 关键词2').value).toBe('高血压, 心内科')
  })

  it('无更改 → 取消直接关闭, 无二次确认', () => {
    const { onClose } = renderDialog({ initialTitle: '标题', initialValues: { author: '张三' } })
    fireEvent.click(screen.getByText('取消'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('有未保存的更改，确定放弃吗？')).toBeNull()
  })

  it('有更改 → 取消弹二次确认; 放弃更改 → 丢弃草稿并关闭', () => {
    const { onClose, onApply } = renderDialog({ initialTitle: '标题' })
    fireEvent.change(inputByPlaceholder('文档标题'), { target: { value: '新标题' } })
    fireEvent.click(screen.getByText('取消'))

    expect(screen.getByText('有未保存的更改，确定放弃吗？')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('放弃更改'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled() // 丢弃草稿, 不提交
  })

  it('有更改 → 二次确认选继续编辑 → 保持打开', () => {
    const { onClose } = renderDialog({ initialTitle: '标题' })
    fireEvent.change(inputByPlaceholder('文档标题'), { target: { value: '新标题' } })
    fireEvent.click(screen.getByText('取消'))
    fireEvent.click(screen.getByText('继续编辑'))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('有未保存的更改，确定放弃吗？')).toBeNull()
  })

  it('应用 → onApply 提交规范化 { title, metadata } (keywords 逗号串 → string[])', () => {
    const { onApply } = renderDialog({ initialTitle: '旧标题', initialValues: { author: '张三' } })
    fireEvent.change(inputByPlaceholder('文档标题'), { target: { value: '出院小结' } })
    fireEvent.change(inputByPlaceholder('关键词1, 关键词2'), { target: { value: ' 高血压 , 心内科, 高血压 ' } })
    fireEvent.click(screen.getByText('应用'))

    const result = onApply.mock.calls[0][0] as DocumentPropertiesResult
    expect(result.title).toBe('出院小结')
    expect(result.metadata).toEqual({ author: '张三', keywords: ['高血压', '心内科'] })
  })

  it('清空所有字段 → metadata undefined (整体删除语义)', () => {
    const { onApply } = renderDialog({ initialTitle: '标题', initialValues: { author: '张三', keywords: ['a'] } })
    fireEvent.change(inputByPlaceholder('文档标题'), { target: { value: '' } })
    fireEvent.change(inputByPlaceholder('作者姓名'), { target: { value: '' } })
    fireEvent.change(inputByPlaceholder('关键词1, 关键词2'), { target: { value: '' } })
    fireEvent.click(screen.getByText('应用'))

    const result = onApply.mock.calls[0][0] as DocumentPropertiesResult
    expect(result.title).toBe('')
    expect(result.metadata).toBeUndefined()
  })

  it('externalId/categoryId/createdAt/updatedAt 只读', () => {
    renderDialog({
      initialValues: {
        author: '张三',
        externalId: 'ext-1', categoryId: 'cat-1',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
      },
    })
    for (const v of ['ext-1', 'cat-1', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z']) {
      expect((screen.getByDisplayValue(v) as HTMLInputElement).readOnly).toBe(true)
    }
  })

  it('草稿未提交 (仅编辑) 不触发 onApply — 对话框不直改 DocumentModel', () => {
    const { onApply } = renderDialog({ initialTitle: '标题', initialValues: { author: '张三' } })
    fireEvent.change(inputByPlaceholder('作者姓名'), { target: { value: '李四' } })
    expect(onApply).not.toHaveBeenCalled()
  })
})
