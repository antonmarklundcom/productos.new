import type { IvaRate } from '@/db/schema';

export type SeedVariant = {
  sku: string;
  label: string;
  pricePyg: number;
  compareAtPyg?: number;
  onHand: number;
};

export type SeedProduct = {
  slug: string;
  name: string;
  description: string;
  categorySlug: string;
  brand: string;
  ivaRate: IvaRate;
  variants: SeedVariant[];
};

export const SEED_CATEGORIES = [
  { slug: 'electronica', name: 'Electrónica', position: 1 },
  { slug: 'hogar-y-cocina', name: 'Hogar y Cocina', position: 2 },
  { slug: 'moda', name: 'Moda', position: 3 },
  { slug: 'deportes', name: 'Deportes', position: 4 },
] as const;

/** Precios reales de góndola paraguaya, IVA incluido, en guaraníes enteros. */
export const SEED_PRODUCTS: SeedProduct[] = [
  // --- Electrónica ---------------------------------------------------------
  {
    slug: 'auriculares-bluetooth-tws',
    name: 'Auriculares Bluetooth TWS',
    description: 'Auriculares inalámbricos con estuche de carga, 24 h de autonomía y cancelación de ruido ambiente.',
    categorySlug: 'electronica',
    brand: 'Xiaomi',
    ivaRate: 10,
    variants: [
      { sku: 'AUR-TWS-NEG', label: 'Negro', pricePyg: 285000, compareAtPyg: 350000, onHand: 24 },
      { sku: 'AUR-TWS-BLA', label: 'Blanco', pricePyg: 285000, onHand: 18 },
    ],
  },
  {
    slug: 'parlante-portatil-20w',
    name: 'Parlante portátil 20W',
    description: 'Parlante Bluetooth resistente al agua IPX7, 12 h de batería, ideal para la costanera.',
    categorySlug: 'electronica',
    brand: 'JBL',
    ivaRate: 10,
    variants: [
      { sku: 'PAR-20W-NEG', label: 'Negro', pricePyg: 690000, onHand: 12 },
      { sku: 'PAR-20W-AZU', label: 'Azul', pricePyg: 690000, onHand: 7 },
    ],
  },
  {
    slug: 'smartwatch-deportivo',
    name: 'Smartwatch deportivo',
    description: 'Reloj inteligente con GPS, medición de ritmo cardíaco y notificaciones de WhatsApp.',
    categorySlug: 'electronica',
    brand: 'Amazfit',
    ivaRate: 10,
    variants: [
      { sku: 'SMW-DEP-42', label: '42 mm', pricePyg: 845000, compareAtPyg: 990000, onHand: 15 },
      { sku: 'SMW-DEP-46', label: '46 mm', pricePyg: 925000, onHand: 9 },
    ],
  },
  {
    slug: 'power-bank-20000mah',
    name: 'Power bank 20.000 mAh',
    description: 'Batería externa con carga rápida 22,5W y dos salidas USB. Aguanta los cortes de luz.',
    categorySlug: 'electronica',
    brand: 'Baseus',
    ivaRate: 10,
    variants: [{ sku: 'PWB-20K-NEG', label: 'Negro', pricePyg: 320000, onHand: 30 }],
  },
  {
    slug: 'teclado-mecanico-compacto',
    name: 'Teclado mecánico compacto',
    description: 'Teclado 65% con switches rojos, retroiluminación RGB y distribución en español latino.',
    categorySlug: 'electronica',
    brand: 'Redragon',
    ivaRate: 10,
    variants: [
      { sku: 'TEC-MEC-ROJ', label: 'Switch rojo', pricePyg: 415000, onHand: 11 },
      { sku: 'TEC-MEC-AZU', label: 'Switch azul', pricePyg: 415000, onHand: 6 },
    ],
  },
  {
    slug: 'camara-seguridad-wifi',
    name: 'Cámara de seguridad WiFi',
    description: 'Cámara interior 1080p con visión nocturna, audio bidireccional y app en español.',
    categorySlug: 'electronica',
    brand: 'TP-Link',
    ivaRate: 10,
    variants: [{ sku: 'CAM-WIFI-1080', label: '1080p', pricePyg: 265000, onHand: 20 }],
  },

  // --- Hogar y Cocina ------------------------------------------------------
  {
    slug: 'termo-acero-inoxidable',
    name: 'Termo de acero inoxidable 1L',
    description: 'Termo con cebador y pico vertedor, mantiene el agua caliente 12 h. Para el tereré y el mate.',
    categorySlug: 'hogar-y-cocina',
    brand: 'Lumilagro',
    ivaRate: 10,
    variants: [
      { sku: 'TER-1L-PLA', label: 'Plateado', pricePyg: 195000, onHand: 40 },
      { sku: 'TER-1L-NEG', label: 'Negro mate', pricePyg: 210000, onHand: 25 },
    ],
  },
  {
    slug: 'jarra-termica-terere',
    name: 'Jarra térmica para tereré 2,5L',
    description: 'Jarra con aislamiento y tapa a rosca, mantiene el hielo hasta 8 horas.',
    categorySlug: 'hogar-y-cocina',
    brand: 'Nacional',
    ivaRate: 10,
    variants: [{ sku: 'JAR-25L-VER', label: 'Verde', pricePyg: 165000, onHand: 22 }],
  },
  {
    slug: 'juego-sabanas-2-plazas',
    name: 'Juego de sábanas 2 plazas',
    description: 'Sábanas de microfibra 144 hilos, incluye dos fundas de almohada.',
    categorySlug: 'hogar-y-cocina',
    brand: 'Casa Bella',
    ivaRate: 10,
    variants: [
      { sku: 'SAB-2P-BEI', label: 'Beige', pricePyg: 185000, onHand: 18 },
      { sku: 'SAB-2P-GRI', label: 'Gris', pricePyg: 185000, onHand: 14 },
    ],
  },
  {
    slug: 'set-ollas-antiadherentes',
    name: 'Set de ollas antiadherentes 5 piezas',
    description: 'Set de aluminio forjado con antiadherente reforzado y tapas de vidrio templado.',
    categorySlug: 'hogar-y-cocina',
    brand: 'Tramontina',
    ivaRate: 10,
    variants: [{ sku: 'OLL-SET-5P', label: '5 piezas', pricePyg: 890000, compareAtPyg: 1050000, onHand: 8 }],
  },
  {
    slug: 'ventilador-de-pie-18',
    name: 'Ventilador de pie 18"',
    description: 'Ventilador de tres velocidades con altura regulable. Indispensable de octubre a marzo.',
    categorySlug: 'hogar-y-cocina',
    brand: 'Kanji',
    ivaRate: 10,
    variants: [{ sku: 'VEN-PIE-18', label: '18 pulgadas', pricePyg: 445000, onHand: 16 }],
  },
  {
    slug: 'yerba-mate-compuesta-1kg',
    name: 'Yerba mate compuesta 1 kg',
    description: 'Yerba con hierbas medicinales seleccionadas, molienda para tereré.',
    categorySlug: 'hogar-y-cocina',
    brand: 'Kurupí',
    // Canasta básica: IVA 5%.
    ivaRate: 5,
    variants: [
      { sku: 'YER-1KG-COM', label: '1 kg', pricePyg: 28000, onHand: 120 },
      { sku: 'YER-500-COM', label: '500 g', pricePyg: 16000, onHand: 90 },
    ],
  },

  // --- Moda ----------------------------------------------------------------
  {
    slug: 'remera-algodon-basica',
    name: 'Remera de algodón básica',
    description: 'Remera de algodón peinado 24/1, cuello reforzado, corte regular.',
    categorySlug: 'moda',
    brand: 'Basics PY',
    ivaRate: 10,
    variants: [
      { sku: 'REM-BAS-S', label: 'Talle S', pricePyg: 85000, onHand: 30 },
      { sku: 'REM-BAS-M', label: 'Talle M', pricePyg: 85000, onHand: 45 },
      { sku: 'REM-BAS-L', label: 'Talle L', pricePyg: 85000, onHand: 38 },
      { sku: 'REM-BAS-XL', label: 'Talle XL', pricePyg: 92000, onHand: 20 },
    ],
  },
  {
    slug: 'camisa-lino-manga-corta',
    name: 'Camisa de lino manga corta',
    description: 'Camisa fresca de lino con botones de coco. Pensada para el verano asunceno.',
    categorySlug: 'moda',
    brand: 'Guaraní Wear',
    ivaRate: 10,
    variants: [
      { sku: 'CAM-LIN-M', label: 'Talle M', pricePyg: 245000, onHand: 12 },
      { sku: 'CAM-LIN-L', label: 'Talle L', pricePyg: 245000, onHand: 10 },
    ],
  },
  {
    slug: 'jean-slim-hombre',
    name: 'Jean slim hombre',
    description: 'Jean elastizado de corte slim, tiro medio, lavado azul oscuro.',
    categorySlug: 'moda',
    brand: 'Denim Co.',
    ivaRate: 10,
    variants: [
      { sku: 'JEA-SLI-38', label: 'Talle 38', pricePyg: 235000, onHand: 9 },
      { sku: 'JEA-SLI-40', label: 'Talle 40', pricePyg: 235000, onHand: 14 },
      { sku: 'JEA-SLI-42', label: 'Talle 42', pricePyg: 235000, onHand: 11 },
    ],
  },
  {
    slug: 'vestido-verano-floral',
    name: 'Vestido de verano floral',
    description: 'Vestido midi de viscosa con estampado floral y tiras regulables.',
    categorySlug: 'moda',
    brand: 'Ñande Moda',
    ivaRate: 10,
    variants: [
      { sku: 'VES-FLO-S', label: 'Talle S', pricePyg: 275000, compareAtPyg: 320000, onHand: 8 },
      { sku: 'VES-FLO-M', label: 'Talle M', pricePyg: 275000, onHand: 13 },
    ],
  },
  {
    slug: 'mochila-urbana-impermeable',
    name: 'Mochila urbana impermeable',
    description: 'Mochila con compartimento para notebook de 15,6", puerto USB y tela repelente.',
    categorySlug: 'moda',
    brand: 'Totto',
    ivaRate: 10,
    variants: [
      { sku: 'MOC-URB-NEG', label: 'Negro', pricePyg: 395000, onHand: 17 },
      { sku: 'MOC-URB-GRI', label: 'Gris', pricePyg: 395000, onHand: 12 },
    ],
  },
  {
    slug: 'gorra-trucker',
    name: 'Gorra trucker',
    description: 'Gorra con frente de algodón, malla trasera y cierre ajustable.',
    categorySlug: 'moda',
    brand: 'Basics PY',
    ivaRate: 10,
    variants: [{ sku: 'GOR-TRU-UNI', label: 'Talle único', pricePyg: 75000, onHand: 50 }],
  },

  // --- Deportes ------------------------------------------------------------
  {
    slug: 'pelota-futbol-n5',
    name: 'Pelota de fútbol N°5',
    description: 'Pelota cosida a máquina, cámara de butilo, apta para cancha de césped sintético.',
    categorySlug: 'deportes',
    brand: 'Penalty',
    ivaRate: 10,
    variants: [{ sku: 'PEL-FUT-N5', label: 'N°5', pricePyg: 185000, onHand: 26 }],
  },
  {
    slug: 'zapatillas-running',
    name: 'Zapatillas de running',
    description: 'Zapatillas livianas con amortiguación en EVA y malla transpirable.',
    categorySlug: 'deportes',
    brand: 'Olympikus',
    ivaRate: 10,
    variants: [
      { sku: 'ZAP-RUN-39', label: 'Talle 39', pricePyg: 465000, onHand: 7 },
      { sku: 'ZAP-RUN-41', label: 'Talle 41', pricePyg: 465000, onHand: 10 },
      { sku: 'ZAP-RUN-43', label: 'Talle 43', pricePyg: 465000, onHand: 6 },
    ],
  },
  {
    slug: 'set-mancuernas-10kg',
    name: 'Set de mancuernas 10 kg',
    description: 'Par de mancuernas recubiertas en neopreno, 5 kg cada una.',
    categorySlug: 'deportes',
    brand: 'FitPro',
    ivaRate: 10,
    variants: [{ sku: 'MAN-SET-10K', label: '2 × 5 kg', pricePyg: 320000, onHand: 13 }],
  },
  {
    slug: 'bicicleta-rodado-29',
    name: 'Bicicleta MTB rodado 29',
    description: 'Bicicleta de montaña con cuadro de aluminio, 21 velocidades y frenos a disco.',
    categorySlug: 'deportes',
    brand: 'Vairo',
    ivaRate: 10,
    variants: [
      { sku: 'BIC-R29-NEG', label: 'Negro', pricePyg: 2450000, compareAtPyg: 2790000, onHand: 4 },
      { sku: 'BIC-R29-ROJ', label: 'Rojo', pricePyg: 2450000, onHand: 3 },
    ],
  },
  {
    slug: 'colchoneta-yoga',
    name: 'Colchoneta de yoga 6 mm',
    description: 'Colchoneta antideslizante de TPE con correa de transporte.',
    categorySlug: 'deportes',
    brand: 'FitPro',
    ivaRate: 10,
    variants: [
      { sku: 'COL-YOG-VIO', label: 'Violeta', pricePyg: 135000, onHand: 21 },
      { sku: 'COL-YOG-VER', label: 'Verde', pricePyg: 135000, onHand: 19 },
    ],
  },
  {
    slug: 'guia-entrenamiento-libro',
    name: 'Guía de entrenamiento (libro)',
    description: 'Manual impreso de 220 páginas con rutinas progresivas de 12 semanas.',
    categorySlug: 'deportes',
    brand: "Editorial Ñe'ẽ",
    // Libros: exentos de IVA en Paraguay.
    ivaRate: 0,
    variants: [{ sku: 'LIB-ENT-220', label: 'Tapa blanda', pricePyg: 95000, onHand: 35 }],
  },
];

export const SEED_SHIPPING_ZONES = [
  {
    slug: 'asuncion',
    name: 'Asunción',
    cities: ['Asunción'],
    pricePyg: 25000,
    freeThresholdPyg: 500000,
    position: 1,
  },
  {
    slug: 'gran-asuncion',
    name: 'Gran Asunción',
    cities: [
      'San Lorenzo',
      'Fernando de la Mora',
      'Luque',
      'Lambaré',
      'Capiatá',
      'Ñemby',
      'Mariano Roque Alonso',
      'Villa Elisa',
      'San Antonio',
      'Limpio',
      'Itauguá',
      'Areguá',
    ],
    pricePyg: 35000,
    freeThresholdPyg: 700000,
    position: 2,
  },
  {
    slug: 'ciudades-del-interior',
    name: 'Ciudades del interior',
    cities: [
      'Ciudad del Este',
      'Encarnación',
      'Coronel Oviedo',
      'Caaguazú',
      'Villarrica',
      'Pedro Juan Caballero',
      'Concepción',
      'Paraguarí',
      'San Juan Bautista',
      'Caacupé',
    ],
    pricePyg: 60000,
    freeThresholdPyg: 1500000,
    position: 3,
  },
  {
    slug: 'resto-del-pais',
    name: 'Resto del país',
    cities: [
      'Filadelfia',
      'Loma Plata',
      'Mariscal Estigarribia',
      'Pilar',
      'Salto del Guairá',
      'Ayolas',
      'Santa Rita',
      'Fuerte Olimpo',
    ],
    pricePyg: 95000,
    freeThresholdPyg: null,
    position: 4,
  },
] as const;
