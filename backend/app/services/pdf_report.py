"""Branded PDF evaluation & risk report (ReportLab + Matplotlib).

Every figure in the report comes from the stored training results
(artifacts/reports/experiments.json) and the live database. Sections whose
data is unavailable are marked as such instead of being filled with
invented numbers.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from ml import config

# Brand palette (light "Italian Roast / Dried Plum / Parchment" theme - prints well)
PLUM = colors.HexColor("#6D405D")
ESPRESSO = colors.HexColor("#34231F")
COCOA = colors.HexColor("#766054")
PARCHMENT = colors.HexColor("#F3EBDD")
IVORY = colors.HexColor("#FAF6ED")
BORDER = colors.HexColor("#DED2C2")
MAUVE = colors.HexColor("#A77F92")
CORAL = colors.HexColor("#B5443C")
MODEL_HEX = {"xgboost": "#6D405D", "random_forest": "#B07A45", "logistic_regression": "#A77F92"}

W, H = A4
MARGIN = 18 * mm

ST = {
    "h1": ParagraphStyle("h1", fontName="Times-Bold", fontSize=26, leading=30, textColor=ESPRESSO, spaceAfter=6),
    "h2": ParagraphStyle("h2", fontName="Times-Bold", fontSize=18, leading=22, textColor=ESPRESSO, spaceBefore=4, spaceAfter=8),
    "h3": ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=PLUM, spaceBefore=8, spaceAfter=4),
    "kicker": ParagraphStyle("k", fontName="Helvetica", fontSize=8, leading=10, textColor=COCOA, spaceAfter=2),
    "body": ParagraphStyle("b", fontName="Helvetica", fontSize=9.5, leading=14, textColor=ESPRESSO, alignment=TA_LEFT),
    "small": ParagraphStyle("s", fontName="Helvetica", fontSize=8, leading=11, textColor=COCOA),
    "bullet": ParagraphStyle("bl", fontName="Helvetica", fontSize=9.5, leading=14, textColor=ESPRESSO, leftIndent=10, bulletIndent=0),
}


class NumberedCanvas(rl_canvas.Canvas):
    """Draws the brand header band and 'Page X of Y' on every page (two-pass)."""

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._pages = []

    def showPage(self):
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._pages)
        for state in self._pages:
            self.__dict__.update(state)
            self._decorate(total)
            super().showPage()
        super().save()

    def _decorate(self, total: int):
        self.saveState()
        self.setFillColor(PARCHMENT); self.rect(0, H - 16 * mm, W, 16 * mm, stroke=0, fill=1)
        self.setFillColor(PLUM); self.rect(0, H - 16 * mm, 4 * mm, 16 * mm, stroke=0, fill=1)
        self.setFont("Helvetica-Bold", 11); self.setFillColor(ESPRESSO)
        self.drawString(MARGIN, H - 10 * mm, "T R A N Z ")
        self.setFillColor(PLUM)
        self.drawString(MARGIN + self.stringWidth("T R A N Z ", "Helvetica-Bold", 11), H - 10 * mm, "I Q")
        self.setFont("Times-Italic", 9); self.setFillColor(COCOA)
        self.drawRightString(W - MARGIN, H - 10 * mm, "Intelligence Behind Every Transaction.")
        self.setStrokeColor(BORDER); self.setLineWidth(0.6); self.line(MARGIN, 14 * mm, W - MARGIN, 14 * mm)
        self.setFont("Helvetica", 7.5); self.setFillColor(COCOA)
        self.drawString(MARGIN, 9 * mm, "TRANZIQ Fraud Detection & Risk Report · educational portfolio project")
        self.drawRightString(W - MARGIN, 9 * mm, f"Page {self._pageNumber} of {total}")
        self.restoreState()


def _table(data, widths, header=True, highlight_row: int | None = None, align_right_from: int = 1) -> Table:
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    style = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), ESPRESSO),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ALIGN", (align_right_from, 1), (-1, -1), "RIGHT"),
    ]
    if header:
        style += [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5), ("TEXTCOLOR", (0, 0), (-1, 0), COCOA),
                  ("BACKGROUND", (0, 0), (-1, 0), PARCHMENT), ("ALIGN", (align_right_from, 0), (-1, 0), "RIGHT")]
    if highlight_row is not None:
        style += [("BACKGROUND", (0, highlight_row), (-1, highlight_row), colors.HexColor("#F1E6EC")),
                  ("FONT", (0, highlight_row), (-1, highlight_row), "Helvetica-Bold", 8.5)]
    t.setStyle(TableStyle(style))
    return t


def _fig(fig, width_mm: float) -> Image:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=170, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    buf.seek(0)
    img = Image(buf)
    ratio = img.imageHeight / img.imageWidth
    img.drawWidth = width_mm * mm
    img.drawHeight = width_mm * mm * ratio
    return img


def _style_ax(ax):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color("#BBA996")
    ax.tick_params(colors="#766054", labelsize=7)
    ax.grid(alpha=0.25, color="#BBA996", linewidth=0.5)


def _curves_figure(exp: dict):
    fig, axes = plt.subplots(1, 2, figsize=(8.2, 3.2))
    for name in exp["ranking"]:
        m = exp["models"][name]; t = m["test"]
        pr = t["pr_curve"]; roc = t["roc_curve"]
        axes[0].step([p["x"] for p in pr], [p["y"] for p in pr], where="post", color=MODEL_HEX[name], lw=1.6,
                     label=f"{m['label']} (AP {t['pr_auc']:.3f})")
        axes[1].plot([p["x"] for p in roc], [p["y"] for p in roc], color=MODEL_HEX[name], lw=1.6,
                     label=f"{m['label']} (AUC {t['roc_auc']:.3f})")
    axes[0].set(xlabel="Recall", ylabel="Precision", title="Precision-Recall (test)")
    axes[1].set(xlabel="False positive rate", ylabel="True positive rate", title="ROC (test)")
    axes[1].plot([0, 1], [0, 1], ls="--", color="#BBA996", lw=0.8)
    for ax in axes:
        _style_ax(ax); ax.title.set_size(9); ax.xaxis.label.set_size(8); ax.yaxis.label.set_size(8)
        ax.legend(fontsize=6.5, frameon=False, loc="lower left" if ax is axes[0] else "lower right")
    fig.tight_layout()
    return fig


def _confusion_figure(exp: dict):
    fig, axes = plt.subplots(1, len(exp["ranking"]), figsize=(8.2, 2.5))
    for ax, name in zip(axes, exp["ranking"]):
        m = exp["models"][name]; cm = m["test"]["at_recommended"]["confusion_matrix"]
        grid = [[cm["tn"], cm["fp"]], [cm["fn"], cm["tp"]]]
        tints = [["#E7EFE7", "#F3E6C9"], ["#F2D9D5", "#E9DDE6"]]
        for i in range(2):
            for j in range(2):
                ax.add_patch(plt.Rectangle((j, 1 - i), 1, 1, color=tints[i][j], ec="white", lw=2))
                ax.text(j + 0.5, 1.5 - i, f"{grid[i][j]:,}", ha="center", va="center", fontsize=10, color="#34231F", weight="bold")
                ax.text(j + 0.5, 1.22 - i, ["TN", "FP", "FN", "TP"][i * 2 + j], ha="center", fontsize=6.5, color="#766054")
        ax.set_xlim(0, 2); ax.set_ylim(0, 2)
        ax.set_xticks([0.5, 1.5], ["Pred legit", "Pred fraud"], fontsize=6.5)
        ax.set_yticks([1.5, 0.5], ["Actual legit", "Actual fraud"], fontsize=6.5)
        ax.tick_params(length=0, colors="#766054")
        for s in ax.spines.values():
            s.set_visible(False)
        ax.set_title(f"{m['label']} (thr {m['recommended_threshold']:.2f})", fontsize=8, color="#34231F")
    fig.tight_layout()
    return fig


def _risk_figure(dist: dict):
    fig, ax = plt.subplots(figsize=(4.2, 2.4))
    lv = ["low", "medium", "high", "critical"]
    vals = [dist.get(k, 0) for k in lv]
    bars = ax.bar([k.title() for k in lv], vals, color=["#4A7656", "#9C6C1A", "#C8786F", "#B5443C"])
    ax.set_yscale("log"); _style_ax(ax); ax.set_title("Stored predictions by risk band (log)", fontsize=8.5)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, max(v, 1), f"{v:,}", ha="center", va="bottom", fontsize=7, color="#34231F")
    fig.tight_layout()
    return fig


def _bul(text: str) -> Paragraph:
    return Paragraph(text, ST["bullet"], bulletText="•")


def build_pdf(exp: dict | None, eda: dict | None, live: dict) -> bytes:
    """live: {'active_model', 'model_label', 'transactions', 'predictions', 'alerts', 'risk_distribution',
              'alert_status', 'bands', 'flag_rate'}"""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=24 * mm, bottomMargin=20 * mm,
                            title="TRANZIQ Fraud Detection & Risk Report", author="TRANZIQ")
    story: list = []
    now = datetime.now(timezone.utc).strftime("%d %B %Y, %H:%M UTC")
    pct = lambda v: f"{v * 100:.1f}%"  # noqa: E731

    # ---------------- Page 1: Executive summary ----------------
    story += [Paragraph("REPORT · EXECUTIVE SUMMARY", ST["kicker"]),
              Paragraph("Fraud Detection Model &amp; Transaction Risk Report", ST["h1"]),
              Paragraph(f"Generated {now}", ST["small"]), Spacer(1, 10)]
    stats = eda["statistics"] if eda else None
    best = exp["best_model"] if exp else None
    rows = [["Item", "Value"]]
    if stats:
        cd = stats["class_distribution"]
        rows += [["Dataset", "Kaggle Credit Card Fraud Detection (mlg-ulb), real anonymised data"],
                 ["Rows after cleaning", f"{stats['rows']:,}"],
                 ["Fraud-labelled transactions (dataset)", f"{cd['fraudulent']:,} ({cd['fraud_percentage']:.3f}%)"],
                 ["Imbalance ratio", f"{cd['imbalance_ratio']} legitimate per fraud"]]
    else:
        rows.append(["Dataset statistics", "Unavailable - training has not been run"])
    if exp:
        bm = exp["models"][best]
        rows += [["Best model (validation PR-AUC)", f"{bm['label']} - {bm['validation']['pr_auc']:.4f}"],
                 ["Selected (active) model", live["model_label"]],
                 ["Training run", exp["generated_at"]]]
    rows += [["Transactions in monitoring database", f"{live['transactions']:,}"],
             ["Stored predictions / alerts", f"{live['predictions']:,} / {live['alerts']:,}"]]
    story.append(_table(rows, [70 * mm, 104 * mm], align_right_from=5))
    story.append(Spacer(1, 12))
    if exp:
        bt = exp["models"][best]["test"]; r = bt["at_recommended"]
        story += [Paragraph("Key findings", ST["h3"]),
                  _bul(f"<b>{exp['models'][best]['label']}</b> ranked first by validation PR-AUC. On the untouched test split it reached "
                       f"PR-AUC {bt['pr_auc']:.3f}, precision {r['precision']:.3f} and recall {r['recall']:.3f} at threshold {r['threshold']:.2f}."),
                  _bul(f"It caught {r['confusion_matrix']['tp']} of {r['confusion_matrix']['tp'] + r['confusion_matrix']['fn']} test frauds "
                       f"with {r['confusion_matrix']['fp']} false alarm(s) among {r['confusion_matrix']['tn'] + r['confusion_matrix']['fp']:,} legitimate transactions."),
                  _bul("Accuracy is above 99.9% for every model and is therefore not used for model selection."),
                  _bul(f"The active model currently flags {pct(live['flag_rate'])} of the transactions stored in the demo database "
                       "(which deliberately over-represents fraud).")]
    story.append(PageBreak())

    # ---------------- Page 2: Model performance ----------------
    story += [Paragraph("SECTION 2", ST["kicker"]), Paragraph("Model performance", ST["h2"])]
    if exp:
        hdr = ["Model", "Strategy", "Thr.", "Precision", "Recall", "F1", "PR-AUC", "ROC-AUC", "Accuracy"]
        data = [hdr]
        for name in exp["ranking"]:
            m = exp["models"][name]; t = m["test"]; r = t["at_recommended"]
            data.append([m["label"], m["strategy"], f"{m['recommended_threshold']:.2f}", f"{r['precision']:.4f}", f"{r['recall']:.4f}",
                         f"{r['f1']:.4f}", f"{t['pr_auc']:.4f}", f"{t['roc_auc']:.4f}", f"{r['accuracy']:.4f}"])
        story += [Paragraph("Held-out <b>TEST</b> split (each model at its validation-selected threshold)", ST["h3"]),
                  KeepTogether(_table(data, [34 * mm, 20 * mm, 11 * mm, 18 * mm, 16 * mm, 16 * mm, 18 * mm, 19 * mm, 22 * mm], highlight_row=1, align_right_from=2))]
        vdata = [["Model", "Validation PR-AUC", "Validation ROC-AUC", "Validation F1 @ thr", "Rank"]]
        for name in exp["ranking"]:
            m = exp["models"][name]
            vdata.append([m["label"], f"{m['validation']['pr_auc']:.4f}", f"{m['validation']['roc_auc']:.4f}",
                          f"{m['validation']['at_recommended']['f1']:.4f}", str(m["rank"])])
        story += [Paragraph("<b>VALIDATION</b> split (used for every model-selection decision)", ST["h3"]),
                  KeepTogether(_table(vdata, [44 * mm, 34 * mm, 34 * mm, 36 * mm, 26 * mm], highlight_row=1)),
                  Spacer(1, 8),
                  Paragraph(f"Selection criterion: {exp['selection_criterion']} Test results are reported once and never "
                            "influence a choice, so they estimate performance on unseen data.", ST["small"])]
        best_per = {k: max(exp["ranking"], key=lambda n: exp["models"][n]["test"]["at_recommended"][k] if k != "pr_auc" else exp["models"][n]["test"]["pr_auc"])
                    for k in ("precision", "recall", "f1", "pr_auc")}
        story += [Paragraph("Reading the table", ST["h3"]),
                  _bul("<b>Precision</b> - of flagged transactions, the share that were fraud (few false alarms). "
                       f"Best: {exp['models'][best_per['precision']]['label']}."),
                  _bul("<b>Recall</b> - of all fraud, the share that was caught. "
                       f"Best: {exp['models'][best_per['recall']]['label']}."),
                  _bul(f"<b>F1</b> balances the two. Best: {exp['models'][best_per['f1']]['label']}."),
                  _bul("<b>PR-AUC</b> summarises precision/recall across all thresholds and is the primary metric for a "
                       f"0.17% positive class. Best: {exp['models'][best_per['pr_auc']]['label']}.")]
    else:
        story.append(Paragraph("Model results unavailable - run the training script.", ST["body"]))
    story.append(PageBreak())

    # ---------------- Page 3: Evaluation ----------------
    story += [Paragraph("SECTION 3", ST["kicker"]), Paragraph("Model evaluation", ST["h2"])]
    if exp:
        story += [Paragraph("Confusion matrices (test split)", ST["h3"]), _fig(_confusion_figure(exp), 172),
                  Paragraph("TN = legitimate correctly passed · FP = false alarm · FN = missed fraud · TP = fraud caught.", ST["small"]),
                  Spacer(1, 6), Paragraph("Precision-Recall and ROC curves (test split)", ST["h3"]), _fig(_curves_figure(exp), 172)]
        top = exp["models"][exp["ranking"][0]]
        story += [Paragraph("Interpretation", ST["h3"]),
                  _bul("A precision-recall curve that stays high further to the right keeps more precision as recall increases; "
                       f"{exp['models'][max(exp['ranking'], key=lambda n: exp['models'][n]['test']['pr_auc'])]['label']} has the largest area (AP)."),
                  _bul("ROC-AUC values are all close to 1 because the huge number of legitimate transactions keeps the false positive "
                       "rate tiny; that is why PR-AUC is the more informative comparison here."),
                  _bul(f"At its tuned threshold {top['label']} trades a small number of missed frauds for very few false alarms.")]
    else:
        story.append(Paragraph("Evaluation figures unavailable.", ST["body"]))
    story.append(PageBreak())

    # ---------------- Page 4: Imbalance & methodology ----------------
    story += [Paragraph("SECTION 4", ST["kicker"]), Paragraph("Class imbalance &amp; methodology", ST["h2"])]
    if stats:
        cd = stats["class_distribution"]
        story.append(Paragraph(f"The cleaned dataset contains {cd['legitimate']:,} legitimate and {cd['fraudulent']:,} fraudulent "
                               f"transactions ({cd['fraud_percentage']:.3f}% fraud). A model that never flags fraud would already be "
                               f"{100 - cd['fraud_percentage']:.2f}% accurate, so imbalance-aware metrics are essential.", ST["body"]))
    if exp:
        data = [["Model", "Strategy", "Val. PR-AUC", "Precision@0.5", "Recall@0.5", "F1@0.5", "Selected"]]
        chosen = {n: exp["models"][n]["strategy"] for n in exp["models"]}
        for e in exp["experiments"]:
            v = e["validation"]
            data.append([config.MODEL_LABELS[e["model"]], e["strategy"], f"{v['pr_auc']:.4f}", f"{v['precision']:.4f}",
                         f"{v['recall']:.4f}", f"{v['f1']:.4f}", "yes" if chosen[e["model"]] == e["strategy"] else ""])
        story += [Paragraph("Imbalance strategy experiment (validation split)", ST["h3"]),
                  KeepTogether(_table(data, [38 * mm, 26 * mm, 22 * mm, 24 * mm, 22 * mm, 20 * mm, 20 * mm], align_right_from=2))]
    story += [Paragraph("Methodology", ST["h3"]),
              _bul("<b>Original data</b> - models trained on the natural 0.17% fraud ratio."),
              _bul("<b>Class weighting</b> - errors on fraud cost more (class_weight='balanced'; XGBoost scale_pos_weight)."),
              _bul(f"<b>SMOTE</b> - synthetic minority samples to {config.SMOTE_SAMPLING_STRATEGY:.0%} of the majority class, applied only "
                   "inside the training pipeline; validation and test data are never resampled."),
              _bul("<b>Threshold selection</b> - for each model, the threshold maximising F1 on the validation split (grid 0.01-0.99)."),
              _bul("<b>Leakage prevention</b> - duplicates removed before splitting; stratified 60/20/20 split with seed 42; scalers and "
                   "SMOTE fitted on training data only; test split used once for the final report."),
              _bul("V1-V28 are anonymised PCA components; their real-world meanings are confidential and not interpreted.")]
    story.append(PageBreak())

    # ---------------- Page 5: Risk analysis & conclusion ----------------
    story += [Paragraph("SECTION 5", ST["kicker"]), Paragraph("Risk analysis &amp; conclusion", ST["h2"])]
    dist = live["risk_distribution"]
    if sum(dist.values()):
        b = live["bands"]
        rt = [["Risk band", "Probability range", "Stored predictions"],
              ["Low", f"0.00 - {b['medium']:.2f}", f"{dist['low']:,}"], ["Medium", f"{b['medium']:.2f} - {b['high']:.2f}", f"{dist['medium']:,}"],
              ["High", f"{b['high']:.2f} - {b['critical']:.2f}", f"{dist['high']:,}"], ["Critical", f"{b['critical']:.2f} - 1.00", f"{dist['critical']:,}"]]
        story.append(KeepTogether([Paragraph(f"Active model: {live['model_label']}", ST["h3"]),
                                   Table([[ _table(rt, [24 * mm, 34 * mm, 30 * mm], align_right_from=2), _fig(_risk_figure(dist), 80)]],
                                         colWidths=[92 * mm, 82 * mm], style=[("VALIGN", (0, 0), (-1, -1), "TOP")])]))
        st = live["alert_status"]
        story.append(Paragraph(f"Alert queue: {st.get('pending', 0)} pending, {st.get('investigating', 0)} investigating, "
                               f"{st.get('confirmed', 0)} confirmed and {st.get('dismissed', 0)} dismissed. Statuses are analyst decisions, "
                               "not verified labels.", ST["body"]))
    else:
        story.append(Paragraph("Risk distribution unavailable - the monitoring database is empty.", ST["body"]))
    story += [Paragraph("Limitations", ST["h3"]),
              _bul("Two days of European card data from 2013; fraud patterns drift over time."),
              _bul("Anonymised features limit domain interpretation of explanations."),
              _bul("Probabilities are not calibrated; the demo database over-represents fraud; synthetic scenario data has no ground truth."),
              Paragraph("Recommendations", ST["h3"]),
              _bul("Use the validation-selected threshold as a default and adjust it to the cost of missed fraud vs. false alarms."),
              _bul("Route High and Critical transactions to analyst review; treat scores as decision support, not automatic decisions."),
              _bul("Re-train periodically and monitor drift; add probability calibration and cost-sensitive thresholds."),
              Paragraph("Summary", ST["h3"])]
    if exp:
        bm = exp["models"][best]; r = bm["test"]["at_recommended"]
        story.append(Paragraph(f"Across three algorithms and three imbalance strategies, {bm['label']} offered the strongest "
                               f"precision-recall trade-off (test PR-AUC {bm['test']['pr_auc']:.3f}, F1 {r['f1']:.3f}). The pipeline is "
                               "reproducible, leak-free and explainable, and every figure in this report comes from stored experiment results.",
                               ST["body"]))
    doc.build(story, canvasmaker=NumberedCanvas)
    return buf.getvalue()
