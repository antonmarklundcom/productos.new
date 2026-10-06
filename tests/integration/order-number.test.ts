import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { nextOrderNumber } from '@/domain/order-number';

import { closeTestDb, hasTestDb, resetTables } from '../helpers/db';
import { readCode } from '../helpers/source';

describe.skipIf(!hasTestDb)('nextOrderNumber', () => {
  beforeEach(resetTables);
  afterAll(closeTestDb);

  it('empieza en PY-000001 y sigue en orden', async () => {
    expect(await nextOrderNumber()).toBe('PY-000001');
    expect(await nextOrderNumber()).toBe('PY-000002');
    expect(await nextOrderNumber()).toBe('PY-000003');
  });

  it('50 llamadas concurrentes no repiten un número', async () => {
    const numbers = await Promise.all(Array.from({ length: 50 }, () => nextOrderNumber()));

    expect(new Set(numbers).size).toBe(50);
    expect([...numbers].sort()).toEqual(
      Array.from({ length: 50 }, (_, i) => `PY-${String(i + 1).padStart(6, '0')}`).sort(),
    );
  });
});

describe('nextOrderNumber: implementación', () => {
  it('no usa COUNT(*) — dos checkouts simultáneos generarían el mismo número', async () => {
    const code = await readCode('src/domain/order-number.ts');
    expect(code.toLowerCase()).not.toMatch(/count\s*\(\s*\*/);
  });

  it('toma el contador con FOR UPDATE', async () => {
    const code = await readCode('src/domain/order-number.ts');
    expect(code).toMatch(/\.for\(['"]update['"]\)/);
  });
});
