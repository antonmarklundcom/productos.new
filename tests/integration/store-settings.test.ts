import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { TIENDA } from "@/config/tienda";
import { storeSettings } from "@/db/schema";
import { DEFAULT_REORDER_POINT } from "@/domain/admin-products";
import { buildDailyDigest } from "@/domain/daily-digest";
import {
  DEFAULT_STORE_SETTINGS,
  StoreSettingsError,
  getStoreSettings,
  readStoreSettings,
  resetStoreSettingsSection,
  saveStoreSettingsSection,
} from "@/domain/store-settings";
import { contactoPublico, whatsappPublico } from "@/lib/comercio";
import { paginaEfectiva, valoresDePlaceholders } from "@/lib/paginas";

import { closeTestDb, getTestDb, hasTestDb, resetTables } from "../helpers/db";
import { createAdminUser, createVariant } from "../helpers/factories";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Ajustes de la tienda contra la base: la fila única de `store_settings`.
 *
 * Lo que se fija acá es lo que no se puede probar sin MySQL: que sin fila la
 * tienda se ve como siempre, que guardar una sección no pisa las otras, que
 * una fila rota no tumba la vidriera, y que `null` sigue mandando al
 * `tienda.ts` y al entorno.
 */
describe.skipIf(!hasTestDb)("store_settings", () => {
  beforeEach(resetTables);
  afterEach(() => vi.unstubAllEnvs());
  afterAll(closeTestDb);

  it("sin fila: los defaults, y la vidriera se ve como antes", async () => {
    const { settings, updatedAt } = await readStoreSettings();
    expect(settings).toEqual(DEFAULT_STORE_SETTINGS);
    expect(updatedAt).toBeNull();
    expect(await getStoreSettings()).toEqual(DEFAULT_STORE_SETTINGS);
  });

  it("guardar una sección crea la fila con quién la guardó", async () => {
    const owner = await createAdminUser();
    await saveStoreSettingsSection(
      "anuncio",
      { activo: true, texto: "Feriado el lunes", href: "" },
      { userId: owner }
    );

    const [fila] = await getTestDb().select().from(storeSettings);
    expect(fila?.id).toBe(1);
    expect(fila?.updatedByUserId).toBe(owner);

    const { settings } = await readStoreSettings();
    expect(settings.anuncio).toEqual({
      activo: true,
      texto: "Feriado el lunes",
      href: null,
    });
  });

  it("guardar una sección no toca las otras", async () => {
    const owner = await createAdminUser();
    await saveStoreSettingsSection(
      "contacto",
      { email: "hola@tienda.com.py" },
      { userId: owner }
    );
    await saveStoreSettingsSection(
      "vidriera",
      { estrellasEnTarjetas: false, barraCompraMovil: true },
      {
        userId: owner,
      }
    );

    const { settings } = await readStoreSettings();
    expect(settings.contacto.email).toBe("hola@tienda.com.py");
    expect(settings.vidriera.estrellasEnTarjetas).toBe(false);
    expect(settings.marca).toEqual(DEFAULT_STORE_SETTINGS.marca);
    // Sigue habiendo una sola fila.
    expect(await getTestDb().select().from(storeSettings)).toHaveLength(1);
  });

  it("las páginas se funden de a una", async () => {
    const owner = await createAdminUser();
    await saveStoreSettingsSection(
      "paginas",
      {
        envios: {
          activo: true,
          titulo: "Cómo enviamos",
          cuerpo: "Texto propio",
        },
      },
      { userId: owner }
    );
    await saveStoreSettingsSection(
      "paginas",
      { terminos: { activo: false, titulo: "", cuerpo: "" } },
      { userId: owner }
    );

    const { settings } = await readStoreSettings();
    expect(settings.paginas.envios).toEqual({
      activo: true,
      titulo: "Cómo enviamos",
      cuerpo: "Texto propio",
    });
    expect(settings.paginas.terminos).toEqual({
      activo: false,
      titulo: null,
      cuerpo: null,
    });
    expect(settings.paginas.privacidad).toEqual({
      activo: false,
      titulo: null,
      cuerpo: null,
    });

    // `null` = el texto por defecto, marcado como tal para el aviso del panel.
    const privacidad = paginaEfectiva(settings, "privacidad");
    expect(privacidad.cuerpoPorDefecto).toBe(true);
    expect(paginaEfectiva(settings, "envios").cuerpoPorDefecto).toBe(false);
  });

  it("un valor inválido no se guarda y no toca lo que había", async () => {
    const owner = await createAdminUser();
    await saveStoreSettingsSection(
      "contacto",
      { email: "hola@tienda.com.py" },
      { userId: owner }
    );

    await expect(
      saveStoreSettingsSection(
        "contacto",
        { instagram: "http://instagram.com/x" },
        { userId: owner }
      )
    ).rejects.toBeInstanceOf(StoreSettingsError);

    expect((await readStoreSettings()).settings.contacto.email).toBe(
      "hola@tienda.com.py"
    );
  });

  it("restaurar vuelve la sección a sus defaults", async () => {
    const owner = await createAdminUser();
    await saveStoreSettingsSection(
      "checkout",
      { confianzaActiva: false, confianzaLineas: ["Una"] },
      {
        userId: owner,
      }
    );
    await resetStoreSettingsSection("checkout", { userId: owner });
    await resetStoreSettingsSection("paginas", { userId: owner });

    const { settings } = await readStoreSettings();
    expect(settings.checkout).toEqual(DEFAULT_STORE_SETTINGS.checkout);
    expect(settings.paginas).toEqual(DEFAULT_STORE_SETTINGS.paginas);
  });

  it("un JSON con la forma equivocada se lee como defaults, sin tirar", async () => {
    await getTestDb()
      .insert(storeSettings)
      .values({
        id: 1,
        data: {
          contacto: "no es un objeto",
          vidriera: { barraCompraMovil: "x" },
        },
      });

    const settings = await getStoreSettings();
    expect(settings.contacto).toEqual(DEFAULT_STORE_SETTINGS.contacto);
    expect(settings.vidriera.barraCompraMovil).toBe(true);

    // Un escalar entero en la columna, también.
    await getTestDb()
      .update(storeSettings)
      .set({ data: "hola" })
      .where(eq(storeSettings.id, 1));
    expect((await readStoreSettings()).settings).toEqual(
      DEFAULT_STORE_SETTINGS
    );
  });

  it("un JSON que ni siquiera es JSON se lee como defaults", async () => {
    // MySQL 8 no deja guardar JSON inválido en una columna JSON (MariaDB, con
    // su CHECK, tampoco): se prueba cambiando el tipo de la columna sólo para
    // este caso, que es lo que haría una restauración a mano mal hecha.
    const db = getTestDb();
    await db.execute(
      sql`ALTER TABLE store_settings MODIFY data LONGTEXT NOT NULL`
    );
    try {
      await db.execute(
        sql`INSERT INTO store_settings (id, data) VALUES (1, '{roto')`
      );
      expect((await readStoreSettings()).settings).toEqual(
        DEFAULT_STORE_SETTINGS
      );
      expect(await getStoreSettings()).toEqual(DEFAULT_STORE_SETTINGS);
    } finally {
      await db.execute(sql`DELETE FROM store_settings`);
      await db.execute(
        sql`ALTER TABLE store_settings MODIFY data JSON NOT NULL`
      );
    }
  });

  it("precedencia: `null` manda al entorno y a tienda.ts; el panel gana", async () => {
    vi.stubEnv("WHATSAPP_NUMBER", "0981 000 000");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");

    // Sin fila: el del entorno, y las páginas con sus defaults.
    expect(await whatsappPublico()).toBe("+595981000000");
    const sinNada = await valoresDePlaceholders();
    expect(sinNada.tienda).toBe(TIENDA.nombre);
    expect(sinNada.whatsapp).toBe("(0981) 000-000");
    expect(sinNada.email).toBeNull();
    expect(sinNada.url).toBeNull();

    const owner = await createAdminUser();
    await saveStoreSettingsSection(
      "contacto",
      { whatsapp: "0971 111 111", email: "hola@tienda.com.py" },
      { userId: owner }
    );
    await saveStoreSettingsSection(
      "envioDevolucion",
      { acceptsReturns: true, returnDays: "7" },
      {
        userId: owner,
      }
    );

    expect(await whatsappPublico()).toBe("+595971111111");
    const contacto = await contactoPublico();
    expect(contacto.email).toBe("hola@tienda.com.py");
    const valores = await valoresDePlaceholders();
    expect(valores.whatsapp).toBe("(0971) 111-111");
    expect(valores.diasDevolucion).toBe("7 días");
    // Sin métodos de envío configurados: los medios del método implícito,
    // sin tarjeta porque Pagopar no está configurado en los tests.
    expect(valores.mediosDePago).not.toContain("Transferencia");
  });

  it("el umbral de stock del panel lo usa el resumen diario", async () => {
    const owner = await createAdminUser();
    // Por encima del umbral de siempre (3), por debajo del del panel (10).
    await createVariant({ onHand: 5 });

    const antes = await buildDailyDigest();
    expect(antes.stockBajo).toHaveLength(0);
    expect(DEFAULT_REORDER_POINT).toBeLessThan(5);

    await saveStoreSettingsSection(
      "stock",
      { umbralStockBajo: "10" },
      { userId: owner }
    );
    const despues = await buildDailyDigest();
    expect(despues.stockBajo).toHaveLength(1);
  });
});
