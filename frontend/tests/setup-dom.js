import { expect } from 'vitest';
// matcher minimal tanpa dependensi tambahan (pengganti jest-dom)
expect.extend({
  toBeDisabled(el) { return { pass: !!el.disabled, message: () => `elemen ${el.disabled ? '' : 'tidak '}disabled` }; },
  toHaveTextContent(el, text) { const c = el.textContent || ''; const ok = text instanceof RegExp ? text.test(c) : c.includes(text); return { pass: ok, message: () => `teks "${c}" ${ok ? 'cocok' : 'tidak memuat'} ${text}` }; },
  toBeInTheDocument(el) { return { pass: !!el && el.ownerDocument.contains(el), message: () => 'elemen tidak ada di dokumen' }; },
  toHaveValue(el, v) { const actual = el.type === 'number' ? Number(el.value) : el.value; return { pass: actual === v, message: () => `nilai ${actual} != ${v}` }; },
});
