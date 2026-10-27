import {parse,serialize} from 'parse5';

// Keep the CSP as the first parsed content. Parent-created event callbacks may
// run in WebKit, but no code supplied by an email can execute in the document.
export function mailHTMLPolicy(){return "default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; img-src * data:; style-src 'unsafe-inline' *; font-src *;"}
export function mailHTMLDocument(html){return '<!doctype html><meta http-equiv="Content-Security-Policy" content="'+mailHTMLPolicy()+'">'+html}

// Stored originals are unchanged. Only the reading projection is sanitized;
// sandbox still disallows forms, popups, downloads and top-level navigation.
export function sanitizeMailHTML(html){
 const tree=parse(String(html),{scriptingEnabled:false}),active=new Set(['script','iframe','frame','frameset','object','embed','applet','base','meta']);
 const fallback=nodes=>nodes.flatMap(n=>n.tagName==='noscript'?fallback(n.childNodes||[]):[n]);
 const visit=node=>{
  if(node.attrs)node.attrs=node.attrs.filter(a=>{
   if(/^on/i.test(a.name)||['srcdoc','autofocus','autoplay','formaction','formtarget'].includes(a.name))return false;
   if(['href','src','action','background'].includes(a.name)&&/^(?:javascript|vbscript):/i.test(a.value.replace(/[\u0000-\u0020\u007f]/g,'')))return false;
   return true;
  });
  if(node.childNodes){node.childNodes=fallback(node.childNodes).filter(n=>(!n.namespaceURI||n.namespaceURI==='http://www.w3.org/1999/xhtml')&&!active.has(n.tagName)&&!(n.tagName==='link'&&!n.attrs?.some(a=>a.name==='rel'&&a.value.toLowerCase()==='stylesheet')));for(const child of node.childNodes){child.parentNode=node;visit(child)}}
  if(node.content)visit(node.content);
 };visit(tree);return serialize(tree);
}
