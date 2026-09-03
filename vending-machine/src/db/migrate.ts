import { db, closeDb } from './client.js';
import { logger } from '../lib/log.js';

const log = logger('migrate');
db();
log.info('schema applied');
closeDb();
