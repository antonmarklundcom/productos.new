/** Don't steal focus from a control used during navigation, a dialog or history restore. */
export function mayFocusRoute({ initiated, changedPath, source, active, modalOpen }: {
  initiated: boolean; changedPath: boolean; source: Element | null;
  active: Element | null; modalOpen: boolean;
}): boolean {
  return initiated && changedPath && !modalOpen && (active === source || active === null || active.tagName === "BODY");
}
export function focusRouteHeading(): void {
  const main = document.getElementById("contenido") ?? document.querySelector("main");
  const heading = main?.querySelector<HTMLElement>("h1");
  if (!heading) return;
  const hadTabindex = heading.hasAttribute("tabindex");
  if (!hadTabindex) heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
  if (!hadTabindex) heading.addEventListener("blur", () => heading.removeAttribute("tabindex"), { once: true });
}
