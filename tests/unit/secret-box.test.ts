import { describe, expect, it } from 'vitest';

import {
  SecretBoxDecryptError,
  SecretBoxUnavailableError,
  cifrarSecreto,
  descifrarSecreto,
  enmascararSecreto,
  secretBoxDisponible,
} from '../../src/lib/secret-box';

/**
 * El cifrado de los secretos de `/admin/integraciones`: AES-256-GCM con una
 * clave derivada de SESSION_SECRET por HKDF, una por contexto.
 */

const ENV = { SESSION_SECRET: 'k'.repeat(24) + 'un-secreto-de-prueba-largo' };
const OTRO_ENV = { SESSION_SECRET: 'z'.repeat(24) + 'otro-secreto-de-prueba-largo' };
const CONTEXTO = 'integraciones/pagopar/privateKey';
const SECRETO = 'clave-privada-de-pagopar-1234';

describe('cifrar y descifrar', () => {
  it('ida y vuelta devuelve lo mismo', () => {
    const blob = cifrarSecreto(SECRETO, CONTEXTO, ENV);
    expect(descifrarSecreto(blob, CONTEXTO, ENV)).toBe(SECRETO);
  });

  it('el blob no contiene el secreto y lleva la versión adelante', () => {
    const blob = cifrarSecreto(SECRETO, CONTEXTO, ENV);
    expect(blob).not.toContain(SECRETO);
    expect(blob.startsWith('v1.')).toBe(true);
    expect(blob.split('.')).toHaveLength(4);
  });

  it('el mismo texto cifrado dos veces da blobs distintos (IV al azar)', () => {
    expect(cifrarSecreto(SECRETO, CONTEXTO, ENV)).not.toBe(cifrarSecreto(SECRETO, CONTEXTO, ENV));
  });

  it('con otro contexto no abre: una clave por uso', () => {
    const blob = cifrarSecreto(SECRETO, CONTEXTO, ENV);
    expect(() => descifrarSecreto(blob, 'integraciones/whatsapp/accessToken', ENV)).toThrow(
      SecretBoxDecryptError,
    );
  });

  it('con otro SESSION_SECRET no abre', () => {
    const blob = cifrarSecreto(SECRETO, CONTEXTO, ENV);
    expect(() => descifrarSecreto(blob, CONTEXTO, OTRO_ENV)).toThrow(SecretBoxDecryptError);
  });

  it('un byte tocado no abre (GCM autentica)', () => {
    const blob = cifrarSecreto(SECRETO, CONTEXTO, ENV);
    const partes = blob.split('.');
    const cifrado = Buffer.from(partes[3]!, 'base64url');
    cifrado[0] = cifrado[0]! ^ 0xff;
    partes[3] = cifrado.toString('base64url');
    expect(() => descifrarSecreto(partes.join('.'), CONTEXTO, ENV)).toThrow(SecretBoxDecryptError);
  });

  it('basura o versión desconocida no abre', () => {
    expect(() => descifrarSecreto('no-es-un-blob', CONTEXTO, ENV)).toThrow(SecretBoxDecryptError);
    expect(() => descifrarSecreto('v9.a.b.c', CONTEXTO, ENV)).toThrow(SecretBoxDecryptError);
  });

  it('el error de descifrado no trae el blob ni el contexto', () => {
    const blob = cifrarSecreto(SECRETO, CONTEXTO, ENV);
    try {
      descifrarSecreto(blob, CONTEXTO, OTRO_ENV);
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(blob);
      expect(String((error as Error).message)).not.toContain(SECRETO);
    }
  });
});

describe('sin SESSION_SECRET válido no se hace nada', () => {
  it.each([
    ['ausente', {}],
    ['vacío', { SESSION_SECRET: '' }],
    ['corto', { SESSION_SECRET: 'corto' }],
    ['el placeholder de .env.example', { SESSION_SECRET: 'changeme-generate-with-openssl-rand-base64-32' }],
  ])('%s: no cifra ni descifra', (_caso, env) => {
    expect(secretBoxDisponible(env)).toBe(false);
    expect(() => cifrarSecreto(SECRETO, CONTEXTO, env)).toThrow(SecretBoxUnavailableError);
    const blob = cifrarSecreto(SECRETO, CONTEXTO, ENV);
    expect(() => descifrarSecreto(blob, CONTEXTO, env)).toThrow(SecretBoxUnavailableError);
  });

  it('con uno válido sí', () => {
    expect(secretBoxDisponible(ENV)).toBe(true);
  });
});

describe('la máscara', () => {
  it('muestra sólo los últimos cuatro de un secreto largo', () => {
    expect(enmascararSecreto(SECRETO)).toBe('••••1234');
  });

  it('de uno corto no muestra nada', () => {
    expect(enmascararSecreto('abc12345')).toBe('••••');
  });
});
