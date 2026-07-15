import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Design',
};

export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
