import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installMailListFilters,mailListFilterFields,mailToggleFilter,mailFilterQuery} from './src/mail-list-filters.js';
import {mailSearchTerms} from './src/mail-search.js';
function harness(){
 let observer,head,bindings=0,disposals=0;const panels=[],q={value:''};
 const element=()=>({dataset:{},attrs:{},label:{},controls:[],setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},matches(){return !!this.open},closest(){return this},querySelector(){return this.label},querySelectorAll(){return this.controls},remove(){this.removed=true;this.open=false},set innerHTML(value){this.markup=value;this.controls=[...value.matchAll(/data-filter-name="([^"]+)" data-filter-value="([^"]+)" aria-pressed="([^"]+)"/g)].map(([,name,value,pressed])=>{const n=element();n.dataset={filterName:name,filterValue:value};n.attrs['aria-pressed']=pressed;return n})}});
 const replace=()=>{head={closest:()=>null,querySelector:s=>s==='h1'?{textContent:'收件箱'}:null,insertBefore(node){this.trigger=node}}};replace();
 const list={querySelector:()=>head};
 const ctx={state:{folder:'inbox',q:'',searchOrder:'recent'},MailWorkspace:{data:{directory:[{group:'other'},{group:'automatic'}]}},listMore:{total:20},activeMailPage:{},parseMailQuery:mailSearchTerms,mailListFilterFields,mailToggleFilter,mailFilterQuery,esc:s=>s,document:{getElementById:id=>id==='list'?list:q,querySelector:()=>null,createElement:element,body:{append:n=>panels.push(n)}},MutationObserver:class{constructor(f){observer=f}observe(){}},EonaUI:{icon:()=>'',positionPopover(){},bindPopover(){bindings++;return {dispose(){disposals++}}}},submitMailSearch(){ctx.state.q=q.value},renderMailWorkspace(){},loadList(){}};
 vm.createContext(ctx);vm.runInContext(installMailListFilters.toString()+';installMailListFilters()',ctx);
 return {ctx,panels,refresh(){replace();observer()},noHeading(){head=null;observer()},get bindings(){return bindings},get disposals(){return disposals},get trigger(){return head.trigger}};
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
