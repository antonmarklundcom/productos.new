/**
 * Rate limit en memoria, ventana deslizante.
 *
 * Alcanza para el slot único de Node de Hostinger, que es donde corre esto.
 * Con más de una instancia hay que moverlo a la DB o a Redis: cada proceso
 * tiene su propio contador y el límite efectivo se multiplica. Está acá
 * aislado justamente para que ese cambio sea de un archivo.
 */

/**
 * La ventana va con la clave: la limpieza de abajo recorre **todas** las
 * claves, y con la ventana de quien la disparaba (una búsqueda de 60 s)
 * borraba los intentos de login de los últimos 15 minutos.
 */
type Bucket = { hits: number[]; windowMs: number };

const buckets = new Map<string, Bucket>();

/** Cada tanto se limpia lo vencido para que el Map no crezca para siempre. */
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 60_000;

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Segundos hasta que se libere un intento. */
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  options: { limit: number; windowMs: number },
  now: number = Date.now()
): RateLimitResult {
  sweep(now);

  const bucket = buckets.get(key) ?? { hits: [], windowMs: options.windowMs };
  const windowStart = now - options.windowMs;
  const hits = bucket.hits.filter((time) => time > windowStart);

  if (hits.length >= options.limit) {
    buckets.set(key, { hits, windowMs: options.windowMs });
    const oldest = hits[0] ?? now;
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldest + options.windowMs - now) / 1000)
      ),
    };
  }

  hits.push(now);
  buckets.set(key, { hits, windowMs: options.windowMs });
  return {
    ok: true,
    remaining: options.limit - hits.length,
    retryAfterSeconds: 0,
  };
}

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    const alive = bucket.hits.filter((time) => time > now - bucket.windowMs);
    if (alive.length === 0) buckets.delete(key);
    else buckets.set(key, { hits: alive, windowMs: bucket.windowMs });
  }
}

/** Sólo para tests. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}

/**
 * Borra el contador de una clave. Se usa después de un login exitoso: el que
 * probó tres contraseñas y acertó no tiene por qué quedar a un intento del
 * bloqueo.
 */
export function resetRateLimitKey(key: string): void {
  buckets.delete(key);
}

/**
 * IP del cliente detrás del proxy de Hostinger.
 *
 * Seleccionar desde el proxy más cercano. El despliegue debe comprobar que
 * éste sobrescribe o agrega XFF; nunca usar esta señal como prueba de identidad.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const chain = forwarded
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean);
    const configured = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
    const hops =
      Number.isInteger(configured) && configured >= 1 && configured <= 10
        ? configured
        : 1;
    const client = chain[chain.length - hops];
    if (client) return client;
  }
  return headers.get("x-real-ip")?.trim() || "desconocida";
}

/**
 * Límite del formulario "buscar mi pedido" (PLAN.md 3.9).
 *
 * Viven acá y no en la server action porque un módulo `"use server"` sólo
 * puede exportar funciones async: exportar una constante deja el módulo sin
 * exports y el build falla con "has no exports at all".
 */
export const LOOKUP_LIMIT = 5;
export const LOOKUP_WINDOW_MS = 15 * 60 * 1000;

/**
 * Límite del login del panel (PLAN.md 4.1).
 *
 * Más apretado que el de "buscar mi pedido": del otro lado hay una contraseña
 * que abre todos los pedidos del comercio, y el dueño es una sola persona que
 * entra una vez por día. Se aplica por IP **y** por email, porque el atacante
 * puede rotar cualquiera de los dos por separado.
 */
export const LOGIN_LIMIT = 8;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Límite del login y del registro de clientes (PLAN.md FASE 2, PR E).
 *
 * Más holgado que el del panel y por un motivo concreto: del otro lado no hay
 * una contraseña que abra todos los pedidos del comercio, sino la de una
 * compradora que ve los suyos. Y la que se equivoca acá es una clienta con el
 * carrito lleno — bloquearla de más es perder la venta, que es el daño que
 * este límite tendría que estar evitando.
 *
 * Sigue siendo mucho más apretado que "sin límite": alcanza para que nadie
 * pruebe contraseñas en volumen, que es lo único que se está cuidando.
 */
export const CUSTOMER_LOGIN_LIMIT = 10;
export const CUSTOMER_LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Límite del alta de cuenta. Más apretado que el login: registrarse es un
 * gesto que se hace una vez, y el volumen sólo puede ser automático.
 */
export const CUSTOMER_REGISTER_LIMIT = 5;
export const CUSTOMER_REGISTER_WINDOW_MS = 60 * 60 * 1000;

/**
 * Límite del pedido de código de acceso (PLAN.md FASE 2, PR F).
 *
 * El más apretado de todos los de cliente, y por un motivo que no es la
 * seguridad de la cuenta: **cada intento manda un WhatsApp**. Un script sin
 * freno acá no adivina nada, pero le llena el teléfono de mensajes a una
 * persona real y le gasta la cuota de Meta al comercio. Por eso el límite es
 * por teléfono además de por IP: el daño se le hace al dueño del número.
 */
export const OTP_REQUEST_LIMIT = 3;
export const OTP_REQUEST_WINDOW_MS = 15 * 60 * 1000;

/**
 * Límite del canje del código. Seis dígitos son un millón de combinaciones y
 * el código vive diez minutos: sin este límite, un script las prueba todas
 * mucho antes de que venza.
 */
export const OTP_VERIFY_LIMIT = 6;
export const OTP_VERIFY_WINDOW_MS = 15 * 60 * 1000;

/**
 * Límite del cron: la ruta es pública y compara un secreto, así que sin esto
 * es un oráculo para adivinarlo a fuerza de intentos.
 */
export const CRON_LIMIT = 30;
export const CRON_WINDOW_MS = 60 * 1000;

/**
 * Límite de la ruta de setup (DEPLOY.md §4).
 *
 * Mucho más apretado que el del cron y a propósito: del otro lado hay un
 * secreto que corre migraciones y crea al dueño de la tienda, y el uso legítimo
 * es **una** llamada por deploy hecha por una persona con un curl. Cualquier
 * volumen mayor que esto es alguien probando secretos.
 */
export const SETUP_LIMIT = 5;
export const SETUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Límite del webhook de Pagopar (PLAN.md 5.2).
 *
 * Más holgado que el resto y a propósito: del otro lado hay avisos de pago
 * reales, y tirar uno cuesta un pedido cobrado que la tienda no marca. Alcanza
 * para que nadie use la ruta como oráculo de firmas —cada intento necesita un
 * sha1 acertado— sin castigar un sábado con muchas ventas. Pagopar reintenta
 * ante un 429, así que un aviso legítimo que caiga acá vuelve.
 */
export const PAGOPAR_WEBHOOK_LIMIT = 120;
export const PAGOPAR_WEBHOOK_WINDOW_MS = 60 * 1000;

/**
 * Límite del checkout.
 *
 * No es contra el fraude con tarjeta —de eso se ocupa Pagopar— sino contra el
 * agotamiento de stock: cada pedido creado reserva unidades por 45 minutos o
 * 24 horas, y nadie tiene que pagar nada para crearlo. Sin límite, un script
 * deja la vidriera entera en "sin stock" con un rato de pedidos que nunca se
 * van a pagar, y el comercio no vende hasta que venzan.
 *
 * Holgado en serio: una familia detrás de un mismo NAT, o un comprador que
 * corrige el formulario cinco veces, tienen que pasar sin fricción. Lo que se
 * corta es el volumen que sólo puede ser automático.
 */
export const CHECKOUT_LIMIT = 20;
export const CHECKOUT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Límite de la cotización de envío.
 *
 * Es sólo lectura —no crea pedidos ni reserva stock— así que no hay nada que
 * agotar del otro lado; lo único que se cuida es el slot de Node, porque cada
 * llamada son tres consultas y la ruta es pública y anónima. Holgado porque el
 * uso legítimo es tipear: la compradora corrige la ciudad, agrega algo al
 * carrito y vuelve, y cada uno de esos gestos cotiza de nuevo.
 */
export const QUOTE_LIMIT = 60;
export const QUOTE_WINDOW_MS = 60 * 1000;

/**
 * "Avisame cuando haya stock" (O6). Dos límites, y son por cosas distintas.
 *
 * Por **IP**: el formulario es público y sin captcha, así que un script puede
 * anotar mil números en un minuto — y cada uno de esos números va a recibir un
 * WhatsApp cuando vuelva el stock, pagado por el comercio.
 *
 * Por **teléfono**, y más apretado: es el mismo razonamiento que el OTP. El
 * daño no se le hace a la tienda sino a la persona del número, que no pidió
 * nada. Tres por día alcanza de sobra para anotarse en las variantes que uno
 * realmente espera.
 */
export const STOCK_ALERT_IP_LIMIT = 5;
export const STOCK_ALERT_IP_WINDOW_MS = 15 * 60 * 1000;
export const STOCK_ALERT_PHONE_LIMIT = 3;
export const STOCK_ALERT_PHONE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Reseñas desde la página del pedido. La puerta de verdad es el token del
 * link y el pedido entregado —sin eso no se escribe nada—, así que esto no es
 * contra spam anónimo sino contra un script con un link válido martillando la
 * acción. Diez por IP cada 15 minutos cubre de sobra un pedido grande
 * calificado producto por producto.
 */
export const REVIEW_IP_LIMIT = 10;
export const REVIEW_IP_WINDOW_MS = 15 * 60 * 1000;
