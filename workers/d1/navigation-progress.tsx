"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { forwardRef, useEffect, useRef, type ComponentProps } from "react";
import { create } from "zustand";
import "./navigation-progress.css";

const useNavigation = create<{pending: boolean; destination: string | null}>(() => ({pending: false, destination: null}));
let timeout: ReturnType<typeof setTimeout> | undefined;
function finish() {
  clearTimeout(timeout);
  useNavigation.setState({pending: false, destination: null});
}
function begin(href: string) {
  const next = new URL(href, window.location.href);
  if (next.origin !== window.location.origin ||
    (next.pathname === window.location.pathname && next.search === window.location.search)) return;
  useNavigation.setState({pending: true, destination: next.pathname + next.search});
  clearTimeout(timeout);
  timeout = setTimeout(finish, 15000);
}
export function navigateWithProgress(router: ReturnType<typeof useRouter>, href: string, options?: {scroll?: boolean}) {
  begin(href);
  try { router.push(href, options); } catch (error) { finish(); throw error; }
}
export function NavigationProgress() {
  const pathname = usePathname(), params = useSearchParams();
  const route = pathname + "?" + params.toString();
  const pending = useNavigation(state => state.pending);
  const previous = useRef(route);
  useEffect(() => {
    if (previous.current !== route) { previous.current = route; finish(); }
  }, [route]);
  useEffect(() => {
    const content = document.getElementById("contenido");
    content?.setAttribute("aria-busy", String(pending));
    return () => { content?.removeAttribute("aria-busy"); };
  }, [pending]);
  useEffect(() => {
    window.addEventListener("popstate", finish);
    window.addEventListener("pageshow", finish);
    return () => { window.removeEventListener("popstate", finish); window.removeEventListener("pageshow", finish); finish(); };
  }, []);
  return pending ? <div className="catalog-navigation-progress" role="status" aria-live="polite">
    <span className="sr-only">Cargando página…</span><div aria-hidden="true" />
  </div> : null;
}

// Only explicit intent prefetches. No viewport prefetch or speculative catalogue fan-out.
let budgetRoute = "", prefetched = new Set<string>();
export const CatalogLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof Link>>(function CatalogLink(
  {href, onNavigate, onMouseEnter, onMouseLeave, onFocus, onBlur, onTouchStart, onTouchMove, onTouchCancel, ...props}, ref,
) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  const intent = () => {
    if (typeof href !== "string") return;
    const connection = (navigator as Navigator & {connection?: {saveData?: boolean; effectiveType?: string}}).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "")) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || url.search || url.hash ||
      !(url.pathname === "/" || /^\/(categoria|producto)\/[a-z0-9-]+\/?$/.test(url.pathname))) return;
    const current = window.location.pathname + window.location.search;
    if (budgetRoute !== current) { budgetRoute = current; prefetched = new Set(); }
    const target = url.pathname;
    if (target === window.location.pathname || prefetched.has(target) || prefetched.size >= 6) return;
    cancel();
    timer.current = setTimeout(() => {
      if (window.location.pathname + window.location.search !== current || prefetched.has(target) || prefetched.size >= 6) return;
      prefetched.add(target);
      try {
        // Vinext auto-prefetch may fetch only a non-reusable dynamic shell.
        // Its full mode uses the bounded 30-second static cache in vite.config.ts.
        const options = {kind: "full" as NonNullable<Parameters<typeof router.prefetch>[1]>["kind"], onInvalidate: () => {}};
        router.prefetch(target, options);
      } catch { /* Clicking still performs normal navigation. */ }
    }, 120);
  };
  return <Link {...props} ref={ref} href={href} prefetch={false}
    onNavigate={event => {
      cancel(); // A quick tap must not start a second prefetch after navigation begins.
      let cancelled = false;
      onNavigate?.({preventDefault() { cancelled = true; event.preventDefault(); }});
      if (!cancelled && typeof href === "string") begin(href);
    }}
    onMouseEnter={event => { onMouseEnter?.(event); if (!event.defaultPrevented) intent(); }}
    onMouseLeave={event => { onMouseLeave?.(event); cancel(); }}
    onFocus={event => { onFocus?.(event); if (!event.defaultPrevented) intent(); }}
    onBlur={event => { onBlur?.(event); cancel(); }}
    onTouchStart={event => { onTouchStart?.(event); if (!event.defaultPrevented) intent(); }}
    onTouchMove={event => { onTouchMove?.(event); cancel(); }}
    onTouchCancel={event => { onTouchCancel?.(event); cancel(); }} />;
});
