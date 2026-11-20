# SyncScore — Smart Grade Synchronization

SyncScore membantu dosen menyinkronkan nilai mahasiswa dari satu atau beberapa spreadsheet Sumber ke spreadsheet Target **berdasarkan NIM, bukan posisi baris**. Seluruh pemrosesan berjalan di browser; tidak ada server dan data mahasiswa tidak pernah dikirim ke mana pun.

Aplikasi: https://rendicahya.github.io/syncscore/

## Fitur utama

- Impor XLSX (pilih worksheet) atau tempel data dari Excel/Google Sheets; baris pertama selalu header. Data tempel dan berkas dapat digabungkan.
- Spreadsheet ala Excel (Tabulator): huruf kolom, nomor baris, edit langsung, seleksi rentang, salin/tempel multi-sel (TSV), isi-seret, urut, cari, saring, tambah/hapus baris & kolom, ubah lebar kolom.
- Pencocokan NIM persis (teks, nol di depan dipertahankan), deteksi NIM duplikat, peninjauan beda nama, pasangan manual dengan konfirmasi.
- Beberapa dataset Sumber per proyek, masing-masing dengan pemetaan kolom sendiri.
- Pratinjau sebelum sinkronisasi: sel yang diisi, ditimpa (perlu persetujuan per sel), dilewati karena kosong, tidak berpasangan, duplikat, beda nama, dan konflik antar-Sumber. Penerapan bersifat atomik.
- Riwayat sinkronisasi lengkap dengan undo/redo selektif yang tidak merusak perubahan lain.
- Ekspor Target ke XLSX (NIM sebagai teks) atau salin ke clipboard.
- Proyek tersimpan otomatis di IndexedDB; ekspor/impor cadangan JSON; hapus semua data lokal.
- Menu klik kanan (context menu) di spreadsheet (potong/salin/tempel, hapus isi, sisip/hapus baris & kolom, kolom NIM/Nama, urutkan), tab dataset, daftar pencocokan, pemetaan, riwayat, dan proyek.
- Tema terang/gelap, tata letak responsif.

## Pengembangan

```bash
npm ci
npm run check   # type checking
npm test        # unit tests (Vitest)
npm run build   # production build -> dist/
```

Setiap push ke `main` dibangun dan dideploy ke GitHub Pages oleh `.github/workflows/deploy.yml` (menjalankan check, test, dan build terlebih dahulu).

SheetJS di-*vendor* di `vendor/xlsx-0.20.3.tgz` dari CDN resmi SheetJS, karena versi di registri npm sudah usang dan memiliki kerentanan yang diketahui.

## Struktur

```
src/lib/domain        Model data & operasi dataset (murni)
src/lib/matching      Mesin pencocokan NIM
src/lib/sync          Mesin sinkronisasi (pratinjau + penerapan atomik)
src/lib/history       Riwayat, undo/redo selektif
src/lib/validation    Validasi kolom identitas
src/lib/io            Impor/ekspor XLSX, parsing TSV clipboard
src/lib/persistence   Dexie/IndexedDB, migrasi skema, cadangan
src/lib/spreadsheet   Adapter Tabulator <-> model data
src/lib/state         State aplikasi (Svelte 5 runes)
src/lib/components    Komponen UI
```

Lihat `CLAUDE.md` untuk aturan bisnis dan pedoman pengembangan.
