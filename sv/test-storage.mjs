import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SQLiteD1,FileObjects} from './storage.mjs';
const root=await mkdtemp(join(tmpdir(),'mailhub-storage-test-'));
try{
  const db=new SQLiteD1(join(root,'mail.db'));
  await db.exec('CREATE TABLE rows(id INTEGER PRIMARY KEY,v TEXT UNIQUE);');
  await db.batch([db.prepare('INSERT INTO rows VALUES(?,?)').bind(1,'a'),db.prepare('INSERT INTO rows VALUES(?,?)').bind(2,'b')]);
  await assert.rejects(db.batch([db.prepare('INSERT INTO rows VALUES(?,?)').bind(3,'c'),db.prepare('INSERT INTO rows VALUES(?,?)').bind(4,'a')]));
  assert.equal(await db.prepare('SELECT count(*) AS n FROM rows').first('n'),2);
  db.close();const reopen=new SQLiteD1(join(root,'mail.db'));assert.equal(await reopen.prepare('SELECT v FROM rows WHERE id=?').bind(2).first('v'),'b');reopen.close();
  const objects=new FileObjects(join(root,'objects'));
  const key='raw/../../original.eml';const raw=Buffer.from([0,10,13,128,255]);
  await objects.put(key,raw,{customMetadata:{raw_sha256:'evidence'}});
  assert.deepEqual(Buffer.from(await(await objects.get(key)).arrayBuffer()),raw);
  assert.equal((await objects.head(key)).customMetadata.raw_sha256,'evidence');
  assert.equal(await objects.get('missing'),null);
  const path=objects.path(key);const packed=await readFile(path);packed[packed.length-1]^=1;await writeFile(path,packed);await assert.rejects(objects.get(key),/object_corrupt/);
  await objects.delete(key);assert.equal(await objects.get(key),null);
  console.log('storage: atomic transaction rollback, reopen, binary object, metadata, traversal and corruption checks passed');
}finally{await rm(root,{recursive:true,force:true});}
