import { Cast } from 'lucide-react';

import Poster from './Poster';

interface MediaRowProps {
  title: string;
  subtitle?: string;
  poster?: string;
  disabled?: boolean;
  onClick: () => void;
}

export default function MediaRow({
  title,
  subtitle,
  poster,
  disabled,
  onClick,
}: MediaRowProps) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onClick}
      className='group flex w-full items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/50 p-2 text-left transition-all hover:border-emerald-400/60 hover:bg-white/80 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]'
    >
      <Poster src={poster} alt={title} className='h-16 w-12' />
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium text-slate-800 dark:text-slate-100'>
          {title}
        </span>
        {subtitle && (
          <span className='mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400'>
            {subtitle}
          </span>
        )}
      </span>
      <Cast className='mr-2 h-4 w-4 shrink-0 text-slate-400 transition-colors group-hover:text-emerald-600 dark:group-hover:text-emerald-300' />
    </button>
  );
}
