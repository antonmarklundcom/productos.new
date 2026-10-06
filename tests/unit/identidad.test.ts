import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STORE_SETTINGS,
  SECTION_INPUT,
  cuentasEfectivas,
  nombreEfectivo,
  parseStoreSettings,
  variablesDeColor,
} from '../../src/domain/store-settings-schema';
import { secretoSesionCliente } from '../../src/lib/customer-session';

/**
 * Lo que cada tienda clonada antes cambiaba en el código y ahora cambia el
 * dueño en `/admin/ajustes`: nombre, logo, favicon, color de marca y el
 * interruptor de las cuentas de cliente (cuyo secreto ya no se genera a mano).
 */

describe('identidad: sin nada cargado, la tienda de siempre', () => {
  it('un JSON viejo sin la sección se lee con todo en null', () => {
    const viejo = parseStoreSettings({ marca: { tagline: 'hola' } });
    expect(viejo.identidad).toEqual({ nombre: null, logoId: null, faviconId: null, colorPrimario: null });
    expect(viejo.cuentas).toEqual({ activas: null });
  });

  it('el nombre del panel gana; vacío o en blanco, el de tienda.ts', () => {
    expect(nombreEfectivo({ ...DEFAULT_STORE_SETTINGS.identidad, nombre: 'Mascota Feliz' }, 'TiendaPY')).toBe(
      'Mascota Feliz',
    );
    expect(nombreEfectivo({ ...DEFAULT_STORE_SETTINGS.identidad, nombre: '   ' }, 'TiendaPY')).toBe('TiendaPY');
    expect(nombreEfectivo(DEFAULT_STORE_SETTINGS.identidad, 'TiendaPY')).toBe('TiendaPY');
  });

  it('las cuentas: el panel decide, sin decisión manda tienda.ts', () => {
    expect(cuentasEfectivas({ activas: null }, false)).toBe(false);
    expect(cuentasEfectivas({ activas: null }, true)).toBe(true);
    expect(cuentasEfectivas({ activas: true }, false)).toBe(true);
    expect(cuentasEfectivas({ activas: false }, true)).toBe(false);
  });
});

describe('color de marca', () => {
  const con = (colorPrimario: string | null) => ({ ...DEFAULT_STORE_SETTINGS.identidad, colorPrimario });

  it('sin color no pisa nada: manda el tema', () => {
    expect(variablesDeColor(con(null))).toBeNull();
  });

  it('un color oscuro lleva texto blanco; uno claro, texto oscuro', () => {
    expect(variablesDeColor(con('#1f2a44'))).toEqual({
      '--primary': '#1f2a44',
      '--primary-foreground': '#ffffff',
      '--ring': '#1f2a44',
    });
    expect(variablesDeColor(con('#ffd84d'))?.['--primary-foreground']).toBe('#171717');
  });

  it('lo guardado se revalida al leer: termina en un atributo style', () => {
    // Una fila editada a mano no puede meter CSS arbitrario en <html>.
    expect(variablesDeColor(con('red; background: url(x)'))).toBeNull();
    expect(variablesDeColor(con('#fff'))).toBeNull();
  });

  it('al guardar: #RRGGBB, en minúsculas; otra cosa se rechaza', () => {
    const esquema = SECTION_INPUT.identidad;
    expect(esquema.parse({ colorPrimario: ' #1F6FEB ' }).colorPrimario).toBe('#1f6feb');
    expect(esquema.parse({ colorPrimario: '' }).colorPrimario).toBeNull();
    expect(esquema.safeParse({ colorPrimario: 'azul' }).success).toBe(false);
    expect(esquema.safeParse({ nombre: 'x'.repeat(61) }).success).toBe(false);
  });
});

describe('secreto de la sesión de cliente', () => {
  const SESSION = 's'.repeat(40);

  it('sin variable propia se deriva de SESSION_SECRET: estable, largo y distinto', () => {
    const a = secretoSesionCliente({ SESSION_SECRET: SESSION });
    const b = secretoSesionCliente({ SESSION_SECRET: SESSION });
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a!.length).toBeGreaterThanOrEqual(32);
    // Nunca el mismo que el del panel: son dos poblaciones distintas.
    expect(a).not.toBe(SESSION);
    expect(a).not.toContain(SESSION);
    // Otro SESSION_SECRET, otro secreto derivado.
    expect(secretoSesionCliente({ SESSION_SECRET: 'z'.repeat(40) })).not.toBe(a);
  });

  it('una variable propia manda (las tiendas que ya la tenían no cambian)', () => {
    const propio = 'p'.repeat(40);
    expect(secretoSesionCliente({ SESSION_SECRET: SESSION, CUSTOMER_SESSION_SECRET: propio })).toBe(propio);
  });

  it('sin forma de tener uno válido, null (y /cuenta no se ofrece)', () => {
    expect(secretoSesionCliente({})).toBeNull();
    expect(secretoSesionCliente({ SESSION_SECRET: 'corto' })).toBeNull();
    expect(
      secretoSesionCliente({ SESSION_SECRET: 'changeme-generate-with-openssl-rand-base64-32' }),
    ).toBeNull();
    // Una propia cargada pero corta no cae al derivado: es un error de config.
    expect(secretoSesionCliente({ SESSION_SECRET: SESSION, CUSTOMER_SESSION_SECRET: 'corta' })).toBeNull();
  });
});
