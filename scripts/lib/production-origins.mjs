import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

/** Promoted project domains and separately managed branch aliases have distinct lifecycles. */
export function deriveProductionOrigins(production) {
 const promoted=production.appOrigins, auxiliary=production.auxiliaryAppOrigins;
 assert.ok(Array.isArray(promoted)&&promoted.length>0&&Array.isArray(auxiliary));
 const all=[...promoted,...auxiliary];
 assert.equal(new Set(all).size,all.length);
 for(const origin of all){const url=new URL(origin);assert.equal(url.protocol,'https:');assert.equal(url.origin,origin);assert.ok(!url.username&&!url.password&&!url.port);}
 return Object.freeze({promoted:Object.freeze([...promoted]),auxiliary:Object.freeze([...auxiliary]),all:Object.freeze(all)});
}
const targets=JSON.parse(readFileSync(new URL('../../config/deployment-targets.json',import.meta.url),'utf8'));
export const productionOrigins=deriveProductionOrigins(targets.production);
