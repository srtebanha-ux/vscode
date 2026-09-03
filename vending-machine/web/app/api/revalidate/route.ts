import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || params.get('secret') !== secret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const slug = params.get('slug');
  revalidatePath('/');
  revalidatePath('/sitemap.xml');
  if (slug) revalidatePath(`/p/${slug}`);
  return NextResponse.json({ revalidated: true, slug });
}
