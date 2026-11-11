/**
 * Chart interpretations for the Model Lab, generated from the stored experiment
 * metrics. Nothing names a "winner" unless the numbers say so.
 */
import type { ReactNode } from "react";
import { MODEL_LABELS, MODELS, type ModelEval, type ModelName } from "./types";

type Evals = Record<ModelName, ModelEval>;
const L = (m: ModelName) => MODEL_LABELS[m];
const f3 = (v: number) => v.toFixed(3);
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

function best(evals: Evals, get: (e: ModelEval) => number): { m: ModelName; v: number; second: { m: ModelName; v: number } } {
  const sorted = [...MODELS].sort((a, b) => get(evals[b]) - get(evals[a]));
  return { m: sorted[0], v: get(evals[sorted[0]]), second: { m: sorted[1], v: get(evals[sorted[1]]) } };
}

export function metricsInsight(evals: Evals, at: "at_recommended" | "at_default"): ReactNode {
  const p = best(evals, (e) => e.test[at].precision);
  const r = best(evals, (e) => e.test[at].recall);
  const f = best(evals, (e) => e.test[at].f1);
  const a = best(evals, (e) => e.test.pr_auc);
  const where = at === "at_recommended" ? "at each model's tuned threshold" : "at the default 0.50 threshold";
  return (
    <>
      <p><b>Precision</b> is the share of flagged transactions that really were fraud: high precision means few false alarms.
        <b> Recall</b> is the share of all fraud that was caught: high recall means few missed frauds. <b>F1</b> is their harmonic mean,
        and it only stays high when both are high.</p>
      <p><b>PR-AUC</b> summarises precision and recall across every possible threshold. Fraud is about 0.17% of transactions, so a model
        that flags nothing is still 99.8% accurate. PR-AUC exposes that; accuracy hides it.</p>
      <p>On the test split, {where}: best precision is <b>{L(p.m)}</b> ({f3(p.v)}), best recall is <b>{L(r.m)}</b> ({f3(r.v)}),
        best F1 is <b>{L(f.m)}</b> ({f3(f.v)}) and best PR-AUC is <b>{L(a.m)}</b> ({f3(a.v)}, ahead of {L(a.second.m)} by {f3(a.v - a.second.v)}).
        {p.m !== r.m && <> No single model wins everything: {L(p.m)} raises fewer false alarms, while {L(r.m)} misses less fraud.</>}</p>
    </>
  );
}

export function prInsight(evals: Evals, prevalence: number): ReactNode {
  const a = best(evals, (e) => e.test.pr_auc);
  const worst = [...MODELS].sort((x, y) => evals[x].test.pr_auc - evals[y].test.pr_auc)[0];
  return (
    <>
      <p>The <b>x-axis is recall</b> (share of fraud caught) and the <b>y-axis is precision</b> (share of flags that are correct). Each point is one
        threshold: moving right means a lower threshold, which catches more fraud but usually with more false alarms.</p>
      <p>A curve that stays <b>higher for longer</b> is better: it keeps precision while recall grows. The <b>Average Precision (AP)</b> in the legend
        is the area under the curve. A random guesser would score about the fraud rate ({pct(prevalence, 2)}).</p>
      <p><b>{L(a.m)}</b> has the strongest precision-recall trade-off (AP {f3(a.v)}). {L(worst)} is lowest (AP {f3(evals[worst].test.pr_auc)}),
        but every model is far above random.</p>
    </>
  );
}

export function rocInsight(evals: Evals): ReactNode {
  const roc = best(evals, (e) => e.test.roc_auc);
  const pr = best(evals, (e) => e.test.pr_auc);
  const rocOrder = [...MODELS].sort((a, b) => evals[b].test.roc_auc - evals[a].test.roc_auc);
  const prOrder = [...MODELS].sort((a, b) => evals[b].test.pr_auc - evals[a].test.pr_auc);
  const same = rocOrder.join() === prOrder.join();
  return (
    <>
      <p>The <b>True Positive Rate</b> (y) is recall: the share of fraud flagged. The <b>False Positive Rate</b> (x) is the share of legitimate
        transactions wrongly flagged. <b>ROC-AUC</b> is the probability that a random fraud gets a higher score than a random legitimate
        transaction.</p>
      <p>All models score between {f3(Math.min(...MODELS.map((m) => evals[m].test.roc_auc)))} and {f3(roc.v)} ({L(roc.m)} highest), so ROC makes them look
        similar. With over 56,000 legitimate test transactions, even dozens of false alarms barely move the FPR. That is why <b>PR-AUC
        is the more informative comparison for this dataset</b>.{" "}
        {same ? "Here both metrics rank the models in the same order." : `Note that the ROC ranking differs from the PR-AUC ranking, which favours ${L(pr.m)}.`}</p>
    </>
  );
}

export function histInsight(e: ModelEval, label: string): ReactNode {
  const thr = e.recommended_threshold;
  let fAbove = 0, lAbove = 0, fTot = 0, lTot = 0, fLow = 0;
  for (const b of e.test.probability_histogram) {
    const lo = Number(b.bin.split("-")[0]);
    fTot += b.fraud; lTot += b.legitimate;
    if (lo >= 0.5) { fAbove += b.fraud; lAbove += b.legitimate; }
    if (lo < 0.05) fLow += b.fraud;
  }
  return (
    <>
      <p>Each bar counts held-out test transactions whose predicted fraud probability falls in that range, split by their <b>true</b> label.
        The y-axis is logarithmic, because legitimate transactions outnumber fraud by about 600 to 1.</p>
      <p>For <b>{label}</b>, {pct(lTot ? 1 - lAbove / lTot : 0, 2)} of legitimate transactions score below 0.50, while {pct(fTot ? fAbove / fTot : 0)} of
        fraud scores at or above 0.50. Well-separated classes look like that: legitimate mass piled near 0, fraud mass near 1.</p>
      <p>The overlap is the hard part: {fLow} fraud case(s) ({pct(fTot ? fLow / fTot : 0)}) score below 0.05 and look completely normal to the model.
        No threshold can catch those without flagging huge numbers of legitimate transactions. The tuned threshold of {thr.toFixed(2)} sits in the gap.</p>
    </>
  );
}

export function confusionInsight(evals: Evals, at: "at_recommended" | "at_default"): ReactNode {
  return (
    <>
      <p><b>True Positive (TP)</b>: fraud correctly flagged. <b>True Negative (TN)</b>: legitimate correctly passed.
        <b> False Positive (FP)</b>: a false alarm on a legitimate customer. <b>False Negative (FN)</b>: fraud the model missed, usually the costliest error.</p>
      {MODELS.map((m) => {
        const cm = evals[m].test[at].confusion_matrix;
        const fraud = cm.tp + cm.fn, legit = cm.tn + cm.fp;
        return (
          <p key={m}><b>{L(m)}</b> (threshold {evals[m].test[at].threshold.toFixed(2)}) caught {cm.tp} of {fraud} frauds ({pct(cm.tp / fraud)}),
            missed {cm.fn}, and raised {cm.fp} false alarm{cm.fp === 1 ? "" : "s"}: about one per {cm.fp ? Math.round(legit / cm.fp).toLocaleString() : "∞"} legitimate transactions.</p>
        );
      })}
    </>
  );
}

export function thresholdInsight(e: ModelEval, label: string): ReactNode {
  const tbl = e.test.threshold_table;
  const lo = tbl[0], hi = tbl[tbl.length - 1];
  return (
    <>
      <p>Raising the threshold makes the model <b>stricter</b>: it flags fewer transactions, so <b>precision rises</b> (flags are more often right)
        and <b>recall falls</b> (more fraud slips through). Lowering it does the opposite.</p>
      <p>For {label}, moving from {lo.threshold.toFixed(2)} to {hi.threshold.toFixed(2)} changes false alarms from {lo.confusion_matrix.fp} to {hi.confusion_matrix.fp} and
        missed fraud from {lo.confusion_matrix.fn} to {hi.confusion_matrix.fn} (precision {f3(lo.precision)} → {f3(hi.precision)}, recall {f3(lo.recall)} → {f3(hi.recall)}).</p>
      <p>The recommended threshold <b>{e.recommended_threshold.toFixed(2)}</b> was chosen on the <b>validation</b> split as the value that maximises F1
        (validation F1 {f3(e.validation.at_recommended.f1)}). It was never tuned on the test data shown here. A team that values catching fraud over
        avoiding false alarms would pick a lower threshold.</p>
    </>
  );
}

export interface Experiment { model: ModelName; strategy: string; validation: { pr_auc: number; precision: number; recall: number; f1: number } }

export function imbalanceInsight(exps: Experiment[]): ReactNode {
  const by = (m: ModelName, s: string) => exps.find((e) => e.model === m && e.strategy === s)!;
  const winners = MODELS.map((m) => {
    const opts = exps.filter((e) => e.model === m).sort((a, b) => b.validation.pr_auc - a.validation.pr_auc);
    return { m, s: opts[0].strategy, v: opts[0].validation.pr_auc };
  });
  const counts: Record<string, number> = {};
  winners.forEach((w) => (counts[w.s] = (counts[w.s] ?? 0) + 1));
  const lr = by("logistic_regression", "class_weight"), lrNone = by("logistic_regression", "none");
  return (
    <>
      <p><b>Original</b> trains on the natural 0.17% fraud rate. <b>Class weighting</b> makes each fraud example count more during training.
        <b> SMOTE</b> creates synthetic fraud examples by interpolating between real ones (inside the training pipeline only, never on
        validation or test data).</p>
      <p>Measured by validation PR-AUC, the selected strategy was: {winners.map((w, i) => (
        <span key={w.m}>{i > 0 && (i === winners.length - 1 ? " and " : ", ")}<b>{L(w.m)}</b> → {w.s.replace("_", " ")} ({f3(w.v)})</span>
      ))}.{" "}
        {Object.keys(counts).length === 1
          ? `All three models did best with "${winners[0].s.replace("_", " ")}" on this dataset.`
          : "Different models preferred different strategies."}</p>
      <p>The main effect of re-weighting is to <b>push probabilities upward</b>. At a fixed 0.50 threshold, Logistic Regression with class weights reaches
        recall {f3(lr.validation.recall)} (vs {f3(lrNone.validation.recall)}), but precision collapses to {f3(lr.validation.precision)}.
        Because TRANZIQ tunes the threshold afterwards, that shift matters less than how well the model <i>ranks</i> transactions, which
        is what PR-AUC measures. Resampling therefore isn't automatically better; it has to earn its place on validation data.</p>
    </>
  );
}
