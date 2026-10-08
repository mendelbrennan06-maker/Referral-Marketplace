import 'dotenv/config';
import { db } from '../src/lib/db';
import { runDailyMonitoring } from '../src/lib/monitoring/service';
import { monitoringProviderStatus } from '../src/lib/monitoring/providers';
async function main() {
 const result=await runDailyMonitoring();
 const evidence='id' in result?{
  realSourcesRetrieved:await db.programSourceSnapshot.count({where:{runId:result.id,isDemo:false,error:null,contentHash:{not:null}}}),
  simulatedSources:await db.programSourceSnapshot.count({where:{runId:result.id,isDemo:true,error:null}}),
  aiExtractions:await db.programSourceSnapshot.count({where:{runId:result.id,extractionStatus:'AI_EXTRACTED',sourceHashUnchanged:false}}),
  unchangedHashes:await db.programSourceSnapshot.count({where:{runId:result.id,sourceHashUnchanged:true}}),
 }:undefined;
 console.log(JSON.stringify({job:'program-monitoring',providers:monitoringProviderStatus(),result,evidence}));
}
main().catch(()=>{console.error('Monitoring job failed. Inspect source snapshots and admin monitoring reviews; private provider responses are withheld.');process.exitCode=1;}).finally(()=>db.$disconnect());
