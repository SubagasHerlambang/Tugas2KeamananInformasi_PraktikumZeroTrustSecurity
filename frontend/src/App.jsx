import React, { useMemo, useState } from "react";
import { ROLE_LABEL } from "./components.jsx";
import Login from "./views/Login.jsx";
import StudentView from "./views/StudentView.jsx";
import LecturerView from "./views/LecturerView.jsx";
import AdminView from "./views/AdminView.jsx";

// Catatan keamanan: pemilihan tampilan per role hanyalah UX. Hak akses SEBENARNYA diputuskan gateway + service;
// menyembunyikan tombol di sini tidak dianggap sebagai kontrol akses.
export default function App({ createClient }) {
  const [user, setUser] = useState(null);
  const [expired, setExpired] = useState(false);
  const api = useMemo(
    () =>
      createClient({
        onSessionExpired: () => {
          setUser(null);
          setExpired(true);
        },
      }),
    [createClient],
  );

  async function login(username, password, deviceId) {
    const u = await api.login(username, password, deviceId);
    setExpired(false);
    setUser(u);
  }
  async function logout() {
    await api.logout();
    setUser(null);
  }

  if (!user) {
    return (
      <>
        {expired && (
          <div className="alert alert-error" role="alert">
            Sesi berakhir. Silakan login kembali.
          </div>
        )}
        <Login onLogin={login} />
      </>
    );
  }
  return (
    <div className="app">
      <header className="topbar">
        <strong>SecureCampus</strong>
        <span className="role-pill" data-testid="role-indicator">
          {ROLE_LABEL[user.role]}
        </span>
        <span className="spacer" />
        <button type="button" className="secondary" onClick={logout}>
          Logout
        </button>
      </header>
      <main className="content">
        {user.role === "mahasiswa" && <StudentView api={api} user={user} />}
        {user.role === "dosen" && <LecturerView api={api} />}
        {user.role === "admin" && <AdminView api={api} />}
      </main>
    </div>
  );
}
