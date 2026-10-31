/** Exact DRAFT0030 write-window pins. These are catalog/source attestations,
 * not proof of native clock, locking or persistence behavior. Existing retained
 * GET semantics remain unchanged; unrepaired writes stay unavailable. */
export const CHECKPOINT_CODE_DRAFT_WRITE_SHA256 =
  '6d71f2c99726c7ff48fbdcd7a2d2b8152f59ccf248524edb92dde0fc57c033e2';
export const CHECKPOINT_TYPED_DRAFT_WRITE_SHA256 =
  '3e365dc7b40317d902e7bd8aca489df93bcd30020ee045a9e4c523efdf7892c6';
export const CHECKPOINT_CODE_DRAFT_WRITE_WINDOW_SQL = `EXISTS(
 SELECT FROM pg_catalog.pg_proc p
 WHERE p.oid=pg_catalog.to_regprocedure('app.save_checkpoint_draft(uuid,uuid,text,text,uuid,bigint,bytea,text)')
 AND pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8'))=pg_catalog.decode('${CHECKPOINT_CODE_DRAFT_WRITE_SHA256}','hex'))`;
export const CHECKPOINT_TYPED_DRAFT_WRITE_WINDOW_SQL = `EXISTS(
 SELECT FROM pg_catalog.pg_proc p
 WHERE p.oid=pg_catalog.to_regprocedure('app.save_checkpoint_answer_draft(uuid,uuid,text,text,text,uuid,bigint,bytea,text)')
 AND pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8'))=pg_catalog.decode('${CHECKPOINT_TYPED_DRAFT_WRITE_SHA256}','hex'))`;
