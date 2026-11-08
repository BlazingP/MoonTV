'use client';

import { HardDrive, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import {
  jellyfinItemFromVodId,
  NAS_SOURCE_KEY,
  NasCard,
  NasLibrary,
  NasType,
} from '@/lib/nas';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import NasPlayChooser from '@/components/NasPlayChooser';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

const TABS = [
  { label: '电影', value: 'movie' },
  { label: '剧集', value: 'tv' },
];
const SOURCE_NAME = '🏠 我的 NAS';
const focusStyle =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950';
const gridStyle =
  'grid grid-cols-2 gap-x-4 gap-y-14 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';

function LibraryView({ type }: { type: NasType }) {
  const [cards, setCards] = useState<NasCard[]>([]);
  const [page, setPage] = useState(1);
  const [pagecount, setPagecount] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  // 点卡片先选播放方式：Jellyfin（默认）或 NAS 转码（备用）
  const [chosen, setChosen] = useState<{
    card: NasCard;
    href: string;
  } | null>(null);
  const closeChooser = useCallback(() => setChosen(null), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    (async () => {
      try {
        const params = new URLSearchParams({ type, page: String(page) });
        const response = await fetch(`/api/nas/library?${params}`, {
          signal: controller.signal,
        });
        // An expired login gets a plain-text 401 from the middleware, not JSON.
        const isJson = (response.headers.get('content-type') || '').includes(
          'application/json'
        );
        const data = isJson ? await response.json() : {};
        if (!response.ok)
          throw new Error(
            data.error ||
              (response.status === 401 ? '登录已过期，请刷新后重新登录。' : '')
          );
        const library = data as NasLibrary;
        if (controller.signal.aborted) return;
        setCards((previous) => {
          const seen = new Set(previous.map((card) => card.vod_id));
          return [
            ...previous,
            ...library.list.filter((card) => !seen.has(card.vod_id)),
          ];
        });
        setPagecount(library.pagecount);
        setTotal(library.total);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            (e instanceof Error && e.message) || 'NAS 片库暂时无法加载。'
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [type, page, retry]);

  // Retrying re-requests the page that failed, so no page is ever skipped.
  const errorBox = !error ? null : (
    <div className='mt-8 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200'>
      <p>{error}</p>
      <button
        type='button'
        onClick={() => setRetry((value) => value + 1)}
        className={`mt-4 rounded-full border border-red-300 px-5 py-2 ${focusStyle}`}
      >
        重试
      </button>
    </div>
  );

  if (error && cards.length === 0) return errorBox;

  if (!loading && cards.length === 0)
    return (
      <p className='py-16 text-center text-sm text-slate-500 dark:text-slate-400'>
        这里还没有{type === 'movie' ? '电影' : '剧集'}
        。片子下载入库后会自动出现。
      </p>
    );

  return (
    <>
      <p className='mb-6 text-sm text-slate-500 dark:text-slate-400'>
        共 {total} {type === 'movie' ? '部电影' : '季剧集'}，按最近入库排序
      </p>
      <div className={gridStyle}>
        {cards.map((card) => (
          <div key={card.vod_id} className='w-full'>
            <VideoCard
              id={card.vod_id}
              title={card.vod_name}
              query={
                card.search_title !== card.vod_name ? card.search_title : ''
              }
              poster={card.vod_pic}
              episodes={card.episodes}
              source={NAS_SOURCE_KEY}
              source_name={SOURCE_NAME}
              douban_id=''
              year={card.vod_year}
              from='search'
              type={type}
              onOpen={(href) => setChosen({ card, href })}
            />
          </div>
        ))}
        {loading &&
          Array.from({ length: 6 }, (_, i) => <DoubanCardSkeleton key={i} />)}
      </div>
      {errorBox}
      {chosen && (
        <NasPlayChooser
          title={chosen.card.vod_name}
          jellyfinItem={jellyfinItemFromVodId(chosen.card.vod_id)}
          fallbackHref={chosen.href}
          onClose={closeChooser}
        />
      )}
      {!loading && !error && page < pagecount && (
        <div className='mt-12 flex justify-center'>
          <button
            type='button'
            onClick={() => setPage((value) => value + 1)}
            className={`rounded-full border border-slate-200 px-6 py-2.5 text-sm font-medium transition-colors hover:bg-emerald-50 dark:border-white/15 dark:hover:bg-white/10 ${focusStyle}`}
          >
            加载更多
          </button>
        </div>
      )}
      {loading && cards.length > 0 && (
        <Loader2 className='mx-auto mt-8 h-6 w-6 animate-spin text-emerald-600' />
      )}
    </>
  );
}

function NasPage() {
  const router = useRouter();
  const params = useSearchParams();
  const type: NasType = params.get('type') === 'tv' ? 'tv' : 'movie';

  return (
    <PageLayout activePath='/nas'>
      <div className='px-4 py-6 text-slate-800 sm:px-6 md:px-8 md:pt-20 dark:text-slate-100'>
        <header className='mb-8'>
          <h1 className='flex items-center gap-2 text-2xl font-bold'>
            <HardDrive
              className='h-6 w-6 text-emerald-600 dark:text-emerald-300'
              aria-hidden='true'
            />
            我的 NAS
          </h1>
          <p className='mt-2 text-sm text-slate-500 dark:text-slate-400'>
            家里 Mac mini 上的片库，原画、无广告。
          </p>
        </header>
        <CapsuleSwitch
          options={TABS}
          active={type}
          onChange={(value) => router.replace(`/nas?type=${value}`)}
          className='mb-8'
        />
        {/* Remount on tab change so each tab starts from page 1. */}
        <LibraryView key={type} type={type} />
      </div>
    </PageLayout>
  );
}

export default function NasPageWrapper() {
  return (
    <Suspense>
      <NasPage />
    </Suspense>
  );
}
