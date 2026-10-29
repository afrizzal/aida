**Rekomendasi: coba tolak encoding path yang rusak di awal `proxy()` dengan respons 400 non-HTML dan CSP ketat.** Pertahankan test yang gagal sebagai bukti awal, lalu uji perubahan itu pada `next dev` dan `next start`. **Belum terverifikasi:** proxy menerima representasi path yang cukup utuh untuk mendeteksi semua bentuk encoding rusak, dan respons langsungnya bertahan pada kedua mode.

1. **Lokasi kehilangan header dan pilihan aplikasi**

   **Terverifikasi di kode:** [`src/proxy.ts`](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.YhMaElH2zi/src/proxy.ts) meneruskan CSP pada *request* dan memasangnya juga pada respons `NextResponse.next()`. [`08-08-SUMMARY.md`](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.YhMaElH2zi/.planning/phases/08-security-hardening/08-08-SUMMARY.md) melaporkan script bernonce, tetapi respons HTML 400 tanpa CSP. Ini **mendukung dugaan** bahwa request hasil proxy dipakai untuk rendering sementara header responsnya tidak ikut pada jalur galat. Titik pasti dalam internal Next **belum terverifikasi**: kode Next tidak tersedia dalam ekspor. Komentar proxy yang menyatakan contoh ini pasti terjadi sebelum proxy tidak cocok dengan bukti yang dilaporkan.

   **Terverifikasi di kode:** tidak ada `pages/_error` atau `app/global-error`; error boundary yang ada bersifat spesifik fitur. [`next.config.ts`](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.YhMaElH2zi/next.config.ts) tidak menetapkan `headers()`.

   **Belum terverifikasi:** halaman galat sendiri akan dipakai oleh jalur decode-error dan dapat memulihkan header respons; mengganti markup saja tidak membuktikan hal itu. Demikian pula, aturan `headers()` mungkin ikut hilang atau gagal mencocokkan path rusak. Aturan statis luas juga dapat bertabrakan dengan CSP nonce pada halaman normal. Perubahan versi atau pengaturan Next layak diselidiki hanya dengan bukti reproduksi yang sama; belum ada bukti di ekspor bahwa itu menyelesaikannya.

   **Belum terverifikasi:** guard di awal proxy dapat memeriksa path dengan `decodeURIComponent` dalam `try/catch`, sebelum cabang publik, autentikasi, dan redirect; pada kegagalan, kembalikan 400 `text/plain` atau JSON, `nosniff`, kebijakan referrer yang sesuai, dan CSP statis ketat seperti `default-src 'none'; frame-ancestors 'none'`. Periksa **path saja**, bukan query; jangan mendekode ulang nilai untuk routing. Perlu menguji percent escape tidak lengkap, byte UTF-8 tidak sah, path valid ber-escape, serta dampak normalisasi URL dan matcher. Jalur yang ditolak sebelum proxy atau dikecualikan matcher tetap di luar jaminan guard ini.

2. **Caddy dan CSP ganda**

   **Terverifikasi di kode:** [`Caddyfile`](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.YhMaElH2zi/Caddyfile) saat ini tidak menambahkan CSP; test E2E yang dimaksud memeriksa aplikasi tanpa Caddy. Karena itu, perubahan Caddy saja tidak membuktikan hasil respons aplikasi pada test tersebut.

   **Belum terverifikasi:** fallback Caddy dapat menutup kasus ini pada deployment jika benar-benar hanya diterapkan saat CSP hilang. Perlu test melalui stack yang memeriksa respons upstream **dan** galat yang dihasilkan Caddy sendiri. Dua kebijakan CSP yang ditegakkan berlaku bersama: kebijakan statis tanpa nonce dapat memblokir script sah meskipun kebijakan aplikasi mengizinkannya. Uji jumlah/nilai header dan fungsi halaman normal, bukan hanya keberadaan header.

3. **Opsi (a)**

   **Terverifikasi di kode:** [AIDA-28](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.YhMaElH2zi/.planning/REQUIREMENTS.md:15) mensyaratkan **setiap respons HTML** membawa CSP yang membatasi script dan `connect-src`; D-11 juga mensyaratkan nonce pada jalur HTML. Mengizinkan HTML tersebut **tanpa CSP** sambil menyatakan AIDA-28 terpenuhi tidak jujur. Mengizinkan HTML **dengan CSP yang memenuhi kontrak** adalah perubahan must-have plan yang berbeda.

   **Belum terverifikasi:** bila pengecualian tanpa CSP tetap diterima, catat URL dan mode yang diamati, tidak adanya bukti keamanan/injeksi, cakupan deployment, dan bahwa AIDA-28/D-11 belum terpenuhi untuk batas itu; perubahan must-have tidak otomatis mengubah requirement.

4. **Test yang membuktikan kegagalan**

   **Terverifikasi di kode:** test [`C13-boundary`](/var/folders/_f/5lfgy3_s4q1515bbcm9z70jh0000gn/T/tmp.YhMaElH2zi/tests/e2e/csp.spec.ts:207) sekarang menerima *CSP apa pun*, bahkan yang permisif. Perketat menjadi status 400, tipe non-HTML, body tetap tanpa script, CSP yang benar-benar ketat, `nosniff`, dan `no-referrer` untuk `/status`. Sertakan URL rusak lain serta kontrol path valid ber-escape; pastikan path valid tetap mencapai perilaku normal. Jalankan test yang sama pada dev dan produksi.

   **Belum terverifikasi:** bahkan bila test tersebut hijau, ia membuktikan contoh yang diuji, bukan seluruh respons HTML atau semua galat sebelum proxy. Untuk halaman normal, tambahkan pemeriksaan nonce pada CSP cocok dengan nonce script serta injeksi inline tanpa nonce benar-benar diblokir; keberadaan header saja tidak membuktikan penegakan.