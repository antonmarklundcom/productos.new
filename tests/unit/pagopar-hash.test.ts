import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  pagoparAmount,
  PagoparHashError,
  requestToken,
  tokensMatch,
  webhookGuardToken,
} from "../../src/domain/pagopar/hash";
import { MoneyError } from "../../src/lib/money";

/**
 * Los dos hashes de Pagopar (ARCH.md §4).
 *
 * Cada uno con su vector, calculado acá con `createHash` independiente de la
 * implementación: si alguien "unifica" las dos funciones en una sola, estos
 * tests se caen.
 */

const PRIVATE_KEY = "clave-privada-de-prueba";

function sha1(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex");
}

describe("pagoparAmount", () => {
  it("manda el total como entero pelado", () => {
    expect(pagoparAmount(150000)).toBe("150000");
    expect(pagoparAmount(0)).toBe("0");
    expect(pagoparAmount(1)).toBe("1");
  });

  it('nunca produce "150000.00"', () => {
    // El error clásico: `toFixed(2)` da otro digest y Pagopar rechaza el pago.
    expect(pagoparAmount(150000)).not.toContain(".");
    expect(pagoparAmount(150000)).not.toContain(",");
  });

  it("no acepta decimales ni floats disfrazados", () => {
    for (const invalid of [150000.5, 0.1, 1e-3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pagoparAmount(invalid)).toThrow(MoneyError);
    }
  });

  it("no acepta negativos", () => {
    expect(() => pagoparAmount(-1)).toThrow(MoneyError);
  });

  it("un total grande no se convierte en notación científica", () => {
    // `String(1e21)` es "1e+21": el hash saldría mal y el bug sería invisible.
    expect(pagoparAmount(999_999_999_999)).toBe("999999999999");
  });
});

describe("requestToken — sha1(private + order_number + total)", () => {
  it("coincide con el vector calculado a mano", () => {
    expect(requestToken(PRIVATE_KEY, "PY-000123", 150000)).toBe(
      sha1(`${PRIVATE_KEY}PY-000123150000`)
    );
  });

  it('el total entra como "150000", no como "150000.00"', () => {
    expect(requestToken(PRIVATE_KEY, "PY-000123", 150000)).not.toBe(
      sha1(`${PRIVATE_KEY}PY-000123150000.00`)
    );
  });

  it("cambiar el número de pedido cambia el digest", () => {
    expect(requestToken(PRIVATE_KEY, "PY-000123", 150000)).not.toBe(
      requestToken(PRIVATE_KEY, "PY-000124", 150000)
    );
  });

  it("cambiar la clave privada cambia el digest", () => {
    expect(requestToken(PRIVATE_KEY, "PY-000123", 150000)).not.toBe(
      requestToken("otra-clave", "PY-000123", 150000)
    );
  });

  it("exige clave privada y número de pedido", () => {
    expect(() => requestToken("", "PY-000123", 1)).toThrow(PagoparHashError);
    expect(() => requestToken(PRIVATE_KEY, "  ", 1)).toThrow(PagoparHashError);
  });
});

describe("webhookGuardToken — sha1(private + hash_pedido)", () => {
  const HASH_PEDIDO = "b92a3c6e319f08e49500328cbd342db19cf1cf07eab118414716a5f66d20cee3";

  it("coincide con el vector calculado a mano", () => {
    expect(webhookGuardToken(PRIVATE_KEY, HASH_PEDIDO)).toBe(sha1(`${PRIVATE_KEY}${HASH_PEDIDO}`));
  });

  it("es una entrada DISTINTA a la del token de la petición", () => {
    // El bug que ARCH.md §4 avisa: reusar el helper equivocado y quedarse
    // mirando un 401 sin explicación.
    expect(webhookGuardToken(PRIVATE_KEY, HASH_PEDIDO)).not.toBe(
      requestToken(PRIVATE_KEY, HASH_PEDIDO, 150000)
    );
  });

  it("exige clave privada y hash_pedido", () => {
    expect(() => webhookGuardToken("", HASH_PEDIDO)).toThrow(PagoparHashError);
    expect(() => webhookGuardToken(PRIVATE_KEY, "")).toThrow(PagoparHashError);
  });
});

describe("tokensMatch", () => {
  const token = sha1("cualquier-cosa");

  it("acepta el digest correcto", () => {
    expect(tokensMatch(token, token)).toBe(true);
  });

  it("rechaza uno del mismo largo que difiere en un caracter", () => {
    const casiIgual = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(casiIgual).toHaveLength(token.length);
    expect(tokensMatch(token, casiIgual)).toBe(false);
  });

  it("rechaza largos distintos sin tirar", () => {
    expect(tokensMatch(token, "")).toBe(false);
    expect(tokensMatch(token, `${token}x`)).toBe(false);
  });
});
