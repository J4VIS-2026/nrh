// 인식 모듈을 Node 에서 돌린다.
//
// `nrh-detector` 는 진입점이 `/web`(브라우저)과 `/native`(React Native) 뿐이고 Node
// 진입점이 없다. **하지만 코어(`nrh-detector`)는 런타임을 모른다** — `Session` 계약
// 하나만 채워 주면 `detectFromTensor` 가 그대로 돈다. 그래서 여기서 그 계약을
// `onnxruntime-node` 로 채운다.
//
// 코어가 하지 않는 것이 하나 있다: **줄이고 채우기(letterbox)의 실제 리샘플링.**
// 대상마다 리샘플러가 달라서 일부러 빼 놓았다 (브라우저는 canvas, RN 은 opencv).
// 여기서는 축소 시 정보 손실을 줄이는 면적 평균(`INTER_AREA`)을 사용한다.
// 선택한 방식은 결과의 `settings.resize`에 기록된다.
import { readFileSync } from "node:fs";

import { modelPath as bundledModelPath } from "../model.js";

import {
  INPUT_SIZE,
  PAD_VALUE,
  detectFromTensor,
  letterbox,
  readClassMap,
  rgbToTensor,
} from "nrh-detector";

export const RESIZE_NAME = "node-area";

/**
 * 원본 RGB 를 letterbox 된 정사각 RGB 로 만든다.
 *
 * 축소는 **면적 평균**이다. 출력 픽셀 하나가 덮는 입력 영역을 전부 더해 나눈다 —
 * 최근접(nearest)으로 줄이면 얇은 볼라드·기둥이 통째로 사라진다.
 */
export function letterboxPixels(rgb, params) {
  const { origWidth: sw, origHeight: sh, newWidth: dw, newHeight: dh, padX, padY, inputSize } =
    params;
  const out = new Uint8Array(inputSize * inputSize * 3).fill(PAD_VALUE);

  const xRatio = sw / dw;
  const yRatio = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = Math.floor(dy * yRatio);
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((dy + 1) * yRatio)));
    const rowOut = ((dy + padY) * inputSize + padX) * 3;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = Math.floor(dx * xRatio);
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((dx + 1) * xRatio)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * sw + x0) * 3;
        for (let x = x0; x < x1; x++, i += 3) {
          r += rgb[i];
          g += rgb[i + 1];
          b += rgb[i + 2];
          n++;
        }
      }
      const o = rowOut + dx * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

export class DetectorSetupError extends Error {}

/**
 * Node 용 인식 세션을 만든다.
 *
 * @param modelFile `model.onnx` 경로. **비우면 이 패키지에 번들된 모델**을 쓴다.
 *   다른 모델을 시험할 때만 경로를 준다.
 */
export async function openSession(modelFile, { providers = ["cpu"] } = {}) {
  // 경로를 안 주면 **번들된 모델**을 쓴다. 이 패키지가 모델을 품고 있다.
  const resolved = modelFile ?? bundledModelPath();
  let ort;
  try {
    ort = (await import("onnxruntime-node")).default;
  } catch (err) {
    throw new DetectorSetupError(
      "onnxruntime-node 를 불러올 수 없습니다.\n" +
        "  npm install onnxruntime-node\n" +
        `  원인: ${err.message}`
    );
  }

  let bytes;
  try {
    bytes = readFileSync(resolved);
  } catch (err) {
    throw new DetectorSetupError(
      `모델 파일을 열 수 없습니다: ${resolved}\n` +
        "  이 패키지에 모델이 함께 들어 있습니다 — 경로를 비우면 그것을 씁니다.\n" +
        `  원인: ${err.message}`
    );
  }

  // **클래스 이름을 모델 metadata 에서 읽는다.** class_id 를 숫자로 박으면 안 된다 —
  // 원본 29클래스에서 5쌍이 병합돼 24개가 되면서 번호가 밀렸다.
  const classNames = readClassMap(bytes);
  const inner = await ort.InferenceSession.create(bytes, {
    executionProviders: providers,
  });

  return {
    async run(input, size) {
      const tensor = new ort.Tensor("float32", input, [1, 3, size, size]);
      const out = await inner.run({ [inner.inputNames[0]]: tensor });
      const first = out[inner.outputNames[0]];
      return { data: first.data, dims: first.dims };
    },
    providers,
    modelFile: resolved.split(/[\\/]/).pop(),
    modelName: null,
    classNames,
    resize: RESIZE_NAME,
  };
}

/**
 * 프레임 하나를 탐지한다. 전처리 시간을 직접 재서 넘긴다 (코어가 못 잰다).
 *
 * @param stream `{ frame_index, timestamp_ms }`. **영상이면 반드시 넣는다** —
 *   빼면 어댑터가 처리 시각(`received_at`)을 쓰게 되어 τ가 통째로 어긋난다.
 */
export async function detectFrame(session, rgb, width, height, { conf, iou, stream } = {}) {
  const params = letterbox(width, height);
  const started = performance.now();
  const pixels = letterboxPixels(rgb, params);
  const tensor = rgbToTensor(pixels, INPUT_SIZE);
  const preprocessMs = performance.now() - started;
  return detectFromTensor(session, tensor, params, preprocessMs, { conf, iou, stream });
}
