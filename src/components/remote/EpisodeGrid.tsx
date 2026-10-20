'use client';

import { RemoteEpisode } from '@/lib/remote/types';

interface EpisodeGridProps {
  episodes: RemoteEpisode[];
  currentIndex?: number;
  disabled?: boolean;
  onSelect: (index: number) => void;
}

export default function EpisodeGrid({
  episodes,
  currentIndex,
  disabled,
  onSelect,
}: EpisodeGridProps) {
  if (episodes.length <= 1) return null;
  return (
    <section className='media-section surface-glass'>
      <div className='section-bar'>
        <h2 className='section-title'>选集</h2>
        <span className='text-xs text-slate-500 dark:text-slate-400'>
          共 {episodes.length} 集
        </span>
      </div>
      <div className='grid max-h-72 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6'>
        {episodes.map((episode) => {
          const active = episode.index === currentIndex;
          return (
            <button
              key={episode.index}
              type='button'
              disabled={disabled}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(episode.index)}
              className={`min-h-[44px] truncate rounded-xl px-2 text-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? 'bg-emerald-500/[0.15] font-semibold text-emerald-800 ring-1 ring-emerald-500/50 dark:bg-emerald-400/10 dark:text-emerald-300'
                  : 'border border-slate-200/70 bg-white/55 text-slate-700 hover:text-emerald-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-emerald-300'
              }`}
            >
              {episode.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
