import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readCode } from '../helpers/source';

import { ORDER_STATUSES, USER_ROLES, type OrderStatus, type UserRole } from '@/db/schema';
import { USER_ROLES as ROLES_DEL_MODULO } from '@/lib/roles';
import { CAPABILITIES, ROLE_CAPABILITIES, can } from '@/lib/permissions';
import {
  ForbiddenError,
  UnauthorizedError,
  VENDEDOR_TRANSITIONS,
  assertCanTransitionTo,
  requireAdmin,
  requireOwner,
  requireStaff,
  type AdminActor,
} from '@/lib/session';

/**
 * Los tres roles del PR B, probados por el lado que importa: **quién no
 * puede**. Un guard que deja pasar a quien corresponde y también a quien no
 * pasa igual de verde que uno correcto.
 */

const actores: Record<UserRole, AdminActor> = {
  owner: { userId: 1, email: 'due@tienda.py', role: 'owner' },
  staff: { userId: 2, email: 'encargado@tienda.py', role: 'staff' },
  vendedor: { userId: 3, email: 'mostrador@tienda.py', role: 'vendedor' },
};

describe('los guards por rol', () => {
  it('requireAdmin deja pasar a los tres roles del panel', () => {
    for (const role of USER_ROLES) {
      expect(requireAdmin(actores[role])).toEqual(actores[role]);
    }
  });

  it('requireStaff excluye al vendedor y deja pasar a owner y staff', () => {
    expect(requireStaff(actores.owner)).toEqual(actores.owner);
    expect(requireStaff(actores.staff)).toEqual(actores.staff);
    expect(() => requireStaff(actores.vendedor)).toThrow(ForbiddenError);
  });

  it('requireOwner excluye a staff y a vendedor', () => {
    expect(requireOwner(actores.owner)).toEqual(actores.owner);
    expect(() => requireOwner(actores.staff)).toThrow(ForbiddenError);
    expect(() => requireOwner(actores.vendedor)).toThrow(ForbiddenError);
  });

  it('un rol que no es del panel no entra ni al guard más flojo', () => {
    // Es la forma que va a tener una sesión de cliente (PR E) si alguien
    // llega a pasarla por acá: rol que no está en el ENUM del panel.
    const cliente = { userId: 9, email: 'compradora@gmail.com', role: 'cliente' as never };
    expect(() => requireAdmin(cliente)).toThrow(ForbiddenError);
  });

  it('una sesión a medio armar es 401, no 403', () => {
    expect(() => requireStaff(null)).toThrow(UnauthorizedError);
    expect(() => requireOwner({ userId: 1 })).toThrow(UnauthorizedError);
  });
});

describe('qué transiciones puede apretar cada rol', () => {
  it('owner y staff pueden cualquier destino de la máquina de estados', () => {
    for (const to of ORDER_STATUSES) {
      expect(() => assertCanTransitionTo(actores.owner, to)).not.toThrow();
      expect(() => assertCanTransitionTo(actores.staff, to)).not.toThrow();
    }
  });

  it('el vendedor sólo puede preparar, despachar y entregar', () => {
    for (const to of VENDEDOR_TRANSITIONS) {
      expect(() => assertCanTransitionTo(actores.vendedor, to)).not.toThrow();
    }
  });

  it('el vendedor no puede dar por cobrado, cancelar, vencer ni reembolsar', () => {
    // Lo importante del rol: todo lo que mueve plata o suelta stock queda
    // afuera, y se enumera desde el ENUM para que un estado nuevo tenga que
    // pasar por acá en vez de colarse permitido.
    const prohibidos: OrderStatus[] = ORDER_STATUSES.filter(
      (status) => !VENDEDOR_TRANSITIONS.includes(status),
    );
    expect(prohibidos).toContain('pagado');
    expect(prohibidos).toContain('reembolsado');
    expect(prohibidos).toContain('cancelado');
    expect(prohibidos).toContain('vencido');
    expect(prohibidos).toContain('rechazado');

    for (const to of prohibidos) {
      expect(() => assertCanTransitionTo(actores.vendedor, to)).toThrow(ForbiddenError);
    }
  });
});

describe('la matriz de capacidades', () => {
  it('el dueño puede todo lo que existe', () => {
    for (const capability of CAPABILITIES) {
      expect(can('owner', capability)).toBe(true);
    }
  });

  it('el staff no toca reembolsos, exports ni usuarios', () => {
    expect(can('staff', 'reembolsos')).toBe(false);
    expect(can('staff', 'exports')).toBe(false);
    expect(can('staff', 'usuarios')).toBe(false);
    expect(can('staff', 'cupones')).toBe(false);
    // Apagar una categoría vacía la vidriera; una zona mal puesta cobra de
    // menos en cada pedido. Las dos son decisiones del dueño (PR J y K).
    expect(can('staff', 'categorias')).toBe(false);
    expect(can('staff', 'envios')).toBe(false);
    // A qué cuenta transfieren las compradoras (PR T): quien lo puede cambiar
    // desvía la facturación entera sin dejar un pedido raro.
    expect(can('staff', 'banco')).toBe(false);
    // Los ajustes de la tienda incluyen el WhatsApp al que escriben las
    // compradoras: mismo motivo que el banco.
    expect(can('staff', 'ajustes')).toBe(false);
    expect(can('owner', 'ajustes')).toBe(true);
    // …pero sí la operación diaria completa.
    expect(can('staff', 'comprobantes')).toBe(true);
    expect(can('staff', 'stock')).toBe(true);
    expect(can('staff', 'productos')).toBe(true);
  });

  it('el vendedor ve, despacha y anota pedidos, y nada más', () => {
    // `pedidos.notas` entró en O5 y es la única capacidad que se le sumó al
    // vendedor desde el MVP: es mostrador puro —no mueve plata, no mueve
    // stock, no cambia el estado, y la compradora no la ve nunca— y quien
    // atiende cuando la compradora llama es justamente él.
    const DEL_VENDEDOR = ['pedidos.ver', 'pedidos.despachar', 'pedidos.notas'] as const;

    expect(ROLE_CAPABILITIES.vendedor).toEqual([...DEL_VENDEDOR]);
    for (const capability of CAPABILITIES) {
      if ((DEL_VENDEDOR as readonly string[]).includes(capability)) continue;
      expect(can('vendedor', capability)).toBe(false);
    }
  });

  it('cada rol del ENUM tiene su fila (agregar un rol obliga a decidir)', () => {
    for (const role of USER_ROLES) {
      expect(ROLE_CAPABILITIES[role]).toBeDefined();
    }
  });
});

/**
 * El proxy (`src/proxy.ts`) corre en el runtime **edge** y necesita saber qué
 * roles son del panel. Leerlo de `@/db/schema` le arrastraría el grafo de
 * `drizzle-orm/mysql-core` al bundle del edge; por eso la lista vive en
 * `@/lib/roles`, sin dependencias, y el schema la re-exporta.
 *
 * Lo que este test cuida es que ese rodeo no se convierta en dos listas.
 */
describe('la lista de roles es una sola', () => {
  it('el schema re-exporta exactamente la del módulo sin dependencias', () => {
    expect([...USER_ROLES]).toEqual([...ROLES_DEL_MODULO]);
  });

  it('el proxy decide contra la lista, no contra literales sueltos', async () => {
    const proxy = await readCode(path.join('src', 'proxy.ts'));

    // Un rol nuevo agregado al ENUM y olvidado en el proxy queda rebotando al
    // login para siempre, con la cookie válida y sin ningún error visible.
    expect(proxy).toContain('USER_ROLES');
    expect(proxy).not.toMatch(/session\.role\s*===\s*"(owner|staff|vendedor)"/);
  });

  it('el proxy no importa el schema: en el edge eso es drizzle entero', async () => {
    const proxy = await readCode(path.join('src', 'proxy.ts'));
    expect(proxy).not.toMatch(/from\s+"@\/db\/schema"/);
  });
});
