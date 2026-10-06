/**
 * Catálogo de mensajes — **es-PY, el idioma por defecto y el fallback**.
 *
 * Reglas para editarlo, que son las que hacen que traducir sea posible:
 *
 * 1. **Las claves son el contrato.** Un catálogo de otro idioma copia este
 *    archivo y cambia sólo los valores. Hay un test de CI que exige que todos
 *    los catálogos registrados tengan exactamente estas claves.
 * 2. **Una clave por frase completa**, no por pedacito. Partir "Te faltan ₲X
 *    para el envío gratis" en tres claves obliga a quien traduce a adivinar el
 *    orden de las palabras, y hay idiomas donde el orden es otro.
 * 3. **Los `{parámetros}` van con nombre**, nunca por posición: `{n}`,
 *    `{nombre}`, `{monto}`. Quien traduce los puede mover de lugar.
 * 4. **Los plurales van de a dos claves**, `<base>.uno` y `<base>.varios`, y
 *    se leen con `tPlural()`. Las dos reciben `{n}`.
 * 5. **La plata no se traduce.** Los montos los formatea `formatGs()` y
 *    entran como parámetro ya armado (`₲ 35.000`): la moneda de este template
 *    es el guaraní, y cambiarla no es traducir (PLAN.md, PR P–S).
 *
 * Ordenado por área de la tienda, y adentro de cada área por dónde aparece en
 * la pantalla. Para encontrar algo, buscá el texto: está literal.
 */
export const esPY = {
  "carrito.problema.soloConsulta":
    "{nombre} es un producto de consulta o catálogo y no admite compra online.",
  "producto.soloConsulta":
    "Consultá disponibilidad y condiciones con el comercio.",
  "producto.muestra":
    "Producto de catálogo. Las condiciones se confirman con el comercio.",
  "producto.precioOrientativo": "Precio orientativo; se confirma al consultar.",
  "panel.producto.modo": "Cómo se ofrece este producto",
  "panel.producto.modo.stock": "Compra online con stock",
  "panel.producto.modo.enquiry": "Consulta por WhatsApp",
  "panel.producto.modo.showcase": "Sólo catálogo",
  "panel.producto.dropiUrl": "Dropi URL (privada, opcional)",
  "panel.producto.dropiUrlAyuda":
    "Referencia del proveedor, visible sólo en el panel.",
  "panel.producto.mostrarPrecio":
    "Mostrar precio (siempre visible para compra online)",
  "error.checkout.pagoNoDisponible":
    "Este medio de pago ya no está disponible. Elegí otro o contactá al comercio.",
  "panel.avisos.titulo": "Avisos del pedido",
  "panel.avisos.pendiente": "Pendiente de envío",
  "panel.avisos.enviando": "Envío en curso",
  "panel.avisos.enviado": "Aceptado por el proveedor",
  "panel.avisos.rechazado": "Rechazado por el proveedor",
  "panel.avisos.desconocido": "Entrega por confirmar",
  "panel.avisos.dueno": "Pedido nuevo al comercio",
  "panel.avisos.confirmado": "Confirmación de pedido",
  "panel.avisos.pagado": "Confirmación de pago",
  "panel.avisos.despachado": "Despacho",
  "panel.avisos.recordatorio": "Recordatorio de pago",
  "panel.avisos.resena": "Invitación a reseña",
  "panel.avisos.intentos": "{n} intento(s)",
  "panel.avisos.reintentar": "Reintentar aviso",
  "panel.avisos.incierto":
    "La entrega es incierta. Revisá el proveedor antes de reintentar: el cliente podría recibir un duplicado.",
  "panel.avisos.confirmar":
    "Confirmo que revisé la entrega y acepto un posible duplicado.",
  "error.operacion.reutilizada":
    "Este formulario ya se envió con otros datos. Recargá la página para iniciar una operación nueva.",
  "cuenta.password.titulo": "Contraseña de tu cuenta",
  "cuenta.password.verificada":
    "Verificamos tu WhatsApp. Elegí una contraseña nueva para proteger tu cuenta.",
  "cuenta.password.nueva": "Nueva contraseña",
  "cuenta.password.guardada":
    "Contraseña guardada. Las sesiones anteriores se cerraron.",
  "buscarPedido.recuperacion":
    "Revisá WhatsApp. Si no recibís el enlace, contactá a la tienda para recuperar tu pedido.",
  // -------------------------------------------------------------------------
  // Header y pie
  // -------------------------------------------------------------------------
  "header.categorias": "Categorías",
  "header.buscar.placeholder": "Buscar productos…",
  "header.buscar.label": "Buscar productos",
  "header.buscar.sugerencias": "Sugerencias",
  "header.buscar.verTodos": "Ver todos los resultados de “{termino}”",

  "footer.categorias": "Categorías",
  "footer.contacto": "Contacto",
  "footer.whatsapp": "WhatsApp {telefono}",
  "footer.seguirPedido": "Seguí tu pedido",

  "whatsapp.flotante.label": "Escribinos por WhatsApp",
  "whatsapp.flotante.nav": "Contacto por WhatsApp",
  "whatsapp.consultaGenerica": "¡Hola! Tengo una consulta sobre un producto.",

  // -------------------------------------------------------------------------
  // Home
  // -------------------------------------------------------------------------
  "home.hero.titulo": "Comprá fácil, pagá como quieras",
  "home.hero.texto":
    "Transferencia, QR o contra entrega. Precios en guaraníes con IVA incluido y envíos a todo el país. ¿Dudas? Escribinos por WhatsApp.",
  "home.hero.cta": "Ver productos",
  "home.categorias": "Categorías",
  "home.categorias.verTodo": "Ver todo →",
  "home.destacados": "Destacados",
  "home.sinProductos":
    "Catálogo en preparación",
  "home.errorCatalogo": "Nuestro catálogo todavía no está disponible.",
  "home.errorCatalogo.ayuda":
    "Podés explorar las categorías y volver a consultar más adelante.",

  // -------------------------------------------------------------------------
  // Catálogo: fichas, precios, stock
  // -------------------------------------------------------------------------
  "catalogo.productos.uno": "{n} producto",
  "catalogo.productos.varios": "{n} productos",
  "catalogo.opciones": "{n} opciones",
  "catalogo.ivaIncluidoNota": "precios con IVA incluido",
  "catalogo.tituloOculto": "Productos",
  "catalogo.sinFoto": "{nombre} (sin foto todavía)",

  "precio.ivaIncluido": "IVA incluido",

  "stock.sin": "Sin stock",
  "stock.ultima": "Última unidad",
  "stock.quedan": "Quedan {n}",
  "stock.disponible": "Disponible",

  // -------------------------------------------------------------------------
  // Filtros de categoría
  // -------------------------------------------------------------------------
  "filtros.marca.label": "Filtrar por marca",
  "filtros.marca.todas": "Todas las marcas",
  "filtros.marca.conCuenta": "{marca} ({n})",
  "filtros.precio.label": "Filtrar por precio",
  "filtros.precio.cualquiera": "Cualquier precio",
  "filtros.orden.label": "Ordenar",
  "filtros.orden.relevancia": "Más relevantes",
  "filtros.orden.precioAsc": "Precio: menor a mayor",
  "filtros.orden.precioDesc": "Precio: mayor a menor",
  "filtros.orden.nuevos": "Más nuevos",
  "filtros.quitar": "Quitar el filtro {filtro}",
  "filtros.limpiarTodo": "Limpiar todo",

  "precio.rango.hasta": "Hasta {monto}",
  "precio.rango.entre": "{desde} a {hasta}",
  "precio.rango.masDe": "Más de {monto}",

  // -------------------------------------------------------------------------
  // Carrito
  // -------------------------------------------------------------------------
  "carrito.abrir": "Abrir carrito",
  "carrito.abrirCon": "Abrir carrito ({n})",
  "carrito.boton": "Carrito",
  "carrito.titulo": "Tu carrito",
  "carrito.descripcion":
    "Los precios se confirman con el servidor. Todo incluye IVA.",
  "carrito.vacio": "Tu carrito está vacío.",
  "carrito.seguirComprando": "Seguí comprando",
  "carrito.quitar": "Quitar",
  "carrito.subtotal": "Subtotal",
  "carrito.envioEnCheckout":
    "El envío se calcula en el checkout según tu ciudad.",
  "carrito.irAlCheckout": "Ir al checkout",
  "carrito.consultarWhatsApp": "¿Tenés una duda? Consultanos por WhatsApp",
  "carrito.abriendoWhatsApp": "Abriendo WhatsApp…",

  "carrito.problema.noDisponible":
    "{nombre} se quedó sin stock y lo sacamos del carrito.",
  "carrito.problema.stockParcial":
    "De {nombre} quedan {disponible} (pediste {pedido}).",
  "carrito.problema.precioCambio":
    "El precio de {nombre} cambió mientras estaba en tu carrito.",

  "cantidad.label": "Cantidad",
  "cantidad.quitarUno": "Quitar uno",
  "cantidad.agregarUno": "Agregar uno",

  // -------------------------------------------------------------------------
  // Favoritos (sin cuenta, en el navegador)
  // -------------------------------------------------------------------------
  "favoritos.guardar": "Guardar en favoritos",
  "favoritos.quitar": "Quitar de favoritos",
  "favoritos.agregado": "Guardado en favoritos",
  "favoritos.quitado": "Sacado de favoritos",
  "favoritos.abrir": "Favoritos",
  "favoritos.abrirCon": "Favoritos ({n})",
  "favoritos.titulo": "Tus favoritos",
  "favoritos.tituloCompartido": "Favoritos que te compartieron",
  "favoritos.vacio": "Todavía no guardaste ningún producto.",
  "favoritos.vacio.ayuda": "Tocá el corazón de un producto para guardarlo acá.",
  "favoritos.vacio.irAlInicio": "Ver el catálogo",
  "favoritos.compartirWhatsApp": "Compartir por WhatsApp",
  "favoritos.compartirWhatsApp.texto": "¡Mirá lo que guardé en favoritos!",
  "favoritos.guardarTodos": "Guardar todos en mis favoritos",
  "favoritos.meta": "Favoritos",

  // -------------------------------------------------------------------------
  // Envío gratis
  // -------------------------------------------------------------------------
  "envioGratis.alcanzado": "¡Tenés envío gratis!",
  "envioGratis.falta": "Te faltan {monto} para el envío gratis.",
  "envioGratis.indefinidoConMonto":
    "En algunas zonas el envío es gratis desde {monto}. Poné tu ciudad en el checkout y te decimos la tuya.",
  "envioGratis.indefinido":
    "Puede que tengas envío gratis: depende de tu ciudad. Ponela en el checkout y te decimos.",

  // -------------------------------------------------------------------------
  // Ficha de producto
  // -------------------------------------------------------------------------
  "producto.elegiOpcion": "Elegí una opción",
  "producto.agregar": "Agregar al carrito",
  "producto.agregado": "Agregado al carrito",
  "producto.consultaWhatsApp":
    '¡Hola! Me interesa "{nombre}". ¿Está disponible?',
  "producto.dudaWhatsApp": "¿Tenés una duda? Consultanos por WhatsApp",
  "producto.descripcion": "Descripción",
  "producto.iva": "IVA",
  "producto.ivaValor": "{tasa}% incluido en el precio",
  "producto.disponibilidad": "Disponibilidad",
  "producto.unidades": "{n} unidades",
  "producto.desde": "Desde",
  "producto.relacionados": "También te puede interesar",
  "producto.noEncontrado": "Producto no encontrado",
  "producto.metaDescripcion": "{nombre} — {precio}, IVA incluido.",

  // -------------------------------------------------------------------------
  // Copiar datos bancarios
  // -------------------------------------------------------------------------
  "copiar.boton": "Copiar",
  "copiar.listo": "¡Copiado!",
  "copiar.ok": "{campo} copiado",
  "copiar.error": "No se pudo copiar. Copialo a mano.",

  // -------------------------------------------------------------------------
  // Navegación común
  // -------------------------------------------------------------------------
  "nav.inicio": "Inicio",
  "nav.paginacion": "Paginación",
  "nav.anterior": "Anterior",
  "nav.siguiente": "Siguiente",
  "nav.pagina": "Página {actual} de {total}",

  // -------------------------------------------------------------------------
  // Categoría
  // -------------------------------------------------------------------------
  "categoria.meta": "Categoría",
  "categoria.metaDescripcion":
    "{nombre} en guaraníes, IVA incluido. Envíos a todo Paraguay.",
  "categoria.sinResultados": "No encontramos productos con esos filtros",
  "categoria.sinResultados.ayuda":
    "Probá quitando la marca o ampliando el rango de precio.",
  "categoria.verTodo": "Ver toda la categoría",

  // -------------------------------------------------------------------------
  // Buscador
  // -------------------------------------------------------------------------
  "buscar.meta": "Buscar",
  "buscar.titulo": "Buscar productos",
  "buscar.resultadosPara": "Resultados para “{termino}”",
  "buscar.minimo": "Escribí al menos dos letras para buscar.",
  "buscar.nada": "No encontramos nada con “{termino}”",
  "buscar.nada.ayuda": "Probá con menos palabras, o mirá las categorías.",

  // -------------------------------------------------------------------------
  // Páginas de error
  // -------------------------------------------------------------------------
  "error404.codigo": "Error 404",
  "error404.titulo": "No encontramos esta página",
  "error404.texto":
    "Puede que el producto ya no esté publicado o que el link esté mal copiado.",
  "error404.inicio": "Ir al inicio",
  "error404.buscarPedido": "Buscar mi pedido",

  "error.titulo": "Algo salió mal",
  "error.texto":
    "Tuvimos un problema cargando esta página. Probá de nuevo en unos segundos.",
  "error.ref": "Ref: {digest}",
  "error.reintentar": "Reintentar",

  // -------------------------------------------------------------------------
  // Checkout
  // -------------------------------------------------------------------------
  "checkout.meta": "Checkout",
  "checkout.titulo": "Finalizá tu compra",
  "checkout.bajadaConCuenta": "Ya tenemos tus datos: revisalos y confirmá.",
  "checkout.bajadaInvitado":
    "Sin cuenta ni registro: guardá el enlace privado para seguir tu pedido.",
  "checkout.carritoVacio": "Tu carrito está vacío",
  "checkout.verProductos": "Ver productos",

  "checkout.nombre": "Nombre y apellido",
  "checkout.whatsapp": "WhatsApp",
  "checkout.whatsapp.placeholder": "0981 123 456",
  "checkout.email": "Email",
  "checkout.opcional": "(opcional)",
  "checkout.email.placeholder": "tucorreo@ejemplo.com",
  "checkout.email.ayuda":
    "Por si tu WhatsApp falla. No es obligatorio y no lo usamos para nada más.",

  "checkout.documento": "Documento",
  "checkout.documento.ninguno": "Consumidor final",
  "checkout.documento.ci": "Cédula",
  "checkout.documento.ruc": "RUC",
  "checkout.documento.rucLabel": "RUC (con DV)",
  "checkout.documento.ciLabel": "Nro. de cédula",

  "checkout.ciudad": "Ciudad",
  "checkout.barrio": "Barrio",
  "checkout.direccion": "Dirección",
  "checkout.referencia": "Referencia (opcional)",
  "checkout.referencia.placeholder": "Casa de portón verde, entre X e Y",

  "checkout.pago.pregunta": "¿Cómo querés pagar?",
  "checkout.pago.transferencia": "Transferencia / QR (SPI)",
  "checkout.pago.transferencia.ayuda":
    "Te pasamos los datos y subís el comprobante.",
  "checkout.pago.contraEntrega": "Contra entrega",
  "checkout.pago.contraEntrega.ayuda":
    "Pagás en efectivo cuando recibís el pedido.",
  "checkout.pago.tarjeta": "Tarjeta / Pagopar",
  "checkout.pago.tarjeta.ayuda":
    "Pagás online, ahora, con tarjeta u otros medios de Pagopar.",
  "checkout.pago.sinOpciones":
    "Esa forma de entrega no tiene ningún medio de pago habilitado. Elegí otra.",

  "checkout.envio.pregunta": "¿Cómo querés recibirlo?",
  "checkout.envio.sinMetodos":
    "No tenemos ninguna forma de entrega para esa ciudad. Escribinos por WhatsApp y lo resolvemos.",
  "envio.metodo.implicito": "Envío a domicilio",

  "checkout.regalo": "Es un regalo",
  "checkout.regalo.ayuda":
    "Lo preparamos para regalar y, si querés, le sumamos un mensaje.",
  "checkout.regalo.mensaje": "Mensaje para la tarjeta (opcional)",
  "checkout.regalo.mensaje.placeholder": "¡Feliz cumple! Con mucho cariño.",

  "checkout.novedades": "Quiero recibir novedades y promociones",
  "checkout.novedades.ayuda":
    "{tienda} te escribe al WhatsApp que pusiste arriba, sólo por ofertas y productos nuevos. Nunca por este pedido —eso te llega igual— y nunca le pasamos tu número a nadie. Pedinos que te saquemos cuando quieras.",

  "checkout.cupon.pregunta": "¿Tenés un código de descuento?",
  "checkout.cupon.label": "Código de descuento",
  "checkout.cupon.placeholder": "BIENVENIDA",
  "checkout.cupon.aplicar": "Aplicar",
  "checkout.cupon.aplicado": "Listo: {codigo} descuenta {monto}.",
  "checkout.cupon.quitar": "Quitar",
  "checkout.cupon.faltaCiudad":
    "Poné tu ciudad para ver el total con el descuento aplicado.",

  "checkout.subtotal": "Subtotal (IVA incluido)",
  "checkout.descuento": "Descuento",
  "checkout.descuentoCon": "Descuento — {codigo}",
  "checkout.envio": "Envío",
  "checkout.envioCon": "Envío — {zona}",
  "checkout.envioGratis": "Gratis",
  "checkout.total": "Total",
  "checkout.nota.faltaCiudad":
    "Poné tu ciudad y te calculamos el envío antes de confirmar.",
  "checkout.nota.masCara":
    "No encontramos tu ciudad en nuestras zonas: te cotizamos la tarifa más alta ({zona}). Escribinos por WhatsApp y lo revisamos.",
  "checkout.nota.exacta": "El total se confirma al crear el pedido.",
  "checkout.confirmar": "Confirmar pedido",
  "checkout.confirmando": "Creando tu pedido…",

  // -------------------------------------------------------------------------
  // Cupones rechazados
  // -------------------------------------------------------------------------
  "cupon.rechazo.noExiste": "Ese código no existe o ya no está disponible.",
  "cupon.rechazo.noEmpezo": "Ese código todavía no está vigente.",
  "cupon.rechazo.vencido": "Ese código ya venció.",
  "cupon.rechazo.agotado": "Ese código ya se usó todas las veces disponibles.",
  "cupon.rechazo.agotadoParaVos":
    "Ya usaste ese código la cantidad de veces permitida.",
  "cupon.rechazo.minimo": "Tu compra no llega al mínimo que pide ese código.",
  "cupon.rechazo.minimoConMonto":
    "Ese código pide una compra mínima de {minimo}.",
  "cupon.rechazo.minimoConFalta":
    "Ese código pide una compra mínima de {minimo}: te faltan {falta}.",
  "cupon.rechazo.soloClientes":
    "Ese código es sólo para quienes tienen cuenta.",

  // -------------------------------------------------------------------------
  // Buscar un pedido
  // -------------------------------------------------------------------------
  "buscarPedido.meta": "Buscar mi pedido",
  "buscarPedido.titulo": "Buscá tu pedido",
  "buscarPedido.bajada":
    "Si perdiste el enlace privado, ingresá el número de pedido y el teléfono que usaste al comprar para solicitar su recuperación.",
  "buscarPedido.numero": "Número de pedido",
  "buscarPedido.numero.placeholder": "PY-000123",
  "buscarPedido.telefono": "WhatsApp usado en la compra",
  "buscarPedido.boton": "Buscar mi pedido",
  "buscarPedido.buscando": "Buscando…",

  // -------------------------------------------------------------------------
  // La página del pedido (la que le llega por WhatsApp)
  // -------------------------------------------------------------------------
  "pedido.meta": "Tu pedido",
  "pedido.etiqueta": "Pedido",
  "pedido.estado": "Estado:",
  "pedido.consultaWhatsApp":
    "¡Hola! Te escribo por mi pedido {numero} ({total}).",

  "pedido.transferencia.titulo": "Pagá por transferencia o QR",
  "pedido.transferencia.bajada":
    "Transferí el total exacto y subí el comprobante acá abajo. Lo revisamos y te confirmamos.",
  "pedido.banco.banco": "Banco",
  "pedido.banco.titular": "Titular",
  "pedido.banco.ruc": "RUC",
  "pedido.banco.total": "Total a transferir (₲)",
  "pedido.banco.qrAlt": "Código QR para pagar por SPI",
  "pedido.banco.qrAyuda": "O escaneá el QR desde la app de tu banco.",
  "pedido.banco.sinDatos":
    "Los datos bancarios del comercio todavía no están configurados. Escribinos por WhatsApp con tu número de pedido y te los pasamos a mano mientras tanto.",
  "pedido.pasos.1":
    "Abrí la app de tu banco y elegí transferencia por SPI o pago por QR.",
  "pedido.pasos.2":
    "Copiá el banco, titular, RUC y número de cuenta de arriba (o escaneá el QR).",
  "pedido.pasos.3":
    "Copiá el total exacto —{total}— y pegalo como monto. No redondees ni cambies el número.",
  "pedido.pasos.4": "Confirmá la transferencia.",
  "pedido.pasos.5": "Sacá una captura del comprobante y subila acá abajo.",

  "pedido.comprobante.titulo": "Subí tu comprobante",
  "pedido.comprobante.waAyuda":
    "También podés mandarnos el comprobante directo por WhatsApp:",
  "pedido.comprobante.waBoton": "Enviar comprobante por WhatsApp",
  "pedido.comprobante.waMensaje":
    "¡Hola! Ya transferí el pedido {numero} por {total}. Te mando el comprobante. Podés ver el pedido acá: {url}",

  "pedido.items.titulo": "Tu pedido",
  "pedido.subtotal": "Subtotal",
  "pedido.descuento": "Descuento",
  "pedido.descuentoCon": "Descuento — {codigo}",
  "pedido.envio": "Envío",
  "pedido.total": "Total",
  "pedido.iva10": "IVA 10% incluido",
  "pedido.iva5": "IVA 5% incluido",

  "pedido.envio.titulo": "Envío",
  "pedido.envio.referencia": "Ref: {referencia}",
  "pedido.seguimiento": "Seguimiento",
  "pedido.escribinos": "Escribinos por WhatsApp",
  "pedido.seguirComprando": "Seguir comprando",

  "pedido.subirComprobante.maximo":
    "Ya subiste el máximo de comprobantes. Si hubo un problema, escribinos por WhatsApp.",
  "pedido.subirComprobante.campo": "Comprobante (JPG, PNG o PDF, hasta 5 MB)",
  "pedido.subirComprobante.enviar": "Enviar comprobante",
  "pedido.subirComprobante.enviando": "Subiendo…",
  "pedido.subirComprobante.recibido":
    "Comprobante recibido. Lo revisamos y te avisamos.",

  // -------------------------------------------------------------------------
  // Vuelta de Pagopar
  // -------------------------------------------------------------------------
  "pagopar.meta": "Volviendo de Pagopar",
  "pagopar.noEncontrado": "No encontramos tu pedido",
  "pagopar.noEncontrado.texto":
    "Volviste de Pagopar pero no pudimos identificar el pedido desde acá. Si ya pagaste, no te preocupes: tu comprobante de pedido te llegó por WhatsApp con el link para seguirlo.",
  "pagopar.buscar": "Buscar mi pedido con el número y mi WhatsApp",

  // -------------------------------------------------------------------------
  // Cuentas de cliente (sólo se ven con `TIENDA.cuentasClientes` prendido)
  // -------------------------------------------------------------------------
  "cuenta.header.entrar": "Entrar",
  "cuenta.header.miCuenta": "Mi cuenta",

  "cuenta.meta": "Mi cuenta",
  "cuenta.hola": "Hola, {nombre}",
  "cuenta.salir": "Salir",
  "cuenta.saliendo": "Saliendo…",
  "cuenta.pedidos": "Mis pedidos",
  "cuenta.pedidos.vacio": "Todavía no hiciste ningún pedido con esta cuenta.",
  "cuenta.pedidos.mira": "Mirá lo que hay",
  "cuenta.pedidos.invitada":
    "Si compraste antes de crear esta cuenta, esos pedidos no aparecen todavía. Seguilos con su enlace privado.",
  "cuenta.datos": "Mis datos",
  "cuenta.datos.whatsapp": "WhatsApp:",
  "cuenta.datos.whatsappNota":
    "Es la llave de tu cuenta, así que no se cambia desde acá. Escribinos si lo necesitás.",
  "cuenta.datos.novedades":
    "Quiero recibir novedades y promociones por WhatsApp.",
  "cuenta.datos.guardar": "Guardar",
  "cuenta.datos.guardando": "Guardando…",
  "cuenta.datos.guardado": "Listo, guardamos tus datos.",

  "cuenta.entrar.meta": "Entrar a tu cuenta",
  "cuenta.entrar.titulo": "Entrá a tu cuenta",
  "cuenta.entrar.bajada":
    "Para ver tus pedidos y no volver a tipear tus datos.",
  "cuenta.entrar.identificador": "WhatsApp o email",
  "cuenta.entrar.password": "Contraseña",
  "cuenta.entrar.boton": "Entrar",
  "cuenta.entrar.entrando": "Entrando…",
  "cuenta.entrar.sinCuenta": "¿Todavía no tenés cuenta?",
  "cuenta.entrar.crear": "Creá una",
  "cuenta.entrar.noHaceFalta":
    "No hace falta cuenta para comprar. Podés hacer tu pedido como invitada y seguirlo con su enlace privado.",

  "cuenta.codigo.titulo": "¿No te acordás la contraseña?",
  "cuenta.codigo.bajada":
    "Te mandamos un código por WhatsApp y entrás con eso.",
  "cuenta.codigo.pedir": "Mandame un código",
  "cuenta.codigo.mandando": "Mandando…",
  "cuenta.codigo.aviso":
    "Si hay una cuenta con ese WhatsApp, te mandamos un código de 6 dígitos. Vence en 10 minutos.",
  "cuenta.codigo.label": "Código",
  "cuenta.codigo.placeholder": "123456",
  "cuenta.codigo.otroNumero": "Usar otro número",

  "cuenta.registro.meta": "Crear cuenta",
  "cuenta.registro.titulo": "Creá tu cuenta",
  "cuenta.registro.bajada":
    "Guardamos tus datos para que la próxima compra sea de dos toques.",
  "cuenta.registro.telefonoAyuda":
    "Es con lo que entrás, y por donde te avisamos de tu pedido.",
  "cuenta.registro.passwordAyuda":
    "Al menos {minimo} caracteres, con letras y números.",
  "cuenta.registro.boton": "Crear cuenta",
  "cuenta.registro.creando": "Creando…",
  "cuenta.registro.yaTenes": "¿Ya tenés cuenta?",
  "cuenta.registro.entrar": "Entrá",
  "cuenta.registro.noHaceFalta":
    "No hace falta cuenta para comprar. Esto es sólo para no volver a tipear tu dirección.",

  "cuenta.guardarDatos.titulo": "¿Guardamos tus datos para la próxima?",
  "cuenta.guardarDatos.texto":
    "Con una cuenta no volvés a tipear tu dirección, y tenés todos tus pedidos en un solo lugar. Tu pedido {numero} ya está hecho: esto es sólo para la próxima vez.",
  "cuenta.guardarDatos.boton": "Crear mi cuenta",

  // -------------------------------------------------------------------------
  // Errores del dominio (PR S) — los que una persona lee
  //
  // Viven acá y no adentro de cada `throw` por lo mismo que el resto: si no,
  // los textos que la compradora ve quedan repartidos entre transacciones y
  // bloqueos de fila, y quien traduce tiene que ir a buscarlos ahí.
  // -------------------------------------------------------------------------
  "error.checkout.telefono": "El número de WhatsApp no parece paraguayo.",
  "error.checkout.ruc": "RUC inválido: {motivo}",
  "error.checkout.ci": "CI inválida: {motivo}",
  "error.checkout.carritoVacio": "El carrito está vacío.",
  "error.checkout.noDisponible":
    "Algunos productos ya no están disponibles. Revisá tu carrito.",
  "error.checkout.noPude": "No pude crear el pedido. Probá de nuevo.",
  "error.checkout.totalCambio":
    "El total cambió de {antes} a {despues} mientras completabas los datos. Revisalo y confirmá de nuevo.",
  "error.checkout.cuponCaido":
    "El código de descuento ya no se puede usar. Revisá el total y confirmá de nuevo.",
  "error.checkout.sinMetodoEnvio":
    "No tenemos ninguna forma de entrega para esa ciudad. Escribinos por WhatsApp y lo resolvemos.",
  "error.checkout.metodoEnvioCaido":
    "La forma de entrega que elegiste ya no está disponible. Elegí otra y confirmá de nuevo.",
  "error.checkout.pagoNoPermitido":
    "{envio} no acepta {pago}. Elegí otro medio de pago o cambiá la forma de entrega.",
  "error.checkout.demasiadosIntentos":
    "Demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.",
  "error.checkout.revisaDatos": "Revisá los datos del formulario.",
  "error.checkout.sinTarjeta":
    "El pago con tarjeta no está disponible en este momento.",
  "error.checkout.generico":
    "No pudimos crear el pedido. Probá de nuevo en un momento.",

  // == O6 · avisame cuando haya stock ==
  "error.avisoStock.apagado":
    "Por ahora no podemos avisarte. Escribinos por WhatsApp y te contamos.",
  "error.avisoStock.noExiste": "Ese producto ya no está disponible.",
  "error.avisoStock.hayStock":
    "¡Buena noticia! Ya hay stock: podés comprarlo ahora.",
  "error.avisoStock.demasiados":
    "Ya nos pediste varios avisos. Probá de nuevo más tarde.",

  // == O5 · notas internas del pedido ==
  "error.nota.vacia": "Escribí algo en la nota.",
  "error.nota.larga": "La nota no puede pasar de {maximo} caracteres.",
  "error.nota.pedidoNoExiste": "No encontramos ese pedido.",
  "error.nota.usuarioInactivo": "Tu usuario ya no tiene acceso al panel.",

  "error.comprobante.vacio": "El archivo está vacío.",
  "error.comprobante.pesado": "El comprobante no puede pesar más de 5 MB.",
  "error.comprobante.formato":
    "Subí una foto (JPG o PNG) o un PDF del comprobante.",
  "error.comprobante.noEsTransferencia":
    "Este pedido no se paga por transferencia.",
  "error.comprobante.noEsperaComprobante":
    "Este pedido ya no está esperando el comprobante.",
  "error.comprobante.pedidoNoEncontrado": "No encontramos ese pedido.",
  "error.comprobante.elegiArchivo": "Elegí el archivo del comprobante.",
  "error.comprobante.generico":
    "No pudimos subir el comprobante. Probá de nuevo.",
  "error.comprobante.demasiados":
    "Ya subiste {maximo} comprobantes para este pedido. Escribinos por WhatsApp.",
  "error.comprobante.sinMotivo":
    "Escribí el motivo del rechazo: el comprador lo ve y necesita saber qué corregir.",
  "error.comprobante.noExiste": "No encontramos ese comprobante.",
  "error.comprobante.yaAprobado": "Ese comprobante ya estaba aprobado.",
  "error.comprobante.yaRechazado": "Ese comprobante ya estaba rechazado.",

  "error.buscarPedido.noEncontrado":
    "No encontramos un pedido con esos datos. Revisá el número y el teléfono que usaste al comprar.",
  "error.buscarPedido.demasiados.uno":
    "Demasiados intentos. Probá de nuevo en {n} minuto, o escribinos por WhatsApp.",
  "error.buscarPedido.demasiados.varios":
    "Demasiados intentos. Probá de nuevo en {n} minutos, o escribinos por WhatsApp.",

  "error.cuenta.telefono": "Ese número de WhatsApp no parece paraguayo.",
  "error.cuenta.nombre": "Poné tu nombre completo.",
  "error.cuenta.yaExiste":
    "Ya hay una cuenta con ese WhatsApp o ese email. Probá entrar.",
  "error.cuenta.emailUsado": "Ese email ya está usado por otra cuenta.",
  "error.cuenta.noPude": "No pudimos crear la cuenta. Probá de nuevo.",
  "error.cuenta.codigoNoPude": "No pude generar un código. Probá de nuevo.",

  // -------------------------------------------------------------------------
  // Mensajes de WhatsApp que el comercio le manda al comprador (PR S)
  //
  // Nunca llevan el detalle de lo comprado: un WhatsApp llega a la pantalla de
  // bloqueo del teléfono, que puede estar sobre una mesa con más gente
  // alrededor. Al traducirlos, no agregar ítems acá.
  // -------------------------------------------------------------------------
  "wa.seguimiento":
    "Hola {nombre}! Te escribo por tu pedido {numero} ({total}). Podés seguirlo acá: {url}",
  "wa.recuperar.vencido":
    "Hola {nombre}! Tu pedido {numero} quedó sin pagar y se venció la reserva. Si todavía lo querés, avisanos y lo revisamos según disponibilidad.",
  "wa.recuperar.rechazado":
    "Hola {nombre}! No pudimos validar el comprobante de tu pedido {numero}. Entrá al link de abajo, mirá el motivo y subí uno nuevo.",
  "wa.recuperar.pendiente":
    "Hola {nombre}! Te recuerdo tu pedido {numero}, que quedó pendiente de pago.",
  "wa.recuperar.total": "Total: {total}",
  "wa.recuperar.paraTransferir": "Para transferir:",
  "wa.recuperar.banco": "{banco} — {tipoCuenta}",
  "wa.recuperar.titular": "Titular: {titular}",
  "wa.recuperar.ruc": "RUC: {ruc}",
  "wa.recuperar.cuenta": "Cuenta: {cuenta}",
  "wa.recuperar.subiComprobante":
    "Cuando pagues, subí el comprobante acá: {url}",

  // -------------------------------------------------------------------------
  // Aviso al comercio: pedido nuevo (fable/plan.md §5.2)
  //
  // Este lo lee el dueño, no la compradora, así que sí lleva el total y el
  // método de pago — pero tampoco los ítems: el detalle está en el panel, a un
  // toque de distancia, y el mensaje llega a la pantalla de bloqueo igual.
  // -------------------------------------------------------------------------
  "wa.aviso.pedidoNuevo":
    "Pedido nuevo {numero} — {total} ({metodo}). Compró {nombre}.",
  "wa.aviso.pedidoNuevo.envio": "Entrega: {metodo}.",
  "wa.aviso.pedidoNuevo.url": "Miralo en el panel: {url}",

  // -------------------------------------------------------------------------
  // Avisos a la COMPRADORA por WhatsApp: confirmado, pagado, enviado (O3).
  //
  // Los manda el servidor solo, sin que ella tenga que tocar nada — misma
  // filosofía que el aviso al comercio: nunca frenan ni demoran una
  // transición, y si faltan las variables el aviso queda apagado. Cada uno
  // termina con el link a `/pedido/[numero]` para que pueda seguirlo.
  // -------------------------------------------------------------------------
  "wa.cliente.confirmado":
    "Hola {nombre}! Tu pedido {numero} en {tienda} quedó confirmado. Total: {total}.",
  "wa.cliente.confirmado.envio": "Entrega: {metodo}.",
  "wa.cliente.pagado":
    "Hola {nombre}! Recibimos el pago de tu pedido {numero} ({total}). ¡Gracias por tu compra!",
  "wa.cliente.enviado": "Hola {nombre}! Tu pedido {numero} ya salió.",
  "wa.cliente.enviado.envio": "Entrega: {metodo}.",
  "wa.cliente.enviado.nota": "Nota: {nota}",
  // == O6 · resumen diario al dueño ==
  //
  // Voseo y sin adornos: esto se lee de un vistazo a las ocho de la mañana,
  // en el celular, antes de abrir el local.
  "wa.resumen.titulo": "Resumen de hoy",
  "wa.resumen.sinNovedades":
    "Sin novedades: nada pendiente y ayer no hubo ventas.",
  "wa.resumen.comprobantes": "Comprobantes por revisar: {n}",
  "wa.resumen.sinPagar": "Pedidos sin pagar hace más de un día: {n}",
  "wa.resumen.sinPagarLinea": "· {numero} — {horas} h",
  "wa.resumen.stockBajo": "Stock bajo: {n}",
  "wa.resumen.stockBajoLinea": "· {producto} ({etiqueta}) — quedan {quedan}",
  "wa.resumen.ayer": "Ayer: {n} pedidos, {total}",
  "wa.resumen.ayerSinVentas": "Ayer no hubo ventas.",

  // == O6 · avisame cuando haya stock ==
  "wa.stock.disponible":
    "Hola! Volvió a haber stock de {producto} ({etiqueta}) en {tienda}.",
  "wa.stock.verProducto": "Mirálo acá: {url}",

  // == O5 · seguimiento del envío ==
  // Tres formas de la misma línea porque las tres pasan de verdad: courier
  // con guía, sólo courier (una moto propia, "Entrega propia"), y sólo guía
  // (el comercio despacha por su cuenta y anota el número del remito).
  "wa.cliente.enviado.seguimiento": "Transporte: {courier} · Guía {guia}",
  "wa.cliente.enviado.courier": "Transporte: {courier}",
  "wa.cliente.enviado.guia": "Guía: {guia}",
  "wa.cliente.enviado.seguirEnvio": "Seguí tu envío: {url}",
  "wa.cliente.verPedido": "Seguilo acá: {url}",

  // -------------------------------------------------------------------------
  // Errores del panel (PR R) — los lee el dueño, no la compradora
  // -------------------------------------------------------------------------
  "adminError.sesionCerrada": "Se cerró tu sesión. Volvé a entrar.",
  "adminError.generico": "No pudimos completar la acción. Probá de nuevo.",

  "adminError.categoria.nombreCorto":
    "El nombre necesita al menos 2 caracteres.",
  "adminError.categoria.nombreLargo":
    "El nombre no puede pasar los 120 caracteres.",
  "adminError.categoria.sinUrl":
    "De ese nombre no sale ninguna URL. Escribí el slug a mano, con letras y números.",
  "adminError.categoria.slugLargo":
    "El slug no puede pasar los 120 caracteres.",
  "adminError.categoria.urlRepetida":
    'Ya hay una categoría con la URL "{slug}".',
  "adminError.categoria.urlRepetidaOtra":
    'Ya hay otra categoría con la URL "{slug}".',
  "adminError.categoria.noPude": "No pude crear la categoría.",
  "adminError.categoria.noExiste": "Esa categoría no existe.",

  "adminError.envio.nombreCorto": "El nombre necesita al menos 2 caracteres.",
  "adminError.envio.nombreLargo":
    "El nombre no puede pasar los 160 caracteres.",
  "adminError.envio.sinSlug":
    "De ese nombre no sale ningún identificador. Escribí el slug a mano.",
  "adminError.envio.slugLargo": "El slug no puede pasar los 120 caracteres.",
  "adminError.envio.ciudadLarga":
    '"{ciudad}…" es demasiado largo para una ciudad.',
  "adminError.envio.noEsNumero": "{campo} tiene que ser un número.",
  "adminError.envio.noEsEntero":
    "{campo} va en guaraníes enteros, sin centavos.",
  "adminError.envio.precioLabel": "El precio del envío",
  "adminError.envio.umbralLabel": "El umbral de envío gratis",
  "adminError.envio.precioNegativo":
    "El precio del envío no puede ser negativo.",
  "adminError.envio.umbralCero":
    "Un umbral de ₲0 haría gratis todos los envíos de la zona. Si es lo que querés, poné el precio en ₲0 y dejá el umbral vacío.",
  "adminError.envio.ciudadRepetida":
    '"{ciudad}" ya está en la zona "{zona}". Una ciudad va en una sola zona: con dos, el precio del envío depende del orden de las zonas y nadie se entera.',
  "adminError.envio.slugRepetido":
    'Ya hay una zona con el identificador "{slug}".',
  "adminError.envio.slugRepetidoOtra":
    'Ya hay otra zona con el identificador "{slug}".',
  "adminError.envio.noPude": "No pude crear la zona.",
  "adminError.envio.noExiste": "Esa zona no existe.",
  "adminError.envio.ultimaActiva":
    "Es la última zona activa: sin ninguna, la tienda pasa a cobrar ₲0 de envío a todo el país sin avisar en ninguna pantalla. Si querés dejar de cobrar el flete, poné el precio de esta zona en ₲0.",

  "adminError.metodo.nombreCorto": "El nombre necesita al menos 2 caracteres.",
  "adminError.metodo.nombreLargo":
    "El nombre no puede pasar los 160 caracteres.",
  "adminError.metodo.sinSlug":
    "De ese nombre no sale ningún identificador. Escribí el slug a mano.",
  "adminError.metodo.slugLargo": "El slug no puede pasar los 120 caracteres.",
  "adminError.metodo.descripcionLarga":
    "La descripción no puede pasar los 200 caracteres: es una línea para el checkout.",
  "adminError.metodo.noEsNumero": "{campo} tiene que ser un número.",
  "adminError.metodo.noEsEntero":
    "{campo} va en guaraníes enteros, sin centavos.",
  "adminError.metodo.precioLabel": "La tarifa plana",
  "adminError.metodo.precioNegativo": "La tarifa plana no puede ser negativa.",
  "adminError.metodo.faltaPrecioFijo":
    'Elegiste tarifa plana: poné cuánto cobra. Si el precio sale de las zonas, cambiá "cómo se cobra".',
  "adminError.metodo.sinPagos":
    "Elegí al menos un medio de pago: un método que no acepta ninguno no se puede elegir en el checkout.",
  "adminError.metodo.demasiadasZonas":
    "Son demasiadas zonas para un solo método.",
  "adminError.metodo.zonaInexistente":
    "Alguna de las zonas elegidas ya no existe (ids: {ids}). Recargá la página y probá de nuevo.",
  "adminError.metodo.slugRepetido":
    'Ya hay un método con el identificador "{slug}".',
  "adminError.metodo.slugRepetidoOtro":
    'Ya hay otro método con el identificador "{slug}".',
  "adminError.metodo.noPude": "No pude crear el método.",
  "adminError.metodo.noExiste": "Ese método no existe.",

  // Datos bancarios (PR T). No son plata —no entran en ningún total— pero son
  // a dónde va la plata de otra persona, así que el RUC se verifica de verdad.
  "adminError.banco.campo.banco": "el banco",
  "adminError.banco.campo.titular": "el titular",
  "adminError.banco.campo.ruc": "el RUC",
  "adminError.banco.campo.cuenta": "el número de cuenta",
  "adminError.banco.campo.tipoCuenta": "el tipo de cuenta",
  "adminError.banco.incompleto":
    "Faltan {campos}. Los cinco datos se guardan juntos: media cuenta cargada muestra un banco sin número, y esa transferencia se hace mal.",
  "adminError.banco.largo": "{campo} no puede pasar los {maximo} caracteres.",
  "adminError.banco.ruc":
    "El RUC no es válido ({motivo}). Revisá el dígito verificador: va después del guion, y un RUC mal tipeado rompe la transferencia en el banco, no acá.",
  "adminError.banco.qrVacio": "No llegó ninguna imagen del QR.",
  "adminError.banco.sinDatosParaQr":
    "Guardá primero los datos de la cuenta: el QR solo no se muestra en ningún lado.",
  "adminError.banco.noExiste": "Todavía no hay datos bancarios cargados.",
  "adminError.banco.elegiQr": "Elegí la imagen del QR.",

  "adminError.usuario.email": "Revisá el email.",
  "adminError.password.corta":
    "La contraseña debe tener al menos {minimo} caracteres",
  "adminError.password.simple": "La contraseña debe combinar letras y números",
  "adminError.usuario.emailRepetido": "Ya hay un usuario con ese email.",
  "adminError.usuario.noPude": "No pude crear el usuario.",
  "adminError.usuario.noExiste": "Ese usuario no existe.",
  "adminError.usuario.noTeDesactives":
    "No podés desactivar tu propia cuenta: quedarías afuera del panel sin forma de volver.",
  "adminError.usuario.ultimoDueno":
    "Es el último dueño activo: la tienda quedaría sin nadie que pueda gestionar usuarios. Nombrá otro dueño primero.",
  "adminError.usuario.noTeDegrades":
    "No podés quitarte a vos mismo el rol de dueño: perderías el acceso a esta pantalla.",
  "adminError.usuario.ultimoDuenoDegradar":
    "Es el último dueño activo: si lo degradás, nadie puede volver a nombrar dueños. Nombrá otro dueño primero.",

  "adminError.cupon.codigoCorto": "El código necesita al menos 3 caracteres.",
  "adminError.cupon.valor": "El valor tiene que ser un entero mayor que cero.",
  "adminError.cupon.porcentaje": "Un porcentaje no puede pasar de 100.",
  "adminError.cupon.fechas": "La fecha de inicio es posterior a la de fin.",
  "adminError.cupon.topeUsos":
    "El tope de usos tiene que ser un entero mayor que cero.",
  "adminError.cupon.topeCliente":
    "El tope por cliente tiene que ser un entero mayor que cero.",
  "adminError.cupon.codigoRepetido": "Ya existe un cupón con ese código.",
  "adminError.cupon.codigoRepetidoOtro": "Ya existe otro cupón con ese código.",
  "adminError.cupon.noPude": "No pude crear el cupón.",
  "adminError.cupon.noExiste": "Ese cupón no existe.",
  "adminError.cupon.yaUsado":
    "Ese cupón ya se usó en pedidos reales: no se le puede cambiar el código ni el descuento. Desactivalo y creá uno nuevo.",

  "adminError.producto.noPude": "No pude crear el producto.",
  "adminError.producto.noExiste": "Ese producto no existe.",
  "adminError.producto.slugRepetido":
    'Ya hay un producto con el slug "{slug}".',
  "adminError.producto.skuRepetido":
    'El SKU "{sku}" ya está usado por otra variante.',
  "adminError.producto.varianteNoExiste": "Esa variante no existe.",
  "adminError.stock.sinMotivo":
    "Escribí el motivo del ajuste (ej: rotura, conteo, reposición).",
  "adminError.stock.deltaCero":
    "El ajuste tiene que ser un número entero distinto de cero.",
  "adminError.stock.negativo":
    "No podés descontar {cantidad}: hay {stock} en stock.",
  "adminError.foto.vacia": "El archivo está vacío.",
  "adminError.foto.pesada": "La foto no puede pesar más de 5 MB.",
  "adminError.foto.formato": "Subí una foto en JPG, PNG o WebP.",

  "adminError.pago.yaDevuelto":
    "Ese pago ya está marcado como devuelto: no corresponde revivir el pedido.",
  "adminError.pago.noAcreditado":
    "Ese pago no está acreditado: no hay nada que recuperar.",
  "adminError.pago.pedidoCancelado":
    "Ese pedido está cancelado y no se revive solo: si el comprador todavía lo quiere, armá uno nuevo. Si no, marcá el pago como devuelto.",
  "adminError.pago.sinMotivo":
    "Escribí por qué se devuelve: queda en el historial del pedido y es lo único que va a explicar esta plata dentro de seis meses.",
  // == O7 · acciones masivas ==
  "adminError.masivo.sinSeleccion": "No seleccionaste ningún producto.",
  "adminError.masivo.demasiados":
    "Son demasiados de una vez (máximo {maximo}). Filtrá y hacelo por tandas.",
  "adminError.masivo.sinMotivo":
    "Escribí por qué cambiás los precios: queda en el historial de cada variante y es lo único que va a explicar estos precios dentro de seis meses.",
  "adminError.masivo.porcentajeEntero":
    "El porcentaje tiene que ser un número entero.",
  "adminError.masivo.porcentajeFuera":
    "El porcentaje tiene que estar entre {min} % y {max} %.",
  "adminError.masivo.redondeoInvalido":
    "El redondeo tiene que ser a ₲100 o a ₲1.000.",
  "adminError.masivo.categoriaNoExiste": "Esa categoría ya no existe.",
  "adminError.masivo.categoriaApagada":
    "Esa categoría está apagada: mover los productos ahí los saca a todos de la vidriera. Prendela primero.",
  "adminError.masivo.productoNoExiste": "Ese producto ya no existe.",
  "adminError.masivo.demasiadasCopias":
    "Ya hay demasiadas copias de este producto. Renombrá o borrá alguna antes de duplicar de nuevo.",
  "adminError.masivo.noPude": "No pude duplicar el producto. Probá de nuevo.",

  // == O7 · reembolso parcial ==
  "adminError.pago.montoInvalido":
    "El monto a devolver tiene que ser un número entero de guaraníes, mayor que cero.",
  "adminError.pago.montoExcede":
    "Ese monto supera lo que queda por devolver de este pago (₲ {disponible}). Recargá: puede que alguien ya haya devuelto una parte.",

  "adminError.pago.noEncontrado": "No encontramos ese pago.",
  "adminError.pago.pedidoNoExiste": "El pedido de ese pago ya no existe.",
  "adminError.pago.nadaQueDevolver":
    "Ese pago no está acreditado: no hay nada que devolver todavía.",
  "adminError.pago.pedidoRevivio":
    "Ese pedido volvió a estar vivo ({estado}) desde que abriste esta pantalla. Recargá y mirá el pedido antes de marcar una devolución.",
  "adminError.pedido.reembolsoPorFormulario":
    "La devolución se registra desde el formulario de devolución del pedido, no como cambio de estado.",

  // Validación de los formularios del panel.
  "adminError.revisaDatos": "Revisá los datos.",
  "adminError.noEntendi.pedido": "No entendí qué querés hacer con el pedido.",
  "adminError.noEntendi.comprobante":
    "Faltan datos para revisar el comprobante.",
  "adminError.noEntendi.pago": "No entendí de qué pago se trata.",
  "adminError.noEntendi.devolucion":
    "Faltan datos para registrar la devolución.",
  "adminError.noEntendi.categoria": "No entendí qué categoría cambiar.",
  "adminError.noEntendi.zona": "No entendí qué zona cambiar.",
  "adminError.noEntendi.metodo": "No entendí qué método de envío cambiar.",
  "adminError.noEntendi.cupon": "No entendí qué cupón cambiar.",
  "adminError.noEntendi.usuario": "No entendí qué usuario cambiar.",
  "adminError.noEntendi.rol": "No entendí qué rol poner.",
  "adminError.noEntendi.mover": "No entendí hacia dónde mover.",
  // == O5 ==
  "adminError.noEntendi.nota": "No entendí qué nota guardar.",
  // == O7 ==
  "adminError.noEntendi.masivo":
    "No entendí qué querés hacer con esos productos.",
  "adminError.comprobanteInvalido": "Comprobante inválido.",
  "adminError.productoInvalido": "Producto inválido.",
  "adminError.elegiFoto": "Elegí la foto.",
  "adminError.imagenInvalida": "Imagen inválida.",
  "adminError.filtros": "Revisá los filtros antes de bajar el archivo.",
  "adminError.sinCuentasClientes": "Esta tienda no tiene cuentas de cliente.",
  "adminError.elegiArchivo": "Elegí un archivo CSV o Excel.",
  "adminError.archivoGrande": "El archivo pesa demasiado (máximo 10 MB).",

  "adminError.login.generico": "Email o contraseña incorrectos.",
  "adminError.login.demasiados.uno": "Demasiados intentos. Esperá {n} minuto.",
  "adminError.login.demasiados.varios":
    "Demasiados intentos. Esperá {n} minutos.",

  "adminForm.nombreProducto": "Poné el nombre del producto",
  "adminForm.sku": "Falta el SKU",
  "adminForm.etiquetaVariante": "Poné una etiqueta: Talle M, 500 ml…",
  "adminForm.precioEntero": "El precio va en guaraníes enteros",
  "adminForm.umbralEntero": "El umbral va en guaraníes enteros",
  "adminForm.ajusteCero": "El ajuste no puede ser cero",
  "adminForm.motivoAjuste": "Escribí el motivo del ajuste",
  "adminForm.nombreCategoria": "Poné el nombre de la categoría",
  "adminForm.nombreZona": "Poné el nombre de la zona",
  "adminForm.nombreMetodo": "Poné el nombre del método de envío",
  "adminForm.pagosMetodo": "Elegí al menos un medio de pago",
  "adminForm.banco.banco": "Poné el nombre del banco",
  "adminForm.banco.titular": "Poné el titular de la cuenta",
  "adminForm.banco.ruc": "Poné el RUC del titular",
  "adminForm.banco.cuenta": "Poné el número de cuenta",
  "adminForm.banco.tipoCuenta": "Poné el tipo de cuenta",
  "adminForm.codigoCupon": "El código necesita al menos 3 caracteres",
  "adminForm.valorEntero": "El valor va en enteros",
  "adminForm.email": "Revisá el email",
  "adminForm.passwordTemporal": "Poné una contraseña temporal",
  "adminForm.passwordNueva": "Poné la contraseña nueva",

  // Cabeceras de los CSV. Se traducen porque el archivo lo abre el dueño en su
  // planilla; los datos de adentro no cambian.
  "csv.pedido.numero": "Nº de pedido",
  "csv.pedido.fecha": "Fecha",
  "csv.pedido.cliente": "Cliente",
  "csv.whatsapp": "WhatsApp",
  "csv.pedido.estado": "Estado",
  "csv.pedido.metodo": "Método de pago",
  "csv.pedido.total": "Total (₲)",
  "csv.producto.sku": "SKU",
  "csv.producto.nombre": "Producto",
  "csv.producto.categoria": "Categoría",
  "csv.producto.variante": "Variante",
  "csv.producto.precio": "Precio (₲)",
  "csv.producto.stock": "Stock",
  "csv.cliente.nombre": "Nombre",
  "csv.cliente.email": "Email",
  "csv.cliente.acepto": "Aceptó el",

  // -------------------------------------------------------------------------
  // Estados del pedido (PR R)
  //
  // Dos traducciones del mismo ENUM, y las dos son legítimas: el panel dice
  // qué tiene que hacer el dueño ("Verificar comprobante") y la página del
  // pedido le cuenta al comprador qué pasa con su plata ("Comprobante en
  // revisión"). Son el mismo estado visto desde los dos lados del mostrador.
  // -------------------------------------------------------------------------
  "estado.panel.pendiente_pago": "Esperando pago",
  "estado.panel.esperando_verificacion": "Verificar comprobante",
  "estado.panel.pagado": "Pagado",
  "estado.panel.preparando": "Preparando",
  "estado.panel.enviado": "Enviado",
  "estado.panel.entregado": "Entregado",
  "estado.panel.rechazado": "Comprobante rechazado",
  "estado.panel.vencido": "Vencido",
  "estado.panel.cancelado": "Cancelado",
  "estado.panel.reembolsado": "Reembolsado",

  "estado.comprador.pendiente_pago": "Esperando tu pago",
  "estado.comprador.esperando_verificacion": "Comprobante en revisión",
  "estado.comprador.pagado": "Pago confirmado",
  "estado.comprador.preparando": "Preparando tu pedido",
  "estado.comprador.enviado": "En camino",
  "estado.comprador.entregado": "Entregado",
  "estado.comprador.rechazado": "Comprobante rechazado",
  "estado.comprador.vencido": "Vencido",
  "estado.comprador.cancelado": "Cancelado",
  "estado.comprador.reembolsado": "Reembolsado",

  "metodo.transferencia": "Transferencia / QR",
  "metodo.contra_entrega": "Contra entrega",
  "metodo.tarjeta": "Tarjeta",

  "transicion.pagado": "Marcar como pagado",
  "transicion.preparando": "Empezar a preparar",
  "transicion.enviado": "Marcar como enviado",
  "transicion.entregado": "Marcar como entregado",
  "transicion.cancelado": "Cancelar pedido",
  "transicion.vencido": "Marcar como vencido",
  "transicion.rechazado": "Rechazar comprobante",
  "transicion.reembolsado": "Marcar como reembolsado",
  "transicion.pendiente_pago": "Volver a esperando pago",
  "transicion.esperando_verificacion": "Volver a verificación",

  // -------------------------------------------------------------------------
  // Panel (PR R)
  // -------------------------------------------------------------------------
  "panel.titulo": "Panel",
  "panel.salir": "Salir",
  "panel.saliendo": "Saliendo…",
  "panel.nav.resumen": "Resumen",
  "panel.nav.pedidos": "Pedidos",
  "panel.nav.productos": "Productos",
  "panel.nav.clientes": "Clientes",
  "panel.nav.cupones": "Cupones",
  "panel.nav.actividad": "Actividad",
  "panel.nav.categorias": "Categorías",
  "panel.nav.envios": "Envíos",
  "panel.nav.banco": "Banco",
  "panel.nav.usuarios": "Usuarios",
  "panel.menu.navigation": "Menú del panel",
  "panel.menu.edit": "Editar menú",
  "panel.menu.help": "Arrastrá los ítems o usá las flechas para cambiar el orden.",
  "panel.menu.drag": "Arrastrar {item}",
  "panel.menu.up": "Subir {item}",
  "panel.menu.down": "Bajar {item}",
  "panel.menu.moved": "{item}: posición {n}.",
  "panel.menu.save": "Guardar orden",
  "panel.menu.cancel": "Cancelar",
  "panel.menu.reset": "Restaurar orden original",
  "panel.menu.resetDraft": "Orden original restaurado. Guardá para aplicarlo.",
  "panel.menu.local": "El orden se guarda para tu cuenta en este navegador.",
  "panel.menu.saved": "Orden del menú guardado.",
  "panel.menu.storageError": "El navegador no permite guardar el orden. Habilitá el almacenamiento o cancelá la edición.",
  "panel.menu.store": "Ver tienda",
  "panel.menu.open": "Abrir menú del panel",

  "panel.login.meta": "Entrar",
  "panel.login.email": "Email",
  "panel.login.password": "Contraseña",
  "panel.login.entrar": "Entrar",
  "panel.login.entrando": "Entrando…",

  "panel.csv.descargar": "Descargar CSV",
  "panel.csv.preparando": "Preparando…",
  "panel.csv.filas.uno": "{n} fila.",
  "panel.csv.filas.varios": "{n} filas.",
  "panel.csv.truncado":
    "Bajé las primeras {n} filas. Filtrá por fecha para llevarte el resto.",

  "panel.acciones.motivo": "Motivo (queda en el historial del pedido)",
  "panel.acciones.motivo.placeholder": "Ej: el cliente pidió cancelar",
  "panel.acciones.confirmar": "Confirmar",
  "panel.acciones.guardando": "Guardando…",
  "panel.acciones.volver": "Volver",
  "panel.acciones.marcado": "Pedido marcado como “{estado}”.",

  "panel.filtros.buscarPedido": "Nº de pedido, WhatsApp o RUC",
  "panel.filtros.buscarPedido.label": "Buscar pedido",
  "panel.filtros.buscar": "Buscar",
  "panel.filtros.mas": "Más filtros",
  "panel.filtros.ocultar": "Ocultar filtros",
  "panel.filtros.activos": " ({n})",
  "panel.filtros.estado": "Estado",
  "panel.filtros.metodo": "Método de pago",
  "panel.filtros.desde": "Desde",
  "panel.filtros.hasta": "Hasta",
  "panel.filtros.todos": "Todos",
  "panel.filtros.aplicar": "Aplicar",
  "panel.filtros.limpiar": "Limpiar",
  "panel.filtros.porEstado": "Filtrar por estado",
  "panel.filtros.categoria": "Categoría",
  "panel.filtros.todasCategorias": "Todas las categorías",
  "panel.filtros.ordenar": "Ordenar",

  "panel.orden.recientes": "Editados hace poco",
  "panel.orden.stock": "Stock: menor primero",
  "panel.orden.precioAsc": "Precio: menor a mayor",
  "panel.orden.precioDesc": "Precio: mayor a menor",

  "panel.comprobante.pending": "Sin revisar",
  "panel.comprobante.approved": "Aprobado",
  "panel.comprobante.rejected": "Rechazado",
  "panel.comprobante.motivo": "Motivo: {motivo}",
  "panel.comprobante.ver": "Ver comprobante",
  "panel.comprobante.actualizar": "Actualizar vista",
  "panel.comprobante.aprobar": "Aprobar",
  "panel.comprobante.rechazar": "Rechazar",
  "panel.comprobante.aprobado":
    "Comprobante aprobado. El pedido pasó a pagado.",
  "panel.comprobante.rechazado":
    "Comprobante rechazado. El cliente puede subir otro.",
  "panel.comprobante.motivoRechazo": "Motivo del rechazo — el cliente lo lee",
  "panel.comprobante.motivoRechazo.placeholder":
    "Ej: el monto transferido no coincide",
  "panel.comprobante.confirmarRechazo": "Confirmar rechazo",
  "panel.comprobante.abrirPdf": "Abrir el PDF del comprobante",
  "panel.comprobante.alt": "Comprobante de transferencia",
  "panel.comprobante.linkVence":
    "El link vence en un par de minutos. Si no carga, tocá “Actualizar vista”.",

  "panel.pagos.revivido": "{numero} volvió a estar cobrado.",
  "panel.pagos.yaCobrado": "{numero} ya estaba cobrado.",
  "panel.pagos.devolucionAnotada": "Devolución anotada en {numero}.",
  "panel.pagos.detalle": "{proveedor} · pedido en “{estado}” · {fecha}",
  "panel.pagos.motivo":
    "Motivo de la devolución (queda en el historial del pedido)",
  "panel.pagos.motivo.placeholder": "Ej: transferí de vuelta por SPI el 12/8",
  "panel.pagos.aclaracion":
    "Esto no le transfiere la plata a nadie: anota que vos ya la devolviste, y cancela el pedido.",
  "panel.pagos.confirmarDevolucion": "Confirmar devolución",
  "panel.pagos.reintentar": "Reintentar el pedido",
  "panel.pagos.marcarDevuelto": "Marcar como devuelto",

  "panel.producto.guardado": "Producto guardado.",
  "panel.producto.nombre": "Nombre",
  "panel.producto.slug": "Slug (la URL del producto)",
  "panel.producto.descripcion": "Descripción",
  "panel.producto.categoria": "Categoría",
  "panel.producto.elegiCategoria": "Elegí una",
  "panel.producto.marca": "Marca",
  "panel.producto.iva": "IVA",
  "panel.producto.iva10": "10% (lo habitual)",
  "panel.producto.iva5": "5% (canasta básica)",
  "panel.producto.iva0": "Exento",
  "panel.producto.activo": "Activo",
  "panel.producto.publicado": "Publicado en la tienda",
  "panel.producto.publicadoAyuda":
    "Un producto sin publicar no aparece en el catálogo ni en la búsqueda.",
  "panel.producto.guardar": "Guardar producto",

  "panel.fotos.alt": "Foto del producto",
  "panel.fotos.quitar": "Quitar",
  "panel.fotos.quitada": "Foto quitada.",
  "panel.fotos.subida": "Foto subida.",
  "panel.fotos.vacio":
    "Todavía no hay fotos: en la tienda se ve un placeholder de color.",
  "panel.fotos.agregar": "Agregar foto (JPG, PNG o WebP, hasta 5 MB)",
  "panel.fotos.descripcion": "Descripción de la foto (accesibilidad y SEO)",
  "panel.fotos.descripcion.placeholder": "Remera azul de frente",
  "panel.fotos.subir": "Subir foto",
  "panel.fotos.subiendo": "Subiendo…",

  "panel.variante.agregar": "Agregar variante",
  "panel.variante.vacio":
    "Un producto sin variantes no se puede comprar: cargá al menos una con su precio.",
  "panel.variante.stockLinea":
    "{stock} en stock · {reservados} reservados · {disponibles} disponibles",
  "panel.variante.inactiva": " · inactiva",
  "panel.variante.editar": "Editar",
  "panel.variante.cancelar": "Cancelar",
  "panel.variante.ajustarStock": "Ajustar stock",
  "panel.variante.guardada": "Variante guardada.",
  "panel.variante.etiqueta": "Etiqueta",
  "panel.variante.etiqueta.placeholder": "Talle M",
  "panel.variante.sku": "SKU",
  "panel.variante.sku.placeholder": "CAM-M-AZ",
  "panel.variante.precio": "Precio en ₲ (IVA incluido)",
  "panel.variante.precioTachado": "Precio tachado (opcional)",
  "panel.variante.activa": "Activa",
  "panel.variante.arrancaEnCero":
    "Arranca con 0 en stock: se carga con “Ajustar stock”, que pide el motivo.",
  "panel.variante.guardar": "Guardar variante",

  "panel.stock.ajustado": "Stock ajustado: quedan {n}.",
  "panel.stock.agregar": "Agregar",
  "panel.stock.quitar": "Quitar",
  "panel.stock.cantidad": "Cantidad",
  "panel.stock.motivo": "Motivo (obligatorio)",
  "panel.stock.motivo.placeholder": "Conteo de depósito / rotura / reposición",

  "panel.actividad.quien": "Quién",
  "panel.actividad.cualquiera": "Cualquiera",
  "panel.actividad.sistema": "El sistema (cron, Pagopar, la compradora)",
  "panel.actividad.desactivado": " (desactivado)",
  "panel.actividad.tipo": "Tipo",
  "panel.actividad.todo": "Todo",
  "panel.actividad.tipoPedido": "Cambios de pedido",
  "panel.actividad.tipoStock": "Ajustes de stock",
  // == O5 ==
  "panel.actividad.tipoNota": "Notas de pedidos",
  "panel.actividad.hastaIncluye": "Incluye todo ese día.",
  "panel.actividad.filtrar": "Filtrar",

  "panel.abm.noPudimos": "No pudimos hacer eso.",
  "panel.abm.guardarCambios": "Guardar cambios",
  "panel.abm.cancelar": "Cancelar",
  "panel.abm.editar": "Editar",
  "panel.abm.desactivar": "Desactivar",
  "panel.abm.reactivar": "Reactivar",
  "panel.abm.activar": "Activar",
  "panel.abm.ordenActualizado": "Orden actualizado.",
  "panel.abm.subir": "Subir {nombre}",
  "panel.abm.bajar": "Bajar {nombre}",

  "panel.categoria.crear": "Crear categoría",
  "panel.categoria.vacio":
    "Todavía no hay categorías. Sin al menos una, no se puede cargar ningún producto: cada producto pertenece a una.",
  "panel.categoria.desactivada": " · desactivada",
  "panel.categoria.productos.uno": "{n} producto",
  "panel.categoria.productos.varios": "{n} productos",
  "panel.categoria.enVidriera": " · {n} en la vidriera",
  "panel.categoria.confirmar": "¿Desactivar “{nombre}”?",
  "panel.categoria.confirmar.sinPublicados":
    "No hay productos publicados en esta categoría, así que la vidriera no cambia. Sólo desaparece del menú y /categoria/{slug} pasa a dar 404.",
  "panel.categoria.confirmar.conPublicados.uno":
    "Su {n} producto publicado deja de verse en toda la tienda: home, buscador, sitemap y su propia ficha. No se borra nada — los productos quedan como están y vuelven solos cuando reactivés la categoría.",
  "panel.categoria.confirmar.conPublicados.varios":
    "Sus {n} productos publicados dejan de verse en toda la tienda: home, buscador, sitemap y sus propias fichas. No se borra nada — los productos quedan como están y vuelven solos cuando reactivés la categoría.",
  "panel.categoria.siDesactivar": "Sí, desactivar",
  "panel.categoria.desactivando": "Desactivando…",
  "panel.categoria.desactivadaOk": "Categoría desactivada.",
  "panel.categoria.reactivadaOk": "Categoría reactivada.",
  "panel.categoria.actualizada": "Categoría actualizada.",
  "panel.categoria.creada": "Categoría creada.",
  "panel.categoria.editarTitulo": "Editar {nombre}",
  "panel.categoria.nueva": "Nueva categoría",
  "panel.categoria.nombre": "Nombre",
  "panel.categoria.nombreAyuda": "Lo que se lee en el menú de la tienda.",
  "panel.categoria.url": "URL",
  "panel.categoria.urlPreview": "Queda /categoria/{slug}",
  "panel.categoria.avisoUrl":
    "Estás cambiando la URL. La anterior (/categoria/{slug}) va a dar 404: los links compartidos por WhatsApp y lo que Google tenga indexado dejan de funcionar. El nombre se puede cambiar sin tocar la URL — para eso son dos campos.",

  "panel.zona.crear": "Crear zona",
  "panel.zona.vacio":
    "Todavía no hay zonas de envío. Mientras no haya ninguna activa, el checkout cobra ₲0 de flete y lo dice en pantalla — está bien para una demo y no para cobrar de verdad.",
  "panel.zona.comodin":
    "Una ciudad que no esté en ninguna lista se cotiza como {zona} ({precio}), que es la zona activa más cara. El checkout se lo avisa a la compradora.",
  "panel.zona.desactivada": " · desactivada",
  "panel.zona.envioGratis": "Envío gratis",
  "panel.zona.sinCiudades":
    "Sin ciudades: sólo se usa como comodín cuando es la activa más cara.",
  "panel.zona.ciudades.uno": "{n} ciudad: {lista}",
  "panel.zona.ciudades.varios": "{n} ciudades: {lista}",
  "panel.zona.masCiudades": ", +{n} más",
  "panel.zona.gratisDesde": "Gratis a partir de {monto} de subtotal.",
  "panel.zona.desactivadaOk": "Zona desactivada.",
  "panel.zona.activadaOk": "Zona activada.",
  "panel.zona.actualizada": "Zona actualizada.",
  "panel.zona.creada": "Zona creada.",
  "panel.zona.editarTitulo": "Editar {nombre}",
  "panel.zona.nueva": "Nueva zona",
  "panel.zona.nombre": "Nombre",
  "panel.zona.nombreAyuda":
    "Lo lee la compradora en el checkout: “Envío — Gran Asunción”.",
  "panel.zona.precio": "Precio del envío",
  "panel.zona.precioAyuda":
    "Guaraníes enteros, IVA 10% incluido como el resto de los precios.",
  "panel.zona.ciudadesLabel": "Ciudades",
  "panel.zona.ciudades.placeholder": "Asunción\nLambaré\nFernando de la Mora",
  "panel.zona.ciudadesAyuda":
    "Una por línea o separadas por coma — pegá la lista como la tengas. ",
  "panel.zona.ciudadesAyuda.ninguna":
    "Sin ninguna, esta zona nunca coincide con una ciudad: sólo se cobra si es la activa más cara, o sea como comodín del interior.",
  "panel.zona.ciudadesAyuda.algunas":
    "Van {n}. Los acentos y las mayúsculas no importan al comparar; se guarda como lo escribiste.",
  "panel.zona.gratisLabel": "Envío gratis desde",
  "panel.zona.gratisAyuda":
    "Sobre el subtotal, sin el envío. Vacío = esta zona no lo ofrece.",
  "panel.zona.identificador": "Identificador",
  "panel.zona.identificadorAyuda":
    "Interno: no sale en ninguna URL. Sirve para distinguir dos zonas que se llamen parecido.",

  "panel.metodo.titulo": "Formas de entrega",
  "panel.metodo.bajada":
    "Courier, moto propia o retiro en el local. Cada forma decide con qué se puede pagar: contra entrega sólo tiene sentido donde alguien tuyo va a estar en la puerta para cobrar.",
  "panel.metodo.crear": "Agregar forma de entrega",
  "panel.metodo.vacio":
    'Todavía no hay ninguna. Sin métodos, el checkout ofrece "Envío a domicilio" con el precio de la zona y los tres medios de pago — exactamente como venía funcionando.',
  "panel.metodo.nueva": "Forma de entrega nueva",
  "panel.metodo.editarTitulo": "Editar {nombre}",
  "panel.metodo.desactivado": " · desactivado",
  "panel.metodo.creado": "Forma de entrega creada.",
  "panel.metodo.actualizado": "Forma de entrega actualizada.",
  "panel.metodo.activadoOk": "Forma de entrega activada.",
  "panel.metodo.desactivadoOk": "Forma de entrega desactivada.",
  "panel.metodo.kind.courier": "Courier",
  "panel.metodo.kind.local": "Reparto propio",
  "panel.metodo.kind.retiro": "Retiro en el local",
  "panel.metodo.precioPorZona": "Precio de la zona",
  "panel.metodo.gratis": "Gratis",
  "panel.metodo.zonasTodas": "Todas las zonas activas",
  "panel.metodo.zonasLista": "Zonas: {lista}",
  "panel.metodo.pagosLista": "Se paga con: {lista}",
  "panel.metodo.sinZonaActiva":
    "Ninguna de sus zonas está activa: hoy este método no le aparece a nadie en el checkout.",
  "panel.metodo.nombre": "Nombre",
  "panel.metodo.nombreAyuda":
    'Lo que lee quien compra: "Courier AEX", "Moto Asunción", "Retiro en el local".',
  "panel.metodo.tipo": "Tipo",
  "panel.metodo.tipoAyuda":
    "Retiro no viaja: no cobra flete ni usa zonas, cualquiera sea lo que pongas abajo.",
  "panel.metodo.pricing": "Cómo se cobra",
  "panel.metodo.pricing.zona": "Con el precio de la zona",
  "panel.metodo.pricing.fijo": "Tarifa plana",
  "panel.metodo.pricingAyuda":
    "Por zona conserva el envío gratis desde el umbral de la zona. La tarifa plana cobra lo mismo siempre.",
  "panel.metodo.precioFijo": "Tarifa plana",
  "panel.metodo.precioFijoAyuda":
    "En guaraníes enteros. Sólo se usa con tarifa plana.",
  "panel.metodo.zonas": "Zonas donde aplica",
  "panel.metodo.zonasAyuda":
    "Sin ninguna tildada aplica a todas las zonas activas. Tildá sólo las ciudades a las que este método llega de verdad.",
  "panel.metodo.pagos": "Medios de pago habilitados",
  "panel.metodo.pagosAyuda":
    "Al menos uno. Es lo que decide qué ve quien compra después de elegir esta forma de entrega.",
  "panel.metodo.descripcion": "Descripción",
  "panel.metodo.descripcionAyuda":
    'Una línea para el checkout: "Llega en 24-48 h a todo el país".',
  "panel.metodo.identificador": "Identificador",
  "panel.metodo.identificadorAyuda":
    "Interno: no sale en ninguna URL. Sirve para distinguir dos métodos que se llamen parecido.",

  "panel.rol.owner": "Dueño",
  "panel.rol.staff": "Encargado",
  "panel.rol.vendedor": "Vendedor",
  "panel.rol.owner.ayuda":
    "Todo, incluidos usuarios, devoluciones y descargas de CSV.",
  "panel.rol.staff.ayuda":
    "Pedidos, comprobantes, productos y stock. Sin devoluciones ni CSV.",
  "panel.rol.vendedor.ayuda":
    "Ve pedidos y los despacha. Sin montos, comprobantes ni stock.",
  "panel.rol.label": "Rol",
  "panel.rol.de": "Rol de {email}",

  "panel.usuario.agregar": "Agregar usuario",
  "panel.usuario.nuevo": "Nuevo usuario",
  "panel.usuario.creado":
    "Usuario creado. Pasale la contraseña por un canal seguro.",
  "panel.usuario.email": "Email",
  "panel.usuario.nombre": "Nombre",
  "panel.usuario.passwordTemporal": "Contraseña temporal",
  "panel.usuario.passwordAyuda":
    "Al menos {minimo} caracteres, con letras y números. Se la pasás vos por WhatsApp o en persona — la tienda no manda emails. Que la cambie al entrar.",
  "panel.usuario.crear": "Crear usuario",
  "panel.usuario.creando": "Creando…",
  "panel.usuario.vos": " (vos)",
  "panel.usuario.desactivado": " · desactivado",
  "panel.usuario.ultimoIngreso": "Último ingreso: {fecha}",
  "panel.usuario.nuncaEntro": "Nunca entró",
  "panel.usuario.passwordNueva": "Contraseña nueva para {email}",
  "panel.usuario.cambiarPassword": "Cambiar contraseña",
  "panel.usuario.passwordCambiada":
    "Contraseña cambiada. Pasásela por un canal seguro.",
  "panel.usuario.resetear": "Resetear contraseña",
  "panel.usuario.rolActualizado": "Rol actualizado.",
  "panel.usuario.desactivadoOk": "Usuario desactivado.",
  "panel.usuario.reactivadoOk": "Usuario reactivado.",
  "panel.usuario.tuCuenta":
    "Tu propia cuenta no se puede desactivar ni degradar desde acá: quedarías afuera del panel sin forma de volver.",

  "panel.cupon.tipo.porcentaje": "Porcentaje",
  "panel.cupon.tipo.monto_fijo": "Monto fijo",
  "panel.cupon.crear": "Crear cupón",
  "panel.cupon.vacio":
    "Todavía no hay cupones. Mientras no haya ninguno, el checkout no muestra el campo de descuento.",
  "panel.cupon.descuento": "{valor} de descuento",
  "panel.cupon.desactivado": " · desactivado",
  "panel.cupon.agotado": " · agotado",
  "panel.cupon.minimo": " · mínimo {monto}",
  "panel.cupon.desde": " · desde {fecha}",
  "panel.cupon.hasta": " · hasta {fecha}",
  "panel.cupon.soloClientes": " · sólo con cuenta",
  "panel.cupon.usos.uno": "{n} uso",
  "panel.cupon.usos.varios": "{n} usos",
  "panel.cupon.usosDe": " de {n}",
  "panel.cupon.discrepancia": " · ⚠ {n} pedidos lo usan",
  "panel.cupon.descontados": " · {monto} descontados",
  "panel.cupon.maxPorCliente": " · máx. {n} por cliente",
  "panel.cupon.desactivadoOk": "Cupón desactivado.",
  "panel.cupon.activadoOk": "Cupón activado.",
  "panel.cupon.actualizado": "Cupón actualizado.",
  "panel.cupon.creado": "Cupón creado.",
  "panel.cupon.editarTitulo": "Editar {codigo}",
  "panel.cupon.nuevo": "Nuevo cupón",
  "panel.cupon.codigo": "Código",
  "panel.cupon.codigoAyuda":
    "Se guarda en mayúsculas. Es lo que va a tipear la compradora.",
  "panel.cupon.porcentajeLabel": "Porcentaje (1 a 100)",
  "panel.cupon.montoLabel": "Monto en guaraníes",
  "panel.cupon.enterosAyuda": "Enteros. El guaraní no tiene céntimos.",
  "panel.cupon.tipoLabel": "Tipo",
  "panel.cupon.minimoLabel": "Mínimo de compra",
  "panel.cupon.minimoAyuda": "Sobre el subtotal, sin el envío.",
  "panel.cupon.topeLabel": "Tope de usos",
  "panel.cupon.topeAyuda": "Vacío = sin tope.",
  "panel.cupon.desdeLabel": "Desde",
  "panel.cupon.formatoFecha": "(dd/mm/aaaa)",
  "panel.cupon.desde.placeholder": "01/09/2026",
  "panel.cupon.hastaLabel": "Hasta",
  "panel.cupon.hasta.placeholder": "30/09/2026",
  "panel.cupon.hastaAyuda": "Incluye todo ese día.",
  "panel.cupon.maxClienteLabel": "Máximo por cliente",
  "panel.cupon.maxClienteAyuda":
    "Se cuenta por cuenta de cliente, o por WhatsApp si compró de invitada.",
  "panel.cupon.soloClientesLabel": "Sólo para quienes tengan cuenta",
  "panel.cupon.soloClientesAyuda":
    "Si esta tienda no tiene las cuentas de cliente prendidas, un cupón así no lo va a poder usar nadie.",

  "panel.login.titulo": "Panel del comercio",
  "panel.login.bajada": "Entrá con tu cuenta para ver los pedidos.",

  "panel.categorias.meta": "Categorías",
  "panel.categorias.titulo": "Categorías",
  "panel.categorias.bajada":
    "El menú de la tienda, en el orden en que se ve. Nada se borra: una categoría se desactiva, y con ella dejan de verse sus productos hasta que la vuelvas a prender.",

  "panel.envios.meta": "Envíos",
  "panel.envios.titulo": "Zonas de envío",
  "panel.envios.bajada":
    "Cuánto sale el flete a cada ciudad. Lo que cambies acá se cotiza de los próximos pedidos en adelante — los que ya se hicieron conservan el envío que la compradora aceptó pagar.",

  "panel.banco.meta": "Banco",
  "panel.banco.titulo": "Datos bancarios",
  "panel.banco.bajada":
    "A dónde transfieren tus compradoras. Lo que guardes acá es lo que muestra la página del pedido y lo que va en el WhatsApp de recuperación — sin redeploy y sin tocar ningún archivo.",
  "panel.banco.desdeEntorno":
    "Hoy la tienda muestra los datos que están cargados en el entorno del servidor: {banco}, {titular}, cuenta {cuenta}. Lo que guardes acá los reemplaza a partir de ese momento.",
  "panel.banco.sinNada":
    "Todavía no hay datos bancarios en ningún lado: la página del pedido avisa que faltan en vez de mostrar una cuenta. Cargalos acá y la transferencia queda habilitada.",
  "panel.banco.formTitulo": "La cuenta del comercio",
  "panel.banco.guardado": "Datos bancarios guardados.",
  "panel.banco.campo.banco": "Banco",
  "panel.banco.campo.titular": "Titular",
  "panel.banco.campo.ruc": "RUC",
  "panel.banco.campo.cuenta": "Número de cuenta",
  "panel.banco.campo.tipoCuenta": "Tipo de cuenta",
  "panel.banco.titularAyuda":
    "Como figura en el banco: si no coincide, la transferencia rebota.",
  "panel.banco.rucAyuda":
    "Con el dígito verificador: 80012345-6. Lo verificamos antes de guardar.",
  "panel.banco.tipoCuentaAyuda":
    "Es lo que se lee como etiqueta al lado del número en la página del pedido.",
  "panel.banco.tipoCuentaPlaceholder": "Cuenta corriente",
  "panel.banco.actualizado": "Última edición: {fecha}",
  "panel.banco.qrTitulo": "QR del SPI",
  "panel.banco.qrBajada":
    "Opcional. Con QR cargado, la compradora escanea desde la app de su banco en vez de copiar el número a mano — que es donde se equivoca.",
  "panel.banco.qrVacio":
    "Todavía no hay QR cargado: la página muestra los datos con botón de copiar.",
  "panel.banco.qrArchivo": "Imagen del QR",
  "panel.banco.qrArchivoAyuda":
    "JPG, PNG o WebP, hasta 5 MB. Sacale la captura desde la app del banco.",
  "panel.banco.qrSubir": "Subir QR",
  "panel.banco.qrSubido": "QR cargado.",
  "panel.banco.qrQuitar": "Quitar QR",
  "panel.banco.qrQuitado": "QR quitado.",

  "panel.usuarios.meta": "Usuarios",
  "panel.usuarios.titulo": "Usuarios del panel",
  "panel.usuarios.bajada":
    "Quién puede entrar y qué puede hacer. Nadie se borra: se desactiva, y así el historial de lo que hizo sigue siendo consultable.",

  "panel.cupones.meta": "Cupones",
  "panel.cupones.titulo": "Cupones",
  "panel.cupones.bajada":
    "Mientras no haya ninguno activo, el checkout no muestra el campo de descuento. Un cupón usado no se puede editar ni borrar: se desactiva.",

  "panel.productoNuevo.meta": "Nuevo producto",
  "panel.productoNuevo.titulo": "Nuevo producto",
  "panel.productoNuevo.bajada":
    "Primero se crea el producto; las variantes, los precios y las fotos se cargan después.",

  "panel.resumen.meta": "Resumen",
  "panel.resumen.titulo": "Resumen",
  "panel.resumen.sinPedidoVivo": "Pagos sin pedido vivo",
  "panel.resumen.sinPedidoVivo.ayuda":
    "Entró la plata pero el pedido no está cobrado — normalmente el pago llegó justo después de que el pedido venciera y la mercadería ya se había vendido. Reintentar vuelve a probar si hoy hay stock; si no lo hay, no pasa nada y podés volver a intentarlo. Marcar como devuelto es para cuando ya le transferiste la plata de vuelta al comprador.",
  "panel.resumen.sinBanco": "Faltan los datos bancarios",
  "panel.resumen.sinBanco.ayuda":
    "La página del pedido está avisando que no hay a dónde transferir, y la transferencia es el método principal de la tienda. Se cargan una vez y quedan.",
  "panel.resumen.sinBanco.link": "Cargar los datos bancarios →",
  "panel.resumen.demo":
    "{n} producto(s) del catálogo de ejemplo siguen a la venta",
  "panel.resumen.demo.ayuda":
    "Son los que sembró el setup para ver la tienda andando (auriculares, termos, remeras…), con stock de mentira. Apagalos o borralos antes de publicitar la tienda: un pedido por uno de esos es un pedido que no se puede entregar.",
  "panel.resumen.demo.link": "Ir a productos →",
  "panel.resumen.sinZonas":
    "No hay zonas de envío activas: el envío sale gratis a todo el país",
  "panel.resumen.sinZonas.ayuda":
    "Sin zonas, el checkout cobra ₲0 de envío a cualquier ciudad y el costo lo pagás vos en cada pedido. Cargá al menos Asunción y una zona Interior sin ciudades, que haga de comodín.",
  "panel.resumen.sinZonas.link": "Cargar las zonas de envío →",
  "panel.resumen.cronNunca": "El cron de vencimientos nunca corrió",
  "panel.resumen.cronParado":
    "El cron de vencimientos no corre desde el {cuando}",
  "panel.resumen.cron.ayuda":
    "Sin él, los pedidos sin pagar no vencen, el stock queda reservado para siempre y no sale ningún recordatorio de pago. Se configura en el hPanel → Avanzado → Cron Jobs, cada 15 minutos (DEPLOY.md §5).",

  "panel.resumen.ventasHoy": "Ventas de hoy",
  "panel.resumen.ventasMes": "Ventas del mes",
  "panel.resumen.cobrados.uno": "{n} pedido cobrado",
  "panel.resumen.cobrados.varios": "{n} pedidos cobrados",
  "panel.resumen.soloCobrados":
    "Sólo se cuentan los pedidos ya cobrados (pagado en adelante). Un pedido esperando pago todavía puede vencer.",
  "panel.resumen.ultimos7": "Últimos 7 días",
  "panel.resumen.ultimos7.ayuda":
    "Cada día se corta a medianoche de Asunción y cuenta lo mismo que el cuadro de arriba.",
  "panel.resumen.masVendido": "Lo más vendido del mes",
  "panel.resumen.sinVentas": "Todavía no hay ventas cobradas este mes.",
  "panel.resumen.unidades": "{n} u.",
  "panel.resumen.esperandoVerificacion": "Esperando verificación",
  "panel.resumen.verTodos": "Ver todos ({n})",
  "panel.resumen.sinComprobantes":
    "No hay comprobantes esperando revisión. Todo al día.",
  "panel.resumen.stockBajo": "Stock bajo",
  "panel.resumen.stockBajo.ayuda":
    "Disponible = lo que hay físicamente menos lo que ya está reservado por un pedido.",
  "panel.resumen.sinStockBajo": "Ninguna variante con stock bajo.",
  "panel.resumen.pendientes": "Pendientes de pago",
  "panel.resumen.pendientes.uno":
    "{n} pedido espera el pago. Los que pasen su fecha de reserva los vence el cron automáticamente.",
  "panel.resumen.pendientes.varios":
    "{n} pedidos esperan el pago. Los que pasen su fecha de reserva los vence el cron automáticamente.",
  "panel.resumen.verPendientes": "Ver pendientes",

  "panel.paginacion.anteriores": "← Anteriores",
  "panel.paginacion.siguientes": "Siguientes →",

  "panel.pedidos.meta": "Pedidos",
  "panel.pedidos.titulo": "Pedidos",
  "panel.pedidos.porCobrar": "Por cobrar",
  "panel.pedidos.cuenta.uno": "{n} pedido",
  "panel.pedidos.cuenta.varios": "{n} pedidos",
  "panel.pedidos.sinResultados": "No hay pedidos con esos filtros.",
  "panel.pedidos.comprobantes.uno": " · {n} comprobante sin revisar",
  "panel.pedidos.comprobantes.varios": " · {n} comprobantes sin revisar",
  "panel.pedidos.csvAyuda":
    "Baja los pedidos con los filtros puestos, no sólo esta página.",
  "panel.pedidos.avisarWhatsApp": "Avisar por WhatsApp →",
  "panel.pedidos.avisoMensaje":
    "Pedido nuevo {numero} — {cliente} — {total} ({metodo}). Ver: {url}",

  "panel.productos.meta": "Productos",
  "panel.productos.titulo": "Productos",
  "panel.productos.nuevo": "Nuevo producto",
  "panel.productos.buscar.placeholder": "Buscar por nombre o slug",
  "panel.productos.buscar.label": "Buscar producto",
  "panel.productos.sinResultados": "No hay productos que coincidan.",
  "panel.productos.sinPrecio": "Sin precio",
  "panel.productos.variantes.uno": "{n} variante",
  "panel.productos.variantes.varios": "{n} variantes",
  "panel.productos.enStock": "{n} en stock",
  "panel.productos.sinPublicar": " · sin publicar",
  "panel.productos.csvAyuda": "Una fila por variante, con los filtros puestos.",

  "panel.productos.importar.titulo": "Cargar planilla",
  "panel.productos.importar.ayuda":
    "CSV o Excel, una fila por variante — el mismo formato que baja el botón de arriba. Primero se revisa; recién se escribe cuando confirmás.",
  "panel.productos.importar.revisar": "Revisar",
  "panel.productos.importar.confirmar": "Confirmar e importar",
  "panel.productos.importar.aplicando": "Importando…",
  "panel.productos.importar.pisarStock":
    "Pisar el stock de las variantes que ya existen (si no, su stock actual no se toca)",
  "panel.productos.importar.pisandoStock": "se va a pisar su stock",
  "panel.productos.importar.stockIntacto": "su stock no se toca",
  "panel.productos.importar.productosNuevos.uno": "{n} producto nuevo",
  "panel.productos.importar.productosNuevos.varios": "{n} productos nuevos",
  "panel.productos.importar.productosActualizar.uno":
    "{n} producto a actualizar",
  "panel.productos.importar.productosActualizar.varios":
    "{n} productos a actualizar",
  "panel.productos.importar.variantesNuevas.uno": "{n} variante nueva",
  "panel.productos.importar.variantesNuevas.varios": "{n} variantes nuevas",
  "panel.productos.importar.variantesActualizar.uno":
    "{n} variante a actualizar",
  "panel.productos.importar.variantesActualizar.varios":
    "{n} variantes a actualizar",
  "panel.productos.importar.categoriasNuevas":
    "Categorías a crear: {categorias}.",
  "panel.productos.importar.fotosNuevas.uno": "{n} foto a subir",
  "panel.productos.importar.fotosNuevas.varios": "{n} fotos a subir",
  "panel.productos.importar.fotosOmitidas":
    "{n} fotos NO se subieron: Cloudinary no está configurado.",
  "panel.productos.importar.fotosFallidas.uno": "{n} foto no se pudo subir.",
  "panel.productos.importar.fotosFallidas.varios":
    "{n} fotos no se pudieron subir.",
  "panel.productos.importar.listo":
    "Listo: {productos} productos, {variantes} variantes escritas.",
  "panel.productos.importar.listoConFotos":
    "Listo: {productos} productos, {variantes} variantes y {fotos} fotos.",

  "panel.clientes.meta": "Clientes",
  "panel.clientes.titulo": "Clientes",
  "panel.clientes.cuenta.uno": "{n} cliente",
  "panel.clientes.cuenta.varios": "{n} clientes",
  "panel.clientes.bajada":
    "Sale de los pedidos, agrupados por WhatsApp. Lo gastado cuenta sólo los pedidos ya cobrados.",
  "panel.clientes.csvNovedades": "Descargar lista de novedades",
  "panel.clientes.csvAyuda":
    "Sólo las cuentas activas que aceptaron recibir novedades.",
  "panel.clientes.buscar.placeholder": "Nombre, WhatsApp o RUC",
  "panel.clientes.buscar.label": "Buscar cliente",
  "panel.clientes.sinBusqueda": "Ningún cliente coincide con esa búsqueda.",
  "panel.clientes.sinPedidos": "Todavía no hay pedidos.",
  "panel.clientes.pedidos.uno": "{n} pedido",
  "panel.clientes.pedidos.varios": "{n} pedidos",
  "panel.clientes.cobrados.uno": " ({n} cobrado)",
  "panel.clientes.cobrados.varios": " ({n} cobrados)",
  "panel.clientes.conCuenta": "Con cuenta",
  "panel.clientes.aceptaNovedades": " · acepta novedades",
  "panel.clientes.ultimoEl": " · último el {fecha}",

  "panel.actividad.meta": "Actividad",
  "panel.actividad.titulo": "Actividad",
  "panel.actividad.movimientos.uno": "{n} movimiento",
  "panel.actividad.movimientos.varios": "{n} movimientos",
  "panel.actividad.bajada":
    "Todo lo que se movió en la tienda: cambios de estado de pedidos y ajustes de stock, del más nuevo al más viejo. Es un registro, no se edita.",
  "panel.actividad.sinResultados": "No hay movimientos con esos filtros.",
  "panel.actividad.creadoComo": "creado como {estado}",
  "panel.actividad.transicion": "{desde} → {hasta}",
  "panel.actividad.deltaStock": "{delta} ({antes} → {despues})",
  "panel.actividad.elSistema": "El sistema",
  // == O5 ==
  "panel.actividad.nota": "nota interna",
  "panel.actividad.masNuevos": "← Más nuevos",
  "panel.actividad.masViejos": "Más viejos →",

  "panel.porCobrar.meta": "Por cobrar",
  "panel.porCobrar.volver": "← Pedidos",
  "panel.porCobrar.titulo": "Por cobrar",
  "panel.porCobrar.vencidos.uno": " · {n} vencido",
  "panel.porCobrar.vencidos.varios": " · {n} vencidos",
  "panel.porCobrar.bajada":
    "Pendientes de pago, vencidos y con el comprobante rechazado, del más viejo al más nuevo. El mensaje ya lleva los datos para transferir, el total y el link del pedido.",
  "panel.porCobrar.cortado":
    "Mostramos los {n} más viejos de {total}. Cobrá estos y volvé a entrar.",
  "panel.porCobrar.sinBanco":
    "Faltan los datos bancarios: el mensaje sale sin la parte de la transferencia. Cargalos en Banco y el botón queda completo.",
  "panel.porCobrar.sinResultados": "No hay pedidos esperando pago.",
  "panel.porCobrar.hoy": "hoy",
  "panel.porCobrar.antiguedad.uno": "hace {n} día",
  "panel.porCobrar.antiguedad.varios": "hace {n} días",
  "panel.porCobrar.escribir": "Escribirle por WhatsApp →",

  "panel.pedido.meta": "Pedido",
  "panel.pedido.escribir": "Escribir por WhatsApp",
  "panel.pedido.mandarDatos": "Mandar datos para pagar",
  "panel.pedido.esRegalo": "Es un regalo",
  "panel.pedido.sinMensaje": "Sin mensaje para la tarjeta.",
  "panel.pedido.comprobantes": "Comprobantes",
  "panel.pedido.items": "Ítems",
  "panel.pedido.itemDetalle": " · {precio} c/u · IVA {tasa}%",
  "panel.pedido.subtotal": "Subtotal",
  "panel.pedido.descuento": "Descuento",
  "panel.pedido.descuentoCon": "Descuento — {codigo}",
  "panel.pedido.envio": "Envío",
  "panel.pedido.metodoEnvio": "Forma de entrega",
  "panel.pedido.total": "Total",
  "panel.pedido.ivaIncluido": "IVA incluido en el total",
  "panel.pedido.iva10": "IVA 10%",
  "panel.pedido.iva5": "IVA 5%",
  "panel.pedido.gravado": "Gravado",
  "panel.pedido.ivaPorLinea": "Ver IVA por línea",
  "panel.pedido.lineaIva": "{nombre} · IVA {tasa}%",
  "panel.pedido.cliente": "Cliente",
  "panel.pedido.nombre": "Nombre",
  "panel.pedido.whatsapp": "WhatsApp",
  "panel.pedido.email": "Email",
  "panel.pedido.documento": "Documento",
  "panel.pedido.consumidorFinal": "Consumidor final",
  "panel.pedido.docConNumero": "{tipo} {numero}",
  "panel.pedido.novedades": "Novedades",
  "panel.pedido.acepta": "Acepta",
  "panel.pedido.noAcepta": "No acepta",
  "panel.pedido.referencia": "Ref: {referencia}",
  "panel.pedido.cambiarEstado": "Cambiar estado",
  "panel.pedido.estadoFinal":
    "Este pedido está en un estado final: ya no se puede mover.",
  "panel.pedido.sinPermiso":
    "Tu usuario no puede mover este pedido desde este estado.",
  "panel.pedido.historial": "Historial",
  "panel.pedido.transicionDesde": "{estado} → ",
  "panel.pedido.motivoEvento": " · {motivo}",

  "panel.producto.meta": "Producto",
  "panel.producto.volver": "← Productos",
  "panel.producto.datos": "Datos",
  "panel.producto.variantes": "Variantes y stock",
  "panel.producto.ultimosAjustes": "Últimos ajustes de stock",
  "panel.producto.ajusteLinea":
    "{fecha} · {actor} · {antes} → {despues} · {motivo}",
  "panel.producto.fotos": "Fotos",

  // También lo usa `/admin/productos/nuevo`, que lo dibuja arriba del
  // formulario para poder volver sin perder el filtro.
  "panel.productoNuevo.volver": "← Productos",

  // == S10 == Panel de productos y categorías: selección y acciones masivas,
  // duplicar, markdown seguro, punto de reposición, categorías con foto y
  // descripción, reembolso parcial (plan-operacion §6.2)
  // -------------------------------------------------------------------------
  "panel.productos.seleccionar": "Seleccionar {nombre}",
  "panel.productos.seleccionarPagina": "Seleccionar toda la página",
  "panel.productos.seleccionados.uno": "{n} producto seleccionado",
  "panel.productos.seleccionados.varios": "{n} productos seleccionados",
  "panel.productos.limpiarSeleccion": "Limpiar selección",

  "panel.masivo.activar": "Activar",
  "panel.masivo.desactivar": "Desactivar",
  "panel.masivo.moverCategoria": "Mover de categoría",
  "panel.masivo.moverConfirmar": "Mover",
  "panel.masivo.ajustarPrecios": "Ajustar precios",
  "panel.masivo.aplicando": "Aplicando…",
  "panel.masivo.cambiaronActivos.uno": "Cambió {n} producto.",
  "panel.masivo.cambiaronActivos.varios": "Cambiaron {n} productos.",
  "panel.masivo.movieron.uno": "Se movió {n} producto.",
  "panel.masivo.movieron.varios": "Se movieron {n} productos.",
  "panel.masivo.elegiCategoria": "Elegí una categoría",

  "panel.masivo.precios.titulo": "Ajustar precios por porcentaje",
  "panel.masivo.precios.bajada":
    "Se aplica sobre el precio de cada variante de los productos elegidos. El precio tachado no cambia.",
  "panel.masivo.precios.porcentaje": "Porcentaje (negativo para bajar)",
  "panel.masivo.precios.redondeo": "Redondear a",
  "panel.masivo.precios.redondeo100": "₲ 100",
  "panel.masivo.precios.redondeo1000": "₲ 1.000",
  "panel.masivo.precios.motivo": "Motivo",
  "panel.masivo.precios.motivo.placeholder":
    "Ej: ajuste por inflación de proveedor",
  "panel.masivo.precios.verVistaPrevia": "Ver vista previa",
  "panel.masivo.precios.calculando": "Calculando…",
  "panel.masivo.precios.vistaPrevia":
    "Vista previa ({miradas} variantes, {cambiadas} cambian)",
  "panel.masivo.precios.ejemploLinea":
    "Variante #{variantId}: {desde} → {hasta}",
  "panel.masivo.precios.sinCambios":
    "Con este porcentaje y redondeo ningún precio cambia.",
  "panel.masivo.precios.confirmarTitulo": "¿Confirmás el ajuste?",
  "panel.masivo.precios.confirmarBajada":
    "Vas a cambiar el precio de {cambiadas} variante(s) un {porcentaje}%, redondeado a {redondeo}. Motivo: “{motivo}”. Esto no se puede deshacer con un botón.",
  "panel.masivo.precios.confirmarBoton": "Sí, ajustar precios",
  "panel.masivo.precios.aplicado.uno": "Se ajustó el precio de {n} variante.",
  "panel.masivo.precios.aplicado.varios":
    "Se ajustó el precio de {n} variantes.",
  "panel.masivo.precios.diferencia": "Diferencia total: {monto}",

  "panel.producto.duplicar": "Duplicar producto",
  "panel.producto.duplicando": "Duplicando…",
  "panel.producto.duplicado": "Se creó la copia, sin publicar.",

  "panel.variante.puntoReposicion": "Punto de reposición",
  "panel.variante.puntoReposicion.ayuda":
    'Debajo de este stock, la variante aparece como "stock bajo" en el resumen diario. Vacío = el umbral general de la tienda.',
  "panel.variante.puntoReposicion.placeholder": "Umbral general",

  "panel.markdown.editar": "Escribir",
  "panel.markdown.vistaPrevia": "Vista previa",
  "panel.markdown.ayuda":
    '**negrita**, *cursiva*, listas con "- " y links [texto](https://…).',
  "panel.markdown.vacio": "Sin descripción todavía.",

  "panel.categoria.descripcion": "Descripción",
  "panel.categoria.descripcion.placeholder":
    "Texto para la página de la categoría (opcional).",
  "panel.categoria.foto": "Foto de portada",
  "panel.categoria.foto.alt": "Descripción de la foto (alt)",

  "panel.reembolso.titulo": "Reembolso parcial",
  "panel.reembolso.pagado": "Pagado",
  "panel.reembolso.devuelto": "Ya devuelto",
  "panel.reembolso.resta": "Queda por devolver",
  "panel.reembolso.monto": "Monto a devolver",
  "panel.reembolso.motivo": "Motivo",
  "panel.reembolso.motivo.placeholder":
    "Ej: la compradora devolvió una de las tres unidades",
  "panel.reembolso.confirmar": "Registrar devolución",
  "panel.reembolso.cancelar": "Cancelar",
  "panel.reembolso.abrir": "Reembolso parcial…",
  "panel.reembolso.hecho": "Devolución registrada.",
  "panel.reembolso.completo": "Con esto el pago queda devuelto por completo.",
  "panel.reembolso.excede":
    "El monto no puede superar lo que queda por devolver.",

  // ===========================================================================
  // == S9 — panel de pedidos: tracking, notas, remito imprimible (§6.1) ==
  // ===========================================================================
  "panel.pedido.imprimirRemito": "Imprimir remito",
  "panel.pedido.tracking.titulo": "Seguimiento",
  "panel.pedido.tracking.courier": "Transporte",
  "panel.pedido.tracking.guia": "Guía",
  "panel.pedido.tracking.link": "Link",
  "panel.pedido.notas": "Notas internas",

  "panel.acciones.tracking.titulo": "Seguimiento del envío (opcional)",
  "panel.acciones.tracking.courier": "Transporte",
  "panel.acciones.tracking.courier.placeholder": "Moto propia, OCA, correo…",
  "panel.acciones.tracking.guia": "Número de guía",
  "panel.acciones.tracking.guia.placeholder": "Ej.: 123456789",
  "panel.acciones.tracking.link": "Link de seguimiento",
  "panel.acciones.tracking.link.placeholder": "https://…",
  "panel.acciones.tracking.opcional":
    "Los tres campos son opcionales. Lo que cargues acá lo ve la compradora en la página de su pedido.",

  "panel.notas.sinNotas": "Todavía no hay notas en este pedido.",
  "panel.notas.placeholder": "Llamó, pasa a retirar el jueves…",
  "panel.notas.contador": "{n}/{maximo}",
  "panel.notas.agregar": "Agregar nota",
  "panel.notas.guardando": "Guardando…",
  "panel.notas.guardada": "Nota guardada.",

  "panel.remito.meta": "Remito",
  "panel.remito.imprimir": "Imprimir",
  "panel.remito.volver": "← Volver al pedido",
  "panel.remito.titulo": "Remito",
  "panel.remito.numeroPedido": "N.º de pedido",
  "panel.remito.entrega": "Entrega",
  "panel.remito.nombre": "Nombre",
  "panel.remito.telefono": "Teléfono",
  "panel.remito.direccion": "Dirección",
  "panel.remito.referencia": "Referencia",
  "panel.remito.esRegalo": "Es un regalo",
  "panel.remito.items": "Contenido",
  "panel.remito.sku": "SKU",
  "panel.remito.producto": "Producto",
  "panel.remito.cantidad": "Cant.",
  "panel.remito.total": "Total",
  "panel.remito.totalPedido": "Total: {total}",

  "pedido.tracking.titulo": "Seguimiento del envío",
  "pedido.tracking.courierYguia": "{courier} · Guía {guia}",
  "pedido.tracking.soloCourier": "{courier}",
  "pedido.tracking.soloGuia": "Guía {guia}",
  "pedido.tracking.verEnvio": "Seguí tu envío →",

  // -------------------------------------------------------------------------
  // == S11 == Vidriera: destacados, vistos recientemente, avisame, consulta
  // por WhatsApp por variante (plan-operacion §6.3)
  // -------------------------------------------------------------------------
  // Fallback de la home sin destacados elegidos a mano — misma lista de
  // productos que "home.destacados", pero el título dice lo que es: lo más
  // nuevo, no una selección del comercio.
  "home.novedades": "Novedades",

  "producto.vistosRecientemente": "Vistos recientemente",

  "stock.avisame.titulo": "Avisame cuando haya stock",
  "stock.avisame.label": "Tu WhatsApp",
  "stock.avisame.boton": "Avisame",
  "stock.avisame.enviando": "Enviando…",
  "stock.avisame.listo":
    "Listo, te avisamos por WhatsApp apenas vuelva el stock.",

  // El texto que arma `variant-inquiry-link.tsx`. La URL, cuando hay
  // `NEXT_PUBLIC_SITE_URL`, se agrega aparte con un separador " — " en vez de
  // ir adentro de la clave: así una tienda que no configuró esa variable
  // manda el mismo mensaje sin un hueco vacío al final.
  "producto.consultaVariante":
    'Hola, quiero consultar por "{producto}" ({variante}, SKU {sku})',
  "producto.consultarWhatsApp": "Consultar por WhatsApp",

  // -------------------------------------------------------------------------
  // == O14 == Deuda de dominio: destacados, foto de categoría, slug largo,
  // planilla dañada (fable/plan-crecimiento.md §5.1)
  // -------------------------------------------------------------------------
  "adminForm.slugLargo": "El slug no puede pasar los 160 caracteres.",

  // -------------------------------------------------------------------------
  // == O15 == Recordatorio de pago antes del vencimiento
  // (fable/plan-crecimiento.md §5.2)
  // -------------------------------------------------------------------------
  // Sin datos de otras personas y sin datos bancarios: número de pedido, total,
  // hasta cuándo, y el link tokenizado donde están las instrucciones de pago
  // que la tienda ya sabe dar.
  "wa.cliente.recordatorio":
    "Hola {nombre}! Tu pedido {numero} ({total}) todavía está esperando el pago.",
  "wa.cliente.recordatorio.limite": "Podés pagarlo hasta las {limite}.",
  "wa.cliente.recordatorio.pagar": "Pagá o mirá cómo acá: {url}",

  // -------------------------------------------------------------------------
  // == O16 == Editar un pedido antes del pago (fable/plan-crecimiento.md §5.3)
  // -------------------------------------------------------------------------
  // Los lee el staff en el panel, no la compradora: dicen qué se puede hacer
  // en vez de "no se pudo".
  "error.edicion.noExiste": "Ese pedido ya no existe.",
  "error.edicion.estado":
    "Sólo se puede editar un pedido que todavía está esperando el pago.",
  "error.edicion.tarjeta":
    "Un pedido con tarjeta no se edita: el monto ya está comprometido en Pagopar. Cancelalo y que lo haga de nuevo.",
  "error.edicion.yaPagado":
    "Este pedido ya tiene el pago acreditado: no se edita.",
  "error.edicion.motivo":
    "Escribí por qué lo estás editando: queda en la historia del pedido.",
  "error.edicion.sinLineas": "Ese pedido no tiene líneas para editar.",
  "error.edicion.cantidad":
    "La cantidad tiene que ser un número entero de 0 para arriba.",
  "error.edicion.lineaAjena": "Esa línea no es de este pedido.",
  "error.edicion.cantidadSube":
    "Acá las cantidades sólo bajan. Para agregar productos hace falta un pedido nuevo.",
  "error.edicion.quedaVacio":
    "El pedido no puede quedar sin nada. Si ya no quiere nada, cancelalo.",
  "error.edicion.envio":
    "Esa forma de entrega no sirve para esta ciudad. Elegí otra antes de guardar.",
  "error.edicion.envioPago":
    "Esa forma de entrega no acepta el medio de pago de este pedido.",

  // El mensaje que el staff le manda a la compradora después de editar. Lo
  // manda una persona por el `wa.me` de siempre: una edición se acordó por
  // WhatsApp hace un minuto y el que sigue no lo escribe el servidor.
  "wa.edicion.total": "Listo, tu pedido {numero} quedó en {total}.",
  "wa.edicion.cuponQuitado":
    "Con las cantidades nuevas el cupón ya no llegaba al mínimo, así que quedó sin descuento.",
  "wa.edicion.limite": "Podés pagarlo hasta las {limite}.",
  "wa.edicion.link": "Mirá el detalle acá: {url}",

  // -------------------------------------------------------------------------
  // == S17 == Panel y vidriera: dibujar lo que O14–O16 dejaron
  // (fable/plan-crecimiento.md §6.1)
  // -------------------------------------------------------------------------

  // Destacados (A): O14 dejó `isFeatured` en `saveProduct`/`listAdminProducts`.
  "panel.producto.destacado": "Destacado en la home",
  "panel.producto.destacadoAyuda":
    "Aparece en la fila de destacados de la portada, antes que el resto del catálogo.",
  "panel.productos.destacadoChip": "Destacado",
  "panel.filtros.destacados": "Sólo destacados",

  // Foto de categoría (B): antes era un ID de Cloudinary pegado a mano.
  "panel.categoria.foto.vacia": "Todavía no tiene foto.",
  "panel.categoria.foto.subida": "Foto actualizada.",

  // Editar un pedido antes del pago (D): O16 dejó el dominio y la acción.
  "panel.pedido.editar.titulo": "Editar pedido",
  "panel.pedido.editar.abrir": "Editar pedido",
  "panel.pedido.editar.motivoTarjeta":
    "Con tarjeta no se edita: el monto ya está comprometido en Pagopar. Cancelalo y que la compradora lo haga de nuevo.",
  "panel.pedido.editar.motivoPagado":
    "Este pedido ya tiene el pago acreditado: no se edita.",
  "panel.pedido.editar.motivoEstado":
    "Sólo se puede editar un pedido que todavía está esperando el pago.",
  "panel.pedido.editar.items": "Cantidades",
  "panel.pedido.editar.quitar": "Quitar",
  "panel.pedido.editar.ciudad": "Ciudad",
  "panel.pedido.editar.direccion": "Dirección",
  "panel.pedido.editar.referencia": "Referencia",
  "panel.pedido.editar.envio": "Forma de entrega",
  "panel.pedido.editar.sinEnvios":
    "No hay una forma de entrega que acepte el medio de pago de este pedido.",
  "panel.pedido.editar.motivo": "Motivo de la edición",
  "panel.pedido.editar.motivo.placeholder":
    "Ej: la compradora pidió bajar una unidad",
  "panel.pedido.editar.motivoCorto":
    "Contá en pocas palabras por qué lo estás editando.",
  "panel.pedido.editar.guardar": "Guardar cambios",
  "panel.pedido.editar.guardado": "Pedido editado.",
  "panel.pedido.editar.resumen": "Total: {antes} → {despues}",
  "panel.pedido.editar.cuponQuitado":
    "Con las cantidades nuevas el cupón {codigo} ya no llegaba al mínimo, así que quedó sin descuento.",
  "panel.pedido.editar.avisar": "Avisar por WhatsApp",

  // Timeline (E): la línea del recordatorio de pago (O15) en la ficha.
  "panel.pedido.recordatorioEnviado": "Recordatorio de pago enviado el {fecha}",

  // `src/app/admin/error.tsx` (F): el mismo boundary genérico no distinguía
  // un error de checkout de un error del panel.
  "admin.error.titulo": "Algo falló en el panel",
  "admin.error.texto":
    "No se pudo cargar esta pantalla. Podés reintentar o volver al inicio del panel — el pedido o el producto no se tocaron.",
  "admin.error.volver": "Volver a /admin",

  // -------------------------------------------------------------------------
  // Reseñas verificadas (`src/domain/reviews.ts`): sólo quien recibió el
  // pedido califica; el panel modera y responde.
  // -------------------------------------------------------------------------
  "error.resena.estrellas": "Elegí de 1 a 5 estrellas.",
  "error.resena.corta": "Contanos un poco más: al menos {minimo} caracteres.",
  "error.resena.larga": "La reseña puede tener hasta {maximo} caracteres.",
  "error.resena.tituloLargo":
    "El título puede tener hasta {maximo} caracteres.",
  "error.resena.pedidoNoExiste": "No encontramos ese pedido.",
  "error.resena.noEntregado":
    "Vas a poder calificar tu compra cuando el pedido figure como entregado.",
  "error.resena.noEstaEnElPedido": "Ese producto no está en este pedido.",
  "error.resena.yaCalificaste": "Ya calificaste este producto.",
  "error.resena.estadoInvalido": "No entendí qué hacer con la reseña.",
  "error.resena.respuestaLarga":
    "La respuesta puede tener hasta {maximo} caracteres.",
  "error.resena.noExiste": "Esa reseña ya no existe.",
  "error.resena.demasiados":
    "Mandaste muchas reseñas seguidas. Probá de nuevo en un rato.",
  "error.resena.generico":
    "No pudimos guardar tu reseña. Probá de nuevo en un momento.",
  "resena.autorSinNombre": "Compradora",

  // La página del pedido (`/pedido/[orderNumber]`), con el pedido entregado.
  "pedido.resenas.titulo": "Calificá tu compra",
  "pedido.resenas.bajada":
    "Tu opinión ayuda a otras personas a elegir. Se publica con tu nombre y la inicial de tu apellido.",
  "pedido.resenas.estrellas": "¿Cuántas estrellas le das a {producto}?",
  "pedido.resenas.estrella.uno": "{n} estrella",
  "pedido.resenas.estrella.varios": "{n} estrellas",
  "pedido.resenas.tituloCampo": "Título (opcional)",
  "pedido.resenas.cuerpo": "Tu reseña",
  "pedido.resenas.cuerpoPlaceholder": "¿Qué te pareció? ¿Es lo que esperabas?",
  "pedido.resenas.contador": "{n}/{maximo}",
  "pedido.resenas.enviar": "Enviar reseña",
  "pedido.resenas.enviando": "Enviando…",
  "pedido.resenas.gracias":
    "¡Gracias! Tu reseña se publica cuando la revisemos.",
  "pedido.resenas.yaCalificado": "Ya calificaste {producto}. ¡Gracias!",

  // La ficha de producto.
  "estrellas.label": "{valor} de 5 estrellas",
  "producto.resenas.resumen.uno": "{promedio} ({n} reseña)",
  "producto.resenas.resumen.varios": "{promedio} ({n} reseñas)",
  "producto.resenas.titulo": "Reseñas",
  "producto.resenas.compraVerificada": "Compra verificada",
  "producto.resenas.respuesta": "Respuesta de la tienda",

  // WhatsApp a la compradora cuando el pedido se entrega.
  "wa.cliente.resena":
    "Hola {nombre}! ¿Qué tal tu pedido {numero}? Contanos qué te pareció: {url}",

  // `/admin/resenas`.
  "panel.nav.resenas": "Reseñas",
  "panel.nav.resenasPendientes": "Reseñas ({n})",
  "panel.resenas.meta": "Reseñas",
  "panel.resenas.titulo": "Reseñas",
  "panel.resenas.bajada":
    "Sólo escriben quienes recibieron su pedido. Podés publicarlas, rechazarlas y responder en público, pero no cambiar lo que escribió la compradora.",
  "panel.resenas.estado.pendiente": "Por revisar",
  "panel.resenas.estado.aprobada": "Publicadas",
  "panel.resenas.estado.rechazada": "Rechazadas",
  "panel.resenas.vacio": "No hay reseñas en esta lista.",
  "panel.resenas.pedido": "Pedido {numero}",
  "panel.resenas.aprobar": "Publicar",
  "panel.resenas.rechazar": "Rechazar",
  "panel.resenas.respuesta": "Respuesta pública de la tienda",
  "panel.resenas.respuestaPlaceholder":
    "Se publica debajo de la reseña. Vacía, no se muestra ninguna.",
  "panel.resenas.guardarRespuesta": "Guardar respuesta",
  "panel.resenas.aprobada": "Reseña publicada.",
  "panel.resenas.rechazada": "Reseña rechazada.",
  "panel.resenas.respuestaGuardada": "Respuesta guardada.",
  "adminError.noEntendi.resena": "No entendí qué hacer con esa reseña.",

  // -------------------------------------------------------------------------
  // Devoluciones de mercadería (`src/domain/returns.ts`): qué volvió y si va
  // al stock. La plata sigue por el reembolso, aparte.
  // -------------------------------------------------------------------------
  "error.devolucion.sinMotivo":
    "Contá en pocas palabras por qué vuelve la mercadería.",
  "error.devolucion.motivoLargo":
    "El motivo puede tener hasta {maximo} caracteres.",
  "error.devolucion.sinItems": "Elegí al menos una unidad que vuelva.",
  "error.devolucion.cantidad":
    "Las cantidades tienen que ser enteras y mayores que cero.",
  "error.devolucion.lineaRepetida":
    "Una línea del pedido aparece dos veces en la devolución.",
  "error.devolucion.pedidoNoExiste": "Ese pedido no existe.",
  "error.devolucion.estado":
    "Sólo se registra una devolución de un pedido enviado, entregado o reembolsado. Antes de eso, editalo o cancelalo.",
  "error.devolucion.lineaAjena": "Esa línea no es de este pedido.",
  "error.devolucion.demasiado":
    "De {producto} se pueden devolver {queda} como máximo.",
  "adminError.noEntendi.mercaderia":
    "No entendí la devolución. Revisá las cantidades.",

  "panel.nav.devoluciones": "Devoluciones",
  "panel.devoluciones.meta": "Devoluciones",
  "panel.devoluciones.titulo": "Devoluciones",
  "panel.devoluciones.bajada":
    "Las últimas mercaderías que volvieron. La plata, si se devolvió, está en el reembolso de cada pedido.",
  "panel.devoluciones.vacio": "Todavía no se registró ninguna devolución.",
  "panel.devoluciones.item": "{n}× {producto}",
  "panel.devoluciones.repuesto": "volvió al stock",
  "panel.devoluciones.noRepuesto": "no volvió al stock",
  "panel.devoluciones.motivo": "Motivo: {motivo}",

  // Ficha del pedido.
  "panel.pedido.devoluciones": "Devoluciones",
  "panel.pedido.devoluciones.ninguna": "Este pedido no tiene devoluciones.",
  "panel.pedido.devoluciones.noCorresponde":
    "Se registra una devolución cuando el pedido ya salió (enviado, entregado o reembolsado).",
  "panel.pedido.devoluciones.nueva": "Registrar una devolución",
  "panel.pedido.devoluciones.cantidad": "Vuelven",
  "panel.pedido.devoluciones.deTotal": "de {n}",
  "panel.pedido.devoluciones.alStock": "Volver al stock",
  "panel.pedido.devoluciones.motivo": "Motivo",
  "panel.pedido.devoluciones.motivoPlaceholder":
    "Ej: cambio de talle, llegó fallado",
  "panel.pedido.devoluciones.registrar": "Registrar devolución",
  "panel.pedido.devoluciones.registrando": "Registrando…",
  "panel.pedido.devoluciones.registrada": "Devolución registrada.",
  "panel.pedido.devoluciones.nadaQueDevolver":
    "Ya se devolvió todo lo de este pedido.",
  "panel.pedido.devoluciones.reembolso":
    "¿Hay que devolver plata? Usá el reembolso de este pedido.",

  // Página pública del pedido, con el pedido entregado.
  "pedido.cambio.link": "¿Querés cambiar o devolver algo?",
  "pedido.cambio.waMensaje":
    "¡Hola! Quiero cambiar o devolver algo de mi pedido {numero}.",

  // Ajustes de la tienda (`/admin/ajustes`) y lo que dibujan en la vidriera.
  "panel.nav.ajustes": "Ajustes",
  "panel.ajustes.meta": "Ajustes",
  "panel.ajustes.titulo": "Ajustes de la tienda",
  "panel.ajustes.bajada":
    "Lo que antes había que pedirle al desarrollador. Un campo vacío usa el valor de siempre, que se muestra abajo de cada uno.",
  "panel.ajustes.actualizado": "Última edición: {fecha}",
  "panel.ajustes.indice": "Secciones de los ajustes",
  "panel.ajustes.guardado": "Ajustes guardados.",
  "panel.ajustes.restaurado": "Valores por defecto restaurados.",
  "panel.ajustes.restaurar": "Restaurar valores por defecto",
  "panel.ajustes.restaurarConfirmar":
    "¿Volver esta sección a sus valores por defecto? Lo que cargaste se pierde.",
  "panel.ajustes.vacioUsa": "Vacío: se usa «{valor}».",
  "panel.ajustes.vacioNada": "Vacío: no se muestra.",
  "panel.ajustes.si": "Sí",
  "panel.ajustes.no": "No",
  "panel.ajustes.marca.titulo": "Marca y portada",
  "panel.ajustes.marca.bajada":
    "La bajada del pie, el título y la descripción de la home para Google, y la portada de arriba de todo.",
  "panel.ajustes.marca.tagline": "Bajada (una línea en el pie)",
  "panel.ajustes.marca.seoTitulo": "Título de la home en Google",
  "panel.ajustes.marca.seoDescripcion": "Descripción de la home en Google",
  "panel.ajustes.marca.hero": "Portada de la home",
  "panel.ajustes.marca.heroActivo": "Mostrar la portada",
  "panel.ajustes.marca.heroTitulo": "Título",
  "panel.ajustes.marca.heroTexto": "Texto",
  "panel.ajustes.marca.heroCtaLabel": "Texto del botón",
  "panel.ajustes.marca.heroCtaHref": "Link del botón",
  "panel.ajustes.marca.heroCtaHrefDefecto": "la primera categoría",
  "panel.ajustes.marca.heroCtaHrefAyuda":
    "Una página de la tienda (/categoria/ofertas) o un link que empiece con https://.",
  "panel.ajustes.marca.heroImagen": "Foto de portada",
  "panel.ajustes.marca.heroImagenAlt":
    "Descripción de la foto (para quien no la ve)",
  "panel.ajustes.marca.imagenVacia":
    "Sin foto: la portada se dibuja con el fondo de siempre.",
  "panel.ajustes.marca.imagenArchivo": "Imagen (JPG, PNG o WebP, hasta 5 MB)",
  "panel.ajustes.marca.imagenSubir": "Subir foto",
  "panel.ajustes.marca.imagenSubida": "Foto de portada cargada.",
  "panel.ajustes.marca.imagenQuitar": "Quitar foto",
  "panel.ajustes.marca.imagenQuitada": "Foto de portada quitada.",
  "panel.ajustes.marca.sinCloudinary":
    "Para subir fotos falta configurar Cloudinary (CLOUDINARY_* en el entorno).",
  "panel.ajustes.anuncio.titulo": "Barra de anuncio",
  "panel.ajustes.anuncio.bajada":
    "Una línea arriba de todo en la tienda: una promo, un feriado, un aviso de envíos.",
  "panel.ajustes.anuncio.activo": "Mostrar la barra",
  "panel.ajustes.anuncio.texto": "Texto (hasta 140 caracteres)",
  "panel.ajustes.anuncio.textoEjemplo":
    "Envío gratis en Asunción desde ₲ 300.000",
  "panel.ajustes.anuncio.href": "Link (opcional)",
  "panel.ajustes.contacto.titulo": "Contacto y redes",
  "panel.ajustes.contacto.bajada":
    "Lo que ven las compradoras: el botón de WhatsApp, el pie y las páginas de políticas. Los avisos de pedidos nuevos te siguen llegando al número del entorno (WHATSAPP_NUMBER).",
  "panel.ajustes.contacto.whatsapp": "WhatsApp público",
  "panel.ajustes.contacto.whatsappAyuda":
    "Un número paraguayo: 0981 123 456 o +595 981 123 456.",
  "panel.ajustes.contacto.email": "Email",
  "panel.ajustes.contacto.direccion": "Dirección",
  "panel.ajustes.contacto.horario": "Horario de atención",
  "panel.ajustes.contacto.horarioEjemplo": "Lunes a viernes de 8 a 18",
  "panel.ajustes.envio.titulo": "Envíos y devoluciones (datos para Google)",
  "panel.ajustes.envio.bajada":
    "Google los muestra en los resultados de producto. Sólo se publica lo que cargues completo: nada se inventa.",
  "panel.ajustes.envio.preparacion": "preparación",
  "panel.ajustes.envio.preparacionMin": "Días de preparación (mínimo)",
  "panel.ajustes.envio.preparacionMax": "Días de preparación (máximo)",
  "panel.ajustes.envio.transito": "viaje",
  "panel.ajustes.envio.transitoMin": "Días de viaje (mínimo)",
  "panel.ajustes.envio.transitoMax": "Días de viaje (máximo)",
  "panel.ajustes.envio.desde": "Envío desde (₲)",
  "panel.ajustes.envio.desdeAyuda":
    "El envío más barato, en guaraníes enteros. 0 si hay envío gratis.",
  "panel.ajustes.envio.aceptaDevoluciones": "¿Aceptás devoluciones?",
  "panel.ajustes.envio.sinResponder": "Sin responder",
  "panel.ajustes.envio.diasDevolucion": "Días para devolver",
  "panel.ajustes.envio.costoDevolucion": "¿Quién paga la devolución?",
  "panel.ajustes.envio.costoCliente": "La compradora",
  "panel.ajustes.envio.costoGratis": "La tienda (devolución gratis)",
  "panel.ajustes.envio.metodoDevolucion": "¿Cómo se devuelve?",
  "panel.ajustes.envio.metodoEnvio": "Por envío",
  "panel.ajustes.envio.metodoLocal": "En el local",
  "panel.ajustes.envio.metodoAmbos": "Las dos",
  "panel.ajustes.envio.ayuda":
    "El envío sale en Google con el precio y los dos rangos de días completos. La política de devolución, sólo si respondiste la primera pregunta.",
  "panel.ajustes.paginas.tituloSeccion": "Páginas",
  "panel.ajustes.paginas.bajada":
    "Envíos, devoluciones, preguntas frecuentes, términos y privacidad. Se enlazan desde el pie. En el texto podés usar {placeholders}.",
  "panel.ajustes.paginas.ver": "Ver {ruta}",
  "panel.ajustes.paginas.porDefecto":
    "Texto por defecto — revisalo antes de publicar.",
  "panel.ajustes.paginas.activo": "Publicar esta página",
  "panel.ajustes.paginas.titulo": "Título",
  "panel.ajustes.paginas.cuerpo": "Texto",
  "panel.ajustes.paginas.restaurar": "Restaurar texto por defecto",
  "panel.ajustes.vidriera.titulo": "Vidriera",
  "panel.ajustes.vidriera.bajada":
    "Detalles de la tienda que se pueden prender o apagar.",
  "panel.ajustes.vidriera.estrellas": "Estrellas en las tarjetas de producto",
  "panel.ajustes.vidriera.estrellasAyuda":
    "Sólo en los productos con al menos una reseña aprobada.",
  "panel.ajustes.vidriera.barra": "Barra de compra fija en el celular",
  "panel.ajustes.vidriera.barraAyuda":
    "En la ficha, aparece abajo cuando el botón de agregar quedó fuera de la pantalla.",
  "panel.ajustes.checkout.tituloSeccion": "Checkout",
  "panel.ajustes.checkout.bajada":
    "Un recuadro de confianza abajo del formulario de compra. Los medios de pago se listan solos, según lo que la tienda ofrece.",
  "panel.ajustes.checkout.activo": "Mostrar el recuadro",
  "panel.ajustes.checkout.titulo": "Título del recuadro",
  "panel.ajustes.checkout.lineas": "Líneas (hasta 4)",
  "panel.ajustes.checkout.linea": "Línea",
  "panel.ajustes.checkout.lineaN": "Línea {n}",
  "panel.ajustes.checkout.lineasAyuda":
    "Todas vacías: se usan las de siempre (las que se ven en gris).",
  "panel.ajustes.stock.titulo": "Stock",
  "panel.ajustes.stock.bajada":
    "Cuántas unidades cuentan como stock bajo en el resumen y en el aviso diario. El umbral propio de cada variante igual gana.",
  "panel.ajustes.stock.umbral": "Umbral de stock bajo",
  "adminError.ajustes.seccion": "Esa sección de ajustes no existe.",
  "adminError.ajustes.invalido": "No se guardó: {detalle}",
  "adminError.ajustes.largo": "{campo}: hasta {maximo} caracteres.",
  "adminError.ajustes.link":
    "{campo}: tiene que ser una página de la tienda (/…) o un link https://.",
  "adminError.ajustes.https":
    "{campo}: tiene que ser un link que empiece con https://.",
  "adminError.ajustes.numero": "{campo}: tiene que ser un número entero.",
  "adminError.ajustes.rango": "{campo}: entre {minimo} y {maximo}.",
  "adminError.ajustes.rangoDias":
    "Días de {campo}: cargá el mínimo y el máximo, y que el mínimo no sea mayor.",
  "adminError.ajustes.diasDevolucion":
    "Si aceptás devoluciones, cargá cuántos días hay para devolver.",
  "adminError.ajustes.anuncioSinTexto":
    "Para mostrar la barra de anuncio, escribí el texto.",
  "adminError.ajustes.whatsapp":
    "Ese WhatsApp no parece un número paraguayo (ej: 0981 123 456).",
  "adminError.ajustes.email": "Ese email no es válido.",
  "adminError.ajustes.lineas": "Hasta 4 líneas.",
  "adminError.ajustes.elegiImagen": "Elegí una imagen.",
  "footer.ayuda": "Ayuda",
  "footer.redes": "Redes sociales",
  "catalogo.resenas.uno": "{n} reseña",
  "catalogo.resenas.varios": "{n} reseñas",
  "producto.barraCompra.label": "Comprar este producto",
  "producto.barraCompra.boton": "Comprar",
  "checkout.confianza.titulo": "Comprá tranquilo",
  "checkout.confianza.linea1": "Precios en guaraníes, IVA incluido",
  "checkout.confianza.linea2": "Seguí tu pedido con su enlace privado",
  "checkout.confianza.linea3": "Envíos a todo el país",
  "checkout.confianza.medios": "Podés pagar con:",
  "checkout.confianza.whatsapp": "¿Dudas? Escribinos por WhatsApp",
  "checkout.confianza.waMensaje":
    "¡Hola! Tengo una duda antes de terminar mi compra.",
  "paginas.dias.uno": "{n} día",
  "paginas.dias.varios": "{n} días",
  "paginas.y": "y",
  "paginas.placeholder.tienda": "nuestra tienda",
  "paginas.placeholder.url": "este sitio",
  "paginas.placeholder.whatsapp": "lo encontrás en el pie de esta página",
  "paginas.placeholder.email": "por ahora, sólo por WhatsApp",
  "paginas.placeholder.direccion": "a coordinar por WhatsApp",
  "paginas.placeholder.horario": "consultalo por WhatsApp",
  "paginas.placeholder.diasDevolucion": "los primeros días",
  "paginas.placeholder.mediosDePago":
    "los medios que ves al finalizar la compra",
  "panel.nav.integraciones": "Integraciones",
  "panel.integraciones.meta": "Integraciones",
  "panel.integraciones.titulo": "Integraciones",
  "panel.integraciones.bajada":
    "Cloudinary, WhatsApp, Pagopar, medición y reporte de errores, sin tocar el hPanel ni redeployar. Lo que cargues acá manda sobre las variables de entorno; vacío, vuelve a mandar el entorno, y sin ninguno de los dos la función queda apagada.",
  "panel.integraciones.sinClave":
    "No se puede leer ni guardar nada acá: SESSION_SECRET no está configurado en el hosting (o es el de ejemplo, o mide menos de 32 caracteres). Es la clave con la que se cifran estos datos. Mientras tanto, todo sale de las variables de entorno.",
  "panel.integraciones.estado.panel": "Activa · desde el panel",
  "panel.integraciones.estado.entorno": "Activa · desde el entorno",
  "panel.integraciones.estado.apagada": "Apagada",
  "panel.integraciones.estado.incompleta": "Incompleta",
  "panel.integraciones.fuente.panel": "desde el panel",
  "panel.integraciones.fuente.entorno": "desde el entorno ({variable})",
  "panel.integraciones.fuente.ninguna": "sin cargar ({variable})",
  "panel.integraciones.secreto.configurado": "Configurado {mascara}",
  "panel.integraciones.secreto.noConfigurado": "No configurado",
  "panel.integraciones.secreto.ilegible":
    "Guardado, pero no se puede descifrar (¿cambió SESSION_SECRET?). Cargalo de nuevo.",
  "panel.integraciones.secreto.reemplazar": "Pegá uno nuevo para reemplazarlo",
  "panel.integraciones.secreto.borrar": "Borrar el guardado",
  "panel.integraciones.guardar": "Guardar",
  "panel.integraciones.guardado": "Guardado. La tienda ya usa estos datos.",
  "panel.integraciones.sinCambios": "No había nada que cambiar.",
  "panel.integraciones.probar": "Probar conexión",
  "panel.integraciones.probando": "Probando…",
  "panel.integraciones.volverAlEntorno": "Borrar lo del panel",
  "panel.integraciones.volverConfirmar":
    "¿Borrar todo lo cargado en el panel para esta integración? Vuelven a mandar las variables de entorno (o queda apagada si no hay).",
  "panel.integraciones.vueltoAlEntorno": "Listo: vuelve a mandar el entorno.",
  "panel.integraciones.actualizado": "Guardado en el panel el {fecha}",
  "panel.integraciones.cloudinary.titulo": "Cloudinary",
  "panel.integraciones.cloudinary.bajada":
    "Fotos de producto, comprobantes de pago (carpeta privada) y copias de seguridad. Sin esto la compradora no puede subir el comprobante.",
  "panel.integraciones.whatsapp.titulo": "WhatsApp",
  "panel.integraciones.whatsapp.bajada":
    "El número del comercio (a donde llegan los avisos al dueño) y la WhatsApp Cloud API de Meta con sus plantillas aprobadas. Cada plantilla vacía apaga sólo ese aviso.",
  "panel.integraciones.pagopar.titulo": "Pagopar",
  "panel.integraciones.pagopar.bajada":
    "Pago con tarjeta. Las tres credenciales van juntas; sin ellas el checkout no ofrece tarjeta y el webhook responde 503. En el panel de Pagopar, la URL de respuesta es /api/webhooks/pagopar de este sitio.",
  "panel.integraciones.analitica.titulo": "Medición",
  "panel.integraciones.analitica.bajada":
    "Google Analytics 4 y el Pixel de Meta. Vacíos, la tienda no carga ni un byte de terceros. No son secretos: viajan en el HTML.",
  "panel.integraciones.errores.titulo": "Reporte de errores",
  "panel.integraciones.errores.bajada":
    "Un webhook https propio (Slack, Discord, n8n) que recibe los errores del servidor. Sin datos de compradoras. Vacío, nada sale de la máquina.",
  "panel.integraciones.campo.cloudName": "Cloud name",
  "panel.integraciones.campo.apiKey": "API key",
  "panel.integraciones.campo.apiSecret": "API secret",
  "panel.integraciones.campo.folderPrefix":
    "Prefijo de carpetas (sólo si varias tiendas comparten la cuenta; no lo cambies con fotos subidas)",
  "panel.integraciones.campo.numeroComercio":
    "WhatsApp del comercio (avisos al dueño)",
  "panel.integraciones.campo.phoneNumberId": "Phone number ID (Cloud API)",
  "panel.integraciones.campo.accessToken": "Token de acceso permanente",
  "panel.integraciones.campo.apiVersion":
    "Versión de la Graph API (vacío = v21.0)",
  "panel.integraciones.campo.plantillaLogin": "Plantilla: código de login",
  "panel.integraciones.campo.plantillaRecuperarPedido":
    "Plantilla: recuperar enlace privado del pedido",
  "csv.producto.modo": "Modo de venta",
  "checkout.consultar": "Consultá con la tienda para coordinar tu compra",
  "error.operacion.archivada":
    "Esta operación ya fue procesada y archivada. Revisá el pedido o consultá con la tienda antes de iniciar otra.",
  "panel.pedido.tarjetaIncierta":
    "El inicio del pago con tarjeta quedó sin respuesta confirmada. Revisá la operación en Pagopar antes de intentar otro cobro; este pedido no iniciará otro automáticamente.",
  "csv.producto.mostrarPrecio": "Mostrar precio",
  "panel.integraciones.campo.plantillaPedidoNuevo":
    "Plantilla: pedido nuevo (al dueño)",
  "panel.integraciones.campo.plantillaClienteConfirmado":
    "Plantilla: pedido confirmado",
  "panel.integraciones.campo.plantillaClientePagado":
    "Plantilla: pago registrado",
  "panel.integraciones.campo.plantillaClienteEnviado":
    "Plantilla: pedido enviado",
  "panel.integraciones.campo.plantillaClienteRecordatorio":
    "Plantilla: recordatorio de pago",
  "panel.integraciones.campo.plantillaClienteResena":
    "Plantilla: pedido de reseña",
  "panel.integraciones.campo.plantillaResumenDiario":
    "Plantilla: resumen diario (al dueño)",
  "panel.integraciones.campo.plantillaStockDisponible":
    "Plantilla: avisame cuando haya stock",
  "panel.integraciones.campo.publicKey": "Clave pública",
  "panel.integraciones.campo.privateKey": "Clave privada",
  "panel.integraciones.campo.baseUrl":
    "URL de la API (https://…, sin barra final)",
  "panel.integraciones.campo.ga4Id": "ID de medición de GA4 (G-XXXXXXXXXX)",
  "panel.integraciones.campo.metaPixelId": "ID del Pixel de Meta",
  "panel.integraciones.campo.reportUrl": "URL del webhook (https://…)",
  "panel.integraciones.prueba.incompleta":
    "Faltan datos para probar: {faltan}.",
  "panel.integraciones.prueba.cloudinaryOk":
    "Cloudinary respondió: las credenciales andan.",
  "panel.integraciones.prueba.cloudinaryError":
    "Cloudinary rechazó la prueba: {detalle}",
  "panel.integraciones.prueba.whatsappOk":
    "Meta respondió: número {numero} ({nombre}).",
  "panel.integraciones.prueba.whatsappError":
    "Meta rechazó la consulta: {detalle}",
  "panel.integraciones.prueba.pagoparOk":
    "{host} responde por https. Las claves sólo se verifican con una transacción de prueba en el sandbox (tests/integration/pagopar-sandbox.test.ts).",
  "panel.integraciones.prueba.pagoparError":
    "No se pudo llegar a {host}: {detalle}",
  "panel.integraciones.prueba.pagoparMock":
    "Pagopar está en modo simulador (PAGOPAR_MODE=mock): no hay nada que probar.",
  "panel.integraciones.prueba.red": "sin respuesta ({detalle})",
  "panel.integraciones.prueba.noAplica":
    "Esta integración no tiene prueba de conexión.",
  "adminError.integraciones.formato": "{campo}: el formato no es válido.",
  "adminError.integraciones.ga4":
    "El ID de GA4 tiene la forma G-XXXXXXXXXX (el ID de medición, no el de la propiedad).",
  "adminError.integraciones.pixel": "El ID del Pixel de Meta es sólo números.",
  "adminError.integraciones.plantilla":
    "{campo}: el nombre de una plantilla de Meta va en minúsculas, números y guiones bajos.",
  "adminError.integraciones.whatsapp":
    "Ese WhatsApp no parece un número paraguayo (ej: 0981 123 456).",
  "adminError.integraciones.https":
    "{campo}: tiene que ser un link que empiece con https://.",
  "adminError.integraciones.sinClave":
    "No se puede guardar: SESSION_SECRET no está configurado en el hosting (o es el de ejemplo). Es la clave con la que se cifran estos datos.",
  "adminError.integraciones.campo": "Ese campo no existe: {campo}.",
  "adminError.integraciones.integracion": "Esa integración no existe.",
  "panel.ajustes.identidad.titulo": "Identidad",
  "panel.ajustes.identidad.bajada":
    "El nombre de la tienda, el logo, el favicon y el color de marca. Vacíos, se usa lo del código (src/config/tienda.ts) y el tema de siempre.",
  "panel.ajustes.identidad.nombre": "Nombre de la tienda",
  "panel.ajustes.identidad.nombreAyuda":
    "Sale en el header, en el título de cada página, en los links compartidos y en los mensajes de WhatsApp.",
  "panel.ajustes.identidad.color": "Color de marca",
  "panel.ajustes.identidad.colorAyuda":
    "Formato #RRGGBB (ej. #1f6feb). Pinta botones y links; el texto encima se elige solo para que se lea. Vacío: el del tema.",
  "panel.ajustes.identidad.logo": "Logo",
  "panel.ajustes.identidad.logoAyuda":
    "Reemplaza el nombre en el header. Mejor apaisado y con fondo transparente (PNG o WebP).",
  "panel.ajustes.identidad.favicon": "Favicon",
  "panel.ajustes.identidad.faviconAyuda":
    "El iconito de la pestaña del navegador. Cuadrado; se recorta al centro.",
  "panel.ajustes.identidad.sinImagen": "Sin cargar: se usa el de siempre.",
  "panel.ajustes.cuentas.titulo": "Cuentas de cliente",
  "panel.ajustes.cuentas.bajada":
    "Que las compradoras puedan crear una cuenta para guardar sus datos y ver sus pedidos. El checkout de invitado sigue igual siempre: la cuenta es opcional.",
  "panel.ajustes.cuentas.activas": "¿Ofrecer cuentas de cliente?",
  "panel.ajustes.cuentas.porDefecto": "Lo que diga el código ({valor})",
  "panel.ajustes.cuentas.si": "Sí, ofrecerlas",
  "panel.ajustes.cuentas.no": "No",
  "panel.ajustes.cuentas.sinSecreto":
    "No hay secreto para las sesiones de cliente: SESSION_SECRET no está bien configurado en el hosting. Prenderlas así hace fallar /cuenta.",
  "adminError.ajustes.color": "El color va en formato #RRGGBB (ej. #1f6feb).",
  "setup.meta": "Configuración inicial",
  "setup.titulo": "Configuración inicial de la tienda",
  "setup.bajada":
    "Crea las tablas de la base, la cuenta del dueño y, si querés, el catálogo de ejemplo. Es lo mismo que el curl de DEPLOY.md §4, sin terminal.",
  "setup.despues":
    "Terminado el setup, borrá SETUP_SECRET del hPanel y apretá Redeploy: esta página deja de existir. Después se entra por /admin.",
  "setup.secreto": "SETUP_SECRET",
  "setup.secretoAyuda":
    "El valor que cargaste en el hPanel (lo imprime pnpm nueva-tienda). No se guarda en ningún lado.",
  "setup.duenio": "Cuenta del dueño",
  "setup.email": "Email",
  "setup.password": "Contraseña",
  "setup.password.confirmar": "Repetir contraseña",
  "setup.password.mostrar": "Mostrar contraseñas",
  "setup.nombre": "Nombre (opcional)",
  "setup.duenioAyuda":
    "Vacío = no se crea ni se cambia ninguna cuenta (sólo se aplican las migraciones).",
  "setup.seed": "Cargar productos de ejemplo",
  "setup.seedAyuda":
    "Agrega productos de prueba con precios y stock de ejemplo. Dejalo desmarcado para cargar tu catálogo real. Los ejemplos no se reemplazan automáticamente.",
  "setup.force": "Repetir la configuración de una tienda ya inicializada",
  "setup.forceAyuda":
    "Habilita las opciones elegidas aunque el setup ya se haya completado. Si ingresás un email que ya existe, cambia la contraseña de esa cuenta. Dejalo desmarcado en la primera configuración.",
  "setup.correr": "Inicializar",
  "setup.corriendo": "Inicializando…",
  "setup.listo": "Listo. La tienda quedó inicializada.",
  "setup.loginAyuda":
    "La configuración terminó. Si creaste la cuenta del dueño, ya podés entrar con el email y la contraseña que elegiste. Los avisos de abajo indican lo que falta configurar para vender; no son errores del registro.",
  "setup.irAlAdmin": "Ir al inicio de sesión del admin",
  "setup.preflight": "Lo que falta para cobrar de verdad:",
  "setup.error.secreto": "El SETUP_SECRET no coincide.",
  "setup.error.passwordNoCoincide":
    "Las contraseñas no coinciden. Volvé a escribirlas.",
  "setup.error.limite": "Demasiados intentos. Esperá unos minutos.",
  "setup.error.https": "Hace falta entrar por https://.",
  "setup.error.yaInicializada":
    'La tienda ya estaba inicializada: las migraciones corrieron, pero no se tocaron datos. Marcá "quiero repetirlo igual" si de verdad hace falta.',
  "setup.error.sinSecreto": "SETUP_SECRET no está configurado en el hosting.",
  "setup.error.generico": "No se pudo inicializar. Mirá el log del hPanel.",
} as const satisfies Record<string, string>;
