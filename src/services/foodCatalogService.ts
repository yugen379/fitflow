// Shared food catalog — Firestore I/O for the compounding food DB (#3).
//
// Every food a user resolves is written here keyed by a normalised name, so the
// next person to log it gets an instant hit instead of another AI/USDA round-trip.
// All operations are best-effort and never throw — the catalog is an accelerator,
// never a dependency. Pure key/validation logic lives in foodCatalogUtils.ts.

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firestore';
import { catalogKey, normalizeCatalogFood, CatalogFood, barcodeKey, labelPlausible } from './foodCatalogUtils';

/** Instant lookup by food name. Returns null on miss, malformed name, or error. */
export const lookupCatalog = async (name: string): Promise<CatalogFood | null> => {
  try {
    const key = catalogKey(name);
    if (!key) return null;
    const snap = await getDoc(doc(db, 'food_catalog', key));
    if (!snap.exists()) return null;
    return normalizeCatalogFood(snap.data());
  } catch {
    return null;
  }
};

/** Upsert a resolved food into the shared catalog. Silently skips invalid input. */
export const saveToCatalog = async (food: Partial<CatalogFood>): Promise<void> => {
  try {
    const valid = normalizeCatalogFood(food);
    if (!valid) return;
    const key = catalogKey(valid.name);
    if (!key) return;
    await setDoc(
      doc(db, 'food_catalog', key),
      {
        name: valid.name,
        calories: valid.calories,
        protein: valid.protein,
        carbs: valid.carbs,
        fats: valid.fats,
        ...(valid.brand ? { brand: valid.brand } : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch {
    // best-effort — a failed cache write must never affect the user's log
  }
};

/**
 * A packaged product someone already photographed the label of, by barcode
 * (values per 100 g). Null on miss or error.
 */
export const lookupBarcodeFood = async (code: string): Promise<CatalogFood | null> => {
  try {
    const key = barcodeKey(code);
    if (!key) return null;
    const snap = await getDoc(doc(db, 'food_catalog', key));
    if (!snap.exists()) return null;
    const f = normalizeCatalogFood(snap.data());
    return f && labelPlausible(f) ? f : null;
  } catch {
    return null;
  }
};

/**
 * Share a label read (per 100 g) under its barcode, so the next person who
 * scans the product gets it instantly. Only plausible labels are shared; the
 * rules re-check the numbers server-side. Never throws.
 */
export const saveBarcodeFood = async (code: string, food: Partial<CatalogFood>): Promise<boolean> => {
  try {
    const key = barcodeKey(code);
    const valid = normalizeCatalogFood(food);
    if (!key || !valid || !labelPlausible(valid)) return false;
    await setDoc(doc(db, 'food_catalog', key), {
      name: valid.name,
      calories: valid.calories,
      protein: valid.protein,
      carbs: valid.carbs,
      fats: valid.fats,
      ...(valid.brand ? { brand: valid.brand } : {}),
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
};
