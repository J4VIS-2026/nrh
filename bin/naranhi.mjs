#!/usr/bin/env node
// 나란히 명령줄 도구 — 영상을 넣으면 판정을 그려 넣은 mp4 가 나온다.
//
//   npx naranhi 내영상.mp4
//   npx naranhi 내영상.mp4 --stride 2 --jsonl 결과.jsonl
//
// 모델은 이 패키지에 들어 있어서 따로 줄 필요가 없다.
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadConfig } from "naranhi-collision-assessor";

import { DetectorSetupError, FfmpegError, analyzeVideo } from "../src/node.js";
import { modelPath } from "../src/model.js";

const LEVELS = ["safe", "caution", "warning", "danger"];

function usage() {
  console.log(`나란히 — 인식 + 분석 통합

사용법
  naranhi <영상> [옵션]

옵션
  -o, --out <경로>    저장할 mp4. 생략하면 <입력>_risk.mp4
  --stride <N>        처리 주기 — N프레임마다 하나씩 (기본 1). τ에 영향이 있다
  --max-frames <N>    앞 N프레임만
  --jsonl <경로>      프레임별 판정을 남긴다 (우선순위·요인 포함)
  --model <경로>      다른 모델을 시험할 때만. 기본은 이 패키지에 든 모델
  --set <섹션.키=값>   평가 설정을 덮어쓴다. 여러 번 줄 수 있다
  -h, --help

예시
  naranhi sidewalk.mp4
  naranhi sidewalk.mp4 --max-frames 100 --stride 2
  naranhi sidewalk.mp4 --set trapezoid.topH=78 --set sigmoid.tau0=3

이 경로는 런타임 패키지 셋이 필요하다 (라이브러리 본체는 아무것도 요구하지 않는다):
  npm install onnxruntime-node @napi-rs/canvas ffmpeg-static
`);
}

/** ``["sigmoid.tau0=2.5"]`` → ``{ sigmoid: { tau0: 2.5 } }``. */
function parseOverrides(pairs) {
  const out = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at < 0) throw new Error(`--set 은 '섹션.키=값' 꼴이어야 합니다: ${pair}`);
    const path = pair.slice(0, at);
    const raw = pair.slice(at + 1);
    const value = raw === "" || Number.isNaN(Number(raw)) ? raw : Number(raw);
    const dot = path.indexOf(".");
    if (dot < 0) {
      out[path] = value; // defaultClassWeight 처럼 스칼라인 것
      continue;
    }
    (out[path.slice(0, dot)] ??= {})[path.slice(dot + 1)] = value;
  }
  return out;
}

function openLog(path) {
  mkdirSync(dirname(resolve(path)) || ".", { recursive: true });
  const stream = createWriteStream(path, { encoding: "utf8" });
  return {
    write(step) {
      stream.write(
        JSON.stringify({
          frame_id: step.frameIndex,
          timestamp: step.timestamp,
          // 판정만 남기면 **무엇에 대한 판정인지 알 수 없다** — 결과에는
          // `tracker_id` 뿐이고 클래스도 박스도 없다. 그래서 객체 쪽에서 둘을 붙인다.
          ranked: step.ranked.map((e) => ({
            priority: e.priority,
            class_name: e.obj.class_name,
            bbox: e.obj.bbox,
            confidence: e.obj.confidence,
            ...e.result,
          })),
        }) + "\n"
      );
    },
    close() {
      return new Promise((r) => stream.end(r));
    },
  };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        out: { type: "string", short: "o" },
        stride: { type: "string", default: "1" },
        "max-frames": { type: "string" },
        jsonl: { type: "string" },
        model: { type: "string" },
        set: { type: "string", multiple: true, default: [] },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (err) {
    console.error(`${err.message}\n`);
    usage();
    return 2;
  }
  const { values: opt, positionals } = parsed;

  if (opt.help) {
    usage();
    return 0;
  }
  if (positionals.length === 0) {
    usage();
    return 2;
  }

  let config;
  try {
    config = loadConfig(parseOverrides(opt.set));
  } catch (err) {
    console.error(`설정 오류: ${err.message}`);
    return 2;
  }

  const log = opt.jsonl ? openLog(opt.jsonl) : null;
  let report;
  try {
    report = await analyzeVideo(positionals[0], {
      out: opt.out,
      model: opt.model,
      config,
      stride: Math.max(1, Number(opt.stride) || 1),
      maxFrames: opt["max-frames"] ? Number(opt["max-frames"]) : null,
      onFrame: log ? (step) => log.write(step) : undefined,
      onProgress: (n) => {
        if (n % 25 === 0) process.stdout.write(`  ${n}프레임...\n`);
      },
    });
  } catch (err) {
    if (err instanceof DetectorSetupError || err instanceof FfmpegError) {
      console.error(err.message);
      return 2;
    }
    console.error(`${err.message}`);
    return 1;
  } finally {
    if (log) await log.close();
  }

  const n = report.assessments || 1;
  console.log(
    `\n영상 ${report.video} — ${report.width}×${report.height} · ${report.fps}fps` +
      (report.rotation ? ` · 회전 ${report.rotation}도 (적용됨)` : "")
  );
  console.log(`모델 ${modelPath().split(/[\\/]/).pop()} (번들)`);
  console.log(`프레임 ${report.frames} / 평가 ${report.assessments}`);
  console.log(
    `경로 게이트 — 완전통과 ${((report.gate.full / n) * 100).toFixed(1)}%` +
      `  완충 ${((report.gate.soft / n) * 100).toFixed(1)}%` +
      `  하한 ${((report.gate.floor / n) * 100).toFixed(1)}%`
  );
  for (const level of LEVELS) {
    console.log(
      `  ${level.padEnd(9)} ${String(report.levels[level]).padStart(7)}` +
        `  ${((report.levels[level] / n) * 100).toFixed(2).padStart(6)}%`
    );
  }
  if (report.worst) {
    console.log(
      `최고 위험: tracker=${report.worst.tracker_id} ${report.worst.risk_level} ` +
        report.worst.risk_score.toFixed(4)
    );
  }
  if (report.untracked) {
    console.log(`추적 미확정 ${report.untracked}건 (정상 — 방금 나타난 것들)`);
  }
  if (report.degenerate) console.log(`면적 0이라 버린 박스 ${report.degenerate}개`);
  console.log(`\n→ ${report.out}`);
  if (opt.jsonl) console.log(`→ ${opt.jsonl}`);
  return 0;
}

process.exitCode = await main();
