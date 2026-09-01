import 'package:cloud_firestore/cloud_firestore.dart';

import 'models/task.dart';
import 'session.dart';

/// Reads tasks straight from Firestore, the way the web app does.
///
/// Ordering is on `createdAt`, not on the deadline. Firestore drops any
/// document missing the field it is ordered by, and plenty of tasks have no
/// deadline — ordering by `dueAt` silently hid them from "my tasks" on the web
/// until it was fixed. The same trap is avoided here.
class TasksRepo {
  TasksRepo._();
  static final TasksRepo instance = TasksRepo._();

  CollectionReference<Map<String, dynamic>> get _col =>
      FirebaseFirestore.instance.collection('tasks');

  /// Everything assigned to the signed-in person, newest first.
  Stream<List<Task>> myTasks({int limit = 200}) {
    final uid = Session.instance.uid;
    if (uid.isEmpty) return Stream.value(const []);

    return _col
        .where('assignees', arrayContains: uid)
        .orderBy('createdAt', descending: true)
        .limit(limit)
        .snapshots()
        .map((snap) => snap.docs.map(Task.fromDoc).toList());
  }

  /// The whole board, for people whose permissions allow it. The rules reject
  /// this for everyone else, so the stream surfaces an error rather than
  /// quietly returning nothing.
  Stream<List<Task>> allTasks({int limit = 200}) {
    return _col
        .orderBy('createdAt', descending: true)
        .limit(limit)
        .snapshots()
        .map((snap) => snap.docs.map(Task.fromDoc).toList());
  }

  Stream<Task> watch(String id) =>
      _col.doc(id).snapshots().map(Task.fromDoc);

  /// Moving a task along the board. Allowed for assignees by the security
  /// rules, which is why this is a direct write rather than a callable.
  Future<void> setStatus(String id, TaskStatus status) {
    return _col.doc(id).update({
      'status': status.id,
      'updatedAt': FieldValue.serverTimestamp(),
      if (status == TaskStatus.completed)
        'completedAt': FieldValue.serverTimestamp(),
    });
  }
}

/// The counts the home screen leads with, and the ones the profile shows.
///
/// The same buckets the website's employee profile uses, so a person reading
/// their numbers on a phone sees what their manager sees on a desktop.
class TaskSummary {
  const TaskSummary({
    required this.total,
    required this.open,
    required this.dueToday,
    required this.overdue,
    required this.completed,
    required this.completedToday,
    required this.completedWeek,
    required this.completedMonth,
    required this.completedYear,
  });

  final int total;
  final int open;
  final int dueToday;
  final int overdue;
  final int completed;
  final int completedToday;
  final int completedWeek;
  final int completedMonth;
  final int completedYear;

  /// Whole percent, and zero rather than a division by zero for someone who
  /// has no tasks at all.
  int get completionRate =>
      total == 0 ? 0 : ((completed / total) * 100).round();

  factory TaskSummary.of(List<Task> tasks) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    // The website counts weeks from Sunday; Dart numbers Monday as 1, so
    // `weekday % 7` is the number of days since the last Sunday.
    final week = today.subtract(Duration(days: now.weekday % 7));
    final month = DateTime(now.year, now.month);
    final year = DateTime(now.year);

    int finishedSince(DateTime from) => tasks
        .where((task) =>
            task.status == TaskStatus.completed &&
            task.completedAt != null &&
            !task.completedAt!.isBefore(from))
        .length;

    return TaskSummary(
      total: tasks.length,
      open: tasks.where((task) => task.status.isOpen).length,
      dueToday: tasks.where((task) => task.isDueToday).length,
      overdue: tasks.where((task) => task.isOverdue).length,
      completed:
          tasks.where((task) => task.status == TaskStatus.completed).length,
      completedToday: finishedSince(today),
      completedWeek: finishedSince(week),
      completedMonth: finishedSince(month),
      completedYear: finishedSince(year),
    );
  }
}
