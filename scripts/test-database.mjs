import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = fileURLToPath(new URL('../',import.meta.url));
const image = 'postgres:17-bookworm@sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994';
const container = `liquigas-db-test-${randomUUID().slice(0,8)}`;
const env = {...process.env};
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key];
function docker(args, input) {
 const r=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{cwd:root,env,input,encoding:'utf8',maxBuffer:8*1024*1024});
 if(r.status!==0) throw new Error(r.stderr||r.stdout||r.error?.message||'Falha Docker');
 return r.stdout.trim();
}
export function sql(query) {
 return docker(['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','liquigas_test'],query);
}
export function sqlAsync(query) {
 return import('node:child_process').then(({spawn})=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['--host=unix:///var/run/docker.sock','exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','liquigas_test'],{env,cwd:root});
  let out='',err=''; child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err)));child.stdin.end(query);
 }));
}
let cleaned=false;
function cleanup(){ if(cleaned)return;cleaned=true;try{docker(['rm','--force',container]);}catch{} }
process.once('SIGINT',()=>{cleanup();process.exit(130);});
process.once('SIGTERM',()=>{cleanup();process.exit(143);});
try {
 docker(['info','--format','{{.ServerVersion}}']);
 docker(['run','--detach','--rm','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=liquigas_test',image]);
 for(let n=0;;n++) {
  try { docker(['exec',container,'psql','-X','-qAt','-U','postgres','-h','127.0.0.1','-d','liquigas_test','-c','select 1']);break; } catch(e) { if(n>=80) throw e; await new Promise(r=>setTimeout(r,250)); }
 }
 console.log(`PostgreSQL local: ${sql("select current_setting('server_version');")}`);
 sql(readFileSync(`${root}/supabase/tests/auth-fixture.sql`,'utf8'));
 for(const file of readdirSync(`${root}/supabase/migrations`).filter(x=>x.endsWith('.sql')).sort()) {
  sql(readFileSync(`${root}/supabase/migrations/${file}`,'utf8')); console.log(`Migração aplicada: ${file}`);
  if(file==='20261112000100_schema.sql') {
   const exposed=sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'select') or has_table_privilege('authenticated',c.oid,'insert'));");
   if(exposed!=='0') throw new Error('Tabelas expostas entre migrações');
   console.log('PASS acesso fechado desde a primeira migração');
  }
 }
 if(process.argv.includes('--migrations-only')) console.log('Migrações válidas em PostgreSQL 17.');
 else { const {run}=await import('../supabase/tests/integrity.mjs');await run({sql,sqlAsync}); }
} catch(error) { console.error(error.message);process.exitCode=1; }
finally { cleanup(); }
