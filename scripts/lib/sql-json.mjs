/** JSON enters SQL as hexadecimal bytes, independent of string-escape settings. */
export const jsonSql = value => `convert_from(decode('${Buffer.from(JSON.stringify(value)).toString('hex')}','hex'),'UTF8')::jsonb`;
