export type CorrMethod = "pearson" | "spearman" | "kendall";

export interface StatsPayload {
  summary?: {
    rows: number;
  };
  warning?: string;
  selected_correlation_method?: CorrMethod;
  correlation?: Record<
    CorrMethod,
    {
      variables: string[];
      coefficients: Array<Array<number | null>>;
      p_values: Array<Array<number | null>>;
      sample_sizes: number[][];
    }
  >;
  pairwise?: {
    x: string;
    y: string;
    degree: number;
    n: number;
    equation?: string | null;
    r2?: number | null;
    coefficients?: number[];
    points?: number[][];
    curve?: number[][];
    warning?: string;
  };
  regression_single?: {
    x: string;
    y: string;
    n: number;
    slope?: number;
    intercept?: number;
    r?: number;
    r2?: number;
    p_value?: number;
    std_err?: number;
    aic?: number | null;
    bic?: number | null;
    residual_diagnostics?: {
      mean: number;
      std: number;
      durbin_watson?: number | null;
    };
    observed_vs_predicted?: number[][];
    warning?: string;
  };
  regression_multiple?: {
    y: string;
    x: string[];
    n: number;
    r2?: number | null;
    adjusted_r2?: number | null;
    aic?: number | null;
    bic?: number | null;
    coefficients?: Array<{
      name: string;
      coef: number;
      std_err: number;
      t: number;
      p_value: number;
    }>;
    residual_diagnostics?: {
      mean: number;
      std: number;
      durbin_watson?: number | null;
    };
    observed_vs_predicted?: number[][];
    warning?: string;
  };
  trend?: {
    variable: string;
    n: number;
    warning?: string;
    mann_kendall?: {
      S: number;
      tau: number;
      z: number;
      p_value: number;
      trend: string;
    };
    sen_slope?: number | null;
    theil_sen?: {
      slope: number;
      intercept: number;
      line: number[][];
    };
    series?: number[][];
  };
  normality?: {
    variable: string;
    n: number;
    warning?: string;
    shapiro_wilk?: {
      statistic: number;
      p_value: number;
    };
    kolmogorov_smirnov?: {
      statistic: number;
      p_value: number;
    };
    anderson_darling?: {
      statistic: number;
      critical_values: number[];
      significance_levels: number[];
    };
  };
}
