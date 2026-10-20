import { SearchResult } from '@/lib/types';

import { buildPlayUrl, parseRecordKey } from '../playUrl';
import { groupPlayUrl, groupResults } from '../searchGroup';
import { parseRemoteCommand } from '../types';

const item = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  id: '1',
  title: '测试 剧',
  poster: '',
  episodes: ['a', 'b'],
  source: 'ffzy',
  source_name: '非凡',
  year: '2024',
  ...overrides,
});

describe('buildPlayUrl', () => {
  it('builds a play url that passes command validation', () => {
    const url = buildPlayUrl({
      source: 'ffzy',
      id: 'a b&c',
      title: '你好 世界',
      year: '2024',
      stitle: '搜索',
    });
    const params = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('/play?')).toBe(true);
    expect(params.get('id')).toBe('a b&c');
    expect(params.get('title')).toBe('你好 世界');
    expect(params.get('year')).toBe('2024');
    expect(params.get('stitle')).toBe('搜索');
    expect(parseRemoteCommand({ type: 'navigate', url })).not.toBeNull();
  });

  it('omits empty optional params', () => {
    const url = buildPlayUrl({ source: 's', id: '1', title: 't' });
    expect(url).toBe('/play?source=s&id=1&title=t');
  });

  it('drops stitle when the url would be too long', () => {
    const url = buildPlayUrl({
      source: 's',
      id: '1',
      title: 't',
      stitle: 'x'.repeat(3000),
    });
    expect(url.length).toBeLessThanOrEqual(2048);
    expect(url).not.toContain('stitle');
  });
});

describe('parseRecordKey', () => {
  it('splits source and id', () => {
    expect(parseRecordKey('ffzy+123')).toEqual({ source: 'ffzy', id: '123' });
    expect(parseRecordKey('a+b+c')).toEqual({ source: 'a', id: 'b+c' });
  });

  it('rejects malformed keys', () => {
    expect(parseRecordKey('nokey')).toBeNull();
    expect(parseRecordKey('+id')).toBeNull();
    expect(parseRecordKey('source+')).toBeNull();
  });
});

describe('groupResults', () => {
  it('groups the same title/year across sources', () => {
    const groups = groupResults(
      [item(), item({ source: 'bfzy', id: '9' }), item({ title: '别的' })],
      '测试'
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
  });

  it('ranks title matches first', () => {
    const groups = groupResults(
      [item({ title: '无关', id: '5' }), item({ title: '目标 作品' })],
      '目标'
    );
    expect(groups[0].items[0].title).toBe('目标 作品');
  });

  it('prefers best source when a group has several and adds stitle', () => {
    const [group] = groupResults(
      [item(), item({ source: 'bfzy', id: '9' })],
      '测'
    );
    const params = new URLSearchParams(groupPlayUrl(group, '测').split('?')[1]);
    expect(params.get('prefer')).toBe('true');
    expect(params.get('stitle')).toBe('测');
    expect(params.get('source')).toBe('ffzy');
  });
});
