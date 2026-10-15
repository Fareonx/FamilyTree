import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useI18n } from '../i18n';
import { LangSwitch } from './LangSwitch';

export function AuthScreen({ client, message }: { client: SupabaseClient; message?: string | null }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [info, setInfo] = useState<string | null>(message ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setInfo(null);
    const creds = { email: email.trim().toLowerCase(), password };
    const res =
      mode === 'in'
        ? await client.auth.signInWithPassword(creds)
        : await client.auth.signUp({ ...creds, options: { emailRedirectTo: location.href.split('#')[0] } });
    setBusy(false);
    if (res.error) setInfo(res.error.message);
    else if (mode === 'up' && !res.data.session) setInfo(t('checkEmail'));
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-top">
          <h1>🌳 {t('appTitle')}</h1>
          <LangSwitch />
        </div>
        <p className="muted small">{t('signInHint')}</p>
        <label>
          {t('email')}
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          {t('password')}
          <input
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        </label>
        {info && <p className="notice small">{info}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {mode === 'in' ? t('signIn') : t('signUp')}
        </button>
        <button type="button" className="link-btn" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? t('signUp') : t('signIn')}
        </button>
      </form>
    </div>
  );
}
