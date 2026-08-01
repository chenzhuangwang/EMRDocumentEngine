// ============================================================
// API 客户端
// ============================================================

import axios, { type AxiosInstance, type AxiosResponse } from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器 - 添加认证 Token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器 - 统一错误处理
apiClient.interceptors.response.use(
  (response: AxiosResponse<ApiResponse<unknown>>) => {
    return response
  },
  async (error) => {
    if (error.response?.status === 401) {
      // Token 过期，尝试刷新
      const refreshToken = localStorage.getItem('refreshToken')
      if (refreshToken) {
        try {
          const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken })
          const { accessToken } = res.data.data
          localStorage.setItem('accessToken', accessToken)
          error.config.headers.Authorization = `Bearer ${accessToken}`
          return apiClient(error.config)
        } catch {
          localStorage.removeItem('accessToken')
          localStorage.removeItem('refreshToken')
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  }
)

// API 类型
export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export interface PageResult<T> {
  records: T[]
  total: number
  page: number
  size: number
}

// ==================== 文档 API ====================

export interface DocumentListItem {
  id: string
  title: string
  status: string
  version: number
  createdBy: string
  updatedBy: string
  createdAt: string
  updatedAt: string
}

export interface DocumentDetail {
  id: string
  title: string
  templateId?: string
  /** DocumentTree JSON (v20.34, ModelD 去分页化) */
  content: string
  modelVersion?: string
  pageSetup: {
    width: number
    height: number
    marginTop: number
    marginBottom: number
    marginLeft: number
    marginRight: number
    orientation: string
  }
  /** v20.34: 元数据统一为 Record, 不再预设固定结构 */
  metadata?: Record<string, unknown>
}

export const documentApi = {
  list: (params?: { page?: number; size?: number; keyword?: string; status?: string }) =>
    apiClient.get<ApiResponse<PageResult<DocumentListItem>>>('/documents', { params }),

  getById: (id: string) =>
    apiClient.get<ApiResponse<DocumentDetail>>(`/documents/${id}`),

  create: (data: { title: string; templateId?: string; content?: unknown }) =>
    apiClient.post<ApiResponse<DocumentDetail>>('/documents', data),

  update: (id: string, data: { title?: string; content?: unknown }) =>
    apiClient.put<ApiResponse<DocumentDetail>>(`/documents/${id}`, data),

  delete: (id: string) =>
    apiClient.delete<ApiResponse<void>>(`/documents/${id}`),
}

// ==================== 模板 API ====================

export interface TemplateListItem {
  id: string
  name: string
  category: string
  description: string
  thumbnail?: string
  isPublic: boolean
  createdAt: string
}

export const templateApi = {
  list: (params?: { category?: string; keyword?: string }) =>
    apiClient.get<ApiResponse<TemplateListItem[]>>('/templates', { params }),

  getById: (id: string) =>
    apiClient.get<ApiResponse<DocumentDetail>>(`/templates/${id}`),

  create: (data: { name: string; category?: string; description?: string; content: unknown }) =>
    apiClient.post<ApiResponse<DocumentDetail>>('/templates', data),

  update: (id: string, data: { name?: string; content?: unknown }) =>
    apiClient.put<ApiResponse<DocumentDetail>>(`/templates/${id}`, data),

  delete: (id: string) =>
    apiClient.delete<ApiResponse<void>>(`/templates/${id}`),
}

// ==================== 认证 API ====================

export interface UserInfo {
  id: string
  username: string
  realName: string
  role: string
}

export const authApi = {
  login: (username: string, password: string) =>
    apiClient.post<ApiResponse<{ accessToken: string; refreshToken: string; user: UserInfo }>>(
      '/auth/login',
      { username, password }
    ),

  logout: () => apiClient.post<ApiResponse<void>>('/auth/logout'),

  refresh: (refreshToken: string) =>
    apiClient.post<ApiResponse<{ accessToken: string; refreshToken: string }>>(
      '/auth/refresh',
      { refreshToken }
    ),

  getCurrentUser: () =>
    apiClient.get<ApiResponse<UserInfo>>('/auth/me'),
}

export default apiClient
