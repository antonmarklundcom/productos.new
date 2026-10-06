import { eq } from 'drizzle-orm';
import type { MessageKey, Params } from '@/i18n';

import { DomainError } from './errors';

import { getDb } from '@/db';
import { bankDetails } from '@/db/schema';
import { t } from '@/i18n';
import { validateRuc } from '@/lib/py';

import type { Executor } from './executor';

/**
 * Los datos bancarios del comercio, editables desde el panel (PLAN.md FASE 2,
 * PR T). Espeja a `admin-shipping.ts`: un módulo de dominio que lee y escribe
 * una tabla chica, con toda la validación adentro de la transacción.
 *
 * **Esto no es plata.** No entra en `computeOrderTotals` ni en ningún total:
 * es el copy que la compradora lee para saber a dónde transferir (la página
 * del pedido, el WhatsApp de recuperación) y el que el panel le muestra al
 * dueño en "por cobrar". Cambiarlo cambia lo que dice una pantalla, nunca
 * cuánto paga alguien. Por eso no hay `assertGs` ni nada por el estilo acá.
 *
 * Lo que sí hay son dos reglas, y las dos salen del mismo lugar: **una cuenta
 * a medias es peor que ninguna.**
 *
 * 1. **Todos-o-nada.** Los cinco campos de texto se guardan juntos o no se
 *    guardan. Media cuenta cargada mostraría un banco sin número, o un número
 *    sin titular, y eso no es "incompleto": es una transferencia que se va a
 *    hacer mal. Sin fila, la página avisa que faltan los datos — que es
 *    exactamente lo que hacía cuando esto vivía sólo en `BANCO_*`.
 *
 * 2. **El RUC se valida con su dígito verificador** (`validateRuc`, módulo 11
 *    de la DNIT). Un RUC mal tipeado no rompe nada en la tienda: rompe la
 *    transferencia de otra persona, en el banco, sin que nadie de este lado se
 *    entere. Es el único de los cinco campos que se puede verificar solo, así
 *    que se verifica.
 *
 * El QR va aparte (`setBankQr`) porque llega por otro camino: un archivo que
 * se sube a Cloudinary, no un campo de texto de un formulario.
 */

export class AdminBankError extends DomainError {
  constructor(code: MessageKey, params?: Params) {
    super(code, params);
    this.name = 'AdminBankError';
  }
}

/** La fila, cruda. Quien la muestra decide qué hacer con `null`. */
export type BankDetailsRow = {
  banco: string;
  titular: string;
  ruc: string;
  cuenta: string;
  tipoCuenta: string;
  qrCloudinaryId: string | null;
  updatedAt: Date;
  updatedBy: number | null;
};

/** Siempre `id = 1`: es un singleton, igual que `setup_state`. */
const SINGLETON_ID = 1;

/**
 * La fila, o `null` si la tienda todavía no cargó sus datos desde el panel.
 *
 * Devuelve `null` también cuando la fila existe pero le falta alguno de los
 * cinco campos: no debería poder pasar —el dominio los exige juntos— pero una
 * fila editada a mano con un cliente de MySQL sí puede quedar así, y la
 * vidriera no puede mostrar medio dato bancario por eso. Ante la duda, se cae
 * al entorno (ver `getDatosBancarios`).
 */
export async function readBankDetails(executor?: Executor): Promise<BankDetailsRow | null> {
  const tx = executor ?? getDb();
  const rows = await tx
    .select()
    .from(bankDetails)
    .where(eq(bankDetails.id, SINGLETON_ID))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const campos = {
    banco: row.banco.trim(),
    titular: row.titular.trim(),
    ruc: row.ruc.trim(),
    cuenta: row.cuenta.trim(),
    tipoCuenta: row.tipoCuenta.trim(),
  };
  if (Object.values(campos).some((valor) => valor === '')) return null;

  return {
    ...campos,
    qrCloudinaryId: row.qrCloudinaryId?.trim() || null,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export type BankDetailsInput = {
  banco: string;
  titular: string;
  ruc: string;
  cuenta: string;
  tipoCuenta: string;
};

const LARGO_MAXIMO: Readonly<Record<keyof BankDetailsInput, number>> = {
  banco: 120,
  titular: 160,
  ruc: 20,
  cuenta: 60,
  tipoCuenta: 60,
};

const ETIQUETA: Readonly<Record<keyof BankDetailsInput, MessageKey>> = {
  banco: 'adminError.banco.campo.banco',
  titular: 'adminError.banco.campo.titular',
  ruc: 'adminError.banco.campo.ruc',
  cuenta: 'adminError.banco.campo.cuenta',
  tipoCuenta: 'adminError.banco.campo.tipoCuenta',
};

/**
 * Normaliza y valida los cinco. Corre **adentro** de la transacción, igual
 * que en `admin-shipping`: la validación es parte de la escritura, no un
 * paso previo que alguien pueda saltearse llamando a la función de abajo.
 */
function normalizar(input: BankDetailsInput): BankDetailsInput {
  const campos = {
    banco: input.banco.trim().replace(/\s+/g, ' '),
    titular: input.titular.trim().replace(/\s+/g, ' '),
    ruc: input.ruc.trim(),
    cuenta: input.cuenta.trim().replace(/\s+/g, ' '),
    tipoCuenta: input.tipoCuenta.trim().replace(/\s+/g, ' '),
  };

  // Todos-o-nada, y el mensaje nombra lo que falta: "guardá los cinco" sin
  // decir cuál es el que quedó vacío obliga a mirar campo por campo.
  const vacios = (Object.keys(campos) as Array<keyof BankDetailsInput>).filter(
    (campo) => campos[campo] === '',
  );
  if (vacios.length > 0) {
    throw new AdminBankError('adminError.banco.incompleto', {
      campos: vacios.map((campo) => etiqueta(campo)).join(', '),
    });
  }

  for (const campo of Object.keys(campos) as Array<keyof BankDetailsInput>) {
    if (campos[campo].length > LARGO_MAXIMO[campo]) {
      throw new AdminBankError('adminError.banco.largo', {
        campo: etiqueta(campo),
        maximo: LARGO_MAXIMO[campo],
      });
    }
  }

  const ruc = validateRuc(campos.ruc);
  if (!ruc.ok || !ruc.normalized) {
    throw new AdminBankError('adminError.banco.ruc', { motivo: ruc.reason ?? '' });
  }
  campos.ruc = ruc.normalized;

  return campos;
}

/** El nombre del campo tal como lo lee el dueño en el formulario. */
function etiqueta(campo: keyof BankDetailsInput): string {
  return t(ETIQUETA[campo]);
}

/**
 * Guarda los cinco campos. Upsert del singleton: no hay "crear" y "editar"
 * separados porque no hay dos filas posibles.
 */
export async function saveBankDetails(input: {
  data: BankDetailsInput;
  actorUserId: number | null;
}): Promise<void> {
  return getDb().transaction(async (tx) => {
    const campos = normalizar(input.data);

    const existente = (
      await tx
        .select({ id: bankDetails.id })
        .from(bankDetails)
        .where(eq(bankDetails.id, SINGLETON_ID))
        .limit(1)
        .for('update')
    )[0];

    if (existente) {
      await tx
        .update(bankDetails)
        .set({ ...campos, updatedBy: input.actorUserId })
        .where(eq(bankDetails.id, SINGLETON_ID));
      return;
    }

    await tx.insert(bankDetails).values({
      id: SINGLETON_ID,
      ...campos,
      qrCloudinaryId: null,
      updatedBy: input.actorUserId,
    });
  });
}

/**
 * Guarda el `public_id` del QR ya subido a Cloudinary.
 *
 * Exige que los datos estén cargados: un QR solo no sirve de nada —la página
 * dibuja la sección entera o no la dibuja— y guardarlo en una fila que no
 * existe obligaría a inventar cinco campos vacíos, que es justo lo que la
 * regla de todos-o-nada evita.
 */
export async function setBankQr(input: {
  qrCloudinaryId: string;
  actorUserId: number | null;
}): Promise<void> {
  const qrCloudinaryId = input.qrCloudinaryId.trim();
  if (qrCloudinaryId === '') throw new AdminBankError('adminError.banco.qrVacio');

  return getDb().transaction(async (tx) => {
    const existente = (
      await tx
        .select({ id: bankDetails.id })
        .from(bankDetails)
        .where(eq(bankDetails.id, SINGLETON_ID))
        .limit(1)
        .for('update')
    )[0];

    if (!existente) throw new AdminBankError('adminError.banco.sinDatosParaQr');

    await tx
      .update(bankDetails)
      .set({ qrCloudinaryId, updatedBy: input.actorUserId })
      .where(eq(bankDetails.id, SINGLETON_ID));
  });
}

/**
 * Saca el QR. **No borra el archivo de Cloudinary**, por el mismo motivo que
 * las fotos de producto: si esa imagen está referenciada en otro lado,
 * borrarla del CDN rompe esa pantalla, y una imagen huérfana no cuesta nada.
 */
export async function clearBankQr(input: { actorUserId: number | null }): Promise<void> {
  return getDb().transaction(async (tx) => {
    const existente = (
      await tx
        .select({ id: bankDetails.id })
        .from(bankDetails)
        .where(eq(bankDetails.id, SINGLETON_ID))
        .limit(1)
        .for('update')
    )[0];

    if (!existente) throw new AdminBankError('adminError.banco.noExiste');

    await tx
      .update(bankDetails)
      .set({ qrCloudinaryId: null, updatedBy: input.actorUserId })
      .where(eq(bankDetails.id, SINGLETON_ID));
  });
}
