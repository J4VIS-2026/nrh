// React Native 진입점.
//
//   import { createNativePipeline } from "naranhi/native";
//   import { modelPath, modelBytes } from "naranhi/model";
//   const pipeline = await createNativePipeline({
//     modelPath: modelPath(), modelBytes: modelBytes(),
//   });
//
// `onnxruntime-react-native` 가 필요하다. **경로와 바이트를 둘 다** 준다 — 그쪽 런타임이
// 경로로 세션을 만들고, 클래스 맵은 바이트에서 읽기 때문이다.
//
// ⚠️ RN 번들러는 `node:fs` 를 쓰지 못한다. `modelPath()`·`modelBytes()` 는 Node 용이므로,
// RN 에서는 모델을 앱 자산으로 넣고 그 경로·바이트를 직접 넘겨야 한다.
export { createNativePipeline } from "naranhi-collision-assessor/pipeline/native";
export { NrhAnalysisDependencyError } from "naranhi-collision-assessor";
