'use client';

import { useState, type FormEvent } from 'react';
import { sendFriendRequest } from '../../../lib/user-link-api';

export function ClaimHandoff({ token, targetName }: { token: string; targetName: string }) {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('sending');
    try {
      const result = await sendFriendRequest({ token, message });
      setStatus(result.ok ? 'sent' : 'failed');
    } catch {
      setStatus('failed');
    }
  }

  if (status === 'sent') {
    return <p className="public-user-link__status">Friend request sent to {targetName}.</p>;
  }

  return (
    <form className="public-user-link__claim" onSubmit={handleSubmit}>
      <label htmlFor="friend-request-message">Message</label>
      <textarea
        id="friend-request-message"
        name="message"
        value={message}
        onChange={(event) => setMessage(event.currentTarget.value)}
        maxLength={500}
      />
      <button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending...' : 'Send friend request'}
      </button>
      {status === 'failed' ? (
        <p className="public-user-link__status">Friend request could not be sent. Please try again.</p>
      ) : null}
    </form>
  );
}
