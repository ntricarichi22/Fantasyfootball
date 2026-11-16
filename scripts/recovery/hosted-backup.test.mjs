import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySelectedBackup } from './hosted-checks.mjs';

const shown='2026-11-15T11:25:40Z',exact='2026-11-15T11:25:40.064Z';
const backup=(inserted_at=exact,overrides={})=>({id:1,status:'COMPLETED',is_physical_backup:true,inserted_at,...overrides});
const metadata=(backups=[backup()],physical_backup_data={})=>({walg_enabled:true,pitr_enabled:false,backups,physical_backup_data});
const fails=(data,time,category)=>assert.throws(()=>verifySelectedBackup(data,time),error=>error.category===category);

test('Dashboard seconds resolve only to a unique completed physical backup and retain exact API milliseconds',()=>{
  assert.deepEqual(verifySelectedBackup(metadata(),shown),{
    selectedAt:Date.parse(exact),resolvedBackupTimestamp:exact,resolution:'dashboard-second',
  });
  assert.equal(verifySelectedBackup(metadata(),exact).resolution,'exact');
  assert.equal(verifySelectedBackup(metadata(),'2026-11-15T06:25:40-05:00').resolvedBackupTimestamp,exact);
  fails(metadata(),'2026-11-15T11:25:40.000Z','BACKUP_TIMESTAMP_MISMATCH');
  fails(metadata(),'2026-11-15T11:25:41Z','BACKUP_TIMESTAMP_MISMATCH');
});

test('same-second collisions are rejected while an exact unique match takes precedence',()=>{
  const colliding=metadata([backup(),backup('2026-11-15T11:25:40.365Z',{id:2})]);
  fails(colliding,shown,'BACKUP_TIMESTAMP_AMBIGUOUS');
  fails(metadata([backup(shown),backup(exact,{id:2})]),shown,'BACKUP_TIMESTAMP_AMBIGUOUS');
  assert.equal(verifySelectedBackup(colliding,exact).resolution,'exact');
  fails(metadata([backup(),backup(exact,{id:2})]),exact,'BACKUP_TIMESTAMP_AMBIGUOUS');
});

test('invalid or timezone-free timestamps and unsupported metadata fail closed',()=>{
  for(const time of ['2026-11-15 11:25:40','2026-11-15T11:25:40','2026-02-30T11:25:40Z',
    '2026-11-15T24:25:40Z','2026-11-15T11:25:40+99:00']) fails(metadata(),time,'BACKUP_METADATA_UNSUPPORTED');
  for(const data of [{},metadata([backup('invalid')]),metadata([backup(exact,{is_physical_backup:undefined})]),
    metadata([],{latest_physical_backup_date_unix:1}),metadata([],[])]) fails(data,shown,'BACKUP_METADATA_UNSUPPORTED');
  fails({...metadata(),walg_enabled:false},shown,'BACKUP_PHYSICAL_UNAVAILABLE');
});

test('unavailable entries and recovery-window interiors cannot satisfy selected backup identity',()=>{
  for(const overrides of [{status:'PENDING'},{status:'FAILED'},{status:'REMOVED'},{is_physical_backup:false}])
    fails(metadata([backup(exact,overrides)]),shown,'BACKUP_SELECTED_UNAVAILABLE');
  const latest=Date.parse(shown)/1000,window=metadata([],{earliest_physical_backup_date_unix:latest-86400,latest_physical_backup_date_unix:latest});
  assert.equal(verifySelectedBackup(window,shown).resolution,'physical-window-end');
  fails(window,'2026-11-15T10:25:40Z','BACKUP_TIMESTAMP_MISMATCH');
});
