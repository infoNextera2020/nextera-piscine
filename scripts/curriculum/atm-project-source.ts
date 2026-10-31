import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { AtmProjectSource } from '@nextera/domain';
import { canonicalJson, contentDigest, sha256, type SourceFile } from './digest';
import { parseDocument } from 'yaml';
import { assertActiveLearningText } from './source-selection';
import { APPROVED_ATM_PUBLIC_FILES } from './atm-approved-source-pins';

export const APPROVED_ATM_SEMANTIC_PROFILE_DIGEST =
  'f09da2b66999409f6dc08ea8f54ef5c34ac259d48cccf5b1d66ecb63ad4c1007';
export const APPROVED_ATM_SOURCE_DIRECTORY = 'content/source-baselines/project1-atm-report-v2';
export class AtmSourceError extends Error {}
const fail = (message: string): never => {
  throw new AtmSourceError('ATM_SOURCE: ' + message);
};
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(label + ': object required.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some(
      (key) => !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key]!, 'value'),
    )
  )
    return fail(label + ': exact public metadata required.');
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value]));
}
function json(source: string, label: string): unknown {
  try {
    JSON.parse(source);
    const document = parseDocument(source, {
      uniqueKeys: true,
      strict: true,
      stringKeys: true,
      prettyErrors: false,
    });
    if (document.errors.length || document.warnings.length)
      return fail(label + ': duplicate/invalid JSON.');
    return document.toJS({ maxAliasCount: 0 }) as unknown;
  } catch {
    return fail(label + ': strict JSON required.');
  }
}
function safePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(value) &&
    !value.split('/').some((part) => part === '.' || part === '..')
  );
}
type SourceAccess = { read(path: string): string; bytes(path: string): Uint8Array };

/** Explicit fixed public allowlist. No private oracle, expected cases or publication defaults. */
export function parseAtmProjectSourcePackage(
  folder: string,
  access: SourceAccess,
): AtmProjectSource {
  if (!safePath(folder)) return fail('safe package folder required.');
  const readExact = (path: string) => {
    const bytes = Uint8Array.from(access.bytes(path));
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return fail('invalid resource UTF-8 ' + path);
    }
    if (access.read(path) !== text) return fail('source text/byte drift ' + path);
    assertActiveLearningText(text, path);
    return { text, bytes };
  };
  const manifestPath = folder + '/source-package.json',
    manifestSource = readExact(manifestPath);
  const manifest = exact(
    json(manifestSource.text, 'source-package.json'),
    [
      'format_version',
      'package_id',
      'semantic_profile_digest',
      'policy',
      'provenance',
      'resources',
    ],
    'source-package',
  );
  if (
    manifest.format_version !== 1 ||
    manifest.package_id !== 'project1-atm-report-v2' ||
    manifest.semantic_profile_digest !== APPROVED_ATM_SEMANTIC_PROFILE_DIGEST
  )
    return fail('unapproved package/profile identity.');
  const policy = exact(manifest.policy, ['team_size', 'release', 'submission_file'], 'policy');
  if (
    policy.team_size !== 3 ||
    policy.release !== 'scheduled_independent_of_exam1_result' ||
    policy.submission_file !== 'main.go'
  )
    return fail('approved team/release/submission rule mismatch.');
  const provenance = exact(
    manifest.provenance,
    [
      'learner_handoff_commit',
      'business_baseline_sha256',
      'reporting_approval_message_id',
      'original_input_helper_sha256',
    ],
    'provenance',
  );
  if (
    provenance.learner_handoff_commit !== 'e7b9961f0b56322fe4754cda97a979a5c510794b' ||
    provenance.business_baseline_sha256 !==
      '8d8ff72fdbc241e0c7fdcfe1692cef8223ee426ca68d373f004f63cf15f28a1b' ||
    provenance.reporting_approval_message_id !== 'Sentinel_1cbce2e598b88191964a8d4af844e811' ||
    provenance.original_input_helper_sha256 !==
      'ce71d84089a9d950208be1479bbd731a0a1f86280370a75af4fd46fab5820bd3'
  )
    return fail('approved source provenance mismatch.');
  if (
    !Array.isArray(manifest.resources) ||
    manifest.resources.length !== APPROVED_ATM_PUBLIC_FILES.length
  )
    return fail('complete exact public resources required.');
  const pins = new Map(
    APPROVED_ATM_PUBLIC_FILES.map((resource) => [resource.path, resource] as const),
  );
  const seen = new Set<string>();
  const resources: AtmProjectSource['resources'][number][] = [];
  for (const raw of manifest.resources) {
    const resource = exact(raw, ['path', 'role', 'media_type', 'bytes', 'sha256'], 'resource');
    if (!safePath(resource.path) || seen.has(resource.path.toLowerCase()))
      return fail('unsafe/duplicate resource path.');
    seen.add(resource.path.toLowerCase());
    const pin = pins.get(resource.path as (typeof APPROVED_ATM_PUBLIC_FILES)[number]['path']);
    if (
      !pin ||
      resource.role !== pin.role ||
      resource.media_type !== pin.media_type ||
      resource.bytes !== pin.bytes ||
      resource.sha256 !== pin.sha256
    )
      return fail('resource is not the approved public artifact.');
    const path = folder + '/' + resource.path,
      { text, bytes } = readExact(path);
    if (bytes.byteLength !== pin.bytes || sha256(bytes) !== pin.sha256)
      return fail('public resource bytes/hash mismatch.');
    resources.push(
      Object.freeze({
        path: resource.path,
        role: pin.role,
        mediaType: pin.media_type,
        byteLength: pin.bytes,
        sha256: pin.sha256,
        text,
      }),
    );
  }
  resources.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const resource = (path: string) =>
    resources.find((value) => value.path === path) ?? fail('missing public resource ' + path);
  const profile = json(resource('reporting-contract.json').text, 'reporting-contract.json');
  const digest = sha256('nextera-atm-report-contract\0v1\0' + canonicalJson(profile));
  if (digest !== APPROVED_ATM_SEMANTIC_PROFILE_DIGEST)
    return fail('computed semantic profile mismatch.');
  const starter = resource('main.go').text;
  const inputStart = starter.indexOf('// Provided input adapter.'),
    reportStart = starter.indexOf('// Report writes one structured observation.'),
    mainStart = starter.indexOf('\nfunc main()');
  if (inputStart < 0 || reportStart <= inputStart || mainStart <= reportStart)
    return fail('supplied helper boundaries missing.');
  const inputRegion = starter.slice(inputStart, reportStart - 1),
    reportRegion = starter.slice(reportStart, mainStart);
  if (
    Buffer.byteLength(inputRegion) !== 433 ||
    sha256(inputRegion) !== '6e0a1e3ce7688dbff3853f3d9789b263b28614eb3a95a1ef9d52e1e7e58666a3' ||
    sha256(reportRegion) !== '373ba6c999e5470b5b4f1380bf75c06a10c1f9184c46562f8d69a5f7870a2cc8' ||
    sha256(resource('input-demo/input.go').text) !== provenance.original_input_helper_sha256
  )
    return fail('exact supplied helper binding mismatch.');
  return Object.freeze({
    version: 1,
    packageId: 'project1-atm-report-v2',
    sourcePackageDigest: sha256(manifestSource.bytes),
    semanticProfileDigest: digest,
    teamSize: 3,
    releasePolicy: 'scheduled_independent_of_exam1_result',
    subjectMarkdown: resource('learner-en.md').text,
    subjectDigest: resource('learner-en.md').sha256,
    resources: Object.freeze(resources),
  });
}

/** Standalone executable source validation; no catalog, schedule, database or ready grade is invented. */
export function validateAtmProjectSource(
  files: readonly SourceFile[],
  directory = APPROVED_ATM_SOURCE_DIRECTORY,
) {
  const digest = contentDigest(files),
    sources = new Map(files.map((file) => [file.path, file.bytes])),
    used = new Set<string>();
  const read = (path: string) => {
    const bytes = sources.get(path);
    if (!bytes) return fail('missing source ' + path);
    used.add(path);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return fail('invalid UTF-8 ' + path);
    }
    assertActiveLearningText(text, path);
    return text;
  };
  const source = parseAtmProjectSourcePackage(directory, {
    read,
    bytes: (path) => sources.get(path) ?? fail('missing bytes ' + path),
  });
  for (const file of files)
    if (!used.has(file.path)) return fail('unreferenced package file ' + file.path);
  return Object.freeze({
    source,
    contentDigest: digest,
    sourceValidated: true as const,
    runtimeReadiness: 'not_proven' as const,
  });
}

/** Local working-tree source check only. Production import continues to use committed Git blobs. */
export function readLocalAtmProjectFiles(
  repository: string,
  directory = APPROVED_ATM_SOURCE_DIRECTORY,
): SourceFile[] {
  if (!safePath(directory)) return fail('safe source directory required.');
  const files: SourceFile[] = [];
  function visit(relative: string) {
    const absolute = join(repository, relative),
      stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) return fail('symlinks are not source artifacts.');
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) visit(relative + '/' + entry);
      return;
    }
    if (!stat.isFile()) return fail('only regular source files are allowed.');
    files.push({ path: relative, bytes: readFileSync(absolute) });
  }
  visit(directory);
  return files;
}

/** Recheck the public source descriptor at the compiler boundary; a profile string alone is not proof. */
export function assertApprovedAtmProjectSource(value: AtmProjectSource): void {
  const source = exact(
    value,
    [
      'version',
      'packageId',
      'sourcePackageDigest',
      'semanticProfileDigest',
      'teamSize',
      'releasePolicy',
      'subjectMarkdown',
      'subjectDigest',
      'resources',
    ],
    'resolved ATM source',
  );
  if (
    source.version !== 1 ||
    source.packageId !== 'project1-atm-report-v2' ||
    source.semanticProfileDigest !== APPROVED_ATM_SEMANTIC_PROFILE_DIGEST ||
    source.teamSize !== 3 ||
    source.releasePolicy !== 'scheduled_independent_of_exam1_result' ||
    typeof source.sourcePackageDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source.sourcePackageDigest) ||
    !Array.isArray(source.resources) ||
    source.resources.length !== APPROVED_ATM_PUBLIC_FILES.length
  )
    return fail('resolved ATM source identity mismatch.');
  const seen = new Set<string>();
  for (const raw of source.resources) {
    const item = exact(
      raw,
      ['path', 'role', 'mediaType', 'byteLength', 'sha256', 'text'],
      'resolved public resource',
    );
    const pin = APPROVED_ATM_PUBLIC_FILES.find((pin) => pin.path === item.path);
    if (
      !pin ||
      seen.has(pin.path) ||
      item.role !== pin.role ||
      item.mediaType !== pin.media_type ||
      item.byteLength !== pin.bytes ||
      item.sha256 !== pin.sha256 ||
      typeof item.text !== 'string' ||
      Buffer.byteLength(item.text) !== pin.bytes ||
      sha256(item.text) !== pin.sha256
    )
      return fail('resolved public resource byte binding mismatch.');
    seen.add(pin.path);
  }
  const subject = value.resources.find((item) => item.path === 'learner-en.md')!,
    profile = value.resources.find((item) => item.path === 'reporting-contract.json')!;
  if (
    source.subjectMarkdown !== subject.text ||
    source.subjectDigest !== subject.sha256 ||
    sha256(
      'nextera-atm-report-contract\0v1\0' + canonicalJson(json(profile.text, 'resolved profile')),
    ) !== source.semanticProfileDigest
  )
    return fail('resolved subject/profile binding mismatch.');
}
