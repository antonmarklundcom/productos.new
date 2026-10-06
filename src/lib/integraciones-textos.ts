import type { MessageKey } from "@/i18n";

import type { Integracion } from "./integraciones";

/**
 * Las claves del catálogo de cada integración y de cada campo, escritas
 * enteras (y no armadas con `` `panel.integraciones.campo.${campo}` ``): el
 * test de i18n busca las claves como literales, y una armada en runtime la
 * daría por muerta. Lo usan el panel y los mensajes de error.
 */

export const TITULO_INTEGRACION: Record<Integracion, MessageKey> = {
  cloudinary: "panel.integraciones.cloudinary.titulo",
  whatsapp: "panel.integraciones.whatsapp.titulo",
  pagopar: "panel.integraciones.pagopar.titulo",
  analitica: "panel.integraciones.analitica.titulo",
  errores: "panel.integraciones.errores.titulo",
};

export const BAJADA_INTEGRACION: Record<Integracion, MessageKey> = {
  cloudinary: "panel.integraciones.cloudinary.bajada",
  whatsapp: "panel.integraciones.whatsapp.bajada",
  pagopar: "panel.integraciones.pagopar.bajada",
  analitica: "panel.integraciones.analitica.bajada",
  errores: "panel.integraciones.errores.bajada",
};

export const ETIQUETA_CAMPO: Record<string, MessageKey> = {
  cloudName: "panel.integraciones.campo.cloudName",
  apiKey: "panel.integraciones.campo.apiKey",
  apiSecret: "panel.integraciones.campo.apiSecret",
  folderPrefix: "panel.integraciones.campo.folderPrefix",
  numeroComercio: "panel.integraciones.campo.numeroComercio",
  phoneNumberId: "panel.integraciones.campo.phoneNumberId",
  accessToken: "panel.integraciones.campo.accessToken",
  apiVersion: "panel.integraciones.campo.apiVersion",
  plantillaLogin: "panel.integraciones.campo.plantillaLogin",
  plantillaRecuperarPedido:
    "panel.integraciones.campo.plantillaRecuperarPedido",
  plantillaPedidoNuevo: "panel.integraciones.campo.plantillaPedidoNuevo",
  plantillaClienteConfirmado:
    "panel.integraciones.campo.plantillaClienteConfirmado",
  plantillaClientePagado: "panel.integraciones.campo.plantillaClientePagado",
  plantillaClienteEnviado: "panel.integraciones.campo.plantillaClienteEnviado",
  plantillaClienteRecordatorio:
    "panel.integraciones.campo.plantillaClienteRecordatorio",
  plantillaClienteResena: "panel.integraciones.campo.plantillaClienteResena",
  plantillaResumenDiario: "panel.integraciones.campo.plantillaResumenDiario",
  plantillaStockDisponible:
    "panel.integraciones.campo.plantillaStockDisponible",
  publicKey: "panel.integraciones.campo.publicKey",
  privateKey: "panel.integraciones.campo.privateKey",
  baseUrl: "panel.integraciones.campo.baseUrl",
  ga4Id: "panel.integraciones.campo.ga4Id",
  metaPixelId: "panel.integraciones.campo.metaPixelId",
  reportUrl: "panel.integraciones.campo.reportUrl",
};

/** Las integraciones que tienen "Probar conexión". */
export const CON_PRUEBA: readonly Integracion[] = [
  "cloudinary",
  "whatsapp",
  "pagopar",
];
