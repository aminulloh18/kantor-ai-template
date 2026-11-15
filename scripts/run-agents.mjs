import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

// Cek apakah localhost:5173 sudah nyala; kalau belum, nyalakan npm run dev di background
const isDevRunning = await new Promise((resolve) => {
  const socket = net.connect(5173, '127.0.0.1');
  socket.on('connect', () => { socket.destroy(); resolve(true); });
  socket.on('error', () => resolve(false));
});

if (!isDevRunning) {
  console.log('🌐 Menyalakan server Kantor 3D di background (http://localhost:5173/?libur=1)...');
  const devProc = spawn('npm', ['run', 'dev'], { shell: true, detached: true, stdio: 'ignore' });
  devProc.unref();
  await new Promise((r) => setTimeout(r, 2500)); // Tunggu Vite siap
}

// 1. Load .env manual
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of envLines) {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  }
}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GEMINI_KEY && !GROQ_KEY) {
  console.error('❌ Isi GEMINI_API_KEY (Free Tier AI Studio) atau GROQ_API_KEY di file .env!');
  process.exit(1);
}

const rawInput = process.argv.slice(2).join(' ');
if (!rawInput) {
  console.error('❌ Masukkan perintah atau URL GitHub!');
  process.exit(1);
}

// Helper untuk update src/laporan.json secara LIVE tiap agen bekerja
const laporanPath = path.resolve('src/laporan.json');
function saveLiveLaporan(data) {
  fs.writeFileSync(laporanPath, JSON.stringify(data, null, 2), 'utf-8');
}

async function fetchGithubContext(input) {
  const match = input.match(/github\.com\/([^\/\s]+)\/([^\/\s#?]+)/);
  if (!match) return null;

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, '');
  console.log(`🔍 Mendeteksi repo GitHub: ${owner}/${repo}...`);

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Yafizhan-AI-Lab',
    ...(GITHUB_TOKEN ? { 'Authorization': `Bearer ${GITHUB_TOKEN}` } : {}),
  };

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) throw new Error(`Gagal akses repo GitHub (${repoRes.status})`);
  const repoInfo = await repoRes.json();
  const branch = repoInfo.default_branch || 'main';

  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers });
  const treeData = await treeRes.json();
  const allFiles = (treeData.tree || []).filter((item) => item.type === 'blob').map((item) => item.path);

  const targetExtensions = /\.(ts|tsx|js|jsx|py|json|md|html|css)$/i;
  const ignoreFiles = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.js)/i;
  const selectedFiles = allFiles.filter((f) => targetExtensions.test(f) && !ignoreFiles.test(f)).slice(0, 12);

  console.log(`📂 Ditemukan ${allFiles.length} file. Membaca ${selectedFiles.length} file utama...`);

  let codeBundle = `REPO: ${owner}/${repo} (Deskripsi: ${repoInfo.description || '-'})\n`;
  codeBundle += `STRUKTUR FILE:\n${allFiles.slice(0, 50).join('\n')}\n\nISI KODE UTAMA:\n`;

  for (const filePath of selectedFiles) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    const fileRes = await fetch(rawUrl, { headers });
    if (fileRes.ok) {
      const content = await fileRes.text();
      codeBundle += `\n--- FILE: ${filePath} ---\n${content.slice(0, 4000)}\n`;
    }
  }
  return { owner, repo, codeBundle };
}

const AGENTS = [
  { key: 'raka', nama: 'Yafizhan', role: 'Lead Developer', fokus: 'Arsitektur keseluruhan, struktur folder, modularitas kode, dan tech debt.' },
  { key: 'sekar', nama: 'Fathiyyan', role: 'Frontend Developer', fokus: 'Kualitas komponen UI, logic frontend, state management, dan rekomendasi refactor kode.' },
  { key: 'gilang', nama: 'Jehan', role: 'QA & Security', fokus: 'Celah keamanan (API key bocor, XSS, validasi), potensi runtime error, dan edge-case bug.' },
  { key: 'riska', nama: 'Navisha', role: 'Database & Cost Analyst', fokus: 'Skema data/JSON, efisiensi pemanggilan API/token, dan performa beban resource.' },
  { key: 'esok', nama: 'Yasmin', role: 'AI Researcher', fokus: 'Peluang integrasi AI, kualitas prompt/agentic logic, dan peningkatan kecerdasan fitur.' },
  { key: 'lita', nama: 'Inara', role: 'Product Designer', fokus: 'Kejelasan dokumentasi (README), alur pengguna (UX), dan konsistensi tampilan.' },
];

async function callLLM(prompt) {
  if (GROQ_KEY) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`Groq API Error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API Error (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
}

async function runLabSprint() {
  let githubData = null;
  try {
    githubData = await fetchGithubContext(rawInput);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const mode = githubData ? `AUDIT REPO GITHUB (${githubData.owner}/${githubData.repo})` : 'SPRINT FITUR BARU';
  console.log(`\n🚀 YAFIZHAN AI LAB [${mode}] (Provider: ${GROQ_KEY ? 'Groq Llama-3.3' : 'Gemini 2.5 Flash'})`);

  // Set status awal semua agen ke "Menunggu antrian sprint..." secara LIVE
  const laporanLive = {};
  for (const a of AGENTS) {
    laporanLive[a.key] = { ringkasan: 'Menunggu giliran analisis sprint...' };
  }
  saveLiveLaporan(laporanLive);

  const logLengkap = [`# Laporan ${mode}\nInstruksi: ${rawInput}\nWaktu: ${new Date().toLocaleString('id-ID')}\n`];

  for (const agen of AGENTS) {
    process.stdout.write(`🤖 ${agen.nama} (${agen.role}) sedang bekerja... `);

    // Update gelembung kepala di kantor 3D saat agen ini sedang berpikir!
    laporanLive[agen.key] = {
      ringkasan: `⏳ Sedang menganalisis ${githubData ? githubData.repo : 'instruksi'}...`,
    };
    saveLiveLaporan(laporanLive);

    const konteksKode = githubData
      ? `\nBerikut adalah kode asli dari repository GitHub yang harus kamu audit:\n${githubData.codeBundle}`
      : '';

    const promptAgen = `
Kamu adalah ${agen.nama}, ${agen.role} di YAFIZHAN AI LAB.
Fokus audit & keahlianmu: ${agen.fokus}
Instruksi user: "${rawInput}"
${konteksKode}

Tugasmu: Analisis kode/instruksi di atas secara spesifik berdasarkan nama file & baris kode yang ada, lalu kembalikan HANYA JSON valid dengan format persis berikut:
{
  "ringkasan": "1 kalimat singkat padat (< 90 karakter) temuan utamamu untuk gelembung status di kantor 3D",
  "menunggu": ["1 rekomendasi perubahan yang butuh persetujuan user (kosongkan array [] jika tidak ada)"],
  "mendesak": ["1 temuan bug fatal / celah keamanan serius jika ada (kosongkan array [] jika aman)"],
  "angka": [{ "label": "Metrik audit (2 kata)", "nilai": "Angka + satuan" }],
  "detailTeknis": "Hasil analisis detail & konkret (sebutkan nama file spesifik dan contoh perbaikan kodenya) dalam Markdown."
}
Aturan: Jangan cantumkan nominal uang/rupiah/dolar. Gunakan Bahasa Indonesia teknis yang tajam.
`;

    try {
      const hasil = await callLLM(promptAgen);
      laporanLive[agen.key] = {
        ringkasan: hasil.ringkasan,
        ...(hasil.menunggu?.length ? { menunggu: hasil.menunggu } : {}),
        ...(hasil.mendesak?.length ? { mendesak: hasil.mendesak } : {}),
        ...(hasil.angka?.length ? { angka: hasil.angka } : {}),
      };
      // Langsung update kantor 3D detik itu juga!
      saveLiveLaporan(laporanLive);

      logLengkap.push(`## ${agen.nama} (${agen.role})\n**Ringkasan:** ${hasil.ringkasan}\n\n${hasil.detailTeknis}\n---\n`);
      console.log('✅ Selesai');
    } catch (e) {
      laporanLive[agen.key] = { ringkasan: '❌ Gagal terhubung ke API LLM.' };
      saveLiveLaporan(laporanLive);
      console.log('❌ Gagal:', e.message);
    }
  }

  const outDir = path.resolve('output-sprint');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const fileName = githubData ? `audit-${githubData.repo}.md` : 'latest-sprint.md';
  fs.writeFileSync(path.join(outDir, fileName), logLengkap.join('\n'), 'utf-8');

  console.log('\n🎉 Audit selesai! Lihat hasil live di http://localhost:5173');
  console.log(`📄 Laporan audit lengkap tersimpan di: output-sprint/${fileName}\n`);
}

runLabSprint();