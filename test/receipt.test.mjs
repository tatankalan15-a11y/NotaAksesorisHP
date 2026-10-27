import assert from 'node:assert/strict';
import { rp, totals, buildReceiptText, tagsToPlain } from '../src/receipt.js';
import { tagsToEscPos, bytesToBase64 } from '../src/escpos.js';

assert.equal(rp(1250000), 'Rp 1.250.000');
assert.equal(rp(0), 'Rp 0');
assert.equal(rp(-5000), '-Rp 5.000');

const items = [{ nama: 'Tempered Glass Samsung A12', qty: 2, harga: 15000 }, { nama: 'Casing Silikon', qty: 1, harga: 25000 }];
let t = totals(items, 5000, '');
assert.deepEqual([t.subtotal, t.diskon, t.total, t.bayar, t.kembali, t.kurang], [55000, 5000, 50000, null, 0, 0]);
t = totals(items, 0, 100000);
assert.equal(t.kembali, 45000);
t = totals(items, 0, 40000);
assert.equal(t.kurang, 15000);
t = totals(items, 999999, '');            // diskon dibatasi subtotal
assert.equal(t.total, 0);

const toko = { nama: 'Aksesoris Jaya', slogan: 'Murah & Lengkap', alamat: 'Jl. Braga No. 1 Bandung', telepon: '0812-3456-7890', footer: 'Barang dicek sebelum dibeli' };
const nota = { id: 'AKS-261027-001', tanggal: '27/10/2026', jam: '14:05', nama: 'Budi <script>[x]', nohp: '0812', items, ...totals(items, 5000, 100000), metode: 'Tunai', catatan: 'Garansi toko 7 hari' };
for (const chars of [32, 48]) {
  const text = buildReceiptText(nota, toko, chars);
  assert.ok(!/<script>|\[x\]/.test(text), 'tag dari input pengguna harus dibersihkan');
  const plain = tagsToPlain(text, chars);
  plain.split('\n').forEach(l => assert.ok(l.length <= chars, `baris kelebihan lebar (${chars}): "${l}"`));
  console.log(`--- ${chars} kolom ---\n${plain}\n`);
  const bytes = tagsToEscPos(text, { width: chars, feed: 4 });
  assert.ok(bytes.length > 100 && bytes[0] === 0x1b && bytes[1] === 0x40, 'harus diawali ESC @');
  assert.ok(bytesToBase64(bytes).length > 100);
}
// nota belum lunas & nama barang panjang
const n2 = { ...nota, ...totals(items, 0, 40000), diskon: 0 };
const p2 = tagsToPlain(buildReceiptText(n2, toko, 32), 32);
assert.ok(p2.includes('BELUM LUNAS') && p2.includes('Kurang'));
console.log('SEMUA TES LULUS');
