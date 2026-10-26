import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {testHooks} from './src/index.js';
const page=testHooks().PAGE;
function fixture(){
 class Node{
  constructor(label){this.label=label;this.children=[];this.scrollTop=0;this.writes=0}
  get firstChild(){return this.children[0]}
  append(node){if(node.fragment){for(const n of [...node.children])this.append(n);return}node.parent?.children.splice(node.parent.children.indexOf(node),1);node.parent=this;this.children.push(node)}
  replaceChildren(){this.children=[];this.writes++}
  set innerHTML(value){this.replaceChildren();this.append(new Node(value))}
 }
 const list=new Node('host'),state={folder:'inbox',q:'',searchOrder:'recent'},events=[];
 const ctx={state,$:()=>list,document:{createDocumentFragment(){const n=new Node('fragment');n.fragment=true;return n},dispatchEvent:e=>events.push(e.type),body:{classList:{toggle(){}}}},Event:class{constructor(type){this.type=type}},window:{},MailExperience:{pageChanged(){}},mailLoadingMarkup:()=>'<skeleton>'};
 vm.createContext(ctx);vm.runInContext(page.slice(page.indexOf('const mailPages=new Map()'),page.indexOf('function reset(){')).replace(/function updateMailNavigation\(\)\{[^\n]*\}\n/,'' )+'\nlet listMore={};',ctx);
 const activate=()=>vm.runInContext('activateMailPage()',ctx);
 return {ctx,list,state,activate,events,row:()=>new Node('mail-row')};
}
test('first-time filter and search changes keep the actual surface and visible nodes',()=>{
 const f=fixture(),entry=f.activate();f.list.replaceChildren();const row=f.row();f.list.append(row);f.list.scrollTop=180;const writes=f.list.writes;
 for(const q of ['is:unread','is:unread has:attachment','has:attachment','','subject:project']){f.state.q=q;assert.equal(f.activate(),entry);assert.equal(f.list.firstChild,row);assert.equal(f.list.writes,writes);assert.equal(f.list.scrollTop,180)}
 f.state.searchOrder='relevance';assert.equal(f.activate(),entry);assert.equal(f.list.firstChild,row);assert.equal(f.events.filter(type=>type==='mail:surface').length,7,'each query change immediately clears gestures and selection scope without replacing the content');
});
test('different mailbox scopes stay isolated and a cached folder restores its own nodes',()=>{
 const f=fixture(),entry=f.activate();f.list.replaceChildren();const row=f.row();f.list.append(row);
 f.state.box='another@example.test';const other=f.activate();assert.notEqual(other,entry);assert.notEqual(f.list.firstChild,row);
 f.state.box=null;assert.equal(f.activate(),entry);assert.equal(f.list.firstChild,row);
 f.state.folder='sent';assert.notEqual(f.activate(),entry);assert.notEqual(f.list.firstChild,row);
});
