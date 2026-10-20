'use client';

import { Cast } from 'lucide-react';

import PageLayout from '@/components/PageLayout';
import DevicePicker from '@/components/remote/DevicePicker';
import EpisodeGrid from '@/components/remote/EpisodeGrid';
import NowPlaying from '@/components/remote/NowPlaying';
import RecentPanel from '@/components/remote/RecentPanel';
import SearchPanel from '@/components/remote/SearchPanel';
import { useRemote } from '@/components/remote/useRemote';

const EMPTY_TEXT = '没有找到在线的电视，请在电视上打开 Blazing TV';

function EmptyState({
  loading,
  hasDevices,
}: {
  loading: boolean;
  hasDevices: boolean;
}) {
  if (loading) {
    return (
      <div className='flex h-40 items-center justify-center'>
        <div className='h-10 w-10 animate-spin rounded-full border-2 border-emerald-500/20 border-t-emerald-500' />
      </div>
    );
  }
  return (
    <div className='empty-state'>
      <Cast className='mx-auto mb-3 h-8 w-8 text-slate-400' />
      {hasDevices ? '请选择要遥控的电视' : EMPTY_TEXT}
    </div>
  );
}

export default function RemotePage() {
  const remote = useRemote();
  const { device, notice } = remote;
  const online = Boolean(device?.online);
  const anyOnline = remote.devices.some((d) => d.online);

  const handlePlay = (url: string, title: string) => {
    remote.send({ type: 'navigate', url }, `已在电视上打开《${title}》`);
  };

  return (
    <PageLayout activePath='/remote'>
      <div className='app-page overflow-visible'>
        <div className='mx-auto w-full max-w-2xl space-y-5'>
          <h1 className='text-xl font-semibold text-slate-900 dark:text-slate-100'>
            遥控电视
          </h1>
          <DevicePicker
            devices={remote.devices}
            selectedId={remote.deviceId}
            onSelect={remote.selectDevice}
          />
          {notice && (
            <p
              role='status'
              className={`rounded-xl px-3 py-2 text-sm ${
                notice.kind === 'error'
                  ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {notice.text}
            </p>
          )}
          {!device || (!online && !anyOnline) ? (
            <EmptyState loading={remote.loading} hasDevices={anyOnline} />
          ) : (
            <>
              <NowPlaying device={device} onCommand={remote.send} />
              <EpisodeGrid
                episodes={remote.episodes}
                currentIndex={device.status?.episodeIndex}
                disabled={!online || device.status?.page !== 'play'}
                onSelect={(index) => remote.send({ type: 'episode', index })}
              />
              <section className='media-section surface-glass space-y-4'>
                <div className='section-bar'>
                  <h2 className='section-title'>换个视频</h2>
                </div>
                <SearchPanel disabled={!online} onPlay={handlePlay} />
                <RecentPanel disabled={!online} onPlay={handlePlay} />
              </section>
            </>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
