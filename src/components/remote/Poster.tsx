/* eslint-disable @next/next/no-img-element */
import { processImageUrl } from '@/lib/utils';

interface PosterProps {
  src?: string;
  alt: string;
  className?: string;
}

export default function Poster({ src, alt, className = '' }: PosterProps) {
  const base = `shrink-0 overflow-hidden rounded-xl bg-slate-200/70 dark:bg-white/[0.06] ${className}`;
  if (!src) return <div className={base} aria-hidden='true' />;
  return (
    <img
      src={processImageUrl(src)}
      alt={alt}
      loading='lazy'
      referrerPolicy='no-referrer'
      className={`${base} object-cover`}
    />
  );
}
