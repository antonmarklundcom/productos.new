import { and, asc, eq } from 'drizzle-orm';

import { getDb } from '@/db';
import { orderNotes, orders, users } from '@/db/schema';
import { DomainError } from '@/domain/errors';
import type { MessageKey, Params } from '@/i18n';

import type { Executor } from './executor';

/**
 * Notas internas del pedido (plan-operacion §5.1).
 *
 * Lo que el mostrador necesita anotar y que no es un cambio de estado:
 * "llamó, pasa a retirar el jueves", "el timbre no anda". Hoy eso vive en el
 * grupo de WhatsApp del local y se pierde; acá queda pegado al pedido, con
 * quién la escribió y cuándo.
 *
 * **Nunca las ve la compradora.** No hay ninguna lectura de esta tabla fuera
 * de `/admin`, y no la puede haber: la nota está escrita para adentro, con el
 * tono de adentro.
 *
 * Por qué tabla propia y no un `order_events` sin transición: está explicado
 * en el comentario de `order_notes` en `src/db/schema.ts`. En resumen, una
 * nota no es un movimiento del pedido y mezclarlas obliga a que todo lo que
 * lee la historia de estados aprenda a ignorar filas que no lo son.
 */

export class OrderNoteError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = 'OrderNoteError';
  }
}

/** Los límites de `order_notes.body`, en un solo lugar. */
export const ORDER_NOTE_MAX_LENGTH = 1000;

export type AddOrderNoteInput = {
  orderId: number;
  body: string;
  /** `admin:ana@tienda.py` — la verdad histórica, igual que en `order_events`. */
  actor: string;
  /** La FK consultable. NULL sólo si no la escribió una persona del panel. */
  actorUserId?: number | null;
};

export type OrderNoteRow = {
  id: number;
  orderId: number;
  body: string;
  actor: string;
  actorUserId: number | null;
  /** El nombre de hoy de quien la escribió, o null si no fue una persona. */
  actorName: string | null;
  createdAt: Date;
};

/**
 * Escribe una nota. Devuelve el id de la fila.
 *
 * Las tres validaciones y por qué están las tres:
 *
 * 1. **Texto 1..1000, trimmed.** El `.trim()` corre antes del `.min(1)`: una
 *    nota de puros espacios no se guarda. La tabla es append-only, así que
 *    una fila vacía queda para siempre.
 * 2. **El pedido tiene que existir.** La FK ya lo garantizaría, pero un error
 *    de FK de MySQL sale como "algo salió mal" genérico; acá sale como el
 *    mensaje que el dueño puede entender.
 * 3. **El usuario tiene que estar activo.** El guard de la acción ya lo
 *    verifica contra la cookie, y el dominio lo re-lee igual — misma regla
 *    que `admin-users`. La cookie firmada sigue siendo válida hasta que
 *    expira: alguien a quien le cortaron el acceso hace un minuto todavía
 *    tiene una sesión buena en el navegador, y esta relectura es lo único
 *    que hace que su próxima escritura no entre.
 */
export async function addOrderNote(
  input: AddOrderNoteInput,
  options: { executor?: Executor } = {},
): Promise<number> {
  const body = input.body.trim();
  if (body.length === 0) throw new OrderNoteError('error.nota.vacia');
  if (body.length > ORDER_NOTE_MAX_LENGTH) {
    throw new OrderNoteError('error.nota.larga', { maximo: ORDER_NOTE_MAX_LENGTH });
  }

  const tx = options.executor ?? getDb();

  const pedido = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (pedido.length === 0) throw new OrderNoteError('error.nota.pedidoNoExiste');

  if (input.actorUserId != null) {
    const activo = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.actorUserId), eq(users.isActive, true)))
      .limit(1);
    if (activo.length === 0) throw new OrderNoteError('error.nota.usuarioInactivo');
  }

  const [result] = await tx.insert(orderNotes).values({
    orderId: input.orderId,
    body,
    actor: input.actor,
    actorUserId: input.actorUserId ?? null,
  });

  return Number(result.insertId);
}

/**
 * Las notas de un pedido, de la más vieja a la más nueva.
 *
 * Ascendente y no descendente como el resto de los listados del panel: esto
 * se lee como una conversación —"llamó" / "no atendió" / "pasa el jueves"—, y
 * al revés no se entiende. El desempate por `id` importa por lo mismo que en
 * el feed de actividad: dos notas del mismo segundo tienen que salir siempre
 * en el mismo orden.
 *
 * El `LEFT JOIN` a `users` sigue el criterio de `/admin/actividad`: se
 * muestra el nombre de hoy, y el `actor` de texto queda como la verdad
 * histórica de lo que había en ese momento.
 */
export async function listOrderNotes(
  orderId: number,
  executor?: Executor,
): Promise<OrderNoteRow[]> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select({
      id: orderNotes.id,
      orderId: orderNotes.orderId,
      body: orderNotes.body,
      actor: orderNotes.actor,
      actorUserId: orderNotes.actorUserId,
      actorName: users.name,
      actorEmail: users.email,
      createdAt: orderNotes.createdAt,
    })
    .from(orderNotes)
    .leftJoin(users, eq(orderNotes.actorUserId, users.id))
    .where(eq(orderNotes.orderId, orderId))
    .orderBy(asc(orderNotes.createdAt), asc(orderNotes.id));

  return rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    body: row.body,
    actor: row.actor,
    actorUserId: row.actorUserId,
    actorName: row.actorName?.trim() || row.actorEmail || null,
    createdAt: row.createdAt,
  }));
}
