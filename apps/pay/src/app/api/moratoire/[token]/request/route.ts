import { NextResponse } from 'next/server'

/**
 * A thin proxy from the browser to the API.
 *
 * The browser posts here rather than straight at the API for two reasons:
 * the API origin never has to be public or CORS-open to every visitor, and
 * the token stays on a same-origin request, so it does not appear in a
 * cross-origin `Referer` or a preflight a middlebox might log.
 *
 * It adds nothing and decides nothing — the API is the authority on whether
 * a moratoire is granted. Status and body are passed straight through so the
 * chat sees exactly what the API said, including its 404s.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params
  const base = process.env['API_URL'] ?? 'http://localhost:3010'

  try {
    const upstream = await fetch(`${base}/moratoire/${encodeURIComponent(token)}/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: await request.text(),
      cache: 'no-store',
    })
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    })
  } catch {
    return NextResponse.json({ title: 'Upstream unavailable', status: 502 }, { status: 502 })
  }
}
