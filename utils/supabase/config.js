/* Fallback für Vorschau-Umgebungen (z. B. StackBlitz), die .env-Dateien beim
   GitHub-Import ausblenden. Die Werte sind ohnehin öffentlich (Publishable
   Key, RLS-geschützt) – siehe Profil → Cloud-Datenbank in der App. Wer eine
   eigene .env.local setzt, überschreibt diese Defaults automatisch. */
const FALLBACK_URL = "https://cckmphfsfkqttrggjzgv.supabase.co";
const FALLBACK_KEY = "sb_publishable_Obv6-eHZoh2Hxg_itJ69-g_jPzH1Ny8";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;
export const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || FALLBACK_KEY;
