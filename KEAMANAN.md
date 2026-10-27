# Panduan Keamanan Nota Aksesoris HP

Dokumen ini menjelaskan risiko yang ada dan langkah memperbaikinya. Build tetap berjalan seperti biasa
tanpa langkah-langkah ini; workflow hanya menampilkan **peringatan kuning** bila kondisinya belum aman.

## 1. Jadikan repository Private (paling penting)
Folder `keystore/` berisi kunci tanda tangan APK, dan password bawaannya tertulis di `scripts/patch-android.js`
serta workflow. Jika repository **Public**, siapa pun dapat membuat APK palsu yang bertanda tangan sama
dengan aplikasi Anda.

GitHub → repository → **Settings → General → Danger Zone → Change visibility → Private**.

## 2. Ganti password rilis lewat GitHub Secrets
GitHub → **Settings → Secrets and variables → Actions → New repository secret**, isi:

| Nama | Isi |
|---|---|
| `RELEASE_STORE_PASSWORD` | password keystore rilis |
| `RELEASE_KEY_PASSWORD` | password kunci |
| `RELEASE_KEY_ALIAS` | alias kunci (bawaan: `notaservicehp`) |

Catatan: Secrets hanya dipakai jika password di keystore memang sama. Untuk benar-benar mengganti password
Anda harus membuat keystore baru (langkah 3).

## 3. Membuat keystore rilis baru (hanya jika repo pernah Public)
Konsekuensi: APK baru **tidak bisa dipasang di atas** versi lama (tanda tangan berbeda). Catat dulu data yang
perlu disimpan, uninstall aplikasi lama, lalu pasang yang baru (data nota lokal ikut hilang).

```sh
keytool -genkeypair -v -keystore release.keystore -alias notaservicehp \
  -keyalg RSA -keysize 2048 -validity 10000
```
Ganti `keystore/release.keystore` di repository dengan file baru, lalu isi tiga Secrets di langkah 2
dengan password yang Anda pilih. **Simpan salinan keystore dan passwordnya di tempat aman di luar GitHub**;
jika hilang, aplikasi tidak bisa diperbarui lagi. Lakukan hal yang sama untuk `debug.keystore` bila
repository pernah Public.

## 4. Batas yang perlu diketahui
- **Data nota tersimpan hanya di HP** (penyimpanan lokal aplikasi, tanpa enkripsi dan tanpa backup).
  Menghapus data aplikasi atau uninstall menghapus riwayat nota.
- **Android Auto Backup** (bawaan Capacitor) dapat menyalin data aplikasi ke akun Google pemilik HP.
  Matikan lewat `android:allowBackup="false"` di manifest bila tidak diinginkan.
