import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../core/app_colors.dart';

/// The task statuses, kept in step with `js/utils/task-model.js` on the web.
/// The same work has to read the same way on both screens, so the labels and
/// the colours are copied across rather than reinvented here.
enum TaskStatus {
  newTask('new', 'جديدة', Icons.circle_outlined),
  assigned('assigned', 'مُسندة', Icons.how_to_reg_rounded),
  inprogress('inprogress', 'قيد التنفيذ', Icons.autorenew_rounded),
  waiting('waiting', 'بانتظار', Icons.pause_circle_outline_rounded),
  review('review', 'قيد المراجعة', Icons.visibility_outlined),
  completed('completed', 'مكتملة', Icons.check_circle_outline_rounded),
  cancelled('cancelled', 'ملغاة', Icons.cancel_outlined);

  const TaskStatus(this.id, this.label, this.icon);

  final String id;
  final String label;
  final IconData icon;

  /// Read from the live theme rather than stored on the value: enum entries
  /// must be compile-time constants, and a themed colour is not one.
  Color get color => switch (this) {
        TaskStatus.newTask || TaskStatus.cancelled => AppColors.grey,
        TaskStatus.assigned => AppColors.info,
        TaskStatus.inprogress || TaskStatus.review => AppColors.warning,
        TaskStatus.waiting => AppColors.purple,
        TaskStatus.completed => AppColors.success,
      };

  static TaskStatus from(String? id) => values.firstWhere(
        (status) => status.id == id,
        orElse: () => TaskStatus.newTask,
      );

  bool get isOpen => this != TaskStatus.completed && this != TaskStatus.cancelled;
}

enum TaskPriority {
  urgent('urgent', 'عاجلة', 4),
  high('high', 'مرتفعة', 3),
  medium('medium', 'متوسطة', 2),
  low('low', 'منخفضة', 1);

  const TaskPriority(this.id, this.label, this.weight);

  final String id;
  final String label;
  final int weight;

  Color get color => switch (this) {
        TaskPriority.urgent => AppColors.danger,
        TaskPriority.high => AppColors.warning,
        TaskPriority.medium => AppColors.info,
        TaskPriority.low => AppColors.grey,
      };

  static TaskPriority from(String? id) => values.firstWhere(
        (priority) => priority.id == id,
        orElse: () => TaskPriority.medium,
      );
}

class Task {
  const Task({
    required this.id,
    required this.title,
    required this.description,
    required this.status,
    required this.priority,
    required this.assignees,
    this.dueAt,
    this.createdAt,
    this.completedAt,
    this.createdBy = '',
    this.clientId,
    this.workType,
  });

  final String id;
  final String title;
  final String description;
  final TaskStatus status;
  final TaskPriority priority;
  final List<String> assignees;
  final DateTime? dueAt;
  final DateTime? createdAt;
  final DateTime? completedAt;
  final String createdBy;
  final String? clientId;
  final String? workType;

  factory Task.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) =>
      Task.fromMap(doc.id, doc.data() ?? const {});

  /// Parsing lives apart from Firestore so it can be exercised directly —
  /// `DocumentSnapshot` is sealed and cannot be faked in a test.
  factory Task.fromMap(String id, Map<String, dynamic> data) {
    return Task(
      id: id,
      title: (data['title'] as String?)?.trim() ?? '',
      description: (data['description'] as String?)?.trim() ?? '',
      status: TaskStatus.from(data['status'] as String?),
      priority: TaskPriority.from(data['priority'] as String?),
      assignees: (data['assignees'] as List?)?.whereType<String>().toList() ?? const [],
      dueAt: _date(data['dueAt']),
      createdAt: _date(data['createdAt']),
      completedAt: _date(data['completedAt']),
      createdBy: (data['createdBy'] as String?) ?? '',
      clientId: data['clientId'] as String?,
      workType: data['workType'] as String?,
    );
  }

  /// Overdue means a deadline in the past on work that is still live — the
  /// same rule the web app uses, so counts agree between the two.
  bool get isOverdue {
    final due = dueAt;
    if (due == null || !status.isOpen) return false;
    return due.isBefore(DateTime.now());
  }

  bool get isDueToday {
    final due = dueAt;
    if (due == null || !status.isOpen) return false;
    final now = DateTime.now();
    return due.year == now.year && due.month == now.month && due.day == now.day;
  }

  /// Firestore hands back a Timestamp, but a document written by an older
  /// client can carry a plain number or an ISO string.
  static DateTime? _date(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}
