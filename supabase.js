const SUPABASE_URL = "https://orwyzyxufctmketnoauh.supabase.co/rest/v1/";
const SUPABASE_PUBLIC_KEY = "sb_publishable_Ma9-SMG9XJ0X7XX9fiiU2Q_g-ILdgC9";

if (!window.supabase) {
  throw new Error("Supabase library did not load. Check your internet connection.");
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
