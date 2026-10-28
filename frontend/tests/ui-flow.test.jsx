// Uji integrasi UI <-> backend NYATA: login, baca data, edit/finalisasi, transkrip, logout, error handling.
import { createRequire } from 'node:module';
import React from 'react';
import { describe, it, expect, inject, afterEach } from 'vitest';
import { render, screen, within, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import { createApiClient } from '../src/api.js';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const stack = inject('stack');
const makeClient = (baseUrl = stack.gateway) => (opts) => createApiClient({ baseUrl, ...opts });

afterEach(() => cleanup());

async function loginUI(user, username, device, password = stack.password, baseUrl) {
  render(<App createClient={makeClient(baseUrl)} />);
  await user.type(screen.getByLabelText('Username'), username);
  await user.type(screen.getByLabelText('Password'), password);
  await user.type(screen.getByLabelText('Device ID terdaftar'), device);
  await user.click(screen.getByRole('button', { name: 'Masuk' }));
}

describe('login', () => {
  it('password salah -> pesan error generik, tetap di halaman login', async () => {
    const user = userEvent.setup();
    await loginUI(user, 'mhs.001', 'DEV-MHS-001', 'salah-total');
    expect(await screen.findByRole('alert')).toHaveTextContent('Username atau password salah.');
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeInTheDocument();
  });

  it('device tidak terdaftar -> ditolak dengan pesan jelas tanpa membocorkan detail sensitif', async () => {
    const user = userEvent.setup();
    await loginUI(user, 'mhs.001', 'DEV-MHS-002');
    expect(await screen.findByRole('alert')).toHaveTextContent('perangkat tidak terdaftar');
    expect(screen.queryByTestId('role-indicator')).toBeNull();
  });

  it('gateway tidak dapat dihubungi -> pesan jaringan', async () => {
    const user = userEvent.setup();
    await loginUI(user, 'mhs.001', 'DEV-MHS-001', stack.password, 'http://127.0.0.1:9');
    expect(await screen.findByRole('alert')).toHaveTextContent('Tidak dapat menghubungi server');
  });
});

describe('alur mahasiswa', () => {
  it('login -> nilai milik sendiri -> tab transkrip (belum ada) -> logout kembali ke login', async () => {
    const user = userEvent.setup();
    await loginUI(user, 'mhs.001', 'DEV-MHS-001');
    expect(await screen.findByTestId('role-indicator')).toHaveTextContent('Mahasiswa');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('IF-501')).toBeInTheDocument();
    expect(within(table).getByText('IF-502')).toBeInTheDocument();
    expect(within(table).getByText('82')).toBeInTheDocument();
    expect(screen.getByText('247006110001')).toBeInTheDocument();
    expect(screen.queryByText('247006110002')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Transkrip saya' }));
    expect(await screen.findByText(/Belum ada nilai final/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Logout' }));
    expect(await screen.findByRole('button', { name: 'Masuk' })).toBeInTheDocument();
    expect(screen.queryByTestId('role-indicator')).toBeNull();
  });
});

describe('alur dosen -> mahasiswa -> admin (edit, finalisasi, transkrip)', () => {
  it('dosen mengedit nilai dan memfinalisasi kelas; hanya kelas sendiri yang tampil', async () => {
    const user = userEvent.setup();
    await loginUI(user, 'dosen.andi', 'DEV-DOSEN-001');
    expect(await screen.findByTestId('role-indicator')).toHaveTextContent('Dosen');
    const card = await screen.findByRole('region', { name: 'Kelas IF-501' });
    expect(screen.queryByRole('region', { name: 'Kelas IF-502' })).toBeNull();
    expect(screen.getByText(/saat ini DIBUKA/)).toBeInTheDocument();

    // nilai final (mhs.003) terkunci di UI
    expect(within(card).getByLabelText('Nilai 247006110003')).toBeDisabled();

    const input = within(card).getByLabelText('Nilai 247006110001');
    await user.clear(input);
    await user.type(input, '101');
    expect(within(card).getAllByText('Isi angka 0–100').length).toBeGreaterThan(0);
    await user.clear(input);
    await user.type(input, '91');
    const row = input.closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Nilai tersimpan.')).toBeInTheDocument();
    await waitFor(() => expect(within(card).getByLabelText('Nilai 247006110001')).toHaveValue(91));

    await user.click(within(card).getByRole('button', { name: 'Finalisasi kelas' }));
    await user.click(await screen.findByRole('button', { name: 'Ya, finalisasi' }));
    expect(await screen.findByText(/berhasil difinalisasi dan tersinkron/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Kelas IF-501' })).getByRole('button', { name: 'Sudah final' })).toBeDisabled());
    expect(within(screen.getByRole('region', { name: 'Kelas IF-501' })).getAllByText('Final').length).toBe(3);
  });

  it('mahasiswa melihat transkrip yang sudah terisi setelah finalisasi', async () => {
    const user = userEvent.setup();
    await loginUI(user, 'mhs.001', 'DEV-MHS-001');
    await screen.findByRole('table');
    await user.click(screen.getByRole('tab', { name: 'Transkrip saya' }));
    const t = await screen.findByRole('region', { name: 'Transkrip 247006110001' });
    expect(within(t).getByText('IF-501')).toBeInTheDocument();
    expect(within(t).getByText('91')).toBeInTheDocument();
    expect(within(t).queryByText('IF-502')).toBeNull(); // kelas IF-502 belum final -> tidak muncul
  });

  it('admin: daftar mahasiswa, buka transkrip NIM mana pun, tanpa kontrol edit nilai', async () => {
    const user = userEvent.setup();
    await loginUI(user, 'admin.demo', 'DEV-ADMIN-001');
    expect(await screen.findByTestId('role-indicator')).toHaveTextContent('Admin');
    expect(await screen.findByText('247006110002')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Simpan' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Finalisasi/ })).toBeNull();

    const rowOf = (nim) => screen.getByText(nim).closest('tr');
    await user.click(within(rowOf('247006110003')).getByRole('button', { name: 'Lihat transkrip' }));
    const t = await screen.findByRole('region', { name: 'Transkrip 247006110003' });
    expect(within(t).getByText('90')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Cari NIM / nama'), '247006119999');
    await user.click(screen.getByRole('button', { name: 'Buka transkrip NIM' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/tidak ditemukan/i);
  });
});

describe('klien API: sesi & token', () => {
  it('access token kedaluwarsa (10 menit) -> refresh otomatis satu kali lalu request diulang', async () => {
    const api = createApiClient({ baseUrl: stack.gateway });
    await api.login('mhs.002', stack.password, 'DEV-MHS-002');
    const oldRefresh = api.session.refreshToken;
    const sub = api.user.sub;
    api.session.accessToken = jwt.sign({ sub, role: 'mahasiswa' }, stack.jwtSecret, { algorithm: 'HS256', issuer: stack.issuer, audience: stack.audience, expiresIn: -30 });
    const grades = await api.getGrades();
    expect(grades.data.every((g) => g.student_nim === '247006110002')).toBe(true);
    expect(api.session.refreshToken).not.toBe(oldRefresh); // rotasi refresh token
  });

  it('token tidak valid -> sesi dihapus dan callback sesi berakhir dipanggil', async () => {
    let expired = false;
    const api = createApiClient({ baseUrl: stack.gateway, onSessionExpired: () => { expired = true; } });
    await api.login('mhs.003', stack.password, 'DEV-MHS-003');
    api.session.accessToken = 'rusak.rusak.rusak';
    await expect(api.getGrades()).rejects.toMatchObject({ status: 401 });
    expect(expired).toBe(true);
    expect(api.session).toBeNull();
  });

  it('akses NIM lain dari klien mahasiswa -> ApiError 403 FORBIDDEN (backend menolak, bukan UI)', async () => {
    const api = createApiClient({ baseUrl: stack.gateway });
    await api.login('mhs.001', stack.password, 'DEV-MHS-001');
    await expect(api.getTranscript('247006110002')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await api.logout();
    await expect(api.getGrades()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('token tidak disimpan di localStorage/sessionStorage', async () => {
    const api = createApiClient({ baseUrl: stack.gateway });
    await api.login('mhs.001', stack.password, 'DEV-MHS-001');
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump).not.toContain(api.session.accessToken);
    expect(dump).not.toContain(api.session.refreshToken);
  });
});
