'use client';

import { useState } from 'react';

export function BuyButton({ slug, label }: { slug: string; label: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  async function checkout(): Promise<void> {
    setState('loading');
    try {
      const res = await fetch(`/api/checkout?slug=${encodeURIComponent(slug)}`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { url?: string };
      if (!body.url) throw new Error('missing url');
      window.location.href = body.url;
    } catch {
      setState('error');
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={checkout}
        disabled={state === 'loading'}
        className="w-full rounded-lg bg-accent px-6 py-3 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {state === 'loading' ? 'Abrindo checkout…' : label}
      </button>
      {state === 'error' && <p className="mt-2 text-sm text-red-600">Falha ao abrir o checkout. Tente novamente.</p>}
    </div>
  );
}
