// Aggregate Gmail views describe labels on one message, not separate mail.
export function gmailSource(account,input){
 if(account.imap?.provider!=='gmail'){
  if(input.gmail!==undefined)throw Error('product_gmail_source_unconfigured');
  return null;
 }
 const value=input.gmail;
 if(!value||typeof value.message_id!=='string'||!/^\d{1,20}$/.test(value.message_id)||BigInt(value.message_id)<1n||BigInt(value.message_id)>18446744073709551615n||!Array.isArray(value.labels)||value.labels.length>1000||value.labels.some(v=>typeof v!=='string'||v.length>300||/[\r\n\0]/.test(v)))throw Error('product_gmail_metadata_invalid');
 const labels=new Set(value.labels.map(v=>v.toLowerCase()));
 const kind=labels.has('\\inbox')?'inbox':labels.has('\\draft')||labels.has('\\drafts')?'drafts':labels.has('\\trash')?'trash':labels.has('\\sent')?'sent':input.kind;
 const workspaceKind=labels.has('\\draft')||labels.has('\\drafts')?'drafts':labels.has('\\sent')?'sent':['sent','drafts'].includes(input.kind)?input.kind:null;
 return {...value,kind,workspaceKind,starred:labels.has('\\starred'),projection:[account.id,'gmail',value.message_id,workspaceKind||kind]};
}
