"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { createClient } from "../utils/supabase/client.js";

/* ============================================================================
   RIG DAILY — Training, Laufen, Seilspringen
   Einzeldatei-MVP. Aufbau der Datei:
     1  Design-Tokens
     2  Hilfsfunktionen
     3  Übungsdatenbank
     4  Speicher-Schicht (window.storage + In-Memory-Fallback)
     5  Datenmodell: Aggregation, Rekorde, Streak
     6  UI-Bausteine
     7  Screens
     8  App (State, Navigation, Persistenz)
   ========================================================================== */

/* ---------------------------------------------------------------- 1 TOKENS */
/* Palette aus der Hantelscheiben-Norm: 15 kg gelb, 25 kg rot, 20 kg blau,
   10 kg grün. Gelb führt, die anderen kodieren Trainingsart. */
const PLATE = { yellow: "#F2C230", red: "#D6402F", blue: "#2E6FD6", green: "#3FA45B" };

const DARK = {
  bg: "#101218", panel: "#191C24", panel2: "#212530", line: "#2B303C",
  text: "#EFEDE7", muted: "#878D9C", chalk: "#EFEDE7", ...PLATE,
};
const LIGHT = {
  bg: "#F4F2ED", panel: "#FFFFFF", panel2: "#EAE7E0", line: "#DBD7CD",
  text: "#15181F", muted: "#6C7280", chalk: "#15181F", ...PLATE,
};

const FONT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');
* { -webkit-tap-highlight-color: transparent; }
.rig { font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
.rig-display { font-family: "Barlow Condensed", "Arial Narrow", system-ui, sans-serif;
  text-transform: uppercase; letter-spacing: .02em; font-weight: 700; line-height: 1; }
.rig-num { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.rig-scroll::-webkit-scrollbar { display: none; }
.rig-scroll { scrollbar-width: none; }
.rig-fade { animation: rigFade .22s ease-out both; }
@keyframes rigFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.rig-sheet { animation: rigUp .26s cubic-bezier(.2,.8,.25,1) both; }
@keyframes rigUp { from { transform: translateY(24px); opacity: .4 } to { transform: none; opacity: 1 } }
.rig-pulse { animation: rigPulse 1.6s ease-in-out infinite; }
@keyframes rigPulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
button:focus-visible, input:focus-visible { outline: 2px solid ${PLATE.yellow}; outline-offset: 2px; }
input { font-size: 16px; }
@media (prefers-reduced-motion: reduce) {
  .rig-fade, .rig-sheet, .rig-pulse { animation: none !important; }
}
`;

/* ------------------------------------------------------------- 2 HELPERS  */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, "0");
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function fmtMin(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
const DE_MONTH = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
const DE_DAY = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()}. ${DE_MONTH[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDayShort(ts) {
  const d = new Date(ts);
  return `${DE_DAY[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
}
function relDay(ts) {
  const a = dayKey(ts), t = dayKey(Date.now());
  if (a === t) return "Heute";
  if (a === dayKey(Date.now() - DAY)) return "Gestern";
  return fmtDate(ts);
}
const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const nf = (n, d = 0) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

function paceStr(sec, km) {
  if (!km || km < 0.01 || !sec) return "–";
  const p = sec / km;
  return `${Math.floor(p / 60)}:${pad(Math.round(p % 60))}`;
}
function haversine(a, b) {
  const R = 6371, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
/* Video-Call-Räume: rein aus den Benutzernamen berechnet, kein Server nötig.
   Beide Seiten landen ohne Absprache im selben Jitsi-Raum. */
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
function roomFor1v1(a, b) {
  return "rigdaily-" + [slug(a), slug(b)].sort().join("-");
}
function roomForTeam(owner) {
  return "rigdaily-team-" + slug(owner);
}

function beep() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; o.type = "sine";
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch { /* Ton nicht verfügbar – kein Grund abzubrechen */ }
  try { navigator.vibrate?.([120, 60, 120]); } catch { /* ignorieren */ }
}

/* ------------------------------------------------------- 3 ÜBUNGSDATENBANK */
/* type: "reps" = Körpergewicht (nur Wdh.), "weight" = Wdh. + kg, "time" = Sekunden */
const CATS = ["Brust", "Rücken", "Beine", "Schultern", "Arme", "Bauch", "Ganzkörper"];
const BASE_EX = [
  ["Liegestütze", "Brust", "reps"], ["Bankdrücken", "Brust", "weight"], ["Dips", "Brust", "reps"],
  ["Breite Liegestütze", "Brust", "reps"], ["Kurzhantel-Fliegende", "Brust", "weight"],
  ["Klimmzüge", "Rücken", "reps"], ["Chin-ups", "Rücken", "reps"], ["Rudern", "Rücken", "weight"],
  ["Australian Pull-ups", "Rücken", "reps"], ["Kreuzheben", "Rücken", "weight"],
  ["Kniebeugen", "Beine", "reps"], ["Langhantel-Kniebeugen", "Beine", "weight"],
  ["Ausfallschritte", "Beine", "reps"], ["Bulgarian Split Squats", "Beine", "reps"],
  ["Wadenheben", "Beine", "reps"], ["Pistol Squats", "Beine", "reps"],
  ["Schulterdrücken", "Schultern", "weight"], ["Seitheben", "Schultern", "weight"],
  ["Frontheben", "Schultern", "weight"], ["Pike Push-ups", "Schultern", "reps"],
  ["Bizeps-Curls", "Arme", "weight"], ["Hammer Curls", "Arme", "weight"],
  ["Trizeps Extensions", "Arme", "weight"], ["Trizeps-Dips", "Arme", "reps"],
  ["Sit-ups", "Bauch", "reps"], ["Crunches", "Bauch", "reps"], ["Leg Raises", "Bauch", "reps"],
  ["Plank", "Bauch", "time"], ["Hollow Hold", "Bauch", "time"],
  ["Burpees", "Ganzkörper", "reps"], ["Mountain Climbers", "Ganzkörper", "reps"],
  ["Jumping Jacks", "Ganzkörper", "reps"], ["Kettlebell Swings", "Ganzkörper", "weight"],
].map(([name, category, type]) => ({ id: "b_" + name.toLowerCase().replace(/[^a-z]/g, ""), name, category, type, custom: false }));

/* --------------------------------------------------------- 4 SPEICHER      */
/* Zwei Schichten, ein Interface (S):
     Local  – window.storage (bzw. In-Memory als Notnagel). Sofort da, funktioniert
              immer, aber gerätegebunden.
     Cloud  – Supabase, mit echter Auth-Session (E-Mail + Passwort). Sobald man
              angemeldet ist, spiegelt jeder Zugriff zusätzlich in eine Postgres-
              Tabelle – damit das Konto geräteübergreifend funktioniert und die
              Daten auch nach dem Schließen des Tabs weiterleben.
   Schema (bereits im Supabase-Projekt per Migration angelegt):

     create table public.rig_kv (
       owner text not null default '',
       key text not null,
       shared boolean not null default false,
       value jsonb not null,
       updated_at timestamptz not null default now(),
       primary key (owner, key, shared)
     );
     create table public.profiles (
       id uuid primary key references auth.users(id) on delete cascade,
       username text not null unique,
       emoji text not null default '🦍',
       created_at timestamptz not null default now()
     );
     -- RLS: rig_kv nur für authentifizierte Nutzer, private Zeilen nur für den
     -- Owner (auth.uid()), geteilte Zeilen (shared = true) für alle Angemeldeten.
     -- profiles: für alle lesbar (auch anonym, für die Verfügbarkeitsprüfung beim
     -- Registrieren), aber nur die eigene Zeile schreibbar.

   "owner" trennt private Daten (Profil-Einstellungen, Workouts, …) pro Konto –
   und ist ab jetzt die auth.uid() des Besitzers, nicht mehr der Benutzername.
   Öffentliche Zeilen (Rangliste, Freundschaften) tragen owner = "" und sind über
   den Key selbst schon eindeutig (z. B. board:max). */
const memStore = new Map();
const mk = (k, s) => (s ? "S::" : "P::") + k;

const Local = {
  available: typeof window !== "undefined" && !!window.storage,
  async get(key, shared = false) {
    if (window.storage) {
      try {
        const r = await window.storage.get(key, shared);
        return r?.value ? JSON.parse(r.value) : null;
      } catch { return memStore.has(mk(key, shared)) ? memStore.get(mk(key, shared)) : null; }
    }
    return memStore.get(mk(key, shared)) ?? null;
  },
  async set(key, value, shared = false) {
    memStore.set(mk(key, shared), value);
    if (window.storage) {
      try { await window.storage.set(key, JSON.stringify(value), shared); return true; }
      catch { return false; }
    }
    return true;
  },
  async del(key, shared = false) {
    memStore.delete(mk(key, shared));
    if (window.storage) { try { await window.storage.delete(key, shared); } catch { return false; } }
    return true;
  },
  async keys(prefix, shared = false) {
    if (window.storage) {
      try {
        const r = await window.storage.list(prefix, shared);
        if (r?.keys) return r.keys;
      } catch { /* Fallback unten */ }
    }
    return [...memStore.keys()].filter((k) => k.startsWith(mk(prefix, shared))).map((k) => k.slice(3));
  },
};

/* --- Supabase Auth + Cloud -------------------------------------------- */
const supabase = createClient();

let session = null; // aktuelle Auth-Session – wird von App() über onAuthStateChange gepflegt
let cloudStatus = "unconfigured"; // unconfigured | ok | error
const cloudListeners = new Set();
const setCloudStatus = (s) => { cloudStatus = s; cloudListeners.forEach((fn) => fn(s)); };

const Cloud = {
  async get(key, shared, owner = "") {
    const { data, error } = await supabase
      .from("rig_kv").select("value")
      .eq("key", key).eq("shared", shared).eq("owner", owner)
      .maybeSingle();
    if (error) throw error;
    return data?.value ?? null;
  },
  async set(key, value, shared, owner = "") {
    const { error } = await supabase
      .from("rig_kv")
      .upsert({ owner, key, shared, value, updated_at: new Date().toISOString() }, { onConflict: "owner,key,shared" });
    if (error) throw error;
  },
  async del(key, shared, owner = "") {
    const { error } = await supabase.from("rig_kv").delete().eq("key", key).eq("shared", shared).eq("owner", owner);
    if (error) throw error;
  },
  async keys(prefix, shared, owner = "") {
    let q = supabase.from("rig_kv").select("key").eq("shared", shared).like("key", `${prefix}%`);
    if (!shared) q = q.eq("owner", owner);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((r) => r.key);
  },
  /* Registrierungs-/Freunde-Suche über das öffentliche Namensregister. */
  async usernameTaken(username) {
    const { data, error } = await supabase.from("profiles").select("id").ilike("username", username).maybeSingle();
    if (error) throw error;
    return !!data;
  },
  async findUsernames(term, excludeId) {
    let q = supabase.from("profiles").select("username, emoji, created_at").ilike("username", `%${term}%`).limit(12);
    if (excludeId) q = q.neq("id", excludeId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async getProfileRow(id) {
    const { data, error } = await supabase.from("profiles").select("username, emoji, created_at").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async upsertProfileRow(id, username, emoji) {
    const { error } = await supabase.from("profiles").upsert({ id, username, emoji });
    if (error) throw error;
  },
};

/* S = einheitliche Fassade, die der Rest der App benutzt. Lesen: lokal zuerst
   (sofort da), bei aktiver Session danach still mit dem Server abgleichen.
   Schreiben: immer lokal, bei aktiver Session zusätzlich (best effort – schlägt
   der Cloud-Schreibvorgang fehl, bleibt die App trotzdem benutzbar). */
const S = {
  configured: () => !!session,
  status: () => cloudStatus,
  onStatus(fn) { cloudListeners.add(fn); return () => cloudListeners.delete(fn); },
  setSession(s) { session = s; setCloudStatus(s ? "ok" : "unconfigured"); },
  async get(key, shared = false, owner = "") {
    const local = await Local.get(key, shared);
    if (S.configured()) {
      try {
        const remote = await Cloud.get(key, shared, owner);
        if (remote != null) { await Local.set(key, remote, shared); setCloudStatus("ok"); return remote; }
        setCloudStatus("ok");
      } catch { setCloudStatus("error"); }
    }
    return local;
  },
  async set(key, value, shared = false, owner = "") {
    await Local.set(key, value, shared);
    if (S.configured()) { try { await Cloud.set(key, value, shared, owner); setCloudStatus("ok"); } catch { setCloudStatus("error"); } }
    return true;
  },
  async del(key, shared = false, owner = "") {
    await Local.del(key, shared);
    if (S.configured()) { try { await Cloud.del(key, shared, owner); setCloudStatus("ok"); } catch { setCloudStatus("error"); } }
    return true;
  },
  async keys(prefix, shared = false, owner = "") {
    if (S.configured()) { try { const r = await Cloud.keys(prefix, shared, owner); setCloudStatus("ok"); return r; } catch { setCloudStatus("error"); } }
    return Local.keys(prefix, shared);
  },
};

/* Holt einen kompletten Datensatz aus der Cloud – für Login auf neuem Gerät und
   für den stillen Abgleich beim Start. owner ist die auth.uid() des Kontos. */
async function pullAll(owner) {
  const [profile, workouts, runs, ropes, custom, prs, profileRow] = await Promise.all([
    Cloud.get(K.profile, false, owner).catch(() => null),
    Cloud.get(K.workouts, false, owner).catch(() => null),
    Cloud.get(K.runs, false, owner).catch(() => null),
    Cloud.get(K.ropes, false, owner).catch(() => null),
    Cloud.get(K.custom, false, owner).catch(() => null),
    Cloud.get(K.prs, false, owner).catch(() => null),
    Cloud.getProfileRow(owner).catch(() => null),
  ]);
  const social = profileRow ? await Cloud.get(K.social(profileRow.username), true, "").catch(() => null) : null;
  const merged = profileRow ? { ...profile, username: profileRow.username, emoji: profileRow.emoji } : profile;
  return { profile: merged, workouts, runs, ropes, custom, prs, social };
}

const K = {
  profile: "profile",
  workouts: "log:workouts",
  runs: "log:runs",
  ropes: "log:rope",
  custom: "custom:exercises",
  prs: "log:prs",
  active: "active:workout",
  board: (u) => `board:${u}`,
  social: (u) => `social:${u}`,
};

/* ------------------------------------------- 5 AGGREGATION / REKORDE / STREAK */
function workoutTotals(w) {
  let reps = 0, volume = 0, sets = 0, sec = 0;
  for (const ex of w.exercises || []) {
    for (const st of ex.sets) {
      sets++;
      if (ex.type === "time") sec += st.sec || 0;
      else {
        reps += st.reps || 0;
        if (ex.type === "weight") volume += (st.reps || 0) * (st.weight || 0);
      }
    }
  }
  return { reps, volume, sets, holdSec: sec };
}

function aggregate(workouts, runs, ropes) {
  const t = { workouts: workouts.length, reps: 0, volume: 0, sets: 0, seconds: 0, km: 0, runs: runs.length, runSec: 0, jumps: 0, ropeSec: 0 };
  const perExercise = {};
  for (const w of workouts) {
    const tot = workoutTotals(w);
    t.reps += tot.reps; t.volume += tot.volume; t.sets += tot.sets; t.seconds += w.durationSec || 0;
    for (const ex of w.exercises || []) {
      const r = ex.sets.reduce((a, s) => a + (ex.type === "time" ? 0 : s.reps || 0), 0);
      perExercise[ex.name] = (perExercise[ex.name] || 0) + r;
    }
  }
  for (const r of runs) { t.km += r.distanceKm || 0; t.runSec += r.durationSec || 0; }
  for (const j of ropes) { t.jumps += j.totalJumps || 0; t.ropeSec += j.durationSec || 0; }
  return { ...t, perExercise };
}

function activeDays(workouts, runs, ropes) {
  const s = new Set();
  workouts.forEach((w) => s.add(dayKey(w.startedAt)));
  runs.forEach((r) => s.add(dayKey(r.date)));
  ropes.forEach((r) => s.add(dayKey(r.date)));
  return s;
}
function computeStreak(days) {
  if (!days.size) return 0;
  let cur = Date.now();
  if (!days.has(dayKey(cur))) {
    cur -= DAY;
    if (!days.has(dayKey(cur))) return 0;
  }
  let n = 0;
  while (days.has(dayKey(cur))) { n++; cur -= DAY; }
  return n;
}

/* Erkennt neue Bestleistungen und gibt {prs, neu[]} zurück. */
function detectPRs(prev, workout) {
  const prs = { ...prev }, neu = [];
  for (const ex of workout.exercises || []) {
    const cur = prs[ex.name] || { maxReps: 0, maxWeight: 0, maxHold: 0, bestSetVolume: 0 };
    const next = { ...cur };
    for (const st of ex.sets) {
      if (ex.type === "time") {
        if ((st.sec || 0) > next.maxHold) { next.maxHold = st.sec; neu.push(`${ex.name}: ${fmtClock(st.sec)} gehalten`); }
      } else {
        if ((st.reps || 0) > next.maxReps) { next.maxReps = st.reps; neu.push(`${ex.name}: ${st.reps} Wiederholungen`); }
        if (ex.type === "weight") {
          if ((st.weight || 0) > next.maxWeight) { next.maxWeight = st.weight; neu.push(`${ex.name}: ${nf(st.weight, 1)} kg`); }
          const v = (st.reps || 0) * (st.weight || 0);
          if (v > next.bestSetVolume) next.bestSetVolume = v;
        }
      }
    }
    next.date = Date.now();
    prs[ex.name] = next;
  }
  return { prs, neu };
}

function buildBoardEntry(profile, workouts, runs, ropes) {
  const a = aggregate(workouts, runs, ropes);
  const streak = computeStreak(activeDays(workouts, runs, ropes));
  const p = profile.privacy;
  return {
    username: profile.username, emoji: profile.emoji, updatedAt: Date.now(),
    streak, workouts: a.workouts, reps: a.reps, minutes: Math.round(a.seconds / 60),
    volume: Math.round(a.volume),
    km: p.runsPublic ? Number(a.km.toFixed(2)) : 0,
    jumps: a.jumps,
    perExercise: a.perExercise,
    share: { profile: p.profilePublic, workouts: p.workoutsPublic, runs: p.runsPublic },
  };
}

/* -------------------------------------------------------- 6 UI-BAUSTEINE   */
const ThemeCtx = React.createContext(DARK);
const useT = () => React.useContext(ThemeCtx);
const CallCtx = React.createContext({ startCall: () => {} });

function Card({ children, style, onClick, className = "" }) {
  const T = useT();
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl ${onClick ? "cursor-pointer" : ""} ${className}`}
      style={{ background: T.panel, border: `1px solid ${T.line}`, ...style }}
    >
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "solid", tone = PLATE.yellow, disabled, style, className = "", type = "button" }) {
  const T = useT();
  const base = {
    borderRadius: 14, fontWeight: 600, transition: "transform .12s ease, opacity .12s ease",
    opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer",
  };
  const looks = {
    solid: { background: tone, color: "#14161B", border: "1px solid transparent" },
    ghost: { background: "transparent", color: T.text, border: `1px solid ${T.line}` },
    quiet: { background: T.panel2, color: T.text, border: "1px solid transparent" },
    danger: { background: "transparent", color: PLATE.red, border: `1px solid ${PLATE.red}` },
  };
  return (
    <button
      type={type} disabled={disabled} onClick={onClick}
      className={`px-4 py-3 text-sm active:scale-95 ${className}`}
      style={{ ...base, ...looks[variant], ...style }}
    >
      {children}
    </button>
  );
}

function Eyebrow({ children, color }) {
  const T = useT();
  return (
    <div className="rig-display text-xs mb-2" style={{ color: color || T.muted, letterSpacing: ".12em" }}>
      {children}
    </div>
  );
}

function Stat({ label, value, unit, color }) {
  const T = useT();
  return (
    <div>
      <div className="rig-num text-2xl" style={{ color: color || T.text }}>
        {value}
        {unit && <span className="text-xs ml-1" style={{ color: T.muted }}>{unit}</span>}
      </div>
      <div className="text-xs mt-1" style={{ color: T.muted }}>{label}</div>
    </div>
  );
}

/* Signatur: Strichliste. Vier Striche, der fünfte quer. */
function Tally({ count, color, size = 22, max = 60 }) {
  const shown = Math.min(count, max);
  const groups = Math.floor(shown / 5), rest = shown % 5;
  const w = size * 0.62, h = size;
  const strokes = [];
  for (let g = 0; g < groups; g++) strokes.push(5);
  if (rest) strokes.push(rest);
  return (
    <div className="flex flex-wrap items-end" style={{ gap: size * 0.42 }}>
      {strokes.map((n, i) => (
        <svg key={i} width={w} height={h} viewBox="0 0 14 22" style={{ overflow: "visible" }}>
          {[0, 1, 2, 3].slice(0, Math.min(n, 4)).map((k) => (
            <line key={k} x1={1.5 + k * 3.6} y1="1" x2={1.5 + k * 3.6} y2="21"
              stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          ))}
          {n === 5 && <line x1="-1.5" y1="19" x2="14" y2="3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />}
        </svg>
      ))}
      {count > max && <span className="rig-num text-xs" style={{ color }}>+{count - max}</span>}
    </div>
  );
}

function Sheet({ open, onClose, title, children, full }) {
  const T = useT();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(6,7,10,.66)" }} onClick={onClose}>
      <div
        className="rig-sheet w-full rig-scroll"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.bg, maxWidth: 480, maxHeight: full ? "94vh" : "84vh", overflowY: "auto",
          borderTopLeftRadius: 24, borderTopRightRadius: 24, border: `1px solid ${T.line}`, borderBottom: "none",
        }}
      >
        <div className="sticky top-0 z-10 px-5 pt-4 pb-3 flex items-center justify-between"
          style={{ background: T.bg, borderBottom: `1px solid ${T.line}` }}>
          <div className="rig-display text-xl" style={{ color: T.text }}>{title}</div>
          <button onClick={onClose} className="rig-num text-sm px-3 py-1 rounded-full"
            style={{ background: T.panel2, color: T.muted }}>Schließen</button>
        </div>
        <div className="px-5 pb-8 pt-4">{children}</div>
      </div>
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  const T = useT();
  return (
    <div className="flex rig-scroll overflow-x-auto gap-1 p-1 rounded-xl" style={{ background: T.panel2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)}
            className="px-3 py-2 text-xs rounded-lg whitespace-nowrap"
            style={{ background: on ? T.panel : "transparent", color: on ? T.text : T.muted, fontWeight: on ? 600 : 500, border: on ? `1px solid ${T.line}` : "1px solid transparent" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function NumberField({ value, onChange, min = 0, max = 9999, step = 1, suffix, width = 92 }) {
  const T = useT();
  const set = (v) => onChange(clamp(Number(v.toFixed ? v.toFixed(2) : v), min, max));
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => set(value - step)} className="rig-num w-9 h-9 rounded-lg active:scale-90"
        style={{ background: T.panel2, color: T.text }}>–</button>
      <div className="relative">
        <input
          inputMode="decimal" value={value}
          onChange={(e) => {
            const raw = e.target.value.replace(",", ".");
            if (raw === "") return onChange(0);
            const n = Number(raw);
            if (!Number.isNaN(n)) onChange(clamp(n, min, max));
          }}
          className="rig-num text-center py-2 rounded-lg"
          style={{ width, background: T.panel2, color: T.text, border: `1px solid ${T.line}` }}
        />
        {suffix && <span className="absolute right-2 top-2 text-xs" style={{ color: T.muted }}>{suffix}</span>}
      </div>
      <button onClick={() => set(value + step)} className="rig-num w-9 h-9 rounded-lg active:scale-90"
        style={{ background: T.panel2, color: T.text }}>+</button>
    </div>
  );
}

function Toast({ toast }) {
  const T = useT();
  if (!toast) return null;
  const tone = toast.kind === "error" ? PLATE.red : toast.kind === "pr" ? PLATE.yellow : T.panel;
  const fg = toast.kind === "pr" ? "#14161B" : T.text;
  return (
    <div className="fixed left-0 right-0 z-[60] flex justify-center px-4" style={{ bottom: 88 }}>
      <div className="rig-fade px-4 py-3 rounded-xl text-sm max-w-md w-full"
        style={{ background: tone, color: fg, border: `1px solid ${T.line}`, boxShadow: "0 12px 30px rgba(0,0,0,.35)" }}>
        {toast.title && <div className="rig-display text-sm mb-1">{toast.title}</div>}
        <div style={{ opacity: toast.title ? 0.85 : 1 }}>{toast.msg}</div>
      </div>
    </div>
  );
}

function CallSheet({ call, onClose }) {
  const T = useT();
  if (!call) return null;
  const src = `https://meet.jit.si/${call.room}#config.prejoinPageEnabled=false&config.startWithVideoMuted=false&userInfo.displayName="${encodeURIComponent(call.me)}"`;
  return (
    <div className="fixed inset-0 z-[70] flex flex-col rig-fade" style={{ background: "#000" }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ background: T.panel, borderBottom: `1px solid ${T.line}` }}>
        <div className="text-sm" style={{ color: T.text }}>{call.label}</div>
        <button onClick={onClose} className="rig-num text-xs px-3 py-2 rounded-lg" style={{ background: PLATE.red, color: "#fff" }}>Auflegen</button>
      </div>
      <iframe
        title="Video-Call" src={src}
        allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
        style={{ flex: 1, border: "none", width: "100%" }}
      />
    </div>
  );
}

function Empty({ title, hint, action }) {
  const T = useT();
  return (
    <div className="text-center py-10 px-6">
      <div className="rig-display text-lg mb-2" style={{ color: T.text }}>{title}</div>
      <div className="text-sm mb-4" style={{ color: T.muted }}>{hint}</div>
      {action}
    </div>
  );
}

/* --------------------------------------------------------- 7 SCREENS       */

/* --- Onboarding --------------------------------------------------------- */
const EMOJIS = ["🦍", "🔥", "🪨", "⚡", "🐺", "🦅", "🥋", "🧗", "🏃", "🪢", "💪", "🦈"];

const defaultSettings = () => ({
  theme: "dark", restDefault: 90, weeklyGoal: 4,
  privacy: { profilePublic: true, workoutsPublic: true, leaderboard: true, runsPublic: true },
});

function Onboarding({ onDone, onLogin }) {
  const T = useT();
  const [mode, setMode] = useState("new"); // new | login
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emoji, setEmoji] = useState("🦍");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submitNew = async () => {
    const u = name.trim();
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(u)) return setErr("3–16 Zeichen, nur Buchstaben, Zahlen und _");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("Gültige E-Mail-Adresse eingeben.");
    if (password.length < 6) return setErr("Passwort braucht mindestens 6 Zeichen.");
    setBusy(true); setErr(""); setInfo("");
    try {
      const taken = await Cloud.usernameTaken(u);
      if (taken) { setBusy(false); return setErr("Der Benutzername ist schon vergeben. Nimm einen anderen."); }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password, options: { data: { username: u, emoji } },
      });
      if (error) { setBusy(false); return setErr(error.message); }
      if (data.session) {
        await Cloud.upsertProfileRow(data.session.user.id, u, emoji);
        setBusy(false);
        onDone({ username: u, emoji, createdAt: Date.now(), ...defaultSettings() }, data.session);
      } else {
        setBusy(false);
        setMode("login");
        setInfo(`Bestätigungslink an ${email.trim()} geschickt. Danach hier mit E-Mail und Passwort anmelden.`);
      }
    } catch (e) {
      setBusy(false); setErr(e?.message || "Unbekannter Fehler.");
    }
  };

  const submitLogin = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("Gültige E-Mail-Adresse eingeben.");
    if (!password) return setErr("Passwort eingeben.");
    setBusy(true); setErr(""); setInfo("");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) { setBusy(false); return setErr(error.message); }
      const uid = data.session.user.id;
      let row = await Cloud.getProfileRow(uid).catch(() => null);
      if (!row) {
        const meta = data.session.user.user_metadata || {};
        const uname = meta.username || `nutzer${uid.slice(0, 6)}`;
        const em = meta.emoji || "🦍";
        await Cloud.upsertProfileRow(uid, uname, em);
        row = { username: uname, emoji: em };
      }
      const pulled = await pullAll(uid);
      const profile = pulled.profile && pulled.profile.theme
        ? pulled.profile
        : { username: row.username, emoji: row.emoji, createdAt: Date.now(), ...defaultSettings() };
      setBusy(false);
      onLogin({ ...pulled, profile, session: data.session });
    } catch (e) {
      setBusy(false); setErr(e?.message || "Unbekannter Fehler.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-6" style={{ background: T.bg }}>
      <div className="rig-fade">
        <Tally count={5} color={PLATE.yellow} size={34} />
        <div className="rig-display mt-5" style={{ color: T.text, fontSize: 46, lineHeight: .92 }}>
          Rig<br />Daily
        </div>
        <div className="text-sm mt-4 mb-6" style={{ color: T.muted }}>
          Jeder Satz ein Strich. Trag dich ein, dann steht dein erstes Training in einer Minute.
        </div>

        <div className="mb-5">
          <Segmented value={mode} onChange={(v) => { setMode(v); setErr(""); setInfo(""); }}
            options={[{ value: "new", label: "Neues Konto" }, { value: "login", label: "Anmelden" }]} />
        </div>

        <Eyebrow>E-Mail</Eyebrow>
        <input
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@example.com" type="email"
          className="w-full px-4 py-3 rounded-xl mb-4"
          style={{ background: T.panel, color: T.text, border: `1px solid ${T.line}` }}
        />
        <Eyebrow>Passwort</Eyebrow>
        <input
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mindestens 6 Zeichen" type="password"
          className="w-full px-4 py-3 rounded-xl mb-6"
          style={{ background: T.panel, color: T.text, border: `1px solid ${T.line}` }}
        />

        {mode === "new" ? (
          <>
            <Eyebrow>Benutzername</Eyebrow>
            <input
              value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. maxfit"
              className="w-full px-4 py-3 rounded-xl mb-1"
              style={{ background: T.panel, color: T.text, border: `1px solid ${err ? PLATE.red : T.line}` }}
            />
            <div className="text-xs mb-6" style={{ color: err ? PLATE.red : T.muted }}>
              {err || info || "So finden dich deine Freunde in der Rangliste."}
            </div>

            <Eyebrow>Zeichen</Eyebrow>
            <div className="flex flex-wrap gap-2 mb-8">
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => setEmoji(e)} className="w-11 h-11 rounded-xl text-xl active:scale-90"
                  style={{ background: emoji === e ? PLATE.yellow : T.panel, border: `1px solid ${T.line}` }}>{e}</button>
              ))}
            </div>

            <Btn onClick={submitNew} disabled={busy} className="w-full" style={{ padding: "16px" }}>
              {busy ? "Moment …" : "Konto anlegen"}
            </Btn>
            <div className="text-xs mt-4 text-center" style={{ color: T.muted }}>
              Geschützt mit E-Mail und Passwort über Supabase Auth.
            </div>
          </>
        ) : (
          <>
            <div className="text-xs mb-6" style={{ color: err ? PLATE.red : T.muted }}>
              {err || info || "Meldet dich an und holt Profil, Training, Läufe und Freunde aus der Cloud."}
            </div>
            <Btn onClick={submitLogin} disabled={busy} className="w-full" style={{ padding: "16px" }}>
              {busy ? "Moment …" : "Anmelden"}
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

/* --- Home --------------------------------------------------------------- */
function Home({ ctx }) {
  const T = useT();
  const { profile, workouts, runs, ropes, prs, go, startWorkout, active } = ctx;
  const agg = useMemo(() => aggregate(workouts, runs, ropes), [workouts, runs, ropes]);
  const days = useMemo(() => activeDays(workouts, runs, ropes), [workouts, runs, ropes]);
  const streak = computeStreak(days);

  const weekStart = Date.now() - 7 * DAY, prevStart = Date.now() - 14 * DAY;
  const inRange = (ts, a, b) => ts >= a && ts < b;
  const thisWeek = workouts.filter((w) => inRange(w.startedAt, weekStart, Date.now() + DAY));
  const lastWeek = workouts.filter((w) => inRange(w.startedAt, prevStart, weekStart));
  const repsThis = aggregate(thisWeek, [], []).reps;
  const repsLast = aggregate(lastWeek, [], []).reps;
  const delta = repsLast ? Math.round(((repsThis - repsLast) / repsLast) * 100) : (repsThis ? 100 : 0);

  const todays = workouts.filter((w) => dayKey(w.startedAt) === dayKey(Date.now()));
  const goal = profile.weeklyGoal || 4;
  const topPR = Object.entries(prs).sort((a, b) => (b[1].maxReps || 0) - (a[1].maxReps || 0)).slice(0, 3);

  /* 14-Tage-Streifen: ein Strich pro aktivem Tag */
  const strip = Array.from({ length: 14 }, (_, i) => {
    const ts = Date.now() - (13 - i) * DAY;
    return { ts, on: days.has(dayKey(ts)) };
  });

  return (
    <div className="px-5 pb-28 pt-6 rig-fade">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="rig-display text-3xl" style={{ color: T.text }}>
            {new Date().getHours() < 11 ? "Morgen" : new Date().getHours() < 18 ? "Servus" : "Abend"}, {profile.username}
          </div>
          <div className="text-sm mt-1" style={{ color: T.muted }}>{fmtDate(Date.now())}</div>
        </div>
        <button onClick={() => go("profile")} className="w-11 h-11 rounded-2xl text-xl flex items-center justify-center"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}>{profile.emoji}</button>
      </div>

      {active && (
        <Card className="p-4 mb-4 rig-pulse" style={{ borderColor: PLATE.yellow }} onClick={() => go("workout")}>
          <div className="flex items-center justify-between">
            <div>
              <Eyebrow color={PLATE.yellow}>{active.started ? "Läuft gerade" : "Bereit zum Start"}</Eyebrow>
              <div className="text-sm" style={{ color: T.text }}>{active.started ? "Training fortsetzen" : "Zum Workout, Timer starten"}</div>
            </div>
            <div className="rig-num text-2xl" style={{ color: PLATE.yellow }}>▸</div>
          </div>
        </Card>
      )}

      {/* Streak-Kachel mit Strichliste */}
      <Card className="p-5 mb-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            <Eyebrow>Serie</Eyebrow>
            <div className="rig-num text-4xl" style={{ color: streak ? PLATE.yellow : T.muted }}>
              {streak}<span className="text-base ml-2" style={{ color: T.muted }}>{streak === 1 ? "Tag" : "Tage"}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="rig-num text-sm" style={{ color: T.text }}>{thisWeek.length}/{goal}</div>
            <div className="text-xs" style={{ color: T.muted }}>diese Woche</div>
          </div>
        </div>
        <div className="flex gap-1.5 items-end" style={{ height: 26 }}>
          {strip.map((d, i) => (
            <div key={i} title={fmtDayShort(d.ts)} style={{
              flex: 1, height: d.on ? 26 : 8, borderRadius: 3,
              background: d.on ? PLATE.yellow : T.panel2, transition: "height .2s ease",
            }} />
          ))}
        </div>
        <div className="flex justify-between text-xs mt-2" style={{ color: T.muted }}>
          <span>vor 14 Tagen</span><span>heute</span>
        </div>
      </Card>

      <Btn onClick={() => (active ? go("workout") : startWorkout())} className="w-full mb-3"
        style={{ padding: "20px", fontSize: 18, borderRadius: 18 }}>
        <span className="rig-display" style={{ fontSize: 22 }}>{active ? "Training fortsetzen" : "Workout starten"}</span>
      </Btn>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card className="p-4" onClick={() => go("run")}>
          <div className="text-xl mb-2">🏃</div>
          <div className="rig-display text-base" style={{ color: T.text }}>Laufen</div>
          <div className="rig-num text-sm mt-1" style={{ color: PLATE.blue }}>{nf(agg.km, 1)} km gesamt</div>
        </Card>
        <Card className="p-4" onClick={() => go("rope")}>
          <div className="text-xl mb-2">🪢</div>
          <div className="rig-display text-base" style={{ color: T.text }}>Seilspringen</div>
          <div className="rig-num text-sm mt-1" style={{ color: PLATE.green }}>{nf(agg.jumps)} Sprünge</div>
        </Card>
      </div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Workouts" value={nf(agg.workouts)} />
          <Stat label="Wiederholungen" value={nf(agg.reps)} />
          <Stat label="Trainingszeit" value={Math.round(agg.seconds / 3600)} unit="h" />
        </div>
        <div className="mt-4 pt-4 text-xs flex items-center gap-2" style={{ borderTop: `1px solid ${T.line}`, color: T.muted }}>
          <span className="rig-num" style={{ color: delta >= 0 ? PLATE.green : PLATE.red }}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} %
          </span>
          Wiederholungen gegenüber der Vorwoche
        </div>
      </Card>

      {todays.length > 0 && (
        <>
          <Eyebrow>Heute schon erledigt</Eyebrow>
          {todays.map((w) => <WorkoutRow key={w.id} w={w} onClick={() => go("detail", w)} />)}
        </>
      )}

      {topPR.length > 0 && (
        <>
          <Eyebrow>Bestleistungen</Eyebrow>
          <Card className="p-4 mb-4">
            {topPR.map(([name, pr], i) => (
              <div key={name} className="flex justify-between items-center py-2"
                style={{ borderTop: i ? `1px solid ${T.line}` : "none" }}>
                <span className="text-sm" style={{ color: T.text }}>{name}</span>
                <span className="rig-num text-sm" style={{ color: PLATE.red }}>
                  {pr.maxHold ? fmtClock(pr.maxHold) : `${pr.maxReps} Wdh.`}
                  {pr.maxWeight ? ` · ${nf(pr.maxWeight, 1)} kg` : ""}
                </span>
              </div>
            ))}
          </Card>
        </>
      )}

      {workouts.length === 0 && !active && (
        <Empty title="Noch kein Strich auf dem Konto"
          hint="Starte ein Workout, füge eine Übung hinzu und trag deine Sätze ein. Alles andere rechnet die App aus." />
      )}
    </div>
  );
}

function WorkoutRow({ w, onClick }) {
  const T = useT();
  const tot = workoutTotals(w);
  const names = (w.exercises || []).map((e) => e.name);
  return (
    <Card className="p-4 mb-2" onClick={onClick}>
      <div className="flex justify-between items-start">
        <div className="pr-3" style={{ minWidth: 0 }}>
          <div className="rig-display text-base" style={{ color: T.text }}>{w.title || "Training"}</div>
          <div className="text-xs mt-1 truncate" style={{ color: T.muted }}>
            {names.length ? names.join(" + ") : "keine Übungen"}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="rig-num text-sm" style={{ color: T.text }}>{fmtMin(w.durationSec)}</div>
          <div className="rig-num text-xs mt-1" style={{ color: PLATE.yellow }}>{nf(tot.reps)} Wdh.</div>
        </div>
      </div>
    </Card>
  );
}

/* --- Aktives Workout ---------------------------------------------------- */
function WorkoutScreen({ ctx }) {
  const T = useT();
  const { active, setActive, finishWorkout, discardWorkout, exercises, addCustomExercise, profile, toast, startWorkout } = ctx;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rest, setRest] = useState(null); // {left, total}
  const [tick, setTick] = useState(0);

  /* Workout-Uhr */
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  /* Pausen-Countdown */
  useEffect(() => {
    if (!rest) return;
    if (rest.left <= 0) { beep(); toast({ msg: "Pause vorbei. Nächster Satz." }); setRest(null); return; }
    const t = setTimeout(() => setRest((r) => (r ? { ...r, left: r.left - 1 } : null)), 1000);
    return () => clearTimeout(t);
  }, [rest, toast]);

  if (!active) {
    return (
      <div className="px-5 pt-6 pb-28 rig-fade">
        <div className="rig-display text-3xl mb-6" style={{ color: T.text }}>Workout</div>
        <Empty title="Kein Training aktiv" hint="Die Uhr steht erst, wenn du im Workout auf Start drückst."
          action={<Btn onClick={startWorkout}>Workout starten</Btn>} />
      </div>
    );
  }

  const elapsed = !active.started ? 0
    : active.paused ? active.accum
      : active.accum + Math.floor((Date.now() - active.resumedAt) / 1000);
  const tot = workoutTotals(active);

  const patch = (fn) => setActive((a) => (a ? fn({ ...a }) : a));

  const addExercise = (ex) => {
    patch((a) => {
      a.exercises = [...a.exercises, { key: uid(), exerciseId: ex.id, name: ex.name, category: ex.category, type: ex.type, sets: [] }];
      return a;
    });
    setPickerOpen(false);
  };

  const addSet = (key, set) => {
    patch((a) => {
      a.exercises = a.exercises.map((e) => (e.key === key ? { ...e, sets: [...e.sets, { id: uid(), ...set }] } : e));
      return a;
    });
    setRest({ left: profile.restDefault, total: profile.restDefault });
  };
  const updateSet = (key, sid, set) => patch((a) => {
    a.exercises = a.exercises.map((e) => e.key === key ? { ...e, sets: e.sets.map((s) => (s.id === sid ? { ...s, ...set } : s)) } : e);
    return a;
  });
  const delSet = (key, sid) => patch((a) => {
    a.exercises = a.exercises.map((e) => e.key === key ? { ...e, sets: e.sets.filter((s) => s.id !== sid) } : e);
    return a;
  });
  const delExercise = (key) => patch((a) => { a.exercises = a.exercises.filter((e) => e.key !== key); return a; });

  const startTimer = () => patch((a) => { a.started = true; a.paused = false; a.resumedAt = Date.now(); return a; });
  const togglePause = () => patch((a) => {
    if (a.paused) { a.paused = false; a.resumedAt = Date.now(); }
    else { a.accum = a.accum + Math.floor((Date.now() - a.resumedAt) / 1000); a.paused = true; }
    return a;
  });
  const resetTimer = () => patch((a) => {
    a.accum = 0;
    if (!a.paused) a.resumedAt = Date.now();
    return a;
  });

  return (
    <div className="pb-28 rig-fade">
      {/* Uhr */}
      <div className="px-5 pt-6 pb-5 sticky top-0 z-20" style={{ background: T.bg, borderBottom: `1px solid ${T.line}` }}>
        <div className="flex items-end justify-between">
          <div>
            <Eyebrow color={!active.started ? T.muted : active.paused ? T.muted : PLATE.yellow}>
              {!active.started ? "Bereit zum Start" : active.paused ? "Pausiert" : "Training läuft"}
            </Eyebrow>
            <div className="flex items-baseline gap-2">
              <div className="rig-num text-5xl" style={{ color: active.started ? T.text : T.muted }}>{fmtClock(elapsed)}</div>
              {active.started && (
                <button onClick={resetTimer} title="Zeit zurücksetzen"
                  className="rig-num text-xs px-2 py-1 rounded-lg" style={{ background: T.panel2, color: T.muted }}>
                  ↺ 0:00
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {!active.started ? (
              <Btn onClick={startTimer} style={{ padding: "10px 18px" }}>Start</Btn>
            ) : (
              <>
                <Btn variant="quiet" onClick={togglePause} style={{ padding: "10px 14px" }}>
                  {active.paused ? "Weiter" : "Pause"}
                </Btn>
                <Btn onClick={() => finishWorkout(elapsed)} style={{ padding: "10px 14px" }}>Stopp</Btn>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-5 mt-4">
          <span className="rig-num text-xs" style={{ color: T.muted }}>{tot.sets} Sätze</span>
          <span className="rig-num text-xs" style={{ color: T.muted }}>{nf(tot.reps)} Wdh.</span>
          {tot.volume > 0 && <span className="rig-num text-xs" style={{ color: T.muted }}>{nf(tot.volume)} kg Volumen</span>}
        </div>
      </div>

      {/* Pausen-Timer */}
      {rest && (
        <div className="px-5 pt-4">
          <Card className="p-4" style={{ borderColor: PLATE.yellow }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <Eyebrow color={PLATE.yellow}>Pause</Eyebrow>
                <div className="rig-num text-3xl" style={{ color: T.text }}>{fmtClock(rest.left)}</div>
              </div>
              <div className="flex gap-2">
                <Btn variant="quiet" style={{ padding: "8px 12px" }} onClick={() => setRest((r) => ({ ...r, left: r.left + 30, total: r.total + 30 }))}>+30 s</Btn>
                <Btn variant="ghost" style={{ padding: "8px 12px" }} onClick={() => setRest(null)}>Überspringen</Btn>
              </div>
            </div>
            <div style={{ height: 4, borderRadius: 4, background: T.panel2 }}>
              <div style={{ height: 4, borderRadius: 4, width: `${(rest.left / rest.total) * 100}%`, background: PLATE.yellow, transition: "width 1s linear" }} />
            </div>
          </Card>
        </div>
      )}

      <div className="px-5 pt-4">
        {active.exercises.length === 0 && (
          <Empty title="Übung hinzufügen" hint="Wähl aus der Datenbank oder leg eine eigene an." />
        )}

        {active.exercises.map((ex) => (
          <ExerciseBlock key={ex.key} ex={ex} onAdd={(s) => addSet(ex.key, s)} onUpdate={(sid, s) => updateSet(ex.key, sid, s)}
            onDelete={(sid) => delSet(ex.key, sid)} onRemove={() => delExercise(ex.key)} prs={ctx.prs} />
        ))}

        <Btn variant="ghost" className="w-full mt-2" onClick={() => setPickerOpen(true)}>+ Übung hinzufügen</Btn>

        <div className="mt-6 flex gap-2">
          <Btn variant="danger" className="flex-1" onClick={discardWorkout}>Training verwerfen</Btn>
        </div>

        {/* Pausenlänge */}
        <div className="mt-6">
          <Eyebrow>Standard-Pause</Eyebrow>
          <div className="flex gap-2 flex-wrap">
            {[30, 60, 90, 120].map((s) => (
              <button key={s} onClick={() => ctx.patchProfile({ restDefault: s })}
                className="rig-num px-3 py-2 rounded-lg text-xs"
                style={{ background: profile.restDefault === s ? PLATE.yellow : T.panel, color: profile.restDefault === s ? "#14161B" : T.muted, border: `1px solid ${T.line}` }}>
                {s} s
              </button>
            ))}
            <div className="flex items-center gap-2 ml-1">
              <NumberField value={profile.restDefault} onChange={(v) => ctx.patchProfile({ restDefault: clamp(Math.round(v), 5, 600) })} min={5} max={600} step={5} width={70} />
              <span className="text-xs" style={{ color: T.muted }}>s</span>
            </div>
          </div>
        </div>
      </div>

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} exercises={exercises}
        onPick={addExercise} onCreate={addCustomExercise} />
    </div>
  );
}

function ExerciseBlock({ ex, onAdd, onUpdate, onDelete, onRemove, prs }) {
  const T = useT();
  const last = ex.sets[ex.sets.length - 1];
  const [reps, setReps] = useState(last?.reps || 10);
  const [weight, setWeight] = useState(last?.weight || 20);
  const [sec, setSec] = useState(last?.sec || 30);
  const [tallyMode, setTallyMode] = useState(false);
  const [editing, setEditing] = useState(null);

  const totalReps = ex.sets.reduce((a, s) => a + (s.reps || 0), 0);
  const volume = ex.sets.reduce((a, s) => a + (s.reps || 0) * (s.weight || 0), 0);
  const pr = prs[ex.name];

  const commit = () => {
    if (ex.type === "time") { if (sec < 1) return; onAdd({ sec: Math.round(sec) }); }
    else if (ex.type === "weight") { if (reps < 1) return; onAdd({ reps: Math.round(reps), weight: Number(weight) || 0 }); }
    else { if (reps < 1) return; onAdd({ reps: Math.round(reps) }); }
    setTallyMode(false);
  };

  return (
    <Card className="p-4 mb-3">
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="rig-display text-lg" style={{ color: T.text }}>{ex.name}</div>
          <div className="text-xs" style={{ color: T.muted }}>
            {ex.category} · {ex.type === "weight" ? "mit Gewicht" : ex.type === "time" ? "auf Zeit" : "Körpergewicht"}
            {pr && ex.type !== "time" && pr.maxReps ? ` · Bestwert ${pr.maxReps}` : ""}
          </div>
        </div>
        <button onClick={onRemove} className="text-xs px-2 py-1 rounded-lg" style={{ color: T.muted, background: T.panel2 }}>Entfernen</button>
      </div>

      {/* Sätze */}
      {ex.sets.map((s, i) => (
        <div key={s.id} className="flex items-center justify-between py-2" style={{ borderTop: `1px solid ${T.line}` }}>
          <span className="rig-num text-xs w-14 shrink-0" style={{ color: T.muted }}>Satz {i + 1}</span>
          {editing === s.id ? (
            <div className="flex items-center gap-2 flex-1 justify-end">
              {ex.type === "time" ? (
                <NumberField value={s.sec} onChange={(v) => onUpdate(s.id, { sec: Math.round(v) })} min={1} max={3600} step={5} width={72} />
              ) : (
                <>
                  {ex.type === "weight" && (
                    <NumberField value={s.weight || 0} onChange={(v) => onUpdate(s.id, { weight: v })} min={0} max={500} step={2.5} width={72} />
                  )}
                  <NumberField value={s.reps} onChange={(v) => onUpdate(s.id, { reps: Math.round(v) })} min={1} max={1000} width={64} />
                </>
              )}
              <button onClick={() => setEditing(null)} className="text-xs px-2 py-2 rounded-lg" style={{ background: PLATE.yellow, color: "#14161B" }}>OK</button>
            </div>
          ) : (
            <>
              <div className="flex-1 px-3" style={{ minWidth: 0 }}>
                {ex.type !== "time" && <Tally count={s.reps} color={PLATE.yellow} size={16} max={30} />}
              </div>
              <span className="rig-num text-sm mr-3" style={{ color: T.text }}>
                {ex.type === "time" ? fmtClock(s.sec)
                  : ex.type === "weight" ? `${nf(s.weight, s.weight % 1 ? 1 : 0)} kg × ${s.reps}`
                    : `${s.reps} Wdh.`}
              </span>
              <button onClick={() => setEditing(s.id)} className="text-xs px-2 py-1 rounded" style={{ color: T.muted }}>✎</button>
              <button onClick={() => onDelete(s.id)} className="text-xs px-2 py-1 rounded" style={{ color: PLATE.red }}>✕</button>
            </>
          )}
        </div>
      ))}

      {ex.sets.length > 0 && (
        <div className="flex gap-4 pt-2 mt-1 text-xs rig-num" style={{ borderTop: `1px solid ${T.line}`, color: T.muted }}>
          {ex.type !== "time" && <span>{totalReps} Wdh. gesamt</span>}
          {volume > 0 && <span>{nf(volume)} kg Volumen</span>}
        </div>
      )}

      {/* Eingabe */}
      <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${T.line}` }}>
        {tallyMode ? (
          <div>
            <button
              onClick={() => setReps((r) => clamp(r + 1, 0, 1000))}
              className="w-full py-6 rounded-xl active:scale-95 mb-2"
              style={{ background: T.panel2, border: `1px dashed ${T.line}` }}>
              <div className="flex justify-center mb-2"><Tally count={reps} color={PLATE.yellow} size={26} max={40} /></div>
              <div className="rig-num text-3xl" style={{ color: T.text }}>{reps}</div>
              <div className="text-xs mt-1" style={{ color: T.muted }}>tippen zählt eine Wiederholung</div>
            </button>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => setReps(0)}>Zurücksetzen</Btn>
              <Btn variant="ghost" onClick={() => setTallyMode(false)}>Zahlen</Btn>
              <Btn className="flex-1" onClick={commit}>Satz sichern</Btn>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {ex.type === "time" ? (
              <NumberField value={sec} onChange={setSec} min={1} max={3600} step={5} width={80} suffix="s" />
            ) : (
              <>
                {ex.type === "weight" && <NumberField value={weight} onChange={setWeight} min={0} max={500} step={2.5} width={80} suffix="kg" />}
                <NumberField value={reps} onChange={setReps} min={1} max={1000} width={72} />
                {ex.type === "reps" && (
                  <button onClick={() => setTallyMode(true)} className="text-xs px-3 py-2 rounded-lg"
                    style={{ background: T.panel2, color: T.muted }}>Strichliste</button>
                )}
              </>
            )}
            <Btn className="flex-1" onClick={commit} style={{ minWidth: 120 }}>Satz sichern</Btn>
          </div>
        )}
      </div>
    </Card>
  );
}

function ExercisePicker({ open, onClose, exercises, onPick, onCreate }) {
  const T = useT();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("Alle");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("Ganzkörper");
  const [newType, setNewType] = useState("reps");

  const list = exercises.filter((e) =>
    (cat === "Alle" || e.category === cat) && e.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Sheet open={open} onClose={onClose} title="Übung wählen" full>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen"
        className="w-full px-4 py-3 rounded-xl mb-3"
        style={{ background: T.panel, color: T.text, border: `1px solid ${T.line}` }} />
      <div className="mb-3">
        <Segmented value={cat} onChange={setCat} options={["Alle", ...CATS].map((c) => ({ value: c, label: c }))} />
      </div>

      {list.map((e) => (
        <button key={e.id} onClick={() => onPick(e)}
          className="w-full text-left px-4 py-3 rounded-xl mb-2 flex justify-between items-center active:scale-98"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <span style={{ color: T.text }}>{e.name}</span>
          <span className="text-xs rig-num" style={{ color: e.type === "weight" ? PLATE.blue : e.type === "time" ? PLATE.green : PLATE.yellow }}>
            {e.type === "weight" ? "kg" : e.type === "time" ? "Zeit" : "Wdh."}
          </span>
        </button>
      ))}
      {list.length === 0 && <div className="text-sm py-6 text-center" style={{ color: T.muted }}>Keine Übung gefunden.</div>}

      {creating ? (
        <Card className="p-4 mt-3">
          <Eyebrow>Eigene Übung</Eyebrow>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name der Übung"
            className="w-full px-3 py-2 rounded-lg mb-3" style={{ background: T.panel2, color: T.text, border: `1px solid ${T.line}` }} />
          <div className="mb-3"><Segmented value={newCat} onChange={setNewCat} options={CATS.map((c) => ({ value: c, label: c }))} /></div>
          <div className="mb-4"><Segmented value={newType} onChange={setNewType}
            options={[{ value: "reps", label: "Wiederholungen" }, { value: "weight", label: "Mit Gewicht" }, { value: "time", label: "Auf Zeit" }]} /></div>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => setCreating(false)}>Abbrechen</Btn>
            <Btn className="flex-1" disabled={newName.trim().length < 2}
              onClick={() => { const ex = onCreate(newName.trim(), newCat, newType); setCreating(false); setNewName(""); onPick(ex); }}>
              Anlegen und hinzufügen
            </Btn>
          </div>
        </Card>
      ) : (
        <Btn variant="ghost" className="w-full mt-2" onClick={() => setCreating(true)}>+ Eigene Übung anlegen</Btn>
      )}
    </Sheet>
  );
}

/* --- Lauf-Tracker ------------------------------------------------------- */
function RunScreen({ ctx }) {
  const T = useT();
  const { runs, addRun, deleteRun, toast, go } = ctx;
  const [state, setState] = useState("idle"); // idle | running | paused
  const [pts, setPts] = useState([]);
  const [km, setKm] = useState(0);
  const [sec, setSec] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [gpsErr, setGpsErr] = useState("");
  const [manual, setManual] = useState(false);
  const [mKm, setMKm] = useState(5);
  const [mMin, setMMin] = useState(30);
  const watchId = useRef(null);
  const startedRef = useRef(null);

  useEffect(() => {
    if (state !== "running") return;
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) {
      try { navigator.geolocation.clearWatch(watchId.current); } catch { /* egal */ }
      watchId.current = null;
    }
  }, []);
  useEffect(() => stopWatch, [stopWatch]);

  const start = () => {
    setGpsErr(""); setPts([]); setKm(0); setSec(0); setSpeed(0);
    startedRef.current = Date.now();
    setState("running");
    if (!navigator.geolocation) {
      setGpsErr("Dieses Gerät liefert kein GPS. Die Zeit läuft trotzdem – die Distanz trägst du am Ende ein.");
      return;
    }
    try {
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
          setSpeed((pos.coords.speed || 0) * 3.6);
          setPts((prev) => {
            if (prev.length) {
              const d = haversine(prev[prev.length - 1], p);
              if (d > 0.002 && d < 0.5) setKm((k) => k + d); // grobe Ausreißer aussortieren
            }
            return [...prev, p];
          });
          setGpsErr("");
        },
        (err) => {
          setGpsErr(err.code === 1
            ? "Standortzugriff ist gesperrt. Erlaube ihn in den Einstellungen oder trag die Strecke am Ende manuell ein."
            : "GPS-Signal fehlt gerade. Zeit läuft weiter, Distanz kannst du am Ende korrigieren.");
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
      );
    } catch {
      setGpsErr("GPS lässt sich hier nicht starten. Distanz am Ende eintragen.");
    }
  };

  const finish = async () => {
    stopWatch();
    if (sec < 10) { toast({ kind: "error", msg: "Zu kurz zum Speichern. Mindestens 10 Sekunden." }); setState("idle"); return; }
    const distance = Number(km.toFixed(3));
    await addRun({
      id: uid(), date: startedRef.current || Date.now(), distanceKm: distance, durationSec: sec,
      kcal: Math.round(distance * 62), source: pts.length ? "gps" : "manual",
      path: pts.map((p) => [Number(p.lat.toFixed(5)), Number(p.lng.toFixed(5))]),
    });
    setState("idle"); setPts([]); setKm(0); setSec(0);
  };

  const saveManual = async () => {
    if (mKm <= 0 || mMin <= 0) return toast({ kind: "error", msg: "Distanz und Zeit müssen größer als null sein." });
    await addRun({
      id: uid(), date: Date.now(), distanceKm: Number(mKm), durationSec: Math.round(mMin * 60),
      kcal: Math.round(mKm * 62), source: "manual", path: [],
    });
    setManual(false);
  };

  const totals = runs.reduce((a, r) => ({ km: a.km + r.distanceKm, sec: a.sec + r.durationSec }), { km: 0, sec: 0 });
  const best5k = runs.filter((r) => r.distanceKm >= 4.9).sort((a, b) => a.durationSec / a.distanceKm - b.durationSec / b.distanceKm)[0];

  return (
    <div className="px-5 pt-6 pb-28 rig-fade">
      <div className="flex justify-between items-center mb-5">
        <div className="rig-display text-3xl" style={{ color: T.text }}>Laufen</div>
        <button onClick={() => go("home")} className="text-xs px-3 py-2 rounded-lg" style={{ background: T.panel2, color: T.muted }}>Zurück</button>
      </div>

      {state === "idle" ? (
        <>
          <Btn onClick={start} tone={PLATE.blue} className="w-full mb-3" style={{ padding: 20, borderRadius: 18 }}>
            <span className="rig-display" style={{ fontSize: 22 }}>Lauf starten</span>
          </Btn>
          <Btn variant="ghost" className="w-full mb-5" onClick={() => setManual(true)}>Lauf nachtragen</Btn>

          <Card className="p-5 mb-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Gesamt" value={nf(totals.km, 1)} unit="km" color={PLATE.blue} />
              <Stat label="Läufe" value={runs.length} />
              <Stat label="Zeit" value={Math.round(totals.sec / 3600)} unit="h" />
            </div>
            {best5k && (
              <div className="mt-4 pt-4 text-xs" style={{ borderTop: `1px solid ${T.line}`, color: T.muted }}>
                Bester 5-km-Schnitt: <span className="rig-num" style={{ color: PLATE.red }}>
                  {paceStr(best5k.durationSec, best5k.distanceKm)} min/km</span>
              </div>
            )}
          </Card>

          <Eyebrow>Letzte Läufe</Eyebrow>
          {runs.length === 0 && <Empty title="Noch nichts gelaufen" hint="Beim Start fragt die App nach dem Standort. Ohne GPS trägst du die Strecke einfach nach." />}
          {[...runs].sort((a, b) => b.date - a.date).slice(0, 20).map((r) => (
            <Card key={r.id} className="p-4 mb-2">
              <div className="flex justify-between items-start">
                <div>
                  <div className="rig-num text-xl" style={{ color: T.text }}>{nf(r.distanceKm, 2)} km</div>
                  <div className="text-xs mt-1" style={{ color: T.muted }}>
                    {relDay(r.date)} · {fmtClock(r.durationSec)} · {paceStr(r.durationSec, r.distanceKm)} min/km
                    {r.source === "manual" ? " · nachgetragen" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.path?.length > 3 && <RouteTrace path={r.path} color={PLATE.blue} w={64} h={40} />}
                  <button onClick={() => deleteRun(r.id)} className="text-xs px-2 py-1" style={{ color: PLATE.red }}>✕</button>
                </div>
              </div>
            </Card>
          ))}
        </>
      ) : (
        <>
          <Card className="p-6 mb-4" style={{ borderColor: PLATE.blue }}>
            <Eyebrow color={PLATE.blue}>{state === "paused" ? "Pausiert" : "Läuft"}</Eyebrow>
            <div className="rig-num" style={{ color: T.text, fontSize: 54, lineHeight: 1 }}>{nf(km, 2)}
              <span className="text-lg ml-2" style={{ color: T.muted }}>km</span></div>
            <div className="grid grid-cols-3 gap-3 mt-6">
              <Stat label="Zeit" value={fmtClock(sec)} />
              <Stat label="Pace" value={paceStr(sec, km)} unit="min/km" />
              <Stat label="Tempo" value={nf(speed || (km / (sec / 3600) || 0), 1)} unit="km/h" />
            </div>
            <div className="mt-4 pt-4 text-xs rig-num" style={{ borderTop: `1px solid ${T.line}`, color: T.muted }}>
              ca. {Math.round(km * 62)} kcal
            </div>
          </Card>

          {pts.length > 3 && (
            <Card className="p-4 mb-4">
              <Eyebrow>Streckenverlauf</Eyebrow>
              <RouteTrace path={pts.map((p) => [p.lat, p.lng])} color={PLATE.blue} w={340} h={160} full />
            </Card>
          )}

          {gpsErr && (
            <Card className="p-4 mb-4" style={{ borderColor: PLATE.red }}>
              <div className="text-sm" style={{ color: T.text }}>{gpsErr}</div>
            </Card>
          )}

          <div className="flex gap-2 mb-4">
            <Btn variant="quiet" className="flex-1" onClick={() => setState(state === "running" ? "paused" : "running")}>
              {state === "running" ? "Pause" : "Weiter"}
            </Btn>
            <Btn tone={PLATE.blue} className="flex-1" onClick={finish}>Lauf beenden</Btn>
          </div>

          <Card className="p-4">
            <Eyebrow>Distanz korrigieren</Eyebrow>
            <div className="flex items-center gap-3">
              <NumberField value={Number(km.toFixed(2))} onChange={(v) => setKm(v)} min={0} max={300} step={0.1} width={90} suffix="km" />
              <span className="text-xs" style={{ color: T.muted }}>falls das GPS gehakt hat</span>
            </div>
          </Card>
        </>
      )}

      <Sheet open={manual} onClose={() => setManual(false)} title="Lauf nachtragen">
        <div className="mb-4">
          <Eyebrow>Distanz</Eyebrow>
          <NumberField value={mKm} onChange={setMKm} min={0.1} max={300} step={0.5} width={100} suffix="km" />
        </div>
        <div className="mb-6">
          <Eyebrow>Dauer</Eyebrow>
          <NumberField value={mMin} onChange={setMMin} min={1} max={1440} step={5} width={100} suffix="min" />
        </div>
        <div className="text-xs mb-4 rig-num" style={{ color: T.muted }}>
          Pace: {paceStr(mMin * 60, mKm)} min/km
        </div>
        <Btn tone={PLATE.blue} className="w-full" onClick={saveManual}>Lauf speichern</Btn>
      </Sheet>
    </div>
  );
}

/* Zeichnet die GPS-Spur als normalisierte SVG-Linie – ohne externe Karte. */
function RouteTrace({ path, color, w = 80, h = 48, full }) {
  const T = useT();
  const lats = path.map((p) => p[0]), lngs = path.map((p) => p[1]);
  const minLa = Math.min(...lats), maxLa = Math.max(...lats);
  const minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
  const spanLa = maxLa - minLa || 1e-5, spanLo = maxLo - minLo || 1e-5;
  const pad = 6;
  const d = path.map((p, i) => {
    const x = pad + ((p[1] - minLo) / spanLo) * (w - pad * 2);
    const y = h - pad - ((p[0] - minLa) / spanLa) * (h - pad * 2);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={full ? "100%" : w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ borderRadius: 10, background: full ? T.panel2 : "transparent" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={full ? 2.4 : 1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* --- Seilspringen ------------------------------------------------------- */
function RopeScreen({ ctx }) {
  const T = useT();
  const { ropes, addRope, deleteRope, toast, go } = ctx;
  const [sets, setSets] = useState([]);
  const [jumps, setJumps] = useState(100);
  const [running, setRunning] = useState(false);
  const [sec, setSec] = useState(0);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const totalJumps = sets.reduce((a, s) => a + s.jumps, 0);
  const allTime = ropes.reduce((a, r) => a + (r.totalJumps || 0), 0);
  const best = ropes.reduce((m, r) => Math.max(m, r.totalJumps || 0), 0);

  const addSet = () => {
    if (jumps < 1) return toast({ kind: "error", msg: "Mindestens ein Sprung." });
    setSets((s) => [...s, { id: uid(), jumps: Math.round(jumps), sec }]);
    setSec(0);
  };
  const save = async () => {
    if (!sets.length) return toast({ kind: "error", msg: "Leere Einheit lässt sich nicht speichern." });
    setRunning(false);
    await addRope({
      id: uid(), date: Date.now(), sets, totalJumps: totalJumps,
      durationSec: sets.reduce((a, s) => a + (s.sec || 0), 0), kcal: Math.round(totalJumps * 0.13),
    });
    setSets([]); setSec(0);
  };

  return (
    <div className="px-5 pt-6 pb-28 rig-fade">
      <div className="flex justify-between items-center mb-5">
        <div className="rig-display text-3xl" style={{ color: T.text }}>Seilspringen</div>
        <button onClick={() => go("home")} className="text-xs px-3 py-2 rounded-lg" style={{ background: T.panel2, color: T.muted }}>Zurück</button>
      </div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Gesamt" value={nf(allTime)} color={PLATE.green} />
          <Stat label="Einheiten" value={ropes.length} />
          <Stat label="Bestwert" value={nf(best)} color={PLATE.red} />
        </div>
      </Card>

      <Card className="p-5 mb-4" style={{ borderColor: sets.length ? PLATE.green : T.line }}>
        <Eyebrow color={PLATE.green}>Aktuelle Einheit</Eyebrow>
        <div className="flex items-end justify-between mb-4">
          <div className="rig-num" style={{ color: T.text, fontSize: 44, lineHeight: 1 }}>{nf(totalJumps)}
            <span className="text-sm ml-2" style={{ color: T.muted }}>Sprünge</span></div>
          <div className="text-right">
            <div className="rig-num text-2xl" style={{ color: running ? PLATE.green : T.muted }}>{fmtClock(sec)}</div>
            <button onClick={() => setRunning((r) => !r)} className="text-xs px-3 py-1 mt-1 rounded-lg"
              style={{ background: T.panel2, color: T.text }}>{running ? "Timer stoppen" : "Timer starten"}</button>
          </div>
        </div>

        {sets.map((s, i) => (
          <div key={s.id} className="flex justify-between items-center py-2" style={{ borderTop: `1px solid ${T.line}` }}>
            <span className="rig-num text-xs" style={{ color: T.muted }}>Set {i + 1}</span>
            <span className="rig-num text-sm" style={{ color: T.text }}>{nf(s.jumps)} · {fmtClock(s.sec)}</span>
            <button onClick={() => setSets((x) => x.filter((y) => y.id !== s.id))} className="text-xs" style={{ color: PLATE.red }}>✕</button>
          </div>
        ))}

        <div className="flex items-center gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${T.line}` }}>
          <NumberField value={jumps} onChange={setJumps} min={1} max={20000} step={50} width={90} />
          <Btn tone={PLATE.green} className="flex-1" onClick={addSet}>Set hinzufügen</Btn>
        </div>
        {sets.length > 0 && <Btn variant="ghost" className="w-full mt-2" onClick={save}>Einheit speichern</Btn>}
      </Card>

      <Eyebrow>Verlauf</Eyebrow>
      {ropes.length === 0 && <Empty title="Noch keine Einheit" hint="Sets einzeln eintragen, Timer optional. Am Ende speichern." />}
      {[...ropes].sort((a, b) => b.date - a.date).slice(0, 20).map((r) => (
        <Card key={r.id} className="p-4 mb-2">
          <div className="flex justify-between items-center">
            <div>
              <div className="rig-num text-lg" style={{ color: T.text }}>{nf(r.totalJumps)} Sprünge</div>
              <div className="text-xs mt-1" style={{ color: T.muted }}>
                {relDay(r.date)} · {r.sets.length} Sets · {fmtClock(r.durationSec)} · ca. {r.kcal} kcal
              </div>
            </div>
            <button onClick={() => deleteRope(r.id)} className="text-xs px-2 py-1" style={{ color: PLATE.red }}>✕</button>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* --- Statistik ---------------------------------------------------------- */
const PERIODS = [
  { value: 7, label: "7 Tage" }, { value: 30, label: "30 Tage" }, { value: 90, label: "3 Monate" },
  { value: 365, label: "1 Jahr" }, { value: 0, label: "Gesamt" },
];
const METRICS = [
  { value: "workouts", label: "Workouts", color: PLATE.yellow, unit: "" },
  { value: "reps", label: "Wiederholungen", color: PLATE.yellow, unit: "" },
  { value: "minutes", label: "Trainingszeit", color: PLATE.yellow, unit: "min" },
  { value: "volume", label: "Volumen", color: PLATE.blue, unit: "kg" },
  { value: "km", label: "Laufkilometer", color: PLATE.blue, unit: "km" },
  { value: "jumps", label: "Sprünge", color: PLATE.green, unit: "" },
];

function StatsScreen({ ctx }) {
  const T = useT();
  const { workouts, runs, ropes, prs, go } = ctx;
  const [period, setPeriod] = useState(30);
  const [metric, setMetric] = useState("reps");
  const [exFilter, setExFilter] = useState("");

  const since = period ? Date.now() - period * DAY : 0;
  const fw = workouts.filter((w) => w.startedAt >= since);
  const fr = runs.filter((r) => r.date >= since);
  const fj = ropes.filter((r) => r.date >= since);
  const agg = aggregate(fw, fr, fj);

  /* Bucketgröße nach Zeitraum */
  const bucket = period <= 30 ? "day" : period <= 90 ? "week" : "month";
  const data = useMemo(() => {
    const map = new Map();
    const keyOf = (ts) => {
      const d = new Date(ts);
      if (bucket === "day") return dayKey(ts);
      if (bucket === "week") { const m = new Date(ts); m.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(m.getTime()); }
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    };
    const labelOf = (k) => {
      if (bucket === "month") { const [y, m] = k.split("-"); return `${DE_MONTH[Number(m) - 1]} ${String(y).slice(2)}`; }
      const d = new Date(k + "T00:00:00");
      return bucket === "day" ? `${d.getDate()}.${d.getMonth() + 1}.` : `KW ${d.getDate()}.${d.getMonth() + 1}.`;
    };
    const touch = (k) => { if (!map.has(k)) map.set(k, { k, label: labelOf(k), workouts: 0, reps: 0, minutes: 0, volume: 0, km: 0, jumps: 0 }); return map.get(k); };

    /* leere Buckets anlegen, damit Lücken sichtbar bleiben */
    const span = period || Math.max(30, Math.ceil((Date.now() - Math.min(
      ...[...fw.map((w) => w.startedAt), ...fr.map((r) => r.date), ...fj.map((r) => r.date), Date.now()]
    )) / DAY));
    const stepDays = bucket === "day" ? 1 : bucket === "week" ? 7 : 30;
    for (let i = span; i >= 0; i -= stepDays) touch(keyOf(Date.now() - i * DAY));

    for (const w of fw) {
      const b = touch(keyOf(w.startedAt)), t = workoutTotals(w);
      b.workouts++; b.reps += t.reps; b.minutes += Math.round((w.durationSec || 0) / 60); b.volume += t.volume;
      if (exFilter) {
        const ex = (w.exercises || []).find((e) => e.name === exFilter);
        b.filtered = (b.filtered || 0) + (ex ? ex.sets.reduce((a, s) => a + (s.reps || 0), 0) : 0);
      }
    }
    for (const r of fr) { const b = touch(keyOf(r.date)); b.km += r.distanceKm; b.minutes += Math.round(r.durationSec / 60); }
    for (const r of fj) { const b = touch(keyOf(r.date)); b.jumps += r.totalJumps; }
    return [...map.values()].sort((a, b) => (a.k < b.k ? -1 : 1)).map((d) => ({ ...d, km: Number(d.km.toFixed(2)), volume: Math.round(d.volume) }));
  }, [fw, fr, fj, bucket, period, exFilter]);

  const m = METRICS.find((x) => x.value === metric);
  const exNames = Object.keys(agg.perExercise).sort((a, b) => agg.perExercise[b] - agg.perExercise[a]);
  const chartKey = exFilter ? "filtered" : metric;

  return (
    <div className="px-5 pt-6 pb-28 rig-fade">
      <div className="rig-display text-3xl mb-5" style={{ color: T.text }}>Statistik</div>

      <div className="mb-4"><Segmented value={period} onChange={setPeriod} options={PERIODS} /></div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Stat label="Workouts" value={nf(agg.workouts)} />
          <Stat label="Wiederholungen" value={nf(agg.reps)} />
          <Stat label="Sätze" value={nf(agg.sets)} />
        </div>
        <div className="grid grid-cols-3 gap-4 pt-4" style={{ borderTop: `1px solid ${T.line}` }}>
          <Stat label="Zeit" value={fmtMin(agg.seconds)} />
          <Stat label="Laufen" value={nf(agg.km, 1)} unit="km" color={PLATE.blue} />
          <Stat label="Sprünge" value={nf(agg.jumps)} color={PLATE.green} />
        </div>
      </Card>

      <div className="mb-3"><Segmented value={metric} onChange={(v) => { setMetric(v); setExFilter(""); }} options={METRICS} /></div>

      <Card className="p-4 mb-4">
        <Eyebrow color={exFilter ? PLATE.yellow : m.color}>
          {exFilter ? `${exFilter} – Wiederholungen` : m.label}
        </Eyebrow>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid stroke={T.line} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: T.muted, fontSize: 10 }} axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 6))} />
              <YAxis tick={{ fill: T.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip
                cursor={{ fill: T.panel2 }}
                contentStyle={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, color: T.text, fontSize: 12 }}
                labelStyle={{ color: T.muted }}
                formatter={(v) => [`${nf(v, metric === "km" ? 2 : 0)} ${exFilter ? "Wdh." : m.unit}`, ""]} />
              <Bar dataKey={chartKey} fill={exFilter ? PLATE.yellow : m.color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {exNames.length > 0 && (
        <>
          <Eyebrow>Nach Übung</Eyebrow>
          <Card className="p-4 mb-4">
            {exNames.slice(0, 10).map((name, i) => {
              const max = agg.perExercise[exNames[0]] || 1;
              const on = exFilter === name;
              return (
                <button key={name} onClick={() => setExFilter(on ? "" : name)}
                  className="w-full text-left py-2" style={{ borderTop: i ? `1px solid ${T.line}` : "none" }}>
                  <div className="flex justify-between text-sm mb-1">
                    <span style={{ color: on ? PLATE.yellow : T.text }}>{name}</span>
                    <span className="rig-num" style={{ color: T.muted }}>{nf(agg.perExercise[name])}</span>
                  </div>
                  <div style={{ height: 4, background: T.panel2, borderRadius: 4 }}>
                    <div style={{ height: 4, borderRadius: 4, width: `${(agg.perExercise[name] / max) * 100}%`, background: on ? PLATE.yellow : T.muted }} />
                  </div>
                </button>
              );
            })}
          </Card>
        </>
      )}

      <Eyebrow color={PLATE.red}>Persönliche Rekorde</Eyebrow>
      {Object.keys(prs).length === 0 ? (
        <Empty title="Noch keine Rekorde" hint="Der erste Satz jeder Übung setzt automatisch die Marke." />
      ) : (
        <Card className="p-4">
          {Object.entries(prs).sort((a, b) => (b[1].maxReps || 0) - (a[1].maxReps || 0)).map(([name, pr], i) => (
            <div key={name} className="flex justify-between items-center py-2.5" style={{ borderTop: i ? `1px solid ${T.line}` : "none" }}>
              <div>
                <div className="text-sm" style={{ color: T.text }}>{name}</div>
                {pr.date && <div className="text-xs" style={{ color: T.muted }}>{fmtDate(pr.date)}</div>}
              </div>
              <div className="rig-num text-sm text-right" style={{ color: PLATE.red }}>
                {pr.maxHold ? fmtClock(pr.maxHold) : `${pr.maxReps} Wdh.`}
                {pr.maxWeight ? <div style={{ color: PLATE.blue }}>{nf(pr.maxWeight, 1)} kg</div> : null}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Btn variant="ghost" className="w-full mt-4" onClick={() => go("history")}>Ganze Historie ansehen</Btn>
    </div>
  );
}

/* --- Historie ----------------------------------------------------------- */
function HistoryScreen({ ctx }) {
  const T = useT();
  const { workouts, runs, ropes, go } = ctx;
  const [filter, setFilter] = useState("alle");

  const items = [
    ...(filter === "alle" || filter === "training" ? workouts.map((w) => ({ kind: "w", ts: w.startedAt, w })) : []),
    ...(filter === "alle" || filter === "laufen" ? runs.map((r) => ({ kind: "r", ts: r.date, r })) : []),
    ...(filter === "alle" || filter === "seil" ? ropes.map((r) => ({ kind: "j", ts: r.date, r })) : []),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <div className="px-5 pt-6 pb-28 rig-fade">
      <div className="flex justify-between items-center mb-5">
        <div className="rig-display text-3xl" style={{ color: T.text }}>Historie</div>
        <button onClick={() => go("stats")} className="text-xs px-3 py-2 rounded-lg" style={{ background: T.panel2, color: T.muted }}>Zurück</button>
      </div>
      <div className="mb-4">
        <Segmented value={filter} onChange={setFilter}
          options={[{ value: "alle", label: "Alles" }, { value: "training", label: "Training" }, { value: "laufen", label: "Laufen" }, { value: "seil", label: "Seil" }]} />
      </div>

      {items.length === 0 && <Empty title="Nichts gespeichert" hint="Was du trainierst, landet hier – dauerhaft." />}

      {items.map((it, i) => {
        const showDate = i === 0 || dayKey(items[i - 1].ts) !== dayKey(it.ts);
        return (
          <div key={it.kind + (it.w?.id || it.r?.id)}>
            {showDate && <div className="rig-display text-xs mt-5 mb-2" style={{ color: T.muted, letterSpacing: ".1em" }}>{relDay(it.ts)}</div>}
            {it.kind === "w" && <WorkoutRow w={it.w} onClick={() => go("detail", it.w)} />}
            {it.kind === "r" && (
              <Card className="p-4 mb-2">
                <div className="flex justify-between">
                  <div><div className="rig-display text-base" style={{ color: T.text }}>Lauf</div>
                    <div className="text-xs mt-1" style={{ color: T.muted }}>{paceStr(it.r.durationSec, it.r.distanceKm)} min/km</div></div>
                  <div className="text-right"><div className="rig-num text-sm" style={{ color: PLATE.blue }}>{nf(it.r.distanceKm, 2)} km</div>
                    <div className="rig-num text-xs mt-1" style={{ color: T.muted }}>{fmtClock(it.r.durationSec)}</div></div>
                </div>
              </Card>
            )}
            {it.kind === "j" && (
              <Card className="p-4 mb-2">
                <div className="flex justify-between">
                  <div><div className="rig-display text-base" style={{ color: T.text }}>Seilspringen</div>
                    <div className="text-xs mt-1" style={{ color: T.muted }}>{it.r.sets.length} Sets</div></div>
                  <div className="rig-num text-sm" style={{ color: PLATE.green }}>{nf(it.r.totalJumps)} Sprünge</div>
                </div>
              </Card>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WorkoutDetail({ ctx, workout }) {
  const T = useT();
  const { go, deleteWorkout, repeatWorkout } = ctx;
  const tot = workoutTotals(workout);
  return (
    <div className="px-5 pt-6 pb-28 rig-fade">
      <button onClick={() => go("history")} className="text-xs px-3 py-2 rounded-lg mb-4" style={{ background: T.panel2, color: T.muted }}>Zurück</button>
      <div className="rig-display text-3xl" style={{ color: T.text }}>{workout.title || "Training"}</div>
      <div className="text-sm mt-1 mb-5" style={{ color: T.muted }}>{fmtDate(workout.startedAt)} · {fmtMin(workout.durationSec)}</div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Wiederholungen" value={nf(tot.reps)} />
          <Stat label="Sätze" value={tot.sets} />
          <Stat label="Volumen" value={nf(tot.volume)} unit="kg" />
        </div>
      </Card>

      {workout.exercises.map((ex) => {
        const reps = ex.sets.reduce((a, s) => a + (s.reps || 0), 0);
        return (
          <Card key={ex.key || ex.name} className="p-4 mb-3">
            <div className="flex justify-between items-center mb-3">
              <div className="rig-display text-lg" style={{ color: T.text }}>{ex.name}</div>
              <div className="rig-num text-sm" style={{ color: PLATE.yellow }}>
                {ex.type === "time" ? fmtClock(ex.sets.reduce((a, s) => a + (s.sec || 0), 0)) : `${reps} Wdh.`}
              </div>
            </div>
            {ex.type !== "time" && <div className="mb-3"><Tally count={reps} color={PLATE.yellow} size={20} max={80} /></div>}
            {ex.sets.map((s, i) => (
              <div key={s.id || i} className="flex justify-between py-1.5 text-sm" style={{ borderTop: `1px solid ${T.line}` }}>
                <span className="rig-num text-xs" style={{ color: T.muted }}>Satz {i + 1}</span>
                <span className="rig-num" style={{ color: T.text }}>
                  {ex.type === "time" ? fmtClock(s.sec) : ex.type === "weight" ? `${nf(s.weight, s.weight % 1 ? 1 : 0)} kg × ${s.reps}` : `${s.reps} Wdh.`}
                </span>
              </div>
            ))}
          </Card>
        );
      })}

      <div className="flex gap-2 mt-4">
        <Btn variant="ghost" className="flex-1" onClick={() => repeatWorkout(workout)}>Nochmal trainieren</Btn>
        <Btn variant="danger" onClick={() => { deleteWorkout(workout.id); go("history"); }}>Löschen</Btn>
      </div>
    </div>
  );
}

/* --- Rangliste + Freunde ------------------------------------------------ */
const BOARDS = [
  { value: "workouts", label: "Workouts", unit: "Workouts", color: PLATE.yellow },
  { value: "streak", label: "Serie", unit: "Tage", color: PLATE.yellow },
  { value: "reps", label: "Wiederholungen", unit: "Wdh.", color: PLATE.yellow },
  { value: "minutes", label: "Trainingszeit", unit: "min", color: PLATE.yellow },
  { value: "km", label: "Laufen", unit: "km", color: PLATE.blue },
  { value: "jumps", label: "Seilspringen", unit: "Sprünge", color: PLATE.green },
];

function LeaderboardScreen({ ctx }) {
  const T = useT();
  const { profile, board, refreshBoard, social, sendRequest, acceptRequest, declineRequest, removeFriend, toast } = ctx;
  const [metric, setMetric] = useState("workouts");
  const [scope, setScope] = useState("alle");
  const [exBoard, setExBoard] = useState("");
  const [q, setQ] = useState("");
  const [searchRes, setSearchRes] = useState(null);
  const [openFriend, setOpenFriend] = useState(null);

  useEffect(() => { refreshBoard(); }, [refreshBoard]);

  const friends = social.friends || [];
  const rows = useMemo(() => {
    let list = board.filter((b) => b.username);
    if (scope === "freunde") list = list.filter((b) => b.username === profile.username || friends.includes(b.username));
    if (exBoard) {
      return list.map((b) => ({ ...b, _v: b.perExercise?.[exBoard] || 0 })).filter((b) => b._v > 0).sort((a, b) => b._v - a._v);
    }
    return list.map((b) => ({ ...b, _v: b[metric] || 0 })).sort((a, b) => b._v - a._v);
  }, [board, metric, scope, friends, profile.username, exBoard]);

  const myRank = rows.findIndex((r) => r.username === profile.username) + 1;
  const exOptions = useMemo(() => {
    const s = new Set();
    board.forEach((b) => Object.keys(b.perExercise || {}).forEach((n) => s.add(n)));
    return [...s].sort();
  }, [board]);

  const doSearch = async () => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return setSearchRes([]);
    const found = await Cloud.findUsernames(t, ctx.owner).catch(() => []);
    setSearchRes(found.filter((c) => c.username.toLowerCase() !== profile.username.toLowerCase()));
  };

  const unit = exBoard ? "Wdh." : BOARDS.find((b) => b.value === metric).unit;
  const color = exBoard ? PLATE.yellow : BOARDS.find((b) => b.value === metric).color;

  return (
    <div className="px-5 pt-6 pb-28 rig-fade">
      <div className="rig-display text-3xl mb-1" style={{ color: T.text }}>Rangliste</div>
      <div className="text-sm mb-5" style={{ color: T.muted }}>
        {profile.privacy.leaderboard ? "Du bist dabei." : "Du bist ausgeblendet – ändern kannst du das im Profil."}
      </div>

      <div className="mb-3">
        <Segmented value={scope} onChange={setScope}
          options={[{ value: "alle", label: "Alle" }, { value: "freunde", label: `Freunde (${friends.length})` }]} />
      </div>
      <div className="mb-3">
        <Segmented value={exBoard ? "_ex" : metric} onChange={(v) => { if (v !== "_ex") { setMetric(v); setExBoard(""); } }} options={BOARDS} />
      </div>
      {exOptions.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto rig-scroll">
          {exOptions.slice(0, 12).map((n) => (
            <button key={n} onClick={() => setExBoard(exBoard === n ? "" : n)}
              className="text-xs px-3 py-2 rounded-lg whitespace-nowrap"
              style={{ background: exBoard === n ? PLATE.yellow : T.panel, color: exBoard === n ? "#14161B" : T.muted, border: `1px solid ${T.line}` }}>
              {n}
            </button>
          ))}
        </div>
      )}

      {myRank > 0 && (
        <Card className="p-4 mb-4" style={{ borderColor: PLATE.yellow }}>
          <div className="flex justify-between items-center">
            <div>
              <Eyebrow color={PLATE.yellow}>Dein Platz</Eyebrow>
              <div className="rig-num text-3xl" style={{ color: T.text }}>#{myRank}<span className="text-sm ml-2" style={{ color: T.muted }}>von {rows.length}</span></div>
            </div>
            <div className="rig-num text-xl" style={{ color: PLATE.yellow }}>{nf(rows[myRank - 1]._v, metric === "km" && !exBoard ? 1 : 0)} {unit}</div>
          </div>
        </Card>
      )}

      {rows.length === 0 && (
        <Empty title="Noch niemand hier" hint="Sobald du oder deine Freunde etwas gespeichert habt, füllt sich die Liste." />
      )}

      {rows.map((r, i) => {
        const me = r.username === profile.username;
        return (
          <Card key={r.username} className="p-4 mb-2" style={me ? { borderColor: PLATE.yellow } : undefined}
            onClick={me ? undefined : () => setOpenFriend(r)}>
            <div className="flex items-center gap-3">
              <span className="rig-num text-sm w-8 shrink-0" style={{ color: i < 3 ? PLATE.yellow : T.muted }}>{i + 1}</span>
              <span className="text-lg">{r.emoji || "🦍"}</span>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="text-sm truncate" style={{ color: T.text, fontWeight: me ? 600 : 400 }}>
                  {r.username}{me && " · du"}
                </div>
                {r.streak > 0 && <div className="text-xs" style={{ color: T.muted }}>{r.streak} Tage Serie</div>}
              </div>
              <span className="rig-num text-sm" style={{ color }}>{nf(r._v, metric === "km" && !exBoard ? 1 : 0)}</span>
            </div>
          </Card>
        );
      })}

      {/* Freunde */}
      <div className="mt-8">
        <Eyebrow>Freunde finden</Eyebrow>
        <div className="flex gap-2 mb-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Benutzername" className="flex-1 px-4 py-3 rounded-xl"
            style={{ background: T.panel, color: T.text, border: `1px solid ${T.line}` }} />
          <Btn variant="quiet" onClick={doSearch}>Suchen</Btn>
        </div>
        {searchRes?.length === 0 && <div className="text-xs mb-3" style={{ color: T.muted }}>Keinen Treffer gefunden.</div>}
        {searchRes?.map((u) => {
          const isFriend = friends.includes(u.username);
          return (
            <Card key={u.username} className="p-3 mb-2">
              <div className="flex items-center gap-3">
                <span className="text-lg">{u.emoji}</span>
                <span className="flex-1 text-sm" style={{ color: T.text }}>{u.username}</span>
                {isFriend
                  ? <span className="text-xs" style={{ color: PLATE.green }}>befreundet</span>
                  : <Btn variant="quiet" style={{ padding: "8px 12px" }} onClick={() => sendRequest(u.username)}>Anfrage senden</Btn>}
              </div>
            </Card>
          );
        })}

        {(social.requests || []).length > 0 && (
          <>
            <Eyebrow color={PLATE.yellow}>Offene Anfragen</Eyebrow>
            {social.requests.map((u) => (
              <Card key={u} className="p-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm" style={{ color: T.text }}>{u}</span>
                  <Btn style={{ padding: "8px 12px" }} onClick={() => acceptRequest(u)}>Annehmen</Btn>
                  <Btn variant="ghost" style={{ padding: "8px 12px" }} onClick={() => declineRequest(u)}>Ablehnen</Btn>
                </div>
              </Card>
            ))}
          </>
        )}

        {friends.length > 0 && (
          <>
            <Eyebrow>Deine Freunde</Eyebrow>
            {friends.map((u) => (
              <Card key={u} className="p-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm truncate" style={{ color: T.text }}>{u}</span>
                  <button onClick={() => ctx.startCall(roomFor1v1(profile.username, u), `1:1 · du & ${u}`)}
                    className="text-xs px-2 py-2 rounded-lg" style={{ background: T.panel2, color: PLATE.blue }}>📹</button>
                  <button onClick={() => setOpenFriend(board.find((b) => b.username === u) || { username: u })}
                    className="text-xs px-3 py-2 rounded-lg" style={{ background: T.panel2, color: T.text }}>Profil</button>
                  <button onClick={() => removeFriend(u)} className="text-xs px-2" style={{ color: PLATE.red }}>Entfernen</button>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>

      <Sheet open={!!openFriend} onClose={() => setOpenFriend(null)} title={openFriend?.username || ""}>
        {openFriend && <FriendProfile entry={openFriend} isFriend={friends.includes(openFriend.username)} me={profile.username}
          onAdd={() => { sendRequest(openFriend.username); setOpenFriend(null); }} />}
      </Sheet>
    </div>
  );
}

function CallButtons({ me, friend }) {
  const T = useT();
  const { startCall } = React.useContext(CallCtx);
  return (
    <div className="flex gap-2 mb-4">
      <Btn tone={PLATE.blue} className="flex-1" onClick={() => startCall(roomFor1v1(me, friend), `1:1 · du & ${friend}`)}>
        📹 1:1 anrufen
      </Btn>
      <Btn variant="quiet" className="flex-1" onClick={() => startCall(roomForTeam(friend), `Team-Call · ${friend}s Raum`)}>
        Team-Call beitreten
      </Btn>
    </div>
  );
}

function FriendProfile({ entry, isFriend, onAdd, me }) {
  const T = useT();
  const share = entry.share || {};
  if (!share.profile) {
    return (
      <div className="py-6 text-center">
        <div className="text-4xl mb-3">{entry.emoji || "🦍"}</div>
        <div className="text-sm mb-5" style={{ color: T.muted }}>
          {entry.username} hat das Profil auf privat gestellt. Sichtbar bleibt nur der Platz in der Rangliste.
        </div>
        {isFriend && <CallButtons me={me} friend={entry.username} />}
      </div>
    );
  }
  return (
    <div>
      <div className="text-center mb-5">
        <div className="text-5xl mb-2">{entry.emoji || "🦍"}</div>
        <div className="rig-display text-2xl" style={{ color: T.text }}>{entry.username}</div>
        {entry.streak > 0 && <div className="rig-num text-sm mt-1" style={{ color: PLATE.yellow }}>{entry.streak} Tage Serie</div>}
      </div>
      {isFriend && <CallButtons me={me} friend={entry.username} />}
      <Card className="p-5 mb-3">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Workouts" value={nf(entry.workouts)} />
          <Stat label="Wiederholungen" value={nf(entry.reps)} />
          <Stat label="Zeit" value={Math.round((entry.minutes || 0) / 60)} unit="h" />
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4" style={{ borderTop: `1px solid ${T.line}` }}>
          <Stat label="Laufen" value={share.runs ? `${nf(entry.km, 1)}` : "privat"} unit={share.runs ? "km" : ""} color={PLATE.blue} />
          <Stat label="Sprünge" value={nf(entry.jumps)} color={PLATE.green} />
        </div>
      </Card>
      {share.workouts && entry.perExercise && Object.keys(entry.perExercise).length > 0 && (
        <Card className="p-4 mb-3">
          <Eyebrow>Top-Übungen</Eyebrow>
          {Object.entries(entry.perExercise).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v], i) => (
            <div key={n} className="flex justify-between py-2 text-sm" style={{ borderTop: i ? `1px solid ${T.line}` : "none" }}>
              <span style={{ color: T.text }}>{n}</span><span className="rig-num" style={{ color: T.muted }}>{nf(v)}</span>
            </div>
          ))}
        </Card>
      )}
      {!isFriend && <Btn className="w-full" onClick={onAdd}>Freundschaftsanfrage senden</Btn>}
    </div>
  );
}

/* --- Profil / Einstellungen --------------------------------------------- */
function ProfileScreen({ ctx }) {
  const T = useT();
  const { profile, patchProfile, workouts, runs, ropes, prs, exportData, go, resetAll, startCall, cloudStatus, authEmail, signOut } = ctx;
  const agg = aggregate(workouts, runs, ropes);
  const streak = computeStreak(activeDays(workouts, runs, ropes));
  const [confirmReset, setConfirmReset] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const statusLabel = { unconfigured: "Nicht angemeldet", ok: "Synchronisiert", error: "Sync-Fehler" }[cloudStatus] || "Nicht angemeldet";
  const statusColor = { unconfigured: T.muted, ok: PLATE.green, error: PLATE.red }[cloudStatus] || T.muted;
  const doSignOut = async () => {
    setSignOutBusy(true);
    await signOut();
    setSignOutBusy(false);
  };

  const Toggle = ({ label, hint, on, set }) => (
    <div className="flex items-center justify-between py-3" style={{ borderTop: `1px solid ${T.line}` }}>
      <div className="pr-4">
        <div className="text-sm" style={{ color: T.text }}>{label}</div>
        {hint && <div className="text-xs mt-0.5" style={{ color: T.muted }}>{hint}</div>}
      </div>
      <button onClick={() => set(!on)} className="shrink-0" style={{
        width: 48, height: 28, borderRadius: 999, background: on ? PLATE.yellow : T.panel2,
        border: `1px solid ${T.line}`, position: "relative", transition: "background .18s ease",
      }}>
        <span style={{
          position: "absolute", top: 2, left: on ? 22 : 2, width: 22, height: 22, borderRadius: 999,
          background: on ? "#14161B" : T.muted, transition: "left .18s ease",
        }} />
      </button>
    </div>
  );

  return (
    <div className="px-5 pt-6 pb-28 rig-fade">
      <div className="text-center mb-6">
        <div className="text-6xl mb-3">{profile.emoji}</div>
        <div className="rig-display text-3xl" style={{ color: T.text }}>{profile.username}</div>
        <div className="text-xs mt-1" style={{ color: T.muted }}>dabei seit {fmtDate(profile.createdAt)}</div>
      </div>

      <div className="flex flex-wrap gap-2 justify-center mb-6">
        {EMOJIS.map((e) => (
          <button key={e} onClick={() => patchProfile({ emoji: e })} className="w-9 h-9 rounded-lg text-base"
            style={{ background: profile.emoji === e ? PLATE.yellow : T.panel, border: `1px solid ${T.line}` }}>{e}</button>
        ))}
      </div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Stat label="Workouts" value={nf(agg.workouts)} />
          <Stat label="Wiederholungen" value={nf(agg.reps)} />
          <Stat label="Serie" value={streak} unit="d" color={PLATE.yellow} />
        </div>
        <div className="grid grid-cols-3 gap-4 pt-4" style={{ borderTop: `1px solid ${T.line}` }}>
          <Stat label="Laufen" value={nf(agg.km, 1)} unit="km" color={PLATE.blue} />
          <Stat label="Sprünge" value={nf(agg.jumps)} color={PLATE.green} />
          <Stat label="Rekorde" value={Object.keys(prs).length} color={PLATE.red} />
        </div>
      </Card>

      <Btn tone={PLATE.blue} className="w-full mb-4" onClick={() => startCall(roomForTeam(profile.username), "Team-Call · dein Raum")}>
        📹 Team-Call starten
      </Btn>
      <div className="text-xs -mt-2 mb-4" style={{ color: T.muted }}>
        Freunde erreichen deinen Raum über dein Profil in der Rangliste – „Team-Call beitreten".
      </div>

      <Card className="p-4 mb-4">
        <Eyebrow>Wochenziel</Eyebrow>
        <div className="flex items-center gap-3">
          <NumberField value={profile.weeklyGoal} onChange={(v) => patchProfile({ weeklyGoal: clamp(Math.round(v), 1, 14) })} min={1} max={14} width={70} />
          <span className="text-sm" style={{ color: T.muted }}>Trainings pro Woche</span>
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <Eyebrow>Darstellung</Eyebrow>
        <Segmented value={profile.theme} onChange={(v) => patchProfile({ theme: v })}
          options={[{ value: "dark", label: "Dunkel" }, { value: "light", label: "Hell" }]} />
      </Card>

      <Card className="px-4 pb-2 pt-4 mb-4">
        <Eyebrow>Sichtbarkeit</Eyebrow>
        <Toggle label="Profil öffentlich" hint="Freunde sehen deine Zahlen im Detail."
          on={profile.privacy.profilePublic} set={(v) => patchProfile({ privacy: { ...profile.privacy, profilePublic: v } })} />
        <Toggle label="Trainings öffentlich" hint="Zeigt deine Top-Übungen auf dem Profil."
          on={profile.privacy.workoutsPublic} set={(v) => patchProfile({ privacy: { ...profile.privacy, workoutsPublic: v } })} />
        <Toggle label="In der Rangliste auftauchen" hint="Aus heißt: dein Eintrag verschwindet komplett."
          on={profile.privacy.leaderboard} set={(v) => patchProfile({ privacy: { ...profile.privacy, leaderboard: v } })} />
        <Toggle label="Läufe öffentlich" hint="Kilometer bleiben sonst bei null."
          on={profile.privacy.runsPublic} set={(v) => patchProfile({ privacy: { ...profile.privacy, runsPublic: v } })} />
      </Card>

      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <Eyebrow>Konto</Eyebrow>
          <span className="text-xs rig-num px-2 py-1 rounded-full" style={{ background: T.panel2, color: statusColor }}>{statusLabel}</span>
        </div>
        <div className="text-sm mb-3" style={{ color: T.text }}>{authEmail}</div>
        <div className="text-xs mb-4" style={{ color: T.muted }}>
          Angemeldet über Supabase Auth. Deine Daten synchronisieren automatisch und sind auf
          jedem Gerät verfügbar, auf dem du dich mit dieser E-Mail-Adresse anmeldest.
        </div>
        <Btn variant="ghost" className="w-full" disabled={signOutBusy} onClick={doSignOut}>
          {signOutBusy ? "Moment …" : "Abmelden"}
        </Btn>
      </Card>

      <div className="flex gap-2 mb-3">
        <Btn variant="ghost" className="flex-1" onClick={() => go("history")}>Historie</Btn>
        <Btn variant="ghost" className="flex-1" onClick={exportData}>Daten exportieren</Btn>
      </div>

      {confirmReset ? (
        <Card className="p-4" style={{ borderColor: PLATE.red }}>
          <div className="text-sm mb-3" style={{ color: T.text }}>
            Das löscht alle Trainings, Läufe, Sprünge und Rekorde auf diesem Gerät. Rückgängig geht nicht.
          </div>
          <div className="flex gap-2">
            <Btn variant="ghost" className="flex-1" onClick={() => setConfirmReset(false)}>Abbrechen</Btn>
            <Btn variant="danger" className="flex-1" onClick={resetAll}>Alles löschen</Btn>
          </div>
        </Card>
      ) : (
        <Btn variant="danger" className="w-full" onClick={() => setConfirmReset(true)}>Alle Daten löschen</Btn>
      )}

      <div className="text-xs text-center mt-6" style={{ color: T.muted }}>Rig Daily · MVP</div>
    </div>
  );
}

/* --- Navigation --------------------------------------------------------- */
const TABS = [
  { key: "home", label: "Home", icon: "▤" },
  { key: "workout", label: "Workout", icon: "✚" },
  { key: "stats", label: "Statistik", icon: "▮" },
  { key: "board", label: "Rangliste", icon: "▲" },
  { key: "profile", label: "Profil", icon: "●" },
];

function TabBar({ tab, go, active }) {
  const T = useT();
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center">
      <div className="w-full flex" style={{ maxWidth: 480, background: T.panel, borderTop: `1px solid ${T.line}`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map((t) => {
          const on = tab === t.key || (t.key === "stats" && ["history", "detail"].includes(tab));
          const dot = t.key === "workout" && active;
          return (
            <button key={t.key} onClick={() => go(t.key)} className="flex-1 py-3 flex flex-col items-center gap-1 active:scale-95">
              <span className="text-sm relative" style={{ color: on ? PLATE.yellow : T.muted }}>
                {t.icon}
                {dot && <span style={{ position: "absolute", top: -2, right: -6, width: 6, height: 6, borderRadius: 9, background: PLATE.yellow }} />}
              </span>
              <span className="text-xs" style={{ color: on ? T.text : T.muted, fontSize: 10 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- 8 APP       */
/* Sichtbares Absturz-Overlay statt einer toten/weißen Seite – wichtig, weil
   wir bei Problemen sonst keine Konsole von den Geräten der Nutzer sehen. */
function CrashOverlay({ error, debugInfo }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#101218", color: "#EFEDE7", padding: 24, fontFamily: "system-ui, sans-serif", overflowY: "auto", zIndex: 9999 }}>
      <div className="rig-display" style={{ fontSize: 20, marginBottom: 12 }}>
        {error ? "App-Fehler" : "Lädt ungewöhnlich lange"}
      </div>
      <div style={{ fontSize: 13, marginBottom: 12, color: "#878D9C" }}>Bitte Screenshot hiervon schicken:</div>
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#191C24", padding: 12, borderRadius: 8, fontSize: 11, color: error ? "#D6402F" : "#F2C230", lineHeight: 1.5 }}>
        {error ? `${error.message || error}\n\n${error.stack || ""}` : JSON.stringify(debugInfo, null, 2)}
      </pre>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { try { console.error(error); } catch { /* egal */ } }
  render() { return this.state.error ? <CrashOverlay error={this.state.error} /> : this.props.children; }
}

function GlobalErrorWatcher() {
  const [err, setErr] = useState(null);
  useEffect(() => {
    const onErr = (e) => setErr(e.error instanceof Error ? e.error : new Error(String(e.message || e)));
    const onRej = (e) => setErr(e.reason instanceof Error ? e.reason : new Error(String(e.reason)));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
  }, []);
  return err ? <CrashOverlay error={err} /> : null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <GlobalErrorWatcher />
      <AppInner />
    </ErrorBoundary>
  );
}

function AppInner() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [workouts, setWorkouts] = useState([]);
  const [runs, setRuns] = useState([]);
  const [ropes, setRopes] = useState([]);
  const [custom, setCustom] = useState([]);
  const [prs, setPrs] = useState({});
  const [active, setActive] = useState(null);
  const [board, setBoard] = useState([]);
  const [social, setSocial] = useState({ friends: [], requests: [] });
  const [tab, setTab] = useState("home");
  const [detail, setDetail] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [cloudStatusState, setCloudStatusState] = useState("unconfigured");
  const [authSession, setAuthSession] = useState(undefined); // undefined = wird noch geprüft, null = nicht angemeldet
  const [call, setCall] = useState(null); // {room, label, me}
  const [stuck, setStuck] = useState(null);

  /* Hängt der Ladevorgang ungewöhnlich lange, sichtbaren Diagnose-Zustand
     zeigen statt einer stillen, toten Seite. */
  useEffect(() => {
    if (ready) { setStuck(null); return; }
    const t = setTimeout(() => {
      setStuck({
        ready, authSession: authSession === undefined ? "undefined (Session-Check läuft noch)" : authSession,
        hasSupabaseGlobal: typeof supabase !== "undefined", hasWindow: typeof window !== "undefined",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        time: new Date().toISOString(),
      });
    }, 6000);
    return () => clearTimeout(t);
  }, [ready, authSession]);

  const T = profile?.theme === "light" ? LIGHT : DARK;
  /* undefined = Sitzungs-Check läuft noch, null = geprüft und nicht angemeldet,
     sonst die auth.uid() – als eigener Zustand, damit "noch am Prüfen" und
     "geprüft, nicht angemeldet" sich unterscheiden. Beides auf null zu mappen
     hätte den Lade-Effekt unten (hängt an [authUid]) nie neu auslösen lassen,
     wenn die Prüfung mit "nicht angemeldet" endet – die App blieb dann für
     jeden ohne bestehende Sitzung für immer im Lade-Kreisel hängen. */
  const authUid = authSession === undefined ? undefined : (authSession?.user?.id || null);
  const owner = authUid || "";
  const authEmail = authSession?.user?.email || "";

  const toast = useCallback((t) => {
    setToastMsg(t);
    setTimeout(() => setToastMsg(null), t.kind === "pr" ? 4200 : 2600);
  }, []);

  const startCall = useCallback((room, label) => setCall({ room, label, me: profile?.username || "Gast" }), [profile]);

  /* --- Cloud-Verbindungsstatus live spiegeln --- */
  useEffect(() => S.onStatus(setCloudStatusState), []);

  /* --- Auth-Session: einmal laden, danach auf Änderungen (Login, Logout,
     Token-Refresh, Login in einem anderen Tab) reagieren. --- */
  useEffect(() => {
    let cancelled = false;
    const settle = (session) => {
      if (cancelled) return;
      cancelled = true; // erster Treffer gewinnt (Session-Check oder Timeout)
      S.setSession(session);
      setAuthSession(session);
    };
    /* Schlägt der Sitzungs-Check fehl (Netzwerk-/Browserproblem) oder hängt er,
       darf die App nicht für immer im Lade-Kreisel bleiben – nach 8s einfach
       als "nicht angemeldet" weitermachen, dann sieht man wenigstens die
       Anmeldemaske statt einer toten Seite. */
    const timeout = setTimeout(() => settle(null), 8000);
    supabase.auth.getSession()
      .then(({ data }) => { clearTimeout(timeout); settle(data.session); })
      .catch(() => { clearTimeout(timeout); settle(null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      S.setSession(s);
      setAuthSession(s);
    });
    return () => { cancelled = true; clearTimeout(timeout); sub.subscription.unsubscribe(); };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null); setWorkouts([]); setRuns([]); setRopes([]); setCustom([]); setPrs({});
    setActive(null); setBoard([]); setSocial({ friends: [], requests: [] }); setTab("home"); setDetail(null);
    await Promise.all([
      Local.del(K.profile), Local.del(K.workouts), Local.del(K.runs), Local.del(K.ropes),
      Local.del(K.custom), Local.del(K.prs), Local.del(K.active),
    ]);
  }, []);

  /* --- Laden, sobald die Session feststeht ---
     Hängt bewusst nur an der User-ID, nicht am ganzen Session-Objekt: onAuthStateChange
     feuert bei jedem Token-Refresh (stündlich) mit einer neuen Session-Instanz für
     denselben Nutzer – ein Reload aller Daten (inkl. des laufenden Workouts) wäre dabei
     reine Verschwendung und könnte frische lokale Änderungen mit älterem Cloud-Stand
     überschreiben. Bei echtem Login/Logout/Kontowechsel ändert sich die ID und der
     Effekt läuft trotzdem. */
  useEffect(() => {
    (async () => {
      if (authUid === undefined) return; // Session-Check noch nicht abgeschlossen
      if (!authUid) { setProfile(null); setReady(true); return; }
      const [p, w, r, j, c, pr, a] = await Promise.all([
        Local.get(K.profile), Local.get(K.workouts), Local.get(K.runs), Local.get(K.ropes),
        Local.get(K.custom), Local.get(K.prs), Local.get(K.active),
      ]);
      setProfile(p); setWorkouts(w || []); setRuns(r || []); setRopes(j || []);
      setCustom(c || []); setPrs(pr || {}); setActive(a || null);
      if (p) {
        const soc = await Local.get(K.social(p.username), true);
        setSocial(soc || { friends: [], requests: [] });
      }
      setReady(true);

      /* Stiller Abgleich mit der Cloud im Hintergrund – überschreibt nur, wenn dort
         tatsächlich etwas hinterlegt ist, damit ein leerer Server nichts löscht. */
      const remote = await pullAll(authUid).catch(() => null);
      /* Nur übernehmen, wenn die Cloud tatsächlich vollständige Einstellungen hat –
         sonst würde ein noch unvollständiges Profil (z. B. kurz nach Signup, bevor
         die Einstellungen geschrieben wurden) das gute lokale Profil zerstören. */
      if (remote?.profile?.theme) { setProfile(remote.profile); Local.set(K.profile, remote.profile); }
      if (remote?.workouts) { setWorkouts(remote.workouts); Local.set(K.workouts, remote.workouts); }
      if (remote?.runs) { setRuns(remote.runs); Local.set(K.runs, remote.runs); }
      if (remote?.ropes) { setRopes(remote.ropes); Local.set(K.ropes, remote.ropes); }
      if (remote?.custom) { setCustom(remote.custom); Local.set(K.custom, remote.custom); }
      if (remote?.prs) { setPrs(remote.prs); Local.set(K.prs, remote.prs); }
      if (remote?.social) { setSocial(remote.social); Local.set(K.social(remote.profile.username), remote.social, true); }
    })();
  }, [authUid]);

  /* --- Neues Konto angelegt (Onboarding) --- */
  const createProfile = async (p, session) => {
    S.setSession(session); setAuthSession(session);
    setProfile(p);
    await S.set(K.profile, p, false, session.user.id);
    await pushBoard(p, [], [], []);
  };

  /* --- Login mit bestehendem Konto (neues Gerät) --- */
  const loginExisting = async (data) => {
    S.setSession(data.session); setAuthSession(data.session);
    setProfile(data.profile); setWorkouts(data.workouts || []); setRuns(data.runs || []);
    setRopes(data.ropes || []); setCustom(data.custom || []); setPrs(data.prs || {});
    setSocial(data.social || { friends: [], requests: [] });
    await Promise.all([
      Local.set(K.profile, data.profile), Local.set(K.workouts, data.workouts || []),
      Local.set(K.runs, data.runs || []), Local.set(K.ropes, data.ropes || []),
      Local.set(K.custom, data.custom || []), Local.set(K.prs, data.prs || {}),
      Local.set(K.social(data.profile.username), data.social || { friends: [], requests: [] }, true),
    ]);
    /* Falls die Cloud noch keine (vollständigen) Profil-Einstellungen hatte
       (z. B. erster Login nach E-Mail-Bestätigung), jetzt nachschreiben –
       sonst überschreibt der nächste Hintergrund-Abgleich das gute lokale
       Profil wieder mit einem unvollständigen. */
    if (data.session?.user?.id) S.set(K.profile, data.profile, false, data.session.user.id);
    toast({ msg: `Willkommen zurück, ${data.profile.username}.` });
  };

  /* --- Autosave des laufenden Workouts --- */
  useEffect(() => {
    if (!ready) return;
    S.set(K.active, active, false, owner);
  }, [active, ready, owner]);

  /* --- Rangliste aktualisieren --- */
  const pushBoard = useCallback(async (p = profile, w = workouts, r = runs, j = ropes) => {
    if (!p) return;
    if (!p.privacy.leaderboard) { await S.del(K.board(p.username), true); return; }
    await S.set(K.board(p.username), buildBoardEntry(p, w, r, j), true);
  }, [profile, workouts, runs, ropes]);

  const refreshBoard = useCallback(async () => {
    const keys = await S.keys("board:", true);
    const out = [];
    for (const k of keys.slice(0, 200)) {
      const e = await S.get(k, true);
      if (e?.username) out.push(e);
    }
    setBoard(out);
    if (profile) {
      const soc = await S.get(K.social(profile.username), true);
      if (soc) setSocial(soc);
    }
  }, [profile]);

  /* --- Profil --- */
  const patchProfile = async (patch) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    await S.set(K.profile, next, false, owner);
    if (patch.emoji) await Cloud.upsertProfileRow(owner, next.username, next.emoji).catch(() => {});
    await pushBoard(next);
  };

  /* --- Übungen --- */
  const exercises = useMemo(() => [...BASE_EX, ...custom].sort((a, b) => a.name.localeCompare(b.name, "de")), [custom]);
  const addCustomExercise = (name, category, type) => {
    if (exercises.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
      toast({ kind: "error", msg: "Diese Übung gibt es schon." });
      return exercises.find((e) => e.name.toLowerCase() === name.toLowerCase());
    }
    const ex = { id: "c_" + uid(), name, category, type, custom: true };
    const next = [...custom, ex];
    setCustom(next); S.set(K.custom, next, false, owner);
    return ex;
  };

  /* --- Workout --- */
  const startWorkout = (preset) => {
    setActive({
      id: uid(), startedAt: Date.now(), accum: 0, resumedAt: null, paused: false, started: false,
      title: preset?.title || "",
      exercises: (preset?.exercises || []).map((e) => ({ key: uid(), exerciseId: e.exerciseId, name: e.name, category: e.category, type: e.type, sets: [] })),
    });
    setTab("workout");
  };
  const repeatWorkout = (w) => { startWorkout({ title: w.title, exercises: w.exercises }); };

  const finishWorkout = async (elapsed) => {
    if (!active) return;
    const nonEmpty = active.exercises.filter((e) => e.sets.length > 0);
    if (!nonEmpty.length) {
      toast({ kind: "error", msg: "Ohne einen einzigen Satz gibt es nichts zu speichern." });
      return;
    }
    if (elapsed < 20) { toast({ kind: "error", msg: "Unter 20 Sekunden speichert die App nicht." }); return; }
    const cats = [...new Set(nonEmpty.map((e) => e.category))];
    const w = {
      id: active.id, startedAt: active.startedAt, endedAt: Date.now(),
      durationSec: elapsed, title: active.title || cats.slice(0, 2).join(" + ") || "Training",
      exercises: nonEmpty,
    };
    const nextW = [w, ...workouts];
    const { prs: nextPrs, neu } = detectPRs(prs, w);
    setWorkouts(nextW); setPrs(nextPrs); setActive(null);
    await Promise.all([
      S.set(K.workouts, nextW, false, owner), S.set(K.prs, nextPrs, false, owner), S.set(K.active, null, false, owner),
    ]);
    await pushBoard(profile, nextW, runs, ropes);
    setTab("home");
    if (neu.length) {
      beep();
      toast({ kind: "pr", title: neu.length === 1 ? "Neuer Rekord" : `${neu.length} neue Rekorde`, msg: neu.slice(0, 3).join(" · ") });
    } else {
      toast({ msg: `Training gespeichert · ${fmtMin(elapsed)}` });
    }
  };
  const discardWorkout = async () => { setActive(null); await S.set(K.active, null, false, owner); setTab("home"); toast({ msg: "Training verworfen." }); };

  const deleteWorkout = async (id) => {
    const next = workouts.filter((w) => w.id !== id);
    setWorkouts(next); await S.set(K.workouts, next, false, owner); await pushBoard(profile, next, runs, ropes);
    toast({ msg: "Training gelöscht." });
  };

  /* --- Laufen / Seil --- */
  const addRun = async (r) => {
    const next = [r, ...runs]; setRuns(next); await S.set(K.runs, next, false, owner);
    await pushBoard(profile, workouts, next, ropes);
    toast({ msg: `Lauf gespeichert · ${nf(r.distanceKm, 2)} km` });
  };
  const deleteRun = async (id) => {
    const next = runs.filter((r) => r.id !== id); setRuns(next); await S.set(K.runs, next, false, owner);
    await pushBoard(profile, workouts, next, ropes);
  };
  const addRope = async (r) => {
    const next = [r, ...ropes]; setRopes(next); await S.set(K.ropes, next, false, owner);
    await pushBoard(profile, workouts, runs, next);
    toast({ msg: `${nf(r.totalJumps)} Sprünge gespeichert.` });
  };
  const deleteRope = async (id) => {
    const next = ropes.filter((r) => r.id !== id); setRopes(next); await S.set(K.ropes, next, false, owner);
    await pushBoard(profile, workouts, runs, next);
  };

  /* --- Social --- */
  const sendRequest = async (target) => {
    const key = K.social(target);
    const cur = (await S.get(key, true)) || { friends: [], requests: [] };
    if (cur.friends.includes(profile.username)) return toast({ msg: "Ihr seid schon befreundet." });
    if (cur.requests.includes(profile.username)) return toast({ msg: "Anfrage läuft schon." });
    cur.requests = [...cur.requests, profile.username];
    await S.set(key, cur, true);
    toast({ msg: `Anfrage an ${target} ist raus.` });
  };
  const acceptRequest = async (from) => {
    const mine = { friends: [...new Set([...(social.friends || []), from])], requests: (social.requests || []).filter((r) => r !== from) };
    setSocial(mine); await S.set(K.social(profile.username), mine, true);
    const theirs = (await S.get(K.social(from), true)) || { friends: [], requests: [] };
    theirs.friends = [...new Set([...theirs.friends, profile.username])];
    await S.set(K.social(from), theirs, true);
    toast({ msg: `${from} ist jetzt in deiner Liste.` });
  };
  const declineRequest = async (from) => {
    const mine = { ...social, requests: (social.requests || []).filter((r) => r !== from) };
    setSocial(mine); await S.set(K.social(profile.username), mine, true);
  };
  const removeFriend = async (u) => {
    const mine = { ...social, friends: (social.friends || []).filter((f) => f !== u) };
    setSocial(mine); await S.set(K.social(profile.username), mine, true);
    const theirs = (await S.get(K.social(u), true)) || { friends: [], requests: [] };
    theirs.friends = theirs.friends.filter((f) => f !== profile.username);
    await S.set(K.social(u), theirs, true);
  };

  /* --- Export / Reset --- */
  const exportData = () => {
    try {
      const blob = new Blob([JSON.stringify({ profile, workouts, runs, ropes, prs, custom, exportedAt: new Date().toISOString() }, null, 2)],
        { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `rig-daily-${dayKey(Date.now())}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ msg: "Export als JSON-Datei gestartet." });
    } catch {
      toast({ kind: "error", msg: "Der Download ließ sich hier nicht starten." });
    }
  };
  const resetAll = async () => {
    setWorkouts([]); setRuns([]); setRopes([]); setPrs({}); setActive(null);
    await Promise.all([
      S.set(K.workouts, [], false, owner), S.set(K.runs, [], false, owner), S.set(K.ropes, [], false, owner),
      S.set(K.prs, {}, false, owner), S.set(K.active, null, false, owner),
    ]);
    await pushBoard(profile, [], [], []);
    toast({ msg: "Alles gelöscht." });
  };

  const go = (t, payload) => {
    if (t === "detail") { setDetail(payload); setTab("detail"); return; }
    if (t === "run" || t === "rope" || t === "history") { setTab(t); return; }
    setTab(t);
  };

  const ctx = {
    profile, workouts, runs, ropes, prs, active, exercises, board, social, owner,
    setActive, go, toast, patchProfile, startWorkout, repeatWorkout, finishWorkout, discardWorkout,
    deleteWorkout, addRun, deleteRun, addRope, deleteRope, addCustomExercise,
    refreshBoard, sendRequest, acceptRequest, declineRequest, removeFriend, exportData, resetAll,
    startCall, cloudStatus: cloudStatusState, authEmail, signOut,
  };

  if (!ready) {
    if (stuck) return <CrashOverlay debugInfo={stuck} />;
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: DARK.bg }}>
        <style>{FONT_CSS}</style>
        <div className="rig-pulse"><Tally count={3} color={PLATE.yellow} size={30} /></div>
      </div>
    );
  }

  return (
    <ThemeCtx.Provider value={T}>
      <CallCtx.Provider value={{ startCall }}>
      <style>{FONT_CSS}</style>
      <div className="rig min-h-screen" style={{ background: T.bg, color: T.text }}>
        <div className="mx-auto" style={{ maxWidth: 480, minHeight: "100vh", background: T.bg }}>
          {!profile ? (
            <Onboarding onDone={createProfile} onLogin={loginExisting} />
          ) : (
            <>
              {tab === "home" && <Home ctx={ctx} />}
              {tab === "workout" && <WorkoutScreen ctx={ctx} />}
              {tab === "stats" && <StatsScreen ctx={ctx} />}
              {tab === "board" && <LeaderboardScreen ctx={ctx} />}
              {tab === "profile" && <ProfileScreen ctx={ctx} />}
              {tab === "run" && <RunScreen ctx={ctx} />}
              {tab === "rope" && <RopeScreen ctx={ctx} />}
              {tab === "history" && <HistoryScreen ctx={ctx} />}
              {tab === "detail" && detail && <WorkoutDetail ctx={ctx} workout={detail} />}
              <TabBar tab={tab} go={go} active={!!active} />
            </>
          )}
          <CallSheet call={call} onClose={() => setCall(null)} />
          <Toast toast={toastMsg} />
        </div>
      </div>
      </CallCtx.Provider>
    </ThemeCtx.Provider>
  );
}
