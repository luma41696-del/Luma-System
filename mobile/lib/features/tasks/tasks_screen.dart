import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../data/models/task.dart';
import '../../data/tasks_repo.dart';
import '../../widgets/task_tile.dart';

enum _Scope { mine, all }

enum _Filter {
  open('المفتوحة'),
  today('اليوم'),
  overdue('المتأخرة'),
  done('المكتملة');

  const _Filter(this.label);
  final String label;

  bool matches(Task task) => switch (this) {
        _Filter.open => task.status.isOpen,
        _Filter.today => task.isDueToday,
        _Filter.overdue => task.isOverdue,
        _Filter.done => task.status == TaskStatus.completed,
      };
}

class TasksScreen extends StatefulWidget {
  const TasksScreen({super.key});

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> {
  _Scope _scope = _Scope.mine;
  _Filter _filter = _Filter.open;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgApp,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Row(
                children: [
                  const Expanded(
                    child: Text(
                      'المهام',
                      style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
                    ),
                  ),
                  _ScopeToggle(
                    scope: _scope,
                    onChanged: (value) => setState(() => _scope = value),
                  ),
                ],
              ),
            ),
            SizedBox(
              height: 40,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 20),
                itemCount: _Filter.values.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, i) {
                  final filter = _Filter.values[i];
                  return _Chip(
                    label: filter.label,
                    active: filter == _filter,
                    onTap: () => setState(() => _filter = filter),
                  );
                },
              ),
            ),
            Expanded(
              child: StreamBuilder<List<Task>>(
                stream: _scope == _Scope.mine
                    ? TasksRepo.instance.myTasks()
                    : TasksRepo.instance.allTasks(),
                builder: (context, snapshot) {
                  if (snapshot.hasError) {
                    return const _Message(
                      icon: Icons.lock_outline_rounded,
                      title: 'لا تملك صلاحية عرض كل المهام',
                      text: 'يمكنك دائماً رؤية المهام المسندة إليك.',
                    );
                  }
                  if (!snapshot.hasData) {
                    return Center(
                      child: CircularProgressIndicator(color: AppColors.brand),
                    );
                  }

                  final tasks =
                      snapshot.data!.where(_filter.matches).toList();
                  if (tasks.isEmpty) {
                    return _Message(
                      icon: Icons.inbox_rounded,
                      title: 'لا توجد مهام ${_filter.label}',
                      text: 'جرّب تبويباً آخر.',
                    );
                  }

                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(20, 14, 20, 120),
                    itemCount: tasks.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (context, i) => TaskTile(task: tasks[i]),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScopeToggle extends StatelessWidget {
  const _ScopeToggle({required this.scope, required this.onChanged});

  final _Scope scope;
  final ValueChanged<_Scope> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.bgSurface,
        borderRadius: BorderRadius.circular(AppRadius.chip),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final option in _Scope.values)
            GestureDetector(
              onTap: () => onChanged(option),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                decoration: BoxDecoration(
                  color: option == scope ? AppColors.brand : Colors.transparent,
                  borderRadius: BorderRadius.circular(AppRadius.chip),
                ),
                child: Text(
                  option == _Scope.mine ? 'مهامي' : 'الكل',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: option == scope
                        ? AppColors.onBrand
                        : AppColors.textSecondary,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.active,
    required this.onTap,
  });

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 18),
        decoration: BoxDecoration(
          color: active ? AppColors.brand : AppColors.bgSurface,
          borderRadius: BorderRadius.circular(AppRadius.chip),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w700,
            color: active ? AppColors.onBrand : AppColors.textSecondary,
          ),
        ),
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    required this.icon,
    required this.title,
    required this.text,
  });

  final IconData icon;
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(40, 0, 40, 90),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 42, color: AppColors.textMuted),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              text,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
