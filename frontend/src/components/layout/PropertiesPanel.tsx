// ============================================================
// 属性面板（右侧滑出）
// ============================================================

import { X, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store'

interface PropertiesPanelProps {
  selectedElement?: SelectedElement | null
  onPropertyChange?: (property: string, value: unknown) => void
}

interface SelectedElement {
  id: string
  type: string
  label: string
  properties: Record<string, unknown>
  validation?: {
    required?: boolean
    pattern?: string
    min?: number
    max?: number
    maxLength?: number
    message?: string
  }
  dataBinding?: {
    source: string
    property: string
  }
}

export function PropertiesPanel({ selectedElement, onPropertyChange }: PropertiesPanelProps) {
  const propertiesPanelOpen = useUIStore((s) => s.propertiesPanelOpen)
  const setPropertiesPanelOpen = useUIStore((s) => s.setPropertiesPanelOpen)

  if (!propertiesPanelOpen) return null

  return (
    <aside className="w-properties bg-white border-l border-gray-200 flex flex-col flex-shrink-0 animate-slide-in-right">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-800">属性</h3>
        <button
          className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          onClick={() => setPropertiesPanelOpen(false)}
        >
          <X size={16} />
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin p-4 space-y-4">
        {selectedElement ? (
          <>
            {/* 基本信息 */}
            <div className="property-group">
              <h4 className="property-group-title">{selectedElement.label}</h4>
              <div className="property-field">
                <label className="property-label">元素类型</label>
                <div className="text-sm text-gray-600">{selectedElement.type}</div>
              </div>
            </div>

            {/* 控件属性 */}
            {selectedElement.properties && Object.keys(selectedElement.properties).length > 0 && (
              <div className="property-group">
                <h4 className="property-group-title">控件属性</h4>
                {Object.entries(selectedElement.properties).map(([key, value]) => (
                  <div key={key} className="property-field">
                    <label className="property-label">{key}</label>
                    <input
                      className="property-input"
                      value={String(value ?? '')}
                      onChange={(e) => onPropertyChange?.(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* 校验规则 */}
            {selectedElement.validation && (
              <div className="property-group">
                <h4 className="property-group-title">校验规则</h4>

                <div className="property-field">
                  <label className="property-label flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="rounded text-primary-600"
                      checked={selectedElement.validation.required ?? false}
                      onChange={(e) => onPropertyChange?.('validation.required', e.target.checked)}
                    />
                    必填项
                  </label>
                </div>

                {selectedElement.validation.maxLength !== undefined && (
                  <div className="property-field">
                    <label className="property-label">最大长度</label>
                    <input
                      type="number"
                      className="property-input"
                      value={selectedElement.validation.maxLength}
                      onChange={(e) => onPropertyChange?.('validation.maxLength', parseInt(e.target.value))}
                    />
                  </div>
                )}

                {selectedElement.validation.pattern !== undefined && (
                  <div className="property-field">
                    <label className="property-label">正则表达式</label>
                    <input
                      className="property-input"
                      value={selectedElement.validation.pattern}
                      onChange={(e) => onPropertyChange?.('validation.pattern', e.target.value)}
                    />
                  </div>
                )}

                {selectedElement.validation.message && (
                  <div className="property-field">
                    <label className="property-label">错误提示</label>
                    <input
                      className="property-input"
                      value={selectedElement.validation.message}
                      onChange={(e) => onPropertyChange?.('validation.message', e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* 数据绑定 */}
            {selectedElement.dataBinding && (
              <div className="property-group">
                <h4 className="property-group-title">数据绑定</h4>
                <div className="property-field">
                  <label className="property-label">数据源</label>
                  <input
                    className="property-input"
                    value={selectedElement.dataBinding.source}
                    onChange={(e) => onPropertyChange?.('dataBinding.source', e.target.value)}
                  />
                </div>
                <div className="property-field">
                  <label className="property-label">属性路径</label>
                  <input
                    className="property-input"
                    value={selectedElement.dataBinding.property}
                    onChange={(e) => onPropertyChange?.('dataBinding.property', e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* 校验状态 */}
            <ValidationStatus
              isValid={true}
              message="元素配置正常"
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <AlertTriangle size={32} className="mb-2" />
            <p className="text-sm text-center">选中一个元素<br />查看和编辑属性</p>
          </div>
        )}
      </div>
    </aside>
  )
}

function ValidationStatus({ isValid, message }: { isValid: boolean; message: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-md text-sm',
        isValid ? 'bg-success-100 text-green-700' : 'bg-error-100 text-red-700'
      )}
    >
      {isValid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {message}
    </div>
  )
}
