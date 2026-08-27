// 통합 진입점이 두 모듈을 제대로 합치는지 못 박는다.
//
// `export *` 두 개를 쓰기 때문에 **이름이 겹치면 ESM 이 그 이름을 조용히 빼 버린다.**
// 조용히 사라지는 것이 가장 나쁘므로 여기서 잡는다.
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { test } from "node:test";

import * as assessorModule from "naranhi-collision-assessor";
import * as detectorModule from "nrh-detector";

import * as naranhi from "../src/index.js";

const names = (mod) => Object.keys(mod).filter((k) => k !== "default");

test("두 모듈의 export 이름이 겹치지 않는다", () => {
  const a = new Set(names(assessorModule));
  const dup = names(detectorModule).filter((k) => a.has(k));
  assert.deepEqual(
    dup,
    [],
    `이름이 겹치면 export * 가 그것을 빼 버린다: ${dup.join(", ")}\n` +
      "src/index.js 를 명시적 재내보내기로 바꾸거나 이름을 바꿔야 한다."
  );
});

test("통합 진입점이 분석 API 를 전부 낸다", () => {
  for (const key of names(assessorModule)) {
    assert.ok(key in naranhi, `분석 export 가 빠졌다: ${key}`);
  }
});

test("통합 진입점이 인식 API 를 전부 낸다", () => {
  for (const key of names(detectorModule)) {
    assert.ok(key in naranhi, `인식 export 가 빠졌다: ${key}`);
  }
});

test("주요 API 가 이름 그대로 나온다", () => {
  for (const key of [
    "CollisionAssessor",
    "loadConfig",
    "adaptNrhResult",
    "assessFrame",
    "traceSequence",
    "SCENARIOS",
    "Tracker",
    "letterbox",
    "rgbToTensor",
    "detectFromTensor",
    "readClassMap",
    "INPUT_SIZE",
    "modelPath",
  ]) {
    assert.ok(key in naranhi, `없음: ${key}`);
  }
});

test("이름공간으로도 닿는다", () => {
  assert.equal(typeof naranhi.assessor.loadConfig, "function");
  assert.equal(typeof naranhi.detector.letterbox, "function");
});

test("모델이 패키지 안에 있고 열린다", () => {
  const path = naranhi.modelPath();
  assert.ok(existsSync(path), `번들 모델이 없다: ${path}`);
  // int8 양자화 모델이 3.3MB 다. 0바이트나 LFS 포인터가 실려 오는 것을 막는다.
  const size = statSync(path).size;
  assert.ok(size > 2_000_000, `모델이 너무 작다 (${size}바이트) — 실물이 맞나?`);
  assert.equal(naranhi.MODEL_FILE, "model.onnx");
});

test("번들 모델에서 클래스 24개를 읽는다", () => {
  // **class_id 를 숫자로 박으면 안 된다** — 원본 29클래스에서 5쌍이 병합돼 24개가
  // 되면서 번호가 밀렸다 (person 8→7, bollard 15→12). 그 사실을 여기서 고정한다.
  const classes = naranhi.readClassMap(naranhi.modelBytes());
  assert.equal(classes.size, 24);
  assert.equal(classes.get(7), "person");
  assert.equal(classes.get(12), "bollard");
});

test("모델만으로 평가까지 이어진다 (인식 없이)", () => {
  // 인식 결과 모양을 직접 만들어 넣는다 — ONNX 런타임 없이도 분석은 돌아야 한다.
  const assessor = new naranhi.CollisionAssessor(naranhi.loadConfig());
  let last;
  for (let i = 0; i < 5; i++) {
    const h = 30 + i * 20;
    last = assessor.assess({
      frame_id: i,
      timestamp: i * 0.2,
      frame_size: { width: 1080, height: 1920 },
      objects: [
        {
          tracker_id: 1,
          class_name: "micromobility",
          confidence: 0.9,
          bbox: { x: 480, y: 1500 - h, w: h * 0.8, h },
        },
      ],
    });
  }
  assert.equal(last[0].risk_level, "danger");
  assert.ok(Math.abs(last[0].risk_score - 0.89985) < 1e-4, last[0].risk_score);
});
