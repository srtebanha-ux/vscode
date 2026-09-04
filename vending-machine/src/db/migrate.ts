import { closeDb, databaseUrl, migrate } from './client.js';
import { errMeta, logger } from '../lib/log.js';

const log = logger('migrate');

migrate()
  .then(() => {
    log.info('schema applied', { target: databaseUrl().replace(/\?.*$/, '') });
    closeDb();
  })
  .catch((error: unknown) => {
    log.error('migration failed', errMeta(error));
    process.exit(1);
  });
