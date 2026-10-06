import { headers } from "next/headers";
import Script from "next/script";

import { analyticsConfig } from "@/lib/analytics";

/**
 * Los medidores de la tienda: GA4 y/o Meta Pixel (src/lib/analytics.ts).
 *
 * Sin variables configuradas no renderiza **nada** — ni un byte de terceros —
 * y eso es lo que hace que esté bien tenerlo en el layout del template.
 *
 * El nonce sale del header `x-nonce` que escribe `src/proxy.ts`: sin él, el
 * CSP (script-src 'nonce-…' 'strict-dynamic') bloquea estos scripts. Los que
 * gtag.js o el pixel cargan después heredan la confianza vía 'strict-dynamic';
 * los destinos de red que usan están permitidos en el mismo proxy, y sólo
 * cuando la tienda los configura.
 */
export async function Analytics() {
  const { ga4Id, metaPixelId } = analyticsConfig();
  if (!ga4Id && !metaPixelId) return null;

  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      {ga4Id ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`}
            strategy="afterInteractive"
            nonce={nonce}
          />
          {/* Los ids pasaron el regex de analyticsConfig: acá no puede entrar
              nada que no sea [A-Z0-9-], por eso interpolarlos es seguro. */}
          <Script id="ga4-init" strategy="afterInteractive" nonce={nonce}>
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${ga4Id}');`}
          </Script>
        </>
      ) : null}
      {metaPixelId ? (
        <>
          <Script id="meta-pixel-init" strategy="afterInteractive" nonce={nonce}>
            {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${metaPixelId}');
fbq('track', 'PageView');`}
          </Script>
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              alt=""
              src={`https://www.facebook.com/tr?id=${metaPixelId}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      ) : null}
    </>
  );
}
