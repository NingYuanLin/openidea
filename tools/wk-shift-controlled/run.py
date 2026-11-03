"""Run isolated native cases and validate observations, not the hypothesized result."""
import itertools
import json
import pathlib
import subprocess
import sys


def validate(result):
    if result['status'] != 'complete':
        return {'valid': False, 'status': result['status'], 'reason': result['reason']}
    assert result['flagReadback'] == result['flagRequested'], 'feature readback'
    assert result['calls'] == result['callbacks'] == 4 and result['pending'] == 0, 'callback counts'
    rows = result['rows']
    assert [r['seq'] for r in rows] == list(range(len(rows))), 'sequence'
    assert all(a['ms'] <= b['ms'] for a, b in zip(rows, rows[1:])), 'timestamps'
    dom = [r for r in rows if r['source'] == 'DOM']
    entries = [r for r in rows if r['source'] == 'controlled-context-entry']
    callbacks = [r for r in rows if r['source'] == 'controlled-completion']
    assert len(dom) == len(entries) == len(callbacks) == 4, 'event counts'
    assert [r['call'] for r in entries] == [1, 2, 3, 4], 'entry IDs'
    assert [r['call'] for r in callbacks] == [1, 2, 3, 4], 'callback IDs'
    assert all(r['sameNativeObject'] for r in entries), 'native event identity'
    assert [r['type'] for r in dom] == ['keydown', 'keyup'] * 2, 'event types'
    expected_side = 'ShiftLeft' if result['side'] == 56 else 'ShiftRight'
    assert all(r['code'] == expected_side for r in dom), 'event side'
    assert all(r['keyCode'] in (16, 229) for r in dom), 'keycode not observed'
    assert all(r['length'] == 0 for r in dom), 'unexpected text'
    assert all(r['trusted'] is True for r in dom), 'JS-generated event'
    assert all(r['handled'] == (result['mode'] != 'false-none') for r in callbacks), 'mock response'
    for entry, callback, event in zip(entries, callbacks, dom):
        assert entry['seq'] < callback['seq'] < event['seq'], 'native/callback/DOM order'
    assert result['insertCalls'] == (2 if result['mode'] == 'true-empty' else 0), 'insertion count'
    # This is a prediction from WebKit-7624.2.5.11.4, not an assertion masking a contrary result.
    predicted = 16 if result['mode'] == 'false-none' or (result['flagRequested'] and result['mode'] == 'true-empty') else 229
    codes = [r['keyCode'] for r in dom]
    return {'valid': True, 'codes': codes, 'predicted': [predicted, 16] * 2,
            'matchesPrediction': codes == [predicted, 16] * 2}


def main():
    binary, directory = map(pathlib.Path, sys.argv[1:])
    directory.mkdir(parents=True, exist_ok=True)
    results = []
    for flag, mode, delayed, side in itertools.product((0, 1), ('true-none', 'true-empty', 'false-none'), (0, 1), (56, 60)):
        name = f'flag{flag}-{mode}-delay{delayed}-side{side}'
        path = directory / f'{name}.json'
        command = [str(binary.resolve()), '-flag', str(flag), '-mode', mode, '-delayed', str(delayed), '-side', str(side), '-output', str(path.resolve())]
        try:
            process = subprocess.run(command, capture_output=True, text=True, timeout=25)
            (directory / f'{name}.txt').write_text(process.stdout + process.stderr)
            result = json.loads(path.read_text()) if path.exists() else {'status': 'error', 'reason': 'no-result-file'}
            analysis = validate(result)
            if process.returncode != 0 and analysis['valid']:
                analysis = {'valid': False, 'status': 'error', 'reason': 'process-exit-conflict'}
        except (subprocess.TimeoutExpired, AssertionError, ValueError) as error:
            analysis = {'valid': False, 'status': 'error', 'reason': str(error)}
        results.append({'case': name, **analysis})
        print(json.dumps(results[-1]), flush=True)
    summary = {'schema': 1, 'syntheticOnly': True, 'nativeSogouVerified': False,
               'cases': results, 'complete': sum(r['valid'] for r in results),
               'matchesPrediction': sum(r.get('matchesPrediction', False) for r in results)}
    (directory / 'summary.json').write_text(json.dumps(summary, indent=2))
    if summary['complete'] != 24:
        sys.exit(1)


if __name__ == '__main__':
    main()
