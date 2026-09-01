import 'package:flutter_test/flutter_test.dart';
import 'package:luma/data/presence.dart';

void main() {
  group('work state', () {
    test('reads the same four states the website writes', () {
      expect(WorkState.from('online'), WorkState.online);
      expect(WorkState.from('working'), WorkState.working);
      expect(WorkState.from('break'), WorkState.breakTime);
      expect(WorkState.from('offline'), WorkState.offline);
    });

    test('anything unexpected reads as offline, never as present', () {
      // Claiming someone is at their desk on the strength of a value we do not
      // recognise is the one direction this must not fail in.
      expect(WorkState.from(null), WorkState.offline);
      expect(WorkState.from(''), WorkState.offline);
      expect(WorkState.from('busy'), WorkState.offline);
      expect(WorkState.from(42), WorkState.offline);
    });

    test('only offline counts as away', () {
      expect(WorkState.online.isOnline, isTrue);
      expect(WorkState.working.isOnline, isTrue);
      expect(WorkState.breakTime.isOnline, isTrue);
      expect(WorkState.offline.isOnline, isFalse);
    });

    test('every state has an Arabic label', () {
      for (final state in WorkState.values) {
        expect(state.label.trim(), isNotEmpty);
      }
    });
  });
}
