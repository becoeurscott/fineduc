import { notFound } from 'next/navigation'
import type { MoratoriumChatView } from '@fineduc/contracts'
import { MoratoireChat } from './chat'

/**
 * `/moratoire/<token>` — the guided chat a parent reaches from a reminder.
 *
 * A Server Component fetches, so the token never has to survive a round trip
 * through client JavaScript and the page has something to show on a phone
 * that gives up on JS entirely. The conversation itself is a small client
 * component.
 *
 * Any failure is a 404, matching the API: a parent with a broken link and
 * someone probing get the same answer.
 */
export const dynamic = 'force-dynamic'

async function fetchView(token: string): Promise<MoratoriumChatView | null> {
  const base = process.env['API_URL'] ?? 'http://localhost:3010'
  try {
    const response = await fetch(`${base}/moratoire/${encodeURIComponent(token)}`, { cache: 'no-store' })
    if (!response.ok) return null
    return (await response.json()) as MoratoriumChatView
  } catch {
    return null
  }
}

export default async function MoratoirePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const view = await fetchView(token)
  if (!view) notFound()

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col gap-4 px-4 py-6">
      <MoratoireChat token={token} view={view} />
    </main>
  )
}
