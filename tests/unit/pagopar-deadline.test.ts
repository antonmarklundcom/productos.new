import { describe, expect, it } from "vitest";

import { eventKey, PagoparDeadlineError, withDeadline } from "../../src/domain/pagopar/webhook";
import { parseWebhookEvent } from "../../src/domain/pagopar/protocol";

const HASH = "b92a3c6e319f08e49500328cbd342db19cf1cf07eab118414716a5f66d20cee3";

/**
 * El presupuesto de respuesta del webhook (ARCH.md §4: Pagopar reintenta si
 * tardamos más de ~5 s).
 */
describe("withDeadline", () => {
  it("deja pasar el trabajo que termina a tiempo", async () => {
    await expect(withDeadline(Promise.resolve("listo"), 1000)).resolves.toBe("listo");
  });

  it("corta el que se pasa", async () => {
    const eterno = new Promise<string>(() => {});
    await expect(withDeadline(eterno, 10)).rejects.toBeInstanceOf(PagoparDeadlineError);
  });

  it("propaga el error original si el trabajo falla antes del corte", async () => {
    const roto = Promise.reject(new Error("la base dijo que no"));
    await expect(withDeadline(roto, 1000)).rejects.toThrow("la base dijo que no");
  });
});

/**
 * La clave de idempotencia. Es la que decide qué es un repetido, así que un
 * cambio acá se paga con pedidos cobrados que no se marcan.
 */
describe("eventKey", () => {
  const base = { hash_pedido: HASH, monto: "150000" };

  it("el mismo aviso da la misma clave", () => {
    const uno = parseWebhookEvent({ ...base, pagado: true });
    const otro = parseWebhookEvent({ ...base, pagado: true, ruido: "no importa" });
    expect(eventKey(uno)).toBe(eventKey(otro));
  });

  it("pagado y no pagado son eventos distintos", () => {
    // Si la clave fuera sólo el hash, el primer aviso de "no pagado" taparía
    // para siempre el "pagado" que viene después.
    expect(eventKey(parseWebhookEvent({ ...base, pagado: false }))).not.toBe(
      eventKey(parseWebhookEvent({ ...base, pagado: true }))
    );
  });

  it("dos pedidos distintos nunca comparten clave", () => {
    const otroHash = HASH.replace(/^b/, "c");
    expect(eventKey(parseWebhookEvent({ ...base, pagado: true }))).not.toBe(
      eventKey(parseWebhookEvent({ hash_pedido: otroHash, monto: "150000", pagado: true }))
    );
  });

  it("entra en la columna `event_key` (varchar 191)", () => {
    const key = eventKey(parseWebhookEvent({ ...base, pagado: true }));
    expect(key.length).toBeLessThanOrEqual(191);
  });
});
