import type { SignupRequestListItem, ApproveSignupResponse } from '@fineduc/contracts'

export interface AdminApi {
  listSignupRequests(): Promise<SignupRequestListItem[]>
  approveSignup(id: string): Promise<ApproveSignupResponse>
  rejectSignup(id: string, reason: string): Promise<void>
}

export const qk = {
  signupRequests: ['signup-requests'] as const,
}

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3010'

function getAdminKey(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('fineduc_admin_key') ?? ''
}

async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-admin-key': getAdminKey(),
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { detail?: string; message?: string }
    throw new Error(body.detail ?? body.message ?? `Request failed: ${res.status}`)
  }

  return res
}

class RealAdminApi implements AdminApi {
  async listSignupRequests(): Promise<SignupRequestListItem[]> {
    const res = await adminFetch('/admin/signups')
    return res.json() as Promise<SignupRequestListItem[]>
  }

  async approveSignup(id: string): Promise<ApproveSignupResponse> {
    const res = await adminFetch(`/admin/signups/${id}/approve`, { method: 'POST' })
    return res.json() as Promise<ApproveSignupResponse>
  }

  async rejectSignup(id: string, reason: string): Promise<void> {
    await adminFetch(`/admin/signups/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  }
}

let instance: AdminApi | null = null

export function getApi(): AdminApi {
  if (!instance) instance = new RealAdminApi()
  return instance
}
