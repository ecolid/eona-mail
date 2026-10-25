"""Durable flag/move reconciliation; uncertain COPY is never replayed."""
import datetime
import email
import email.policy
import hashlib
import json
import re


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def proof(copy):
    return {key: str(copy[key]) for key in ('account', 'folder', 'validity', 'uid')}


def op_id(copy, revision):
    value = json.dumps([proof(copy), revision], sort_keys=True)
    return hashlib.sha256(value.encode()).hexdigest()


class Unknown(RuntimeError):
    pass


class StateSync:
    def __init__(self, db, objects, raw_reader):
        self.db, self.objects, self.raw_reader = db, objects, raw_reader
        db.row_factory = __import__('sqlite3').Row

    def rows(self, sql, args=()):
        return [dict(row) for row in self.db.execute(sql, args)]

    def observe(self, account, remote, folders):
        copies = self.rows("SELECT c.*,s.restore_folder,s.present AS was_present,s.flagged AS was_flagged FROM product_source_copies c LEFT JOIN product_copy_state s USING(account,folder,validity,uid) WHERE c.account=? AND c.kind NOT IN ('sent','drafts')", (account,))
        allowed = {f['name'] for f in folders}
        if any(c['folder'] not in allowed for c in copies):
            raise RuntimeError('state_folder_unconfigured')
        observations = {folder: remote.inventory(folder) for folder in {c['folder'] for c in copies}}
        changes = {}
        with self.db:
            for copy in copies:
                validity, items = observations[copy['folder']]
                item = items.get(int(copy['uid'])) if validity == str(copy['validity']) else None
                migrated=self.db.execute('SELECT 1 FROM product_migrated_emails WHERE email_id=?',(copy['email_id'],)).fetchone()
                first=copy['was_present'] is None
                initial=first and not migrated
                delta=changes.setdefault(copy['email_id'],[False,False,False])
                delta[0] |= bool(item and (initial or (not first and bool(copy['seen'])!=bool(item['seen']))))
                delta[1] |= bool(item and (initial or (not first and bool(copy['was_flagged'])!=bool(item['flagged']))))
                delta[2] |= bool(initial or (not first and bool(copy['was_present'])!=bool(item is not None)))
                self.db.execute('INSERT INTO product_copy_state VALUES(?,?,?,?,?,?,?) ON CONFLICT(account,folder,validity,uid) DO UPDATE SET present=excluded.present,flagged=excluded.flagged WHERE product_copy_state.present<>excluded.present OR product_copy_state.flagged<>excluded.flagged', (*proof(copy).values(), int(item is not None), int(bool(item and item['flagged'])), copy['restore_folder'] or ''))
                if item:
                    self.db.execute('UPDATE product_source_copies SET seen=? WHERE account=? AND folder=? AND validity=? AND uid=? AND seen<>?', (int(item['seen']), *proof(copy).values(),int(item['seen'])))
            changed={email_id for email_id,delta in changes.items() if any(delta)}
            if not changed:
                return
            self.db.execute('UPDATE product_state_guard SET remote_apply=1 WHERE id=1')
            for email_id in changed:
                pending = self.db.execute("SELECT 1 FROM product_state_intents WHERE email_id=? AND state<>'confirmed'", (email_id,)).fetchone()
                if pending:
                    continue
                live = self.rows("SELECT c.kind,c.seen,s.flagged FROM product_source_copies c JOIN product_copy_state s USING(account,folder,validity,uid) WHERE c.email_id=? AND s.present=1 AND c.kind NOT IN ('sent','drafts')", (email_id,))
                if live:
                    current=dict(self.db.execute('SELECT is_read,is_starred,folder FROM emails WHERE id=?',(email_id,)).fetchone())
                    delta=changes[email_id]
                    self.db.execute('UPDATE emails SET is_read=?,is_starred=?,folder=? WHERE id=?', (int(any(c['seen'] for c in live)) if delta[0] else current['is_read'], int(any(c['flagged'] for c in live)) if delta[1] else current['is_starred'], ('inbox' if any(c['kind'] != 'trash' for c in live) else 'trash') if delta[2] else current['folder'], email_id))
            self.db.execute('UPDATE product_state_guard SET remote_apply=0 WHERE id=1')

    def _prepare(self, copy, intent):
        desired = {k: intent[k] for k in ('is_read', 'is_starred', 'folder')}
        key = op_id(copy, intent['revision'])
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO product_state_ops(id,email_id,revision,account,proof_json,desired_json,state,error,updated_at,destination_json) VALUES(?,?,?,?,?,?,'prepared','',?,'')", (key, copy['email_id'], intent['revision'], copy['account'], json.dumps(proof(copy)), json.dumps(desired), stamp()))
        return key

    def _execute(self, op, remote, folders):
        source = json.loads(op['proof_json'])
        copy = self.db.execute('SELECT c.*,s.restore_folder FROM product_source_copies c LEFT JOIN product_copy_state s USING(account,folder,validity,uid) WHERE c.account=? AND c.folder=? AND c.validity=? AND c.uid=?', tuple(source.values())).fetchone()
        if not copy:
            raise Unknown('state_source_proof_missing')
        copy = dict(copy)
        desired = json.loads(op['desired_json'])
        candidates = [f['name'] for f in folders if f['kind'] == ('trash' if desired['folder'] == 'trash' else 'inbox')]
        if desired['folder'] != 'trash':
            if copy['kind'] != 'trash':candidates=[copy['folder']]
            elif copy['restore_folder']:candidates=[copy['restore_folder']] if any(f['name']==copy['restore_folder'] and f['kind'] not in ('trash','sent','drafts') for f in folders) else []
        if len(candidates) != 1:
            raise RuntimeError('source_target_folder_ambiguous')
        target = candidates[0]
        if source['folder'] not in {f['name'] for f in folders}:
            raise RuntimeError('state_folder_unconfigured')
        if source['folder'] == target:
            remote.flags(copy, desired)
        else:
            raw = self.raw_reader(self.objects, copy['raw_key'])
            receipt = json.loads(op['destination_json']) if op['destination_json'] else None
            if op['state'] == 'prepared':
                with self.db:
                    self.db.execute("UPDATE product_state_ops SET state='copying',updated_at=? WHERE id=?", (stamp(), op['id']))
                # The journal commits before COPY. A lost reply is reconciled by
                # exact original bytes and can never trigger a second COPY.
                try:
                    receipt = remote.copy(copy, target)
                except Exception:
                    receipt = None
                if receipt:
                    with self.db:
                        self.db.execute('UPDATE product_state_ops SET destination_json=?,updated_at=? WHERE id=?', (json.dumps(receipt), stamp(), op['id']))
            matches = remote.find(target, raw, receipt)
            if len(matches) != 1:
                raise Unknown('copy_confirmation_pending' if not matches else 'copy_confirmation_ambiguous')
            destination = {**copy, **matches[0], 'folder': target, 'kind': next(f['kind'] for f in folders if f['name']==target)}
            # Both target bytes and target flags are confirmed before a targeted
            # removal. An old UIDVALIDITY is never a valid deletion capability.
            remote.flags(destination, desired)
            remote.retire(copy)
            with self.db:
                self.db.execute('INSERT INTO product_source_copies(account,folder,validity,uid,email_id,raw_key,raw_sha,source_at,kind,seen) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account,folder,validity,uid) DO UPDATE SET seen=excluded.seen', (*proof(destination).values(), copy['email_id'], copy['raw_key'], copy['raw_sha'], stamp(), destination['kind'], desired['is_read']))
                self.db.execute('INSERT INTO product_copy_state VALUES(?,?,?,?,1,?,?) ON CONFLICT(account,folder,validity,uid) DO UPDATE SET present=1,flagged=excluded.flagged,restore_folder=excluded.restore_folder', (*proof(destination).values(), desired['is_starred'], copy['restore_folder'] or (copy['folder'] if copy['kind'] != 'trash' else '')))
                self.db.execute('UPDATE product_copy_state SET present=0 WHERE account=? AND folder=? AND validity=? AND uid=?', tuple(source.values()))
                key = self._prepare(destination, {'revision': op['revision'], **desired})
                self.db.execute("UPDATE product_state_ops SET state='confirmed' WHERE id=?", (key,))
        with self.db:
            self.db.execute("UPDATE product_state_ops SET state='confirmed',error='',updated_at=? WHERE id=?", (stamp(), op['id']))

    def push(self, account, remote, folders):
        errors = []
        # Reconcile older unfinished effects before issuing a newer local edit.
        for op in self.rows("SELECT * FROM product_state_ops WHERE account=? AND state<>'confirmed' ORDER BY updated_at,id", (account,)):
            self._attempt(op, remote, folders, errors)
        copies = self.rows("SELECT c.* FROM product_source_copies c JOIN product_copy_state s USING(account,folder,validity,uid) WHERE c.account=? AND s.present=1 AND c.kind NOT IN ('sent','drafts')", (account,))
        for copy in copies:
            intent = self.db.execute("SELECT * FROM product_state_intents WHERE email_id=? AND state<>'confirmed'", (copy['email_id'],)).fetchone()
            if not intent:
                continue
            # An unknown older operation blocks new effects on this message.
            if self.db.execute("SELECT 1 FROM product_state_ops WHERE email_id=? AND state<>'confirmed'", (copy['email_id'],)).fetchone():
                continue
            key = self._prepare(copy, dict(intent))
            op = dict(self.db.execute('SELECT * FROM product_state_ops WHERE id=?', (key,)).fetchone())
            if op['state'] != 'confirmed':
                self._attempt(op, remote, folders, errors)
        return errors

    def _attempt(self, op, remote, folders, errors):
        try:
            self._execute(op, remote, folders)
        except Exception as error:
            code = str(error) if isinstance(error, RuntimeError) and re.fullmatch('[a-z_]+', str(error)) else 'source_operation_unknown'
            with self.db:
                self.db.execute("UPDATE product_state_ops SET state='unknown',error=?,updated_at=? WHERE id=?", (code, stamp(), op['id']))
                self.db.execute("UPDATE product_state_intents SET state='unknown',error=? WHERE email_id=? AND revision=?", (code, op['email_id'], op['revision']))
            errors.append(code)

    def complete(self):
        pending = []
        for row in self.rows("SELECT * FROM product_state_intents WHERE state<>'confirmed'"):
            copies = self.rows("SELECT c.* FROM product_source_copies c JOIN product_copy_state s USING(account,folder,validity,uid) WHERE c.email_id=? AND s.present=1 AND c.kind NOT IN ('sent','drafts')", (row['email_id'],))
            unfinished = self.db.execute("SELECT 1 FROM product_state_ops WHERE email_id=? AND state<>'confirmed'", (row['email_id'],)).fetchone()
            if copies and not unfinished and all(self.db.execute("SELECT 1 FROM product_state_ops WHERE id=? AND state='confirmed'", (op_id(copy, row['revision']),)).fetchone() for copy in copies):
                with self.db:
                    self.db.execute("UPDATE product_state_intents SET state='confirmed',error='' WHERE email_id=? AND revision=?", (row['email_id'], row['revision']))
            else:
                pending.append(row['email_id'])
        return pending


class IMAPState:
    def __init__(self, remote):
        self.r, self.c = remote, remote.c

    def inventory(self, folder):
        validity = self.r.select(folder)
        status, data = self.c.uid('SEARCH', None, 'ALL')
        if status != 'OK' or not data or not isinstance(data[0], bytes):
            raise RuntimeError('state_inventory_failed')
        uids, out = data[0].split(), {}
        if any(not uid.isdigit() for uid in uids) or len(set(uids)) != len(uids):
            raise RuntimeError('state_inventory_invalid')
        for start in range(0, len(uids), 250):
            status, rows = self.c.uid('FETCH', b','.join(uids[start:start + 250]).decode(), '(UID FLAGS)')
            if status != 'OK':
                raise RuntimeError('state_inventory_failed')
            for part in rows or []:
                raw = part[0] if isinstance(part, tuple) else part
                if not isinstance(raw, bytes):
                    continue
                uid = re.search(rb'\bUID (\d+)', raw)
                flags = re.search(rb'FLAGS \(([^)]*)\)', raw)
                if uid and flags:
                    values = flags[1].lower().split()
                    out[int(uid[1])] = {'seen': b'\\seen' in values, 'flagged': b'\\flagged' in values}
        if set(out) != set(map(int, uids)):
            raise RuntimeError('state_inventory_changed')
        return validity, out

    def flags(self, item, desired):
        if self.r.select(item['folder'], write=True) != str(item['validity']):
            raise Unknown('state_uidvalidity_changed')
        if not self.r.exists(item):
            raise Unknown('state_source_missing')
        self.r.select(item['folder'], write=True)
        for key, flag in [('is_read', '\\Seen'), ('is_starred', '\\Flagged')]:
            status, _ = self.c.uid('STORE', str(item['uid']), '+FLAGS.SILENT' if desired[key] else '-FLAGS.SILENT', '(' + flag + ')')
            if status != 'OK':
                raise Unknown('state_flags_unconfirmed')
        validity, items = self.inventory(item['folder'])
        actual = items.get(int(item['uid']))
        if validity != str(item['validity']) or not actual or actual['seen'] != bool(desired['is_read']) or actual['flagged'] != bool(desired['is_starred']):
            raise Unknown('state_flags_unconfirmed')

    def copy(self, item, target):
        if 'UIDPLUS' not in self.r.cap:
            raise RuntimeError('targeted_expunge_unavailable')
        if self.r.select(item['folder']) != str(item['validity']):
            raise Unknown('state_uidvalidity_changed')
        name = self.r.encode(target)
        status, _ = self.c.uid('COPY', str(item['uid']), '"' + name.replace('\\', '\\\\').replace('"', '\\"') + '"')
        if status != 'OK':
            raise Unknown('copy_confirmation_pending')
        response = self.c.response('COPYUID')
        data = b' '.join(p for p in (response[1] or []) if isinstance(p, bytes)) if response else b''
        match = re.fullmatch(rb'(\d+) (\d+) (\d+)', data)
        if match and int(match[2]) == int(item['uid']):
            return {'validity': match[1].decode(), 'uid': match[3].decode()}
        return None

    def find(self, target, expected, receipt=None):
        validity = self.r.select(target)
        if receipt:
            if validity != receipt['validity']:
                raise Unknown('state_uidvalidity_changed')
            uids = [str(receipt['uid']).encode()]
        else:
            mid = email.message_from_bytes(expected, policy=email.policy.default).get('Message-ID')
            if not mid or len(str(mid)) > 998 or any(c in str(mid) for c in '\r\n'):
                raise Unknown('copy_identity_missing')
            status, data = self.c.uid('SEARCH', None, 'HEADER', 'Message-ID', '"' + str(mid).replace('\\', '\\\\').replace('"', '\\"') + '"')
            if status != 'OK' or not data:
                raise Unknown('copy_lookup_failed')
            uids = data[0].split()
        if len(uids) > 1000 or any(not uid.isdigit() for uid in uids):
            raise Unknown('copy_lookup_ambiguous')
        matches = []
        for uid in uids:
            item = {'folder': target, 'validity': validity, 'uid': int(uid)}
            if hashlib.sha256(self.r.raw(item)).digest() == hashlib.sha256(expected).digest():
                matches.append({'validity': validity, 'uid': str(int(uid))})
        return matches

    def retire(self, item):
        if self.r.select(item['folder']) != str(item['validity']):
            raise Unknown('state_uidvalidity_changed')
        self.r.delete_uid(item)
        if self.r.exists(item):
            raise Unknown('state_retirement_unconfirmed')
