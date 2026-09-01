import 'package:flutter/material.dart';

import '../../core/app_colors.dart';
import '../../core/app_theme.dart';
import '../../core/format.dart';
import '../../data/models/records.dart';
import '../../data/models/task.dart';
import '../../data/presence.dart';
import '../../data/repos.dart';
import '../../data/session.dart';
import '../../data/tasks_repo.dart';
import '../../widgets/common.dart';
import '../../widgets/task_tile.dart';
import '../announcements/announcements_screen.dart';
import '../calendar/calendar_screen.dart';
import '../chat/chat_thread_screen.dart';
import '../chat/chats_screen.dart';
import '../profile/profile_screen.dart';
import '../requests/requests_screen.dart';

/// The first screen: who you are, what is on your plate, the week ahead, and
/// the conversations you were last in.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgApp,
      body: StreamBuilder<List<Task>>(
        stream: TasksRepo.instance.myTasks(),
        builder: (context, snapshot) {
          final tasks = snapshot.data ?? const <Task>[];
          final summary = TaskSummary.of(tasks);
          final live = tasks.where((task) => task.status.isOpen).toList()
            ..sort(_mostUrgentFirst);

          return CustomScrollView(
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
              SliverToBoxAdapter(child: _Stats(summary: summary)),
              const SliverToBoxAdapter(child: _QuickActions()),
              SliverToBoxAdapter(child: _WeekStrip(tasks: tasks)),
              const SliverToBoxAdapter(child: _RecentChats()),
              SliverToBoxAdapter(
                child: _SectionHeader(
                  title: 'مهامك المفتوحة',
                  count: live.length,
                ),
              ),
              if (!snapshot.hasData)
                const SliverToBoxAdapter(child: _Loading())
              else if (live.isEmpty)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 20, bottom: 130),
                    child: EmptyState(
                      icon: Icons.check_circle_outline_rounded,
                      title: 'لا توجد مهام مفتوحة',
                      text: 'كل شيء منجز — استمتع بيومك.',
                      tone: AppColors.success,
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 130),
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
          );
        },
      ),
    );
  }

  /// Overdue first, then by deadline, then by priority. A list that leads with
  /// whatever happened to be created last is not a list anyone can work from.
  static int _mostUrgentFirst(Task a, Task b) {
    if (a.isOverdue != b.isOverdue) return a.isOverdue ? -1 : 1;

    final aDue = a.dueAt;
    final bDue = b.dueAt;
    if (aDue != null && bDue != null && aDue != bDue) return aDue.compareTo(bDue);
    if (aDue != null && bDue == null) return -1;
    if (aDue == null && bDue != null) return 1;

    return b.priority.weight.compareTo(a.priority.weight);
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
        child: ListenableBuilder(
          listenable: Session.instance,
          builder: (context, _) => Row(
            children: [
              // Straight to your own page, which is where a photo of you
              // should lead.
              GestureDetector(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const ProfileScreen()),
                ),
                child: PresenceAvatar(
                  uid: Session.instance.uid,
                  name: Session.instance.displayName,
                  url: Session.instance.photoUrl,
                  size: 50,
                  ringColor: AppColors.bgApp,
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'أهلاً بك',
                      style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      Session.instance.displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -.3,
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

/// The design's balance card, carrying the number that matters here.
class _FocusCard extends StatelessWidget {
  const _FocusCard({required this.summary, required this.loading});

  final TaskSummary summary;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 22),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: [AppColors.brandLight, AppColors.brand, AppColors.brandHover],
        ),
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: [
          BoxShadow(
            color: AppColors.brand.withValues(alpha: .32),
            blurRadius: 30,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                'مهام مفتوحة',
                style: TextStyle(color: Colors.white70, fontSize: 13.5),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .18),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.bolt_rounded, size: 13, color: AppColors.onBrand),
                    const SizedBox(width: 4),
                    Text(
                      'مهامي',
                      style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.onBrand,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 380),
            child: Text(
              loading ? '—' : '${summary.open}',
              key: ValueKey(loading ? -1 : summary.open),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 48,
                fontWeight: FontWeight.w800,
                height: 1.15,
              ),
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              _CardStat(label: 'اليوم', value: summary.dueToday),
              _CardDivider(),
              _CardStat(label: 'متأخرة', value: summary.overdue, alarm: true),
              _CardDivider(),
              _CardStat(label: 'مكتملة', value: summary.completed),
            ],
          ),
        ],
      ),
    );
  }
}

class _CardDivider extends StatelessWidget {
  @override
  Widget build(BuildContext context) => Container(
        width: 1,
        height: 28,
        color: Colors.white.withValues(alpha: .22),
      );
}

class _CardStat extends StatelessWidget {
  const _CardStat({
    required this.label,
    required this.value,
    this.alarm = false,
  });

  final String label;
  final int value;
  final bool alarm;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            '$value',
            style: TextStyle(
              // Only overdue earns a different colour, and only when there is
              // something to be alarmed about.
              color: alarm && value > 0 ? const Color(0xFFFFE08A) : Colors.white,
              fontSize: 21,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: const TextStyle(color: Colors.white70, fontSize: 12.5),
          ),
        ],
      ),
    );
  }
}

/// The profile's headline numbers, on the first screen so nobody has to go
/// looking for them.
class _Stats extends StatelessWidget {
  const _Stats({required this.summary});

  final TaskSummary summary;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
      child: TapCard(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 14),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const ProfileScreen()),
        ),
        child: Row(
          children: [
            Expanded(
              child: _MiniStat(
                value: '${summary.completionRate}%',
                label: 'نسبة الإنجاز',
                tone: AppColors.brandLight,
              ),
            ),
            Container(width: 1, height: 30, color: AppColors.border),
            Expanded(
              child: _MiniStat(
                value: '${summary.completedWeek}',
                label: 'أُنجز هذا الأسبوع',
                tone: AppColors.success,
              ),
            ),
            Container(width: 1, height: 30, color: AppColors.border),
            Expanded(
              child: _MiniStat(
                value: '${summary.completedMonth}',
                label: 'هذا الشهر',
                tone: AppColors.info,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({
    required this.value,
    required this.label,
    required this.tone,
  });

  final String value;
  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            fontSize: 19,
            fontWeight: FontWeight.w800,
            color: tone,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 11, color: AppColors.textMuted),
        ),
      ],
    );
  }
}

/// The next seven days with a count on each, and the way into the full month.
class _WeekStrip extends StatelessWidget {
  const _WeekStrip({required this.tasks});

  final List<Task> tasks;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);

    final days = List.generate(7, (i) => today.add(Duration(days: i)));
    final counts = {
      for (final day in days)
        day: tasks
            .where((task) =>
                task.status.isOpen &&
                task.dueAt != null &&
                DateTime(task.dueAt!.year, task.dueAt!.month, task.dueAt!.day) ==
                    day)
            .length,
    };

    return Column(
      children: [
        _SectionHeader(
          title: 'الأسبوع',
          action: 'التقويم',
          onAction: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const CalendarScreen()),
          ),
        ),
        SizedBox(
          height: 78,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            itemCount: days.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (context, i) => _Day(
              date: days[i],
              count: counts[days[i]] ?? 0,
              isToday: i == 0,
            ),
          ),
        ),
      ],
    );
  }
}

class _Day extends StatelessWidget {
  const _Day({
    required this.date,
    required this.count,
    required this.isToday,
  });

  final DateTime date;
  final int count;
  final bool isToday;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const CalendarScreen()),
      ),
      child: Container(
        width: 58,
        decoration: BoxDecoration(
          color: isToday ? AppColors.brand : AppColors.bgSurface,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              Fmt.shortWeekday(date),
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: isToday ? AppColors.onBrand : AppColors.textMuted,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              '${date.day}',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w800,
                color: isToday ? AppColors.onBrand : AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            Container(
              width: count > 0 ? 18 : 5,
              height: 5,
              decoration: BoxDecoration(
                color: count > 0
                    ? (isToday ? AppColors.onBrand : AppColors.brandLight)
                    : (isToday
                        ? AppColors.onBrand.withValues(alpha: .35)
                        : AppColors.border),
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The last few conversations, so replying does not start with a search.
class _RecentChats extends StatelessWidget {
  const _RecentChats();

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Chat>>(
      stream: Repos.instance.myChats(limit: 6),
      builder: (context, snapshot) {
        final chats = (snapshot.data ?? const <Chat>[]).take(3).toList();
        if (chats.isEmpty) return const SizedBox.shrink();

        return Column(
          children: [
            _SectionHeader(
              title: 'آخر المحادثات',
              action: 'الكل',
              onAction: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ChatsScreen()),
              ),
            ),
            for (final chat in chats)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: _ChatRow(chat: chat),
              ),
          ],
        );
      },
    );
  }
}

class _ChatRow extends StatelessWidget {
  const _ChatRow({required this.chat});

  final Chat chat;

  @override
  Widget build(BuildContext context) {
    final other = chat.members.firstWhere(
      (id) => id != Session.instance.uid,
      orElse: () => '',
    );

    return FutureBuilder(
      future: chat.isDirect ? Repos.instance.person(other) : null,
      builder: (context, snapshot) {
        final title = chat.name.isNotEmpty
            ? chat.name
            : (snapshot.data?.name ?? 'محادثة');

        return TapCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => ChatThreadScreen(chat: chat)),
          ),
          child: Row(
            children: [
              if (chat.isDirect)
                PresenceAvatar(
                  uid: other,
                  name: title,
                  url: snapshot.data?.photoUrl,
                  size: 38,
                )
              else
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: AppColors.brand.withValues(alpha: .16),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(chat.icon, color: AppColors.brandLight, size: 19),
                ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (chat.lastMessage.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        chat.lastMessage,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (chat.lastMessageAt != null)
                Text(
                  Fmt.ago(chat.lastMessageAt!),
                  style: TextStyle(fontSize: 11, color: AppColors.textMuted),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    this.count,
    this.action,
    this.onAction,
  });

  final String title;
  final int? count;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final badge = count;
    final label = action;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 12),
      child: Row(
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          if (badge != null && badge > 0) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.brand.withValues(alpha: .18),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                '$badge',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: AppColors.brandLight,
                ),
              ),
            ),
          ],
          const Spacer(),
          if (label != null)
            GestureDetector(
              onTap: onAction,
              child: Row(
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.brandLight,
                    ),
                  ),
                  Icon(Icons.chevron_left_rounded,
                      size: 18, color: AppColors.brandLight),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions();

  @override
  Widget build(BuildContext context) {
    final actions = <(IconData, String, Color, Widget Function())>[
      (Icons.forum_rounded, 'المحادثات', AppColors.brandLight, ChatsScreen.new),
      (
        Icons.assignment_turned_in_rounded,
        'الطلبات',
        AppColors.warning,
        RequestsScreen.new
      ),
      (
        Icons.campaign_rounded,
        'الإعلانات',
        AppColors.purple,
        AnnouncementsScreen.new
      ),
    ];

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
      child: Row(
        children: [
          for (var i = 0; i < actions.length; i++) ...[
            if (i > 0) const SizedBox(width: 10),
            Expanded(
              child: TapCard(
                padding: const EdgeInsets.symmetric(vertical: 14),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => actions[i].$4()),
                ),
                child: Column(
                  children: [
                    Icon(actions[i].$1, color: actions[i].$3, size: 22),
                    const SizedBox(height: 7),
                    Text(
                      actions[i].$2,
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 130),
      child: Column(
        children: List.generate(
          3,
          (_) => Container(
            height: 76,
            margin: const EdgeInsets.only(bottom: 10),
            decoration: BoxDecoration(
              color: AppColors.bgSurface,
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
