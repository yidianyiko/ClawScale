'use client';
import { useEffect, useState } from 'react';
import { UserPlus, Loader2, Trash2, Shield, Eye, User } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { useLocale } from '@/components/locale-provider';
import { getDashboardCopy } from '@/lib/dashboard-copy';
import { cn, formatDate } from '@/lib/utils';
import type { ApiResponse } from '../../../../shared/src/types/api';
import type { PublicUser, UserRole } from '../../../../shared/src/types/user';

const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  admin: <Shield className="h-3.5 w-3.5" />,
  member: <User className="h-3.5 w-3.5" />,
  viewer: <Eye className="h-3.5 w-3.5" />,
};

const ROLE_BADGE: Record<UserRole, string> = {
  admin: 'badge-teal', member: 'badge-gray', viewer: 'badge-yellow',
};

interface InviteForm { email: string; name: string; role: UserRole; temporaryPassword: string }

export default function Users() {
  const me = getUser();
  const { locale } = useLocale();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>({ email: '', name: '', role: 'member', temporaryPassword: '' });
  const [inviteError, setInviteError] = useState('');
  const [inviting, setInviting] = useState(false);
  const copy = getDashboardCopy(locale);

  async function loadUsers() {
    const res = await api.get<ApiResponse<PublicUser[]>>('/api/users');
    if (res.ok) setUsers(res.data);
    setLoading(false);
  }

  useEffect(() => { void loadUsers(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    setInviting(true);
    try {
      const res = await api.post<ApiResponse<PublicUser>>('/api/users', inviteForm);
      if (!res.ok) { setInviteError(copy.users.genericError); return; }
      setUsers((prev) => [...prev, res.data]);
      setShowInvite(false);
      setInviteForm({ email: '', name: '', role: 'member', temporaryPassword: '' });
    } finally { setInviting(false); }
  }

  async function handleDeactivate(userId: string) {
    if (!confirm(copy.users.confirmDeactivate)) return;
    const res = await api.delete<ApiResponse<null>>(`/api/users/${userId}`);
    if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== userId));
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{copy.users.title}</h1>
          <p className="text-gray-500 mt-1">{copy.users.subtitle}</p>
        </div>
        {me?.role === 'admin' && (
          <button className="btn-primary" onClick={() => setShowInvite(true)}>
            <UserPlus className="h-4 w-4" /> {copy.users.inviteMember}
          </button>
        )}
      </div>

      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">{copy.users.inviteTitle}</h2>
            {inviteError && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{inviteError}</div>}
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="label">{copy.users.nameLabel}</label>
                <input className="input" placeholder={copy.users.namePlaceholder} value={inviteForm.name}
                  onChange={(e) => setInviteForm((p) => ({ ...p, name: e.target.value }))} required />
              </div>
              <div>
                <label className="label">{copy.users.emailLabel}</label>
                <input className="input" type="email" placeholder={copy.users.emailPlaceholder} value={inviteForm.email}
                  onChange={(e) => setInviteForm((p) => ({ ...p, email: e.target.value }))} required />
              </div>
              <div>
                <label className="label">{copy.users.roleLabel}</label>
                <select className="input" value={inviteForm.role}
                  onChange={(e) => setInviteForm((p) => ({ ...p, role: e.target.value as UserRole }))}>
                  <option value="admin">{copy.users.roleLabels.admin}</option>
                  <option value="member">{copy.users.roleLabels.member}</option>
                  <option value="viewer">{copy.users.roleLabels.viewer}</option>
                </select>
              </div>
              <div>
                <label className="label">{copy.users.tempPasswordLabel}</label>
                <input className="input" type="password" placeholder={copy.users.tempPasswordPlaceholder} value={inviteForm.temporaryPassword}
                  minLength={8} onChange={(e) => setInviteForm((p) => ({ ...p, temporaryPassword: e.target.value }))} required />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1" disabled={inviting}>
                  {inviting && <Loader2 className="h-4 w-4 animate-spin" />} {copy.users.sendInvite}
                </button>
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowInvite(false)}>{copy.users.cancel}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.users.columns.member}</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.users.columns.role}</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.users.columns.joined}</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">{copy.users.columns.lastActive}</th>
                {me?.role === 'admin' && <th className="px-5 py-3 text-right font-medium text-gray-500">{copy.users.columns.actions}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u) => (
                <tr key={u.id} className={cn('hover:bg-gray-50/50', !u.isActive && 'opacity-50')}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-50 text-teal-600 font-semibold text-sm">
                        {u.name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{u.name}</p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={cn(ROLE_BADGE[u.role], 'flex items-center gap-1 w-fit')}>
                      {ROLE_ICONS[u.role]} {copy.users.roleLabels[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{formatDate(u.createdAt)}</td>
                  <td className="px-5 py-3.5 text-gray-500">{u.lastActiveAt ? formatDate(u.lastActiveAt) : '—'}</td>
                  {me?.role === 'admin' && (
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        {u.id !== me.id && u.isActive && (
                          <button onClick={() => handleDeactivate(u.id)} className="text-gray-400 hover:text-red-500 transition-colors" title={copy.users.deactivateTitle}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
