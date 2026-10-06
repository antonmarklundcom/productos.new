import { describe, expect, it } from "vitest";

import {
  iniciarTransaccion,
  INICIAR_TRANSACCION_PATH,
} from "../../src/domain/pagopar/client";
import type { PagoparConfig } from "../../src/domain/pagopar/config";
import { webhookResponseBody, parseWebhookEvent } from "../../src/domain/pagopar/protocol";

/**
 * Test de integración contra el sandbox de Pagopar (PLAN.md 5.4).
 *
 * ⚠️ **Estado al escribirlo: nunca se corrió.** No había credenciales de
 * sandbox ni acceso de red a la documentación de Pagopar, y ARCH.md §4 es
 * explícito en que el sobre de la respuesta del webhook cambió entre
 * revisiones de la doc y que no hay que confiar en ninguna forma recordada.
 * Así que no se inventaron ni claves ni URLs: este archivo se saltea solo
 * mientras `.env.local` no tenga las tres variables de abajo.
 *
 *   PAGOPAR_SANDBOX_PUBLIC_KEY=
 *   PAGOPAR_SANDBOX_PRIVATE_KEY=
 *   PAGOPAR_SANDBOX_BASE_URL=
 *
 * Lo que fija cuando corre:
 *
 *   1. que `sha1(PRIVATE_KEY + order_number + total)` con el total como string
 *      entero es aceptado — si Pagopar contesta `respuesta: false`, el hash o
 *      el cuerpo están mal y el test lo dice,
 *   2. el sobre real de la respuesta de `iniciar-transaccion`.
 *
 * Lo que NO puede fijar solo, y hay que hacer a mano una vez:
 *
 *   a. levantar un túnel HTTPS contra `/api/webhooks/pagopar` y registrarlo
 *      como "URL de respuesta" en el panel de Pagopar,
 *   b. pagar un pedido del sandbox,
 *   c. comparar lo que Pagopar acepta con lo que devuelve
 *      `webhookResponseBody()` — es la ÚNICA función del repo que decide la
 *      forma de esa respuesta,
 *   d. si difiere: corregir esa función y el test que la fija en
 *      tests/unit/pagopar-protocol.test.ts. Nada más cambia.
 */

function sandboxConfig(): PagoparConfig | null {
  const publicKey = (process.env.PAGOPAR_SANDBOX_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.PAGOPAR_SANDBOX_PRIVATE_KEY ?? "").trim();
  const baseUrl = (process.env.PAGOPAR_SANDBOX_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (publicKey === "" || privateKey === "" || baseUrl === "") return null;
  return { publicKey, privateKey, baseUrl };
}

const config = sandboxConfig();

describe.skipIf(config === null)("Pagopar sandbox — iniciar-transaccion", () => {
  it("acepta el token con el total como string entero", async () => {
    if (!config) throw new Error("sin credenciales de sandbox");

    const orderNumber = `PY-SBX${Date.now().toString().slice(-6)}`;
    const totalPyg = 150_000;

    const result = await iniciarTransaccion(
      {
        orderNumber,
        totalPyg,
        descripcion: `Pedido de prueba ${orderNumber}`,
        comprador: {
          nombre: "Comprador de Prueba",
          telefono: "+595981123456",
          email: "prueba@example.com",
          documento: "4444440",
          tipoDocumento: "CI",
          ciudad: "Asunción",
          direccion: "Av. Mcal. López 1234",
        },
        items: [
          {
            sku: "SKU-SANDBOX",
            nombre: "Producto de prueba",
            cantidad: 1,
            precioPyg: totalPyg,
            totalPyg,
          },
        ],
        fechaMaximaPago: new Date(Date.now() + 45 * 60_000),
      },
      { config }
    );

    // Si esto falla con "Pagopar rechazó la transacción", el hash o el cuerpo
    // están mal — revisar `requestToken` y el body de `iniciarTransaccion`.
    expect(result.hashPedido).toMatch(/^[a-f0-9]{32,}$/i);
    expect(result.envelope.respuesta).toBe(true);

    // Deja a la vista el sobre real, que es la mitad del punto del test.
    console.info(
      `pagopar sandbox: ${INICIAR_TRANSACCION_PATH} devolvió ${JSON.stringify(result.envelope)}`
    );
  });
});

/**
 * Este bloque sí corre siempre: documenta, en código, qué es exactamente lo
 * que hoy le contestamos al webhook, para que el día que alguien confirme el
 * formato contra la doc v2 sepa qué está cambiando.
 */
describe("formato de la respuesta al webhook — pendiente de confirmar", () => {
  it("hoy contestamos el sobre {respuesta, resultado} con el pedido recibido", () => {
    const event = parseWebhookEvent({
      hash_pedido: "b92a3c6e319f08e49500328cbd342db19cf1cf07eab118414716a5f66d20cee3",
      pagado: true,
      monto: "150000",
    });

    expect(webhookResponseBody(event)).toEqual({
      respuesta: true,
      resultado: [event.raw],
    });
  });
});
