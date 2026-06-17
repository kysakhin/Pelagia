import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats

from services.NeondbService import NeonDBService


@dataclass
class PairConfig:
    x: str
    y: str


class StatsService:
    def __init__(self):
        self.db = NeonDBService()

    def _load_project_data(self, project_id: int, user_id: str) -> pd.DataFrame:
        with self.db.get_connection() as conn:
            cursor = conn.cursor()
            self.db.verify_project_ownership(cursor, project_id, user_id)
            cursor.execute(
                """
                SELECT
                    p.observed_at,
                    COALESCE(m.temperature_adjusted, m.temperature)::float AS temperature,
                    COALESCE(m.salinity_adjusted, m.salinity)::float AS salinity,
                    COALESCE(m.pressure_adjusted, m.pressure)::float AS pressure
                FROM files f
                JOIN projects pr ON pr.project_id = f.project_id
                JOIN profiles p ON p.file_id = f.file_id
                JOIN measurements m ON m.profile_id = p.profile_id
                WHERE f.project_id = %s AND pr.user_id = %s
                """,
                (project_id, user_id),
            )
            rows = cursor.fetchall()

        df = pd.DataFrame(rows, columns=["observed_at", "temperature", "salinity", "pressure"])
        if df.empty:
            return df
        df["observed_at"] = pd.to_datetime(df["observed_at"], errors="coerce")
        return df

    def _corr_entry(self, x: pd.Series, y: pd.Series, method: str) -> tuple[float | None, float | None, int]:
        mask = x.notna() & y.notna()
        n = int(mask.sum())
        if n < 3:
            return None, None, n
        xv = x[mask].to_numpy()
        yv = y[mask].to_numpy()
        if np.nanstd(xv) == 0 or np.nanstd(yv) == 0:
            return None, None, n

        if method == "pearson":
            r, p = stats.pearsonr(xv, yv)
        elif method == "spearman":
            r, p = stats.spearmanr(xv, yv)
        else:
            r, p = stats.kendalltau(xv, yv)
        return float(r), float(p), n

    def correlation_bundle(self, df: pd.DataFrame) -> dict:
        variables = ["temperature", "salinity", "pressure"]
        out: dict[str, dict] = {}

        for method in ["pearson", "spearman", "kendall"]:
            coeff = [[None for _ in variables] for _ in variables]
            pvals = [[None for _ in variables] for _ in variables]
            counts = [[0 for _ in variables] for _ in variables]

            for i, a in enumerate(variables):
                for j, b in enumerate(variables):
                    r, p, n = self._corr_entry(df[a], df[b], method)
                    coeff[i][j] = r
                    pvals[i][j] = p
                    counts[i][j] = n

            out[method] = {
                "variables": variables,
                "coefficients": coeff,
                "p_values": pvals,
                "sample_sizes": counts,
            }
        return out

    def pairwise_bundle(self, df: pd.DataFrame, pair: PairConfig, degree: int) -> dict:
        subset = df[[pair.x, pair.y]].dropna()
        if subset.empty or len(subset) < 3:
            return {
                "x": pair.x,
                "y": pair.y,
                "degree": degree,
                "n": int(len(subset)),
                "equation": None,
                "r2": None,
                "coefficients": [],
                "points": [],
                "curve": [],
                "warning": "Insufficient points for polynomial fit",
            }

        x = subset[pair.x].to_numpy(dtype=float)
        y = subset[pair.y].to_numpy(dtype=float)
        d = max(1, min(int(degree), 5))
        coeffs = np.polyfit(x, y, d)
        poly = np.poly1d(coeffs)
        y_hat = poly(x)
        sst = float(np.sum((y - np.mean(y)) ** 2))
        sse = float(np.sum((y - y_hat) ** 2))
        r2 = None if sst == 0 else float(1 - sse / sst)

        xmin, xmax = float(np.min(x)), float(np.max(x))
        xgrid = np.linspace(xmin, xmax, 120)
        ygrid = poly(xgrid)

        terms = []
        power = d
        for c in coeffs:
            terms.append(f"{c:.6g}x^{power}" if power > 1 else (f"{c:.6g}x" if power == 1 else f"{c:.6g}"))
            power -= 1
        equation = "y = " + " + ".join(terms).replace("+ -", "- ")

        return {
            "x": pair.x,
            "y": pair.y,
            "degree": d,
            "n": int(len(subset)),
            "equation": equation,
            "r2": r2,
            "coefficients": [float(v) for v in coeffs],
            "points": [[float(a), float(b)] for a, b in zip(x, y)],
            "curve": [[float(a), float(b)] for a, b in zip(xgrid, ygrid)],
        }

    def regression_single(self, df: pd.DataFrame, x_var: str, y_var: str) -> dict:
        subset = df[[x_var, y_var]].dropna()
        if len(subset) < 3:
            return {"x": x_var, "y": y_var, "n": int(len(subset)), "warning": "Insufficient data"}

        x = subset[x_var].to_numpy(dtype=float)
        y = subset[y_var].to_numpy(dtype=float)
        if np.nanstd(x) == 0 or np.nanstd(y) == 0:
            return {"x": x_var, "y": y_var, "n": int(len(subset)), "warning": "No variance in selected variables"}

        fit = stats.linregress(x, y)
        y_hat = fit.intercept + fit.slope * x
        residuals = y - y_hat
        rss = float(np.sum(residuals**2))
        n = len(x)
        k = 1
        sigma2 = rss / n if n > 0 else np.nan
        aic = float(n * np.log(sigma2) + 2 * (k + 1)) if sigma2 > 0 else None
        bic = float(n * np.log(sigma2) + np.log(n) * (k + 1)) if sigma2 > 0 else None
        durbin_watson = float(np.sum(np.diff(residuals) ** 2) / rss) if rss > 0 else None

        return {
            "x": x_var,
            "y": y_var,
            "n": int(n),
            "slope": float(fit.slope),
            "intercept": float(fit.intercept),
            "r": float(fit.rvalue),
            "r2": float(fit.rvalue**2),
            "p_value": float(fit.pvalue),
            "std_err": float(fit.stderr),
            "aic": aic,
            "bic": bic,
            "residual_diagnostics": {
                "mean": float(np.mean(residuals)),
                "std": float(np.std(residuals)),
                "durbin_watson": durbin_watson,
            },
            "observed_vs_predicted": [[float(yy), float(yp)] for yy, yp in zip(y, y_hat)],
        }

    def regression_multiple(self, df: pd.DataFrame, y_var: str, x_vars: list[str]) -> dict:
        cols = [y_var, *x_vars]
        subset = df[cols].dropna()
        n = len(subset)
        if n < max(8, len(x_vars) + 3):
            return {"y": y_var, "x": x_vars, "n": int(n), "warning": "Insufficient data for multiple regression"}

        y = subset[y_var].to_numpy(dtype=float)
        X_no_const = subset[x_vars].to_numpy(dtype=float)
        X = np.column_stack([np.ones(n), X_no_const])

        beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
        y_hat = X @ beta
        residuals = y - y_hat

        p = X.shape[1]
        dof = n - p
        if dof <= 0:
            return {"y": y_var, "x": x_vars, "n": int(n), "warning": "Not enough degrees of freedom"}

        rss = float(np.sum(residuals**2))
        tss = float(np.sum((y - np.mean(y)) ** 2))
        r2 = None if tss == 0 else float(1 - rss / tss)
        adj_r2 = None if r2 is None else float(1 - (1 - r2) * (n - 1) / (n - p))

        sigma2 = rss / dof
        xtx = X.T @ X
        try:
            xtx_inv = np.linalg.inv(xtx)
            inversion_method = "inverse"
        except np.linalg.LinAlgError:
            xtx_inv = np.linalg.pinv(xtx)
            inversion_method = "pseudoinverse"
        se = np.sqrt(np.diag(sigma2 * xtx_inv))
        t_stats = beta / se
        p_vals = [2 * (1 - stats.t.cdf(abs(t), dof)) for t in t_stats]

        aic = float(n * np.log(rss / n) + 2 * p) if rss > 0 else None
        bic = float(n * np.log(rss / n) + p * np.log(n)) if rss > 0 else None
        durbin_watson = float(np.sum(np.diff(residuals) ** 2) / rss) if rss > 0 else None

        coeff_table = [{
            "name": "intercept",
            "coef": float(beta[0]),
            "std_err": float(se[0]),
            "t": float(t_stats[0]),
            "p_value": float(p_vals[0]),
        }]
        for i, name in enumerate(x_vars, start=1):
            coeff_table.append({
                "name": name,
                "coef": float(beta[i]),
                "std_err": float(se[i]),
                "t": float(t_stats[i]),
                "p_value": float(p_vals[i]),
            })

        return {
            "y": y_var,
            "x": x_vars,
            "n": int(n),
            "r2": r2,
            "adjusted_r2": adj_r2,
            "aic": aic,
            "bic": bic,
            "solver": inversion_method,
            "coefficients": coeff_table,
            "residual_diagnostics": {
                "mean": float(np.mean(residuals)),
                "std": float(np.std(residuals)),
                "durbin_watson": durbin_watson,
            },
            "observed_vs_predicted": [[float(yy), float(yp)] for yy, yp in zip(y, y_hat)],
        }

    def trend_bundle(self, df: pd.DataFrame, variable: str) -> dict:
        s = df[["observed_at", variable]].dropna().sort_values("observed_at")
        if len(s) < 8:
            return {"variable": variable, "n": int(len(s)), "warning": "Insufficient time-series points"}

        y = s[variable].to_numpy(dtype=float)
        x = np.arange(len(y), dtype=float)

        # Mann-Kendall
        S = 0
        n = len(y)
        for k in range(n - 1):
            S += int(np.sum(np.sign(y[k + 1 :] - y[k])))

        var_s = (n * (n - 1) * (2 * n + 5)) / 18
        if S > 0:
            z = (S - 1) / math.sqrt(var_s)
        elif S < 0:
            z = (S + 1) / math.sqrt(var_s)
        else:
            z = 0.0
        p = 2 * (1 - stats.norm.cdf(abs(z)))
        tau = S / (0.5 * n * (n - 1))

        # Sen's slope (median of all pairwise slopes)
        slopes = []
        for i in range(n - 1):
            den = np.arange(i + 1, n) - i
            slopes.extend(((y[i + 1 :] - y[i]) / den).tolist())
        sen_slope = float(np.median(slopes)) if slopes else None

        # Theil-Sen robust line
        ts_slope, ts_intercept, _, _ = stats.theilslopes(y, x, 0.95)
        y_ts = ts_intercept + ts_slope * x

        trend = "increasing" if z > 0 else ("decreasing" if z < 0 else "no trend")

        return {
            "variable": variable,
            "n": int(n),
            "mann_kendall": {
                "S": int(S),
                "tau": float(tau),
                "z": float(z),
                "p_value": float(p),
                "trend": trend,
            },
            "sen_slope": sen_slope,
            "theil_sen": {
                "slope": float(ts_slope),
                "intercept": float(ts_intercept),
                "line": [[int(i), float(v)] for i, v in zip(x, y_ts)],
            },
            "series": [[idx, float(v)] for idx, v in enumerate(y)],
        }

    def normality_bundle(self, df: pd.DataFrame, variable: str) -> dict:
        s = df[variable].dropna()
        if len(s) < 8:
            return {"variable": variable, "n": int(len(s)), "warning": "Insufficient samples"}

        x = s.to_numpy(dtype=float)

        sh_stat, sh_p = stats.shapiro(x)

        mu = float(np.mean(x))
        sd = float(np.std(x, ddof=1))
        if sd <= 0:
            return {"variable": variable, "n": int(len(x)), "warning": "No variance in sample"}

        z = (x - mu) / sd
        ks_stat, ks_p = stats.kstest(z, "norm")

        ad = stats.anderson(x, dist="norm")

        return {
            "variable": variable,
            "n": int(len(x)),
            "shapiro_wilk": {"statistic": float(sh_stat), "p_value": float(sh_p)},
            "kolmogorov_smirnov": {"statistic": float(ks_stat), "p_value": float(ks_p)},
            "anderson_darling": {
                "statistic": float(ad.statistic),
                "critical_values": [float(v) for v in ad.critical_values.tolist()],
                "significance_levels": [float(v) for v in ad.significance_level.tolist()],
            },
        }

    def compute_v1(self, project_id: int, user_id: str, pair: PairConfig, poly_degree: int, corr_method: str):
        df = self._load_project_data(project_id=project_id, user_id=user_id)
        if df.empty:
            return {
                "summary": {"rows": 0},
                "warning": "No measurements found for project",
            }

        corr_method = corr_method if corr_method in {"pearson", "spearman", "kendall"} else "pearson"

        return {
            "summary": {"rows": int(len(df))},
            "correlation": self.correlation_bundle(df),
            "selected_correlation_method": corr_method,
            "pairwise": self.pairwise_bundle(df, pair=pair, degree=poly_degree),
            "regression_single": self.regression_single(df, x_var=pair.x, y_var=pair.y),
            "regression_multiple": self.regression_multiple(
                df, y_var="temperature", x_vars=["salinity", "pressure"]
            ),
            "trend": self.trend_bundle(df, variable=pair.y),
            "normality": self.normality_bundle(df, variable=pair.y),
        }
