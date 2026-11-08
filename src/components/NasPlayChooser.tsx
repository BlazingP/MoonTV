'use client';

import { MonitorPlay, Wand2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { jellyfinDetailsUrl } from '@/lib/nas';
import { getJellyfinBaseUrl } from '@/lib/nas.client';

interface NasPlayChooserProps {
  title: string;
  /** Jellyfin item to open (movie, season or episode). */
  jellyfinItem: string;
  /** nas-bridge transcoding play page, kept as the fallback. */
  fallbackHref: string;
  onClose: () => void;
}

const buttonBase =
  'flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400';

/**
 * 「我的 NAS」的播放方式：默认用 Jellyfin 网页版（真字幕轨、可选字幕），
 * NAS 转码播放（字幕烧进画面）留作备用。
 */
export default function NasPlayChooser({
  title,
  jellyfinItem,
  fallbackHref,
  onClose,
}: NasPlayChooserProps) {
  const router = useRouter();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const jellyfinUrl = jellyfinDetailsUrl(getJellyfinBaseUrl(), jellyfinItem);

  useEffect(() => {
    // 电视遥控器导航（Blazing TV 的 tv-nav.js）只在可点击、pointer-events 不为 none
    // 的元素间移动；弹窗打开时让背后的页面失效，焦点只会落在弹窗按钮上。
    const body = document.body;
    const previous = body.style.pointerEvents;
    body.style.pointerEvents = 'none';
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      body.style.pointerEvents = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      role='dialog'
      aria-modal='true'
      aria-label={`播放 ${title}`}
      className='fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm'
      style={{ pointerEvents: 'auto' }}
      onClick={onClose}
    >
      <div
        className='w-full max-w-md rounded-3xl bg-white p-6 text-slate-800 shadow-2xl dark:bg-slate-900 dark:text-slate-100'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='mb-5 flex items-start justify-between gap-4'>
          <div>
            <p className='text-sm text-slate-500 dark:text-slate-400'>
              我的 NAS
            </p>
            <h2 className='text-xl font-bold'>{title}</h2>
          </div>
          <button
            type='button'
            aria-label='关闭'
            onClick={onClose}
            className='rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10'
          >
            <X className='h-5 w-5' />
          </button>
        </div>
        <div className='space-y-3'>
          {jellyfinUrl ? (
            <button
              ref={primaryRef}
              type='button'
              onClick={() => window.location.assign(jellyfinUrl)}
              className={`${buttonBase} bg-emerald-600 text-white hover:bg-emerald-500`}
            >
              <MonitorPlay className='h-6 w-6 flex-shrink-0' />
              <span>
                <span className='block text-base font-semibold'>
                  用 Jellyfin 播放
                </span>
                <span className='block text-xs opacity-80'>
                  原画、可选中文字幕；看完按返回键回到这里
                </span>
              </span>
            </button>
          ) : (
            <p className='rounded-2xl bg-amber-50 px-5 py-4 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200'>
              没找到 Jellyfin 的地址，先用下面的转码播放。
            </p>
          )}
          <button
            ref={jellyfinUrl ? undefined : primaryRef}
            type='button'
            onClick={() => router.push(fallbackHref)}
            className={`${buttonBase} border border-slate-200 hover:bg-slate-50 dark:border-white/15 dark:hover:bg-white/10`}
          >
            <Wand2 className='h-6 w-6 flex-shrink-0 text-emerald-600 dark:text-emerald-300' />
            <span>
              <span className='block text-base font-semibold'>
                NAS 转码播放（备用）
              </span>
              <span className='block text-xs text-slate-500 dark:text-slate-400'>
                在 MoonTV 里播放，字幕烧进画面；Jellyfin 打不开时用
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
