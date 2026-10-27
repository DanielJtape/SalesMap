import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';

const text = value => {
  if (value == null) return '';
  if (typeof value === 'object') {
    if ('result' in value) return text(value.result);
    if (value.richText) return value.richText.map(t => t.text).join('').trim();
    if (value.text) return value.text.trim();
    return '';
  }
  return String(value).trim();
};
const key = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = {
  company:['companyname','company','name'], status:['accprospect','accountstatus','status'],
  manager:['manager','accountmanager','owner'], street:['streetaddress','street','address'],
  city:['city','town'], postcode:['postcode','postalcode','zip','zipcode'],
  phone:['phonenumber','phone'], website:['websitedomain','website'],
  application:['primarytapeapplication','application'], specification:['requiredtapespecification','specification'],
  country:['country','countrycode'], latitude:['latitude','lat'], longitude:['longitude','lng','lon'],
  externalId:['externalid','recordid','hsobjectid']
};
export function normalizeRecord(input, source = 'spreadsheet') {
  const byKey = Object.fromEntries(Object.entries(input).map(([k,v])=>[key(k),text(v)]));
  const out = {};
  for (const [field,names] of Object.entries(aliases)) out[field] = byKey[key(field)] ?? names.map(n=>byKey[n]).find(v=>v !== undefined) ?? '';
  if (!out.company) return null;
  const status = out.status.toLowerCase();
  out.status = ['acc','account','customer','existing customer'].includes(status) ? 'Customer' : ['prospect','new prospect','lead'].includes(status) ? 'Prospect' : 'Unspecified';
  out.manager ||= 'Unassigned';
  const lat=Number(out.latitude), lng=Number(out.longitude);
  const located=out.latitude!=='' && out.longitude!=='' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat)<=90 && Math.abs(lng)<=180;
  out.latitude=located?lat:null;out.longitude=located?lng:null;
  out.locationSource=located?'Imported coordinates':null;
  out.locationLabel=located?'Provided in source':'';
  out.source=source;
  out.id=createHash('sha256').update(source+'|'+(out.externalId || [out.company,out.street,out.city,out.postcode,out.manager].join('|'))).digest('hex').slice(0,24);
  return out;
}
export async function readWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet=workbook.worksheets.find(s=>s.rowCount>1);
  if (!sheet) throw new Error('The workbook has no account rows.');
  const headers=sheet.getRow(1).values.slice(1).map(text);
  if (!headers.some(h=>aliases.company.includes(key(h)))) throw new Error('A Company Name column is required on the first row.');
  const records=[];const occurrences=new Map();let skipped=0;
  sheet.eachRow((row,index)=>{
    if(index===1)return;
    const input=Object.fromEntries(headers.map((h,i)=>[h,text(row.getCell(i+1).value)]));
    const record=normalizeRecord(input);
    if(record){
      const count=(occurrences.get(record.id)||0)+1;occurrences.set(record.id,count);
      if(count>1)record.id += '-'+count;
      records.push(record);
    }else skipped++;
  });
  if(records.length>50000)throw new Error('Import at most 50,000 accounts at a time.');
  return {records,skipped,sheet:sheet.name};
}
