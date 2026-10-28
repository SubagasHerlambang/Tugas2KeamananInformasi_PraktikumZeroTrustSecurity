'use strict';
// Satu modul waktu untuk seluruh sistem: jam akses (PRD BR-10, FR-CTX-02) + clock yang dapat di-mock.
const systemClock = { now: () => new Date() };

function createFixedClock(initialIso) {
  let current = new Date(initialIso).getTime();
  return {
    now: () => new Date(current),
    set: (iso) => { current = new Date(iso).getTime(); },
    advance: (ms) => { current += ms; },
  };
}

function parseHHMM(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) throw new Error(`Format jam tidak valid: ${value} (gunakan HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) throw new Error(`Jam di luar rentang: ${value}`);
  return h * 60 + min;
}

const formatterCache = new Map();
function minutesOfDayInZone(date, timeZone) {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatterCache.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

/**
 * Mulai INKLUSIF, akhir EKSKLUSIF (07:00 diizinkan, 21:00 ditolak).
 * Detik tidak diabaikan: 20:59:59 -> menit ke-1259 (<1260) diizinkan, 21:00:00 -> 1260 ditolak.
 * Mendukung jendela yang melewati tengah malam (start > end).
 */
function isWithinAccessWindow(date, { start, end, timezone }) {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  const m = minutesOfDayInZone(date, timezone);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

function accessWindowInfo(date, windowCfg) {
  return {
    start: windowCfg.start,
    end: windowCfg.end,
    timezone: windowCfg.timezone,
    open: isWithinAccessWindow(date, windowCfg),
    server_time: date.toISOString(),
  };
}

module.exports = { systemClock, createFixedClock, parseHHMM, isWithinAccessWindow, accessWindowInfo, minutesOfDayInZone };
