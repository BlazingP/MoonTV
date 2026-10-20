'use client';

import { RemoteSource } from '@/lib/remote/types';

interface SourceListProps {
  sources: RemoteSource[];
  currentSource?: string;
  currentId?: string;
  loading?: boolean;
  disabled?: boolean;
  onSelect: (source: RemoteSource) => void;
}

function SourceMeta({ item }: { item: RemoteSource }) {
  const parts = [
    item.episodes > 0 ? `${item.episodes} 集` : '',
    item.quality || '',
    item.speed || '',
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <span className='truncate text-xs text-slate-500 dark:text-slate-400'>
      {parts.join(' · ')}
    </span>
  );
}

/** 换源列表：当前源高亮，点击其他源让电视切换播放源。 */
export default function SourceList({
  sources,
  currentSource,
  currentId,
  loading,
  disabled,
  onSelect,
}: SourceListProps) {
  if (sources.length === 0 && !loading) return null;
  return (
    <section className='media-section surface-glass'>
      <div className='section-bar'>
        <h2 className='section-title'>换源</h2>
        <span className='text-xs text-slate-500 dark:text-slate-400'>
          {loading ? '正在搜索可用源…' : `共 ${sources.length} 个源`}
        </span>
      </div>
      <div className='grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2'>
        {sources.map((item) => {
          const active = item.source === currentSource && item.id === currentId;
          return (
            <button
              key={`${item.source}-${item.id}`}
              type='button'
              disabled={disabled || active}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(item)}
              className={`flex min-h-[52px] flex-col items-start justify-center gap-0.5 rounded-xl px-3 py-2 text-left text-sm transition-all active:scale-[0.98] disabled:cursor-not-allowed ${
                active
                  ? 'bg-emerald-500/[0.15] font-semibold text-emerald-800 ring-1 ring-emerald-500/50 dark:bg-emerald-400/10 dark:text-emerald-300'
                  : 'border border-slate-200/70 bg-white/55 text-slate-700 hover:text-emerald-700 disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-emerald-300'
              }`}
            >
              <span className='w-full truncate'>
                {item.name}
                {active ? '（当前）' : ''}
              </span>
              <SourceMeta item={item} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
