import { Suspense } from 'react';
import { SetPassword } from '@/components/set-password';

export default function Page() {
  return <Suspense><SetPassword mode="invite" /></Suspense>;
}
