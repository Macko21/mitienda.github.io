// ===============================
// CONFIGURACIÓN SUPABASE
// ===============================
// Reemplaza firebase-config.js — borrá o no incluyas firebase-config.js

const SUPABASE_URL = 'https://epyvqofipplljgpphsdb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GzNSDZjGu-57xI0G8x_6eA_rehy0g7A';

// Cliente Supabase global
window._supabase = null;

async function inicializarSupabase() {
  // Cargar SDK de Supabase si no está cargado
  if (!window.supabase) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase configurado correctamente');
  return window._supabase;
}

window._supabaseReady = inicializarSupabase();
