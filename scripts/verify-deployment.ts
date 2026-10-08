import 'dotenv/config';

// Optional deployment verification: credentials stay inside Railway reference variables.
async function main() {
  if (process.env.VERIFY_DEPLOYMENT !== 'true') return;
  const origin = new URL(process.env.APP_URL || '').origin;
  const email = process.env.VERIFY_ADMIN_EMAIL;
  const password = process.env.VERIFY_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Deployment verification credentials are missing.');
  const html = await (await fetch(`${origin}/login`)).text();
  const form = new FormData();
  for (const input of html.match(/<input[^>]*type="hidden"[^>]*>/g) || []) {
    const name = input.match(/name="([^"]+)"/)?.[1];
    const value = (input.match(/value="([^"]*)"/)?.[1] || '').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
    if (name) form.set(name, value);
  }
  if (!form.has('$ACTION_REF_1')) throw new Error('Login action was not found.');
  form.set('email', email); form.set('password', password);
  const login = await fetch(`${origin}/login`, {method:'POST', body:form, headers:{Origin:origin}, redirect:'manual'});
  const cookies = login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  if (!cookies) throw new Error('Authenticated deployment verification could not sign in.');
  for (const path of ['/api/health','/admin?tab=payments','/admin?tab=monitoring','/dashboard/payments','/dashboard/requests','/dashboard/targeted-offers']) {
    const response = await fetch(`${origin}${path}`, {headers:{Cookie:cookies}, redirect:'manual'});
    const body = await response.text();
    if (response.status !== 200 || body.includes('Internal Server Error')) throw new Error(`Deployment route check failed: ${path} (${response.status})`);
    console.log(JSON.stringify({check:'authenticated-deployment-route',path,status:response.status}));
  }
  console.log(JSON.stringify({check:'authenticated-deployment-verification',status:'passed'}));
}
main().catch(()=>{console.error('Deployment verification failed; credentials and responses are withheld.');process.exitCode=1;});
