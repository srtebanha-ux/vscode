const STOP = new Set(['de', 'da', 'do', 'para', 'com', 'the', 'a', 'o', 'e', 'em', 'no', 'na']);

export function slugify(input: string, maxWords = 8): string {
  const words = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 0 && !STOP.has(w));
  const kept = words.length > maxWords ? words.slice(0, maxWords) : words;
  const slug = kept.join('-').replace(/^-+|-+$/g, '');
  return slug || `item-${Date.now().toString(36)}`;
}

export async function uniqueSlug(base: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(base))) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
