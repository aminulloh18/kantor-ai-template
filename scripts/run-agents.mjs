import fs from 'node:fs';
import path from 'node:path';

// 1. Load .env manual
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of envLines) {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  }
}

const API_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Opsional (wajib kalau repo private)

if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY belum diisi di file .env!');
  process.exit(1);
}

const rawInput = process.argv.slice(2).join(' ');
if (!rawInput) {
  console.error('❌ Masukkan perintah atau URL GitHub!');
  console.error('   Contoh: npm run agent -- "https://github.com/aminulloh18/kantor-ai-template"');
  process.exit(1);
}

// 2. Fungsi Penyedot Kode dari GitHub API
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

  // Ambil metadata repo (default branch)
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) {
    throw new Error(`Gagal akses repo GitHub (${repoRes.status}). Jika repo private, tambahkan GITHUB_TOKEN di .env`);
  }
  const repoInfo = await repoRes.json();
  const branch = repoInfo.default_branch || 'main';

  // Ambil struktur tree file
  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers });
  const treeData = await treeRes.json();
  const allFiles = (treeData.tree || [])
    .filter((item) => item.type === 'blob')
    .map((item) => item.path);

  // Filter file kode penting (hindari lockfile, gambar, node_modules)
  const targetExtensions = /\.(ts|tsx|js|jsx|py|json|md|html|css)$/i;
  const ignoreFiles = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.js)/i;

  const selectedFiles = allFiles
    .filter((f) => targetExtensions.test(f) && !ignoreFiles.test(f))
    .slice(0, 12); // Ambil maksimal 12 file utama agar hemat token & cepat

  console.log(`📂 Ditemukan ${allFiles.length} file. Membaca ${selectedFiles.length} file utama...`);

  let codeBundle = `REPO: ${owner}/${repo} (Deskripsi: ${repoInfo.description || '-'})\n`;
  codeBundle += `STRUKTUR FILE:\n${allFiles.slice(0, 50).join('\n')}\n\nISI KODE UTAMA:\n`;

  for (const filePath of selectedFiles) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    const fileRes = await fetch(rawUrl, { headers });
    if (fileRes.ok) {
      const content = await fileRes.text();
      // Batasi per file maks 4000 karakter biar context tetap tajam
      codeBundle += `\n--- FILE: ${filePath} ---\n${content.slice(0, 4000)}\n`;
    }
  }

  return { owner, repo, codeBundle };
}

const AGENTS = [
  {
    key: 'raka',
    nama: 'Yafizhan',
    role: 'Lead Developer',
    fokus: 'Arsitektur keseluruhan, struktur folder, modularitas kode, dan tech debt.',
  },
  {
    key: 'sekar',
    nama: 'Fathiyyan',
    role: 'Frontend Developer',
    fokus: 'Kualitas komponen UI, logic frontend, state management, dan rekomendasi refactor kode.',
  },
  {
    key: 'gilang',
    nama: 'Jehan',
    role: 'QA & Security',
    fokus: 'Celah keamanan (API key bocor, XSS, validasi), potensi runtime error, dan edge-case bug.',
  },
  {
    key: 'riska',
    nama: 'Navisha',
    role: 'Database & Cost Analyst',
    fokus: 'Skema data/JSON, efisiensi pemanggilan API/token, dan performa beban resource.',
  },
  {
    key: 'esok',
    nama: 'Yasmin',
    role: 'AI Researcher',
    fokus: 'Peluang integrasi AI, kualitas prompt/agentic logic, dan peningkatan kecerdasan fitur.',
  },
  {
    key: 'lita',
    nama: 'Inara',
    role: 'Product Designer',
    fokus: 'Kejelasan dokumentasi (README), alur pengguna (UX), dan konsistensi tampilan.',
  },
];

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API Error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return JSON.parse(rawText);
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
  console.log(`\n🚀 YAFIZHAN AI LAB [${mode}]`);
  console.log(`📝 Instruksi: "${rawInput}"\n`);

  const laporanBaru = {};
  const logLengkap = [
    `# Laporan ${mode}\nInstruksi: ${rawInput}\nWaktu: ${new Date().toLocaleString('id-ID')}\n`,
  ];

  for (const agen of AGENTS) {
    process.stdout.write(`🤖 ${agen.nama} (${agen.role}) sedang menganalisis... `);

    const konteksKode = githubData
      ? `\nBerikut adalah kode asli dari repository GitHub yang harus kamu audit:\n${githubData.codeBundle}`
      : '';

    const promptAgen = `
Kamu adalah ${agen.nama}, ${agen.role} di YAFIZHAN AI LAB.
Fokus audit & keahlianmu: ${agen.fokus}

Instruksi user: "${rawInput}"
${konteksKode}

Tugasmu: Analisis kode/instruksi di atas secara spesifik berdasarkan nama file & baris kode yang ada (jangan mengarang file yang tidak ada), lalu kembalikan HANYA JSON valid dengan format persis berikut:
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
      const hasil = await callGemini(promptAgen);
      laporanBaru[agen.key] = {
        ringkasan: hasil.ringkasan,
        ...(hasil.menunggu?.length ? { menunggu: hasil.menunggu } : {}),
        ...(hasil.mendesak?.length ? { mendesak: hasil.mendesak } : {}),
        ...(hasil.angka?.length ? { angka: hasil.angka } : {}),
      };

      logLengkap.push(`## ${agen.nama} (${agen.role})\n**Ringkasan:** ${hasil.ringkasan}\n\n${hasil.detailTeknis}\n---\n`);
      console.log('✅ Selesai');
    } catch (e) {
      console.log('❌ Gagal:', e.message);
    }
  }

  // Update Kantor 3D
  fs.writeFileSync(path.resolve('src/laporan.json'), JSON.stringify(laporanBaru, null, 2), 'utf-8');

  // Simpan laporan audit lengkap
  const outDir = path.resolve('output-sprint');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const fileName = githubData ? `audit-${githubData.repo}.md` : 'latest-sprint.md';
  fs.writeFileSync(path.join(outDir, fileName), logLengkap.join('\n'), 'utf-8');

  console.log('\n🎉 Audit selesai! Lihat gelembung status & Mission Board di http://localhost:5173');
  console.log(`📄 Laporan audit lengkap tersimpan di: output-sprint/${fileName}\n`);
}

runLabSprint();