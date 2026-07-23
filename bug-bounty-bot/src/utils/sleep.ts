/**
 * Pausa a execução assíncrona pelo número de milissegundos informado.
 *
 * @param ms Tempo de espera em milissegundos. Valores <= 0 resolvem imediatamente.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
