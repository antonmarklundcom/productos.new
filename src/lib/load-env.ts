import { config } from 'dotenv';

/**
 * `tsx` no carga `.env` solo. Todo script tiene que importar este módulo
 * PRIMERO, antes de tocar `process.env` o de importar el pool.
 *
 * Precedencia (de mayor a menor): lo que ya venga en `process.env` →
 * `.env.local` (secretos reales, ignorado por git) → `.env`.
 *
 * Nada pisa a `process.env`: si alguien corre
 * `DATABASE_URL=... pnpm db:seed`, esa variable manda. Por eso ambas cargas
 * van sin `override` y `.env.local` primero.
 */
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });
