import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../core/format.dart';
import '../../data/models/task.dart';
import '../../data/tasks_repo.dart';

/// One task, and the one thing you usually want to do to it from a phone:
/// move it along.
class TaskDetailScreen extends StatelessWidget {
  const TaskDetailScreen({super.key, required this.taskId, this.initial});

  final String taskId;

  /// Handed over from the list so the screen has content on the first frame
  /// instead of a spinner over data that is already loaded.
  final Task? initial;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgApp,
      appBar: AppBar(
        backgroundColor: AppColors.bgApp,
        surfaceTintColor: Colors.transparent,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: const Text(
          'تفاصيل المهمة',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
      ),
      body: StreamBuilder<Task>(
        stream: TasksRepo.instance.watch(taskId),
        initialData: initial,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text(
                  'تعذّر فتح المهمة. قد لا تملك صلاحية عرضها.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.textSecondary),
                ),
              ),
            );
          }

          final task = snapshot.data;
          if (task == null) {
            return Center(
              child: CircularProgressIndicator(color: AppColors.brand),
            );
          }

          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 40),
            children: [
              Text(
                task.title.isEmpty ? 'بدون عنوان' : task.title,
                style: const TextStyle(
                  fontSize: 23,
                  fontWeight: FontWeight.w800,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _Pill(
                    label: task.status.label,
                    color: task.status.color,
                    icon: task.status.icon,
                  ),
                  _Pill(
                    label: task.priority.label,
                    color: task.priority.color,
                    icon: Icons.flag_rounded,
                  ),
                  if (task.dueAt != null)
                    _Pill(
                      label: Fmt.due(task.dueAt!),
                      color: task.isOverdue
                          ? AppColors.danger
                          : AppColors.textSecondary,
                      icon: Icons.event_rounded,
                    ),
                ],
              ),
              if (task.description.isNotEmpty) ...[
                const SizedBox(height: 22),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: AppColors.bgSurface,
                    borderRadius: BorderRadius.circular(AppRadius.tile),
                  ),
                  child: Text(
                    task.description,
                    style: const TextStyle(fontSize: 15, height: 1.7),
                  ),
                ),
              ],
              const SizedBox(height: 26),
              const Text(
                'تغيير الحالة',
                style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 12),
              _StatusPicker(task: task),
            ],
          );
        },
      ),
    );
  }
}

class _StatusPicker extends StatelessWidget {
  const _StatusPicker({required this.task});

  final Task task;

  Future<void> _set(BuildContext context, TaskStatus status) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await TasksRepo.instance.setStatus(task.id, status);
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text('صارت المهمة «${status.label}»')));
    } on Object {
      // The rules decide, not the client — so a refusal is reported plainly
      // rather than the button pretending it worked.
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(content: Text('لا تملك صلاحية تغيير حالة هذه المهمة.')),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final status in TaskStatus.values)
          GestureDetector(
            onTap: status == task.status ? null : () => _set(context, status),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: status == task.status ? AppColors.brand : AppColors.bgSurface,
                borderRadius: BorderRadius.circular(AppRadius.chip),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    status.icon,
                    size: 16,
                    color: status == task.status
                        ? AppColors.onBrand
                        : status.color,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    status.label,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: status == task.status
                          ? AppColors.onBrand
                          : AppColors.textPrimary,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({
    required this.label,
    required this.color,
    required this.icon,
  });

  final String label;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(AppRadius.chip),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: color),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
