// The visual demo uses normal HTML navigation. No server actions or database calls.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const gallery = $(".product-gallery");
if (gallery) {
  $$(".gallery-thumbnails button", gallery).forEach((button) => {
    button.addEventListener("click", () => {
      const source = $("img", button);
      const main = $(".gallery-main img", gallery);
      if (!main || !source) return;
      main.src = source.src;
      main.srcset = source.srcset;
      main.sizes = "(max-width: 1024px) 100vw, 600px";
      $$(".gallery-thumbnails button", gallery).forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    });
  });
  $(".gallery-main", gallery)?.addEventListener("click", () => {
    const image = $(".gallery-main img", gallery)?.cloneNode(true);
    if (!image) return;
    const dialog = document.createElement("dialog");
    dialog.className = "demo-image-dialog";
    const close = document.createElement("button");
    close.textContent = "Cerrar imagen";
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove());
    image.sizes = "90vw";
    dialog.append(close, image);
    document.body.append(dialog);
    dialog.showModal();
  });
}

const mobileTrigger = $('[data-testid="header-menu-trigger"]');
const desktopLinks = $$("header details a");
mobileTrigger?.addEventListener("click", () => {
  const dialog = document.createElement("dialog");
  dialog.className = "demo-menu-dialog";
  const close = document.createElement("button");
  close.textContent = "Cerrar menú";
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  const title = document.createElement("h2");
  title.textContent = "Menú";
  dialog.append(close, title);
  desktopLinks.forEach((link) => dialog.append(link.cloneNode(true)));
  for (const [href, label] of [["/", "Inicio"], ["/envios", "Envíos"], ["/preguntas-frecuentes", "Preguntas frecuentes"], ["/contacto", "Contacto"]]) {
    const link = document.createElement("a"); link.href = href; link.textContent = label; dialog.append(link);
  }
  document.body.append(dialog);
  dialog.showModal();
});

if (location.pathname === "/buscar") {
  const term = new URLSearchParams(location.search).get("q") || "";
  $$('input[name="q"]').forEach((input) => { input.value = term; });
  const normalize = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  let count = 0;
  $$('.demo-search-results [data-testid="product-card"]').forEach((card) => {
    card.hidden = !normalize(card.textContent).includes(normalize(term));
    if (!card.hidden) count++;
  });
  const status = $(".demo-search-status");
  if (status) status.textContent = `${count} productos encontrados`;
}
