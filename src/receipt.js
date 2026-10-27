// Logika nota aksesoris (murni, tanpa DOM) — dipakai aplikasi dan diuji di Node.

export function rp(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + 'Rp ' + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** items: [{ nama, qty, harga }]; diskon: angka; bayar: '' / null (tidak diisi) atau angka. */
export function totals(items, diskon, bayar) {
  const subtotal = items.reduce((s, it) => s + it.qty * it.harga, 0);
  const disc = Math.min(Math.max(Number(diskon) || 0, 0), subtotal);
  const total = subtotal - disc;
  const b = bayar === '' || bayar === null || bayar === undefined || Number.isNaN(Number(bayar)) ? null : Number(bayar);
  return {
    subtotal,
    diskon: disc,
    total,
    bayar: b,
    kembali: b !== null && b >= total ? b - total : 0,
    kurang: b !== null && b < total ? total - b : 0,
  };
}

// Buang karakter yang bisa merusak tag/printer: hanya ASCII, tanpa < > [ ].
const clean = v => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[<>\[\]]/g, ' ')
  .replace(/[^\x20-\x7E]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * @param nota { id, tanggal, jam, nama, nohp, items, subtotal, diskon, total, metode, bayar, kembali, kurang, catatan }
 * @param toko { nama, slogan, alamat, telepon, footer }
 * @param chars karakter per baris (32 = 58 mm, 48 = 80 mm)
 * @returns teks bertag untuk tagsToEscPos() di escpos.js
 */
export function buildReceiptText(nota, toko, chars) {
  const n = chars || 32;
  const eq = '='.repeat(n), sep = '-'.repeat(n);
  const L = [];
  L.push(`[C]<font size='big'><b>${clean(toko.nama) || 'Toko Aksesoris HP'}</b></font>`);
  if (toko.slogan) L.push(`[C]${clean(toko.slogan)}`);
  if (toko.alamat) L.push(`[C]${clean(toko.alamat)}`);
  if (toko.telepon) L.push(`[C]Telp: ${clean(toko.telepon)}`);
  L.push(`[C]${eq}`);
  L.push(`[L]No      : ${clean(nota.id)}`, `[L]Tanggal : ${clean(nota.tanggal)} ${clean(nota.jam)}`, `[L]Nama    : ${clean(nota.nama) || 'Pelanggan Umum'}`);
  if (nota.nohp) L.push(`[L]HP      : ${clean(nota.nohp)}`);
  L.push(`[C]${sep}`);
  nota.items.forEach(it => {
    L.push(`[L]<b>${clean(it.nama)}</b>`);
    L.push(`[L]  ${it.qty} x ${rp(it.harga)} [R]${rp(it.qty * it.harga)}`);
  });
  L.push(`[C]${sep}`);
  const showSub = nota.diskon > 0;
  if (showSub) L.push(`[L]Subtotal [R]${rp(nota.subtotal)}`, `[L]Diskon [R]-${rp(nota.diskon)}`);
  L.push(`[L]<b>TOTAL</b> [R]<b>${rp(nota.total)}</b>`);
  L.push(`[L]Bayar (${clean(nota.metode) || 'Tunai'})${nota.bayar !== null && nota.bayar !== undefined ? ' [R]' + rp(nota.bayar) : ''}`);
  if (nota.kurang > 0) L.push(`[L]<b>Kurang</b> [R]<b>${rp(nota.kurang)}</b>`, '[C]<b>** BELUM LUNAS **</b>');
  else {
    if (nota.bayar !== null && nota.bayar !== undefined && nota.kembali > 0) L.push(`[L]Kembali [R]${rp(nota.kembali)}`);
    L.push('[C]<b>** LUNAS **</b>');
  }
  if (nota.catatan) L.push(`[C]${sep}`, `[L]Catatan: ${clean(nota.catatan)}`);
  L.push(`[C]${eq}`);
  if (toko.footer) L.push(`[C]${clean(toko.footer)}`);
  L.push('[C]Terima Kasih');
  return L.join('\n');
}

// Teks bertag -> teks polos untuk pratinjau di layar (meniru pembungkusan printer).
export function tagsToPlain(text, width) {
  const wrap = t => {
    if (t.length <= width) return [t];
    const out = []; let cur = '';
    t.split(' ').forEach(w => {
      while (w.length > width) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, width)); w = w.slice(width); }
      const next = cur ? cur + ' ' + w : w;
      if (next.length > width) { out.push(cur); cur = w; } else cur = next;
    });
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  return text.split('\n').flatMap(raw => {
    const line = raw.replace(/<[^>]+>/g, '');
    let m;
    if ((m = line.match(/^\[L\](.*?)\s*\[R\](.*)$/))) {
      const l = m[1], r = m[2].trim();
      if (l.length + 1 + r.length <= width) return [l + ' '.repeat(width - l.length - r.length) + r];
      return [...wrap(l), ' '.repeat(Math.max(0, width - r.length)) + r];
    }
    if ((m = line.match(/^\[C\](.*)$/))) return wrap(m[1]).map(t => ' '.repeat(Math.max(0, Math.floor((width - t.length) / 2))) + t);
    if ((m = line.match(/^\[L\](.*)$/))) return wrap(m[1]);
    return [line];
  }).join('\n');
}
