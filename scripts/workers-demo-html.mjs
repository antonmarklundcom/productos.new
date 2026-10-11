/** Resolve already-rendered React Suspense segments without running inline code. */
export function resolveStreamedHtml(document) {
  for (const template of document.querySelectorAll('template[id^="B:"]')) {
    const segment = document.getElementById(`S:${template.id.slice(2)}`);
    if (segment) {
      template.replaceWith(...segment.childNodes);
      segment.remove();
    }
  }
  for (const hidden of document.querySelectorAll('div[hidden]')) {
    const metadata = [...hidden.children].filter((child) => ["TITLE", "META", "LINK"].includes(child.tagName));
    if (metadata.length) {
      document.head.append(...metadata);
      if (!hidden.childNodes.length) hidden.remove();
    }
  }
  for (const input of document.querySelectorAll('input[name="q"]')) {
    input.setAttribute("role", "searchbox");
    input.removeAttribute("aria-controls");
    input.removeAttribute("aria-autocomplete");
    input.removeAttribute("aria-expanded");
  }
}
