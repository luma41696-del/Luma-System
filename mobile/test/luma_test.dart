import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:luma/data/models/task.dart';
import 'package:luma/data/pairing_payload.dart';
import 'package:luma/data/tasks_repo.dart';

void main() {
  group('pairing payload', () {
    const code = 'a3fa3fa3fa3fa3fa3fa3fa3fa3fa3fab';

    test('reads the code and the server out of a real payload', () {
      final payload = PairingPayload.tryParse(
        'luma-pair:1:$code:https://luma.example.com/api',
      );

      expect(payload, isNotNull);
      expect(payload!.code, code);
      expect(payload.apiBase, 'https://luma.example.com/api');
      expect(payload.host, 'luma.example.com');
    });

    test('drops a trailing slash so the call does not double up', () {
      final payload =
          PairingPayload.tryParse('luma-pair:1:$code:https://luma.example.com/api/');
      expect(payload!.apiBase, 'https://luma.example.com/api');
    });

    test('ignores barcodes that are not ours', () {
      expect(PairingPayload.tryParse('https://example.com'), isNull);
      expect(PairingPayload.tryParse(''), isNull);
      expect(PairingPayload.tryParse('luma-pair:$code:https://a.com'), isNull);
    });

    test('rejects a code that is not the shape the server issues', () {
      // Too short, wrong alphabet, and missing entirely.
      expect(PairingPayload.tryParse('luma-pair:1:abc:https://a.com'), isNull);
      expect(
        PairingPayload.tryParse('luma-pair:1:${'z' * 32}:https://a.com'),
        isNull,
      );
      expect(PairingPayload.tryParse('luma-pair:1::https://a.com'), isNull);
    });

    test('the redeem request actually carries the code', () {
      // The first build sent only the device name, and every scan failed with
      // "الرمز مطلوب" from the server's validator.
      final payload =
          PairingPayload.tryParse('luma-pair:1:$code:https://luma.example.com/api')!;
      final request = payload.redeemRequest('Pixel 8');

      expect(request['code'], code);
      expect(request['device'], 'Pixel 8');
    });

    test('refuses to send a token over plain http on the open internet', () {
      expect(
        PairingPayload.tryParse('luma-pair:1:$code:http://evil.example.com/api'),
        isNull,
      );
    });

    test('still allows http against a machine on the same network', () {
      expect(
        PairingPayload.tryParse('luma-pair:1:$code:http://localhost:5000/api'),
        isNotNull,
      );
      expect(
        PairingPayload.tryParse('luma-pair:1:$code:http://192.168.1.40:5000/api'),
        isNotNull,
      );
    });
  });

  group('task rules', () {
    // "Now" is a terrible test deadline: it is due today, and a microsecond
    // later it is also overdue, so the same task lands in two buckets and the
    // result depends on how busy the machine is. Late today is unambiguous.
    final now = DateTime.now();
    final laterToday = DateTime(now.year, now.month, now.day, 23, 59);

    Task make({
      DateTime? dueAt,
      TaskStatus status = TaskStatus.assigned,
    }) =>
        Task(
          id: 't',
          title: 'مهمة',
          description: '',
          status: status,
          priority: TaskPriority.medium,
          assignees: const ['u1'],
          dueAt: dueAt,
        );

    test('a task with no deadline is never overdue', () {
      expect(make().isOverdue, isFalse);
    });

    test('a past deadline on live work is overdue', () {
      final task = make(dueAt: DateTime.now().subtract(const Duration(days: 1)));
      expect(task.isOverdue, isTrue);
    });

    test('finished work is not overdue, however late it was', () {
      final late = DateTime.now().subtract(const Duration(days: 30));
      expect(make(dueAt: late, status: TaskStatus.completed).isOverdue, isFalse);
      expect(make(dueAt: late, status: TaskStatus.cancelled).isOverdue, isFalse);
    });

    test('due today counts only live work', () {
      expect(make(dueAt: laterToday).isDueToday, isTrue);
      expect(
        make(dueAt: laterToday, status: TaskStatus.completed).isDueToday,
        isFalse,
      );
    });

    test('a deadline later today is due but not yet overdue', () {
      final task = make(dueAt: laterToday);
      expect(task.isDueToday, isTrue);
      expect(task.isOverdue, isFalse);
    });

    test('an unknown status falls back rather than throwing', () {
      expect(TaskStatus.from('something-else'), TaskStatus.newTask);
      expect(TaskPriority.from(null), TaskPriority.medium);
    });

    test('the summary counts each bucket independently', () {
      final summary = TaskSummary.of([
        make(),
        make(dueAt: laterToday),
        make(dueAt: now.subtract(const Duration(days: 2))),
        make(status: TaskStatus.completed),
      ]);

      expect(summary.open, 3);
      expect(summary.dueToday, 1);
      expect(summary.overdue, 1);
      expect(summary.completed, 1);
    });
  });

  group('task parsing', () {
    test('reads the fields the web app writes', () {
      final due = DateTime(2026, 9, 1, 12);
      final task = Task.fromMap('abc', {
        'title': '  تصميم هوية  ',
        'description': 'وصف',
        'status': 'inprogress',
        'priority': 'urgent',
        'assignees': ['u1', 'u2', 7],
        'dueAt': Timestamp.fromDate(due),
        'createdBy': 'u9',
      });

      expect(task.id, 'abc');
      expect(task.title, 'تصميم هوية');
      expect(task.status, TaskStatus.inprogress);
      expect(task.priority, TaskPriority.urgent);
      // Anything that is not a user id is dropped rather than crashing a list.
      expect(task.assignees, ['u1', 'u2']);
      expect(task.dueAt, due);
      expect(task.createdBy, 'u9');
    });

    test('survives a document missing everything', () {
      final task = Task.fromMap('empty', {});
      expect(task.title, '');
      expect(task.status, TaskStatus.newTask);
      expect(task.assignees, isEmpty);
      expect(task.dueAt, isNull);
    });
  });
}
