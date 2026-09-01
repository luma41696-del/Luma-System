import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../data/models/task.dart';
import '../../data/tasks_repo.dart';
import '../../widgets/task_tile.dart';

/// What the raised centre button opens: everything that needs attention today,
/// overdue work first. It is one tap from anywhere in the app because on a
/// phone this is the question people actually open the app to answer.
Future<void> showTodaySheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: AppColors.bgCanvas,
    isScrollControlled: true,
    showDragHandle: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
    ),
    builder: (context) => const _TodaySheet(),
  );
}

class _TodaySheet extends StatelessWidget {
  const _TodaySheet();

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: .72,
      minChildSize: .4,
      maxChildSize: .94,
      expand: false,
      builder: (context, controller) => StreamBuilder<List<Task>>(
        stream: TasksRepo.instance.myTasks(),
        builder: (context, snapshot) {
          final all = snapshot.data ?? const <Task>[];
          final overdue = all.where((task) => task.isOverdue).toList();
          final today = all
              .where((task) => task.isDueToday && !task.isOverdue)
              .toList();

          return ListView(
            controller: controller,
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
            children: [
              const Text(
                'تركيز اليوم',
                style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              Text(
                'المتأخر أولاً، ثم ما يستحق اليوم.',
                style: TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 20),
              if (!snapshot.hasData)
                Center(
                  child: Padding(
                    padding: EdgeInsets.all(40),
                    child: CircularProgressIndicator(color: AppColors.brand),
                  ),
                )
              else if (overdue.isEmpty && today.isEmpty)
                Padding(
                  padding: EdgeInsets.symmetric(vertical: 50),
                  child: Column(
                    children: [
                      Icon(Icons.wb_sunny_rounded,
                          size: 42, color: AppColors.brand),
                      SizedBox(height: 12),
                      Text(
                        'لا شيء مستحق اليوم',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 15.5,
                        ),
                      ),
                    ],
                  ),
                )
              else ...[
                if (overdue.isNotEmpty) ...[
                  _SectionLabel(
                    text: 'متأخرة',
                    color: AppColors.danger,
                  ),
                  for (final task in overdue)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: TaskTile(task: task),
                    ),
                  const SizedBox(height: 14),
                ],
                if (today.isNotEmpty) ...[
                  _SectionLabel(
                    text: 'اليوم',
                    color: AppColors.textSecondary,
                  ),
                  for (final task in today)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: TaskTile(task: task),
                    ),
                ],
              ],
            ],
          );
        },
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Text(
            text,
            style: TextStyle(
              fontSize: 13.5,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
