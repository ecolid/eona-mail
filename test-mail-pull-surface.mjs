import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMailPullSurface} from './src/mail-mobile-view.js';
function fixture(withIndicator=false){
 class Node{
  constructor(name){this.name=name;this.className=name;this.children=[];this.style={values:new Map(),setProperty(k,v){this.values.set(k,v)},removeProperty(k){this.values.delete(k)}};this.scrollTop=0}
  append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n)}}
  replaceChildren(...nodes){for(const n of [...this.children])n.remove();this.append(...nodes)}
  before(...nodes){const parent=this.parentElement,index=parent.children.indexOf(this);for(const n of nodes)n.remove();parent.children.splice(index,0,...nodes);for(const n of nodes)n.parentElement=parent}
  after(n){const parent=this.parentElement,index=parent.children.indexOf(this);n.remove();parent.children.splice(index+1,0,n);n.parentElement=parent}
  remove(){if(!this.parentElement)return;const p=this.parentElement;p.children.splice(p.children.indexOf(this),1);this.parentElement=null}
  querySelector(selector){for(const n of this.children){if(n.matches(selector))return n;const found=n.querySelector(selector);if(found)return found}return null}
  contains(node){return this===node||this.children.some(n=>n.contains(node))}
  setAttribute(k,v){this[k]=v}
  removeAttribute(k){delete this[k]}
  get childNodes(){return this.children}
  replaceWith(node){this.before(node);this.remove()}
  matches(selector){return selector.split(',').some(s=>s==='.'+this.className)}
  getBoundingClientRect(){return this.className==='mail-workspace-title'?{top:56,bottom:112,height:56}:{top:56,bottom:740,height:684}}
 }
 const list=new Node('list'),heading=new Node('mail-workspace-title'),a=new Node('row-a'),b=new Node('row-b');list.append(heading,a,b);let changed,disconnected=false;
 const indicator=withIndicator?new Node('mail-pull-status'):undefined;
 const surface=bindMailPullSurface({list,indicator,document:{createElement:()=>new Node('div')},window:{MutationObserver:class{constructor(fn){changed=fn}observe(){}disconnect(){disconnected=true}}}});
 return {list,heading,a,b,surface,indicator,node:name=>new Node(name),change:()=>changed(),disconnected:()=>disconnected};
}
test('pull keeps the original heading and scroll owner and groups the same content nodes',()=>{
 const f=fixture();assert.equal(f.heading.parentElement,f.list);assert.equal(f.list.children[0],f.heading);const clip=f.list.children[1],content=clip.children[0];assert.equal(clip.className,'mail-pull-clip');assert.equal(content.className,'mail-pull-content');assert.deepEqual(content.children,[f.a,f.b]);assert.equal(f.surface.top(),112);assert.equal(f.surface.scrollElement(),clip);assert(!clip.contains(f.heading));assert.equal(f.list['data-mail-viewport'],'');
});
test('failure insertion and refreshed markup retain their order beneath the fixed heading',()=>{
 const f=fixture(),notice=f.node('mail-list-error');f.heading.after(notice);f.change();assert.equal(f.list.children[0],f.heading);assert.deepEqual(f.list.children[1].children[0].children,[notice,f.a,f.b]);
 const nextHeading=f.node('mail-workspace-title'),next=f.node('next-row');f.list.replaceChildren(nextHeading,next);f.change();assert.equal(f.list.children[0],nextHeading);assert.deepEqual(f.list.children[1].children[0].children,[next]);assert.equal(f.surface.top(),112);
});
test('disposing the surface restores direct node identity, order and scroll position',()=>{
 const f=fixture();f.surface.scrollElement().scrollTop=200;f.surface.dispose();assert.deepEqual(f.list.children,[f.heading,f.a,f.b]);assert.equal(f.list.scrollTop,200);assert(f.disconnected());assert.equal(f.list.style.values.has('--mail-pull-heading-height'),false);
});

test('workspace list shells retain the same header/content contract as received mail',()=>{
 const f=fixture(),pane=f.node('mail-workspace-content'),head=f.node('mail-workspace-title'),row=f.node('sent-row');pane.append(head,row);f.list.replaceChildren(pane);f.list.clientHeight=684;f.change();assert.equal(head.parentElement,pane);assert.equal(f.list.children[0],pane);const clip=pane.children[1];assert.equal(clip.className,'mail-pull-clip');assert.deepEqual(clip.children[0].children,[row]);assert.equal(f.surface.scrollElement(),clip);assert(!clip.contains(head),'the header is outside the native scrolling subtree');assert.equal(f.surface.top(),112);f.surface.dispose();assert.deepEqual(pane.children,[head,row]);
});

test('returning to cached directories reuses the original surface without nested translations',()=>{
 const f=fixture(),cached=[...f.list.children],clip=cached[1],content=clip.children[0];
 for(let i=0;i<3;i++){const pane=f.node('mail-workspace-content'),head=f.node('mail-workspace-title'),row=f.node('sent-row');pane.append(head,row);f.list.replaceChildren(pane);f.change();f.list.replaceChildren(...cached);f.change();assert.equal(f.list.children[1],clip);assert.deepEqual(content.children,[f.a,f.b]);assert.equal(content.children.some(n=>n.className==='mail-pull-clip'),false)}
});

test('the one indicator follows the active cached clip and never enters moving content',()=>{
 const f=fixture(true),cached=[...f.list.children],clip=cached[1];assert.equal(f.indicator.parentElement,clip);assert.equal(clip.children[0].className,'mail-pull-content');
 for(let i=0;i<12;i++){const pane=f.node('mail-workspace-content'),head=f.node('mail-workspace-title');pane.append(head,f.node('row'));f.list.replaceChildren(pane);f.change();assert.equal(f.indicator.parentElement,pane.children[1]);f.list.replaceChildren(...cached);f.change();assert.equal(f.indicator.parentElement,clip);assert.equal(clip.children.filter(n=>n===f.indicator).length,1);assert.deepEqual(clip.children[0].children,[f.a,f.b])}
});

test('the cached native viewport retains its offset through parent rerenders and returns',()=>{
 const f=fixture(),scroll=f.surface.scrollElement(),cached=[...f.list.children];scroll.scrollTop=340;
 f.heading.after(f.node('notice'));f.change();assert.equal(f.surface.scrollElement(),scroll);assert.equal(scroll.scrollTop,340);
 const next=f.node('mail-workspace-title');f.list.replaceChildren(next,f.node('new-row'));assert.notEqual(f.surface.scrollElement(),scroll,'a new page resolves synchronously');
 f.list.replaceChildren(...cached);assert.equal(f.surface.scrollElement(),scroll);assert.equal(scroll.scrollTop,340);
});

test('same-page commits keep the original native viewport and scroll offset',()=>{
 const f=fixture(),scroll=f.surface.scrollElement(),nextHead=f.node('mail-workspace-title'),nextRow=f.node('new-row');scroll.scrollTop=280;
 f.surface.commit(f.list,[nextHead,nextRow]);assert.equal(f.surface.scrollElement(),scroll);assert.equal(scroll.scrollTop,280);assert.equal(f.list.children[0],nextHead);assert.deepEqual(scroll.children[0].children,[nextRow]);assert(!scroll.contains(nextHead));
});

test('the first completed directory replaces its loading shell instead of retaining it',()=>{
 const f=fixture(),shell=f.node('mail-page-skeleton'),pane=f.node('mail-workspace-content'),head=f.node('mail-workspace-title');pane.append(head,f.node('loading-row'));shell.append(pane);f.list.replaceChildren(shell);f.change();head.closest=()=>shell;
 const ready=f.node('mail-workspace-content'),nextHead=f.node('mail-workspace-title');ready.append(nextHead,f.node('ready-row'));f.surface.commit(f.list,[ready]);assert.equal(f.list.children[0],ready);assert(!f.list.contains(shell));assert(!f.surface.scrollElement().contains(nextHead));
});
