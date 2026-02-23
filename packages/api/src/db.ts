import pg from 'pg';
import { loadEnv } from './env.js';

const env = loadEnv();

export const pool = env.DATABASE_URL
  ? new pg.Pool({ connectionString: env.DATABASE_URL })
  : null;
