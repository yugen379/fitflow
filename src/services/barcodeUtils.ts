// Pure barcode utilities + hardened product lookup.
//
// This module deliberately has NO browser-only imports (no idb-keyval, no
// import.meta.env) so it can be imported unchanged by:
//   - the browser app (src/services/foodService.ts wraps it with caching)
//   - the Node proof harness (scripts/barcode-proof.mjs)
//
// Why this exists: the old scan flow hit Open Food Facts v0 with a single raw
// code, no check-digit validation, no UPC/EAN normalization, and a bare
// `res.json()` that throws on OFF's HTML rate-limit pages — so a huge fraction
// of real scans silently fell through to manual entry. Everything that made the
// scanner feel broken is fixed here in one resolver.

export interface BarcodeProduct {
  name: string;
  calories: number; // per 100g
  protein: number;
  carbs: number;
  fats: number;
  brand?: string;
  source: 'OFF' | 'OFF_V0' | 'USDA';
  code: string; // the variant that actually resolved
}

export interface LookupOptions {
  usdaKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** User-Agent string — honored in Node, ignored by browsers (forbidden header). */
  userAgent?: string;
  /** Retries per request on rate-limit / non-JSON responses. */
  retries?: number;
  /** Base backoff between retries (ms). */
  backoffMs?: number;
  /** Optional logger for diagnostics. */
  log?: (msg: string) => void;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Strip everything that isn't a digit. Scanners occasionally prepend symbology
 *  identifiers or whitespace; OFF/USDA only want the numeric GTIN. */
export const cleanBarcode = (raw: string): string => (raw || '').replace(/\D/g, '');

/** GS1 mod-10 check digit for the data portion (everything except the last digit).
 *  Works for GTIN-8 / UPC-A(12) / EAN-13 / GTIN-14: weight the rightmost data
 *  digit by 3, then alternate 1,3,1,3… moving left. */
export const gtinCheckDigit = (dataDigits: string): number => {
  let sum = 0;
  for (let i = 0; i < dataDigits.length; i++) {
    const d = dataDigits.charCodeAt(dataDigits.length - 1 - i) - 48;
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
};

/** True when `code` is a structurally valid GTIN (8/12/13/14 digits with a
 *  correct check digit). Used to reject camera misreads before a network call. */
export const isValidGtin = (code: string): boolean => {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const check = code.charCodeAt(code.length - 1) - 48;
  return gtinCheckDigit(code.slice(0, -1)) === check;
};

/** Ordered, de-duplicated list of GTIN forms worth querying. The classic miss is
 *  a US UPC-A (12) stored in OFF as EAN-13 with a leading zero (or vice-versa),
 *  so we always try both. Valid GTINs are tried before speculative ones. */
export const barcodeVariants = (raw: string): string[] => {
  const code = cleanBarcode(raw);
  if (!code) return [];
  const set = new Set<string>();
  const add = (c: string) => { if (c && c.length >= 8 && c.length <= 14) set.add(c); };

  add(code);
  if (code.length === 12) {            // UPC-A → EAN-13 (leading 0) and GTIN-14
    add('0' + code);
    add('00' + code);
  }
  if (code.length === 13 && code[0] === '0') add(code.slice(1)); // EAN-13 → UPC-A
  if (code.length === 14 && code.startsWith('00')) add(code.slice(2));
  if (code.length === 13) add('0' + code); // → GTIN-14

  // Order: valid-checksum variants first (most likely real), then the rest.
  const arr = Array.from(set);
  return arr.sort((a, b) => Number(isValidGtin(b)) - Number(isValidGtin(a)));
};

// --- internal: fetch JSON, tolerating OFF's HTML rate-limit pages -----------
async function fetchJson(
  url: string,
  opts: LookupOptions,
): Promise<any | null> {
  const f = opts.fetchImpl || fetch;
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? 350;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.userAgent) headers['User-Agent'] = opts.userAgent;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await f(url, { headers });
      const ct = res.headers.get('content-type') || '';
      // OFF returns an HTML challenge/error page (not JSON) when rate-limited.
      if (res.ok && ct.includes('json')) return await res.json();
      opts.log?.(`fetchJson non-JSON (${res.status}, ${ct || 'no-ct'}) for ${url}`);
    } catch (e: any) {
      opts.log?.(`fetchJson error for ${url}: ${e?.message || e}`);
    }
    if (attempt < retries) await sleep(backoff * (attempt + 1));
  }
  return null;
}

const num = (v: any): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const offToProduct = (p: any, code: string, source: 'OFF' | 'OFF_V0'): BarcodeProduct | null => {
  if (!p) return null;
  const nu = p.nutriments || {};
  const calories = num(nu['energy-kcal_100g'] ?? nu['energy-kcal'] ?? nu['energy_100g']);
  if (calories <= 0) return null; // product exists but has no usable nutrition
  return {
    name: p.product_name || p.generic_name || 'Unknown product',
    calories: Math.round(calories),
    protein: Math.round(num(nu.proteins_100g)),
    carbs: Math.round(num(nu.carbohydrates_100g)),
    fats: Math.round(num(nu.fat_100g)),
    brand: p.brands || undefined,
    source,
    code,
  };
};

/** The hardened resolver: OFF v2 → OFF v0 → USDA, each across code variants.
 *  Returns the first result that carries real (>0 kcal) nutrition, else null. */
export async function lookupBarcodeRaw(
  rawBarcode: string,
  opts: LookupOptions = {},
): Promise<BarcodeProduct | null> {
  const variants = barcodeVariants(rawBarcode);
  if (!variants.length) return null;
  const spacing = opts.backoffMs ?? 350;

  // TIER 1 — Open Food Facts v2 (fast, field-scoped).
  for (const code of variants) {
    const data = await fetchJson(
      `https://world.openfoodfacts.org/api/v2/product/${code}?fields=product_name,generic_name,brands,nutriments`,
      opts,
    );
    if (data?.status === 1 && data.product) {
      const prod = offToProduct(data.product, code, 'OFF');
      if (prod) { opts.log?.(`OFF v2 hit on ${code}`); return prod; }
    }
    await sleep(spacing);
  }

  // TIER 2 — Open Food Facts v0 legacy (some older products only resolve here).
  for (const code of variants) {
    const data = await fetchJson(
      `https://world.openfoodfacts.org/api/v0/product/${code}.json`,
      opts,
    );
    if (data?.status === 1 && data.product) {
      const prod = offToProduct(data.product, code, 'OFF_V0');
      if (prod) { opts.log?.(`OFF v0 hit on ${code}`); return prod; }
    }
    await sleep(spacing);
  }

  // TIER 3 — USDA FDC branded foods, matched by GTIN/UPC.
  if (opts.usdaKey) {
    for (const code of variants) {
      const data = await fetchJson(
        `https://api.nal.usda.gov/fdc/v1/foods/search?query=${code}&dataType=Branded&pageSize=10&api_key=${opts.usdaKey}`,
        opts,
      );
      const foods: any[] = data?.foods || [];
      const stripped = code.replace(/^0+/, '');
      const match =
        foods.find(fd => String(fd.gtinUpc || '').replace(/^0+/, '') === stripped) || foods[0];
      if (match) {
        const getN = (id: number) => num(match.foodNutrients?.find((n: any) => n.nutrientId === id)?.value);
        const calories = getN(1008);
        if (calories > 0) {
          opts.log?.(`USDA hit on ${code}`);
          return {
            name: match.description || 'Unknown product',
            calories: Math.round(calories),
            protein: Math.round(getN(1003)),
            carbs: Math.round(getN(1005)),
            fats: Math.round(getN(1004)),
            brand: match.brandOwner || match.brandName || undefined,
            source: 'USDA',
            code,
          };
        }
      }
      await sleep(spacing);
    }
  }

  return null;
}
