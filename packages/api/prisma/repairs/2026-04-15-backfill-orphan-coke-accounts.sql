-- Backfill missing coke_accounts rows for existing clawscale_users orphans.
--
-- Why this exists:
-- - Older clawscale_users rows could be created before the gateway enforced
--   coke_accounts existence.
-- - Startup now runs `npx prisma db push --skip-generate`, which tries to
--   enforce `clawscale_users.coke_account_id -> coke_accounts.id`.
-- - Deleting orphan clawscale_users is unsafe when downstream channels,
--   end_users, conversations, or delivery_routes still depend on them.
--
-- Safety properties:
-- - idempotent: reruns are safe via `ON CONFLICT (id) DO NOTHING`
-- - transactional: either all placeholder parents are inserted or none are
-- - preserves existing identifiers and dependent graph shape
--
-- Placeholder accounts are intentionally inert:
-- - email uses the reserved `.invalid` TLD
-- - status is `suspended`
-- - email_verified is `false`
-- - password hash is a valid bcrypt hash, but login remains blocked by status

BEGIN;

-- Snapshot the orphan set before repair, including dependency counts.
WITH orphaned AS (
  SELECT
    cu.id AS clawscale_user_id,
    cu.tenant_id,
    cu.coke_account_id,
    cu.created_at,
    (
      SELECT COUNT(*)
      FROM channels ch
      WHERE ch.owner_clawscale_user_id = cu.id
    ) AS channel_count,
    (
      SELECT COUNT(*)
      FROM end_users eu
      WHERE eu.clawscale_user_id = cu.id
    ) AS end_user_count,
    (
      SELECT COUNT(*)
      FROM conversations conv
      WHERE conv.clawscale_user_id = cu.id
    ) AS conversation_count,
    (
      SELECT COUNT(*)
      FROM delivery_routes dr
      WHERE dr.coke_account_id = cu.coke_account_id
    ) AS delivery_route_count
  FROM clawscale_users cu
  LEFT JOIN coke_accounts ca
    ON ca.id = cu.coke_account_id
  WHERE ca.id IS NULL
)
SELECT *
FROM orphaned
ORDER BY created_at, clawscale_user_id;

-- Insert inert parent rows so Prisma can enforce the FK without deleting data.
WITH orphaned AS (
  SELECT
    cu.tenant_id,
    cu.coke_account_id
  FROM clawscale_users cu
  LEFT JOIN coke_accounts ca
    ON ca.id = cu.coke_account_id
  WHERE ca.id IS NULL
),
inserted AS (
  INSERT INTO coke_accounts (
    id,
    email,
    password_hash,
    display_name,
    email_verified,
    status,
    created_at,
    updated_at
  )
  SELECT
    orphaned.coke_account_id,
    lower(orphaned.coke_account_id || '@recovered.coke.invalid'),
    '$2a$10$7EqJtq98hPqEX7fNZaFWoO.jhN9xjWgY0FsL6t1Q9q4CPGK/cHBXG',
    left('[Recovered] ' || COALESCE(NULLIF(t.name, ''), orphaned.coke_account_id), 120),
    FALSE,
    'suspended',
    NOW(),
    NOW()
  FROM orphaned
  JOIN tenants t
    ON t.id = orphaned.tenant_id
  ON CONFLICT (id) DO NOTHING
  RETURNING id, email, display_name, email_verified, status
)
SELECT *
FROM inserted
ORDER BY id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM clawscale_users cu
    LEFT JOIN coke_accounts ca
      ON ca.id = cu.coke_account_id
    WHERE ca.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphan clawscale_users remain after repair';
  END IF;
END
$$;

COMMIT;
