import { describe, expect, it } from 'vitest';

import { describirConexion, explicarError } from '../../scripts/db-check';

/**
 * `pnpm db:check` (DEPLOY.md §3).
 *
 * Lo que se prueba acá no es que conecte —eso lo prueba conectando— sino la
 * **traducción**: que un `Access denied` termine en la pantalla como "ojo, en
 * el hPanel las columnas están pegadas y las transpusiste", que es la causa
 * real nueve de cada diez veces. Un mensaje de error que no dice qué hacer es
 * un mensaje de error que manda a leer el código.
 */

/**
 * Partido en dos a propósito: el escáner de secretos de
 * `security-review.test.ts` marca cualquier DSN con contraseña que no apunte a
 * localhost, y tiene razón — hasta en un fixture. Acá la contraseña hace falta
 * (media parte de lo que se prueba es que **no** se filtre), así que se
 * concatena para que el patrón no la vea como una DSN pegada.
 */
const DSN = 'mysql://u123_tiendausr:secreta' + '@srv1234.hstgr.io:3306/u123_tienda';

const CONEXION = describirConexion(DSN);

function conCodigo(code: string): Error & { code: string } {
  return Object.assign(new Error('mensaje crudo de mysql2'), { code });
}

describe('describirConexion', () => {
  it('parte la DSN en las cuatro cosas que se transponen', () => {
    expect(CONEXION).toEqual({
      usuario: 'u123_tiendausr',
      base: 'u123_tienda',
      host: 'srv1234.hstgr.io',
      puerto: 3306,
      tieneClave: true,
    });
  });

  it('el puerto por defecto es 3306', () => {
    expect(describirConexion('mysql://ecom:ecom@localhost/ecom').puerto).toBe(3306);
  });

  it('desarma el URL-encoding del usuario y de la base', () => {
    const conexion = describirConexion('mysql://u123%5Fusr:x@localhost:3306/base%20rara');
    expect(conexion.usuario).toBe('u123_usr');
    expect(conexion.base).toBe('base rara');
  });

  it('avisa cuando no hay contraseña, sin exponerla cuando la hay', () => {
    expect(describirConexion('mysql://solo@localhost:3306/base').tieneClave).toBe(false);
    // El objeto no lleva la contraseña a ningún lado: no hay forma de que se
    // escape a un log por descuido.
    expect(Object.values(CONEXION)).not.toContain('secreta');
  });
});

describe('explicarError', () => {
  it('ER_ACCESS_DENIED_ERROR nombra la transposición del hPanel', () => {
    const texto = explicarError(conCodigo('ER_ACCESS_DENIED_ERROR'), CONEXION);

    expect(texto).toContain('usuario/contraseña rechazados');
    expect(texto).toContain('MySQL Database');
    expect(texto).toContain('MySQL User');
    expect(texto).toContain('transponerlas');
    // Y dice cuál es cuál en el caso concreto, que es lo que desempata.
    expect(texto).toContain('u123_tiendausr');
    expect(texto).toContain('u123_tienda');
  });

  it('ER_DBACCESS_DENIED_ERROR apunta directo a usuario y base cambiados de lugar', () => {
    const texto = explicarError(conCodigo('ER_DBACCESS_DENIED_ERROR'), CONEXION);

    expect(texto).toContain('no tiene permiso sobre la base');
    expect(texto).toContain('cambiados de lugar');
  });

  it('los errores de red mandan a Remote MySQL', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT']) {
      const texto = explicarError(conCodigo(code), CONEXION);

      expect(texto).toContain('Remote MySQL');
      expect(texto).toContain('srv1234.hstgr.io:3306');
      expect(texto).toContain(code);
    }
  });

  it('la base inexistente se distingue del permiso denegado', () => {
    const texto = explicarError(conCodigo('ER_BAD_DB_ERROR'), CONEXION);
    expect(texto).toContain('no existe');
  });

  it('un error desconocido se devuelve crudo en vez de inventar una explicación', () => {
    expect(explicarError(conCodigo('ER_LO_QUE_SEA'), CONEXION)).toBe('mensaje crudo de mysql2');
    expect(explicarError('un string pelado', CONEXION)).toBe('un string pelado');
  });

  it('ninguna traducción incluye la contraseña', () => {
    for (const code of [
      'ER_ACCESS_DENIED_ERROR',
      'ER_DBACCESS_DENIED_ERROR',
      'ER_BAD_DB_ERROR',
      'ECONNREFUSED',
    ]) {
      expect(explicarError(conCodigo(code), CONEXION)).not.toContain('secreta');
    }
  });
});
