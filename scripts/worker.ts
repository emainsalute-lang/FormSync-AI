import { workerTick } from "../lib/processing-worker";
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
console.log("FormSync durable processing worker started");
async function main() {
  while (!stopping) {
    await workerTick().catch((e) => console.error("Worker tick failed", e));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
void main();
