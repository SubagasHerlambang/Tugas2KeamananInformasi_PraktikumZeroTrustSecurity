import React, { useEffect, useMemo, useState } from 'react';
import { Alert, TranscriptTable, errorText } from '../components.jsx';

export default function AdminView({ api }) {
  const [directory, setDirectory] = useState(null);
  const [query, setQuery] = useState('');
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.listTranscripts().then(setDirectory).catch(setError); }, [api]);
  const filtered = useMemo(() => (directory || []).filter((s) => `${s.nim} ${s.full_name}`.toLowerCase().includes(query.trim().toLowerCase())), [directory, query]);

  async function open(nim) {
    setError(null); setTranscript(null);
    try { setTranscript(await api.getTranscript(nim)); } catch (e) { setError(e); }
  }

  return (
    <div>
      <h2>Dashboard Admin</h2>
      <p className="muted">Admin dapat membaca transkrip seluruh mahasiswa. Admin tidak memiliki hak mengubah atau memfinalisasi nilai.</p>
      <Alert>{errorText(error)}</Alert>
      <form className="search" onSubmit={(e) => { e.preventDefault(); if (/^\d{8,20}$/.test(query.trim())) open(query.trim()); }}>
        <label htmlFor="nim-search">Cari NIM / nama</label>
        <input id="nim-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="mis. 247006110001" />
        <button type="submit" disabled={!/^\d{8,20}$/.test(query.trim())}>Buka transkrip NIM</button>
      </form>
      {directory === null && !error && <p className="muted">Memuat daftar mahasiswa…</p>}
      {directory && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>NIM</th><th>Nama</th><th className="num">Entri published</th><th>Aksi</th></tr></thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.nim}><td>{s.nim}</td><td>{s.full_name}</td><td className="num">{s.published_entries}</td>
                  <td><button type="button" className="secondary" onClick={() => open(s.nim)}>Lihat transkrip</button></td></tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan="4" className="muted">Tidak ada hasil.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <TranscriptTable transcript={transcript} />
    </div>
  );
}
