import { useState } from 'react';
import { X, User, Weight, Ruler, Heart, Calendar, Watch, Cog, Activity } from 'lucide-react';
import {
  loadProfile,
  saveProfile,
  loadConnectivity,
  effectiveMaxHr,
  type Profile as ProfileData,
  type Units,
} from '@/store/profile';

/** The avatar chip shown in the Home header. */
export function ProfileButton({ name, onClick }: { name: string; onClick: () => void }) {
  const initial = name.trim().charAt(0).toUpperCase() || 'A';
  return (
    <button className="profile-btn" onClick={onClick} aria-label="Profile">
      <span className="avatar">{initial}</span>
    </button>
  );
}

/** Full-screen profile / settings / connectivity overlay. */
export function Profile({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<ProfileData>(loadProfile());
  const conn = loadConnectivity();

  function update<K extends keyof ProfileData>(key: K, value: ProfileData[K]) {
    const next = { ...p, [key]: value };
    setP(next);
    saveProfile(next);
  }

  function numOrNull(v: string): number | null {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  const maxHr = effectiveMaxHr(p);

  return (
    <div className="overlay">
      <header className="overlay-head">
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={24} />
        </button>
        <h2>Profile</h2>
        <span style={{ width: 24 }} />
      </header>

      <div className="overlay-body">
        <div className="profile-hero">
          <span className="avatar avatar-lg">{(p.name[0] || 'A').toUpperCase()}</span>
          <input
            className="name-input"
            value={p.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Your name"
          />
        </div>

        <Section title="Personal data" icon={User}>
          <Field icon={Calendar} label="Birth date">
            <input
              type="date"
              value={p.birthDate ?? ''}
              onChange={(e) => update('birthDate', e.target.value || null)}
            />
          </Field>
          <Field icon={Weight} label="Weight (kg)">
            <input
              type="number"
              inputMode="decimal"
              value={p.weightKg ?? ''}
              onChange={(e) => update('weightKg', numOrNull(e.target.value))}
              placeholder="—"
            />
          </Field>
          <Field icon={Ruler} label="Height (cm)">
            <input
              type="number"
              inputMode="decimal"
              value={p.heightCm ?? ''}
              onChange={(e) => update('heightCm', numOrNull(e.target.value))}
              placeholder="—"
            />
          </Field>
        </Section>

        <Section title="Heart rate" icon={Heart}>
          <Field icon={Heart} label="Max HR">
            <input
              type="number"
              inputMode="numeric"
              value={p.maxHr ?? ''}
              onChange={(e) => update('maxHr', numOrNull(e.target.value))}
              placeholder={maxHr ? `${maxHr} (est.)` : 'auto'}
            />
          </Field>
          <Field icon={Activity} label="Resting HR">
            <input
              type="number"
              inputMode="numeric"
              value={p.restingHr ?? ''}
              onChange={(e) => update('restingHr', numOrNull(e.target.value))}
              placeholder="—"
            />
          </Field>
        </Section>

        <Section title="Connectivity" icon={Watch}>
          <div className="conn-row">
            <div className="source-icon">
              <Watch size={22} className="icon-grad" />
            </div>
            <div className="source-text">
              <span className="source-title">Galaxy Watch 4</span>
              <span className="muted small">
                {conn.healthConnectLinked ? 'Linked via Health Connect' : 'Not connected'}
              </span>
            </div>
            <button className="btn-sm" disabled>
              {conn.healthConnectLinked ? 'Manage' : 'Connect'}
            </button>
          </div>
          <p className="muted small conn-note">
            Watch sync uses Health Connect on Android. Wiring arrives with the backend phase.
          </p>
        </Section>

        <Section title="Settings" icon={Cog}>
          <Field icon={Cog} label="Units">
            <div className="seg">
              {(['metric', 'imperial'] as Units[]).map((u) => (
                <button
                  key={u}
                  className={`seg-opt ${p.units === u ? 'seg-opt-active' : ''}`}
                  onClick={() => update('units', u)}
                >
                  {u === 'metric' ? 'km' : 'mi'}
                </button>
              ))}
            </div>
          </Field>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: IconCmp,
  children,
}: {
  title: string;
  icon: typeof User;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <IconCmp size={18} className="icon-grad" />
        <h2>{title}</h2>
      </div>
      <div className="field-list">{children}</div>
    </section>
  );
}

function Field({
  icon: IconCmp,
  label,
  children,
}: {
  icon: typeof User;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        <IconCmp size={16} className="muted" />
        {label}
      </span>
      <span className="field-control">{children}</span>
    </label>
  );
}
