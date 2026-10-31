import {
  buildShowRecommendUrl,
  isShowRecommend,
  isValidShowFilter,
  SHOW_HOT,
  toDoubanItems,
} from '../doubanShow';

function selectedOf(url: string) {
  const params = new URL(url).searchParams;
  return {
    selected: JSON.parse(params.get('selected_categories') || '{}'),
    tags: params.get('tags'),
    start: params.get('start'),
    count: params.get('count'),
  };
}

describe('buildShowRecommendUrl', () => {
  test('includes genre and region when both are set', () => {
    const { selected, tags, start, count } = selectedOf(
      buildShowRecommendUrl('真人秀', '韩国', 25, 25)
    );

    expect(selected).toEqual({ 形式: '综艺', 类型: '真人秀', 地区: '韩国' });
    expect(tags).toBe('综艺,真人秀,韩国');
    expect(start).toBe('25');
    expect(count).toBe('25');
  });

  test('omits genre and region set to 全部', () => {
    const { selected, tags } = selectedOf(
      buildShowRecommendUrl('全部', '全部', 0, 25)
    );

    expect(selected).toEqual({ 形式: '综艺' });
    expect(tags).toBe('综艺');
  });

  test('targets the douban tv recommend endpoint', () => {
    const url = new URL(buildShowRecommendUrl('脱口秀', '全部', 0, 25));

    expect(url.origin + url.pathname).toBe(
      'https://m.douban.com/rexxar/api/v2/tv/recommend'
    );
  });
});

describe('show filter helpers', () => {
  test('hot uses the recent_hot endpoint, other genres use recommend', () => {
    expect(isShowRecommend(SHOW_HOT)).toBe(false);
    expect(isShowRecommend('全部')).toBe(true);
    expect(isShowRecommend('真人秀')).toBe(true);
  });

  test('accepts only listed genres and regions', () => {
    expect(isValidShowFilter('真人秀', '韩国')).toBe(true);
    expect(isValidShowFilter(SHOW_HOT, '全部')).toBe(false);
    expect(isValidShowFilter('真人秀', '火星')).toBe(false);
    expect(isValidShowFilter('"}&x=1', '全部')).toBe(false);
  });
});

describe('toDoubanItems', () => {
  test('maps poster, rating and year from card_subtitle', () => {
    const [item] = toDoubanItems([
      {
        id: '1',
        title: '快乐再出发',
        card_subtitle: '2022 / 中国大陆 / 音乐 真人秀',
        pic: { large: 'L', normal: 'N' },
        rating: { value: 9.6 },
      },
    ]);

    expect(item).toEqual({
      id: '1',
      title: '快乐再出发',
      poster: 'N',
      rate: '9.6',
      year: '2022',
    });
  });

  test('tolerates missing pic and rating', () => {
    const [item] = toDoubanItems([{ id: '2', title: 'x', rating: null }]);

    expect(item.poster).toBe('');
    expect(item.rate).toBe('');
    expect(item.year).toBe('');
  });
});
