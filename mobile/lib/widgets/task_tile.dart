import 'package:flutter/material.dart';

import '../core/app_colors.dart';
import '../core/app_theme.dart';
import '../core/format.dart';
import '../data/models/task.dart';
import '../features/tasks/task_detail_screen.dart';

/// One task, as it appears in any list.
class TaskTile extends StatelessWidget {
  const TaskTile({super.key, required this.task});

  final Task task;

  @override
  Widget build(BuildContext context) {
    final due = task.dueAt;
    final overdue = task.isOverdue;

    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.tile),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.tile),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => TaskDetailScreen(taskId: task.id, initial: task),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: task.status.color.withValues(alpha: .13),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(task.status.icon, color: task.status.color, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      task.title.isEmpty ? 'بدون عنوان' : task.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w700,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Text(
                          task.status.label,
                          style: TextStyle(
                            fontSize: 12.5,
                            color: task.status.color,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (due != null) ...[
                          const Text(
                            ' · ',
                            style: TextStyle(color: AppColors.textMuted),
                          ),
                          Text(
                            Fmt.due(due),
                            style: TextStyle(
                              fontSize: 12.5,
                              color: overdue
                                  ? AppColors.danger
                                  : AppColors.textSecondary,
                              fontWeight:
                                  overdue ? FontWeight.w700 : FontWeight.w500,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _PriorityPip(priority: task.priority),
            ],
          ),
        ),
      ),
    );
  }
}

/// Priority as a small bar rather than a word — it is context, not the point
/// of the row, and four coloured words in a list is noise.
class _PriorityPip extends StatelessWidget {
  const _PriorityPip({required this.priority});

  final TaskPriority priority;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'الأولوية: ${priority.label}',
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: List.generate(
          4,
          (i) => Container(
            width: 4,
            height: 5,
            margin: const EdgeInsets.symmetric(vertical: 1),
            decoration: BoxDecoration(
              color: i < priority.weight
                  ? priority.color
                  : AppColors.divider,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
      ),
    );
  }
}
