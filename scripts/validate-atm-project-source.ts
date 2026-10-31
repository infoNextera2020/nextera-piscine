import { fileURLToPath } from 'node:url';
import {
  readLocalAtmProjectFiles,
  validateAtmProjectSource,
} from './curriculum/atm-project-source';
const repository = fileURLToPath(new URL('../', import.meta.url));
const checked = validateAtmProjectSource(readLocalAtmProjectFiles(repository));
process.stdout.write(
  JSON.stringify(
    {
      status: 'source_validated_only',
      packageId: checked.source.packageId,
      semanticProfileDigest: checked.source.semanticProfileDigest,
      contentDigest: checked.contentDigest,
      publicResources: checked.source.resources.map(({ path, sha256, byteLength }) => ({
        path,
        sha256,
        byteLength,
      })),
      runtimeReadiness: checked.runtimeReadiness,
      missingRuntimeConfiguration: [
        'approved_catalog_artifacts_images',
        'compilation_execution_resource_policy',
        'immutable_input_only_test_pack',
        'cohort_release_schedule',
        'trusted_capture_and_result_application',
      ],
      publicationAttempted: false,
    },
    null,
    2,
  ) + '\n',
);
