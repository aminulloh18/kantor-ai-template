# Laporan AUDIT REPO GITHUB (aminulloh18/kantor-ai-template)
Instruksi: Audit kualitas kode, arsitektur, keamanan, dan potensi bug di https://github.com/aminulloh18/kantor-ai-template
Waktu: 15/11/2026, 10.58.45

## Jehan (QA & Security)
**Ringkasan:** Dependency anomali di package.json dan risiko WebGL context leak saat ganti gaya 3D.

### 1. Dependensi Invalid & Risiko Supply-Chain (`package.json`)
- **Masalah**: `package.json` memuat `"typescript": "^7.0.2"` dan `"vite": "^8.3.1"`. Versi ini belum dirilis secara resmi di NPM (TypeScript saat ini v5.x dan Vite v5/v6). Ini menyebabkan kegagalan build/install pada environment baru (`npm ci`) serta membuka risiko *dependency confusion*.
- **Solusi**: Turunkan ke versi stabil:
```json
"devDependencies": {
  "typescript": "^5.8.0",
  "vite": "^6.2.0"
}
```

### 2. Potensi WebGL Context Leak & Memory Leak (`src/OfficeScene.tsx`)
- **Masalah**: Pergantian properti `gaya` me-retrigger hook `useEffect` untuk membangun ulang scene Three.js. Jika siklus pembersihan (`cleanup function`) tidak memanggil `renderer.dispose()`, `disposables.forEach(d => d.dispose())`, dan `el.removeChild(renderer.domElement)`, browser akan mengalami *WebGL context loss* setelah berganti gaya 8–16 kali (melebihi limit konteks WebGL browser).
- **Solusi**: Tambahkan cleanup eksplisit pada return `useEffect` di `OfficeScene.tsx`:
```ts
return () => {
  disposables.forEach(d => d.dispose());
  renderer.dispose();
  if (el.contains(renderer.domElement)) {
    el.removeChild(renderer.domElement);
  }
};
```

### 3. Validasi & Penanganan Error Endpoint Sprint (`src/App.tsx`)
- **Masalah**: Fungsi `kirimPerintah` mengirimkan raw prompt langsung ke `/api/run-sprint` tanpa validasi panjang karakter maksimal (DoS via oversized prompt) dan tanpa proteksi CSRF/rate-limiting jika backend mengeksekusi sub-proses otomatis seperti di `scripts/run-agents.mjs`.
- **Solusi**: Batasi panjang payload sebelum request dan tangani sanitasi respons:
```ts
if (!cmd.trim() || cmd.length > 500 || busy) return;
```
---

## Navisha (Database & Cost Analyst)
**Ringkasan:** Re-render 100ms boroskan CPU dan prompt agen bocor di bundle client frontend.

### 1. Resource Drain: Re-render Loop Tanpa Throttling di `src/App.tsx`
Pada baris `useEffect` non-rekam:
```ts
const id = window.setInterval(() => {
  setT((performance.now() - start) / 1000);
  setNow(new Date());
}, 100);
```
Memanggil `setNow(new Date())` setiap 100 milidetik memicu re-render reaktif pada komponen root `App` sebanyak 10 kali per detik. Logika turunan seperti `officeDesks()`, `missionBoard()`, dan filter array dijalankan ulang secara berlebihan meski jam (`hm(now)`) hanya berubah per menit.

**Solusi:** Pisahkan timer animasi (`t`) atau batasi pembaruan state waktu jam hanya ketika menit berubah:
```ts
// Cukup perbarui waktu jam setiap 1 detik atau 10 detik
const clockId = window.setInterval(() => {
  setNow(new Date());
}, 1000);
```

### 2. Keamanan & Efisiensi Bundle: Paparan `src/agentPrompts.ts` di Frontend
File `src/agentPrompts.ts` menyimpan `systemPrompt`, `kewenangan`, dan batasan operasional agen secara statis di dalam bundle client. Hal ini mengakibatkan:
- Prompt internal dan instruksi AI terekspos ke publik melalui source map/JS build.
- Ukuran bundle JavaScript membengkak tanpa fungsi komputasi langsung di UI browser.
- Tidak adanya validasi runtime (misalnya schema Zod) saat mem-parsing respons `/api/run-sprint` di `App.tsx` (`kirimPerintah`).

**Solusi:** Pindahkan `AGENT_BRAINS` ke service backend (Node.js/Edge function). Sisi frontend hanya perlu menyimpan metadata publik agen (`nama`, `tugas`, `warna`, `ruang`) dari `src/config.ts`.

### 3. Skema Data & Beban Muat JSON (`laporanDetail.json` & `laporan.json`)
Import statis file JSON besar (`import laporanDetail from './laporanDetail.json'`) memaksa seluruh histori laporan termuat di awal (eager loading), memperbesar First Contentful Paint (FCP). Gunakan dynamic import atau fetch on-demand saat modal laporan dibuka (`showFullReport`).
---

## Yasmin (AI Researcher)
**Ringkasan:** Prompt agen statis tanpa memory/RAG, endpoint sprint rentan injeksi prompt.

### Audit AI Integrasi & Agentic Logic (Yasmin - AI Researcher)

#### 1. Arsitektur Prompting Statis & Ketiadaan Agentic Loop
- **Lokasi:** `src/agentPrompts.ts`
- **Temuan:** Definisi `AGENT_BRAINS` hanya menyediakan `systemPrompt` statis tanpa konfigurasi *dynamic context injection*, *few-shot examples*, atau arsitektur *memory store* (misal: vector store atau sliding-window memory). Ini membatasi interaksi hanya pada single-turn completion tanpa kemampuan penalaran iteratif (ReAct loop).
- **Rekomendasi Implementasi:** Tambahkan interface state dan context schema pada `src/agentPrompts.ts`:
```typescript
export interface AgentExecutionContext {
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  tools: Array<{ name: string; description: string; parameters: object }>;
  temperature?: number;
  maxTokens?: number;
}
```

#### 2. Kerentanan Injeksi & Penanganan Endpoint Sprint
- **Lokasi:** `src/App.tsx` (fungsi `kirimPerintah` baris 68-84)
- **Temuan:** Payload `cmd.trim()` dikirimkan mentah ke `/api/run-sprint` tanpa validasi skema (misal Zod) atau sanitasi guardrail prompt. Hal ini memicu risiko *Prompt Injection* dan *Jailbreak* pada eksekutor backend (`scripts/run-agents.mjs`).
- **Solusi Kode:** Terapkan sanitasi input, batasan panjang token, serta penanganan error terstruktur di `src/App.tsx`:
```typescript
const MAX_PROMPT_LEN = 500;
if (!cmd.trim() || busy) return;
if (cmd.length > MAX_PROMPT_LEN) {
  setCmdErr(`Prompt melebihi batas ${MAX_PROMPT_LEN} karakter`);
  return;
}
```

#### 3. Sinkronisasi Asinkron State Laporan AI
- **Lokasi:** `src/laporan.json` dan `src/App.tsx`
- **Temuan:** Data laporan dibaca secara statis melalui bundling file JSON lokal. Agen AI otonom membutuhkan polling reaktif (SSE / WebSocket) agar status visual (gelembung notifikasi, meja berkedip) sinkron secara *real-time* ketika agen eksternal memperbarui state.
---

## Inara (Product Designer)
**Ringkasan:** Dokumentasi lisensi ambigu dan HUD form bentrok dengan elemen kredit di layar ponsel.

### 1. Inkonsistensi Dokumentasi & Lisensi Proyek
- **Masalah:** Di `package.json` dan `README.md`, proyek diklaim berlisensi **MIT (Gratis)**. Namun pada `index.html` baris 2 dan `skill/kantor-ai-3-agen/SKILL.md` bagian footer tercantum: *'Lisensi Nonkomersial Maliki Studio: wajib kredit, dilarang dijual'*. Ini membingungkan pengguna open-source dan melanggar klausul kejelasan hak cipta.
- **Solusi:** Harmonisasi berkas `LICENSE` dan tentukan lisensi tunggal di seluruh file (`README.md`, `package.json`, dan `index.html`).

### 2. Tabrakan Layout & UX Responsif (Mobile Viewport)
- **Masalah:** Di `index.html`, tag `<a class="kredit-maliki">` dipasang secara `position: fixed; left: 10px; bottom: 8px; z-index: 9999;`. Elemen ini bertumpukan langsung dengan tombol navigasi, selector gaya (`TAMPIL_PEMILIH_GAYA`), dan input chat task di `App.tsx` saat dibuka di layar smartphone/tablet.
- **Solusi:** Pindahkan elemen kredit ke dalam hierarki DOM React di `src/App.tsx` agar tata letaknya adaptif terhadap breakpoint viewport mobile.
```tsx
// Rekomendasi di src/App.tsx
<div className="fixed bottom-2 left-2 z-40 flex items-center gap-2 pointer-events-none">
  <a className="pointer-events-auto text-[11px] bg-black/40 backdrop-blur px-2 py-1 rounded-full text-white/80 hover:text-white" href="https://malikisaputra.biz.id" target="_blank" rel="noreferrer">
    Template @malikisaputra
  </a>
</div>
```

### 3. Ketidaksesuaian Zonasi Ruang & Identitas Agen (UX Information Architecture)
- **Masalah:** Pada `src/config.ts`, ruang tengah (`keuangan`) diberi label **'Quality & Data'**, tetapi agen QA/Security (**Jehan / gilang**) ditempatkan di ruang `bizdev` (**'Engineering'**), meninggalkan **Navisha** sendirian di ruang Quality & Data. Secara tata ruang visual, ini merusak koherensi fungsi tim.
- **Solusi:** Pindahkan koordinat x dan penugasan ruangan untuk Jehan di `src/config.ts`:
```ts
// src/config.ts
{
  key: 'gilang',
  nama: 'Jehan',
  tugas: 'QA & Security',
  ruang: 'keuangan', // sebelumnya 'bizdev'
  warna: '#8e6bd8',
  x: -0.8,          // sesuaikan rentang x0: -1.8, x1: 2
  z: 1.2
}
```

### 4. Alur Interaksi Form Perintah (Broken User Flow)
- **Masalah:** Pada `src/App.tsx`, fungsi `kirimPerintah` melakukan `fetch('/api/run-sprint', ...)`. Proyek murni menggunakan Vite dev server tanpa backend handler default untuk rute tersebut, mengakibatkan status error runtime (`404 Not Found`) tanpa umpan balik UI yang intuitif jika user mencoba mengetik instruksi sprint.
---
