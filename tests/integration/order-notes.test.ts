import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { orderNotes, users } from '@/db/schema';
import { addOrderNote, listOrderNotes, OrderNoteError } from '@/domain/order-notes';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';
import { createAdminUser, createOrder } from '../helpers/factories';

/**
 * Notas internas del pedido (O5, plan-operacion §5.1 C).
 *
 * Lo que fijan estos tests es la disciplina de la tabla, que es append-only:
 * una fila que no debería haberse escrito no se puede borrar después.
 */

describe.skipIf(!hasTestDb)('notas del pedido', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('guarda la nota con su actor y la devuelve', async () => {
    const orderId = await createOrder();
    const userId = await createAdminUser({ email: 'ana@tienda.py' });
    await getTestDb().update(users).set({ name: 'Ana' }).where(eq(users.id, userId));

    await addOrderNote({
      orderId,
      body: '  Llamó, pasa a retirar el jueves  ',
      actor: 'admin:ana@tienda.py',
      actorUserId: userId,
    });

    const notas = await listOrderNotes(orderId);
    expect(notas).toHaveLength(1);
    // Trimmed al guardar, no al mostrar: lo que queda en la base es lo limpio.
    expect(notas[0]?.body).toBe('Llamó, pasa a retirar el jueves');
    expect(notas[0]?.actor).toBe('admin:ana@tienda.py');
    expect(notas[0]?.actorUserId).toBe(userId);
    // El nombre de hoy arriba, el string histórico abajo (misma regla que el
    // feed de actividad).
    expect(notas[0]?.actorName).toBe('Ana');
  });

  it('las devuelve de la más vieja a la más nueva', async () => {
    const orderId = await createOrder();
    const userId = await createAdminUser({ email: 'beto@tienda.py' });

    for (const body of ['llamó', 'no atendió', 'pasa el jueves']) {
      await addOrderNote({ orderId, body, actor: 'admin:beto@tienda.py', actorUserId: userId });
    }

    // Ascendente y no descendente como el resto del panel: esto se lee como
    // una conversación y al revés no se entiende.
    expect((await listOrderNotes(orderId)).map((nota) => nota.body)).toEqual([
      'llamó',
      'no atendió',
      'pasa el jueves',
    ]);
  });

  it('sólo trae las notas de ese pedido', async () => {
    const uno = await createOrder();
    const otro = await createOrder();
    const userId = await createAdminUser({ email: 'ana@tienda.py' });

    await addOrderNote({ orderId: uno, body: 'la del primero', actor: 'a', actorUserId: userId });
    await addOrderNote({ orderId: otro, body: 'la del segundo', actor: 'a', actorUserId: userId });

    expect((await listOrderNotes(uno)).map((nota) => nota.body)).toEqual(['la del primero']);
  });

  it('rechaza una nota de 1001 caracteres', async () => {
    const orderId = await createOrder();
    const userId = await createAdminUser({ email: 'ana@tienda.py' });

    // 1000 entra —es el largo exacto de la columna— y 1001 no. El borde va
    // testeado por los dos lados: un `>=` de más acá recortaría notas
    // legítimas y nadie se enteraría.
    await expect(
      addOrderNote({ orderId, body: 'x'.repeat(1000), actor: 'a', actorUserId: userId }),
    ).resolves.toBeGreaterThan(0);

    await expect(
      addOrderNote({ orderId, body: 'x'.repeat(1001), actor: 'a', actorUserId: userId }),
    ).rejects.toBeInstanceOf(OrderNoteError);

    expect(await listOrderNotes(orderId)).toHaveLength(1);
  });

  it('rechaza una nota de puros espacios', async () => {
    const orderId = await createOrder();
    const userId = await createAdminUser({ email: 'ana@tienda.py' });

    await expect(
      addOrderNote({ orderId, body: '   \n  ', actor: 'a', actorUserId: userId }),
    ).rejects.toBeInstanceOf(OrderNoteError);

    expect(await listOrderNotes(orderId)).toHaveLength(0);
  });

  it('rechaza una nota sobre un pedido que no existe', async () => {
    const userId = await createAdminUser({ email: 'ana@tienda.py' });

    await expect(
      addOrderNote({ orderId: 999_999, body: 'fantasma', actor: 'a', actorUserId: userId }),
    ).rejects.toBeInstanceOf(OrderNoteError);
  });

  it('rechaza la nota de un usuario desactivado', async () => {
    const orderId = await createOrder();
    const userId = await createAdminUser({ email: 'exempleado@tienda.py' });

    // La cookie firmada sigue siendo válida hasta que expira: a quien le
    // cortaron el acceso hace un minuto todavía le anda la sesión en el
    // navegador. La relectura del dominio es lo único que frena su próxima
    // escritura, y por eso se testea acá y no sólo en el guard.
    await getTestDb().update(users).set({ isActive: false }).where(eq(users.id, userId));

    await expect(
      addOrderNote({ orderId, body: 'todavía puedo', actor: 'a', actorUserId: userId }),
    ).rejects.toBeInstanceOf(OrderNoteError);

    expect(await listOrderNotes(orderId)).toHaveLength(0);
  });

  it('borrar el pedido se lleva sus notas', async () => {
    const orderId = await createOrder();
    const userId = await createAdminUser({ email: 'ana@tienda.py' });
    await addOrderNote({ orderId, body: 'algo', actor: 'a', actorUserId: userId });

    // SQL crudo a propósito: lo que se verifica es el `ON DELETE CASCADE` de
    // la FK, no lo que haga el ORM al borrar.
    await getTestDb().execute(sql`DELETE FROM \`orders\` WHERE \`id\` = ${orderId}`);

    const quedan = await getTestDb()
      .select({ id: orderNotes.id })
      .from(orderNotes)
      .where(eq(orderNotes.orderId, orderId));
    expect(quedan).toHaveLength(0);
  });
});
