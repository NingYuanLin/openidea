import copy
import unittest
from run import validate


def fixture():
    rows = []
    for i in range(4):
        rows.extend([
            {'source': 'controlled-context-entry', 'call': i + 1, 'sameNativeObject': True},
            {'source': 'controlled-completion', 'call': i + 1, 'handled': True},
            {'source': 'DOM', 'type': 'keydown' if i % 2 == 0 else 'keyup', 'code': 'ShiftLeft', 'keyCode': 229 if i % 2 == 0 else 16, 'length': 0, 'trusted': True},
        ])
    for i, row in enumerate(rows):
        row.update(seq=i, ms=i)
    return dict(status='complete', flagReadback=False, flagRequested=False,
                calls=4, callbacks=4, pending=0, rows=rows, side=56, mode='true-none', insertCalls=0)


class ValidationTests(unittest.TestCase):
    def test_complete(self):
        self.assertTrue(validate(fixture())['matchesPrediction'])

    def test_unsupported_is_not_false(self):
        self.assertFalse(validate(dict(status='unsupported', reason='missing-feature'))['valid'])

    def test_missing_and_duplicate_callbacks(self):
        for count in (3, 5):
            case = fixture(); case['callbacks'] = count
            with self.assertRaises(AssertionError): validate(case)

    def test_pending_is_not_false(self):
        case = fixture(); case['pending'] = 1
        with self.assertRaises(AssertionError): validate(case)

    def test_synthetic_dom_is_rejected(self):
        case = fixture(); case['rows'][2]['trusted'] = False
        with self.assertRaises(AssertionError): validate(case)

    def test_contrary_result_is_recorded_not_rejected(self):
        case = fixture(); case['rows'][2]['keyCode'] = 16
        result = validate(case)
        self.assertTrue(result['valid']); self.assertFalse(result['matchesPrediction'])

    def test_order_and_feature_mismatch(self):
        for change in ('order', 'feature'):
            case = copy.deepcopy(fixture())
            if change == 'order': case['rows'][2]['ms'] = -1
            else: case['flagReadback'] = True
            with self.assertRaises(AssertionError): validate(case)


if __name__ == '__main__': unittest.main()
