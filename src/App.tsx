import { Suspense, lazy, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { GAYA, KANTOR, TAMPIL_PEMILIH_GAYA } from './config';
import { DAFTAR_GAYA, KUNCI_SIMPAN, cariGaya, gayaAwal, type GayaId } from './gaya/daftar';
import laporanDetail from './laporanDetail.json';
import { IDLE_LABEL, idleAt, isNight, isoDay, lapseAt, missionBoard, officeDesks, params as readParams, type DeskState, type IdleSpot } from './office';

const OfficeScene = lazy(() => import('./OfficeScene'));

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function App() {
  const p = useMemo(() => readParams(new URLSearchParams(location.search)), []);
  const [now, setNow] = useState(() => new Date());
  const [t, setT] = useState(0);
  const [open, setOpen] = useState<DeskState | null>(null);
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [cmdErr, setCmdErr] = useState<string | null>(null);
  const [showFullReport, setShowFullReport] = useState(false);

  const drive = useRef<((t: number) => void) | null>(null);
  const anchors = useRef(new Map<string, HTMLElement>());
  const boardAnchor = useRef<HTMLElement | null>(null);
  const [gaya, setGaya] = useState<GayaId>(() => {
    let simpanan: string | null = null;
    try {
      simpanan = localStorage.getItem(KUNCI_SIMPAN);
    } catch {
      /* penyimpanan diblokir: pakai config */
    }
    return gayaAwal(new URLSearchParams(location.search).get('gaya'), simpanan, GAYA);
  });
  const [pilihBuka, setPilihBuka] = useState(false);
  const gantiGaya = (id: GayaId) => {
    setGaya(id);
    setPilihBuka(false);
    try {
      localStorage.setItem(KUNCI_SIMPAN, id);
    } catch {
      /* abaikan */
    }
    const q = new URLSearchParams(location.search);
    q.set('gaya', id);
    history.replaceState(null, '', `${location.pathname}?${q}`);
  };
  const g = cariGaya(gaya);

  useEffect(() => {
    if (p.rec) {
      const w = window as unknown as { __koFrame?: (t: number) => boolean };
      w.__koFrame = (x: number) => {
        flushSync(() => setT(x));
        drive.current?.(x);
        return !!drive.current;
      };
      return () => void delete w.__koFrame;
    }
    const start = performance.now();
    const id = window.setInterval(() => {
      setT((performance.now() - start) / 1000);
      setNow(new Date());
    }, 100);
    return () => window.clearInterval(id);
  }, [p.rec]);

  const kirimPerintah = async (e: FormEvent) => {
    e.preventDefault();
    if (!cmd.trim() || busy) return;
    setBusy(true);
    setCmdErr(null);
    try {
      const res = await fetch('/api/run-sprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: cmd.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal menjalankan tugas');
      setCmd('');
    } catch (err: any) {
      setCmdErr(err.message);
    } finally {
      setBusy(false);
    }
  };

  const lapse = p.lapse ? lapseAt(t) : null;
  const time = lapse?.time ?? p.time ?? hm(now);
  const desks = officeDesks(isoDay(now), time, p.alwaysWork);
  const board = missionBoard(desks);
  const night = isNight(time);
  const withBubble = desks.filter((d) => d.bubble);
  const spotKey = withBubble.length ? withBubble[Math.floor(t / 2.5) % withBubble.length]!.desk.key : null;
  const working = desks.filter((d) => ['kerja', 'laporan', 'belajar'].includes(d.doing.activity)).length;
  const idle = desks.filter((d) => d.doing.activity === 'siaga').length;
  const latar = g.latar && (night ? g.latar.malam : g.latar.siang);
  const detailMap = laporanDetail as Record<string, string>;

  return (
    <div className="ko" data-night={night || !!g.malam || undefined} data-gaya={gaya} style={latar ? { background: latar } : undefined}>
      <div className="ko-stage">
        <Suspense fallback={<div className="ko-loading">Menyiapkan kantor…</div>}>
          <OfficeScene
            desks={desks}
            night={night}
            boardCount={Math.min(board.items.length, 8)}
            anchors={anchors}
            boardAnchor={boardAnchor}
            cinematic
            manual={p.rec}
            drive={drive}
            gaya={gaya}
          />
        </Suspense>
        {g.tiltShift && <div className="ko-tilt" aria-hidden="true" />}
        <div className="ko-layer">
          {desks.map((d) => (
            <Tag
              key={d.desk.key}
              d={d}
              spot={spotKey === d.desk.key}
              idle={d.doing.activity === 'siaga' ? idleAt(d.desk.key, t).spot : null}
              refFn={(el) => (el ? anchors.current.set(d.desk.key, el) : anchors.current.delete(d.desk.key))}
              onOpen={() => setOpen(d)}
            />
          ))}
          <span className="ko-board-pin" ref={(el) => void (boardAnchor.current = el)}>
            Mission Board
          </span>
        </div>
      </div>

      <header className="ko-hud">
        <div className="ko-brand">
          <span className="ko-live" />
          <div>
            <b>{KANTOR.nama}</b>
            <small>
              {KANTOR.subjudul} · {working} bekerja · {idle} santai · {board.items.length} misi
            </small>
          </div>
        </div>
        <div className="ko-clock">
          <b>{time.replace(':', '.')}</b>
          <small>
            {HARI[now.getDay()]}, {now.getDate()} {BULAN[now.getMonth()]} {now.getFullYear()}
          </small>
        </div>
      </header>

      {lapse && (!p.rec || lapse.inAct < 3) && (
        <p key={lapse.act} className="ko-act" style={p.rec ? { animation: 'none', opacity: Math.max(0, Math.min(1, lapse.inAct * 3, (3 - lapse.inAct) * 2)) } : undefined}>
          {lapse.title}
        </p>
      )}

      <aside className="ko-mini">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Mission Board</h2>
          {Object.keys(detailMap).length > 0 && (
            <button
              type="button"
              onClick={() => setShowFullReport(true)}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#3a86ff', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              📄 Laporan Lengkap
            </button>
          )}
        </div>
        <ul>
          {board.items.slice(0, 3).map((it, i) => (
            <li key={i}>
              <b style={{ color: it.color }}>{it.name}</b> {it.text}
            </li>
          ))}
        </ul>
        {board.metrics.length > 0 && (
          <dl>
            {board.metrics.slice(0, 4).map((m, i) => (
              <div key={i}>
                <dd>{m.nilai}</dd>
                <dt>{m.label}</dt>
              </div>
            ))}
          </dl>
        )}
      </aside>

      {/* COMMAND BAR INTERAKTIF DI LAYAR KANTOR */}
      {!p.rec && (
        <form
          onSubmit={kirimPerintah}
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
            display: 'flex',
            gap: 8,
            background: 'rgba(20, 22, 28, 0.88)',
            backdropFilter: 'blur(10px)',
            padding: '8px 12px',
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.14)',
            width: 'min(620px, 92vw)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
          }}
        >
          <input
            type="text"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            disabled={busy}
            placeholder={busy ? '⏳ Tim YAFIZHAN AI LAB sedang mengerjakan tugas...' : 'Beri perintah ke tim atau paste URL repo GitHub...'}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#fff',
              fontSize: 13,
            }}
          />
          <button
            type="submit"
            disabled={busy || !cmd.trim()}
            style={{
              background: busy ? '#555' : '#e4572e',
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Bekerja...' : 'Kirim Tugas'}
          </button>
        </form>
      )}

      {cmdErr && (
        <div
          style={{
            position: 'fixed',
            bottom: 68,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 45,
            background: '#c1121f',
            color: '#fff',
            padding: '6px 14px',
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          ⚠ {cmdErr}
        </div>
      )}

      {TAMPIL_PEMILIH_GAYA && !p.rec && (
        <nav className="ko-gaya" aria-label="Gaya 3D">
          {pilihBuka && (
            <ul>
              {DAFTAR_GAYA.map((x) => (
                <li key={x.id}>
                  <button type="button" aria-pressed={x.id === gaya} title={x.ket} onClick={() => gantiGaya(x.id as GayaId)}>
                    {x.nama}
                    {x.jenis === 'paduan' && <small>dunia</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="ko-gaya-btn" aria-expanded={pilihBuka} onClick={() => setPilihBuka((b) => !b)}>
            Gaya: {g.nama}
          </button>
        </nav>
      )}

      {/* MODAL DETAIL PER AGEN (KLIK NAMA AGEN DI KANTOR 3D) */}
      {open && (
        <div className="ko-sheet" role="dialog" aria-label={open.agen.nama} onClick={() => setOpen(null)}>
          <div className="ko-sheet-in" style={{ maxWidth: 640, maxHeight: '82vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3>
              {open.agen.nama} <small>{open.agen.tugas}</small>
            </h3>
            <p>
              Sekarang: <b>{open.doing.label}</b>
            </p>
            {open.bubble && <p className="ko-sheet-sum">{open.bubble}</p>}
            {open.urgent.length > 0 && <p className="ko-sheet-urgent">⚠ {open.urgent.join(' · ')}</p>}
            {open.waiting.length > 0 && (
              <ul>
                {open.waiting.map((w, i) => (
                  <li key={i}>⏳ {w}</li>
                ))}
              </ul>
            )}
            {detailMap[open.desk.key] && (
              <div style={{ marginTop: 12, padding: 12, background: 'rgba(0,0,0,0.06)', borderRadius: 10, fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                <b>📋 Hasil Kerja & Analisis {open.agen.nama}:</b>
                <div style={{ marginTop: 6 }}>{detailMap[open.desk.key]}</div>
              </div>
            )}
            <button type="button" style={{ marginTop: 12 }} onClick={() => setOpen(null)}>
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* MODAL REKAP LAPORAN SEMUA AGEN */}
      {showFullReport && (
        <div className="ko-sheet" role="dialog" aria-label="Laporan Lengkap Tim" onClick={() => setShowFullReport(false)}>
          <div className="ko-sheet-in" style={{ maxWidth: 760, maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3>📋 Laporan Hasil Kerja Tim — {KANTOR.nama}</h3>
            {desks.map((d) => (
              <div key={d.desk.key} style={{ marginTop: 14, paddingBottom: 12, borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                <b style={{ color: d.desk.color }}>
                  {d.agen.nama} ({d.agen.tugas})
                </b>
                <p style={{ fontSize: 13, margin: '4px 0', fontWeight: 600 }}>{d.bubble}</p>
                {detailMap[d.desk.key] && (
                  <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12.5, background: 'rgba(0,0,0,0.05)', padding: 10, borderRadius: 8, marginTop: 6 }}>
                    {detailMap[d.desk.key]}
                  </pre>
                )}
              </div>
            ))}
            <button type="button" style={{ marginTop: 14 }} onClick={() => setShowFullReport(false)}>
              Tutup Laporan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tag({ d, spot, idle, refFn, onOpen }: { d: DeskState; spot: boolean; idle: IdleSpot | null; refFn: (el: HTMLElement | null) => void; onOpen: () => void }) {
  const label = idle ? IDLE_LABEL[idle] : d.doing.label;
  const a = d.doing.activity;
  const think = a === 'kerja' ? '</>' : a === 'laporan' ? '•••' : a === 'belajar' ? '📖' : idle === 'kopi' ? '☕' : idle === 'papan' ? '📌' : idle === 'sofa' ? '💬' : null;
  return (
    <div className="ko-tag" ref={refFn} data-act={a} style={{ ['--agent' as string]: d.desk.color }}>
      <div className="ko-tag-in">
        {d.bubble && spot && a !== 'pulang' && <p className="ko-bubble">{d.bubble}</p>}
        {think && !(d.bubble && spot) && <span className="ko-think">{think}</span>}
        <div className="ko-tag-row">
          <button type="button" className="ko-name" onClick={onOpen}>
            <span className="ko-dot" />
            {d.agen.nama}
            <span className="ko-name-act">{label}</span>
          </button>
          {d.waiting.length > 0 && (
            <button type="button" className="ko-bang" onClick={onOpen} aria-label={`${d.waiting.length} butir menunggu keputusan`}>
              !
            </button>
          )}
          {d.urgent.length > 0 && <span className="ko-urgent">⚠</span>}
        </div>
      </div>
    </div>
  );
}