'use client';

import { Search } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';

import { groupPlayUrl, groupResults } from '@/lib/remote/searchGroup';
import { SearchResult } from '@/lib/types';

import MediaRow from './MediaRow';

interface SearchPanelProps {
  disabled?: boolean;
  onPlay: (url: string, title: string) => void;
}

type SearchState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; query: string; results: SearchResult[] };

async function fetchResults(query: string): Promise<SearchResult[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { results?: SearchResult[] };
  return data.results ?? [];
}

function useSearch() {
  const [state, setState] = useState<SearchState>({ phase: 'idle' });
  const run = async (raw: string) => {
    const query = raw.trim().replace(/\s+/g, ' ');
    if (!query) return;
    setState({ phase: 'loading' });
    try {
      const results = await fetchResults(query);
      setState({ phase: 'done', query, results });
    } catch {
      setState({ phase: 'error', message: '搜索失败，请稍后重试' });
    }
  };
  return { state, run };
}

function Results({
  state,
  disabled,
  onPlay,
}: {
  state: SearchState;
  disabled?: boolean;
  onPlay: SearchPanelProps['onPlay'];
}) {
  const groups = useMemo(
    () =>
      state.phase === 'done' ? groupResults(state.results, state.query) : [],
    [state]
  );
  if (state.phase === 'loading') {
    return (
      <div className='flex h-24 items-center justify-center'>
        <div className='h-8 w-8 animate-spin rounded-full border-2 border-emerald-500/20 border-t-emerald-500' />
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <p className='text-sm text-red-600 dark:text-red-400'>{state.message}</p>
    );
  }
  if (state.phase !== 'done') return null;
  if (groups.length === 0)
    return <div className='empty-state'>没有找到相关结果</div>;
  return (
    <div className='space-y-2'>
      {groups.map((group) => {
        const first = group.items[0];
        const subtitle = [
          first.year && first.year !== 'unknown' ? first.year : null,
          first.episodes.length > 1 ? `${first.episodes.length} 集` : '电影',
          group.items.length > 1
            ? `${group.items.length} 个来源`
            : first.source_name,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <MediaRow
            key={group.key}
            title={first.title}
            subtitle={subtitle}
            poster={first.poster}
            disabled={disabled}
            onClick={() =>
              onPlay(groupPlayUrl(group, state.query), first.title)
            }
          />
        );
      })}
    </div>
  );
}

export default function SearchPanel({ disabled, onPlay }: SearchPanelProps) {
  const [text, setText] = useState('');
  const { state, run } = useSearch();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    run(text);
  };

  return (
    <div className='space-y-3'>
      <form onSubmit={handleSubmit} className='relative'>
        <Search className='absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500' />
        <input
          type='search'
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='搜索电影、电视剧...'
          aria-label='搜索视频'
          className='surface-glass-strong h-12 w-full rounded-2xl py-3 pl-12 pr-4 text-sm text-slate-800 placeholder-slate-400 shadow-none outline-none transition-all focus:border-emerald-400/70 focus:ring-4 focus:ring-emerald-500/10 dark:text-slate-100 dark:placeholder-slate-500'
        />
      </form>
      <Results state={state} disabled={disabled} onPlay={onPlay} />
    </div>
  );
}
