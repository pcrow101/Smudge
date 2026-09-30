/**
 * Interactive benchmark page. Not part of the shipped bundle — run with
 * `npm run bench` (opens a Vite dev server) and use the buttons to load
 * synthetic documents of various sizes, then watch keystroke latency and
 * scroll frame time reported live.
 *
 * This intentionally boots the *real* editor entry point (`../src/index`),
 * so numbers reflect exactly what ships, not a simplified stand-in.
 */
import "../src/index";
import { generateFixture, FIXTURE_SIZES } from "./fixtures";

const log = document.getElementById("log")!;
const results = document.getElementById("results")!;

function report(label: string, value: string): void {
  const row = document.createElement("tr");
  row.innerHTML = `<td>${label}</td><td>${value}</td>`;
  results.appendChild(row);
}

function print(message: string): void {
  log.textContent += `${message}\n`;
  log.scrollTop = log.scrollHeight;
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function waitReady(): Promise<void> {
  while (!window.SmudgeEditor) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function runLoadAndTypeBenchmark(sizeBytes: number, label: string): Promise<void> {
  await waitReady();
  results.innerHTML = "";
  print(`--- ${label} (${(sizeBytes / 1024 / 1024).toFixed(2)} MB) ---`);

  const fixture = generateFixture(sizeBytes);
  const editor = window.SmudgeEditor;

  // First paint: time from setDoc() to the browser actually committing a frame.
  const loadStart = performance.now();
  editor.setDoc(fixture, 1);
  await nextFrame();
  await nextFrame();
  const loadMs = performance.now() - loadStart;
  report("First paint", `${loadMs.toFixed(1)} ms`);
  print(`First paint (setDoc → 2 frames): ${loadMs.toFixed(1)} ms`);

  // Keystroke latency: simulate typing several characters in a row (the
  // realistic case — each insertText call advances the cursor, just like an
  // actual keystroke) and measure how long each one takes to settle.
  const editorEl = document.querySelector(".cm-content") as HTMLElement | null;
  editorEl?.focus();

  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    editor.insertText("x");
    await nextFrame();
    samples.push(performance.now() - start);
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const max = Math.max(...samples);
  report("Keystroke avg", `${avg.toFixed(2)} ms`);
  report("Keystroke max", `${max.toFixed(2)} ms`);
  print(`Keystroke latency: avg ${avg.toFixed(2)} ms, max ${max.toFixed(2)} ms (20 samples)`);
}

async function runScrollBenchmark(): Promise<void> {
  const scroller = document.querySelector(".cm-scroller") as HTMLElement | null;
  if (!scroller) {
    print("No document loaded yet — load a fixture first.");
    return;
  }
  const frameTimes: number[] = [];
  let last = performance.now();
  const steps = 60;
  for (let i = 0; i < steps; i++) {
    scroller.scrollTop = (scroller.scrollHeight / steps) * i;
    await nextFrame();
    const now = performance.now();
    frameTimes.push(now - last);
    last = now;
  }
  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const max = Math.max(...frameTimes);
  const fps = 1000 / avg;
  report("Scroll frame avg", `${avg.toFixed(2)} ms (${fps.toFixed(0)} fps)`);
  report("Scroll frame max", `${max.toFixed(2)} ms`);
  print(`Scroll: avg frame ${avg.toFixed(2)} ms (${fps.toFixed(0)} fps), max ${max.toFixed(2)} ms`);
}

document.querySelectorAll<HTMLButtonElement>("button[data-size]").forEach((button) => {
  button.addEventListener("click", () => {
    const kb = Number(button.dataset.size);
    void runLoadAndTypeBenchmark(kb * 1024, button.textContent ?? `${kb} KB`);
  });
});

document.getElementById("scroll-test")?.addEventListener("click", () => void runScrollBenchmark());

void (async () => {
  await waitReady();
  print("Editor ready. Pick a document size to benchmark.");
})();

void FIXTURE_SIZES; // referenced for discoverability from the console during manual runs
