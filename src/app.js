import { Capacitor, registerPlugin } from '@capacitor/core';
import { tagsToEscPos, bytesToBase64 } from './escpos.js';
import { rp, totals, buildReceiptText, tagsToPlain } from './receipt.js';

// Plugin native (scripts/native/EscPosPrinterPlugin.java): kirim byte ESC/POS lewat Bluetooth SPP.
const EscPosPrinter = registerPlugin('EscPosPrinter');

// ---------------------------------------------------------------- penyimpanan
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (_) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } },
};
const K = { notas: 'aks_notas', toko: 'aks_toko', counter: 'aks_counter', printer: 'aks_printer', paper: 'aks_paper' };

let notas = store.get(K.notas, []);
let toko = { nama: 'Toko Aksesoris HP', slogan: '', alamat: '', telepon: '', footer: '', ...store.get(K.toko, {}) };
let printerSel = store.get(K.printer, null);        // { name, address }
let paper = store.get(K.paper, '58');
let busy = false;

const $ = id => document.getElementById(id);
const chars = () => (paper === '80' ? 48 : 32);
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = d => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtTime = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// ---------------------------------------------------------------- UI umum
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function loading(on, text) { $('loadingText').textContent = text || 'Memproses...'; $('loading').classList.toggle('active', !!on); }

let modalOnClose = null;
function openModal(title, bodyNode, actions, onClose) {
  $('modalTitle').textContent = title;
  const body = $('modalBody'); body.textContent = ''; if (bodyNode) body.appendChild(bodyNode);
  const act = $('modalActions'); act.textContent = '';
  (actions || []).forEach(a => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn ' + (a.cls || ''); b.textContent = a.label;
    b.addEventListener('click', a.onClick); act.appendChild(b);
  });
  modalOnClose = onClose || null;
  $('modal').classList.add('active');
}
function closeModal() {
  $('modal').classList.remove('active');
  const f = modalOnClose; modalOnClose = null; if (f) f();
}
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });

function confirmBox(text, okLabel = 'Ya', danger = false) {
  return new Promise(resolve => {
    let answer = false;
    const p = document.createElement('p'); p.textContent = text; p.style.lineHeight = '1.5';
    openModal('Konfirmasi', p, [
      { label: okLabel, cls: danger ? 'danger' : '', onClick: () => { answer = true; closeModal(); } },
      { label: 'Batal', cls: 'ghost', onClick: () => closeModal() },
    ], () => resolve(answer));
  });
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'riwayat') renderHistory();
  if (name === 'setelan') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------------------------------------------------------------- form nota
function addRow(data) {
  const d = document.createElement('div'); d.className = 'item';
  d.innerHTML =
    '<input class="i-nama" type="text" list="namaBarang" placeholder="Nama barang (mis. Tempered Glass A12)" autocomplete="off">' +
    '<div class="grid">' +
    '<input class="i-qty" type="number" inputmode="numeric" min="1" step="1" value="1" aria-label="Jumlah">' +
    '<input class="i-harga" type="number" inputmode="numeric" min="0" step="500" placeholder="Harga satuan" aria-label="Harga satuan">' +
    '<div class="i-sub">Rp 0</div>' +
    '<button class="i-del" type="button" aria-label="Hapus barang">✖</button>' +
    '</div>';
  if (data) { d.querySelector('.i-nama').value = data.nama; d.querySelector('.i-qty').value = data.qty; d.querySelector('.i-harga').value = data.harga; }
  d.querySelector('.i-nama').addEventListener('change', e => {      // isi harga terakhir bila barang pernah dijual
    const h = d.querySelector('.i-harga'); const known = lastPrice.get(e.target.value.trim().toLowerCase());
    if (known !== undefined && h.value === '') { h.value = known; recalc(); }
  });
  d.querySelector('.i-del').addEventListener('click', () => { d.remove(); if (!$('items').children.length) addRow(); recalc(); });
  d.addEventListener('input', recalc);
  $('items').appendChild(d);
  return d;
}

function readForm() {
  const rows = [...$('items').querySelectorAll('.item')].map(r => ({
    nama: r.querySelector('.i-nama').value.trim(),
    qtyRaw: r.querySelector('.i-qty').value, hargaRaw: r.querySelector('.i-harga').value,
  }));
  return {
    nama: $('fNama').value.trim(), nohp: $('fHp').value.trim(), rows,
    diskon: $('fDiskon').value, metode: $('fMetode').value,
    bayar: $('fMetode').value === 'Tunai' ? $('fBayar').value : '', catatan: $('fCatatan').value.trim(),
  };
}

// Item yang sudah terisi (nama + harga) untuk ringkasan live; baris kosong diabaikan.
function liveItems(f) {
  return f.rows.filter(r => r.nama && r.hargaRaw !== '').map(r => ({ nama: r.nama, qty: Math.max(1, Math.floor(Number(r.qtyRaw) || 1)), harga: Math.max(0, Number(r.hargaRaw) || 0) }));
}

function recalc() {
  const f = readForm();
  document.querySelectorAll('#items .item').forEach(r => {
    const q = Math.max(1, Math.floor(Number(r.querySelector('.i-qty').value) || 1)), h = Math.max(0, Number(r.querySelector('.i-harga').value) || 0);
    r.querySelector('.i-sub').textContent = rp(q * h);
  });
  const t = totals(liveItems(f), f.diskon, f.bayar);
  $('sSub').textContent = rp(t.subtotal); $('sTotal').textContent = rp(t.total);
  $('rowDisk').style.display = t.diskon > 0 ? '' : 'none'; $('sDisk').textContent = '-' + rp(t.diskon);
  $('bayarWrap').style.display = f.metode === 'Tunai' ? '' : 'none';
  $('rowKembali').style.display = t.bayar !== null && t.kembali > 0 ? '' : 'none'; $('sKembali').textContent = rp(t.kembali);
  $('rowKurang').style.display = t.kurang > 0 ? '' : 'none'; $('sKurang').textContent = rp(t.kurang);
}
['fDiskon', 'fBayar', 'fMetode'].forEach(id => { $(id).addEventListener('input', recalc); $(id).addEventListener('change', recalc); });

// Validasi ketat saat simpan/cetak. Mengembalikan { error } atau { items }.
function validate(f) {
  const items = [];
  for (const [i, r] of f.rows.entries()) {
    const empty = !r.nama && r.hargaRaw === '';
    if (empty) continue;
    const label = `Barang ${i + 1}`;
    if (!r.nama) return { error: `${label}: nama barang belum diisi` };
    const qty = Number(r.qtyRaw), harga = Number(r.hargaRaw);
    if (!Number.isInteger(qty) || qty < 1) return { error: `${label}: jumlah harus bilangan bulat ≥ 1` };
    if (r.hargaRaw === '' || !Number.isFinite(harga) || harga < 0) return { error: `${label}: harga belum diisi` };
    items.push({ nama: r.nama, qty, harga });
  }
  if (!items.length) return { error: 'Tambahkan minimal satu barang' };
  return { items };
}

function nextId(now) {
  const day = String(now.getFullYear()).slice(2) + pad2(now.getMonth() + 1) + pad2(now.getDate());
  const c = store.get(K.counter, { d: '', n: 0 });
  const n = (c.d === day ? c.n : 0) + 1;
  return { id: `AKS-${day}-${String(n).padStart(3, '0')}`, counter: { d: day, n } };
}

function buildNota(f, items, id) {
  const now = new Date(); const t = totals(items, f.diskon, f.bayar);
  return {
    id, ts: now.getTime(), tanggal: fmtDate(now), jam: fmtTime(now),
    nama: f.nama || 'Pelanggan Umum', nohp: f.nohp, items, metode: f.metode, catatan: f.catatan, ...t,
  };
}

function receiptTextOf(nota) { return buildReceiptText(nota, toko, chars()); }

function showPreview(nota, actions) {
  const pre = document.createElement('pre'); pre.className = 'paper';
  pre.textContent = tagsToPlain(receiptTextOf(nota), chars());
  openModal(nota.id.startsWith('PRATINJAU') ? 'Pratinjau Struk' : 'Nota ' + nota.id, pre, actions || [{ label: 'Tutup', cls: 'ghost', onClick: closeModal }]);
}

function resetForm() {
  $('fNama').value = ''; $('fHp').value = ''; $('fDiskon').value = ''; $('fBayar').value = ''; $('fCatatan').value = '';
  $('fMetode').value = 'Tunai'; $('items').textContent = ''; addRow(); recalc();
}

async function saveNota(alsoPrint) {
  if (busy) return;
  busy = true;
  try {
    const f = readForm(), v = validate(f);
    if (v.error) { toast('⚠️ ' + v.error); return; }
    const t = totals(v.items, f.diskon, f.bayar);
    if (Number(f.diskon) > t.subtotal) { toast('⚠️ Diskon melebihi subtotal'); return; }
    if (t.kurang > 0 && !(await confirmBox(`Uang diterima kurang ${rp(t.kurang)}. Tetap simpan sebagai BELUM LUNAS?`, 'Tetap Simpan'))) return;

    const { id, counter } = nextId(new Date());
    const nota = buildNota(f, v.items, id);
    const next = [nota, ...notas];
    if (!store.set(K.notas, next)) { toast('❌ Gagal menyimpan: penyimpanan HP penuh'); return; }
    notas = next; store.set(K.counter, counter); rebuildPriceMemory();
    resetForm();
    if (!alsoPrint) { toast(`✅ Nota ${id} tersimpan`); return; }
    try { await printNota(nota); toast(`✅ Nota ${id} tersimpan & tercetak`); }
    catch (e) { toast(`Nota ${id} tersimpan, tetapi gagal cetak: ${e.message}. Cetak ulang dari Riwayat.`, 7000); }
  } finally { busy = false; }
}

$('btnSavePrint').addEventListener('click', () => saveNota(true));
$('btnSave').addEventListener('click', () => saveNota(false));
$('btnAddItem').addEventListener('click', () => addRow().querySelector('.i-nama').focus());
$('btnReset').addEventListener('click', async () => { if (await confirmBox('Kosongkan semua isian form?', 'Kosongkan', true)) resetForm(); });
$('btnPreview').addEventListener('click', () => {
  const f = readForm(), v = validate(f);
  if (v.error) { toast('⚠️ ' + v.error); return; }
  showPreview(buildNota(f, v.items, 'PRATINJAU'));
});

// Ingatan harga terakhir per nama barang + daftar saran (datalist)
const lastPrice = new Map();
function rebuildPriceMemory() {
  lastPrice.clear();
  const names = new Map();
  for (const n of [...notas].reverse()) for (const it of n.items) { const k = it.nama.toLowerCase(); lastPrice.set(k, it.harga); names.set(k, it.nama); }
  const dl = $('namaBarang'); dl.textContent = '';
  [...names.values()].slice(-300).forEach(nm => { const o = document.createElement('option'); o.value = nm; dl.appendChild(o); });
}

// ---------------------------------------------------------------- printer Bluetooth
const isNative = () => Capacitor.isNativePlatform();

async function ensureBluetoothPermission() {
  try {
    let s = await EscPosPrinter.checkPermissions();
    if (s && s.bluetooth === 'granted') return;
    s = await EscPosPrinter.requestPermissions();
    if (s && s.bluetooth === 'granted') return;
  } catch (e) { console.warn('Izin Bluetooth:', e); }
  if (await confirmBox("Izin “Perangkat sekitar” (Bluetooth) belum diberikan. Buka Pengaturan aplikasi untuk mengaktifkannya?", 'Buka Pengaturan')) {
    try { await EscPosPrinter.openAppSettings(); } catch (_) {}
  }
  throw new Error("izin Bluetooth ditolak — aktifkan 'Perangkat sekitar' di Pengaturan aplikasi");
}

async function listPrinters() {
  if (!isNative()) throw new Error('pilih printer hanya tersedia di aplikasi Android (APK)');
  await ensureBluetoothPermission();
  const r = await EscPosPrinter.listPrinters();
  return (r && r.printers) || [];
}

// Tampilkan printer ter-pairing; kembalikan yang dipilih (atau null bila dibatalkan).
async function pickPrinter() {
  const list = await listPrinters();
  if (!list.length) throw new Error('belum ada perangkat Bluetooth ter-pairing. Pairing printer dulu di Pengaturan Bluetooth HP');
  return new Promise(resolve => {
    let chosen = null;
    const box = document.createElement('div');
    list.forEach(p => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost';
      b.textContent = `🖨️ ${p.name} (${p.address})`;
      b.addEventListener('click', () => { chosen = { name: p.name, address: p.address }; closeModal(); });
      box.appendChild(b);
    });
    openModal('Pilih Printer Bluetooth', box, [{ label: 'Batal', cls: 'ghost', onClick: closeModal }], () => {
      if (chosen) { printerSel = chosen; store.set(K.printer, chosen); renderPrinterBadge(); renderSettings(); }
      resolve(chosen);
    });
  });
}

async function sendToPrinter(bytes) {
  if (!isNative()) throw new Error('cetak Bluetooth hanya tersedia di aplikasi Android (APK). Pratinjau tetap bisa dipakai di sini');
  await ensureBluetoothPermission();
  let p = printerSel;
  if (!p) { p = await pickPrinter(); if (!p) throw new Error('cetak dibatalkan, printer belum dipilih'); }
  loading(true, `Mencetak ke ${p.name}...`);
  try { await EscPosPrinter.print({ type: 'bluetooth', address: p.address, data: bytesToBase64(bytes) }); }
  finally { loading(false); }
}

function printNota(nota) {
  return sendToPrinter(tagsToEscPos(receiptTextOf(nota), { width: chars(), feed: 4 }));
}

function renderPrinterBadge() {
  const b = $('printerBadge');
  b.textContent = printerSel ? `🖨️ ${printerSel.name}` : '🖨️ Printer belum dipilih';
}
$('printerBadge').addEventListener('click', () => showTab('setelan'));

// ---------------------------------------------------------------- riwayat
function sumPeriod(pred) { const l = notas.filter(pred); return `${l.length} nota · ${rp(l.reduce((s, n) => s + n.total, 0))}`; }

function renderHistory() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  $('stHari').textContent = sumPeriod(n => { const t = new Date(n.ts); return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d; });
  $('stBulan').textContent = sumPeriod(n => { const t = new Date(n.ts); return t.getFullYear() === y && t.getMonth() === m; });

  const q = $('fCari').value.trim().toLowerCase();
  const list = notas.filter(n => !q || n.id.toLowerCase().includes(q) || n.nama.toLowerCase().includes(q) || n.items.some(it => it.nama.toLowerCase().includes(q)));
  const box = $('histList'); box.textContent = '';
  if (!list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = notas.length ? 'Tidak ada nota yang cocok.' : 'Belum ada nota. Buat nota pertama di tab Nota Baru.'; box.appendChild(e); return; }
  list.slice(0, 100).forEach(n => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'hist';
    const l1 = document.createElement('div'); l1.className = 'l1';
    const a = document.createElement('span'); a.textContent = n.nama;
    const c = document.createElement('span'); c.textContent = rp(n.total);
    l1.append(a, c);
    const l2 = document.createElement('div'); l2.className = 'l2';
    l2.textContent = `${n.id} · ${n.tanggal} ${n.jam} · ${n.items.reduce((s, it) => s + it.qty, 0)} pcs · ${n.metode}${n.kurang > 0 ? ' · BELUM LUNAS' : ''}`;
    b.append(l1, l2); b.addEventListener('click', () => openDetail(n)); box.appendChild(b);
  });
  if (list.length > 100) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = `Menampilkan 100 dari ${list.length} nota. Gunakan pencarian untuk mempersempit.`; box.appendChild(e); }
}
$('fCari').addEventListener('input', renderHistory);

function openDetail(n) {
  showPreview(n, [
    { label: '🖨️ Cetak Ulang (Bluetooth)', onClick: async () => { closeModal(); try { await printNota(n); toast('✅ Nota tercetak'); } catch (e) { toast('❌ Gagal cetak: ' + e.message, 6000); } } },
    { label: '🗑️ Hapus Nota', cls: 'ghost', onClick: async () => {
      closeModal();
      if (!(await confirmBox(`Hapus nota ${n.id}? Tindakan ini tidak bisa dibatalkan.`, 'Hapus', true))) return;
      const next = notas.filter(x => x.id !== n.id);
      if (store.set(K.notas, next)) { notas = next; rebuildPriceMemory(); renderHistory(); toast('Nota dihapus'); } else toast('❌ Gagal menghapus');
    } },
    { label: 'Tutup', cls: 'ghost', onClick: closeModal },
  ]);
}

// ---------------------------------------------------------------- pengaturan
function renderSettings() {
  $('printerInfo').textContent = printerSel ? `Printer terpilih: ${printerSel.name} (${printerSel.address})` : 'Belum ada printer dipilih.';
  $('fPaper').value = paper;
  $('tNama').value = toko.nama; $('tSlogan').value = toko.slogan; $('tAlamat').value = toko.alamat; $('tTelp').value = toko.telepon; $('tFooter').value = toko.footer;
}

$('btnPickPrinter').addEventListener('click', async () => {
  try { const p = await pickPrinter(); if (p) toast('Printer dipilih: ' + p.name); } catch (e) { toast('❌ ' + e.message, 6000); }
});
$('btnClearPrinter').addEventListener('click', () => { printerSel = null; localStorage.removeItem(K.printer); renderPrinterBadge(); renderSettings(); toast('Pilihan printer dihapus'); });
$('fPaper').addEventListener('change', e => { paper = e.target.value === '80' ? '80' : '58'; store.set(K.paper, paper); toast(`Kertas ${paper} mm`); });
$('btnTestPrint').addEventListener('click', async () => {
  const w = chars();
  const t = ["[C]<font size='big'><b>TES PRINTER</b></font>", `[C]Kertas ${paper} mm`, `[C]${'='.repeat(w)}`, '[L]Rata kiri', '[C]Rata tengah', '[R]Rata kanan', '[L]Kiri [R]Kanan', '[L]<b>Teks tebal</b>', `[C]${'-'.repeat(w)}`, '[C]Jika struk ini rapi, printer siap dipakai'].join('\n');
  try { await sendToPrinter(tagsToEscPos(t, { width: w, feed: 4 })); toast('✅ Tes cetak terkirim'); } catch (e) { toast('❌ Tes cetak gagal: ' + e.message, 6000); }
});
$('btnSaveToko').addEventListener('click', () => {
  toko = { nama: $('tNama').value.trim() || 'Toko Aksesoris HP', slogan: $('tSlogan').value.trim(), alamat: $('tAlamat').value.trim(), telepon: $('tTelp').value.trim(), footer: $('tFooter').value.trim() };
  if (store.set(K.toko, toko)) { $('tokoTitle').textContent = toko.nama; toast('✅ Data toko disimpan'); } else toast('❌ Gagal menyimpan');
});

// ---------------------------------------------------------------- mulai
$('tokoTitle').textContent = toko.nama;
renderPrinterBadge(); rebuildPriceMemory(); addRow(); recalc();
