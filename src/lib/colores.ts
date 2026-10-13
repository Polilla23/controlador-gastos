/**
 * Colores de subcategorías: una variante de la misma gama que la madre, así se distinguen entre sí
 * en los gráficos de desglose sin dejar de "verse" como parte de la misma categoría. Más clara si
 * la madre es oscura, más oscura si es clara; cada hija nueva, una variante distinta.
 */

type Hsl = { h: number; s: number; l: number };

function hexToHsl(hex: string): Hsl {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = parseInt(m ? m[1] : "6B7280", 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Color de la hija número `indice` (0 = la primera) de una madre de color `madreHex`. Cada una se
 * corre un paso más de luminosidad en la dirección que la aleja del color de la madre y un leve giro
 * de tono (para distinguirse aun con muchas hermanas); pasados seis pasos la luminosidad vuelve a
 * empezar y baja un poco la saturación.
 */
export function colorDeHija(madreHex: string, indice: number): string {
  const { h, s, l } = hexToHsl(madreHex);
  const oscura = l < 0.5;
  const paso = indice % 6;
  const vuelta = Math.floor(indice / 6);
  const delta = (0.05 + 0.035 * paso) * (oscura ? 1 : -1);
  return hslToHex({
    h: (h + (paso - 2.5) * 4 + 360) % 360, // giro de tono acotado (±10°): se distinguen sin salirse de la gama
    s: clamp(s - (vuelta % 2 ? 0.12 : 0), 0, 1),
    l: clamp(l + delta, 0.22, 0.82),
  });
}
