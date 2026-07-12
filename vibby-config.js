/* ============================================================
   VIBBY CONFIG — connecté au projet Supabase réel "vibby".
   ============================================================
   Ce fichier pointe déjà vers ton projet Supabase
   (dbsoqpiyfcehqttsggyt) — schéma déployé, clé publishable en
   place. Rien à faire pour l'authentification par courriel/mdp,
   elle est déjà active.

   Pour activer Google plus tard : Supabase Dashboard →
   Authentication → Providers → Google → active-le et fournis un
   Client ID / Client Secret Google OAuth (console.cloud.google.com),
   puis repasse GOOGLE_ENABLED à true ci-dessous.

   La clé "publishable" est conçue pour être visible dans le code
   client — ce n'est pas un secret, la vraie protection vient des
   règles RLS définies dans vibby-supabase-schema.sql.
   ============================================================ */

window.VIBBY_CONFIG = {
  SUPABASE_URL: "https://dbsoqpiyfcehqttsggyt.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_QI4K0A3T500ogQi0qkV3hw_vroiqlRb",
  GOOGLE_ENABLED: false,  // Google pas encore configuré dans Supabase — voir note ci-dessus
};
