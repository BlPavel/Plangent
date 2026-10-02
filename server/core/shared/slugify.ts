/** A latin slug for the @-key; Cyrillic is transliterated so «Заказы» becomes `zakazy`, not an empty key. */
export function slugify(value: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  return [...value.toLowerCase()].map(c => map[c] ?? c).join('')
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').replace(/-{2,}/g, '-') || 'project';
}

