import type { SignupRequestListItem, ApproveSignupResponse } from '@fineduc/contracts'

export interface AdminApi {
  listSignupRequests(): Promise<SignupRequestListItem[]>
  approveSignup(id: string): Promise<ApproveSignupResponse>
  rejectSignup(id: string, reason: string): Promise<void>
}

export const qk = {
  signupRequests: ['signup-requests'] as const,
}

const LATENCY_MS = 260
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS))
}

const MOCK_SIGNUPS: SignupRequestListItem[] = [
  {
    id: 'sr-001',
    schoolName: 'Collège Saint-Joseph',
    contactName: 'Pierre Atangana',
    role: 'Directeur',
    email: 'patangana@stjoseph.cm',
    phone: '+237699001122',
    studentCount: 450,
    country: 'CM',
    status: 'pending',
    emailVerified: false,
    phoneVerified: false,
    setupToken: null,
    setupUrl: null,
    tempIdentifier: null,
    createdAt: '2026-08-22T14:30:00.000Z',
    completedAt: null,
    expiresAt: '2026-08-23T14:30:00.000Z',
  },
  {
    id: 'sr-002',
    schoolName: 'Lycée Moderne de Cocody',
    contactName: 'Aminata Koné',
    role: 'Fondatrice',
    email: 'akone@lycecocody.ci',
    phone: '+2250700334455',
    studentCount: 820,
    country: 'CI',
    status: 'pending',
    emailVerified: false,
    phoneVerified: false,
    setupToken: null,
    setupUrl: null,
    tempIdentifier: null,
    createdAt: '2026-08-21T09:15:00.000Z',
    completedAt: null,
    expiresAt: '2026-08-22T09:15:00.000Z',
  },
  {
    id: 'sr-003',
    schoolName: 'Institut Samba Diallo',
    contactName: 'Ousmane Diallo',
    role: 'Directeur administratif',
    email: 'odiallo@samba.sn',
    phone: '+221770112233',
    studentCount: 310,
    country: 'SN',
    status: 'approved',
    emailVerified: false,
    phoneVerified: false,
    setupToken: 'tok-samba-abc123',
    setupUrl: 'http://localhost:3040/setup/tok-samba-abc123',
    tempIdentifier: 'FIN-2026-0003',
    createdAt: '2026-08-20T16:45:00.000Z',
    completedAt: null,
    expiresAt: '2026-08-21T16:45:00.000Z',
  },
  {
    id: 'sr-004',
    schoolName: 'École Bilingue Excellence',
    contactName: 'Directeur Fondateur',
    role: 'Directeur',
    email: 'directeur@excellence.test',
    phone: '+237677000001',
    studentCount: 121,
    country: 'CM',
    status: 'setup_complete',
    emailVerified: true,
    phoneVerified: true,
    setupToken: null,
    setupUrl: null,
    tempIdentifier: 'FIN-2026-0001',
    createdAt: '2026-08-15T08:00:00.000Z',
    completedAt: '2026-08-15T08:25:00.000Z',
    expiresAt: '2026-08-16T08:00:00.000Z',
  },
  {
    id: 'sr-005',
    schoolName: 'Groupe Scolaire La Réussite',
    contactName: 'Jean-Paul Mvondo',
    role: 'Économe',
    email: 'jpmvondo@lareussite.cm',
    phone: '+237655998877',
    studentCount: 200,
    country: 'CM',
    status: 'expired',
    emailVerified: false,
    phoneVerified: false,
    setupToken: null,
    setupUrl: null,
    tempIdentifier: null,
    createdAt: '2026-08-10T11:00:00.000Z',
    completedAt: null,
    expiresAt: '2026-08-11T11:00:00.000Z',
  },
  {
    id: 'sr-006',
    schoolName: 'Complexe Scolaire Lumière',
    contactName: 'Berthe Nkeng',
    role: 'Directrice',
    email: 'bnkeng@lumiere.cm',
    phone: '+237677554433',
    studentCount: 580,
    country: 'CM',
    status: 'rejected',
    emailVerified: false,
    phoneVerified: false,
    setupToken: null,
    setupUrl: null,
    tempIdentifier: null,
    createdAt: '2026-08-18T10:00:00.000Z',
    completedAt: null,
    expiresAt: '2026-08-19T10:00:00.000Z',
  },
]

class MockAdminApi implements AdminApi {
  private signups: SignupRequestListItem[] = [...MOCK_SIGNUPS]
  private counter = 6

  listSignupRequests(): Promise<SignupRequestListItem[]> {
    return delay(this.signups)
  }

  approveSignup(id: string): Promise<ApproveSignupResponse> {
    this.counter += 1
    const tempId = `FIN-2026-${String(this.counter).padStart(4, '0')}`
    const token = `tok-${id}-${Date.now().toString(36)}`
    const setupUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3040'}/setup/${token}`

    this.signups = this.signups.map((r) =>
      r.id === id ? { ...r, status: 'approved' as const, setupToken: token, setupUrl, tempIdentifier: tempId } : r,
    )

    return delay({ setupToken: token, setupUrl, tempIdentifier: tempId })
  }

  rejectSignup(id: string, _reason: string): Promise<void> {
    this.signups = this.signups.map((r) =>
      r.id === id ? { ...r, status: 'rejected' as const } : r,
    )
    return delay(undefined)
  }
}

let instance: AdminApi | null = null

export function getApi(): AdminApi {
  if (!instance) instance = new MockAdminApi()
  return instance
}
