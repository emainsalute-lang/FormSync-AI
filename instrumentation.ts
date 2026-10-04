export async function register() {
 if(process.env.NEXT_RUNTIME==="nodejs"&&process.env.FORMSYNC_EMBEDDED_WORKER!=="false") {
  const {startWorker}=await import("./lib/processing-worker");startWorker();
 }
}
