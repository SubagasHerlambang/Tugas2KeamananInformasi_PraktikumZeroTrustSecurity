import React, { useState } from 'react';
import { Alert, errorText } from '../components.jsx';

// Akun demo FIKTIF (lokal saja). Hanya mengisi username & device ID; password tidak pernah ditanam di frontend.
const DEMO = [
  ['mhs.001', 'DEV-MHS-001'], ['mhs.002', 'DEV-MHS-002'], ['mhs.003', 'DEV-MHS-003'],
  ['dosen.andi', 'DEV-DOSEN-001'], ['dosen.bunga', 'DEV-DOSEN-002'], ['admin.demo', 'DEV-ADMIN-001'],
];

export default function Login({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '', deviceId: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await onLogin(form.username.trim(), form.password, form.deviceId.trim()); } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <main className="login-page">
      <form className="card login-card" onSubmit={submit} aria-labelledby="login-title">
        <h1 id="login-title">SecureCampus</h1>
        <p className="muted">Sistem Nilai — Zero Trust Academic System</p>
        <Alert>{errorText(error)}</Alert>
        <label htmlFor="username">Username</label>
        <input id="username" autoComplete="username" value={form.username} onChange={set('username')} required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={form.password} onChange={set('password')} required />
        <label htmlFor="deviceId">Device ID terdaftar</label>
        <input id="deviceId" list="device-list" value={form.deviceId} onChange={set('deviceId')} placeholder="mis. DEV-MHS-001" required />
        <datalist id="device-list">{DEMO.map(([, d]) => <option key={d} value={d} />)}</datalist>
        <button type="submit" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</button>
        <details className="demo">
          <summary>Akun demo (data fiktif, lokal saja)</summary>
          <p className="muted">Pilih akun untuk mengisi username &amp; device ID. Password demo ada di README / hasil <code>npm run setup</code>.</p>
          <div className="chips">
            {DEMO.map(([u, d]) => (
              <button type="button" className="chip" key={u} onClick={() => setForm((f) => ({ ...f, username: u, deviceId: d }))}>{u}</button>
            ))}
          </div>
        </details>
      </form>
    </main>
  );
}
