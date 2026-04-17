import { Prisma } from '@prisma/client';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/index.js';
import { hashAdminPassword, normalizeAdminEmail } from '../lib/admin-auth.js';
import { requireAdminAuth } from '../middleware/admin-auth.js';

const createAdminSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const adminSelect = {
  id: true,
  email: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const DELETE_ADMIN_MAX_ATTEMPTS = 2;

class AdminDeleteGuardError extends Error {
  constructor(
    public readonly code:
      | 'admin_not_found'
      | 'cannot_delete_last_active_admin',
  ) {
    super(code);
    this.name = 'AdminDeleteGuardError';
  }
}

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

export const adminAdminsRouter = new Hono()
  .use('*', requireAdminAuth)
  .get('/', async (c) => {
    const rows = await db.adminAccount.findMany({
      select: adminSelect,
      orderBy: { createdAt: 'asc' },
    });

    return c.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        email: row.email,
        isActive: row.isActive,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    });
  })
  .post('/', zValidator('json', createAdminSchema), async (c) => {
    const body = c.req.valid('json');

    try {
      const created = await db.adminAccount.create({
        data: {
          email: normalizeAdminEmail(body.email),
          passwordHash: await hashAdminPassword(body.password),
          isActive: true,
        },
        select: adminSelect,
      });

      return c.json(
        {
          ok: true,
          data: {
            id: created.id,
            email: created.email,
            isActive: created.isActive,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
          },
        },
        201,
      );
    } catch (error) {
      if (isPrismaErrorCode(error, 'P2002')) {
        return c.json({ ok: false, error: 'email_already_exists' }, 409);
      }

      throw error;
    }
  })
  .delete('/:id', async (c) => {
    const actor = c.get('adminAuth');
    const id = c.req.param('id');

    if (id === actor.adminId) {
      return c.json({ ok: false, error: 'cannot_delete_self' }, 422);
    }

    for (let attempt = 1; attempt <= DELETE_ADMIN_MAX_ATTEMPTS; attempt += 1) {
      try {
        const deleted = await db.$transaction(
          async (tx) => {
            const target = await tx.adminAccount.findUnique({
              where: {
                id,
              },
              select: {
                id: true,
                isActive: true,
              },
            });

            if (!target) {
              throw new AdminDeleteGuardError('admin_not_found');
            }

            if (target.isActive) {
              const activeAdminCount = await tx.adminAccount.count({
                where: {
                  isActive: true,
                },
              });

              if (activeAdminCount <= 1) {
                throw new AdminDeleteGuardError('cannot_delete_last_active_admin');
              }
            }

            return tx.adminAccount.delete({
              where: {
                id,
              },
            });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        return c.json({
          ok: true,
          data: {
            id: deleted.id,
          },
        });
      } catch (error) {
        if (error instanceof AdminDeleteGuardError) {
          if (error.code === 'admin_not_found') {
            return c.json({ ok: false, error: error.code }, 404);
          }

          return c.json({ ok: false, error: error.code }, 422);
        }

        if (isPrismaErrorCode(error, 'P2034') && attempt < DELETE_ADMIN_MAX_ATTEMPTS) {
          continue;
        }

        if (isPrismaErrorCode(error, 'P2034')) {
          return c.json({ ok: false, error: 'delete_conflict' }, 409);
        }

        if (isPrismaErrorCode(error, 'P2025')) {
          return c.json({ ok: false, error: 'admin_not_found' }, 404);
        }

        throw error;
      }
    }

    return c.json({ ok: false, error: 'delete_conflict' }, 409);
  });
