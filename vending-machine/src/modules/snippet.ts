import type { ProductAsset, Snippet, SnippetCode, SnippetTable, Token, TokenType } from '../types.js';

const TABLE_ROWS = 12;
const CODE_LINES = 24;
const TREE_ENTRIES = 14;
const TEXT_LINES = 14;
const CELL_MAX = 48;
const LINE_MAX = 160;

const LANGUAGE_BY_MIME: Record<string, string> = {
  'text/x-python': 'python',
  'application/javascript': 'javascript',
  'application/x-sh': 'shell',
};

const KEYWORDS: Record<string, ReadonlySet<string>> = {
  python: new Set(['def', 'class', 'return', 'import', 'from', 'as', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'pass', 'break', 'continue', 'True', 'False', 'None', 'self', 'async', 'await', 'global']),
  javascript: new Set(['const', 'let', 'var', 'function', 'return', 'import', 'export', 'from', 'default', 'if', 'else', 'for', 'while', 'of', 'in', 'new', 'class', 'extends', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'async', 'await', 'yield', 'true', 'false', 'null', 'undefined', 'this']),
  shell: new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'local', 'export', 'return', 'echo', 'set', 'trap', 'exit', 'source']),
};

const COMMENT_PREFIX: Record<string, string> = { python: '#', javascript: '//', shell: '#' };
const BLOCK_DELIMS: Record<string, readonly string[]> = { python: ['"""', "'''"], javascript: [], shell: [] };

const IDENT = /^[A-Za-z_$][\w$]*/;
const NUMBER = /^\d+(?:\.\d+)?/;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = headerLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Parser RFC4180 (aspas duplas escapadas por duplicação) com delimitador detectado. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let dirty = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      dirty = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      dirty = true;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      dirty = false;
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
    dirty = true;
  }
  if (dirty || field.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.trim().length > 0));
}

function buildTable(text: string): SnippetTable {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const parsed = parseCsv(text, delimiter);
  const [head, ...body] = parsed;
  const headers = (head ?? []).map((cell) => clip(cell.trim(), CELL_MAX));
  return {
    kind: 'table',
    delimiter,
    headers,
    rows: body.slice(0, TABLE_ROWS).map((row) =>
      Array.from({ length: headers.length }, (_, i) => clip((row[i] ?? '').trim(), CELL_MAX)),
    ),
    totalRows: body.length,
    truncated: body.length > TABLE_ROWS,
  };
}

function pushToken(line: Token[], type: TokenType, value: string): void {
  const last = line[line.length - 1];
  if (last && last.t === type) last.v += value;
  else line.push({ t: type, v: value });
}

interface ScanState {
  block: string | null;
}

function tokenizeLine(raw: string, language: string, state: ScanState): Token[] {
  const line = clip(raw, LINE_MAX);
  const tokens: Token[] = [];
  const keywords = KEYWORDS[language] ?? new Set<string>();
  const comment = COMMENT_PREFIX[language] ?? '#';
  const blocks = BLOCK_DELIMS[language] ?? [];
  let i = 0;

  while (i < line.length) {
    if (state.block) {
      const end = line.indexOf(state.block, i);
      if (end === -1) {
        pushToken(tokens, 'str', line.slice(i));
        return tokens;
      }
      pushToken(tokens, 'str', line.slice(i, end + state.block.length));
      i = end + state.block.length;
      state.block = null;
      continue;
    }

    const openBlock = blocks.find((delim) => line.startsWith(delim, i));
    if (openBlock) {
      const end = line.indexOf(openBlock, i + openBlock.length);
      if (end === -1) {
        state.block = openBlock;
        pushToken(tokens, 'str', line.slice(i));
        return tokens;
      }
      pushToken(tokens, 'str', line.slice(i, end + openBlock.length));
      i = end + openBlock.length;
      continue;
    }

    if (line.startsWith(comment, i)) {
      pushToken(tokens, 'com', line.slice(i));
      return tokens;
    }

    const ch = line[i] as string;

    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') j += 2;
        else if (line[j] === ch) break;
        else j += 1;
      }
      pushToken(tokens, 'str', line.slice(i, Math.min(j + 1, line.length)));
      i = Math.min(j + 1, line.length);
      continue;
    }

    if (/\s/.test(ch)) {
      pushToken(tokens, 'txt', ch);
      i += 1;
      continue;
    }

    const number = NUMBER.exec(line.slice(i));
    if (number && /\d/.test(ch)) {
      pushToken(tokens, 'num', number[0]);
      i += number[0].length;
      continue;
    }

    const ident = IDENT.exec(line.slice(i));
    if (ident) {
      const word = ident[0];
      const rest = line.slice(i + word.length);
      const type: TokenType = keywords.has(word) ? 'kw' : /^\s*\(/.test(rest) ? 'fn' : 'txt';
      pushToken(tokens, type, word);
      i += word.length;
      continue;
    }

    pushToken(tokens, 'op', ch);
    i += 1;
  }

  return tokens;
}

const SYMBOL_PATTERNS: Record<string, RegExp[]> = {
  python: [/^\s*def\s+([A-Za-z_]\w*\s*\([^)]*\))/, /^\s*class\s+([A-Za-z_]\w*)/],
  javascript: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*\s*\([^)]*\))/,
    /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  ],
  shell: [/^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/],
};

function extractSymbols(lines: string[], language: string): string[] {
  const patterns = SYMBOL_PATTERNS[language] ?? [];
  const found: string[] = [];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match?.[1]) found.push(clip(match[1].replace(/\s+/g, ' ').trim(), 90));
    }
  }
  return [...new Set(found)].slice(0, 12);
}

function buildCode(text: string, language: string): SnippetCode {
  const all = text.split(/\r?\n/);
  const visible = all.slice(0, CODE_LINES);
  const state: ScanState = { block: null };
  return {
    kind: 'code',
    language,
    lines: visible.map((line) => tokenizeLine(line, language, state)),
    symbols: extractSymbols(all, language),
    totalLines: all.length,
    truncated: all.length > CODE_LINES,
  };
}

function describe(value: unknown): { type: string; sample: string } {
  if (Array.isArray(value)) return { type: `array[${value.length}]`, sample: clip(JSON.stringify(value.slice(0, 2)), CELL_MAX) };
  if (value === null) return { type: 'null', sample: 'null' };
  if (typeof value === 'object') return { type: `object[${Object.keys(value as object).length}]`, sample: clip(Object.keys(value as object).join(', '), CELL_MAX) };
  return { type: typeof value, sample: clip(String(value), CELL_MAX) };
}

function buildTree(text: string): Snippet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return buildText(text);
  }
  const entries: Array<{ path: string; type: string; sample: string }> = [];

  const walk = (node: unknown, path: string, depth: number): void => {
    if (entries.length >= TREE_ENTRIES || depth > 2) return;
    if (Array.isArray(node)) {
      entries.push({ path, ...describe(node) });
      if (node[0] !== undefined) walk(node[0], `${path}[0]`, depth + 1);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (entries.length >= TREE_ENTRIES) return;
        const child = path ? `${path}.${key}` : key;
        entries.push({ path: child, ...describe(value) });
        if (value && typeof value === 'object') walk(value, child, depth + 1);
      }
      return;
    }
    entries.push({ path: path || '$', ...describe(node) });
  };

  walk(parsed, '', 0);
  return { kind: 'tree', entries, truncated: entries.length >= TREE_ENTRIES };
}

function buildText(text: string): Snippet {
  const all = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return {
    kind: 'text',
    lines: all.slice(0, TEXT_LINES).map((line) => clip(line, LINE_MAX)),
    headings: all.filter((line) => /^#{1,3}\s+\S/.test(line)).map((line) => clip(line.replace(/^#+\s*/, ''), 90)).slice(0, 10),
    truncated: all.length > TEXT_LINES,
  };
}

/** Estrutura serializável renderizada server-side: zero JS de highlight no cliente. */
export function renderSnippet(asset: ProductAsset): Snippet {
  const text = Buffer.from(asset.base64, 'base64').toString('utf8');
  if (asset.mime === 'text/csv') return buildTable(text);
  if (asset.mime === 'application/json') return buildTree(text);
  const language = LANGUAGE_BY_MIME[asset.mime];
  if (language) return buildCode(text, language);
  return buildText(text);
}

/** Fatos verificáveis extraídos do artefato real — aterram o prompt dos casos de uso. */
export function groundingFacts(snippet: Snippet): string[] {
  switch (snippet.kind) {
    case 'table':
      return snippet.headers.filter((header) => header.length > 0);
    case 'code':
      return snippet.symbols;
    case 'tree':
      return snippet.entries.map((entry) => entry.path).slice(0, 12);
    case 'text':
      return snippet.headings;
  }
}
