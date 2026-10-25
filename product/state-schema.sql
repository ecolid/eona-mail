CREATE TABLE IF NOT EXISTS product_migrated_emails(email_id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS product_state_guard(id INTEGER PRIMARY KEY CHECK(id=1),remote_apply INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO product_state_guard VALUES(1,0);
CREATE TABLE IF NOT EXISTS product_copy_state(account TEXT,folder TEXT,validity TEXT,uid TEXT,present INTEGER NOT NULL DEFAULT 1,flagged INTEGER NOT NULL DEFAULT 0,restore_folder TEXT NOT NULL DEFAULT '',PRIMARY KEY(account,folder,validity,uid));
CREATE TABLE IF NOT EXISTS product_state_intents(email_id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,is_read INTEGER NOT NULL,is_starred INTEGER NOT NULL,folder TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS product_state_ops(id TEXT PRIMARY KEY,email_id INTEGER NOT NULL,revision INTEGER NOT NULL,account TEXT NOT NULL,proof_json TEXT NOT NULL,desired_json TEXT NOT NULL,state TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,destination_json TEXT NOT NULL DEFAULT '');
CREATE TRIGGER IF NOT EXISTS product_mail_state_intent AFTER UPDATE OF is_read,is_starred,folder ON emails
WHEN (SELECT remote_apply FROM product_state_guard WHERE id=1)=0 AND (OLD.is_read<>NEW.is_read OR OLD.is_starred<>NEW.is_starred OR (OLD.folder='trash' AND NEW.folder='inbox') OR (OLD.folder<>'trash' AND NEW.folder='trash'))
BEGIN
INSERT INTO product_state_intents(email_id,revision,is_read,is_starred,folder,state,error,updated_at) VALUES(NEW.id,1,NEW.is_read,NEW.is_starred,NEW.folder,'pending','',datetime('now'))
ON CONFLICT(email_id) DO UPDATE SET revision=product_state_intents.revision+1,is_read=excluded.is_read,is_starred=excluded.is_starred,folder=excluded.folder,state='pending',error='',updated_at=excluded.updated_at;
END;
