"use server";

import { z } from "zod";

import { cuentasClientesHabilitadas } from "@/lib/cuentas";
import { ORDER_STATUSES, PAYMENT_METHODS } from "@/db/schema";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/order-labels";
import { listOrdersForExport } from "@/domain/admin-orders";
import { listVariantsForExport } from "@/domain/admin-products";
import { listMarketingOptIns } from "@/domain/customers";
import {
  adminActionError,
  requireOwnerSession,
  type AdminActionResult,
} from "@/lib/admin-guard";
import { EXPORT_MAX_ROWS, csvFilename, toCsv } from "@/lib/csv";
import {
  formatDatePY,
  formatDateTimePY,
  parsePyDateInput,
  parsePyDateInputEnd,
} from "@/lib/py";
import { t } from "@/i18n";

/**
 * Exports a CSV del panel.
 *
 * El archivo se arma **en el servidor**, con los mismos filtros que la pantalla
 * está mostrando: si se armara en el navegador con lo que hay en pantalla,
 * bajaría una página de veinte filas creyendo que bajó el listado entero.
 *
 * Igual que toda acción de `/admin`, el guard es la primera línea: una server
 * action es un endpoint HTTP propio y se la puede invocar sin pasar por
 * ninguna URL `/admin` (ARCH.md §1). Acá encima el resultado es la base de
 * datos del comercio en texto plano.
 *
 * Y por eso el guard es `requireOwnerSession()` y no el genérico: un CSV de
 * pedidos es la lista completa de clientes, teléfonos, direcciones y cuánto
 * gastó cada uno, en un archivo que sale del edificio. Es lo que se lleva
 * quien renuncia. Que lo baje el dueño y nadie más (ARCH.md §1).
 */

export type CsvExport = {
  csv: string;
  filename: string;
  rows: number;
  truncated: boolean;
};

const OrdersFiltersSchema = z.object({
  estado: z.enum(ORDER_STATUSES).optional(),
  metodo: z.enum(PAYMENT_METHODS).optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
  q: z.string().optional(),
});

export async function exportOrdersCsv(
  input: unknown
): Promise<AdminActionResult<CsvExport>> {
  try {
    await requireOwnerSession();

    const parsed = OrdersFiltersSchema.safeParse(input ?? {});
    if (!parsed.success) {
      return { ok: false, error: t("adminError.filtros") };
    }

    const rows = await listOrdersForExport({
      status: parsed.data.estado,
      paymentMethod: parsed.data.metodo,
      createdFrom: parsePyDateInput(parsed.data.desde) ?? undefined,
      createdTo: parsePyDateInputEnd(parsed.data.hasta) ?? undefined,
      search: parsed.data.q,
    });

    const csv = toCsv(
      [
        t("csv.pedido.numero"),
        t("csv.pedido.fecha"),
        t("csv.pedido.cliente"),
        t("csv.whatsapp"),
        t("csv.pedido.estado"),
        t("csv.pedido.metodo"),
        t("csv.pedido.total"),
      ],
      rows.map((row) => [
        row.orderNumber,
        formatDateTimePY(row.createdAt),
        row.customerName,
        row.customerPhone,
        ORDER_STATUS_LABEL[row.status],
        PAYMENT_METHOD_LABEL[row.paymentMethod],
        // Entero pelado: la planilla lo tiene que poder sumar.
        row.totalPyg,
      ])
    );

    return {
      ok: true,
      csv,
      filename: csvFilename("pedidos", isoDayPY()),
      rows: rows.length,
      truncated: rows.length === EXPORT_MAX_ROWS,
    };
  } catch (error) {
    return adminActionError("exportOrdersCsv", error);
  }
}

const ProductsFiltersSchema = z.object({
  categoria: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
});

export async function exportProductsCsv(
  input: unknown
): Promise<AdminActionResult<CsvExport>> {
  try {
    await requireOwnerSession();

    const parsed = ProductsFiltersSchema.safeParse(input ?? {});
    if (!parsed.success) {
      return { ok: false, error: t("adminError.filtros") };
    }

    const rows = await listVariantsForExport({
      search: parsed.data.q,
      categoryId: parsed.data.categoria,
    });

    const csv = toCsv(
      [
        t("csv.producto.sku"),
        t("csv.producto.nombre"),
        t("csv.producto.categoria"),
        t("csv.producto.variante"),
        t("csv.producto.precio"),
        t("csv.producto.stock"),
        t("csv.producto.modo"),
        t("csv.producto.mostrarPrecio"),
      ],
      rows.map((row) => [
        row.sku,
        row.productName,
        row.categoryName,
        row.label,
        row.pricePyg,
        row.onHand,
        row.saleMode,
        row.showPrice ? "true" : "false",
      ])
    );

    return {
      ok: true,
      csv,
      filename: csvFilename("productos", isoDayPY()),
      rows: rows.length,
      truncated: rows.length === EXPORT_MAX_ROWS,
    };
  } catch (error) {
    return adminActionError("exportProductsCsv", error);
  }
}

/** `2026-08-07` en día paraguayo, para el nombre del archivo. */
function isoDayPY(): string {
  const [day, month, year] = formatDatePY(new Date()).split("/");
  return `${year}-${month}-${day}`;
}

/**
 * La lista de marketing (PLAN.md FASE 2, PR E.6).
 *
 * Es la única lista de contactos que esta tienda puede usar legítimamente para
 * mandar promociones: **sólo** cuentas activas que marcaron la casilla. No
 * sale de los pedidos —comprar no es aceptar que te escriban— y por eso no
 * existía hasta que existieron las cuentas.
 *
 * `requireOwnerSession()` por el mismo motivo que los otros exports, y con más
 * razón: una lista de gente que consintió recibir mensajes es exactamente lo
 * que se lleva quien se va a trabajar a la competencia.
 */
export async function exportMarketingOptInsCsv(): Promise<
  AdminActionResult<CsvExport>
> {
  try {
    await requireOwnerSession();

    if (!(await cuentasClientesHabilitadas())) {
      return { ok: false, error: t("adminError.sinCuentasClientes") };
    }

    const rows = await listMarketingOptIns();

    const csv = toCsv(
      [
        t("csv.cliente.nombre"),
        t("csv.whatsapp"),
        t("csv.cliente.email"),
        t("csv.cliente.acepto"),
      ],
      rows.map((row) => [
        row.name,
        row.phone,
        row.email ?? "",
        formatDatePY(row.since),
      ])
    );

    return {
      ok: true,
      csv,
      filename: csvFilename("clientes-novedades", isoDayPY()),
      rows: rows.length,
      truncated: false,
    };
  } catch (error) {
    return adminActionError("exportMarketingOptInsCsv", error);
  }
}
