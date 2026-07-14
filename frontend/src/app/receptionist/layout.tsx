import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Reception',
};

export default function ReceptionistLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
