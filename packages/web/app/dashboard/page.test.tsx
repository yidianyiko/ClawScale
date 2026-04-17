import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

import { LocaleProvider } from '../../components/locale-provider';

const apiGetMock = vi.hoisted(() => vi.fn());
const getTenantMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../../lib/api', () => ({
  api: {
    get: (url: string) => apiGetMock(url),
  },
}));

vi.mock('../../lib/auth', () => ({
  getTenant: () => getTenantMock(),
}));

import DashboardPage from './page';

describe('DashboardPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    apiGetMock.mockReset();
    getTenantMock.mockReset();
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/api/tenant/stats') {
        return Promise.resolve({
          ok: true,
          data: {
            totalMembers: 4,
            activeMembers: 3,
            totalConversations: 12,
            activeChannels: 2,
            totalBackends: 1,
            totalEndUsers: 9,
          },
        });
      }

      if (url === '/api/channels') {
        return Promise.resolve({
          ok: true,
          data: [
            { id: 'c1', name: 'Primary', type: 'whatsapp', status: 'connected' },
            { id: 'c2', name: 'Backup', type: 'telegram', status: 'disconnected' },
          ],
        });
      }

      return Promise.resolve({ ok: false });
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it('renders English dashboard overview copy', async () => {
    getTenantMock.mockReturnValue({ name: 'Acme' });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="en">
          <DashboardPage />
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Welcome back to Acme');
      expect(container.textContent).toContain("Here's an overview of your chatbot.");
      expect(container.textContent).toContain('Total conversations');
      expect(container.textContent).toContain('Channels');
      expect(container.textContent).toContain('Open the new admin console');
      expect(container.textContent).not.toContain('总对话数');
    });

    expect(container.querySelector('a[href="/admin/customers"]')).not.toBeNull();
    expect(container.querySelector('a[href="/admin/channels"]')).not.toBeNull();
    expect(container.querySelector('a[href="/admin/deliveries"]')).not.toBeNull();
    const quickCards = Array.from(container.querySelectorAll('a.card'));

    expect(quickCards).toHaveLength(3);
    expect(quickCards.some((card) =>
      card.getAttribute('href') === '/admin/customers'
      && card.textContent?.includes('Customers')
      && card.textContent?.includes('Review customer accounts, claim state, and channel coverage.'),
    )).toBe(true);
    expect(quickCards.some((card) => card.textContent?.includes('Conversations'))).toBe(false);
    expect(quickCards.some((card) =>
      card.getAttribute('href') === '/admin/channels'
      && card.textContent?.includes('Channels')
      && card.textContent?.includes('Inspect platform channel status and routing health in the admin console.'),
    )).toBe(true);
    expect(quickCards.some((card) =>
      card.getAttribute('href') === '/admin/deliveries'
      && card.textContent?.includes('Deliveries')
      && card.textContent?.includes('Review recent delivery failures and operational follow-up from the admin console.'),
    )).toBe(true);
    expect(quickCards.some((card) => card.textContent?.includes('Workflows'))).toBe(false);
    expect(container.querySelector('a[href="/dashboard/conversations"]')).toBeNull();
    expect(container.querySelector('a[href="/dashboard/channels"]')).toBeNull();
    expect(container.querySelector('a[href="/dashboard/workflows"]')).toBeNull();
  });

  it('renders Chinese dashboard overview copy', async () => {
    getTenantMock.mockReturnValue({ name: 'Acme' });

    flushSync(() => {
      root.render(
        <LocaleProvider initialLocale="zh">
          <DashboardPage />
        </LocaleProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('欢迎回到 Acme');
      expect(container.textContent).toContain('这里是你的聊天机器人工作区概览。');
      expect(container.textContent).toContain('总对话数');
      expect(container.textContent).toContain('客户');
      expect(container.textContent).toContain('投递');
      expect(container.textContent).toContain('打开新的管理后台');
      expect(container.textContent).not.toContain('Total conversations');
    });

    expect(container.querySelector('a[href="/admin/customers"]')).not.toBeNull();
    expect(container.querySelector('a[href="/admin/channels"]')).not.toBeNull();
    expect(container.querySelector('a[href="/admin/deliveries"]')).not.toBeNull();
    const quickCards = Array.from(container.querySelectorAll('a.card'));

    expect(quickCards).toHaveLength(3);
    expect(quickCards.some((card) =>
      card.getAttribute('href') === '/admin/customers'
      && card.textContent?.includes('客户')
      && card.textContent?.includes('查看客户账号、认领状态和渠道覆盖情况。'),
    )).toBe(true);
    expect(quickCards.some((card) => card.textContent?.includes('对话'))).toBe(false);
    expect(quickCards.some((card) =>
      card.getAttribute('href') === '/admin/channels'
      && card.textContent?.includes('渠道')
      && card.textContent?.includes('在管理后台检查平台渠道状态和路由健康。'),
    )).toBe(true);
    expect(quickCards.some((card) =>
      card.getAttribute('href') === '/admin/deliveries'
      && card.textContent?.includes('投递')
      && card.textContent?.includes('在管理后台查看近期投递失败和后续处理。'),
    )).toBe(true);
    expect(quickCards.some((card) => card.textContent?.includes('工作流'))).toBe(false);
    expect(container.querySelector('a[href="/dashboard/conversations"]')).toBeNull();
    expect(container.querySelector('a[href="/dashboard/channels"]')).toBeNull();
    expect(container.querySelector('a[href="/dashboard/workflows"]')).toBeNull();
  });
});
