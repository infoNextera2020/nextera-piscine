import { execFileSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import {
  curriculumRoots,
  NODE_KINDS,
  type Curriculum,
  type NodeKind,
  type SubmissionRules,
  type CheckpointTask,
} from '@nextera/domain';
import { contentDigest, sha256, type SourceFile } from './digest';

export class CurriculumValidationError extends Error {}
const fail = (message: string): never => {
  throw new CurriculumValidationError(message);
};
export function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail(`${context}: expected an object.`);
  return value as Record<string, unknown>;
}
export function text(value: unknown, context: string): string {
  if (typeof value !== 'string' || !value.trim())
    return fail(`${context}: required nonempty string.`);
  return value;
}
export function positive(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    return fail(`${context}: required positive safe integer.`);
  return value as number;
}
const list = (value: unknown, context: string): unknown[] =>
  Array.isArray(value) ? value : fail(`${context}: required list.`);
const key = (value: unknown, context: string): string => {
  const result = text(value, context);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) return fail(`${context}: invalid key.`);
  return result;
};
function unique(values: readonly (string | number)[], context: string) {
  if (new Set(values).size !== values.length) fail(`${context}: duplicate key or position.`);
}
function knownFields(value: Record<string, unknown>, allowed: readonly string[], context: string) {
  if (Object.keys(value).some((field) => !allowed.includes(field)))
    fail(`${context}: unsupported metadata field.`);
}
export function parseCurriculum(
  files: readonly SourceFile[],
  directory = 'content/piscine-v1',
): Curriculum {
  const digest = contentDigest(files);
  const sources = new Map(files.map((file) => [file.path, file.bytes]));
  const used = new Set<string>();
  const read = (path: string): string => {
    const bytes = sources.get(path);
    if (!bytes) return fail(`Missing required file: ${path}`);
    used.add(path);
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return fail(`${path}: invalid UTF-8.`);
    }
  };
  const yaml = (path: string) => {
    const document = parseDocument(read(path), {
      uniqueKeys: true,
      strict: true,
      stringKeys: true,
      prettyErrors: false,
    });
    if (document.errors.length || document.warnings.length)
      fail(
        `${path}: ${[...document.errors, ...document.warnings].map((e) => e.message).join('; ')}`,
      );
    try {
      return object(document.toJS({ maxAliasCount: 0 }), path);
    } catch {
      return fail(`${path}: aliases or invalid YAML are not supported.`);
    }
  };
  const manifest = yaml(`${directory}/manifest.yaml`);
  knownFields(
    manifest,
    ['id', 'version', 'title', 'status', 'default_language', 'quests', 'nodes', 'edges'],
    'manifest',
  );
  const curriculumKey = key(manifest.id, 'manifest.id');
  const version = text(manifest.version, 'manifest.version');
  text(manifest.title, 'manifest.title');
  if (manifest.default_language !== 'go') fail('Only the pilot Go language is supported.');
  const quests = list(manifest.quests, 'quests').map((value) => {
    const q = object(value, 'quest');
    knownFields(q, ['id', 'title', 'order'], 'quest');
    return {
      key: key(q.id, 'quest.id'),
      title: text(q.title, 'quest.title'),
      position: positive(q.order, 'quest.order'),
    };
  });
  if (!quests.length) fail('At least one quest is required.');
  unique(
    quests.map((q) => q.key),
    'quests',
  );
  unique(
    quests.map((q) => q.position),
    'quest positions',
  );
  const nodes = list(manifest.nodes, 'nodes').map((value) => {
    const n = object(value, 'node');
    knownFields(n, ['id', 'quest', 'type', 'title', 'order', 'difficulty'], 'node');
    const nodeKey = key(n.id, 'node.id');
    const questKey = key(n.quest, 'node.quest');
    if (!quests.some((q) => q.key === questKey)) fail(`${nodeKey}: unknown quest ${questKey}.`);
    if (!NODE_KINDS.some((kind) => kind === n.type)) fail(`${nodeKey}: invalid node kind.`);
    const kind = n.type as NodeKind;
    const folder = `${directory}/${kind === 'challenge' ? 'challenges' : `${kind}s`}/${nodeKey}`;
    if (kind === 'checkpoint') {
      const configPath = `${folder}/checkpoint.yaml`;
      const config = yaml(configPath);
      knownFields(
        config,
        ['id', 'title', 'policy_version', 'duration_seconds', 'tasks'],
        configPath,
      );
      if (
        config.id !== nodeKey ||
        config.title !== n.title ||
        config.policy_version !== 1 ||
        config.duration_seconds !== 5400
      )
        fail('Checkpoint identity or accepted policy mismatch.');
      const taskKeys = list(config.tasks, 'checkpoint.tasks').map((v) => key(v, 'task key'));
      unique(taskKeys, 'checkpoint tasks');
      if (taskKeys.length !== 4) fail('A checkpoint requires exactly four tasks.');
      const tasks: CheckpointTask[] = taskKeys.map((taskKey) => {
        const base = `${folder}/tasks/${taskKey}`;
        const path = `${base}/task.yaml`;
        const task = yaml(path);
        knownFields(
          task,
          ['id', 'title', 'language', 'submission', 'limits', 'judge', 'skills'],
          path,
        );
        if (task.id !== taskKey || task.language !== 'go')
          fail('Checkpoint task identity mismatch.');
        const submission = object(task.submission, 'task.submission');
        knownFields(
          submission,
          ['required_files', 'allowed_extensions', 'max_size_kb'],
          'submission',
        );
        const required = list(submission.required_files, 'required_files').map((v) =>
          text(v, 'filename'),
        );
        const extensions = list(submission.allowed_extensions, 'allowed_extensions');
        if (
          required.length !== 1 ||
          !/^[A-Za-z0-9_][A-Za-z0-9_]*[.]go$/.test(required[0]!) ||
          required[0] === 'main.go' ||
          extensions.length !== 1 ||
          extensions[0] !== '.go'
        )
          fail('Checkpoint task requires one safe Go function file.');
        const limits = object(task.limits, 'task.limits');
        knownFields(limits, ['timeout_ms', 'memory_mb', 'output_kb'], 'limits');
        const judge = object(task.judge, 'task.judge');
        knownFields(judge, ['testpack'], 'judge');
        const subject = read(`${base}/subject.md`);
        if (!subject.trim()) fail('Empty checkpoint task subject.');
        const skills = list(task.skills, 'skills').map((v) => key(v, 'skill'));
        unique(skills, 'skills');
        return {
          key: taskKey,
          title: text(task.title, 'task.title'),
          subjectMarkdown: subject,
          subjectDigest: sha256(sources.get(`${base}/subject.md`)!),
          configurationDigest: sha256(sources.get(path)!),
          submissionRules: {
            required_files: required,
            allowed_extensions: ['.go'],
            max_size_kb: positive(submission.max_size_kb, 'max_size_kb'),
          },
          testPackId: key(judge.testpack, 'testpack'),
          declaredLimits: {
            timeout_ms: positive(limits.timeout_ms, 'timeout_ms'),
            memory_mb: positive(limits.memory_mb, 'memory_mb'),
            output_kb: positive(limits.output_kb, 'output_kb'),
          },
        };
      });
      unique(
        tasks.map((t) => t.testPackId),
        'checkpoint evaluation identities',
      );
      const subject = read(`${folder}/subject.md`);
      if (!subject.trim()) fail('Empty checkpoint subject.');
      return {
        key: nodeKey,
        questKey,
        kind,
        title: text(n.title, 'node.title'),
        position: positive(n.order, 'node.order'),
        difficulty: positive(n.difficulty, 'difficulty'),
        subjectMarkdown: subject,
        subjectDigest: sha256(sources.get(`${folder}/subject.md`)!),
        configurationDigest: sha256(sources.get(configPath)!),
        skills: [],
        submissionRules: tasks[0]!.submissionRules,
        testPackId: tasks[0]!.testPackId,
        declaredLimits: tasks[0]!.declaredLimits,
        checkpoint: { policyVersion: 1 as const, durationSeconds: 5400 as const, tasks },
      };
    }
    const configPath = `${folder}/${kind}.yaml`;
    const config = yaml(configPath);
    knownFields(
      config,
      ['id', 'title', 'language', 'submission', 'limits', 'judge', 'skills'],
      configPath,
    );
    const title = text(n.title, 'node.title');
    if (config.id !== nodeKey || config.title !== title || config.language !== 'go')
      fail(`${nodeKey}: configuration identity/title/language mismatch.`);
    const submission = object(config.submission, `${nodeKey}.submission`);
    knownFields(submission, ['required_files', 'allowed_extensions', 'max_size_kb'], 'submission');
    const requiredFiles = list(submission.required_files, 'required_files').map((v) =>
      text(v, 'required filename'),
    );
    const extensions = list(submission.allowed_extensions, 'allowed_extensions').map((v) =>
      text(v, 'extension'),
    );
    if (!requiredFiles.length || !extensions.length)
      fail(`${nodeKey}: submission allowlists cannot be empty.`);
    unique(requiredFiles, 'required files');
    unique(extensions, 'extensions');
    if (
      extensions.some((v) => !/^\.[a-z0-9]+$/.test(v)) ||
      requiredFiles.some(
        (v) =>
          !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(v) || !extensions.some((ext) => v.endsWith(ext)),
      )
    )
      fail(`${nodeKey}: unsafe filename or disallowed extension.`);
    const limits = object(config.limits, `${nodeKey}.limits`);
    knownFields(limits, ['timeout_ms', 'memory_mb', 'output_kb'], 'limits');
    const judge = object(config.judge, 'judge');
    knownFields(judge, ['testpack'], 'judge');
    const subjectPath = `${folder}/subject.md`;
    const subjectMarkdown = read(subjectPath);
    if (!subjectMarkdown.trim()) fail(`${nodeKey}: empty subject.`);
    const skills = list(config.skills, 'skills').map((v) => key(v, 'skill'));
    unique(skills, 'skills');
    const submissionRules: SubmissionRules = {
      required_files: requiredFiles,
      allowed_extensions: extensions,
      max_size_kb: positive(submission.max_size_kb, 'max_size_kb'),
    };
    if (!Number.isSafeInteger(submissionRules.max_size_kb * 1024))
      fail('Submission byte size overflows.');
    return {
      key: nodeKey,
      questKey,
      kind,
      title,
      position: positive(n.order, 'node.order'),
      difficulty: positive(n.difficulty, 'node.difficulty'),
      subjectMarkdown,
      subjectDigest: sha256(sources.get(subjectPath)!),
      configurationDigest: sha256(sources.get(configPath)!),
      skills,
      submissionRules,
      testPackId: key(judge.testpack, 'testpack'),
      declaredLimits: {
        timeout_ms: positive(limits.timeout_ms, 'timeout_ms'),
        memory_mb: positive(limits.memory_mb, 'memory_mb'),
        output_kb: positive(limits.output_kb, 'output_kb'),
      },
    };
  });
  unique(
    nodes.map((n) => n.key),
    'nodes',
  );
  unique(
    nodes.map((n) => `${n.questKey}/${n.position}`),
    'node positions within quest',
  );
  const prerequisites = list(manifest.edges, 'edges').map((value) => {
    const e = object(value, 'edge');
    knownFields(e, ['from', 'to', 'rule'], 'edge');
    if (e.rule !== 'requires_pass') fail('Unsupported prerequisite rule.');
    return {
      from: key(e.from, 'edge.from'),
      to: key(e.to, 'edge.to'),
      rule: 'requires_pass' as const,
    };
  });
  let roots: string[];
  try {
    roots = curriculumRoots(
      nodes.map((n) => n.key),
      prerequisites,
    );
  } catch (error) {
    return fail((error as Error).message);
  }
  for (const path of sources.keys())
    if (!used.has(path)) fail(`Unreferenced curriculum file: ${path}`);
  return {
    key: curriculumKey,
    version,
    contentDigest: digest,
    digestFormatVersion: 1,
    quests,
    nodes,
    prerequisites,
    roots,
  };
}

/** Read committed Git blobs, never working-tree bytes or a route's filesystem. */
export function loadGitCurriculum(repository: string, ref = 'HEAD') {
  const git = (args: string[]) =>
    execFileSync('git', ['-C', repository, ...args], { maxBuffer: 8 * 1024 * 1024 });
  const gitCommitSha = git(['rev-parse', '--verify', `${ref}^{commit}`])
    .toString()
    .trim();
  const files = git(['ls-tree', '-r', '-z', gitCommitSha, '--', 'content/piscine-v1'])
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = /^(100644|100755) blob ([0-9a-f]+)\t(.+)$/.exec(entry);
      if (!match)
        return fail('Curriculum must contain regular Git blobs without symlinks/submodules.');
      return { path: match[3]!, bytes: git(['cat-file', 'blob', match[2]!]) };
    });
  return { gitCommitSha, curriculum: parseCurriculum(files), files };
}
