import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
const root = fs.mkdtempSync(path.join(os.tmpdir(),'plangent-integrations-'));
process.env.PLANGENT_DATA_DIR = root;
test('integration domain, configured authentication and HTTP API',async () => {
  const d = await import('./index');
  const { getDb } = await import('../../infrastructure/db/schema');
  const { configureSecretVault,InMemoryVault } = await import('../../infrastructure/secrets');
  const { authenticatedRequest,checkConnection,redact } = await import('../../infrastructure/http/integration-client');
  const { integrationsRouter } = await import('../../infrastructure/http/routes/integrations');
  configureSecretVault(new InMemoryVault());
  let logins = 0, password = 'first-password', failNetwork = false, deny = false, cookieVersion = 1, html = false, invalidMode = 'status';
  const remote = createServer(async (req,res) => {
    if (failNetwork) { req.socket.destroy(); return; }
    if (req.url === '/redirect-away') { res.writeHead(302, { Location: 'https://untrusted.example/collect' }); res.end(); return; }
    if (req.url === '/invented/login') {
      logins++;
      let body = ''; for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      if (!((form.get('person') === 'alice' && form.get('passcode') === password) || (form.get('person') === 'bob' && form.get('passcode') === 'org-b-password'))) { res.writeHead(200,{ 'X-Credential': 'bad' }); res.end('bad password'); return; }
      await new Promise(resolve => setTimeout(resolve,25));
      res.setHeader('Set-Cookie',`opaque=secret-cookie-${cookieVersion}; Path=/; HttpOnly`);
      res.writeHead(302,{ Location: '/whoami' }); res.end(); return;
    }
    if (req.url === '/basic') {
      logins++;
      if (req.headers.authorization !== 'Basic ' + Buffer.from('alice:' + password).toString('base64')) { res.writeHead(401); res.end(); return; }
      res.setHeader('Content-Type','application/json'); res.end('{"person":{"name":"Alice"}}'); return;
    }
    if (req.headers.cookie !== `opaque=secret-cookie-${cookieVersion}`) {
      if (invalidMode === 'header') { res.writeHead(200,{ 'X-Session': 'expired' }); res.end('{}'); }
      else if (invalidMode === 'redirect') { res.writeHead(302,{ Location: '/sign-in/start' }); res.end(); }
      else if (invalidMode === 'html') { res.writeHead(200,{ 'Content-Type': 'text/html' }); res.end('<html>Login</html>'); }
      else { res.writeHead(401); res.end(); }
      return;
    }
    if (deny) { res.writeHead(403); res.end(); return; }
    if (html) { res.setHeader('Content-Type','text/html'); res.end('<html>sign in</html>'); return; }
    res.setHeader('Content-Type','application/json'); res.end('{"person":{"name":"Alice"}}');
  });
  remote.listen(0,'127.0.0.1'); await once(remote,'listening');
  const base = 'http://127.0.0.1:' + (remote.address() as { port: number }).port;
  const config = { login_path: '/invented/login',username_field: 'person',password_field: 'passcode',check_path: '/whoami',user_path: 'person.name',expect_json: true,
    invalid_password: { header: { name: 'X-Credential',value: 'bad' } },
    invalid_session: { statuses: [401],redirect_path: '/sign-in/*',header: { name: 'X-Session',value: 'expired' } } };
  const app = express(); app.use('/api/integrations',integrationsRouter);
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  const api = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/integrations';
  async function request(p: string,method = 'GET',body?: unknown) {
    const r = await fetch(api+p,{ method,headers: { 'Content-Type': 'application/json' },body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    for (const secret of ['first-password','changed-password','org-b-password','secret-cookie-','secret_blob']) assert.ok(!text.includes(secret),text);
    return { status: r.status,body: text ? JSON.parse(text) : null };
  }
  try {
    const orgA = d.saveOrganization({ name: 'A' }), orgB = d.saveOrganization({ name: 'B' });
    const a = d.saveCredential({ name: 'Default A',organization_id: orgA.id,username: 'alice' });
    const b = d.saveCredential({ name: 'Default B',organization_id: orgB.id,username: 'bob' });
    d.setPassword(a.id,password); d.setPassword(b.id,'org-b-password');
    d.saveOrganization({ credential_id: a.id },orgA.id); d.saveOrganization({ credential_id: b.id },orgB.id);
    const inherited = d.saveConnection({ name: 'Inherited',organization_id: orgA.id,base_url: base + '/pages/12?a=b',auth_strategy: 'form',auth_config: config });
    const other = d.saveConnection({ name: 'Other',organization_id: orgB.id,base_url: base,auth_strategy: 'form',auth_config: config });
    const o = d.saveCredential({ name: 'Override',organization_id: orgA.id,username: 'alice' }); d.setPassword(o.id,password);
    const override = d.saveConnection({ name: 'Override',organization_id: orgA.id,base_url: base,credential_mode: 'credential',credential_id: o.id,auth_strategy: 'form',auth_config: config });
    const own = d.saveConnection({ name: 'Own',organization_id: orgA.id,base_url: base,credential_mode: 'own',own_credential: { username: 'alice' },auth_strategy: 'form',auth_config: config });
    d.setPassword(own.credential_id!,password);
    assert.equal(inherited.base_url,base);
    assert.equal(d.effectiveCredential(inherited)?.id,a.id); assert.equal(d.effectiveCredential(other)?.id,b.id);
    assert.equal(d.listCredentials().some(c => c.id === own.credential_id),false);
    assert.throws(() => d.saveConnection({ credential_mode: 'credential',credential_id: b.id },inherited.id));
    for (const p of ['https://external/x','//external/x','\\external','../escape']) assert.throws(() => d.relativePath(p));
    assert.throws(() => d.saveConnection({ auth_config: { ...config,headers: { Authorization: 'secret' } } },inherited.id));
    assert.throws(() => d.saveCredential({ password: 'plaintext' },a.id));
    await Promise.all(Array.from({ length: 10 },() => authenticatedRequest(inherited.id,'/whoami')));
    assert.equal(logins,1,'concurrent requests share one login');
    for (const c of [other,override,own]) assert.equal((await checkConnection(c.id)).ok,true);
    assert.equal((await checkConnection(inherited.id)).user,'Alice');
    await assert.rejects(authenticatedRequest(inherited.id, '/redirect-away'), (error: unknown) => (error as { code: string }).code === 'unsupported_auth');
    const blobs = getDb().prepare('SELECT secret_blob FROM integration_sessions').all() as { secret_blob: Buffer }[];
    assert.ok(blobs.every(r => !r.secret_blob.includes(Buffer.from('secret-cookie'))));
    d.setPassword(a.id,'changed-password');
    assert.equal(d.getConnection(inherited.id)?.last_check_status,'unchecked');
    for (const c of [other,override,own]) assert.equal(d.getConnection(c.id)?.last_check_status,'ok');
    assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM integration_sessions').get() as { n: number }).n,3);
    logins = 0;
    const bad = await checkConnection(inherited.id);
    assert.equal(bad.status,'invalid_credentials'); assert.equal(bad.url,base+'/invented/login'); assert.equal(logins,1);
    assert.equal((await checkConnection(inherited.id)).status,'needs_update'); assert.equal(logins,1);
    assert.equal(d.getCredential(a.id)?.status,'needs_update'); assert.equal(d.getCredential(b.id)?.status,'ready');
    d.setPassword(a.id,password);
    failNetwork = true; assert.equal((await checkConnection(inherited.id)).status,'network'); failNetwork = false;
    assert.equal(d.getCredential(a.id)?.status,'ready');
    assert.equal((await checkConnection(inherited.id)).ok,true);
    cookieVersion++; logins = 0;
    await Promise.all(Array.from({ length: 10 },() => authenticatedRequest(inherited.id,'/whoami'))); assert.equal(logins,1,'expired session relogs once');
    for (const mode of ['header','redirect','html']) {
      invalidMode = mode; cookieVersion++; logins = 0;
      await Promise.all(Array.from({ length: 5 },() => authenticatedRequest(inherited.id,'/whoami')));
      assert.equal(logins,1,'one refresh for configured ' + mode + ' invalidation');
    }
    invalidMode = 'status';
    deny = true; assert.equal((await checkConnection(inherited.id)).status,'forbidden'); deny = false;
    assert.equal(d.getCredential(a.id)?.status,'ready');
    assert.equal((await request('/presets')).body[0].id,'atlassian-server-dc');
    assert.equal((await request('/storage')).body.insecure_dev_storage,false);
    assert.equal((await request('/normalize-url','POST',{ base_url: base+'/page?id=1' })).body.base_url,base);
    const newOrg = (await request('/organizations','POST',{ name: 'API' })).body;
    assert.equal((await request('/organizations/'+newOrg.id,'PATCH',{ name: 'API edited' })).body.name,'API edited');
    const newCredential = (await request('/credentials','POST',{ name: 'API account',organization_id: newOrg.id,username: 'alice' })).body;
    assert.equal((await request('/credentials/'+newCredential.id+'/password','PUT',{ password })).body.hasSecret,true);
    await request('/organizations/'+newOrg.id,'PATCH',{ credential_id: newCredential.id });
    const nc = (await request('/connections','POST',{ name: 'API service',organization_id: newOrg.id,base_url: base,auth_strategy: 'form',auth_config: config })).body;
    assert.equal((await request('/connections/'+nc.id+'/check','POST')).body.user,'Alice');
    for (const p of ['/organizations','/credentials','/connections','/connections/'+nc.id+'/credential','/credentials/'+newCredential.id]) assert.equal((await request(p)).status,200);
    assert.equal((await request('/connections/missing','PATCH',{ name: 'new' })).status,404);
    assert.equal((await request('/connections','POST',null)).status,400);
    assert.equal((await request('/connections/'+nc.id,'PATCH',{ password })).status,400);
    const malformed = await fetch(api+'/connections',{ method: 'POST',headers: { 'Content-Type': 'application/json' },body: '{ invalid secret-cookie-' });
    assert.equal(malformed.status,400); assert.ok(!(await malformed.text()).includes('secret-cookie-'));
    assert.equal((await request('/credentials/'+newCredential.id,'PATCH',{ secret_blob: 'bad' })).status,400);
    getDb().prepare(`INSERT INTO projects(id,name,repo_path,kind,source_type,connection_id) VALUES ('test-source','Docs','/test','source','docs',?)`).run(nc.id);
    assert.equal((await request('/connections/'+nc.id,'DELETE')).status,409);
    getDb().prepare("DELETE FROM projects WHERE id='test-source'").run();
    assert.equal((await request('/connections/'+nc.id,'DELETE')).status,204);
    assert.equal((await request('/credentials/'+newCredential.id,'DELETE')).status,204);
    assert.equal((await request('/organizations/'+newOrg.id,'DELETE')).status,204);
    assert.deepEqual(redact({ Authorization: 'secret',Cookie: 'secret',body: 'secret',nested: { password: 'secret' } }),{ Authorization: '[REDACTED]',Cookie: '[REDACTED]',body: '[REDACTED]',nested: { password: '[REDACTED]' } });
    const { matches } = await import('./strategies');
    const reply = { status: 200,headers: new Headers({ 'X-Session': 'expired' }),body: '{}',url: base,redirects: [base+'/sign-in/start'] };
    assert.equal(matches(reply,config.invalid_session),true);
    assert.equal(matches({ ...reply,headers: new Headers() },{ redirect_path: '/sign-in/*' }),true);
    const basic = d.saveConnection({ name: 'Basic',organization_id: orgA.id,base_url: base,auth_strategy: 'basic',auth_config: { check_path: '/basic',user_path: 'person.name' } });
    assert.equal((await checkConnection(basic.id)).user,'Alice');
    const auto = d.saveConnection({ name: 'Auto',organization_id: orgA.id,base_url: base,auth_strategy: 'auto',auth_config: { ...config,strategies: ['form','basic'] } });
    d.setPassword(a.id,'wrong'); logins = 0;
    assert.equal((await checkConnection(auto.id)).status,'invalid_credentials'); assert.equal(logins,1,'auto stops on definite wrong password');
    d.setPassword(a.id,password);
    html = true; assert.equal((await checkConnection(inherited.id)).status,'unsupported_auth'); html = false;
    const token = d.saveConnection({ name: 'Future login',organization_id: orgA.id,base_url: base,auth_strategy: 'token',auth_config: { check_path: '/whoami' } });
    assert.equal((await checkConnection(token.id)).status,'unsupported_auth');
    assert.equal(d.getCredential(a.id)?.status,'ready');
    d.deleteConnection(own.id); assert.equal(d.getCredential(own.credential_id!),null);
    d.deleteOrganization(orgB.id); assert.equal(d.getCredential(b.id),null); assert.equal(d.getConnection(other.id)?.organization_id,null);
    assert.deepEqual(getDb().pragma('foreign_key_check'),[]);
  } finally {
    await Promise.all([new Promise<void>(r => server.close(() => r())),new Promise<void>(r => remote.close(() => r()))]);
    getDb().close(); fs.rmSync(root,{ recursive: true,force: true });
  }
});
