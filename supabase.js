/**
 * supabase.js — Supabase Client Setup (Optional Cloud Storage)
 * Safely initializes Supabase client when available without crashing if offline or unconfigured.
 */

"use strict";

const SUPABASE_URL = "https://ypdajfdyytjfvjeaxnyq.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwZGFqZmR5eXRqZnZqZWF4bnlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MDg0ODUsImV4cCI6MjA4OTE4NDQ4NX0.CoxLqQOccH4d7TTnL4O0DB52Y-gBUrGdgzNLsWwO9DI";

window.getSupabaseClient = function () {
  try {
    if (
      window.supabase &&
      typeof window.supabase.createClient === "function" &&
      SUPABASE_URL &&
      SUPABASE_KEY &&
      SUPABASE_URL.startsWith("https://")
    ) {
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
    }
  } catch (err) {
    console.warn("Supabase client initialization skipped:", err);
  }
  return null;
};
