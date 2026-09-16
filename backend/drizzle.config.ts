import type { Config } from 'drizzle-kit';

// NOTE: schema glob is incomplete — 21 split schema-*.ts files are not wired here.
// Run `npm run db:generate:guard` before generate; prefer hand-written SQL migrations
// until schema is set to './src/db/schema*.ts' (see B8 / DATA-7).
export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
} satisfies Config;
