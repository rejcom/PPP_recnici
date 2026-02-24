// Sdílená Supabase konfigurace pro API endpointy
import { createClient } from '@supabase/supabase-js';

const CORRECT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxbmh2ZHlhb2h6bmxheGFpbGZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NTE4ODcsImV4cCI6MjA4NzQyNzg4N30.Or-wwAE31LO-fcV38dzQcTHZXcW6MhCHEGvc3pFkKfE';

export function getSupabaseUrl() {
    return (process.env.SUPABASE_URL || 'https://wqnhvdyaohznlaxailfd.supabase.co').trim();
}

export function getSupabaseAnonKey() {
    const envKey = (process.env.SUPABASE_ANON_KEY || '').trim();
    return envKey.startsWith('eyJ') ? envKey : CORRECT_ANON_KEY;
}

export function getSupabase(authHeader) {
    return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
        global: {
            headers: authHeader ? { Authorization: authHeader } : {}
        }
    });
}
