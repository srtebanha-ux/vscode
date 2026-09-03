import type { Snippet, TokenType } from '@/lib/catalog';

const TOKEN_CLASS: Record<TokenType, string> = {
  kw: 'text-violet-600 dark:text-violet-400',
  str: 'text-emerald-700 dark:text-emerald-400',
  num: 'text-amber-700 dark:text-amber-400',
  com: 'text-slate-400 italic',
  fn: 'text-sky-700 dark:text-sky-400',
  op: 'text-slate-500',
  txt: '',
};

const shell = 'overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 text-xs dark:border-slate-800 dark:bg-slate-900';

/** Renderizado no servidor a partir de tokens pré-computados: nenhum KB de highlighter no cliente. */
export function SnippetView({ snippet, filename }: { snippet: Snippet; filename: string }) {
  if (snippet.kind === 'table') {
    return (
      <figure>
        <div className={shell}>
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Estrutura de {filename}</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                {snippet.headers.map((header) => (
                  <th key={header} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snippet.rows.map((row, index) => (
                <tr key={index} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600 dark:text-slate-400">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <figcaption className="mt-2 text-xs text-slate-500">
          {snippet.headers.length} colunas · {snippet.totalRows} linhas{snippet.truncated ? ` (${snippet.rows.length} exibidas)` : ''}
        </figcaption>
      </figure>
    );
  }

  if (snippet.kind === 'code') {
    return (
      <figure>
        <pre className={`${shell} p-4 leading-relaxed`}>
          <code>
            {snippet.lines.map((line, index) => (
              <span key={index} className="block">
                {line.length === 0 ? ' ' : line.map((token, tokenIndex) => (
                  <span key={tokenIndex} className={TOKEN_CLASS[token.t]}>{token.v}</span>
                ))}
              </span>
            ))}
          </code>
        </pre>
        <figcaption className="mt-2 text-xs text-slate-500">
          {snippet.language} · {snippet.totalLines} linhas{snippet.truncated ? ` (${snippet.lines.length} exibidas)` : ''}
          {snippet.symbols.length > 0 && ` · ${snippet.symbols.length} funções`}
        </figcaption>
      </figure>
    );
  }

  if (snippet.kind === 'tree') {
    return (
      <div className={shell}>
        <dl className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {snippet.entries.map((entry) => (
            <div key={entry.path} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2">
              <dt className="truncate font-mono">{entry.path}</dt>
              <dd className="text-slate-500">{entry.type}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <pre className={`${shell} whitespace-pre-wrap p-4 leading-relaxed`}>{snippet.lines.join('\n')}</pre>
  );
}
