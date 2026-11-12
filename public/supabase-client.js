import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';
export const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
