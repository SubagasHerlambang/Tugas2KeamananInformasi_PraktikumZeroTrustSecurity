# Referensi API SecureCampus

Basis URL lokal: **`http://127.0.0.1:3000`** (gateway). Port 3001/3002 **bukan** alamat klien: service menolak request tanpa `X-Gateway-Secret` + token valid.
Semua body/respons JSON (`Content-Type: application/json`). Setiap respons membawa header `X-Request-ID` (sama dengan `request_id` pada error dan pada audit log).

## Header

| Header | Dipakai pada | Keterangan |
|---|---|---|
| `Authorization: Bearer <token>` | semua endpoint kecuali `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/service`, `/health` | Access token user (10 menit) atau token service (5 menit, hanya `/transkrip/sinkron`) |
| `X-Device-ID: <id>` | `/auth/login` dan semua endpoint bisnis **pengguna** | Harus terdaftar, aktif, dan terikat pada user pemilik token. Format `[A-Za-z0-9._-]{1,64}` |
| `Idempotency-Key: grade:<grade_id>:v<version>` | `/transkrip/sinkron` (opsional) | Bila ada, harus cocok dengan body; dikirim otomatis oleh Service Nilai |
| `X-Gateway-Secret` | hanya gateway → service | **Ditambahkan server.** Nilai kiriman client dibuang gateway |

## Format error

```json
{ "error": { "code": "CLASS_NOT_OWNED", "message": "Kelas ini bukan kelas yang Anda ampu.", "request_id": "req-8e2db7ee-…", "details": [] } }
```
`details` hanya ada bila relevan (validasi: `[{field, message}]` tanpa memantulkan nilai input; 502 finalisasi: `{class_id, retryable, synced_before_failure, total}`). Tidak pernah memuat stack trace, SQL, token, atau secret.

| HTTP | `error.code` | Kapan |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body/param/header salah format, field tak dikenal, JSON rusak, payload terlalu besar |
| 401 | `AUTH_REQUIRED` | Tidak ada `Authorization` |
| 401 | `INVALID_TOKEN` | Malformed, tanda tangan salah, algoritma/issuer/audience salah, claim hilang, role di token ≠ DB, refresh token tak dikenal/dicabut |
| 401 | `TOKEN_EXPIRED` | Access/service/refresh token kedaluwarsa |
| 401 | `INVALID_CREDENTIALS` | Username/password salah, akun nonaktif, client service salah (pesan generik) |
| 403 | `FORBIDDEN` | Role tidak berhak, NIM bukan milik sendiri, akun nonaktif, token service pada endpoint user, secret gateway salah (di service) |
| 403 | `DEVICE_NOT_REGISTERED` | Device hilang/tak dikenal/nonaktif/milik user lain |
| 403 | `CLASS_NOT_OWNED` | Kelas/nilai bukan milik dosen tersebut |
| 403 | `SERVICE_TOKEN_REQUIRED` | Endpoint sinkron dipanggil dengan token user |
| 403 | `OUT_OF_ACCESS_HOURS` | Edit/finalisasi di luar jam akses |
| 404 | `RESOURCE_NOT_FOUND` | Route tak dikenal (default deny), nilai/kelas/NIM tidak ada |
| 405 | `METHOD_NOT_ALLOWED` | Method tidak diizinkan pada route yang dikenal (`Allow` berisi method sah) |
| 409 | `GRADE_FINAL` | Nilai sudah final / kelas sudah final semua |
| 409 | `DUPLICATE_OR_CONFLICT` | Finalisasi sedang berjalan, versi sinkron basi, entri published tak dapat diubah |
| 422 | `BUSINESS_RULE_VIOLATION` | Kelas tidak lengkap (`CLASS_INCOMPLETE`), payload sinkron tidak cocok dengan data nilai |
| 429 | `TOO_MANY_REQUESTS` | Batas percobaan **gagal** pada `/auth/*` terlampaui |
| 500 | `INTERNAL_ERROR` | Kesalahan tak terduga atau audit tidak dapat ditulis (fail-closed); pesan generik |
| 502 | `UPSTREAM_SERVICE_FAILURE` | Service hulu mati/timeout/5xx, atau sinkronisasi transkrip gagal saat finalisasi |

Kode alasan audit (`reason_code`) lebih rinci daripada `error.code`, mis. `NIM_NOT_OWNED`, `ROLE_NOT_ALLOWED`, `ROUTE_NOT_ALLOWED`, `ROLE_MISMATCH`, `REFRESH_TOKEN_REVOKED`, `CLASS_INCOMPLETE`, `FINALIZATION_IN_PROGRESS`.

---

## Autentikasi (ditangani gateway)

### `POST /auth/login`
Header: `X-Device-ID`. Body: `{"username": "mhs.001", "password": "…"}` (field lain ditolak).
Urutan pemeriksaan: validasi body → username+password (bcrypt; waktu disamakan untuk username tak dikenal) → akun aktif → device aktif & terikat ke akun.
```json
200 {
  "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 600,
  "refresh_token": "<opaque>", "refresh_expires_in": 86400,
  "user": { "sub": "USR-MHS-001", "role": "mahasiswa", "nim": "247006110001" }
}
```
Gagal: `401 INVALID_CREDENTIALS` (generik) · `403 DEVICE_NOT_REGISTERED` (hanya setelah password benar) · `400` · `429`.
Claim JWT: `sub`, `role`, `iat`, `exp` (= iat + 600), `iss`, `aud`. Refresh token = 384-bit acak; DB hanya menyimpan hash SHA-256.

### `POST /auth/refresh`
Body: `{"refresh_token": "…"}`. `X-Device-ID` opsional, **bila dikirim harus cocok** dengan device sesi.
`200 {access_token, token_type, expires_in: 600, refresh_token, refresh_expires_in}` — **rotasi**: token lama dicabut atomik, token baru **mewarisi expiry mutlak** (maksimum 1 hari sejak login; tidak diperpanjang).
Gagal: `401` (tak dikenal/dicabut/expired) · `403` (akun/device nonaktif atau device tidak cocok).

### `POST /auth/logout`
Body: `{"refresh_token": "…"}` → `204`. Mencabut refresh token di DB; idempoten (token tak dikenal pun `204`, tanpa oracle). Access token yang sudah terbit tetap berlaku sampai `exp` (maks 10 menit).

### `POST /auth/service`
Body: `{"client_id": "service-nilai", "client_secret": "…"}` → `200 {access_token, token_type, expires_in: 300}`; JWT `{sub: "service-nilai", role: "service"}`. Salah/nonaktif → `401 INVALID_CREDENTIALS`.

---

## Nilai (gateway → Service Nilai :3001)

### `GET /nilai` — mahasiswa, dosen
Mahasiswa: hanya baris dengan `student_id` = subjek token (status internal `finalizing`/`sync_failed` ditampilkan sebagai `draft`). Dosen: hanya kelas yang `lecturer_id` = subjek token. Admin → 403. Query string diabaikan.
```json
200 { "data": [ { "id": "GRD-501-001", "class_id": "CLS-501", "course_code": "IF-501", "course_name": "Keamanan Informasi",
                  "term": "2026-GANJIL", "student_nim": "247006110001", "student_name": "Mahasiswa Satu",
                  "score": 82, "status": "draft", "version": 1, "finalized_at": null } ],
      "meta": { "access_window": { "start": "07:00", "end": "21:00", "timezone": "Asia/Jakarta", "open": true, "server_time": "…Z" } } }
```
`status`: `draft | finalizing | final | sync_failed`.

### `PUT /nilai/:id` — dosen pengampu
Body: `{"score": 85}` — angka 0–100 (string/negatif/>100/NaN/`null`/field tambahan → 400). Aturan (gateway **dan** service): dosen → nilai ada (404) → kelas diampu (403 `CLASS_NOT_OWNED`) → dalam jam akses (403 `OUT_OF_ACCESS_HOURS`) → belum final (409 `GRADE_FINAL`) dan tidak sedang `finalizing` (409). Berhasil: `200 {"data": {…nilai, version naik, status "draft"}}`. Mengedit nilai `sync_failed` mengembalikannya ke `draft`.

### `POST /kelas/:id/finalisasi` — dosen pengampu
Body kosong atau `{}`. Gateway: dosen → kelas ada → diampu → jam akses → nilai lengkap (422 `CLASS_INCOMPLETE`) → masih ada yang belum final (409 `GRADE_FINAL`). Service Nilai mengulang pemeriksaan, lalu:
1. mengunci nilai `draft`/`sync_failed` → `finalizing` (transaksi lokal);
2. memperoleh token service (`POST /auth/service`) dan memanggil **gateway** `POST /transkrip/sinkron` untuk tiap nilai;
3. hanya bila **semua** sinkronisasi sukses → nilai `final` + entri transkrip `published` dalam satu transaksi lokal.
```json
200 { "data": { "class_id": "CLS-501", "status": "final", "transcript_sync": "success",
                "finalized": [ { "grade_id": "GRD-501-001", "student_nim": "247006110001", "score": 85, "version": 2 } ] } }
```
Bila sinkronisasi gagal: `502 UPSTREAM_SERVICE_FAILURE` (`details.retryable = true`), nilai menjadi `sync_failed`, **tidak ada** yang `final`, entri `pending` tidak terlihat; panggil endpoint yang sama lagi untuk mencoba ulang (idempoten, tanpa entri ganda).

---

## Transkrip (gateway → Service Transkrip :3002)

### `GET /transkrip/:nim` — mahasiswa, admin
`:nim` = 8–20 digit. Mahasiswa hanya NIM miliknya (dari DB, diperiksa di gateway dan service), admin semua NIM (NIM tak ada → 404), dosen → 403. Hanya entri **published**.
```json
200 { "data": { "nim": "247006110003", "student_name": "Mahasiswa Tiga",
                "entries": [ { "grade_id": "GRD-501-003", "class_id": "CLS-501", "course_code": "IF-501", "course_name": "Keamanan Informasi",
                               "term": "2026-GANJIL", "score": 90, "synced_at": "…Z" } ] } }
```

### `GET /transkrip` — admin *(ekstensi; DECISIONS D-13)*
`200 {"data": [{"nim", "full_name", "published_entries"}]}` — daftar NIM untuk fitur cari di UI admin. Role lain → 403.

### `POST /transkrip/sinkron` — **hanya token service**
`Authorization: Bearer <token service>` (tanpa `X-Device-ID`). Token user mana pun, walau valid → `403 SERVICE_TOKEN_REQUIRED`; tanpa/rusak/expired → 401. Body (strict):
```json
{ "grade_id": "GRD-501-001", "student_nim": "247006110001", "class_id": "CLS-501", "score": 85, "term": "2026-GANJIL", "version": 2 }
```
Payload diverifikasi terhadap data nilai di DB (kelas, NIM, term, skor, versi harus cocok → 422/409). Upsert **idempoten** berbasis `(grade_id, version)`:
`201` entri `pending` baru · `200` identik/idempoten atau pembaruan entri `pending` dengan versi lebih baru · `409` entri sudah `published` dengan versi lain.

---

## Lain-lain
- `GET /health` (gateway, publik): `{"status":"ok","service":"gateway"}`. Health service (`:3001/:3002/health`) juga mensyaratkan `X-Gateway-Secret`. Health tidak diaudit.
- Route/method di luar tabel ini → `404`/`405` dan dicatat sebagai `deny` (`ROUTE_NOT_ALLOWED` / `METHOD_NOT_ALLOWED`). Path dengan `..`, `%`, `//`, `\`, trailing slash, atau huruf besar tidak cocok allowlist.
- CORS hanya untuk origin pada `CORS_ORIGINS`; header yang diizinkan: `Authorization, Content-Type, X-Device-ID`.
