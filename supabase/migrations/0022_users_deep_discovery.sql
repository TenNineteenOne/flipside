-- Deep discovery toggle: when ON, the engine walks 2nd-hop from each seed's
-- lowest-match similars, yielding more obscure picks at the cost of some
-- genre drift. Default OFF so existing users see no behavior change.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deep_discovery BOOLEAN NOT NULL DEFAULT false;
