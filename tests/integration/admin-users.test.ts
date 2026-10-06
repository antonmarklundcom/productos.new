import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { users } from '@/db/schema';
import {
  AdminUserError,
  createAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  setAdminUserActive,
  setAdminUserRole,
} from '@/domain/admin-users';
import { authenticate } from '@/lib/auth';

import { closeTestDb, getTestDb, hasTestDb, resetTables } from '../helpers/db';

/**
 * `/admin/usuarios` (PLAN.md FASE 2, PR C).
 *
 * Lo que se prueba acá es sobre todo **lo que no se puede hacer**: esta es la
 * pantalla que, mal hecha, deja al dueño afuera de su propia tienda con un
 * clic apurado en la fila equivocada. La única salida de ahí sería un SSH, que
 * es exactamente lo que esta página existe para evitar.
 */

const PASSWORD = 'tienda2026segura';

async function unOwner(email = 'due@tienda.py') {
  return createAdminUser({ email, password: PASSWORD, role: 'owner' });
}

describe.skipIf(!hasTestDb)('alta de usuarios', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('crea con rol y normaliza el email', async () => {
    const created = await createAdminUser({
      email: 'Encargado@Tienda.PY',
      password: PASSWORD,
      name: 'La Encargada',
      role: 'staff',
    });

    expect(created.email).toBe('encargado@tienda.py');
    expect(created.role).toBe('staff');
    expect(created.lastLoginAt).toBeNull();
  });

  it('el usuario creado entra de verdad al panel', async () => {
    await createAdminUser({ email: 'nuevo@tienda.py', password: PASSWORD, role: 'vendedor' });

    const user = await authenticate('nuevo@tienda.py', PASSWORD);
    expect(user).toMatchObject({ email: 'nuevo@tienda.py', role: 'vendedor' });
  });

  it('no deja dos usuarios con el mismo email', async () => {
    await unOwner();
    await expect(unOwner()).rejects.toThrow(AdminUserError);
  });

  it('rechaza una contraseña débil antes de tocar la tabla', async () => {
    await expect(
      createAdminUser({ email: 'x@tienda.py', password: 'corta', role: 'staff' }),
    ).rejects.toThrow(AdminUserError);

    expect(await listAdminUsers()).toHaveLength(0);
  });
});

describe.skipIf(!hasTestDb)('las dos reglas duras', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('no podés desactivarte a vos mismo', async () => {
    const owner = await unOwner();
    // Aunque haya otro dueño activo: el motivo no es dejar la tienda sin
    // dueño, es no cerrarte la puerta con el pulgar.
    await createAdminUser({ email: 'otro@tienda.py', password: PASSWORD, role: 'owner' });

    await expect(
      setAdminUserActive({ userId: owner.id, isActive: false, actingUserId: owner.id }),
    ).rejects.toThrow(AdminUserError);

    const [row] = await getTestDb().select().from(users).where(eq(users.id, owner.id));
    expect(row?.isActive).toBe(true);
  });

  it('no podés quitarte a vos mismo el rol de dueño', async () => {
    const owner = await unOwner();
    await createAdminUser({ email: 'otro@tienda.py', password: PASSWORD, role: 'owner' });

    await expect(
      setAdminUserRole({ userId: owner.id, role: 'staff', actingUserId: owner.id }),
    ).rejects.toThrow(AdminUserError);
  });

  it('no podés desactivar al último dueño activo', async () => {
    const owner = await unOwner();
    const staff = await createAdminUser({
      email: 'encargado@tienda.py',
      password: PASSWORD,
      role: 'staff',
    });

    // El staff intentando desactivar al único owner: la tienda quedaría sin
    // nadie que pueda crear usuarios ni aprobar una devolución.
    await expect(
      setAdminUserActive({ userId: owner.id, isActive: false, actingUserId: staff.id }),
    ).rejects.toThrow(AdminUserError);
  });

  it('no podés degradar al último dueño activo', async () => {
    const owner = await unOwner();
    const otro = await createAdminUser({ email: 'x@tienda.py', password: PASSWORD, role: 'staff' });

    await expect(
      setAdminUserRole({ userId: owner.id, role: 'staff', actingUserId: otro.id }),
    ).rejects.toThrow(AdminUserError);
  });

  it('con dos dueños activos, uno se puede desactivar', async () => {
    const uno = await unOwner('uno@tienda.py');
    const dos = await unOwner('dos@tienda.py');

    await setAdminUserActive({ userId: uno.id, isActive: false, actingUserId: dos.id });

    const [row] = await getTestDb().select().from(users).where(eq(users.id, uno.id));
    expect(row?.isActive).toBe(false);
  });

  it('un dueño ya desactivado no cuenta como "el último activo"', async () => {
    const activo = await unOwner('activo@tienda.py');
    const dormido = await unOwner('dormido@tienda.py');
    await setAdminUserActive({ userId: dormido.id, isActive: false, actingUserId: activo.id });

    // Ahora `activo` es el único owner activo: degradarlo tiene que fallar
    // aunque exista otra fila con rol owner.
    const staff = await createAdminUser({ email: 's@tienda.py', password: PASSWORD, role: 'staff' });
    await expect(
      setAdminUserRole({ userId: activo.id, role: 'staff', actingUserId: staff.id }),
    ).rejects.toThrow(AdminUserError);
  });
});

describe.skipIf(!hasTestDb)('el flujo completo del plan', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('el dueño crea un staff, el staff entra, lo desactivan y ya no entra', async () => {
    const owner = await unOwner();

    const staff = await createAdminUser({
      email: 'encargado@tienda.py',
      password: PASSWORD,
      role: 'staff',
    });
    expect(await authenticate('encargado@tienda.py', PASSWORD)).not.toBeNull();

    await setAdminUserActive({ userId: staff.id, isActive: false, actingUserId: owner.id });
    expect(await authenticate('encargado@tienda.py', PASSWORD)).toBeNull();

    // Y vuelve a entrar si lo reactivan: desactivar no es borrar.
    await setAdminUserActive({ userId: staff.id, isActive: true, actingUserId: owner.id });
    expect(await authenticate('encargado@tienda.py', PASSWORD)).not.toBeNull();
  });

  it('resetear la contraseña invalida la anterior', async () => {
    const staff = await createAdminUser({
      email: 'encargado@tienda.py',
      password: PASSWORD,
      role: 'staff',
    });

    await resetAdminUserPassword({ userId: staff.id, password: 'otracontrasena2026' });

    expect(await authenticate('encargado@tienda.py', PASSWORD)).toBeNull();
    expect(await authenticate('encargado@tienda.py', 'otracontrasena2026')).not.toBeNull();
  });

  it('cambiar el rol cambia lo que ese usuario puede', async () => {
    const owner = await unOwner();
    const user = await createAdminUser({ email: 'x@tienda.py', password: PASSWORD, role: 'vendedor' });

    await setAdminUserRole({ userId: user.id, role: 'staff', actingUserId: owner.id });

    const authed = await authenticate('x@tienda.py', PASSWORD);
    expect(authed?.role).toBe('staff');
  });
});
