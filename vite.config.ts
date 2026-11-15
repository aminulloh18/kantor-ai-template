import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function loadEnvLocal() {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (k) process.env[k] = v;
  }
}

function ensureDataFiles() {
  const defaults: Record<string, string> = {
    'src/laporan.json': '{}',
    'src/laporanDetail.json': '{}',
    'src/laporanLogs.json': '[]',
  };
  for (const [rel, content] of Object.entries(defaults)) {
    const full = path.resolve(rel);
    if (!fs.existsSync(full)) fs.writeFileSync(full, content, 'utf-8');
  }
}

const AGENTS = [
  { key: 'raka', nama: 'Yafizhan', role: 'Lead Developer', fokus: 'Arsitektur keseluruhan, struktur folder, modularitas kode, dan tech debt.' },
  { key: 'sekar', nama: 'Fathiyyan', role: 'Frontend Developer', fokus: 'Kualitas komponen UI, logic frontend, state management, dan rekomendasi refactor kode.' },
  { key: 'gilang', nama: 'Jehan', role: 'QA & Security', fokus: 'Celah keamanan (API key bocor, XSS, validasi), potensi runtime error, dan edge-case bug.' },
  { key: 'riska', nama: 'Navisha', role: 'Database & Cost Analyst', fokus: 'Skema data/JSON, efisiensi pemanggilan API/token, dan performa beban resource.' },
  { key: 'esok', nama: 'Yasmin', role: 'AI Researcher', fokus: 'Peluang integrasi AI, kualitas prompt/agentic logic, dan peningkatan kecerdasan fitur.' },
  { key: 'lita', nama: 'Inara', role: 'Product Designer', fokus: 'Kejelasan dokumentasi (README), alur pengguna (UX), dan konsistensi tampilan.' },
];

function appendLog(entry: {
  waktu: string;
  agen: string;
  aksi: 'AUDIT' | 'AUTO-SOLVE' | 'ROLLBACK';
  status: 'SUKSES' | 'GAGAL';
  ringkasan: string;
  files?: string[];
  commitHash?: string;
}) {
  const logPath = path.resolve('src/laporanLogs.json');
  const existing = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf-8')) : [];
  existing.unshift(entry);
  fs.writeFileSync(logPath, JSON.stringify(existing.slice(0, 50), null, 2), 'utf-8');
}

async function fetchGithubContext(input: string, token?: string) {
  const match = input.match(/github\.com\/([^\/\s"'`]+)\/([^\/\s#?"'`]+)/);
  if (!match) return null;

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, '').replace(/["'`.,)]+$/, '');
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Yafizhan-AI-Lab',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) throw new Error(`Gagal akses repo GitHub (${repoRes.status})`);
  const repoInfo = await repoRes.json();
  const branch = repoInfo.default_branch || 'main';

  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers });
  const treeData = await treeRes.json();
  const allFiles: string[] = (treeData.tree || []).filter((i: any) => i.type === 'blob').map((i: any) => i.path);

  const selectedFiles = allFiles
    .filter((f) => /\.(ts|tsx|js|jsx|py|json|md|html)$/i.test(f) && !/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.js)/i.test(f))
    .slice(0, 8);

  let codeBundle = `REPO: ${owner}/${repo} (${repoInfo.description || '-'})\nDAFTAR FILE ASLI DI REPO:\n${allFiles.slice(0, 50).join('\n')}\n\nISI KODE UTAMA:\n`;
  for (const filePath of selectedFiles) {
    const fileRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`, { headers });
    if (fileRes.ok) {
      const content = await fileRes.text();
      codeBundle += `\n--- FILE: ${filePath} ---\n${content.slice(0, 2200)}\n`;
    }
  }
  return { owner, repo, codeBundle };
}

function extractJson(raw: string) {
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Output bukan JSON valid');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callLLM(prompt: string, geminiKey?: string, groqKey?: string) {
  // 1. JALUR UTAMA: GEMINI API (Limit 250k - 1M TPM, jago coding & JSON)
  if (geminiKey) {
    const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.8-flash'];
    for (const model of models) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
            }),
          });
          if (res.ok) {
            const data = await res.json();
            return extractJson(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
          }
          if (res.status === 503 || res.status === 429) {
            await new Promise((r) => setTimeout(r, 2500 * attempt));
            continue;
          }
          if (res.status === 404) break;
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  }

  // 2. JALUR CADANGAN OTOMATIS: GROQ (Hanya dipakai jika semua model Gemini sedang 503)
  if (groqKey) {
    const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${groqKey}` },
    });
    const modelsData = modelsRes.ok ? await modelsRes.json() : { data: [] };
    const availableIds: string[] = (modelsData.data || []).map((m: any) => m.id);

    const preferred = ['llama-3.1-8b-instant', 'qwen/qwen3-32b', 'openai/gpt-oss-120b'];
    const chosenModel =
      preferred.find((id) => availableIds.includes(id)) ||
      availableIds.find((id) => !id.includes('whisper') && !id.includes('guard')) ||
      'llama-3.1-8b-instant';

    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: chosenModel,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return extractJson(data.choices?.[0]?.message?.content || '{}');
      }

      const errTxt = await res.text();
      if (res.status === 429 && attempt < 3) {
        const waitMatch = errTxt.match(/try again in ([\d.]+)s/i);
        const waitMs = waitMatch ? Math.ceil(parseFloat(waitMatch[1]) * 1000) + 1000 : 10000;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(`Groq Error (${res.status}): ${errTxt}`);
    }
  }

  throw new Error('Semua jalur LLM (Gemini & Groq) gagal merespons.');
}

// Perbaikan #2: Sertakan OfficeScene.tsx & index.html pada audit lokal
function getLocalAuditContext() {
  const targetFiles = ['src/App.tsx', 'src/OfficeScene.tsx', 'src/config.ts', 'src/office.ts', 'src/agentPrompts.ts', 'index.html', 'package.json'];
  let bundle = `DAFTAR FILE YANG TERSEDIA: ${targetFiles.join(', ')}\n`;
  for (const rel of targetFiles) {
    const full = path.resolve(rel);
    if (fs.existsSync(full)) {
      bundle += `\n--- FILE LOKAL: ${rel} ---\n${fs.readFileSync(full, 'utf-8').slice(0, 2500)}\n`;
    }
  }
  return bundle;
}

// Perbaikan #3: Berikan isi UTUH file yang diizinkan untuk Auto-Solve agar tidak terpotong & lolos npm run build
const EDITABLE_FILES = ['src/App.tsx', 'src/config.ts', 'src/office.ts', 'src/agentPrompts.ts', 'index.html'];

function getFullEditableContext() {
  let bundle = `DAFTAR FILE YANG BOLEH DIMODIFIKASI (ISI UTUH):\n`;
  for (const rel of EDITABLE_FILES) {
    const full = path.resolve(rel);
    if (fs.existsSync(full)) {
      bundle += `\n=== FILE: ${rel} ===\n${fs.readFileSync(full, 'utf-8')}\n=== END OF ${rel} ===\n`;
    }
  }
  return bundle;
}

function agentLabPlugin(): Plugin {
  let sprintCancelled = false;

  return {
    name: 'yafizhan-ai-lab-api',
    configureServer(server) {
      // 1. Endpoint Analisis & Audit (Anti-Halusinasi)
      server.middlewares.use('/api/run-sprint', async (req, res) => {
        if (req.method !== 'POST') return ((res.statusCode = 405), res.end('Method Not Allowed'));
        loadEnvLocal();
        ensureDataFiles();
        sprintCancelled = false;

        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { prompt } = JSON.parse(body || '{}');
            if (!prompt) throw new Error('Instruksi kosong.');
            const geminiKey = process.env.GEMINI_API_KEY;
            const groqKey = process.env.GROQ_API_KEY;
            if (!geminiKey && !groqKey) throw new Error('API Key belum diset di .env');

            const laporanPath = path.resolve('src/laporan.json');
            const detailPath = path.resolve('src/laporanDetail.json');
            const githubData = await fetchGithubContext(prompt, process.env.GITHUB_TOKEN);
            const laporanLive: Record<string, any> = {};
            const detailLive: Record<string, string> = {};

            for (const a of AGENTS) laporanLive[a.key] = { ringkasan: 'Menunggu giliran...' };
            fs.writeFileSync(laporanPath, JSON.stringify(laporanLive, null, 2));

            for (const agen of AGENTS) {
              if (sprintCancelled) break;

              laporanLive[agen.key] = { ringkasan: `⏳ Sedang menganalisis...` };
              fs.writeFileSync(laporanPath, JSON.stringify(laporanLive, null, 2));

              const konteksKode = githubData ? `\nKode repo GitHub:\n${githubData.codeBundle}` : `\nKode proyek lokal:\n${getLocalAuditContext()}`;

              // Perbaikan #1: Strict Anti-Hallucination Grounding Rules
              const promptAgen = `
Kamu adalah ${agen.nama}, ${agen.role} di YAFIZHAN AI LAB.
Fokus keahlianmu: ${agen.fokus}
Instruksi user: "${prompt}"
${konteksKode}

ATURAN KETAT ANTI-HALUSINASI:
1. HANYA bahas file, fungsi, variabel, dan dependency yang BENAR-BENAR TERTULIS di konteks kode di atas.
2. DILARANG KERAS mengarang atau menebak nama library, file, atau fungsi yang tidak ada di konteks (jangan sebut eval, react-scripts, vm2, atau API_KEY hardcoded jika tidak tertulis di kode di atas).
3. Jika kode sudah aman pada suatu aspek, nyatakan aman secara jujur dan berikan saran peningkatan nyata yang relevan dengan isi kode yang ada.

Kembalikan HANYA JSON valid:
{
  "ringkasan": "1 kalimat singkat (< 85 karakter) temuan/hasil kerjamu yang faktual",
  "menunggu": ["1 rekomendasi perbaikan nyata pada file yang ada (kosongkan [] jika tidak ada)"],
  "mendesak": ["1 bug/risiko nyata yang terbukti ada di baris kode di atas (kosongkan [] jika aman)"],
  "angka": [{ "label": "Metrik (2 kata)", "nilai": "Angka + satuan" }],
  "detailTeknis": "Hasil analisis konkret berbasis fakta kode di atas dalam Bahasa Indonesia."
}`;
              try {
                const hasil = await callLLM(promptAgen, geminiKey, groqKey);
                if (sprintCancelled) break;

                laporanLive[agen.key] = {
                  ringkasan: hasil.ringkasan,
                  ...(hasil.menunggu?.length ? { menunggu: hasil.menunggu } : {}),
                  ...(hasil.mendesak?.length ? { mendesak: hasil.mendesak } : {}),
                  ...(hasil.angka?.length ? { angka: hasil.angka } : {}),
                };
                detailLive[agen.key] = hasil.detailTeknis || hasil.ringkasan;
              } catch (err: any) {
                if (sprintCancelled) break;
                laporanLive[agen.key] = { ringkasan: `❌ ${err.message}` };
                detailLive[agen.key] = err.message;
              }

              if (!sprintCancelled) {
                fs.writeFileSync(laporanPath, JSON.stringify(laporanLive, null, 2));
                fs.writeFileSync(detailPath, JSON.stringify(detailLive, null, 2));
                await new Promise((r) => setTimeout(r, 1500));
              }
            }

            if (!sprintCancelled) {
              appendLog({
                waktu: new Date().toLocaleTimeString('id-ID'),
                agen: 'Tim Yafizhan AI Lab',
                aksi: 'AUDIT',
                status: 'SUKSES',
                ringkasan: `Selesai memproses: "${prompt}"`,
              });
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, cancelled: sprintCancelled }));
          } catch (err: any) {
            console.error('❌ [/api/run-sprint ERROR]:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
          }
        });
      });

      // 2. Endpoint Autonomous Solve + Build Check + Git Push (Full File Context)
      server.middlewares.use('/api/auto-solve', async (req, res) => {
        if (req.method !== 'POST') return ((res.statusCode = 405), res.end('Method Not Allowed'));
        loadEnvLocal();
        ensureDataFiles();

        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { agentKey, agentName, problemSummary } = JSON.parse(body || '{}');
            const geminiKey = process.env.GEMINI_API_KEY;
            const groqKey = process.env.GROQ_API_KEY;

            const laporanPath = path.resolve('src/laporan.json');
            const laporan = JSON.parse(fs.readFileSync(laporanPath, 'utf-8'));

            laporan[agentKey] = { ...laporan[agentKey], ringkasan: `🛠️ Sedang menulis kode perbaikan...` };
            fs.writeFileSync(laporanPath, JSON.stringify(laporan, null, 2));

            const solvePrompt = `
Kamu adalah Fathiyyan (Frontend/Fullstack Dev) & Jehan (QA) membantu ${agentName} di YAFIZHAN AI LAB.
Tugasmu: Selesaikan masalah berikut secara nyata pada kode proyek lokal ini:
MASALAH: "${problemSummary}"

Berikut adalah ISI LENGKAP file yang diizinkan untuk dimodifikasi:
${getFullEditableContext()}

ATURAN KETAT AUTO-SOLVE:
1. Kamu HANYA BOLEH mengubah file yang ada dalam daftar ini: ${EDITABLE_FILES.join(', ')}. DILARANG menyentuh file di luar daftar tersebut.
2. Kembalikan ISI FILE UTUH dari baris pertama sampai baris terakhir yang sudah diperbaiki (DILARANG menyingkat kode dengan "// ... kode lainnya").
3. Pastikan semua import, tipe TypeScript, dan tag JSX valid sehingga perintah "npm run build" lulus 100% tanpa error.
4. Pertahankan seluruh fungsi yang sudah berjalan normal.

Kembalikan HANYA JSON valid dengan format:
{
  "commitMessage": "fix: deskripsi singkat perbaikan",
  "penjelasan": "Ringkasan perbaikan yang dilakukan (< 80 karakter)",
  "files": [
    { "filePath": "src/namaFile.tsx", "content": "isi lengkap file yang sudah diperbaiki" }
  ]
}`;

            const solution = await callLLM(solvePrompt, geminiKey, groqKey);
            if (!Array.isArray(solution.files) || solution.files.length === 0) {
              throw new Error('Agen tidak menghasilkan perubahan file yang valid.');
            }

            const modifiedFiles: string[] = [];
            for (const f of solution.files) {
              if (!f.filePath || !f.content) continue;
              const normalized = f.filePath.replace(/\\/g, '/');
              if (!EDITABLE_FILES.includes(normalized)) {
                throw new Error(`File tidak termasuk daftar yang diizinkan: ${normalized}`);
              }
              const fullPath = path.resolve(normalized);
              fs.writeFileSync(fullPath, f.content, 'utf-8');
              modifiedFiles.push(normalized);
            }

            if (modifiedFiles.length === 0) {
              throw new Error('Tidak ada file valid yang ditulis.');
            }

            laporan[agentKey] = { ...laporan[agentKey], ringkasan: `🔍 Jehan memvalidasi build & test...` };
            fs.writeFileSync(laporanPath, JSON.stringify(laporan, null, 2));

            try {
              execSync('npm run build', { stdio: 'pipe' });
            } catch {
              execSync(`git checkout -- ${modifiedFiles.join(' ')}`, { stdio: 'pipe' });
              appendLog({
                waktu: new Date().toLocaleTimeString('id-ID'),
                agen: agentName,
                aksi: 'ROLLBACK',
                status: 'GAGAL',
                ringkasan: 'Gagal lolos npm run build, perubahan dibatalkan otomatis.',
                files: modifiedFiles,
              });
              throw new Error('Gagal lolos npm run build, perubahan otomatis dibatalkan demi keamanan.');
            }

            const safeMsg = (solution.commitMessage || `fix: solved by ${agentName}`).replace(/"/g, "'");
            execSync(`git add ${modifiedFiles.join(' ')}`, { stdio: 'pipe' });
            execSync(`git commit -m "${safeMsg}"`, { stdio: 'pipe' });
            execSync('git push', { stdio: 'pipe' });

            const commitHash = execSync('git rev-parse --short HEAD').toString().trim();
            appendLog({
              waktu: new Date().toLocaleTimeString('id-ID'),
              agen: agentName,
              aksi: 'AUTO-SOLVE',
              status: 'SUKSES',
              ringkasan: solution.penjelasan,
              files: modifiedFiles,
              commitHash,
            });

            laporan[agentKey] = {
              ringkasan: `✅ Solved & Pushed: ${solution.penjelasan}`,
              angka: [{ label: 'File Diubah', nilai: `${modifiedFiles.length} file` }],
            };
            fs.writeFileSync(laporanPath, JSON.stringify(laporan, null, 2));

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, files: modifiedFiles, message: solution.penjelasan }));
          } catch (err: any) {
            console.error('❌ [/api/auto-solve ERROR]:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
          }
        });
      });

      // 3. Endpoint Stop & Reset Kantor ke Kondisi Awal
      server.middlewares.use('/api/reset-sprint', (req, res) => {
        if (req.method !== 'POST') return ((res.statusCode = 405), res.end('Method Not Allowed'));
        ensureDataFiles();
        sprintCancelled = true;
        fs.writeFileSync(path.resolve('src/laporan.json'), '{}', 'utf-8');
        fs.writeFileSync(path.resolve('src/laporanDetail.json'), '{}', 'utf-8');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), agentLabPlugin()],
});