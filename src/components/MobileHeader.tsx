'use client';

import Link from 'next/link';

import { BackButton } from './BackButton';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();

  return (
    <header className='surface-glass-strong sticky top-0 z-[650] w-full rounded-b-2xl border-x-0 border-t-0 md:hidden'>
      <div className='flex h-14 items-center justify-between gap-3 px-4'>
        <div className='flex min-w-0 items-center gap-2'>
          {showBackButton && <BackButton />}
          <Link
            href='/'
            className='truncate bg-gradient-to-r from-emerald-700 to-emerald-500 bg-clip-text text-2xl font-black tracking-tight text-transparent transition-opacity hover:opacity-80 dark:from-emerald-300 dark:to-emerald-500'
          >
            {siteName}
          </Link>
        </div>

        <div className='flex shrink-0 items-center gap-2'>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

export default MobileHeader;
