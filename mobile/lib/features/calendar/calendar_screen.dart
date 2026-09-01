import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../core/format.dart';
import '../../data/models/task.dart';
import '../../data/tasks_repo.dart';
import '../../widgets/common.dart';
import '../../widgets/task_tile.dart';

/// A month at a glance, with the day's tasks underneath.
///
/// Drawn rather than pulled from a package: a month grid is a handful of rows,
/// and a calendar package would arrive with its own idea of typography, its
/// own locale handling and its own left-to-right assumptions to fight.
class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key});

  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> {
  late DateTime _month = _startOfMonth(DateTime.now());
  late DateTime _selected = _startOfDay(DateTime.now());

  static DateTime _startOfMonth(DateTime d) => DateTime(d.year, d.month);
  static DateTime _startOfDay(DateTime d) => DateTime(d.year, d.month, d.day);

  @override
  Widget build(BuildContext context) {
    return LumaPage(
      title: 'التقويم',
      onBack: () => Navigator.of(context).pop(),
      child: StreamBuilder<List<Task>>(
        stream: TasksRepo.instance.myTasks(),
        builder: (context, snapshot) {
          final tasks = snapshot.data ?? const <Task>[];

          // One bucket per day, so the grid does not walk the whole list once
          // per cell.
          final byDay = <DateTime, List<Task>>{};
          for (final task in tasks) {
            final due = task.dueAt;
            if (due == null) continue;
            byDay.putIfAbsent(_startOfDay(due), () => []).add(task);
          }

          final onSelected = byDay[_selected] ?? const <Task>[];

          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 120),
            children: [
              _MonthBar(
                month: _month,
                onShift: (delta) => setState(() {
                  _month = DateTime(_month.year, _month.month + delta);
                }),
                onToday: () => setState(() {
                  _month = _startOfMonth(DateTime.now());
                  _selected = _startOfDay(DateTime.now());
                }),
              ),
              const SizedBox(height: 14),
              _Grid(
                month: _month,
                selected: _selected,
                byDay: byDay,
                onPick: (day) => setState(() => _selected = day),
              ),
              const SizedBox(height: 22),
              Row(
                children: [
                  Text(
                    Fmt.dayAndMonth(_selected),
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    Fmt.weekday(_selected),
                    style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (onSelected.isEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 34),
                  decoration: BoxDecoration(
                    color: AppColors.bgSurface,
                    borderRadius: BorderRadius.circular(AppRadius.tile),
                  ),
                  child: Column(
                    children: [
                      Icon(Icons.event_available_rounded,
                          size: 30, color: AppColors.textMuted),
                      const SizedBox(height: 10),
                      Text(
                        'لا مهام مستحقة في هذا اليوم',
                        style: TextStyle(
                          fontSize: 13.5,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                )
              else
                for (final task in onSelected)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TaskTile(task: task),
                  ),
            ],
          );
        },
      ),
    );
  }
}

class _MonthBar extends StatelessWidget {
  const _MonthBar({
    required this.month,
    required this.onShift,
    required this.onToday,
  });

  final DateTime month;
  final ValueChanged<int> onShift;
  final VoidCallback onToday;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _Arrow(icon: Icons.chevron_right_rounded, onTap: () => onShift(-1)),
        Expanded(
          child: Center(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 250),
              child: Text(
                Fmt.monthAndYear(month),
                key: ValueKey('${month.year}-${month.month}'),
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
        ),
        _Arrow(icon: Icons.chevron_left_rounded, onTap: () => onShift(1)),
        const SizedBox(width: 6),
        GestureDetector(
          onTap: onToday,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.brand.withValues(alpha: .16),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              'اليوم',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: AppColors.brandLight,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _Arrow extends StatelessWidget {
  const _Arrow({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap,
      icon: Icon(icon),
      color: AppColors.textSecondary,
      style: IconButton.styleFrom(backgroundColor: AppColors.bgSurface),
    );
  }
}

class _Grid extends StatelessWidget {
  const _Grid({
    required this.month,
    required this.selected,
    required this.byDay,
    required this.onPick,
  });

  final DateTime month;
  final DateTime selected;
  final Map<DateTime, List<Task>> byDay;
  final ValueChanged<DateTime> onPick;

  /// The week runs Sunday to Saturday, matching the website.
  static const _weekdays = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

  @override
  Widget build(BuildContext context) {
    final daysInMonth = DateTime(month.year, month.month + 1, 0).day;
    // Dart numbers Monday as 1 and Sunday as 7; `% 7` turns that into an
    // offset from Sunday, which is where our grid starts.
    final leading = DateTime(month.year, month.month).weekday % 7;
    final today = DateTime.now();

    final cells = <Widget>[];
    for (var i = 0; i < leading; i++) {
      cells.add(const SizedBox.shrink());
    }
    for (var day = 1; day <= daysInMonth; day++) {
      final date = DateTime(month.year, month.month, day);
      final tasks = byDay[date] ?? const <Task>[];
      cells.add(_Cell(
        day: day,
        tasks: tasks,
        isToday: date.year == today.year &&
            date.month == today.month &&
            date.day == today.day,
        isSelected: date == selected,
        onTap: () => onPick(date),
      ));
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.bgSurface,
        borderRadius: BorderRadius.circular(AppRadius.card),
      ),
      child: Column(
        children: [
          Row(
            children: [
              for (final label in _weekdays)
                Expanded(
                  child: Center(
                    child: Text(
                      label,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          GridView.count(
            crossAxisCount: 7,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 2,
            crossAxisSpacing: 2,
            children: cells,
          ),
        ],
      ),
    );
  }
}

class _Cell extends StatelessWidget {
  const _Cell({
    required this.day,
    required this.tasks,
    required this.isToday,
    required this.isSelected,
    required this.onTap,
  });

  final int day;
  final List<Task> tasks;
  final bool isToday;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // A day with overdue work is worth seeing before you tap it.
    final overdue = tasks.any((task) => task.isOverdue);
    final dot = tasks.isEmpty
        ? null
        : overdue
            ? AppColors.danger
            : AppColors.brandLight;

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.all(1),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.brand : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          border: isToday && !isSelected
              ? Border.all(color: AppColors.brandLight, width: 1.4)
              : null,
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              '$day',
              style: TextStyle(
                fontSize: 13,
                fontWeight: isSelected || isToday
                    ? FontWeight.w800
                    : FontWeight.w500,
                color: isSelected ? AppColors.onBrand : AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 3),
            Container(
              width: 5,
              height: 5,
              decoration: BoxDecoration(
                color: dot == null
                    ? Colors.transparent
                    : (isSelected ? AppColors.onBrand : dot),
                shape: BoxShape.circle,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
