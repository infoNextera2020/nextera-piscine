import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import type { Sql } from 'postgres';
import type {
  InvitationRuntimeConfiguration,
  InvitationRuntimeClients,
  InvitationOperationBudget,
} from './runtime-configuration-core';
import type { createNativeInvitationLoader } from './runtime-protected-loader';

type SqlClient = Pick<Sql, 'unsafe'>;
type Query = PromiseLike<unknown[]> & { cancel(): void };
type Driver = {
  unsafe(sql: string, params?: unknown[]): Query;
  end(options: { timeout: number }): Promise<void>;
};
type Auth = {
  getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  admin: InvitationRuntimeClients['admin'];
};
type Binding = {
  profile: string;
  publicPolicySha256: string;
  issuerId: string;
  cohortId: string;
  curriculumVersionId: string;
};
type Rate = InvitationRuntimeConfiguration['policy']['rates']['issuer'];
export type NativeInvitationRpc = {
  readInvitationRuntimePolicyRows(
    client: SqlClient,
    binding: Binding,
  ): ReturnType<InvitationRuntimeClients['readPolicyRows']>;
  readInvitationRuntimeAuthorityRows(
    client: SqlClient,
    binding: Binding,
  ): ReturnType<InvitationRuntimeClients['readAuthorityRows']>;
  consumeInvitationRuntimeIssuer(
    client: SqlClient,
    binding: Binding,
    operation: string,
    issuer: string,
    rate: Rate,
  ): Promise<boolean>;
  consumeInvitationRuntimeIssueIngress(
    client: SqlClient,
    binding: Binding,
    operation: string,
    rate: Rate,
  ): Promise<boolean>;
};
export type NativeClientFactories = {
  postgres(options: Record<string, unknown>): Driver;
  supabase(url: string, key: string, fetcher: typeof fetch): Auth;
  fetch: typeof fetch;
  uuid(): string;
  token(): string;
};
const factories: NativeClientFactories = {
  postgres: (options) => postgres(options as never) as unknown as Driver,
  supabase: (url, key, fetcher) =>
    createClient(url, key, {
      global: { fetch: fetcher },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
        debug: false,
      },
    }).auth,
  fetch: (...args) => globalThis.fetch(...args),
  uuid: randomUUID,
  token: () => randomBytes(32).toString('base64url'),
};
const fail = (): never => {
  throw new Error('INVITATION_NATIVE_OUTCOME_UNKNOWN');
};
const HASH = /^[a-f0-9]{64}$/,
  UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function exact(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const r = value as Record<string, unknown>;
  if (Object.keys(r).sort().join() !== keys.sort().join()) return fail();
  return r;
}
function jwt(value: unknown, role: string, started: number, deadline: number): string {
  if (typeof value !== 'string' || value.length > 16384) return fail();
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((p) => !p || !/^[A-Za-z0-9_-]+$/.test(p))) return fail();
  const decode = (part: string) => {
    const b = Buffer.from(part, 'base64url');
    if (b.toString('base64url') !== part) return fail();
    try {
      return JSON.parse(b.toString('utf8')) as unknown;
    } catch {
      return fail();
    }
  };
  const h = exact(decode(parts[0]!), ['alg', 'typ']),
    p = exact(decode(parts[1]!), ['role', 'iss', 'iat', 'exp']);
  if (
    h.alg !== 'HS256' ||
    h.typ !== 'JWT' ||
    p.role !== role ||
    p.iss !== 'supabase' ||
    p.iat !== Math.floor(started / 1000) ||
    p.exp !== Math.floor(deadline / 1000) ||
    Buffer.from(parts[2]!, 'base64url').length !== 32
  )
    return fail();
  // Signing material stays with the private broker. These checks are constraints,
  // not authentication: the independently pinned credential-file digest binds the
  // actual token bytes; only GoTrue can establish current provider acceptance.
  return value;
}
function connection(
  value: unknown,
  c: InvitationRuntimeConfiguration,
  key: 'issuer' | 'activation' | 'web',
) {
  if (typeof value !== 'string' || value.length > 8192) return fail();
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return fail();
  }
  const username = decodeURIComponent(u.username),
    password = decodeURIComponent(u.password);
  if (
    u.protocol !== 'postgres:' ||
    u.hostname !== c.target.dbHost ||
    Number(u.port) !== c.target.dbPort ||
    u.pathname !== '/' + c.target.database ||
    u.search ||
    u.hash ||
    username !== c.target.roles[key] ||
    !password ||
    password.length > 4096 ||
    [...password].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return fail();
  return {
    host: c.target.dbHost,
    port: c.target.dbPort,
    database: c.target.database,
    username,
    password,
  };
}
function accessToken(request: Request, name: string, maximum: number): string | null {
  const header = request.headers.get('cookie') ?? '';
  if (Buffer.byteLength(header) > maximum) return fail();
  const cookies = new Map<string, string>();
  for (const item of header.split(';')) {
    if (!item.trim()) continue;
    const at = item.indexOf('=');
    if (at < 1) return fail();
    const key = item.slice(0, at).trim();
    if (cookies.has(key)) return fail();
    try {
      cookies.set(key, decodeURIComponent(item.slice(at + 1).trim()));
    } catch {
      return fail();
    }
  }
  const chunks = [...cookies.keys()].filter((k) => k.startsWith(name + '.'));
  let value = cookies.get(name);
  if (value !== undefined && chunks.length) return fail();
  if (value === undefined && chunks.length) {
    if (chunks.some((k) => !/^(0|[1-9][0-9]*)$/.test(k.slice(name.length + 1)))) return fail();
    value = '';
    for (let i = 0; i < chunks.length; i++) {
      const part = cookies.get(name + '.' + i);
      if (part === undefined) return fail();
      value += part;
    }
  }
  if (value === undefined) return null;
  if (value.startsWith('base64-')) {
    const raw = value.slice(7);
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) return fail();
    value = Buffer.from(raw, 'base64url').toString('utf8');
  }
  let session: unknown;
  try {
    session = JSON.parse(value);
  } catch {
    return fail();
  }
  if (!session || typeof session !== 'object' || Array.isArray(session)) return fail();
  const token = (session as Record<string, unknown>).access_token;
  if (typeof token !== 'string' || token.length > 16384 || !token) return fail();
  // Never trust cookie user/role metadata, use refresh_token or call setSession.
  return token;
}
type Context = {
  controller: AbortController;
  pending: Set<Query>;
  expired: boolean;
  budget: InvitationOperationBudget;
  monotonicCap: number;
  reject: ((reason: Error) => void) | null;
};
export function createNativeInvitationClientFactory(options: {
  loader: ReturnType<typeof createNativeInvitationLoader>;
  now(): number;
  monotonic(): number;
  factories?: NativeClientFactories;
  rpc: NativeInvitationRpc;
}) {
  const f = options.factories ?? factories,
    loader = options.loader;
  const remaining = (b: InvitationOperationBudget) =>
    Math.min(
      b.wallCutoffMs - options.now(),
      b.monotonicCutoffMs - options.monotonic(),
      b.remainingMs,
    );
  return async (
    c: InvitationRuntimeConfiguration,
    request: Request,
    remainingMs: number,
  ): Promise<InvitationRuntimeClients> => {
    const lease = loader.reviewed.lease;
    const budget = Object.freeze({
      wallCutoffMs: lease.cleanupAt,
      monotonicCutoffMs: lease.monotonicDeadline - 180000,
      remainingMs,
    });
    if (
      !Number.isFinite(remaining(budget)) ||
      remaining(budget) <= 0 ||
      new URL(request.url).origin !== c.target.origin
    )
      return fail();
    const input = await loader.load();
    let protectedConfiguration: unknown;
    try {
      protectedConfiguration = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(input.configuration.bytes),
      );
    } catch {
      return fail();
    }
    if (JSON.stringify(protectedConfiguration) !== JSON.stringify(c)) return fail();
    const r = exact(await loader.readCredentials(), [
      'version',
      'profile',
      'scopeSha256',
      'configurationSha256',
      'sourceLockSha256',
      'started',
      'deadline',
      'authOrigin',
      'connections',
      'anonKey',
      'serviceRoleKey',
      'cookieName',
      'maxCookieBytes',
    ]);
    if (
      r.version !== 1 ||
      r.profile !== c.profile ||
      r.scopeSha256 !== loader.reviewed.scopeSha256 ||
      r.configurationSha256 !== loader.reviewed.configurationSha256 ||
      r.sourceLockSha256 !== loader.reviewed.sourceLockSha256 ||
      r.started !== lease.started ||
      r.deadline !== lease.deadline ||
      r.authOrigin !== c.target.authOrigin ||
      r.cookieName !== 'sb-127-auth-token' ||
      typeof r.maxCookieBytes !== 'number' ||
      !Number.isSafeInteger(r.maxCookieBytes) ||
      r.maxCookieBytes <= 0 ||
      r.maxCookieBytes > 65536 ||
      !HASH.test(loader.reviewed.configurationSha256)
    )
      return fail();
    const dsns = exact(r.connections, ['issuer', 'activation', 'web']);
    const connections = {
      issuer: connection(dsns.issuer, c, 'issuer'),
      activation: connection(dsns.activation, c, 'activation'),
      web: connection(dsns.web, c, 'web'),
    };
    const anon = jwt(r.anonKey, 'anon', lease.started, lease.deadline);
    const service = jwt(r.serviceRoleKey, 'service_role', lease.started, lease.deadline);
    const cookieToken = accessToken(request, r.cookieName as string, r.maxCookieBytes);
    const storage = new AsyncLocalStorage<Context>(),
      active = new Set<Context>(),
      drivers: Driver[] = [];
    const left = (ctx: Context) =>
      Math.min(remaining(ctx.budget), ctx.monotonicCap - options.monotonic());
    let closed = false,
      closePromise: Promise<void> | undefined;
    const check = (ctx: Context) => {
      if (
        closed ||
        ctx.expired ||
        ctx.controller.signal.aborted ||
        !Number.isFinite(left(ctx)) ||
        left(ctx) <= 0
      )
        return fail();
    };
    const current = () => {
      const ctx = storage.getStore();
      if (!ctx) return fail();
      check(ctx);
      return ctx;
    };
    const cancel = (ctx: Context) => {
      if (!ctx.expired) {
        ctx.expired = true;
        ctx.controller.abort();
        for (const q of ctx.pending)
          try {
            q.cancel();
          } catch {
            /* still unknown */
          }
      }
      // Close/request abort must settle the race even when the driver never
      // acknowledges cancellation. A repeated cancel never repeats native cancel.
      ctx.reject?.(new Error('INVITATION_NATIVE_OUTCOME_UNKNOWN'));
    };
    const close = () => {
      if (closePromise) return closePromise;
      closed = true;
      for (const ctx of active) cancel(ctx);
      closePromise = (async () => {
        const ends = drivers.map(async (driver) => {
          try {
            await driver.end({ timeout: 0 });
          } catch {
            return fail();
          }
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.all(ends),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('INVITATION_NATIVE_OUTCOME_UNKNOWN')),
                Math.max(1, Math.min(1000, lease.deadline - options.now())),
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      })();
      return closePromise;
    };
    const runBounded = async <T>(
      b: InvitationOperationBudget,
      operation: () => Promise<T>,
    ): Promise<T> => {
      if (
        closed ||
        b.wallCutoffMs !== lease.cleanupAt ||
        b.monotonicCutoffMs !== lease.monotonicDeadline - 180000 ||
        !Object.isFrozen(b) ||
        !Number.isFinite(remaining(b)) ||
        remaining(b) <= 0 ||
        storage.getStore()
      )
        return fail();
      const ctx: Context = {
        controller: new AbortController(),
        pending: new Set(),
        expired: false,
        budget: b,
        monotonicCap: options.monotonic() + b.remainingMs,
        reject: null,
      };
      active.add(ctx);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const aborted = () => cancel(ctx);
      request.signal.addEventListener('abort', aborted, { once: true });
      const timeout = new Promise<never>((_, reject) => {
        ctx.reject = reject;
      });
      const poll = () => {
        if (
          closed ||
          ctx.expired ||
          ctx.controller.signal.aborted ||
          request.signal.aborted ||
          !Number.isFinite(left(ctx)) ||
          left(ctx) <= 0
        ) {
          cancel(ctx);
          return;
        }
        timer = setTimeout(poll, Math.max(1, Math.min(50, left(ctx))));
      };
      poll();
      try {
        const result = await Promise.race([
          storage.run(ctx, async () => {
            check(ctx);
            const answer = await operation();
            check(ctx);
            return answer;
          }),
          timeout,
        ]);
        check(ctx);
        // A callback that leaves native SQL in flight cannot establish success.
        // Cancellation below preserves an unknown mutation outcome, never rollback proof.
        if (ctx.pending.size !== 0) return fail();
        return result;
      } catch {
        cancel(ctx);
        return fail();
      } finally {
        // AsyncLocalStorage descendants can outlive a successful callback. Seal
        // every finished context before dropping its poller/ownership tracking.
        // Awaited queries have already removed themselves from pending, so they
        // are not spuriously cancelled; unfinished mutations remain unknown.
        cancel(ctx);
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener('abort', aborted);
        active.delete(ctx);
      }
    };
    const fetcher: typeof fetch = async (input, init) => {
      const ctx = current();
      const u = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      if (
        u.origin !== c.target.authOrigin ||
        !u.pathname.startsWith('/auth/v1/') ||
        u.username ||
        u.password
      )
        return fail();
      const signals = [
        ctx.controller.signal,
        ...(init?.signal ? [init.signal] : []),
        ...(input instanceof Request ? [input.signal] : []),
      ];
      const response = await f.fetch(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any(signals),
      });
      check(ctx);
      return response;
    };
    try {
      const bound = {} as Record<
        'issuer' | 'activation' | 'web',
        InvitationRuntimeClients['issuer']
      >;
      for (const key of ['issuer', 'activation', 'web'] as const) {
        if (remaining(budget) <= 0) return fail();
        const info = connections[key];
        const driver = f.postgres({
          ...info,
          prepare: false,
          max: 1,
          ssl: false,
          connect_timeout: Math.max(0.001, Math.min(8, remaining(budget) / 1000)),
          idle_timeout: Math.max(0.001, Math.min(5, remaining(budget) / 1000)),
          onnotice: () => {},
          debug: false,
        });
        drivers.push(driver);
        const client = {
          unsafe: async (sql: string, params: unknown[] = []) => {
            const ctx = current(),
              q = driver.unsafe(sql, params);
            ctx.pending.add(q);
            try {
              const answer = await q;
              check(ctx);
              return answer;
            } catch {
              return fail();
            } finally {
              ctx.pending.delete(q);
            }
          },
        } as unknown as SqlClient;
        bound[key] = {
          client,
          host: info.host,
          port: info.port,
          database: info.database,
          username: info.username,
        };
      }
      const ordinary = f.supabase(c.target.authOrigin, anon, fetcher),
        admin = f.supabase(c.target.authOrigin, service, fetcher);
      const rpc = options.rpc;
      const binding = {
        profile: c.profile,
        publicPolicySha256: loader.reviewed.configurationSha256,
        issuerId: c.issuerId,
        cohortId: c.cohortId,
        curriculumVersionId: c.curriculumVersionId,
      };
      const operations = { issuer: f.uuid(), issueIngress: f.uuid() };
      if (
        !UUID.test(operations.issuer) ||
        !UUID.test(operations.issueIngress) ||
        operations.issuer === operations.issueIngress
      )
        return fail();
      let issuerConsumed = false,
        ingressConsumed = false;
      return {
        ...bound,
        authOrigin: c.target.authOrigin,
        close,
        runBounded,
        auth: {
          getUser: async () =>
            cookieToken ? ordinary.getUser(cookieToken) : { data: { user: null }, error: null },
        },
        admin: admin.admin,
        readPolicyRows: (client) => rpc.readInvitationRuntimePolicyRows(client, binding),
        readAuthorityRows: (client) => rpc.readInvitationRuntimeAuthorityRows(client, binding),
        consumeIssuer: async (id, rate) => {
          current();
          if (issuerConsumed || id !== c.issuerId) return fail();
          issuerConsumed = true;
          return rpc.consumeInvitationRuntimeIssuer(
            bound.issuer.client,
            binding,
            operations.issuer,
            id,
            rate,
          );
        },
        consumeIssueIngress: async (req, rate) => {
          current();
          if (ingressConsumed || req !== request) return fail();
          ingressConsumed = true;
          return rpc.consumeInvitationRuntimeIssueIngress(
            bound.issuer.client,
            binding,
            operations.issueIngress,
            rate,
          );
        },
        capability: async () => {
          current();
          return { invitationId: f.uuid(), token: f.token() };
        },
      };
    } catch {
      try {
        await close();
      } catch {
        /* both outcomes remain unknown */
      }
      return fail();
    }
  };
}
