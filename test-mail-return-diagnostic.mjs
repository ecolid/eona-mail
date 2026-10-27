import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMailReturnDiagnostic} from './src/mail-return-diagnostic.js';

test('return diagnostics is inert unless explicitly enabled in this page',()=>{
 const forbidden=new Proxy({},{get(){throw Error('disabled diagnostics accessed the document')}});
 const handle=bindMailReturnDiagnostic({root:forbidden,buildSource:'',document:forbidden,window:{URLSearchParams,location:{search:''}}});
 assert.doesNotThrow(()=>handle.dispose());
});
