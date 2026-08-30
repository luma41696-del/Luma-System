import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../data/models/task.dart';
import '../../data/session.dart';
import '../../data/tasks_repo.dart';
import '../../widgets/task_tile.dart';

/// The first screen: what is on your plate, then what moved recently.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.scaffold,
      body: StreamBuilder<List<Task>>(
        stream: TasksRepo.instance.myTasks(),
        builder: (context, snapshot) {
          final tasks = snapshot.data ?? const <Task>[];
          final summary = TaskSummary.of(tasks);
          final live = tasks.where((task) => task.status.isOpen).toList();

          return RefreshIndicator(
            // The stream is already live; this exists because people pull down
            // anyway, and a list that ignores the gesture feels broken.
            onRefresh: () async =>
                Future<void>.delayed(const Duration(milliseconds: 400)),
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                const SliverToBoxAdapter(child: _Greeting()),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
                    child: _FocusCard(
                      summary: summary,
                      loading: !snapshot.hasData,
                    ),
                  ),
                ),
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(20, 26, 20, 12),
                    child: Text(
                      'مهامك المفتوحة',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
                if (!snapshot.hasData)
                  const SliverToBoxAdapter(child: _Loading())
                else if (live.isEmpty)
                  const SliverToBoxAdapter(child: _AllClear())
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 120),
                    sliver: SliverList.separated(
                      itemCount: live.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (context, i) => _StaggeredIn(
                        index: i,
                        child: TaskTile(task: live[i]),
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 14),
        child: ListenableBuilder(
          listenable: Session.instance,
          builder: (context, _) => Row(
            children: [
              _Avatar(
                url: Session.instance.photoUrl,
                name: Session.instance.displayName,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'أهلاً بك',
                      style: TextStyle(
                        fontSize: 13,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    Text(
                      Session.instance.displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.url, required this.name});

  final String? url;
  final String name;

  @override
  Widget build(BuildContext context) {
    final photo = url;
    return CircleAvatar(
      radius: 24,
      backgroundColor: AppColors.limeTint,
      foregroundImage:
          photo != null && photo.isNotEmpty ? NetworkImage(photo) : null,
      child: Text(
        name.characters.take(1).toString(),
        style: const TextStyle(
          color: AppColors.ink,
          fontWeight: FontWeight.w800,
          fontSize: 18,
        ),
      ),
    );
  }
}

/// The design's balance card, carrying the number that actually matters here.
class _FocusCard extends StatelessWidget {
  const _FocusCard({required this.summary, required this.loading});

  final TaskSummary summary;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
      decoration: BoxDecoration(
        color: AppColors.ink,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: [
          BoxShadow(
            color: AppColors.ink.withValues(alpha: .22),
            blurRadius: 28,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'مهام مفتوحة',
            style: TextStyle(color: Colors.white60, fontSize: 13.5),
          ),
          const SizedBox(height: 6),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 350),
            child: Text(
              loading ? '—' : '${summary.open}',
              key: ValueKey(loading ? -1 : summary.open),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 46,
                fontWeight: FontWeight.w800,
                height: 1.1,
              ),
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              _Stat(
                label: 'اليوم',
                value: summary.dueToday,
                tint: AppColors.lime,
              ),
              _Stat(
                label: 'متأخرة',
                value: summary.overdue,
                tint: AppColors.danger,
              ),
              _Stat(
                label: 'مكتملة',
                value: summary.completed,
                tint: Colors.white70,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.tint});

  final String label;
  final int value;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$value',
            style: TextStyle(
              color: tint,
              fontSize: 20,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: const TextStyle(color: Colors.white54, fontSize: 12.5),
          ),
        ],
      ),
    );
  }
}

class _AllClear extends StatelessWidget {
  const _AllClear();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 120),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 40),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.card),
        ),
        child: const Column(
          children: [
            Icon(Icons.check_circle_outline_rounded,
                size: 44, color: AppColors.success),
            SizedBox(height: 12),
            Text(
              'لا توجد مهام مفتوحة',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15.5),
            ),
            SizedBox(height: 4),
            Text(
              'كل شيء منجز — استمتع بيومك.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 120),
      child: Column(
        children: List.generate(
          3,
          (_) => Container(
            height: 76,
            margin: const EdgeInsets.only(bottom: 10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .55),
              borderRadius: BorderRadius.circular(AppRadius.tile),
            ),
          ),
        ),
      ),
    );
  }
}

/// Rows arrive one after another instead of all at once. Capped, so a long
/// list does not make the last row wait.
class _StaggeredIn extends StatelessWidget {
  const _StaggeredIn({required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) return child;

    final delay = Duration(milliseconds: 40 * (index.clamp(0, 8)));
    return TweenAnimationBuilder<double>(
      key: ValueKey(index),
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 380) + delay,
      curve: Curves.easeOutCubic,
      builder: (context, value, child) => Opacity(
        opacity: value.clamp(0, 1),
        child: Transform.translate(
          offset: Offset(0, (1 - value) * 14),
          child: child,
        ),
      ),
      child: child,
    );
  }
}
