import { EnterpriseScanError } from './errors';

export type CsvRecord = Record<string, string>;

export interface DeliveryBatchRow {
  line: number;
  business_key: string;
  name: string;
  team_business_key: string;
  team_name: string;
  period: string;
  valid_from: string;
  valid_to: string;
  definition_version: string;
  planned: number | null;
  delivered: number | null;
  accepted: number | null;
}

export interface DashboardRow {
  line: number;
  period: string;
  metric: string;
  value: number;
  unit: string;
  definitionVersion: string;
}

export interface PolicyAssertion {
  businessKey: string;
  field: string;
  value: unknown;
  sourceRef: string;
  definitionVersion: string;
  period: string;
}

export interface OperatorStatement {
  statementId: string;
  speaker: { userId: string; role: string; departmentId: string };
  saidAt: string;
  observedPeriod: string;
  about: { businessKey: string; field: string };
  claim: { value: unknown; unit: string | null; definitionVersion: string };
  note: string;
}

function validation(message: string): never {
  throw new EnterpriseScanError('SOURCE_VALIDATION_FAILED', 'parse', message);
}

function parseCsv(content: string): { headers: string[]; records: Array<{ line: number; values: CsvRecord }> } {
  if (content.trim().length === 0) throw new EnterpriseScanError('EMPTY_CONTENT', 'parse', 'CSV 内容为空');
  const rows: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) { quoted = true; continue; }
    if (char === ',') { fields.push(field); field = ''; continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && content[index + 1] === '\n') index += 1;
      fields.push(field);
      rows.push({ line: rowLine, fields });
      fields = [];
      field = '';
      line += 1;
      rowLine = line;
      continue;
    }
    field += char;
  }
  if (quoted) validation('CSV 引号未闭合');
  if (field.length > 0 || fields.length > 0) {
    fields.push(field);
    rows.push({ line: rowLine, fields });
  }
  if (rows.length === 0 || (rows.length === 1 && rows[0].fields.every(value => value.trim() === ''))) {
    throw new EnterpriseScanError('EMPTY_CONTENT', 'parse', 'CSV 内容为空');
  }
  const headers = rows[0].fields.map(value => value.trim());
  if (headers.length > 64 || new Set(headers).size !== headers.length || headers.some(header => header === '')) {
    validation('CSV 表头为空、重复或超过 64 列');
  }
  const data = rows.slice(1).filter(row => !row.fields.every(value => value.trim() === ''));
  if (data.length > 1000) validation('CSV 超过 1000 行');
  const records = data.map(row => {
    if (row.fields.length !== headers.length) validation(`CSV 第 ${row.line} 行列数不一致`);
    const values: CsvRecord = {};
    headers.forEach((header, index) => { values[header] = row.fields[index].trim(); });
    return { line: row.line, values };
  });
  return { headers, records };
}

function required(record: CsvRecord, key: string, line: number): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') validation(`第 ${line} 行缺少 ${key}`);
  return value;
}

function numeric(record: CsvRecord, key: string, line: number): number | null {
  const value = record[key];
  if (value === '') return null;
  if (typeof value !== 'string') validation(`第 ${line} 行缺少 ${key}`);
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) validation(`第 ${line} 行 ${key} 不是合法数值`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) validation(`第 ${line} 行 ${key} 不是有限数值`);
  return parsed;
}

export function parseDeliveryBatches(content: string): DeliveryBatchRow[] {
  const expected = ['business_key', 'name', 'team_business_key', 'team_name', 'period', 'planned_count', 'delivered_count', 'accepted_count', 'valid_from', 'valid_to', 'definition_version'];
  const { headers, records } = parseCsv(content);
  if (expected.some(header => !headers.includes(header))) validation('delivery_batches.csv 缺少固定列');
  return records.map(({ line, values }) => ({
    ...values,
    line,
    business_key: required(values, 'business_key', line),
    name: required(values, 'name', line),
    team_business_key: required(values, 'team_business_key', line),
    team_name: required(values, 'team_name', line),
    period: required(values, 'period', line),
    valid_from: required(values, 'valid_from', line),
    valid_to: required(values, 'valid_to', line),
    definition_version: required(values, 'definition_version', line),
    planned: numeric(values, 'planned_count', line),
    delivered: numeric(values, 'delivered_count', line),
    accepted: numeric(values, 'accepted_count', line),
  }));
}

export function parseDashboard(content: string): DashboardRow[] {
  const expected = ['period', 'metric', 'value', 'unit', 'definition_version'];
  const { headers, records } = parseCsv(content);
  if (expected.some(header => !headers.includes(header))) validation('delivery_dashboard.csv 缺少固定列');
  return records.map(({ line, values }) => {
    const value = numeric(values, 'value', line);
    if (value === null) validation(`看板第 ${line} 行 value 不得为空`);
    return {
      line,
      period: required(values, 'period', line),
      metric: required(values, 'metric', line),
      value,
      unit: required(values, 'unit', line),
      definitionVersion: required(values, 'definition_version', line),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) validation(`JSON 字段 ${key} 必须为非空字符串`);
  return value;
}

export function parsePolicy(content: string): PolicyAssertion[] {
  if (content.trim().length === 0) throw new EnterpriseScanError('EMPTY_CONTENT', 'parse', 'Markdown 内容为空');
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let definitionVersion = '';
  let period = '';
  const assertions: PolicyAssertion[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith('definition_version:')) definitionVersion = line.slice('definition_version:'.length).trim();
    if (line.startsWith('period:')) period = line.slice('period:'.length).trim();
    if (!line.startsWith('assertion:')) return;
    let parsed: unknown;
    try { parsed = JSON.parse(line.slice('assertion:'.length).trim()); }
    catch { validation(`Markdown 第 ${index + 1} 行 assertion 不是 JSON 对象`); }
    if (!isRecord(parsed)) validation(`Markdown 第 ${index + 1} 行 assertion 不是 JSON 对象`);
    assertions.push({
      businessKey: stringField(parsed, 'businessKey'),
      field: stringField(parsed, 'field'),
      value: parsed.value,
      sourceRef: stringField(parsed, 'sourceRef'),
      definitionVersion,
      period,
    });
  });
  if (!definitionVersion || !period || assertions.length === 0) validation('Markdown 缺少 definition_version、period 或 assertion');
  return assertions;
}

export function parseOperatorStatement(content: string): OperatorStatement {
  if (content.trim().length === 0) throw new EnterpriseScanError('EMPTY_CONTENT', 'parse', 'JSON 内容为空');
  let parsed: unknown;
  try { parsed = JSON.parse(content); }
  catch { validation('operator-statement.json 不是有效 JSON'); }
  if (!isRecord(parsed) || !isRecord(parsed.speaker) || !isRecord(parsed.about) || !isRecord(parsed.claim)) {
    validation('operator-statement.json 缺少固定对象结构');
  }
  const speaker = parsed.speaker;
  const about = parsed.about;
  const claim = parsed.claim;
  const unit = claim.unit;
  if (unit !== undefined && typeof unit !== 'string') validation('claim.unit 必须为字符串或 null');
  return {
    statementId: stringField(parsed, 'statement_id'),
    speaker: {
      userId: stringField(speaker, 'user_id'),
      role: stringField(speaker, 'role'),
      departmentId: stringField(speaker, 'department_id'),
    },
    saidAt: stringField(parsed, 'said_at'),
    observedPeriod: stringField(parsed, 'observed_period'),
    about: { businessKey: stringField(about, 'businessKey'), field: stringField(about, 'field') },
    claim: {
      value: claim.value,
      unit: typeof unit === 'string' ? unit : null,
      definitionVersion: stringField(claim, 'definition_version'),
    },
    note: stringField(parsed, 'note'),
  };
}
