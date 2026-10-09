'use client';

import { ArrowLeft, Loader2, Play, Search, Sparkles } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';

import {
  KAZUMI_TAGS,
  KazumiCatalog,
  KazumiSubject,
} from '@/lib/kazumi-catalog';
import { SearchResult } from '@/lib/types';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import PageLayout from '@/components/PageLayout';

const focusStyle =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950';
const buttonStyle = `rounded-full border border-slate-200 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10 ${focusStyle}`;

function Poster({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className='relative aspect-[2/3] overflow-hidden rounded-2xl bg-slate-200/60 dark:bg-slate-800'>
      {src && !failed ? (
        <Image
          src={src}
          alt=''
          fill
          sizes='(max-width: 640px) 45vw, (max-width: 1280px) 23vw, 15vw'
          referrerPolicy='no-referrer'
          className='object-cover'
          onError={() => setFailed(true)}
        />
      ) : (
        <div className='flex h-full items-center justify-center text-slate-400'>
          <Sparkles className='h-10 w-10' aria-hidden='true' />
        </div>
      )}
    </div>
  );
}

function LoadingCards() {
  return (
    <div
      className='grid grid-cols-2 gap-x-4 gap-y-14 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'
      aria-hidden='true'
    >
      {Array.from({ length: 12 }, (_, i) => (
        <DoubanCardSkeleton key={i} />
      ))}
    </div>
  );
}

function CatalogView({ tag, query }: { tag: string; query: string }) {
  const [items, setItems] = useState<KazumiSubject[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ tag, q: query, page: String(page) });
    (async () => {
      try {
        const response = await fetch(`/api/kazumi/catalog?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('番剧目录暂时无法加载，请稍后重试。');
        const data: KazumiCatalog = await response.json();
        if (controller.signal.aborted) return;
        setItems((previous) => {
          const seen = new Set(previous.map((item) => item.id));
          return [
            ...previous,
            ...data.items.filter((item) => !seen.has(item.id)),
          ];
        });
        setHasMore(data.hasMore);
      } catch {
        if (!controller.signal.aborted)
          setError('番剧目录暂时无法加载，请检查网络后重试。');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [tag, query, page, retry]);

  return (
    <section
      aria-label={query ? '番剧搜索结果' : tag || '热门番组'}
      aria-busy={loading}
    >
      <div className='mb-5 flex items-center justify-between gap-4'>
        <h2 className='text-lg font-semibold'>
          {query ? `“${query}”的搜索结果` : tag || '热门番组'}
        </h2>
        <span className='text-xs text-slate-500 dark:text-slate-400'>
          Bangumi 番剧目录
        </span>
      </div>
      {loading && items.length === 0 ? (
        <LoadingCards />
      ) : (
        <div className='grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'>
          {items.map((item) => {
            const params = new URLSearchParams({
              title: item.title,
              original: item.originalTitle,
            });
            if (tag) params.set('tag', tag);
            if (query) params.set('q', query);
            return (
              <Link
                key={item.id}
                href={`/kazumi?${params}`}
                className={`group min-w-0 rounded-2xl ${focusStyle}`}
                aria-label={`查找 ${item.title} 的播放源`}
              >
                <div className='relative'>
                  <Poster src={item.poster} />
                  {item.score && (
                    <span className='absolute right-2 top-2 rounded-lg bg-black/70 px-2 py-1 text-xs font-semibold text-amber-300'>
                      {item.score}
                    </span>
                  )}
                </div>
                <h3 className='mt-2 line-clamp-2 text-sm font-semibold group-hover:text-emerald-600 dark:group-hover:text-emerald-300'>
                  {item.title}
                </h3>
                <p className='mt-1 truncate text-xs text-slate-500 dark:text-slate-400'>
                  {item.info || item.originalTitle}
                </p>
              </Link>
            );
          })}
        </div>
      )}
      <div className='mt-10 flex flex-col items-center gap-4 text-center'>
        <p role='status' className='text-sm text-slate-500 dark:text-slate-400'>
          {loading
            ? '正在加载番剧…'
            : !error && !items.length
            ? '没有找到相关番剧，试试其他分类或关键词。'
            : ''}
        </p>
        {error && (
          <>
            <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
              {error}
            </p>
            <button
              className={buttonStyle}
              onClick={() => setRetry((value) => value + 1)}
            >
              重新加载
            </button>
          </>
        )}
        {!error && hasMore && (
          <button
            disabled={loading}
            className={buttonStyle}
            onClick={() => setPage((value) => value + 1)}
          >
            {loading ? '加载中…' : '加载更多'}
          </button>
        )}
      </div>
    </section>
  );
}

function SourceView({ title, original }: { title: string; original: string }) {
  const [input, setInput] = useState(title);
  const [query, setQuery] = useState(title);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [retry, setRetry] = useState(0);
  const [matchedQuery, setMatchedQuery] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let active = true;
    setLoading(true);
    setError('');
    setResults([]);
    setMatchedQuery('');
    (async () => {
      try {
        const search = async (term: string) => {
          const params = new URLSearchParams({ q: term, scope: 'kazumi' });
          const response = await fetch(`/api/search?${params}`, {
            signal: controller.signal,
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('搜索失败');
          return response.json() as Promise<{
            results: SearchResult[];
            sourcesConfigured: boolean;
          }>;
        };
        let data = await search(query);
        let matched = query;
        if (
          data.sourcesConfigured &&
          !data.results.length &&
          query === title &&
          original &&
          original !== title
        ) {
          data = await search(original);
          matched = original;
        }
        if (!active) return;
        setConfigured(data.sourcesConfigured);
        setResults(data.results.filter((item) => item.episodes.length > 0));
        setMatchedQuery(matched);
      } catch {
        if (active) setError('播放源搜索未完成，请稍后重试。');
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, title, original, retry]);

  function search(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setQuery(input.trim());
    setRetry((value) => value + 1);
  }

  return (
    <section aria-label='选择播放源' aria-busy={loading}>
      <h2 className='text-2xl font-bold'>{title}</h2>
      <p className='mt-2 text-sm text-slate-500 dark:text-slate-400'>
        选择 Kazumi 播放源。不同来源的译名可能不同，可以修改搜索词。
      </p>
      <form onSubmit={search} className='my-6 flex max-w-xl gap-2'>
        <label htmlFor='kazumi-source-query' className='sr-only'>
          播放源搜索词
        </label>
        <input
          id='kazumi-source-query'
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={100}
          className={`min-w-0 flex-1 rounded-full border border-slate-300 bg-white/60 px-4 py-2 text-sm dark:border-white/15 dark:bg-white/5 ${focusStyle}`}
        />
        <button type='submit' className={buttonStyle}>
          搜索
        </button>
      </form>
      {loading ? (
        <p role='status' className='flex items-center gap-2 py-12 text-sm'>
          <Loader2 className='h-5 w-5 animate-spin' aria-hidden='true' />
          正在查找播放源…
        </p>
      ) : error ? (
        <div className='space-y-4'>
          <p role='alert'>{error}</p>
          <button
            className={buttonStyle}
            onClick={() => setRetry((value) => value + 1)}
          >
            重试搜索
          </button>
        </div>
      ) : !configured ? (
        <p role='status' className='py-8 text-slate-500 dark:text-slate-400'>
          暂未启用 Kazumi 播放源，请联系管理员完成配置。番剧目录仍可正常浏览。
        </p>
      ) : !results.length ? (
        <p role='status' className='py-8 text-slate-500 dark:text-slate-400'>
          暂未找到可播放结果。可以缩短番剧名称、尝试其他译名，或稍后重试。
        </p>
      ) : (
        <>
          <p
            role='status'
            className='mb-4 text-sm text-slate-500 dark:text-slate-400'
          >
            找到 {results.length} 条结果，请核对作品名称和集数。
          </p>
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            {results.map((item) => {
              const params = new URLSearchParams({
                source: item.source,
                id: item.id,
                title: item.title,
                stitle: matchedQuery,
                scope: 'kazumi',
              });
              if (item.year && item.year !== 'unknown')
                params.set('year', item.year);
              return (
                <Link
                  key={`${item.source}-${item.id}`}
                  href={`/play?${params}`}
                  className={`surface-glass flex items-center gap-3 rounded-2xl p-4 hover:bg-emerald-50 dark:hover:bg-white/10 ${focusStyle}`}
                >
                  <Play
                    className='h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300'
                    aria-hidden='true'
                  />
                  <div className='min-w-0'>
                    <h3 className='line-clamp-2 text-sm font-semibold'>
                      {item.title}
                    </h3>
                    <p className='mt-1 text-xs text-slate-500 dark:text-slate-400'>
                      {item.source_name} · {item.episodes.length} 集
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function KazumiPageClient() {
  const params = useSearchParams();
  const router = useRouter();
  const tag = params.get('tag') || '';
  const query = params.get('q') || '';
  const title = params.get('title') || '';
  const original = params.get('original') || '';
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);
  const catalogParams = new URLSearchParams();
  if (tag) catalogParams.set('tag', tag);
  if (query) catalogParams.set('q', query);
  const catalogHref = `/kazumi${catalogParams.size ? `?${catalogParams}` : ''}`;

  function search(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (tag) next.set('tag', tag);
    if (input.trim()) next.set('q', input.trim());
    router.push(`/kazumi?${next}`);
  }

  return (
    <PageLayout activePath='/kazumi'>
      <div className='px-4 py-6 text-slate-800 sm:px-6 md:px-8 md:pt-20 dark:text-slate-100'>
        <header className='mb-8'>
          <h1 className='flex items-center gap-2 text-2xl font-bold'>
            <Sparkles
              className='h-6 w-6 text-emerald-600 dark:text-emerald-300'
              aria-hidden='true'
            />
            动漫kazumi
          </h1>
          <p className='mt-2 text-sm text-slate-500 dark:text-slate-400'>
            与 Kazumi 相同的 Bangumi 热门番组，发现想看的下一部动漫。
          </p>
        </header>
        {title ? (
          <>
            <Link
              href={catalogHref}
              className={`mb-6 inline-flex items-center gap-1 rounded-lg py-2 text-sm text-emerald-700 dark:text-emerald-300 ${focusStyle}`}
            >
              <ArrowLeft className='h-4 w-4' aria-hidden='true' />
              返回番剧目录
            </Link>
            <SourceView
              key={`${title}-${original}`}
              title={title}
              original={original}
            />
          </>
        ) : (
          <>
            <form onSubmit={search} className='mb-6 flex max-w-xl gap-2'>
              <label htmlFor='kazumi-catalog-query' className='sr-only'>
                搜索番剧目录
              </label>
              <input
                id='kazumi-catalog-query'
                value={input}
                onChange={(event) => setInput(event.target.value)}
                maxLength={100}
                placeholder='搜索番剧名称'
                className={`min-w-0 flex-1 rounded-full border border-slate-300 bg-white/60 px-4 py-2.5 text-sm dark:border-white/15 dark:bg-white/5 ${focusStyle}`}
              />
              <button
                type='submit'
                className={buttonStyle}
                aria-label='搜索番剧'
              >
                <Search className='h-5 w-5' aria-hidden='true' />
              </button>
            </form>
            <nav aria-label='番剧分类' className='mb-8 flex flex-wrap gap-2'>
              {['', ...KAZUMI_TAGS].map((value) => (
                <Link
                  key={value}
                  href={
                    value
                      ? `/kazumi?${new URLSearchParams({ tag: value })}`
                      : '/kazumi'
                  }
                  aria-current={tag === value && !query ? 'page' : undefined}
                  className={`rounded-full px-3 py-2 text-sm ${focusStyle} ${
                    tag === value && !query
                      ? 'bg-emerald-600 text-white dark:bg-emerald-500'
                      : 'bg-white/60 text-slate-600 hover:bg-emerald-50 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
                  }`}
                >
                  {value || '热门番组'}
                </Link>
              ))}
            </nav>
            <CatalogView key={`${tag}-${query}`} tag={tag} query={query} />
            <p className='mt-8 text-xs text-slate-500 dark:text-slate-400'>
              目录与评分来自{' '}
              <a
                href='https://bangumi.tv'
                target='_blank'
                rel='noreferrer'
                className={`rounded underline ${focusStyle}`}
              >
                Bangumi
              </a>
              ；是否可播放取决于已启用的 Kazumi 来源。
            </p>
          </>
        )}
      </div>
    </PageLayout>
  );
}

export default function KazumiPage() {
  return (
    <Suspense
      fallback={
        <div role='status' className='p-8'>
          正在加载动漫kazumi…
        </div>
      }
    >
      <KazumiPageClient />
    </Suspense>
  );
}
