import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="auth-wrap">
        <div className="auth-col">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            { }
            <img src="/logo.png" alt="Nicolas Center Elite" className="auth-logo" />
            <div>
              <div className="auth-name"><span className="blue">Nicolas</span> Center Elite</div>
              <div className="t-label" style={{ marginTop: 6, textAlign: 'center', letterSpacing: '.16em', fontSize: 11 }}>Córdoba · Orizaba, Ver.</div>
            </div>
          </div>
          {children}
        </div>
      </div>
    </ToastProvider>
  );
}
