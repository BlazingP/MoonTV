'use client';

import {
  Home,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
} from 'lucide-react';

import { RemoteCommand, RemoteDevice } from '@/lib/remote/types';

import ControlButton from './ControlButton';
import Poster from './Poster';
import ProgressBar from './ProgressBar';

interface NowPlayingProps {
  device: RemoteDevice;
  onCommand: (command: RemoteCommand, okText?: string) => void;
}

const SEEK_STEP_SECONDS = 10;

function episodeText(index?: number, total?: number): string | null {
  if (index === undefined) return null;
  const current = `第 ${index + 1} 集`;
  return total && total > 0 ? `${current} / 共 ${total} 集` : current;
}

function Heading({ device }: { device: RemoteDevice }) {
  const status = device.status;
  const playing = status?.page === 'play';
  const meta = [
    playing ? episodeText(status?.episodeIndex, status?.totalEpisodes) : null,
    status?.year,
  ].filter(Boolean);
  return (
    <div className='flex gap-4'>
      <Poster
        src={playing ? status?.poster : undefined}
        alt={status?.title ?? '海报'}
        className='h-28 w-20'
      />
      <div className='min-w-0 flex-1 self-center'>
        <p className='text-xs text-slate-500 dark:text-slate-400'>
          {device.name}
          {device.online ? '' : '（离线）'}
        </p>
        <h2 className='mt-1 line-clamp-2 text-lg font-semibold text-slate-900 dark:text-slate-100'>
          {playing ? status?.title || '正在播放' : '电视未在播放'}
        </h2>
        <p className='mt-1 text-sm text-emerald-700 dark:text-emerald-300'>
          {playing ? meta.join(' · ') : '可以选择下方视频开始播放'}
        </p>
      </div>
    </div>
  );
}

export default function NowPlaying({ device, onCommand }: NowPlayingProps) {
  const status = device.status;
  const playing = device.online && status?.page === 'play';
  const send = (command: RemoteCommand) => () => onCommand(command);

  return (
    <section className='media-section surface-glass space-y-5'>
      <Heading device={device} />
      <ProgressBar
        currentTime={status?.currentTime}
        duration={status?.duration}
        disabled={!playing}
        onSeek={(time) => onCommand({ type: 'seek', time })}
      />
      <div className='grid grid-cols-4 gap-2'>
        <ControlButton
          icon={RotateCcw}
          label='后退10秒'
          disabled={!playing}
          onClick={send({ type: 'seekBy', delta: -SEEK_STEP_SECONDS })}
        />
        <ControlButton
          primary
          icon={status?.paused ? Play : Pause}
          label={status?.paused ? '播放' : '暂停'}
          disabled={!playing}
          onClick={send({ type: 'toggle' })}
        />
        <ControlButton
          icon={RotateCw}
          label='前进10秒'
          disabled={!playing}
          onClick={send({ type: 'seekBy', delta: SEEK_STEP_SECONDS })}
        />
        <ControlButton
          icon={status?.fullscreen ? Minimize : Maximize}
          label={status?.fullscreen ? '退出全屏' : '全屏'}
          disabled={!playing}
          onClick={send({ type: 'fullscreen', on: !status?.fullscreen })}
        />
        <ControlButton
          icon={SkipBack}
          label='上一集'
          disabled={!playing}
          onClick={send({ type: 'prev' })}
        />
        <ControlButton
          icon={SkipForward}
          label='下一集'
          disabled={!playing}
          onClick={send({ type: 'next' })}
        />
        <div className='col-span-2'>
          <button
            type='button'
            disabled={!device.online}
            onClick={send({ type: 'home' })}
            className='flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl border border-slate-200/70 bg-white/60 text-sm font-medium text-slate-700 transition-all hover:bg-white hover:text-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1] dark:hover:text-emerald-300'
          >
            <Home className='h-5 w-5' />
            电视回首页
          </button>
        </div>
      </div>
    </section>
  );
}
