/**
 * Ayudantes chicos que comparten los avisos del sistema por WhatsApp: el aviso
 * al comercio (`order-notifications.ts`) y los avisos a la compradora
 * (`order-customer-notifications.ts`). Separados acá para no repetir el mismo
 * timeout y el mismo recorte de motivo en cada archivo.
 */

/** Más que esto y no vale la pena seguir esperando: lo que dispara el aviso ya está guardado. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Message delivery timeout")),
          ms
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Motivo corto para `order_events.reason`: sin stack, sin número de nadie. */
export function motivoDeAviso(error: unknown): string {
  return safeError(error).message;
}
import { safeError } from "@/lib/safe-error";
