import { updateSession } from "./utils/supabase/middleware";

export async function middleware(request) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Auf alle Pfade anwenden außer:
     * - _next/static, _next/image (Next.js-interne Assets)
     * - favicon.ico
     * - Bild-/Font-Dateien
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
