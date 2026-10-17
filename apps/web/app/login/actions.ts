'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';

export async function login(form: FormData) {
  const email = form.get('email');
  const password = form.get('password');
  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    !email.trim() ||
    email.length > 320 ||
    !password ||
    password.length > 1024
  ) {
    redirect('/login?error=invalid_credentials');
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) redirect('/login?error=invalid_credentials');
  // Identity only. Provisioning and authorization are separate; login never writes app.users.
  redirect('/app');
}

export async function logout() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) redirect('/login?error=logout_failed');
  redirect('/login');
}
