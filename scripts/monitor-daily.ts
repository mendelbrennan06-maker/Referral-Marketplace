import 'dotenv/config';
import { db } from '../src/lib/db';
import { runDailyMonitoring } from '../src/lib/monitoring/service';
runDailyMonitoring().then(result=>console.log(JSON.stringify({job:'program-monitoring',result}))).catch(e=>{console.error(e instanceof Error?e.message:'Monitoring job failed');process.exitCode=1}).finally(()=>db.$disconnect());
