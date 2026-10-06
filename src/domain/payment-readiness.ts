import type { PaymentMethod } from "@/db/schema";
import { getDatosBancarios } from "@/lib/comercio";
import { isPagoparConfigured } from "./pagopar/config";
import type { Executor } from "./executor";

export async function readyPaymentMethods(
  executor?: Executor
): Promise<PaymentMethod[]> {
  const methods: PaymentMethod[] = ["contra_entrega"];
  if (await getDatosBancarios(executor)) methods.unshift("transferencia");
  if (isPagoparConfigured()) methods.push("tarjeta");
  return methods;
}
