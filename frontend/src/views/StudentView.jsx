import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StatusBadge, TranscriptTable, errorText } from '../components.jsx';

export default function StudentView({ api, user }) {
  const [tab, setTab] = useState('nilai');
  const [grades, setGrades] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setGrades((await api.getGrades()).data);
      setTranscript(await api.getTranscript(user.nim)); // NIM berasal dari sesi login, bukan input bebas
    } catch (e) { setError(e); }
  }, [api, user.nim]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <h2>Dashboard Mahasiswa</h2>
      <p className="muted">NIM: <strong>{user.nim}</strong></p>
      <Alert>{errorText(error)}</Alert>
      <div role="tablist" className="tabs">
        <button role="tab" aria-selected={tab === 'nilai'} onClick={() => setTab('nilai')}>Nilai saya</button>
        <button role="tab" aria-selected={tab === 'transkrip'} onClick={() => setTab('transkrip')}>Transkrip saya</button>
      </div>
      {tab === 'nilai' && (
        <section aria-label="Nilai saya">
          {grades === null && !error && <p className="muted">Memuat…</p>}
          {grades && grades.length === 0 && <p className="muted">Belum ada nilai.</p>}
          {grades && grades.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Kode</th><th>Mata kuliah</th><th>Semester</th><th className="num">Nilai</th><th>Status</th></tr></thead>
                <tbody>
                  {grades.map((g) => (
                    <tr key={g.id}><td>{g.course_code}</td><td>{g.course_name}</td><td>{g.term}</td><td className="num">{g.score}</td><td><StatusBadge status={g.status} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === 'transkrip' && <TranscriptTable transcript={transcript} />}
    </div>
  );
}
