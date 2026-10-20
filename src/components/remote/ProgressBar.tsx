'use client';

import { useRef, useState } from 'react';

import { formatTime } from './format';

interface ProgressBarProps {
  currentTime?: number;
  duration?: number;
  disabled?: boolean;
  onSeek: (time: number) => void;
}

/** 进度条：拖动期间不被状态更新打断，松手时才发送 seek。 */
export default function ProgressBar({
  currentTime = 0,
  duration,
  disabled,
  onSeek,
}: ProgressBarProps) {
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const max = duration && duration > 0 ? duration : Math.max(currentTime, 1);
  const value = drag ?? Math.min(currentTime, max);

  const update = (next: number) => {
    dragRef.current = next;
    setDrag(next);
  };
  const commit = () => {
    const next = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (next !== null) onSeek(next);
  };

  return (
    <div>
      <input
        type='range'
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled || !duration}
        aria-label='播放进度'
        onChange={(e) => update(Number(e.target.value))}
        onPointerUp={commit}
        onPointerCancel={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        className='h-2 w-full cursor-pointer accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-50'
      />
      <div className='mt-1 flex justify-between text-xs tabular-nums text-slate-500 dark:text-slate-400'>
        <span>{formatTime(value)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
