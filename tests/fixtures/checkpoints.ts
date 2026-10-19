/** Disposable checkpoint fixtures only. No catalog approval or real publication. */
import { randomUUID } from 'node:crypto';
import { testCurriculum } from './curriculum';
import { parseCurriculum } from '../../scripts/curriculum/load';
import { evaluationDigest, sha256 } from '../../scripts/curriculum/digest';
export const checkpointTasks = [
  {
    key: 'normalize-label',
    file: 'normalize.go',
    fn: 'NormalizeLabel',
    input: 'string',
    title: 'Normalize a label',
    subject:
      'Implement NormalizeLabel(value string) string: trim surrounding whitespace and return lowercase text.',
  },
  {
    key: 'count-vowels',
    file: 'vowels.go',
    fn: 'CountVowels',
    input: 'string',
    title: 'Count vowels',
    subject:
      'Implement CountVowels(value string) string: count ASCII vowels a e i o u without regard to case and return the count as decimal text.',
  },
  {
    key: 'digit-sum',
    file: 'digits.go',
    fn: 'DigitSum',
    input: 'int64',
    title: 'Sum decimal digits',
    subject:
      'Implement DigitSum(value int64) string: return the sum of the decimal digits of the absolute value, as decimal text.',
  },
  {
    key: 'sign-label',
    file: 'sign.go',
    fn: 'SignLabel',
    input: 'int64',
    title: 'Classify a sign',
    subject:
      'Implement SignLabel(value int64) string: return negative, zero, or positive according to its sign.',
  },
] as const;
export function checkpointFixture(
  options: {
    packs?: Record<string, Record<string, unknown>>;
    artifacts?: string;
    prerequisites?: boolean;
  } = {},
) {
  const original = testCurriculum();
  const manifest = original.files.find((f) => f.path.endsWith('/manifest.yaml'))!;
  const base = Buffer.from(manifest.bytes).toString();
  const nodeDefs = `  - id: transfer-checkpoint\n    quest: go-basics\n    type: checkpoint\n    title: Transfer checkpoint\n    order: 3\n    difficulty: 1\n  - id: after-checkpoint\n    quest: go-basics\n    type: challenge\n    title: After checkpoint\n    order: 4\n    difficulty: 1\n`;
  // Reuse the committed quest identity, avoiding assumptions about display names.
  const quest = original.curriculum.quests[0]!.key;
  const cpEdges = options.prerequisites
    ? `  - { from: hello-go, to: transfer-checkpoint, rule: requires_pass }\n  - { from: even-or-odd, to: transfer-checkpoint, rule: requires_pass }\n`
    : '';
  const unrelated = options.prerequisites
    ? `  - id: unrelated-root\n    quest: ${quest}\n    type: challenge\n    title: Unrelated root\n    order: 5\n    difficulty: 1\n`
    : '';
  const content = base.replace(
    /edges:[\s\S]*$/,
    nodeDefs.replaceAll('quest: go-basics', `quest: ${quest}`) +
      unrelated +
      `edges:\n${cpEdges}  - { from: transfer-checkpoint, to: after-checkpoint, rule: requires_pass }\n`,
  );
  const root = 'content/piscine-v1';
  const files = original.files.map((f) =>
    f === manifest ? { ...f, bytes: Buffer.from(content) } : f,
  );
  const add = (path: string, value: string) =>
    files.push({ path: `${root}/${path}`, bytes: Buffer.from(value) });
  add(
    'checkpoints/transfer-checkpoint/checkpoint.yaml',
    `id: transfer-checkpoint\ntitle: Transfer checkpoint\npolicy_version: 1\nduration_seconds: 5400\ntasks: [${checkpointTasks.map((t) => t.key).join(', ')}]\n`,
  );
  add(
    'checkpoints/transfer-checkpoint/subject.md',
    'Four transfer tasks. Pass any three. You have 90 minutes.',
  );
  for (const t of checkpointTasks) {
    add(
      `checkpoints/transfer-checkpoint/tasks/${t.key}/task.yaml`,
      `id: ${t.key}\ntitle: ${t.title}\nlanguage: go\nsubmission:\n  required_files: [${t.file}]\n  allowed_extensions: [.go]\n  max_size_kb: 256\nlimits: { timeout_ms: 2000, memory_mb: 64, output_kb: 64 }\njudge: { testpack: checkpoint-${t.key}-v1 }\nskills: [transfer]\n`,
    );
    add(`checkpoints/transfer-checkpoint/tasks/${t.key}/subject.md`, t.subject);
  }
  const hello = original.files.find((f) => f.path.endsWith('/hello-go/challenge.yaml'))!;
  add(
    'challenges/after-checkpoint/challenge.yaml',
    Buffer.from(hello.bytes)
      .toString()
      .replace('id: hello-go', 'id: after-checkpoint')
      .replace(/title: [^\n]+/, 'title: After checkpoint'),
  );
  add('challenges/after-checkpoint/subject.md', 'Gate test fixture.');
  if (options.prerequisites) {
    add(
      'challenges/unrelated-root/challenge.yaml',
      Buffer.from(hello.bytes)
        .toString()
        .replace('id: hello-go', 'id: unrelated-root')
        .replace(/title: [^\n]+/, 'title: Unrelated root'),
    );
    add('challenges/unrelated-root/subject.md', 'Unrelated prerequisite fixture.');
  }
  const curriculum = parseCurriculum(files);
  const resolve = (
    node: (typeof curriculum.nodes)[number] | import('@nextera/domain').CheckpointTask,
    nodeKey: string,
  ) => {
    const entry = options.packs?.[node.testPackId];
    const fallback = original.evaluations[0]!.spec;
    const hash = entry?.test_pack_digest ?? sha256(`NON-RUNNABLE-CP-${node.testPackId}`);
    const task = checkpointTasks.find((t) => t.key === node.key);
    const spec: Record<string, unknown> = {
      ...(entry ?? fallback),
      test_only: true,
      curriculum_key: curriculum.key,
      curriculum_version: curriculum.version,
      content_digest: curriculum.contentDigest,
      node_key: nodeKey,
      subject_digest: node.subjectDigest,
      configuration_digest: node.configurationDigest,
      test_pack_id: node.testPackId,
      test_pack_digest: hash,
      test_pack_artifact: `oci://${options.artifacts ?? '/non-runnable-checkpoint-fixture'}/${node.testPackId}@sha256:${hash}`,
      ...(task
        ? {
            execution_contract: {
              version: 1,
              item_key: task.key,
              learner_file: task.file,
              function: task.fn,
              input_type: task.input,
              output_type: 'string',
            },
          }
        : {}),
    };
    return { spec, digest: evaluationDigest(spec) };
  };
  const evaluations = curriculum.nodes.map((node) => {
    if (!node.checkpoint) return { nodeKey: node.key, ...resolve(node, node.key) };
    const definition = {
      policyVersion: 1,
      durationSeconds: 5400,
      tasks: node.checkpoint.tasks.map((task) => {
        const r = resolve(task, node.key);
        return { ...task, evaluationSpec: r.spec, evaluationDigest: r.digest };
      }),
    };
    const spec: Record<string, unknown> = {
      ...resolve(node.checkpoint.tasks[0]!, node.key).spec,
      checkpoint_definition: definition,
      subject_digest: node.subjectDigest,
      configuration_digest: node.configurationDigest,
    };
    return { nodeKey: node.key, spec, digest: evaluationDigest(spec), checkpoint: definition };
  });
  return {
    curriculum,
    evaluations,
    files,
    gitCommitSha: original.gitCommitSha,
    fixtureId: randomUUID(),
  };
}
