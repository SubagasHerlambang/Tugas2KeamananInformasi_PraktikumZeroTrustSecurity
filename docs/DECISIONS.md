# Keputusan Teknis, Asumsi, dan Ekstensi

Label mengikuti PRD: **WAJIB** (dari dokumen tugas dosen), **REKOMENDASI** (PRD/teknis), **ASUMSI** (detail yang tidak diatur tugas), **EKSTENSI** (di luar teks PRD, beserta alasan).
Bila ada konflik, urutan prioritas: dokumen tugas dosen → PRD → keputusan paling aman/sederhana/mudah didemokan (tercatat di sini). Tidak ada keputusan yang melonggarkan persyaratan WAJIB.

## A. Persyaratan WAJIB dan cara pemenuhannya
| Persyaratan | Cara |
|---|---|
| Gateway :3000 PEP terpisah, satu-satunya pintu | Route allowlist + default deny; service tidak mempublikasikan route di luar daftar |
| Access JWT 10 menit; refresh 1 hari di DB & dapat dicabut; token service 5 menit | `ACCESS_TOKEN_TTL=10m`, `REFRESH_TOKEN_TTL=1d`, `SERVICE_TOKEN_TTL=5m` → 600/86400/300 detik; diuji `exp−iat` |
| `X-Gateway-Secret` ditambahkan gateway; service menolak tanpa header; service verifikasi ulang token | Middleware pertama di service; secret + signature + expiry + role diperiksa mandiri |
| Device terdaftar & jam akses 07.00–21.00 dapat dikonfigurasi | `devices` terikat `user_id`; `ACCESS_WINDOW_START/END` |
| Sinkronisasi lewat gateway dengan token service; token user ditolak | `gateway-client.js` memanggil URL **gateway**; policy `transkrip.sinkron` + `requireServiceToken` |
| Audit: waktu, subjek, endpoint, device, hasil, alasan | Tabel `audit_logs` ditulis gateway |

## B. Keputusan desain

**D-01 Stack (REKOMENDASI tugas).** Node.js + Express, `http-proxy-middleware`, `jsonwebtoken`, `fetch` bawaan Node 18+, SQLite via `better-sqlite3` 12.11.1 (binary prebuilt Node 20–24). bcryptjs (JS murni, tanpa kompilasi tambahan) untuk hash password/secret client. Zod 4 untuk validasi; Helmet, `cors`, `express-rate-limit`.

**D-02 Database bersama (WAJIB) dengan satu koneksi per proses.** Satu file SQLite, mode WAL, `busy_timeout=5000`, `foreign_keys=ON`. Migrasi tunggal di `packages/database` agar skema tidak drift. Servis memeriksa tabel `schema_migrations` saat start dan berhenti dengan pesan jelas bila belum dimigrasi.

**D-03 Jam akses (ASUMSI AS-06).** Zona `Asia/Jakarta`; mulai **inklusif**, akhir **eksklusif** (07:00 diizinkan, 20:59:59 diizinkan, 21:00:00 ditolak). Dievaluasi dengan `Intl.DateTimeFormat` (tidak bergantung zona waktu server), dengan clock yang dapat di-mock di test. Jendela yang melewati tengah malam didukung. *Perlu konfirmasi dosen* jika 21:00 tepat dimaksudkan masih diizinkan — cukup ubah `ACCESS_WINDOW_END`.

**D-04 Rentang skor 0–100 (ASUMSI AS-07).** Konstanta tunggal `SCORE_MIN/MAX` (`packages/shared/constants.js`) + `CHECK` di DB. PRD menyebut "range yang dikonfigurasi"; kami **tidak** menjadikannya variabel environment agar validator, DB, dan test tidak bisa saling tidak sinkron. Mengubahnya = ubah konstanta dan migrasi `CHECK`.

**D-05 Refresh token (REKOMENDASI AS-03).** Opaque 384-bit; DB menyimpan hash SHA-256. **Rotasi** saat refresh: token lama dicabut dan token baru dibuat dalam satu transaksi `IMMEDIATE`; token baru **mewarisi expiry mutlak** token awal, sehingga sesi tidak dapat diperpanjang melampaui 1 hari sejak login. Pemakaian ulang token yang sudah dirotasi ditolak (401); *tidak* ada pencabutan massal saat reuse terdeteksi (disederhanakan).

**D-06 Device pada `/auth/refresh`.** Tugas hanya mensyaratkan device untuk login dan request bisnis. Kami menambah pemeriksaan **bila** `X-Device-ID` dikirim (harus cocok dengan device sesi) dan selalu memeriksa bahwa device sesi masih aktif. Klien yang tidak mengirim header tetap dapat me-refresh (kompatibel dengan kontrak PRD/Postman).

**D-07 Urutan kegagalan login.** Username tak dikenal, password salah, dan akun nonaktif → `401 INVALID_CREDENTIALS` generik dengan waktu respons disamakan (hash tiruan). `DEVICE_NOT_REGISTERED` (403) hanya diberikan **setelah** password benar, sehingga status device tidak dapat dipakai untuk mengenumerasi akun.

**D-08 Kebijakan kegagalan audit = fail-closed untuk ALLOW.** Event allow ditulis **sebelum** request diteruskan; bila gagal ditulis → `500 INTERNAL_ERROR` dan request tidak diproses (diuji). Event deny tetap deny; kegagalan menulisnya hanya dicatat ke log runtime. `status_code` baris allow diisi setelah respons hulu (satu-satunya UPDATE yang diizinkan trigger).

**D-09 `/health` tidak diaudit.** Hanya mengembalikan `{status, service}`; tidak diaudit agar polling tidak membanjiri log. Health service mewajibkan `X-Gateway-Secret` (konsisten dengan "service tidak dapat diakses langsung").

**D-10 Gateway tidak mem-parsing body route yang diproxy.** Body di-stream apa adanya ke service (menghindari manipulasi/double-parse); gateway hanya membatasi `Content-Length` (64 kB) dan mengevaluasi policy dari token/path/DB. **Validasi body (skor, payload sinkron, dll.) dilakukan di service** (PRD 5.3 langkah 3); body JSON `/auth/*` divalidasi gateway (batas 16 kB).

**D-11 Device dicek di gateway saja.** Service memeriksa secret, token, role, dan kepemilikan; `X-Device-ID` diteruskan tetapi tidak dipakai ulang di service karena PRD 5.2 langkah 7 tidak mensyaratkannya. Konsekuensi: pelaku yang memegang secret gateway **dan** token user valid dapat melewati cek device bila menembak service langsung. Mitigasi: binding `127.0.0.1`, secret acak, dan service tetap memeriksa token + kepemilikan.

**D-12 Konsistensi finalisasi (jujur: tidak ada transaksi atomik lintas HTTP).** Lihat `docs/architecture.md` §3. Transaksi lokal A (kunci) dan C (commit) di SQLite, upsert idempoten `(grade_id, version)`, status `finalizing`/`sync_failed`, kunci basi dilepas setelah 60 dtk (`FINALIZE_LOCK_TIMEOUT_MS`). Service Nilai menulis `transcript_entries.sync_status='published'` langsung ke DB bersama pada transaksi C (konsekuensi satu DB bersama; alternatif endpoint publish tambahan tidak ada di PRD). Jika proses Service Nilai mati **setelah** sinkron tetapi **sebelum** commit, entri tetap `pending` (tersembunyi) dan nilai `finalizing` → dilepas menjadi `sync_failed` pada percobaan berikutnya setelah kunci basi; finalisasi ulang aman.

**D-13 EKSTENSI: `GET /transkrip` (admin saja, read-only).** UI admin perlu memilih/mencari NIM (instruksi implementasi). Tanpa endpoint ini daftar NIM harus ditanam di frontend (data statis, ditolak). Endpoint hanya mengembalikan `nim`, `full_name`, jumlah entri published; **tidak menambah hak** karena admin memang boleh membaca transkrip seluruh mahasiswa. Role lain → 403.

**D-14 EKSTENSI minor pada data/respons.** Kolom `users.full_name` (tampilan UI); `GET /nilai` menambah `meta.access_window` (agar UI dapat menampilkan jam akses; **keputusan tetap di backend**); `transcript_entries.version` dan `grades.updated_at` (idempotensi dan kunci basi); `audit_logs.status_code`.

**D-15 Kode error.** Selain daftar PRD ditambahkan kode publik `OUT_OF_ACCESS_HOURS` (403), `METHOD_NOT_ALLOWED` (405), `TOO_MANY_REQUESTS` (429). Alasan audit lebih rinci daripada kode publik (mis. `NIM_NOT_OWNED` → publik `FORBIDDEN`).

**D-16 404 vs 403 pada ID asing.** ID nilai/kelas yang **tidak ada** → 404; **milik dosen lain** → 403 `CLASS_NOT_OWNED`. Konsekuensi: dosen dapat membedakan "ID ada tetapi bukan miliknya" dari "ID tidak ada" (ID bukan rahasia; tidak ada data yang bocor). Mahasiswa yang meminta NIM lain selalu 403 (tidak membedakan NIM ada/tidak ada).

**D-17 Penyimpanan token di frontend.** Access dan refresh token **hanya di memori** (hilang saat tab dimuat ulang → login ulang). Tidak ada localStorage/sessionStorage/URL (diuji). Kontrak PRD mengembalikan refresh token di body (bukan cookie HttpOnly); trade-off: lebih mudah diuji dengan Postman, tetapi XSS dapat membaca token di memori. Cookie HttpOnly+SameSite tidak diterapkan karena akan mengubah kontrak PRD dan membutuhkan CSRF handling; didokumentasikan sebagai batasan.

**D-18 Admin/dosen/mahasiswa tanpa hak implisit.** Admin tidak diizinkan `GET /nilai` (tidak ada di Tabel 3) dan tidak dapat edit/finalisasi. Dosen tidak diizinkan membaca transkrip (tidak dinyatakan di tugas → default deny).

**D-19 Binding jaringan.** Semua proses bind ke `127.0.0.1` (bukan `0.0.0.0`) dan URL internal memakai `127.0.0.1` untuk menghindari masalah `localhost`→`::1` di Node lama. `http://localhost:3000` tetap dapat dipakai oleh browser/curl/Postman.

**D-20 Rate limiting.** `express-rate-limit` pada `/auth/*`, 20 percobaan **gagal**/menit/IP (konfigurabel); login sukses tidak dihitung. Store di memori proses gateway.

**D-21 Idempotensi sinkron.** `UNIQUE(grade_id)` + perbandingan `version`; payload diverifikasi terhadap `grades` (kelas, NIM, term, skor, versi harus cocok). Entri `published` tak dapat ditimpa versi lain (409). Header `Idempotency-Key` opsional tetapi bila ada harus konsisten dengan body.

**D-22 Service client.** Hanya `sub=service-nilai` yang diterima policy sinkron; `service_clients.is_active` dicek pada penerbitan token **dan** pada policy sinkron.

**D-23 Kredensial demo.** Password seed `SecureCampus-Demo-2026` dan secret client demo bersifat **tetap, fiktif, dan hanya lokal** supaya README/video dapat diulang; `JWT_SIGNING_SECRET` dan `GATEWAY_SECRET` selalu acak per instalasi dan tidak di-commit. `npm run setup:random` mengacak seluruhnya. *Catatan teknis:* nilai `.env` yang berisi `#` harus dikutip (dotenv memotongnya) — password demo sengaja tidak memakai `#` (bug ini sempat ditemukan lewat skrip curl dan kini diuji di `tests/unit/setup-env.test.js`).

**D-24 Versi dependency.** Zod 4.6.7 dipakai (advisory memori pada 3.x); Vite 8 / Vitest 5 untuk tooling frontend (advisory pada versi lama). `npm audit` lokal: 0 kerentanan pada backend dan frontend per tanggal pengujian (lihat TEST_REPORT). Hasil audit dapat berubah seiring waktu.

## C. Batasan yang diketahui (tidak diperbaiki)
1. **Access JWT tidak dapat dicabut** — logout hanya mencabut refresh token (sesuai tugas/PRD 13.2); jendela risiko ≤ 10 menit. Dibuktikan sebagai perilaku yang diketahui di `tests/security/idor-privilege.test.js`.
2. **JWT HS256 satu secret bersama** gateway+service: service yang dikompromikan dapat menempa token. Alternatif: kunci asimetris (RS256/EdDSA) dengan verifikasi-saja di service.
3. **Device ID bukan atestasi kriptografis**; bisa ditiru bila diketahui (PRD 15.1).
4. **Satu database bersama**: tidak ada isolasi hak DB per service (sesuai tugas).
5. **Tanpa TLS** pada lingkungan lokal.
6. **Tidak ada pencabutan massal saat reuse refresh token** terdeteksi; tidak ada pencabutan sesi saat device/akun dinonaktifkan selain penolakan pada request/refresh berikutnya.
7. **Rate limit per-proses** (memori), tidak terdistribusi.
8. **Frontend** diuji di jsdom (bukan browser sungguhan); desain responsif dasar saja.
9. **Video demo belum direkam** (hanya naskah, `docs/VIDEO_DEMO_SCRIPT.md`).

## D. Pertanyaan terbuka untuk dosen (PRD 20.3) dan default yang dipakai
| Pertanyaan | Default |
|---|---|
| Batas 21.00 inklusif/eksklusif? | Eksklusif (D-03), dapat dikonfigurasi |
| Perlu endpoint/UI registrasi device? | Tidak; device lewat seed (AS-05) |
| Admin perlu akses audit? | Tidak; audit via CLI/DB lokal saja |
| Skala nilai? | 0–100 (D-04) |
| Refresh token wajib dirotasi? | Ya, dirotasi (D-05) |

## E. Kebijakan versi Node (ditambahkan setelah laporan kegagalan instalasi)
**D-25 Node 20+ (disarankan LTS 22).** Versi awal memakai `better-sqlite3` 11.10.0 yang belum punya binary prebuilt untuk Node 24; di Windows tanpa Visual Studio `npm ci` jatuh ke kompilasi `node-gyp` dan gagal. Dinaikkan ke **12.11.1** (engines Node 20–26; rilis resminya memuat binary win32-x64/linux-x64 untuk Node 22 dan 24 — diperiksa dari daftar aset rilis GitHub). Konsekuensi: **Node 18 tidak lagi didukung** (`engines: >=20`). Skrip `preinstall` (`scripts/check-node.js`) menolak Node < 20 dengan pesan jelas dan memberi peringatan untuk Node > 24. better-sqlite3 13.x tidak dipilih karena ketersediaan binary-nya tidak terverifikasi.

