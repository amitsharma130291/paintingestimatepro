"""Merges the four parallel-audited batch CSVs into test-execution-results.csv,
validates row count (345) and enum values, and reports counts. Run once all
four audit_batch_*.csv files exist in the repo root.
"""
import csv
import glob
import sys

EXPECTED_COLUMNS = [
    'case_id', 'area', 'priority', 'implementation_status', 'execution_status',
    'test_ref', 'environment', 'observed_result', 'evidence_location', 'notes',
]
VALID_IMPL = {'implemented', 'partial', 'missing', 'external_dependency'}
VALID_EXEC = {'passed', 'failed', 'blocked', 'not_run'}

batch_files = sorted(glob.glob('audit_batch_*.csv'))
if not batch_files:
    print('No audit_batch_*.csv files found.')
    sys.exit(1)

all_rows = []
seen_ids = set()
errors = []

for path in batch_files:
    with open(path, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != EXPECTED_COLUMNS:
            errors.append(f'{path}: column mismatch: {reader.fieldnames}')
            continue
        for row in reader:
            cid = row['case_id']
            if cid in seen_ids:
                errors.append(f'{path}: duplicate case_id {cid}')
            seen_ids.add(cid)
            if row['implementation_status'] not in VALID_IMPL:
                errors.append(f'{path}: {cid} bad implementation_status {row["implementation_status"]!r}')
            if row['execution_status'] not in VALID_EXEC:
                errors.append(f'{path}: {cid} bad execution_status {row["execution_status"]!r}')
            all_rows.append(row)

print(f'Merged {len(all_rows)} rows from {len(batch_files)} files: {batch_files}')
if errors:
    print(f'\n{len(errors)} VALIDATION ERRORS:')
    for e in errors[:50]:
        print(' -', e)
    if len(all_rows) != 345 or errors:
        print('\nNOT writing output due to errors or wrong row count.')
        sys.exit(1)

if len(all_rows) != 345:
    print(f'ERROR: expected 345 rows, got {len(all_rows)}')
    sys.exit(1)

all_rows.sort(key=lambda r: r['case_id'])

with open('test-execution-results.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=EXPECTED_COLUMNS)
    writer.writeheader()
    writer.writerows(all_rows)

from collections import Counter
exec_counts = Counter(r['execution_status'] for r in all_rows)
impl_counts = Counter(r['implementation_status'] for r in all_rows)
print('\nExecution status counts:', dict(exec_counts))
print('Implementation status counts:', dict(impl_counts))
print('\nWrote test-execution-results.csv (345 rows + header).')
