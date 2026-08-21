import { NextResponse } from 'next/server'

/**
 * Same-origin proxy for the LLM delay parser. Same pattern as the request
 * proxy — the API origin never has to be public, and the token stays off
 * cross-origin headers.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params
  const base = process.env['API_URL'] ?? 'http://localhost:3010'

  try {
    const upstream = await fetch(`${base}/moratoire/${encodeURIComponent(token)}/parse`, {
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
