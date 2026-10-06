import { describe, expect, it } from "vitest";

import {
  extractHashPedido,
  parseAmountPyg,
  parseEnvelope,
  parseWebhookEvent,
  PagoparProtocolError,
  webhookErrorBody,
  webhookResponseBody,
} from "../../src/domain/pagopar/protocol";
import { MoneyError } from "../../src/lib/money";

const HASH = "b92a3c6e319f08e49500328cbd342db19cf1cf07eab118414716a5f66d20cee3";

describe("parseAmountPyg", () => {
  it("lee enteros vengan como número o como string", () => {
    expect(parseAmountPyg(150000)).toBe(150000);
    expect(parseAmountPyg("150000")).toBe(150000);
    expect(parseAmountPyg(" 150000 ")).toBe(150000);
  });

  it('acepta los céntimos en cero que agrega cualquier serializador', () => {
    expect(parseAmountPyg("150000.00")).toBe(150000);
    expect(parseAmountPyg("150000,00")).toBe(150000);
    expect(parseAmountPyg("150000.0")).toBe(150000);
  });

  it("rechaza céntimos que no son cero en vez de redondearlos", () => {
    expect(() => parseAmountPyg("150000.50")).toThrow(MoneyError);
    expect(() => parseAmountPyg(150000.5)).toThrow(MoneyError);
  });

  it('rechaza "150.000" por ambiguo', () => {
    // En es-PY son ciento cincuenta mil; en formato inglés, ciento cincuenta.
    // Adivinar acá es un descuadre que sólo aparece en la conciliación.
    expect(() => parseAmountPyg("150.000")).toThrow(MoneyError);
    expect(() => parseAmountPyg("1.500.000")).toThrow(MoneyError);
  });

  it("rechaza basura", () => {
    for (const invalid of ["", "abc", "1e5", null, undefined, {}, []]) {
      expect(() => parseAmountPyg(invalid)).toThrow(MoneyError);
    }
  });
});

describe("parseEnvelope / extractHashPedido", () => {
  it("saca el hash de `data`", () => {
    const envelope = parseEnvelope({ respuesta: true, resultado: [{ data: HASH }] });
    expect(extractHashPedido(envelope)).toBe(HASH);
  });

  it("saca el hash de `hash_pedido`", () => {
    const envelope = parseEnvelope({ respuesta: true, resultado: [{ hash_pedido: HASH }] });
    expect(extractHashPedido(envelope)).toBe(HASH);
  });

  it("propaga el mensaje cuando Pagopar rechaza", () => {
    const envelope = parseEnvelope({ respuesta: false, resultado: "token inválido" });
    expect(() => extractHashPedido(envelope)).toThrow(/token inválido/);
  });

  it("sin hash es un error duro, no un default", () => {
    const envelope = parseEnvelope({ respuesta: true, resultado: [{ otra_cosa: 1 }] });
    expect(() => extractHashPedido(envelope)).toThrow(PagoparProtocolError);
  });

  it("una respuesta sin `respuesta` no es de Pagopar", () => {
    expect(() => parseEnvelope({ resultado: [] })).toThrow(PagoparProtocolError);
    expect(() => parseEnvelope("ok")).toThrow(PagoparProtocolError);
  });
});

describe("parseWebhookEvent", () => {
  const pedido = { hash_pedido: HASH, pagado: true, monto: "150000", numero_pedido: "PY-000123" };

  it("lee el pedido envuelto en `resultado`", () => {
    const event = parseWebhookEvent({ resultado: [pedido] });
    expect(event).toMatchObject({ hashPedido: HASH, pagado: true, montoPyg: 150000 });
    expect(event.raw).toEqual(pedido);
  });

  it("lee el pedido pelado y la lista pelada", () => {
    expect(parseWebhookEvent(pedido).hashPedido).toBe(HASH);
    expect(parseWebhookEvent([pedido]).hashPedido).toBe(HASH);
  });

  it("`pagado` tolera las formas en que viaja un booleano por JSON", () => {
    for (const value of [true, 1, "1", "true", "SI"]) {
      expect(parseWebhookEvent({ ...pedido, pagado: value }).pagado).toBe(true);
    }
    for (const value of [false, 0, "0", "false", "", undefined, null]) {
      expect(parseWebhookEvent({ ...pedido, pagado: value }).pagado).toBe(false);
    }
  });

  it('"false" no se cuenta como pagado por ser un string no vacío', () => {
    // El bug: `Boolean("false") === true` marcaría cobrado un pago fallido.
    expect(parseWebhookEvent({ ...pedido, pagado: "false" }).pagado).toBe(false);
  });

  it("sin hash_pedido o sin monto no se procesa nada", () => {
    expect(() => parseWebhookEvent({ pagado: true, monto: "1" })).toThrow(PagoparProtocolError);
    expect(() => parseWebhookEvent({ hash_pedido: HASH, pagado: true })).toThrow(
      PagoparProtocolError
    );
    expect(() => parseWebhookEvent("no soy json")).toThrow(PagoparProtocolError);
  });
});

/**
 * El formato de la respuesta al webhook, fijado.
 *
 * ⚠️ Sin confirmar contra la doc v2 vigente ni contra el sandbox (ver
 * `tests/integration/pagopar-sandbox.test.ts` y el comentario de
 * `webhookResponseBody`). Este test no dice "esto es lo que Pagopar espera":
 * dice "esto es exactamente lo que hoy contestamos", para que cambiarlo sea
 * una decisión visible en el diff y no un efecto colateral.
 */
describe("formato de la respuesta al webhook (pinned)", () => {
  const event = parseWebhookEvent({ hash_pedido: HASH, pagado: true, monto: "150000" });

  it("devuelve el sobre {respuesta, resultado} con el pedido recibido", () => {
    expect(webhookResponseBody(event)).toEqual({
      respuesta: true,
      resultado: [{ hash_pedido: HASH, pagado: true, monto: "150000" }],
    });
  });

  it("es JSON serializable tal cual", () => {
    expect(JSON.parse(JSON.stringify(webhookResponseBody(event)))).toEqual(
      webhookResponseBody(event)
    );
  });

  it("los errores usan el mismo sobre que usa Pagopar para los suyos", () => {
    expect(webhookErrorBody("unauthorized")).toEqual({
      respuesta: false,
      resultado: "unauthorized",
    });
  });
});
