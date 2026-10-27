# Nota Aksesoris HP — Capacitor 7

Aplikasi Android ringkas **hanya untuk nota penjualan aksesoris HP**, dengan **cetak thermal lewat Bluetooth saja**.
Tidak ada fitur servis, pembukuan, PDF, WhatsApp, kamera, atau kontak.

## Fitur
- **Nota Baru**: nama & HP pelanggan (opsional, bawaan "Pelanggan Umum"), daftar barang (nama, jumlah, harga), diskon,
  metode bayar (Tunai/Transfer/QRIS), uang diterima + kembalian, catatan. Total dihitung otomatis.
  Harga terakhir tiap barang diingat dan terisi otomatis saat nama dipilih lagi.
- **Nomor nota otomatis**: `AKS-YYMMDD-001` (urut per hari).
- **Simpan & Cetak Bluetooth**: nota disimpan dulu, lalu dicetak. Bila cetak gagal, nota tetap tersimpan dan bisa dicetak ulang.
- **Pratinjau Struk** di layar (58 mm = 32 karakter, 80 mm = 48 karakter).
- **Riwayat**: cari, lihat, cetak ulang, hapus; ringkasan hari ini & bulan ini.
- **Pengaturan**: pilih printer ter-pairing, tes cetak, lebar kertas, data toko (nama, slogan, alamat, telepon, teks bawah).

## Cetak Bluetooth
- Plugin native `scripts/native/EscPosPrinterPlugin.java` (Bluetooth Classic/SPP), encoder ESC/POS di `src/escpos.js`.
- Pairing printer dulu di Pengaturan Bluetooth HP, lalu pilih di tab Pengaturan. Android 12+ meminta izin "Perangkat sekitar".
- Uji dulu pada printer fisik Anda (58/80 mm, Android 12+) sebelum dipakai harian.

## Build APK lewat GitHub
1. Upload **isi folder** proyek ini ke repository GitHub **Private** (pastikan `.github/workflows/build-apk.yml` ikut).
2. Tab **Actions** → **Build APK** → **Run workflow**.
3. Unduh artifact `NotaAksesorisHP-debug-apk` (atau `-release-apk`).

## Build lokal
Butuh Node.js 20, JDK 21, Android SDK:
```sh
npm install --legacy-peer-deps
npm test               # tes logika nota & encoder ESC/POS
npm run android:add    # hanya pertama kali
npm run android:sync   # setelah mengubah kode
```

## Catatan
- `appId` = `com.notaservice.aksesoris` (berbeda dari aplikasi Nota Service HP), jadi keduanya bisa terpasang bersamaan
  dan data aplikasi lama tidak tersentuh. Kunci tanda tangan di `keystore/` dipakai ulang; lihat `KEAMANAN.md`.
- Data nota tersimpan di HP (localStorage) dan hilang bila data aplikasi dihapus. Belum ada fitur backup.
