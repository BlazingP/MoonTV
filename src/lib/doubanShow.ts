// 综艺筛选：「热门」走豆瓣近期热门接口（条目较少），
// 其余类型走豆瓣推荐接口，支持按类型和地区筛选，每个组合最多约 500 条。
import { DoubanItem } from './types';

export const SHOW_HOT = '热门';

// 豆瓣推荐接口实测有足够条目的综艺类型（美食、情感条目过少，未列入）
export const SHOW_GENRES = [
  '全部',
  '真人秀',
  '脱口秀',
  '音乐',
  '歌舞',
  '选秀',
  '旅行',
  '喜剧',
  '搞笑',
  '访谈',
  '文化',
  '生活',
  '恋爱',
  '游戏',
  '职场',
  '竞技',
  '亲子',
];

export const SHOW_REGIONS = [
  '全部',
  '中国大陆',
  '韩国',
  '日本',
  '欧美',
  '中国台湾',
  '中国香港',
  '泰国',
];

// 「热门」下沿用原来的近期热门分档
export const SHOW_HOT_OPTIONS = [
  { label: '全部', value: 'show' },
  { label: '国内', value: 'show_domestic' },
  { label: '国外', value: 'show_foreign' },
];

export function isShowRecommend(genre: string): boolean {
  return SHOW_GENRES.includes(genre);
}

export function isValidShowFilter(genre: string, region: string): boolean {
  return SHOW_GENRES.includes(genre) && SHOW_REGIONS.includes(region);
}

export function buildShowRecommendUrl(
  genre: string,
  region: string,
  pageStart: number,
  pageLimit: number
): string {
  const selected: Record<string, string> = { 形式: '综艺' };
  if (genre !== '全部') selected['类型'] = genre;
  if (region !== '全部') selected['地区'] = region;
  const params = new URLSearchParams({
    start: String(pageStart),
    count: String(pageLimit),
    selected_categories: JSON.stringify(selected),
    tags: Object.values(selected).join(','),
  });
  return `https://m.douban.com/rexxar/api/v2/tv/recommend?${params.toString()}`;
}

export interface DoubanRecommendItem {
  id: string;
  title: string;
  card_subtitle?: string;
  pic?: { large?: string; normal?: string };
  rating?: { value?: number } | null;
}

export function toDoubanItems(items: DoubanRecommendItem[]): DoubanItem[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    poster: item.pic?.normal || item.pic?.large || '',
    rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
    year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
  }));
}
