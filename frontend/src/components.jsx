import React from 'react';

export const ROLE_LABEL = { mahasiswa: 'Mahasiswa', dosen: 'Dosen', admin: 'Admin' };

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

// Status ditampilkan sebagai TEKS (tidak hanya warna).
const STATUS_TEXT = { draft: 'Draft', final: 'Final', finalizing: 'Sedang difinalisasi', sync_failed: 'Sinkron gagal (dapat diulang)' };
export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_TEXT[status] || status}</span>;
}

export function errorText(err) {
  if (!err) return '';
  const rid = err.requestId ? ` (ID: ${err.requestId})` : '';
  switch (err.code) {
    case 'OUT_OF_ACCESS_HOURS': return `Ditolak: di luar jam akses perubahan/finalisasi nilai.${rid}`;
    case 'GRADE_FINAL': return `Ditolak: nilai sudah final dan tidak dapat diubah.${rid}`;
    case 'CLASS_NOT_OWNED': return `Ditolak: kelas ini bukan kelas yang Anda ampu.${rid}`;
    case 'DEVICE_NOT_REGISTERED': return `Ditolak: perangkat tidak terdaftar untuk akun ini.${rid}`;
    case 'UPSTREAM_SERVICE_FAILURE': return `Sinkronisasi transkrip gagal; finalisasi BELUM selesai. Silakan coba lagi.${rid}`;
    case 'INVALID_CREDENTIALS': return 'Username atau password salah.';
    case 'TOO_MANY_REQUESTS': return 'Terlalu banyak percobaan. Coba lagi beberapa saat.';
    case 'NETWORK_ERROR': return err.message;
    default: return `${err.message}${rid}`;
  }
}

export function TranscriptTable({ transcript }) {
  if (!transcript) return null;
  return (
    <section aria-label={`Transkrip ${transcript.nim}`}>
      <h3>Transkrip — {transcript.student_name} <small>({transcript.nim})</small></h3>
      {transcript.entries.length === 0 ? (
        <p className="muted">Belum ada nilai final yang masuk ke transkrip.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Kode</th><th>Mata kuliah</th><th>Semester</th><th className="num">Nilai</th></tr></thead>
            <tbody>
              {transcript.entries.map((e) => (
                <tr key={e.grade_id}><td>{e.course_code}</td><td>{e.course_name}</td><td>{e.term}</td><td className="num">{e.score}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
