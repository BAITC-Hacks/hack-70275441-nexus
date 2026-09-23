import { clamp } from "./statistics.ts";

/**
 * Small, self-contained inferential-statistics helpers: Fisher-z confidence intervals for Pearson r,
 * exact two-tailed p-values via the regularized incomplete beta function, Holm step-down correction
 * for multiple comparisons, and a deterministic moving-block bootstrap for time-series correlation
 * stability. No ML, no fitted models — classical closed-form statistics only, per docs/methodology.md.
 */

export const MIN_N_FOR_INFERENCE = 6; // Fisher z needs n>3; below ~6 the interval is too wide to be meaningful.

// --- Lanczos approximation of ln(Gamma(x)), standard coefficients (Numerical Recipes). ---
const LANCZOS_G = 7;
const LANCZOS_COEF = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const xx = x - 1;
  let a = LANCZOS_COEF[0];
  const t = xx + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_G + 2; i += 1) a += LANCZOS_COEF[i] / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

// --- Regularized incomplete beta function I_x(a,b) via Lentz's continued fraction (Numerical Recipes 6.4). ---
function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAXIT = 200, EPS = 3e-9, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logBt = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(logBt);
  return x < (a + 1) / (a + b + 2)
    ? (bt * betaContinuedFraction(x, a, b)) / a
    : 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Two-tailed p-value for a Pearson r on n paired observations, via the exact Student-t relationship. */
export function pearsonPValue(r: number, n: number): number | null {
  if (n < MIN_N_FOR_INFERENCE) return null;
  const rClamped = clamp(r, -0.999999, 0.999999);
  const df = n - 2;
  const t = rClamped * Math.sqrt(df / (1 - rClamped * rClamped));
  const x = df / (df + t * t);
  return regularizedIncompleteBeta(x, df / 2, 0.5);
}

/** 95% CI for Pearson r via the Fisher z-transform. Returns null when n is too small for a meaningful interval. */
export function pearsonConfidenceInterval(r: number, n: number): { lower: number; upper: number } | null {
  if (n < MIN_N_FOR_INFERENCE) return null;
  const rClamped = clamp(r, -0.999999, 0.999999);
  const z = 0.5 * Math.log((1 + rClamped) / (1 - rClamped));
  const se = 1 / Math.sqrt(n - 3);
  const zCrit = 1.959963985; // 95% two-tailed normal critical value
  const lo = z - zCrit * se, hi = z + zCrit * se;
  return { lower: Math.tanh(lo), upper: Math.tanh(hi) };
}

/**
 * Holm step-down correction for multiple comparisons (more powerful than plain Bonferroni,
 * still exact/closed-form — no simulation). Returns which p-values are significant at familyAlpha.
 */
export function holmSignificant(pValues: number[], familyAlpha = 0.05): boolean[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const significant = new Array(m).fill(false);
  for (let rank = 0; rank < m; rank += 1) {
    const threshold = familyAlpha / (m - rank);
    if (order[rank].p <= threshold) significant[order[rank].i] = true;
    else break; // Holm stops at the first non-rejection
  }
  return significant;
}

// --- Deterministic PRNG (mulberry32) so bootstrap results are reproducible for identical inputs. ---
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export interface BootstrapResult {
  observedCorrelation: number;
  bootstrapMedian: number;
  ci95: { lower: number; upper: number };
  successfulResamples: number;
  stabilityLabel: "STABLE" | "MODERATE" | "UNSTABLE";
}

/**
 * Moving-block bootstrap for a paired time series (NOT plain row resampling, which would destroy
 * lag/temporal structure). Resamples contiguous blocks with a deterministic seed derived from the
 * input itself, so identical data always reproduces the identical result.
 */
export function movingBlockBootstrap(a: number[], b: number[], seedKey: string, iterations = 400): BootstrapResult {
  const n = Math.min(a.length, b.length);
  const pearsonCorrelation = (x: number[], y: number[]) => {
    const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
    const num = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
    const den = Math.sqrt(x.reduce((s, v) => s + (v - mx) ** 2, 0) * y.reduce((s, v) => s + (v - my) ** 2, 0));
    return den ? num / den : 0;
  };
  const observedCorrelation = pearsonCorrelation(a.slice(0, n), b.slice(0, n));
  if (n < MIN_N_FOR_INFERENCE) {
    return { observedCorrelation, bootstrapMedian: observedCorrelation, ci95: { lower: observedCorrelation, upper: observedCorrelation }, successfulResamples: 0, stabilityLabel: "UNSTABLE" };
  }
  const blockLength = Math.max(2, Math.min(Math.floor(n / 3), Math.round(Math.sqrt(n))));
  const rng = mulberry32(hashSeed(seedKey));
  const samples: number[] = [];
  for (let iter = 0; iter < iterations; iter += 1) {
    const resampledA: number[] = [], resampledB: number[] = [];
    while (resampledA.length < n) {
      const start = Math.floor(rng() * (n - blockLength + 1));
      for (let k = 0; k < blockLength && resampledA.length < n; k += 1) {
        resampledA.push(a[start + k]);
        resampledB.push(b[start + k]);
      }
    }
    const r = pearsonCorrelation(resampledA, resampledB);
    if (Number.isFinite(r)) samples.push(r);
  }
  samples.sort((x, y) => x - y);
  const percentile = (p: number) => samples[clamp(Math.round(p * (samples.length - 1)), 0, samples.length - 1) | 0];
  const bootstrapMedian = percentile(0.5);
  const ci95 = { lower: percentile(0.025), upper: percentile(0.975) };
  const sameSignShare = samples.filter((r) => Math.sign(r) === Math.sign(observedCorrelation) || observedCorrelation === 0).length / (samples.length || 1);
  const stabilityLabel = sameSignShare >= 0.9 ? "STABLE" : sameSignShare >= 0.7 ? "MODERATE" : "UNSTABLE";
  return { observedCorrelation, bootstrapMedian, ci95, successfulResamples: samples.length, stabilityLabel };
}
