import type { Sku } from '../types';
import { detectAdditives, detectAllergens, splitTopLevel } from './parse';
import { parseShelfLife } from './shelfLife';

/** 商品信息改动后重算派生字段：配料切分、添加剂、致敏物质、保质期天数。 */
export function refreshSku(sku: Sku): Sku {
  const ingredients = splitTopLevel(sku.ingredientsRaw);
  const shelfLife = parseShelfLife(sku.shelfLifeText);
  const packageGrams =
    Number.isFinite(Number(sku.packageGrams)) && Number(sku.packageGrams) > 0
      ? Math.round(Number(sku.packageGrams) * 10) / 10
      : undefined;
  return {
    ...sku,
    packageGrams,
    shelfLifeMonths:
      shelfLife?.unit === 'month'
        ? Math.round(shelfLife.value)
        : shelfLife?.unit === 'year'
          ? Math.round(shelfLife.value * 12)
          : sku.shelfLifeMonths,
    ingredients: ingredients.length ? ingredients : sku.ingredientsRaw ? [sku.ingredientsRaw] : [],
    additives: detectAdditives(sku.ingredientsRaw),
    allergens: detectAllergens(sku.ingredientsRaw),
    shelfLifeDays: shelfLife?.days,
    updatedAt: Date.now(),
  };
}

export function createEmptySku(gtin = ''): Sku {
  const now = Date.now();
  return {
    gtin,
    name: '',
    brand: '',
    brandOwner: '',
    manufacturer: '',
    ingredientsRaw: '',
    ingredients: [],
    additives: [],
    allergens: [],
    source: 'manual',
    version: 1,
    confidence: {},
    createdAt: now,
    updatedAt: now,
  };
}
