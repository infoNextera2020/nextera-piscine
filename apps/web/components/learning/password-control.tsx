'use client';
import { useState } from 'react';
import s from './auth-split.module.css';
export function PasswordControl({
  id,
  name,
  autoComplete,
  placeholder,
  describedBy,
  invalid,
}: {
  id: string;
  name: string;
  autoComplete: 'current-password' | 'new-password';
  placeholder: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const description = id.includes('confirm') ? 'confirmation password' : 'password';
  return (
    <div className={s.control}>
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        maxLength={1024}
        required
        placeholder={placeholder}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
      />
      <button
        className={s.reveal}
        type="button"
        aria-label={(visible ? 'Hide ' : 'Show ') + description}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
