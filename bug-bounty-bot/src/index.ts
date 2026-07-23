import 'dotenv/config';

/**
 * Ponto de entrada do Bug Bounty Bot.
 *
 * Nesta etapa apenas a base estrutural do projeto foi construída.
 * A lógica de varredura (busca de secret leaks via API do GitHub) e o
 * envio de alertas via Telegram serão implementados nas próximas etapas
 * dentro de `src/services`.
 */
function bootstrap(): void {
  console.log('[bug-bounty-bot] Base estrutural inicializada. Aguardando implementação dos serviços.');
}

bootstrap();
