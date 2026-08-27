// 브라우저 진입점 — 인식 세션과 평가 파이프라인을 브라우저에서 잇는다.
//
//   import { createWebPipeline } from "naranhi/web";
//   const pipeline = await createWebPipeline({ modelUrl: "/model.onnx" });
//   const step = await pipeline.assess(videoElement);
//
// `onnxruntime-web` 이 필요하다. **번들된 모델을 그대로 쓸 수는 없다** — 브라우저는
// 파일 경로가 아니라 URL 로 받으므로, 번들러가 `naranhi/model/model.onnx` 를 자산으로
// 처리하게 하거나 정적 경로에 복사해 `modelUrl` 로 준다.
//
//   // Vite 예
//   import modelUrl from "naranhi/model/model.onnx?url";
//   const pipeline = await createWebPipeline({ modelUrl });
export { createWebPipeline } from "naranhi-collision-assessor/pipeline/web";
export { NrhAnalysisDependencyError } from "naranhi-collision-assessor";
