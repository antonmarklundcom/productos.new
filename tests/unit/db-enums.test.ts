import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listSourceFiles, readCode } from '../helpers/source';
import * as enums from '@/db/enums';
import * as schema from '@/db/schema';

/**
 * `src/db/enums.ts` existe para que el navegador pueda conocer los valores de
 * un ENUM sin cargarse `drizzle-orm` entero (fase O14; el diagnóstico completo
 * estaba en KNOWN-ISSUES.md, medido en `tests/e2e/presupuesto.spec.ts`).
 *
 * La regla se sostiene sola sólo mientras nadie escriba un `import` de más:
 * `schema.ts` define cada tabla con `mysqlTable(...)` al alcance del módulo
 * —llamadas con efecto, no puras—, así que un solo import de drizzle acá
 * adentro vuelve a arrastrar el ORM al bundle del panel sin que se note en
 * ninguna pantalla. De ahí los dos tests que leen el fuente.
 */

const ENUMS_MODULE = path.join('src', 'db', 'enums.ts');
const SCHEMA_MODULE = path.join('src', 'db', 'schema.ts');
/** Este mismo archivo nombra los patrones que busca; no se escanea a sí mismo. */
const SELF = path.join('tests', 'unit', 'db-enums.test.ts');

describe('src/db/enums.ts', () => {
  it('no importa drizzle-orm ni nada que lo arrastre', async () => {
    const code = await readCode(ENUMS_MODULE);

    expect(code).not.toMatch(/from\s+['"]drizzle-orm/);
    expect(code).not.toMatch(/from\s+['"]\.\/schema['"]/);
    // Sólo importa de `../lib/roles`, que tampoco tiene dependencias.
    const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toEqual(['../lib/roles']);
  });

  it('sigue habiendo una sola lista: el schema re-exporta exactamente estos valores', async () => {
    expect(schema.ORDER_STATUSES).toBe(enums.ORDER_STATUSES);
    expect(schema.PAYMENT_METHODS).toBe(enums.PAYMENT_METHODS);
    expect(schema.COUPON_TYPES).toBe(enums.COUPON_TYPES);
    expect(schema.DOC_TYPES).toBe(enums.DOC_TYPES);
    expect(schema.USER_ROLES).toBe(enums.USER_ROLES);
  });

  it('ningún componente cliente importa un valor de @/db/schema', async () => {
    const offenders: string[] = [];

    for (const file of await listSourceFiles(['src'])) {
      if (file === SELF || file === SCHEMA_MODULE) continue;
      const code = await readCode(file);
      if (!/^\s*['"]use client['"]/m.test(code)) continue;

      // `import type { ... } from "@/db/schema"` no deja nada en el bundle:
      // los tipos se borran al compilar. Lo que arrastra el ORM es el import
      // de un **valor**.
      for (const match of code.matchAll(/import\s+(type\s+)?([^;]*?)from\s+['"]@\/db\/schema['"]/g)) {
        const esTypeImport = Boolean(match[1]);
        const clausula = match[2] ?? '';
        // `import { type X, Y }`: el `type` por especificador también borra.
        const traeValor = clausula
          .replace(/[{}]/g, ' ')
          .split(',')
          .map((parte) => parte.trim())
          .filter(Boolean)
          .some((parte) => !parte.startsWith('type '));
        if (!esTypeImport && traeValor) offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
