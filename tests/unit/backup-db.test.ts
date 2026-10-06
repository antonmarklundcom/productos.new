import { describe, expect, it } from 'vitest';

import {
  argumentosDeDump,
  copiasVencidas,
  explicarFallo,
  nombreDeArchivo,
  parseArgs,
  parseDatabaseUrl,
  RETENCION_DIAS,
} from '../../scripts/backup-db';

/**
 * `pnpm backup` (DEPLOY.md §7).
 *
 * Una copia de la base es de esas cosas que se prueban el día que se necesitan,
 * o sea el peor día. Lo que se fija acá son las tres formas conocidas de que
 * una copia sea inútil: que se le escape la contraseña por la línea de
 * comandos, que borre de más al limpiar las viejas, y que falle con un mensaje
 * que no dice qué arreglar.
 */

const CONEXION = parseDatabaseUrl('mysql://u123_usr:secreta' + '@srv1234.hstgr.io:3306/u123_tienda');

describe('parseArgs', () => {
  it('sin flags, retiene dos semanas en backups/', () => {
    expect(parseArgs([])).toEqual({ retenerDias: RETENCION_DIAS, salida: 'backups' });
  });

  it('acepta --retener y --salida', () => {
    expect(parseArgs(['--retener', '30', '--salida', '/mnt/copias'])).toEqual({
      retenerDias: 30,
      salida: '/mnt/copias',
    });
  });

  it('un --retener inválido corta antes de tocar la base', () => {
    // Cero o negativo borraría la copia recién hecha; un texto la dejaría en
    // NaN y `copiasVencidas` compararía contra NaN, que no borra nada y
    // silenciosamente miente.
    for (const malo of ['0', '-1', 'catorce', '1.5']) {
      expect(() => parseArgs(['--retener', malo]), malo).toThrow();
    }
  });

  it('una opción desconocida no se ignora', () => {
    // Ignorarla es cómo `--retener 30` mal escrito termina reteniendo 14 días.
    expect(() => parseArgs(['--retner', '30'])).toThrow(/no conozco/);
  });
});

describe('parseDatabaseUrl', () => {
  it('saca las cinco partes de la DSN', () => {
    expect(CONEXION).toEqual({
      usuario: 'u123_usr',
      password: 'secreta',
      base: 'u123_tienda',
      host: 'srv1234.hstgr.io',
      puerto: 3306,
    });
  });

  it('sin nombre de base no hay nada que copiar', () => {
    expect(() => parseDatabaseUrl('mysql://u@host:3306/')).toThrow(/nombre de la base/);
  });
});

describe('argumentosDeDump', () => {
  it('nunca pone la contraseña en la línea de comandos', () => {
    const args = argumentosDeDump(CONEXION);

    // Esto es lo importante de este archivo: argv lo lee cualquiera con un
    // `ps` en la misma máquina. La contraseña viaja por MYSQL_PWD.
    expect(args.join(' ')).not.toContain('secreta');
    expect(args.some((arg) => arg.startsWith('--password'))).toBe(false);
    expect(args.some((arg) => arg === '-p')).toBe(false);
  });

  it('copia consistente sin frenar la tienda, y sin pedir PROCESS', () => {
    const args = argumentosDeDump(CONEXION);

    // Sin --single-transaction la copia lockea las tablas mientras alguien
    // está comprando; sin --no-tablespaces el usuario de Hostinger no tiene
    // privilegios suficientes y el dump falla entero.
    expect(args).toContain('--single-transaction');
    expect(args).toContain('--no-tablespaces');
    expect(args).toContain('--quick');
    // La base va última, como espera mysqldump.
    expect(args.at(-1)).toBe('u123_tienda');
  });
});

describe('nombreDeArchivo', () => {
  it('ordenar por nombre es ordenar por fecha', () => {
    const vieja = nombreDeArchivo('tienda', new Date('2026-03-01T04:05:06Z'));
    const nueva = nombreDeArchivo('tienda', new Date('2026-11-30T23:59:59Z'));

    expect(vieja).toBe('tienda-2026-03-01_04-05-06.sql.gz');
    expect([nueva, vieja].sort()).toEqual([vieja, nueva]);
  });
});

describe('copiasVencidas', () => {
  const ahora = new Date('2026-08-16T12:00:00Z');
  const hace = (dias: number) => new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);

  it('borra sólo lo más viejo que la retención', () => {
    const vencidas = copiasVencidas(
      [
        { nombre: 'tienda-vieja.sql.gz', modificado: hace(20) },
        { nombre: 'tienda-justo.sql.gz', modificado: hace(13) },
        { nombre: 'tienda-hoy.sql.gz', modificado: hace(0) },
      ],
      14,
      ahora,
    );

    expect(vencidas).toEqual(['tienda-vieja.sql.gz']);
  });

  it('no toca nada que no sea una copia', () => {
    // El directorio puede tener un README, un .DS_Store o el dump que alguien
    // dejó a mano. Borrar por antigüedad es peligroso justamente por esto.
    const vencidas = copiasVencidas(
      [
        { nombre: 'README.md', modificado: hace(400) },
        { nombre: 'dump-a-mano.sql', modificado: hace(400) },
        { nombre: 'tienda-vieja.sql.gz', modificado: hace(400) },
      ],
      14,
      ahora,
    );

    expect(vencidas).toEqual(['tienda-vieja.sql.gz']);
  });

  it('con la copia recién hecha en el directorio, no se borra a sí misma', () => {
    expect(copiasVencidas([{ nombre: 'tienda-hoy.sql.gz', modificado: ahora }], 1, ahora)).toEqual(
      [],
    );
  });
});

describe('explicarFallo', () => {
  it('sin mysqldump instalado dice cómo instalarlo', () => {
    expect(explicarFallo(null, 'spawn mysqldump ENOENT')).toMatch(/mariadb-client|mysql-client/);
  });

  it('Access denied manda a db:check y a la trampa del hPanel', () => {
    const texto = explicarFallo(1, "mysqldump: Got error: 1045: Access denied for user 'u123_usr'");
    expect(texto).toContain('db:check');
    expect(texto).toContain('MySQL User');
  });

  it('no poder conectar manda a Remote MySQL', () => {
    expect(explicarFallo(2, "Can't connect to MySQL server on 'srv1234.hstgr.io'")).toContain(
      'Remote MySQL',
    );
  });

  it('un error desconocido se muestra crudo en vez de inventar', () => {
    expect(explicarFallo(3, 'algo rarísimo pasó')).toContain('algo rarísimo pasó');
  });

  it('ninguna explicación repite la contraseña', () => {
    for (const stderr of ['Access denied for user', "Can't connect", 'ENOENT', 'otra cosa']) {
      expect(explicarFallo(1, stderr)).not.toContain('secreta');
    }
  });
});
