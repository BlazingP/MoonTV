'use client';

import { Cast } from 'lucide-react';

import { RemoteDevice } from '@/lib/remote/types';

interface DevicePickerProps {
  devices: RemoteDevice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function DevicePicker({
  devices,
  selectedId,
  onSelect,
}: DevicePickerProps) {
  const onlineCount = devices.filter((d) => d.online).length;
  if (devices.length === 0 || (devices.length === 1 && onlineCount === 1)) {
    return null;
  }
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Cast className='h-4 w-4 text-slate-500 dark:text-slate-400' />
      {devices.map((device) => {
        const active = device.deviceId === selectedId;
        return (
          <button
            key={device.deviceId}
            type='button'
            aria-pressed={active}
            onClick={() => onSelect(device.deviceId)}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors ${
              active
                ? 'bg-emerald-500/[0.15] font-medium text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300'
                : 'border border-slate-200/70 text-slate-600 hover:text-emerald-700 dark:border-white/10 dark:text-slate-300 dark:hover:text-emerald-300'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                device.online ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            {device.name}
          </button>
        );
      })}
    </div>
  );
}
