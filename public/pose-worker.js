/* Local MediaPipe worker: video pixels stay on this device. */
importScripts("/pose/vision_bundle.js");
let detector;
self.onmessage=async(event)=>{
 const {id,type,bitmap,time}=event.data;
 try {
  if(type==="init"){
   const files=await Vision.FilesetResolver.forVisionTasks("/pose/wasm");
   detector=await Vision.PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:"/pose/pose_landmarker_lite.task",delegate:"CPU"},runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:.6,minPosePresenceConfidence:.6,minTrackingConfidence:.6,canvas:new OffscreenCanvas(512,512)});
   self.postMessage({id,ready:true});
  }else if(type==="frame"){
   if(!detector)throw new Error("Pose model is not ready.");
   const result=detector.detectForVideo(bitmap,time*1000+1);
   self.postMessage({id,landmarks:(result.landmarks[0]||[]).map(p=>({x:p.x,y:p.y,visibility:p.visibility??0}))});
  }
 }catch(error){self.postMessage({id,error:error?.message||"Pose detection failed."});}
 finally {bitmap?.close();}
};
