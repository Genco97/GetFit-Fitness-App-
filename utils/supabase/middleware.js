import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { supabaseUrl, supabaseKey } from "./config.js";

export async function updateSession(request) {
  let supabaseResponse = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
      },
    },
  });

  // Wichtig: getUser() ruft den Auth-Server ab und aktualisiert den Session-Cookie,
  // bevor er abläuft. Nur getSession() zu nutzen würde stille Session-Ausfälle riskieren.
  await supabase.auth.getUser();

  return supabaseResponse;
}
