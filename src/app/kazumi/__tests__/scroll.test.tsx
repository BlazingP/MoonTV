import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';

import KazumiPage from '../page';

const mockNavigation = { params: new URLSearchParams() };
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => mockNavigation.params,
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
jest.mock('@/components/DoubanCardSkeleton', () => ({
  __esModule: true,
  default: () => <div />,
}));

class TestObserver {
  static instances: TestObserver[] = [];
  disconnected = false;
  constructor(private callback: IntersectionObserverCallback) {
    TestObserver.instances.push(this);
  }
  observe() {
    /* Test driver supplies intersection changes. */
  }
  disconnect() {
    this.disconnected = true;
  }
  enter() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

function response(page: number, hasMore: boolean, title = `番剧${page}`) {
  return {
    ok: true,
    json: async () => ({
      page,
      hasMore,
      items: [
        { id: page, title, originalTitle: '', poster: '', score: '', info: '' },
      ],
    }),
  } as Response;
}

function currentObserver() {
  const observer = TestObserver.instances
    .filter((item) => !item.disconnected)
    .pop();
  expect(observer).toBeDefined();
  return observer as TestObserver;
}

beforeEach(() => {
  TestObserver.instances.length = 0;
  global.IntersectionObserver =
    TestObserver as unknown as typeof IntersectionObserver;
  mockNavigation.params = new URLSearchParams();
});
afterEach(cleanup);

test('scrolling near the bottom appends the next page once and stops at the last page', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response(1, true))
    .mockResolvedValueOnce(response(2, false));
  render(<KazumiPage />);
  await screen.findByRole('link', { name: '查找 番剧1 的播放源' });
  expect(
    screen.queryByRole('button', { name: '加载更多' })
  ).not.toBeInTheDocument();
  const observer = currentObserver();
  await act(async () => {
    observer.enter();
    observer.enter();
  });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(String((global.fetch as jest.Mock).mock.calls[1][0])).toContain(
    'page=2'
  );
  expect(
    screen.getByRole('link', { name: '查找 番剧1 的播放源' })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: '查找 番剧2 的播放源' })
  ).toBeInTheDocument();
  expect(screen.getByText('已经到底了')).toBeInTheDocument();
  expect(TestObserver.instances.every((item) => item.disconnected)).toBe(true);
});

test('an in-flight page or failed page cannot trigger more pages; retry requests the failed page again', async () => {
  let failPage: (value: Response) => void = () => undefined;
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response(1, true))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          failPage = resolve;
        })
    )
    .mockResolvedValueOnce(response(2, false));
  render(<KazumiPage />);
  await screen.findByRole('link', { name: '查找 番剧1 的播放源' });
  const observer = currentObserver();
  await act(async () => {
    observer.enter();
  });
  await act(async () => {
    observer.enter();
    observer.enter();
  });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  await act(async () => {
    failPage({ ok: false } as Response);
  });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(TestObserver.instances.every((item) => item.disconnected)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await screen.findByRole('link', { name: '查找 番剧2 的播放源' });
  const calls = (global.fetch as jest.Mock).mock.calls.map(([url]) =>
    new URL(String(url), 'http://localhost').searchParams.get('page')
  );
  expect(calls).toEqual(['1', '2', '2']);
});

test('switching categories aborts an old page and does not mix its results into the new category', async () => {
  let finishOld: (value: Response) => void = () => undefined;
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response(1, true))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishOld = resolve;
        })
    )
    .mockResolvedValueOnce(response(1, false, '治愈新番'));
  const view = render(<KazumiPage />);
  await screen.findByRole('link', { name: '查找 番剧1 的播放源' });
  await act(async () => {
    currentObserver().enter();
  });
  mockNavigation.params = new URLSearchParams({ tag: '治愈' });
  view.rerender(<KazumiPage />);
  await screen.findByRole('link', { name: '查找 治愈新番 的播放源' });
  await act(async () => {
    finishOld(response(2, true));
  });
  expect(
    screen.queryByRole('link', { name: '查找 番剧2 的播放源' })
  ).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls[1][1].signal.aborted).toBe(
    true
  );
});

test('older browsers keep a manual fallback when IntersectionObserver is unavailable', async () => {
  Object.defineProperty(global, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response(1, true))
    .mockResolvedValueOnce(response(2, false));
  render(<KazumiPage />);
  fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
  await screen.findByRole('link', { name: '查找 番剧2 的播放源' });
});
