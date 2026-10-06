import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { users } from '@/db/schema';
import { authenticate, createUser } from '@/lib/auth';
import { ForbiddenError, requireAdmin, requireOwner, requireStaff } from '@/lib/session';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';

describe.skipIf(!hasTestDb)('auth', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('crea el dueño y lo autentica', async () => {
    const created = await createUser({
      email: 'Due@Tienda.PY',
      password: 'tienda2026segura',
      role: 'owner',
      name: 'La Dueña',
    });
    expect(created.email).toBe('due@tienda.py'); // normalizado

    const user = await authenticate('due@tienda.py', 'tienda2026segura');
    expect(user).toMatchObject({ email: 'due@tienda.py', role: 'owner' });

    const session = { userId: user!.id, email: user!.email, role: user!.role };
    expect(requireOwner(session).role).toBe('owner');
  });

  it('el email es case-insensitive al entrar', async () => {
    await createUser({ email: 'staff@tienda.py', password: 'tienda2026segura', role: 'staff' });
    expect(await authenticate('STAFF@TIENDA.PY', 'tienda2026segura')).not.toBeNull();
  });

  it('contraseña incorrecta y usuario inexistente devuelven null (sin distinguirse)', async () => {
    await createUser({ email: 'staff@tienda.py', password: 'tienda2026segura', role: 'staff' });
    expect(await authenticate('staff@tienda.py', 'otra-cosa')).toBeNull();
    expect(await authenticate('nadie@tienda.py', 'tienda2026segura')).toBeNull();
  });

  it('un staff no pasa el guard de dueño pero sí el de admin', async () => {
    await createUser({ email: 'staff@tienda.py', password: 'tienda2026segura', role: 'staff' });
    const user = await authenticate('staff@tienda.py', 'tienda2026segura');
    const session = { userId: user!.id, email: user!.email, role: user!.role };

    expect(requireAdmin(session).role).toBe('staff');
    expect(() => requireOwner(session)).toThrow();
  });

  it('la contraseña nunca se guarda en claro', async () => {
    const { id } = await createUser({ email: 'x@tienda.py', password: 'tienda2026segura', role: 'staff' });
    const { getTestDb } = await import('../helpers/db');
    const { users } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const row = (await getTestDb().select().from(users).where(eq(users.id, id)))[0];
    expect(row?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row?.passwordHash).not.toContain('tienda2026segura');
  });
});

/**
 * `users.last_login_at` (PR B.1): la columna que le dice al dueño si la
 * cuenta que creó sigue en uso antes de decidir si la desactiva (PR C).
 */
describe.skipIf(!hasTestDb)('last_login_at', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('arranca en NULL: creada no es lo mismo que usada', async () => {
    await createUser({ email: 'nuevo@tienda.py', password: 'tienda2026segura', role: 'staff' });

    const [row] = await getTestDb()
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.email, 'nuevo@tienda.py'));

    expect(row?.lastLoginAt).toBeNull();
  });

  it('un login exitoso la escribe', async () => {
    await createUser({ email: 'staff@tienda.py', password: 'tienda2026segura', role: 'staff' });
    expect(await authenticate('staff@tienda.py', 'tienda2026segura')).not.toBeNull();

    const [row] = await getTestDb()
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.email, 'staff@tienda.py'));

    expect(row?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('un intento fallido no la toca: no es una entrada', async () => {
    await createUser({ email: 'staff@tienda.py', password: 'tienda2026segura', role: 'staff' });
    expect(await authenticate('staff@tienda.py', 'la-que-no-es')).toBeNull();

    const [row] = await getTestDb()
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.email, 'staff@tienda.py'));

    expect(row?.lastLoginAt).toBeNull();
  });

  it('un usuario desactivado no entra, y la marca queda como estaba', async () => {
    await createUser({ email: 'baja@tienda.py', password: 'tienda2026segura', role: 'staff' });
    await getTestDb()
      .update(users)
      .set({ isActive: false })
      .where(eq(users.email, 'baja@tienda.py'));

    expect(await authenticate('baja@tienda.py', 'tienda2026segura')).toBeNull();

    const [row] = await getTestDb()
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.email, 'baja@tienda.py'));

    expect(row?.lastLoginAt).toBeNull();
  });
});

/**
 * El rol nuevo del PR B, de punta a punta contra MySQL: el ENUM lo acepta y
 * los guards lo tratan como corresponde.
 */
describe.skipIf(!hasTestDb)('el rol vendedor', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('se crea, entra al panel, y no pasa los guards de plata', async () => {
    await createUser({
      email: 'mostrador@tienda.py',
      password: 'tienda2026segura',
      role: 'vendedor',
    });

    const user = await authenticate('mostrador@tienda.py', 'tienda2026segura');
    expect(user).toMatchObject({ role: 'vendedor' });

    const session = { userId: user!.id, email: user!.email, role: user!.role };
    expect(requireAdmin(session).role).toBe('vendedor');
    expect(() => requireStaff(session)).toThrow(ForbiddenError);
    expect(() => requireOwner(session)).toThrow(ForbiddenError);
  });
});
