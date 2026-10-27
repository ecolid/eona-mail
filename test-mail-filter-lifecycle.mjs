import {mailListScrollElement,mailCommitListContent} from './src/mail-mobile-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installMailListFilters,mailListFilterFields,mailToggleFilter,mailFilterQuery} from './src/mail-list-filters.js';
import {mailSearchTerms} from './src/mail-search.js';
function harness({folder='inbox',query=''}={}){
 let observer,head,bindings=0,disposals=0,requests=0,frame=0;const panels=[],q={value:query},frames=new Map(),positions=[];
 const element=()=>({isConnected:true,dataset:{},attrs:{},label:{},controls:[],listeners:[],addEventListener(type,fn,options){this.listeners.push({type,fn,options})},click(){const event={preventDefault(){},stopImmediatePropagation(){this.stopped=true}};for(const {fn} of this.listeners.filter(l=>l.type==='click'&&l.options?.capture))fn(event);if(!event.stopped)for(const {fn} of this.listeners.filter(l=>l.type==='click'&&!l.options?.capture))fn(event)},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},matches(){return !!this.open},closest(){return this},querySelector(){return this.label},querySelectorAll(){return this.controls},remove(){this.removed=true;this.isConnected=false;this.open=false},set innerHTML(value){this.markup=value;this.controls=[...value.matchAll(/data-filter-name="([^"]+)" data-filter-value="([^"]+)" aria-pressed="([^"]+)"/g)].map(([,name,value,pressed])=>{const n=element();n.dataset={filterName:name,filterValue:value};n.attrs['aria-pressed']=pressed;return n})}});
 const replace=()=>{head={closest:()=>null,querySelector:s=>s==='h1'?{textContent:'收件箱'}:null,insertBefore(node){this.trigger=node}}};replace();
 const list={querySelector:()=>head};
 const ctx={state:{folder,q:query,searchOrder:'recent'},MailWorkspace:{data:{directory:[{group:'other'},{group:'automatic'}]}},listMore:{total:20},activeMailPage:{},parseMailQuery:mailSearchTerms,mailListFilterFields,mailToggleFilter,mailFilterQuery,esc:s=>s,requestAnimationFrame(fn){frames.set(++frame,fn);return frame},cancelAnimationFrame(id){frames.delete(id)},document:{getElementById:id=>id==='list'?list:q,querySelector:()=>null,createElement:element,body:{append:n=>panels.push(n)}},MutationObserver:class{constructor(f){observer=f}observe(){}},EonaUI:{icon:key=>'<svg data-icon="'+key+'"></svg>',positionPopover(){positions.push(head.selectionAttached)},bindPopover(trigger,panel){bindings++;trigger.addEventListener('click',()=>panel.open=!panel.open);return {close(){panel.open=false},dispose(){disposals++}}}},submitMailSearch(){requests++;ctx.state.q=q.value},renderMailWorkspace(){requests++},loadList(){requests++}};
 Object.assign(ctx,{mailListScrollElement,mailCommitListContent});vm.createContext(ctx);vm.runInContext(installMailListFilters.toString()+';installMailListFilters()',ctx);
 return {ctx,panels,positions,refresh(){replace();observer();head.selectionAttached=true},flush(){for(const [id,fn] of frames){frames.delete(id);fn()}},choose(name,value){const panel=panels.at(-1),choice=panel.controls.find(c=>c.dataset.filterName===name&&c.dataset.filterValue===value);panel.onclick({target:choice})},noHeading(){head=null;observer()},get requests(){return requests},get bindings(){return bindings},get disposals(){return disposals},get trigger(){return head.trigger}};
}
test('filter result commits retain the open panel, trigger, focused choices and repeated reset',()=>{
 const h=harness(),panel=h.panels[0],trigger=h.trigger,choice=panel.controls[0];panel.open=true;
 panel.onclick({target:choice});h.refresh();
 assert.equal(h.panels.length,1);assert.equal(h.bindings,1);assert.equal(h.disposals,0);assert.equal(panel.open,true);assert.equal(h.trigger,trigger);assert.equal(panel.controls[0],choice);assert.equal(choice.attrs['aria-pressed'],'true');assert.equal(h.ctx.state.q,'is:unread');
 panel.onclick({target:choice});h.refresh();assert.equal(h.ctx.state.q,'');assert.equal(choice.attrs['aria-pressed'],'false');assert.equal(h.panels.length,1);
 h.ctx.state.folder='contacts';h.refresh();assert.equal(h.disposals,1);assert.equal(panel.removed,true);assert.equal(h.panels.length,2);
 const directory=h.panels[1];directory.open=true;directory.onclick({target:directory.controls[0]});h.refresh();assert.equal(h.panels.length,2);assert.equal(directory.open,true);
 h.ctx.state.folder='settings';h.noHeading();assert.equal(directory.removed,true);
});

test('one click clears all quick filters and sort while preserving keywords and mailbox scope',()=>{
 const h=harness({query:'budget from:friend@example.test'}),panel=h.panels[0],trigger=h.trigger;trigger.click();h.choose('read','unread');h.choose('has','yes');h.choose('order','relevance');h.refresh();
 assert.equal(panel.open,true);assert.match(trigger.markup,/data-icon="close"/);assert.match(trigger.markup,/>清除</);assert.equal(trigger.attrs['aria-label'],'清除全部筛选');assert.equal(h.ctx.state.searchOrder,'relevance');const requests=h.requests;
 trigger.click();assert.equal(panel.open,false);assert.equal(h.requests,requests+1);assert.equal(h.ctx.state.q,'budget from:friend@example.test');assert.equal(h.ctx.state.folder,'inbox');assert.equal(h.ctx.state.searchOrder,'recent');assert.equal(trigger.dataset.active,'false');assert.match(trigger.markup,/>筛选</);h.refresh();trigger.click();assert.equal(panel.open,true);assert.equal(h.trigger,trigger);
});

test('directory category reset uses the directory owner and keeps the current page',()=>{
 const h=harness({folder:'contacts'}),panel=h.panels[0];h.trigger.click();h.choose('group','other');h.refresh();assert.equal(h.ctx.state.directoryFilters.contacts.group,'other');h.trigger.click();assert.equal(panel.open,false);assert.equal(h.ctx.state.directoryFilters.contacts.group,'');assert.equal(h.ctx.state.folder,'contacts');assert.equal(h.ctx.activeMailPage.directoryLimit,80);assert.match(h.trigger.markup,/>分类</);
});

test('filter result commits measure only after the selection slot has been reattached',()=>{
 const h=harness(),panel=h.panels[0];panel.open=true;h.choose('has','no');h.refresh();assert.deepEqual(h.positions,[],'no intermediate layout may move the open panel');h.flush();assert.deepEqual(h.positions,[true]);h.refresh();h.refresh();assert.equal(h.positions.length,1);h.flush();assert.deepEqual(h.positions,[true,true],'coalesce result enhancers before each visible frame');
});
