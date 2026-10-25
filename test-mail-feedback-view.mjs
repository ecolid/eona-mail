import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailFeedbackPresenter} from './src/mail-feedback-view.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function fixture(){const states=[],timers=new Map();let next=0;const show=createMailFeedbackPresenter((message,options)=>{const entry={message,...options};states.push(entry);return entry},{set:fn=>{timers.set(++next,fn);return next},clear:id=>timers.delete(id)});return {show,states,wait:()=>{for(const fn of timers.values())fn();timers.clear()},last:()=>states.at(-1)}}
test('a recovery remains one card from ready through pending and completion',async()=>{
 const f=fixture(),write=deferred();let calls=0;
 f.show('已移入垃圾箱',{id:'folder:1',tone:'success',action:{label:'恢复邮件',done:'邮件已恢复',run:()=>{calls++;return write.promise}}});const action=f.last().action;
 const first=action.run(),second=action.run();assert.equal(first,second);assert.equal(calls,1);f.wait();assert.equal(f.last().message,'正在处理…');assert.equal(f.last().duration,0);assert.equal(f.last().action,undefined);
 write.resolve({ok:true});assert.equal(await first,false);assert.equal(f.last().message,'邮件已恢复');assert.deepEqual([...new Set(f.states.map(x=>x.id))],['folder:1']);assert.equal(f.last().action,undefined);
});
test('controller completion owns the existing feedback without a second generic result',async()=>{
 const f=fixture();f.show('已移出订阅列表',{id:'source:1',action:{label:'恢复订阅',run:async()=>{f.show('订阅已恢复',{id:'source:1',tone:'success'});return true}}});await f.last().action.run();assert.deepEqual(f.states.map(x=>x.message),['已移出订阅列表','订阅已恢复']);
});
test('failed recovery retains the same identity and one usable retry action',async()=>{
 const f=fixture();let attempt=0;f.show('邮件已删除',{action:{label:'恢复邮件',done:'邮件已恢复',run:async()=>{if(++attempt===1)throw Error('暂时无法连接');return true}}});const id=f.last().id;await f.last().action.run();assert.equal(f.last().id,id);assert.equal(f.last().tone,'error');assert.equal(f.last().action.label,'恢复邮件');await f.last().action.run();assert.equal(attempt,2);assert.equal(f.last().id,id);assert.equal(f.last().message,'邮件已恢复');
});
test('a false response preserves the controller error and retry instead of reporting completion',async()=>{
 const f=fixture();f.show('已移出订阅列表',{id:'source:1',action:{label:'恢复订阅',run:async()=>{f.show('当前更新失败',{id:'source:1',tone:'error'});return false}}});await f.last().action.run();assert.equal(f.last().message,'当前更新失败');assert.equal(f.last().action.label,'恢复订阅');assert.equal(f.states.every(x=>x.id==='source:1'),true);
});

test('a late failed action cannot replace a newer successful state',async()=>{
 const f=fixture(),old=deferred();f.show('旧状态',{id:'same',action:{label:'恢复',run:()=>old.promise}});const pending=f.last().action.run();f.show('新的操作已完成',{id:'same',tone:'success'});old.reject(Error('旧请求失败'));await pending;assert.equal(f.last().message,'新的操作已完成');
});

test('a fast successful recovery skips the intermediate pending flash',async()=>{
 const f=fixture();f.show('已移入垃圾箱',{id:'quick',action:{label:'恢复',done:'已恢复',run:async()=>true}});await f.last().action.run();f.wait();assert.deepEqual(f.states.map(s=>s.message),['已移入垃圾箱','已恢复']);
});
