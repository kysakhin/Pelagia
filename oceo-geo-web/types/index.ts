export interface FileScanResult {
  filename: string;
  status: "success" | "error";
  error?: string;
  core_params?: string[];
  bgc_params?: string[];
  available_extras?: string[];
}

export interface ScanSummary {
  core_params: string[];
  bgc_params: string[];
  available_extras: string[];
  files_scanned: number;
  files_failed: number;
  file_errors: { file: string; error: string }[];
}

export interface FileResult {
  filename: string;
  status: "success" | "error";
  error?: string;
  file_id?: number;
  profiles_inserted?: number;
  measurements_inserted?: number;
}
