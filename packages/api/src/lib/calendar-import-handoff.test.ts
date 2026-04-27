import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarImportHandoffError,
  claimCalendarImportHandoff,
  createCalendarImportHandoff,
} from './calendar-import-handoff.js';

describe('calendar import handoff', () => {
  beforeEach(() => {
    process.env.DOMAIN_CLIENT = 'https://coke.example';
  });

  it('creates a short-lived tokenized handoff link without exposing the token hash', async () => {
    const db = {
      calendarImportHandoffSession: {
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'hnd_1', ...data })),
      },
    };

    const result = await createCalendarImportHandoff(db as never, {
      sourceCustomerId: 'ck_whatsapp',
      tenantId: 'tnt_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalId: '8617807028761',
      gatewayConversationId: 'gw_1',
      businessConversationKey: 'bc_1',
    });

    expect(result.url).toMatch(/^https:\/\/coke\.example\/handoff\/calendar-import\?token=.+/);
    expect(result.token).toBeTruthy();
    expect(db.calendarImportHandoffSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: expect.any(String),
        sourceCustomerId: 'ck_whatsapp',
        provider: 'whatsapp_evolution',
        identityType: 'wa_id',
        identityValue: '8617807028761',
        status: 'pending',
      }),
    });
    expect(db.calendarImportHandoffSession.create.mock.calls[0][0].data.tokenHash).not.toBe(
      result.token,
    );
  });

  it('claims an unowned whatsapp identity for the active email customer', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const session = {
      id: 'hnd_1',
      status: 'pending',
      expiresAt,
      sourceCustomerId: 'ck_whatsapp',
      targetCustomerId: null,
      targetIdentityId: null,
      provider: 'whatsapp_evolution',
      identityType: 'wa_id',
      identityValue: '8617807028761',
      tenantId: 'tnt_1',
      channelId: 'ch_1',
      endUserId: 'eu_1',
      externalId: '8617807028761',
      gatewayConversationId: 'gw_1',
      businessConversationKey: 'bc_1',
    };
    const tx = {
      calendarImportHandoffSession: {
        findUnique: vi.fn().mockResolvedValue(session),
        update: vi.fn().mockResolvedValue({ ...session, status: 'claimed' }),
      },
      membership: {
        findFirst: vi.fn().mockResolvedValue({
          customerId: 'ck_email',
          identityId: 'idt_email',
          role: 'owner',
          identity: { claimStatus: 'active' },
        }),
      },
      externalIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ext_1',
          customerId: 'ck_whatsapp',
        }),
        update: vi.fn().mockResolvedValue({ id: 'ext_1', customerId: 'ck_email' }),
      },
    };
    const db = {
      $transaction: vi.fn((fn) => fn(tx)),
    };

    const result = await claimCalendarImportHandoff(db as never, {
      token: 'tok_1',
      customerId: 'ck_email',
      identityId: 'idt_email',
    });

    expect(result.session.status).toBe('claimed');
    expect(tx.externalIdentity.update).toHaveBeenCalledWith({
      where: { id: 'ext_1' },
      data: { customerId: 'ck_email' },
    });
    expect(tx.calendarImportHandoffSession.update).toHaveBeenCalledWith({
      where: { id: 'hnd_1' },
      data: expect.objectContaining({
        status: 'claimed',
        targetCustomerId: 'ck_email',
        targetIdentityId: 'idt_email',
      }),
    });
  });

  it('blocks a handoff when the whatsapp identity already belongs to another active account', async () => {
    const session = {
      id: 'hnd_1',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
      sourceCustomerId: 'ck_whatsapp',
      provider: 'whatsapp_evolution',
      identityType: 'wa_id',
      identityValue: '8617807028761',
    };
    const tx = {
      calendarImportHandoffSession: {
        findUnique: vi.fn().mockResolvedValue(session),
      },
      membership: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            customerId: 'ck_email',
            identityId: 'idt_email',
            role: 'owner',
            identity: { claimStatus: 'active' },
          })
          .mockResolvedValueOnce({
            customerId: 'ck_other',
            identityId: 'idt_other',
            role: 'owner',
            identity: { claimStatus: 'active' },
          }),
      },
      externalIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ext_1',
          customerId: 'ck_other',
        }),
      },
    };
    const db = {
      $transaction: vi.fn((fn) => fn(tx)),
    };

    await expect(
      claimCalendarImportHandoff(db as never, {
        token: 'tok_1',
        customerId: 'ck_email',
        identityId: 'idt_email',
      }),
    ).rejects.toEqual(new CalendarImportHandoffError('identity_already_bound'));
  });
});
