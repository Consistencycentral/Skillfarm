import type { Ionicons } from '@expo/vector-icons';
import type { CourseCategory } from '../api/courses';

// Per-sector fallback glyph, shown (over a sector-tinted block) when a course has
// no image or its remote URL fails to load. Lives in its own file — not in the api layer —
// so @expo/vector-icons stays out of the data modules.
export const SECTOR_ICONS: Record<CourseCategory, keyof typeof Ionicons.glyphMap> = {
  crop_cultivation: 'leaf',
  horticulture: 'flower',
  seed_technology: 'nutrition',
  crop_protection: 'shield-checkmark',
  agro_processing: 'cog',
  food_processing: 'fast-food',
  post_harvest: 'cube',
  dairy: 'water',
  animal_husbandry: 'paw',
  fisheries: 'fish',
  poultry: 'egg',
  apiculture: 'bug',
  sericulture: 'shirt',
  agroforestry: 'earth',
  organic_farming: 'sparkles',
  precision_agri: 'hardware-chip',
  agri_marketing: 'megaphone',
  entrepreneurship: 'rocket',
};
