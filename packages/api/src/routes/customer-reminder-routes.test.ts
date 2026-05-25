import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyCustomerToken: vi.fn(),
  getCustomerSession: vi.fn(),
  listRuntimeReminders: vi.fn(),
  createRuntimeReminder: vi.fn(),
  updateRuntimeReminder: vi.fn(),
  completeRuntimeReminder: vi.fn(),
  cancelRuntimeReminder: vi.fn(),
}));

vi.mock('../db/index.js', () => ({ db: {} }));
vi.mock('../lib/customer-auth.js', () => ({
  verifyCustomerToken: mocks.verifyCustomerToken,
  getCustomerSession: mocks.getCustomerSession,
}));
vi.mock('../lib/reminder-runtime-client.js', () => ({
  listRuntimeReminders: mocks.listRuntimeReminders,
  createRuntimeReminder: mocks.createRuntimeReminder,
  updateRuntimeReminder: mocks.updateRuntimeReminder,
  completeRuntimeReminder: mocks.completeRuntimeReminder,
  cancelRuntimeReminder: mocks.cancelRuntimeReminder,
}));

import { customerReminderRouter } from './customer-reminder-routes.js';

function createApp(): Hono {
  const app = new Hono();
  app.route('/api/customer/reminders', customerReminderRouter);
  return app;
}

describe('customer reminder routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyCustomerToken.mockReturnValue({
      sub: 'ck_123',
      identityId: 'idt_123',
      tokenType: 'access',
    });
    mocks.getCustomerSession.mockResolvedValue({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'active',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });
    mocks.listRuntimeReminders.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rem-1',
          title: 'Standup',
          schedule: {
            localDate: '2026-05-13',
            localTime: '09:30:00',
            timezone: 'Asia/Tokyo',
            rrule: 'FREQ=WEEKLY',
            durationMinutes: 60,
          },
          lifecycleState: 'active',
        },
      ],
    });
    mocks.createRuntimeReminder.mockResolvedValue({ ok: true, data: { id: 'rem-1' } });
    mocks.updateRuntimeReminder.mockResolvedValue({ ok: true, data: { id: 'rem-1' } });
    mocks.completeRuntimeReminder.mockResolvedValue({ ok: true, data: { id: 'rem-1' } });
    mocks.cancelRuntimeReminder.mockResolvedValue({ ok: true, data: { id: 'rem-1' } });
  });

  it('rejects unauthenticated list requests', async () => {
    const res = await createApp().request(
      '/api/customer/reminders?from=2026-05-13&to=2026-05-19',
    );

    expect(res.status).toBe(401);
    expect(mocks.verifyCustomerToken).not.toHaveBeenCalled();
    expect(mocks.getCustomerSession).not.toHaveBeenCalled();
    expect(mocks.listRuntimeReminders).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });

  it('lists reminders for the authenticated customer and defaults states to active', async () => {
    const res = await createApp().request(
      '/api/customer/reminders?from=2026-05-13&to=2026-05-19&customerId=ck_attacker',
      { headers: { authorization: 'Bearer customer-token' } },
    );

    expect(res.status).toBe(200);
    expect(mocks.verifyCustomerToken).toHaveBeenCalledWith('customer-token');
    expect(mocks.getCustomerSession).toHaveBeenCalledWith({} as never, {
      customerId: 'ck_123',
      identityId: 'idt_123',
    });
    expect(mocks.listRuntimeReminders).toHaveBeenCalledWith({
      customerId: 'ck_123',
      from: '2026-05-13',
      to: '2026-05-19',
      states: ['active'],
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        reminders: [
          {
            id: 'rem-1',
            title: 'Standup',
            localDate: '2026-05-13',
            localTime: '09:30',
            timezone: 'Asia/Tokyo',
            rrule: 'FREQ=WEEKLY',
            durationMinutes: 60,
            lifecycleState: 'active',
          },
        ],
      },
    });
  });

  it('rejects inactive claims before calling the runtime', async () => {
    mocks.getCustomerSession.mockResolvedValue({
      customerId: 'ck_123',
      identityId: 'idt_123',
      claimStatus: 'pending',
      email: 'alice@example.com',
      membershipRole: 'owner',
    });

    const res = await createApp().request('/api/customer/reminders?from=2026-05-13&to=2026-05-19', {
      headers: { authorization: 'Bearer customer-token' },
    });

    expect(res.status).toBe(403);
    expect(mocks.listRuntimeReminders).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'claim_inactive' });
  });

  it('validates list date range and states before calling the runtime', async () => {
    const app = createApp();

    const tooWide = await app.request(
      '/api/customer/reminders?from=2026-05-01&to=2026-06-01&states=active',
      { headers: { authorization: 'Bearer customer-token' } },
    );
    const badState = await app.request(
      '/api/customer/reminders?from=2026-05-13&to=2026-05-19&states=active,deleted',
      { headers: { authorization: 'Bearer customer-token' } },
    );

    expect(tooWide.status).toBe(400);
    expect(badState.status).toBe(400);
    expect(mocks.listRuntimeReminders).not.toHaveBeenCalled();
  });

  it('creates a reminder with conversation hints and ignores caller customer and route keys', async () => {
    const res = await createApp().request('/api/customer/reminders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        customerId: 'ck_attacker',
        customer_id: 'ck_attacker',
        routeKey: 'caller-route',
        title: 'Standup',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
        rrule: null,
        businessConversationKey: 'bc-123',
        gatewayConversationId: 'gw-123',
        durationMinutes: 60,
      }),
    });

    expect(res.status).toBe(200);
    expect(mocks.createRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'ck_123',
      title: 'Standup',
      localDate: '2026-05-13',
      localTime: '09:30',
      timezone: 'Asia/Tokyo',
      rrule: null,
      businessConversationKey: 'bc-123',
      gatewayConversationId: 'gw-123',
      durationMinutes: 60,
    });
  });

  it('returns created reminders in the customer reminder DTO shape with duration', async () => {
    mocks.createRuntimeReminder.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'rem-created',
        title: 'Lesson',
        schedule: {
          localDate: '2026-05-13',
          localTime: '09:30:00',
          timezone: 'Asia/Tokyo',
          rrule: null,
          durationMinutes: 60,
        },
      },
    });

    const res = await createApp().request('/api/customer/reminders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Lesson',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
        durationMinutes: 60,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        id: 'rem-created',
        title: 'Lesson',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
        rrule: null,
        durationMinutes: 60,
      },
    });
  });

  it('validates create and update reminder fields', async () => {
    const createRes = await createApp().request('/api/customer/reminders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'x'.repeat(201),
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
        durationMinutes: 0,
      }),
    });
    const updateRes = await createApp().request('/api/customer/reminders/rem-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated',
        localDate: '2026-5-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
        rrule: 'FREQ=MONTHLY',
      }),
    });

    expect(createRes.status).toBe(400);
    expect(updateRes.status).toBe(400);
    expect(mocks.createRuntimeReminder).not.toHaveBeenCalled();
    expect(mocks.updateRuntimeReminder).not.toHaveBeenCalled();
  });

  it('accepts runtime-supported RRULE subset for create and update', async () => {
    const app = createApp();
    await app.request('/api/customer/reminders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Weekday standup',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      }),
    });
    await app.request('/api/customer/reminders/rem-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
        rrule: 'FREQ=WEEKLY;INTERVAL=2',
      }),
    });
    await app.request('/api/customer/reminders/rem-2', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
        rrule: 'FREQ=MONTHLY',
      }),
    });

    expect(mocks.createRuntimeReminder).toHaveBeenCalledWith(
      expect.objectContaining({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }),
    );
    expect(mocks.updateRuntimeReminder).toHaveBeenCalledWith(
      expect.objectContaining({ reminderId: 'rem-1', rrule: 'FREQ=WEEKLY;INTERVAL=2' }),
    );
    expect(mocks.updateRuntimeReminder).toHaveBeenCalledWith(
      expect.objectContaining({ reminderId: 'rem-2', rrule: 'FREQ=MONTHLY' }),
    );
  });

  it('rejects invalid reminder timezones', async () => {
    const createRes = await createApp().request('/api/customer/reminders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Standup',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Mars/Olympus',
      }),
    });
    const updateRes = await createApp().request('/api/customer/reminders/rem-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Mars/Olympus',
      }),
    });

    expect(createRes.status).toBe(400);
    expect(updateRes.status).toBe(400);
    await expect(createRes.json()).resolves.toEqual({ ok: false, error: 'invalid_body' });
    await expect(updateRes.json()).resolves.toEqual({ ok: false, error: 'invalid_body' });
    expect(mocks.createRuntimeReminder).not.toHaveBeenCalled();
    expect(mocks.updateRuntimeReminder).not.toHaveBeenCalled();
  });

  it('rejects timezone abbreviations even when Intl canonicalizes them', async () => {
    const res = await createApp().request('/api/customer/reminders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Standup',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'PST',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'invalid_body' });
    expect(mocks.createRuntimeReminder).not.toHaveBeenCalled();
  });

  it('accepts UTC as a valid reminder timezone', async () => {
    const res = await createApp().request('/api/customer/reminders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Standup',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'UTC',
      }),
    });

    expect(res.status).toBe(200);
    expect(mocks.createRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'ck_123',
      title: 'Standup',
      localDate: '2026-05-13',
      localTime: '09:30',
      timezone: 'UTC',
    });
  });

  it('updates, completes, and cancels reminders using the authenticated customer id', async () => {
    const app = createApp();

    await app.request('/api/customer/reminders/rem-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ customerId: 'ck_attacker', title: 'Updated' }),
    });
    await app.request('/api/customer/reminders/rem-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
        durationMinutes: 90,
      }),
    });
    await app.request('/api/customer/reminders/rem-1/complete', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ customerId: 'ck_attacker' }),
    });
    await app.request('/api/customer/reminders/rem-2/cancel', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ customerId: 'ck_attacker' }),
    });

    expect(mocks.updateRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'ck_123',
      reminderId: 'rem-1',
      title: 'Updated',
    });
    expect(mocks.updateRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'ck_123',
      reminderId: 'rem-1',
      localDate: '2026-05-13',
      localTime: '09:30',
      timezone: 'Asia/Tokyo',
      durationMinutes: 90,
    });
    expect(mocks.completeRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'ck_123',
      reminderId: 'rem-1',
    });
    expect(mocks.cancelRuntimeReminder).toHaveBeenCalledWith({
      customerId: 'ck_123',
      reminderId: 'rem-2',
    });
  });

  it('returns updated reminders in the customer reminder DTO shape with duration', async () => {
    mocks.updateRuntimeReminder.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'rem-1',
        title: 'Updated lesson',
        schedule: {
          localDate: '2026-05-14',
          localTime: '10:00:00',
          timezone: 'Asia/Tokyo',
          rrule: 'FREQ=WEEKLY',
          durationMinutes: 90,
        },
      },
    });

    const res = await createApp().request('/api/customer/reminders/rem-1', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Updated lesson',
        localDate: '2026-05-14',
        localTime: '10:00',
        timezone: 'Asia/Tokyo',
        rrule: 'FREQ=WEEKLY',
        durationMinutes: 90,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      data: {
        id: 'rem-1',
        title: 'Updated lesson',
        localDate: '2026-05-14',
        localTime: '10:00',
        timezone: 'Asia/Tokyo',
        rrule: 'FREQ=WEEKLY',
        durationMinutes: 90,
      },
    });
  });

  it('maps runtime errors with stable status codes and preserves conversation_required', async () => {
    mocks.createRuntimeReminder.mockResolvedValueOnce({ ok: false, error: 'conversation_required' });
    mocks.updateRuntimeReminder.mockResolvedValueOnce({ ok: false, error: 'reminder_not_found' });

    const conversationRes = await createApp().request('/api/customer/reminders', {
      method: 'POST',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Standup',
        localDate: '2026-05-13',
        localTime: '09:30',
        timezone: 'Asia/Tokyo',
      }),
    });
    const notFoundRes = await createApp().request('/api/customer/reminders/rem-missing', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer customer-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Updated' }),
    });

    expect(conversationRes.status).toBe(409);
    await expect(conversationRes.json()).resolves.toEqual({
      ok: false,
      error: 'conversation_required',
    });
    expect(notFoundRes.status).toBe(404);
    await expect(notFoundRes.json()).resolves.toEqual({
      ok: false,
      error: 'reminder_not_found',
    });
  });
});
