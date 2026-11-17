import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

/** Bounded password propagation plus verification of the actual client TLS hop. */
export async function verifiedPgConnection(pool,{guard,signal,wait=(ms)=>delay(ms,undefined,{signal})}) {
  let client;
  for(let attempt=0;attempt<6;attempt++){
    signal?.throwIfAborted();guard();
    try{client=await pool.connect();break;}
    catch(error){if(attempt===5)throw error;await wait(2000);}
  }
  try{
    signal?.throwIfAborted();guard();
    // pg_stat_ssl covers pooler→Postgres, not this Node→pooler connection.
    assert.ok(client.connection.stream.encrypted===true&&client.connection.stream.authorized===true,'Verified TLS database connection required');
    const {rows:[connection]}=await client.query('SELECT current_database() database');
    assert.equal(connection.database,'postgres','Expected database required');
    return client;
  }catch(error){client.release();throw error;}
}
