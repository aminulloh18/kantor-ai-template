import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function loadEnvLocal() {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
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

async function fetchGithubContext(input: string, token?: string) {
  const match = input.match(/github\.com\/([^\/\s]+)\/([^\/\s#?]+)/);
  if (!match) return null;

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, '');
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
    .filter((f) => /\.(ts|tsx|js|jsx|py|json|md|html|css)$/i.test(f) && !/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.js)/i.test(f))
    .slice(0, 12);

  let codeBundle = `REPO: ${owner}/${repo} (${repoInfo.description || '-'})\nSTRUKTUR FILE:\n${allFiles.slice(0, 50).join('\n')}\n\nISI KODE:\n`;
  for (const filePath of selectedFiles) {
    const fileRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`, { headers });
    if (fileRes.ok) {
      const content = await fileRes.text();
      codeBundle += `\n--- FILE: ${filePath} ---\n${content.slice(0, 4000)}\n`;
    }
  }
  return { owner, repo, codeBundle };
}

async function callLLM(prompt: string, geminiKey?: string, groqKey?: string) {
  if (groqKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`Groq Error (${res.status})`);
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  }

  const models = ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-2.5-flash-lite'];
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
      }
      if (res.status === 503 || res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (res.status === 404) break;
      throw new Error(`Gemini Error (${res.status})`);
    }
  }
  throw new Error('Server LLM sedang padat (503). Coba lagi beberapa detik.');
}

function agentLabPlugin(): Plugin {
  return {
    name: 'yafizhan-ai-lab-api',
    configureServer(server) {
      server.middlewares.use('/api/run-sprint', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('Method Not Allowed');
        }

        loadEnvLocal();
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { prompt } = JSON.parse(body || '{}');
            if (!prompt) throw new Error('Instruksi tidak boleh kosong.');

            const geminiKey = process.env.GEMINI_API_KEY;
            const groqKey = process.env.GROQ_API_KEY;
            if (!geminiKey && !groqKey) throw new Error('GEMINI_API_KEY atau GROQ_API_KEY belum diset di .env');

            const laporanPath = path.resolve('src/laporan.json');
            const detailPath = path.resolve('src/laporanDetail.json');

            const githubData = await fetchGithubContext(prompt, process.env.GITHUB_TOKEN);
            const laporanLive: Record<string, any> = {};
            const detailLive: Record<string, string> = {};

            for (const a of AGENTS) {
              laporanLive[a.key] = { ringkasan: 'Menunggu giliran...' };
            }
            fs.writeFileSync(laporanPath, JSON.stringify(laporanLive, null, 2));

            for (const agen of AGENTS) {
              laporanLive[agen.key] = { ringkasan: `⏳ Sedang menganalisis...` };
              fs.writeFileSync(laporanPath, JSON.stringify(laporanLive, null, 2));

              const konteksKode = githubData ? `\nKode repo GitHub:\n${githubData.codeBundle}` : '';
              const promptAgen = `
Kamu adalah ${agen.nama}, ${agen.role} di YAFIZHAN AI LAB.
Fokus keahlianmu: ${agen.fokus}
Instruksi user: "${prompt}"
${konteksKode}

Kembalikan HANYA JSON valid dengan format persis:
{
  "ringkasan": "1 kalimat singkat (< 85 karakter) hasil kerjamu untuk gelembung di atas kepala",
  "menunggu": ["1 keputusan yang butuh persetujuan user (kosongkan [] jika tidak ada)"],
  "mendesak": ["1 temuan bug fatal / celah keamanan serius (kosongkan [] jika aman)"],
  "angka": [{ "label": "Metrik (2 kata)", "nilai": "Angka + satuan" }],
  "detailTeknis": "Hasil analisis/kode/rekomendasi lengkap & konkret dalam Bahasa Indonesia."
}`;

              try {
                const hasil = await callLLM(promptAgen, geminiKey, groqKey);
                laporanLive[agen.key] = {
                  ringkasan: hasil.ringkasan,
                  ...(hasil.menunggu?.length ? { menunggu: hasil.menunggu } : {}),
                  ...(hasil.mendesak?.length ? { mendesak: hasil.mendesak } : {}),
                  ...(hasil.angka?.length ? { angka: hasil.angka } : {}),
                };
                detailLive[agen.key] = hasil.detailTeknis || hasil.ringkasan;
              } catch (err: any) {
                laporanLive[agen.key] = { ringkasan: `❌ ${err.message}` };
                detailLive[agen.key] = `Terjadi kendala saat memproses: ${err.message}`;
              }

              fs.writeFileSync(laporanPath, JSON.stringify(laporanLive, null, 2));
              fs.writeFileSync(detailPath, JSON.stringify(detailLive, null, 2));
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), agentLabPlugin()],
});