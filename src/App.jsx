"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { createClient } from "../utils/supabase/client.js";
import QRCode from "qrcode";

/* ============================================================================
   STRADAA — Training, Laufen, Seilspringen
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
  text: "#EFEDE7", muted: "#878D9C", chalk: "#EFEDE7",
  shadow: "0 6px 20px rgba(0,0,0,.28)", glow: "0 0 0 1px rgba(242,194,48,.35), 0 8px 24px rgba(242,194,48,.16)",
  ...PLATE,
};
const LIGHT = {
  bg: "#F4F2ED", panel: "#FFFFFF", panel2: "#EAE7E0", line: "#DBD7CD",
  text: "#15181F", muted: "#6C7280", chalk: "#15181F",
  shadow: "0 4px 16px rgba(21,24,31,.08)", glow: "0 0 0 1px rgba(242,194,48,.4), 0 8px 20px rgba(242,194,48,.18)",
  ...PLATE,
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
/* Kein "both"/"forwards": ein am Ende gehaltenes transform: none wird vom Browser
   weiter als Matrix (nicht das Keyword "none") berechnet und macht das Element
   ungewollt zum Containing Block für fixed-positionierte Kinder (z.B. Sheet) –
   das reißt jedes Sheet auf einer höheren Seite ans Ende des ganzen Inhalts statt
   an den Viewport-Rand. Ohne Fill-Mode fällt transform danach sauber auf "none" zurück. */
.rig-fade { animation: rigFade .22s ease-out; }
@keyframes rigFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.rig-sheet { animation: rigUp .26s cubic-bezier(.2,.8,.25,1); }
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
  return "stradaa-" + [slug(a), slug(b)].sort().join("-");
}
function roomForTeam(owner) {
  return "stradaa-team-" + slug(owner);
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

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "gerade eben";
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  return `vor ${d} Tag${d === 1 ? "" : "en"}`;
}

/* Bild vor dem Speichern client-seitig verkleinern – Fotos landen als JSON
   im Key-Value-Store, ohne Verkleinerung wären die Zeilen viel zu groß. */
function resizeImageFile(file, maxW = 640, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* Einzeiligen Text bei Bedarf mit "…" kürzen – für die Story-Karte, wo
   Nutzer-Titel beliebig lang sein können. */
function truncateCanvasText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

/* Workout als Story-Karte (1080×1920, Instagram-Story-Format) direkt auf einem
   <canvas> gezeichnet statt per DOM-Screenshot – dadurch unabhängig von
   Browser-Eigenheiten beim Rendern von Verläufen/Web-Fonts. */
async function drawWorkoutStoryCard(workout, username) {
  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  /* Canvas bleibt komplett transparent (kein Hintergrund, keine Karte/Box) – wie
     bei Strava: die Werte schweben direkt über dem Foto, ein Schlagschatten sorgt
     für Lesbarkeit auf jedem Hintergrund, statt eines Kastens dahinter. */
  const white = "#FFFFFF", labelCol = "rgba(255,255,255,.82)";

  try {
    await Promise.all([
      document.fonts.load('700 96px "Barlow Condensed"'), document.fonts.load('600 36px "Inter"'),
      document.fonts.load('700 44px "Barlow Condensed"'),
    ]);
    await document.fonts.ready;
  } catch { /* Web Fonts noch nicht bereit – Canvas fällt auf System-Font zurück */ }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  const cx = W / 2;

  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 3;

  const tot = workoutTotals(workout);
  const stats = [
    { label: "WIEDERHOLUNGEN", value: nf(tot.reps) },
    { label: "SÄTZE", value: nf(tot.sets) },
    { label: "VOLUMEN", value: `${nf(tot.volume)} kg` },
  ];

  let y = 420;

  ctx.fillStyle = labelCol;
  ctx.font = '600 36px "Inter", system-ui, sans-serif';
  ctx.fillText(truncateCanvasText(ctx, (workout.title || "Training").toUpperCase(), W - 120), cx, y);
  y += 100;

  stats.forEach((s) => {
    ctx.fillStyle = labelCol;
    ctx.font = '600 36px "Inter", system-ui, sans-serif';
    ctx.fillText(s.label, cx, y);
    ctx.fillStyle = white;
    ctx.font = '700 96px "Barlow Condensed", "Arial Narrow", sans-serif';
    ctx.fillText(s.value, cx, y + 96);
    y += 96 + 74;
  });

  y += 40;
  ctx.fillStyle = white;
  ctx.font = '700 44px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.fillText("STRADAA", cx, y);

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/* Erzeugt die Story-Karte und teilt sie nativ (Instagram, WhatsApp, …), falls
   der Browser das kann – sonst lädt sie als PNG herunter. */
async function shareWorkoutStory(workout, username, toast) {
  try {
    const blob = await drawWorkoutStoryCard(workout, username);
    if (!blob) throw new Error("no-blob");
    const file = new File([blob], "stradaa-workout.png", { type: "image/png" });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: "STRADAA" });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "stradaa-workout.png";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast({ msg: "Bild gespeichert." });
  } catch (err) {
    if (err?.name !== "AbortError") toast({ kind: "error", msg: "Bild ließ sich nicht erstellen." });
  }
}

/* ------------------------------------------------------- 3 ÜBUNGSDATENBANK */
/* type: "reps" = Körpergewicht (nur Wdh.), "weight" = Wdh. + kg, "time" = Sekunden */
const CATS = ["Brust", "Rücken", "Beine", "Schultern", "Arme", "Bauch", "Ganzkörper"];
const CAT_ICON = { Brust: "🎽", Rücken: "🧗", Beine: "🦵", Schultern: "🙆", Arme: "💪", Bauch: "🔥", Ganzkörper: "⚡" };
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

/* Feste Standard-Splits für den Workout-Schnellstart, aus dem eingebauten
   Übungskatalog zusammengestellt (bleiben also immer verfügbar). */
const STANDARD_TEMPLATES = [
  { title: "Push", icon: "🎽", duration: 25, hint: "Brust · Schultern · Trizeps", names: ["Bankdrücken", "Schulterdrücken", "Dips", "Trizeps Extensions"] },
  { title: "Pull", icon: "🧗", duration: 25, hint: "Rücken · Bizeps", names: ["Klimmzüge", "Rudern", "Kreuzheben", "Bizeps-Curls"] },
  { title: "Beine", icon: "🦵", duration: 25, hint: "Quads · Beinbizeps · Waden", names: ["Kniebeugen", "Ausfallschritte", "Bulgarian Split Squats", "Wadenheben"] },
  { title: "Ganzkörper", icon: "⚡", duration: 20, hint: "Alles auf einmal", names: ["Burpees", "Kettlebell Swings", "Mountain Climbers", "Plank"] },
];

/* Pro Muskelgruppe: wann zuletzt überhaupt trainiert + Sätze diese Woche –
   für die Home- und die Workout-Seite ("Diese Woche noch offen"). */
function muscleGroupsStatus(workouts, weekStart) {
  const lastTrained = {}, setsThisWeek = {};
  CATS.forEach((c) => { lastTrained[c] = null; setsThisWeek[c] = 0; });
  for (const w of workouts) {
    for (const ex of w.exercises || []) {
      const cat = ex.category;
      if (!(cat in lastTrained)) continue;
      if (!lastTrained[cat] || w.startedAt > lastTrained[cat]) lastTrained[cat] = w.startedAt;
      if (w.startedAt >= weekStart) setsThisWeek[cat] += (ex.sets || []).length;
    }
  }
  return CATS.map((c) => ({ category: c, trained: setsThisWeek[c] > 0, sets: setsThisWeek[c], lastTrained: lastTrained[c] }));
}

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
  const [profile, workouts, runs, ropes, weight, custom, prs, achievements, streak, photos, profileRow] = await Promise.all([
    Cloud.get(K.profile, false, owner).catch(() => null),
    Cloud.get(K.workouts, false, owner).catch(() => null),
    Cloud.get(K.runs, false, owner).catch(() => null),
    Cloud.get(K.ropes, false, owner).catch(() => null),
    Cloud.get(K.weight, false, owner).catch(() => null),
    Cloud.get(K.custom, false, owner).catch(() => null),
    Cloud.get(K.prs, false, owner).catch(() => null),
    Cloud.get(K.achievements, false, owner).catch(() => null),
    Cloud.get(K.streak, false, owner).catch(() => null),
    Cloud.get(K.photos, false, owner).catch(() => null),
    Cloud.getProfileRow(owner).catch(() => null),
  ]);
  const social = profileRow ? await Cloud.get(K.social(profileRow.username), true, "").catch(() => null) : null;
  const merged = profileRow ? { ...profile, username: profileRow.username, emoji: profileRow.emoji } : profile;
  return { profile: merged, workouts, runs, ropes, weight, custom, prs, achievements, streak, photos, social };
}

const K = {
  profile: "profile",
  workouts: "log:workouts",
  runs: "log:runs",
  ropes: "log:rope",
  weight: "log:weight",
  custom: "custom:exercises",
  prs: "log:prs",
  achievements: "log:achievements",
  streak: "log:streak",
  photos: "log:photos",
  active: "active:workout",
  board: (u) => `board:${u}`,
  social: (u) => `social:${u}`,
  notif: (u) => `notif:${u}`,
  chat: (a, b) => `chat:${[a, b].sort().join("~")}`,
  feed: (u) => `feed:${u}`,
  challenge: (id) => `challenge:${id}`,
  challengeList: (u) => `challenges:${u}`,
};

/* Legt eine Benachrichtigung im (geteilten) Postfach eines anderen Nutzers ab –
   z. B. bei einer Freundschaftsanfrage oder einer neuen Chat-Nachricht. */
async function pushNotification(toUsername, notif) {
  const key = K.notif(toUsername);
  const cur = (await S.get(key, true)) || { items: [] };
  const items = [{ id: uid(), read: false, createdAt: Date.now(), ...notif }, ...(cur.items || [])].slice(0, 50);
  await S.set(key, { items }, true);
}

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

const CHALLENGE_METRICS = [
  { value: "workouts", label: "Workouts", unit: "" },
  { value: "reps", label: "Wiederholungen", unit: "" },
  { value: "minutes", label: "Trainingszeit", unit: "min" },
  { value: "km", label: "Laufen", unit: "km" },
  { value: "jumps", label: "Seilspringen", unit: "" },
];

/* Eigener Wert für eine Challenge – nur im Zeitraum [start, end), damit es egal
   ist, wann beide Seiten annehmen oder zuletzt synchronisiert haben. */
function computeMetricInRange(workouts, runs, ropes, metric, start, end) {
  const fw = workouts.filter((w) => w.startedAt >= start && w.startedAt < end);
  const fr = runs.filter((r) => r.date >= start && r.date < end);
  const fj = ropes.filter((r) => r.date >= start && r.date < end);
  const agg = aggregate(fw, fr, fj);
  if (metric === "workouts") return agg.workouts;
  if (metric === "reps") return agg.reps;
  if (metric === "minutes") return Math.round(agg.seconds / 60);
  if (metric === "km") return Number(agg.km.toFixed(2));
  if (metric === "jumps") return agg.jumps;
  return 0;
}

function activeDays(workouts, runs, ropes) {
  const s = new Set();
  workouts.forEach((w) => s.add(dayKey(w.startedAt)));
  runs.forEach((r) => s.add(dayKey(r.date)));
  ropes.forEach((r) => s.add(dayKey(r.date)));
  return s;
}
/* frozenDays (optional): Tage, die per Streak-Schutz überbrückt wurden – zählen
   für die Serie wie ein echter aktiver Tag, ohne dass dort etwas eingetragen wurde. */
function computeStreak(days, frozenDays) {
  const frozen = frozenDays && frozenDays.length ? new Set(frozenDays) : null;
  const isActive = (k) => days.has(k) || (frozen ? frozen.has(k) : false);
  if (!days.size && !frozen) return 0;
  let cur = Date.now();
  if (!isActive(dayKey(cur))) {
    cur -= DAY;
    if (!isActive(dayKey(cur))) return 0;
  }
  let n = 0;
  while (isActive(dayKey(cur))) { n++; cur -= DAY; }
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

/* Meilensteine – rein aus der bestehenden Trainingshistorie abgeleitet
   (keine eigenen Zähler), einmal freigeschaltet bleiben sie in
   achievementsUnlocked für immer erhalten, auch nach "Alle Daten löschen". */
const BASE_ACHIEVEMENTS = [
  { id: "w1", icon: "🥇", title: "Erster Schritt", hint: "1 Workout absolviert", check: (s) => s.workouts >= 1 },
  { id: "w10", icon: "💪", title: "Dabeigeblieben", hint: "10 Workouts absolviert", check: (s) => s.workouts >= 10 },
  { id: "w50", icon: "🏋️", title: "Stammgast", hint: "50 Workouts absolviert", check: (s) => s.workouts >= 50 },
  { id: "w100", icon: "🏆", title: "Hundertschaft", hint: "100 Workouts absolviert", check: (s) => s.workouts >= 100 },
  { id: "streak7", icon: "🔥", title: "Eine Woche dran", hint: "7 Tage Serie", check: (s) => s.streak >= 7 },
  { id: "streak30", icon: "🔥", title: "Ein Monat dran", hint: "30 Tage Serie", check: (s) => s.streak >= 30 },
  { id: "streak100", icon: "🔥", title: "Unaufhaltbar", hint: "100 Tage Serie", check: (s) => s.streak >= 100 },
  { id: "run1", icon: "🏃", title: "Erste Runde", hint: "Ersten Lauf gespeichert", check: (s) => s.runsCount >= 1 },
  { id: "run5k", icon: "🎽", title: "5er-Läufer", hint: "Einen Lauf über 5 km", check: (s) => s.maxRunKm >= 5 },
  { id: "run10k", icon: "🎽", title: "10er-Läufer", hint: "Einen Lauf über 10 km", check: (s) => s.maxRunKm >= 10 },
  { id: "km50", icon: "🗺️", title: "50 km gesamt", hint: "Insgesamt 50 km gelaufen", check: (s) => s.totalKm >= 50 },
  { id: "km100", icon: "🗺️", title: "100 km gesamt", hint: "Insgesamt 100 km gelaufen", check: (s) => s.totalKm >= 100 },
  { id: "jump1000", icon: "🪢", title: "Seilspringer", hint: "1.000 Sprünge insgesamt", check: (s) => s.totalJumps >= 1000 },
  { id: "jump10000", icon: "🪢", title: "Sprungmeister", hint: "10.000 Sprünge insgesamt", check: (s) => s.totalJumps >= 10000 },
  { id: "pr1", icon: "⭐", title: "Erster Rekord", hint: "Ersten persönlichen Rekord aufgestellt", check: (s) => s.prCount >= 1 },
  { id: "pr10", icon: "🌟", title: "Rekordjäger", hint: "10 persönliche Rekorde", check: (s) => s.prCount >= 10 },
  { id: "reps10000", icon: "🔢", title: "Zehntausend", hint: "10.000 Wiederholungen insgesamt", check: (s) => s.totalReps >= 10000 },
];

/* Calisthenics-Abzeichen: aus einer kompakten Tabelle erzeugt statt einzeln
   ausgeschrieben – bei ~90 Einträgen sonst viel zu fehleranfällig beim Pflegen.
   "Bestwert" = meiste Wdh./Sekunden in einem einzelnen Satz (aus prs), "insgesamt"
   = Summe aller je geloggten Wdh. dieser Übung über die ganze Historie. */
const slugId = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
const CALISTHENICS_REPS = [
  { name: "Liegestütze", cat: "Brust", setTiers: [15, 30, 50], totalTiers: [1000, 5000] },
  { name: "Breite Liegestütze", cat: "Brust", setTiers: [10, 20, 35], totalTiers: [500, 2000] },
  { name: "Dips", cat: "Brust", setTiers: [8, 15, 25], totalTiers: [500, 2000] },
  { name: "Trizeps-Dips", cat: "Arme", setTiers: [10, 20, 30], totalTiers: [500, 2000] },
  { name: "Klimmzüge", cat: "Rücken", setTiers: [3, 8, 15], totalTiers: [250, 1000] },
  { name: "Chin-ups", cat: "Rücken", setTiers: [3, 8, 15], totalTiers: [250, 1000] },
  { name: "Australian Pull-ups", cat: "Rücken", setTiers: [10, 20, 35], totalTiers: [500, 2000] },
  { name: "Pistol Squats", cat: "Beine", setTiers: [1, 3, 6], totalTiers: [100, 400] },
  { name: "Pike Push-ups", cat: "Schultern", setTiers: [5, 12, 20], totalTiers: [250, 1000] },
  { name: "Sit-ups", cat: "Bauch", setTiers: [20, 40, 75], totalTiers: [1000, 5000] },
  { name: "Crunches", cat: "Bauch", setTiers: [20, 40, 75], totalTiers: [1000, 5000] },
  { name: "Leg Raises", cat: "Bauch", setTiers: [10, 20, 35], totalTiers: [500, 2000] },
  { name: "Burpees", cat: "Ganzkörper", setTiers: [10, 20, 40], totalTiers: [500, 2000] },
  { name: "Mountain Climbers", cat: "Ganzkörper", setTiers: [30, 60, 100], totalTiers: [1000, 5000] },
  { name: "Jumping Jacks", cat: "Ganzkörper", setTiers: [30, 60, 100], totalTiers: [1000, 5000] },
];
const CALISTHENICS_HOLDS = [
  { name: "Plank", cat: "Bauch", holdTiers: [20, 45, 90, 180] },
  { name: "Hollow Hold", cat: "Bauch", holdTiers: [15, 30, 60, 120] },
];
const CALISTHENICS_ACHIEVEMENTS = [
  ...CALISTHENICS_REPS.flatMap((e) => [
    ...e.setTiers.map((n) => ({
      id: `set_${slugId(e.name)}_${n}`, icon: CAT_ICON[e.cat],
      title: `${n} ${e.name} am Stück`, hint: `${n} Wiederholungen ${e.name} in einem Satz`,
      check: (s) => (s.prs[e.name]?.maxReps || 0) >= n,
    })),
    ...e.totalTiers.map((n) => ({
      id: `total_${slugId(e.name)}_${n}`, icon: CAT_ICON[e.cat],
      title: `${nf(n)} ${e.name} insgesamt`, hint: `${nf(n)} Wiederholungen ${e.name} insgesamt geloggt`,
      check: (s) => (s.exerciseTotals[e.name] || 0) >= n,
    })),
  ]),
  ...CALISTHENICS_HOLDS.flatMap((e) => e.holdTiers.map((sec) => ({
    id: `hold_${slugId(e.name)}_${sec}`, icon: CAT_ICON[e.cat],
    title: `${fmtClock(sec)} ${e.name}`, hint: `${e.name} ${sec} Sekunden am Stück gehalten`,
    check: (s) => (s.prs[e.name]?.maxHold || 0) >= sec,
  }))),
];

const ACHIEVEMENTS = [...BASE_ACHIEVEMENTS, ...CALISTHENICS_ACHIEVEMENTS];
/* Abschluss-Trophäe: erscheint als letztes Abzeichen der Liste und schaltet
   sich frei, sobald jedes andere Abzeichen bereits freigeschaltet ist.
   Bewusst anders benannt als die "Alle Abzeichen"-Ordner-Kachel in der
   Statistik, die nur die Übersicht öffnet und selbst kein Abzeichen ist. */
ACHIEVEMENTS.push({
  id: "all_badges", icon: "👑", title: "Abzeichen-Meister", hint: "Jedes andere Abzeichen freigeschaltet",
  check: (s) => s.unlockedCount >= ACHIEVEMENTS.length - 1,
});

function buildBoardEntry(profile, workouts, runs, ropes, frozenDays) {
  const a = aggregate(workouts, runs, ropes);
  const streak = computeStreak(activeDays(workouts, runs, ropes), frozenDays);
  const p = profile.privacy;
  return {
    username: profile.username, emoji: profile.emoji, avatarUrl: profile.avatarUrl || null, updatedAt: Date.now(),
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

/* Zeigt ein Profilfoto, wenn eins gesetzt ist – sonst das Emoji als Fallback,
   wie überall in der App gewohnt. */
function Avatar({ url, emoji, size = 40, style }) {
  const T = useT();
  if (url) {
    return (
      <img src={url} alt="" className="shrink-0" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", ...style }} />
    );
  }
  return (
    <div className="shrink-0 flex items-center justify-center rounded-full"
      style={{ width: size, height: size, fontSize: size * 0.55, background: T.panel2, ...style }}>
      {emoji || "🦍"}
    </div>
  );
}

function Card({ children, style, onClick, className = "" }) {
  const T = useT();
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl ${onClick ? "cursor-pointer active:scale-[0.98]" : ""} ${className}`}
      style={{ background: T.panel, border: `1px solid ${T.line}`, boxShadow: T.shadow, transition: "transform .12s ease", ...style }}
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
    solid: { background: tone, color: "#14161B", border: "1px solid transparent", boxShadow: `0 6px 16px ${tone}33` },
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

function Stat({ label, value, unit, color, delta }) {
  const T = useT();
  return (
    <div>
      <div className="rig-num text-2xl" style={{ color: color || T.text }}>
        {value}
        {unit && <span className="text-xs ml-1" style={{ color: T.muted }}>{unit}</span>}
      </div>
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        <div className="text-xs" style={{ color: T.muted }}>{label}</div>
        {delta != null && Number.isFinite(delta) && (
          <span className="rig-num text-[10px] px-1.5 py-0.5 rounded-full" style={{
            background: T.panel2, color: delta > 0 ? PLATE.green : delta < 0 ? PLATE.red : T.muted,
          }}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} {Math.abs(delta)}%
          </span>
        )}
      </div>
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

const GOALS = [
  { value: "muscle", label: "Muskelaufbau" },
  { value: "weightloss", label: "Abnehmen" },
  { value: "endurance", label: "Ausdauer" },
  { value: "strength", label: "Kraft" },
  { value: "mobility", label: "Beweglichkeit" },
];
const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Anfänger" },
  { value: "intermediate", label: "Fortgeschritten" },
  { value: "pro", label: "Profi" },
];
const GENDERS = [
  { value: "male", label: "Männlich" },
  { value: "female", label: "Weiblich" },
  { value: "diverse", label: "Divers" },
  { value: "unspecified", label: "Keine Angabe" },
];

const defaultSettings = () => ({
  theme: "dark", restDefault: 90, weeklyGoal: 4,
  privacy: { profilePublic: true, workoutsPublic: true, leaderboard: true, runsPublic: true },
  weightKg: null, heightCm: null, experience: null, goals: [], goalWeightKg: null, goalDate: null, goalNote: "",
  avatarUrl: null, gender: null, birthDate: null,
});

/* Körperdaten & Ziele – wiederverwendet im Onboarding (optionaler Zusatzschritt)
   und im Profil-Screen (jederzeit nachträglich änderbar). */
function BodyGoalsFields({ value, onChange }) {
  const T = useT();
  const v = value || {};
  const toggleGoal = (g) => {
    const cur = v.goals || [];
    onChange({ goals: cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g] });
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div>
          <Eyebrow>Gewicht</Eyebrow>
          <NumberField value={v.weightKg || 0} onChange={(n) => onChange({ weightKg: n || null })} min={0} max={300} step={1} suffix="kg" width={88} />
        </div>
        <div>
          <Eyebrow>Größe</Eyebrow>
          <NumberField value={v.heightCm || 0} onChange={(n) => onChange({ heightCm: n || null })} min={0} max={250} step={1} suffix="cm" width={88} />
        </div>
      </div>

      <Eyebrow>Erfahrung</Eyebrow>
      <div className="mb-5">
        <Segmented value={v.experience || ""} onChange={(val) => onChange({ experience: val })} options={EXPERIENCE_LEVELS} />
      </div>

      <Eyebrow>Ziele</Eyebrow>
      <div className="flex flex-wrap gap-2 mb-5">
        {GOALS.map((g) => {
          const on = (v.goals || []).includes(g.value);
          return (
            <button key={g.value} onClick={() => toggleGoal(g.value)}
              className="px-3 py-2 rounded-lg text-sm active:scale-95"
              style={{ background: on ? PLATE.yellow : T.panel, color: on ? "#14161B" : T.text, border: `1px solid ${T.line}`, fontWeight: on ? 600 : 400 }}>
              {g.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-5">
        <div>
          <Eyebrow>Zielgewicht (optional)</Eyebrow>
          <NumberField value={v.goalWeightKg || 0} onChange={(n) => onChange({ goalWeightKg: n || null })} min={0} max={300} step={1} suffix="kg" width={88} />
        </div>
        <div>
          <Eyebrow>Zieldatum (optional)</Eyebrow>
          <input type="date" value={v.goalDate || ""} onChange={(e) => onChange({ goalDate: e.target.value || null })}
            className="w-full px-3 py-3 rounded-xl text-sm" style={{ background: T.panel2, color: T.text, border: `1px solid ${T.line}` }} />
        </div>
      </div>

      <Eyebrow>Was möchtest du erreichen?</Eyebrow>
      <textarea
        value={v.goalNote || ""} onChange={(e) => onChange({ goalNote: e.target.value })}
        placeholder="z. B. in 3 Monaten 10 Klimmzüge am Stück schaffen"
        rows={3}
        className="w-full px-4 py-3 rounded-xl text-sm"
        style={{ background: T.panel, color: T.text, border: `1px solid ${T.line}`, resize: "vertical" }}
      />
    </>
  );
}

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
  const [phase, setPhase] = useState("form"); // form | details
  const [pending, setPending] = useState(null); // {profile, session}
  const [details, setDetails] = useState({});

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
        setPending({ profile: { username: u, emoji, createdAt: Date.now(), ...defaultSettings() }, session: data.session });
        setPhase("details");
      } else {
        setBusy(false);
        setMode("login");
        setInfo(`Bestätigungslink an ${email.trim()} geschickt. Danach hier mit E-Mail und Passwort anmelden.`);
      }
    } catch (e) {
      setBusy(false); setErr(e?.message || "Unbekannter Fehler.");
    }
  };

  const finishDetails = (skip) => {
    const profile = skip ? pending.profile : { ...pending.profile, ...details };
    onDone(profile, pending.session);
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

  if (phase === "details") {
    return (
      <div className="min-h-screen px-6 pt-10 pb-10" style={{ background: T.bg }}>
        <div className="rig-fade">
          <div className="rig-display text-3xl mb-2" style={{ color: T.text }}>Dein Profil</div>
          <div className="text-sm mb-6" style={{ color: T.muted }}>
            Optional – hilft dir, dein Training passender zu planen. Kannst du jederzeit im Profil ändern.
          </div>
          <BodyGoalsFields value={details} onChange={(patch) => setDetails((d) => ({ ...d, ...patch }))} />
          <div className="flex gap-2 mt-6">
            <Btn variant="ghost" className="flex-1" onClick={() => finishDetails(true)}>Überspringen</Btn>
            <Btn className="flex-1" onClick={() => finishDetails(false)}>Speichern</Btn>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6" style={{ background: T.bg }}>
      <div className="rig-fade">
        <Tally count={5} color={PLATE.yellow} size={34} />
        <div className="rig-display mt-5" style={{ color: T.text, fontSize: 46, lineHeight: .92 }}>
          STRADAA
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

/* Kleiner Fortschrittsring, z. B. fürs Wochenziel. */
function ProgressRing({ value, max, size = 52, stroke = 5, color }) {
  const T = useT();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.panel2} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color || PLATE.yellow} strokeWidth={stroke}
        strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" style={{ transition: "stroke-dasharray .3s ease" }} />
    </svg>
  );
}

/* Tageszeit-Gruß auf der Home-Seite: fünf Stufen statt nur drei. */
function daypartGreeting(hour) {
  if (hour < 5) return "Nacht";
  if (hour < 11) return "Morgen";
  if (hour < 14) return "Mittag";
  if (hour < 18) return "Nachmittag";
  if (hour < 22) return "Abend";
  return "Nacht";
}

/* --- Home --------------------------------------------------------------- */
function Home({ ctx }) {
  const T = useT();
  const { profile, workouts, runs, ropes, prs, go, startWorkout, active, board, refreshBoard, streak, streakData } = ctx;
  const agg = useMemo(() => aggregate(workouts, runs, ropes), [workouts, runs, ropes]);
  const days = useMemo(() => activeDays(workouts, runs, ropes), [workouts, runs, ropes]);
  const frozenSet = useMemo(() => new Set(streakData.frozenDays), [streakData.frozenDays]);

  useEffect(() => { refreshBoard(); }, [refreshBoard]);
  const rank = useMemo(() => {
    const rows = board.filter((b) => b.username).sort((a, b) => (b.workouts || 0) - (a.workouts || 0));
    const i = rows.findIndex((r) => r.username === profile.username);
    return i >= 0 && rows.length > 1 ? { place: i + 1, total: rows.length } : null;
  }, [board, profile.username]);

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

  /* Muskelgruppen: pro Kategorie Sätze diese Woche + wann zuletzt überhaupt trainiert,
     damit man auf einen Blick sieht, was diese Woche noch fehlt. */
  const muscleGroups = useMemo(() => muscleGroupsStatus(workouts, weekStart), [workouts, weekStart]);

  /* 14-Tage-Streifen: ein Strich pro aktivem Tag, per Streak-Schutz überbrückte Tage extra markiert */
  const strip = Array.from({ length: 14 }, (_, i) => {
    const ts = Date.now() - (13 - i) * DAY;
    const k = dayKey(ts);
    return { ts, on: days.has(k), frozen: !days.has(k) && frozenSet.has(k) };
  });

  return (
    <div className="px-5 pb-28 pt-6 rig-fade">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="rig-display text-3xl" style={{ color: T.text }}>
            {daypartGreeting(new Date().getHours())}, {profile.username}
          </div>
          <div className="text-sm mt-1" style={{ color: T.muted }}>{fmtDate(Date.now())}</div>
        </div>
        <button onClick={() => go("profile")} className="w-11 h-11 rounded-2xl overflow-hidden flex items-center justify-center"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <Avatar url={profile.avatarUrl} emoji={profile.emoji} size={44} style={{ borderRadius: 14 }} />
        </button>
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
            {streakData.freezes > 0 && (
              <div className="text-xs mt-1" style={{ color: PLATE.blue }}>
                🧊 {streakData.freezes} Streak-Schutz{streakData.freezes === 1 ? "" : "e"}
              </div>
            )}
          </div>
          <div className="flex flex-col items-center">
            <div className="relative flex items-center justify-center" style={{ width: 52, height: 52 }}>
              <ProgressRing value={thisWeek.length} max={goal} size={52} stroke={5} />
              <span className="rig-num text-xs absolute" style={{ color: T.text }}>{thisWeek.length}/{goal}</span>
            </div>
            <div className="text-xs mt-1" style={{ color: T.muted }}>diese Woche</div>
          </div>
        </div>
        <div className="flex gap-1.5 items-end" style={{ height: 26 }}>
          {strip.map((d, i) => (
            <div key={i} title={d.frozen ? `${fmtDayShort(d.ts)} · Streak-Schutz` : fmtDayShort(d.ts)} style={{
              flex: 1, height: d.on || d.frozen ? 26 : 8, borderRadius: 3,
              background: d.on ? PLATE.yellow : d.frozen ? PLATE.blue : T.panel2, transition: "height .2s ease",
              opacity: d.frozen ? 0.7 : 1,
            }} />
          ))}
        </div>
        <div className="flex justify-between text-xs mt-2" style={{ color: T.muted }}>
          <span>vor 14 Tagen</span><span>heute</span>
        </div>
      </Card>

      {/* Muskelgruppen diese Woche */}
      <Card className="p-4 mb-4">
        <Eyebrow>Muskelgruppen diese Woche</Eyebrow>
        <div className="grid grid-cols-4 gap-2">
          {muscleGroups.map((g) => {
            const daysAgo = g.lastTrained ? Math.floor((Date.now() - g.lastTrained) / DAY) : null;
            return (
              <div key={g.category} className="rounded-xl p-2 text-center" style={g.trained
                ? { background: `linear-gradient(160deg, ${T.panel}, ${PLATE.green}1f)`, border: `1px solid ${PLATE.green}55` }
                : { background: T.panel2, border: `1px solid ${T.line}` }}>
                <div className="text-lg mb-0.5" style={{ opacity: g.trained ? 1 : 0.5 }}>{CAT_ICON[g.category]}</div>
                <div className="text-[10px] truncate" style={{ color: g.trained ? T.text : T.muted, fontWeight: g.trained ? 600 : 400 }}>
                  {g.category}
                </div>
                <div className="text-[9px] mt-0.5" style={{ color: g.trained ? PLATE.green : T.muted }}>
                  {g.trained ? `${g.sets} Sätze` : daysAgo == null ? "noch nie" : daysAgo === 0 ? "heute" : `vor ${daysAgo}d`}
                </div>
              </div>
            );
          })}
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

      {rank && (
        <Card className="p-4 mb-4 flex items-center justify-between" onClick={() => go("board")}>
          <div className="flex items-center gap-3">
            <span className="text-xl">🏆</span>
            <div>
              <div className="text-sm" style={{ color: T.text }}>Rangliste</div>
              <div className="text-xs" style={{ color: T.muted }}>nach Workouts</div>
            </div>
          </div>
          <div className="text-right">
            <div className="rig-num text-xl" style={{ color: PLATE.yellow }}>#{rank.place}</div>
            <div className="text-xs" style={{ color: T.muted }}>von {rank.total}</div>
          </div>
        </Card>
      )}

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
  const { active, setActive, finishWorkout, discardWorkout, exercises, addCustomExercise, profile, toast, startWorkout, repeatWorkout, workouts, go } = ctx;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rest, setRest] = useState(null); // {left, total}
  const [tick, setTick] = useState(0);
  const [groupMode, setGroupMode] = useState(false);
  const [groupSelection, setGroupSelection] = useState([]);

  /* Übungen zu Anzeige-Blöcken zusammenfassen: gruppierte Übungen bleiben in
     ihrer Reihenfolge, werden aber als ein Block gerendert.
     Muss vor jedem Early-Return stehen, sonst wechselt die Hook-Anzahl
     zwischen Startseite (active=null) und laufendem Workout (React #300). */
  const renderItems = useMemo(() => {
    if (!active) return [];
    const seen = new Set();
    const items = [];
    for (const ex of active.exercises) {
      if (seen.has(ex.key)) continue;
      if (ex.group) {
        const mates = active.exercises.filter((e) => e.group === ex.group);
        mates.forEach((m) => seen.add(m.key));
        items.push({ type: "group", group: ex.group, exercises: mates });
      } else {
        seen.add(ex.key);
        items.push({ type: "single", ex });
      }
    }
    return items;
  }, [active]);

  /* Letzte vergangene Session mit dieser Übung – als Referenz fürs progressive Steigern.
     `workouts` ist neueste zuerst, ein einfacher Vorwärtslauf reicht also. */
  const lastSessionFor = useCallback((name) => {
    for (const w of workouts) {
      const ex = (w.exercises || []).find((e) => e.name === name);
      if (ex && ex.sets.length) return { date: w.startedAt, sets: ex.sets, type: ex.type };
    }
    return null;
  }, [workouts]);

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
    const weekStart = Date.now() - 7 * DAY;
    const missingGroups = muscleGroupsStatus(workouts, weekStart).filter((g) => !g.trained);
    /* Empfehlung: die am längsten überfällige noch offene Muskelgruppe – nie trainiert
       geht dabei vor "nur lange her", damit blinde Flecken zuerst drankommen. */
    const recommended = missingGroups.length
      ? [...missingGroups].sort((a, b) => (a.lastTrained ?? -Infinity) - (b.lastTrained ?? -Infinity))[0]
      : null;
    const recentHistory = workouts.slice(0, 5);

    /* Feste Standard-Splits, aufgelöst gegen den echten Übungskatalog (eingebaut + eigene) –
       so bleiben es immer vollständige, sofort startbare Vorlagen. */
    const templates = STANDARD_TEMPLATES.map((t) => ({
      ...t,
      exercises: t.names.map((n) => exercises.find((e) => e.name === n)).filter(Boolean)
        .map((e) => ({ exerciseId: e.id, name: e.name, category: e.category, type: e.type })),
    })).filter((t) => t.exercises.length > 0);

    const startForCategory = (category) => {
      const picks = exercises.filter((e) => e.category === category).slice(0, 3)
        .map((e) => ({ exerciseId: e.id, name: e.name, category: e.category, type: e.type }));
      startWorkout({ title: category, exercises: picks });
    };

    const recDaysAgo = recommended?.lastTrained ? Math.floor((Date.now() - recommended.lastTrained) / DAY) : null;
    const recHint = recDaysAgo == null ? "Noch nie trainiert" : `Noch nicht trainiert · zuletzt vor ${recDaysAgo} Tagen`;

    return (
      <div className="px-5 pt-6 pb-28 rig-fade">
        <div className="rig-display text-3xl mb-1" style={{ color: T.text }}>Workout</div>
        <div className="text-sm mb-5" style={{ color: T.muted }}>{fmtDate(Date.now())}</div>

        <div className="flex gap-3 mb-5 items-stretch">
          {recommended ? (
            <Card className="p-4 flex-1 flex flex-col">
              <Eyebrow color={PLATE.yellow}>Empfehlung</Eyebrow>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{CAT_ICON[recommended.category]}</span>
                <span className="rig-display text-base" style={{ color: T.text }}>{recommended.category}</span>
              </div>
              <div className="text-xs mb-4 flex-1" style={{ color: T.muted }}>{recHint}</div>
              <Btn style={{ padding: "10px 0" }} onClick={() => startForCategory(recommended.category)}>Starten</Btn>
            </Card>
          ) : (
            <Card className="p-4 flex-1 flex flex-col">
              <Eyebrow color={PLATE.green}>Empfehlung</Eyebrow>
              <div className="rig-display text-base mb-1" style={{ color: T.text }}>Alles im Plan 💪</div>
              <div className="text-xs" style={{ color: T.muted }}>Diese Woche schon jede Muskelgruppe trainiert.</div>
            </Card>
          )}
          <Card className="p-4 flex-1 flex flex-col">
            <Eyebrow>Manuell</Eyebrow>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg" style={{ color: T.muted }}>+</span>
              <span className="rig-display text-base" style={{ color: T.text }}>Eigenes Training</span>
            </div>
            <div className="text-xs mb-4 flex-1" style={{ color: T.muted }}>Übungen frei zusammenstellen</div>
            <Btn variant="quiet" style={{ padding: "10px 0" }} onClick={() => startWorkout()}>Zusammenstellen</Btn>
          </Card>
        </div>

        <Eyebrow>Schnellstart</Eyebrow>
        <div className="flex gap-3 mb-5 overflow-x-auto rig-scroll pb-1">
          {templates.map((t) => (
            <Card key={t.title} className="p-4 shrink-0" style={{ width: 132 }} onClick={() => startWorkout({ title: t.title, exercises: t.exercises })}>
              <div className="text-2xl mb-2">{t.icon}</div>
              <div className="rig-display text-base" style={{ color: T.text }}>{t.title}</div>
              <div className="text-xs mt-1" style={{ color: T.muted }}>{t.duration} Min.</div>
            </Card>
          ))}
        </div>

        <Eyebrow>Letzte Workouts</Eyebrow>
        {recentHistory.length === 0 ? (
          <Card className="p-4 mb-2">
            <div className="text-sm" style={{ color: T.text }}>Noch kein Training absolviert.</div>
            <div className="text-xs mt-1" style={{ color: T.muted }}>Starte oben frei oder über eine Vorlage – jeder Anfang zählt.</div>
          </Card>
        ) : recentHistory.map((w) => {
          const cats = [...new Set((w.exercises || []).map((e) => e.category))];
          const daysAgo = Math.floor((Date.now() - w.startedAt) / DAY);
          const when = daysAgo <= 0 ? "Heute" : daysAgo === 1 ? "Gestern" : `vor ${daysAgo} Tagen`;
          const sets = (w.exercises || []).reduce((a, e) => a + (e.sets || []).length, 0);
          return (
            <Card key={w.id} className="p-3 mb-2" onClick={() => go("detail", w)}>
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full flex items-center justify-center text-base shrink-0" style={{ background: T.panel2 }}>
                  {CAT_ICON[cats[0]] || "🏋️"}
                </span>
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div className="text-sm truncate" style={{ color: T.text }}>{w.title || cats.join(" + ") || "Training"}</div>
                  <div className="text-xs mt-0.5" style={{ color: T.muted }}>{when} · {sets} Sätze</div>
                </div>
              </div>
            </Card>
          );
        })}
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

  /* Supersatz/Zirkel: nach einem Satz erst dann die Pause starten, wenn jede
     Übung der Gruppe in dieser Runde gleichgezogen hat – sonst weiter zur
     nächsten Übung der Gruppe, ohne Pause dazwischen. */
  const addSet = (key, set) => {
    const ex = active.exercises.find((e) => e.key === key);
    const group = ex?.group || null;
    patch((a) => {
      a.exercises = a.exercises.map((e) => (e.key === key ? { ...e, sets: [...e.sets, { id: uid(), ...set }] } : e));
      return a;
    });
    if (group) {
      const newCount = ex.sets.length + 1;
      const mates = active.exercises.filter((e) => e.group === group);
      const lagging = mates.find((m) => m.key !== key && m.sets.length < newCount);
      if (lagging) {
        toast({ msg: `Weiter mit ${lagging.name}.` });
        return;
      }
    }
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
  const delExercise = (key) => patch((a) => {
    a.exercises = a.exercises.filter((e) => e.key !== key);
    /* Gruppen mit nur noch einer Übung sind kein Supersatz mehr. */
    const counts = {};
    a.exercises.forEach((e) => { if (e.group) counts[e.group] = (counts[e.group] || 0) + 1; });
    a.exercises = a.exercises.map((e) => (e.group && counts[e.group] < 2 ? { ...e, group: null } : e));
    return a;
  });

  const toggleGroupSelect = (key) => setGroupSelection((sel) => (sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key]));
  const cancelGroupMode = () => { setGroupSelection([]); setGroupMode(false); };
  const confirmGroup = () => {
    if (groupSelection.length < 2) return;
    const gid = uid();
    patch((a) => {
      a.exercises = a.exercises.map((e) => (groupSelection.includes(e.key) ? { ...e, group: gid } : e));
      return a;
    });
    setGroupSelection([]); setGroupMode(false);
  };
  const ungroup = (gid) => patch((a) => { a.exercises = a.exercises.map((e) => (e.group === gid ? { ...e, group: null } : e)); return a; });

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
          <Card className="p-4" style={{ border: `1px solid ${PLATE.yellow}55`, background: `linear-gradient(135deg, ${T.panel}, ${PLATE.yellow}14)` }}>
            <div className="flex items-center gap-4">
              <ProgressRing value={rest.left} max={rest.total} size={56} stroke={5} />
              <div className="flex-1">
                <Eyebrow color={PLATE.yellow}>Pause</Eyebrow>
                <div className="rig-num text-3xl" style={{ color: T.text }}>{fmtClock(rest.left)}</div>
              </div>
              <div className="flex flex-col gap-2 items-stretch">
                <button onClick={() => setRest((r) => ({ ...r, left: r.left + 30, total: r.total + 30 }))}
                  className="rig-num text-xs px-3 py-1.5 rounded-lg active:scale-95" style={{ background: T.panel2, color: T.text, transition: "transform .12s ease" }}>+30 s</button>
                <button onClick={() => setRest(null)} className="text-xs px-3 py-1.5 rounded-lg active:scale-95" style={{ color: T.muted, transition: "transform .12s ease" }}>Überspringen</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="px-5 pt-4">
        {active.exercises.length === 0 && (
          <Empty title="Übung hinzufügen" hint="Wähl aus der Datenbank oder leg eine eigene an." />
        )}

        {renderItems.map((item) => item.type === "single" ? (
          <ExerciseBlock key={item.ex.key} ex={item.ex} onAdd={(s) => addSet(item.ex.key, s)} onUpdate={(sid, s) => updateSet(item.ex.key, sid, s)}
            onDelete={(sid) => delSet(item.ex.key, sid)} onRemove={() => delExercise(item.ex.key)} prs={ctx.prs}
            lastSession={lastSessionFor(item.ex.name)}
            selectable={groupMode} selected={groupSelection.includes(item.ex.key)} onToggleSelect={() => toggleGroupSelect(item.ex.key)} />
        ) : (
          <div key={item.group} className="mb-3 rounded-2xl p-3" style={{ border: `1px solid ${PLATE.blue}55`, background: `linear-gradient(135deg, ${T.panel}, ${PLATE.blue}0d)` }}>
            <div className="flex items-center justify-between px-1 mb-2">
              <Eyebrow color={PLATE.blue}>{item.exercises.length > 2 ? "Zirkel" : "Supersatz"} · {item.exercises.length} Übungen</Eyebrow>
              <button onClick={() => ungroup(item.group)} className="text-xs" style={{ color: T.muted }}>Trennen</button>
            </div>
            {item.exercises.map((ex) => (
              <ExerciseBlock key={ex.key} ex={ex} onAdd={(s) => addSet(ex.key, s)} onUpdate={(sid, s) => updateSet(ex.key, sid, s)}
                onDelete={(sid) => delSet(ex.key, sid)} onRemove={() => delExercise(ex.key)} prs={ctx.prs}
                lastSession={lastSessionFor(ex.name)} />
            ))}
          </div>
        ))}

        {groupMode ? (
          <Card className="p-3 mt-2 flex items-center justify-between">
            <span className="text-sm" style={{ color: T.text }}>{groupSelection.length} ausgewählt</span>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={cancelGroupMode}>Abbrechen</Btn>
              <Btn disabled={groupSelection.length < 2} onClick={confirmGroup}>Verknüpfen</Btn>
            </div>
          </Card>
        ) : (
          <div className="flex gap-2 mt-2">
            <Btn variant="ghost" className="flex-1" onClick={() => setPickerOpen(true)}>+ Übung hinzufügen</Btn>
            {active.exercises.filter((e) => !e.group).length >= 2 && (
              <Btn variant="ghost" onClick={() => setGroupMode(true)}>🔗 Verknüpfen</Btn>
            )}
          </div>
        )}

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

function ExerciseBlock({ ex, onAdd, onUpdate, onDelete, onRemove, prs, lastSession, selectable, selected, onToggleSelect }) {
  const T = useT();
  const last = ex.sets[ex.sets.length - 1];
  const lastRef = lastSession?.sets[lastSession.sets.length - 1];
  const [reps, setReps] = useState(last?.reps || lastRef?.reps || 10);
  const [weight, setWeight] = useState(last?.weight || lastRef?.weight || 20);
  const [sec, setSec] = useState(last?.sec || lastRef?.sec || 30);
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
  const repeatLastSet = () => {
    if (!last) return;
    if (ex.type === "time") onAdd({ sec: last.sec });
    else if (ex.type === "weight") onAdd({ reps: last.reps, weight: last.weight || 0 });
    else onAdd({ reps: last.reps });
  };

  const typeIcon = ex.type === "weight" ? "🏋️" : ex.type === "time" ? "⏱️" : "🤸";

  /* Auswahl-Modus fürs Verknüpfen zu einem Supersatz/Zirkel: nur Kopfzeile +
     Checkbox, keine Satz-Eingabe, damit man beim Auswählen nichts versehentlich einträgt. */
  if (selectable) {
    return (
      <Card className="p-4 mb-3" onClick={onToggleSelect} style={selected ? { border: `2px solid ${PLATE.blue}` } : undefined}>
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center text-base shrink-0" style={{ background: T.panel2 }}>{typeIcon}</span>
          <div className="flex-1" style={{ minWidth: 0 }}>
            <div className="rig-display text-lg truncate" style={{ color: T.text }}>{ex.name}</div>
            <div className="text-xs" style={{ color: T.muted }}>{ex.sets.length} Sätze bisher</div>
          </div>
          <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs"
            style={{ background: selected ? PLATE.blue : T.panel2, color: selected ? "#fff" : T.muted, border: `1px solid ${T.line}` }}>
            {selected ? "✓" : ""}
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 mb-3">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center text-base shrink-0" style={{ background: T.panel2 }}>{typeIcon}</span>
          <div>
            <div className="rig-display text-lg" style={{ color: T.text }}>{ex.name}</div>
            <div className="text-xs" style={{ color: T.muted }}>
              {ex.category} · {ex.type === "weight" ? "mit Gewicht" : ex.type === "time" ? "auf Zeit" : "Körpergewicht"}
              {pr && ex.type !== "time" && pr.maxReps ? ` · Bestwert ${pr.maxReps}` : ""}
            </div>
          </div>
        </div>
        <button onClick={onRemove} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 active:scale-90"
          style={{ color: T.muted, background: T.panel2, transition: "transform .12s ease" }}>✕</button>
      </div>

      {/* Sätze */}
      {ex.sets.map((s, i) => (
        <div key={s.id} className="flex items-center justify-between py-2 px-1 mb-1 rounded-lg" style={{ background: T.panel2 }}>
          <span className="rig-num text-xs w-6 h-6 rounded-full flex items-center justify-center shrink-0 ml-1"
            style={{ background: T.panel, color: T.muted }}>{i + 1}</span>
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
            {last && (
              <button onClick={repeatLastSet} className="text-xs px-3 py-2 rounded-lg shrink-0"
                style={{ background: T.panel2, color: T.text }}>
                ↻ {ex.type === "time" ? fmtClock(last.sec) : ex.type === "weight" ? `${nf(last.weight, last.weight % 1 ? 1 : 0)}kg×${last.reps}` : `${last.reps} Wdh.`}
              </button>
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

/* Echte Kartenansicht (OpenStreetMap über Leaflet). Leaflet greift auf window/
   document zu, deshalb erst im Browser per dynamischem Import laden – ein
   normaler Top-Level-Import würde den Server-seitigen Build zum Absturz bringen. */
function LeafletMap({ path, live, height = 200 }) {
  const T = useT();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const lineRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const start = path[0] || [48.2082, 16.3738];
      const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false }).setView(start, 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      lineRef.current = L.polyline(path, { color: PLATE.blue, weight: 4 }).addTo(map);
      mapRef.current = map;
      if (path.length > 1) map.fitBounds(lineRef.current.getBounds(), { padding: [24, 24] });
    });
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !lineRef.current) return;
    lineRef.current.setLatLngs(path);
    if (path.length) {
      if (live) mapRef.current.panTo(path[path.length - 1]);
      else mapRef.current.fitBounds(lineRef.current.getBounds(), { padding: [24, 24] });
    }
  }, [path, live]);

  return <div ref={containerRef} style={{ height, borderRadius: 16, background: T.panel2 }} />;
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
  const [viewingRoute, setViewingRoute] = useState(null);
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
                  {r.path?.length > 3 && (
                    <button onClick={() => setViewingRoute(r)}>
                      <RouteTrace path={r.path} color={PLATE.blue} w={64} h={40} />
                    </button>
                  )}
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
            <Card className="p-2 mb-4">
              <div className="px-2 pt-1 pb-2"><Eyebrow>Streckenverlauf</Eyebrow></div>
              <LeafletMap path={pts.map((p) => [p.lat, p.lng])} live height={220} />
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

      <Sheet open={!!viewingRoute} onClose={() => setViewingRoute(null)} title={viewingRoute ? `${Number(viewingRoute.distanceKm).toFixed(2)} km` : "Strecke"}>
        {viewingRoute && (
          <>
            <LeafletMap path={viewingRoute.path} height={280} />
            <div className="flex items-center justify-between mt-4 text-xs rig-num" style={{ color: T.muted }}>
              <span>{new Date(viewingRoute.date).toLocaleDateString("de-AT")}</span>
              <span>{paceStr(viewingRoute.durationSec, viewingRoute.distanceKm)} min/km</span>
            </div>
          </>
        )}
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

const HEAT_PERIODS = [
  { value: 7, label: "7 Tage" }, { value: 30, label: "30 Tage" },
  { value: 90, label: "3 Monate" }, { value: 365, label: "1 Jahr" },
];

/* Aktivitäts-Kalender wie bei GitHub/Strava: eine Spalte pro Woche, ein
   Kästchen pro Tag, dunkler = mehr an dem Tag gemacht. Eigener Zeitraum-Filter,
   unabhängig vom Zeitraum-Filter weiter unten auf der Seite. Jedes Kästchen ist
   antippbar und zeigt, was an dem Tag trainiert wurde. */
function ActivityHeatmap({ workouts, runs, ropes, streak }) {
  const T = useT();
  const [period, setPeriod] = useState(30);
  const [detail, setDetail] = useState(null); // { key, ts }
  const weeks = Math.ceil(period / 7);
  const counts = useMemo(() => {
    const m = new Map();
    const bump = (ts) => { const k = dayKey(ts); m.set(k, (m.get(k) || 0) + 1); };
    workouts.forEach((w) => bump(w.startedAt));
    runs.forEach((r) => bump(r.date));
    ropes.forEach((r) => bump(r.date));
    return m;
  }, [workouts, runs, ropes]);

  const grid = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = weeks * 7;
    const cells = [];
    for (let i = days - 1; i >= 0; i--) {
      const ts = today.getTime() - i * DAY;
      cells.push({ ts, key: dayKey(ts), count: counts.get(dayKey(ts)) || 0 });
    }
    const padStart = (new Date(cells[0].ts).getDay() + 6) % 7; // Montag = 0
    const padded = [...Array(padStart).fill(null), ...cells];
    const cols = [];
    for (let w = 0; w < Math.ceil(padded.length / 7); w++) cols.push(padded.slice(w * 7, w * 7 + 7));
    return cols;
  }, [counts, weeks]);

  const opacityFor = (n) => (n <= 0 ? 0 : n === 1 ? 0.4 : n === 2 ? 0.7 : 1);

  const dayItems = useMemo(() => {
    if (!detail) return null;
    return {
      w: workouts.filter((x) => dayKey(x.startedAt) === detail.key),
      r: runs.filter((x) => dayKey(x.date) === detail.key),
      j: ropes.filter((x) => dayKey(x.date) === detail.key),
    };
  }, [detail, workouts, runs, ropes]);

  return (
    <>
      {streak > 0 && (
        <div className="text-sm mb-3">
          🔥 <span className="rig-num" style={{ color: PLATE.yellow, fontWeight: 600 }}>{streak}</span>{" "}
          <span style={{ color: T.muted }}>{streak === 1 ? "Tag" : "Tage"} in Folge</span>
        </div>
      )}
      <div className="mb-3"><Segmented value={period} onChange={setPeriod} options={HEAT_PERIODS} /></div>
      <div className="flex gap-1 overflow-x-auto rig-scroll pb-1">
        {grid.map((col, i) => (
          <div key={i} className="flex flex-col gap-1">
            {col.map((cell, j) => (
              <button key={j} disabled={!cell} onClick={() => cell && setDetail(cell)} style={{
                width: 11, height: 11, borderRadius: 3,
                background: cell && cell.count > 0 ? PLATE.yellow : T.panel2,
                opacity: cell ? (cell.count > 0 ? opacityFor(cell.count) : 1) : 0,
              }} title={cell ? `${fmtDate(cell.ts)} · ${cell.count}×` : ""} />
            ))}
          </div>
        ))}
      </div>

      <Sheet open={!!detail} onClose={() => setDetail(null)}
        title={detail ? `${DE_DAY[new Date(detail.ts).getDay()]}, ${fmtDate(detail.ts)}` : ""}>
        {dayItems && dayItems.w.length + dayItems.r.length + dayItems.j.length === 0 ? (
          <div className="text-sm text-center py-6" style={{ color: T.muted }}>Kein Training an diesem Tag.</div>
        ) : dayItems && (
          <div className="flex flex-col gap-2">
            {dayItems.w.map((w) => {
              const t = workoutTotals(w);
              return (
                <div key={w.id} className="p-3 rounded-xl" style={{ background: T.panel2 }}>
                  <div className="text-sm" style={{ color: T.text }}>{w.title || "Training"}</div>
                  <div className="text-xs mt-1 rig-num" style={{ color: T.muted }}>{nf(t.reps)} Wdh. · {fmtMin(w.durationSec)}</div>
                </div>
              );
            })}
            {dayItems.r.map((r) => (
              <div key={r.id} className="p-3 rounded-xl" style={{ background: T.panel2 }}>
                <div className="text-sm" style={{ color: T.text }}>🏃 Lauf</div>
                <div className="text-xs mt-1 rig-num" style={{ color: T.muted }}>{nf(r.distanceKm, 2)} km · {fmtMin(r.durationSec)}</div>
              </div>
            ))}
            {dayItems.j.map((r) => (
              <div key={r.id} className="p-3 rounded-xl" style={{ background: T.panel2 }}>
                <div className="text-sm" style={{ color: T.text }}>🪢 Seilspringen</div>
                <div className="text-xs mt-1 rig-num" style={{ color: T.muted }}>{nf(r.totalJumps)} Sprünge · {fmtMin(r.durationSec)}</div>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </>
  );
}

/* Kleiner Gewichtsverlauf: Eintrag mit Datum, Linienchart, letzte Einträge
   löschbar. Der aktuelle Wert bleibt zusätzlich im Profil (Körperdaten) sichtbar. */
function WeightSection({ ctx }) {
  const T = useT();
  const { weightLog, addWeightEntry, deleteWeightEntry, profile } = ctx;
  const [val, setVal] = useState(profile.weightKg || 70);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => [...weightLog].sort((a, b) => a.date - b.date), [weightLog]);
  const chartData = sorted.map((w) => ({ label: fmtDayShort(w.date), weightKg: w.weightKg }));
  const latest = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const trend = latest && prev ? Number((latest.weightKg - prev.weightKg).toFixed(1)) : null;

  const save = async () => {
    setBusy(true);
    await addWeightEntry(Number(val));
    setBusy(false);
  };

  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-1">
        <Eyebrow color={PLATE.blue}>Gewichtsverlauf</Eyebrow>
        {latest && (
          <div className="text-right">
            <div className="rig-num text-sm" style={{ color: T.text }}>{nf(latest.weightKg, 1)} kg</div>
            {trend != null && trend !== 0 && (
              <div className="text-[10px]" style={{ color: trend > 0 ? PLATE.red : PLATE.green }}>
                {trend > 0 ? "▲" : "▼"} {nf(Math.abs(trend), 1)} kg seit letztem Eintrag
              </div>
            )}
          </div>
        )}
      </div>

      {chartData.length >= 2 ? (
        <div style={{ height: 140 }} className="mt-2 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
              <CartesianGrid stroke={T.line} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: T.muted, fontSize: 10 }} axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(chartData.length / 5))} />
              <YAxis tick={{ fill: T.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={40}
                domain={["auto", "auto"]} tickFormatter={(v) => Math.round(v)} />
              <Tooltip
                contentStyle={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, color: T.text, fontSize: 12 }}
                labelStyle={{ color: T.muted }}
                formatter={(v) => [`${nf(v, 1)} kg`, ""]} />
              {profile.goalWeightKg ? (
                <ReferenceLine y={profile.goalWeightKg} stroke={PLATE.green} strokeDasharray="4 4" />
              ) : null}
              <Line type="monotone" dataKey="weightKg" stroke={PLATE.blue} strokeWidth={2} dot={{ r: 3, fill: PLATE.blue }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-xs mb-3 mt-2" style={{ color: T.muted }}>
          Trag dein Gewicht ein paar Mal ein, dann erscheint hier ein Verlauf.
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <NumberField value={val} onChange={setVal} step={0.1} min={20} max={300} width={90} suffix="kg" />
        <Btn className="flex-1" onClick={save} disabled={busy}>Heute eintragen</Btn>
      </div>

      {sorted.length > 0 && (
        <div className="mt-2">
          {[...sorted].reverse().slice(0, 5).map((w, i) => (
            <div key={w.id} className="flex items-center justify-between py-2 text-sm" style={{ borderTop: i ? `1px solid ${T.line}` : "none" }}>
              <span style={{ color: T.muted }}>{fmtDate(w.date)}</span>
              <div className="flex items-center gap-3">
                <span className="rig-num" style={{ color: T.text }}>{nf(w.weightKg, 1)} kg</span>
                <button onClick={() => deleteWeightEntry(w.id)} className="text-xs" style={{ color: PLATE.red }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* Fortschrittsfotos: ein Foto pro Tag, Galerie zum Durchtippen und ein
   Vorher/Nachher-Vergleich (zwei Fotos antippen). */
function ProgressPhotosSection({ ctx }) {
  const T = useT();
  const { photos, addProgressPhoto, deleteProgressPhoto } = ctx;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const fileRef = useRef(null);

  const sorted = useMemo(() => [...photos].sort((a, b) => b.date - a.date), [photos]);

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const img = await resizeImageFile(file, 720, 0.7);
      await addProgressPhoto(img, note.trim());
      setNote("");
    } catch { /* Bild ließ sich nicht lesen */ }
    setBusy(false);
  };

  const tapPhoto = (p) => {
    if (!compareMode) { setViewing(p); return; }
    if (!compareA || (compareA && compareB)) { setCompareA(p); setCompareB(null); return; }
    if (p.id === compareA.id) return;
    setCompareB(p);
  };

  const stopCompare = () => { setCompareMode(false); setCompareA(null); setCompareB(null); };

  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow color={PLATE.blue}>Fortschrittsfotos</Eyebrow>
        {sorted.length >= 2 && (
          <button onClick={() => (compareMode ? stopCompare() : setCompareMode(true))}
            className="text-xs px-3 py-1.5 rounded-lg" style={{ background: compareMode ? PLATE.blue : T.panel2, color: compareMode ? "#fff" : T.text }}>
            {compareMode ? "Fertig" : "Vergleichen"}
          </button>
        )}
      </div>

      {compareMode && (
        <div className="text-xs mb-3" style={{ color: T.muted }}>
          {!compareA ? "Erstes Foto (vorher) antippen" : !compareB ? "Zweites Foto (nachher) antippen" : `${Math.round(Math.abs(compareB.date - compareA.date) / DAY)} Tage dazwischen`}
        </div>
      )}

      {compareMode && compareA && compareB && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div>
            <img src={compareA.image} alt="" className="w-full rounded-xl" style={{ aspectRatio: "3/4", objectFit: "cover" }} />
            <div className="text-[10px] text-center mt-1" style={{ color: T.muted }}>{fmtDate(compareA.date)}</div>
          </div>
          <div>
            <img src={compareB.image} alt="" className="w-full rounded-xl" style={{ aspectRatio: "3/4", objectFit: "cover" }} />
            <div className="text-[10px] text-center mt-1" style={{ color: T.muted }}>{fmtDate(compareB.date)}</div>
          </div>
        </div>
      )}

      {!compareMode && (
        <div className="flex gap-2 mb-3">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz (optional)"
            className="flex-1 px-3 py-2 rounded-lg text-sm" style={{ background: T.panel2, color: T.text, border: `1px solid ${T.line}` }} />
          <Btn onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "…" : "📷 Foto"}</Btn>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-xs" style={{ color: T.muted }}>Noch keine Fotos – leg mit dem ersten los, um deinen Fortschritt später zu sehen.</div>
      ) : (
        <div className="flex gap-2 overflow-x-auto rig-scroll pb-1">
          {sorted.map((p) => {
            const selected = compareMode && (compareA?.id === p.id || compareB?.id === p.id);
            return (
              <button key={p.id} onClick={() => tapPhoto(p)} className="shrink-0">
                <img src={p.image} alt="" className="rounded-xl" style={{
                  width: 72, height: 96, objectFit: "cover",
                  border: selected ? `2px solid ${PLATE.blue}` : `1px solid ${T.line}`,
                }} />
                <div className="text-[9px] mt-1" style={{ color: T.muted }}>{fmtDayShort(p.date)}</div>
              </button>
            );
          })}
        </div>
      )}

      <Sheet open={!!viewing} onClose={() => setViewing(null)} title={viewing ? fmtDate(viewing.date) : ""}>
        {viewing && (
          <div>
            <img src={viewing.image} alt="" className="w-full rounded-xl mb-3" />
            {viewing.note && <div className="text-sm mb-3" style={{ color: T.text }}>{viewing.note}</div>}
            <Btn variant="danger" className="w-full" onClick={() => { deleteProgressPhoto(viewing.id); setViewing(null); }}>Foto löschen</Btn>
          </div>
        )}
      </Sheet>
    </Card>
  );
}

function BadgeCard({ a, unlockedAt, T }) {
  return (
    <Card className="p-3 text-center"
      style={unlockedAt
        ? { border: `1px solid ${PLATE.yellow}55`, background: `linear-gradient(160deg, ${T.panel}, ${PLATE.yellow}14)` }
        : { opacity: 0.5 }}>
      <div className="text-2xl mb-1" style={{ filter: unlockedAt ? "none" : "grayscale(1)" }}>{a.icon}</div>
      <div className="text-xs" style={{ color: T.text, fontWeight: unlockedAt ? 600 : 400 }}>{a.title}</div>
      <div className="text-[10px] mt-1" style={{ color: T.muted }}>{unlockedAt ? fmtDate(unlockedAt) : a.hint}</div>
    </Card>
  );
}

function StatsScreen({ ctx }) {
  const T = useT();
  const { workouts, runs, ropes, prs, achievementsUnlocked, streak, go } = ctx;
  const [period, setPeriod] = useState(30);
  const [metric, setMetric] = useState("reps");
  const [exFilter, setExFilter] = useState("");
  const [showAllBadges, setShowAllBadges] = useState(false);

  const since = period ? Date.now() - period * DAY : 0;
  const fw = workouts.filter((w) => w.startedAt >= since);
  const fr = runs.filter((r) => r.date >= since);
  const fj = ropes.filter((r) => r.date >= since);
  const agg = aggregate(fw, fr, fj);

  /* Vergleich zum vorherigen, gleich langen Zeitraum – nicht bei "Gesamt". */
  const prevSince = period ? since - period * DAY : null;
  const prevAgg = useMemo(() => {
    if (!period) return null;
    return aggregate(
      workouts.filter((w) => w.startedAt >= prevSince && w.startedAt < since),
      runs.filter((r) => r.date >= prevSince && r.date < since),
      ropes.filter((r) => r.date >= prevSince && r.date < since),
    );
  }, [workouts, runs, ropes, period, since, prevSince]);
  const pct = (cur, prev) => {
    if (!period || prevAgg == null) return null;
    if (!prev) return cur > 0 ? 100 : null;
    return Math.round(((cur - prev) / prev) * 100);
  };

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
    const touch = (k) => { if (!map.has(k)) map.set(k, { k, label: labelOf(k), workouts: 0, reps: 0, minutes: 0, volume: 0, km: 0, jumps: 0, filtered: 0 }); return map.get(k); };

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

  /* Wdh. zuletzt / seit Start für eine einzelne gefilterte Übung – unabhängig vom
     gewählten Zeitraum, damit "seit Start" wirklich den allerersten erfassten Wert meint. */
  const exStats = useMemo(() => {
    if (!exFilter) return null;
    const entries = workouts
      .filter((w) => (w.exercises || []).some((e) => e.name === exFilter))
      .map((w) => ({ date: w.startedAt, reps: w.exercises.find((e) => e.name === exFilter).sets.reduce((a, s) => a + (s.reps || 0), 0) }))
      .sort((a, b) => a.date - b.date);
    if (!entries.length) return null;
    const first = entries[0], last = entries[entries.length - 1];
    return { last: last.reps, delta: last.reps - first.reps };
  }, [workouts, exFilter]);

  /* Vorschau statt der ganzen Liste: die zuletzt freigeschalteten zuerst, als
     Teaser bei zu wenigen unlocked die nächsten noch offenen auffüllen –
     der Rest liegt hinter dem "Alle Abzeichen"-Ordner in der Sheet. */
  const badgePreview = useMemo(() => {
    const unlocked = ACHIEVEMENTS.filter((a) => achievementsUnlocked[a.id])
      .sort((a, b) => achievementsUnlocked[b.id] - achievementsUnlocked[a.id]);
    const locked = ACHIEVEMENTS.filter((a) => !achievementsUnlocked[a.id]);
    return [...unlocked, ...locked].slice(0, 5);
  }, [achievementsUnlocked]);

  return (
    <div className="px-5 pt-6 pb-28 rig-fade">
      <div className="rig-display text-3xl mb-5" style={{ color: T.text }}>Statistik</div>

      <Card className="p-4 mb-4">
        <Eyebrow>Aktivität</Eyebrow>
        <ActivityHeatmap workouts={workouts} runs={runs} ropes={ropes} streak={streak} />
      </Card>

      <div className="mb-4"><Segmented value={period} onChange={setPeriod} options={PERIODS} /></div>

      <Card className="p-5 mb-4">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Stat label="Workouts" value={nf(agg.workouts)} delta={prevAgg && pct(agg.workouts, prevAgg.workouts)} />
          <Stat label="Wiederholungen" value={nf(agg.reps)} delta={prevAgg && pct(agg.reps, prevAgg.reps)} />
          <Stat label="Sätze" value={nf(agg.sets)} delta={prevAgg && pct(agg.sets, prevAgg.sets)} />
        </div>
        <div className="grid grid-cols-3 gap-4 pt-4" style={{ borderTop: `1px solid ${T.line}` }}>
          <Stat label="Zeit" value={fmtMin(agg.seconds)} delta={prevAgg && pct(agg.seconds, prevAgg.seconds)} />
          <Stat label="Laufen" value={nf(agg.km, 1)} unit="km" color={PLATE.blue} delta={prevAgg && pct(agg.km, prevAgg.km)} />
          <Stat label="Sprünge" value={nf(agg.jumps)} color={PLATE.green} delta={prevAgg && pct(agg.jumps, prevAgg.jumps)} />
        </div>
      </Card>

      <div className="mb-3"><Segmented value={metric} onChange={(v) => { setMetric(v); setExFilter(""); }} options={METRICS} /></div>

      <Card className="p-4 mb-4">
        <Eyebrow color={exFilter ? PLATE.yellow : m.color}>
          {exFilter ? `${exFilter} – Wiederholungen` : m.label}
        </Eyebrow>

        {metric === "reps" && exNames.length > 0 && (
          <div className="mt-2 mb-1 flex gap-2 overflow-x-auto rig-scroll">
            <button onClick={() => setExFilter("")}
              className="text-xs px-3 py-2 rounded-lg whitespace-nowrap shrink-0"
              style={{ background: !exFilter ? PLATE.yellow : T.panel, color: !exFilter ? "#14161B" : T.muted, border: `1px solid ${T.line}` }}>
              Alle
            </button>
            {exNames.map((n) => (
              <button key={n} onClick={() => setExFilter(exFilter === n ? "" : n)}
                className="text-xs px-3 py-2 rounded-lg whitespace-nowrap shrink-0"
                style={{ background: exFilter === n ? PLATE.yellow : T.panel, color: exFilter === n ? "#14161B" : T.muted, border: `1px solid ${T.line}` }}>
                {n}
              </button>
            ))}
          </div>
        )}

        {exFilter && exStats && (
          <div className="flex gap-5 mt-3 mb-1">
            <div>
              <div className="text-[10px]" style={{ color: T.muted }}>Wdh. zuletzt</div>
              <div className="rig-num text-lg" style={{ color: T.text }}>{nf(exStats.last)}</div>
            </div>
            <div>
              <div className="text-[10px]" style={{ color: T.muted }}>seit Start</div>
              <div className="rig-num text-lg" style={{ color: exStats.delta > 0 ? PLATE.green : exStats.delta < 0 ? PLATE.red : T.muted }}>
                {exStats.delta > 0 ? "+" : ""}{nf(exStats.delta)}
              </div>
            </div>
          </div>
        )}

        <div style={{ height: 200 }} className="mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="statsAreaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={exFilter ? PLATE.yellow : m.color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={exFilter ? PLATE.yellow : m.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={T.line} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: T.muted, fontSize: 10 }} axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 6))} />
              <YAxis tick={{ fill: T.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip
                cursor={{ stroke: T.line }}
                contentStyle={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, color: T.text, fontSize: 12 }}
                labelStyle={{ color: T.muted }}
                formatter={(v) => [`${nf(v, metric === "km" ? 2 : 0)} ${exFilter ? "Wdh." : m.unit}`, ""]} />
              <Area type="monotone" dataKey={chartKey} stroke={exFilter ? PLATE.yellow : m.color} strokeWidth={2.5}
                fill="url(#statsAreaFill)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <WeightSection ctx={ctx} />

      <ProgressPhotosSection ctx={ctx} />

      {exNames.length > 0 && (
        <>
          <Eyebrow>Nach Übung</Eyebrow>
          <Card className="p-4 mb-4">
            {exNames.slice(0, 10).map((name, i) => {
              const max = agg.perExercise[exNames[0]] || 1;
              const on = exFilter === name;
              return (
                <button key={name} onClick={() => { if (on) { setExFilter(""); } else { setMetric("reps"); setExFilter(name); } }}
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

      <Eyebrow color={PLATE.yellow}>Abzeichen · {Object.keys(achievementsUnlocked).length}/{ACHIEVEMENTS.length}</Eyebrow>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {badgePreview.map((a) => <BadgeCard key={a.id} a={a} unlockedAt={achievementsUnlocked[a.id]} T={T} />)}
        <Card className="p-3 text-center" onClick={() => setShowAllBadges(true)} style={{ border: `1px solid ${T.line}` }}>
          <div className="text-2xl mb-1">📁</div>
          <div className="text-xs" style={{ color: T.text, fontWeight: 600 }}>Alle Abzeichen</div>
          <div className="text-[10px] mt-1" style={{ color: T.muted }}>{Object.keys(achievementsUnlocked).length}/{ACHIEVEMENTS.length} ansehen</div>
        </Card>
      </div>

      <Sheet open={showAllBadges} onClose={() => setShowAllBadges(false)} title="Alle Abzeichen" full>
        <div className="grid grid-cols-3 gap-2">
          {ACHIEVEMENTS.map((a) => <BadgeCard key={a.id} a={a} unlockedAt={achievementsUnlocked[a.id]} T={T} />)}
        </div>
      </Sheet>

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
  const { go, deleteWorkout, repeatWorkout, profile, toast } = ctx;
  const tot = workoutTotals(workout);
  const [sharing, setSharing] = useState(false);
  const doShare = async () => {
    setSharing(true);
    await shareWorkoutStory(workout, profile.username, toast);
    setSharing(false);
  };
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
        <Btn variant="quiet" disabled={sharing} onClick={doShare}>{sharing ? "…" : "🖼️ Story"}</Btn>
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

const MEDALS = [
  { rank: 1, tone: PLATE.yellow, barH: 96, avatar: 64 },
  { rank: 2, tone: "#B8BEC9", barH: 68, avatar: 52 },
  { rank: 3, tone: "#C97F4A", barH: 50, avatar: 52 },
];

/* Podium für die Top 3 – 2. Platz links, 1. Platz erhöht in der Mitte,
   3. Platz rechts, wie man's von anderen Fitness-/Sport-Apps kennt. */
function Podium({ rows, me, unit, decimals, color, onOpen }) {
  const T = useT();
  return (
    <div className="flex items-end gap-2 mb-5 p-4 pt-6 rounded-2xl relative overflow-hidden"
      style={{ background: T.panel, border: `1px solid ${T.line}`, boxShadow: T.shadow }}>
      <div className="absolute inset-x-0 top-0" style={{
        height: 140, background: `radial-gradient(60% 100% at 50% 0%, ${PLATE.yellow}22, transparent)`, pointerEvents: "none",
      }} />
      {[1, 0, 2].map((idx) => {
        const r = rows[idx];
        const m = MEDALS[idx];
        if (!r) return <div key={idx} className="flex-1" />;
        const isMe = r.username === me;
        return (
          <div key={r.username} className="flex-1 flex flex-col items-center relative"
            onClick={isMe ? undefined : () => onOpen(r)} style={{ cursor: isMe ? "default" : "pointer" }}>
            {m.rank === 1 && <div className="text-lg mb-0.5">👑</div>}
            <div className="rig-display text-xs mb-1" style={{ color: m.tone }}>#{m.rank}</div>
            <div className="rounded-full mb-2 shrink-0" style={{
              border: `2px solid ${m.tone}`, overflow: "hidden",
              boxShadow: m.rank === 1 ? T.glow : "none",
            }}>
              <Avatar url={r.avatarUrl} emoji={r.emoji} size={m.avatar} style={{ fontSize: m.avatar * 0.5, background: T.panel }} />
            </div>
            <div className="text-xs text-center truncate w-full mb-0.5" style={{ color: T.text, fontWeight: isMe ? 700 : 500 }}>
              {r.username}{isMe && " · du"}
            </div>
            <div className="rig-num text-sm mb-2 whitespace-nowrap" style={{ color }}>
              {nf(r._v, decimals)} <span className="text-xs" style={{ color: T.muted }}>{unit}</span>
            </div>
            <div className="w-full rounded-t-xl" style={{ height: m.barH, background: `linear-gradient(180deg, ${m.tone}, ${m.tone}99)` }} />
          </div>
        );
      })}
    </div>
  );
}

function LeaderboardScreen({ ctx }) {
  const T = useT();
  const { profile, board, refreshBoard, social, sendRequest, go } = ctx;
  const [metric, setMetric] = useState("workouts");
  const [scope, setScope] = useState("alle");
  const [exBoard, setExBoard] = useState("");
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

      {rows.length === 0 && (
        <Empty title="Noch niemand hier" hint="Sobald du oder deine Freunde etwas gespeichert habt, füllt sich die Liste." />
      )}

      {rows.length > 0 && (
        <Podium rows={rows.slice(0, 3)} me={profile.username} unit={unit} decimals={metric === "km" && !exBoard ? 1 : 0}
          color={color} onOpen={setOpenFriend} />
      )}

      {myRank > 0 && myRank > 3 && (
        <Card className="p-4 mb-4" style={{
          border: `1px solid ${PLATE.yellow}55`,
          background: `linear-gradient(135deg, ${T.panel}, ${PLATE.yellow}14)`,
        }}>
          <div className="flex justify-between items-center">
            <div>
              <Eyebrow color={PLATE.yellow}>Dein Platz</Eyebrow>
              <div className="rig-num text-3xl" style={{ color: T.text }}>#{myRank}<span className="text-sm ml-2" style={{ color: T.muted }}>von {rows.length}</span></div>
            </div>
            <div className="rig-num text-xl" style={{ color: PLATE.yellow }}>{nf(rows[myRank - 1]._v, metric === "km" && !exBoard ? 1 : 0)} {unit}</div>
          </div>
        </Card>
      )}

      {rows.length > 3 && (
        <div className="mb-2">
          {rows.slice(3).map((r, idx) => {
            const i = idx + 3;
            const me = r.username === profile.username;
            return (
              <Card key={r.username} className="p-3 mb-2" style={me ? { border: `1px solid ${PLATE.yellow}55`, background: `linear-gradient(135deg, ${T.panel}, ${PLATE.yellow}14)` } : undefined}
                onClick={me ? undefined : () => setOpenFriend(r)}>
                <div className="flex items-center gap-3">
                  <span className="rig-num text-xs w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: T.panel2, color: T.muted }}>{i + 1}</span>
                  <Avatar url={r.avatarUrl} emoji={r.emoji} size={28} />
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
        </div>
      )}

      {/* Freunde verwalten (finden, Anfragen, Chat) sind jetzt im Community-Tab. */}
      <div className="mt-8 mb-2 text-center">
        <button onClick={() => go("community")} className="text-xs px-4 py-2 rounded-full inline-block"
          style={{ background: T.panel2, color: T.muted, border: `1px solid ${T.line}` }}>
          Freunde &amp; Chat im Community-Tab ◆
        </button>
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
        <div className="flex justify-center mb-3"><Avatar url={entry.avatarUrl} emoji={entry.emoji} size={64} style={{ fontSize: 32 }} /></div>
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
        <div className="flex justify-center mb-2"><Avatar url={entry.avatarUrl} emoji={entry.emoji} size={80} style={{ fontSize: 40 }} /></div>
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

/* --- Community: Feed, Freunde, Chat, Benachrichtigungen ----------------- */
const NOTIF_ICON = { friend_request: "🤝", friend_accept: "✅", chat: "💬", challenge: "⚔️" };

function ChatSheet({ open, onClose, friend, me, ctx }) {
  const T = useT();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!open || !friend) return;
    let stop = false;
    const load = async () => { const msgs = await ctx.loadChat(friend); if (!stop) setMessages(msgs); };
    load();
    const id = setInterval(load, 4000);
    return () => { stop = true; clearInterval(id); };
  }, [open, friend, ctx]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setText("");
    const msgs = await ctx.sendMessage(friend, t);
    if (msgs) setMessages(msgs);
    setSending(false);
  };

  return (
    <Sheet open={open} onClose={onClose} title={friend ? `Chat · ${friend}` : "Chat"}>
      <div ref={scrollRef} className="flex flex-col gap-2 mb-3 overflow-y-auto rig-scroll" style={{ maxHeight: "50vh" }}>
        {messages.length === 0 && (
          <div className="text-xs text-center py-6" style={{ color: T.muted }}>Noch keine Nachrichten. Schreib als Erstes.</div>
        )}
        {messages.map((m) => {
          const mine = m.from === me;
          return (
            <div key={m.id} className="flex" style={{ justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div className="px-3 py-2 rounded-xl text-sm" style={{ maxWidth: "78%", background: mine ? PLATE.yellow : T.panel2, color: mine ? "#14161B" : T.text }}>
                {m.text}
                <div className="text-[10px] mt-1" style={{ color: mine ? "#14161B99" : T.muted }}>{timeAgo(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Nachricht schreiben …" className="flex-1 px-4 py-3 rounded-xl"
          style={{ background: T.panel, color: T.text, border: `1px solid ${T.line}` }} />
        <Btn onClick={send} disabled={sending}>Senden</Btn>
      </div>
    </Sheet>
  );
}

function NotificationsSheet({ open, onClose, notifications }) {
  const T = useT();
  return (
    <Sheet open={open} onClose={onClose} title="Benachrichtigungen">
      {notifications.length === 0 && <Empty title="Noch nichts los" hint="Freundschaftsanfragen und Nachrichten erscheinen hier." />}
      {notifications.map((n) => (
        <Card key={n.id} className="p-3 mb-2"
          style={!n.read ? { border: `1px solid ${PLATE.yellow}55`, background: `linear-gradient(135deg, ${T.panel}, ${PLATE.yellow}14)` } : undefined}>
          <div className="flex items-start gap-3">
            <span className="text-base w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: T.panel2 }}>
              {NOTIF_ICON[n.type] || "🔔"}
            </span>
            <div className="flex-1">
              <div className="text-sm" style={{ color: T.text }}>{n.text}</div>
              <div className="text-xs mt-1" style={{ color: T.muted }}>{timeAgo(n.createdAt)}</div>
            </div>
          </div>
        </Card>
      ))}
    </Sheet>
  );
}

function ChallengeCard({ challenge, me, onAccept, onDecline }) {
  const T = useT();
  const m = CHALLENGE_METRICS.find((x) => x.value === challenge.metric) || CHALLENGE_METRICS[0];
  const opponent = challenge.createdBy === me ? challenge.opponent : challenge.createdBy;
  const decimals = m.value === "km" ? 1 : 0;

  if (challenge.status === "pending" && challenge.opponent === me) {
    return (
      <Card className="p-4 mb-3" style={{ border: `1px solid ${PLATE.yellow}55`, background: `linear-gradient(135deg, ${T.panel}, ${PLATE.yellow}14)` }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">⚔️</span>
          <div className="text-sm flex-1" style={{ color: T.text }}>
            <span style={{ fontWeight: 600 }}>{challenge.createdBy}</span> fordert dich heraus: {m.label} diese Woche
          </div>
        </div>
        <div className="flex gap-2">
          <Btn className="flex-1" onClick={() => onAccept(challenge.id)}>Annehmen</Btn>
          <Btn variant="ghost" className="flex-1" onClick={() => onDecline(challenge.id)}>Ablehnen</Btn>
        </div>
      </Card>
    );
  }
  if (challenge.status === "pending") {
    return (
      <Card className="p-4 mb-3" style={{ opacity: 0.7 }}>
        <div className="text-sm" style={{ color: T.text }}>⚔️ Challenge an <span style={{ fontWeight: 600 }}>{challenge.opponent}</span> · {m.label}</div>
        <div className="text-xs mt-1" style={{ color: T.muted }}>Warte auf Antwort …</div>
      </Card>
    );
  }
  if (challenge.status === "declined") {
    return (
      <Card className="p-4 mb-3" style={{ opacity: 0.6 }}>
        <div className="text-sm" style={{ color: T.text }}>⚔️ {opponent} · {m.label}</div>
        <div className="text-xs mt-1" style={{ color: PLATE.red }}>Abgelehnt</div>
      </Card>
    );
  }

  const myVal = challenge.values[me] || 0;
  const oppVal = challenge.values[opponent] || 0;
  const total = Math.max(myVal, oppVal, 1);
  const finished = Date.now() >= challenge.endsAt;
  const daysLeft = Math.max(0, Math.ceil((challenge.endsAt - Date.now()) / DAY));
  const iAmWinning = myVal > oppVal;

  return (
    <Card className="p-4 mb-3" style={finished ? { border: `1px solid ${PLATE.yellow}55`, background: `linear-gradient(135deg, ${T.panel}, ${PLATE.yellow}14)` } : undefined}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm" style={{ color: T.text, fontWeight: 600 }}>Du vs. {opponent}</div>
        <div className="text-xs" style={{ color: T.muted }}>{finished ? "beendet" : `noch ${daysLeft} Tag${daysLeft === 1 ? "" : "e"}`}</div>
      </div>
      <div className="text-xs mb-3" style={{ color: T.muted }}>{m.label}</div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="rig-num text-sm w-14 shrink-0" style={{ color: PLATE.yellow }}>{nf(myVal, decimals)}</span>
        <div className="flex-1 rounded-full overflow-hidden" style={{ height: 8, background: T.panel2 }}>
          <div style={{ width: `${(myVal / total) * 100}%`, height: 8, borderRadius: 4, background: PLATE.yellow }} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rig-num text-sm w-14 shrink-0" style={{ color: T.muted }}>{nf(oppVal, decimals)}</span>
        <div className="flex-1 rounded-full overflow-hidden" style={{ height: 8, background: T.panel2 }}>
          <div style={{ width: `${(oppVal / total) * 100}%`, height: 8, borderRadius: 4, background: T.muted }} />
        </div>
      </div>
      {finished && (
        <div className="text-xs mt-3 text-center rig-num" style={{ color: myVal === oppVal ? T.muted : iAmWinning ? PLATE.green : PLATE.red }}>
          {myVal === oppVal ? "Unentschieden" : iAmWinning ? "🏆 Gewonnen!" : "Verloren"}
        </div>
      )}
    </Card>
  );
}

function NewChallengeSheet({ open, onClose, friends, presetFriend, onCreate }) {
  const T = useT();
  const [friend, setFriend] = useState("");
  const [metric, setMetric] = useState("workouts");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setFriend(presetFriend || friends[0] || ""); setMetric("workouts"); }
  }, [open, presetFriend, friends]);

  const submit = async () => {
    if (!friend) return;
    setBusy(true);
    await onCreate(friend, metric);
    setBusy(false);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Challenge starten">
      <Eyebrow>Gegen wen?</Eyebrow>
      <div className="flex gap-2 flex-wrap mb-5">
        {friends.map((f) => (
          <button key={f} onClick={() => setFriend(f)} className="px-3 py-2 rounded-lg text-sm"
            style={{ background: friend === f ? PLATE.yellow : T.panel2, color: friend === f ? "#14161B" : T.text }}>
            {f}
          </button>
        ))}
        {friends.length === 0 && <div className="text-xs" style={{ color: T.muted }}>Du hast noch keine Freunde.</div>}
      </div>
      <Eyebrow>Worum geht's?</Eyebrow>
      <div className="mb-5">
        <Segmented value={metric} onChange={setMetric} options={CHALLENGE_METRICS} />
      </div>
      <div className="text-xs mb-4" style={{ color: T.muted }}>Läuft 7 Tage, sobald {friend || "dein Freund"} annimmt.</div>
      <Btn className="w-full" disabled={!friend || busy} onClick={submit}>Challenge senden</Btn>
    </Sheet>
  );
}

const ACTIVITY_KIND = {
  workout: { icon: "🏋️", color: PLATE.yellow, label: "Workout" },
  run: { icon: "🏃", color: PLATE.blue, label: "Lauf" },
  rope: { icon: "🪢", color: PLATE.green, label: "Seilspringen" },
};

/* Letzte Trainings-, Lauf- und Sprung-Einheiten gemischt, neueste zuerst –
   Auswahl für "Aktivität teilen" im Composer. */
function recentActivityOptions(workouts, runs, ropes) {
  const items = [
    ...workouts.slice(0, 6).map((w) => ({
      kind: "workout", id: w.id, date: w.startedAt, title: w.title || "Training",
      reps: workoutTotals(w).reps, durationSec: w.durationSec,
    })),
    ...runs.slice(0, 6).map((r) => ({
      kind: "run", id: r.id, date: r.date, title: "Lauf", distanceKm: r.distanceKm, durationSec: r.durationSec,
    })),
    ...ropes.slice(0, 6).map((r) => ({
      kind: "rope", id: r.id, date: r.date, title: "Seilspringen", jumps: r.totalJumps, durationSec: r.durationSec,
    })),
  ];
  return items.sort((a, b) => b.date - a.date).slice(0, 6);
}
function activityStatLine(a) {
  if (a.kind === "run") return `${nf(a.distanceKm, 2)} km · ${fmtMin(a.durationSec)}`;
  if (a.kind === "rope") return `${nf(a.jumps)} Sprünge · ${fmtMin(a.durationSec)}`;
  return `${nf(a.reps)} Wdh. · ${fmtMin(a.durationSec)}`;
}

function PostComposer({ onPost, avatarUrl, emoji, workouts, runs, ropes }) {
  const T = useT();
  const [text, setText] = useState("");
  const [image, setImage] = useState(null);
  const [activity, setActivity] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const options = useMemo(() => recentActivityOptions(workouts, runs, ropes), [workouts, runs, ropes]);

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { setImage(await resizeImageFile(file)); } catch { /* Bild ließ sich nicht lesen */ }
  };

  const submit = async () => {
    if (!text.trim() && !image && !activity) return;
    setBusy(true);
    await onPost(text, image, activity);
    setText(""); setImage(null); setActivity(null); setPickerOpen(false); setBusy(false);
  };

  return (
    <Card className="p-4 mb-5" style={{ background: `linear-gradient(160deg, ${T.panel}, ${PLATE.yellow}0d)` }}>
      <div className="flex gap-3 mb-3">
        <Avatar url={avatarUrl} emoji={emoji} size={40} style={{ marginTop: 2 }} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Form, Essen, Fortschritt – was gibt's Neues?"
          rows={3} className="flex-1 px-3 py-2 rounded-xl text-sm rig-scroll"
          style={{ background: T.panel2, color: T.text, border: `1px solid ${T.line}`, resize: "none" }} />
      </div>

      {image && (
        <div className="relative mb-3">
          <img src={image} alt="" className="w-full rounded-xl" style={{ maxHeight: 220, objectFit: "cover" }} />
          <button onClick={() => setImage(null)} className="absolute top-2 right-2 text-xs px-2 py-1 rounded-lg"
            style={{ background: "rgba(6,7,10,.7)", color: "#EFEDE7" }}>✕</button>
        </div>
      )}

      {activity && (() => {
        const k = ACTIVITY_KIND[activity.kind];
        return (
          <div className="mb-3 p-3 rounded-xl flex items-center gap-3"
            style={{ background: `linear-gradient(135deg, ${T.panel2}, ${k.color}22)`, border: `1px solid ${k.color}55` }}>
            <span className="text-xl">{k.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate" style={{ color: T.text, fontWeight: 600 }}>{activity.title}</div>
              <div className="text-xs rig-num" style={{ color: k.color }}>{activityStatLine(activity)}</div>
            </div>
            <button onClick={() => setActivity(null)} className="text-xs px-2 py-1 rounded-lg shrink-0" style={{ background: "rgba(6,7,10,.35)", color: T.text }}>✕</button>
          </div>
        );
      })()}

      {pickerOpen && (
        <div className="flex gap-2 mb-3 overflow-x-auto rig-scroll pb-1">
          {options.length === 0 && <div className="text-xs py-2" style={{ color: T.muted }}>Noch nichts erfasst.</div>}
          {options.map((a) => {
            const k = ACTIVITY_KIND[a.kind];
            const on = activity && activity.kind === a.kind && activity.id === a.id;
            return (
              <button key={a.kind + a.id} onClick={() => { setActivity(on ? null : a); setPickerOpen(false); }}
                className="shrink-0 text-left px-3 py-2 rounded-xl"
                style={{ background: on ? k.color : T.panel2, color: on ? "#14161B" : T.text, border: `1px solid ${T.line}`, minWidth: 132 }}>
                <div className="text-xs" style={{ fontWeight: 600 }}>{k.icon} {a.title}</div>
                <div className="text-[10px] rig-num mt-0.5" style={{ color: on ? "#14161B99" : T.muted }}>{activityStatLine(a)}</div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
        <Btn variant="quiet" onClick={() => fileRef.current?.click()}>📷 Foto</Btn>
        <Btn variant="quiet" onClick={() => setPickerOpen((v) => !v)}>🏋️ Aktivität</Btn>
        <div className="flex-1" />
        <Btn onClick={submit} disabled={busy || (!text.trim() && !image && !activity)}>Posten</Btn>
      </div>
    </Card>
  );
}

function PostCard({ post, me, onLike, onDelete, onOpenAuthor }) {
  const T = useT();
  const liked = (post.likes || []).includes(me);
  const count = (post.likes || []).length;
  const k = post.activity ? ACTIVITY_KIND[post.activity.kind] : null;
  return (
    <Card className="p-4 mb-3" style={k ? { border: `1px solid ${k.color}40` } : undefined}>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onOpenAuthor}><Avatar url={post.authorAvatarUrl} emoji={post.authorEmoji} size={38} /></button>
        <button onClick={onOpenAuthor} className="flex-1 text-sm text-left" style={{ color: T.text, fontWeight: 600 }}>
          {post.authorUsername}{post.authorUsername === me && " · du"}
        </button>
        <span className="text-xs" style={{ color: T.muted }}>{timeAgo(post.createdAt)}</span>
      </div>

      {k && (
        <div className="flex items-center gap-3 p-3 mb-3 rounded-xl"
          style={{ background: `linear-gradient(135deg, ${T.panel2}, ${k.color}22)`, border: `1px solid ${k.color}40` }}>
          <span className="text-2xl">{k.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate rig-display" style={{ color: T.text }}>{post.activity.title}</div>
            <div className="text-xs rig-num mt-0.5" style={{ color: k.color }}>{activityStatLine(post.activity)}</div>
          </div>
        </div>
      )}

      {post.text && <div className="text-sm mb-3" style={{ color: T.text, whiteSpace: "pre-wrap" }}>{post.text}</div>}
      {post.image && <img src={post.image} alt="" className="w-full rounded-xl mb-3" style={{ maxHeight: 320, objectFit: "cover" }} />}
      <div className="flex items-center gap-4 pt-3" style={{ borderTop: `1px solid ${T.line}` }}>
        <button onClick={onLike} className="text-sm flex items-center gap-1.5 active:scale-90 px-3 py-1.5 rounded-full"
          style={{ transition: "transform .12s ease", background: liked ? `${PLATE.yellow}22` : "transparent", color: liked ? PLATE.yellow : T.muted }}>
          🔥 <span className="rig-num text-xs">{count > 0 ? count : "Kudos"}</span>
        </button>
        {post.authorUsername === me && (
          <button onClick={onDelete} className="text-xs ml-auto" style={{ color: T.muted }}>Löschen</button>
        )}
      </div>
    </Card>
  );
}

/* "Wer war heute schon aktiv" – Story-Leiste wie bei Instagram/Snapchat, aber
   fitness-eigen: der Ring leuchtet, wenn die Person heute trainiert hat
   (Signal: updatedAt des Board-Eintrags, wird bei jedem Workout/Lauf/Sprung
   neu gesetzt), die Flamme zeigt eine laufende Serie. */
function activeToday(entry) {
  return !!entry && dayKey(entry.updatedAt) === dayKey(Date.now());
}

function StoryStrip({ me, board, friends, onOpen }) {
  const T = useT();
  const people = useMemo(() => [me, ...friends]
    .map((u) => board.find((b) => b.username === u) || { username: u })
    .sort((a, b) => (activeToday(b) - activeToday(a)) || (b.streak || 0) - (a.streak || 0)),
  [me, friends, board]);

  if (people.length <= 1) return null;

  return (
    <div className="flex gap-3 mb-5 overflow-x-auto rig-scroll pb-1">
      {people.map((p) => {
        const active = activeToday(p);
        const isMe = p.username === me;
        return (
          <button key={p.username} onClick={() => !isMe && onOpen(p)} className="flex flex-col items-center gap-1 shrink-0" style={{ width: 62 }}>
            <div className="relative">
              <div className="rounded-full p-[2px]" style={{ background: active ? `linear-gradient(135deg, ${PLATE.yellow}, ${PLATE.red})` : T.line }}>
                <div className="rounded-full p-[2px]" style={{ background: T.bg }}>
                  <Avatar url={p.avatarUrl} emoji={p.emoji} size={52} />
                </div>
              </div>
              {p.streak > 0 && (
                <span className="absolute -bottom-1 -right-1 text-[10px] rig-num px-1 rounded-full" style={{ background: PLATE.red, color: "#fff" }}>
                  🔥{p.streak}
                </span>
              )}
            </div>
            <span className="text-[10px] truncate" style={{ color: active ? T.text : T.muted, maxWidth: 60 }}>
              {isMe ? "Du" : p.username}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CommunityScreen({ ctx }) {
  const T = useT();
  const {
    profile, board, social, sendRequest, acceptRequest, declineRequest, removeFriend,
    feed, refreshFeed, addPost, toggleLike, deletePost,
    notifications, refreshNotifications, markNotificationsRead, refreshBoard,
    challenges, refreshChallenges, startChallenge, respondChallenge,
    workouts, runs, ropes,
  } = ctx;
  const [view, setView] = useState("feed");
  const [feedScope, setFeedScope] = useState("freunde");
  const [q, setQ] = useState("");
  const [searchRes, setSearchRes] = useState(null);
  const [openFriend, setOpenFriend] = useState(null);
  const [chatFriend, setChatFriend] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [newChallengeOpen, setNewChallengeOpen] = useState(false);
  const [challengeFriend, setChallengeFriend] = useState(null);

  useEffect(() => { refreshBoard(); refreshFeed(); refreshNotifications(); refreshChallenges(); }, [refreshBoard, refreshFeed, refreshNotifications, refreshChallenges]);

  const friends = social.friends || [];
  const unread = notifications.filter((n) => !n.read).length;
  const pendingChallenges = challenges.filter((c) => c.status === "pending" && c.opponent === profile.username).length;

  const doSearch = async () => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return setSearchRes([]);
    const found = await Cloud.findUsernames(t, ctx.owner).catch(() => []);
    setSearchRes(found.filter((c) => c.username.toLowerCase() !== profile.username.toLowerCase()));
  };

  const visiblePosts = feedScope === "freunde"
    ? feed.filter((p) => p.authorUsername === profile.username || friends.includes(p.authorUsername))
    : feed;

  const openNotifications = () => { setNotifOpen(true); markNotificationsRead(); };
  const activeTodayCount = [profile.username, ...friends].filter((u) => activeToday(board.find((b) => b.username === u))).length;

  return (
    <div className="px-5 pt-6 pb-28 rig-fade">
      <div className="flex items-center justify-between mb-1">
        <div className="rig-display text-3xl" style={{ color: T.text }}>Community</div>
        <button onClick={openNotifications} className="relative text-lg w-11 h-11 rounded-2xl flex items-center justify-center"
          style={{ background: T.panel, border: `1px solid ${T.line}`, boxShadow: T.shadow }}>
          🔔
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 rig-num text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: PLATE.red, color: "#fff", minWidth: 16, textAlign: "center", boxShadow: "0 2px 6px rgba(214,64,47,.5)" }}>{unread}</span>
          )}
        </button>
      </div>
      <div className="text-sm mb-5" style={{ color: activeTodayCount > 0 ? PLATE.yellow : T.muted }}>
        {activeTodayCount > 0
          ? `🔥 ${activeTodayCount} aus deiner Crew ${activeTodayCount === 1 ? "ist" : "sind"} heute schon aktiv`
          : "Feed, Freunde und Chat an einem Ort."}
      </div>

      <div className="mb-5">
        <Segmented value={view} onChange={setView}
          options={[
            { value: "feed", label: "Feed" },
            { value: "friends", label: `Freunde (${friends.length})` },
            { value: "challenges", label: `Challenges${pendingChallenges > 0 ? ` (${pendingChallenges})` : ""}` },
          ]} />
      </div>

      {view === "feed" && (
        <>
          <StoryStrip me={profile.username} board={board} friends={friends}
            onOpen={(p) => setOpenFriend(p)} />
          <PostComposer onPost={addPost} avatarUrl={profile.avatarUrl} emoji={profile.emoji}
            workouts={workouts} runs={runs} ropes={ropes} />
          <div className="mb-4">
            <Segmented value={feedScope} onChange={setFeedScope}
              options={[{ value: "freunde", label: "Freunde" }, { value: "alle", label: "Alle" }]} />
          </div>
          {visiblePosts.length === 0 && (
            <Empty title="Noch nichts gepostet" hint="Teil deine Form, dein Essen oder deinen Fortschritt mit deinen Freunden." />
          )}
          {visiblePosts.map((p) => (
            <PostCard key={p.id} post={p} me={profile.username}
              onLike={() => toggleLike(p.authorUsername, p.id)}
              onDelete={() => deletePost(p.id)}
              onOpenAuthor={() => p.authorUsername !== profile.username && setOpenFriend(board.find((b) => b.username === p.authorUsername) || { username: p.authorUsername, emoji: p.authorEmoji, avatarUrl: p.authorAvatarUrl })} />
          ))}
        </>
      )}

      {view === "friends" && (
        <>
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
                  <Avatar emoji={u.emoji} size={34} />
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

          <Eyebrow>Deine Freunde</Eyebrow>
          {friends.length === 0 && (
            <div className="text-xs mb-3" style={{ color: T.muted }}>Noch keine Freunde – oben suchen und Anfrage senden.</div>
          )}
          {friends.map((u) => {
            const entry = board.find((b) => b.username === u);
            const online = activeToday(entry);
            const iconBtn = "w-9 h-9 rounded-full flex items-center justify-center text-sm shrink-0 active:scale-90";
            return (
              <Card key={u} className="p-3 mb-2">
                <div className="flex items-center gap-3">
                  <button onClick={() => setOpenFriend(entry || { username: u })} className="shrink-0 relative">
                    <Avatar url={entry?.avatarUrl} emoji={entry?.emoji} size={36} />
                    {online && (
                      <span className="absolute -bottom-0.5 -right-0.5 rounded-full" style={{ width: 11, height: 11, background: PLATE.green, border: `2px solid ${T.panel}` }} />
                    )}
                  </button>
                  <button onClick={() => setOpenFriend(entry || { username: u })} className="flex-1 text-left text-sm truncate" style={{ color: T.text, fontWeight: 500 }}>
                    {u}
                    {online && <span className="text-[10px] ml-2" style={{ color: PLATE.green }}>heute aktiv</span>}
                  </button>
                  <button onClick={() => setChatFriend(u)} className={iconBtn} style={{ background: T.panel2, color: PLATE.yellow, transition: "transform .12s ease" }}>💬</button>
                  <button onClick={() => { setChallengeFriend(u); setNewChallengeOpen(true); }}
                    className={iconBtn} style={{ background: T.panel2, color: T.text, transition: "transform .12s ease" }}>⚔️</button>
                  <button onClick={() => removeFriend(u)} className={iconBtn} style={{ background: T.panel2, color: PLATE.red, transition: "transform .12s ease" }}>✕</button>
                </div>
              </Card>
            );
          })}
        </>
      )}

      {view === "challenges" && (
        <>
          <Btn className="w-full mb-4" disabled={friends.length === 0}
            onClick={() => { setChallengeFriend(null); setNewChallengeOpen(true); }}>⚔️ Challenge starten</Btn>
          {challenges.length === 0 && (
            <Empty title="Noch keine Challenges" hint="Fordere einen Freund heraus – wer schafft diese Woche mehr?" />
          )}
          {[...challenges].sort((a, b) => {
            const rank = (c) => (c.status === "pending" && c.opponent === profile.username) ? 0
              : (c.status === "active" && Date.now() < c.endsAt) ? 1
                : c.status === "pending" ? 2 : 3;
            return rank(a) - rank(b);
          }).map((c) => (
            <ChallengeCard key={c.id} challenge={c} me={profile.username}
              onAccept={(id) => respondChallenge(id, true)} onDecline={(id) => respondChallenge(id, false)} />
          ))}
        </>
      )}

      <Sheet open={!!openFriend} onClose={() => setOpenFriend(null)} title={openFriend?.username || ""}>
        {openFriend && <FriendProfile entry={openFriend} isFriend={friends.includes(openFriend.username)} me={profile.username}
          onAdd={() => { sendRequest(openFriend.username); setOpenFriend(null); }} />}
      </Sheet>

      <ChatSheet open={!!chatFriend} onClose={() => setChatFriend(null)} friend={chatFriend} me={profile.username} ctx={ctx} />
      <NotificationsSheet open={notifOpen} onClose={() => setNotifOpen(false)} notifications={notifications} />
      <NewChallengeSheet open={newChallengeOpen} onClose={() => setNewChallengeOpen(false)}
        friends={friends} presetFriend={challengeFriend} onCreate={startChallenge} />
    </div>
  );
}

/* Eigener QR-Code zum Freunde-hinzufügen: kodiert einen Link zurück auf die
   App mit ?add=<username>. Jede Handykamera erkennt den Code systemweit und
   öffnet den Link – kein In-App-Scanner mit Kamerazugriff nötig. Schwarz auf
   Weiß statt Markenfarben, damit die Erkennung zuverlässig bleibt. */
function MyQrCodeSheet({ open, onClose, username }) {
  const T = useT();
  const canvasRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?add=${encodeURIComponent(username)}` : "";

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, { width: 260, margin: 1, color: { dark: "#101218", light: "#FFFFFF" } }).catch(() => {});
  }, [open, url]);

  const share = async () => {
    setBusy(true);
    try {
      if (navigator.share) await navigator.share({ title: "STRADAA", text: `Füg mich auf STRADAA hinzu: ${username}`, url });
      else await navigator.clipboard.writeText(url);
    } catch { /* abgebrochen */ }
    setBusy(false);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Mein QR-Code">
      <div className="flex flex-col items-center">
        <div className="p-4 rounded-2xl mb-4" style={{ background: "#FFFFFF" }}>
          <canvas ref={canvasRef} />
        </div>
        <div className="rig-display text-xl mb-1" style={{ color: T.text }}>{username}</div>
        <div className="text-xs text-center mb-5" style={{ color: T.muted }}>
          Freunde scannen diesen Code mit der Handykamera, um dir eine Anfrage zu senden.
        </div>
        <Btn className="w-full" onClick={share} disabled={busy}>{busy ? "…" : "Teilen"}</Btn>
      </div>
    </Sheet>
  );
}

/* Kleiner Baustein für Impressum/Datenschutz: Überschrift + Fließtext,
   damit beide Sheets nicht jede Zeile einzeln stylen müssen. */
function LegalSection({ title, children }) {
  const T = useT();
  return (
    <div className="mb-4">
      {title && <div className="text-sm font-semibold mb-1" style={{ color: T.text }}>{title}</div>}
      <div className="text-xs leading-relaxed" style={{ color: T.muted }}>{children}</div>
    </div>
  );
}

/* Enthält noch Platzhalter ([...]) – die Betreiber tragen Name/Adresse/
   Kontakt-E-Mail selbst nach, das kann/soll niemand für sie erfinden. */
function ImpressumSheet({ open, onClose }) {
  const T = useT();
  return (
    <Sheet open={open} onClose={onClose} title="Impressum">
      <LegalSection title="Angaben gemäß § 5 ECG">
        [Name Person 1]<br />
        [Name Person 2]<br /><br />
        [Straße Hausnummer]<br />
        [PLZ Ort], Österreich
      </LegalSection>
      <LegalSection title="Kontakt">
        E-Mail: [gemeinsame-email@...]
      </LegalSection>
      <LegalSection>
        Diese App wird als privates, nicht-kommerzielles Projekt zu zweit betrieben.
      </LegalSection>
      <LegalSection title="Streitschlichtung">
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{" "}
        <span style={{ color: T.text }}>ec.europa.eu/consumers/odr</span>. Wir sind nicht verpflichtet und nicht
        bereit, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
      </LegalSection>
    </Sheet>
  );
}

function DatenschutzSheet({ open, onClose }) {
  const T = useT();
  return (
    <Sheet open={open} onClose={onClose} title="Datenschutzerklärung" full>
      <LegalSection title="1. Verantwortliche">
        [Name Person 1], [Name Person 2]<br />
        [Adresse]<br />
        E-Mail: [gemeinsame-email@...]<br /><br />
        Wir betreiben diese App gemeinsam und sind daher gemeinsam Verantwortliche im Sinne von Art. 26 DSGVO.
        Für Anfragen zu deinen Daten wende dich an obige E-Mail-Adresse, wir kümmern uns gemeinsam darum.
      </LegalSection>
      <LegalSection title="2. Welche Daten wir verarbeiten">
        <b style={{ color: T.text }}>Registrierung:</b> E-Mail-Adresse und Passwort (über unseren Auth-Anbieter Supabase, Passwort verschlüsselt gespeichert)<br /><br />
        <b style={{ color: T.text }}>Profildaten:</b> Benutzername, Profilbild/Emoji, Geschlecht, Geburtsdatum, Körpergröße/-gewicht, Trainingsziele – jeweils freiwillige Angaben<br /><br />
        <b style={{ color: T.text }}>Trainingsdaten:</b> geloggte Workouts, Sätze, Wiederholungen, Gewichte, Seilspringen<br /><br />
        <b style={{ color: T.text }}>Standortdaten:</b> Beim Aufzeichnen eines Laufs erfassen wir mit deiner Erlaubnis fortlaufend deinen GPS-Standort, um die Laufstrecke darzustellen. Diese Daten bleiben in deinem Konto und werden nicht an andere Nutzer weitergegeben.<br /><br />
        <b style={{ color: T.text }}>Fortschrittsfotos:</b> von dir freiwillig hochgeladene Fotos, ausschließlich in deinem eigenen Konto sichtbar<br /><br />
        <b style={{ color: T.text }}>Community-Daten:</b> Falls du die Sichtbarkeits-Einstellungen aktivierst, werden Benutzername und aggregierte Trainingsstatistiken (nicht: GPS-Rohdaten oder Fotos) für Rangliste und Freunde sichtbar<br /><br />
        <b style={{ color: T.text }}>Video-Calls:</b> Bei Nutzung der Team-Call-Funktion wird eine Verbindung zum Drittanbieter Jitsi (meet.jit.si, Betreiber: 8x8, Inc., USA) aufgebaut; dabei werden IP-Adresse und Anzeigename an diesen Dienst übermittelt<br /><br />
        <b style={{ color: T.text }}>Technisch notwendige Cookies/Speicher:</b> Session-Cookies zur Anmeldung (Supabase Auth) sowie lokaler Browser-Speicher (localStorage), damit die App auch offline funktioniert<br /><br />
        <b style={{ color: T.text }}>Server-Logs:</b> Unser Hosting-Anbieter Vercel verarbeitet beim Aufruf der App automatisch IP-Adresse, Zeitpunkt und Browsertyp in Server-Logfiles (Standard-Hosting-Protokollierung)
      </LegalSection>
      <LegalSection title="3. Zweck und Rechtsgrundlage">
        Bereitstellung der App-Funktionen: Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)<br /><br />
        Standortdaten, Fotos, Video-Calls: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung), jederzeit widerrufbar
      </LegalSection>
      <LegalSection title="4. Empfänger / Auftragsverarbeiter">
        <b style={{ color: T.text }}>Supabase</b> – Datenbank &amp; Authentifizierung, Serverstandort Frankfurt/EU (eu-central-1)<br /><br />
        <b style={{ color: T.text }}>Vercel Inc.</b> – Hosting der Web-App (USA-Unternehmen; Übermittlung ggf. auf Basis des EU-US Data Privacy Framework / Standardvertragsklauseln)<br /><br />
        <b style={{ color: T.text }}>8x8, Inc. (Jitsi)</b> – nur bei aktiver Nutzung der Video-Call-Funktion
      </LegalSection>
      <LegalSection title="5. Speicherdauer">
        Deine Daten bleiben gespeichert, solange dein Konto besteht. Über "Alle Daten löschen" in den
        Profileinstellungen kannst du sie jederzeit selbst unwiderruflich entfernen.
      </LegalSection>
      <LegalSection title="6. Deine Rechte">
        Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung,
        Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO). Kontakt: [gemeinsame-email@...].
        Beschwerderecht bei der österreichischen Datenschutzbehörde (dsb.gv.at).
      </LegalSection>
      <LegalSection title="7. Keine Weitergabe zu Werbezwecken">
        Deine Daten werden nicht verkauft oder zu Werbezwecken an Dritte weitergegeben.
      </LegalSection>
    </Sheet>
  );
}

/* --- Profil / Einstellungen --------------------------------------------- */
function ProfileScreen({ ctx }) {
  const T = useT();
  const {
    profile, patchProfile, workouts, runs, ropes, weightLog, prs, streak, exportData,
    go, resetAll, startCall, cloudStatus, authEmail, signOut,
  } = ctx;
  const agg = aggregate(workouts, runs, ropes);
  const [confirmReset, setConfirmReset] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [showStatsDetail, setShowStatsDetail] = useState(false);
  const [showVisibility, setShowVisibility] = useState(false);
  const [showPersonal, setShowPersonal] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showImpressum, setShowImpressum] = useState(false);
  const [showDatenschutz, setShowDatenschutz] = useState(false);
  const [editGoals, setEditGoals] = useState(false);
  const avatarFileRef = useRef(null);
  const statusLabel = { unconfigured: "Nicht angemeldet", ok: "Synchronisiert", error: "Sync-Fehler" }[cloudStatus] || "Nicht angemeldet";
  const statusColor = { unconfigured: T.muted, ok: PLATE.green, error: PLATE.red }[cloudStatus] || T.muted;
  const doSignOut = async () => {
    setSignOutBusy(true);
    await signOut();
    setSignOutBusy(false);
  };

  const pickAvatar = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarBusy(true);
    try {
      const url = await resizeImageFile(file, 200, 0.75);
      await patchProfile({ avatarUrl: url });
    } catch {
      // Bild ließ sich nicht lesen
    }
    setAvatarBusy(false);
  };
  const removeAvatar = () => patchProfile({ avatarUrl: null });

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

  /* Wochenring am Profilbild – dieselbe Rechnung wie auf der Home-Seite. */
  const weekStart = Date.now() - 7 * DAY;
  const thisWeekCount = workouts.filter((w) => w.startedAt >= weekStart).length;
  const weeklyGoalVal = profile.weeklyGoal || 4;
  const expLabel = EXPERIENCE_LEVELS.find((l) => l.value === profile.experience)?.label;

  /* Gewichts-Fortschritt: echte Strecke seit dem ersten erfassten Gewicht bis zum
     Ziel, nicht nur eine freie Zahl – nutzt den ohnehin vorhandenen Gewichtsverlauf. */
  const sortedWeights = useMemo(() => [...(weightLog || [])].sort((a, b) => a.date - b.date), [weightLog]);
  const startWeight = sortedWeights[0]?.weightKg ?? profile.weightKg;
  const hasWeightGoal = profile.weightKg != null && profile.goalWeightKg != null;
  const weightPct = hasWeightGoal && startWeight != null && startWeight !== profile.goalWeightKg
    ? clamp((startWeight - profile.weightKg) / (startWeight - profile.goalWeightKg), 0, 1)
    : 0;
  const goalChipLabels = (profile.goals || []).map((g) => GOALS.find((x) => x.value === g)?.label).filter(Boolean);

  return (
    <div className="px-5 pt-6 pb-28 rig-fade">
      {/* --- Kopfbereich: Bild mit Wochenring, Name, Level, dabei-seit --- */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative shrink-0" style={{ width: 100, height: 100 }}>
          <div className="absolute inset-0">
            <ProgressRing value={thisWeekCount} max={weeklyGoalVal} size={100} stroke={4} color={PLATE.yellow} />
          </div>
          <div className="absolute" style={{ top: 6, left: 6 }}>
            <Avatar url={profile.avatarUrl} emoji={profile.emoji} size={88} style={{ fontSize: 42 }} />
          </div>
          <button onClick={() => avatarFileRef.current?.click()} disabled={avatarBusy}
            className="absolute flex items-center justify-center rounded-full"
            style={{ right: -2, bottom: -2, width: 28, height: 28, background: PLATE.yellow, color: "#14161B", border: `2px solid ${T.bg}`, fontSize: 12 }}>
            {avatarBusy ? "…" : "✏️"}
          </button>
          <input ref={avatarFileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rig-display text-2xl truncate" style={{ color: T.text }}>{profile.username}</span>
            {expLabel && (
              <span className="text-[10px] rig-display px-2 py-1 rounded-full shrink-0" style={{ background: T.panel2, color: T.muted, letterSpacing: ".06em" }}>
                {expLabel.toUpperCase()}
              </span>
            )}
          </div>
          <div className="text-xs mt-1" style={{ color: T.muted }}>seit {fmtDate(profile.createdAt)}</div>
        </div>
      </div>

      {/* --- Statistik-Kacheln --- */}
      <Card className="p-5 mb-2">
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Workouts" value={nf(agg.workouts)} />
          <Stat label="Wiederholungen" value={nf(agg.reps)} />
          <Stat label="Tage Serie" value={streak} color={PLATE.yellow} />
        </div>
      </Card>
      <button onClick={() => setShowStatsDetail((v) => !v)} className="w-full text-left text-xs mb-4 px-1" style={{ color: T.muted }}>
        {Object.keys(prs).length} Rekorde, {nf(agg.km, 1)} km, {nf(agg.jumps)} Sprünge – {showStatsDetail ? "einklappen" : "alle anzeigen"} ›
      </button>
      {showStatsDetail && (
        <Card className="p-4 mb-4">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Laufen" value={nf(agg.km, 1)} unit="km" color={PLATE.blue} />
            <Stat label="Sprünge" value={nf(agg.jumps)} color={PLATE.green} />
            <Stat label="Rekorde" value={Object.keys(prs).length} color={PLATE.red} />
          </div>
        </Card>
      )}

      {/* --- So sehen dich Freunde --- */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <Eyebrow>👁 So sehen dich Freunde</Eyebrow>
          <button onClick={() => setShowVisibility((v) => !v)} className="text-xs shrink-0" style={{ color: PLATE.yellow }}>
            {showVisibility ? "fertig" : "anpassen"} ›
          </button>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: T.panel2 }}>
          <Avatar url={profile.avatarUrl} emoji={profile.emoji} size={34} />
          <span className="flex-1 text-sm truncate" style={{ color: T.text }}>{profile.username}</span>
          <span className="rig-num text-xs" style={{ color: PLATE.blue }}>{nf(agg.workouts)} Workout{agg.workouts === 1 ? "" : "s"} · {nf(agg.reps)} Wdh.</span>
        </div>
        {!profile.privacy.leaderboard && (
          <div className="text-xs mt-2" style={{ color: T.muted }}>Aktuell ausgeblendet – du erscheinst in keiner Rangliste.</div>
        )}
        {showVisibility && (
          <div className="mt-1">
            <Toggle label="Profil öffentlich" hint="Freunde sehen deine Zahlen im Detail."
              on={profile.privacy.profilePublic} set={(v) => patchProfile({ privacy: { ...profile.privacy, profilePublic: v } })} />
            <Toggle label="Trainings öffentlich" hint="Zeigt deine Top-Übungen auf dem Profil."
              on={profile.privacy.workoutsPublic} set={(v) => patchProfile({ privacy: { ...profile.privacy, workoutsPublic: v } })} />
            <Toggle label="In der Rangliste auftauchen" hint="Aus heißt: dein Eintrag verschwindet komplett."
              on={profile.privacy.leaderboard} set={(v) => patchProfile({ privacy: { ...profile.privacy, leaderboard: v } })} />
            <Toggle label="Läufe öffentlich" hint="Kilometer bleiben sonst bei null."
              on={profile.privacy.runsPublic} set={(v) => patchProfile({ privacy: { ...profile.privacy, runsPublic: v } })} />
          </div>
        )}
      </Card>

      {/* --- Trainingsziele --- */}
      <Card className="p-4 mb-4" onClick={() => setEditGoals((v) => !v)}>
        <div className="flex items-center justify-between mb-3">
          <Eyebrow>Trainingsziele</Eyebrow>
          <span className="text-xs" style={{ color: PLATE.yellow }}>{editGoals ? "fertig ›" : "bearbeiten ›"}</span>
        </div>

        {hasWeightGoal && (
          <>
            <div className="flex items-center gap-3 mb-1">
              <span className="rig-num text-lg" style={{ color: T.text }}>{nf(profile.weightKg, 1)} kg</span>
              <div className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: T.panel2 }}>
                <div style={{ width: `${weightPct * 100}%`, height: 6, borderRadius: 4, background: PLATE.yellow, transition: "width .3s ease" }} />
              </div>
              <span className="rig-num text-lg" style={{ color: T.muted }}>{nf(profile.goalWeightKg, 1)} kg</span>
            </div>
          </>
        )}
        <div className="text-xs" style={{ color: T.muted }}>
          {profile.goalDate ? `Ziel bis ${fmtDate(new Date(profile.goalDate + "T00:00:00").getTime())} · ` : ""}{weeklyGoalVal}× Training/Woche
        </div>

        {goalChipLabels.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {goalChipLabels.map((label) => (
              <span key={label} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: T.panel2, color: T.text }}>{label}</span>
            ))}
          </div>
        )}

        {editGoals && (
          <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${T.line}` }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4">
              <Eyebrow>Trainings pro Woche</Eyebrow>
              <NumberField value={profile.weeklyGoal} onChange={(v) => patchProfile({ weeklyGoal: clamp(Math.round(v), 1, 14) })} min={1} max={14} width={70} />
            </div>
            <BodyGoalsFields value={profile} onChange={(patch) => patchProfile(patch)} />
          </div>
        )}
      </Card>

      {/* --- Account-Bereich: dezent, seltener genutzt --- */}
      <Card className="p-0 mb-4 overflow-hidden">
        <button onClick={() => setShowPersonal((v) => !v)} className="w-full flex items-center gap-3 p-4 text-left">
          <span>👤</span>
          <span className="flex-1 text-sm" style={{ color: T.text }}>Persönliche Angaben &amp; Darstellung</span>
          <span className="text-xs" style={{ color: T.muted, display: "inline-block", transform: showPersonal ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}>›</span>
        </button>
        {showPersonal && (
          <div className="px-4 pb-4" style={{ borderTop: `1px solid ${T.line}` }}>
            <div className="text-xs mt-3 mb-2" style={{ color: T.muted }}>Geschlecht</div>
            <div className="flex flex-wrap gap-2 mb-4">
              {GENDERS.map((g) => {
                const on = profile.gender === g.value;
                return (
                  <button key={g.value} onClick={() => patchProfile({ gender: g.value })}
                    className="px-3 py-2 rounded-lg text-sm active:scale-95"
                    style={{ background: on ? PLATE.yellow : T.panel, color: on ? "#14161B" : T.text, border: `1px solid ${T.line}`, fontWeight: on ? 600 : 400 }}>
                    {g.label}
                  </button>
                );
              })}
            </div>
            <div className="text-xs mb-2" style={{ color: T.muted }}>Geburtsdatum</div>
            <input type="date" value={profile.birthDate || ""} onChange={(e) => patchProfile({ birthDate: e.target.value || null })}
              className="w-full px-4 py-3 rounded-xl mb-4" style={{ background: T.panel2, color: T.text, border: `1px solid ${T.line}` }} />
            <div className="text-xs mb-2" style={{ color: T.muted }}>Darstellung</div>
            <div className="mb-4">
              <Segmented value={profile.theme} onChange={(v) => patchProfile({ theme: v })}
                options={[{ value: "dark", label: "Dunkel" }, { value: "light", label: "Hell" }]} />
            </div>
            <div className="text-xs mb-2" style={{ color: T.muted }}>
              {profile.avatarUrl ? "Emoji-Fallback (falls du dein Foto entfernst)" : "Emoji, solange kein Foto gesetzt ist"}
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => patchProfile({ emoji: e })} className="w-9 h-9 rounded-lg text-base"
                  style={{ background: profile.emoji === e ? PLATE.yellow : T.panel, border: `1px solid ${T.line}` }}>{e}</button>
              ))}
            </div>
            {profile.avatarUrl && (
              <button onClick={removeAvatar} className="text-xs" style={{ color: T.muted }}>Foto entfernen</button>
            )}
          </div>
        )}

        <button onClick={() => setShowQr(true)} className="w-full flex items-center gap-3 p-4 text-left" style={{ borderTop: `1px solid ${T.line}` }}>
          <span>📱</span>
          <span className="flex-1 text-sm" style={{ color: T.text }}>Mein QR-Code</span>
          <span className="text-xs" style={{ color: T.muted }}>›</span>
        </button>

        <button onClick={() => setShowAccount((v) => !v)} className="w-full flex items-center gap-3 p-4 text-left" style={{ borderTop: `1px solid ${T.line}` }}>
          <span>⚙️</span>
          <span className="flex-1 text-sm" style={{ color: T.text }}>Konto</span>
          <span className="text-xs truncate" style={{ color: T.muted, maxWidth: 160 }}>{authEmail}</span>
          <span className="text-xs shrink-0" style={{ color: T.muted, display: "inline-block", transform: showAccount ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}>›</span>
        </button>
        {showAccount && (
          <div className="px-4 pb-4" style={{ borderTop: `1px solid ${T.line}` }}>
            <div className="flex items-center justify-between mt-3 mb-3">
              <span className="text-xs" style={{ color: T.muted }}>Sync-Status</span>
              <span className="text-xs rig-num px-2 py-1 rounded-full" style={{ background: T.panel2, color: statusColor }}>{statusLabel}</span>
            </div>
            <div className="text-xs mb-4" style={{ color: T.muted }}>
              Angemeldet über Supabase Auth. Deine Daten synchronisieren automatisch und sind auf
              jedem Gerät verfügbar, auf dem du dich mit dieser E-Mail-Adresse anmeldest.
            </div>
            <div className="flex gap-2 mb-2">
              <Btn variant="ghost" className="flex-1" onClick={() => go("history")}>Historie</Btn>
              <Btn variant="ghost" className="flex-1" onClick={exportData}>Daten exportieren</Btn>
            </div>
            <Btn variant="ghost" className="w-full" disabled={signOutBusy} onClick={doSignOut}>
              {signOutBusy ? "Moment …" : "Abmelden"}
            </Btn>
          </div>
        )}
      </Card>

      {/* --- Team-Call --- */}
      <Btn tone={PLATE.blue} className="w-full mb-4" onClick={() => startCall(roomForTeam(profile.username), "Team-Call · dein Raum")}>
        📹 Team-Call starten
      </Btn>
      <div className="text-xs -mt-2 mb-6" style={{ color: T.muted }}>
        Freunde erreichen deinen Raum über dein Profil in der Rangliste – „Team-Call beitreten".
      </div>

      {/* --- Fußbereich --- */}
      <div className="pt-4 text-center" style={{ borderTop: `1px solid ${T.line}` }}>
        <div className="text-xs" style={{ color: T.muted }}>STRADAA · MVP</div>
        <div className="flex items-center justify-center gap-2 mt-2">
          <button onClick={() => setShowImpressum(true)} className="text-xs" style={{ color: T.muted }}>Impressum</button>
          <span className="text-xs" style={{ color: T.muted }}>·</span>
          <button onClick={() => setShowDatenschutz(true)} className="text-xs" style={{ color: T.muted }}>Datenschutz</button>
        </div>
        {confirmReset ? (
          <Card className="p-4 mt-3 text-left" style={{ borderColor: PLATE.red }}>
            <div className="text-sm mb-3" style={{ color: T.text }}>
              Das löscht alle Trainings, Läufe, Sprünge und Rekorde auf diesem Gerät. Rückgängig geht nicht.
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" className="flex-1" onClick={() => setConfirmReset(false)}>Abbrechen</Btn>
              <Btn variant="danger" className="flex-1" onClick={resetAll}>Alles löschen</Btn>
            </div>
          </Card>
        ) : (
          <button onClick={() => setConfirmReset(true)} className="text-xs mt-2" style={{ color: T.muted }}>Alle Daten löschen</button>
        )}
      </div>

      <MyQrCodeSheet open={showQr} onClose={() => setShowQr(false)} username={profile.username} />
      <ImpressumSheet open={showImpressum} onClose={() => setShowImpressum(false)} />
      <DatenschutzSheet open={showDatenschutz} onClose={() => setShowDatenschutz(false)} />
    </div>
  );
}

/* --- Navigation --------------------------------------------------------- */
const TABS = [
  { key: "home", label: "Home", icon: "▤" },
  { key: "workout", label: "Workout", icon: "✚" },
  { key: "stats", label: "Statistik", icon: "▮" },
  { key: "board", label: "Rangliste", icon: "▲" },
  { key: "community", label: "Community", icon: "◆" },
  { key: "profile", label: "Profil", icon: "●" },
];

function TabBar({ tab, go, active, notifCount = 0 }) {
  const T = useT();
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center">
      <div className="w-full flex" style={{ maxWidth: 480, background: T.panel, borderTop: `1px solid ${T.line}`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {TABS.map((t) => {
          const on = tab === t.key || (t.key === "stats" && ["history", "detail"].includes(tab));
          const dot = t.key === "workout" && active;
          const badge = t.key === "community" && notifCount > 0;
          return (
            <button key={t.key} onClick={() => go(t.key)} className="flex-1 py-3 flex flex-col items-center gap-1 active:scale-95">
              <span className="text-sm relative" style={{ color: on ? PLATE.yellow : T.muted }}>
                {t.icon}
                {dot && <span style={{ position: "absolute", top: -2, right: -6, width: 6, height: 6, borderRadius: 9, background: PLATE.yellow }} />}
                {badge && (
                  <span className="rig-num" style={{
                    position: "absolute", top: -6, right: -10, fontSize: 9, minWidth: 14, height: 14, padding: "0 3px",
                    borderRadius: 9, background: PLATE.red, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{notifCount > 9 ? "9+" : notifCount}</span>
                )}
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
  const [weightLog, setWeightLog] = useState([]);
  const [custom, setCustom] = useState([]);
  const [prs, setPrs] = useState({});
  const [achievementsUnlocked, setAchievementsUnlocked] = useState({});
  const [streakData, setStreakData] = useState({ freezes: 1, frozenDays: [], grantedWeeks: 0 });
  const [photos, setPhotos] = useState([]);
  const [active, setActive] = useState(null);
  const [board, setBoard] = useState([]);
  const [social, setSocial] = useState({ friends: [], requests: [] });
  const [notifications, setNotifications] = useState([]);
  const [feed, setFeed] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [tab, setTab] = useState("home");
  const [detail, setDetail] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [pendingAddFriend, setPendingAddFriend] = useState(null);
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

  /* Freund per QR-Code hinzufügen: der Code kodiert einen Link mit ?add=<username>,
     jede Handykamera öffnet ihn systemweit – hier wird der Parameter einmal beim
     Laden ausgewertet und danach aus der URL entfernt. */
  useEffect(() => {
    if (!ready || !profile) return;
    const params = new URLSearchParams(window.location.search);
    const target = params.get("add");
    if (!target) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (target.toLowerCase() === profile.username.toLowerCase()) return;
    (async () => {
      const exists = await Cloud.usernameTaken(target).catch(() => false);
      if (exists) setPendingAddFriend(target);
      else toast({ kind: "error", msg: `Nutzer "${target}" wurde nicht gefunden.` });
    })();
  }, [ready, profile, toast]);

  /* Reiht Toasts strikt nacheinander, statt sich beim gleichzeitigen Auslösen
     mehrerer Effekte (z. B. Abzeichen + Streak-Schutz in derselben Ladung)
     gegenseitig zu überschreiben. */
  const toastQueueRef = useRef(Promise.resolve());
  const queueToast = useCallback((t) => {
    toastQueueRef.current = toastQueueRef.current.then(
      () => new Promise((resolve) => { toast(t); setTimeout(resolve, t.kind === "pr" ? 4200 : 2600); })
    );
  }, [toast]);

  const startCall = useCallback((room, label) => setCall({ room, label, me: profile?.username || "Gast" }), [profile]);

  /* --- Serie: aus den echten aktiven Tagen plus per Streak-Schutz überbrückten
     Tagen, wird an mehreren Stellen gebraucht (Home, Profil, Rangliste, Abzeichen). */
  const activeDaySet = useMemo(() => activeDays(workouts, runs, ropes), [workouts, runs, ropes]);
  const streak = useMemo(() => computeStreak(activeDaySet, streakData.frozenDays), [activeDaySet, streakData.frozenDays]);

  const MAX_STREAK_FREEZES = 2;
  /* Schützt automatisch genau einen verpassten Tag, wenn ein Streak-Schutz-Token
     vorhanden ist, und vergibt alle 7 Serientage ein neues Token (bis zum Maximum).
     Läuft bei jeder Änderung der aktiven Tage – ein bereits geschützter Tag wird
     dabei nie ein zweites Mal verbraucht. */
  useEffect(() => {
    if (!ready || !profile) return;
    const yesterday = dayKey(Date.now() - DAY);
    const dayBefore = dayKey(Date.now() - 2 * DAY);
    const frozenSet = new Set(streakData.frozenDays);
    const alreadyCoveredYesterday = activeDaySet.has(yesterday) || frozenSet.has(yesterday);
    const hadStreakBefore = activeDaySet.has(dayBefore) || frozenSet.has(dayBefore);

    let next = streakData;
    let usedFreeze = false, grantedFreeze = false;

    if (!alreadyCoveredYesterday && hadStreakBefore && streakData.freezes > 0) {
      next = { ...next, freezes: next.freezes - 1, frozenDays: [...next.frozenDays, yesterday] };
      usedFreeze = true;
    }

    const displayStreak = computeStreak(activeDaySet, next.frozenDays);
    const weeksEarned = Math.floor(displayStreak / 7);
    if (weeksEarned > next.grantedWeeks) {
      if (next.freezes < MAX_STREAK_FREEZES) { next = { ...next, freezes: next.freezes + 1 }; grantedFreeze = true; }
      next = { ...next, grantedWeeks: weeksEarned };
    }

    if (next === streakData) return;
    setStreakData(next);
    S.set(K.streak, next, false, owner);
    if (usedFreeze && grantedFreeze) {
      queueToast({ kind: "pr", title: "Serie geschützt & Schutz erneuert", msg: "🧊 Gestern nichts eingetragen – ein Streak-Schutz sprang ein, dafür gibt's als Belohnung fürs Durchhalten gleich einen neuen." });
    } else if (usedFreeze) {
      queueToast({ kind: "pr", title: "Serie geschützt", msg: "🧊 Gestern nichts eingetragen – ein Streak-Schutz wurde automatisch eingesetzt." });
    } else if (grantedFreeze) {
      queueToast({ kind: "pr", title: "Neuer Streak-Schutz", msg: "🧊 Für deine Serie gibt's einen Streak-Schutz dazu." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDaySet, ready, profile]);

  /* --- Abzeichen: reagiert auf jede Änderung an Workouts/Läufen/Seil/Rekorden,
     schaltet neu erreichte Meilensteine frei und zeigt sie kurz an. */
  const achievementStats = useMemo(() => {
    const agg = aggregate(workouts, runs, ropes);
    /* Summe aller je geloggten Wdh. pro Übungsname – Basis für die
       "insgesamt"-Abzeichen der Calisthenics-Übungen. */
    const exerciseTotals = {};
    for (const w of workouts) {
      for (const ex of w.exercises || []) {
        if (ex.type === "time") continue;
        const sum = (ex.sets || []).reduce((a, s) => a + (s.reps || 0), 0);
        exerciseTotals[ex.name] = (exerciseTotals[ex.name] || 0) + sum;
      }
    }
    return {
      workouts: workouts.length, runsCount: runs.length,
      streak,
      totalKm: agg.km, maxRunKm: runs.reduce((m, r) => Math.max(m, r.distanceKm || 0), 0),
      totalJumps: agg.jumps, totalReps: agg.reps, prCount: Object.keys(prs).length,
      prs, exerciseTotals, unlockedCount: Object.keys(achievementsUnlocked).length,
    };
  }, [workouts, runs, ropes, prs, streak, achievementsUnlocked]);

  useEffect(() => {
    if (!ready || !profile) return;
    const newly = ACHIEVEMENTS.filter((a) => !achievementsUnlocked[a.id] && a.check(achievementStats));
    if (!newly.length) return;
    const next = { ...achievementsUnlocked };
    newly.forEach((a) => { next[a.id] = Date.now(); });
    setAchievementsUnlocked(next);
    S.set(K.achievements, next, false, owner);
    queueToast({
      kind: "pr",
      title: newly.length === 1 ? "Abzeichen freigeschaltet" : `${newly.length} neue Abzeichen`,
      msg: newly.map((a) => `${a.icon} ${a.title}`).join(" · "),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achievementStats, ready, profile]);

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
      const [p, w, r, j, wt, c, pr, ach, sd, ph, a] = await Promise.all([
        Local.get(K.profile), Local.get(K.workouts), Local.get(K.runs), Local.get(K.ropes),
        Local.get(K.weight), Local.get(K.custom), Local.get(K.prs), Local.get(K.achievements), Local.get(K.streak),
        Local.get(K.photos), Local.get(K.active),
      ]);
      setProfile(p); setWorkouts(w || []); setRuns(r || []); setRopes(j || []); setWeightLog(wt || []);
      setCustom(c || []); setPrs(pr || {}); setAchievementsUnlocked(ach || {});
      setStreakData(sd || { freezes: 1, frozenDays: [], grantedWeeks: 0 }); setPhotos(ph || []); setActive(a || null);
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
      if (remote?.weight) { setWeightLog(remote.weight); Local.set(K.weight, remote.weight); }
      if (remote?.custom) { setCustom(remote.custom); Local.set(K.custom, remote.custom); }
      if (remote?.prs) { setPrs(remote.prs); Local.set(K.prs, remote.prs); }
      if (remote?.achievements) { setAchievementsUnlocked(remote.achievements); Local.set(K.achievements, remote.achievements); }
      if (remote?.streak) { setStreakData(remote.streak); Local.set(K.streak, remote.streak); }
      if (remote?.photos) { setPhotos(remote.photos); Local.set(K.photos, remote.photos); }
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
    setRopes(data.ropes || []); setWeightLog(data.weight || []); setCustom(data.custom || []); setPrs(data.prs || {});
    setAchievementsUnlocked(data.achievements || {});
    setStreakData(data.streak || { freezes: 1, frozenDays: [], grantedWeeks: 0 });
    setPhotos(data.photos || []);
    setSocial(data.social || { friends: [], requests: [] });
    await Promise.all([
      Local.set(K.profile, data.profile), Local.set(K.workouts, data.workouts || []),
      Local.set(K.runs, data.runs || []), Local.set(K.ropes, data.ropes || []), Local.set(K.weight, data.weight || []),
      Local.set(K.custom, data.custom || []), Local.set(K.prs, data.prs || {}), Local.set(K.achievements, data.achievements || {}),
      Local.set(K.streak, data.streak || { freezes: 1, frozenDays: [], grantedWeeks: 0 }), Local.set(K.photos, data.photos || []),
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
    await S.set(K.board(p.username), buildBoardEntry(p, w, r, j, streakData.frozenDays), true);
  }, [profile, workouts, runs, ropes, streakData.frozenDays]);

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

  /* --- Gewichtsverlauf: ein Eintrag pro Tag, überschreibt einen bestehenden vom selben Tag --- */
  const addWeightEntry = async (weightKg, date = Date.now()) => {
    const day = dayKey(date);
    const next = [{ id: uid(), date, weightKg }, ...weightLog.filter((w) => dayKey(w.date) !== day)]
      .sort((a, b) => b.date - a.date);
    setWeightLog(next);
    await S.set(K.weight, next, false, owner);
    await patchProfile({ weightKg });
    toast({ msg: `Gewicht gespeichert · ${nf(weightKg, 1)} kg` });
  };
  const deleteWeightEntry = async (id) => {
    const next = weightLog.filter((w) => w.id !== id);
    setWeightLog(next);
    await S.set(K.weight, next, false, owner);
  };

  /* --- Fortschrittsfotos: ein Foto pro Tag, überschreibt eins vom selben Tag,
     auf 100 begrenzt, damit die Zeile nicht unbegrenzt wächst. */
  const addProgressPhoto = async (image, note, date = Date.now()) => {
    const day = dayKey(date);
    const next = [{ id: uid(), date, image, note: note || "" }, ...photos.filter((p) => dayKey(p.date) !== day)]
      .sort((a, b) => b.date - a.date).slice(0, 100);
    setPhotos(next);
    await S.set(K.photos, next, false, owner);
    toast({ msg: "Foto gespeichert." });
  };
  const deleteProgressPhoto = async (id) => {
    const next = photos.filter((p) => p.id !== id);
    setPhotos(next);
    await S.set(K.photos, next, false, owner);
  };

  /* --- Social --- */
  const sendRequest = async (target) => {
    const key = K.social(target);
    const cur = (await S.get(key, true)) || { friends: [], requests: [] };
    if (cur.friends.includes(profile.username)) return toast({ msg: "Ihr seid schon befreundet." });
    if (cur.requests.includes(profile.username)) return toast({ msg: "Anfrage läuft schon." });
    cur.requests = [...cur.requests, profile.username];
    await S.set(key, cur, true);
    await pushNotification(target, { type: "friend_request", from: profile.username, text: `${profile.username} möchte mit dir befreundet sein.` });
    toast({ msg: `Anfrage an ${target} ist raus.` });
  };
  const acceptRequest = async (from) => {
    const mine = { friends: [...new Set([...(social.friends || []), from])], requests: (social.requests || []).filter((r) => r !== from) };
    setSocial(mine); await S.set(K.social(profile.username), mine, true);
    const theirs = (await S.get(K.social(from), true)) || { friends: [], requests: [] };
    theirs.friends = [...new Set([...theirs.friends, profile.username])];
    await S.set(K.social(from), theirs, true);
    await pushNotification(from, { type: "friend_accept", from: profile.username, text: `${profile.username} hat deine Anfrage angenommen.` });
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

  /* --- Benachrichtigungen --- */
  const refreshNotifications = useCallback(async () => {
    if (!profile) return;
    const cur = await S.get(K.notif(profile.username), true);
    setNotifications((cur && cur.items) || []);
  }, [profile]);

  const markNotificationsRead = async () => {
    if (!profile || !notifications.some((n) => !n.read)) return;
    const items = notifications.map((n) => ({ ...n, read: true }));
    setNotifications(items);
    await S.set(K.notif(profile.username), { items }, true);
  };

  /* Alle paar Sekunden pollen statt Echtzeit – ohne eigenen Realtime-Server
     reicht das für Freundschaftsanfragen und Chat-Nachrichten locker aus. */
  useEffect(() => {
    if (!profile) return;
    refreshNotifications();
    const id = setInterval(refreshNotifications, 25000);
    return () => clearInterval(id);
  }, [profile, refreshNotifications]);

  /* --- Chat (1:1, nur unter Freunden) --- */
  const sendMessage = async (friend, text) => {
    const t = text.trim();
    if (!t || !profile) return null;
    const key = K.chat(profile.username, friend);
    const cur = (await S.get(key, true)) || { messages: [] };
    const msg = { id: uid(), from: profile.username, text: t.slice(0, 500), createdAt: Date.now() };
    const messages = [...(cur.messages || []), msg].slice(-200);
    await S.set(key, { messages }, true);
    await pushNotification(friend, { type: "chat", from: profile.username, text: t.slice(0, 80) });
    return messages;
  };
  const loadChat = async (friend) => {
    if (!profile) return [];
    const cur = await S.get(K.chat(profile.username, friend), true);
    return (cur && cur.messages) || [];
  };

  /* --- Community-Feed (Fotos, Fortschritt, Text) --- */
  const addPost = async (text, image, activity) => {
    if (!profile) return;
    const key = K.feed(profile.username);
    const cur = (await S.get(key, true)) || { posts: [] };
    const post = {
      id: uid(), authorUsername: profile.username, authorEmoji: profile.emoji, authorAvatarUrl: profile.avatarUrl || null,
      text: (text || "").trim().slice(0, 500), image: image || null, activity: activity || null, createdAt: Date.now(), likes: [],
    };
    const posts = [post, ...(cur.posts || [])].slice(0, 30);
    await S.set(key, { posts }, true);
    await refreshFeed();
    toast({ msg: "Beitrag gepostet." });
  };
  const deletePost = async (postId) => {
    if (!profile) return;
    const key = K.feed(profile.username);
    const cur = (await S.get(key, true)) || { posts: [] };
    const posts = (cur.posts || []).filter((p) => p.id !== postId);
    await S.set(key, { posts }, true);
    await refreshFeed();
  };
  const toggleLike = async (authorUsername, postId) => {
    if (!profile) return;
    const key = K.feed(authorUsername);
    const cur = (await S.get(key, true)) || { posts: [] };
    const posts = (cur.posts || []).map((p) => {
      if (p.id !== postId) return p;
      const has = (p.likes || []).includes(profile.username);
      return { ...p, likes: has ? p.likes.filter((u) => u !== profile.username) : [...(p.likes || []), profile.username] };
    });
    await S.set(key, { posts }, true);
    await refreshFeed();
  };
  const refreshFeed = useCallback(async () => {
    const keys = await S.keys("feed:", true);
    const all = [];
    for (const k of keys.slice(0, 200)) {
      const e = await S.get(k, true);
      if (e?.posts) all.push(...e.posts);
    }
    all.sort((a, b) => b.createdAt - a.createdAt);
    setFeed(all.slice(0, 100));
  }, []);

  /* --- Challenges: 1:1-Duell mit einem Freund über 7 Tage --- */
  const startChallenge = async (friend, metric) => {
    if (!profile) return;
    const id = uid();
    const now = Date.now();
    const doc = {
      id, metric, createdBy: profile.username, opponent: friend, createdAt: now, endsAt: now + 7 * DAY,
      status: "pending", values: { [profile.username]: 0, [friend]: 0 },
    };
    await S.set(K.challenge(id), doc, true);
    const mine = (await S.get(K.challengeList(profile.username), true)) || [];
    await S.set(K.challengeList(profile.username), [id, ...mine], true);
    const theirs = (await S.get(K.challengeList(friend), true)) || [];
    await S.set(K.challengeList(friend), [id, ...theirs], true);
    const m = CHALLENGE_METRICS.find((x) => x.value === metric);
    await pushNotification(friend, { type: "challenge", from: profile.username, text: `${profile.username} fordert dich heraus: ${m.label} diese Woche!` });
    toast({ msg: `Challenge an ${friend} ist raus.` });
    await refreshChallenges();
  };

  const respondChallenge = async (id, accept) => {
    const doc = await S.get(K.challenge(id), true);
    if (!doc) return;
    doc.status = accept ? "active" : "declined";
    await S.set(K.challenge(id), doc, true);
    if (accept) {
      await pushNotification(doc.createdBy, { type: "challenge", from: profile.username, text: `${profile.username} hat deine Challenge angenommen!` });
      toast({ msg: "Challenge angenommen." });
    } else {
      toast({ msg: "Challenge abgelehnt." });
    }
    await refreshChallenges();
  };

  const refreshChallenges = useCallback(async () => {
    if (!profile) return;
    const ids = (await S.get(K.challengeList(profile.username), true)) || [];
    const docs = [];
    for (const id of ids.slice(0, 50)) {
      const doc = await S.get(K.challenge(id), true);
      if (!doc) continue;
      if (doc.status === "active") {
        const end = Math.min(Date.now(), doc.endsAt);
        const myVal = computeMetricInRange(workouts, runs, ropes, doc.metric, doc.createdAt, end);
        if (doc.values[profile.username] !== myVal) {
          doc.values = { ...doc.values, [profile.username]: myVal };
          await S.set(K.challenge(id), doc, true);
        }
      }
      docs.push(doc);
    }
    docs.sort((a, b) => b.createdAt - a.createdAt);
    setChallenges(docs);
  }, [profile, workouts, runs, ropes]);

  /* --- Export / Reset --- */
  const exportData = () => {
    try {
      const blob = new Blob([JSON.stringify({ profile, workouts, runs, ropes, weightLog, prs, custom, exportedAt: new Date().toISOString() }, null, 2)],
        { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `stradaa-${dayKey(Date.now())}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ msg: "Export als JSON-Datei gestartet." });
    } catch {
      toast({ kind: "error", msg: "Der Download ließ sich hier nicht starten." });
    }
  };
  const resetAll = async () => {
    const freshStreak = { freezes: 1, frozenDays: [], grantedWeeks: 0 };
    setWorkouts([]); setRuns([]); setRopes([]); setWeightLog([]); setPrs({}); setStreakData(freshStreak); setPhotos([]); setActive(null);
    await Promise.all([
      S.set(K.workouts, [], false, owner), S.set(K.runs, [], false, owner), S.set(K.ropes, [], false, owner),
      S.set(K.weight, [], false, owner), S.set(K.prs, {}, false, owner), S.set(K.streak, freshStreak, false, owner),
      S.set(K.photos, [], false, owner), S.set(K.active, null, false, owner),
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
    profile, workouts, runs, ropes, weightLog, prs, achievementsUnlocked, achievementStats, streak, streakData, photos, active, exercises, board, social, owner,
    setActive, go, toast, patchProfile, startWorkout, repeatWorkout, finishWorkout, discardWorkout,
    deleteWorkout, addRun, deleteRun, addRope, deleteRope, addWeightEntry, deleteWeightEntry, addProgressPhoto, deleteProgressPhoto, addCustomExercise,
    refreshBoard, sendRequest, acceptRequest, declineRequest, removeFriend, exportData, resetAll,
    notifications, refreshNotifications, markNotificationsRead, sendMessage, loadChat,
    feed, refreshFeed, addPost, deletePost, toggleLike,
    challenges, refreshChallenges, startChallenge, respondChallenge,
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
              {tab === "community" && <CommunityScreen ctx={ctx} />}
              {tab === "profile" && <ProfileScreen ctx={ctx} />}
              {tab === "run" && <RunScreen ctx={ctx} />}
              {tab === "rope" && <RopeScreen ctx={ctx} />}
              {tab === "history" && <HistoryScreen ctx={ctx} />}
              {tab === "detail" && detail && <WorkoutDetail ctx={ctx} workout={detail} />}
              <TabBar tab={tab} go={go} active={!!active} notifCount={notifications.filter((n) => !n.read).length} />
            </>
          )}
          <CallSheet call={call} onClose={() => setCall(null)} />
          {profile && (
            <Sheet open={!!pendingAddFriend} onClose={() => setPendingAddFriend(null)} title="Freund hinzufügen">
              <div className="text-sm mb-5" style={{ color: T.text }}>
                Freundschaftsanfrage an <b>{pendingAddFriend}</b> senden?
              </div>
              <div className="flex gap-2">
                <Btn variant="ghost" className="flex-1" onClick={() => setPendingAddFriend(null)}>Abbrechen</Btn>
                <Btn className="flex-1" onClick={async () => { await sendRequest(pendingAddFriend); setPendingAddFriend(null); }}>Anfrage senden</Btn>
              </div>
            </Sheet>
          )}
          <Toast toast={toastMsg} />
        </div>
      </div>
      </CallCtx.Provider>
    </ThemeCtx.Provider>
  );
}
