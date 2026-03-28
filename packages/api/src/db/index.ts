import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString =
  process.env['DATABASE_URL'] ?? 'postgresql://clawscale:clawscale@localhost:5432/clawscale';

const queryClient = postgres(connectionString);

export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
