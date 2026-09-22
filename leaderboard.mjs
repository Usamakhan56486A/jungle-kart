import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export class Leaderboard{
  constructor(file){this.file=file;this.entries=[];this.pending=Promise.resolve();this.lastError=null;}
  async load(){try{const data=JSON.parse(await readFile(this.file,'utf8'));if(Array.isArray(data))this.entries=data.filter(x=>x&&typeof x.name==='string'&&Number.isFinite(x.points)&&Number.isFinite(x.rounds)).slice(0,100);}catch(error){if(error.code!=='ENOENT'){this.lastError=error.message;console.warn('Leaderboard could not be read:',error.message);}}return this;}
  record(cup){
    const date=new Date().toISOString();
    const records=cup.results.filter(p=>!p.bot).map(p=>({id:randomUUID(),name:p.name,animal:p.animal,vehicle:p.vehicle,points:p.points,rounds:cup.totalRounds,mode:cup.mode,rank:p.rank,totalTime:p.totalTime,bestLap:p.bestLap,date}));
    this.entries.push(...records);this.entries.sort((a,b)=>b.points/b.rounds-a.points/a.rounds||a.totalTime/a.rounds-b.totalTime/b.rounds);this.entries=this.entries.slice(0,100);
    const payload=JSON.stringify(this.entries,null,2);
    this.pending=this.pending.catch(()=>{}).then(async()=>{await writeFile(this.file+'.tmp',payload,'utf8');await rename(this.file+'.tmp',this.file);this.lastError=null;}).catch(error=>{this.lastError=error.message;console.error('Leaderboard could not be saved:',error.message);});
    return this.pending;
  }
  snapshot(){return{entries:this.entries.map(entry=>({...entry})),localOnly:true,persistenceError:this.lastError};}
}
