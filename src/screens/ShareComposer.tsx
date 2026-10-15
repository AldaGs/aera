import { useEffect, useMemo, useState } from 'react';
import { X, ShareNetwork, DownloadSimple, Image } from '@phosphor-icons/react';
import { getWorkout } from '@/db/db';
import type { Workout } from '@/model/workout';
import { loadProfile } from '@/store/profile';
import {
  TEMPLATES,
  renderShareCard,
  svgToPngBlob,
  type Template,
} from '@/share/renderShareCard';
import { saveFile, shareOrDownloadFile } from '@/share/shareImage';
import { SavingOrb } from '@/ui/SavingOrb';

export function ShareComposer({ id, onClose }: { id: string; onClose: () => void }) {
  const [w, setW] = useState<Workout | undefined>();
  const [template, setTemplate] = useState<Template>('story');
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    getWorkout(id).then(setW);
  }, [id]);

  const spec = TEMPLATES.find((t) => t.id === template)!;
  const athlete = loadProfile().name;

  const svg = useMemo(
    () => (w ? renderShareCard(w, spec, athlete, transparent) : ''),
    [w, spec, athlete, transparent],
  );

  async function exportPng(save = false) {
    if (!w || busy) return;
    setBusy(true);
    try {
      const blob = await svgToPngBlob(svg, spec.w, spec.h);
      const safe = w.title.replace(/[^\w]+/g, '-').toLowerCase();
      // Timestamped so a re-save never collides with (or fails to overwrite) an older copy.
      const name = `aera-${safe}-${Date.now()}.png`;
      if (save) {
        setToast(await saveFile(blob, name));
        return;
      }
      const result = await shareOrDownloadFile(blob, name);
      setToast(result === 'shared' ? 'Shared' : 'Saved PNG');
    } catch {
      setToast('Export failed');
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 2200);
    }
  }

  return (
    <div className="overlay">
      <header className="overlay-head">
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={24} />
        </button>
        <h2>Share</h2>
        <span style={{ width: 24 }} />
      </header>

      <div className="overlay-body share-body">
        {!w ? (
          <p className="muted center">Loading…</p>
        ) : (
          <>
            <div className={`share-preview share-preview-${template}${transparent ? ' share-preview-clear' : ''}`}>
              <div
                className="share-svg"
                // Same SVG as the exported PNG, scaled to fit.
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              {busy && <SavingOrb />}
            </div>

            <div className="range-toggle share-templates">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className={`range-opt ${template === t.id ? 'range-opt-active' : ''}`}
                  onClick={() => setTemplate(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="range-toggle share-templates">
              <button
                className={`range-opt ${!transparent ? 'range-opt-active' : ''}`}
                onClick={() => setTransparent(false)}
              >
                Background
              </button>
              <button
                className={`range-opt ${transparent ? 'range-opt-active' : ''}`}
                onClick={() => setTransparent(true)}
              >
                Transparent
              </button>
            </div>

            <button className="btn" onClick={() => exportPng()} disabled={busy}>
              <ShareNetwork size={18} /> {busy ? 'Preparing…' : 'Share'}
            </button>
            <button className="btn-ghost" onClick={() => exportPng(true)} disabled={busy}>
              <DownloadSimple size={18} /> Save PNG
            </button>

            <p className="muted small center share-hint">
              <Image size={14} /> On mobile, Share opens Instagram Stories and the
              rest of the share sheet.
            </p>
          </>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
