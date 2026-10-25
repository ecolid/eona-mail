import {parseMailLabels,labelProjection} from './mail-labels.js';
import {workflowMailSummary} from './mail-workflow-summary.js';
import {mailCanTranslate} from './mail-reader-view.js';

// Lists and correspondence expose the same bounded, account-readable header.
// The translation sample is consumed here and never returned to the browser.
export const MAIL_READER_PREVIEW_COLUMNS=`id,alias,from_addr,from_name,subject,verification_code,
 has_attachments,is_read,is_starred,folder,received_at,ai_category,ai_summary,ai_action,
 message_id,origin_to,to_addr,attachment_keys,labels_json,labels_rev,labels_updated_at,
 substr(COALESCE(text_body,''),1,240) AS body_preview,
 substr(COALESCE(text_body,''),1,3000) AS translation_preview`;

export function projectMailRow(row){
 const workflow=workflowMailSummary({...row,text_body:String(row.text_body??row.translation_preview??'').slice(0,3000)});if(workflow)row={...row,ai_summary:workflow.summary};
 const labels=parseMailLabels(row);
 return labels?{...row,ai_category:labels.category,ai_action:labelProjection(labels,row).action,
  ...(labels.verification?{verification_code:labels.verification.state==='confirmed'?labels.verification.code:null}:{}),labels}:row;
}
export function projectMailListRow(row){
 const {translation_preview,...value}=projectMailRow(row);
 return {...value,can_translate:mailCanTranslate({...value,text_body:translation_preview})};
}
