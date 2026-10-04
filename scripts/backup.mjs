import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const source=path.resolve(process.env.FORMSYNC_DATA_DIR||"data");
const mode=process.argv[2]||"backup";
const backup=path.resolve(process.argv[3]||path.join(".tools","backups",new Date().toISOString().replaceAll(":","-")));
const valid=id=>/^[0-9a-f-]{36}$/i.test(id);
async function empty(dir){try{return (await fs.readdir(dir)).length===0;}catch(e){if(e.code==="ENOENT")return true;throw e;}}
async function digest(file){const handle=await fs.open(file);const hash=crypto.createHash("sha256");try{for await(const chunk of handle.createReadStream())hash.update(chunk);}finally{await handle.close();}return hash.digest("hex");}
if(mode==="restore"){
 const manifest=JSON.parse(await fs.readFile(path.join(backup,"manifest.json"),"utf8"));if(manifest.format!=="formsync-backup-v1")throw new Error("Unknown backup format");
 if(!await empty(source))throw new Error("Restore requires an empty data directory. Stop the app and choose a new FORMSYNC_DATA_DIR; existing data will not be overwritten.");
 for(const [file,hash] of Object.entries(manifest.files)){if(!/^(workspace\.json|(sessions|metadata)\/[0-9a-f-]{36}\.json|videos\/[0-9a-f-]{36})$/i.test(file))throw new Error("Unsafe backup entry");if(await digest(path.join(backup,file))!==hash)throw new Error("Backup checksum failed: "+file);}
 await fs.mkdir(source,{recursive:true});for(const file of Object.keys(manifest.files)){const dest=path.join(source,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(backup,file),dest,fs.constants.COPYFILE_EXCL);}console.log("Restored saved sessions and videos to "+source);
}else if(mode==="backup"){
 if(!await empty(backup))throw new Error("Backup destination must be empty");await fs.mkdir(source,{recursive:true});const lock=path.join(source,".session-lock");let held=false;
 try{await fs.writeFile(lock,String(process.pid),{flag:"wx"});held=true;await fs.mkdir(backup,{recursive:true});const files={};
 const records=await fs.readdir(path.join(source,"sessions")).catch(e=>{if(e.code==="ENOENT")return [];throw e;});const videos=new Set();
 async function copy(file){const dest=path.join(backup,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(source,file),dest,fs.constants.COPYFILE_EXCL);files[file.replaceAll("\\","/")]=await digest(dest);}
 for(const name of records.filter(n=>n.endsWith(".json"))){const session=JSON.parse(await fs.readFile(path.join(source,"sessions",name),"utf8"));if(!valid(session.id)||name!==session.id+".json"||!valid(session.videoId))throw new Error("Invalid session record");await copy("sessions/"+name);videos.add(session.videoId);}
 for(const id of videos){await copy("videos/"+id);try{await copy("metadata/"+id+".json");}catch(e){if(e.code!=="ENOENT")throw e;}}
 try{await copy("workspace.json");}catch(e){if(e.code!=="ENOENT")throw e;}
 await fs.writeFile(path.join(backup,"manifest.json"),JSON.stringify({format:"formsync-backup-v1",createdAt:new Date().toISOString(),files},null,2));console.log("Backup saved to "+backup+" (saved video clips included; browser drafts and staged uploads excluded)");
 }finally{if(held)await fs.unlink(lock);}
}else throw new Error("Use backup or restore");
