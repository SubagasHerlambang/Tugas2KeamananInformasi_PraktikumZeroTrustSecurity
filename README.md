# Nama : Subagas Herlambang
# NPM : 247006111100
# sKelas : C


# SecureCampus — Zero Trust Academic System

Sistem nilai akademik dengan API Gateway sebagai Policy Enforcement Point (tugas praktikum Zero Trust Security, KP70065004). Semua data adalah **data demo fiktif untuk lokal**.

| Komponen | Port |
|---|---|
| API Gateway (satu-satunya pintu masuk) | 3000 |
| Service Nilai | 3001 |
| Service Transkrip | 3002 |
| Frontend (opsional) | 5173 |

## Prasyarat
- Node.js 20–24 (disarankan 22 LTS) dan npm. Cek dengan `node -v`.
- Port 3000, 3001, dan 3002 harus bebas.

## Cara menjalankan
```bash
npm ci          # pasang dependency
npm run setup   # buat .env, database, dan data awal (seed)
npm start       # jalankan gateway :3000, nilai :3001, transkrip :3002
```
Cek di browser: http://127.0.0.1:3000/health → `{"status":"ok","service":"gateway"}`. Hentikan dengan `Ctrl+C`.

Frontend (opsional, di terminal baru):
```bash
npm run frontend:install   # sekali saja
npm run frontend:dev       # buka http://127.0.0.1:5173
```

Mengembalikan data awal: hentikan `npm start`, jalankan `npm run db:reset`, lalu `npm start` lagi.

## Akun dan device ID data awal
Password semua akun: `SecureCampus-Demo-2026` (demo lokal saja, dibuat oleh `npm run setup`).
Login wajib menyertakan `X-Device-ID` yang sesuai tabel. Di UI, isi kolom "Device ID".

| Username | Role | NIM | Device ID | Keterangan |
|---|---|---|---|---|
| `admin.demo` | admin | — | `DEV-ADMIN-001` | Baca transkrip semua mahasiswa |
| `dosen.andi` | dosen | — | `DEV-DOSEN-001` | Mengampu IF-501 (`CLS-501`) |
| `dosen.bunga` | dosen | — | `DEV-DOSEN-002` | Mengampu IF-502 (`CLS-502`) |
| `mhs.001` | mahasiswa | 247006110001 | `DEV-MHS-001` | Terdaftar di IF-501 dan IF-502 |
| `mhs.002` | mahasiswa | 247006110002 | `DEV-MHS-002` | Terdaftar di IF-501 dan IF-502 |
| `mhs.003` | mahasiswa | 247006110003 | `DEV-MHS-003` | Terdaftar di IF-501 dan IF-502 |

Client Service Nilai (untuk `POST /auth/service`): `client_id` = `service-nilai`, `client_secret` = `service-nilai-demo-secret-local`.

Nilai awal: `CLS-501` → mhs.001 = 82 (draft), mhs.002 = 76 (draft), mhs.003 = 90 (final). `CLS-502` → mhs.001 = 88, mhs.002 = 80, mhs.003 = 85 (semua draft).

## Pengujian
```bash
npm test                                              # test backend
npm run frontend:install && npm run test:frontend     # test frontend
npm run smoke                                         # hentikan npm start dulu (port yang sama)
```
Postman: impor file di `tests/postman/`, lalu isi variabel `demoPassword` dan `serviceClientSecret` dengan nilai di atas.

## Jika bermasalah
- **`npm ci` meminta Visual Studio / "No prebuilt binaries"**: pakai Node 20–24, hapus folder `node_modules`, lalu ulangi `npm ci`.
- **Port sudah dipakai**: tutup `npm start` yang lama atau program lain di port 3000–3002.
- **Login "device tidak terdaftar"**: pasangan username dan device ID harus sesuai tabel.
- **Edit nilai ditolak "di luar jam akses"**: jam akses 07.00–21.00 WIB. Ubah `ACCESS_WINDOW_START` dan `ACCESS_WINDOW_END` di `.env`, lalu jalankan ulang `npm start`.

Dokumentasi lanjutan: `docs/api.md`, `docs/architecture.md`, `docs/DECISIONS.md`, `docs/TEST_REPORT.md`.