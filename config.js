// Configuración de la app.
// - Si dejás SUPABASE_URL y SUPABASE_ANON_KEY vacíos, la app guarda los datos en este navegador (localStorage).
// - Si los completás, pide login (email + contraseña) y guarda todo en tu base de Supabase.
//   La anon key es pública por diseño; la seguridad la da la política RLS de supabase.sql.
window.APP_CONFIG = {
  SUPABASE_URL: "https://gebxenbehwtmyrajoevr.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlYnhlbmJlaHd0bXlyYWpvZXZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjM0MjAsImV4cCI6MjEwNzEzOTQyMH0.a0viDPJAKtxWbGDwAJXEkLqoMv-1YTWBnR9vjCA79mo",
};
