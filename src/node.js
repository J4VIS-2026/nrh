// Node 진입점 — 영상 파일을 넣으면 판정을 그려 넣은 mp4 가 나온다.
//
//   import { analyzeVideo } from "naranhi/node";
//   const report = await analyzeVideo("내영상.mp4", { out: "결과.mp4" });
//
// 명령줄로는 `npx naranhi 내영상.mp4` 다.
//
// ## 필요한 것
//
// 이 경로만 런타임 패키지가 필요하다. **라이브러리 본체는 아무것도 요구하지 않는다.**
//
//   npm install onnxruntime-node @napi-rs/canvas ffmpeg-static
//
// 셋 다 늦게 임포트하고, 없으면 설치 방법을 알려주며 멈춘다.
//
// ## 한 프레임에 하는 일
//
//   1. ffmpeg 로 프레임과 **실제 타임스탬프**를 얻는다 (`stride` 가 처리 주기)
//   2. 면적 평균 letterbox → 텐서 → `detectFromTensor`   탐지
//   3. `Tracker.update`                                  추적 (track_id)
//   4. `adaptNrhResult`                                  어댑터 (포맷①)
//   5. `assessor.assess` + 우선순위                       τ·위험도
//   6. Canvas 2D 로 그려서 ffmpeg 로 인코딩
//
// **프레임 사이의 상태는 3·5 가 스스로 들고 있다.** `Tracker` 는 트랙을,
// `CollisionAssessor` 는 직전 프레임·최근 창 이력·트래커별 EMA 를 유지한다.
import { basename } from "node:path";

import { CollisionAssessor, adaptNrhResult, loadConfig } from "naranhi-collision-assessor";
import { Tracker } from "nrh-detector";

import { canvasSize, drawOverlay, fillBackground, putFrame, registerFonts } from "./node/overlay.js";
import { DetectorSetupError, detectFrame, openSession } from "./node/session.js";
import { FfmpegMissingError, createEncoder, decodeFrames, findFfmpeg, probeVideo } from "./node/video.js";

export { DetectorSetupError, openSession, detectFrame } from "./node/session.js";
export { FfmpegMissingError, probeVideo, decodeFrames, createEncoder } from "./node/video.js";
export { LEVEL_COLORS, drawOverlay, registerFonts } from "./node/overlay.js";

const LEVELS = ["safe", "caution", "warning", "danger"];

/** 한 프레임에 붙은 우선순위. 1 = 이 프레임에서 가장 위험. */
function rank(frame, results) {
  return frame.objects
    .map((obj, i) => ({ obj, result: results[i] }))
    .sort((a, b) => b.result.risk_score - a.result.risk_score)
    .map((pair, i) => ({ priority: i + 1, ...pair }));
}

/**
 * 영상을 인식·평가해 판정을 그려 넣은 mp4 로 저장한다.
 *
 * @param {string} video 영상 파일 경로.
 * @param {object} [options]
 * @param {string} [options.out] 저장할 mp4. 생략하면 `<입력>_risk.mp4`.
 * @param {string} [options.model] `model.onnx` 경로. **비우면 번들된 모델**을 쓴다.
 * @param {object} [options.config] `loadConfig()` 결과. 생략하면 기본값.
 * @param {number} [options.stride=1] **처리 주기** — N프레임마다 하나씩.
 *   ⚠️ τ에 영향이 있다: 건너뛰면 Δt 가 커진다.
 * @param {number|null} [options.maxFrames] 이 수에 닿으면 멈춘다.
 * @param {(step:object)=>void} [options.onFrame] 프레임마다 부른다. 판정을 직접
 *   받아 쓰거나 로그로 남길 때.
 * @param {(n:number)=>void} [options.onProgress] 처리한 프레임 수를 알린다.
 * @returns 집계 — 프레임·평가 수, 등급 분포, 경로 게이트 분포, 최고 위험.
 */
export async function analyzeVideo(video, options = {}) {
  const {
    out = video.replace(/\.[^.]+$/, "") + "_risk.mp4",
    model,
    config = loadConfig(),
    stride = 1,
    maxFrames = null,
    onFrame,
    onProgress,
  } = options;

  // 캔버스는 **여기서 한 번만** 임포트한다. 없으면 설치 방법을 알려주며 멈춘다.
  const canvasModule = await importCanvas();
  registerFonts(canvasModule.GlobalFonts);

  const ffmpeg = await findFfmpeg();
  const info = await probeVideo(ffmpeg, video);
  const session = await openSession(model);

  // 상태를 들고 있는 둘. **영상 하나에 하나씩**이다.
  const tracker = new Tracker();
  const assessor = new CollisionAssessor(config);

  const { width: cw, height: ch } = canvasSize(info.width, info.height);
  const canvas = canvasModule.createCanvas(cw, ch);
  const ctx = canvas.getContext("2d");
  const encoder = createEncoder(ffmpeg, out, {
    width: cw,
    height: ch,
    fps: info.fps / Math.max(1, stride),
  });

  const report = {
    video: basename(video),
    out,
    width: info.width,
    height: info.height,
    fps: info.fps,
    rotation: info.rotation,
    frames: 0,
    assessments: 0,
    untracked: 0,
    degenerate: 0,
    levels: Object.fromEntries(LEVELS.map((l) => [l, 0])),
    gate: { full: 0, soft: 0, floor: 0 },
    worst: null,
  };

  try {
    for await (const { index, timestampMs, rgb } of decodeFrames(ffmpeg, video, info, {
      stride,
      maxFrames,
    })) {
      // stream 을 넣어야 어댑터가 **재생 시각**을 쓴다. 빼면 처리 시각이 Δt 가 되어
      // τ가 통째로 어긋난다.
      const raw = await detectFrame(session, rgb, info.width, info.height, {
        stream: { frame_index: index, timestamp_ms: timestampMs },
      });
      const tracked = tracker.update(raw, rgb);
      const { frame, stats } = adaptNrhResult(tracked, { source: "video" });
      const results = assessor.assess(frame);

      const step = {
        frameIndex: frame.frame_id,
        timestamp: frame.timestamp,
        frame,
        assessments: results,
        stats,
        ranked: rank(frame, results),
      };

      report.frames++;
      report.untracked += stats.untracked;
      report.degenerate += stats.degenerate;
      for (const r of results) {
        report.assessments++;
        report.levels[r.risk_level]++;
        if (r.factors.path_gate >= 1) report.gate.full++;
        else if (r.factors.path_gate > 0.05) report.gate.soft++;
        else report.gate.floor++;
        if (report.worst === null || r.risk_score > report.worst.risk_score) {
          report.worst = r;
        }
      }

      fillBackground(ctx, cw, ch);
      putFrame(ctx, rgb, info.width, info.height);
      drawOverlay(ctx, step, config);
      await encoder.write(rgbFromCanvas(ctx, cw, ch));

      onFrame?.(step);
      onProgress?.(report.frames);
    }
  } finally {
    await encoder.close();
  }

  return report;
}

async function importCanvas() {
  try {
    return await import("@napi-rs/canvas");
  } catch (err) {
    throw new DetectorSetupError(
      "@napi-rs/canvas 를 불러올 수 없습니다 (그리기에 필요합니다).\n" +
        "  npm install @napi-rs/canvas\n" +
        `  원인: ${err.message}`
    );
  }
}

/** 캔버스 픽셀을 rgb24 로. ffmpeg 는 알파를 받지 않는다. */
function rgbFromCanvas(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height);
  const rgb = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0, j = 0; j < data.length; i += 3, j += 4) {
    rgb[i] = data[j];
    rgb[i + 1] = data[j + 1];
    rgb[i + 2] = data[j + 2];
  }
  return rgb;
}

export { FfmpegMissingError as FfmpegError };
