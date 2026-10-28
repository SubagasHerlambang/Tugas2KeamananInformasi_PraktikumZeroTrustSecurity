import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StatusBadge, errorText } from '../components.jsx';

function GradeRow({ grade, onSave, busy }) {
  const [value, setValue] = useState(String(grade.score));
  useEffect(() => { setValue(String(grade.score)); }, [grade.score, grade.version]);
  const locked = grade.status === 'final' || grade.status === 'finalizing';
  const n = Number(value);
  const invalid = value.trim() === '' || Number.isNaN(n) || n < 0 || n > 100;
  return (
    <tr>
      <td>{grade.student_nim}</td>
      <td>{grade.student_name}</td>
      <td className="num">
        <label className="sr-only" htmlFor={`score-${grade.id}`}>Nilai {grade.student_nim}</label>
        <input id={`score-${grade.id}`} className="score-input" type="number" min="0" max="100" step="any" value={value}
          disabled={locked} onChange={(e) => setValue(e.target.value)} aria-invalid={invalid && !locked} aria-describedby={`range-${grade.id}`} />
        <div id={`range-${grade.id}`} className={invalid && !locked ? 'field-error' : 'hint'}>
          {invalid && !locked ? 'Isi angka 0–100' : 'Rentang 0–100'}
        </div>
      </td>
      <td><StatusBadge status={grade.status} /></td>
      <td>
        <button type="button" className="secondary" disabled={locked || invalid || busy || Number(value) === grade.score}
          onClick={() => onSave(grade.id, n)}>Simpan</button>
      </td>
    </tr>
  );
}

export default function LecturerView({ api }) {
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const load = useCallback(async () => {
    try { const r = await api.getGrades(); setRows(r.data); setMeta(r.meta); } catch (e) { setError(e); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const classes = useMemo(() => {
    const map = new Map();
    (rows || []).forEach((g) => {
      if (!map.has(g.class_id)) map.set(g.class_id, { id: g.class_id, code: g.course_code, name: g.course_name, term: g.term, grades: [] });
      map.get(g.class_id).grades.push(g);
    });
    return [...map.values()];
  }, [rows]);

  async function run(fn, okMsg) {
    setBusy(true); setError(null); setNotice('');
    try { await fn(); setNotice(okMsg); } catch (e) { setError(e); } finally { await load(); setBusy(false); setConfirming(null); }
  }
  const save = (id, score) => run(() => api.updateScore(id, score), 'Nilai tersimpan.');
  const finalize = (classId) => run(() => api.finalizeClass(classId), `Kelas ${classId} berhasil difinalisasi dan tersinkron ke transkrip.`);
  const win = meta?.access_window;

  return (
    <div>
      <h2>Dashboard Dosen</h2>
      {win && (
        <p className={win.open ? 'hint' : 'field-error'} aria-live="polite">
          Jam akses ubah/finalisasi nilai: {win.start}–{win.end} ({win.timezone}) — saat ini {win.open ? 'DIBUKA' : 'DITUTUP (server akan menolak perubahan)'}.
        </p>
      )}
      <Alert>{errorText(error)}</Alert>
      <Alert kind="success">{notice}</Alert>
      {rows === null && !error && <p className="muted">Memuat…</p>}
      {classes.map((c) => {
        const finalizable = c.grades.some((g) => g.status === 'draft' || g.status === 'sync_failed');
        return (
          <section className="card" key={c.id} aria-label={`Kelas ${c.code}`}>
            <header className="card-head">
              <div><h3>{c.code} — {c.name}</h3><span className="muted">{c.id} · {c.term} · {c.grades.length} mahasiswa</span></div>
              {confirming === c.id ? (
                <div className="confirm" role="group" aria-label="Konfirmasi finalisasi">
                  <span>Finalisasi kelas ini? Nilai akan dikunci &amp; dikirim ke transkrip.</span>
                  <button type="button" disabled={busy} onClick={() => finalize(c.id)}>Ya, finalisasi</button>
                  <button type="button" className="secondary" onClick={() => setConfirming(null)}>Batal</button>
                </div>
              ) : (
                <button type="button" disabled={busy || !finalizable} onClick={() => setConfirming(c.id)}>
                  {finalizable ? 'Finalisasi kelas' : 'Sudah final'}
                </button>
              )}
            </header>
            <div className="table-wrap">
              <table>
                <thead><tr><th>NIM</th><th>Nama</th><th className="num">Nilai</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>{c.grades.map((g) => <GradeRow key={g.id} grade={g} onSave={save} busy={busy} />)}</tbody>
              </table>
            </div>
          </section>
        );
      })}
      {rows && rows.length === 0 && <p className="muted">Anda belum mengampu kelas.</p>}
    </div>
  );
}
