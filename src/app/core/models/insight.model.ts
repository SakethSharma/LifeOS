export interface InsightMetric {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

export interface InsightListItem {
  text: string;
  amount?: string;
  percentage?: string;
}

export interface InsightTableData {
  headers: string[];
  rows: string[][];
}

export interface InsightChartData {
  type: 'bar' | 'pie' | 'line';
  title: string;
  labels: string[];
  series: { name: string; data: number[] }[];
}

export type InsightBlockType =
  | 'summary'
  | 'bullets'
  | 'numbered'
  | 'metrics'
  | 'table'
  | 'chart'
  | 'warning'
  | 'recommendation';

export interface InsightBlock {
  type: InsightBlockType;
  title?: string;
  text?: string;
  metrics?: InsightMetric[];
  items?: InsightListItem[];
  table?: InsightTableData;
  chart?: InsightChartData;
}

export interface InsightResponse {
  blocks: InsightBlock[];
  generatedAt: string;
  provider: 'local' | 'remote';
}

export interface InsightRequest {
  question: string;
  startDate: string;
  endDate: string;
  scope?: 'all' | 'income' | 'expense';
}

export interface AnalyticsInsightService {
  analyze(request: InsightRequest): Promise<InsightResponse>;
  isAvailable(): boolean;
  getProviderName(): string;
}
