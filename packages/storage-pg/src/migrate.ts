import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  await client.query(`
    create table if not exists _orbit_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const dir = path.join(process.cwd(), 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const id = file;
    const applied = await client.query('select 1 from _orbit_migrations where id=$1', [id]);
    if (applied.rowCount) continue;

    const sql = await readFile(path.join(dir, file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into _orbit_migrations(id) values ($1)', [id]);
      await client.query('commit');
      // eslint-disable-next-line no-console
      console.log(`[migrate] applied ${file}`);
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  }

  await client.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
