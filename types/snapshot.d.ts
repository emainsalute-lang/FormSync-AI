declare module "*.mjs" {
 export function snapshotDatabase(source:string,destination:string,hydrate?:(key:string)=>Promise<unknown>):Promise<{format:string;createdAt:string;files:Record<string,string>}>;
}
