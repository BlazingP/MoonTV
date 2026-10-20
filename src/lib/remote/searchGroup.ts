// 把搜索结果按「标题 + 年份 + 电影/剧集」聚合，与搜索页的聚合规则一致。
import { SearchResult } from '@/lib/types';

import { buildPlayUrl } from './playUrl';

export interface ResultGroup {
  key: string;
  items: SearchResult[];
}

const MAX_GROUPS = 30;

function groupKey(item: SearchResult): string {
  const kind = item.episodes.length === 1 ? 'movie' : 'tv';
  return `${item.title.replaceAll(' ', '')}-${item.year || 'unknown'}-${kind}`;
}

export function groupResults(
  results: SearchResult[],
  query: string
): ResultGroup[] {
  const map = new Map<string, SearchResult[]>();
  for (const item of results) {
    const key = groupKey(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  const needle = query.trim().replaceAll(' ', '');
  const groups = Array.from(map.entries()).map(([key, items]) => ({
    key,
    items,
    matched: items[0].title.replaceAll(' ', '').includes(needle),
  }));
  groups.sort((a, b) => Number(b.matched) - Number(a.matched));
  return groups.slice(0, MAX_GROUPS).map(({ key, items }) => ({ key, items }));
}

export function groupPlayUrl(group: ResultGroup, query: string): string {
  const first = group.items[0];
  const trimmed = query.trim();
  return buildPlayUrl({
    source: first.source,
    id: first.id,
    title: first.title,
    year: first.year && first.year !== 'unknown' ? first.year : undefined,
    prefer: group.items.length > 1,
    stitle: trimmed && trimmed !== first.title ? trimmed : undefined,
  });
}
