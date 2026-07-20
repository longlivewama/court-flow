'use client';

/**
 * Vanilla-Tilt.js wrapper — pointer/gyro 3D tilt for any child content.
 * Instance is created on mount and destroyed on unmount to avoid leaking
 * listeners across client-side route changes.
 */
import { useEffect, useRef } from 'react';
import type { TiltOptions } from 'vanilla-tilt';

interface TiltWrapperProps {
  options?:   Partial<TiltOptions>;
  className?: string;
  style?:     React.CSSProperties;
  children:   React.ReactNode;
}

export function TiltWrapper({ options, className, style, children }: TiltWrapperProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let cancelled = false;
    import('vanilla-tilt').then(({ default: VanillaTilt }) => {
      if (cancelled || !ref.current) return;
      VanillaTilt.init(ref.current, options);
    });

    return () => {
      cancelled = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).vanillaTilt?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref} className={className} style={{ transformStyle: 'preserve-3d', ...style }}>
      {children}
    </div>
  );
}
