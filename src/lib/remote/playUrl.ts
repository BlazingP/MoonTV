// 构造遥控页发给电视的 /play 站内链接（参数与 VideoCard 保持一致）。
import { MAX_NAVIGATE_URL_LENGTH } from './types';

export interface PlayTarget {
  source: string;
  id: string;
  title: string;
  year?: string;
  stitle?: string;
  prefer?: boolean;
}

export function buildPlayUrl(target: PlayTarget): string {
  const build = (withStitle: boolean) => {
    const params = new URLSearchParams({
      source: target.source,
      id: target.id,
      title: target.title,
    });
    if (target.year) params.set('year', target.year);
    if (target.prefer) params.set('prefer', 'true');
    if (withStitle && target.stitle) params.set('stitle', target.stitle);
    return `/play?${params.toString()}`;
  };
  const full = build(true);
  return full.length <= MAX_NAVIGATE_URL_LENGTH ? full : build(false);
}

/** 播放记录的 key 形如 "source+id"。 */
export function parseRecordKey(
  key: string
): { source: string; id: string } | null {
  const index = key.indexOf('+');
  if (index <= 0 || index === key.length - 1) return null;
  return { source: key.slice(0, index), id: key.slice(index + 1) };
}
