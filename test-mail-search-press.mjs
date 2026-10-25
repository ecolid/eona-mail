import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMailSearchActions,mailSearchBrowserScript} from './src/mail-search-view.js';

test('clear and close commit once on press even if keyboard blur moves the original target before click',()=>{
 const handlers={},form={addEventListener(type,fn){handlers[type]=fn}};bindMailSearchActions(form);
 for(const label of ['clear','close']){let activations=0;const button={disabled:false,closest:()=>button,click(){const event={target:button,isTrusted:false,detail:0};handlers.click(event);activations++}};
  const press={target:button,button:0,isPrimary:true,preventDefault(){this.prevented=true}};handlers.pointerdown(press);assert.equal(press.prevented,true);assert.equal(activations,1,label+' must commit before any release or viewport transition');
  const click={target:button,isTrusted:true,detail:1,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};handlers.click(click);assert.equal(click.prevented,true);assert.equal(click.stopped,true);assert.equal(activations,1,'the compatibility click cannot repeat the intent');
  const keyboard={target:button,isTrusted:true,detail:0,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};handlers.click(keyboard);assert.equal(keyboard.stopped,undefined,'keyboard activation remains available');
 }
});

test('normal field focus, disabled controls, secondary pointers and context clicks keep their native behavior',()=>{
 const handlers={},form={addEventListener(type,fn){handlers[type]=fn}};bindMailSearchActions(form);let activations=0;
 const button={disabled:false,closest:()=>button,click(){activations++}};for(const e of [{target:{closest:()=>null},button:0},{target:button,button:2},{target:button,button:0,isPrimary:false}]){e.preventDefault=()=>{throw Error('native event was intercepted')};handlers.pointerdown(e)}button.disabled=true;handlers.pointerdown({target:button,button:0,preventDefault(){throw Error('disabled')}});assert.equal(activations,0);assert.doesNotThrow(()=>new Function(mailSearchBrowserScript()));
});
