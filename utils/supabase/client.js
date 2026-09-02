import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl, supabaseKey } from "./config.js";

export const createClient = () => createBrowserClient(supabaseUrl, supabaseKey);
