'use client';

import { useEffect, useState } from 'react';

import { getAllPlayRecords, PlayRecord } from '@/lib/db.client';
import {
  buildPlayUrl,
  isKazumiSource,
  parseRecordKey,
} from '@/lib/remote/playUrl';

import MediaRow from './MediaRow';

interface RecentPanelProps {
  disabled?: boolean;
  onPlay: (url: string, title: string) => void;
}

interface RecentItem {
  key: string;
  source: string;
  id: string;
  record: PlayRecord;
}

const MAX_RECENT = 20;

function toItems(records: Record<string, PlayRecord>): RecentItem[] {
  const items: RecentItem[] = [];
  for (const [key, record] of Object.entries(records)) {
    const parsed = parseRecordKey(key);
    if (parsed) items.push({ key, ...parsed, record });
  }
  return items
    .sort((a, b) => b.record.save_time - a.record.save_time)
    .slice(0, MAX_RECENT);
}

function describe(record: PlayRecord): string {
  const parts = [record.source_name];
  if (record.total_episodes > 1) {
    parts.unshift(`第 ${record.index} / ${record.total_episodes} 集`);
  }
  return parts.filter(Boolean).join(' · ');
}

export default function RecentPanel({ disabled, onPlay }: RecentPanelProps) {
  const [items, setItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    getAllPlayRecords()
      .then((records) => {
        if (!cancelled) setItems(toItems(records));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className='space-y-2'>
      <h3 className='text-sm font-medium text-slate-600 dark:text-slate-300'>
        继续观看
      </h3>
      {items.map(({ key, source, id, record }) => (
        <MediaRow
          key={key}
          title={record.title}
          subtitle={describe(record)}
          poster={record.cover}
          disabled={disabled}
          onClick={() =>
            onPlay(
              buildPlayUrl({
                source,
                id,
                title: record.title,
                year: record.year,
                stitle: record.search_title,
                kazumiOnly: isKazumiSource(source),
              }),
              record.title
            )
          }
        />
      ))}
    </div>
  );
}
