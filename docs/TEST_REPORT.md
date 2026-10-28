# Laporan Pengujian SecureCampus

Laporan ini disusun dari **keluaran perintah yang benar-benar dijalankan** (berkas mentah di [`docs/evidence/`](evidence/)). Status memakai definisi: **PASS** = dijalankan dan hasil aktual sesuai harapan · **FAIL** = dijalankan, tidak sesuai · **SKIPPED** = sengaja dilewati oleh test runner · **BLOCKED** = tidak dapat dijalankan karena lingkungan · **BELUM DIUJI** = tidak dijalankan/ditangani. Tidak ada status PASS yang diberikan hanya karena kode "terlihat benar".

- **Tanggal pengujian:** 24 Oktober 2026 (UTC).
- **Lingkungan:** Ubuntu 24.04 (container), Node.js v22.22.2, npm 10.9.7. Satu mesin; tiga proses Node terpisah untuk smoke/curl/Newman.
- **Versi kunci:** Express 4.22.3, http-proxy-middleware 3.0.7, jsonwebtoken 9.0.3, better-sqlite3 12.11.1 (SQLite 3.53.2), bcryptjs 2.4.3, helmet 7.2.0, express-rate-limit 7.5.1, zod 4.6.7 · frontend: React 18.3.1, Vite 8.3.5, Vitest 5.0.5, jsdom 30.1.3 · Newman 6.2.3.

## 1. Ringkasan hasil

| # | Perintah / metode | Cakupan | PASS | FAIL | SKIPPED | Bukti |
|---|---|---|---|---|---|---|
| 1 | `npm run test:unit` | helper token, password, device, policy, jam akses, validator, idempotensi, DB, setup-env, check-node | **72** | 0 | 0 | `evidence/backend-unit-output.txt` |
| 2 | `npm run test:integration` | endpoint melalui gateway (auth, nilai, finalisasi, transkrip/sinkron, audit) | **71** | 0 | 0 | `evidence/backend-integration-output.txt` |
| 3 | `npm run test:security` | bypass gateway, route abuse, injeksi, IDOR/eskalasi, rate limit | **27** | 0 | 0 | `evidence/backend-security-output.txt` |
| — | **`npm test`** (1+2+3) | seluruh backend | **170** | 0 | 0 | `evidence/backend-all-tap.txt` |
| 4 | `npm run test:frontend` (Vitest + jsdom → backend **nyata**) | login, baca data, edit/finalisasi, transkrip, logout, error, sesi/token | **11** | 0 | 0 | `evidence/frontend-test-output.txt` |
| 5 | `npm run frontend:build` | build produksi Vite | berhasil (156 kB JS) | — | — | terminal; `evidence/frontend-test-output.txt` |
| 6 | `npm run smoke` — **3 proses Node terpisah** pada port nyata 3000/3001/3002 + frontend preview :4173 | wiring port, direct-service, alur role, audit, CORS | **27** | 0 | 0 | `evidence/smoke-output.txt` |
| 7 | `tests/curl/scenarios.sh` terhadap stack nyata (`npm start`) | skenario positif/negatif via curl | **32** | 0 | 0 | `evidence/curl-output.txt` |
| 8 | Newman 6.2.3 menjalankan koleksi Postman terhadap stack nyata | 46 request, 69 assertion | **69 assertion** | 0 | 0 | `evidence/newman-output.txt` |
| 9 | `npm audit` (backend prod; frontend lengkap) | kerentanan dependency | 0 temuan / 0 temuan | — | — | `evidence/npm-audit-output.txt` |
| 10 | Mengikuti README dari **salinan bersih** (tanpa node_modules/.env/DB) | `npm ci` → `npm run setup` → `npm test` → `frontend:install` → `test:frontend` → `frontend:build` → `smoke` → `npm start` + login akun README | semua langkah berhasil (170 + 11 + 27 PASS); diulang setelah upgrade `better-sqlite3` | 0 | 0 | dijalankan di `/tmp/clean`; keluaran dilampirkan di atas |
| 11 | Prosedur README §10 (jendela jam akses sempit via `.env`, proses nyata) | PUT dan finalisasi → 403 `OUT_OF_ACCESS_HOURS`, `meta.access_window.open=false`, 2 baris audit deny | **PASS** | 0 | 0 | dijalankan di `/tmp/clean` |

Jumlah per berkas test (hasil aktual): unit — check-node 3, database 14, idempotency 6, policy 15, security-helpers 6, setup-env 3, time 7, tokens 11, validators 7 · integrasi — audit 8, auth 16, finalization 14, grades 16, transcripts-sync 17 · keamanan — gateway-bypass 11, idor-privilege 7, rate-limit 1, routes-injection 8.

Catatan metode: test integrasi/keamanan menjalankan gateway + Service Nilai + Service Transkrip sebagai **server HTTP nyata** pada port acak di atas **satu file SQLite sementara** (`tests/helpers/harness.js`); database demo di `./data` tidak pernah dipakai. Batas jam akses diuji dengan clock terkontrol (`createFixedClock`). Token kedaluwarsa/claim hilang dibuat dengan menandatangani JWT secara langsung dengan secret test.

## 2. Pemetaan 18 skenario wajib (instruksi implementasi)

| # | Skenario | Berkas test utama | Hasil |
|---|---|---|---|
| 1 | Login 3 role, password salah, user nonaktif, device unknown, device user lain | `integration/auth.test.js` (TC-AUTH-01..04, "akun nonaktif dan device nonaktif") | PASS |
| 2 | Token valid/malformed/expired/signature salah/claim hilang tidak menjalankan operasi | `integration/auth.test.js` (TC-AUTH-05), `unit/tokens.test.js`, `security/gateway-bypass.test.js` | PASS |
| 3 | Refresh sukses; expired/revoked ditolak; logout revoke | `integration/auth.test.js` (refresh, TC-AUTH-06, refresh kedaluwarsa via clock) | PASS |
| 4 | Token service role=service, 300 dtk; secret salah ditolak | `auth.test.js` (TC-SVC-01/02), `unit/tokens.test.js` | PASS |
| 5 | Mahasiswa: nilai sendiri; data mahasiswa lain ditolak | `integration/grades.test.js` (TC-VAL-01/02), `security/idor-privilege.test.js` | PASS |
| 6 | Dosen: kelas sendiri; kelas lain ditolak; edit valid; skor invalid; edit final ditolak | `grades.test.js` (TC-VAL-03..06, TC-IN-01) | PASS |
| 7 | Edit **dan** finalisasi sebelum/di dalam/pada batas akhir/sesudah jam akses | `grades.test.js` (TC-VAL-07: 06:59, 07:00, 20:59, 21:00, 21:01), `finalization.test.js` (06:59, 21:00, 21:01 → 403; 07:00 → 200), `unit/time.test.js` | PASS |
| 8 | Finalisasi kelas sendiri sukses hanya jika semua sinkron berhasil; kelas asing & luar jam ditolak | `finalization.test.js` (TC-FIN-01/02, partial failure) | PASS |
| 9 | Service Transkrip mati / sync gagal: tidak sukses, pending tersembunyi, tercatat, retry idempoten | `finalization.test.js` (TC-FIN-03/04, kegagalan parsial, edit setelah sync_failed), `unit/idempotency.test.js` | PASS |
| 10 | Transkrip sendiri; NIM lain ditolak; admin semua NIM | `transcripts-sync.test.js` (TC-TR-01..03) | PASS |
| 11 | Token user ditolak di `/transkrip/sinkron` walau valid; hanya token service | `transcripts-sync.test.js` (TC-TR-04), `unit/policy.test.js`, `security/gateway-bypass.test.js` | PASS |
| 12 | Direct 3001/3002 tanpa secret/secret salah/secret benar + JWT invalid ditolak | `security/gateway-bypass.test.js` (TC-GW-01/02), `scripts/smoke.js` (proses nyata) | PASS |
| 13 | Route tak terdaftar tidak diproxy; traversal/method tak diizinkan tidak bypass | `security/routes-injection.test.js` (TC-GW-03), `unit/policy.test.js` (route table) | PASS |
| 14 | Audit allow & deny berisi field wajib; tanpa credential/token/secret | `integration/audit.test.js` (TC-LOG-01/02), `smoke.js` | PASS |
| 15 | Seed count/relasi minimum; sync ganda tidak membuat entri ganda | `unit/database.test.js`, `unit/idempotency.test.js`, `transcripts-sync.test.js` | PASS |
| 16 | Error konsisten tanpa stack trace; tidak ada SQL injection/bypass | `audit.test.js` (NFR-SEC-04), `security/routes-injection.test.js` (TC-IN-02) | PASS |
| 17 | Frontend: login per role, lewat gateway, tampilan role-spesifik, error, logout, edit & finalisasi | `frontend/tests/ui-flow.test.jsx` (11 test) | PASS (jsdom; lihat §5) |
| 18 | Smoke startup tiga service + frontend, port & health | `scripts/smoke.js` | PASS |

## 3. Pemetaan ID test PRD (bab 17)

| ID | Status | Bukti |
|---|---|---|
| TC-AUTH-01 … 06 | PASS | `auth.test.js`; curl; Newman; smoke |
| TC-SVC-01, 02 | PASS | `auth.test.js`; curl; Newman |
| TC-VAL-01 … 07 | PASS | `grades.test.js`, `unit/policy.test.js`, `unit/time.test.js` |
| TC-FIN-01 … 04 | PASS | `finalization.test.js`, `unit/idempotency.test.js` |
| TC-TR-01 … 04 | PASS | `transcripts-sync.test.js` |
| TC-GW-01 … 03 | PASS | `security/gateway-bypass.test.js`, `security/routes-injection.test.js` |
| TC-LOG-01, 02 | PASS | `audit.test.js` (TC-LOG-01 pada judul test pertama; TC-LOG-02 pada test "tidak ada password, token…") |
| TC-IN-01, 02 | PASS | `grades.test.js`, `unit/validators.test.js`, `routes-injection.test.js` |

## 4. Acceptance criteria PRD (bab 16)

| AC | Status | Catatan bukti |
|---|---|---|
| AC-01 tiga proses + DB bersama | PASS | `smoke.js` memulai 3 proses terpisah dan memeriksa health + port |
| AC-02 seed minimum | PASS | `unit/database.test.js`; `npm run db:summary` |
| AC-03 login hanya kredensial + device valid | PASS | `auth.test.js` |
| AC-04 JWT sub/role, exp 600 dtk, invalid ditolak | PASS | `unit/tokens.test.js`, `auth.test.js` |
| AC-05 refresh 1 hari, hash di DB, revoke saat logout | PASS | `auth.test.js` (cek `expires_at−created_at = 86400 s`, token mentah tidak ada di DB) |
| AC-06 token service 5 menit role service | PASS | `auth.test.js`, Newman |
| AC-07 tanpa token/device ditolak sebelum diproses | PASS | `auth.test.js`, `idor-privilege.test.js` |
| AC-08 mahasiswa hanya data sendiri | PASS | `grades.test.js`, `transcripts-sync.test.js`, `idor-privilege.test.js` |
| AC-09 dosen hanya kelasnya; final tak dapat diedit | PASS | `grades.test.js`, `idor-privilege.test.js` |
| AC-10 edit/finalisasi hanya dalam jam akses | PASS | `grades.test.js`, `finalization.test.js`, prosedur README §10 |
| AC-11 gateway entry point + `X-Gateway-Secret` oleh server | PASS | `gateway-bypass.test.js` (secret kiriman client dibuang); inspeksi `proxy/service-proxy.js` |
| AC-12 service menolak tanpa/salah secret atau token tak valid | PASS | `gateway-bypass.test.js`, `smoke.js` |
| AC-13 sinkron lewat gateway + token service; token user ditolak | PASS | `finalization.test.js` (audit `subject_type=service` ke `/auth/service` & `/transkrip/sinkron`), `transcripts-sync.test.js` |
| AC-14 published tersedia, pending tersembunyi, retry tanpa duplikasi | PASS | `finalization.test.js`, `unit/idempotency.test.js` |
| AC-15 audit field lengkap | PASS | `audit.test.js` |
| AC-16 error konsisten, tanpa kebocoran | PASS | `audit.test.js`, `routes-injection.test.js` *(terbatas pada respons yang diuji)* |
| AC-17 README dapat diikuti | PASS | Diikuti dari salinan bersih (baris 10 §1). Belum diuji di Windows/macOS |
| **AC-18 video demo 6–9 menit** | **BELUM DIKERJAKAN** | Hanya **naskah** (`docs/VIDEO_DEMO_SCRIPT.md`); video tidak dapat direkam di lingkungan ini |

## 5. Tidak dijalankan / BLOCKED / keterbatasan verifikasi

| Item | Status | Alasan spesifik |
|---|---|---|
| Video demo | BELUM DIKERJAKAN | Tidak ada perekaman layar/suara di lingkungan ini; naskah disediakan |
| Pengujian UI di **browser sungguhan** (Chromium/Firefox, Playwright) | BELUM DIUJI (kemungkinan BLOCKED) | Tidak dicoba: unduhan binary browser kemungkinan berada di luar domain yang diizinkan jaringan sandbox (hanya registry npm, GitHub, dll.). UI diuji dengan jsdom + Testing Library terhadap backend nyata, sehingga **tata letak visual, fokus keyboard nyata, responsivitas, dan CORS dari browser tidak diverifikasi**; CORS diverifikasi pada level HTTP (preflight dengan `fetch`) |
| `npm run frontend:dev` (dev server Vite) | BELUM DIUJI sebagai proses interaktif | Build produksi + `vite preview` diverifikasi (smoke); dev server tidak dijalankan terpisah |
| Render diagram Mermaid → gambar | BELUM DIKERJAKAN | Butuh browser (mermaid-cli); diagram ada sebagai teks Mermaid di README & `docs/architecture.md` — sintaks tidak divalidasi oleh renderer di lingkungan ini |
| Windows / macOS | BELUM DIUJI | Hanya Linux. **Pengguna melaporkan `npm ci` gagal di Windows + Node 24** (lihat §6 temuan 5). Perbaikan (`better-sqlite3` 12.11.1) diverifikasi di Linux/Node 22 dan keberadaan binary prebuilt win32-x64 untuk Node 22 & 24 dipastikan dari daftar aset rilis GitHub, tetapi **instalasi di Windows belum saya jalankan sendiri** — konfirmasi dari pengguna diperlukan |
| Koleksi Postman dengan aplikasi Postman (GUI) | BELUM DIUJI | Dijalankan dengan Newman (runner resmi Postman CLI); impor ke GUI Postman tidak diuji |
| Docker / Docker Compose | TIDAK DISEDIAKAN | Opsional menurut tugas |
| Uji beban/kinerja, penetration test formal | BELUM DIUJI | Di luar cakupan tugas (NFR-PERF-01 tanpa target formal). Newman mengamati rata-rata respons ±10 ms pada mesin uji — bukan kriteria kelulusan |
| Lint/typecheck | TIDAK ADA | Sengaja tidak menambah konfigurasi lint yang tidak berfungsi; build Vite dan seluruh test dijalankan |
| Crash proses di tengah finalisasi (kill -9 antara sinkron dan commit) | DIUJI SEBAGIAN | Disimulasikan lewat status `finalizing` basi di DB (`finalization.test.js`), bukan dengan mematikan proses sungguhan |

## 6. Temuan selama pengujian (cacat produk vs kesalahan test)

**Cacat produk/konfigurasi yang ditemukan dan sudah diperbaiki:**
1. **`.env` memotong password demo di karakter `#`** (dotenv menganggap `#` tak berkutip sebagai komentar): password seed menjadi `SecureCampus`, bukan yang tertulis di README. Ditemukan oleh skrip curl terhadap proses nyata (test lain memberi env langsung sehingga tidak menangkapnya). Perbaikan: password demo tanpa `#`, peringatan di `.env.example`, dan test baru `unit/setup-env.test.js` (parse dengan dotenv + `loadConfig`).
2. **Script `npm test` memakai `node --test tests/unit` (folder)** yang gagal pada Node 22; diganti pola glob.
3. **Advisory dependency:** zod 3.x (memori pada koleksi besar) → zod 4.6.7; tooling frontend lama (esbuild/vitest) → Vite 8 / Vitest 5; hasil `npm audit` kini 0/0. Pemakaian zod kami sebelumnya tidak memakai koleksi terbatas sehingga tidak dapat dieksploitasi, tetapi tetap diperbarui.
4. **Derau `code.charCodeAt is not a function`** (interaksi validasi `creationStack` express-rate-limit dengan stack-trace Vite di proses Vitest); exit code tetap 0, namun validasi itu dimatikan (limiter dibuat sekali saat startup) sehingga keluaran bersih.
5. **Instalasi gagal di Windows + Node 24 (dilaporkan pengguna).** Log: `prebuild-install warn install No prebuilt binaries found (target=24.13.0 ... platform=win32)`, lalu `node-gyp` gagal karena tidak ada Visual Studio. Penyebab: `better-sqlite3` 11.10.0 belum menyediakan binary untuk Node 24 — **lolos dari semua pengujian saya karena seluruhnya dijalankan di Node 22 (Linux)**, kelalaian verifikasi lintas-versi/OS. Perbaikan: naik ke 12.11.1 (Node 20–26), `engines >=20`, skrip `preinstall` (`scripts/check-node.js` + 3 unit test) yang memberi pesan jelas, dan baris troubleshooting README untuk galat ini serta peringatan `EPERM` saat membersihkan `node_modules` di Windows. Seluruh pengujian dijalankan ulang (170 + 11 + 27, audit 0).
6. **Pengecekan jam akses finalisasi pada 21:01** dan **unit test idempotensi** ditambahkan setelah audit kelengkapan terhadap daftar skenario wajib.

**Kesalahan pada test/skrip (bukan cacat produk) yang dikoreksi:** ekspektasi `sanitizeDeviceId` salah (karakter `-` memang diizinkan); regex deteksi stack trace `/at /` cocok dengan kata "dapat"; hitungan alasan audit tidak memasukkan `INVALID_TOKEN_CLAIMS`; membaca transkrip saat Service Transkrip sengaja dimatikan; kasus header dengan spasi di depan (parser HTTP membuang whitespace awal — bukan celah); `local` bash yang meng-ekspansi variabel sebelum assignment; `spawnSync` memblokir event loop server in-process (deadlock saat menjalankan Newman). Semua dijalankan ulang sampai hasil di §1.

## 7. Cara mengulang
```bash
npm ci && npm run setup                 # sekali
npm test                                # 170 test backend
npm run frontend:install && npm run test:frontend && npm run frontend:build
npm run smoke                           # port 3000-3002 harus bebas
npm start &                             # lalu, di terminal lain:
./tests/curl/scenarios.sh               # 32 pemeriksaan (mengubah data demo -> npm run db:reset sesudahnya)
npx newman run tests/postman/SecureCampus.postman_collection.json -e tests/postman/SecureCampus.postman_environment.json \
  --env-var demoPassword='SecureCampus-Demo-2026' --env-var serviceClientSecret=service-nilai-demo-secret-local
```
Untuk Newman, jalankan folder koleksi pada DB yang bersih (`npm run db:reset` lalu restart service). Bukti Newman pada laporan ini diperoleh dengan menjalankan koleksi terhadap stack nyata pada port acak (harness) dengan jam server 12:00 WIB.
