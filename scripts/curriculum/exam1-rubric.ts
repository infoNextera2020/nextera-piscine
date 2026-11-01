import {
  EXAM_TRACE_COMPARATOR_V1,
  validateExamScoringRubric,
  type ExamForm,
  type ExamQuestionKey,
  type ExamScoringRubric,
} from '@nextera/domain';

/** Source preparation only. Contains published criteria and weights, never expected answers/cases.
 * Approval records and publication/hash verification belong to an authoritative adapter, not HTTP.
 */
export type Exam1RubricDecisions = Readonly<{
  weightsOwnerMessageId: string | null;
  approvedDraftSha256: string | null;
  traceComparatorOwnerMessageId: string | null;
  traceComparator: typeof EXAM_TRACE_COMPARATOR_V1 | null;
  /** Independently reviewed mentor rubric bytes, kept outside learner/public assets. */
  manualCriteriaSha256: string | null;
}>;
export type Exam1RubricPreparation = Readonly<{
  form: ExamForm;
  definitionDigest: string;
  publishedPaperSha256: string | null;
  decisions: Exam1RubricDecisions | null;
}>;
/** Authentic policy approval, not a runtime lease or approval of unseen private answers. */
export const EXAM1_GRADING_APPROVAL_RECORD = Object.freeze({
  proposalMessageId: 'Sentinel_772f0614fef88191b978c186a2bf8248',
  ownerMessageId: 'Sentinel_e849fe300ea88191acd6431b61521c7a',
  approvedAtUtc: null,
  reportedTime: '2026-11-01 approximately 05:30 UTC; exact timestamp unavailable',
  runtimeEnabled: false,
} as const);
const hashPattern = /^[a-f0-9]{64}$/;
const ownerMessagePattern = /^Sentinel_[a-f0-9]{32}$/;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('EXAM1_RUBRIC_CANONICAL');
  return encoded;
}
function freeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

const drafts = [
  {
    version: 1,
    form: 'A',
    status: 'source-reviewed-owner-approved-policy',
    paperSha256: 'b39bd12cd76e3f5e8a41399bc74fed5d4ebaa1949e2b21df0b27bb620b8b76f0',
    weightsOwnerApproved: true,
    traceComparator: EXAM_TRACE_COMPARATOR_V1,
    questions: [
      {
        questionKey: 'q1',
        kind: 'coding',
        functionName: 'OrderTotal',
        learnerFile: 'ordertotal.go',
        publishedCriteriaDigest: '404943a4d7a0a8569263d288ba4029315e30472704f19db9f2377adc240d666a',
        functionalGroups: [
          {
            key: 'ordinary-branch-one',
            points: 4,
            criterion: 'Nonzero subtotal below 30 with handling fee',
            criteriaDigest: '0ef0d3429e07a582d7e6c8f0867d06b6925f37a21b56f93bff3352518071afda',
          },
          {
            key: 'ordinary-branch-two',
            points: 4,
            criterion: 'Nonzero subtotal above 30 without handling fee',
            criteriaDigest: '98e8f02ec75d831597222b9f6a537a7362fbafcf6f57fcf47f95bd29c37d94f5',
          },
          {
            key: 'exact-threshold',
            points: 3,
            criterion: 'Subtotal exactly 30 without handling fee',
            criteriaDigest: '49b83a09ac5b4ba5c4f16dd3f9d1a5dec782482d0063ef839d085321982d6da3',
          },
          {
            key: 'zero-override',
            points: 2,
            criterion: 'Zero quantity overrides the handling fee',
            criteriaDigest: 'e441833cc1973bbe85a1e3dfe49a7412bb49d02c6dff00c359ce6d6e396d10fc',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q2',
        kind: 'coding',
        functionName: 'ShiftCounter',
        learnerFile: 'shiftcounter.go',
        publishedCriteriaDigest: '95939088ab08c38cb4dad770889b4e40e9ab17652113d186f00a79e29268cc24',
        functionalGroups: [
          {
            key: 'ordinary-mutation',
            points: 5,
            criterion: 'Adds delta to the original caller target',
            criteriaDigest: 'be8d8c85f5f6cea129ec5530f2b1ad01d5fc7d5b6a2076d63f016260051a4581',
          },
          {
            key: 'signed-operands',
            points: 5,
            criterion: 'Signed initial values and negative delta use addition',
            criteriaDigest: 'bd85231ff1cbb4179eb100dc3d96c4de9e457b4a72ef4f95001ffcc72f9c8325',
          },
          {
            key: 'zero-operands',
            points: 3,
            criterion: 'Zero delta leaves the target value unchanged',
            criteriaDigest: 'ee86efcfbf9658bcb1e8329511cf1cf17fbe5deecfa2f1ff197b858170186d1c',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q3',
        kind: 'coding',
        functionName: 'CountOutside',
        learnerFile: 'countoutside.go',
        publishedCriteriaDigest: 'dbb916c37787d69af1b8784ae43387d13715140dbe335fa094167c449c07d3cf',
        functionalGroups: [
          {
            key: 'range-classification',
            points: 5,
            criterion: 'Counts strictly below low or above high',
            criteriaDigest: '805c2aacbc2318a6b7b5640cf420441dcba611d52973f080ef10abefd077f361',
          },
          {
            key: 'endpoints',
            points: 2,
            criterion: 'Both boundary values are inside',
            criteriaDigest: '20efe40cdbc5bcd53a25c1445773a47e7b2fe02e8e43ecb2e364d039de9bb8df',
          },
          {
            key: 'equal-bounds',
            points: 2,
            criterion: 'Equal bounds count each element according to the same outside rule',
            criteriaDigest: '350a3e449d6c4dd2b1be997264802c6a776b909e468fe91d2289fd2a36c44a2d',
          },
          {
            key: 'duplicates',
            points: 2,
            criterion: 'Repeated elements count separately',
            criteriaDigest: '756032f4ad41e3fc347f0b7f522ef25faa6967fb1da5867bf855de78a470ceb6',
          },
          {
            key: 'nil-empty',
            points: 2,
            criterion: 'Empty and nil slices return zero',
            criteriaDigest: 'b7d0a934b114dd3895e7715d00079e90e665de4254e5681fe49990a08791ede4',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q4',
        kind: 'coding',
        functionName: 'CountText',
        learnerFile: 'counttext.go',
        publishedCriteriaDigest: 'e11fde31d236192c8a42ce10194a96b6bef5af98fbf95f3d5f58ad2b93809d0f',
        functionalGroups: [
          {
            key: 'ordinary-runes',
            points: 4,
            criterion: 'Counts included ordinary runes while excluding ASCII space',
            criteriaDigest: '0983658851d7560c5cf1c1dd470e6ad99213822b826f26c6ea3ded3bd569d6f7',
          },
          {
            key: 'multibyte-runes',
            points: 5,
            criterion: 'Valid multibyte Latin/Arabic-domain runes count by rune',
            criteriaDigest: '5511b6fb1f25a9a57a9ff5e92f7fd6d02d1a635e816a47cbaff233c73eb0f921',
          },
          {
            key: 'empty-excluded',
            points: 2,
            criterion: 'Empty or all-space text returns zero',
            criteriaDigest: 'b007bba4e62a584c8818aab308498b77d0d387408068435c8ae2a716322b9c62',
          },
          {
            key: 'character-distinction',
            points: 2,
            criterion: 'Only U+0020 is excluded; in-domain digit characters count',
            criteriaDigest: 'd978f9b45834e9cafb9a0396afb1ebe98c328c23db903a7a3a13bc9b898e16b4',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q5',
        kind: 'coding',
        functionName: 'ReadLabel',
        learnerFile: 'readlabel.go',
        publishedCriteriaDigest: 'c396c531ac8bbbd82f626ed0fc43f5c1e80ee9121157bd57f4c9610f73d073b1',
        functionalGroups: [
          {
            key: 'valid-lengths',
            points: 3,
            criterion: 'One, two and three digit valid labels',
            criteriaDigest: 'f6fc2a04c529fab4f465b562d24e4c1def0b693bfb9418666a27c75f09ff1655',
          },
          {
            key: 'leading-zeroes',
            points: 2,
            criterion: 'Leading ASCII zeroes remain valid',
            criteriaDigest: '90e7dad6b3e5f4b904362995a6f682b19e067ac3d9e04bbbd90f7300e491e6e3',
          },
          {
            key: 'marker-length',
            points: 4,
            criterion: 'Exactly one leading # and the declared length',
            criteriaDigest: 'f41521b4fd125b15f7a8b6231b097fa53da6fddabff6e8c9ce13f39a45ebf411',
          },
          {
            key: 'ascii-full-input',
            points: 4,
            criterion: 'ASCII digits only and the entire input must be valid',
            criteriaDigest: 'd21864dde77fbd3a71b29b1654bc53f9c28bfd7fead674f7192d14b7768e0be5',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q6',
        kind: 'trace_with_reason',
        functionName: null,
        learnerFile: null,
        publishedCriteriaDigest: '909eb4c968307daca7474af646b865d121dea5dff2b72d25091535d2ef8841bc',
        functionalGroups: [],
        manualCategories: [
          {
            key: 'causal-checkpoint-one',
            points: 1,
            criterion:
              'First causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
          {
            key: 'causal-checkpoint-two',
            points: 1,
            criterion:
              'Second causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
        ],
      },
      {
        questionKey: 'q7',
        kind: 'trace_with_reason',
        functionName: null,
        learnerFile: null,
        publishedCriteriaDigest: 'c2910f46493a2b3bb5007aa2fce6a2be2276d595541966d2aebb4ee015300a1d',
        functionalGroups: [],
        manualCategories: [
          {
            key: 'causal-checkpoint-one',
            points: 1,
            criterion:
              'First causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
          {
            key: 'causal-checkpoint-two',
            points: 1,
            criterion:
              'Second causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
        ],
      },
      {
        questionKey: 'q8',
        kind: 'debug_with_reason',
        functionName: 'SumAll',
        learnerFile: 'sumall.go',
        publishedCriteriaDigest: '431094bcb1acb8c9edbec2f7346c1f6d2c5a26aba32fcce439bfc8feec9b7a6d',
        functionalGroups: [
          {
            key: 'ordinary-sum',
            points: 3,
            criterion: 'Sums every element in an ordinary in-domain list',
            criteriaDigest: 'db24b510e5e9f416c5de36377c0137db736cdf086b8f345d3652c3b484fd3079',
          },
          {
            key: 'signed-zero',
            points: 2,
            criterion: 'Handles signed and zero values within the declared bounds',
            criteriaDigest: 'c1252a3ad4a4fdd0e56ee78886c59613ab23494282631e2cb9bed9bb44159c8a',
          },
          {
            key: 'singleton',
            points: 2,
            criterion: 'Handles one-element input',
            criteriaDigest: 'cbcdce3acfb9fd09217a4e26db4cfe20a28d5259b458f9f7da563fcff18d19f1',
          },
          {
            key: 'nil-empty',
            points: 2,
            criterion: 'Empty and nil slices return zero',
            criteriaDigest: '187ebff75a1e2da871834759f74b3ad0b267a448f9f4f811e86a8cc467c1653a',
          },
        ],
        manualCategories: [
          {
            key: 'counterexample-input',
            points: 2,
            criterion: 'Provides an in-domain concrete input that exposes the published defect',
          },
          {
            key: 'counterexample-effect',
            points: 2,
            criterion: 'Correctly describes the original-versus-repaired behavior for that input',
          },
          {
            key: 'defect-reason',
            points: 1,
            criterion: 'Explains the published defect mechanism; equivalent wording accepted',
          },
          {
            key: 'repair-reason',
            points: 1,
            criterion: 'Explains why the repair works; equivalent wording accepted',
          },
        ],
      },
    ],
    draftSha256: 'a410c44bf33b59c73b9ce6c7205942c4cadfd36f133ca1c63d3302254a1f9ab2',
  },
  {
    version: 1,
    form: 'B',
    status: 'source-reviewed-owner-approved-policy',
    paperSha256: '0476b7427bb0263d4315a0f003ca9ec02c4da6b86c847138c0e7c0e0c9cdc30f',
    weightsOwnerApproved: true,
    traceComparator: EXAM_TRACE_COMPARATOR_V1,
    questions: [
      {
        questionKey: 'q1',
        kind: 'coding',
        functionName: 'TicketCredit',
        learnerFile: 'ticketcredit.go',
        publishedCriteriaDigest: 'cfcafb141cc648e07f464305ee53e14df07624371e30cc4d38738171b32193e3',
        functionalGroups: [
          {
            key: 'ordinary-branch-one',
            points: 4,
            criterion: 'Nonzero base credits below 40 receive no bonus',
            criteriaDigest: '9ff770d17b48a336013ffbbcf7d6c4831f4d34843e576bf834456613f4f86def',
          },
          {
            key: 'ordinary-branch-two',
            points: 4,
            criterion: 'Nonzero base credits above 40 receive the bonus',
            criteriaDigest: '4e88b8a6ddd94bd5f29da7f1e53685cf71eee3ae4bfb5a3526399e525bad83e4',
          },
          {
            key: 'exact-threshold',
            points: 3,
            criterion: 'Base credits exactly 40 receive the bonus',
            criteriaDigest: '4f83ae75758c744bbca0621d4b8622a6d35a66d47ffd3e09dd5ed107e2ee0739',
          },
          {
            key: 'zero-override',
            points: 2,
            criterion: 'Zero quantity returns the declared sentinel',
            criteriaDigest: '5fc18745f887005d37bdd76289409292194723f36ad2ed356b26af21f849f897',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q2',
        kind: 'coding',
        functionName: 'LowerLevel',
        learnerFile: 'lowerlevel.go',
        publishedCriteriaDigest: '5d521d09c86cdf0a92594f38f60a31257d89587dfd9dbe88fb52e250fc183f44',
        functionalGroups: [
          {
            key: 'ordinary-mutation',
            points: 5,
            criterion: 'Subtracts drop from the original caller target',
            criteriaDigest: '2d9c4c74a71cbc8d7d0e48cb04a831189addaf0ca88b37552535411615cc3ab5',
          },
          {
            key: 'signed-operands',
            points: 5,
            criterion: 'Signed targets and negative drop retain the declared subtraction order',
            criteriaDigest: '4b426655b7f5a9ade2be114ddc247280ea52f49b5f52db03809621c647dc00ae',
          },
          {
            key: 'zero-operands',
            points: 3,
            criterion: 'Zero drop leaves the target value unchanged',
            criteriaDigest: 'eee7955c4bf486aff9dab75822507fb146060fb4a0f971ec33169f81d5252400',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q3',
        kind: 'coding',
        functionName: 'CountInside',
        learnerFile: 'countinside.go',
        publishedCriteriaDigest: '0ea705b28ed5ed8a15390ab818790a7b4001408311bb6f54654da740b93462bc',
        functionalGroups: [
          {
            key: 'range-classification',
            points: 5,
            criterion: 'Counts values inclusively between low and high',
            criteriaDigest: 'cccd0cea03f94c20b5d4275df763c09ba0831bb858a87e99440f54be292d9440',
          },
          {
            key: 'endpoints',
            points: 2,
            criterion: 'Both boundary values are included',
            criteriaDigest: '61b38fa258b293a23baee0a5de3ebebbf2e1de0daff285667991fbe6a916e0d3',
          },
          {
            key: 'equal-bounds',
            points: 2,
            criterion: 'Equal bounds count matching elements',
            criteriaDigest: 'b4432f055857526dadc684e42aa0c16b1464685a9a8512cf977b6a14c12cdc1f',
          },
          {
            key: 'duplicates',
            points: 2,
            criterion: 'Repeated elements count separately',
            criteriaDigest: '28132272475c890acb4bc63fe06481e81aa754616a077b8729d66f47539385ec',
          },
          {
            key: 'nil-empty',
            points: 2,
            criterion: 'Empty and nil slices return zero',
            criteriaDigest: '98b6982f78a7191b10424ad316f7f674b828e725db6fff7905de9e8e2bca8e22',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q4',
        kind: 'coding',
        functionName: 'CountVisibleMarkers',
        learnerFile: 'countvisiblemarkers.go',
        publishedCriteriaDigest: '23d54fb5eec186b680ae51d92587c5ded4e2e04681a56d38dccc699d04f4d3a6',
        functionalGroups: [
          {
            key: 'ordinary-runes',
            points: 4,
            criterion: 'Counts included ordinary runes while excluding ASCII hyphen',
            criteriaDigest: '89c02c3ac35c6eaeef33a4640e60e5ae6e9247950697cb93c7aef4fcbb27b67e',
          },
          {
            key: 'multibyte-runes',
            points: 5,
            criterion: 'Valid multibyte Latin/Arabic-domain runes count by rune',
            criteriaDigest: '973d84c9308a8fa0cb8f3d1a7537fbe409e97070806feb5a02e22474f0ba6146',
          },
          {
            key: 'empty-excluded',
            points: 2,
            criterion: 'Empty or all-hyphen text returns zero',
            criteriaDigest: '6e1ee05b8312ab34b101d24d05d597c1c6d4598d663d2aa552b0ad08fe53266e',
          },
          {
            key: 'character-distinction',
            points: 2,
            criterion: 'Only U+002D is excluded; in-domain digit characters count',
            criteriaDigest: 'a21db9c395385f222428d3250a94dfd9f6ee31e7620d019a9f51fe007cbb62bc',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q5',
        kind: 'coding',
        functionName: 'ReadMeasure',
        learnerFile: 'readmeasure.go',
        publishedCriteriaDigest: '22f462b4c0bae87fc50b0651e3f65d494a4d5664d5d29a881ab4435744edc9e8',
        functionalGroups: [
          {
            key: 'valid-lengths',
            points: 3,
            criterion: 'One, two and three digit valid tags',
            criteriaDigest: '9f923929759fa34c072fb733007a5352aca6dfcda3b99cb19ae8e310339db3ed',
          },
          {
            key: 'leading-zeroes',
            points: 2,
            criterion: 'Leading ASCII zeroes remain valid',
            criteriaDigest: '93f66b6128f0faca37ad87972bae8644b7788ce9451e3059c76d4a7cefe4e670',
          },
          {
            key: 'marker-length',
            points: 4,
            criterion: 'Exactly one trailing % marker and the declared length',
            criteriaDigest: '03427e7106a71c9334243c33d29af6557d10e0c6f624cf0f01082c44752ed2d1',
          },
          {
            key: 'ascii-full-input',
            points: 4,
            criterion: 'ASCII digits only and the entire input must be valid',
            criteriaDigest: '0b44caab4d36c73c39e77e2a73f1e712d06d06fefc3dc975a8b7f6bc4e05b2d0',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q6',
        kind: 'trace_with_reason',
        functionName: null,
        learnerFile: null,
        publishedCriteriaDigest: 'ad87bcba91a75d2d326dc415e439fb530a43d4f0596f72e38d916ab4aaa563e9',
        functionalGroups: [],
        manualCategories: [
          {
            key: 'causal-checkpoint-one',
            points: 1,
            criterion:
              'First causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
          {
            key: 'causal-checkpoint-two',
            points: 1,
            criterion:
              'Second causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
        ],
      },
      {
        questionKey: 'q7',
        kind: 'trace_with_reason',
        functionName: null,
        learnerFile: null,
        publishedCriteriaDigest: '0f7a4a91b17ffdf99a312e1074d92b0554b4a00dfda38702e79c7fbdff8f2946',
        functionalGroups: [],
        manualCategories: [
          {
            key: 'causal-checkpoint-one',
            points: 1,
            criterion:
              'First causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
          {
            key: 'causal-checkpoint-two',
            points: 1,
            criterion:
              'Second causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
        ],
      },
      {
        questionKey: 'q8',
        kind: 'debug_with_reason',
        functionName: 'SumAll',
        learnerFile: 'sumall.go',
        publishedCriteriaDigest: 'cf7dad509fdd0a0265fd57455ff1a00e31465a74ae6b08aaa5d752591129a644',
        functionalGroups: [
          {
            key: 'ordinary-sum',
            points: 3,
            criterion: 'Sums every element in an ordinary in-domain list',
            criteriaDigest: 'fe4d975ed88cd1a0648a20cd6712a83da57ba6406c5cd29059c81ca703608b12',
          },
          {
            key: 'signed-zero',
            points: 2,
            criterion: 'Handles signed and zero values within the declared bounds',
            criteriaDigest: 'ecd6126922abc5e940e3bd0b8d2e011aa96a5208a0caf87d47be248611bfdac1',
          },
          {
            key: 'singleton',
            points: 2,
            criterion: 'Handles one-element input',
            criteriaDigest: '5e4aea449c6a1d62e300ead3a2806fe0a53f00ae2f03ebd4fbbb44205686dbb2',
          },
          {
            key: 'nil-empty',
            points: 2,
            criterion: 'Empty and nil slices return zero',
            criteriaDigest: '4b188720201c33dba18d393ca8621587d14fb49e3c9a5073cb1c577b1723e9ac',
          },
        ],
        manualCategories: [
          {
            key: 'counterexample-input',
            points: 2,
            criterion: 'Provides an in-domain concrete input that exposes the published defect',
          },
          {
            key: 'counterexample-effect',
            points: 2,
            criterion: 'Correctly describes the original-versus-repaired behavior for that input',
          },
          {
            key: 'defect-reason',
            points: 1,
            criterion: 'Explains the published defect mechanism; equivalent wording accepted',
          },
          {
            key: 'repair-reason',
            points: 1,
            criterion: 'Explains why the repair works; equivalent wording accepted',
          },
        ],
      },
    ],
    draftSha256: 'e4b4e98454d9797ef494b54f3cf1d186355566808997917c97c6de37948821a1',
  },
  {
    version: 1,
    form: 'C',
    status: 'source-reviewed-owner-approved-policy',
    paperSha256: 'a528401ba443b7101568919c3b5de5625ed48f140ad52ff59859648a03cf0c97',
    weightsOwnerApproved: true,
    traceComparator: EXAM_TRACE_COMPARATOR_V1,
    questions: [
      {
        questionKey: 'q1',
        kind: 'coding',
        functionName: 'GroupCost',
        learnerFile: 'groupcost.go',
        publishedCriteriaDigest: '8407b32983f3f82998e796bc5410b300f22e3280219374cc3a6bd81f5fc54b5e',
        functionalGroups: [
          {
            key: 'ordinary-branch-one',
            points: 4,
            criterion: 'Nonzero product below 50 is unchanged',
            criteriaDigest: '2807d157a3b84f0667b9937b7df9cf9dbd148ae4b6b51fcc2b2dcf9d025207a8',
          },
          {
            key: 'ordinary-branch-two',
            points: 4,
            criterion: 'Nonzero product above 50 receives the reduction',
            criteriaDigest: '5e1f90c8fa7224bb8af54bb745a030dd217d1d6f89af645fe06eb41362b239b6',
          },
          {
            key: 'exact-threshold',
            points: 3,
            criterion: 'Product exactly 50 receives no reduction',
            criteriaDigest: 'ab30c41b0eb8571a7b415451f484f882d304d227288579ff22c335d30d497cd7',
          },
          {
            key: 'zero-override',
            points: 2,
            criterion: 'Zero quantity returns the declared sentinel',
            criteriaDigest: 'ac66111157b89f4aa28ed1d6bc760a997f82d56e3ce9e5890f825f905788f84d',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q2',
        kind: 'coding',
        functionName: 'ScaleLevel',
        learnerFile: 'scalelevel.go',
        publishedCriteriaDigest: '9df52a32fd69cf111745e0b2ad416865764c03fb3c58d311012738d949c0673d',
        functionalGroups: [
          {
            key: 'ordinary-mutation',
            points: 5,
            criterion: 'Multiplies the original caller target by factor',
            criteriaDigest: 'e893f0a94807ebe957d4bdd44a1f92e67f7ef9e85d9cbca954e9ccfe67a76b83',
          },
          {
            key: 'signed-operands',
            points: 5,
            criterion: 'Signed factors and targets follow multiplication',
            criteriaDigest: 'a88c08c2a8a37468273232d185d7e60843d11b648f691c68c368811b95cf679f',
          },
          {
            key: 'zero-operands',
            points: 3,
            criterion: 'Zero factor or target yields zero',
            criteriaDigest: '8fe7b4f51348dabf9c634cd6cdaa619e168099e87bc5d0a713fe284a0331a387',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q3',
        kind: 'coding',
        functionName: 'CountAtEdges',
        learnerFile: 'countatedges.go',
        publishedCriteriaDigest: 'fe7c612b75fd09f95f4f2589fc1432e80c66f42d83bae8ec7f67c14808f4cb08',
        functionalGroups: [
          {
            key: 'range-classification',
            points: 5,
            criterion: 'Counts endpoint matches and excludes other positions',
            criteriaDigest: '7832044e9dc2feef1af6213bf943cc8c8923dd3c0b2adefc9a16e23aab93b6a6',
          },
          {
            key: 'endpoints',
            points: 2,
            criterion: 'Both endpoints are included',
            criteriaDigest: 'cb4e868d0ebb90c38e522aa6dbf9117f08601615d9be79b00201a0403231e7ce',
          },
          {
            key: 'equal-bounds',
            points: 2,
            criterion: 'Equal endpoints count each matching element once',
            criteriaDigest: 'f268c996f00c2f85c4e5cfe6733e9abe151173678ad885a5b839ff37fdfed1a6',
          },
          {
            key: 'duplicates',
            points: 2,
            criterion: 'Repeated elements count separately',
            criteriaDigest: 'abf257baa2cf0bdda8fc08cc1d2735ee946f4176b35ba269c9c92559ac7b2d7a',
          },
          {
            key: 'nil-empty',
            points: 2,
            criterion: 'Empty and nil slices return zero',
            criteriaDigest: '9f4eace6ec0476f34d16c0f1b1c50ea673382042ee7d033721d5aeca907507b5',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q4',
        kind: 'coding',
        functionName: 'CountLabelRunes',
        learnerFile: 'countlabelrunes.go',
        publishedCriteriaDigest: '254840c1d8ba16c5d507896708745b49ef456fc3fc70a74a9e11c1429054782e',
        functionalGroups: [
          {
            key: 'ordinary-runes',
            points: 4,
            criterion: 'Counts included ordinary runes while excluding ASCII dot',
            criteriaDigest: '80f3bdb7e861cb81499004df2b2d27bafc44da546660ac73b89d4b410ecb202a',
          },
          {
            key: 'multibyte-runes',
            points: 5,
            criterion: 'Valid multibyte Latin/Arabic-domain runes count by rune',
            criteriaDigest: 'cbc2e9074a756eb5b58b598591c5e669ecdeaf12c4d96538f413552a31098b91',
          },
          {
            key: 'empty-excluded',
            points: 2,
            criterion: 'Empty or all-dot text returns zero',
            criteriaDigest: '3b4983f88543654a049c844e1641685d7dcdea58437e7c4a45ea0f9ecd764804',
          },
          {
            key: 'character-distinction',
            points: 2,
            criterion: 'Only U+002E is excluded; in-domain digit characters count',
            criteriaDigest: '4dad0e88557dac6019cf749592985b47be0c18ac78e7f269daaecef484493750',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q5',
        kind: 'coding',
        functionName: 'ReadVoucher',
        learnerFile: 'readvoucher.go',
        publishedCriteriaDigest: '63f6020c16968788b1a90c25a9acf0e039ab42051069a7053f8666575c7cbd88',
        functionalGroups: [
          {
            key: 'valid-lengths',
            points: 3,
            criterion: 'One, two and three digit valid labels',
            criteriaDigest: 'fa8bb613c69fa0b2a90d6b33c4762c691e5289584c1614ce8e196d1e8b544d6a',
          },
          {
            key: 'leading-zeroes',
            points: 2,
            criterion: 'Leading ASCII zeroes remain valid',
            criteriaDigest: '16a92bdef4db88fd25aaba6554e6eb6e88e90954a8ef697049c0365036ea813d',
          },
          {
            key: 'marker-length',
            points: 4,
            criterion: 'Exactly one leading + marker and the declared length',
            criteriaDigest: '2856a7689aa9396fdfd65ea0c93b9b3554ccac50c938f6c8308428b02aacfaa7',
          },
          {
            key: 'ascii-full-input',
            points: 4,
            criterion: 'ASCII digits only and the entire input must be valid',
            criteriaDigest: '6f5ceade70d9beeeb300e102ad468e3a1335a79315c46a6da46bc420e2c61236',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q6',
        kind: 'trace_with_reason',
        functionName: null,
        learnerFile: null,
        publishedCriteriaDigest: 'f5314a620599dd69da00e3c26b447b5bf93da113393a75548ff577f5e8b9d049',
        functionalGroups: [],
        manualCategories: [
          {
            key: 'causal-checkpoint-one',
            points: 1,
            criterion:
              'First causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
          {
            key: 'causal-checkpoint-two',
            points: 1,
            criterion:
              'Second causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
        ],
      },
      {
        questionKey: 'q7',
        kind: 'trace_with_reason',
        functionName: null,
        learnerFile: null,
        publishedCriteriaDigest: '942a0c6b8fd82cfd56cc08e1532bfb1e8280eed25ab13e9eba784e996103fd0b',
        functionalGroups: [],
        manualCategories: [
          {
            key: 'causal-checkpoint-one',
            points: 1,
            criterion:
              'First causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
          {
            key: 'causal-checkpoint-two',
            points: 1,
            criterion:
              'Second causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
        ],
      },
      {
        questionKey: 'q8',
        kind: 'debug_with_reason',
        functionName: 'SumAll',
        learnerFile: 'sumall.go',
        publishedCriteriaDigest: '8fcd74c54e1978b6a03d9166f7b7b7cf68e7c0aa42d39db0ea486ab2ea522c62',
        functionalGroups: [
          {
            key: 'ordinary-sum',
            points: 3,
            criterion: 'Sums every element in an ordinary in-domain list',
            criteriaDigest: 'c2c5d5601b27bce314b141a825c67ad0563a680cf7c08d52fee9620ab51e286f',
          },
          {
            key: 'signed-zero',
            points: 2,
            criterion: 'Handles signed and zero values within the declared bounds',
            criteriaDigest: '2093471f2cd772ccf932c3cdbd6051393aec7bd3ce1965f54b059eecbd20d928',
          },
          {
            key: 'singleton',
            points: 2,
            criterion: 'Handles one-element input',
            criteriaDigest: '18b7686d0257855af583b9bc301a5f65321e7ee02d6b6fecf926613e8a936bbf',
          },
          {
            key: 'nil-empty',
            points: 2,
            criterion: 'Empty and nil slices return zero',
            criteriaDigest: '0aec309782a69fcf58fed1e9bec59aec50a0fe255b0976ed052376c10a423e25',
          },
        ],
        manualCategories: [
          {
            key: 'counterexample-input',
            points: 2,
            criterion: 'Provides an in-domain concrete input that exposes the published defect',
          },
          {
            key: 'counterexample-effect',
            points: 2,
            criterion: 'Correctly describes the original-versus-repaired behavior for that input',
          },
          {
            key: 'defect-reason',
            points: 1,
            criterion: 'Explains the published defect mechanism; equivalent wording accepted',
          },
          {
            key: 'repair-reason',
            points: 1,
            criterion: 'Explains why the repair works; equivalent wording accepted',
          },
        ],
      },
    ],
    draftSha256: '05d5d00a7d7f1d5a385a30dd9b59fbeaebd80104dc1d48ea0f1172903dfc6578',
  },
  {
    version: 1,
    form: 'D',
    status: 'source-reviewed-owner-approved-policy',
    paperSha256: 'a6246dab869f14c60bfda3ed896865c1fa64c90176e7f7d3f5f9877410cd8151',
    weightsOwnerApproved: true,
    traceComparator: EXAM_TRACE_COMPARATOR_V1,
    questions: [
      {
        questionKey: 'q1',
        kind: 'coding',
        functionName: 'SupplyCost',
        learnerFile: 'supplycost.go',
        publishedCriteriaDigest: '19c0a38908e4b8c1d90f0aed2d77cddca1dcb10e19ebd826d82af2e2327cd8e9',
        functionalGroups: [
          {
            key: 'ordinary-branch-one',
            points: 4,
            criterion: 'Nonzero product below 24 receives the charge',
            criteriaDigest: '4b926676f81bf66c5b8411c49e5427d48f261a1fba0626bdc9b82cc3af7f5e4f',
          },
          {
            key: 'ordinary-branch-two',
            points: 4,
            criterion: 'Nonzero product above 24 receives no charge',
            criteriaDigest: '162dd0268a40652282168927fd26e225769b52834325bdc64c7b8785064e9fca',
          },
          {
            key: 'exact-threshold',
            points: 3,
            criterion: 'Product exactly 24 receives the charge',
            criteriaDigest: '14c4e61b6be9585db32b20957e79593ef930c598a3a6a59bf62ef9e1778c9a9c',
          },
          {
            key: 'zero-override',
            points: 2,
            criterion: 'Zero quantity overrides the extra charge',
            criteriaDigest: 'e41193860b248af1b368d3e48df5f75a71165439f9f8b72510319a8a1acd5a4e',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q2',
        kind: 'coding',
        functionName: 'MirrorOffset',
        learnerFile: 'mirroroffset.go',
        publishedCriteriaDigest: 'b06e5e5434ecdbf2dfd87e921854610c00eb5f785f9de33f3f1506a08a895a14',
        functionalGroups: [
          {
            key: 'ordinary-mutation',
            points: 5,
            criterion: 'Replaces the original caller target with base minus old target',
            criteriaDigest: '0fd94ff81b9c7485065d44e97c227544b25ac9cd8e05fdab5c698a29a48f714f',
          },
          {
            key: 'signed-operands',
            points: 5,
            criterion: 'Signed and asymmetric operands retain the declared operand order',
            criteriaDigest: '061490d1bd854e58c9a87e9347d27f851c6520cf62273e5ba1a255ca49202306',
          },
          {
            key: 'zero-operands',
            points: 3,
            criterion: 'Zero base or target follows the same subtraction rule',
            criteriaDigest: '2307da5243eeff059017e121fa6b417932b1c59534975dc77f8d12739cc91763',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q3',
        kind: 'coding',
        functionName: 'CountBetween',
        learnerFile: 'countbetween.go',
        publishedCriteriaDigest: 'b777b97faf567f48d8eb754ba9bcc70736e931432c630b9e0538abbc9c7dca17',
        functionalGroups: [
          {
            key: 'range-classification',
            points: 5,
            criterion: 'Counts strictly greater than low and less than high',
            criteriaDigest: '55d6174bb69a530a8971f70384a81d674e971ce98ac99882a2f230cf44763be4',
          },
          {
            key: 'endpoints',
            points: 2,
            criterion: 'Both endpoints are excluded',
            criteriaDigest: '86aa5209aea94fdea5d0f286aa90b9ae7f4c2953f8673eca8d2397e8a0026c27',
          },
          {
            key: 'equal-bounds',
            points: 2,
            criterion: 'Equal bounds return zero',
            criteriaDigest: 'e853655a1942e589e8e6eaed11cd72306943734fdba4783918c06687b757ed1e',
          },
          {
            key: 'duplicates',
            points: 2,
            criterion: 'Repeated elements count separately',
            criteriaDigest: 'b10c318ebc4954e3476dfacdb523d07267430c6734ce8aa9285e278f2925d861',
          },
          {
            key: 'nil-empty',
            points: 2,
            criterion: 'Empty and nil slices return zero',
            criteriaDigest: '8f24b61ff25e5080dd762cc3bf98fcaffd8bb40d8d3f020e9a3f26f2f6356c0a',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q4',
        kind: 'coding',
        functionName: 'CountDisplayRunes',
        learnerFile: 'countdisplayrunes.go',
        publishedCriteriaDigest: 'a5b9f11f190de6c1bfd97250eeb2262c7e632c07c92ac1cef7eaf4210add9229',
        functionalGroups: [
          {
            key: 'ordinary-runes',
            points: 4,
            criterion: 'Counts included ordinary runes while excluding ASCII zero',
            criteriaDigest: '5035a6e122fc119753156da163134909d1cb120fa98b313ce6a380e62426e775',
          },
          {
            key: 'multibyte-runes',
            points: 5,
            criterion: 'Valid multibyte Latin/Arabic-domain runes count by rune',
            criteriaDigest: 'da2d67c77424569d38ac750639f8f1916dd24ae05adddfd69838a766f29b09ad',
          },
          {
            key: 'empty-excluded',
            points: 2,
            criterion: 'Empty or all-ASCII-zero text returns zero',
            criteriaDigest: '07a274ccf206b5a6c012eef8d21fbdad7574c895beebfcee48401d7bea60bdac',
          },
          {
            key: 'character-distinction',
            points: 2,
            criterion: 'Spaces and Arabic zero count; only U+0030 is excluded',
            criteriaDigest: 'a72023e01df176b3c7959fb6138a0b3b74d846a666b801d6c9a74497c4c8de13',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q5',
        kind: 'coding',
        functionName: 'ReadUnits',
        learnerFile: 'readunits.go',
        publishedCriteriaDigest: '758c9b66e645e9742a03a4f61afa9aedeb5692e4f461b6fc6e2b108251ffbc1d',
        functionalGroups: [
          {
            key: 'valid-lengths',
            points: 3,
            criterion: 'One, two and three digit valid tags',
            criteriaDigest: '77441304d81deaef6bdc5e212e72654e934c9b3a6d714d2811d14c7b09e15d44',
          },
          {
            key: 'leading-zeroes',
            points: 2,
            criterion: 'Leading ASCII zeroes remain valid',
            criteriaDigest: '84e3b7b533b640d3fb5970345c41512686185148bc064b92c65a86b9a7362507',
          },
          {
            key: 'marker-length',
            points: 4,
            criterion: 'Exactly one trailing lowercase u and the declared length',
            criteriaDigest: 'e760cc064fc59181aeddb2f5b8fa578bcd0cf6bb5645fd4bf5ba4e4cf5d4d396',
          },
          {
            key: 'ascii-full-input',
            points: 4,
            criterion: 'ASCII digits only and the entire input must be valid',
            criteriaDigest: '724c806e4f9fdb98dd206ebcf451feeb60d068f53f47a9b400cdf119a82a597a',
          },
        ],
        manualCategories: [
          {
            key: 'published-signature',
            points: 1,
            criterion: 'Matches the published function signature',
          },
          {
            key: 'published-obligations',
            points: 1,
            criterion:
              'Meets the remaining published return/mutation/no-print/preservation and requested method obligations; no style or invented restriction',
          },
        ],
      },
      {
        questionKey: 'q6',
        kind: 'trace_with_reason',
        functionName: null,
        learnerFile: null,
        publishedCriteriaDigest: '453d43c0ff94bbe50fdc10b61a5401d6670d00b410aef7fc574bf11a8d160e65',
        functionalGroups: [],
        manualCategories: [
          {
            key: 'causal-checkpoint-one',
            points: 1,
            criterion:
              'First causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
          {
            key: 'causal-checkpoint-two',
            points: 1,
            criterion:
              'Second causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
        ],
      },
      {
        questionKey: 'q7',
        kind: 'trace_with_reason',
        functionName: null,
        learnerFile: null,
        publishedCriteriaDigest: '0dbcb6e82ebb6bdc6b4433efcc46c89a4bc9a1bf60a9750269db9cc3cb6df131',
        functionalGroups: [],
        manualCategories: [
          {
            key: 'causal-checkpoint-one',
            points: 1,
            criterion:
              'First causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
          {
            key: 'causal-checkpoint-two',
            points: 1,
            criterion:
              'Second causal checkpoint from the independently reviewed private mentor rubric; equivalent explanations accepted without required terminology',
          },
        ],
      },
      {
        questionKey: 'q8',
        kind: 'debug_with_reason',
        functionName: 'SumAll',
        learnerFile: 'sumall.go',
        publishedCriteriaDigest: '007aa504ffdcd707ed79e45cffd4fd95ea91688b40c7256446dd83c3f126820f',
        functionalGroups: [
          {
            key: 'ordinary-sum',
            points: 3,
            criterion: 'Sums every element in an ordinary in-domain list',
            criteriaDigest: 'f27f9a6e606cc97c0fd0e8bf497875a01e844e91d379e82f04d3e93198ceda9b',
          },
          {
            key: 'signed-zero',
            points: 2,
            criterion: 'Handles signed and zero values within the declared bounds',
            criteriaDigest: '6c625bac239701650d82ddbdae97ea4cedd121ccc5c8a8c2be9ebe64cdb7f434',
          },
          {
            key: 'singleton',
            points: 2,
            criterion: 'Handles one-element input',
            criteriaDigest: '5fb5304b3f47e4e1d70c9ed1f870bcac406a8491bc59fe41dc00eaf9586210f3',
          },
          {
            key: 'nil-empty',
            points: 2,
            criterion: 'Empty and nil slices return zero',
            criteriaDigest: '6851fc60a266ce4293484fcb5c35ce4802576638d1a34afb3997316e17109f84',
          },
        ],
        manualCategories: [
          {
            key: 'counterexample-input',
            points: 2,
            criterion: 'Provides an in-domain concrete input that exposes the published defect',
          },
          {
            key: 'counterexample-effect',
            points: 2,
            criterion: 'Correctly describes the original-versus-repaired behavior for that input',
          },
          {
            key: 'defect-reason',
            points: 1,
            criterion: 'Explains the published defect mechanism; equivalent wording accepted',
          },
          {
            key: 'repair-reason',
            points: 1,
            criterion: 'Explains why the repair works; equivalent wording accepted',
          },
        ],
      },
    ],
    draftSha256: 'dc452d7d11281ddb2fabe598dba63da1b64af630bbf4ded1cfe0dd7bceb2a14c',
  },
] as const;

for (const draft of drafts) freeze(draft);
export function getExam1RubricDraft(form: ExamForm) {
  const draft = drafts.find((item) => item.form === form);
  if (!draft) throw new Error('EXAM1_RUBRIC_FORM');
  return draft;
}
/** A frozen candidate is not permission to publish, evaluate or connect a service.
 * sha256 must be the trusted adapter's SHA256 over the exact supplied UTF-8 string.
 * This pure function does not read files, validate owner identity, or infer missing policy.
 */
export function prepareExam1ScoringRubric(
  input: Exam1RubricPreparation,
  sha256: (utf8: string) => string,
) {
  const draft = getExam1RubricDraft(input.form);
  const reasons: string[] = [];
  if (!hashPattern.test(input.definitionDigest)) reasons.push('definition_digest_unavailable');
  if (draft.paperSha256 === null) reasons.push('learner_source_unavailable');
  if (input.publishedPaperSha256 !== draft.paperSha256 || input.publishedPaperSha256 === null)
    reasons.push('published_paper_not_bound');
  const decision = input.decisions;
  if (
    !decision ||
    !ownerMessagePattern.test(decision.weightsOwnerMessageId ?? '') ||
    decision.approvedDraftSha256 !== draft.draftSha256
  )
    reasons.push('exact_draft_weights_not_approved');
  if (
    !decision ||
    decision.traceComparator !== EXAM_TRACE_COMPARATOR_V1 ||
    !ownerMessagePattern.test(decision.traceComparatorOwnerMessageId ?? '')
  )
    reasons.push('trace_comparator_not_approved');
  if (!decision || !hashPattern.test(decision.manualCriteriaSha256 ?? ''))
    reasons.push('manual_criteria_not_bound');
  if (reasons.length)
    return freeze({ available: false as const, runtimeEnabled: false as const, reasons });
  // A candidate uses only the exact source-reviewed learner paper for its selected form.
  const questions = draft.questions.map((question) => ({
    questionKey: question.questionKey as ExamQuestionKey,
    kind: question.kind,
    publishedCriteriaDigest: question.publishedCriteriaDigest!,
    groupBasis: 'fixed_semantic' as const,
    functionalGroups: question.functionalGroups.map((group) => ({
      key: group.key,
      points: group.points,
      criteriaDigest: group.criteriaDigest,
    })),
  }));
  const body = {
    version: 1 as const,
    form: input.form,
    definitionDigest: input.definitionDigest,
    questions,
  };
  // Matches app.checkpoint_digest(rubric - 'digest', '01coding-exam-scoring-rubric').
  // Source/approval metadata has a separate immutable digest; never conflate it
  // with the interoperable pure rubric body digest consumed by SQL and scoring.
  const digest = sha256('01coding-exam-scoring-rubric\0v1\0' + canonical(body));
  const sourceBinding = {
    draftSha256: draft.draftSha256,
    paperSha256: draft.paperSha256,
    decisions: decision!,
    rubric: body,
  };
  const sourceBindingDigest = sha256(
    'nextera-exam1-rubric-source-binding\0v1\0' + canonical(sourceBinding),
  );
  if (!hashPattern.test(digest) || !hashPattern.test(sourceBindingDigest))
    throw new Error('EXAM1_RUBRIC_DIGEST');
  const rubric: ExamScoringRubric = { ...body, digest };
  validateExamScoringRubric(rubric);
  return freeze({
    available: true as const,
    runtimeEnabled: false as const,
    rubric,
    sourceBinding,
    sourceBindingDigest,
    traceComparator: EXAM_TRACE_COMPARATOR_V1,
    manualCriteriaSha256: decision!.manualCriteriaSha256!,
    draftSha256: draft.draftSha256,
    paperSha256: draft.paperSha256!,
  });
}
