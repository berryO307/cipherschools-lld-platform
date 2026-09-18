import type { AttemptHistoryItem, ProblemDetail, ProblemSummary } from '@/types'

// In production (Vercel), there is no dev-server proxy, so the deployed
// Railway backend's URL must be provided via VITE_API_URL. Locally, the
// fallback of 'http://localhost:4000/api' talks straight to the backend
// (CORS-permitted via FRONTEND_URL) without needing that env var set.
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  getMe: () => request<{ id: string; displayName: string; email: string }>('/me'),
  listProblems: () => request<ProblemSummary[]>('/problems'),
  getProblem: (id: string) => request<ProblemDetail>(`/problems/${id}`),
  submitAttempt: (input: { userId: string; problemId: string; text: string; assumptions?: string }) =>
    request<{ attemptId: string; status: string }>('/attempts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getHistory: (userId: string) => request<AttemptHistoryItem[]>(`/attempts/${userId}/history`),
  retryAttempt: (attemptId: string) =>
    request<{ status: string }>(`/attempts/${attemptId}/retry`, { method: 'POST' }),
}
