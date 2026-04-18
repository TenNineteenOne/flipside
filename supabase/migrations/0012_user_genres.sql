-- Phase 4: Add selected_genres to support genre-picker onboarding path
alter table users add column if not exists selected_genres text[] default '{}';
