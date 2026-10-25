// Only the native Email handler or an accepted incoming-folder source proof
// calls this. An arbitrary historical /api/import is never a new-mail event.
export function ingressStatement(env, emailId, kind, sourceAt) {
  return env.MAILDB.prepare(`INSERT OR IGNORE INTO mail_notice_ingress(email_id,kind,source_at)
    SELECT id,?,? FROM emails WHERE id=?
    AND id>CAST((SELECT v FROM mail_notice_meta WHERE k='floor_id') AS INTEGER)`)
    .bind(kind, sourceAt, emailId);
}

export function nativeIngressStatement(env, messageId, sourceAt) {
  return env.MAILDB.prepare(`INSERT OR IGNORE INTO mail_notice_ingress(email_id,kind,source_at)
    SELECT id,'native',? FROM emails WHERE message_id=?
    AND id>CAST((SELECT v FROM mail_notice_meta WHERE k='floor_id') AS INTEGER)`)
    .bind(sourceAt, messageId);
}
