-- ============================================================
-- VIBBY — Schéma Supabase
-- ============================================================
-- Où l'exécuter : Supabase Dashboard → ton projet → SQL Editor →
-- "New query" → colle tout ce fichier → Run.
--
-- Ce script crée :
--   1) la table "projects"  (les sites générés par chaque utilisateur)
--   2) la table "events"    (visites / ajouts au panier / paiements —
--                            envoyés en direct par les sites déployés)
--   3) les règles de sécurité (RLS) : chacun ne voit QUE ses propres
--      projets et ses propres statistiques. Les visiteurs anonymes de
--      tes sites générés peuvent seulement AJOUTER des évènements
--      (jamais les lire).
-- ============================================================

-- 1) PROJECTS -------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Site sans nom',
  html_original text,
  html_generated text,
  options jsonb default '{}'::jsonb,
  products jsonb default '[]'::jsonb,
  pub_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

drop policy if exists "select own projects" on public.projects;
create policy "select own projects" on public.projects
  for select using (auth.uid() = user_id);

drop policy if exists "insert own projects" on public.projects;
create policy "insert own projects" on public.projects
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own projects" on public.projects;
create policy "update own projects" on public.projects
  for update using (auth.uid() = user_id);

drop policy if exists "delete own projects" on public.projects;
create policy "delete own projects" on public.projects
  for delete using (auth.uid() = user_id);

-- keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- 2) EVENTS -----------------------------------------------------
-- Une ligne par visite / ajout au panier / paiement lancé, envoyée
-- en direct depuis chaque site généré par Vibby (peu importe qui
-- l'héberge — Netlify, GitHub Pages, etc.)
create table if not exists public.events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null check (type in ('view', 'add_to_cart', 'checkout')),
  payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_project_id on public.events(project_id);
create index if not exists idx_events_created_at on public.events(created_at);

alter table public.events enable row level security;

-- Les visiteurs anonymes des sites générés peuvent SEULEMENT
-- insérer des évènements (jamais les lire ni les modifier).
drop policy if exists "anon can insert events" on public.events;
create policy "anon can insert events" on public.events
  for insert
  with check (true);

-- Le propriétaire du site peut voir SES statistiques uniquement.
drop policy if exists "owner can read own events" on public.events;
create policy "owner can read own events" on public.events
  for select using (
    exists (
      select 1 from public.projects
      where projects.id = events.project_id
      and projects.user_id = auth.uid()
    )
  );

-- Active le temps réel sur "events" pour que le tableau de bord se
-- mette à jour tout seul dès qu'une visite/vente arrive (sans
-- rafraîchir la page). Si cette ligne échoue avec "already a member",
-- c'est déjà activé — ignore l'erreur.
alter publication supabase_realtime add table public.events;

-- ============================================================
-- Ensuite, active la connexion Google (optionnel mais recommandé) :
-- Supabase Dashboard → Authentication → Providers → Google → Enable
-- Tu auras besoin d'un Client ID / Client Secret Google OAuth,
-- créés gratuitement sur https://console.cloud.google.com/apis/credentials
-- (Type d'identifiant : "OAuth client ID" → "Web application").
-- Ajoute comme "Authorized redirect URI" l'URL fournie par Supabase
-- sur cet écran (ex: https://xxxx.supabase.co/auth/v1/callback).
--
-- Active aussi "Confirm email" dans Authentication → Settings si tu
-- veux exiger la confirmation par courriel avant la première connexion.
-- ============================================================
