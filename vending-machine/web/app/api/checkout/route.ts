import { NextResponse } from 'next/server';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

export async function POST(request: Request): Promise<NextResponse> {
  const slug = new URL(request.url).searchParams.get('slug');
  if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  }

  try {
    const res = await fetch(`${API}/checkout/${slug}`, { method: 'POST', cache: 'no-store' });
    const body = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'checkout upstream unavailable' }, { status: 502 });
  }
}
