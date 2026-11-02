import 'server-only';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import type { InvitationAssemblySettings } from './assembly';
import type { InvitationIssuanceAssemblySettings } from './issuance-assembly';
import type { InvitationSignupPublicPolicy } from './signup-settings';
import { createInvitationRequestConfiguration } from './runtime-configuration-core';
import { createNativeInvitationDependenciesResolver } from './runtime-native-binding';

// Reads only a public startup digest at construction. No file, credential or client opens here.
// Missing/invalid configuration remains unavailable; a future approved broker must supply the
// protected externally pinned anchor. Every request reloads and validates its active lease.
const nativeDependencies = createNativeInvitationDependenciesResolver();

let localSqlClient: ReturnType<typeof postgres> | null = null;
function getLocalSqlClient(url: string) {
  if (!localSqlClient) {
    localSqlClient = postgres(url, { max: 5, prepare: false });
  }
  return localSqlClient;
}

let localAdminClient: ReturnType<typeof createClient> | null = null;
function getLocalAdminClient(url: string, key: string) {
  if (!localAdminClient) {
    localAdminClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return localAdminClient;
}

export async function getInvitationActivationSettings(request: Request) {
  const native = await nativeDependencies();
  if (native) {
    return createInvitationRequestConfiguration(native).activation(request);
  }

  // Fallback is strictly disallowed in production; production requires the approved native broker.
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  const dbUrl = process.env.DATABASE_URL || process.env.OPERATIONS_DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_LOCAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.NEXTERA_INVITATION_SERVICE_ROLE_KEY || process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;

  if (!dbUrl || !supabaseUrl || !serviceKey) {
    return null;
  }

  const client = getLocalSqlClient(dbUrl);
  const adminClient = getLocalAdminClient(supabaseUrl, serviceKey);

  const requestOrigin = request.headers.get('origin');
  const allowedOrigins = [
    'http://127.0.0.1:3100',
    'http://localhost:3100',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
  ];
  if (
    requestOrigin &&
    (requestOrigin.startsWith('http://127.0.0.1:') || requestOrigin.startsWith('http://localhost:')) &&
    !allowedOrigins.includes(requestOrigin)
  ) {
    allowedOrigins.push(requestOrigin);
  }

  const settings: InvitationAssemblySettings = {
    enabled: true,
    admission: {
      enabled: true,
      client,
      policy: {
        authorityContract: 'nextera-invitation-admission-v1',
        emailConfirmed: true,
        rateProfiles: {
          ingress: 'rate_ingress_default',
          inspect: 'rate_inspect_default',
          activate: 'rate_activate_default',
        },
      },
    },
    policy: {
      enabled: true,
      maxTokenBytes: 128,
      maxPasswordBytes: 1024,
      claimLeaseMs: 30000,
      acceptsPassword: async (password: string) =>
        typeof password === 'string' && password.length >= 8 && password.length <= 1024,
    },
    admin: {
      createUser: async (...args) => adminClient.auth.admin.createUser(...args),
      getUserById: async (...args) => adminClient.auth.admin.getUserById(...args),
    },
    now: () => Date.now(),
    http: {
      enabled: true,
      allowedOrigins,
      maxBodyBytes: 4096,
      bodyTimeoutMs: 10000,
      callerKey: async (req) => {
        const key = req.headers.get('x-forwarded-for') ?? req.headers.get('host') ?? '127.0.0.1';
        return createHash('sha256').update(key).digest('hex');
      },
    },
  };

  return { settings, close: async () => {} };
}

export async function getInvitationIssuanceSettings(request: Request) {
  const native = await nativeDependencies();
  if (native) {
    return createInvitationRequestConfiguration(native).issuance(request);
  }
  return null;
}

export async function getInvitationSignupPublicPolicy(): Promise<InvitationSignupPublicPolicy | null> {
  const native = await nativeDependencies();
  if (native) {
    return createInvitationRequestConfiguration(native).publicPolicy();
  }

  // Fallback is strictly disallowed in production; production requires the approved native broker.
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  const dbUrl = process.env.DATABASE_URL || process.env.OPERATIONS_DATABASE_URL;
  const serviceKey =
    process.env.NEXTERA_INVITATION_SERVICE_ROLE_KEY || process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;

  if (!dbUrl || !serviceKey) {
    return null;
  }

  return Object.freeze({
    enabled: true as const,
    timeoutMs: 10000,
    maxResponseBytes: 4096,
    maxPasswordBytes: 1024,
  });
}
