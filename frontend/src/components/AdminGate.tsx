'use client';
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AUTH_BACKEND } from '@/lib/auth';
import { disconnectAdminSocket } from '@/hooks/useSocket';
import './admin-auth.css';

const AdminLogoutContext = createContext<{ logout: () => Promise<void>; busy: boolean; error: string } | null>(null);

export function AdminLogoutButton() {
  const auth = useContext(AdminLogoutContext);
  if (!auth) return null;
  return <div className="admin-footer-action">
    <button type="button" className="admin-logout-button" onClick={auth.logout} disabled={auth.busy}>
      {auth.busy ? 'Đang xử lý…' : 'Đăng xuất'}
    </button>
    {auth.error && <p role="alert" className="admin-error">{auth.error}</p>}
  </div>;
}

export default function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const expired = () => { setUser(null); disconnectAdminSocket(); router.replace('/login'); };
    window.addEventListener('admin-session-expired', expired);
    const check = async () => {
      try {
        const response = await fetch(AUTH_BACKEND + '/api/auth/me', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) { if (active) expired(); return; }
        const result = await response.json();
        if (active) setUser(result.data.email);
      } catch { if (active) { setUser(null); setError('Không kết nối được máy chủ. Vui lòng thử lại.'); } }
      finally { if (active) setChecking(false); }
    };
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => { active = false; clearInterval(timer); window.removeEventListener('admin-session-expired', expired); };
  }, [router]);
  useEffect(() => { if (user && pathname === '/login') router.replace('/'); }, [user, pathname, router]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(AUTH_BACKEND + '/api/auth/login', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Đăng nhập thất bại.');
      setUser(result.data.email); router.replace('/');
    } catch (error) { setError(error instanceof Error ? error.message : 'Không kết nối được máy chủ.'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try {
      const response = await fetch(AUTH_BACKEND + '/api/auth/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Không thể đăng xuất. Vui lòng thử lại.');
      setUser(null); disconnectAdminSocket(); router.replace('/login');
    } catch (error) { setError(error instanceof Error ? error.message : 'Không kết nối được máy chủ.'); }
    finally { setBusy(false); }
  }
  if (checking) return <main className="admin-login"><p role="status">Đang kiểm tra phiên đăng nhập…</p></main>;
  if (!user) return <main className="admin-login">
    <section className="admin-card">
      <div className="admin-brand">T</div><p className="admin-eyebrow">TELEVAGA · ADMIN</p>
      <h1>Đăng nhập quản trị</h1><p className="admin-description">Quản lý bot và hội thoại Telegram của bạn.</p>
      <form onSubmit={login}>
        <label htmlFor="admin-email">Email</label><input id="admin-email" name="email" type="email" autoComplete="username" placeholder="Nhập email quản trị" required maxLength={254} disabled={busy} />
        <label htmlFor="admin-password">Mật khẩu</label><input id="admin-password" name="password" type="password" autoComplete="current-password" placeholder="Nhập mật khẩu" required maxLength={256} disabled={busy} />
        {error && <p className="admin-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      </form><p className="admin-note">Chỉ dành cho quản trị viên hệ thống.</p>
    </section>
  </main>;
  return <AdminLogoutContext.Provider value={{ logout, busy, error }}>
    <div className="admin-workspace">{children}</div>
  </AdminLogoutContext.Provider>;
}
