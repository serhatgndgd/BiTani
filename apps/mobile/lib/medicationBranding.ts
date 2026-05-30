const BRAND_REGEX = /^([A-ZÇĞİÖŞÜ\s]+?)(\s+\d|\s+\d+\s*MG|\s+\d+\s*ML|$)/;

export type MedicationBrandGroup<T> = {
  brand: string;
  variants: T[];
};

export function normalizeMedicationName(value: string): string {
  return value.toLocaleUpperCase('tr-TR').trim().replace(/\s+/g, ' ');
}

export function extractMedicationBrand(name: string): string {
  const normalized = normalizeMedicationName(name);
  return (normalized.match(BRAND_REGEX)?.[1] ?? normalized).trim().replace(/\s+/g, ' ');
}

export function medicationVariantLabel(name: string, brand: string): string {
  const normalized = normalizeMedicationName(name);
  const variant = normalized.slice(brand.length).trim();
  return variant.length > 0 ? variant : name;
}

export function groupMedicationsByBrand<T>(
  rows: T[],
  getName: (row: T) => string,
): MedicationBrandGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const brand = extractMedicationBrand(getName(row));
    groups.set(brand, [...(groups.get(brand) ?? []), row]);
  }
  return [...groups.entries()].map(([brand, variants]) => ({ brand, variants }));
}
