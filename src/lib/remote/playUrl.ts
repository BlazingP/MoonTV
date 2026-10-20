// 构造遥控页发给电视的 /play 站内链接（参数与 VideoCard 保持一致）。
import { MAX_NAVIGATE_URL_LENGTH } from './types';

export interface PlayTarget {
  source: string;
  id: string;
  title: string;
  year?: string;
  stitle?: string;
  prefer?: boolean;
  /** 只在 Kazumi 源里换源/优选（带 scope=kazumi），由调用方按候选源决定。 */
  kazumiOnly?: boolean;
}

/**
 * Kazumi 桥接源的 key 都以 "kazumi_" 开头（如 kazumi_mxdm）。
 * 这是部署配置（config.kazumi.json）的命名约定，改名后需要同步这里。
 */
export function isKazumiSource(source: string): boolean {
  return source.startsWith('kazumi_');
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
    // 与 Kazumi 页一致：带上 scope，播放页的换源只在 Kazumi 源里找
    if (target.kazumiOnly) params.set('scope', 'kazumi');
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
