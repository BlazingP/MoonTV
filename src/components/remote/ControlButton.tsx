import { LucideIcon } from 'lucide-react';

interface ControlButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}

export default function ControlButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
}: ControlButtonProps) {
  const tone = primary
    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30 hover:bg-emerald-600 dark:bg-emerald-400 dark:text-slate-950 dark:hover:bg-emerald-300'
    : 'border border-slate-200/70 bg-white/60 text-slate-700 hover:bg-white hover:text-emerald-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.1] dark:hover:text-emerald-300';
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-xs font-medium transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
    >
      <Icon className='h-6 w-6' />
      <span className='whitespace-nowrap'>{label}</span>
    </button>
  );
}
