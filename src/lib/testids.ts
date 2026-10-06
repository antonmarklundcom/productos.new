/**
 * Contrato de `data-testid` entre la maquinaria (`src/components/**`,
 * checkout, admin) y los specs de `tests/e2e/**`.
 *
 * Antes de este contrato, los specs localizaban por texto y markup del seed
 * —nombres de categoría, slugs de producto demo, textos de botones—, así que
 * cada tienda clonada los rompía al rediseñar la piel (NEW-STORE.md §5). Este
 * módulo es la única fuente de verdad: los componentes ponen estos ids en su
 * markup y los specs los importan en vez de inventar selectores propios.
 *
 * Regla para quien clona la tienda: se puede repintar cualquier markup, pero
 * **no** quitar un `data-testid` de esta lista de un elemento que ya lo tiene
 * (ver NEW-STORE.md §5). Agregar o sacar clases, cambiar el texto visible o
 * mover el elemento de lugar no rompe nada; borrar el atributo sí.
 *
 * `tests/unit/testids-contrato.test.ts` falla si un id de acá deja de
 * aparecer en `src/`.
 */
export const TESTIDS = {
  /** Un link del menú de categorías del header (`site-header.tsx`). */
  headerCategoryLink: "header-category-link",
  /** El botón que abre el carrito (`cart-button.tsx`). */
  headerCartLink: "header-cart-link",
  /** La ficha de producto en una grilla (`product-card.tsx`), con `data-slug`. */
  productCard: "product-card",
  /** Agregar al carrito en la ficha de producto (`add-to-cart.tsx`). */
  productAddToCart: "product-add-to-cart",
  /** "Ir al checkout" en el carrito slide-over (`cart-sheet.tsx`). */
  cartCheckoutLink: "cart-checkout-link",
  /** Campos del checkout (`checkout-form.tsx`). */
  checkoutName: "checkout-name",
  checkoutPhone: "checkout-phone",
  checkoutDocType: "checkout-doc-type",
  checkoutDocNumber: "checkout-doc-number",
  checkoutCity: "checkout-city",
  checkoutAddress: "checkout-address",
  /** Radio de forma de entrega, con `data-slug` del método. */
  checkoutShippingMethod: "checkout-shipping-method",
  /** Radio de medio de pago, con `data-value` (`transferencia` | `contra_entrega` | `tarjeta`). */
  checkoutPaymentMethod: "checkout-payment-method",
  /** La línea de total del checkout, visible recién con la cotización lista. */
  checkoutTotal: "checkout-total",
  checkoutSubmit: "checkout-submit",
  /** El número de pedido en la página de confirmación (`pedido/[orderNumber]`). */
  orderConfirmationNumber: "order-confirmation-number",
  /** Login del panel (`admin/login`, `login-form.tsx`). */
  adminLoginEmail: "admin-login-email",
  adminLoginPassword: "admin-login-password",
  adminLoginSubmit: "admin-login-submit",
  /** El link "Pedidos" del nav del panel (`admin/(panel)/layout.tsx`). */
  adminNavOrders: "admin-nav-orders",
  /** El buscador del listado de pedidos (`admin/order-filters.tsx`). */
  adminOrdersSearchInput: "admin-orders-search-input",
  adminOrdersSearchSubmit: "admin-orders-search-submit",

  // == S9 ==
  /** Campos de seguimiento en el paso intermedio de "Enviado" (`order-actions.tsx`). */
  orderTrackingCarrierInput: "order-tracking-carrier-input",
  orderTrackingCodeInput: "order-tracking-code-input",
  orderTrackingUrlInput: "order-tracking-url-input",
  /** El bloque del formulario de tracking, dentro del paso intermedio. */
  orderTrackingBlockForm: "order-tracking-block-form",
  /** El bloque "Seguimiento" de la ficha del pedido, sólo si hay tracking cargado. */
  orderTrackingBlock: "order-tracking-block",
  /** Link a `/admin/pedidos/[id]/imprimir` desde la ficha del pedido. */
  orderPrintLink: "order-print-link",
  /** Notas internas del pedido (`order-notes.tsx`). */
  orderNotesList: "order-notes-list",
  orderNotesTextarea: "order-notes-textarea",
  orderNotesSubmit: "order-notes-submit",
  /** El bloque de seguimiento en `/pedido/[orderNumber]` (la compradora). */
  pedidoTrackingBlock: "pedido-tracking-block",
  /** La fila de un pedido en `/admin/pedidos`, con `data-order` (el número). */
  adminOrderRowLink: "admin-order-row-link",
  /** Un botón de transición de estado (`order-actions.tsx`), con `data-status`. */
  orderTransitionButton: "order-transition-button",
  /** El botón "Confirmar" del paso intermedio de una transición. */
  orderTransitionConfirm: "order-transition-confirm",

  // == S11 ==
  /** Una ficha en "vistos recientemente" (`recently-viewed.tsx`), con `data-slug`. */
  recentlyViewedItem: "recently-viewed-item",
  /**
   * El form "avisame cuando haya stock" (`stock-alert-form.tsx`). Sólo existe
   * en el DOM cuando `stockAlertsEnabled()` es `true` y la variante elegida no
   * tiene disponibilidad — su ausencia en CI (sin sender) es lo que prueban
   * `compra.spec.ts`/`csp.spec.ts`.
   */
  stockAlertForm: "stock-alert-form",
  stockAlertPhone: "stock-alert-phone",
  stockAlertSubmit: "stock-alert-submit",
  /** El link "Consultar por WhatsApp" de una variante (`variant-inquiry-link.tsx`). */
  variantInquiryLink: "variant-inquiry-link",

  // == S10 ==
  /** Campo "Nombre" y botón "Guardar" de `product-form.tsx`. */
  adminProductNameInput: "admin-product-name-input",
  adminProductSaveSubmit: "admin-product-save-submit",
  /** Checkbox de selección de una fila (`productos/page.tsx`), con `data-id`. */
  adminProductRowSelect: "admin-product-row-select",
  /** "Seleccionar toda la página" (`productos/page.tsx`). */
  adminProductSelectAll: "admin-product-select-all",
  /** La barra de acciones masivas, visible con al menos una fila elegida. */
  adminBulkBar: "admin-bulk-bar",
  adminBulkActivate: "admin-bulk-activate",
  adminBulkDeactivate: "admin-bulk-deactivate",
  adminBulkMoveCategorySelect: "admin-bulk-move-category-select",
  adminBulkMoveCategoryConfirm: "admin-bulk-move-category-confirm",
  /** Abre el diálogo de ajuste masivo de precios (owner, `precios.masivo`). */
  adminBulkPriceOpen: "admin-bulk-price-open",
  adminBulkPricePercent: "admin-bulk-price-percent",
  adminBulkPriceRound: "admin-bulk-price-round",
  adminBulkPriceReason: "admin-bulk-price-reason",
  adminBulkPricePreview: "admin-bulk-price-preview",
  adminBulkPriceConfirm: "admin-bulk-price-confirm",
  /** Duplicar producto, en la ficha (`productos/[id]`). */
  adminProductDuplicate: "admin-product-duplicate",
  /** Punto de reposición de una variante (`variant-editor.tsx`). */
  adminVariantReorderPoint: "admin-variant-reorder-point",
  /** Pestañas del editor de markdown (`markdown-editor.tsx`). */
  adminMarkdownTabEdit: "admin-markdown-tab-edit",
  adminMarkdownTabPreview: "admin-markdown-tab-preview",
  adminMarkdownTextarea: "admin-markdown-textarea",
  adminMarkdownPreview: "admin-markdown-preview",
  /** Formulario de reembolso parcial (`refund-form.tsx`). */
  adminRefundOpen: "admin-refund-open",
  adminRefundAmount: "admin-refund-amount",
  adminRefundReason: "admin-refund-reason",
  adminRefundConfirm: "admin-refund-confirm",

  // == S17 ==
  /** Checkbox "Destacado en la home" (`product-form.tsx`). */
  adminProductFeaturedToggle: "admin-product-featured-toggle",
  /** Chip que marca un producto destacado en el listado (`product-list.tsx`). */
  adminProductFeaturedChip: "admin-product-featured-chip",
  /** Filtro "sólo destacados" del listado (`product-filters.tsx`). */
  adminProductFeaturedFilter: "admin-product-featured-filter",
  /** `<input type="file">` real de la foto de categoría (`categories-manager.tsx`). */
  adminCategoryImageInput: "admin-category-image-input",
  /** Botón "Editar pedido" en la ficha (`pedidos/[id]/page.tsx`), cuando es editable. */
  adminEditOrderOpen: "admin-edit-order-open",
  /** El total del pedido en la ficha del panel, con el valor vigente. */
  adminOrderTotal: "admin-order-total",
  /**
   * Cantidad por línea en el formulario de edición (`edit-order-form.tsx`),
   * con `data-order-item-id`.
   */
  adminEditOrderQty: "admin-edit-order-qty",
  adminEditOrderReason: "admin-edit-order-reason",
  adminEditOrderSubmit: "admin-edit-order-submit",
  /** El resumen "total antes → después" que deja la acción del servidor. */
  adminEditOrderResult: "admin-edit-order-result",
  /** Aviso de que el cupón se quitó al re-cotizar (`couponRemoved`). */
  adminEditOrderCuponQuitado: "admin-edit-order-cupon-quitado",
  /** Botón "Avisar por WhatsApp" con el texto prearmado de la acción. */
  adminEditOrderWhatsapp: "admin-edit-order-whatsapp",
  /** El total en la página pública del pedido (`/pedido/[orderNumber]`). */
  pedidoTotal: "pedido-total",

  // Reseñas verificadas.
  /** Un formulario de reseña por producto (`review-form.tsx`), con `data-product-id`. */
  reviewForm: "review-form",
  /** El radio group de estrellas del formulario. */
  reviewStars: "review-stars",
  reviewBody: "review-body",
  reviewSubmit: "review-submit",
  /** El "¡Gracias!" que reemplaza al formulario enviado. */
  reviewThanks: "review-thanks",
  /** El resumen de estrellas bajo el título de la ficha de producto. */
  productRatingSummary: "product-rating-summary",
  /** La sección "Reseñas" (`#resenas`) de la ficha de producto. */
  productReviewsSection: "product-reviews-section",
  /** Una fila de `/admin/resenas`, con `data-review-id`. */
  adminReviewRow: "admin-review-row",

  // Devoluciones de mercadería.
  /** El bloque "Devoluciones" de la ficha del pedido, con las ya registradas. */
  adminReturnsBlock: "admin-returns-block",
  adminReturnForm: "admin-return-form",
  /** Cantidad por línea (`return-form.tsx`), con `data-order-item-id`. */
  adminReturnQty: "admin-return-qty",
  adminReturnReason: "admin-return-reason",
  adminReturnSubmit: "admin-return-submit",
  /** El link "¿Querés cambiar o devolver algo?" de la página del pedido. */
  pedidoCambioLink: "pedido-cambio-link",

  // == Favoritos ==
  /** Corazón de favoritos (`wishlist-button.tsx`), en la tarjeta o la ficha. */
  wishlistButton: "wishlist-button",
  /** El link "Favoritos" del header (`wishlist-header-link.tsx`). */
  headerWishlistLink: "header-wishlist-link",
  /** La grilla de `/favoritos`. */
  wishlistGrid: "wishlist-grid",
  /** "Compartir por WhatsApp" en `/favoritos`. */
  wishlistShareWhatsapp: "wishlist-share-whatsapp",
  /** "Guardar todos en mis favoritos" al ver una lista compartida (`?p=`). */
  wishlistSaveAll: "wishlist-save-all",

  // == Integraciones (/admin/integraciones) ==
  /** La tarjeta de una integración, con `data-integracion` y `data-estado`. */
  integracionCard: "integracion-card",
  /** "Guardar" de una integración. */
  integracionGuardar: "integracion-guardar",
  /** "Probar conexión" de una integración. */
  integracionProbar: "integracion-probar",
} as const;

export type TestId = (typeof TESTIDS)[keyof typeof TESTIDS];
