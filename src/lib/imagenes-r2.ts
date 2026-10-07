/** p1: pre-generated public product photos; no credentials or Node APIs. */
export const P1_BOXES = [240, 480, 800, 1200] as const;
export const P1_MAX_SLUG_LENGTH = 80;
export const P1_MAX_REF_LENGTH = 255;
export const P1_WEBP = {
  quality: 75,
  effort: 6,
  smartSubsample: true,
} as const;
export const P1_JPEG = { quality: 82, mozjpeg: true } as const;

const BASE = /^([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{10})$/;
const REF =
  /^r2:p1\/([a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{10})@([1-9][0-9]{0,4})x([1-9][0-9]{0,4})$/;

export type R2ImageRef = { base: string; width: number; height: number };

function validBase(base: string): boolean {
  const match = BASE.exec(base);
  return !!match && match[0] === base && match[1]!.length <= P1_MAX_SLUG_LENGTH;
}

function validDimensions(w: number, h: number): boolean {
  return [w, h].every((n) => Number.isInteger(n) && n > 0 && n <= 99_999);
}

export function boxesFor(w: number, h: number): number[] {
  if (!validDimensions(w, h)) return [];
  const longest = Math.max(w, h);
  const boxes: number[] = P1_BOXES.filter((b) => b <= longest);
  if (longest < 1200 && (boxes.length === 0 || longest > 1.2 * boxes.at(-1)!)) {
    boxes.push(longest);
  }
  return boxes;
}

export function parseRef(ref: string | null | undefined): R2ImageRef | null {
  if (!ref || ref.length > P1_MAX_REF_LENGTH) return null;
  const match = REF.exec(ref);
  if (!match || match[0] !== ref || !validBase(match[1]!)) return null;
  return { base: match[1]!, width: Number(match[2]), height: Number(match[3]) };
}

export function formatRef(base: string, w: number, h: number): string | null {
  if (!validBase(base) || !validDimensions(w, h)) return null;
  const ref = `r2:p1/${base}@${w}x${h}`;
  return parseRef(ref) ? ref : null;
}

export function keyFor(base: string, box: number): string | null {
  return validBase(base) && Number.isInteger(box) && box > 0 && box <= 1200
    ? `p1/${base}-${box}.webp`
    : null;
}

export function jpegKeyFor(base: string): string | null {
  return validBase(base) ? `p1/${base}.jpg` : null;
}

/** Actual file dimensions, not a srcset descriptor based on the longest side. */
export function sizeForBox(w: number, h: number, box: number) {
  if (!validDimensions(w, h) || !Number.isInteger(box) || box <= 0) return null;
  const scale = Math.min(1, box / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

export function jpegSizeFor(w: number, h: number) {
  return sizeForBox(w, h, 1200);
}

/** Public, build-time URL only. Empty/unsafe values disable R2 delivery. */
export function publicBase(): string | null {
  const value = (process.env.NEXT_PUBLIC_IMAGENES_URL ?? "").trim();
  if (!value || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
