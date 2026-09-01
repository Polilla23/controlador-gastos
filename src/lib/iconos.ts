import "server-only";
import { getIconData } from "@iconify/utils";
import iconSet from "@iconify-json/mdi/icons.json";
import metadata from "@iconify-json/mdi/metadata.json";

/**
 * Buscador de íconos. Usa el set Material Design Icons de Iconify (Apache 2.0,
 * 7.447 íconos), que vive en el servidor: no se descarga nada al navegador ni se
 * consulta ninguna API externa, así que también funciona sin internet.
 */

type Set = Parameters<typeof getIconData>[0];
const set = iconSet as unknown as Set;

export type Icono = { nombre: string; body: string; viewBox: string };

const CATS = (metadata as { categories?: Record<string, string[]> }).categories ?? {};

/** Las categorías del set, traducidas a algo legible en español. */
const TRADUCCION: Record<string, string> = {
  "Account / User": "Personas",
  Agriculture: "Campo",
  "Alert / Error": "Alertas",
  Animal: "Animales",
  Arrow: "Flechas",
  Audio: "Audio",
  Automotive: "Autos",
  Banking: "Banco",
  "Brand / Logo": "Marcas",
  Cellphone: "Celulares",
  Cleaning: "Limpieza",
  Clothing: "Ropa",
  Color: "Colores",
  Communication: "Comunicación",
  Currency: "Monedas",
  Database: "Datos",
  "Date / Time": "Fechas",
  Developer: "Desarrollo",
  Device: "Dispositivos",
  Drawing: "Dibujo",
  Editor: "Edición",
  Emoji: "Emojis",
  Files: "Archivos",
  "Food / Drink": "Comida y bebida",
  Games: "Juegos",
  Gender: "Género",
  Hardware: "Hardware",
  Health: "Salud",
  Holiday: "Fiestas",
  Home: "Hogar",
  "Home Automation": "Domótica",
  Image: "Imágenes",
  Landmarks: "Lugares",
  Math: "Matemática",
  Music: "Música",
  Nature: "Naturaleza",
  Navigation: "Navegación",
  Notification: "Notificaciones",
  People: "Gente",
  Places: "Lugares",
  Printer: "Impresión",
  Religion: "Religión",
  Science: "Ciencia",
  Shopping: "Compras",
  Social: "Social",
  Sport: "Deportes",
  Text: "Texto",
  Transportation: "Transporte",
  "Transportation + Flying": "Aviones",
  "Transportation + Road": "Ruta",
  "Transportation + Water": "Barcos",
  Vector: "Vectores",
  Weather: "Clima",
};

/**
 * Los nombres de los íconos están en inglés, pero acá se busca en español.
 * Este diccionario traduce lo que uno escribiría de verdad ("carniceria",
 * "alquiler", "nafta") a las palabras con las que están nombrados.
 */
const SINONIMOS: Record<string, string[]> = {
  carne: ["food-steak", "food-drumstick"],
  carniceria: ["food-steak", "food-drumstick"],
  bife: ["food-steak"],
  asado: ["grill", "food-steak"],
  pollo: ["food-drumstick"],
  pescado: ["fish"],
  verduleria: ["carrot", "food-apple"],
  verdura: ["carrot"],
  fruta: ["food-apple", "fruit"],
  panaderia: ["bread-slice", "baguette"],
  pan: ["bread-slice"],
  supermercado: ["cart", "store", "basket"],
  super: ["cart", "store"],
  almacen: ["store"],
  compras: ["cart", "shopping"],
  comida: ["food", "silverware"],
  restaurante: ["silverware", "food-fork-drink"],
  delivery: ["moped", "bike-fast"],
  cafe: ["coffee"],
  bebida: ["glass-cocktail", "bottle-soda"],
  cerveza: ["beer"],
  vino: ["glass-wine"],
  casa: ["home", "house"],
  hogar: ["home"],
  alquiler: ["key-variant", "home-city"],
  expensas: ["office-building", "home-city"],
  luz: ["lightbulb", "flash"],
  electricidad: ["flash", "lightning-bolt"],
  gas: ["fire", "gas-cylinder"],
  agua: ["water"],
  internet: ["wifi", "router-wireless"],
  telefono: ["phone", "cellphone"],
  celular: ["cellphone"],
  cable: ["television"],
  television: ["television"],
  auto: ["car"],
  nafta: ["gas-station", "fuel"],
  combustible: ["gas-station", "fuel"],
  taxi: ["taxi"],
  colectivo: ["bus"],
  bondi: ["bus"],
  subte: ["subway", "train"],
  tren: ["train"],
  avion: ["airplane"],
  viaje: ["airplane", "bag-suitcase", "map-marker"],
  vacaciones: ["beach", "palm-tree"],
  hotel: ["bed"],
  moto: ["motorbike"],
  bicicleta: ["bike"],
  estacionamiento: ["parking"],
  peaje: ["boom-gate"],
  salud: ["heart-pulse", "medical-bag"],
  medico: ["doctor", "stethoscope"],
  farmacia: ["pill", "medical-bag"],
  remedio: ["pill"],
  dentista: ["tooth"],
  obra: ["hospital-building"],
  gimnasio: ["dumbbell", "weight-lifter"],
  gym: ["dumbbell"],
  deporte: ["soccer", "basketball", "run"],
  futbol: ["soccer"],
  ropa: ["tshirt-crew", "hanger"],
  zapatillas: ["shoe-sneaker"],
  calzado: ["shoe-formal"],
  regalo: ["gift"],
  cumpleanos: ["cake-variant"],
  mascota: ["dog", "cat", "paw"],
  perro: ["dog"],
  gato: ["cat"],
  veterinaria: ["paw", "medical-bag"],
  educacion: ["school", "book-open"],
  colegio: ["school"],
  universidad: ["school", "certificate"],
  libro: ["book-open"],
  curso: ["book-education"],
  trabajo: ["briefcase"],
  sueldo: ["cash", "wallet"],
  plata: ["cash", "currency-usd"],
  dinero: ["cash", "currency-usd"],
  efectivo: ["cash"],
  banco: ["bank"],
  tarjeta: ["credit-card"],
  credito: ["credit-card"],
  debito: ["credit-card-outline"],
  ahorro: ["piggy-bank"],
  inversion: ["chart-line", "finance"],
  dolar: ["currency-usd"],
  peso: ["currency-usd"],
  prestamo: ["hand-coin"],
  deuda: ["hand-coin", "account-cash"],
  impuesto: ["file-document", "bank"],
  seguro: ["shield-check"],
  suscripcion: ["autorenew", "repeat"],
  streaming: ["netflix", "play-circle"],
  musica: ["music", "spotify"],
  juego: ["gamepad-variant"],
  cine: ["movie", "filmstrip"],
  peluqueria: ["content-cut", "hair-dryer"],
  limpieza: ["broom", "spray-bottle"],
  lavarropas: ["washing-machine"],
  herramienta: ["hammer-wrench", "tools"],
  jardin: ["flower", "sprout"],
  bebe: ["baby-carriage"],
  hijo: ["human-child"],
  familia: ["account-group"],
  amigos: ["account-group"],
  donacion: ["hand-heart", "charity"],
  iglesia: ["church"],
  computadora: ["laptop", "desktop-tower"],
  notebook: ["laptop"],
  tecnologia: ["chip", "laptop"],
  electrodomestico: ["fridge", "microwave"],
  heladera: ["fridge"],
  mueble: ["sofa", "table-furniture"],
  mudanza: ["truck"],
  envio: ["truck-delivery", "package-variant"],
  correo: ["email", "mailbox"],
  documento: ["file-document"],
  factura: ["receipt", "file-document"],
  ticket: ["receipt"],
  otros: ["dots-horizontal", "shape"],
};

export function categorias(): { clave: string; nombre: string; cantidad: number }[] {
  return Object.entries(CATS)
    .map(([clave, lista]) => ({ clave, nombre: TRADUCCION[clave] ?? clave, cantidad: lista.length }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Resuelve un nombre ("mdi:food-steak" o "food-steak") al SVG que hay que dibujar. */
export function icono(nombre?: string | null): Icono | null {
  if (!nombre) return null;
  const limpio = nombre.startsWith("mdi:") ? nombre.slice(4) : nombre;
  const data = getIconData(set, limpio);
  if (!data) return null;
  const w = data.width ?? 24;
  const h = data.height ?? 24;
  return { nombre: `mdi:${limpio}`, body: data.body, viewBox: `${data.left ?? 0} ${data.top ?? 0} ${w} ${h}` };
}

const NOMBRES = Object.keys((iconSet as { icons: Record<string, unknown> }).icons);

/** Busca por texto y, opcionalmente, dentro de una categoría. */
export function buscar(texto: string, categoria?: string, limite = 120): Icono[] {
  const q = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const universo = categoria && CATS[categoria] ? CATS[categoria].map((n) => n.replace(/^mdi:/, "")) : NOMBRES;

  // Además de la búsqueda literal, probamos las traducciones del diccionario.
  const pistas = q ? (SINONIMOS[q] ?? Object.entries(SINONIMOS).filter(([es]) => es.startsWith(q) || q.startsWith(es)).flatMap(([, en]) => en)) : [];
  const literal = q ? universo.filter((n) => n.includes(q)) : universo;
  const traducidos = pistas.flatMap((pista) => universo.filter((n) => n === pista || n.startsWith(pista + "-")));
  const candidatos = q ? [...new Set([...traducidos, ...literal])] : universo;
  // Los traducidos van primero; dentro de cada grupo, los nombres más cortos
  // suelen ser los más representativos ("food" antes que "food-apple-outline").
  const conPeso = candidatos.map((n, i) => ({ n, i, prioridad: i < traducidos.length ? 0 : 1 }));
  conPeso.sort((a, b) => a.prioridad - b.prioridad || a.n.length - b.n.length || a.n.localeCompare(b.n));
  return conPeso
    .map((x) => x.n)
    .slice(0, limite)
    .map((n) => icono(n))
    .filter((i): i is Icono => !!i);
}
