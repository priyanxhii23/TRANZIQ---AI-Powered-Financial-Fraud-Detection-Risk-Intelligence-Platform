export type ModelName = "logistic_regression" | "random_forest" | "xgboost";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Source = "kaggle" | "synthetic" | "user";
export type AlertStatus = "pending" | "investigating" | "confirmed" | "dismissed";

export const MODEL_LABELS: Record<ModelName, string> = {
  logistic_regression: "Logistic Regression",
  random_forest: "Random Forest",
  xgboost: "XGBoost",
};
export const MODEL_SHORT: Record<ModelName, string> = { logistic_regression: "LOGREG", random_forest: "RFOREST", xgboost: "XGB" };
export const MODELS: ModelName[] = ["logistic_regression", "random_forest", "xgboost"];
export const RISK_LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"];
export const FEATURES = ["Time", ...Array.from({ length: 28 }, (_, i) => `V${i + 1}`), "Amount"];

export interface Prediction {
  id: number;
  model_name: ModelName;
  model_version: string;
  probability: number;
  threshold: number;
  predicted_label: number;
  risk_level: RiskLevel;
  created_at: string;
}

export interface Tx {
  id: number;
  external_id: string;
  source: Source;
  event_time: string;
  amount: number;
  customer_id: string | null;
  merchant: string | null;
  merchant_category: string | null;
  country: string | null;
  city: string | null;
  channel: string | null;
  device: string | null;
  status: string | null;
  generation_profile: string | null;
  ground_truth: number | null;
  created_at: string;
  prediction?: Prediction | null;
}

export interface TxDetail extends Tx {
  features: Record<string, number>;
  predictions: Prediction[];
  prediction_history_count: number;
  alerts: { id: number; status: AlertStatus; severity: RiskLevel; created_at: string }[];
}

export interface Paged<T> {
  total: number;
  page: number;
  page_size: number;
  pages: number;
  items: T[];
}

export interface Alert {
  id: number;
  status: AlertStatus;
  severity: RiskLevel;
  analyst_note: string | null;
  created_at: string;
  updated_at: string;
  transaction: Tx;
  prediction: Prediction;
}

export interface AlertSummary {
  total: number;
  by_status: Record<AlertStatus, number>;
  by_severity: Record<RiskLevel, number>;
}

export interface Contribution {
  feature: string;
  value: number;
  shap_value: number;
  direction: "towards_fraud" | "towards_legitimate";
  note: string;
}

export interface Explanation {
  base_value: number;
  output_units: string;
  model_output: number;
  contributions: Contribution[];
}

export interface RiskInfo {
  level: RiskLevel;
  label: string;
  range: [number, number];
  recommended_action: string;
  explanation: string;
  probability: number;
  threshold: number | null;
  predicted_label: number | null;
}

export interface PredictResult {
  model: ModelName;
  model_label: string;
  model_version: string;
  probability: number;
  threshold: number;
  predicted_label: number;
  prediction: "fraud" | "legitimate";
  risk: RiskInfo;
  transaction_id: number | null;
  external_id?: string;
  explanation: Explanation | null;
}

export interface Metrics {
  threshold: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  confusion_matrix: { tn: number; fp: number; fn: number; tp: number };
}

export interface CurvePoint { x: number; y: number; threshold: number | null }

export interface ModelEval {
  label: string;
  strategy: string;
  version: string;
  recommended_threshold: number;
  threshold_objective: string;
  validation: { pr_auc: number; roc_auc: number; at_recommended: Metrics };
  test: {
    pr_auc: number;
    roc_auc: number;
    at_default: Metrics;
    at_recommended: Metrics;
    threshold_table: Metrics[];
    pr_curve: CurvePoint[];
    roc_curve: CurvePoint[];
    probability_histogram: { bin: string; legitimate: number; fraud: number }[];
  };
}

export interface ModelInfo {
  name: ModelName;
  label: string;
  version: string;
  strategy: string;
  trained_at: string;
  train_seconds: number;
  rank: number;
  recommended_threshold: number;
  decision_threshold: number;
  hyperparameters: Record<string, string | number>;
  artifact: string;
  is_active: boolean;
  is_best: boolean;
  loaded: boolean;
  test_summary: { pr_auc: number; roc_auc: number; precision: number; recall: number; f1: number; accuracy: number;
    confusion_matrix: Metrics["confusion_matrix"] };
}

export interface Settings {
  active_model: ModelName;
  best_model: ModelName;
  risk_bands: { medium: number; high: number; critical: number };
  threshold_overrides: Partial<Record<ModelName, number | null>>;
  decision_thresholds: Record<ModelName, number>;
  recommended_thresholds: Record<ModelName, number>;
}

export interface Health {
  status: "ok" | "degraded";
  version: string;
  uptime_seconds: number;
  checks: { database: boolean; models_trained: boolean; models_loaded: string[]; dataset_present: boolean };
  message: string | null;
}
